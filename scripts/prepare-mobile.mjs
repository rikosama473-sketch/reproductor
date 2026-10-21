import { cp, copyFile, mkdir, readdir, rm, stat, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const webDir = path.resolve(process.env.RITMO_WEB_DIR || path.join(root, "mobile", "www"));
const files = ["index.html", "styles.css", "sw.js", "manifest.webmanifest", "pngtuber-capibara.png"];
const directories = ["src", "assets"];

await rm(webDir, { recursive: true, force: true });
await mkdir(webDir, { recursive: true });

for (const name of files) {
  const source = path.join(root, name);
  const info = await stat(source).catch(() => null);
  if (!info?.isFile()) throw new Error("Falta un archivo web necesario para Android: " + name);
  await copyFile(source, path.join(webDir, name));
}
for (const name of directories) {
  const source = path.join(root, name);
  const info = await stat(source).catch(() => null);
  if (!info?.isDirectory()) throw new Error("Falta un directorio web necesario para Android: " + name);
  await cp(source, path.join(webDir, name), { recursive: true });
}

// Vanilla ES modules do not bundle @capacitor/core. The native bridge runtime
// must be copied into the packaged site and loaded before src/app.js.
const nodeModulesRoot = path.resolve(process.env.RITMO_NODE_MODULES_DIR || path.join(root, "mobile", "node_modules"));
const runtimeSource = path.join(nodeModulesRoot, "@capacitor", "core", "dist", "capacitor.js");
const runtimeInfo = await stat(runtimeSource).catch(() => null);
if (!runtimeInfo?.isFile()) {
  throw new Error("Falta @capacitor/core/dist/capacitor.js. Ejecutá npm install antes de preparar Android.");
}
const runtimeText = await readFile(runtimeSource, "utf8");
if (!runtimeText.includes("nativePromise") || !runtimeText.includes("getPlatform")) {
  throw new Error("El runtime de Capacitor no expone las API del puente esperadas.");
}
await copyFile(runtimeSource, path.join(webDir, "capacitor.js"));

const appScriptTag = '<script type="module" src="./src/app.js"></script>';
const uiSoundsScriptTag = '<script type="module" src="./src/ui-sounds.js"></script>';
const voiceStudioScriptTag = '<script type="module" src="./src/voice-studio.js"></script>';
const capacitorScriptTag = '<script src="./capacitor.js"></script>';
let html = await readFile(path.join(webDir, "index.html"), "utf8");
const appTagCount = html.split(appScriptTag).length - 1;
if (appTagCount !== 1) {
  throw new Error("index.html debe incluir exactamente una etiqueta del módulo ./src/app.js.");
}
if (html.split(uiSoundsScriptTag).length - 1 !== 1) {
  throw new Error("index.html debe incluir exactamente una etiqueta del módulo ./src/ui-sounds.js.");
}
if (html.split(voiceStudioScriptTag).length - 1 !== 1) {
  throw new Error("index.html debe incluir exactamente una etiqueta del módulo ./src/voice-studio.js.");
}
if (!html.includes(capacitorScriptTag)) {
  html = html.replace(appScriptTag, capacitorScriptTag + "\n  " + appScriptTag);
}
if (html.indexOf(capacitorScriptTag) < 0 || html.indexOf(capacitorScriptTag) > html.indexOf(appScriptTag)) {
  throw new Error("capacitor.js debe cargarse antes de src/app.js para inicializar el puente nativo.");
}
await writeFile(path.join(webDir, "index.html"), html, "utf8");

const requiredFiles = [
  "index.html", "styles.css", "sw.js", "manifest.webmanifest", "capacitor.js",
  "src/app.js", "src/storage.js", "src/youtube-history.js",
  "src/audio-output-volume.js", "src/media-session-state.js", "src/equalizer-presets.js",
  "src/import-fingerprint.js", "src/id3-tags.js", "src/audio-converter.js", "src/external-navigation.js",
  "src/youtube-player-errors.js", "src/async-generation-gate.js", "src/online-services.js", "src/character-companion.js", "src/ui-sounds.js", "src/voice-studio.js", "assets/icon.svg", "pngtuber-capibara.png"
];
for (const name of requiredFiles) {
  const info = await stat(path.join(webDir, name)).catch(() => null);
  if (!info?.isFile()) throw new Error("El paquete web no contiene " + name);
}

let sw = await readFile(path.join(webDir, "sw.js"), "utf8");
if (!/const CACHE_NAME = ["']ritmo-shell-v\d+["'];/.test(sw)) {
  throw new Error("No se encontró una versión explícita del caché móvil en sw.js.");
}
sw = sw.replace(/const CACHE_NAME = ["']ritmo-shell-v\d+["'];/, 'const CACHE_NAME = "ritmo-shell-v67";');
if (!sw.includes('"./capacitor.js"') && !sw.includes("'./capacitor.js'")) {
  const indexEntry = '  "./index.html",';
  if (sw.split(indexEntry).length - 1 !== 1) {
    throw new Error("No se pudo agregar capacitor.js al shell offline móvil.");
  }
  sw = sw.replace(indexEntry, indexEntry + '\n  "./capacitor.js",');
}
await writeFile(path.join(webDir, "sw.js"), sw, "utf8");
const shellBlock = sw.match(/const APP_SHELL = \[([\s\S]*?)\];/);
if (!shellBlock) throw new Error("No se encontró APP_SHELL en sw.js.");
const entries = [...shellBlock[1].matchAll(/["']\.\/([^"']*)["']/g)]
  .map(match => match[1])
  .filter(Boolean);
for (const entry of entries) {
  const info = await stat(path.join(webDir, entry)).catch(() => null);
  if (!info?.isFile()) throw new Error("El shell offline hace referencia a un archivo ausente: " + entry);
}

const topLevel = await readdir(webDir);
console.log("Paquete Android preparado en " + path.relative(root, webDir) + ": runtime de Capacitor incluido y cargado antes de app.js; " +
  requiredFiles.length + " archivos críticos y " + entries.length + " recursos offline verificados. " +
  topLevel.length + " entradas principales.");
