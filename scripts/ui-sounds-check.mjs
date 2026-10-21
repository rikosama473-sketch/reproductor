import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { UI_SOUND_PACKS, UI_SOUND_RHYTHMS, inferUiSoundRhythm, resolveUiSoundRhythm, normalizeUiSoundPreferences, DEFAULT_UI_SOUND_PREFERENCES, getUiSoundMinIntervalMs } from "../src/ui-sounds.js";

assert.deepEqual(Object.keys(UI_SOUND_PACKS), ["piano", "punk", "cyber", "wood", "glass", "marimba", "bubble", "bell", "sparkle", "pluck", "harp", "flute", "rain", "orbit", "heartbeat", "bamboo", "vinyl", "chord", "koto", "shakuhachi", "kalimba", "breeze", "paper", "sonar", "night", "double", "retro", "warm", "drum", "minimal", "felt", "lofi", "pixel", "musicbox", "ceramic", "water", "analog", "windchime", "typewriter", "moonlight", "celesta", "electricpiano", "handpan", "mutedguitar", "plush", "cloud", "sakura", "shore", "holo", "softbit", "starglow", "arcade", "harpsichord", "organ", "basspluck", "taiko", "laser", "terminal", "glitch", "fmsoft", "synthpop", "neonpulse", "dream", "cassette", "pizzicato", "ocarina", "woodblock", "nylon", "softkick", "marbles", "deepfm", "ripple", "vibraphone", "shamisen", "reed", "mutedbrass", "framedrum", "pulsebass", "sweep", "circuit", "sax", "cello", "clavinet", "glockenspiel", "conga", "synthbass", "softpad", "tubular"]);
for (const [key, pack] of Object.entries(UI_SOUND_PACKS)) {
  assert.ok(pack.label, key + " has a visible label");
  assert.ok(pack.description, key + " explains its sound");
}
assert.deepEqual(normalizeUiSoundPreferences(null), { enabled: false, pack: "piano", volume: 15, rhythm: "auto" });
assert.equal(DEFAULT_UI_SOUND_PREFERENCES.enabled, false);
assert.deepEqual(Object.keys(UI_SOUND_RHYTHMS), ["auto", "soft", "pop", "rock", "cyber"]);
assert.deepEqual(normalizeUiSoundPreferences({ enabled: true, pack: "punk", volume: 45 }), { enabled: true, pack: "punk", volume: 45, rhythm: "auto" });
assert.deepEqual(normalizeUiSoundPreferences({ enabled: true, pack: "cyber", volume: 30, rhythm: "pop" }), { enabled: true, pack: "cyber", volume: 30, rhythm: "pop" });
assert.deepEqual(normalizeUiSoundPreferences({ enabled: "true", pack: "unknown", volume: 150, rhythm: "bad-value" }), { enabled: false, pack: "piano", volume: 100, rhythm: "auto" });
assert.deepEqual(normalizeUiSoundPreferences({ enabled: true, pack: "glass", volume: -20 }), { enabled: true, pack: "glass", volume: 0, rhythm: "auto" });
assert.deepEqual(normalizeUiSoundPreferences({ enabled: true, pack: "wood", volume: 38.6 }), { enabled: true, pack: "wood", volume: 39, rhythm: "auto" });
assert.equal(inferUiSoundRhythm("Pop"), "pop");
assert.equal(inferUiSoundRhythm("K-pop"), "pop");
assert.equal(inferUiSoundRhythm("Electrónica"), "cyber");
assert.equal(inferUiSoundRhythm("Techno / synthwave"), "cyber");
assert.equal(inferUiSoundRhythm("Rock"), "rock");
assert.equal(inferUiSoundRhythm("Punk rock"), "rock");
assert.equal(inferUiSoundRhythm("Alternative Metal"), "rock");
assert.equal(inferUiSoundRhythm("Jazz"), null);
assert.equal(resolveUiSoundRhythm("auto", "Pop", "piano"), "pop");
assert.equal(resolveUiSoundRhythm("auto", "Techno", "piano"), "cyber");
assert.equal(resolveUiSoundRhythm("auto", "Punk Rock", "piano"), "rock");
assert.equal(resolveUiSoundRhythm("auto", "", "cyber"), "cyber");
assert.equal(resolveUiSoundRhythm("auto", "", "piano"), "soft");
assert.equal(resolveUiSoundRhythm("pop", "Techno", "piano"), "pop");
assert.equal(getUiSoundMinIntervalMs("auto", "Pop", "piano"), 170);
assert.equal(getUiSoundMinIntervalMs("auto", "Techno", "piano"), 150);
assert.equal(getUiSoundMinIntervalMs("auto", "Punk Rock", "piano"), 210);
assert.equal(getUiSoundMinIntervalMs("soft", "", "piano"), 240);

const root = new URL("../", import.meta.url);
const [html, sw, prepare, mobileCheck, moduleSource, appSource, id3Source] = await Promise.all([
  readFile(new URL("index.html", root), "utf8"),
  readFile(new URL("sw.js", root), "utf8"),
  readFile(new URL("scripts/prepare-mobile.mjs", root), "utf8"),
  readFile(new URL("scripts/mobile-package-check.mjs", root), "utf8"),
  readFile(new URL("src/ui-sounds.js", root), "utf8"),
  readFile(new URL("src/app.js", root), "utf8"),
  readFile(new URL("src/id3-tags.js", root), "utf8")
]);
assert.match(html, /88 perfiles discretos con ritmo ajustable/, "Settings copy should match the 80 implemented profiles");
for (const selector of ["ui-sounds-enabled", "ui-sounds-pack", "ui-sounds-rhythm", "ui-sounds-rhythm-status", "ui-sounds-volume", "ui-sounds-preview"]) {
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
  '<option value="typewriter">Tecla mecánica suave</option>', '<option value="moonlight">Luz de luna</option>',
  '<option value="celesta">Celesta amortiguada</option>', '<option value="electricpiano">Piano eléctrico mate</option>',
  '<option value="handpan">Handpan apacible</option>', '<option value="mutedguitar">Guitarra limpia muteada</option>',
  '<option value="plush">Terciopelo</option>', '<option value="cloud">Nube suave</option>',
  '<option value="sakura">Sakura</option>', '<option value="shore">Ola mansa</option>',
  '<option value="holo">Holograma suave</option>', '<option value="softbit">8-bit aterciopelado</option>',
  '<option value="starglow">Brillo estelar</option>', '<option value="arcade">Arcade cálido</option>',
  '<option value="harpsichord">Clavicémbalo mate</option>', '<option value="organ">Órgano vintage suave</option>',
  '<option value="basspluck">Bajo redondo</option>', '<option value="taiko">Taiko amortiguado</option>',
  '<option value="laser">Láser mate</option>', '<option value="terminal">Terminal silenciosa</option>',
  '<option value="glitch">Glitch delicado</option>', '<option value="fmsoft">FM cristalino suave</option>',
  '<option value="synthpop">Synth-pop cálido</option>', '<option value="neonpulse">Pulso neón</option>',
  '<option value="dream">Sueño vaporoso</option>', '<option value="cassette">Casete analógico</option>',
  '<option value="pizzicato">Cuerda pizzicato</option>', '<option value="ocarina">Ocarina tenue</option>',
  '<option value="woodblock">Bloque de madera</option>', '<option value="nylon">Guitarra de nylon</option>',
  '<option value="softkick">Bombo acolchado</option>', '<option value="marbles">Canicas</option>',
  '<option value="deepfm">FM profunda</option>', '<option value="ripple">Ondulación</option>',
  '<option value="vibraphone">Vibráfono aterciopelado</option>', '<option value="shamisen">Shamisen tenue</option>',
  '<option value="reed">Caña suave</option>', '<option value="mutedbrass">Metal apagado</option>',
  '<option value="framedrum">Tambor de marco</option>', '<option value="pulsebass">Bajo de circuito</option>',
  '<option value="sweep">Barrido suave</option>', '<option value="circuit">Circuito digital</option>',
  '<option value="sax">Saxo aterciopelado</option>', '<option value="cello">Chelo cálido</option>',
  '<option value="clavinet">Clavinet suave</option>', '<option value="glockenspiel">Metalófono mate</option>',
  '<option value="conga">Conga acolchada</option>', '<option value="synthbass">Subgrave sintético</option>',
  '<option value="softpad">Pad de seda</option>', '<option value="tubular">Campana tubular tenue</option>',
  '<option value="rock">Rock / punk suave</option>',
  '<option value="auto">Automático por género</option>', '<option value="soft">Suave y espaciado</option>',
  '<option value="pop">Pop animado</option>', '<option value="cyber">Cyber / electrónico</option>'
]) assert.ok(html.includes(snippet), "Missing sound selector option: " + snippet);
assert.match(html, /id="ui-sounds-volume"[^>]*max="100"[^>]*value="15"/);
assert.match(html, /src=["']\.\/src\/ui-sounds\.js["']/);
assert.match(sw, /ritmo-shell-v61/);
assert.match(sw, /\.\/src\/ui-sounds\.js/);
assert.match(prepare, /src\/ui-sounds\.js/);
assert.match(mobileCheck, /src\/ui-sounds\.js/);
assert.match(moduleSource, /MAX_OUTPUT_GAIN = 0\.025/);
assert.match(moduleSource, /MUSIC_DUCK_FACTOR = 0\.04/);
assert.match(moduleSource, /MIN_SOUND_INTERVAL_MS = 150/);
assert.match(moduleSource, /getUiSoundMinIntervalMs\(preferences.rhythm, currentMusicGenre, preferences.pack\)/);
assert.match(moduleSource, /function addRhythmAccent\(context, output, rhythm\)/);
assert.match(moduleSource, /accentIndex % 2 !== 0/, "Pop/Rock accents must be sparse");
assert.match(moduleSource, /accentIndex % 3 !== 0/, "Cyber accents must be sparse");
assert.match(moduleSource, /if \(rhythm === "rock"\)/, "Rock rhythm needs a filtered fifth accent");
assert.match(moduleSource, /resolveUiSoundRhythm\(rhythmPreference, currentMusicGenre, pack\)/);
assert.match(moduleSource, /ritmo:track-context/);
assert.match(id3Source, /TCON: "genre"/, "ID3 parser must retain the genre text frame mapping");
assert.match(id3Source, /function normalizeGenre\(value\)/, "Numeric ID3 genre codes must be normalized");
assert.match(appSource, /genre: meta\.genre \|\| ""/);
assert.match(appSource, /notifySoundTrackContext\(track\)/);
assert.match(appSource, /radioTags: String\(track\?\.radioTags \|\| ""\)/);
assert.match(appSource, /function backfillTrackGenre\(track\)/, "Existing library tracks can acquire genre tags lazily");
assert.match(appSource, /readMp3Tags\(track\.blob, track\.name\)/, "Existing local MP3 metadata is read without re-importing");
assert.match(appSource, /async function readMp3Tags\(file, filename = file\?\.name \|\| ""\)/, "ID3 parsing accepts the stored track filename for blob-backed files");
assert.match(moduleSource, /let soundRequestGeneration = 0/);
assert.match(moduleSource, /requestGeneration !== soundRequestGeneration/, "A resumed AudioContext must discard stale sound requests");
assert.match(moduleSource, /soundRequestGeneration \+= 1;\s*voicePreviewActive = true/, "Voice preview start must invalidate pending UI effects");
const packChangeStart = moduleSource.indexOf('packInput.addEventListener("change"');
const packChangeEnd = moduleSource.indexOf("\n  rhythmInput?.addEventListener", packChangeStart);
assert.ok(packChangeStart >= 0 && packChangeEnd > packChangeStart, "Sound pack setting handler must exist");
assert.doesNotMatch(moduleSource.slice(packChangeStart, packChangeEnd), /playUiSound\(/, "Changing a settings selector must not emit an automatic preview");
assert.match(moduleSource, /function voiceOutputIsActive\(\)/);
for (const key of Object.keys(UI_SOUND_PACKS)) assert.ok(moduleSource.includes('if (pack === "' + key + '")'), "Missing synthesizer branch: " + key);
assert.match(moduleSource, /mediaIsPlayingOrEmbedded\(documentRef\)/, "Effects must detect active media before choosing their gain");
assert.match(moduleSource, /appPlaybackIsActive \|\| media\.some/, "App-reported native playback must also activate ducking");
assert.match(moduleSource, /ritmo:playback-context/, "UI sounds should receive playback state from all Ritmo engines");
assert.ok(moduleSource.includes("if (!wasPlaying && appPlaybackIsActive && audioContext && masterGain)"), "An active UI note must be attenuated immediately when playback starts");
assert.ok(moduleSource.includes("now, 0.003"), "Playback-start ducking should use a short gain transition");
assert.match(appSource, /uiSoundPlaybackSource = state\.nativePlayback\.active \? "native"/, "Native Android playback must be reported even without an HTML audio element");
assert.match(appSource, /detail: \{ playing: uiSoundIsPlaying, source: uiSoundPlaybackSource \}/, "The sound engine must receive the current engine's playback state");
assert.match(moduleSource, /MAX_OUTPUT_GAIN \* \(volume \/ 100\) \* \(activeMusic \? MUSIC_DUCK_FACTOR : 1\)/, "Effects must be automatically attenuated while media plays");
assert.match(moduleSource, /if \(preferences\.volume <= 0 \|\| voiceOutputIsActive\(\)\) return/, "Effects must stay silent while a voice preview or system speech is active");
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
console.log("UI sound tests passed: 88 profiles, genre-aware Pop/Rock/Cyber rhythm, sparse accents, voice suppression, cooldown and offline/Android packaging.");
