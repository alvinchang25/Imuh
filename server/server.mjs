import express from "express";
import { fileURLToPath } from "node:url";
import path from "node:path";
import speech from "@google-cloud/speech";
import { WebSocketServer } from "ws";

// Load .env into process.env (Node >=20.12). Non-fatal if the file is missing —
// values may come from the real environment instead.
try {
  process.loadEnvFile(new URL("../.env", import.meta.url));
} catch {
  // no .env file — rely on the ambient environment
}

// ── Config ───────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 8088;
const PERXONA_API_BASE_URL = process.env.PERXONA_API_BASE_URL;
const CONNECT_EMAIL = process.env.PERXONA_CONNECT_EMAIL;
const CONNECT_PASSWORD = process.env.PERXONA_CONNECT_PASSWORD;
const PRESENTER_URL =
  process.env.PRESENTER_URL ||
  "https://cdn.perxona.ai/prod/latest/widget/entry/presenter.js";

const DEFAULT_AVATAR_ID = process.env.DEFAULT_AVATAR_ID || "";
const DEFAULT_SCENE_ID = process.env.DEFAULT_SCENE_ID || "";
const DEFAULT_VOICE_ID = process.env.DEFAULT_VOICE_ID || "";
const BROADCAST_VIDEO_URL = process.env.BROADCAST_VIDEO_URL || "";

const STT_PROVIDER = (process.env.STT_PROVIDER || "openai").toLowerCase();
const STT_API_KEY = process.env.STT_API_KEY || "";
const STT_BASE_URL = process.env.STT_BASE_URL || "https://api.openai.com/v1";
const STT_MODEL = process.env.STT_MODEL || "whisper-1";
const STT_LANGUAGE = process.env.STT_LANGUAGE || "";
// Google Cloud Speech-to-Text streaming (STT_PROVIDER=google) authenticates via
// Application Default Credentials (`gcloud auth application-default login`) —
// no API key in .env, unlike the openai/whisper adapter.
const GOOGLE_STT_LANGUAGE = STT_LANGUAGE || "zh-TW";
const speechClient = new speech.SpeechClient();

const IS_DEV = process.env.NODE_ENV !== "production";

// Fail fast on missing Perxona credentials — the presenter can't do anything
// without them. STT is validated lazily on the first /api/stt call so the app
// still boots (and the video/subtitle UI works) without a transcription key.
for (const [name, value] of Object.entries({
  PERXONA_API_BASE_URL,
  PERXONA_CONNECT_EMAIL: CONNECT_EMAIL,
  PERXONA_CONNECT_PASSWORD: CONNECT_PASSWORD,
})) {
  if (!value) {
    console.error(
      `ERROR: ${name} is required. Copy .env.example to .env and fill it in.`,
    );
    process.exit(1);
  }
}

// ── Upstream Connect API ──────────────────────────────────────────────────────

async function callUpstream(path, opts, token) {
  const headers = { "Content-Type": "application/json", ...opts.headers };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return fetch(`${PERXONA_API_BASE_URL}${path}`, { ...opts, headers });
}

async function upstreamJson(r, label) {
  if (!r.ok) {
    const payload = await r.json().catch(() => ({}));
    throw Object.assign(new Error(`upstream ${label} failed`), {
      status: r.status,
      payload,
    });
  }
  return r.json();
}

const connectApi = {
  async checkUpstream() {
    try {
      const r = await fetch(`${PERXONA_API_BASE_URL}/ready`);
      return r.ok ? "reachable" : "unreachable";
    } catch {
      return "unreachable";
    }
  },
  async login(body) {
    const r = await callUpstream("/api/v1/connect/auth/login", {
      method: "POST",
      body: JSON.stringify(body),
    });
    return upstreamJson(r, "login");
  },
  async voices(token) {
    const r = await callUpstream("/api/v1/connect/voices", {}, token);
    return upstreamJson(r, "voices");
  },
  async avatars(token) {
    const r = await callUpstream("/api/v1/connect/assets/avatars", {}, token);
    const page = await upstreamJson(r, "avatars");
    return {
      ...page,
      items: (page.items ?? []).map(({ avatar_id, ...rest }) => ({
        id: avatar_id,
        ...rest,
      })),
    };
  },
  async scenes(token) {
    const r = await callUpstream("/api/v1/connect/assets/scenes", {}, token);
    const page = await upstreamJson(r, "scenes");
    return {
      ...page,
      items: (page.items ?? []).map(({ scene_id, ...rest }) => ({
        id: scene_id,
        ...rest,
      })),
    };
  },
};

// ── Shared Connect token manager ──────────────────────────────────────────────

let cachedToken = null;
let loginPromise = null;

async function getToken({ forceRefresh = false } = {}) {
  if (cachedToken && !forceRefresh) return cachedToken;
  if (forceRefresh) cachedToken = null;
  if (!loginPromise) {
    loginPromise = connectApi
      .login({ email: CONNECT_EMAIL, password: CONNECT_PASSWORD })
      .then(({ access_token }) => {
        cachedToken = access_token;
        return cachedToken;
      })
      .finally(() => {
        loginPromise = null;
      });
  }
  return loginPromise;
}

async function authedCall(fn) {
  const token = await getToken();
  try {
    return await fn(token);
  } catch (err) {
    if (err.status !== 401 && err.status !== 403) throw err;
    const fresh = await getToken({ forceRefresh: true });
    return fn(fresh);
  }
}

// ── Speech-to-text forwarding ─────────────────────────────────────────────────

/**
 * Forward a raw audio buffer to the configured cloud transcription API and
 * return the recognized text. Provider is swappable via STT_* env vars; the API
 * key stays server-side. Throws { status, payload } on failure so the route can
 * surface it consistently.
 * @param {Buffer} audio
 * @param {string} contentType  e.g. "audio/webm"
 * @returns {Promise<string>}
 */
async function transcribe(audio, contentType) {
  if (!STT_API_KEY) {
    throw Object.assign(new Error("STT_API_KEY not configured"), {
      status: 501,
      payload: { error: "STT_API_KEY not configured. Set it in .env." },
    });
  }
  const ext = contentType.includes("wav")
    ? "wav"
    : contentType.includes("mp4") || contentType.includes("mp4a")
      ? "mp4"
      : contentType.includes("ogg")
        ? "ogg"
        : "webm";

  const form = new FormData();
  form.append("file", new Blob([audio], { type: contentType }), `audio.${ext}`);
  form.append("model", STT_MODEL);
  if (STT_LANGUAGE) form.append("language", STT_LANGUAGE);

  const r = await fetch(`${STT_BASE_URL}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${STT_API_KEY}` },
    body: form,
  });
  if (!r.ok) {
    const payload = await r.json().catch(() => ({}));
    throw Object.assign(new Error("stt upstream failed"), {
      status: r.status,
      payload,
    });
  }
  const data = await r.json();
  return data.text ?? "";
}

// ── Express app ───────────────────────────────────────────────────────────────

const app = express();
app.disable("x-powered-by");

function route(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (err) {
      const status = err.status ?? 502;
      res.status(status).json(err.payload ?? { error: String(err) });
    }
  };
}

// GET /api/health → liveness + upstream reachability.
app.get("/api/health", async (_req, res) => {
  res.json({ status: "ok", upstream: await connectApi.checkUpstream() });
});

// GET /api/config → static per-process flags the frontend reads on boot.
app.get("/api/config", (_req, res) => {
  res.json({
    presenterUrl: PRESENTER_URL,
    broadcastVideoUrl: BROADCAST_VIDEO_URL,
    defaults: {
      avatarId: DEFAULT_AVATAR_ID,
      sceneId: DEFAULT_SCENE_ID,
      voiceId: DEFAULT_VOICE_ID,
    },
    stt: {
      provider: STT_PROVIDER,
      enabled:
        STT_PROVIDER === "mock" ||
        STT_PROVIDER === "google" ||
        Boolean(STT_API_KEY),
    },
  });
});

// GET /api/connect-token → the Connect bearer JWT for presenter.initialize().
app.get(
  "/api/connect-token",
  route(async (_req, res) => {
    res.set({ "Cache-Control": "no-store", Pragma: "no-cache" });
    const token = await authedCall(async (t) => {
      await connectApi.voices(t);
      return t;
    });
    res.json({ connect_token: token });
  }),
);

// Catalog proxy — populate the picker/defaults.
app.get(
  "/api/voices",
  route(async (_req, res) => res.json(await authedCall((t) => connectApi.voices(t)))),
);
app.get(
  "/api/avatars",
  route(async (_req, res) => res.json(await authedCall((t) => connectApi.avatars(t)))),
);
app.get(
  "/api/scenes",
  route(async (_req, res) => res.json(await authedCall((t) => connectApi.scenes(t)))),
);

// POST /api/stt → transcribe a raw audio chunk. Body is the audio bytes with the
// recorder's Content-Type (e.g. audio/webm). Returns { text }.
app.post(
  "/api/stt",
  express.raw({ type: () => true, limit: "25mb" }),
  route(async (req, res) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      res.status(400).json({ error: "Empty audio body." });
      return;
    }
    const contentType = req.get("content-type") || "audio/webm";
    const text = await transcribe(req.body, contentType);
    res.json({ text });
  }),
);

// ── Static frontend (production) ──────────────────────────────────────────────
// In dev, Vite serves the frontend and proxies /api here. In production, serve
// the built dist/ so one process handles everything.

if (!IS_DEV) {
  const dist = fileURLToPath(new URL("../dist", import.meta.url));
  app.use(express.static(dist));
  app.get("*", (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

// ── Start ─────────────────────────────────────────────────────────────────────

const server = app.listen(PORT, () => {
  console.log(`\nImuh — live broadcast avatar`);
  console.log(`  API    : http://localhost:${PORT}`);
  console.log(`  Mode   : ${IS_DEV ? "dev (Vite serves the UI)" : "production (serving dist/)"}`);
  console.log(`  STT    : ${STT_PROVIDER}${STT_PROVIDER !== "mock" && STT_PROVIDER !== "google" && !STT_API_KEY ? " (no key — /api/stt returns 501)" : ""}`);
  console.log(`  Video  : ${BROADCAST_VIDEO_URL || "(BROADCAST_VIDEO_URL not set)"}`);
});

// ── Google STT streaming (STT_PROVIDER=google) ────────────────────────────────
//
// WS /api/stt-stream — the browser opens one socket per "start listening"
// session and streams raw 16kHz mono PCM frames continuously (including
// silence while the avatar is talking, so the connection survives that gap —
// see googleSttAdapter.js). Each connection is its own independent Google
// streamingRecognize session, restarted transparently under the hood every
// time Google closes it (either because `singleUtterance` detected
// end-of-speech, or the ~5s audio-timeout/~5min max-duration limits were
// hit) — none of that is fatal to the browser's WebSocket.
const sttWebSocketServer = new WebSocketServer({
  server,
  path: "/api/stt-stream",
});

sttWebSocketServer.on("connection", (socket) => {
  let recognizeStream = null;
  let shouldRestart = true;

  function startRecognizing() {
    // Guards against 'error' and 'end' both firing for the same underlying
    // stream instance, which would otherwise start two replacement streams
    // at once.
    let restarted = false;
    function restartOnce() {
      if (restarted) return;
      restarted = true;
      // Only clear the shared reference if it still points at THIS stream —
      // a newer stream may already have replaced it by the time a stale
      // event from this one fires (see the `stream` const below).
      if (recognizeStream === stream) recognizeStream = null;
      if (shouldRestart && socket.readyState === 1) startRecognizing();
    }

    // Bind listeners to this call's own `stream` constant, not the shared
    // outer `recognizeStream` variable. Once restarted, the outer variable is
    // reassigned to a brand-new stream for the next utterance — a late
    // 'data'/'error'/'end' event arriving from THIS (already-finished) stream
    // must only ever act on itself, never reach through the outer variable
    // and cut off the new stream already listening for the next sentence.
    const stream = speechClient
      .streamingRecognize({
        config: {
          encoding: "LINEAR16",
          sampleRateHertz: 16000,
          languageCode: GOOGLE_STT_LANGUAGE,
          enableAutomaticPunctuation: true,
        },
        interimResults: true,
        singleUtterance: true,
      })
      .on("data", (data) => {
        const result = data.results?.[0];
        const transcript = result?.alternatives?.[0]?.transcript?.trim();
        if (transcript && socket.readyState === 1) {
          socket.send(
            JSON.stringify({
              type: "transcript",
              transcript,
              final: Boolean(result.isFinal),
            }),
          );
        }
        // End on isFinal regardless of transcript content (Google can send an
        // empty final when it detects end-of-speech with nothing usable) so
        // the next utterance starts promptly instead of waiting for the
        // stream to time out on its own.
        if (result?.isFinal && !stream.destroyed) {
          stream.end();
        }
      })
      .on("error", (err) => {
        console.error(`[stt-stream] Google stream error: ${err.message}`);
        restartOnce();
      })
      .on("end", restartOnce);

    recognizeStream = stream;
  }

  startRecognizing();

  socket.on("message", (audio, isBinary) => {
    if (isBinary && recognizeStream && !recognizeStream.destroyed) {
      recognizeStream.write(audio);
    }
  });

  socket.on("close", () => {
    shouldRestart = false;
    if (recognizeStream && !recognizeStream.destroyed) recognizeStream.end();
  });
});
