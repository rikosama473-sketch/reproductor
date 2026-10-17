import fs from "node:fs";
import assert from "node:assert/strict";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
const storage = fs.readFileSync(new URL("../src/storage.js", import.meta.url), "utf8");
const sw = fs.readFileSync(new URL("../sw.js", import.meta.url), "utf8");

const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
const usedIds = new Set([...app.matchAll(/\$\("#([a-zA-Z0-9_-]+)"\)/g)].map(match => match[1]));
const missingIds = [...usedIds].filter(id => !ids.has(id));
assert.deepEqual(missingIds, [], "App selectors refer to IDs missing from index.html");
assert.match(html, /<audio id="audio-engine"/, "HTML must include the audio engine");
assert.match(html, /manifest\.webmanifest/, "HTML must link to the PWA manifest");
assert.match(app, /indexedDB|saveManyTracks/, "App must use persistent local library storage");
assert.match(storage, /createObjectStore/, "Storage must create its IndexedDB object store");
assert.match(sw, /addAll\(APP_SHELL\)/, "Service worker must cache the app shell");
assert.match(app, /data-delete/, "Library must expose delete actions for imported entries");
console.log("Ritmo smoke checks passed: " + ids.size + " HTML IDs, " + usedIds.size + " app selectors.");

assert.match(html, /id="youtube-search-form"/, "The online page must include the YouTube search form");
assert.match(html, /id="youtube-iframe"/, "The online page must include the official YouTube iframe player");
assert.match(app, /youtube\/v3\/search/, "Integrated YouTube results must use the official Data API");
assert.match(app, /youtube\.com\/embed\//, "Playback must use the official YouTube embedded player");
assert.match(app, /YOUTUBE_KEY_STORAGE/, "The optional API key must be stored locally by the user");
assert.match(app, /youtube\.com\/results\?search_query=/, "Search without an API key must have an external YouTube fallback");
console.log("YouTube integration smoke checks passed.");

assert.match(app, /youtube\/v3\/videos/, "App must check video status before embedding search results");
assert.match(app, /status\.madeForKids/, "App must check the Made for Kids status of a video");
assert.match(app, /ritmoStatusVerified === true/, "Only checked videos may be embedded");
assert.match(app, /data-yt-external/, "Unverified or child-directed videos must use external YouTube links");
console.log("YouTube embedding status checks passed.");
