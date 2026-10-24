import assert from "node:assert/strict";
import { PLAYBACK_RATES, formatPlaybackRate, nextPlaybackRate, normalizePlaybackRate } from "../src/playback-rate.js";

assert.equal(normalizePlaybackRate(1), 1);
assert.equal(normalizePlaybackRate(1.18), 1.1);
assert.equal(normalizePlaybackRate(1.22), 1.25);
assert.equal(normalizePlaybackRate("invalid"), 1);
assert.equal(normalizePlaybackRate(Infinity), 1);
assert.equal(normalizePlaybackRate(-30), 0.5);
assert.equal(normalizePlaybackRate(9), 2);
assert.equal(nextPlaybackRate(1), 1.1);
assert.equal(nextPlaybackRate(2), 0.5);
assert.equal(nextPlaybackRate("invalid"), 1.1);
assert.equal(formatPlaybackRate(1), "1×");
assert.equal(formatPlaybackRate(1.25), "1.25×");
assert.equal(formatPlaybackRate(1.1), "1.1×");
assert.equal(PLAYBACK_RATES.length, 9);
console.log("Playback-rate normalization and cycle checks passed.");
