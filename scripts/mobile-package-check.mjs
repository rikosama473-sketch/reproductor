import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mobileRoot = path.join(root, "mobile");
const pkg = JSON.parse(await readFile(path.join(mobileRoot, "package.json"), "utf8"));
const cap = JSON.parse(await readFile(path.join(mobileRoot, "capacitor.config.json"), "utf8"));
assert.equal(pkg.dependencies?.["@capacitor/core"], "8.5.3", "Mobile Capacitor Core must use the reviewed stable version");
assert.equal(pkg.dependencies?.["@capacitor/android"], "8.5.3", "Mobile Capacitor Android must match Core");
assert.equal(pkg.devDependencies?.["@capacitor/cli"], "8.5.3", "Mobile Capacitor CLI must match Core");
assert.equal(cap.appId, "com.rikosama473.ritmo", "Android package ID must stay stable");
assert.equal(cap.appName, "Ritmo");
assert.equal(cap.webDir, "www", "The native web bundle belongs inside mobile/www");
assert.equal(cap.server?.androidScheme, "https", "Packaged Android assets need a secure local origin for browser APIs");

const webDir = path.join(mobileRoot, "www");
const html = await readFile(path.join(webDir, "index.html"), "utf8");
const sw = await readFile(path.join(webDir, "sw.js"), "utf8");
const capacitorTag = '<script src="./capacitor.js"></script>';
const appTag = '<script type="module" src="./src/app.js"></script>';
assert.ok(html.indexOf(capacitorTag) >= 0 && html.indexOf(capacitorTag) < html.indexOf(appTag),
  "Capacitor runtime must load before the app module");
assert.match(html, /src=["']\.\/src\/app\.js["']/, "Bundled HTML must load the real app module");
assert.match(html, /src=["']\.\/src\/ui-sounds\.js["']/, "Android UI must load its local sound module");
assert.match(html, /src=["']\.\/src\/voice-studio\.js["']/, "Android UI must load its voice studio module");
assert.match(html, /id=["']file-picker["']/, "Android UI must retain its audio file picker");
assert.match(html, /data-scan-device-music/, "Android UI must expose whole-device music scanning");

const capacitorRuntime = await readFile(path.join(webDir, "capacitor.js"), "utf8");
assert.match(capacitorRuntime, /nativePromise/, "Packaged Capacitor runtime must expose nativePromise");
assert.match(capacitorRuntime, /getPlatform/, "Packaged Capacitor runtime must expose getPlatform");

const nativePlugin = await readFile(path.join(root, "mobile/native/android/RitmoMusicLibraryPlugin.java"), "utf8");
assert.match(nativePlugin, /READ_MEDIA_AUDIO/, "Android must request granular audio permission");
assert.match(nativePlugin, /MediaStore\.Audio\.Media/, "Native plugin must query the audio media store");
assert.match(nativePlugin, /ACTION_OPEN_DOCUMENT/, "Native plugin must open the system document picker");
assert.match(nativePlugin, /ACTION_OPEN_DOCUMENT_TREE/, "Native plugin must support selecting music folders");
assert.match(nativePlugin, /listAudioFromTree/, "Native plugin must recursively inspect a selected folder tree");
assert.match(sw, /ritmo-shell-v\d+/, "Mobile bundle should use its independent refreshed offline shell");
assert.match(sw, /capacitor\.js/, "Offline mobile shell must precache the Capacitor runtime");
assert.match(sw, /\.\/src\/external-navigation\.js/, "The safe media-link validator must be available offline");
for (const name of ["index.html", "styles.css", "sw.js", "manifest.webmanifest", "capacitor.js", "src/app.js", "src/storage.js", "src/async-generation-gate.js", "src/online-services.js", "src/character-companion.js", "src/music-recognition.js", "src/music-finder-ui.js", "src/external-navigation.js", "src/import-fingerprint.js", "src/id3-tags.js", "src/audio-converter.js", "src/playback-position.js", "src/audio-preferences.js", "src/ui-sounds.js", "src/voice-studio.js", "assets/icon.svg", "assets/pibara-avatar.png"]) {
  const info = await stat(path.join(webDir, name)).catch(() => null);
  assert.ok(info?.isFile(), "Missing mobile asset: " + name);
}
console.log("Mobile packaging checks passed: isolated Capacitor config, app runtime, native music/folder access and offline resources verified.");
