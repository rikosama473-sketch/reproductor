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

function createConverterAbortError() {
  const error = new Error("La conversión fue cancelada.");
  error.name = "AbortError";
  return error;
}

function throwIfConverterAborted(signal) {
  if (signal?.aborted) throw createConverterAbortError();
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
  timeoutMs = MAX_CONVERTER_DURATION_PROBE_MS,
  signal
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
    let onAbort = null;

    const finish = (error, duration) => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      if (onAbort) signal?.removeEventListener("abort", onAbort);
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
      onAbort = () => finish(createConverterAbortError());
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) {
        onAbort();
        return;
      }
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
function mixedPcmSample(sourceChannels, frame, outputChannel, outputChannels) {
  const count = sourceChannels.length;
  const surroundGain = Math.SQRT1_2;
  let sample;
  if (count === 1) {
    sample = sourceChannels[0][frame];
  } else if (count === 2) {
    sample = outputChannels === 1
      ? 0.5 * (sourceChannels[0][frame] + sourceChannels[1][frame])
      : sourceChannels[outputChannel][frame];
  } else if (count === 4) {
    // Standard Web Audio quad order: L, R, surround-L, surround-R.
    sample = outputChannels === 1
      ? 0.25 * (sourceChannels[0][frame] + sourceChannels[1][frame] +
        sourceChannels[2][frame] + sourceChannels[3][frame])
      : 0.5 * (sourceChannels[outputChannel][frame] + sourceChannels[outputChannel + 2][frame]);
  } else if (count === 6) {
    // Standard Web Audio 5.1 order: L, R, C, LFE, surround-L, surround-R.
    // LFE is omitted when down-mixing to mono/stereo.
    sample = outputChannels === 1
      ? surroundGain * (sourceChannels[0][frame] + sourceChannels[1][frame]) +
        sourceChannels[2][frame] + 0.5 * (sourceChannels[4][frame] + sourceChannels[5][frame])
      : sourceChannels[outputChannel][frame] + surroundGain *
        (sourceChannels[2][frame] + sourceChannels[outputChannel === 0 ? 4 : 5][frame]);
  } else {
    // Unknown layouts are not assumed to be surround speakers.
    sample = count > outputChannel ? sourceChannels[outputChannel][frame] : 0;
  }
  return Number.isFinite(sample) ? sample : 0;
}

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

  // Measure the mixed peak before encoding. A fixed whole-output attenuation
  // is applied only if channel summation would exceed full scale; this avoids
  // hard clipping without changing relative dynamics or allocating a new PCM
  // buffer in memory.
  let mixedPeak = 0;
  for (let frame = 0; frame < frames; frame++) {
    for (let channel = 0; channel < channels; channel++) {
      mixedPeak = Math.max(mixedPeak, Math.abs(mixedPcmSample(sourceChannels, frame, channel, channels)));
    }
  }
  const mixGain = mixedPeak > 1 ? 1 / mixedPeak : 1;
  let offset = 44;
  for (let frame = 0; frame < frames; frame++) {
    for (let channel = 0; channel < channels; channel++) {
      const mixed = mixedPcmSample(sourceChannels, frame, channel, channels) * mixGain;
      const sample = Math.max(-1, Math.min(1, mixed));
      view.setInt16(offset, sample < 0 ? Math.round(sample * 32768) : Math.round(sample * 32767), true);
      offset += 2;
    }
  }
  return new Blob([buffer], { type: "audio/wav" });
}


/**
 * Verify the exact PCM16 RIFF/WAVE layout written by encodePcm16Wav().
 * Reads only the fixed 44-byte header; the payload is length-checked but never
 * copied just for validation.
 */
export async function validatePcm16WavBlob(blob, expected = {}) {
  const size = Number(blob?.size);
  if (!blob || typeof blob.slice !== "function" || !Number.isSafeInteger(size) ||
      size < 46 || size > 0x100000007) {
    throw new Error("El WAV generado tiene un tamaño inválido o está incompleto.");
  }
  if (typeof blob.slice(0, 44)?.arrayBuffer !== "function") {
    throw new Error("No se pudo leer la cabecera del WAV generado.");
  }

  let headerBuffer;
  try {
    headerBuffer = await blob.slice(0, 44).arrayBuffer();
  } catch {
    throw new Error("No se pudo leer la cabecera del WAV generado.");
  }
  if (headerBuffer.byteLength !== 44) {
    throw new Error("La cabecera WAV está truncada; no se conservará el resultado.");
  }

  const header = new DataView(headerBuffer);
  const ascii = (offset, length) => {
    let result = "";
    for (let index = 0; index < length; index++) result += String.fromCharCode(header.getUint8(offset + index));
    return result;
  };
  if (ascii(0, 4) !== "RIFF" || ascii(8, 4) !== "WAVE") {
    throw new Error("La salida no contiene una cabecera RIFF/WAVE válida.");
  }
  if (header.getUint32(4, true) !== size - 8) {
    throw new Error("El tamaño RIFF no coincide con el tamaño real del archivo.");
  }
  if (ascii(12, 4) !== "fmt " || header.getUint32(16, true) !== 16) {
    throw new Error("El bloque de formato WAV no tiene el tamaño PCM esperado.");
  }

  const formatCode = header.getUint16(20, true);
  const channels = header.getUint16(22, true);
  const sampleRate = header.getUint32(24, true);
  const byteRate = header.getUint32(28, true);
  const blockAlign = header.getUint16(32, true);
  const bitsPerSample = header.getUint16(34, true);
  if (formatCode !== 1 || (channels !== 1 && channels !== 2) || bitsPerSample !== 16) {
    throw new Error("La salida no declara PCM entero de 16 bits mono/estéreo.");
  }
  if (sampleRate < 8000 || blockAlign !== channels * 2 ||
      byteRate !== sampleRate * blockAlign) {
    throw new Error("La frecuencia o la alineación de muestras del WAV no es coherente.");
  }
  if (ascii(36, 4) !== "data") {
    throw new Error("Falta el bloque de muestras de audio WAV.");
  }

  const dataBytes = header.getUint32(40, true);
  if (dataBytes <= 0 || dataBytes % blockAlign !== 0 ||
      dataBytes !== size - 44) {
    throw new Error("La longitud de las muestras no coincide con el contenido real del WAV.");
  }
  if (expected.channels !== undefined && Number(expected.channels) !== channels) {
    throw new Error("Los canales WAV no coinciden con la configuración de conversión.");
  }
  if (expected.sampleRate !== undefined &&
      Math.round(Number(expected.sampleRate)) !== sampleRate) {
    throw new Error("La frecuencia WAV no coincide con la frecuencia de salida declarada.");
  }

  return {
    format: "pcm_s16le",
    channels,
    sampleRate,
    bitsPerSample,
    blockAlign,
    byteRate,
    dataBytes,
    frames: dataBytes / blockAlign,
    duration: dataBytes / byteRate,
    fileBytes: size
  };
}

/**
 * Decode only formats supported by the current browser, then encode PCM16 WAV.
 * Web Audio decodes complete file data into memory; duration and expected output
 * size are therefore checked before decodeAudioData() whenever metadata allows it.
 */
export const MAX_CONVERTER_STREAM_CHUNK_BYTES = 256 * 1024;

/**
 * Identify conventional RIFF/WAVE PCM16 mono/stereo input without reading its
 * audio payload. Unsupported codecs/channel layouts fall back to Web Audio.
 */
async function inspectStreamablePcm16Wav(file, signal) {
  if (typeof file?.slice !== "function" || file.size < 44) return null;
  throwIfConverterAborted(signal);
  const signatureBuffer = await file.slice(0, 12).arrayBuffer();
  if (signatureBuffer.byteLength !== 12) return null;
  const signature = new DataView(signatureBuffer);
  const riff = String.fromCharCode(
    signature.getUint8(0), signature.getUint8(1),
    signature.getUint8(2), signature.getUint8(3)
  );
  const wave = String.fromCharCode(
    signature.getUint8(8), signature.getUint8(9),
    signature.getUint8(10), signature.getUint8(11)
  );
  if (riff !== "RIFF" || wave !== "WAVE") return null;
  if (signature.getUint32(4, true) + 8 !== file.size) {
    throw new Error("El tamaño RIFF del WAV de entrada no coincide con el archivo real.");
  }

  let offset = 12;
  let format = null;
  let data = null;
  while (offset < file.size) {
    throwIfConverterAborted(signal);
    if (offset + 8 > file.size) {
      throw new Error("El WAV de entrada termina dentro de una cabecera de bloque.");
    }
    const chunkBuffer = await file.slice(offset, offset + 8).arrayBuffer();
    if (chunkBuffer.byteLength !== 8) throw new Error("No se pudo leer un bloque del WAV de entrada.");
    const chunkHeader = new DataView(chunkBuffer);
    const chunkName = String.fromCharCode(
      chunkHeader.getUint8(0), chunkHeader.getUint8(1),
      chunkHeader.getUint8(2), chunkHeader.getUint8(3)
    );
    const chunkSize = chunkHeader.getUint32(4, true);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkSize;
    const nextOffset = chunkEnd + (chunkSize % 2);
    if (chunkEnd > file.size || nextOffset > file.size) {
      throw new Error("Un bloque del WAV de entrada declara una longitud fuera del archivo.");
    }

    if (chunkName === "fmt " && format === null) {
      if (chunkSize < 16) throw new Error("El bloque fmt del WAV de entrada está truncado.");
      const fmtBuffer = await file.slice(chunkStart, chunkStart + 16).arrayBuffer();
      if (fmtBuffer.byteLength !== 16) throw new Error("No se pudo leer el formato del WAV de entrada.");
      const fmt = new DataView(fmtBuffer);
      format = {
        code: fmt.getUint16(0, true),
        channels: fmt.getUint16(2, true),
        sampleRate: fmt.getUint32(4, true),
        byteRate: fmt.getUint32(8, true),
        blockAlign: fmt.getUint16(12, true),
        bitsPerSample: fmt.getUint16(14, true)
      };
    } else if (chunkName === "data" && data === null) {
      data = { start: chunkStart, bytes: chunkSize };
    }
    offset = nextOffset;
  }

  if (!format || !data) throw new Error("El WAV de entrada no contiene los bloques fmt y data esperados.");
  // Other PCM formats and multichannel files remain on the existing decoder path.
  if (format.code !== 1 || ![1, 2].includes(format.channels) || format.bitsPerSample !== 16) {
    return null;
  }
  if (format.sampleRate < 8000 || format.blockAlign !== format.channels * 2 ||
      format.byteRate !== format.sampleRate * format.blockAlign) {
    throw new Error("La frecuencia o la alineación PCM16 del WAV de entrada es incoherente.");
  }
  if (data.bytes <= 0 || data.bytes % format.blockAlign !== 0) {
    throw new Error("La longitud PCM16 del WAV de entrada no está alineada con sus muestras.");
  }
  const frames = data.bytes / format.blockAlign;
  const duration = frames / format.sampleRate;
  if (!Number.isSafeInteger(frames) || !Number.isFinite(duration) || duration <= 0) {
    throw new Error("La duración o el número de muestras del WAV de entrada no es válido.");
  }
  return {
    dataStart: data.start,
    dataBytes: data.bytes,
    frames,
    duration,
    sampleRate: format.sampleRate,
    sourceChannels: format.channels,
    blockAlign: format.blockAlign
  };
}

function createPcm16WavHeader(channels, sampleRate, dataBytes) {
  if (!Number.isSafeInteger(dataBytes) || dataBytes <= 0 || dataBytes > 0xffffffff - 36) {
    throw new RangeError("El WAV resultante supera el límite del formato RIFF.");
  }
  const buffer = new ArrayBuffer(44);
  const view = new DataView(buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataBytes, true);
  return buffer;
}

/**
 * Repack supported PCM16 WAV inputs in bounded chunks. No AudioBuffer and no
 * whole-input ArrayBuffer is created. The final downloadable Blob still stores
 * the complete output; this is a memory-reduced PCM path, not universal streaming.
 */
async function convertPcm16WavInChunks(file, layout, outputChannels, outputLimit, signal) {
  const dataBytes = layout.frames * outputChannels * 2;
  const outputBytes = 44 + dataBytes;
  if (!Number.isSafeInteger(dataBytes) || outputBytes > outputLimit ||
      outputBytes > MAX_CONVERTER_OUTPUT_BYTES) {
    throw new Error("El WAV real supera el espacio disponible para resultados; se rechazó antes de procesar las muestras.");
  }

  const parts = [createPcm16WavHeader(outputChannels, layout.sampleRate, dataBytes)];
  if (outputChannels === layout.sourceChannels) {
    // Blob slices reuse the original PCM payload without decoding or copying it.
    parts.push(file.slice(layout.dataStart, layout.dataStart + layout.dataBytes));
  } else {
    const framesPerChunk = Math.max(1, Math.floor(
      MAX_CONVERTER_STREAM_CHUNK_BYTES / layout.blockAlign
    ));
    for (let frameOffset = 0; frameOffset < layout.frames; frameOffset += framesPerChunk) {
      throwIfConverterAborted(signal);
      const frameCount = Math.min(framesPerChunk, layout.frames - frameOffset);
      const sourceStart = layout.dataStart + frameOffset * layout.blockAlign;
      const sourceEnd = sourceStart + frameCount * layout.blockAlign;
      const sourceBuffer = await file.slice(sourceStart, sourceEnd).arrayBuffer();
      if (sourceBuffer.byteLength !== frameCount * layout.blockAlign) {
        throw new Error("No se pudo leer un bloque completo de muestras WAV.");
      }
      const source = new DataView(sourceBuffer);
      const outputBuffer = new ArrayBuffer(frameCount * outputChannels * 2);
      const output = new DataView(outputBuffer);
      for (let frame = 0; frame < frameCount; frame++) {
        if (layout.sourceChannels === 1 && outputChannels === 2) {
          const sample = source.getInt16(frame * 2, true);
          output.setInt16(frame * 4, sample, true);
          output.setInt16(frame * 4 + 2, sample, true);
        } else {
          const left = source.getInt16(frame * 4, true);
          const right = source.getInt16(frame * 4 + 2, true);
          const mono = Math.max(-32768, Math.min(32767, Math.round((left + right) / 2)));
          output.setInt16(frame * 2, mono, true);
        }
      }
      parts.push(outputBuffer);
    }
  }

  throwIfConverterAborted(signal);
  const blob = new Blob(parts, { type: "audio/wav" });
  if (blob.size !== outputBytes) throw new Error("La longitud del WAV procesado no coincide con el tamaño calculado.");
  const wavInfo = await validatePcm16WavBlob(blob, {
    channels: outputChannels,
    sampleRate: layout.sampleRate
  });
  return {
    blob,
    duration: wavInfo.duration,
    sampleRate: wavInfo.sampleRate,
    channels: wavInfo.channels,
    sourceChannels: layout.sourceChannels,
    wavInfo,
    streaming: true,
    conversionPath: "chunked-pcm16-wav"
  };
}

export async function convertAudioFileToWav(file, audioContext, {
  channels = 2,
  durationProbe = probeAudioFileDuration,
  maxOutputBytes = MAX_CONVERTER_OUTPUT_BYTES,
  signal
} = {}) {
  if (!file || !Number.isFinite(file.size) || file.size <= 0) throw new Error("El archivo está vacío o no se puede leer.");
  if (file.size > MAX_CONVERTER_INPUT_BYTES) throw new Error("El archivo supera el límite de 50 MiB por conversión.");
  throwIfConverterAborted(signal);
  const wavLayout = await inspectStreamablePcm16Wav(file, signal);
  const outputChannels = safeChannels(channels);
  if (wavLayout && Number(audioContext?.sampleRate) === wavLayout.sampleRate) {
    const outputLimit = Number.isFinite(maxOutputBytes)
      ? Math.max(0, Math.min(MAX_CONVERTER_OUTPUT_BYTES, Math.floor(maxOutputBytes)))
      : MAX_CONVERTER_OUTPUT_BYTES;
    if (wavLayout.duration > MAX_CONVERTER_DURATION_SECONDS) {
      throw new Error("La pista supera el límite de 7 minutos para evitar agotar la memoria del dispositivo.");
    }
    return await convertPcm16WavInChunks(file, wavLayout, outputChannels, outputLimit, signal);
  }

  if (!audioContext || typeof audioContext.decodeAudioData !== "function") throw new Error("Este navegador no ofrece un decodificador de audio compatible.");
  if (typeof durationProbe !== "function") throw new TypeError("No hay un comprobador de duración disponible.");

  let durationBeforeDecode;
  try {
    durationBeforeDecode = await durationProbe(file, { signal });
  } catch (error) {
    throwIfConverterAborted(signal);
    throw error;
  }
  throwIfConverterAborted(signal);
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
    throwIfConverterAborted(signal);
    const compressedData = await file.arrayBuffer();
    throwIfConverterAborted(signal);
    decoded = await audioContext.decodeAudioData(compressedData);
  } catch (error) {
    throwIfConverterAborted(signal);
    throw new Error("El navegador no pudo decodificar este formato. Probá con un archivo que pueda reproducir en Ritmo.");
  }
  // decodeAudioData() itself cannot be interrupted; if cancellation happened
  // during decode, discard the buffer before allocating the final WAV.
  throwIfConverterAborted(signal);
  if (!decoded || !Number.isFinite(decoded.duration) || decoded.duration <= 0) throw new Error("El archivo decodificado no contiene una duración válida.");
  // Keep a post-decode guard as a defense against inaccurate or malformed metadata.
  if (decoded.duration > MAX_CONVERTER_DURATION_SECONDS) throw new Error("La pista supera el límite de 7 minutos para evitar agotar la memoria del dispositivo.");
  if (!Number.isInteger(decoded.length) || decoded.length < 1 ||
      !Number.isInteger(decoded.numberOfChannels) || decoded.numberOfChannels < 1 ||
      !Number.isFinite(decoded.sampleRate) || decoded.sampleRate < 8000) {
    throw new Error("El decodificador devolvió muestras o metadatos de audio no válidos.");
  }
  const decodedBytes = decoded.length * decoded.numberOfChannels * 4;
  if (!Number.isSafeInteger(decodedBytes) || decodedBytes > MAX_CONVERTER_DECODED_BYTES) {
    throw new Error("El audio decodificado necesita demasiada memoria para convertirlo de forma segura en este dispositivo.");
  }

  // Duration metadata can be imperfect. Recalculate the exact PCM output size
  // from the decoded frame count before allocating the potentially large WAV.
  const actualOutputBytes = 44 + decoded.length * outputChannels * 2;
  if (!Number.isSafeInteger(actualOutputBytes) || actualOutputBytes > outputLimit) {
    throw new Error("El WAV real supera el espacio restante para resultados; se rechazó antes de reservar el archivo de salida.");
  }

  const blob = encodePcm16Wav(decoded, outputChannels);
  if (blob.size > outputLimit) throw new Error("El WAV resultante supera el límite de espacio disponible para resultados.");
  const wavInfo = await validatePcm16WavBlob(blob, {
    channels: outputChannels,
    sampleRate: decoded.sampleRate
  });
  return {
    blob,
    duration: wavInfo.duration,
    sampleRate: wavInfo.sampleRate,
    channels: wavInfo.channels,
    sourceChannels: decoded.numberOfChannels,
    wavInfo
  };
}
