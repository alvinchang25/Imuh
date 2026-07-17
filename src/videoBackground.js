/**
 * Background broadcast video.
 *
 * TODO(video-bg): full implementation. Plays a remote video full-screen, muted
 * and looping. Uses hls.js for `.m3u8` streams (native HLS on Safari) and a
 * plain <video> src for mp4.
 *
 * @param {HTMLVideoElement} videoEl
 * @param {string} url  remote mp4 or HLS .m3u8 URL
 * @returns {Promise<void>}
 */
export async function startBackgroundVideo(videoEl, url) {
  if (!url) {
    console.warn("[videoBackground] no BROADCAST_VIDEO_URL configured");
    return;
  }
  // Placeholder: native playback. HLS handling added in the video-bg todo.
  videoEl.src = url;
  videoEl.muted = true;
  videoEl.loop = true;
  await videoEl.play().catch((err) => {
    console.warn("[videoBackground] autoplay blocked:", err);
  });
}
