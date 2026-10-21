export const MAX_CONVERTER_INPUT_BYTES = 50 * 1024 * 1024;
export const MAX_CONVERTER_TOTAL_INPUT_BYTES = 100 * 1024 * 1024;
export const MAX_CONVERTER_FILES = 5;
export const MAX_CONVERTER_DURATION_SECONDS = 7 * 60;
export const MAX_CONVERTER_DECODED_BYTES = 160 * 1024 * 1024;
export const MAX_CONVERTER_OUTPUT_BYTES = 120 * 1024 * 1024;

function writeAscii(view, offset, text) {
  for (let index = 0; index < text.length; index++) view.setUint8(offset + index, text.charCodeAt(index));
}
function safeChannels(value) {
  return Number(value) === 1 ? 1 : 2;
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
  let offset = 44;
  for (let frame = 0; frame < frames; frame++) {
    for (let channel = 0; channel < channels; channel++) {
      let sample;
      if (sourceChannels.length === 1) sample = sourceChannels[0][frame];
      else if (channels === 1) {
        let sum = 0;
        for (const source of sourceChannels) sum += source[frame];
        sample = sum / sourceChannels.length;
      } else if (sourceChannels.length === 2) sample = sourceChannels[channel][frame];
      else {
        // Fold multichannel input down to stereo without allocating another full buffer.
        let sum = 0, count = 0;
        for (let source = channel; source < sourceChannels.length; source += 2) {
          sum += sourceChannels[source][frame];
          count++;
        }
        sample = count ? sum / count : 0;
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
 * Web Audio decodes a complete file into memory, so this intentionally enforces
 * conservative per-file size, duration and decoded-memory limits.
 */
export async function convertAudioFileToWav(file, audioContext, { channels = 2 } = {}) {
  if (!file || !Number.isFinite(file.size) || file.size <= 0) throw new Error("El archivo está vacío o no se puede leer.");
  if (file.size > MAX_CONVERTER_INPUT_BYTES) throw new Error("El archivo supera el límite de 50 MiB por conversión.");
  if (!audioContext || typeof audioContext.decodeAudioData !== "function") throw new Error("Este navegador no ofrece un decodificador de audio compatible.");
  let decoded;
  try {
    decoded = await audioContext.decodeAudioData(await file.arrayBuffer());
  } catch {
    throw new Error("El navegador no pudo decodificar este formato. Probá con un archivo que pueda reproducir en Ritmo.");
  }
  if (!decoded || !Number.isFinite(decoded.duration) || decoded.duration <= 0) throw new Error("El archivo decodificado no contiene una duración válida.");
  if (decoded.duration > MAX_CONVERTER_DURATION_SECONDS) throw new Error("La pista supera el límite de 7 minutos para evitar agotar la memoria del dispositivo.");
  const decodedBytes = decoded.length * decoded.numberOfChannels * 4;
  if (!Number.isSafeInteger(decodedBytes) || decodedBytes > MAX_CONVERTER_DECODED_BYTES) {
    throw new Error("El audio decodificado necesita demasiada memoria para convertirlo de forma segura en este dispositivo.");
  }
  const blob = encodePcm16Wav(decoded, channels);
  if (blob.size > MAX_CONVERTER_OUTPUT_BYTES) throw new Error("El WAV resultante supera el límite de 120 MiB.");
  return { blob, duration: decoded.duration, sampleRate: decoded.sampleRate, channels: safeChannels(channels), sourceChannels: decoded.numberOfChannels };
}
