/**
 * Apply a saved media position without seeking beyond a known media duration.
 * Returns false when the value cannot be applied.
 */
export function setPlaybackPosition(element, seconds) {
  const requested = Number(seconds);
  if (!element || !Number.isFinite(requested) || requested <= 0) return false;
  const duration = Number(element.duration);
  const target = Number.isFinite(duration) && duration > 0
    ? Math.min(requested, duration)
    : requested;
  try {
    element.currentTime = target;
    return true;
  } catch {
    return false;
  }
}

/**
 * Restore a position when metadata arrives, but only while the original play
 * request still owns the active media element. The returned function cancels
 * the listener, so rapid track switches do not accumulate deferred callbacks.
 */
export function schedulePlaybackPositionRestore(element, seconds, {
  isCurrentRequest = () => true,
  isActiveElement = candidate => candidate === element,
  onSettled = () => {}
} = {}) {
  if (!element || typeof element.addEventListener !== "function" ||
      typeof element.removeEventListener !== "function") {
    return () => {};
  }

  let active = true;
  let listener;
  const finish = () => {
    if (!active) return false;
    active = false;
    try {
      if (listener) element.removeEventListener("loadedmetadata", listener);
    } catch {}
    try { onSettled(); } catch {}
    return true;
  };
  listener = () => {
    if (!finish()) return;
    if (!isCurrentRequest() || !isActiveElement(element)) return;
    setPlaybackPosition(element, seconds);
  };
  element.addEventListener("loadedmetadata", listener);
  return finish;
}
