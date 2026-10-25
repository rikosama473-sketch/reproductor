#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const syntaxChecks = [
  "src/app.js",
  "src/concurrent-map.js",
  "src/library-search.js",
  "src/library-filters.js",
  "src/native-track-metadata.js",
  "src/native-track-scan.js",
  "src/ui-sounds.js",
  "src/voice-studio.js",
  "src/youtube-history.js",
  "src/audio-output-volume.js",
  "src/media-session-state.js",
  "src/equalizer-presets.js",
  "src/import-fingerprint.js",
  "src/id3-tags.js",
  "src/vorbis-comments.js",
  "src/wav-info-tags.js",
  "src/audio-converter.js",
  "src/async-generation-gate.js",
  "src/playback-position.js",
  "src/audio-preferences.js",
  "src/youtube-player-errors.js",
  "src/online-services.js",
  "src/storage.js",
  "src/playlist-editing.js",
  "src/character-companion.js",
  "src/music-recognition.js",
  "src/music-finder-ui.js",
  "src/backup.js",
  "src/backup-ui.js",
  "src/external-navigation.js",
  "sw.js",
  "scripts/validate.mjs",
  "scripts/concurrent-map-check.mjs",
  "scripts/ui-sounds-check.mjs",
  "scripts/voice-studio-check.mjs",
  "scripts/smoke-check.mjs",
  "scripts/concurrent-map-check.mjs",
  "scripts/library-search-check.mjs",
  "scripts/library-filters-check.mjs",
  "scripts/native-track-metadata-check.mjs",
  "scripts/native-track-scan-check.mjs",
  "scripts/native-track-metadata-check.mjs",
  "scripts/native-track-scan-check.mjs",
  "scripts/character-companion-check.mjs",
  "scripts/external-navigation-check.mjs",
  "scripts/indexeddb-recovery-check.mjs",
  "scripts/youtube-history-check.mjs",
  "scripts/audio-output-volume-check.mjs",
  "scripts/media-session-state-check.mjs",
  "scripts/equalizer-presets-check.mjs",
  "scripts/import-fingerprint-check.mjs",
  "scripts/id3-tags-check.mjs",
  "scripts/wav-info-tags-check.mjs",
  "scripts/audio-converter-check.mjs",
  "scripts/audio-converter-ui-check.mjs",
  "scripts/async-generation-gate-check.mjs",
  "scripts/playback-position-check.mjs",
  "scripts/audio-preferences-check.mjs",
  "scripts/youtube-player-errors-check.mjs",
  "scripts/online-services-check.mjs",
  "scripts/music-recognition-check.mjs",
  "scripts/music-finder-pagination-check.mjs",
  "scripts/backup-check.mjs",
  "scripts/prepare-mobile.mjs",
  "scripts/mobile-package-check.mjs",
  "scripts/platform-separation-check.mjs",
  "mobile/scripts/prepare-web.mjs",
  "mobile/scripts/configure-android.mjs",
  "mobile/scripts/prepare-native.mjs",
  "desktop/scripts/prepare.mjs",
  "desktop/scripts/serve.mjs",
  "desktop/scripts/static-server.mjs",
  "desktop/electron/main.mjs",
  "desktop/scripts/desktop-package-check.mjs",
  "desktop/scripts/verify-release.mjs",
  "scripts/mobile-touch-check.mjs",
  "scripts/configure-android.mjs",
  "scripts/prepare-android-native.mjs",
  "scripts/android-music-library-check.mjs",
  "scripts/service-worker-fetch-check.mjs",
  "scripts/history-limit-check.mjs",
  "desktop/scripts/desktop-package-check.mjs"
];
const regressionSuites = [
  "scripts/smoke-check.mjs",
  "scripts/library-search-check.mjs",
  "scripts/library-filters-check.mjs",
  "scripts/playlist-editing-check.mjs",
  "scripts/character-companion-check.mjs",
  "scripts/external-navigation-check.mjs",
  "scripts/indexeddb-recovery-check.mjs",
  "scripts/youtube-history-check.mjs",
  "scripts/audio-output-volume-check.mjs",
  "scripts/media-session-state-check.mjs",
  "scripts/equalizer-presets-check.mjs",
  "scripts/ui-sounds-check.mjs",
  "scripts/id3-tags-check.mjs",
  "scripts/vorbis-comments-check.mjs",
  "scripts/wav-info-tags-check.mjs",
  "scripts/audio-converter-check.mjs",
  "scripts/audio-converter-ui-check.mjs",
  "scripts/voice-studio-check.mjs",
  "scripts/import-fingerprint-check.mjs",
  "scripts/async-generation-gate-check.mjs",
  "scripts/playback-position-check.mjs",
  "scripts/audio-preferences-check.mjs",
  "scripts/youtube-player-errors-check.mjs",
  "scripts/online-services-check.mjs",
  "scripts/music-recognition-check.mjs",
  "scripts/music-finder-pagination-check.mjs",
  "scripts/backup-check.mjs",
  "scripts/prepare-mobile.mjs",
  "scripts/mobile-package-check.mjs",
  "scripts/platform-separation-check.mjs",
  "scripts/mobile-touch-check.mjs",
  "scripts/android-music-library-check.mjs",
  "scripts/service-worker-fetch-check.mjs",
  "scripts/history-limit-check.mjs"
];

function run(label, args) {
  console.log("\n=== " + label + " ===");
  const result = spawnSync(process.execPath, args, { cwd: projectRoot, stdio: "inherit", env: process.env });
  if (result.error) {
    console.error("Could not start " + label + ":", result.error);
    process.exit(1);
  }
  if (result.status !== 0) {
    if (result.signal) console.error(label + " terminated by signal " + result.signal);
    else console.error(label + " failed with exit code " + result.status);
    process.exit(result.status || 1);
  }
}

for (const file of syntaxChecks) run("Syntax: " + file, ["--check", file]);
for (const suite of regressionSuites) run("Regression: " + suite, [suite]);
console.log("\nRitmo validation complete: all syntax checks and regression suites passed.");
