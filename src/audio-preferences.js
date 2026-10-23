/**
 * Normalize persisted output levels defensively. JSON turns NaN/Infinity into
 * null, and Number(null)/Number("") are both zero; treating those values as a
 * user-selected mute can silently change playback after damaged preferences.
 */
export function normalizeSavedAudioLevel(value, fallback = 0.8, minimum = 0) {
  const floor = Number.isFinite(minimum) ? Math.max(0, Math.min(1, minimum)) : 0;
  const defaultValue = Number.isFinite(fallback)
    ? Math.max(floor, Math.min(1, fallback))
    : Math.max(floor, 0.8);

  if (value === null || value === undefined ||
      (typeof value === "string" && value.trim() === "") ||
      (typeof value !== "number" && typeof value !== "string")) {
    return defaultValue;
  }
  const parsed = typeof value === "string" ? Number(value.trim()) : value;
  if (!Number.isFinite(parsed)) return defaultValue;
  return Math.max(floor, Math.min(1, parsed));
}
