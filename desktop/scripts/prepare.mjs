import { cp, copyFile, mkdir, readdir, rm, stat, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(desktopRoot, "..");
const outputDir = path.join(desktopRoot, "dist");
const files = ["index.html", "styles.css", "sw.js", "manifest.webmanifest", "pngtuber-capibara.png"];
const directories = ["src", "assets"];

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });

for (const name of files) {
  const source = path.join(repositoryRoot, name);
  const info = await stat(source).catch(() => null);
  if (!info?.isFile()) throw new Error("Falta un archivo requerido para PC: " + name);
  await copyFile(source, path.join(outputDir, name));
}
for (const name of directories) {
  const source = path.join(repositoryRoot, name);
  const info = await stat(source).catch(() => null);
  if (!info?.isDirectory()) throw new Error("Falta un directorio requerido para PC: " + name);
  await cp(source, path.join(outputDir, name), { recursive: true });
}

const html = await readFile(path.join(outputDir, "index.html"), "utf8");
if (!html.includes('<script type="module" src="./src/app.js"></script>')) {
  throw new Error("La salida de PC debe cargar el módulo real de la aplicación.");
}
if (html.includes('<script src="./capacitor.js"></script>')) {
  throw new Error("La salida de PC no debe cargar el puente nativo de Android.");
}
const shell = await readFile(path.join(outputDir, "sw.js"), "utf8");
const block = shell.match(/const APP_SHELL = \[([\s\S]*?)\];/);
if (!block) throw new Error("No se encontró APP_SHELL en el service worker para PC.");
const entries = [...block[1].matchAll(/["']\.\/([^"']*)["']/g)].map(match => match[1]).filter(Boolean);
for (const entry of entries) {
  const info = await stat(path.join(outputDir, entry)).catch(() => null);
  if (!info?.isFile()) throw new Error("El shell offline de PC apunta a un recurso ausente: " + entry);
}
const topLevel = await readdir(outputDir);
console.log("Salida independiente de PC preparada: " + outputDir + "; " + entries.length + " recursos del shell offline verificados; " + topLevel.length + " entradas principales.");
