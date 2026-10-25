export const RITMO_BACKUP_FORMAT = "ritmo-library-backup";
export const RITMO_BACKUP_VERSION = 1;
export const MAX_BACKUP_FILE_BYTES = 40 * 1024 * 1024;
export const MAX_BACKUP_AUDIO_BYTES = 18 * 1024 * 1024;
export const MAX_BACKUP_AUXILIARY_BYTES = 10 * 1024 * 1024;
export const MAX_BACKUP_TRACKS = 25000;
export const MAX_BACKUP_HISTORY = 5000;
export const MAX_BACKUP_PLAYLISTS = 5000;
export const MAX_BACKUP_SETTINGS = 500;
export const MAX_BACKUP_PREFERENCES = 200;
const MAX_BACKUP_NESTING_DEPTH = 40;
const MAX_BACKUP_ARRAY_ITEMS = 100000;
const BLOB_MARKER = "__ritmoBackupBlobV1";
const SENSITIVE_KEY = /token|api.?key|secret|password|credential|authorization|oauth/i;
const SAFE_PREFERENCE_KEY = /^ritmo\.[a-z0-9._-]{1,120}$/i;
const OMIT = Symbol("omit");

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Reserve space for the small outer backup envelope and stop while encoding,
// before JSON.stringify can allocate another full-size copy of an oversized backup.
const BACKUP_JSON_ENVELOPE_RESERVE_BYTES = 512;

function jsonStringUtf8ByteLength(value) {
  let bytes = 2; // opening and closing quotes
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code === 0x22 || code === 0x5c || code === 0x08 || code === 0x09 ||
        code === 0x0a || code === 0x0c || code === 0x0d) {
      bytes += 2; // JSON short escape
    } else if (code < 0x20) {
      bytes += 6; // \\u00XX
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index++;
      } else {
        bytes += 6; // JSON escapes an unpaired surrogate
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      bytes += 6;
    } else if (code < 0x80) {
      bytes++;
    } else if (code < 0x800) {
      bytes += 2;
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

function jsonValueUtf8ByteLength(value) {
  if (typeof value === "string") return jsonStringUtf8ByteLength(value);
  if (value === null) return 4;
  if (typeof value === "boolean") return value ? 4 : 5;
  if (typeof value === "number") return Number.isFinite(value) ? String(value).length : 4;
  if (Array.isArray(value)) {
    let bytes = 2;
    for (let index = 0; index < value.length; index++) {
      if (index) bytes++;
      bytes += value[index] === undefined ? 4 : jsonValueUtf8ByteLength(value[index]);
    }
    return bytes;
  }
  if (isRecord(value)) {
    let bytes = 2, entries = 0;
    for (const [key, child] of Object.entries(value)) {
      if (child === undefined || typeof child === "function" || typeof child === "symbol") continue;
      if (entries++) bytes++;
      bytes += jsonStringUtf8ByteLength(key) + 1 + jsonValueUtf8ByteLength(child);
    }
    return bytes;
  }
  return 4;
}

function accountBackupJsonBytes(budget, bytes) {
  budget.serializedBytes += bytes;
  if (budget.serializedBytes + BACKUP_JSON_ENVELOPE_RESERVE_BYTES > MAX_BACKUP_FILE_BYTES) {
    throw new Error("El contenido del respaldo superaría 40 MiB. Exportá sin incluir audio o reducí los adjuntos para crear una copia más liviana.");
  }
}

function safePreferenceEntries(preferences) {
  const entries = Array.isArray(preferences)
    ? preferences.map(item => [item?.key, item?.value])
    : Object.entries(isRecord(preferences) ? preferences : {});
  return entries
    .filter(([key, value]) => typeof key === "string" && SAFE_PREFERENCE_KEY.test(key) &&
      !SENSITIVE_KEY.test(key) && typeof value === "string" && value.length <= 200000)
    .slice(0, MAX_BACKUP_PREFERENCES)
    .map(([key, value]) => ({ key, value }));
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)));
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  if (typeof value !== "string" || value.length > Math.ceil(MAX_BACKUP_FILE_BYTES / 4) * 4 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error("La copia contiene un archivo adjunto inválido.");
  }
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function isTrackAudioBlob(path) {
  return path.length === 3 && path[0] === "tracks" && path[2] === "blob";
}

function isTrackArtworkBlob(path) {
  return path.length === 3 && path[0] === "tracks" && path[2] === "artworkBlob";
}

async function encodeValue(value, path, budget, includeAudio, depth = 0) {
  if (depth > MAX_BACKUP_NESTING_DEPTH) {
    throw new Error("Los datos de la biblioteca están demasiado anidados para crear una copia segura.");
  }
  if (value instanceof Blob) {
    const audioBlob = isTrackAudioBlob(path);
    const artworkBlob = isTrackArtworkBlob(path);
    if (audioBlob && !includeAudio) return OMIT;
    if (audioBlob) {
      if (budget.audioBytes + value.size > MAX_BACKUP_AUDIO_BYTES) {
        throw new Error("El audio seleccionado para la copia supera 18 MiB. Desmarcá «Incluir archivos de audio» para crear un respaldo liviano de la biblioteca y sus listas.");
      }
      budget.audioBytes += value.size;
    } else {
      // Artwork is helpful but optional. Leave out excess covers rather than
      // making an otherwise valid metadata backup fail on a large library.
      if (artworkBlob && budget.auxiliaryBytes + value.size > MAX_BACKUP_AUXILIARY_BYTES) {
        budget.omittedArtwork += 1;
        return OMIT;
      }
      if (!artworkBlob && value.size > 8 * 1024 * 1024) {
        throw new Error("Un archivo adjunto de la configuración supera 8 MiB. Reducilo y volvé a crear la copia.");
      }
      if (budget.auxiliaryBytes + value.size > MAX_BACKUP_AUXILIARY_BYTES) {
        throw new Error("Las imágenes y adjuntos de la copia superan 10 MiB. Quitá o reducí adjuntos personalizados y volvé a intentarlo.");
      }
      budget.auxiliaryBytes += value.size;
    }
    const bytes = new Uint8Array(await value.arrayBuffer());
    const encodedBlob = {
      [BLOB_MARKER]: true,
      type: String(value.type || "application/octet-stream").slice(0, 180),
      size: bytes.byteLength,
      data: bytesToBase64(bytes)
    };
    accountBackupJsonBytes(budget, jsonValueUtf8ByteLength(encodedBlob));
    return encodedBlob;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_BACKUP_ARRAY_ITEMS) {
      throw new Error("Una lista de la biblioteca es demasiado extensa para crear una copia segura.");
    }
    accountBackupJsonBytes(budget, 2); // brackets
    const result = [];
    for (let index = 0; index < value.length; index++) {
      const item = await encodeValue(value[index], [...path, index], budget, includeAudio, depth + 1);
      if (index > 0) accountBackupJsonBytes(budget, 1); // comma
      if (item === OMIT || item === undefined) {
        accountBackupJsonBytes(budget, 4); // JSON encodes omitted array entries as null
        result.push(null);
      } else {
        result.push(item);
      }
    }
    return result;
  }
  if (isRecord(value)) {
    accountBackupJsonBytes(budget, 2); // braces
    const result = {};
    let includedEntries = 0;
    for (const [key, child] of Object.entries(value)) {
      if (key === "__proto__" || key === "prototype" || key === "constructor") continue;
      if (path[0] === "tracks" && path.length === 2 && (key === "nativePath" || key === "nativeUri")) {
        continue;
      }
      const encoded = await encodeValue(child, [...path, key], budget, includeAudio, depth + 1);
      if (encoded !== OMIT && encoded !== undefined) {
        accountBackupJsonBytes(budget,
          (includedEntries > 0 ? 1 : 0) + jsonStringUtf8ByteLength(key) + 1); // comma, key and colon
        result[key] = encoded;
        includedEntries++;
      }
    }
    return result;
  }
  if (typeof value === "string") {
    const encoded = value.slice(0, 2_000_000);
    accountBackupJsonBytes(budget, jsonStringUtf8ByteLength(encoded));
    return encoded;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      accountBackupJsonBytes(budget, 4);
      return null;
    }
    accountBackupJsonBytes(budget, String(value).length);
    return value;
  }
  if (typeof value === "boolean") {
    accountBackupJsonBytes(budget, value ? 4 : 5);
    return value;
  }
  if (value === null) {
    accountBackupJsonBytes(budget, 4);
    return null;
  }
  return undefined;
}

async function decodeValue(value, path, budget, depth = 0) {
  if (depth > 40) throw new Error("La copia tiene demasiados niveles de datos.");
  if (Array.isArray(value)) {
    if (value.length > 100000) throw new Error("La copia incluye una lista demasiado extensa.");
    const result = [];
    for (let index = 0; index < value.length; index++) {
      result.push(await decodeValue(value[index], [...path, index], budget, depth + 1));
    }
    return result;
  }
  if (!isRecord(value)) return value;
  if (value[BLOB_MARKER] === true) {
    const bytes = base64ToBytes(value.data);
    const expectedSize = Number(value.size);
    const audioBlob = isTrackAudioBlob(path);
    if (!Number.isSafeInteger(expectedSize) || expectedSize < 0 || expectedSize !== bytes.byteLength) {
      throw new Error("La copia contiene un adjunto incompleto o alterado.");
    }
    if (audioBlob) {
      budget.audioBytes += bytes.byteLength;
      if (budget.audioBytes > MAX_BACKUP_AUDIO_BYTES) throw new Error("El audio de la copia supera el límite permitido.");
    } else {
      budget.auxiliaryBytes += bytes.byteLength;
      if (budget.auxiliaryBytes > MAX_BACKUP_AUXILIARY_BYTES) throw new Error("Los adjuntos de la copia superan el límite permitido.");
    }
    const mimeType = typeof value.type === "string" && /^[\w.+-]+\/[\w.+-]+$/i.test(value.type)
      ? value.type.slice(0, 180)
      : "application/octet-stream";
    return new Blob([bytes], { type: mimeType });
  }
  const result = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === "__proto__" || key === "prototype" || key === "constructor") continue;
    result[key] = await decodeValue(child, [...path, key], budget, depth + 1);
  }
  return result;
}

function safeTrackForBackup(track, includeAudio) {
  const copy = { ...track };
  delete copy.nativePath;
  delete copy.nativeUri;
  const hasAudioBlob = track?.blob instanceof Blob;
  if (track?.kind === "file" && (!includeAudio || !hasAudioBlob)) copy.audioMissingInBackup = true;
  else if (includeAudio && hasAudioBlob) delete copy.audioMissingInBackup;
  return copy;
}

export async function createRitmoBackup({
  tracks = [], history = [], playlists = [], settings = [], preferences = [],
  includeAudio = false, now = Date.now()
} = {}) {
  if (tracks.length > MAX_BACKUP_TRACKS) throw new Error("La biblioteca supera el límite de 25.000 pistas por copia.");
  if (history.length > MAX_BACKUP_HISTORY) throw new Error("El historial supera el límite de 5.000 entradas por copia.");
  if (playlists.length > MAX_BACKUP_PLAYLISTS) throw new Error("Hay demasiadas listas para una sola copia.");
  if (settings.length > MAX_BACKUP_SETTINGS) throw new Error("Hay demasiados ajustes guardados para una sola copia.");
  const safeSettings = asArray(settings).filter(item => typeof item?.key === "string" && !SENSITIVE_KEY.test(item.key));
  const budget = { audioBytes: 0, auxiliaryBytes: 0, omittedArtwork: 0, serializedBytes: 0 };
  // Encode settings first so Pibara's custom image is reserved before optional artwork.
  const source = {
    settings: safeSettings,
    tracks: asArray(tracks).map(track => safeTrackForBackup(track, includeAudio)),
    history: asArray(history).slice(0, MAX_BACKUP_HISTORY),
    playlists: asArray(playlists),
    preferences: safePreferenceEntries(preferences)
  };
  const encoded = await encodeValue(source, [], budget, Boolean(includeAudio));
  if (!includeAudio) {
    for (let index = 0; index < encoded.tracks.length; index++) {
      const track = encoded.tracks[index];
      if (track?.audioMissingInBackup === true) {
        delete track.blob;
      }
    }
  }
  const document = {
    format: RITMO_BACKUP_FORMAT,
    version: RITMO_BACKUP_VERSION,
    createdAt: new Date(Number.isFinite(Number(now)) ? Number(now) : Date.now()).toISOString(),
    includesAudio: Boolean(includeAudio),
    counts: {
      tracks: encoded.tracks.length,
      history: encoded.history.length,
      playlists: encoded.playlists.length,
      settings: encoded.settings.length,
      preferences: encoded.preferences.length,
      omittedArtwork: budget.omittedArtwork
    },
    data: encoded
  };
  // This incremental estimate reserves the envelope before constructing the
  // final JSON string; the Blob-size check remains the exact final authority.
  accountBackupJsonBytes(budget, 0);
  const json = JSON.stringify(document);
  const outputBytes = new Blob([json]).size;
  if (outputBytes > MAX_BACKUP_FILE_BYTES) {
    throw new Error("El archivo de respaldo superaría 40 MiB. Exportá sin incluir audio para generar una copia más liviana.");
  }
  const day = document.createdAt.slice(0, 10);
  return {
    json,
    filename: "ritmo-respaldo-" + day + ".json",
    stats: {
      ...document.counts,
      includesAudio: document.includesAudio,
      audioBytes: budget.audioBytes,
      auxiliaryBytes: budget.auxiliaryBytes,
      bytes: outputBytes
    }
  };
}

export async function parseRitmoBackup(json) {
  if (typeof json !== "string" || !json.trim()) throw new Error("El archivo de respaldo está vacío.");
  if (json.length > MAX_BACKUP_FILE_BYTES) throw new Error("El archivo de respaldo supera 40 MiB y fue rechazado antes de importarse.");
  let document;
  try { document = JSON.parse(json); }
  catch { throw new Error("El archivo no contiene JSON válido. No se modificó la biblioteca."); }
  if (!isRecord(document) || document.format !== RITMO_BACKUP_FORMAT) {
    throw new Error("Este archivo no es un respaldo reconocido de Ritmo.");
  }
  if (document.version !== RITMO_BACKUP_VERSION) {
    throw new Error("La versión de este respaldo no es compatible con esta versión de Ritmo.");
  }
  if (!isRecord(document.data)) throw new Error("El respaldo no contiene datos de biblioteca válidos.");
  const data = document.data;
  const tracks = asArray(data.tracks);
  const history = asArray(data.history);
  const playlists = asArray(data.playlists);
  const settings = asArray(data.settings);
  const preferences = asArray(data.preferences);
  if (tracks.length > MAX_BACKUP_TRACKS || history.length > MAX_BACKUP_HISTORY ||
      playlists.length > MAX_BACKUP_PLAYLISTS || settings.length > MAX_BACKUP_SETTINGS ||
      preferences.length > MAX_BACKUP_PREFERENCES) {
    throw new Error("El respaldo supera el máximo de registros que Ritmo admite importar.");
  }
  for (const [records, label] of [[tracks, "pistas"], [history, "historial"], [playlists, "listas"]]) {
    if (!records.every(item => isRecord(item) && (typeof item.id === "string" || typeof item.id === "number") && String(item.id).length > 0)) {
      throw new Error("El respaldo contiene registros de " + label + " sin identificador válido.");
    }
  }
  if (!settings.every(item => isRecord(item) && typeof item.key === "string" && item.key.trim() && item.key.length <= 200)) {
    throw new Error("El respaldo contiene ajustes sin clave válida.");
  }
  if (!preferences.every(item => isRecord(item) && typeof item.key === "string" && typeof item.value === "string")) {
    throw new Error("El respaldo contiene preferencias inválidas.");
  }
  const budget = { audioBytes: 0, auxiliaryBytes: 0 };
  const decoded = await decodeValue(data, [], budget);
  decoded.tracks = decoded.tracks.map(track => {
    const copy = { ...track };
    delete copy.nativePath;
    delete copy.nativeUri;
    if (copy.kind === "file" && !(copy.blob instanceof Blob)) copy.audioMissingInBackup = true;
    if (copy.kind === "url" && copy.url) {
      try {
        const url = new URL(copy.url);
        if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) {
          delete copy.url;
          copy.audioMissingInBackup = true;
        }
      } catch {
        delete copy.url;
        copy.audioMissingInBackup = true;
      }
    }
    return copy;
  });
  decoded.settings = decoded.settings.filter(item => !SENSITIVE_KEY.test(item.key));
  decoded.preferences = safePreferenceEntries(decoded.preferences);
  return {
    format: RITMO_BACKUP_FORMAT,
    version: RITMO_BACKUP_VERSION,
    createdAt: typeof document.createdAt === "string" ? document.createdAt : "",
    includesAudio: document.includesAudio === true,
    tracks: decoded.tracks,
    history: decoded.history,
    playlists: decoded.playlists,
    settings: decoded.settings,
    preferences: decoded.preferences,
    stats: {
      tracks: decoded.tracks.length,
      history: decoded.history.length,
      playlists: decoded.playlists.length,
      settings: decoded.settings.length,
      preferences: decoded.preferences.length,
      audioBytes: budget.audioBytes,
      auxiliaryBytes: budget.auxiliaryBytes
    }
  };
}
