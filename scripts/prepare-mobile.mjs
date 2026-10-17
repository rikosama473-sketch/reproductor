import { cp, copyFile, mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const webDir = path.join(root, "www");
const files = ["index.html", "styles.css", "sw.js", "manifest.webmanifest"];
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

const requiredFiles = [
  "index.html", "styles.css", "sw.js", "manifest.webmanifest",
  "src/app.js", "src/storage.js", "src/youtube-history.js",
  "src/audio-output-volume.js", "src/media-session-state.js",
  "src/youtube-player-errors.js", "assets/icon.svg"
];
for (const name of requiredFiles) {
  const info = await stat(path.join(webDir, name)).catch(() => null);
  if (!info?.isFile()) throw new Error("El paquete web no contiene " + name);
}

const sw = await (await import("node:fs/promises")).readFile(path.join(webDir, "sw.js"), "utf8");
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
console.log("Paquete web para Android preparado en www/: " + requiredFiles.length + " archivos críticos y " + entries.length + " recursos del shell offline verificados. " + topLevel.length + " entradas principales.");
