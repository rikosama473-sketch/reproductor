import assert from "node:assert/strict";
import { findActiveLyricIndex, formatLrcTimestamp, parseLrcLyrics } from "../src/lyrics.js";

const lyrics = parseLrcLyrics([
  "[ti:Prueba]",
  "[ar:Artista]",
  "[offset:100]",
  "[00:01.20]Primera línea",
  "[00:03.05][00:04.50]Segunda línea",
  "una línea sin tiempo",
  "[00:61.00]No válida",
  ""
].join("\n"));
assert.deepEqual(lyrics, [
  { timeMs: 1300, text: "Primera línea" },
  { timeMs: 3150, text: "Segunda línea" },
  { timeMs: 4600, text: "Segunda línea" }
]);
assert.equal(findActiveLyricIndex(lyrics, 1.29), -1);
assert.equal(findActiveLyricIndex(lyrics, 1.3), 0);
assert.equal(findActiveLyricIndex(lyrics, 4.6), 2);
assert.equal(findActiveLyricIndex(lyrics, 9), 2);
assert.equal(findActiveLyricIndex(lyrics, -0.2), -1);
assert.equal(formatLrcTimestamp(65_678), "[01:05.67]");
assert.deepEqual(parseLrcLyrics("[ar:X]\n[ti:No timecodes]"), []);
assert.deepEqual(parseLrcLyrics("x".repeat(200_001)), []);
assert.deepEqual(parseLrcLyrics(null), []);
assert.deepEqual(parseLrcLyrics("[00:05.00]texto\n[offset:-600000]"), []);
console.log("LRC parser, timestamp offset, validation and active-line checks passed.");
