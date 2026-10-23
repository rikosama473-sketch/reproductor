export const EQUALIZER_PRESETS = Object.freeze({
  clean: Object.freeze({
    label: "Limpio (sin procesamiento)",
    description: "Bypass del ecualizador y del limitador; señal local sin procesamiento adicional.",
    bass: 0, mid: 0, treble: 0
  }),
  flat: Object.freeze({
    label: "Plano",
    description: "Sin realce tonal: las tres bandas quedan en 0 dB; el limitador se controla por separado.",
    bass: 0, mid: 0, treble: 0
  }),
  piano: Object.freeze({
    label: "Piano clásico",
    description: "Ajuste tonal mínimo para conservar el carácter del piano sin reforzar sus extremos.",
    bass: 0, mid: 0, treble: 1
  }),
  classical: Object.freeze({
    label: "Clásico / instrumental",
    description: "Balance casi plano con un toque de claridad; no sustituye la dinámica natural de la grabación.",
    bass: 0, mid: 0, treble: 1
  }),
  orchestral: Object.freeze({
    label: "Orquesta",
    description: "Pequeño refuerzo de cuerpo y claridad para secciones instrumentales amplias.",
    bass: 1, mid: 0, treble: 1
  }),
  cinematic: Object.freeze({
    label: "Cinemático / banda sonora",
    description: "Más cuerpo en graves y un leve toque de agudos para bandas sonoras; puede cambiar el balance original.",
    bass: 2, mid: 0, treble: 1
  }),
  acoustic: Object.freeze({
    label: "Acústico",
    description: "Realce moderado de medios y agudos para dar presencia a cuerdas y detalles acústicos.",
    bass: 2, mid: 2, treble: 4
  }),
  pop: Object.freeze({
    label: "Pop",
    description: "Curva general moderada con cuerpo y presencia sin recortar fuertemente los medios.",
    bass: 3, mid: 1, treble: 3
  }),
  rock: Object.freeze({
    label: "Rock",
    description: "Graves y agudos más presentes, con medios algo retraídos para un carácter contundente.",
    bass: 5, mid: -1, treble: 4
  }),
  jazz: Object.freeze({
    label: "Jazz",
    description: "Cuerpo y medios presentes con ajustes moderados en ambos extremos.",
    bass: 3, mid: 2, treble: 2
  }),
  bass: Object.freeze({
    label: "Más graves",
    description: "Refuerzo importante de graves; puede consumir margen de volumen y no es ideal para todo equipo.",
    bass: 7, mid: -2, treble: 1
  }),
  vocal: Object.freeze({
    label: "Voces",
    description: "Reduce graves y resalta la región media para acercar la voz al frente de la mezcla.",
    bass: -2, mid: 5, treble: 2
  }),
  electronic: Object.freeze({
    label: "Electrónica",
    description: "Graves con más peso y brillo moderado para música electrónica; úsalo a volumen prudente.",
    bass: 4, mid: 0, treble: 2
  }),
  cyberpunk: Object.freeze({
    label: "Cyberpunk",
    description: "Graves definidos y agudos presentes para texturas sintéticas y percusión electrónica.",
    bass: 3, mid: -1, treble: 3
  }),
  synthwave: Object.freeze({
    label: "Synthwave",
    description: "Cuerpo en graves y brillo suave para sintetizadores retro sin un realce extremo.",
    bass: 2, mid: 0, treble: 2
  }),
  ambient: Object.freeze({
    label: "Ambient",
    description: "Tono sutil con graves y medios ligeramente suavizados; no añade reverberación ni efectos espaciales.",
    bass: -1, mid: -1, treble: 1
  }),
  "game-anime": Object.freeze({
    label: "Videojuegos / anime",
    description: "Realce moderado de cuerpo y detalle para bandas sonoras variadas; cada mezcla puede necesitar otro ajuste.",
    bass: 2, mid: 1, treble: 2
  }),
  experimental: Object.freeze({
    label: "Experimental",
    description: "Coloración ligera con medios retraídos y más detalle en agudos; no agrega distorsión ni efectos nuevos.",
    bass: 1, mid: -1, treble: 2
  })
});

export function getEqualizerPreset(name) {
  const preset = EQUALIZER_PRESETS[name];
  if (!preset) return null;
  return { bass: preset.bass, mid: preset.mid, treble: preset.treble };
}

export const MAX_SAVED_EQUALIZER_PROFILES = 20;

function boundedGain(value) {
  return Math.round(Math.max(-12, Math.min(12, Number(value))));
}

/** Validate local custom profiles before they are loaded into the selector. */
export function normalizeSavedEqualizerProfiles(value) {
  if (!Array.isArray(value)) return [];
  const result = [];
  const ids = new Set();
  const names = new Set();

  for (const item of value) {
    if (result.length >= MAX_SAVED_EQUALIZER_PROFILES) break;
    if (!item || typeof item !== "object") continue;
    const id = String(item.id ?? "").trim();
    const name = String(item.name ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
    const key = name.toLocaleLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{0,59}$/i.test(id) || !name ||
        ids.has(id) || names.has(key)) continue;
    const bands = ["bass", "mid", "treble"];
    if (bands.some(band => !Number.isFinite(Number(item[band])))) continue;

    result.push({
      id,
      name,
      bass: boundedGain(item.bass),
      mid: boundedGain(item.mid),
      treble: boundedGain(item.treble)
    });
    ids.add(id);
    names.add(key);
  }
  return result;
}

/** Insert or replace a profile, rejecting accidental case-insensitive name collisions. */
export function upsertSavedEqualizerProfile(profiles, profile) {
  const current = normalizeSavedEqualizerProfiles(profiles);
  const incoming = normalizeSavedEqualizerProfiles([profile])[0];
  if (!incoming) throw new TypeError("El perfil personalizado no contiene un nombre, identificador o valores válidos.");
  const duplicateName = current.find(item =>
    item.name.toLocaleLowerCase() === incoming.name.toLocaleLowerCase() && item.id !== incoming.id
  );
  if (duplicateName) throw new Error("Ya existe un perfil llamado «" + duplicateName.name + "».");
  const existingIndex = current.findIndex(item => item.id === incoming.id);
  if (existingIndex >= 0) {
    current[existingIndex] = incoming;
    return current;
  }
  if (current.length >= MAX_SAVED_EQUALIZER_PROFILES) {
    throw new RangeError("Podés guardar hasta " + MAX_SAVED_EQUALIZER_PROFILES + " perfiles personalizados.");
  }
  current.push(incoming);
  return current;
}

export function removeSavedEqualizerProfile(profiles, profileId) {
  const id = String(profileId ?? "");
  return normalizeSavedEqualizerProfiles(profiles).filter(profile => profile.id !== id);
}
