import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { VOICE_PRESETS } from "../src/voice-studio.js";

const root = new URL("../", import.meta.url);
const [html, app, sw, prepare, mobileCheck, moduleSource] = await Promise.all([
  readFile(new URL("index.html", root), "utf8"),
  readFile(new URL("src/app.js", root), "utf8"),
  readFile(new URL("sw.js", root), "utf8"),
  readFile(new URL("scripts/prepare-mobile.mjs", root), "utf8"),
  readFile(new URL("scripts/mobile-package-check.mjs", root), "utf8"),
  readFile(new URL("src/voice-studio.js", root), "utf8")
]);

assert.deepEqual(Object.keys(VOICE_PRESETS), ["anime", "kawaii", "shonen", "tsundere", "chibi", "mysterious", "narrator", "robot", "rap", "custom"]);
for (const [key, preset] of Object.entries(VOICE_PRESETS)) {
  assert.ok(preset.label && preset.description, key + " must explain its voice profile");
  assert.ok(preset.pitch >= 0.5 && preset.pitch <= 2, key + " pitch must be bounded");
  assert.ok(preset.rate >= 0.6 && preset.rate <= 1.8, key + " rate must be bounded");
}
assert.match(html, /id="voices-view"/);
assert.match(html, /data-view="voices"/);
assert.match(html, /id="voice-preset-grid"/);
assert.match(html, /id="voice-system-voice"/);
assert.match(html, /id="voice-preview-play"/);
assert.match(html, /id="voice-preview-stop"/);
assert.match(html, /id="voice-pause-music"[^>]*checked/);
assert.match(html, /src=["']\.\/src\/voice-studio\.js["']/);
assert.match(app, /ritmo:voice-preview-start/);
assert.match(app, /ritmo:voice-preview-end/);
assert.match(app, /snapshot\.requestId !== playbackRequestId/);
assert.match(moduleSource, /speechSynthesis/);
assert.match(moduleSource, /voiceschanged/);
assert.match(moduleSource, /ritmo:voice-preview-start/);
assert.match(moduleSource, /ritmo:voice-preview-end/);
assert.match(moduleSource, /previewSessionNotified/);
assert.match(moduleSource, /pauseMusic: pauseMusicInput\.checked/);
assert.doesNotMatch(moduleSource, /\bfetch\s*\(/);
assert.match(sw, /ritmo-shell-v57/);
assert.match(sw, /\.\/src\/voice-studio\.js/);
assert.match(prepare, /src\/voice-studio\.js/);
assert.match(mobileCheck, /src\/voice-studio\.js/);
console.log("Voice studio checks passed: ten tuning presets, installed voice discovery, bounded pitch/speed and pause/resume integration.");
