import { normalizeId3Genre } from "./music-genres.js";

export const MAX_WAV_METADATA_BYTES = 2 * 1024 * 1024;
export const MAX_WAV_INFO_CHUNKS = 4096;

const INFO_FIELDS = Object.freeze({
  INAM: "title",
  IART: "artist",
  IPRD: "album",
  IGNR: "genre"
});

function asBytes(input) {
  if (input instanceof Uint8Array) return input.subarray(0, MAX_WAV_METADATA_BYTES);
  if (input instanceof ArrayBuffer) return new Uint8Array(input, 0, Math.min(input.byteLength, MAX_WAV_METADATA_BYTES));
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, Math.min(input.byteLength, MAX_WAV_METADATA_BYTES));
  return null;
}
function readUint32LE(bytes, offset) {
  if (offset < 0 || offset + 4 > bytes.length) return -1;
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}
function asciiAt(bytes, offset, value) {
  if (offset < 0 || offset + value.length > bytes.length) return false;
  for (let index = 0; index < value.length; index++) if (bytes[offset + index] !== value.charCodeAt(index)) return false;
  return true;
}
function asciiText(bytes, offset, length) {
  let value = "";
  for (let index = 0; index < length && offset + index < bytes.length; index++) value += String.fromCharCode(bytes[offset + index]);
  return value;
}
function decodeInfoValue(bytes) {
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch {
    try { text = new TextDecoder("windows-1252").decode(bytes); }
    catch { return ""; }
  }
  return text.replace(/\u0000+$/g, "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ").trim().slice(0, 256);
}
function mergeFoundMetadata(fallback, found) {
  return Object.keys(found).length ? { ...fallback, ...found } : { ...fallback };
}
function parseInfoPayload(payload, found) {
  let offset = 0, chunks = 0;
  while (offset + 8 <= payload.length && chunks < MAX_WAV_INFO_CHUNKS) {
    chunks++;
    const id = asciiText(payload, offset, 4);
    const size = readUint32LE(payload, offset + 4);
    if (size < 0) break;
    const dataStart = offset + 8, declaredEnd = dataStart + size;
    if (!Number.isSafeInteger(declaredEnd) || declaredEnd > payload.length) break;
    const field = INFO_FIELDS[id];
    if (field && !found[field] && size > 0) {
      const value = decodeInfoValue(payload.subarray(dataStart, declaredEnd));
      const normalized = field === "genre" ? normalizeId3Genre(value) : value;
      // Do not replace fallback metadata with an unsupported numeric genre code.
      if (normalized) found[field] = normalized;
    }
    const next = declaredEnd + (size & 1);
    if (next <= offset || next > payload.length) break;
    offset = next;
  }
}
function parseListChunk(data, declaredSize, found) {
  if (declaredSize < 4 || data.length < 4 || !asciiAt(data, 0, "INFO")) return;
  parseInfoPayload(data.subarray(4), found);
}

/** Parse a RIFF/WAVE byte array or bounded prefix. For File inputs prefer readWavInfoMetadata. */
export function parseWavInfoComments(input, fallback = {}) {
  const bytes = asBytes(input);
  if (!bytes || bytes.length < 12 || !asciiAt(bytes, 0, "RIFF") || !asciiAt(bytes, 8, "WAVE")) return { ...fallback };
  const riffSize = readUint32LE(bytes, 4);
  if (riffSize < 4) return { ...fallback };
  const riffEnd = Math.min(bytes.length, riffSize + 8);
  if (riffEnd < 12) return { ...fallback };
  const found = {};
  let offset = 12, chunks = 0;
  while (offset + 8 <= riffEnd && chunks < MAX_WAV_INFO_CHUNKS) {
    chunks++;
    const id = asciiText(bytes, offset, 4);
    const chunkSize = readUint32LE(bytes, offset + 4);
    if (chunkSize < 0) break;
    const dataStart = offset + 8, declaredEnd = dataStart + chunkSize;
    if (!Number.isSafeInteger(declaredEnd)) break;
    const availableEnd = Math.min(declaredEnd, riffEnd);
    if (id === "LIST" && chunkSize >= 4) parseListChunk(bytes.subarray(dataStart, availableEnd), chunkSize, found);
    if (declaredEnd > riffEnd) break;
    const next = declaredEnd + (chunkSize & 1);
    if (next <= offset || next > riffEnd) break;
    offset = next;
  }
  return mergeFoundMetadata(fallback, found);
}
export function isWavMetadataFilename(filename) {
  return /\.(?:wav|wave)$/i.test(String(filename || ""));
}

/** Read only RIFF chunk headers and bounded LIST/INFO payloads; large sample chunks are skipped by offset. */
export async function readWavInfoMetadata(file, fallback = {}) {
  if (!file || typeof file.slice !== "function" || !Number.isSafeInteger(Number(file.size)) || Number(file.size) < 12) return { ...fallback };
  try {
    const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    if (header.length < 12 || !asciiAt(header, 0, "RIFF") || !asciiAt(header, 8, "WAVE")) return { ...fallback };
    const riffSize = readUint32LE(header, 4);
    if (riffSize < 4) return { ...fallback };
    const riffEnd = Math.min(Number(file.size), riffSize + 8);
    if (riffEnd < 12) return { ...fallback };
    const found = {};
    let offset = 12, chunks = 0, metadataBytesRead = 12;
    while (offset + 8 <= riffEnd && chunks < MAX_WAV_INFO_CHUNKS) {
      // The 2 MiB budget covers every byte read, including RIFF chunk headers,
      // not only LIST/INFO payloads. Stop before requesting bytes beyond it.
      if (metadataBytesRead + 8 > MAX_WAV_METADATA_BYTES) break;
      chunks++;
      const chunkHeader = new Uint8Array(await file.slice(offset, offset + 8).arrayBuffer());
      metadataBytesRead += chunkHeader.byteLength;
      if (chunkHeader.length !== 8) break;
      const id = asciiText(chunkHeader, 0, 4);
      const chunkSize = readUint32LE(chunkHeader, 4);
      if (chunkSize < 0) break;
      const dataStart = offset + 8, declaredEnd = dataStart + chunkSize;
      if (!Number.isSafeInteger(declaredEnd)) break;
      if (id === "LIST" && chunkSize >= 4) {
        const remainingBudget = MAX_WAV_METADATA_BYTES - metadataBytesRead;
        if (remainingBudget <= 0) break;
        const availableChunkBytes = Math.max(0, Math.min(chunkSize, riffEnd - dataStart));
        const readLength = Math.min(availableChunkBytes, remainingBudget);
        if (readLength >= 4) {
          const listPayload = new Uint8Array(await file.slice(dataStart, dataStart + readLength).arrayBuffer());
          metadataBytesRead += listPayload.byteLength;
          parseListChunk(listPayload, chunkSize, found);
        }
      }
      if (declaredEnd > riffEnd) break;
      const next = declaredEnd + (chunkSize & 1);
      if (next <= offset || next > riffEnd) break;
      offset = next;
    }
    return mergeFoundMetadata(fallback, found);
  } catch {
    // Metadata is optional: a filesystem/Blob read failure must not block import or playback.
    return { ...fallback };
  }
}
