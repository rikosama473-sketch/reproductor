const MAX_LRC_LENGTH = 200_000;
const MAX_LRC_LINES = 10_000;
const TIMESTAMP_RE = /\[(\d{1,3}):(\d{2})(?:\.(\d{1,3}))?\]/g;

function fractionToMilliseconds(value = "") {
  if (!value) return 0;
  if (value.length === 1) return Number(value) * 100;
  if (value.length === 2) return Number(value) * 10;
  return Number(value.slice(0, 3));
}

export function parseLrcLyrics(input) {
  if (typeof input !== "string" || input.length === 0 || input.length > MAX_LRC_LENGTH) return [];
  const rawLines = input.replace(/^\uFEFF/, "").split(/\r?\n/,);
  if (rawLines.length > MAX_LRC_LINES) return [];
  let offsetMs = 0;
  const offsetMatch = input.match(/^\s*\[offset:\s*([+-]?\d+)\s*\]\s*$/im);
  if (offsetMatch) {
    const parsed = Number(offsetMatch[1]);
    if (Number.isFinite(parsed)) offsetMs = Math.max(-600_000, Math.min(600_000, parsed));
  }
  const cues = [];
  for (const [lineIndex, rawLine] of rawLines.entries()) {
    TIMESTAMP_RE.lastIndex = 0;
    const timestamps = [...rawLine.matchAll(TIMESTAMP_RE)];
    if (!timestamps.length) continue;
    const text = rawLine.replace(TIMESTAMP_RE, "").trim();
    for (const timestamp of timestamps) {
      const minutes = Number(timestamp[1]);
      const seconds = Number(timestamp[2]);
      if (!Number.isFinite(minutes) || !Number.isFinite(seconds) || seconds > 59) continue;
      const originalMs = minutes * 60_000 + seconds * 1000 + fractionToMilliseconds(timestamp[3]);
      cues.push({ timeMs: Math.max(0, originalMs + offsetMs), text, sourceLine: lineIndex });
    }
  }
  cues.sort((a, b) => a.timeMs - b.timeMs || a.sourceLine - b.sourceLine);
  return cues.slice(0, MAX_LRC_LINES * 4).map(({ timeMs, text }) => ({ timeMs, text }));
}

export function findActiveLyricIndex(cues, seconds) {
  if (!Array.isArray(cues) || !cues.length || !Number.isFinite(Number(seconds)) || Number(seconds) < 0) return -1;
  const target = Number(seconds) * 1000;
  let low = 0;
  let high = cues.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (cues[middle].timeMs <= target) {
      found = middle;
      low = middle + 1;
    } else high = middle - 1;
  }
  return found;
}

export function formatLrcTimestamp(milliseconds) {
  const value = Number(milliseconds);
  if (!Number.isFinite(value) || value < 0) return "[00:00.00]";
  const total = Math.floor(value);
  const minutes = Math.floor(total / 60_000);
  const seconds = Math.floor((total % 60_000) / 1000);
  const centiseconds = Math.floor((total % 1000) / 10);
  return "[" + String(minutes).padStart(2, "0") + ":" +
    String(seconds).padStart(2, "0") + "." + String(centiseconds).padStart(2, "0") + "]";
}
