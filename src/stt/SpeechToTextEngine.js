/**
 * SpeechToTextEngine — the swappable STT interface.
 *
 * The product does NOT implement speech recognition itself; it depends only on
 * this contract. Any adapter (cloud Whisper, Google Cloud Speech streaming,
 * the Web Speech API, or a mock) can satisfy it without the rest of the app
 * changing. Adapters live alongside this file and are selected by
 * `createSttEngine(config)`.
 *
 * @typedef {Object} SpeechToTextEngine
 * @property {() => Promise<void>} start   Begin capturing + transcribing. Must be
 *   called from a user gesture (mic permission / autoplay).
 * @property {() => void} stop             Stop capturing and release the mic.
 * @property {(cb: (text: string) => void) => void} onPartial  Interim (non-final)
 *   transcript updates, if the adapter supports them. Optional to emit.
 * @property {(cb: (text: string) => void) => void} onFinal    A finalized
 *   utterance ready to send to the avatar via presenter.present().
 * @property {(cb: (err: Error) => void) => void} onError      Recoverable/fatal
 *   errors (mic denied, network, provider failure).
 */

/**
 * Factory: pick an STT adapter based on config.
 * @param {{ provider?: string }} [config]
 * @returns {Promise<SpeechToTextEngine>}
 */
export async function createSttEngine(config = {}) {
  const provider = (config.provider || "openai").toLowerCase();
  switch (provider) {
    case "mock": {
      const { createMockSttEngine } = await import("./mockSttAdapter.js");
      return createMockSttEngine(config);
    }
    case "google": {
      const { createGoogleSttEngine } = await import("./googleSttAdapter.js");
      return createGoogleSttEngine(config);
    }
    case "openai":
    default: {
      const { createCloudSttEngine } = await import("./cloudSttAdapter.js");
      return createCloudSttEngine(config);
    }
  }
}
