/**
 * Subtitle overlay.
 *
 * TODO(subtitles): full implementation (fade timing, line retention, queueing).
 * Renders the text currently being spoken (from the presenter's
 * PLAYING_SPEECH_TEXT event) into the bottom-center overlay.
 *
 * @param {HTMLElement} el  the #subtitles container
 */
export function createSubtitles(el) {
  let hideTimer = null;
  return {
    /** @param {string} text */
    show(text) {
      if (!text) return;
      el.textContent = text;
      el.classList.add("visible");
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => el.classList.remove("visible"), 4000);
    },
    clear() {
      clearTimeout(hideTimer);
      el.classList.remove("visible");
      el.textContent = "";
    },
  };
}
