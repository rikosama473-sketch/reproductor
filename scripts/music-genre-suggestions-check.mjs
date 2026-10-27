import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildItunesGenreSearchUrl,
  normalizeItunesGenreSuggestions,
  searchItunesGenreSuggestions
} from "../src/music-genre-suggestions.js";

const queryUrl = new URL(buildItunesGenreSearchUrl("Warriors", "Imagine Dragons"));
assert.equal(queryUrl.origin, "https://itunes.apple.com");
assert.equal(queryUrl.pathname, "/search");
assert.equal(queryUrl.searchParams.get("term"), "Imagine Dragons Warriors");
assert.equal(queryUrl.searchParams.get("entity"), "song");
assert.equal(queryUrl.searchParams.get("country"), "AR");
assert.equal(queryUrl.searchParams.get("limit"), "8");
assert.equal(new URL(buildItunesGenreSearchUrl("夜に駆ける", "", "US")).searchParams.get("country"), "US");
assert.throws(() => buildItunesGenreSearchUrl("", "Imagine Dragons"), /título/i);
assert.equal(new URL(buildItunesGenreSearchUrl("Song", "Artist", "bad")).searchParams.get("country"), "AR");

const payload = {
  resultCount: 6,
  results: [
    { trackId: 11, trackName: "Warriors", artistName: "Imagine Dragons", primaryGenreName: "Alternative", trackViewUrl: "https://music.apple.com/us/album/warriors/1" },
    { trackId: 12, trackName: "Warriors (From League of Legends)", artistName: "Imagine Dragons", primaryGenreName: "Alternative", trackViewUrl: "https://music.apple.com/us/album/warriors/2" },
    { trackId: 13, trackName: "Warriors", artistName: "Different Artist", primaryGenreName: "Metal", trackViewUrl: "https://music.apple.com/us/album/warriors/3" },
    { trackId: 14, trackName: "A Completely Different Song", artistName: "Imagine Dragons", primaryGenreName: "Pop", trackViewUrl: "https://music.apple.com/us/album/unrelated/4" },
    { trackId: 15, trackName: "Warriors", artistName: "Imagine Dragons", primaryGenreName: "Rock", trackViewUrl: "https://evil.example/track/5" },
    { trackId: 16, trackName: "Warriors", artistName: "Imagine Dragons" }
  ]
};
const suggestions = normalizeItunesGenreSuggestions(payload, { title: "Warriors", artist: "Imagine Dragons" });
assert.deepEqual(suggestions.map(item => item.genre), ["Alternative", "Rock"], "Only plausible title/artist matches with genre labels should survive; duplicate genres should collapse.");
assert.equal(suggestions[0].confidence, 100);
assert.equal(suggestions[0].source, "Catálogo Apple/iTunes");
assert.equal(suggestions[0].sourceUrl, "https://music.apple.com/us/album/warriors/1");
assert.equal(suggestions[0].trackId, 11);
assert.equal(suggestions[1].sourceUrl, "", "External catalog URLs outside the Apple domains must not be linked.");
assert.deepEqual(normalizeItunesGenreSuggestions(null, { title: "Warriors", artist: "Imagine Dragons" }), []);
assert.deepEqual(normalizeItunesGenreSuggestions({ results: [] }, { title: "Warriors" }), []);
assert.deepEqual(normalizeItunesGenreSuggestions(payload, { title: "", artist: "Imagine Dragons" }), []);

let capturedUrl = "";
let capturedOptions = null;
const mockFetch = async (url, options) => {
  capturedUrl = url;
  capturedOptions = options;
  return { ok: true, status: 200, json: async () => ({ results: [
    { trackName: "Warriors", artistName: "Imagine Dragons", primaryGenreName: "Alternative" }
  ] }) };
};
const fetched = await searchItunesGenreSuggestions({ title: "Warriors", artist: "Imagine Dragons", fetchImpl: mockFetch });
assert.equal(fetched.length, 1);
assert.equal(fetched[0].genre, "Alternative");
assert.ok(capturedUrl.startsWith("https://itunes.apple.com/search?"));
assert.equal(capturedOptions.method, "GET");
assert.equal(capturedOptions.mode, "cors");
assert.equal(capturedOptions.credentials, "omit");
assert.equal(capturedOptions.cache, "no-store");

await assert.rejects(
  searchItunesGenreSuggestions({ title: "Warriors", artist: "Imagine Dragons", fetchImpl: async () => ({ ok: false, status: 503 }) }),
  /503/
);
await assert.rejects(
  searchItunesGenreSuggestions({ title: "Warriors", fetchImpl: null }),
  /no puede consultar/i
);
const [metadataHtml, appSource] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../src/app.js", import.meta.url), "utf8")
]);
assert.match(metadataHtml, /id="metadata-genre-suggest"/);
assert.match(metadataHtml, /No analiza ni envía el audio/);
assert.match(appSource, /searchItunesGenreSuggestions/);
assert.match(appSource, /if \(!networkModeIsAvailable\(\)\)/, "Catalog lookup must respect the app's network mode.");
assert.match(appSource, /metadataTouchedFields\.add\("genre"\)/, "Applying a proposal must mark the genre field as edited.");
assert.match(appSource, /tocá «Guardar cambios» para actualizar la ficha local/);
assert.match(appSource, /El archivo original no se modifica/);
assert.doesNotMatch(metadataHtml, /Sugerencia automática aplicada y guardada/);

console.log("Music genre catalog suggestion checks passed: safe query construction, title/artist match filtering, genre de-duplication, safe source links and mocked catalog request behavior.");
