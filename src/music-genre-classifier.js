export const AUDIO_GENRE_MODEL_ID = "onnx-community/Musical-genres-Classification-Hubert-V1-ONNX";
export const AUDIO_GENRE_MODEL_REVISION = "10d98fbaa40c0d007dd249155a553ff6b292aed1";
export const AUDIO_GENRE_MODEL_ESTIMATED_DOWNLOAD_BYTES = 24_000_000;
export const AUDIO_GENRE_SAMPLE_RATE = 16000;
export const AUDIO_GENRE_ANALYSIS_SECONDS = 12;
export const MAX_AUDIO_GENRE_FILE_BYTES = 40 * 1024 * 1024;
export const AUDIO_GENRE_CLASSIFICATION_TIMEOUT_MS = 180_000;

const GENRE_LABELS = Object.freeze({
  blues: "Blues",
  classical: "Clásica",
  country: "Country",
  disco: "Disco",
  hiphop: "Hip-Hop",
  "hip-hop": "Hip-Hop",
  jazz: "Jazz",
  metal: "Metal",
  pop: "Pop",
  reggae: "Reggae",
  rock: "Rock"
});

function abortError() {
  return new DOMException("El análisis de género se canceló.", "AbortError");
}

export function normalizeAcousticGenrePredictions(predictions, limit = 3) {
  if (!Array.isArray(predictions)) return [];
  const safeLimit = Number.isInteger(limit) ? Math.max(1, Math.min(10, limit)) : 3;
  const bestByLabel = new Map();
  for (const prediction of predictions) {
    if (!prediction || typeof prediction !== "object") continue;
    const key = String(prediction.label ?? "").trim().toLowerCase().replace(/[_\s]+/g, "-");
    const label = GENRE_LABELS[key];
    const score = Number(prediction.score);
    if (!label || !Number.isFinite(score) || score < 0 || score > 1) continue;
    const previous = bestByLabel.get(key);
    if (!previous || score > previous.score) bestByLabel.set(key, { label, score });
  }
  return [...bestByLabel.values()]
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label, "es"))
    .slice(0, safeLimit);
}

/** Create a bounded, mono 16 kHz sample from a decoded local audio buffer. */
export function extractCenteredMonoSamples(audioBuffer, targetSampleRate = AUDIO_GENRE_SAMPLE_RATE, maxSeconds = AUDIO_GENRE_ANALYSIS_SECONDS) {
  const sampleRate = Number(audioBuffer?.sampleRate);
  const frameCount = Number(audioBuffer?.length);
  const channels = Number(audioBuffer?.numberOfChannels);
  if (!Number.isFinite(sampleRate) || sampleRate <= 0 ||
      !Number.isSafeInteger(frameCount) || frameCount <= 0 ||
      !Number.isSafeInteger(channels) || channels <= 0 ||
      typeof audioBuffer.getChannelData !== "function" ||
      !Number.isFinite(targetSampleRate) || targetSampleRate < 8000 ||
      !Number.isFinite(maxSeconds) || maxSeconds <= 0) {
    throw new TypeError("El audio decodificado no tiene un formato compatible para analizar el género.");
  }
  const sourceFrames = Math.min(frameCount, Math.max(1, Math.floor(sampleRate * maxSeconds)));
  const startFrame = Math.max(0, Math.floor((frameCount - sourceFrames) / 2));
  const outputFrames = Math.max(1, Math.floor(sourceFrames * targetSampleRate / sampleRate));
  const channelData = [];
  for (let channel = 0; channel < channels; channel++) {
    const data = audioBuffer.getChannelData(channel);
    if (!data || data.length < frameCount) throw new TypeError("No se pudieron leer los canales del archivo de audio.");
    channelData.push(data);
  }
  const output = new Float32Array(outputFrames);
  for (let i = 0; i < outputFrames; i++) {
    const sourcePosition = Math.min(sourceFrames - 1, i * sampleRate / targetSampleRate);
    const leftFrame = Math.floor(sourcePosition);
    const rightFrame = Math.min(sourceFrames - 1, leftFrame + 1);
    const fraction = sourcePosition - leftFrame;
    let left = 0;
    let right = 0;
    for (const channel of channelData) {
      left += Number(channel[startFrame + leftFrame]) || 0;
      right += Number(channel[startFrame + rightFrame]) || 0;
    }
    output[i] = (left * (1 - fraction) + right * fraction) / channels;
  }
  return output;
}

export async function decodeLocalAudioBlob(blob, {
  AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext,
  decodeTimeoutMs = 30_000
} = {}) {
  if (typeof Blob === "undefined" || !(blob instanceof Blob) || blob.size <= 0) {
    throw new TypeError("Seleccioná una canción importada como archivo local para analizarla.");
  }
  if (blob.size > MAX_AUDIO_GENRE_FILE_BYTES) {
    throw new RangeError("Este archivo supera los 40 MB permitidos para el análisis de género. La pista original no se modificó.");
  }
  if (typeof AudioContextClass !== "function") {
    throw new Error("Este navegador no ofrece decodificación de audio compatible.");
  }
  const context = new AudioContextClass();
  let timeoutId = null;
  const timeoutMs = Number.isFinite(decodeTimeoutMs)
    ? Math.max(50, Math.min(120_000, decodeTimeoutMs))
    : 30_000;
  try {
    const encoded = await blob.arrayBuffer();
    const decoded = await Promise.race([
      context.decodeAudioData(encoded),
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error("La decodificación del audio tardó demasiado. Probá otro archivo compatible; no se cambió la ficha.")), timeoutMs);
      })
    ]);
    if (!decoded || decoded.duration < 3) {
      throw new Error("La muestra es demasiado corta. El análisis necesita al menos 3 segundos de audio.");
    }
    return extractCenteredMonoSamples(decoded);
  } finally {
    if (timeoutId !== null) clearTimeout(timeoutId);
    if (typeof context.close === "function") await context.close().catch(() => {});
  }
}

function createClassifierWorker() {
  if (typeof Worker !== "function") {
    throw new Error("Este entorno no permite ejecutar el clasificador de audio en un worker.");
  }
  return new Worker(new URL("./music-genre-classifier-worker.js", import.meta.url), { type: "module" });
}

/**
 * Classify a track's local Blob. The audio samples are transferred to a local
 * worker; only the pinned model/runtime files are fetched, never the song.
 */
export async function classifyLocalAudioTrack(track, {
  onProgress = () => {},
  signal,
  workerFactory = createClassifierWorker,
  decodeAudio = decodeLocalAudioBlob,
  timeoutMs = AUDIO_GENRE_CLASSIFICATION_TIMEOUT_MS
} = {}) {
  if (signal?.aborted) throw abortError();
  if (!track || typeof Blob === "undefined" || !(track.blob instanceof Blob)) {
    throw new TypeError("El análisis acústico solo funciona con canciones importadas como archivos locales; no analiza streaming.");
  }
  const samples = await decodeAudio(track.blob);
  if (signal?.aborted) throw abortError();
  if (!(samples instanceof Float32Array) || samples.length < AUDIO_GENRE_SAMPLE_RATE * 3) {
    throw new TypeError("No se pudo preparar una muestra de audio suficiente para clasificar el género.");
  }

  const worker = workerFactory();
  return new Promise((resolve, reject) => {
    let settled = false;
    const safeTimeout = Number.isFinite(timeoutMs) ? Math.max(1000, Math.min(300_000, timeoutMs)) : AUDIO_GENRE_CLASSIFICATION_TIMEOUT_MS;
    const timer = setTimeout(() => finish(new Error("El modelo tardó demasiado en responder. Comprobá la conexión inicial e intentá otra vez.")), safeTimeout);
    function cleanup() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", handleAbort);
      worker.onmessage = null;
      worker.onerror = null;
      try { worker.terminate(); } catch {}
    }
    function finish(error, value) {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve(value);
    }
    function handleAbort() { finish(abortError()); }
    worker.onmessage = event => {
      const message = event?.data;
      if (!message || typeof message !== "object") return;
      if (message.type === "progress") {
        try { onProgress(String(message.message || "Preparando el modelo local…")); } catch {}
      } else if (message.type === "result") {
        const predictions = normalizeAcousticGenrePredictions(message.predictions, 3);
        if (!predictions.length) finish(new Error("El modelo no devolvió una categoría reconocible. No se cambió el género guardado."));
        else finish(null, predictions);
      } else if (message.type === "error") {
        finish(new Error(String(message.message || "No se pudo ejecutar el modelo acústico.")));
      }
    };
    worker.onerror = event => finish(new Error(String(event?.message || "Falló el worker del clasificador acústico.")));
    if (signal) {
      signal.addEventListener("abort", handleAbort, { once: true });
      if (signal.aborted) { handleAbort(); return; }
    }
    try {
      worker.postMessage({ type: "classify", samples }, [samples.buffer]);
    } catch (error) {
      finish(error instanceof Error ? error : new Error("No se pudo iniciar el clasificador acústico."));
    }
  });
}
