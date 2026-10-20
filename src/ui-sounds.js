const STORAGE_KEY = "ritmo.ui-sounds.v1";

export const UI_SOUND_PACKS = Object.freeze({
  piano: Object.freeze({ label: "Piano clásico", description: "Notas cortas y suaves, inspiradas en un piano." }),
  punk: Object.freeze({ label: "Punk / rock", description: "Acordes cortos, con energía de guitarra eléctrica." }),
  cyber: Object.freeze({ label: "Cibernético", description: "Pitidos electrónicos con barrido de frecuencia." })
});

export const DEFAULT_UI_SOUND_PREFERENCES = Object.freeze({ enabled: false, pack: "piano", volume: 30 });

export function normalizeUiSoundPreferences(value) {
  const source = value && typeof value === "object" ? value : {};
  const pack = Object.prototype.hasOwnProperty.call(UI_SOUND_PACKS, source.pack) ? source.pack : DEFAULT_UI_SOUND_PREFERENCES.pack;
  const rawVolume = source.volume === undefined ? DEFAULT_UI_SOUND_PREFERENCES.volume : Number(source.volume);
  const volume = Number.isFinite(rawVolume) ? Math.max(0, Math.min(60, Math.round(rawVolume))) : DEFAULT_UI_SOUND_PREFERENCES.volume;
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
const pianoNotes = [523.25, 587.33, 659.25, 783.99, 698.46, 587.33, 659.25, 880];

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
    filter.frequency.setValueAtTime(options.cutoff || 1400, now);
    filter.Q.value = options.q || 0.7;
    oscillator.connect(filter);
    filter.connect(envelope);
  } else oscillator.connect(envelope);
  envelope.connect(output);
  const attack = Math.min(options.attack || 0.009, options.duration * 0.25);
  envelope.gain.setValueAtTime(0.0001, now);
  envelope.gain.linearRampToValueAtTime(Math.max(0.0002, options.amplitude || 0.25), now + attack);
  envelope.gain.exponentialRampToValueAtTime(0.0001, now + options.duration);
  oscillator.onended = () => {
    try { oscillator.disconnect(); } catch {}
    try { envelope.disconnect(); } catch {}
    try { filter?.disconnect(); } catch {}
  };
  oscillator.start(now);
  oscillator.stop(now + options.duration + 0.025);
}

function synthesize(context, pack, volume) {
  if (!masterGain || volume <= 0) return;
  const now = context.currentTime;
  masterGain.gain.cancelScheduledValues(now);
  masterGain.gain.setTargetAtTime(Math.min(0.18, (volume / 60) * 0.18), now, 0.012);
  if (pack === "piano") {
    const note = pianoNotes[noteIndex % pianoNotes.length];
    noteIndex += 1;
    addTone(context, masterGain, note, { type: "triangle", duration: 0.19, amplitude: 0.62, attack: 0.006 });
    addTone(context, masterGain, note * 2, { type: "sine", duration: 0.115, amplitude: 0.15, attack: 0.004 });
    addTone(context, masterGain, note * 3, { type: "sine", duration: 0.07, amplitude: 0.035, attack: 0.003 });
    return;
  }
  if (pack === "punk") {
    const roots = [146.83, 164.81, 196.0, 220.0];
    const root = roots[noteIndex % roots.length];
    noteIndex += 1;
    for (const ratio of [1, 1.5, 2]) {
      addTone(context, masterGain, root * ratio, {
        type: "sawtooth", duration: 0.085, amplitude: 0.19, attack: 0.004,
        filterType: "lowpass", cutoff: 1250, q: 0.8
      });
    }
    return;
  }
  addTone(context, masterGain, 940, {
    type: "square", endFrequency: 470, duration: 0.075, amplitude: 0.19, attack: 0.003,
    filterType: "highpass", cutoff: 520, q: 0.7
  });
  addTone(context, masterGain, 1480, {
    type: "sine", endFrequency: 740, duration: 0.06, amplitude: 0.14, attack: 0.002,
    filterType: "highpass", cutoff: 700, q: 0.7
  });
}

function playUiSound(preferences) {
  if (preferences.volume <= 0) return;
  const context = getAudioContext();
  if (!context) return;
  if (context.state === "suspended") {
    context.resume().then(() => synthesize(context, preferences.pack, preferences.volume)).catch(() => {});
    return;
  }
  synthesize(context, preferences.pack, preferences.volume);
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
    if (preferences.enabled) playUiSound(preferences);
  });
  volumeInput.addEventListener("input", () => {
    preferences = normalizeUiSoundPreferences({ ...preferences, volume: volumeInput.value });
    volumeOutput.value = preferences.volume + "%";
    volumeOutput.textContent = preferences.volume + "%";
    persist();
  });
  previewButton.addEventListener("click", () => playUiSound(preferences));
  // Click-based feedback never sounds while the user is typing in a text field.
  documentRef.addEventListener("click", event => {
    if (!preferences.enabled) return;
    const target = event.target?.closest?.("button, [role='button'], input[type='button'], input[type='submit']");
    if (!target || target.id === "ui-sounds-preview" || target.disabled ||
        target.getAttribute("aria-disabled") === "true" || target.closest("[data-no-ui-sound]")) return;
    playUiSound(preferences);
  }, true);
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => initUiSounds(document), { once: true });
  else initUiSounds(document);
}
