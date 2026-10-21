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
  if (flags & 0x40) {
    if (offset + 4 > tagEnd) return result;
    const extendedSize = version === 4 ? synchsafe(bytes, offset) : bigEndian(bytes, offset, 4);
    if (extendedSize < 0) return result;
    const skip = version === 4 ? extendedSize : 4 + extendedSize;
    if (skip < 4 || offset + skip > tagEnd) return result;
    offset += skip;
  }

  let frameEnd = tagEnd;
  if (version === 4 && (flags & 0x10)) frameEnd = Math.max(offset, frameEnd - 10);
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
    if (mappedField && !skipFrame) {
      let payload = bytes.subarray(offset + headerSize, offset + headerSize + frameSize);
      if ((flags & 0x80) || (version === 4 && (bytes[offset + 9] & 0x02))) payload = removeUnsynchronisation(payload);
      const value = decodeText(payload);
      if (value) result[mappedField] = mappedField === "genre" ? normalizeGenre(value) : value;
    }
    offset += headerSize + frameSize;
  }
  return result;
}
