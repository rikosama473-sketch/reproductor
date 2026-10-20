const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com"]);
const SPOTIFY_HOST = "open.spotify.com";

/**
 * Accept only the explicit media links Ritmo creates for YouTube and Spotify.
 * Reject non-HTTPS schemes, deceptive hosts, credentials, custom ports and
 * paths that are not required by the app's search/video shortcuts.
 */
export function normalizeExternalMediaUrl(value) {
  if (typeof value !== "string" || !value.trim() || value.length > 2048) return null;
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return null;
  const host = url.hostname.toLowerCase();
  if (YOUTUBE_HOSTS.has(host) && (url.pathname === "/watch" || url.pathname === "/results")) return url.href;
  if (host === SPOTIFY_HOST && (url.pathname === "/search" || url.pathname.startsWith("/search/"))) return url.href;
  return null;
}
