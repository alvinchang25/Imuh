# Imuh — Architecture & Implementation Plan

> Full design plan for the live-broadcast avatar app. See [`README.md`](../README.md) for
> setup/run instructions. This document is the source of truth for **why** the pieces exist
> and **how** they fit together.

## Problem

Build a web page that simulates a live broadcast. A Perxona `<sv-presenter>` virtual human
(bottom-right) acts as the anchor's on-screen agent:

1. A selected broadcast **video plays full-screen as the background** (loops, muted).
2. The page **continuously captures mic audio**, runs it through a **speech-to-text** layer
   (defined as a swappable interface), and feeds the transcript to `<sv-presenter>` via
   `present(text)`.
3. The page **listens for the presenter's `PLAYING_SPEECH_TEXT` event** and renders that
   text as **subtitles at the bottom-center** of the screen.

## Confirmed decisions

| Question | Decision |
| --- | --- |
| Frontend framework | **Vanilla JS + Vite** (matches the kit sample, zero framework overhead). |
| STT | **Cloud STT** behind a swappable interface; default adapter posts mic audio to the backend `POST /api/stt`, which forwards to a cloud provider (OpenAI Whisper by default). Key stays server-side. |
| Avatar content | **Direct pass-through** — STT transcript → `present()` verbatim (no LLM). |
| Background video | **Remote video URL** (mp4 or HLS `.m3u8`). Configurable via env/query. |
| Feedback loop | **Assume headphones + muted background video**, continuous listening (simplest). |

## The Perxona kit (what we build on)

**Backend building blocks** (ported from `perxona-connect-kit/samples/express`):

- `GET /api/connect-token` — mints one shared Connect bearer JWT for the browser to pass
  into `presenter.initialize()`. One service account, no per-user login.
- `GET /api/avatars` · `/api/scenes` · `/api/voices` — catalog proxy (normalizes
  `avatar_id`/`scene_id` → `id`).
- Transparent re-login + retry on `401/403` from upstream.

**Frontend SDK — the `<sv-presenter>` Web Component** (loaded from Perxona's CDN,
framework-agnostic). Members this product relies on:

| Member / event | Role in this product |
| --- | --- |
| `initialize(connectToken, { type:'explicit', avatarId, sceneId, voiceId })` | Boot the avatar with the chosen target. |
| `resumeAudioPlayback()` | Unlock autoplay — must run from the Start user gesture. |
| `present(text)` | Speak the STT transcript (synth + motion). |
| `interruptPresentation()` | Optional barge-in to cut off the current line. |
| event `PLAYING_SPEECH_TEXT` | **Subtitle source** — the text currently being spoken. |
| event `PRESENTER_STATUS` | `Uninitialized → Initializing → Ready` (drives HUD + reveal). |
| event `PERFORMANCE_STATE` | `Idle/Listening/Thinking/Talking` (optional mic gating). |

## Architecture

```
Browser (Vanilla JS + Vite)                     Backend (Express)
┌───────────────────────────────────┐           ┌──────────────────────────────────┐
│ #bg-video  (full-bleed <video>)    │           │ GET  /api/config    presenterUrl… │
│ <sv-presenter> (fixed bottom-right)│◀── CDN ───│ GET  /api/connect-token  (Perxona)│
│ #subtitles (fixed bottom-center)   │           │ GET  /api/avatars|scenes|voices   │
│ #hud  Start button + status        │           │ POST /api/stt  → cloud STT (key)  │
│ mic → MediaRecorder → chunk ───────┼── POST ───▶ /api/stt → { text }               │
└───────────────────────────────────┘           └──────────────────────────────────┘

Data flow:
mic → MediaRecorder chunk → POST /api/stt → { text }
   → SttEngine.onFinal(text) → presenter.present(text)
   → PLAYING_SPEECH_TEXT event → subtitle overlay
```

### Frontend modules (`src/`)

- `main.js` — orchestrator. `Start` click (user gesture) → `resumeAudioPlayback()` +
  `initialize(token, target)` + `sttEngine.start()` + `getUserMedia`. Wires
  `onFinal → present`, `PLAYING_SPEECH_TEXT → subtitles`,
  `PRESENTER_STATUS/PERFORMANCE_STATE → HUD`.
- `presenter.js` — loads the engine `<script>` from `presenterUrl`; wraps
  `initialize/present/resumeAudioPlayback/interrupt` and event listeners.
- `stt/SpeechToTextEngine.js` — the **interface** (JSDoc typedef): `start()`, `stop()`,
  `onPartial(cb)`, `onFinal(cb)`, `onError(cb)` + a `createSttEngine(config)` factory.
- `stt/cloudSttAdapter.js` — **default** adapter: MediaRecorder captures mic, segments audio,
  POSTs each chunk to `/api/stt`, emits final transcripts.
- `stt/mockSttAdapter.js` — offline stub (canned lines on a timer) so the UI runs without a
  key. Swap via `STT_PROVIDER=mock`.
- `subtitles.js` — renders `PLAYING_SPEECH_TEXT` into the bottom-center overlay (fade in/out).
- `videoBackground.js` — full-screen muted looping video; uses `hls.js` for `.m3u8`
  (native HLS on Safari), plain `<video>` for mp4.
- `config.js` — reads `/api/config` + query-param overrides (video URL, avatar/scene/voice).

### Backend (`server/server.mjs`)

- Keeps `/api/connect-token`, catalog proxy, `/api/config`, `/api/health` from the sample.
- **`POST /api/stt`** — accepts a raw audio blob (recorder Content-Type), forwards to the
  configured cloud STT provider (default OpenAI Whisper `/audio/transcriptions`), returns
  `{ text }`. Provider swappable behind one server-side function; API key never reaches the
  browser.
- **Extended `/api/config`** exposes `broadcastVideoUrl`, default avatar/scene/voice ids, and
  STT availability (so the frontend needs no picker for the demo).
- Env vars: `STT_PROVIDER`, `STT_API_KEY`, `STT_BASE_URL`, `STT_MODEL`, `STT_LANGUAGE`,
  `BROADCAST_VIDEO_URL`, `DEFAULT_AVATAR_ID`/`SCENE`/`VOICE`, plus existing `PERXONA_*`.

### Layout / CSS

- Video: `position:fixed; inset:0; object-fit:cover; z-index:0; muted; loop`.
- `<sv-presenter>`: `position:fixed; right/bottom; ~360px; z-index:2`.
- Subtitles: `position:fixed; bottom; left:50%; translateX(-50%); z-index:3`.
- HUD (Start + status): top-left, `z-index:4`.

## Key considerations / risks

- **Autoplay policy** — `resumeAudioPlayback()` + `getUserMedia()` must be triggered by the
  Start user gesture. One clear entry button.
- **Feedback loop** — per decision, background video is muted and we assume headphones; STT
  runs continuously. `PERFORMANCE_STATE` gating can be added later if needed.
- **present() ordering** — rapid successive finals are safe (SDK plays them in call order).
  Optional barge-in via `interruptPresentation()`.
- **Connect token expiry** — sample doesn't wire `CONNECT_TOKEN_EXPIRED`; long sessions may go
  stale. Mitigation: reload, or later wire `refreshConnectToken`.
- **HLS/CORS** — only via `hls.js`/native; validate the chosen video URL allows CORS.
- **STT latency/cost** — chunked Whisper adds round-trip latency; tune chunk size. The
  interface allows swapping to a streaming (WebSocket) provider later without touching the UI.

## Milestones

Status tracked during development. `TODO(<id>)` markers in the source point at the milestone
that completes each module body.

| # | ID | Milestone | Status |
| - | -- | --------- | ------ |
| 1 | `scaffold` | Vite vanilla project + backend structure in the Imuh repo. | ✅ done |
| 2 | `backend` | Port express sample, add `/api/stt`, extend `/api/config`, env/.env.example. | ✅ done |
| 3 | `video-bg` | Full-screen video background module (mp4 + HLS + YouTube). | ⏳ partial — mp4 works; HLS & YouTube embed pending |
| 4 | `presenter` | Presenter wrapper: load engine, initialize, present, events. | ✅ done |
| 5 | `stt` | STT interface + cloud adapter + mock adapter. | ⏳ partial — interface & mock done; cloud adapter stub (no mic capture yet) |
| 6 | `subtitles` | Subtitle overlay from `PLAYING_SPEECH_TEXT`. | ✅ done |
| 7 | `orchestrator` | main.js orchestrator + Start gesture + HUD + layout CSS. | ✅ done |
| 8 | `e2e-docs` | Wire end-to-end, docs, manual test pass. | ⏳ in progress — 404 bug (empty avatar ID) found during first test |

> **Remaining work:** (a) implement real mic → cloud STT in `cloudSttAdapter.js`, (b) add
> YouTube IFrame Player API support to `videoBackground.js`, (c) set `DEFAULT_AVATAR_ID` in
> `.env` to fix the 404, (d) final E2E validation.
