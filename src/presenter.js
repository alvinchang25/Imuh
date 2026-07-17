/**
 * <sv-presenter> wrapper.
 *
 * TODO(presenter): full implementation. Loads the presenter engine <script>
 * from presenterUrl, then exposes initialize / present / resumeAudioPlayback /
 * interruptPresentation and forwards presenter events (PRESENTER_STATUS,
 * PLAYING_SPEECH_TEXT, PERFORMANCE_STATE) to callbacks.
 */

/**
 * Dynamically load the presenter engine module so <sv-presenter> upgrades.
 * @param {string} presenterUrl
 * @returns {Promise<void>}
 */
export function loadPresenterEngine(presenterUrl) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.type = "module";
    script.src = presenterUrl;
    script.onload = resolve;
    script.onerror = () =>
      reject(new Error(`Failed to load presenter engine from ${presenterUrl}`));
    document.head.append(script);
  });
}

/**
 * Create a thin controller around the <sv-presenter> element.
 * @param {HTMLElement & import('../docs/presenter.d.ts').IPresentationWidget} el
 */
export function createPresenter(el) {
  return {
    el,
    /** @param {string} connectToken @param {object} target */
    initialize: (connectToken, target) => el.initialize(connectToken, target),
    resumeAudioPlayback: () => el.resumeAudioPlayback?.(),
    present: (text) => el.present(text),
    interrupt: () => el.interruptPresentation(),
    on: (eventType, cb) =>
      el.addEventListener(eventType, (e) => cb(e.detail ?? e)),
  };
}
