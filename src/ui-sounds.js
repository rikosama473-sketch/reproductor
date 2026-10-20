const STORAGE_KEY = "ritmo.ui-sounds.v1";
const MAX_OUTPUT_GAIN = 0.045;
const MUSIC_DUCK_FACTOR = 0.15;
const MIN_SOUND_INTERVAL_MS = 75;

export const UI_SOUND_PACKS = Object.freeze({
  piano: Object.freeze({ label: "Piano clásico", description: "Nota cálida, breve y amortiguada." }),
  punk: Object.freeze({ label: "Punk / rock suave", description: "Acorde de guitarra sintetizado, con poca distorsión y graves controlados." }),
  cyber: Object.freeze({ label: "Cibernético", description: "Pulso electrónico corto, sin pitidos estridentes." }),
  wood: Object.freeze({ label: "Madera suave", description: "Pequeño toque opaco, como madera o un botón físico." }),
  glass: Object.freeze({ label: "Cristal delicado", description: "Campanilla corta con armónicos suaves." }),
  retro: Object.freeze({ label: "Retro 8-bit", description: "Tono de videojuego clásico, muy corto." }),
  warm: Object.freeze({ label: "Sintetizador cálido", description: "Pulso redondo, sin agudos agresivos." }),
  minimal: Object.freeze({ label: "Clic minimalista", description: "Confirmación discreta, casi imperceptible." })
});

export const DEFAULT_UI_SOUND_PREFERENCES = Object.freeze({ enabled: false, pack: "piano", volume: 24 });

export function normalizeUiSoundPreferences(value) {
  const source = value && typeof value === "object" ? value : {};
  const pack = Object.prototype.hasOwnProperty.call(UI_SOUND_PACKS, source.pack) ? source.pack : DEFAULT_UI_SOUND_PREFERENCES.pack;
  const rawVolume = source.volume === undefined ? DEFAULT_UI_SOUND_PREFERENCES.volume : Number(source.volume);
  const volume = Number.isFinite(rawVolume) ? Math.max(0, Math.min(100, Math.round(rawVolume))) : DEFAULT_UI_SOUND_PREFERENCES.volume;
  return { enabled: source.enabled === true, pack, volume };
}

function loadPreferences() {
  try {
    const saved = globalThis.localStorage?.getItem(STORAGE_KEY);
    return normalizeUiSoundPreferences(saved ? JSON.parse(saved) : null);
  } catch { return normalizeUiSoundPreferences(null); }
}
function savePreferences(preferences) {
  try { globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(preferences)); } catch {}
}

let audioContext = null;
let masterGain = null;
let noteIndex = 0;
let lastAutomaticSoundAt = 0;
const pianoNotes = [392, 440, 493.88, 587.33, 523.25, 440, 493.88, 659.25];

function getAudioContext() {
  if (audioContext) return audioContext;
  const AudioContextConstructor = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (typeof AudioContextConstructor !== "function") return null;
  try {
    audioContext = new AudioContextConstructor();
    masterGain = audioContext.createGain();
    masterGain.gain.value = 0;
    masterGain.connect(audioContext.destination);
    return audioContext;
  } catch {
    audioContext = null;
    masterGain = null;
    return null;
  }
}

function addTone(context, output, frequency, options = {}) {
  const now = context.currentTime;
  const oscillator = context.createOscillator();
  const envelope = context.createGain();
  let filter = null;
  oscillator.type = options.type || "sine";
  oscillator.frequency.setValueAtTime(Math.max(1, frequency), now);
  if (Number.isFinite(options.endFrequency)) oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, options.endFrequency), now + options.duration);
  if (options.filterType) {
    filter = context.createBiquadFilter();
    filter.type = options.filterType;
    filter.frequency.setValueAtTime(options.cutoff || 650, now);
    filter.Q.value = options.q || 0.65;
    oscillator.connect(filter);
    filter.connect(envelope);
  } else oscillator.connect(envelope);
  envelope.connect(output);
  const attack = Math.min(options.attack || 0.006, options.duration * 0.3);
  envelope.gain.setValueAtTime(0.0001, now);
  envelope.gain.linearRampToValueAtTime(Math.max(0.0002, options.amplitude || 0.10), now + attack);
  envelope.gain.exponentialRampToValueAtTime(0.0001, now + options.duration);
  oscillator.onended = () => {
    try { oscillator.disconnect(); } catch {}
    try { envelope.disconnect(); } catch {}
    try { filter?.disconnect(); } catch {}
  };
  oscillator.start(now);
  oscillator.stop(now + options.duration + 0.015);
}

function addWoodClick(context, output) {
  const duration = 0.032;
  const frameCount = Math.max(1, Math.floor(context.sampleRate * duration));
  const buffer = context.createBuffer(1, frameCount, context.sampleRate);
  const channel = buffer.getChannelData(0);
  for (let index = 0; index < frameCount; index += 1) {
    const fade = 1 - index / frameCount;
    channel[index] = (Math.random() * 2 - 1) * fade * fade;
  }
  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const envelope = context.createGain();
  const now = context.currentTime;
  source.buffer = buffer;
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(520, now);
  filter.Q.value = 0.45;
  envelope.gain.setValueAtTime(0.055, now);
  envelope.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  source.connect(filter);
  filter.connect(envelope);
  envelope.connect(output);
  source.onended = () => {
    try { source.disconnect(); } catch {}
    try { filter.disconnect(); } catch {}
    try { envelope.disconnect(); } catch {}
  };
  source.start(now);
  source.stop(now + duration + 0.012);
}

function mediaIsPlayingOrEmbedded(documentRef) {
  const media = [...documentRef.querySelectorAll("audio, video")];
  if (media.some(item => !item.paused && !item.ended)) return true;
  // Playback inside cross-origin embeds can't be inspected reliably, so be conservative.
  return Boolean(documentRef.querySelector(
    'iframe[src*="youtube.com/embed"], iframe[src*="youtube-nocookie.com/embed"], iframe[src*="open.spotify.com/embed"]'
  ));
}

function synthesize(context, pack, volume, documentRef) {
  if (!masterGain || volume <= 0) return;
  const now = context.currentTime;
  const activeMusic = mediaIsPlayingOrEmbedded(documentRef);
  const safeGain = MAX_OUTPUT_GAIN * (volume / 100) * (activeMusic ? MUSIC_DUCK_FACTOR : 1);
  masterGain.gain.cancelScheduledValues(now);
  masterGain.gain.setTargetAtTime(Math.min(MAX_OUTPUT_GAIN, safeGain), now, 0.008);

  if (pack === "piano") {
    const note = pianoNotes[noteIndex % pianoNotes.length];
    noteIndex += 1;
    addTone(context, masterGain, note, { type: "triangle", duration: 0.082, amplitude: 0.16, attack: 0.004, filterType: "lowpass", cutoff: 1050 });
    addTone(context, masterGain, note * 2, { type: "sine", duration: 0.046, amplitude: 0.025, attack: 0.003, filterType: "lowpass", cutoff: 1500 });
    return;
  }
  if (pack === "punk") {
    const roots = [110, 123.47, 130.81, 146.83];
    const root = roots[noteIndex % roots.length];
    noteIndex += 1;
    for (const ratio of [1, 1.5, 2]) {
      addTone(context, masterGain, root * ratio, {
        type: "sawtooth", duration: 0.052, amplitude: 0.055, attack: 0.003,
        filterType: "lowpass", cutoff: 620, q: 0.55
      });
    }
    return;
  }
  if (pack === "cyber") {
    addTone(context, masterGain, 620, { type: "sine", endFrequency: 390, duration: 0.052, amplitude: 0.075, attack: 0.003, filterType: "lowpass", cutoff: 950 });
    return;
  }
  if (pack === "wood") {
    addWoodClick(context, masterGain);
    return;
  }
  if (pack === "glass") {
    const note = [784, 880, 987.77, 880][noteIndex % 4];
    noteIndex += 1;
    addTone(context, masterGain, note, { type: "sine", duration: 0.06, amplitude: 0.075, attack: 0.004, filterType: "lowpass", cutoff: 1450 });
    addTone(context, masterGain, note * 1.5, { type: "sine", duration: 0.035, amplitude: 0.018, attack: 0.003, filterType: "lowpass", cutoff: 1800 });
    return;
  }
  if (pack === "retro") {
    const note = [440, 493.88, 587.33, 523.25][noteIndex % 4];
    noteIndex += 1;
    addTone(context, masterGain, note, { type: "square", duration: 0.038, amplitude: 0.045, attack: 0.002, filterType: "lowpass", cutoff: 1050 });
    return;
  }
  if (pack === "warm") {
    const note = [293.66, 329.63, 349.23, 392][noteIndex % 4];
    noteIndex += 1;
    addTone(context, masterGain, note, { type: "triangle", endFrequency: note * 1.08, duration: 0.062, amplitude: 0.085, attack: 0.005, filterType: "lowpass", cutoff: 720 });
    return;
  }
  addTone(context, masterGain, 290, { type: "triangle", endFrequency: 250, duration: 0.024, amplitude: 0.085, attack: 0.002, filterType: "lowpass", cutoff: 470 });
}

function playUiSound(preferences, documentRef) {
  if (preferences.volume <= 0) return;
  const context = getAudioContext();
  if (!context) return;
  if (context.state === "suspended") {
    context.resume().then(() => synthesize(context, preferences.pack, preferences.volume, documentRef)).catch(() => {});
    return;
  }
  synthesize(context, preferences.pack, preferences.volume, documentRef);
}

function initUiSounds(documentRef) {
  const enabledInput = documentRef.querySelector("#ui-sounds-enabled");
  const packInput = documentRef.querySelector("#ui-sounds-pack");
  const volumeInput = documentRef.querySelector("#ui-sounds-volume");
  const volumeOutput = documentRef.querySelector("#ui-sounds-volume-value");
  const previewButton = documentRef.querySelector("#ui-sounds-preview");
  if (!enabledInput || !packInput || !volumeInput || !volumeOutput || !previewButton) return;
  let preferences = loadPreferences();
  const persist = () => savePreferences(preferences);
  const syncControls = () => {
    enabledInput.checked = preferences.enabled;
    packInput.value = preferences.pack;
    volumeInput.value = String(preferences.volume);
    volumeOutput.value = preferences.volume + "%";
    volumeOutput.textContent = preferences.volume + "%";
  };
  syncControls();
  enabledInput.addEventListener("change", () => {
    preferences = normalizeUiSoundPreferences({ ...preferences, enabled: enabledInput.checked });
    persist();
  });
  packInput.addEventListener("change", () => {
    preferences = normalizeUiSoundPreferences({ ...preferences, pack: packInput.value });
    persist();
    if (preferences.enabled) playUiSound(preferences, documentRef);
  });
  volumeInput.addEventListener("input", () => {
    preferences = normalizeUiSoundPreferences({ ...preferences, volume: volumeInput.value });
    volumeOutput.value = preferences.volume + "%";
    volumeOutput.textContent = preferences.volume + "%";
    persist();
  });
  previewButton.addEventListener("click", () => playUiSound(preferences, documentRef));
  documentRef.addEventListener("click", event => {
    if (!preferences.enabled || !event.isTrusted) return;
    const target = event.target?.closest?.("button, [role='button'], input[type='button'], input[type='submit']");
    if (!target || target.id === "ui-sounds-preview" || target.disabled ||
        target.getAttribute("aria-disabled") === "true" ||
        target.closest("[data-no-ui-sound], .eq-control, .settings-check, .settings-switch")) return;
    const now = Date.now();
    if (now - lastAutomaticSoundAt < MIN_SOUND_INTERVAL_MS) return;
    lastAutomaticSoundAt = now;
    playUiSound(preferences, documentRef);
  }, true);
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => initUiSounds(document), { once: true });
  else initUiSounds(document);
}
