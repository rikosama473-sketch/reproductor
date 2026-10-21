const TEXT_FRAMES = Object.freeze({
  TIT2: "title", TPE1: "artist", TALB: "album", TCON: "genre",
  TT2: "title", TP1: "artist", TAL: "album", TCO: "genre"
});

function synchsafe(bytes, offset) {
  const a = bytes[offset], b = bytes[offset + 1], c = bytes[offset + 2], d = bytes[offset + 3];
  if ([a, b, c, d].some(value => value === undefined || (value & 0x80))) return -1;
  return (a << 21) | (b << 14) | (c << 7) | d;
}
function bigEndian(bytes, offset, length) {
  let value = 0;
  for (let index = 0; index < length; index++) value = value * 256 + bytes[offset + index];
  return value;
}
function decodeText(frame) {
  if (!frame.length) return "";
  const encoding = frame[0];
  let payload = frame.subarray(1);
  try {
    let decoder;
    if (encoding === 0) decoder = new TextDecoder("windows-1252");
    else if (encoding === 1) decoder = new TextDecoder("utf-16");
    else if (encoding === 2) decoder = new TextDecoder("utf-16be");
    else if (encoding === 3) decoder = new TextDecoder("utf-8");
    else return "";
    // Text frames may contain multiple values separated by NUL. Keep a readable
    // single-line value for the library instead of exposing control characters.
    return decoder.decode(payload).replace(/\u0000+/g, " / ").replace(/[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").replace(/(?:\s\/\s)+$/g, "").trim();
  } catch {
    return "";
  }
}
function normalizeGenre(value) {
  const raw = String(value || "").trim();
  const numeric = raw.match(/^\(?(\d{1,3})\)?$/);
  if (numeric) {
    const knownGenres = { 3: "Dance", 4: "Disco", 13: "Pop", 17: "Rock", 18: "Techno", 19: "Industrial", 20: "Alternative", 25: "Euro-Techno", 26: "Ambient", 31: "Trance", 38: "Electronic", 52: "Electronic", 80: "Folk" };
    return knownGenres[Number(numeric[1])] || "";
  }
  return raw.replace(/^\(\d+\)\s*/, "").trim();
}
function removeUnsynchronisation(bytes) {
  const result = new Uint8Array(bytes.length);
  let length = 0;
  for (let index = 0; index < bytes.length; index++) {
    result[length++] = bytes[index];
    if (bytes[index] === 0xff && bytes[index + 1] === 0x00) index++;
  }
  return result.subarray(0, length);
}

export const MAX_EMBEDDED_ARTWORK_BYTES = 512 * 1024;
export const MAX_EMBEDDED_ARTWORK_DIMENSION = 4096;
export const MAX_EMBEDDED_ARTWORK_PIXELS = 8_388_608;

function findDescriptionTerminator(bytes, start, encoding) {
  if (encoding === 1 || encoding === 2) {
    for (let index = start; index + 1 < bytes.length; index += 2) {
      if (bytes[index] === 0 && bytes[index + 1] === 0) return { end: index, next: index + 2 };
    }
    return null;
  }
  for (let index = start; index < bytes.length; index++) {
    if (bytes[index] === 0) return { end: index, next: index + 1 };
  }
  return null;
}

function dimensionsWithinArtworkBudget(width, height) {
  return Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0 &&
    width <= MAX_EMBEDDED_ARTWORK_DIMENSION && height <= MAX_EMBEDDED_ARTWORK_DIMENSION &&
    width * height <= MAX_EMBEDDED_ARTWORK_PIXELS;
}

function readBigEndian16(bytes, offset) {
  return (bytes[offset] << 8) | bytes[offset + 1];
}
function readBigEndian32(bytes, offset) {
  return bytes[offset] * 0x1000000 + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3];
}
function hasSafePngDimensions(bytes) {
  if (bytes.length < 29 || bytes[8] !== 0 || bytes[9] !== 0 || bytes[10] !== 0 || bytes[11] !== 13 ||
      String.fromCharCode(...bytes.subarray(12, 16)) !== "IHDR") return false;
  return dimensionsWithinArtworkBudget(readBigEndian32(bytes, 16), readBigEndian32(bytes, 20));
}
function hasSafeJpegDimensions(bytes) {
  if (bytes.length < 8 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return false;
  const startOfFrameMarkers = new Set([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf]);
  let offset = 2;
  while (offset + 1 < bytes.length) {
    if (bytes[offset] !== 0xff) { offset++; continue; }
    while (offset < bytes.length && bytes[offset] === 0xff) offset++;
    if (offset >= bytes.length) return false;
    const marker = bytes[offset++];
    if (marker === 0xd9 || marker === 0xda) return false; // EOI/SOS before a dimensions frame
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) return false;
    const segmentLength = readBigEndian16(bytes, offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) return false;
    if (startOfFrameMarkers.has(marker)) {
      if (segmentLength < 8) return false;
      const height = readBigEndian16(bytes, offset + 3);
      const width = readBigEndian16(bytes, offset + 5);
      return dimensionsWithinArtworkBudget(width, height);
    }
    offset += segmentLength;
  }
  return false;
}
function validPicturePayload(bytes, mimeType) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 8 || bytes.length > MAX_EMBEDDED_ARTWORK_BYTES) return false;
  if (mimeType === "image/png") {
    if (bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47 ||
        bytes[4] !== 0x0d || bytes[5] !== 0x0a || bytes[6] !== 0x1a || bytes[7] !== 0x0a) return false;
    return hasSafePngDimensions(bytes);
  }
  if (mimeType === "image/jpeg" && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return hasSafeJpegDimensions(bytes);
  }
  return false;
}

function parseAttachedPicture(frameBytes, version, unsynchronised) {
  if (!(frameBytes instanceof Uint8Array) || frameBytes.length < 6) return null;
  const bytes = unsynchronised ? removeUnsynchronisation(frameBytes) : frameBytes;
  const encoding = bytes[0];
  if (![0, 1, 2, 3].includes(encoding)) return null;

  let mimeType = "";
  let pictureTypeOffset;
  let descriptionStart;
  if (version === 2) {
    const format = String.fromCharCode(bytes[1], bytes[2], bytes[3]).toUpperCase();
    mimeType = format === "PNG" ? "image/png" : format === "JPG" ? "image/jpeg" : "";
    pictureTypeOffset = 4;
    descriptionStart = 5;
  } else {
    const mimeEnd = bytes.indexOf(0, 1);
    if (mimeEnd < 0 || mimeEnd - 1 > 64 || mimeEnd + 2 >= bytes.length) return null;
    mimeType = String.fromCharCode(...bytes.subarray(1, mimeEnd)).trim().toLowerCase();
    pictureTypeOffset = mimeEnd + 1;
    descriptionStart = pictureTypeOffset + 1;
  }

  if (mimeType === "image/jpg") mimeType = "image/jpeg";
  // Linked artwork ("-->") and unrecognised types are deliberately ignored:
  // only bounded, embedded JPEG/PNG data is retained locally.
  if (mimeType !== "image/jpeg" && mimeType !== "image/png") return null;
  const pictureType = bytes[pictureTypeOffset];
  const terminator = findDescriptionTerminator(bytes, descriptionStart, encoding);
  if (!terminator || terminator.next >= bytes.length) return null;
  const data = bytes.subarray(terminator.next);
  if (!validPicturePayload(data, mimeType)) return null;
  return { pictureType, mimeType, data: new Uint8Array(data) };
}

/**
 * Read only the ID3 title/artist/album/genre text frames used by Ritmo.
 * Unsupported, compressed, encrypted, malformed, or truncated frames are
 * skipped safely; the caller's filename-derived metadata remains the fallback.
 */
export function parseId3Tags(input, fallback = {}) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input || 0);
  const result = { ...fallback, genre: String(fallback.genre || "") };
  if (bytes.length < 10 || bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return result;

  const version = bytes[3];
  const revision = bytes[4];
  const flags = bytes[5];
  const tagSize = synchsafe(bytes, 6);
  if (![2, 3, 4].includes(version) || revision === 0xff || tagSize < 0 || tagSize > 2 * 1024 * 1024) return result;
  // ID3v2.2 compression has no portable lightweight decoder here.
  if (version === 2 && (flags & 0x40)) return result;

  const tagEnd = Math.min(bytes.length, 10 + tagSize);
  let offset = 10;
  let selectedArtworkType = -1;
  if (flags & 0x40) {
    if (offset + 4 > tagEnd) return result;
    const extendedSize = version === 4 ? synchsafe(bytes, offset) : bigEndian(bytes, offset, 4);
    if (extendedSize < 0) return result;
    const skip = version === 4 ? extendedSize : 4 + extendedSize;
    if (skip < 4 || offset + skip > tagEnd) return result;
    offset += skip;
  }

  // ID3v2.4 tag size excludes its optional 10-byte footer, so frameEnd stays at tagEnd.
  const frameEnd = tagEnd;
  while (offset < frameEnd) {
    const headerSize = version === 2 ? 6 : 10;
    if (offset + headerSize > frameEnd) break;
    const idLength = version === 2 ? 3 : 4;
    const frameId = String.fromCharCode(...bytes.subarray(offset, offset + idLength));
    if (!frameId.trim() || /^\x00+$/.test(frameId)) break;
    if (!/^[A-Z0-9]+$/.test(frameId)) break;

    const sizeOffset = offset + idLength;
    const frameSize = version === 2
      ? bigEndian(bytes, sizeOffset, 3)
      : version === 4 ? synchsafe(bytes, sizeOffset) : bigEndian(bytes, sizeOffset, 4);
    if (frameSize <= 0 || offset + headerSize + frameSize > frameEnd) break;

    const mappedField = TEXT_FRAMES[frameId];
    let skipFrame = false;
    if (version >= 3) {
      const formatFlags = bytes[offset + 9];
      skipFrame = version === 3
        ? Boolean(formatFlags & (0x80 | 0x40)) // compression or encryption
        : Boolean(formatFlags & (0x08 | 0x04)); // compression or encryption
    }
    const rawPayload = bytes.subarray(offset + headerSize, offset + headerSize + frameSize);
    const frameUnsynchronised = Boolean((flags & 0x80) || (version === 4 && (bytes[offset + 9] & 0x02)));
    if (mappedField && !skipFrame) {
      const payload = frameUnsynchronised ? removeUnsynchronisation(rawPayload) : rawPayload;
      const value = decodeText(payload);
      if (value) result[mappedField] = mappedField === "genre" ? normalizeGenre(value) : value;
    }
    const isPictureFrame = (version === 2 && frameId === "PIC") || (version >= 3 && frameId === "APIC");
    if (isPictureFrame && !skipFrame) {
      const picture = parseAttachedPicture(rawPayload, version, frameUnsynchronised);
      if (picture && (selectedArtworkType < 0 || (picture.pictureType === 3 && selectedArtworkType !== 3))) {
        result.artwork = picture.data;
        result.artworkMimeType = picture.mimeType;
        result.artworkPictureType = picture.pictureType;
        selectedArtworkType = picture.pictureType;
      }
    }
    offset += headerSize + frameSize;
  }
  return result;
}
