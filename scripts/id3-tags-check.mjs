import assert from "node:assert/strict";
import { MAX_EMBEDDED_ARTWORK_BYTES, parseId3Tags } from "../src/id3-tags.js";

const fallback = { title: "Filename title", artist: "Unknown artist", album: "", genre: "" };
const synchsafe = value => [(value >> 21) & 0x7f, (value >> 14) & 0x7f, (value >> 7) & 0x7f, value & 0x7f];
const frame = (id, text, version = 3) => {
  const payload = Uint8Array.from([version === 2 ? 0 : 3, ...new TextEncoder().encode(text)]);
  const size = version === 2
    ? [(payload.length >> 16) & 255, (payload.length >> 8) & 255, payload.length & 255]
    : version === 4 ? synchsafe(payload.length) : [(payload.length >>> 24) & 255, (payload.length >>> 16) & 255, (payload.length >>> 8) & 255, payload.length & 255];
  return Uint8Array.from([...new TextEncoder().encode(id), ...size, ...(version === 2 ? [] : [0, 0]), ...payload]);
};
const tag = (version, frames, flags = 0) => {
  const payload = Uint8Array.from(frames.flatMap(part => [...part]));
  const header = [0x49, 0x44, 0x33, version, 0, flags, ...synchsafe(payload.length)];
  return Uint8Array.from([...header, ...payload]);
};

const rawFrame = (id, payload, version = 3, frameFlags = 0) => {
  const size = version === 2
    ? [(payload.length >> 16) & 255, (payload.length >> 8) & 255, payload.length & 255]
    : version === 4 ? synchsafe(payload.length) : [
      (payload.length >>> 24) & 255, (payload.length >>> 16) & 255,
      (payload.length >>> 8) & 255, payload.length & 255
    ];
  return Uint8Array.from([
    ...new TextEncoder().encode(id), ...size,
    ...(version === 2 ? [] : [(frameFlags >> 8) & 255, frameFlags & 255]),
    ...payload
  ]);
};
const png = Uint8Array.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0x01,0x02,0x03]);
const jpeg = Uint8Array.from([0xff,0xd8,0xff,0xe0,0x00,0x10,0x4a,0x46,0x49,0x46]);
const apic = (mime, pictureType, data, version = 3, description = "", frameFlags = 0) => {
  const encoding = 0;
  return rawFrame(version === 2 ? "PIC" : "APIC", Uint8Array.from([
    encoding,
    ...(version === 2
      ? [...new TextEncoder().encode(mime === "image/png" ? "PNG" : "JPG")]
      : [...new TextEncoder().encode(mime), 0]),
    pictureType,
    ...new TextEncoder().encode(description), 0,
    ...data
  ]), version, frameFlags);
};

const v23 = parseId3Tags(tag(3, [frame("TIT2", "Piano nocturno"), frame("TPE1", "Artista"), frame("TALB", "Álbum"), frame("TCON", "17")]), fallback);
assert.equal(v23.title, "Piano nocturno");
assert.equal(v23.artist, "Artista");
assert.equal(v23.album, "Álbum");
assert.equal(v23.genre, "Rock");
assert.equal(parseId3Tags(tag(3, [frame("TIT2", "AC/DC - Live")]), fallback).title, "AC/DC - Live", "preserve slash characters in titles");

const v22 = parseId3Tags(tag(2, [frame("TT2", "Tema v2.2", 2), frame("TP1", "Banda", 2)]), fallback);
assert.equal(v22.title, "Tema v2.2");
assert.equal(v22.artist, "Banda");

const v24 = parseId3Tags(tag(4, [frame("TIT2", "Etiqueta v2.4", 4)]), fallback);
assert.equal(v24.title, "Etiqueta v2.4");

assert.deepEqual(parseId3Tags(new Uint8Array([1, 2, 3]), fallback), fallback);
assert.deepEqual(parseId3Tags(Uint8Array.from([0x49,0x44,0x33,3,0,0,0x80,0,0,0]), fallback), fallback, "reject non-synchsafe header size");
assert.deepEqual(parseId3Tags(Uint8Array.from([0x49,0x44,0x33,9,0,0,0,0,0,0]), fallback), fallback, "ignore unsupported major versions");

const malformedFrame = Uint8Array.from([...new TextEncoder().encode("TIT2"), 0, 0, 0, 250, 0, 0, 3, 84, 101, 115, 116]);
const malformed = parseId3Tags(tag(3, [malformedFrame]), fallback);
assert.equal(malformed.title, fallback.title, "ignore a frame whose declared size exceeds the tag");

const truncatedHeader = Uint8Array.from([0x49,0x44,0x33,3,0,0,0,0,1]);
assert.equal(parseId3Tags(truncatedHeader, fallback).title, fallback.title);

const coverFallback = parseId3Tags(tag(3, [
  frame("TIT2", "Álbum con portada"),
  apic("image/jpeg", 0, jpeg),
  apic("image/png", 3, png),
  apic("image/jpeg", 4, jpeg)
]), fallback);
assert.equal(coverFallback.artworkMimeType, "image/png");
assert.equal(coverFallback.artworkPictureType, 3, "Prefer the front-cover APIC frame over other pictures");
assert.deepEqual([...coverFallback.artwork], [...png], "Retain actual embedded image bytes");

const coverV22 = parseId3Tags(tag(2, [apic("image/png", 3, png, 2)]), fallback);
assert.equal(coverV22.artworkMimeType, "image/png", "Support ID3v2.2 PIC picture format");
assert.deepEqual([...coverV22.artwork], [...png]);

const coverV24 = parseId3Tags(tag(4, [apic("image/jpeg", 3, jpeg, 4)]), fallback);
assert.equal(coverV24.artworkMimeType, "image/jpeg");
assert.deepEqual([...coverV24.artwork], [...jpeg]);

const unsynchronisedJpeg = Uint8Array.from([0xff,0xd8,0xff,0x00,0xe0,0x00,0x10,0x4a,0x46,0x49,0x46]);
const coverUnsynchronised = parseId3Tags(tag(4, [apic("image/jpeg", 3, unsynchronisedJpeg, 4, "", 0x02)], 0), fallback);
assert.equal(coverUnsynchronised.artworkMimeType, "image/jpeg");
assert.deepEqual([...coverUnsynchronised.artwork], [...jpeg], "Remove ID3v2.4 picture-frame unsynchronisation safely");

const externalPicture = rawFrame("APIC", Uint8Array.from([
  0, ...new TextEncoder().encode("-->"), 0, 3, 0,
  ...new TextEncoder().encode("https://example.invalid/cover.png")
]), 3);
assert.equal(parseId3Tags(tag(3, [externalPicture]), fallback).artwork, undefined,
  "Do not persist or fetch remote picture URLs embedded in tags");

const mismatchedPicture = apic("image/png", 3, jpeg);
assert.equal(parseId3Tags(tag(3, [mismatchedPicture]), fallback).artwork, undefined,
  "Reject picture data whose signature does not match the declared MIME type");

const giantPicture = Uint8Array.from([0xff,0xd8,0xff, ...new Uint8Array(MAX_EMBEDDED_ARTWORK_BYTES)]);
assert.equal(parseId3Tags(tag(3, [apic("image/jpeg", 3, giantPicture)]), fallback).artwork, undefined,
  "Reject embedded artwork above the bounded per-image size");

console.log("ID3 parser tests passed: v2.2/v2.3/v2.4 text frames, JPEG/PNG artwork, front-cover preference, unsynchronisation, bad signatures, external links and size limits.");
