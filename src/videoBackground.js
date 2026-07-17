/**
 * Background broadcast video.
 *
 * Plays a remote video full-screen, muted and looping. YouTube URLs (watch /
 * live / youtu.be / shorts) are mounted as a full-screen iframe embed — YouTube
 * exposes no raw stream URL for <video>. Other URLs use the plain <video>
 * element; hls.js for `.m3u8` streams is still TODO(video-bg).
 *
 * @param {HTMLVideoElement} videoEl
 * @param {string} url  remote mp4 / HLS .m3u8 / YouTube URL
 * @returns {Promise<void>}
 */
export async function startBackgroundVideo(videoEl, url) {
  if (!url) {
    console.warn("[videoBackground] no BROADCAST_VIDEO_URL configured");
    return;
  }

  const ytId = parseYouTubeId(url);
  if (ytId) {
    mountYouTubeBackground(videoEl, ytId);
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

/**
 * Extract the 11-char video id from any common YouTube URL form, or null if
 * the URL isn't YouTube.
 * @param {string} url
 * @returns {string | null}
 */
function parseYouTubeId(url) {
  const m = url.match(
    /(?:youtube\.com\/(?:watch\?.*?v=|live\/|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/,
  );
  return m ? m[1] : null;
}

/**
 * Replace the background <video> with a muted, autoplaying, looping YouTube
 * embed. `playlist=<id>` is required by the embed API for loop=1 to work on a
 * single video; it's harmless for live streams.
 * @param {HTMLVideoElement} videoEl
 * @param {string} videoId
 */
function mountYouTubeBackground(videoEl, videoId) {
  const params = new URLSearchParams({
    autoplay: "1",
    mute: "1",
    controls: "0",
    loop: "1",
    playlist: videoId,
    rel: "0",
    playsinline: "1",
  });
  // Not id="bg-video": the #bg-video CSS (higher specificity than .bg-embed)
  // would override the cover-sizing rules.
  const iframe = document.createElement("iframe");
  iframe.className = "bg-embed";
  iframe.src = `https://www.youtube-nocookie.com/embed/${videoId}?${params}`;
  iframe.allow = "autoplay; encrypted-media";
  iframe.title = "background broadcast";
  videoEl.replaceWith(iframe);
}
