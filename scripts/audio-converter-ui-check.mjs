import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [html, app, sw, engine, styles] = await Promise.all([
  readFile(path.join(root, "index.html"), "utf8"),
  readFile(path.join(root, "src/app.js"), "utf8"),
  readFile(path.join(root, "sw.js"), "utf8"),
  readFile(path.join(root, "src/audio-converter.js"), "utf8"),
  readFile(path.join(root, "styles.css"), "utf8")
]);
for (const id of ["converter-view", "converter-files", "converter-file-list", "converter-sample-rate", "converter-channels", "converter-start", "converter-cancel", "converter-clear", "converter-progress", "converter-status", "converter-results"]) {
  assert.match(html, new RegExp('id="' + id + '"'), "Converter UI must expose " + id);
}
assert.match(html, /data-view="converter"/, "Converter must be reachable from the sidebar");
assert.match(html, /id="converter-view" hidden/, "Converter must use the app's real view navigation");
assert.match(app, /import \{ convertAudioFileToWav, MAX_CONVERTER_FILES/, "UI must call the real conversion engine");
assert.match(app, /await convertAudioFileToWav\(file, converterAudioContext/, "Each selected file must be decoded and encoded");
assert.match(app, /converterCancelRequested/, "Batch cancellation must be handled");
assert.match(app, /converterAbortController\?\.abort\(\)/, "Cancel must abort duration metadata probing.");
assert.match(app, /signal: converterAbortController\?\.signal/, "The converter must receive the active cancellation signal.");
assert.match(engine, /throwIfConverterAborted\(signal\)/, "The engine must check cancellation before allocating decoded/output buffers.");
assert.match(app, /createObjectURL\(blob\)/, "Converted output must be available as a downloadable file");
assert.match(app, /URL\.revokeObjectURL\(url\)/, "Generated object URLs must be released");
assert.match(app, /document\.createElement\("audio"\)/, "Converted outputs should expose native browser audio preview");
assert.match(app, /const playback = preview\.play\(\)/, "Clicking Escuchar must request actual playback, not only reveal controls");
assert.match(app, /playback\.catch\(error =>/, "Rejected media playback promises must be handled");
assert.match(app, /NotAllowedError/, "Autoplay/user-gesture restrictions must produce a clear fallback message");
assert.match(app, /preview\.controls = true/, "Converted audio preview must have real playback controls");
assert.match(app, /preview\.preload = "none"/, "Preview audio must not preload until the user opens it");
assert.match(app, /converterPreviewElements\.clear\(\)/, "Clearing results must release preview element references");
assert.match(app, /activeConverterPreview/, "Only one converted preview should play at a time");
assert.match(styles, /\.converter-result audio\[hidden\]\{display:none\}/, "Hidden previews must not occupy space");
assert.match(engine, /validatePcm16WavBlob/, "Generated WAV output must be structurally verified before it is returned");
assert.match(engine, /actualOutputBytes > outputLimit/, "Actual decoded frame count must be checked before WAV allocation");
assert.match(engine, /RIFF/);
assert.match(engine, /WAVE_FORMAT_PCM/);
assert.match(engine, /MAX_CONVERTER_DURATION_SECONDS = 7 \* 60/);
assert.match(engine, /MAX_CONVERTER_INPUT_BYTES = 50 \* 1024 \* 1024/);
assert.match(sw, /ritmo-shell-v73/);
assert.match(sw, /"\.\/src\/audio-converter\.js"/, "Converter engine must be cached for offline startup");
assert.match(styles, /\.converter-layout/);
console.log("Audio converter UI tests passed: navigation, limits, real conversion wiring, cancellation, downloads and offline cache.");
