import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const gradleCandidates = ["android/app/build.gradle", "android/app/build.gradle.kts"];
let gradlePath;
let source;
for (const candidate of gradleCandidates) {
  try {
    source = await readFile(candidate, "utf8");
    gradlePath = candidate;
    break;
  } catch {}
}
if (!gradlePath) throw new Error("No se encontró el Gradle del módulo Android. Ejecutá primero npx cap add android.");

const rawCode = process.env.RITMO_VERSION_CODE || "1";
const versionCode = Number(rawCode);
assert.ok(Number.isSafeInteger(versionCode) && versionCode > 0, "RITMO_VERSION_CODE debe ser un entero positivo.");
const versionName = process.env.RITMO_VERSION_NAME || "1.0." + versionCode;
assert.match(versionName, /^[0-9]+(?:\.[0-9A-Za-z-]+)*$/, "RITMO_VERSION_NAME tiene un formato no válido.");

let codeReplaced = false;
source = source.replace(/^([ \t]*versionCode[ \t]*(?:=[ \t]*)?)\d+([ \t]*(?:\/\/.*)?)$/m, (_whole, prefix, suffix) => {
  codeReplaced = true;
  return prefix + versionCode + suffix;
});
let nameReplaced = false;
source = source.replace(/^([ \t]*versionName[ \t]*(?:=[ \t]*)?)(["'])([^"'\r\n]*)\2([ \t]*(?:\/\/.*)?)$/m, (_whole, prefix, quote, _old, suffix) => {
  nameReplaced = true;
  return prefix + quote + versionName + quote + suffix;
});
assert.ok(codeReplaced, "No se pudo actualizar versionCode en " + gradlePath);
assert.ok(nameReplaced, "No se pudo actualizar versionName en " + gradlePath);
await writeFile(gradlePath, source);
console.log("Versión Android configurada: code=" + versionCode + ", name=" + versionName + " (" + gradlePath + ").");
