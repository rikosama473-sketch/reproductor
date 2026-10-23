import fs from "node:fs";
import assert from "node:assert/strict";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
const storage = fs.readFileSync(new URL("../src/storage.js", import.meta.url), "utf8");
const audioVolume = fs.readFileSync(new URL("../src/audio-output-volume.js", import.meta.url), "utf8");
const youtubePlayerErrors = fs.readFileSync(new URL("../src/youtube-player-errors.js", import.meta.url), "utf8");
const eqPresets = fs.readFileSync(new URL("../src/equalizer-presets.js", import.meta.url), "utf8");
const importFingerprint = fs.readFileSync(new URL("../src/import-fingerprint.js", import.meta.url), "utf8");
const asyncGenerationGate = fs.readFileSync(new URL("../src/async-generation-gate.js", import.meta.url), "utf8");
const playbackPosition = fs.readFileSync(new URL("../src/playback-position.js", import.meta.url), "utf8");
const audioPreferences = fs.readFileSync(new URL("../src/audio-preferences.js", import.meta.url), "utf8");
const nativeMusicPluginSource = fs.readFileSync(new URL("../mobile/native/android/RitmoMusicLibraryPlugin.java", import.meta.url), "utf8");
const sw = fs.readFileSync(new URL("../sw.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const appIcon = fs.readFileSync(new URL("../assets/icon.svg", import.meta.url), "utf8");
const deployWorkflow = fs.readFileSync(new URL("../.github/workflows/deploy-pages.yml", import.meta.url), "utf8");
const validateWorkflow = fs.readFileSync(new URL("../.github/workflows/validate.yml", import.meta.url), "utf8");

// A rerun of a GitHub Pages workflow preserves artifacts from earlier attempts.
// Upload and deploy the attempt-specific artifact to avoid duplicate-name failures.
assert.match(deployWorkflow, /name: github-pages-\$\{\{ github\.run_attempt \}\}/, "Pages artifact names must be unique for each workflow attempt");
assert.match(deployWorkflow, /artifact_name: github-pages-\$\{\{ github\.run_attempt \}\}/, "Pages deployment must select the current attempt's artifact");

const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
const usedIds = new Set([...app.matchAll(/\$\("#([a-zA-Z0-9_-]+)"\)/g)].map(match => match[1]));
const missingIds = [...usedIds].filter(id => !ids.has(id));
assert.deepEqual(missingIds, [], "App selectors refer to IDs missing from index.html");
assert.match(html, /<audio id="audio-engine"/, "HTML must include the audio engine");
assert.match(html, /id="character-companion"/, "The player's animated character companion must exist");
assert.match(html, /src="\.\/pngtuber-capibara\.png"/, "The companion must reuse the supplied character artwork");
assert.match(app, /function syncCharacterCompanion\(playing\)/, "Companion visibility must be synchronized by playback state");
assert.match(app, /syncCharacterCompanion\(hasMedia && !playbackIsPaused\(\)\)/, "The companion must appear only while media is playing");
assert.match(html, /manifest\.webmanifest/, "HTML must link to the PWA manifest");
assert.match(app, /indexedDB|saveManyTracks/, "App must use persistent local library storage");
assert.match(app, /function scanDeviceMusic/, "Android build must scan local device music");
assert.match(app, /function nativeMusicPlugin/, "App must expose its native Android plugin bridge");
assert.match(app, /bridge\.nativePromise\("RitmoMusicLibrary", method/, "Native bridge fallback must work without bundled registerPlugin");
assert.match(app, /function browseAudioFolder/, "App must offer native folder browsing");
assert.match(app, /data-pick-audio-folder/, "UI must expose folder selection");
assert.match(html, /data-scan-device-music/, "UI must expose device music scanning");
assert.match(storage, /createObjectStore/, "Storage must create its IndexedDB object store");
assert.match(sw, /addAll\(APP_SHELL\)/, "Service worker must cache the app shell");
assert.match(css, /--bg:#151312;--panel:#1f1a18;--panel-2:#29221f;--line:#3a302b;[\s\S]*?--purple:#c1a398;--purple-strong:#8b6658;/, "The app palette should use the character-inspired cocoa, cream and muted terracotta colors");
assert.doesNotMatch(css, /#15171f|#272a34|#252833|#11131aee|#22242f|#20222c|#2d303b|#191b24|#2b2e39/i, "Main navigation and panels must not regress to the old blue-slate surfaces");
assert.match(css, /\.sidebar\{[^}]*background:#1a1512/s, "The sidebar must use the warm character-inspired dark surface");
assert.match(css, /\.topbar\{[^}]*background:#171310ee/s, "The top bar must use the matching warm dark surface");
assert.match(css, /\.character-companion\.is-playing img\{animation:ritmoCompanionWalk/, "The companion must animate while playing");
assert.match(css, /pointer-events:none/, "The decorative companion must never block player controls");
assert.match(css, /\.album-artwork\{[^}]*object-fit:cover/s, "Embedded artwork must cover its thumbnail without stretching");
assert.match(css, /\.library-album-art\.has-artwork:before[\s\S]*?display:none/, "Real library art should not be obscured by decorative placeholder vinyl rings");

assert.match(css, /prefers-reduced-motion:reduce\)[\s\S]*?character-companion\.is-playing img/, "The companion must respect reduced-motion preferences");
assert.match(appIcon, /stop-color="#c1a398"[\s\S]*?stop-color="#8b6658"/, "The installed app icon should use the same character-inspired palette");
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


assert.match(storage, /const DB_VERSION = 3/, "Storage schema should upgrade without deleting existing tracks");
assert.match(storage, /createObjectStore\(HISTORY/, "Storage should keep a persistent playback history");
assert.match(storage, /createObjectStore\(PLAYLISTS/, "Storage should persist playlists");
assert.match(app, /function renderHistory/, "The app should render recent playback history");
assert.match(app, /function renderPlaylists/, "The app should render named playlists");
assert.match(app, /function setupMediaSession/, "The app should expose mobile/system media controls");
assert.match(app, /if \(!useNativePlayer && state\.nativePlayback\.active\) \{\s*await stopNativePlayback\(\);\s*if \(!isCurrentPlaybackRequest\(\)\) return;\s*\}/, "A stale request must stop after awaiting the previous native session");
assert.match(app, /if \(state\.nativePlayback\.active\) \{\s*await stopNativePlayback\(\);\s*if \(!isCurrentPlaybackRequest\(\)\) return;\s*\}\s*let desiredEngine/, "A stale request must not replace the active engine after native shutdown");
assert.match(app, /const isNativeDirectStream = track\.kind === "url"/, "Direct audio URLs should try native Android playback when compatible");
assert.match(app, /const nativeUri = track\.nativeUri \|\| \(track\.kind === "url" \? track\.url : ""\)/, "Media3 must receive the direct audio URL");
assert.match(app, /forceWebPlayback: true/, "Native direct-stream errors must retain a browser playback fallback");
assert.match(app, /youtubeMediaPlaybackState = "playing"/, "Confirmed YouTube playback should update OS media state");
assert.match(app, /title: youtubeSession \? \(youtubeSession\.title \|\| "Video de YouTube"\)/, "YouTube playback must publish its title to Media Session");
assert.match(app, /youtubePlayer\?\.pauseVideo/, "OS pause actions should be routed to the official YouTube player");
assert.match(app, /if \(!key\) \{[\s\S]*?searchInvidiousYoutube\(query, \{ signal: abortController\.signal \}\)/, "Submitting YouTube search without an API key must try the in-app community search first");
assert.ok(app.includes("function fallbackToOfficialYoutubeSearch(query, message)"), "Community search fallback helper must be present");
assert.ok(app.includes('fallbackToOfficialYoutubeSearch(query, "Las instancias comunitarias de búsqueda no respondieron ('), "Native Android must automatically try the official search when all community mirrors fail");
assert.ok(app.includes("Tocá «Abrir búsqueda en YouTube» para continuar; no hace falta una clave API."), "Web users must have a clear no-key fallback");
assert.match(app, /instance recibió tu consulta|La instancia recibió tu consulta/, "The no-key search must disclose that the third-party instance receives the query");
assert.match(nativeMusicPluginSource, /file\.put\("persisted", persisted\)/, "Android picker must report when URI permission can be persisted");
assert.match(app, /if \(item\.persisted === true\)[\s\S]*nativeUri: uri,/, "Persistable Android selections must be stored as native tracks instead of copied into WebView blobs");
assert.match(app, /function renderFormatCapabilities/, "The app should report device audio format support");
assert.match(app, /const BATCH_SIZE = 20/, "Bulk imports should be saved in bounded batches");
assert.match(app, /function readMp3Tags/, "Basic MP3 ID3 tags should be parsed");
assert.match(app, /import \{ parseId3Tags, validateEmbeddedArtwork, MAX_EMBEDDED_ARTWORK_BYTES \}/, "Browser and native cover extraction must share the safe raster-image validator");
assert.match(app, /function decodeNativeArtworkBase64\(value, mimeType\)/, "Native cover bytes must be decoded under the same size limit");
assert.match(app, /validateEmbeddedArtwork\(bytes, mimeType\)/, "Native cover bytes must not bypass signature and dimension validation");

assert.match(app, /MAX_EMBEDDED_ARTWORK_BYTES/, "Embedded artwork reads must have a strict memory limit");
const id3ArtworkSource = fs.readFileSync(new URL("../src/id3-tags.js", import.meta.url), "utf8");
assert.match(id3ArtworkSource, /MAX_EMBEDDED_ARTWORK_DIMENSION = 4096[\s\S]*?MAX_EMBEDDED_ARTWORK_PIXELS = 8_388_608/, "Embedded covers must have pre-decode dimension and pixel-count limits");
assert.match(id3ArtworkSource, /hasSafePngDimensions[\s\S]*?hasSafeJpegDimensions/, "PNG and JPEG image dimensions must be checked before publishing cover bytes");

assert.match(id3ArtworkSource, /MAX_EMBEDDED_ARTWORK_DIMENSION = 4096[\s\S]*?MAX_EMBEDDED_ARTWORK_PIXELS = 8_388_608/, "Embedded covers must have pre-decode dimension and pixel-count limits");

assert.match(app, /function trackArtworkUrl\(track\)/, "Embedded album-art object URLs must be shared and managed");
assert.match(app, /metadata\.artwork instanceof Uint8Array[\s\S]*?new Blob\(\[meta\.artwork\]/, "Imported MP3 covers must persist in IndexedDB as local Blob data");
assert.match(app, /artwork: artworkUrl && track\?\.artworkBlob/, "Browser Media Session should use the real local artwork when available");
assert.match(app, /releaseUnusedArtworkObjectUrls\(\)/, "Removed or replaced artwork Blob URLs must be released");
assert.match(app, /track\?\.artworkInvalid === true/, "A browser-rejected cover must fall back to a placeholder");
assert.match(app, /document\.addEventListener\("error", event =>[\s\S]*?track\.artworkInvalid = true[\s\S]*?render\(\)/, "Broken artwork must be marked and not decoded repeatedly");
assert.match(app, /data-artwork-track/, "Album artwork decode errors must be attributed to their track");

assert.match(app, /track\?\.artworkInvalid === true/, "A browser-rejected cover must fall back to a placeholder");
assert.match(app, /document\.addEventListener\("error", event =>[\s\S]*?track\.artworkInvalid = true[\s\S]*?render\(\)/, "Broken artwork must be marked and not decoded repeatedly");
assert.match(app, /data-artwork-track/, "Album artwork decode errors must be attributed to their track");


assert.match(app, /YOUTUBE_SEARCH_CACHE_STORAGE/, "Recent YouTube result metadata should be cacheable for offline discovery");
assert.match(html, /id="history-view"/, "HTML must provide a history view");
assert.match(html, /id="playlists-view"/, "HTML must provide a playlist view");
assert.match(html, /id="format-capabilities"/, "HTML must expose audio format capabilities");
assert.match(html, /id="library-no-results"/, "Library search should expose a no-matches empty state");
assert.match(sw, /ritmo-shell-v81/, "Service worker cache must refresh for the new shell");
console.log("History, playlists, mobile controls, and offline format checks passed.");


assert.match(html, /id="settings-dialog"/, "Settings dialog should exist");
assert.match(html, /id="eq-enabled"/, "Audio settings must expose equalizer enable control");
assert.match(html, /id="eq-preset"/, "Audio settings must expose selectable equalizer presets");
for (const preset of ["clean", "piano", "classical", "orchestral", "cinematic", "electronic", "cyberpunk", "synthwave", "ambient", "game-anime", "experimental"]) {
  assert.match(html, new RegExp('option value="' + preset + '"'), "Settings UI must expose the " + preset + " sound profile");
}
assert.match(app, /presetName === "clean"/, "Clean mode must bypass EQ and limiter instead of merely setting gains to zero");
for (const id of ["eq-user-profiles", "eq-profile-name", "eq-profile-save", "eq-profile-delete"]) {
  assert.match(html, new RegExp('id="' + id + '"'), "Custom equalizer profile UI must expose " + id);
}
assert.match(app, /upsertSavedEqualizerProfile/, "Custom equalizer save must update the persisted profile collection");
assert.match(app, /removeSavedEqualizerProfile/, "Custom equalizer delete must remove only the selected saved profile");
assert.match(app, /normalizeSavedEqualizerProfiles\(saved\?\.userEqProfiles\)/, "Saved profile data must be normalized before restoring the selector");


assert.match(eqPresets, /clean:[\s\S]*flat:[\s\S]*piano:[\s\S]*classical:[\s\S]*orchestral:[\s\S]*cinematic:[\s\S]*acoustic:[\s\S]*pop:[\s\S]*rock:[\s\S]*jazz:[\s\S]*bass:[\s\S]*vocal:[\s\S]*electronic:[\s\S]*cyberpunk:[\s\S]*synthwave:[\s\S]*ambient:[\s\S]*"game-anime":[\s\S]*experimental:/, "Equalizer must provide its documented genre presets");
assert.match(app, /getEqualizerPreset\(presetName\)/, "Preset selection must apply a real equalizer profile");
assert.match(app, /audioPrefs\.eqPreset = "custom"/, "Manual slider changes must identify the setting as custom");
assert.match(html, /id="eq-bass"/, "Audio settings must expose bass adjustment");
assert.match(html, /id="eq-mid"/, "Audio settings must expose midrange adjustment");
assert.match(html, /id="eq-treble"/, "Audio settings must expose treble adjustment");
assert.match(html, /id="limiter-toggle"/, "Audio settings must expose soft peak limiting");
assert.match(html, /Media3 de Android no aplica este limitador/, "The UI must disclose that the soft limiter is not active in the native Android playback engine");
assert.match(app, /Media3 Android no ofrece este limitador/, "Changing the limiter must explain its native-engine limitation when relevant");
assert.match(app, /Modo limpio: ecualizador nativo desactivado\.[\s\S]*?Media3 Android no aplica el limitador suave/, "Clean mode must not claim to disable a limiter that the native engine does not implement");
assert.match(app, /Modo limpio activado: ecualizador y limitador apagados en el procesamiento Web Audio/, "Clean mode should explicitly confirm the real Web Audio bypass");


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
assert.match(sw, /ritmo-shell-v81/, "Service-worker cache must refresh after playback settings are added");
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


assert.match(html, /id="archive-search-form"/, "Online music view should expose open-license audio search");
assert.match(html, /id="archive-query"/, "Open-license search needs a user query");
assert.match(html, /id="archive-results"/, "Open-license search needs result cards");
assert.match(html, /id="archive-load-more"/, "Open-license search should support pagination");
assert.match(app, /https:\/\/archive\.org\/advancedsearch\.php/, "Open-license catalog should use Internet Archive's public search API");
assert.match(app, /licenseurl:http\*creativecommons\.org\*/, "Open-license query must filter for declared Creative Commons licensing");
assert.match(app, /https:\/\/archive\.org\/metadata\//, "Each open-license result must verify metadata before listing tracks");
assert.match(app, /function inspectArchiveItem/, "Catalog results must inspect license and files before offering them");
assert.match(app, /creativecommons\.org/, "The app must verify the declared Creative Commons license host");
assert.match(app, /function addArchiveFile/, "Catalog tracks should be addable to the local library as remote sources");
assert.match(app, /function archiveFileURL/, "Catalog file actions must link to the original archive host");
assert.match(app, /Descargar original/, "Catalog should provide the source's original-file link, not bypass its delivery rules");
assert.match(sw, /ritmo-shell-v81/, "Service-worker cache should refresh after adding the open-license catalog");
console.log("Internet Archive open-license search, metadata verification and original-file link smoke checks passed.");


assert.match(html, /id="archive-search-form"/, "Online view should expose open-license music search");
assert.match(html, /id="archive-query"/, "Open-license search needs a query input");
assert.match(html, /id="archive-results"/, "Open-license search needs result cards");
assert.match(html, /id="archive-load-more"/, "Open-license search should support pagination");
assert.match(app, /https:\/\/archive\.org\/advancedsearch\.php/, "Open-license search should use Internet Archive's public API");
assert.match(app, /licenseurl:http\*creativecommons\.org\*/, "Archive search must filter to declared Creative Commons metadata");
assert.match(app, /https:\/\/archive\.org\/metadata\//, "Archive results should verify item metadata before exposing audio");
assert.match(app, /function inspectArchiveItem/, "Archive cards must check audio item type and Creative Commons license");
assert.match(app, /function addArchiveFile/, "Verified Archive audio should be addable to the library");
assert.match(app, /function archiveFileURL/, "Original files should use Archive.org direct links");
assert.match(app, /Descargar original/, "Catalog should provide source-file navigation rather than bypass CORS");
assert.match(app, /track\.sourceProvider === "Internet Archive"/, "Archive tracks should open original files directly where binary servers don't provide CORS");
assert.match(sw, /ritmo-shell-v81/, "Service Worker cache should refresh with the open-license catalog");
console.log("Internet Archive catalog, license checks, source links and offline import guidance smoke checks passed.");


assert.match(app, /const \[tracksResult, historyResult, playlistsResult\] = await Promise\.allSettled/, "Startup must restore persisted tracks, history and playlists independently");
assert.match(app, /getHistory\(250\)/, "Startup should restore saved playback history");
assert.match(app, /getPlaylists\(\)/, "Startup should restore saved playlists");
assert.match(app, /showView\("online"\);\s*playYoutubeVideo\(button\.dataset\.historyYoutube/, "Replaying a YouTube history item should show its player view");
assert.match(app, /audioContext\.resume\(\)\.then/, "Suspended local EQ audio should attempt safe foreground recovery");
assert.match(storage, /request\.onblocked = \(\) => \{\s*wasBlocked = true;\s*if \(databasePromise === openingPromise\) databasePromise = null;/, "Blocked IndexedDB opens must clear the rejected single-flight promise");
assert.match(storage, /if \(wasBlocked\) \{\s*db\.close\(\)/, "Late IndexedDB success after a blocked error must close its abandoned connection");
assert.match(storage, /queueMicrotask\(\(\) => \{\s*if \(databasePromise === openingPromise\) databasePromise = null;/, "Synchronous IndexedDB open failures must clear the cached rejected promise");
console.log("Persistence restoration, IndexedDB retry, history navigation and audio foreground-recovery checks passed.");


assert.match(sw, /event\.waitUntil\(cacheWrite\)/, "Runtime cache writes should extend the service-worker fetch lifetime");
assert.match(sw, /\.catch\(\(\) => \{\}\)/, "Cache quota errors must not become unhandled promise rejections");
assert.match(sw, /const offlinePage = await caches\.match\("\.\/index\.html"\)/, "Offline navigation should return a cached document only when one exists");
console.log("Service-worker cache lifetime and storage-error checks passed.");

assert.doesNotMatch(app, /defaultAudio\.volume = 0\.8;\s*equalizedAudio\.volume = 0\.8;/, "Startup must not overwrite the saved volume or mute preference");
assert.match(app, /setOutputVolume\(audioPrefs\.volume\)/, "Startup should apply the persisted volume through the shared engine-aware controller");
assert.match(app, /function releaseUnusedObjectURLs/, "The player should release object URLs for tracks that are no longer active");
assert.match(app, /releaseUnusedObjectURLs\(isLocal\(track\) \? track\.id : null\)/, "Track changes should retain a blob URL only for the active local track");
assert.match(importFingerprint, /export function importedFileFingerprint/, "Import deduplication should expose a reusable path-aware fingerprint module");
assert.match(app, /import \{[^}]*\bimportedFileFingerprint\b[^}]*\} from "\.\/import-fingerprint\.js"/, "The app should use the shared import fingerprint module");
assert.match(app, /function nativeEqualizerPayload\(\)/, "Native playback must share saved equalizer settings with Media3");
assert.match(app, /setEqualizer: invoke\("setEqualizer"\)/, "The UI must update the Android EQ without switching engines");
assert.match(importFingerprint, /source\.webkitRelativePath \|\| source\.sourcePath/, "Folder imports should distinguish identical filenames in different folders");
assert.match(app, /sourcePath: file\.webkitRelativePath \|\| file\.name/, "Imported tracks should persist their relative source path");
console.log("Second-pass regressions passed: persisted volume, object-URL lifecycle, and folder-import identity.");

assert.match(app, /const previousFavorite = track\.favorite;\s*track\.favorite = !previousFavorite;\s*try \{\s*await saveTrack\(track\);/, "Favorite edits should preserve a rollback value before persisting");
assert.match(app, /catch \(error\) \{\s*track\.favorite = previousFavorite;\s*render\(\);\s*updatePlayerFavorite\(\);/, "A failed favorite write must restore the previously persisted value in memory and UI");
assert.match(app, /list\.trackIds = previousTrackIds;\s*list\.updatedAt = previousUpdatedAt;\s*renderPlaylists\(\);/, "Failed playlist writes must restore both membership and modification timestamp");
assert.match(app, /const currentVolume = Number\(\$\("#volume-bar"\)\.value\);\s*const fadedVolume = currentVolume \* Math\.max\(0, 1 - step \/ steps\)/, "The sleep fade must use the current slider value instead of a stale volume captured when the timer started");
assert.match(app, /const restoredVolume = Number\(\$\("#volume-bar"\)\.value\);\s*setOutputVolume\(restoredVolume\);/, "Sleep-timer completion must restore any volume change made while it was running through both output engines");
assert.match(app, /const visibleLibraryTracks = sortedForView\("library"\);/, "Library rendering should reuse the filtered track list when deciding empty-state visibility");
assert.match(app, /library-no-results/, "The app should show a distinct empty state when the library search has no matches");
assert.match(app, /visibleLibraryTracks\.length === 0/, "No-match state should only appear when a non-empty library query has zero results");
console.log("Third-pass regressions passed: failed-storage rollback, live sleep-timer volume, and empty library search state.");

assert.match(app, /let playbackRequestId = 0;[\s\S]*let youtubeSearchRequestId = 0;[\s\S]*let archiveSearchRequestId = 0;/, "Async playback and both online searches must track the latest request");
assert.match(app, /async function playTrack\(trackId, autoplay = true, options = \{\}\) \{[\s\S]*const isCurrentPlaybackRequest = \(\) => requestId === playbackRequestId;/, "Playback requests need a unique identity");
assert.match(app, /if \(autoplay\) await audio\.play\(\);\s*if \(!isCurrentPlaybackRequest\(\)\) return;/, "A superseded play() promise must not update the newer track state");
assert.match(app, /function playYoutubeVideo[\s\S]*cancelPendingPlaybackIntent\(\);/, "Starting YouTube playback must invalidate pending native-audio requests");
assert.match(app, /const query = pageToken \? state\.youtubeQuery : \$\("#youtube-query"\)\.value\.trim\(\);/, "YouTube pagination must use the query that created its page token");
assert.match(app, /const isCurrentYoutubeSearch = \(\) => requestId === youtubeSearchRequestId;/, "YouTube search responses must be associated with the latest request");
assert.match(app, /youtubeSearchAbortController\?\.abort\(\)/, "A new YouTube search must cancel obsolete network requests");
assert.match(app, /youtube\/v3\/search\?" \+ params\.toString\(\), \{ signal: abortController\.signal \}/, "The primary YouTube search request must be abortable");
assert.match(app, /annotateYoutubeVideoStatus\(rawItems, key, abortController\.signal\)/, "The follow-up video-status request must share the same abort signal");
assert.match(app, /youtube\/v3\/videos\?" \+ params\.toString\(\), \{ signal \}/, "The status lookup must pass its abort signal to fetch");
assert.match(app, /error\?\.name !== "AbortError"/, "Superseded searches must not show cancellation as a user-facing error");
assert.match(app, /loadButton\.disabled = true;[\s\S]*?loadButton\.disabled = false;/, "Pagination must be disabled while results are being fetched");
assert.match(app, /if \(!isCurrentYoutubeSearch\(\)\) return;/, "Stale YouTube responses must not overwrite newer results");
assert.match(app, /const isCurrentArchiveSearch = \(\) => requestId === archiveSearchRequestId;/, "Internet Archive searches must be associated with the latest request");
assert.match(app, /if \(!isCurrentArchiveSearch\(\)\) return;/, "Stale archive responses must not overwrite newer results");
assert.match(app, /if \(isCurrentYoutubeSearch\(\)\) \{\s*button\.disabled = false;/, "Older YouTube search finally blocks must not unlock a newer active search");
assert.match(app, /if \(isCurrentArchiveSearch\(\)\) \{\s*button\.disabled = false;/, "Older archive search finally blocks must not unlock a newer active search");
assert.match(storage, /export async function deleteTrackAndPrunePlaylists\(trackId\) \{[\s\S]*db\.transaction\(\[TRACKS, PLAYLISTS\], "readwrite"\)/, "Deleting a track and pruning playlists should share one atomic IndexedDB transaction");
assert.match(storage, /trackIds: trackIds\.filter\(id => id !== trackId\)/, "Atomic track deletion should remove the deleted ID from every affected playlist");
assert.match(app, /await deleteTrackAndPrunePlaylists\(track\.id\)/, "The library UI should use the atomic delete-and-prune operation");
assert.doesNotMatch(app, /await deleteTrack\(track\.id\)[\s\S]*for \(const list of state\.playlists\) await savePlaylist\(list\)/, "Track deletion should not update playlists in separate transactions");
console.log("Fourth-pass regressions passed: async audio switching, latest-query-wins, and atomic deletion from playlists.");

assert.match(storage, /A helper callback can throw after it has already queued a write\.[\s\S]*tx\.abort\(\)/, "A synchronous storage callback failure must abort any queued writes");
assert.match(app, /async function removeCurrent\(\) \{\s*\/\/[\s\S]*cancelPendingPlaybackIntent\(\);/, "Removing a selected track must invalidate any pending play request");
assert.match(app, /function resumeCurrentTrack\(\) \{[\s\S]*playTrack\(track\.id, true, \{ keepQueue: true, resumeAt: position, skipHistory: true \}\);/, "Resume actions must pass through request-aware track selection");
assert.match(app, /schedulePlaybackPositionRestore\(targetEngine, options\.resumeAt, \{[\s\S]*isCurrentRequest: isCurrentPlaybackRequest,[\s\S]*isActiveElement: element => element === audio/, "Deferred seeking must verify the playback request and active media element");
assert.match(app, /function cancelPendingPlaybackPositionRestore\(\)[\s\S]*cancel\?\.\(\);/, "Track switches and pauses must cancel old metadata-seek listeners");
assert.match(playbackPosition, /if \(!isCurrentRequest\(\) \|\| !isActiveElement\(element\)\) return;/, "The position helper must ignore stale requests and inactive engines");
assert.match(app, /normalizeSavedAudioLevel\(saved\?\.volume, DEFAULT_AUDIO_PREFS\.volume\)/, "Invalid saved volume must use the safe default instead of becoming zero");
assert.match(app, /normalizeSavedAudioLevel\(saved\?\.lastAudibleVolume, DEFAULT_AUDIO_PREFS\.lastAudibleVolume, 0\.01\)/, "Last audible level must be validated and remain above mute");
assert.match(audioPreferences, /value === null \|\| value === undefined[\s\S]*typeof value === "string" && value\.trim\(\) === ""/, "Corrupt null and blank levels must be treated as damaged, not intentional zero");
assert.match(app, /function cancelPendingPlaybackIntent\(\) \{\s*playbackRequestId \+= 1;\s*pendingPlaybackRequestId = null;/, "Pausing must invalidate pending play requests and clear their intent");
assert.match(app, /function pauseCurrentTrack\(\) \{[\s\S]*cancelPendingPlaybackIntent\(\);[\s\S]*state\.nativePlayback\.active[\s\S]*nativePlaybackPlugin\(\)\?\.pause\(\)[\s\S]*else audio\.pause\(\);/, "Explicit pause must cancel async playback and pause the active HTML or Media3 engine");
assert.match(app, /pendingPlaybackRequestId = autoplay \? requestId : null;/, "Autoplay requests must expose their pending intent before asynchronous setup");
assert.match(app, /pendingPlaybackRequestId !== null \|\| !playbackIsPaused\(\)\) pauseCurrentTrack\(\);/, "The play button must cancel in-flight requests even while the selected engine reports paused");
assert.match(app, /play: \(\) => resumeCurrentTrack\(\), pause: \(\) => pauseCurrentTrack\(\), stop: \(\) => pauseCurrentTrack\(\)/, "Media Session pause/stop must use the same request cancellation logic");
assert.match(app, /cancelPendingPlaybackIntent\(\);\s*pauseCurrentTrack\(\);/, "Sleep fade completion must invalidate requests and stop whichever playback engine is active");
assert.match(app, /if \(state\.repeat === "one"\) \{ element\.currentTime = 0; resumeCurrentTrack\(\); \}/, "Repeat-one restart must use the request-aware player");
console.log("Fifth-pass regressions passed: service-worker cache invalidation, abortable writes and request-safe resume/removal.");

assert.ok(validateWorkflow.includes("actions/checkout@v7"), "Validation should use a checkout action compatible with the retired Node 20 runtime");
assert.ok(validateWorkflow.includes("actions/setup-node@v7"), "Validation should use setup-node's supported Node 24 runtime");
assert.ok(deployWorkflow.includes("actions/checkout@v7"), "Deployment should use a checkout action compatible with the retired Node 20 runtime");
assert.ok(deployWorkflow.includes("actions/configure-pages@v6"), "Pages configuration should use the supported Node 24 action");
assert.ok(deployWorkflow.includes("actions/deploy-pages@v5"), "Pages deployment should use the supported Node 24 action");
console.log("GitHub Actions Node 24 compatibility checks passed.");

assert.match(app, /createYoutubeHistoryController/, "YouTube history must be gated by confirmed playback state");
assert.doesNotMatch((app.match(/function playYoutubeVideo[\s\S]*?function updateYoutubeKeyStatus/) || [""])[0], /addHistoryEntry\(/, "Selecting a YouTube result must not directly write history");
assert.match(app, /onStateChange: recordConfirmedYoutubePlayback/, "The official YouTube player API must observe state changes");
assert.match(app, /eventState === window\.YT\.PlayerState\.PLAYING[\s\S]*youtubeHistory\.recordPlaying\(actualVideoId\)/, "YouTube history must only record confirmed PLAYING events for the selected video");
assert.match(sw, /src\/youtube-history\.js/, "The imported YouTube history controller must be cached for offline app-shell loading");
console.log("YouTube history is bound to confirmed playback-state events.");

assert.match(html, /id="library-grid"/, "Library should provide a visual album-card grid");
assert.match(html, /data-library-mode="grid"/, "Library should expose the grid/list presentation toggle");
assert.match(html, /id="now-playing-dialog"/, "The app should provide an immersive expanded now-playing view");
assert.match(html, /id="expanded-seek-bar"/, "Expanded player must include a functional seek control");
assert.match(app, /function renderLibraryGrid\(/, "The visual library should render track artwork cards");
assert.match(app, /function setLibraryMode\(/, "Library presentation changes must be handled by a stateful control");
assert.match(app, /expanded-volume-bar[\s\S]*?dispatchEvent\(new Event\("input"/, "Expanded volume control must route through the standard persisted volume handler");
assert.match(sw, /ritmo-shell-v81/, "Service-worker shell cache must refresh for the interface redesign");
console.log("Library grid/list, immersive playback, and synchronized expanded controls passed.");

assert.match(app, /button\.tagName !== "BUTTON" && \(event\.key === "Enter" \|\| event\.key === " "\)/, "Native play buttons must not manually replay their own keyboard activation");
assert.match(sw, /ritmo-shell-v81/, "PWA shell cache must refresh for the keyboard activation fix");


assert.match(html, /id="app-update-banner"/, "PWA should announce when an updated controller is taking over an already-controlled page");
assert.match(html, /id="app-update-now"/, "PWA update notice must provide a deliberate reload action");
assert.match(app, /const hadController = Boolean\(navigator\.serviceWorker\.controller\)/, "First-ever service worker installation should not be mistaken for an app update");
assert.match(app, /if \(hadController && !updatePromptShown\) \{[\s\S]*?updatePromptShown = true;[\s\S]*?\$\("#app-update-banner"\)\.hidden = false;/, "PWA update prompt should be shown only once after an actual controller replacement");
assert.match(app, /app-update-now[\s\S]*?window\.location\.reload\(\)/, "The update action must reload the page to synchronize its HTML and JavaScript");
assert.match(app, /setOutputVolume\(audioPrefs\.volume\);\s*\$\("#expanded-volume-bar"\)\.value = String\(audioPrefs\.volume\)/, "Mute/unmute must route through the shared output volume controller and keep the expanded slider in sync");
assert.match(sw, /ritmo-shell-v81/, "PWA shell cache should advance with the update prompt and mute sync fixes");
console.log("PWA update prompt and expanded mute synchronization checks passed.");


assert.match(storage, /export async function saveManyTracks\(tracks\) \{[\s\S]*?catch \(error\) \{[\s\S]*?operationError = error;[\s\S]*?tx\.abort\(\)/, "Bulk imports must abort a transaction if a synchronous put() fails after earlier writes were queued");
console.log("Atomic bulk-import rollback smoke check passed.");


assert.match(app, /createAudioOutputVolumeController/, "Audio output level should use the tested cross-engine volume controller");
assert.match(app, /const outputGain = audioContext\.createGain\(\)/, "Web Audio EQ graph must have a dedicated master output GainNode");
assert.match(app, /compressor\.connect\(outputGain\);\s*outputGain\.connect\(audioContext\.destination\)/, "EQ master gain must sit after compression and before the audio destination");
assert.match(audioVolume, /equalizedAudio\.volume = 1/, "Processed playback must avoid double attenuation by setting the media element to unity");
assert.match(sw, /src\/audio-output-volume\.js/, "The volume controller module must be precached for offline imports");
console.log("Cross-browser AudioContext volume wiring smoke checks passed.");


assert.match(sw, /const preferNetwork = request\.mode === "navigate"[\s\S]*?\["document", "script", "style", "manifest"\]\.includes\(request\.destination\)/, "Navigations and unversioned shell assets must prefer the network to prevent stale cache-first behavior");
assert.match(sw, /if \(!preferNetwork\) \{\s*const cached = await caches\.match\(request\);\s*if \(cached\) return cached;/, "Non-shell resources should retain cache-first behavior");
assert.match(sw, /catch \{\s*\/\/ Network-first resources still fall back[\s\S]*?const cached = await caches\.match\(request\);\s*if \(cached\) return cached;/, "Network-first requests must fall back to the cached resource when offline");
console.log("Network-first service-worker policy smoke checks passed.");


assert.ok(app.includes('import { clearMediaSession, clearMediaSessionPositionState } from "./media-session-state.js";'), "Media Session cleanup must use the tested helpers");
assert.ok(app.includes('if (!track && !youtubeSession && !spotifySession) { clearMediaSession(navigator.mediaSession, state); return; }'), "Media metadata should clear only when no local, YouTube, or Spotify media is active");
const removeCurrentStart = app.indexOf("async function removeCurrent()");
const removeCurrentEnd = app.indexOf("\nasync function addStream", removeCurrentStart);
assert.ok(removeCurrentStart >= 0 && removeCurrentEnd > removeCurrentStart, "Current-track removal handler must exist");
assert.ok(app.slice(removeCurrentStart, removeCurrentEnd).includes("state.currentId = null;\n  updatePlayer();\n  updateMediaSession();"), "Removing the active track must clear the system media session");
const youtubeStart = app.indexOf("function playYoutubeVideo");
const youtubeEnd = app.indexOf("\nfunction updateYoutubeKeyStatus", youtubeStart);
assert.ok(youtubeStart >= 0 && youtubeEnd > youtubeStart, "YouTube player transition handler must exist");
assert.ok(app.slice(youtubeStart, youtubeEnd).includes("state.currentId = null;\n  state.queueIds = null;\n  updatePlayer();\n  updateMediaSession();"), "Switching to YouTube must not retain metadata from the previous native track");
console.log("Media Session cleanup integration checks passed.");


assert.match(app, /onError: event =>/ , "YouTube IFrame Player errors must be observed");
assert.match(app, /readableYoutubePlayerError\(event\.data\)/, "YouTube player failures must show mapped, actionable errors");
assert.match(app, /onAutoplayBlocked: \(\) =>/, "Browser-blocked YouTube autoplay must be announced with a manual fallback");
assert.match(app, /frame\.referrerPolicy = "strict-origin-when-cross-origin"/, "YouTube iframe navigation should request an origin referrer for API client identification");
assert.match(youtubePlayerErrors, /\[153,/, "YouTube error 153 must have a dedicated diagnostic");
assert.match(sw, /src\/youtube-player-errors\.js/, "YouTube error diagnostics must be available offline with the application shell");
console.log("YouTube playback error recovery checks passed.");


// The settings diagnostics must expose real Service Worker registration state, not API presence alone.
assert.match(app, /function serviceWorkerDiagnosticStatus\(\)/, "Service Worker diagnostics should report runtime registration state");
assert.match(app, /registration\.active\s*\?\s*"Registrado y activo"/, "The diagnostics should distinguish an active registration");
assert.match(app, /serviceWorkerStatus = "Error de registro; modo sin conexión no garantizado"/, "Registration failures must be visible");
assert.doesNotMatch(app, /navigator\.serviceWorker\.register\("\.\/sw\.js"\)\.catch\(\(\) => \{\}\)/, "Registration failures must not be silently swallowed");
assert.match(html, /class="storage-picker-note"/, "Android folder-access restrictions must be explained beside the picker");

assert.match(app, /createAsyncGenerationGate/, "Native playback polling must use a generation-safe in-flight gate");
assert.match(sw, /src\/async-generation-gate\.js/, "The offline shell must cache the async generation gate module");
assert.match(asyncGenerationGate, /function finish\(candidate\)[\s\S]*?isCurrent\(candidate\)[\s\S]*?inFlightGeneration === candidate/, "A stale completion must not clear a newer generation slot");

assert.ok(html.includes('id="spotify-embed-form"'), "Online view must allow loading an official Spotify embed without a Web API key");
assert.ok(html.includes('id="spotify-embed-mount"'), "Spotify iframe API must have a dedicated safe mount");
assert.ok(html.includes('id="radio-search-form"'), "Online view must include public radio search without a user API key");
assert.ok(app.includes("parseSpotifyShareLink"), "Spotify links must be validated instead of trusting arbitrary iframe HTML");
assert.ok(app.includes("open.spotify.com/oembed"), "Spotify embed metadata should use Spotify's public oEmbed endpoint");
assert.ok(app.includes("searchRadioBrowser(query, filter"), "Public radio search must use the no-key Radio Browser directory");
assert.ok(app.includes("radioStationClickUrl(station.stationuuid)"), "Radio Browser playback should signal station starts");
assert.ok(app.includes("stopSpotifyEmbed({ preserveSaved: true, refresh: false })"), "Starting another source must stop Spotify audio to avoid overlap");
assert.ok(sw.includes("./src/online-services.js"), "New online-source code must be cached in the offline shell");
assert.ok(sw.includes("ritmo-shell-v81"), "PWA cache must be refreshed for app-level network mode");
console.log("Spotify official embed and keyless radio directory integration checks passed.");

assert.ok(html.includes('id="network-mode-toggle"'), "The app must expose a single explicit Internet/offline mode toggle");
assert.ok(html.includes('id="network-locked-note"'), "Unavailable online features must explain their lock state");
assert.ok(html.includes('id="online-nav-lock"'), "The online navigation entry must show a lock when network features are unavailable");
assert.ok(html.includes("Radio por altavoz"), "The radio screen must explain speaker playback and its internet requirement");
assert.match(app, /function setNetworkModeEnabled\(enabled\)/, "The network mode must be controlled by one persisted state transition");
assert.match(app, /if \(!isLocal\(track\) && !requireInternetMode\("reproducir esta fuente online"\)\) return;/, "A saved streaming URL must not bypass offline mode");
assert.match(css, /\.network-mode-toggle\[data-mode="offline"\]/, "Offline mode must use its distinct violet visual state");
assert.match(css, /\.network-mode-toggle\{[^}]*#ffd078[^}]*#ff9141/s, "Internet mode must use a visible orange visual state");

