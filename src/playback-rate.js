export const PLAYBACK_RATES = Object.freeze([0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2]);

export function normalizePlaybackRate(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 1;
  return PLAYBACK_RATES.reduce((best, candidate) =>
    Math.abs(candidate - parsed) < Math.abs(best - parsed) ? candidate : best, PLAYBACK_RATES[0]);
}

export function nextPlaybackRate(value) {
  const current = normalizePlaybackRate(value);
  const index = PLAYBACK_RATES.indexOf(current);
  return PLAYBACK_RATES[(index + 1) % PLAYBACK_RATES.length];
}

export function formatPlaybackRate(value) {
  const rate = normalizePlaybackRate(value);
  return (Number.isInteger(rate) ? String(rate) : String(rate).replace(/0+$/, "").replace(/\.$/, "")) + "×";
}
