// Clear system-facing metadata when the native player no longer has a selected track.
// Media Session metadata can persist in OS controls after an audio element is cleared,
// so reset both the browser-facing session and the application's deduplication marker.
export function clearMediaSession(mediaSession, state) {
  if (state && typeof state === "object") state.mediaSessionTrackId = null;
  if (!mediaSession) return;
  try { mediaSession.metadata = null; } catch {}
  try { mediaSession.playbackState = "none"; } catch {}
}
