import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  MAX_COMPANION_IMAGE_BYTES,
  MAX_COMPANION_IMAGE_DIMENSION,
  MAX_COMPANION_IMAGE_PIXELS,
  validateCompanionImage,
  validateCompanionImageDimensions
} from "../src/character-companion.js";

const gif = validateCompanionImage({ name: "Mi personaje.GIF", type: "image/gif", size: 640000 });
assert.equal(gif.fileName, "Mi personaje.GIF");
assert.equal(gif.mimeType, "image/gif");
assert.equal(validateCompanionImage({ name: "avatar.webp", type: "application/octet-stream", size: 800000 }).mimeType, "image/webp");
assert.equal(validateCompanionImage({ name: "avatar", type: "image/png", size: 120 }).mimeType, "image/png");
assert.equal(validateCompanionImage({ name: "C:\\\\Fotos\\\\avatar.gif", type: "image/gif", size: 120 }).fileName, "avatar.gif");
assert.throws(() => validateCompanionImage(null), /Elegí una imagen/i);
assert.throws(() => validateCompanionImage({ name: "empty.gif", type: "image/gif", size: 0 }), /vacío/i);
assert.throws(() => validateCompanionImage({ name: "too-big.gif", type: "image/gif", size: MAX_COMPANION_IMAGE_BYTES + 1 }), /8 MB/i);
assert.throws(() => validateCompanionImage({ name: "page.html", type: "text/html", size: 500 }), /Formato no admitido/i);
assert.throws(() => validateCompanionImage({ name: "unknown.bin", type: "application/octet-stream", size: 500 }), /Formato no admitido/i);
assert.equal(validateCompanionImageDimensions(2048, 2048).width, MAX_COMPANION_IMAGE_DIMENSION);
assert.equal(MAX_COMPANION_IMAGE_PIXELS, 4194304);
assert.throws(() => validateCompanionImageDimensions(2049, 100), /2048/i);
assert.throws(() => validateCompanionImageDimensions(2000, 2100), /2048/i);
assert.throws(() => validateCompanionImageDimensions(0, 10), /dimensiones/i);

const [html, app, storage, serviceWorker, prepareMobile, smoke] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../src/app.js", import.meta.url), "utf8"),
  readFile(new URL("../src/storage.js", import.meta.url), "utf8"),
  readFile(new URL("../sw.js", import.meta.url), "utf8"),
  readFile(new URL("./prepare-mobile.mjs", import.meta.url), "utf8"),
  readFile(new URL("./smoke-check.mjs", import.meta.url), "utf8")
]);
assert.match(html, /id="character-companion-image"/);
assert.match(html, /id="character-companion-preview"/);
assert.match(html, /id="character-companion-file"[^>]*accept="[^"]*image\/gif/);
assert.match(html, /id="character-companion-choose"/);
assert.match(html, /id="character-companion-reset"/);
assert.match(app, /await inspectCharacterCompanionImage\(file\)/);
assert.match(app, /saveAppSetting\(CHARACTER_COMPANION_SETTING_KEY/);
assert.match(app, /getAppSetting\(CHARACTER_COMPANION_SETTING_KEY/);
assert.match(app, /deleteAppSetting\(CHARACTER_COMPANION_SETTING_KEY/);
assert.match(app, /URL\.revokeObjectURL\(oldUrl\)/);
assert.match(app, /let characterCompanionSource = DEFAULT_CHARACTER_COMPANION_SRC/);
assert.match(app, /if \(companion && !companion\.hidden\) image\.src = characterCompanionSource/);
assert.match(app, /image\.removeAttribute\("src"\)/, "The mini-player must detach the animated asset while paused");
assert.match(app, /if \(isPlaying\) \{[\s\S]*?image\.src = characterCompanionSource;[\s\S]*?companion\.hidden = false;[\s\S]*?image\.removeAttribute\("src"\)/,
  "Animated companion decoding must be restored on play and released on pause");
assert.match(storage, /const DB_VERSION = 3/);
assert.match(storage, /createObjectStore\(APP_SETTINGS, \{ keyPath: "key" \}\)/);
assert.match(storage, /export async function getAppSetting\(key\)/);
assert.match(storage, /export async function saveAppSetting\(key, value\)/);
assert.match(storage, /export async function deleteAppSetting\(key\)/);
assert.match(serviceWorker, /ritmo-shell-v72/);
assert.match(serviceWorker, /\.\/src\/character-companion\.js/);
assert.match(prepareMobile, /src\/character-companion\.js/);
assert.match(smoke, /const DB_VERSION = 3/);
assert.match(html, /id="youtube-mode-toggle"/, "YouTube must have a visible explicit on/off switch");
assert.match(html, /Sin clave, Ritmo prueba una búsqueda comunitaria pública de Invidious/, "The keyless search remains available inside Ritmo after opt-in");
assert.match(html, /YouTube está apagado/, "YouTube must start opt-in to avoid unexpected data usage");
assert.doesNotMatch(html, /Sin clave API, Buscar abre la búsqueda oficial de YouTube automáticamente/);
console.log("Character companion checks passed: GIF/PNG validation, bounds, IndexedDB settings, offline/mobile packaging, and YouTube copy.");
