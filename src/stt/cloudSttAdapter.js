/**
 * Cloud STT adapter (default) — satisfies the SpeechToTextEngine interface.
 *
 * TODO(stt): full implementation. Captures the mic with getUserMedia +
 * MediaRecorder, segments audio (by interval and/or silence), POSTs each
 * segment to the backend `POST /api/stt`, and emits the returned text via
 * onFinal. The transcription API key stays server-side — this adapter only ever
 * talks to our own /api/stt.
 *
 * @param {object} [config]
 * @returns {import('./SpeechToTextEngine.js').SpeechToTextEngine}
 */
export function createCloudSttEngine(config = {}) {
  let onFinalCb = () => {};
  let onPartialCb = () => {};
  let onErrorCb = () => {};

  return {
    async start() {
      // TODO(stt): getUserMedia + MediaRecorder loop → POST /api/stt → onFinal.
      throw new Error("cloudSttAdapter.start() not implemented yet (stt todo)");
    },
    stop() {
      // TODO(stt): stop recorder, stop tracks.
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
