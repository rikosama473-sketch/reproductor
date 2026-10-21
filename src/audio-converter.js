export const MAX_CONVERTER_INPUT_BYTES = 50 * 1024 * 1024;
export const MAX_CONVERTER_TOTAL_INPUT_BYTES = 100 * 1024 * 1024;
export const MAX_CONVERTER_FILES = 5;
export const MAX_CONVERTER_DURATION_SECONDS = 7 * 60;
export const MAX_CONVERTER_DECODED_BYTES = 160 * 1024 * 1024;
export const MAX_CONVERTER_OUTPUT_BYTES = 120 * 1024 * 1024;
export const MAX_CONVERTER_DURATION_PROBE_MS = 10000;

function writeAscii(view, offset, text) {
  for (let index = 0; index < text.length; index++) view.setUint8(offset + index, text.charCodeAt(index));
}
function safeChannels(value) {
  return Number(value) === 1 ? 1 : 2;
}

/**
 * Reserve a Windows-safe WAV download name. The caller owns the Set for one
 * conversion batch; its keys are normalized, case-insensitive filenames.
 */
export function claimUniqueWavFilename(name, usedNames = new Set()) {
  if (!(usedNames instanceof Set)) throw new TypeError("La lista de nombres reservados no es válida.");
  const rawBase = String(name || "audio")
    .replace(/\.[^.]+$/, "")
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "-")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, 100);
  let base = rawBase || "audio";
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(base)) base = "_" + base;
  const key = value => value.normalize("NFC").toLowerCase();
  let filename = base + ".wav";
  let suffix = 2;
  while (usedNames.has(key(filename))) {
    const marker = " (" + suffix++ + ")";
    filename = base.slice(0, Math.max(1, 100 - marker.length)) + marker + ".wav";
  }
  usedNames.add(key(filename));
  return filename;
}

/**
 * Read local-file duration from media metadata before allocating a decoded
 * AudioBuffer. The conversion path fails closed when the browser cannot report
 * a finite duration, rather than risking a large decode on an uncertain file.
 * The injectable dependencies also let the metadata path be regression-tested
 * without requiring browser audio hardware.
 */
export async function probeAudioFileDuration(file, {
  createAudioElement = () => new Audio(),
  createObjectURL = value => URL.createObjectURL(value),
  revokeObjectURL = value => URL.revokeObjectURL(value),
  timeoutMs = MAX_CONVERTER_DURATION_PROBE_MS
} = {}) {
  if (!file) throw new TypeError("No se recibió un archivo para comprobar.");
  let objectUrl;
  try {
    objectUrl = createObjectURL(file);
  } catch {
    throw new Error("No se pudo preparar el archivo para comprobar su duración.");
  }

  return await new Promise((resolve, reject) => {
    let element = null;
    let settled = false;
    let timer = null;

    const finish = (error, duration) => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      if (element) {
        element.removeEventListener?.("loadedmetadata", onMetadata);
        element.removeEventListener?.("error", onError);
        try {
          element.pause?.();
          element.removeAttribute?.("src");
          element.load?.();
        } catch {}
      }
      try { revokeObjectURL(objectUrl); } catch {}
      if (error) reject(error);
      else resolve(duration);
    };

    const onMetadata = () => {
      const duration = Number(element?.duration);
      if (!Number.isFinite(duration) || duration <= 0) {
        finish(new Error("El navegador no informó una duración finita; se canceló la conversión por seguridad."));
        return;
      }
      finish(null, duration);
    };
    const onError = () => finish(new Error(
      "El navegador no pudo leer los metadatos de duración. No se inició la conversión para proteger la memoria."
    ));

    try {
      element = createAudioElement();
      if (!element || typeof element.addEventListener !== "function") {
        throw new TypeError("No hay un lector de metadatos de audio disponible.");
      }
      element.preload = "metadata";
      element.addEventListener("loadedmetadata", onMetadata, { once: true });
      element.addEventListener("error", onError, { once: true });
      timer = setTimeout(() => finish(new Error(
        "Se agotó el tiempo para comprobar la duración; no se inició la conversión para proteger la memoria."
      )), Math.max(1, Number(timeoutMs) || MAX_CONVERTER_DURATION_PROBE_MS));
      element.src = objectUrl;
      element.load?.();
    } catch {
      finish(new Error("No se pudo leer la duración del archivo antes de decodificarlo."));
    }
  });
}

/** Encode a decoded AudioBuffer as real little-endian PCM16 RIFF/WAVE data. */
export function encodePcm16Wav(audioBuffer, outputChannels = 2) {
  if (!audioBuffer || !Number.isInteger(audioBuffer.length) || audioBuffer.length < 1 ||
      !Number.isFinite(audioBuffer.sampleRate) || audioBuffer.sampleRate < 8000 ||
      !Number.isInteger(audioBuffer.numberOfChannels) || audioBuffer.numberOfChannels < 1 ||
      typeof audioBuffer.getChannelData !== "function") {
    throw new TypeError("El audio decodificado no contiene muestras válidas.");
  }
  const channels = safeChannels(outputChannels);
  const frames = audioBuffer.length;
  const sampleRate = Math.round(audioBuffer.sampleRate);
  const dataBytes = frames * channels * 2;
  if (!Number.isSafeInteger(dataBytes) || dataBytes > 0xffffffff - 36) {
    throw new RangeError("El WAV resultante supera el límite del formato RIFF.");
  }

  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // WAVE_FORMAT_PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataBytes, true);

  const sourceChannels = Array.from({ length: audioBuffer.numberOfChannels }, (_, index) => audioBuffer.getChannelData(index));
  const sourceChannelCount = sourceChannels.length;
  const surroundGain = Math.SQRT1_2;
  let offset = 44;
  for (let frame = 0; frame < frames; frame++) {
    for (let channel = 0; channel < channels; channel++) {
      let sample;
      if (sourceChannelCount === 1) {
        // Duplicate mono for stereo output; mono remains unchanged.
        sample = sourceChannels[0][frame];
      } else if (sourceChannelCount === 2) {
        sample = channels === 1
          ? 0.5 * (sourceChannels[0][frame] + sourceChannels[1][frame])
          : sourceChannels[channel][frame];
      } else if (sourceChannelCount === 4) {
        // Standard Web Audio quad order: L, R, surround-L, surround-R.
        sample = channels === 1
          ? 0.25 * (sourceChannels[0][frame] + sourceChannels[1][frame] +
            sourceChannels[2][frame] + sourceChannels[3][frame])
          : 0.5 * (sourceChannels[channel][frame] + sourceChannels[channel + 2][frame]);
      } else if (sourceChannelCount === 6) {
        // Standard Web Audio 5.1 order: L, R, C, LFE, surround-L, surround-R.
        // LFE is omitted when down-mixing to mono/stereo, as defined by Web Audio.
        sample = channels === 1
          ? surroundGain * (sourceChannels[0][frame] + sourceChannels[1][frame]) +
            sourceChannels[2][frame] + 0.5 * (sourceChannels[4][frame] + sourceChannels[5][frame])
          : sourceChannels[channel][frame] + surroundGain *
            (sourceChannels[2][frame] + sourceChannels[channel === 0 ? 4 : 5][frame]);
      } else {
        // Unknown layouts are not assumed to be surround speakers: preserve
        // only the matching output channel(s), rather than misrouting center/LFE.
        sample = sourceChannelCount > channel ? sourceChannels[channel][frame] : 0;
      }
      if (!Number.isFinite(sample)) sample = 0;
      sample = Math.max(-1, Math.min(1, sample));
      view.setInt16(offset, sample < 0 ? Math.round(sample * 32768) : Math.round(sample * 32767), true);
      offset += 2;
    }
  }
  return new Blob([buffer], { type: "audio/wav" });
}

/**
 * Decode only formats supported by the current browser, then encode PCM16 WAV.
 * Web Audio decodes complete file data into memory; duration and expected output
 * size are therefore checked before decodeAudioData() whenever metadata allows it.
 */
export async function convertAudioFileToWav(file, audioContext, {
  channels = 2,
  durationProbe = probeAudioFileDuration,
  maxOutputBytes = MAX_CONVERTER_OUTPUT_BYTES
} = {}) {
  if (!file || !Number.isFinite(file.size) || file.size <= 0) throw new Error("El archivo está vacío o no se puede leer.");
  if (file.size > MAX_CONVERTER_INPUT_BYTES) throw new Error("El archivo supera el límite de 50 MiB por conversión.");
  if (!audioContext || typeof audioContext.decodeAudioData !== "function") throw new Error("Este navegador no ofrece un decodificador de audio compatible.");
  if (typeof durationProbe !== "function") throw new TypeError("No hay un comprobador de duración disponible.");

  const durationBeforeDecode = await durationProbe(file);
  if (!Number.isFinite(durationBeforeDecode) || durationBeforeDecode <= 0) {
    throw new Error("No se pudo comprobar una duración válida antes de decodificar el audio.");
  }
  if (durationBeforeDecode > MAX_CONVERTER_DURATION_SECONDS) {
    throw new Error("La pista supera el límite de 7 minutos para evitar agotar la memoria del dispositivo.");
  }

  const sampleRateBeforeDecode = Number(audioContext.sampleRate);
  if (!Number.isFinite(sampleRateBeforeDecode) || sampleRateBeforeDecode < 8000) {
    throw new Error("El motor de audio no informó una frecuencia de muestreo válida.");
  }
  const outputLimit = Number.isFinite(maxOutputBytes)
    ? Math.max(0, Math.min(MAX_CONVERTER_OUTPUT_BYTES, Math.floor(maxOutputBytes)))
    : MAX_CONVERTER_OUTPUT_BYTES;
  const estimatedFrames = Math.ceil(durationBeforeDecode * sampleRateBeforeDecode);
  const estimatedOutputBytes = 44 + estimatedFrames * safeChannels(channels) * 2;
  if (!Number.isSafeInteger(estimatedOutputBytes) || estimatedOutputBytes > outputLimit) {
    throw new Error("El WAV estimado supera el espacio disponible para resultados de esta tanda; descargá o limpiá los resultados antes de continuar.");
  }

  let decoded;
  try {
    decoded = await audioContext.decodeAudioData(await file.arrayBuffer());
  } catch {
    throw new Error("El navegador no pudo decodificar este formato. Probá con un archivo que pueda reproducir en Ritmo.");
  }
  if (!decoded || !Number.isFinite(decoded.duration) || decoded.duration <= 0) throw new Error("El archivo decodificado no contiene una duración válida.");
  // Keep a post-decode guard as a defense against inaccurate or malformed metadata.
  if (decoded.duration > MAX_CONVERTER_DURATION_SECONDS) throw new Error("La pista supera el límite de 7 minutos para evitar agotar la memoria del dispositivo.");
  const decodedBytes = decoded.length * decoded.numberOfChannels * 4;
  if (!Number.isSafeInteger(decodedBytes) || decodedBytes > MAX_CONVERTER_DECODED_BYTES) {
    throw new Error("El audio decodificado necesita demasiada memoria para convertirlo de forma segura en este dispositivo.");
  }
  const blob = encodePcm16Wav(decoded, channels);
  if (blob.size > outputLimit) throw new Error("El WAV resultante supera el límite de espacio disponible para resultados.");
  return { blob, duration: decoded.duration, sampleRate: decoded.sampleRate, channels: safeChannels(channels), sourceChannels: decoded.numberOfChannels };
}
