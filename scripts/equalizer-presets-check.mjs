import assert from "node:assert/strict";
import {
  EQUALIZER_PRESETS,
  getEqualizerPreset,
  MAX_SAVED_EQUALIZER_PROFILES,
  normalizeSavedEqualizerProfiles,
  upsertSavedEqualizerProfile,
  removeSavedEqualizerProfile
} from "../src/equalizer-presets.js";

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
// Saved profiles are validated, bounded, case-insensitive by name and kept local.
{
  const normalized = normalizeSavedEqualizerProfiles([
    { id: "p1", name: "  Mi   Piano  ", bass: -20, mid: 2.4, treble: 99 },
    { id: "p1", name: "Duplicate ID", bass: 0, mid: 0, treble: 0 },
    { id: "p2", name: "mi piano", bass: 0, mid: 0, treble: 0 },
    { id: "bad/id", name: "Invalid ID", bass: 0, mid: 0, treble: 0 },
    { id: "p3", name: "Invalid gain", bass: "NaN", mid: 0, treble: 0 }
  ]);
  assert.deepEqual(normalized, [{ id: "p1", name: "Mi Piano", bass: -12, mid: 2, treble: 12 }]);
  const saved = upsertSavedEqualizerProfile(normalized, { id: "p1", name: "Mi Piano", bass: 4, mid: -2, treble: 1 });
  assert.equal(saved.length, 1, "Saving the same ID updates one profile instead of duplicating it.");
  assert.deepEqual(saved[0], { id: "p1", name: "Mi Piano", bass: 4, mid: -2, treble: 1 });
  assert.throws(
    () => upsertSavedEqualizerProfile(saved, { id: "p2", name: "MI PIANO", bass: 0, mid: 0, treble: 0 }),
    /Ya existe un perfil/
  );
  assert.deepEqual(removeSavedEqualizerProfile(saved, "p1"), []);
  const limit = Array.from({ length: MAX_SAVED_EQUALIZER_PROFILES }, (_, index) => ({
    id: "profile-" + index, name: "Profile " + index, bass: 0, mid: 0, treble: 0
  }));
  assert.equal(normalizeSavedEqualizerProfiles(limit).length, MAX_SAVED_EQUALIZER_PROFILES);
  assert.throws(
    () => upsertSavedEqualizerProfile(limit, { id: "profile-extra", name: "Extra", bass: 0, mid: 0, treble: 0 }),
    /hasta 20 perfiles/
  );
}
console.log("Equalizer preset checks passed: clean bypass, genre profiles, bounded gains and safe custom-profile persistence.");

