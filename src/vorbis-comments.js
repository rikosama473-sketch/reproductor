import { normalizeId3Genre } from "./music-genres.js";

export const MAX_VORBIS_METADATA_BYTES = 2 * 1024 * 1024;
export const MAX_VORBIS_COMMENTS = 4096;
const MAX_COMMENT_BYTES = 16 * 1024;
const MAX_VALUES_PER_FIELD = 8;

const FIELD_MAP = Object.freeze({
  TITLE: "title",
  ARTIST: "artist",
  ALBUM: "album",
  GENRE: "genre"
});

function asBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  return null;
}
function readLittleEndian32(bytes, offset) {
  if (offset < 0 || offset + 4 > bytes.length) return -1;
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}
function readBigEndian24(bytes, offset) {
  if (offset < 0 || offset + 3 > bytes.length) return -1;
  return bytes[offset] * 65536 + bytes[offset + 1] * 256 + bytes[offset + 2];
}
function startsWithAscii(bytes, offset, text) {
  if (offset < 0 || offset + text.length > bytes.length) return false;
  for (let index = 0; index < text.length; index++) {
    if (bytes[offset + index] !== text.charCodeAt(index)) return false;
  }
  return true;
}
function cleanValue(value) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 256);
}
function applyCommentBlock(input, fallback = {}) {
  const bytes = asBytes(input);
  if (!bytes || bytes.length < 8 || bytes.length > MAX_VORBIS_METADATA_BYTES) return { ...fallback };
  let offset = 0;
  const vendorLength = readLittleEndian32(bytes, offset);
  if (vendorLength < 0 || vendorLength > bytes.length - 4 - 4) return { ...fallback };
  offset += 4 + vendorLength;
  const commentCount = readLittleEndian32(bytes, offset);
  if (commentCount < 0 || commentCount > MAX_VORBIS_COMMENTS) return { ...fallback };
  offset += 4;
  const values = { title: [], artist: [], album: [], genre: [] };
  const decoder = new TextDecoder("utf-8");
  for (let index = 0; index < commentCount; index++) {
    const length = readLittleEndian32(bytes, offset);
    if (length < 0 || length > bytes.length - offset - 4) return { ...fallback };
    offset += 4;
    if (length > MAX_COMMENT_BYTES) {
      offset += length;
      continue;
    }
    const comment = decoder.decode(bytes.subarray(offset, offset + length));
    offset += length;
    const separator = comment.indexOf("=");
    if (separator <= 0) continue;
    const field = FIELD_MAP[comment.slice(0, separator).trim().toUpperCase()];
    if (!field || values[field].length >= MAX_VALUES_PER_FIELD) continue;
    const value = cleanValue(comment.slice(separator + 1));
    if (value) values[field].push(value);
  }
  const metadata = {};
  if (values.title.length) metadata.title = values.title[0];
  if (values.album.length) metadata.album = values.album[0];
  if (values.artist.length) metadata.artist = values.artist.join(" / ");
  if (values.genre.length) {
    const genre = normalizeId3Genre(values.genre.join(", "));
    // Invalid numeric codes must not erase a useful filename/fallback genre.
    if (genre) metadata.genre = genre;
  }
  return Object.keys(metadata).length ? { ...fallback, ...metadata } : { ...fallback };
}

export function isVorbisMetadataFilename(filename) {
  return /\.(?:flac|ogg|oga|opus)$/i.test(String(filename || ""));
}

export function parseFlacVorbisComments(input, fallback = {}) {
  const source = asBytes(input);
  if (!source || source.length < 8 || !startsWithAscii(source, 0, "fLaC")) return { ...fallback };
  const bytes = source.subarray(0, MAX_VORBIS_METADATA_BYTES);
  let offset = 4;
  let blocks = 0;
  while (offset + 4 <= bytes.length && blocks++ < 128) {
    const header = bytes[offset];
    const type = header & 0x7f;
    const length = readBigEndian24(bytes, offset + 1);
    if (length < 0) return { ...fallback };
    const bodyStart = offset + 4;
    const bodyEnd = bodyStart + length;
    if (bodyEnd > bytes.length) return { ...fallback };
    if (type === 4) return applyCommentBlock(bytes.subarray(bodyStart, bodyEnd), fallback);
    offset = bodyEnd;
    if (header & 0x80) break;
  }
  return { ...fallback };
}

function getOggCommentHeaderOffset(packet) {
  if (packet.length >= 7 && packet[0] === 3 && startsWithAscii(packet, 1, "vorbis")) return 7;
  if (packet.length >= 8 && startsWithAscii(packet, 0, "OpusTags")) return 8;
  return -1;
}

export function parseOggVorbisComments(input, fallback = {}) {
  const source = asBytes(input);
  if (!source || source.length < 27 || !startsWithAscii(source, 0, "OggS")) return { ...fallback };
  const bytes = source.subarray(0, MAX_VORBIS_METADATA_BYTES);
  let pageOffset = 0;
  let pagesRead = 0;
  let packetParts = [];
  let packetLength = 0;
  let droppingPacket = false;
  while (pageOffset + 27 <= bytes.length && pagesRead++ < 4096) {
    if (!startsWithAscii(bytes, pageOffset, "OggS") || bytes[pageOffset + 4] !== 0) break;
    const segmentCount = bytes[pageOffset + 26];
    const segmentTableStart = pageOffset + 27;
    const payloadStart = segmentTableStart + segmentCount;
    if (payloadStart > bytes.length) break;
    let payloadOffset = payloadStart;
    for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex++) {
      const segmentLength = bytes[segmentTableStart + segmentIndex];
      if (payloadOffset + segmentLength > bytes.length) return { ...fallback };
      if (!droppingPacket && packetLength + segmentLength <= MAX_VORBIS_METADATA_BYTES) {
        packetParts.push(bytes.subarray(payloadOffset, payloadOffset + segmentLength));
        packetLength += segmentLength;
      } else {
        droppingPacket = true;
        packetParts = [];
        packetLength = 0;
      }
      payloadOffset += segmentLength;
      if (segmentLength < 255) {
        if (!droppingPacket && packetLength) {
          const packet = new Uint8Array(packetLength);
          let cursor = 0;
          for (const part of packetParts) { packet.set(part, cursor); cursor += part.length; }
          const bodyOffset = getOggCommentHeaderOffset(packet);
          if (bodyOffset >= 0) return applyCommentBlock(packet.subarray(bodyOffset), fallback);
        }
        packetParts = [];
        packetLength = 0;
        droppingPacket = false;
      }
    }
    pageOffset = payloadOffset;
  }
  return { ...fallback };
}
