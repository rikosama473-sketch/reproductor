#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const syntaxChecks = [
  "src/app.js",
  "src/youtube-history.js",
  "src/audio-output-volume.js",
  "src/media-session-state.js",
  "src/equalizer-presets.js",
  "src/import-fingerprint.js",
  "src/async-generation-gate.js",
  "src/youtube-player-errors.js",
  "src/online-services.js",
  "src/storage.js",
  "src/character-companion.js",
  "src/external-navigation.js",
  "sw.js",
  "scripts/validate.mjs",
  "scripts/smoke-check.mjs",
  "scripts/character-companion-check.mjs",
  "scripts/external-navigation-check.mjs",
  "scripts/external-navigation-check.mjs",
  "scripts/indexeddb-recovery-check.mjs",
  "scripts/youtube-history-check.mjs",
  "scripts/audio-output-volume-check.mjs",
  "scripts/media-session-state-check.mjs",
  "scripts/equalizer-presets-check.mjs",
  "scripts/import-fingerprint-check.mjs",
  "scripts/async-generation-gate-check.mjs",
  "scripts/youtube-player-errors-check.mjs",
  "scripts/online-services-check.mjs",
  "scripts/prepare-mobile.mjs",
  "scripts/mobile-package-check.mjs",
  "scripts/mobile-touch-check.mjs",
  "scripts/configure-android.mjs",
  "scripts/prepare-android-native.mjs",
  "scripts/android-music-library-check.mjs",
  "scripts/service-worker-fetch-check.mjs",
  "scripts/history-limit-check.mjs"
];
const regressionSuites = [
  "scripts/smoke-check.mjs",
  "scripts/character-companion-check.mjs",
  "scripts/indexeddb-recovery-check.mjs",
  "scripts/youtube-history-check.mjs",
  "scripts/audio-output-volume-check.mjs",
  "scripts/media-session-state-check.mjs",
  "scripts/equalizer-presets-check.mjs",
  "scripts/import-fingerprint-check.mjs",
  "scripts/async-generation-gate-check.mjs",
  "scripts/youtube-player-errors-check.mjs",
  "scripts/online-services-check.mjs",
  "scripts/prepare-mobile.mjs",
  "scripts/mobile-package-check.mjs",
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
