/**
 * Load runtime config from the backend (GET /api/config) and merge query-param
 * overrides. Returns presenterUrl, background video URL, default presentation
 * target, and STT availability.
 * @returns {Promise<{
 *   presenterUrl: string,
 *   broadcastVideoUrl: string,
 *   defaults: { avatarId: string, sceneId: string, voiceId: string },
 *   stt: { provider: string, enabled: boolean }
 * }>}
 */
export async function loadConfig() {
  const res = await fetch("/api/config");
  if (!res.ok) throw new Error(`/api/config failed: ${res.status}`);
  const cfg = await res.json();

  // Query-param overrides are handy for demos, e.g. ?video=...&avatar=...
  const q = new URLSearchParams(location.search);
  if (q.get("video")) cfg.broadcastVideoUrl = q.get("video");
  if (q.get("avatar")) cfg.defaults.avatarId = q.get("avatar");
  if (q.get("scene")) cfg.defaults.sceneId = q.get("scene");
  if (q.get("voice")) cfg.defaults.voiceId = q.get("voice");

  return cfg;
}
