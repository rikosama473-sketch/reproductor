import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { UI_SOUND_PACKS, normalizeUiSoundPreferences, DEFAULT_UI_SOUND_PREFERENCES } from "../src/ui-sounds.js";

assert.deepEqual(Object.keys(UI_SOUND_PACKS), ["piano", "punk", "cyber", "wood", "glass", "marimba", "bubble", "bell", "sparkle", "pluck", "harp", "flute", "rain", "orbit", "heartbeat", "bamboo", "vinyl", "chord", "koto", "shakuhachi", "kalimba", "breeze", "paper", "sonar", "night", "double", "retro", "warm", "drum", "minimal", "felt", "lofi", "pixel", "musicbox", "ceramic", "water", "analog", "windchime", "typewriter", "moonlight"]);
for (const [key, pack] of Object.entries(UI_SOUND_PACKS)) {
  assert.ok(pack.label, key + " has a visible label");
  assert.ok(pack.description, key + " explains its sound");
}
assert.deepEqual(normalizeUiSoundPreferences(null), { enabled: false, pack: "piano", volume: 20 });
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
  '<option value="glass">Cristal delicado</option>', '<option value="marimba">Marimba suave</option>',
  '<option value="bubble">Burbuja</option>', '<option value="bell">Campana tenue</option>',
  '<option value="sparkle">Destello anime</option>', '<option value="pluck">Cuerda pulsada</option>',
  '<option value="harp">Arpa suave</option>', '<option value="flute">Flauta tenue</option>',
  '<option value="rain">Gota de lluvia</option>', '<option value="orbit">Órbita</option>',
  '<option value="heartbeat">Pulso grave</option>', '<option value="bamboo">Bambú</option>',
  '<option value="vinyl">Vinilo suave</option>', '<option value="chord">Acorde sereno</option>',
  '<option value="koto">Koto tenue</option>', '<option value="shakuhachi">Flauta de bambú suave</option>',
  '<option value="kalimba">Kalimba suave</option>', '<option value="breeze">Brisa</option>',
  '<option value="paper">Toque de papel</option>', '<option value="sonar">Sonar discreto</option>',
  '<option value="night">Noche tranquila</option>', '<option value="double">Señal doble</option>',
  '<option value="retro">Retro 8-bit</option>', '<option value="warm">Sintetizador cálido</option>',
  '<option value="drum">Percusión amortiguada</option>', '<option value="minimal">Clic minimalista</option>',
  '<option value="felt">Piano de fieltro</option>', '<option value="lofi">Lo-fi aterciopelado</option>',
  '<option value="pixel">Píxel pastel</option>', '<option value="musicbox">Caja musical tenue</option>',
  '<option value="ceramic">Cerámica mate</option>', '<option value="water">Gota de agua suave</option>',
  '<option value="analog">Sintetizador analógico suave</option>', '<option value="windchime">Carillón de viento tenue</option>',
  '<option value="typewriter">Tecla mecánica suave</option>', '<option value="moonlight">Luz de luna</option>'
]) assert.ok(html.includes(snippet), "Missing sound selector option: " + snippet);
assert.match(html, /id="ui-sounds-volume"[^>]*max="100"[^>]*value="20"/);
assert.match(html, /src=["']\.\/src\/ui-sounds\.js["']/);
assert.match(sw, /ritmo-shell-v52/);
assert.match(sw, /\.\/src\/ui-sounds\.js/);
assert.match(prepare, /src\/ui-sounds\.js/);
assert.match(mobileCheck, /src\/ui-sounds\.js/);
assert.match(moduleSource, /MAX_OUTPUT_GAIN = 0\.025/);
assert.match(moduleSource, /MUSIC_DUCK_FACTOR = 0\.06/);
assert.match(moduleSource, /MIN_SOUND_INTERVAL_MS = 125/);
assert.match(moduleSource, /function voiceOutputIsActive\(\)/);
for (const key of Object.keys(UI_SOUND_PACKS)) assert.ok(moduleSource.includes('if (pack === "' + key + '")'), "Missing synthesizer branch: " + key);
assert.match(moduleSource, /mediaIsPlayingOrEmbedded\(documentRef\)/, "Effects must detect active media before choosing their gain");
assert.match(moduleSource, /MAX_OUTPUT_GAIN \* \(volume \/ 100\) \* \(activeMusic \? MUSIC_DUCK_FACTOR : 1\)/, "Effects must be automatically attenuated while media plays");
assert.match(moduleSource, /if \(volume <= 0 \|\| voiceOutputIsActive\(\)\) return/, "Effects must stay silent while a voice preview or system speech is active");
assert.match(moduleSource, /#voice-studio, \.companion-settings-section, \.character-companion/, "Voice and character design controls must remain silent");

assert.match(moduleSource, /globalThis\.speechSynthesis\?\.speaking/);
assert.match(moduleSource, /ritmo:voice-preview-start/);
assert.match(moduleSource, /ritmo:voice-preview-end/);
assert.match(moduleSource, /#voice-studio, \.companion-settings-section/);
assert.match(moduleSource, /iframe\[src\*="youtube\.com\/embed"\]/);
assert.match(moduleSource, /event\.isTrusted/);
assert.match(moduleSource, /ritmo\.ui-sounds\.v2/);
assert.match(moduleSource, /LEGACY_STORAGE_KEY = "ritmo\.ui-sounds\.v1"/);
assert.match(moduleSource, /JSON\.parse\(legacy\), enabled: false/);
assert.doesNotMatch(moduleSource, /\bfetch\s*\(/);
console.log("UI sound tests passed: forty profiles, lower output cap, stronger media ducking, speech suppression, click cooldown and offline/Android packaging.");
