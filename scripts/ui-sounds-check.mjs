import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { UI_SOUND_PACKS, normalizeUiSoundPreferences, DEFAULT_UI_SOUND_PREFERENCES } from "../src/ui-sounds.js";

assert.deepEqual(Object.keys(UI_SOUND_PACKS), ["piano", "punk", "cyber", "wood", "glass", "retro", "warm", "minimal"]);
for (const [key, pack] of Object.entries(UI_SOUND_PACKS)) {
  assert.ok(pack.label, key + " has a visible label");
  assert.ok(pack.description, key + " explains its sound");
}
assert.deepEqual(normalizeUiSoundPreferences(null), { enabled: false, pack: "piano", volume: 24 });
assert.equal(DEFAULT_UI_SOUND_PREFERENCES.enabled, false);
assert.deepEqual(normalizeUiSoundPreferences({ enabled: true, pack: "punk", volume: 45 }), { enabled: true, pack: "punk", volume: 45 });
assert.deepEqual(normalizeUiSoundPreferences({ enabled: "true", pack: "unknown", volume: 150 }), { enabled: false, pack: "piano", volume: 100 });
assert.deepEqual(normalizeUiSoundPreferences({ enabled: true, pack: "glass", volume: -20 }), { enabled: true, pack: "glass", volume: 0 });
assert.deepEqual(normalizeUiSoundPreferences({ enabled: true, pack: "wood", volume: 38.6 }), { enabled: true, pack: "wood", volume: 39 });

const root = new URL("../", import.meta.url);
const [html, sw, prepare, mobileCheck, moduleSource] = await Promise.all([
  readFile(new URL("index.html", root), "utf8"),
  readFile(new URL("sw.js", root), "utf8"),
  readFile(new URL("scripts/prepare-mobile.mjs", root), "utf8"),
  readFile(new URL("scripts/mobile-package-check.mjs", root), "utf8"),
  readFile(new URL("src/ui-sounds.js", root), "utf8")
]);
for (const selector of ["ui-sounds-enabled", "ui-sounds-pack", "ui-sounds-volume", "ui-sounds-preview"]) {
  assert.match(html, new RegExp('id="' + selector + '"'));
}
for (const snippet of [
  '<option value="piano">Piano clásico</option>', '<option value="punk">Punk / rock suave</option>',
  '<option value="cyber">Cibernético</option>', '<option value="wood">Madera suave</option>',
  '<option value="glass">Cristal delicado</option>', '<option value="retro">Retro 8-bit</option>',
  '<option value="warm">Sintetizador cálido</option>', '<option value="minimal">Clic minimalista</option>'
]) assert.ok(html.includes(snippet), "Missing sound selector option: " + snippet);
assert.match(html, /id="ui-sounds-volume"[^>]*max="100"[^>]*value="24"/);
assert.match(html, /src=["']\.\/src\/ui-sounds\.js["']/);
assert.match(sw, /ritmo-shell-v46/);
assert.match(sw, /\.\/src\/ui-sounds\.js/);
assert.match(prepare, /src\/ui-sounds\.js/);
assert.match(mobileCheck, /src\/ui-sounds\.js/);
assert.match(moduleSource, /MAX_OUTPUT_GAIN = 0\.045/);
assert.match(moduleSource, /MUSIC_DUCK_FACTOR = 0\.15/);
assert.match(moduleSource, /MIN_SOUND_INTERVAL_MS = 75/);
assert.match(moduleSource, /iframe\[src\*="youtube\.com\/embed"\]/);
assert.match(moduleSource, /event\.isTrusted/);
assert.match(moduleSource, /ritmo\.ui-sounds\.v2/);
assert.match(moduleSource, /LEGACY_STORAGE_KEY = "ritmo\.ui-sounds\.v1"/);
assert.match(moduleSource, /JSON\.parse\(legacy\), enabled: false/);
assert.doesNotMatch(moduleSource, /\bfetch\s*\(/);
console.log("UI sound tests passed: eight soft profiles, capped gain, music ducking, click cooldown and offline/Android packaging.");
