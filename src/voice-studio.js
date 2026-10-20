const STORAGE_KEY = "ritmo.voice-studio.v1";

export const VOICE_PRESETS = Object.freeze({
  anime: Object.freeze({ label: "Anime aguda", icon: "✦", description: "Tono alto y expresión brillante.", pitch: 1.8, rate: 1.08 }),
  kawaii: Object.freeze({ label: "Kawaii / dulce", icon: "♡", description: "Más suave, luminosa y pausada.", pitch: 1.72, rate: 0.94 }),
  shonen: Object.freeze({ label: "Shōnen energético", icon: "⚡", description: "Más impulso para frases de acción.", pitch: 1.18, rate: 1.24 }),
  tsundere: Object.freeze({ label: "Tsundere rápida", icon: "❣", description: "Tono alto y ritmo impaciente.", pitch: 1.52, rate: 1.36 }),
  chibi: Object.freeze({ label: "Chibi acelerada", icon: "♪", description: "Tono muy alto y velocidad de comedia.", pitch: 1.95, rate: 1.43 }),
  mysterious: Object.freeze({ label: "Grave / misteriosa", icon: "☾", description: "Tono bajo, sereno y más lento.", pitch: 0.68, rate: 0.9 }),
  narrator: Object.freeze({ label: "Narradora calmada", icon: "▤", description: "Lectura pausada para historias.", pitch: 0.92, rate: 0.88 }),
  robot: Object.freeze({ label: "Robot / neutral", icon: "⌁", description: "Parámetros estables y tono centrado.", pitch: 1, rate: 1 }),
  rap: Object.freeze({ label: "Rap / muy rápida", icon: "↯", description: "Máxima agilidad para probar frases rítmicas.", pitch: 1.04, rate: 1.62 }),
  custom: Object.freeze({ label: "Personalizada", icon: "⚙", description: "Ajustá tono y velocidad manualmente.", pitch: 1, rate: 1 })
});

const DEFAULT_SETTINGS = Object.freeze({
  preset: "anime",
  pitch: VOICE_PRESETS.anime.pitch,
  rate: VOICE_PRESETS.anime.rate,
  volume: 86,
  voiceURI: "",
  pauseMusic: true,
  text: "¡No pienso rendirme ahora! ¡Vamos, allá vamos!"
});

function normalizeSettings(value) {
  const source = value && typeof value === "object" ? value : {};
  const preset = Object.prototype.hasOwnProperty.call(VOICE_PRESETS, source.preset) ? source.preset : DEFAULT_SETTINGS.preset;
  const numberInRange = (input, fallback, min, max) => {
    const number = Number(input);
    return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
  };
  return {
    preset,
    pitch: numberInRange(source.pitch, VOICE_PRESETS[preset].pitch, 0.5, 2),
    rate: numberInRange(source.rate, VOICE_PRESETS[preset].rate, 0.6, 1.8),
    volume: Math.round(numberInRange(source.volume, DEFAULT_SETTINGS.volume, 0, 100)),
    voiceURI: typeof source.voiceURI === "string" ? source.voiceURI.slice(0, 500) : "",
    pauseMusic: source.pauseMusic !== false,
    text: typeof source.text === "string" ? source.text.slice(0, 400) : DEFAULT_SETTINGS.text
  };
}

function readSettings() {
  try {
    return normalizeSettings(JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "null"));
  } catch {
    return normalizeSettings(null);
  }
}

function initializeVoiceStudio() {
  const root = document.querySelector("#voice-studio");
  if (!root) return;

  const $ = selector => root.querySelector(selector);
  const presetGrid = $("#voice-preset-grid");
  const voiceSelect = $("#voice-system-voice");
  const textInput = $("#voice-sample-text");
  const pitchInput = $("#voice-pitch");
  const rateInput = $("#voice-rate");
  const volumeInput = $("#voice-output-volume");
  const pauseMusicInput = $("#voice-pause-music");
  const pitchOutput = $("#voice-pitch-value");
  const rateOutput = $("#voice-rate-value");
  const volumeOutput = $("#voice-output-volume-value");
  const playButton = $("#voice-preview-play");
  const stopButton = $("#voice-preview-stop");
  const status = $("#voice-preview-status");
  const voiceNote = $("#voice-runtime-note");
  const synthesis = "speechSynthesis" in window ? window.speechSynthesis : null;
  let settings = readSettings();
  let voices = [];
  let previewToken = 0;
  let previewActive = false;
  let pauseRequestedForPreview = false;

  function persistSettings() {
    settings = normalizeSettings({
      ...settings,
      preset: presetGrid.querySelector('[aria-pressed="true"]')?.dataset.voicePreset || settings.preset,
      pitch: Number(pitchInput.value),
      rate: Number(rateInput.value),
      volume: Number(volumeInput.value),
      voiceURI: voices[Number(voiceSelect.value)]?.voiceURI || "",
      pauseMusic: pauseMusicInput.checked,
      text: textInput.value
    });
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch {}
  }

  function updateOutputs() {
    pitchOutput.textContent = Number(pitchInput.value).toFixed(2) + "×";
    rateOutput.textContent = Number(rateInput.value).toFixed(2) + "×";
    volumeOutput.textContent = volumeInput.value + "%";
  }

  function setSelectedPreset(key) {
    const preset = VOICE_PRESETS[key];
    if (!preset) return;
    settings.preset = key;
    presetGrid.querySelectorAll("[data-voice-preset]").forEach(button => {
      button.setAttribute("aria-pressed", String(button.dataset.voicePreset === key));
    });
    pitchInput.value = String(preset.pitch);
    rateInput.value = String(preset.rate);
    updateOutputs();
    persistSettings();
  }

  function buildPresetCards() {
    for (const [key, preset] of Object.entries(VOICE_PRESETS)) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "voice-preset-card";
      button.dataset.voicePreset = key;
      button.setAttribute("aria-pressed", String(key === settings.preset));
      const icon = document.createElement("span");
      icon.className = "voice-preset-icon";
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = preset.icon;
      const title = document.createElement("strong");
      title.textContent = preset.label;
      const description = document.createElement("small");
      description.textContent = preset.description;
      button.append(icon, title, description);
      button.addEventListener("click", () => setSelectedPreset(key));
      presetGrid.append(button);
    }
  }

  function populateVoices() {
    if (!synthesis || !voiceSelect) return;
    const previousURI = voices[Number(voiceSelect.value)]?.voiceURI || settings.voiceURI;
    voices = synthesis.getVoices().slice().sort((a, b) => {
      const languageOrder = voice => /^es(?:-|$)/i.test(voice.lang) ? 0 : /^ja(?:-|$)/i.test(voice.lang) ? 1 : 2;
      return languageOrder(a) - languageOrder(b) || a.lang.localeCompare(b.lang) || a.name.localeCompare(b.name);
    });
    voiceSelect.replaceChildren();
    if (!voices.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "Voz predeterminada del sistema";
      voiceSelect.append(option);
      voiceNote.textContent = "El navegador todavía no informó sus voces. Se intentará usar la voz predeterminada del sistema.";
      return;
    }
    let preferredIndex = voices.findIndex(voice => voice.voiceURI === previousURI);
    if (preferredIndex < 0) preferredIndex = voices.findIndex(voice => /^es(?:-|$)/i.test(voice.lang));
    if (preferredIndex < 0) preferredIndex = voices.findIndex(voice => /^ja(?:-|$)/i.test(voice.lang));
    if (preferredIndex < 0) preferredIndex = 0;
    voices.forEach((voice, index) => {
      const option = document.createElement("option");
      option.value = String(index);
      option.textContent = voice.name + " — " + voice.lang + (voice.localService ? " · sistema/local" : " · proveedor del navegador");
      voiceSelect.append(option);
    });
    voiceSelect.value = String(preferredIndex);
    settings.voiceURI = voices[preferredIndex].voiceURI || "";
    voiceNote.textContent = voices.length + " voz/ces disponibles en este dispositivo. Las voces japonesas aparecen si el sistema o navegador las tiene instaladas.";
    persistSettings();
  }

  function endPauseIfNeeded() {
    if (!pauseRequestedForPreview) return;
    pauseRequestedForPreview = false;
    window.dispatchEvent(new CustomEvent("ritmo:voice-preview-end"));
  }

  function finishPreview(token, message) {
    if (token !== previewToken) return;
    previewActive = false;
    playButton.disabled = false;
    stopButton.disabled = true;
    endPauseIfNeeded();
    if (message) status.textContent = message;
  }

  function stopPreview(message) {
    previewToken += 1;
    previewActive = false;
    if (synthesis) synthesis.cancel();
    playButton.disabled = !synthesis;
    stopButton.disabled = true;
    endPauseIfNeeded();
    if (message) status.textContent = message;
  }

  function playPreview() {
    if (!synthesis || typeof window.SpeechSynthesisUtterance !== "function") {
      status.textContent = "Este navegador no ofrece síntesis de voz. Probá con un navegador Chromium actualizado o un motor de voz del sistema.";
      return;
    }
    const phrase = textInput.value.trim().slice(0, 400);
    if (!phrase) {
      status.textContent = "Escribí una frase para escuchar la muestra.";
      textInput.focus();
      return;
    }

    const continuingPause = previewActive && pauseRequestedForPreview;
    if (previewActive) {
      previewToken += 1;
      synthesis.cancel();
      previewActive = false;
    }
    if (!continuingPause && pauseMusicInput.checked) {
      window.dispatchEvent(new CustomEvent("ritmo:voice-preview-start", { detail: { pauseMusic: true } }));
    }
    pauseRequestedForPreview = continuingPause || pauseMusicInput.checked;

    const utterance = new window.SpeechSynthesisUtterance(phrase);
    const voice = voices[Number(voiceSelect.value)] || null;
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    } else {
      utterance.lang = "es-AR";
    }
    utterance.pitch = Math.max(0.5, Math.min(2, Number(pitchInput.value) || 1));
    utterance.rate = Math.max(0.6, Math.min(1.8, Number(rateInput.value) || 1));
    utterance.volume = Math.max(0, Math.min(1, Number(volumeInput.value) / 100));
    const token = ++previewToken;
    previewActive = true;
    playButton.disabled = false;
    stopButton.disabled = false;
    status.textContent = "Preparando muestra de voz…";
    persistSettings();

    utterance.onstart = () => {
      if (token === previewToken) status.textContent = "Reproduciendo muestra. La música se reanudará al terminar si Ritmo la pausó.";
    };
    utterance.onend = () => finishPreview(token, "Muestra terminada.");
    utterance.onerror = event => {
      if (event.error === "canceled" || event.error === "interrupted") {
        finishPreview(token, "");
        return;
      }
      finishPreview(token, "No se pudo reproducir esta voz. Elegí otra voz instalada o revisá el motor de voz del sistema.");
    };
    try {
      synthesis.speak(utterance);
    } catch {
      finishPreview(token, "El sistema no pudo iniciar la síntesis de voz.");
    }
  }

  buildPresetCards();
  pitchInput.value = String(settings.pitch);
  rateInput.value = String(settings.rate);
  volumeInput.value = String(settings.volume);
  pauseMusicInput.checked = settings.pauseMusic;
  textInput.value = settings.text;
  updateOutputs();

  pitchInput.addEventListener("input", () => {
    setSelectedPreset("custom");
    pitchInput.value = String(Math.max(0.5, Math.min(2, Number(pitchInput.value))));
    updateOutputs();
    persistSettings();
  });
  rateInput.addEventListener("input", () => {
    setSelectedPreset("custom");
    rateInput.value = String(Math.max(0.6, Math.min(1.8, Number(rateInput.value))));
    updateOutputs();
    persistSettings();
  });
  volumeInput.addEventListener("input", () => { updateOutputs(); persistSettings(); });
  pauseMusicInput.addEventListener("change", persistSettings);
  textInput.addEventListener("input", persistSettings);
  voiceSelect.addEventListener("change", persistSettings);
  playButton.addEventListener("click", playPreview);
  stopButton.addEventListener("click", () => stopPreview("Muestra detenida."));

  if (!synthesis || typeof window.SpeechSynthesisUtterance !== "function") {
    playButton.disabled = true;
    stopButton.disabled = true;
    status.textContent = "Síntesis de voz no disponible en este navegador o motor del sistema.";
    voiceNote.textContent = "No se encontró la API de voces de este navegador. Los controles de Ritmo siguen funcionando.";
  } else {
    stopButton.disabled = true;
    populateVoices();
    synthesis.addEventListener?.("voiceschanged", populateVoices);
    if ("onvoiceschanged" in synthesis) synthesis.onvoiceschanged = populateVoices;
    status.textContent = "Elegí un perfil y tocá «Escuchar muestra». La voz depende del sistema instalado.";
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeVoiceStudio, { once: true });
} else {
  initializeVoiceStudio();
}
