import assert from "node:assert/strict";
import { EQUALIZER_PRESETS, getEqualizerPreset } from "../src/equalizer-presets.js";

const expected = ["flat", "acoustic", "pop", "rock", "classical", "jazz", "bass", "vocal"];
assert.deepEqual(Object.keys(EQUALIZER_PRESETS), expected, "Every preset displayed by the UI must be available in the preset table");
for (const [name, preset] of Object.entries(EQUALIZER_PRESETS)) {
  assert.ok(preset.label, name + " has a user-facing label");
  for (const band of ["bass", "mid", "treble"]) {
    assert.ok(Number.isFinite(preset[band]), name + " has a numeric " + band + " value");
    assert.ok(preset[band] >= -12 && preset[band] <= 12, name + " stays inside the supported gain range");
  }
  assert.deepEqual(getEqualizerPreset(name), { bass: preset.bass, mid: preset.mid, treble: preset.treble });
}
assert.equal(getEqualizerPreset("unknown"), null, "Unknown presets are rejected safely");
assert.deepEqual(getEqualizerPreset("rock"), { bass: 5, mid: -1, treble: 4 });
assert.deepEqual(getEqualizerPreset("vocal"), { bass: -2, mid: 5, treble: 2 });
console.log("Equalizer preset checks passed: eight profiles, finite bounded gains, stable labels and safe unknown-preset handling.");
