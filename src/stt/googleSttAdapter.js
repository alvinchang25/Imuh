/**
 * Google STT adapter — satisfies the SpeechToTextEngine interface using
 * Google Cloud Speech-to-Text streaming over the backend's `WS
 * /api/stt-stream` (see server/server.mjs), in push-to-talk mode: `start()`
 * opens the mic + a fresh WebSocket and streams raw PCM while the caller
 * holds the talk button; `stop()` (button released) tells the server no more
 * audio is coming so it can finalize the in-flight utterance immediately
 * (rather than waiting on Google's own silence timeout), waits briefly for
 * that final transcript, then releases the mic and closes the socket. Each
 * start()/stop() pair is a fresh connection — there's no continuous
 * multi-utterance restart logic here, unlike a hands-free "always listening"
 * design would need.
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
  // Resolved when a final transcript message arrives, so stop() can wait for
  // it before tearing down the mic/socket instead of racing ahead and
  // dropping the last bit of recognized speech.
  let resolveFinalReceived = null;

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
    resolveFinalReceived = null;
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
        if (data.final) {
          onFinalCb(data.transcript);
          resolveFinalReceived?.();
        } else {
          onPartialCb(data.transcript);
        }
      });

      socket.addEventListener("close", () => {
        // A closed backend socket means the whole pipeline stopped (the
        // server only closes this on a fatal condition — stop() closes it
        // itself once done) — surface it so main.js can update the HUD, and
        // release the mic instead of leaving it open with nowhere to send
        // audio.
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
        // signal — avoids transcribing the avatar's own voice back into a
        // new utterance if you're not on headphones. See the module doc.
        const input = isSpeaking()
          ? new Float32Array(event.inputBuffer.length)
          : event.inputBuffer.getChannelData(0);
        socket.send(downsampleToPcm16(input, audioContext.sampleRate));
      };
      microphoneSource.connect(audioProcessor);
      audioProcessor.connect(audioContext.destination);
    },
    async stop() {
      // Push-to-talk release: tell the server no more audio is coming so it
      // finalizes the in-flight utterance right away, then wait briefly for
      // that final transcript before releasing the mic — otherwise teardown
      // could race ahead of (and drop) the last bit of recognized speech.
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "stop" }));
        await Promise.race([
          new Promise((resolve) => {
            resolveFinalReceived = resolve;
          }),
          new Promise((resolve) => setTimeout(resolve, 4000)),
        ]);
      }
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
