import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { UI_SOUND_PACKS, normalizeUiSoundPreferences } from "../src/ui-sounds.js";

assert.deepEqual(Object.keys(UI_SOUND_PACKS), ["piano", "punk", "cyber"]);
for (const [key, pack] of Object.entries(UI_SOUND_PACKS)) {
  assert.ok(pack.label, key + " has a visible label");
  assert.ok(pack.description, key + " explains its sound");
}
assert.deepEqual(normalizeUiSoundPreferences(null), { enabled: false, pack: "piano", volume: 30 });
assert.deepEqual(normalizeUiSoundPreferences({ enabled: true, pack: "punk", volume: 45 }), { enabled: true, pack: "punk", volume: 45 });
assert.deepEqual(normalizeUiSoundPreferences({ enabled: "true", pack: "unknown", volume: 150 }), { enabled: false, pack: "piano", volume: 60 });
assert.deepEqual(normalizeUiSoundPreferences({ enabled: true, pack: "cyber", volume: -20 }), { enabled: true, pack: "cyber", volume: 0 });

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
assert.match(html, /src=["']\.\/src\/ui-sounds\.js["']/);
assert.match(sw, /ritmo-shell-v44/);
assert.match(sw, /\.\/src\/ui-sounds\.js/);
assert.match(prepare, /src\/ui-sounds\.js/);
assert.match(mobileCheck, /src\/ui-sounds\.js/);
assert.match(moduleSource, /new AudioContextConstructor\(\)/);
assert.match(moduleSource, /ritmo\.ui-sounds\.v1/);
assert.doesNotMatch(moduleSource, /\bfetch\s*\(/);
console.log("UI sound tests passed: three sound styles, opt-in settings, local synthesis and offline/Android packaging.");
