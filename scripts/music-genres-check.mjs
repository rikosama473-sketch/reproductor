import assert from "node:assert/strict";
import { ID3_V1_GENRES, normalizeId3Genre, inferUiSoundRhythm } from "../src/music-genres.js";

assert.equal(ID3_V1_GENRES.length, 192, "Cover every common ID3v1/Winamp genre code.");
assert.equal(normalizeId3Genre("0"), "Blues");
assert.equal(normalizeId3Genre("(8)"), "Jazz");
assert.equal(normalizeId3Genre("14"), "R&B");
assert.equal(normalizeId3Genre("145"), "Anime");
assert.equal(normalizeId3Genre("146"), "JPop");
assert.equal(normalizeId3Genre("(17)Rock"), "Rock");
assert.equal(normalizeId3Genre("(17)(13)"), "Rock / Pop");
assert.equal(normalizeId3Genre("(17)Rock / (13)Pop"), "Rock / Pop");
assert.equal(normalizeId3Genre("Rock / Pop / Rock"), "Rock / Pop", "Deduplicate composite genres without losing their labels.");
assert.equal(normalizeId3Genre("193"), "", "Unknown numeric genre codes should not be mislabelled.");
assert.equal(normalizeId3Genre("  "), "");

assert.equal(inferUiSoundRhythm("Pop"), "pop");
assert.equal(inferUiSoundRhythm("K-pop"), "pop");
assert.equal(inferUiSoundRhythm("Hip-Hop"), "pop");
assert.equal(inferUiSoundRhythm("Cumbia"), "pop");
assert.equal(inferUiSoundRhythm("Electrónica"), "cyber");
assert.equal(inferUiSoundRhythm("Techno / Synthwave"), "cyber");
assert.equal(inferUiSoundRhythm("Drum & Bass"), "cyber");
assert.equal(inferUiSoundRhythm("Indie Rock"), "rock");
assert.equal(inferUiSoundRhythm("Alternative Metal"), "rock");
assert.equal(inferUiSoundRhythm("Pop Rock"), "rock", "A mixed rock subgenre should not be classified as generic pop.");
assert.equal(inferUiSoundRhythm("Jazz"), null, "Unmapped genres should keep the neutral sound rhythm.");
assert.equal(inferUiSoundRhythm("Classical"), null);
console.log("Music genre model checks passed: 192 legacy codes, composite tags, duplicate removal and broad rhythm families.");
