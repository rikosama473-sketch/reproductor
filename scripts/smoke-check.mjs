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
