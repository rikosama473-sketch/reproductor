import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "win32") {
  throw new Error("La prueba del ejecutable empaquetado debe correr en Windows.");
}

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseRoot = path.join(desktopRoot, "release");
const packageJson = JSON.parse(await readFile(path.join(desktopRoot, "package.json"), "utf8"));
const executable = path.join(releaseRoot, "Ritmo-" + packageJson.version + "-Portable-x64.exe");
const resultId = randomUUID();
const resultPath = path.join(os.tmpdir(), "ritmo-desktop-smoke-" + resultId + ".json");
const workDir = await mkdtemp(path.join(os.tmpdir(), "ritmo-desktop-smoke-run-"));

let child;
let childExit;
try {
  child = spawn(executable, [], {
    cwd: workDir,
    windowsHide: true,
    stdio: "ignore",
    env: {
      ...process.env,
      RITMO_DESKTOP_SMOKE_TEST: "1",
      RITMO_DESKTOP_SMOKE_TEST_ID: resultId
    }
  });
  childExit = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => resolve({ timedOut: true }), 60000);
    child.once("error", error => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal });
    });
  });
  if (childExit.timedOut) {
    child.kill();
    throw new Error("Ritmo Portable no terminó la prueba de inicio en 60 segundos.");
  }
  assert.equal(childExit.code, 0,
    "El ejecutable portátil de Windows terminó con código " + childExit.code + (childExit.signal ? " (señal " + childExit.signal + ")" : ""));

  const rawResult = await readFile(resultPath, "utf8").catch(error => {
    throw new Error("El ejecutable no generó el resultado de prueba de inicio: " + error.message);
  });
  const result = JSON.parse(rawResult);
  assert.equal(result.passed, true, "Falló la prueba integrada: " + JSON.stringify(result.details));
  assert.equal(result.exitCode, 0);
  assert.equal(result.details.ready, true, "La inicialización de Ritmo no finalizó.");
  assert.equal(result.details.audioIdle, true, "La prueba no debe iniciar reproducción.");
  assert.deepEqual(result.details.missing, [], "Faltan controles o falló la navegación de la aplicación.");
  assert.deepEqual(result.details.navigation, { library: true, converter: true, home: true });
  assert.ok(result.details.elements?.audioEngine && result.details.elements?.playButton);
  assert.ok(result.details.elements?.libraryView && result.details.elements?.librarySearch);
  assert.ok(result.details.elements?.converterView && result.details.elements?.converterFiles && result.details.elements?.converterStart);
  console.log("Ritmo Windows packaged smoke test passed:", JSON.stringify(result.details));
} finally {
  if (child && child.exitCode === null) child.kill();
  await rm(resultPath, { force: true }).catch(() => {});
  await rm(workDir, { recursive: true, force: true }).catch(() => {});
}
