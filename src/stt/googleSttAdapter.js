/**
 * Google STT adapter — satisfies the SpeechToTextEngine interface using
 * Google Cloud Speech-to-Text continuous streaming over the backend's
 * `WS /api/stt-stream` (see server/server.mjs). Unlike cloudSttAdapter (which
 * segments and POSTs whole clips), this adapter streams raw PCM continuously
 * and never stops listening once started — Google's own voice-activity
 * detection (`singleUtterance`) segments it into utterances server-side.
 *
 * Feedback-loop note: this product assumes headphones + a muted background
 * video (see docs/PLAN.md), so unlike the reference implementation this was
 * ported from, real mic audio is NOT silenced while the avatar talks. If you
 * run this without headphones, pass `isSpeaking` in config (a
 * `() => boolean` callback backed by the presenter's PERFORMANCE_START /
 * ALL_PERFORMANCE_FINISHED events) to swap in silence during playback and
 * avoid the avatar transcribing itself.
 *
 * @param {{ isSpeaking?: () => boolean }} [config]
 * @returns {import('./SpeechToTextEngine.js').SpeechToTextEngine}
 */
export function createGoogleSttEngine(config = {}) {
  const isSpeaking = config.isSpeaking ?? (() => false);

  let onFinalCb = () => {};
  let onPartialCb = () => {};
  let onErrorCb = () => {};

  let socket = null;
  let mediaStream = null;
  let audioContext = null;
  let microphoneSource = null;
  let audioProcessor = null;

  /**
   * Downsample a Float32 mic buffer (at the AudioContext's native sample
   * rate) to 16kHz 16-bit PCM — the format Google's streamingRecognize
   * expects.
   * @param {Float32Array} input
   * @param {number} inputSampleRate
   * @returns {ArrayBuffer}
   */
  function downsampleToPcm16(input, inputSampleRate) {
    const outputLength = Math.floor((input.length * 16000) / inputSampleRate);
    const output = new Int16Array(outputLength);
    const sampleRateRatio = inputSampleRate / 16000;

    for (let outputIndex = 0; outputIndex < outputLength; outputIndex++) {
      const start = Math.floor(outputIndex * sampleRateRatio);
      const end = Math.min(
        Math.floor((outputIndex + 1) * sampleRateRatio),
        input.length,
      );
      let sum = 0;
      for (let inputIndex = start; inputIndex < end; inputIndex++) {
        sum += input[inputIndex];
      }
      const sample = Math.max(-1, Math.min(1, sum / Math.max(1, end - start)));
      output[outputIndex] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    }

    return output.buffer;
  }

  function teardown() {
    if (audioProcessor) {
      audioProcessor.disconnect();
      audioProcessor.onaudioprocess = null;
    }
    microphoneSource?.disconnect();
    mediaStream?.getTracks().forEach((track) => track.stop());
    audioContext?.close();
    if (socket?.readyState === WebSocket.OPEN) socket.close(1000);

    audioProcessor = null;
    microphoneSource = null;
    mediaStream = null;
    audioContext = null;
    socket = null;
  }

  return {
    async start() {
      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      audioContext = new AudioContext();
      microphoneSource = audioContext.createMediaStreamSource(mediaStream);
      audioProcessor = audioContext.createScriptProcessor(4096, 1, 1);

      const protocol = location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(`${protocol}//${location.host}/api/stt-stream`);
      socket.binaryType = "arraybuffer";

      socket.addEventListener("message", (event) => {
        const data = JSON.parse(event.data);
        if (data.type === "error") {
          onErrorCb(new Error(data.message));
          return;
        }
        if (data.type !== "transcript") return;
        if (data.final) onFinalCb(data.transcript);
        else onPartialCb(data.transcript);
      });

      socket.addEventListener("close", () => {
        // A closed backend socket means the whole pipeline stopped (the
        // server only closes this on the browser's own request or a fatal
        // condition) — surface it so main.js can update the HUD, and release
        // the mic instead of leaving it open with nowhere to send audio.
        if (socket) {
          teardown();
          onErrorCb(new Error("Google STT stream closed."));
        }
      });

      await new Promise((resolve, reject) => {
        socket.addEventListener("open", resolve, { once: true });
        socket.addEventListener(
          "error",
          () => reject(new Error("WebSocket connection to /api/stt-stream failed.")),
          { once: true },
        );
      });

      audioProcessor.onaudioprocess = (event) => {
        if (socket?.readyState !== WebSocket.OPEN) return;
        // While the avatar is talking, send silence instead of the real mic
        // signal — keeps the Google stream alive (it times out after a few
        // seconds without any audio) without transcribing the avatar's own
        // voice back into a new utterance. See the module doc for when this
        // matters vs. the headphones assumption.
        const input = isSpeaking()
          ? new Float32Array(event.inputBuffer.length)
          : event.inputBuffer.getChannelData(0);
        socket.send(downsampleToPcm16(input, audioContext.sampleRate));
      };
      microphoneSource.connect(audioProcessor);
      audioProcessor.connect(audioContext.destination);
    },
    stop() {
      teardown();
    },
    onPartial(cb) {
      onPartialCb = cb;
    },
    onFinal(cb) {
      onFinalCb = cb;
    },
    onError(cb) {
      onErrorCb = cb;
    },
  };
}
