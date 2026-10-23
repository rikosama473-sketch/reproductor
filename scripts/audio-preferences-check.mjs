import assert from "node:assert/strict";
import { normalizeSavedAudioLevel } from "../src/audio-preferences.js";

const fallback = 0.8;
for (const damaged of [null, undefined, "", "   ", Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, true, false, {}, []]) {
  assert.equal(normalizeSavedAudioLevel(damaged, fallback), fallback,
    "damaged/non-numeric persisted values should fall back without muting: " + String(damaged));
}
assert.equal(normalizeSavedAudioLevel(0, fallback), 0, "explicit numeric zero remains a deliberate mute");
assert.equal(normalizeSavedAudioLevel("0", fallback), 0, "stringified zero from an older valid preference remains a mute");
assert.equal(normalizeSavedAudioLevel(0.35, fallback), 0.35);
assert.equal(normalizeSavedAudioLevel("0.35", fallback), 0.35);
assert.equal(normalizeSavedAudioLevel(-5, fallback), 0, "volume cannot go below zero");
assert.equal(normalizeSavedAudioLevel(3, fallback), 1, "volume is clamped to unity");
assert.equal(normalizeSavedAudioLevel(null, fallback, 0.01), 0.8, "damaged last-audible level restores its safe default");
assert.equal(normalizeSavedAudioLevel(0, fallback, 0.01), 0.01, "last-audible level cannot remain muted");
assert.equal(normalizeSavedAudioLevel(-2, fallback, 0.01), 0.01);
assert.equal(normalizeSavedAudioLevel("0.4", fallback, 0.01), 0.4);
console.log("Audio preference checks passed: damaged-value fallback, explicit mute preservation, numeric compatibility and bounded levels.");
