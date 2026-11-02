import path from "node:path";

export const BENCHMARK_GENRES = Object.freeze([
  "Blues",
  "Clásica",
  "Country",
  "Disco",
  "Hip-Hop",
  "Jazz",
  "Metal",
  "Pop",
  "Reggae",
  "Rock"
]);

const GENRE_ALIASES = new Map([
  ["blues", "Blues"],
  ["classical", "Clásica"],
  ["clasica", "Clásica"],
  ["country", "Country"],
  ["disco", "Disco"],
  ["hiphop", "Hip-Hop"],
  ["hip hop", "Hip-Hop"],
  ["jazz", "Jazz"],
  ["metal", "Metal"],
  ["pop", "Pop"],
  ["reggae", "Reggae"],
  ["rock", "Rock"]
]);

const RIGHTS_BASES = new Set(["owned", "creative-commons", "permission"]);
const MAX_TRACKS = 5000;

export function normalizeBenchmarkGenre(value) {
  const key = String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return GENRE_ALIASES.get(key) || null;
}

export function validateBenchmarkManifest(manifest) {
  const errors = [];
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return ["El manifiesto debe ser un objeto JSON."];
  }
  if (manifest.schemaVersion !== 1) errors.push("schemaVersion debe ser 1.");
  if (typeof manifest.datasetName !== "string" || !manifest.datasetName.trim()) {
    errors.push("datasetName es obligatorio.");
  }
  if (!["validation", "test"].includes(manifest.split)) {
    errors.push("split debe ser validation o test; no mezcles pistas usadas para ajustar un modelo con el conjunto final.");
  }
  if (!Array.isArray(manifest.tracks) || manifest.tracks.length === 0) {
    errors.push("tracks debe contener al menos una pista.");
    return errors;
  }
  if (manifest.tracks.length > MAX_TRACKS) errors.push(`El máximo es ${MAX_TRACKS} pistas por ejecución.`);

  const ids = new Set();
  const files = new Set();
  for (const [index, track] of manifest.tracks.entries()) {
    const prefix = `tracks[${index}]`;
    if (!track || typeof track !== "object" || Array.isArray(track)) {
      errors.push(`${prefix} debe ser un objeto.`);
      continue;
    }
    const id = typeof track.id === "string" ? track.id.trim() : "";
    if (!id) errors.push(`${prefix}.id es obligatorio.`);
    else if (ids.has(id)) errors.push(`ID duplicado: ${id}.`);
    else ids.add(id);

    const file = typeof track.file === "string" ? track.file.trim() : "";
    if (!file) errors.push(`${prefix}.file es obligatorio.`);
    else if (path.isAbsolute(file) || file.includes("\\") ||
      file.split("/").some(part => part === ".." || part === "." || part === "")) {
      errors.push(`${prefix}.file debe ser una ruta WAV relativa, sin segmentos . o ...`);
    } else if (!file.toLowerCase().endsWith(".wav")) {
      errors.push(`${prefix}.file debe apuntar a un WAV PCM de 16 bits.`);
    } else if (files.has(file.toLowerCase())) {
      errors.push(`Archivo repetido en el manifiesto: ${file}.`);
    } else files.add(file.toLowerCase());

    if (!normalizeBenchmarkGenre(track.expectedGenre)) {
      errors.push(`${prefix}.expectedGenre no pertenece a las diez categorías del modelo actual.`);
    }

    if (typeof track.artistKey !== "string" || !track.artistKey.trim()) {
      errors.push(`${prefix}.artistKey es obligatorio para detectar posibles fugas entre artistas.`);
    }

    const rights = track.rights;
    if (!rights || typeof rights !== "object" || !RIGHTS_BASES.has(rights.basis)) {
      errors.push(`${prefix}.rights.basis debe ser owned, creative-commons o permission.`);
    } else {
      if (typeof rights.reference !== "string" || !rights.reference.trim()) {
        errors.push(`${prefix}.rights.reference debe explicar la procedencia o autorización.`);
      }
      if (rights.basis === "creative-commons" &&
          (typeof rights.license !== "string" || !rights.license.trim())) {
        errors.push(`${prefix}.rights.license es obligatorio para Creative Commons.`);
      }
    }
  }
  return errors;
}

export function resolveManifestTrackPath(manifestDirectory, relativeFile) {
  if (typeof relativeFile !== "string" || !relativeFile.trim() ||
      path.isAbsolute(relativeFile) || relativeFile.includes("\\\\") ||
      relativeFile.split("/").some(part => part === ".." || part === "." || part === "")) {
    throw new TypeError("La ruta de audio debe ser relativa al manifiesto y no puede salir de su carpeta.");
  }
  const root = path.resolve(manifestDirectory);
  const resolved = path.resolve(root, relativeFile);
  const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new TypeError("La ruta de audio queda fuera de la carpeta del manifiesto.");
  }
  return resolved;
}

/** Parse uncompressed, little-endian PCM16 WAV without third-party codecs. */
export function parsePcm16Wav(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 44 ||
      buffer.toString("ascii", 0, 4) !== "RIFF" ||
      buffer.toString("ascii", 8, 12) !== "WAVE") {
    throw new TypeError("El archivo no es un WAV RIFF válido.");
  }

  let offset = 12;
  let format = null;
  let channels = null;
  let sampleRate = null;
  let bitsPerSample = null;
  let blockAlign = null;
  let dataStart = -1;
  let dataSize = 0;

  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkSize;
    if (chunkEnd > buffer.length) throw new TypeError("El WAV contiene un bloque truncado.");

    if (chunkId === "fmt ") {
      if (chunkSize < 16) throw new TypeError("El encabezado fmt del WAV está incompleto.");
      format = buffer.readUInt16LE(chunkStart);
      channels = buffer.readUInt16LE(chunkStart + 2);
      sampleRate = buffer.readUInt32LE(chunkStart + 4);
      blockAlign = buffer.readUInt16LE(chunkStart + 12);
      bitsPerSample = buffer.readUInt16LE(chunkStart + 14);
    } else if (chunkId === "data" && dataStart < 0) {
      dataStart = chunkStart;
      dataSize = chunkSize;
    }
    offset = chunkEnd + (chunkSize % 2);
  }

  if (format !== 1 || bitsPerSample !== 16) {
    throw new TypeError("El benchmark acepta únicamente WAV PCM entero de 16 bits; convertí el archivo con Ritmo y elegí PCM16.");
  }
  if (![1, 2].includes(channels)) throw new TypeError("El benchmark acepta WAV mono o estéreo.");
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 96000) {
    throw new TypeError("La frecuencia del WAV debe estar entre 8 y 96 kHz.");
  }
  if (blockAlign !== channels * 2 || dataStart < 0 || dataSize <= 0 || dataSize % blockAlign !== 0) {
    throw new TypeError("El bloque de audio WAV no tiene una alineación PCM16 válida.");
  }

  const frameCount = dataSize / blockAlign;
  const channelData = Array.from({ length: channels }, () => new Float32Array(frameCount));
  for (let frame = 0; frame < frameCount; frame++) {
    for (let channel = 0; channel < channels; channel++) {
      const byteOffset = dataStart + frame * blockAlign + channel * 2;
      channelData[channel][frame] = buffer.readInt16LE(byteOffset) / 32768;
    }
  }

  return {
    sampleRate,
    length: frameCount,
    numberOfChannels: channels,
    duration: frameCount / sampleRate,
    getChannelData(channel) {
      if (!Number.isInteger(channel) || channel < 0 || channel >= channels) {
        throw new RangeError("Canal WAV fuera de rango.");
      }
      return channelData[channel];
    }
  };
}

export function calculateGenreMetrics(trackResults, labels = BENCHMARK_GENRES) {
  const classes = [...labels];
  const unclassified = "Sin clasificación";
  const columns = [...classes, unclassified];
  const confusion = Object.fromEntries(classes.map(label => [
    label,
    Object.fromEntries(columns.map(column => [column, 0]))
  ]));

  let correct = 0;
  let top3Correct = 0;
  const multiSegment = [];
  const segmentCountTotal = trackResults.reduce((total, item) => total + (Number(item.segmentCount) || 0), 0);

  for (const result of trackResults) {
    const expected = normalizeBenchmarkGenre(result.expectedGenre);
    const predicted = normalizeBenchmarkGenre(result.predictedGenre) || unclassified;
    if (!expected || !confusion[expected]) continue;
    confusion[expected][predicted] = (confusion[expected][predicted] || 0) + 1;
    if (predicted === expected) correct++;
    const top3 = Array.isArray(result.top3)
      ? result.top3.map(normalizeBenchmarkGenre).filter(Boolean)
      : [];
    if (top3.includes(expected)) top3Correct++;
    if ((Number(result.segmentCount) || 0) > 1) {
      multiSegment.push(result.segmentTop1?.length > 0 &&
        result.segmentTop1.every(label => normalizeBenchmarkGenre(label) === normalizeBenchmarkGenre(result.segmentTop1[0])));
    }
  }

  const supportTotal = trackResults.filter(item => normalizeBenchmarkGenre(item.expectedGenre)).length;
  const perClass = {};
  const supportedF1 = [];
  const supportedRecall = [];

  for (const label of classes) {
    const support = confusion[label][label] +
      columns.filter(column => column !== label).reduce((sum, column) => sum + confusion[label][column], 0);
    const truePositive = confusion[label][label];
    const falsePositive = classes.reduce((sum, actual) =>
      sum + (actual === label ? 0 : confusion[actual][label] || 0), 0);
    const predictedCount = classes.reduce((sum, actual) =>
      sum + (confusion[actual][label] || 0), 0);

    const precision = predictedCount > 0 ? truePositive / predictedCount : null;
    const recall = support > 0 ? truePositive / support : null;
    const f1 = precision === null
      ? (support > 0 ? 0 : null)
      : (precision + (recall || 0) > 0 ? 2 * precision * (recall || 0) / (precision + (recall || 0)) : 0);

    perClass[label] = {
      support,
      predicted: predictedCount,
      precision,
      recall,
      f1,
      falsePositives: falsePositive
    };
    if (support > 0) {
      supportedF1.push(f1 ?? 0);
      supportedRecall.push(recall ?? 0);
    }
  }

  const stableRate = multiSegment.length
    ? multiSegment.filter(Boolean).length / multiSegment.length
    : null;

  return {
    sampleCount: supportTotal,
    correct,
    accuracy: supportTotal ? correct / supportTotal : null,
    top3Accuracy: supportTotal ? top3Correct / supportTotal : null,
    macroF1PresentClasses: supportedF1.length
      ? supportedF1.reduce((sum, value) => sum + value, 0) / supportedF1.length
      : null,
    macroRecallPresentClasses: supportedRecall.length
      ? supportedRecall.reduce((sum, value) => sum + value, 0) / supportedRecall.length
      : null,
    classesWithoutSupport: classes.filter(label => perClass[label].support === 0),
    perClass,
    confusionMatrix: { rows: classes, columns, values: confusion },
    averageSegmentsPerTrack: trackResults.length ? segmentCountTotal / trackResults.length : null,
    multiSegmentTrackCount: multiSegment.length,
    multiSegmentStableTop1Rate: stableRate
  };
}

export function percentile(values, fraction) {
  const sorted = values.filter(value => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const position = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[position];
}
