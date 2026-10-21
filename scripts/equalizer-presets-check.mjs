import assert from "node:assert/strict";
import { EQUALIZER_PRESETS, getEqualizerPreset } from "../src/equalizer-presets.js";

const expected = [
  "clean", "flat", "piano", "classical", "orchestral", "cinematic",
  "acoustic", "pop", "rock", "jazz", "bass", "vocal", "electronic",
  "cyberpunk", "synthwave", "ambient", "game-anime", "experimental"
];
assert.deepEqual(Object.keys(EQUALIZER_PRESETS), expected, "Every sound preset must have a matching profile definition");
for (const [name, preset] of Object.entries(EQUALIZER_PRESETS)) {
  assert.ok(preset.label, name + " has a user-facing label");
  assert.ok(preset.description, name + " explains its intended tonal character");
  for (const band of ["bass", "mid", "treble"]) {
    assert.ok(Number.isFinite(preset[band]), name + " has a numeric " + band + " value");
    assert.ok(preset[band] >= -12 && preset[band] <= 12, name + " stays inside the supported gain range");
  }
  assert.deepEqual(getEqualizerPreset(name), { bass: preset.bass, mid: preset.mid, treble: preset.treble });
}
assert.equal(getEqualizerPreset("unknown"), null, "Unknown presets are rejected safely");
assert.deepEqual(getEqualizerPreset("clean"), { bass: 0, mid: 0, treble: 0 }, "Clean mode has no tonal gain");
assert.deepEqual(getEqualizerPreset("rock"), { bass: 5, mid: -1, treble: 4 });
assert.deepEqual(getEqualizerPreset("piano"), { bass: 0, mid: 0, treble: 1 }, "Piano profile must remain deliberately subtle");
assert.deepEqual(getEqualizerPreset("orchestral"), { bass: 1, mid: 0, treble: 1 });
assert.deepEqual(getEqualizerPreset("cyberpunk"), { bass: 3, mid: -1, treble: 3 });
assert.deepEqual(getEqualizerPreset("vocal"), { bass: -2, mid: 5, treble: 2 });
console.log("Equalizer preset checks passed: clean bypass, 17 genre profiles, documented purposes and bounded three-band gains.");
