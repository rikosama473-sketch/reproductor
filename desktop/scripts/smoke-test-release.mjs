import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "win32") {
  throw new Error("La prueba del ejecutable empaquetado debe correr en Windows.");
}

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseRoot = path.join(desktopRoot, "release");
const packageJson = JSON.parse(await readFile(path.join(desktopRoot, "package.json"), "utf8"));
const portableExecutable = path.join(releaseRoot, "Ritmo-" + packageJson.version + "-Portable-x64.exe");
const installerExecutable = path.join(releaseRoot, "Ritmo-" + packageJson.version + "-Setup-x64.exe");
const workDir = await mkdtemp(path.join(os.tmpdir(), "ritmo-desktop-smoke-run-"));
const installDir = path.join(workDir, "installed-app");
const portableProfileDir = path.join(workDir, "portable-user-data");
const installerProfileDir = path.join(workDir, "installer-user-data");

async function launchPhase(phase, { executable, resultId, trackId, profileDir }) {
  const phaseId = resultId + "-" + phase;
  const resultPath = path.join(os.tmpdir(), "ritmo-desktop-smoke-" + phaseId + ".json");
  let child;
  try {
    child = spawn(executable, [], {
      cwd: workDir,
      windowsHide: true,
      stdio: "ignore",
      env: {
        ...process.env,
        RITMO_DESKTOP_SMOKE_TEST: "1",
        RITMO_DESKTOP_SMOKE_TEST_ID: phaseId,
        RITMO_DESKTOP_SMOKE_USER_DATA_DIR: profileDir,
        RITMO_DESKTOP_SMOKE_PHASE: phase,
        RITMO_DESKTOP_SMOKE_TRACK_ID: trackId
      }
    });
    const childExit = await new Promise((resolve, reject) => {
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
      throw new Error("Ritmo Portable no terminó la fase " + phase + " en 60 segundos.");
    }
    assert.equal(childExit.code, 0,
      "La fase " + phase + " terminó con código " + childExit.code +
      (childExit.signal ? " (señal " + childExit.signal + ")" : ""));

    const rawResult = await readFile(resultPath, "utf8").catch(error => {
      throw new Error("Ritmo no generó el informe de la fase " + phase + ": " + error.message);
    });
    const result = JSON.parse(rawResult);
    assert.equal(result.passed, true, "Falló la fase " + phase + ": " + JSON.stringify(result.details));
    assert.equal(result.exitCode, 0);
    assert.equal(result.details.ready, true, "La inicialización de Ritmo no finalizó en " + phase + ".");
    assert.equal(result.details.audioIdle, true, "La prueba no debe iniciar reproducción.");
    assert.deepEqual(result.details.missing, [], "Faltan controles o falló la navegación.");
    assert.deepEqual(result.details.navigation, { library: true, converter: true, home: true });
    assert.ok(result.details.elements?.audioEngine && result.details.elements?.playButton);
    assert.ok(result.details.elements?.libraryView && result.details.elements?.librarySearch);
    assert.ok(result.details.elements?.converterView && result.details.elements?.converterFiles && result.details.elements?.converterStart);
    assert.equal(result.details.persistentLibrary?.passed, true, "La prueba de persistencia falló.");
    assert.equal(result.details.persistentLibrary?.phase, phase);
    assert.equal(result.details.converterIntegration?.passed, true,
      "La integración del conversor, la biblioteca y el motor de audio debe aprobar.");
    assert.equal(result.details.convertedTrackPersistence?.passed, true,
      "La prueba de persistencia del WAV convertido debe aprobar.");
    if (phase === "write") {
      assert.equal(result.details.converterIntegration.conversion?.converted, true,
        "El conversor no produjo un WAV desde la interfaz real.");
      assert.equal(result.details.converterIntegration.conversion?.wavPcm16Stereo, true,
        "El resultado del conversor no es un WAV PCM16 estéreo válido.");
      assert.equal(result.details.converterIntegration.library?.saved, true,
        "El WAV convertido no se guardó usando la importación de biblioteca.");
      assert.equal(result.details.converterIntegration.library?.searchable, true,
        "El WAV convertido no se encontró en la interfaz de biblioteca.");
      assert.equal(result.details.converterIntegration.audioEngine?.playedMuted, true,
        "El motor de audio no reprodujo la muestra de prueba en silencio.");
    } else {
      assert.equal(result.details.convertedTrackPersistence?.survivedRestart, true,
        "El WAV convertido no sobrevivió al reinicio de la app.");
      assert.equal(result.details.convertedTrackPersistence?.cleaned, true,
        "No se limpió el registro de prueba tras comprobar persistencia.");
    }
    return result.details;
  } finally {
    if (child && child.exitCode === null) child.kill();
    await rm(resultPath, { force: true }).catch(() => {});
  }
}

async function runProcess(executable, args, timeoutMs = 120000) {
  const child = spawn(executable, args, {
    cwd: workDir,
    windowsHide: true,
    stdio: "ignore"
  });
  const outcome = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => resolve({ timedOut: true }), timeoutMs);
    child.once("error", error => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal });
    });
  });
  if (outcome.timedOut) {
    child.kill();
    throw new Error(path.basename(executable) + " no terminó dentro de " + timeoutMs + " ms.");
  }
  return outcome;
}

async function targetExists(target) {
  try {
    await stat(target);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function verifyTarget(label, executable, profileDir) {
  const testConfig = {
    executable,
    resultId: randomUUID(),
    trackId: "ritmo-smoke-" + randomUUID(),
    profileDir
  };
  await mkdir(profileDir, { recursive: true });
  const firstLaunch = await launchPhase("write", testConfig);
  assert.equal(firstLaunch.persistentLibrary.saved, true,
    label + ": la primera ejecución debe guardar una pista de prueba.");

  const secondLaunch = await launchPhase("verify", testConfig);
  assert.equal(secondLaunch.persistentLibrary.survivedRestart, true,
    label + ": la pista guardada no persistió tras cerrar y volver a abrir Ritmo.");
  assert.equal(secondLaunch.persistentLibrary.cleaned, true,
    label + ": la pista temporal debe eliminarse después de comprobar la persistencia.");
  assert.equal(firstLaunch.audioIdle && secondLaunch.audioIdle, true,
    label + ": la prueba no debe iniciar reproducción.");
  return { firstLaunch, secondLaunch };
}

try {
  assert.ok(await targetExists(portableExecutable), "No se encontró el ejecutable portable.");
  assert.ok(await targetExists(installerExecutable), "No se encontró el instalador NSIS.");

  const portable = await verifyTarget("Portable", portableExecutable, portableProfileDir);

  const installExit = await runProcess(installerExecutable, ["/S", "/D=" + installDir]);
  assert.equal(installExit.code, 0,
    "El instalador Windows terminó con código " + installExit.code +
    (installExit.signal ? " (señal " + installExit.signal + ")" : ""));
  const installedExecutable = path.join(installDir, "Ritmo.exe");
  assert.ok(await targetExists(installedExecutable),
    "El instalador terminó, pero no creó Ritmo.exe en la ruta solicitada.");

  const installed = await verifyTarget("Instalación NSIS", installedExecutable, installerProfileDir);

  const installedFiles = await readdir(installDir);
  const uninstallerName = installedFiles.find(name => /^uninstall.*\.exe$/i.test(name));
  assert.ok(uninstallerName, "La instalación no contiene el desinstalador NSIS esperado.");
  const uninstallExit = await runProcess(path.join(installDir, uninstallerName), ["/S"]);
  assert.equal(uninstallExit.code, 0,
    "El desinstalador NSIS terminó con código " + uninstallExit.code);
  const uninstallDeadline = Date.now() + 15000;
  let executableRemoved = false;
  while (Date.now() < uninstallDeadline) {
    if (!(await targetExists(installedExecutable))) {
      executableRemoved = true;
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  const remainingInstallFiles = await readdir(installDir).catch(error =>
    error?.code === "ENOENT" ? [] : ["No se pudo listar el directorio: " + error.message]);
  assert.equal(executableRemoved, true,
    "La desinstalación silenciosa debe retirar Ritmo.exe. Archivos restantes: " +
    JSON.stringify(remainingInstallFiles));

  console.log("Ritmo Windows release smoke test passed: " + JSON.stringify({
    portable: {
      title: portable.secondLaunch.title,
      navigation: portable.secondLaunch.navigation,
      audioIdleOnBothLaunches: portable.firstLaunch.audioIdle && portable.secondLaunch.audioIdle,
      persistentLibrary: portable.secondLaunch.persistentLibrary
    },
    installer: {
      title: installed.secondLaunch.title,
      navigation: installed.secondLaunch.navigation,
      audioIdleOnBothLaunches: installed.firstLaunch.audioIdle && installed.secondLaunch.audioIdle,
      persistentLibrary: installed.secondLaunch.persistentLibrary
    },
    silentInstallAndUninstall: true,
    isolatedProfiles: true
  }));
} finally {
  await rm(workDir, { recursive: true, force: true }).catch(() => {});
}
