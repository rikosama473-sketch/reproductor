import assert from "node:assert/strict";
import { parseId3Tags } from "../src/id3-tags.js";

const fallback = { title: "Filename title", artist: "Unknown artist", album: "", genre: "" };
const synchsafe = value => [(value >> 21) & 0x7f, (value >> 14) & 0x7f, (value >> 7) & 0x7f, value & 0x7f];
const frame = (id, text, version = 3) => {
  const payload = Uint8Array.from([3, ...new TextEncoder().encode(text)]);
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

const v23 = parseId3Tags(tag(3, [frame("TIT2", "Piano nocturno"), frame("TPE1", "Artista"), frame("TALB", "Álbum"), frame("TCON", "17")]), fallback);
assert.equal(v23.title, "Piano nocturno");
assert.equal(v23.artist, "Artista");
assert.equal(v23.album, "Álbum");
assert.equal(v23.genre, "17");

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
console.log("ID3 parser tests passed: v2.2/v2.3/v2.4 text frames, UTF-8, invalid headers, unsupported versions and truncated frames.");
