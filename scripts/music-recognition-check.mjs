import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  MUSIC_RECOGNITION_RECORDING_MS,
  MUSIC_RECOGNITION_TOKEN_STORAGE_KEY,
  normalizeMusicRecognitionToken,
  readMusicRecognitionToken,
  persistMusicRecognitionToken,
  clearMusicRecognitionToken,
  normalizeMusicSourceUrl,
  buildMusicSearchSources,
  normalizeMusicRecognitionResult
} from "../src/music-recognition.js";

assert.equal(MUSIC_RECOGNITION_RECORDING_MS, 8000, "Microphone capture must stay short and bounded");

const recognitionHtml = await readFile(new URL("../index.html", import.meta.url), "utf8");
const recognitionUi = await readFile(new URL("../src/music-finder-ui.js", import.meta.url), "utf8");
assert.match(recognitionHtml, /Funciona también en la aplicación de escritorio para Windows/);
assert.match(recognitionHtml, /micrófono \(solo audio\).*no usa la cámara/);
assert.match(recognitionHtml, /token se guarda localmente en esta instalación de Ritmo/);
assert.match(recognitionUi, /token guardado localmente en esta instalación/);
assert.match(recognitionUi, /Intentá de nuevo con otra captura/);
assert.doesNotMatch(recognitionHtml, /El token se guarda en este navegador/);
assert.doesNotMatch(recognitionUi, /Hay un token guardado en este navegador/);
assert.equal(normalizeMusicRecognitionToken("  personal-token  "), "personal-token");
assert.equal(normalizeMusicRecognitionToken(""), "");
assert.equal(normalizeMusicRecognitionToken("bad\ntoken"), "");
assert.equal(normalizeMusicRecognitionToken("x".repeat(513)), "");

const memory = {
  value: null,
  getItem(key) { assert.equal(key, MUSIC_RECOGNITION_TOKEN_STORAGE_KEY); return this.value; },
  setItem(key, value) { assert.equal(key, MUSIC_RECOGNITION_TOKEN_STORAGE_KEY); this.value = value; },
  removeItem(key) { assert.equal(key, MUSIC_RECOGNITION_TOKEN_STORAGE_KEY); this.value = null; }
};
assert.equal(readMusicRecognitionToken(memory), "");
assert.equal(persistMusicRecognitionToken(" test-token ", memory), true);
assert.equal(readMusicRecognitionToken(memory), "test-token");
assert.equal(clearMusicRecognitionToken(memory), true);
assert.equal(readMusicRecognitionToken(memory), "");
assert.equal(readMusicRecognitionToken({ getItem() { throw new Error("storage blocked"); } }), "");
assert.equal(persistMusicRecognitionToken("abc", { setItem() { throw new Error("storage blocked"); } }), false);
assert.equal(clearMusicRecognitionToken({ removeItem() { throw new Error("storage blocked"); } }), false);

assert.equal(normalizeMusicSourceUrl("https://open.spotify.com/track/1abc"), "https://open.spotify.com/track/1abc");
assert.equal(normalizeMusicSourceUrl("https://music.apple.com/us/album/example"), "https://music.apple.com/us/album/example");
assert.equal(normalizeMusicSourceUrl("javascript:alert(1)"), "");
assert.equal(normalizeMusicSourceUrl("http://open.spotify.com/track/example"), "");
assert.equal(normalizeMusicSourceUrl("https://open.spotify.com.evil.example/track/example"), "");
assert.equal(normalizeMusicSourceUrl("https://user:pass@open.spotify.com/track/example"), "");
assert.equal(normalizeMusicSourceUrl("https://unknown.example/song"), "");

const manualSources = buildMusicSearchSources("  Aria   & anime OST ");
assert.equal(manualSources.length, 6);
assert.deepEqual(manualSources.map(item => item.id), ["youtube", "spotify", "apple-music", "deezer", "musicbrainz", "bandcamp"]);
assert.ok(manualSources.every(item => item.url.startsWith("https://")));
assert.ok(manualSources.some(item => item.url.includes(encodeURIComponent("Aria & anime OST"))));
assert.deepEqual(buildMusicSearchSources("   "), []);

const recognized = normalizeMusicRecognitionResult({
  status: "success",
  result: {
    title: "Warriors",
    artist: "Imagine Dragons",
    album: "Smoke + Mirrors",
    release_date: "2014-09-18",
    label: "KIDinaKORNER / Interscope",
    timecode: "00:03",
    song_link: "https://lis.tn/Warriors",
    apple_music: {
      url: "https://music.apple.com/us/album/warriors/1440831203?i=1440831624",
      artwork: { url: "https://is1-ssl.mzstatic.com/image/thumb/test/{w}x{h}bb.jpeg" },
      previews: [{ url: "https://audio-ssl.itunes.apple.com/preview/example.m4a" }],
      isrc: "USUM71414163"
    },
    spotify: {
      external_urls: { spotify: "https://open.spotify.com/track/1lgN0A2Vki2FTON5PYq42m" },
      external_ids: { isrc: "USUM71414163" }
    },
    deezer: { link: "https://www.deezer.com/track/12345" },
    musicbrainz: [{ id: "123e4567-e89b-12d3-a456-426614174000" }]
  }
});
assert.equal(recognized.title, "Warriors");
assert.equal(recognized.artist, "Imagine Dragons");
assert.equal(recognized.album, "Smoke + Mirrors");
assert.equal(recognized.releaseDate, "2014-09-18");
assert.equal(recognized.isrc, "USUM71414163");
assert.ok(recognized.artworkUrl.endsWith("/320x320bb.jpeg"));
assert.ok(recognized.previewUrl.startsWith("https://audio-ssl.itunes.apple.com/"));
assert.deepEqual(recognized.sources.map(item => item.id), ["apple-music", "spotify", "deezer", "recognition", "musicbrainz-recording"]);
assert.ok(recognized.searchSources.length === 6);
assert.equal(normalizeMusicRecognitionResult({ status: "success", result: null }), null);
assert.equal(normalizeMusicRecognitionResult({ status: "success", result: { title: "No artist" } }), null);
assert.throws(() => normalizeMusicRecognitionResult({ status: "error", error: { error_message: "Invalid token" } }), /Invalid token/);

const unsafeMetadata = normalizeMusicRecognitionResult({
  status: "success",
  result: {
    title: "Untrusted",
    artist: "No links",
    song_link: "javascript:alert(1)",
    apple_music: { url: "https://evil.example/track" },
    spotify: { external_urls: { spotify: "https://open.spotify.com.evil.example/track" } },
    deezer: { link: "http://www.deezer.com/track/1" }
  }
});
assert.equal(unsafeMetadata.sources.length, 0, "Only allowlisted HTTPS source links may be rendered");
console.log("Music-recognition checks passed: privacy-safe local token handling, bounded clip length, source URL validation, source search links and recognition metadata normalization.");
