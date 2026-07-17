/**
 * Imuh — orchestrator.
 *
 * Boots the live-broadcast experience: background video, the <sv-presenter>
 * virtual anchor, continuous mic → STT → avatar speech, and bottom-center
 * subtitles driven by the presenter's PLAYING_SPEECH_TEXT event.
 *
 * The heavy wiring (initialize handshake, mic pipeline) is finished in the
 * `orchestrator` todo. This scaffold boots config + video + status so the page
 * runs end-to-end shell today.
 */

import { loadConfig } from "./config.js";
import { startBackgroundVideo } from "./videoBackground.js";
import {
  loadPresenterEngine,
  createPresenter,
} from "./presenter.js";
import { createSubtitles } from "./subtitles.js";
import { createSttEngine } from "./stt/SpeechToTextEngine.js";
import { createAvatarDialog } from "./avatarDialog.js";

const els = {
  video: document.getElementById("bg-video"),
  presenter: document.getElementById("presenter"),
  subtitles: document.getElementById("subtitles"),
  startBtn: document.getElementById("start-btn"),
  status: document.getElementById("status"),
};

const avatarDialog = createAvatarDialog({
  dialog: document.getElementById("avatar-dialog"),
  bar: document.getElementById("avatar-dialog-bar"),
  closeBtn: document.getElementById("avatar-dialog-close"),
  toggleBtn: document.getElementById("avatar-toggle"),
});

const setStatus = (t) => {
  els.status.textContent = t;
};

const cfg = await loadConfig();
const subtitles = createSubtitles(els.subtitles);

// Background video can start immediately (muted autoplay is allowed).
await startBackgroundVideo(els.video, cfg.broadcastVideoUrl);
setStatus("點擊「開始直播」啟動主播與收音");

// The Start button is the required user gesture: it unlocks audio, initializes
// the presenter, and starts the mic → STT pipeline.
els.startBtn.addEventListener("click", async () => {
  els.startBtn.disabled = true;
  try {
    setStatus("載入主播引擎…");
    await loadPresenterEngine(cfg.presenterUrl);
    const presenter = createPresenter(els.presenter);

    // Subtitles follow whatever the avatar is currently speaking.
    presenter.on("PLAYING_SPEECH_TEXT", ({ text }) => subtitles.show(text));
    presenter.on("PRESENTER_STATUS", ({ status }) => {
      setStatus(status === "Ready" ? "✓ 直播中" : status);
      if (status === "Ready") avatarDialog.open();
    });

    setStatus("解鎖音訊…");
    await presenter.resumeAudioPlayback();

    setStatus("取得連線權杖…");
    const { connect_token } = await (await fetch("/api/connect-token")).json();

    setStatus("初始化主播…");
    await presenter.initialize(connect_token, {
      type: "explicit",
      avatarId: cfg.defaults.avatarId,
      sceneId: cfg.defaults.sceneId,
      voiceId: cfg.defaults.voiceId || undefined,
    });

    // Mic → STT → avatar. STT is swappable behind the interface; the transcript
    // is passed straight to present() (direct pass-through, no LLM).
    const stt = await createSttEngine({ provider: cfg.stt.provider });
    stt.onFinal((text) => presenter.present(text));
    stt.onError((err) => setStatus(`STT 錯誤：${err.message}`));
    await stt.start();

    setStatus("✓ 直播中");
  } catch (err) {
    console.error(err);
    setStatus(`錯誤：${err.message}`);
    els.startBtn.disabled = false;
  }
});
