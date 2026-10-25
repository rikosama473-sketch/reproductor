import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseDir = path.join(desktopRoot, "release");
const packageJson = JSON.parse(await readFile(path.join(desktopRoot, "package.json"), "utf8"));
const entries = await readdir(releaseDir, { withFileTypes: true });
const leakedWorkspacePackage = path.join(releaseDir, "win-unpacked", "resources", "app.asar.unpacked", "node_modules", "ritmo-workspace");
const leakedWorkspaceInfo = await stat(leakedWorkspacePackage).catch(() => null);
if (leakedWorkspaceInfo) {
  throw new Error("Se detectó el workspace de desarrollo empaquetado dentro de Ritmo: " + leakedWorkspacePackage + ". El ejecutable debe excluir dependencias recursivas y salidas de compilación.");
}
const executables = [];
for (const entry of entries) {
  if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".exe")) continue;
  const filename = path.join(releaseDir, entry.name);
  const details = await stat(filename);
  if (details.size < 10 * 1024 * 1024) {
    throw new Error("El ejecutable parece incompleto (menos de 10 MiB): " + entry.name);
  }
  const sha256 = createHash("sha256").update(await readFile(filename)).digest("hex");
  executables.push({ filename: entry.name, sizeBytes: details.size, sha256 });
}
const setup = executables.find(file => /-Setup-x64\.exe$/i.test(file.filename));
const portable = executables.find(file => /-Portable-x64\.exe$/i.test(file.filename));
assert.ok(setup, "No se generó el instalador Ritmo-Setup-x64.exe.");
assert.ok(portable, "No se generó el ejecutable portable Ritmo-Portable-x64.exe.");

await writeFile(
  path.join(releaseDir, "Ritmo-Windows-SHA256.txt"),
  executables.map(file => file.sha256 + "  " + file.filename).join("\n") + "\n",
  "utf8"
);
const metadata = {
  app: "Ritmo",
  platform: "Windows x64",
  version: packageJson.version,
  commit: process.env.RITMO_COMMIT || "local",
  workflowRun: process.env.RITMO_RUN_NUMBER || "local",
  installer: setup,
  portable,
  codeSigning: "No se ha configurado un certificado comercial de firma de código."
};
await writeFile(path.join(releaseDir, "build-info.json"), JSON.stringify(metadata, null, 2) + "\n", "utf8");
console.log("Windows release verified:", JSON.stringify(metadata, null, 2));
