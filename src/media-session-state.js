// Remove a stale progress bar from OS/browser media controls.
// The Media Session API clears its position state when setPositionState() is called
// without a dictionary. Older/partial implementations may not expose this method.
export function clearMediaSessionPositionState(mediaSession) {
  if (!mediaSession || typeof mediaSession.setPositionState !== "function") return;
  try { mediaSession.setPositionState(); } catch {}
}

// Clear system-facing metadata when the native player no longer has a selected track.
// Media Session metadata can persist in OS controls after an audio element is cleared,
// so reset both the browser-facing session and the application's deduplication marker.
export function clearMediaSession(mediaSession, state) {
  if (state && typeof state === "object") state.mediaSessionTrackId = null;
  if (!mediaSession) return;
  clearMediaSessionPositionState(mediaSession);
  try { mediaSession.metadata = null; } catch {}
  try { mediaSession.playbackState = "none"; } catch {}
}
