import assert from "node:assert/strict";
import {
  MAX_VORBIS_METADATA_BYTES,
  parseFlacVorbisComments,
  parseOggVorbisComments,
  isVorbisMetadataFilename
} from "../src/vorbis-comments.js";

const encoder = new TextEncoder();
const fallback = { title: "Filename title", artist: "Unknown artist", album: "", genre: "" };
const concat = (...arrays) => {
  const result = new Uint8Array(arrays.reduce((sum, item) => sum + item.length, 0));
  let offset = 0;
  for (const item of arrays) { result.set(item, offset); offset += item.length; }
  return result;
};
const le32 = value => Uint8Array.from([value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255]);
function commentBody(entries) {
  const vendor = encoder.encode("Ritmo parser test");
  const chunks = [le32(vendor.length), vendor, le32(entries.length)];
  for (const entry of entries) {
    const bytes = encoder.encode(entry);
    chunks.push(le32(bytes.length), bytes);
  }
  return concat(...chunks);
}
function flacWithComments(body) {
  return concat(encoder.encode("fLaC"), Uint8Array.from([0x84, (body.length >>> 16) & 255, (body.length >>> 8) & 255, body.length & 255]), body);
}
function oggPage(packet) {
  const lacing = [];
  let offset = 0;
  while (packet.length - offset >= 255) { lacing.push(255); offset += 255; }
  lacing.push(packet.length - offset);
  const page = new Uint8Array(27 + lacing.length + packet.length);
  page.set(encoder.encode("OggS"), 0);
  page[4] = 0;
  page[26] = lacing.length;
  page.set(lacing, 27);
  page.set(packet, 27 + lacing.length);
  return page;
}
const entries = ["title=Track title", "ARTIST=Artist A", "ARTIST=Artist B", "ALBUM=Test album", "GENRE=Jazz", "COMMENT=ignored"];
const body = commentBody(entries);
const flac = parseFlacVorbisComments(flacWithComments(body), fallback);
assert.equal(flac.title, "Track title");
assert.equal(flac.artist, "Artist A / Artist B");
assert.equal(flac.album, "Test album");
assert.equal(flac.genre, "Jazz");
assert.equal(fallback.title, "Filename title", "Fallback metadata must not be mutated");

const oggVorbis = concat(Uint8Array.from([3, ...encoder.encode("vorbis")]), body);
assert.equal(parseOggVorbisComments(oggPage(oggVorbis), fallback).title, "Track title");
const opusTags = concat(encoder.encode("OpusTags"), body);
assert.equal(parseOggVorbisComments(oggPage(opusTags), fallback).artist, "Artist A / Artist B");
assert.equal(parseOggVorbisComments(oggPage(encoder.encode("not tags")), fallback).title, fallback.title);
assert.equal(parseOggVorbisComments(oggPage(encoder.encode("OggS-not a page")).subarray(0, 19), fallback).title, fallback.title);
assert.equal(parseFlacVorbisComments(encoder.encode("not flac"), fallback).title, fallback.title);
assert.equal(parseFlacVorbisComments(flacWithComments(new Uint8Array([1, 2, 3])), fallback).title, fallback.title);
assert.equal(parseOggVorbisComments(new Uint8Array(MAX_VORBIS_METADATA_BYTES + 20).fill(0), fallback).title, fallback.title);
assert.equal(isVorbisMetadataFilename("song.FLAC"), true);
assert.equal(isVorbisMetadataFilename("podcast.oga"), true);
assert.equal(isVorbisMetadataFilename("voice.opus"), true);
assert.equal(isVorbisMetadataFilename("song.mp3"), false);
assert.equal(isVorbisMetadataFilename("song.m4a"), false);
console.log("Vorbis metadata checks passed: FLAC comments, Ogg Vorbis and Opus tags, fallback safety, bounded reads and filename routing.");
