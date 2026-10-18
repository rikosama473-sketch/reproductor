export const EQUALIZER_PRESETS = Object.freeze({
  flat: Object.freeze({ label: "Plano", bass: 0, mid: 0, treble: 0 }),
  acoustic: Object.freeze({ label: "Acústico", bass: 2, mid: 2, treble: 4 }),
  pop: Object.freeze({ label: "Pop", bass: 3, mid: 1, treble: 3 }),
  rock: Object.freeze({ label: "Rock", bass: 5, mid: -1, treble: 4 }),
  classical: Object.freeze({ label: "Clásico", bass: 2, mid: 1, treble: 3 }),
  jazz: Object.freeze({ label: "Jazz", bass: 3, mid: 2, treble: 2 }),
  bass: Object.freeze({ label: "Más graves", bass: 7, mid: -2, treble: 1 }),
  vocal: Object.freeze({ label: "Voces", bass: -2, mid: 5, treble: 2 })
});

export function getEqualizerPreset(name) {
  const preset = EQUALIZER_PRESETS[name];
  if (!preset) return null;
  return { bass: preset.bass, mid: preset.mid, treble: preset.treble };
}
