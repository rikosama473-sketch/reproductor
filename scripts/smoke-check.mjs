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


assert.match(storage, /const DB_VERSION = 2/, "Storage schema should upgrade without deleting existing tracks");
assert.match(storage, /createObjectStore\(HISTORY/, "Storage should keep a persistent playback history");
assert.match(storage, /createObjectStore\(PLAYLISTS/, "Storage should persist playlists");
assert.match(app, /function renderHistory/, "The app should render recent playback history");
assert.match(app, /function renderPlaylists/, "The app should render named playlists");
assert.match(app, /function setupMediaSession/, "The app should expose mobile/system media controls");
assert.match(app, /function renderFormatCapabilities/, "The app should report device audio format support");
assert.match(app, /const BATCH_SIZE = 20/, "Bulk imports should be saved in bounded batches");
assert.match(app, /function readMp3Tags/, "Basic MP3 ID3 tags should be parsed");
assert.match(app, /YOUTUBE_SEARCH_CACHE_STORAGE/, "Recent YouTube result metadata should be cacheable for offline discovery");
assert.match(html, /id="history-view"/, "HTML must provide a history view");
assert.match(html, /id="playlists-view"/, "HTML must provide a playlist view");
assert.match(html, /id="format-capabilities"/, "HTML must expose audio format capabilities");
assert.match(sw, /ritmo-shell-v4/, "Service worker cache must refresh for the new shell");
console.log("History, playlists, mobile controls, and offline format checks passed.");


assert.match(html, /id="settings-dialog"/, "Settings dialog should exist");
assert.match(html, /id="eq-enabled"/, "Audio settings must expose equalizer enable control");
assert.match(html, /id="eq-bass"/, "Audio settings must expose bass adjustment");
assert.match(html, /id="eq-mid"/, "Audio settings must expose midrange adjustment");
assert.match(html, /id="eq-treble"/, "Audio settings must expose treble adjustment");
assert.match(html, /id="limiter-toggle"/, "Audio settings must expose soft peak limiting");
assert.match(html, /id="keep-screen-awake"/, "Playback settings must expose optional Wake Lock request");
assert.match(html, /id="sleep-start"/, "Playback settings must provide a sleep timer");
assert.match(html, /id="request-storage-button"/, "Storage settings must allow a user-directed persistent-storage request");
assert.match(html, /id="diagnostics-list"/, "Settings must report browser capabilities");
assert.match(html, /id="playback-retry"/, "Playback failures must offer retry");
assert.match(app, /function ensureAudioProcessing/, "Optional local EQ must use the Web Audio API");
assert.match(app, /createDynamicsCompressor/, "The local EQ chain should include the optional soft peak limiter");
assert.match(app, /function bindAudioEngineEvents/, "Audio engine must report waiting, stalled and error states");
assert.match(app, /function retryCurrentPlayback/, "Audio failures must have a reload/retry route");
assert.match(app, /function requestScreenWakeLock/, "Screen Wake Lock must be requested only when the user opts in");
assert.match(app, /function startSleepTimer/, "The player must expose a sleep timer");
assert.match(app, /async function downloadStreamOffline/, "Direct audio URLs should support authorized offline saving");
assert.match(app, /MAX_DOWNLOAD_BYTES = 150 \* 1024 \* 1024/, "Offline saving must enforce a bounded download size");
assert.match(app, /mode: "cors", credentials: "omit"/, "Direct downloads must respect browser CORS and avoid sending credentials");
assert.match(app, /function renderDiagnostics/, "The settings must summarize actual browser capabilities");
assert.match(sw, /ritmo-shell-v4/, "Service-worker cache must refresh after playback settings are added");
console.log("Audio settings, wake-lock consent, timer, diagnostics, retries and permitted direct-audio offline-save checks passed.");


assert.match(html, /id="queue-dialog"/, "Queue button should open a dedicated editable queue");
assert.match(html, /id="queue-items"/, "Queue dialog should render the active queue");
assert.match(html, /id="queue-from-library"/, "Queue should be resettable to library order");
assert.match(html, /id="volume-mute-button"/, "Player should expose a dedicated mute/unmute action");
assert.match(app, /function activeQueueIds/, "The queue should distinguish library order from an explicit empty/custom queue");
assert.match(app, /function renderQueue/, "The queue UI should expose actual queued tracks and order controls");
assert.match(app, /data-queue-up/, "Queue items should be reorderable");
assert.match(app, /data-queue-down/, "Queue items should be reorderable in both directions");
assert.match(app, /data-queue-remove/, "Queue items should be removable without deleting library files");
assert.match(app, /function toggleMute/, "Mute should remember the previous audible volume");
assert.match(app, /lastAudibleVolume/, "The previous audible volume should be preserved between mute toggles");
console.log("Editable queue and persistent mute control smoke checks passed.");


assert.match(app, /if \(!\$\("#youtube-player-wrap"\)\.hidden\) stopYoutubePlayback\(\)/, "Starting local/URL audio must stop an active YouTube iframe to prevent overlapping audio");
assert.match(app, /function playYoutubeVideo[\s\S]*?renderQueue\(\);/, "Starting YouTube should refresh queue status");
console.log("YouTube/native audio source transition checks passed.");
