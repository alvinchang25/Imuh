/**
 * Mock STT adapter — satisfies the SpeechToTextEngine interface with no mic and
 * no network. Emits a few canned lines on a timer so the full pipeline
 * (subtitles + avatar speech) can be demoed without a transcription key.
 *
 * @param {{ lines?: string[], intervalMs?: number }} [config]
 * @returns {import('./SpeechToTextEngine.js').SpeechToTextEngine}
 */
export function createMockSttEngine(config = {}) {
  const lines = config.lines ?? [
    "歡迎收看今天的直播。",
    "這是由虛擬主播即時播報的內容。",
    "感謝大家的收看。",
  ];
  const intervalMs = config.intervalMs ?? 6000;

  let onFinalCb = () => {};
  let timer = null;
  let i = 0;

  return {
    async start() {
      timer = setInterval(() => {
        onFinalCb(lines[i % lines.length]);
        i += 1;
      }, intervalMs);
    },
    stop() {
      clearInterval(timer);
      timer = null;
    },
    onPartial() {},
    onFinal(cb) {
      onFinalCb = cb;
    },
    onError() {},
  };
}
