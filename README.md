# Imuh — Live Broadcast Avatar

A web page that simulates a live broadcast. A Perxona `<sv-presenter>` virtual human
(bottom-right) acts as the anchor's on-screen agent:

1. A selected broadcast **video plays full-screen** as the background (muted, looping).
2. The page **continuously captures mic audio**, runs it through a swappable
   **speech-to-text** layer, and feeds the transcript to the avatar via `present()`.
3. The presenter's spoken text is shown as **subtitles at the bottom-center**.

Built with **Vanilla JS + Vite** (frontend) and a thin **Express** backend that mints the
Perxona Connect token, proxies the catalog, and forwards audio to a cloud STT provider.

---

## Architecture

```
Browser (Vite, vanilla JS)                    Backend (Express)
┌────────────────────────────────┐            ┌─────────────────────────────┐
│ #bg-video  full-screen video   │            │ GET  /api/config            │
│ <sv-presenter> bottom-right ◀───┼── CDN ─────│ GET  /api/connect-token     │
│ #subtitles  bottom-center      │            │ GET  /api/avatars|scenes|…  │
│ #hud  Start + status           │            │ POST /api/stt → cloud STT   │
│ mic → MediaRecorder ───────────┼── POST ────▶ /api/stt → { text }         │
└────────────────────────────────┘            └─────────────────────────────┘

mic → chunk → POST /api/stt → { text } → presenter.present(text)
   → PLAYING_SPEECH_TEXT event → subtitles
```

### Project layout

```
.
├── index.html              # Vite entry — layout containers + <sv-presenter>
├── vite.config.js          # dev server + /api proxy to Express
├── server/server.mjs       # Express: connect-token, catalog proxy, /api/stt, config
├── src/
│   ├── main.js             # orchestrator: Start gesture → init → mic pipeline
│   ├── config.js           # loads /api/config (+ query overrides)
│   ├── presenter.js        # <sv-presenter> engine loader + wrapper
│   ├── videoBackground.js  # full-screen video (mp4 + HLS)
│   ├── subtitles.js        # bottom-center overlay from PLAYING_SPEECH_TEXT
│   ├── style.css           # layout
│   └── stt/
│       ├── SpeechToTextEngine.js  # the swappable STT interface + factory
│       ├── cloudSttAdapter.js     # default: mic → /api/stt (Whisper)
│       └── mockSttAdapter.js      # no-mic/no-key demo stub
└── docs/presenter.d.ts     # presenter contract (IDE autocomplete)
```

---

## Quick start

Requires **Node `>=22`** (`nvm use` reads `.nvmrc`).

```bash
cp .env.example .env      # then fill in the values below
npm install
npm run dev               # Vite UI + Express API together
```

Open the printed Vite URL (default `http://localhost:5173`), click **開始直播**, allow the
mic, and the avatar re-voices what you say with live subtitles.

### Required `.env` values

| Variable                   | Required | Description                                                       |
| -------------------------- | -------- | ----------------------------------------------------------------- |
| `PERXONA_API_BASE_URL`     | ✅       | Region-specific Connect API base URL. From your Perxona contact.  |
| `PERXONA_CONNECT_EMAIL`    | ✅       | Perxona service account email (server signs in — no browser login). |
| `PERXONA_CONNECT_PASSWORD` | ✅       | Perxona service account password.                                 |
| `BROADCAST_VIDEO_URL`      | ▲        | Background video (mp4 or HLS `.m3u8`). Needed for the broadcast look. |
| `STT_API_KEY`              | ▲        | Cloud transcription key (OpenAI Whisper by default). Or set `STT_PROVIDER=mock`. |

Optional: `PRESENTER_URL`, `DEFAULT_AVATAR_ID` / `DEFAULT_SCENE_ID` / `DEFAULT_VOICE_ID`,
`STT_PROVIDER` (`openai`|`mock`), `STT_BASE_URL`, `STT_MODEL`, `STT_LANGUAGE`, `PORT`,
`WEB_PORT`. See `.env.example` for the full list.

> **No key yet?** Set `STT_PROVIDER=mock` to run the full pipeline (subtitles + avatar
> speech) without a mic or transcription key.

---

## Scripts

| Command           | What it does                                              |
| ----------------- | -------------------------------------------------------- |
| `npm run dev`     | Vite dev server + Express with live reload (both).       |
| `npm run build`   | Build the frontend to `dist/`.                           |
| `npm start`       | Production: Express serves `dist/` and the API (one port). |

---

## Demo setup notes

- **Audio feedback:** the background video is muted and continuous listening assumes
  **headphones**, so the mic doesn't re-capture the avatar's own voice.
- **Autoplay:** browsers require a user gesture before audio — the **開始直播** button
  unlocks the presenter's AudioContext and requests the mic.

---

## Status

Scaffold complete. Module bodies marked `TODO(<todo-id>)` are filled in by the remaining
implementation milestones (`video-bg`, `presenter`, `stt`, `subtitles`, `orchestrator`).

## License

Apache License 2.0.
