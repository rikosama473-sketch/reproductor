import { app, BrowserWindow, dialog, shell } from "electron";
import path from "node:path";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createDesktopServer } from "../scripts/static-server.mjs";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distRoot = path.join(desktopRoot, "dist");
// Keep the origin stable between restarts. A random port would create a new
// IndexedDB database for every launch and make users think their library vanished.
const APP_HOST = "127.0.0.1";
const APP_PORT = 41739;
let server = null;
let mainWindow = null;
let appOrigin = "";

const smokeTest = process.env.RITMO_DESKTOP_SMOKE_TEST === "1";
const smokeTestId = String(process.env.RITMO_DESKTOP_SMOKE_TEST_ID || "")
  .replace(/[^a-zA-Z0-9-]/g, "")
  .slice(0, 64);
const smokeUserDataDir = String(process.env.RITMO_DESKTOP_SMOKE_USER_DATA_DIR || "").trim();
const smokePhase = String(process.env.RITMO_DESKTOP_SMOKE_PHASE || "write");
const smokeTrackId = String(process.env.RITMO_DESKTOP_SMOKE_TRACK_ID || "");
// Isolate automated persistence tests from the desktop user's real profile.
if (smokeTest && smokeUserDataDir) app.setPath("userData", path.resolve(smokeUserDataDir));
const hasSingleInstance = app.requestSingleInstanceLock();
const smokeResultPath = smokeTest && smokeTestId
  ? path.join(app.getPath("temp"), "ritmo-desktop-smoke-" + smokeTestId + ".json")
  : null;
let smokeTestFinished = false;

async function finishSmokeTest(exitCode, details) {
  if (!smokeTest || smokeTestFinished) return;
  smokeTestFinished = true;
  let finalExitCode = exitCode;
  try {
    if (smokeResultPath) {
      await writeFile(smokeResultPath, JSON.stringify({
        passed: exitCode === 0,
        exitCode,
        details
      }, null, 2) + "\n", "utf8");
    }
  } catch (error) {
    finalExitCode = 1;
    console.error("No se pudo escribir el resultado de la prueba de inicio:", error);
  }
  app.exit(finalExitCode);
}

function openSafeExternal(target) {
  try {
    const url = new URL(target);
    if (["https:", "http:", "mailto:"].includes(url.protocol)) {
      void shell.openExternal(url.href).catch(() => {});
    }
  } catch {
    // Ignore malformed or non-URL navigation requests.
  }
}

async function startLocalAppServer() {
  server = createDesktopServer({ root: distRoot, host: APP_HOST, port: APP_PORT });
  await new Promise((resolve, reject) => {
    const onError = error => {
      server?.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server?.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(APP_PORT, APP_HOST);
  });
  appOrigin = "http://" + APP_HOST + ":" + APP_PORT;
  return appOrigin + "/";
}

async function createMainWindow() {
  const startUrl = await startLocalAppServer();
  mainWindow = new BrowserWindow({
    title: "Ritmo",
    width: 1240,
    height: 820,
    minWidth: 850,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#151312",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openSafeExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, target) => {
    try {
      if (new URL(target).origin !== appOrigin) {
        event.preventDefault();
        openSafeExternal(target);
      }
    } catch {
      event.preventDefault();
    }
  });
  mainWindow.once("ready-to-show", () => {
    if (!smokeTest) mainWindow?.show();
  });
  mainWindow.on("closed", () => { mainWindow = null; });
  if (smokeTest) {
    mainWindow.webContents.once("did-finish-load", async () => {
      try {
        const result = await mainWindow.webContents.executeJavaScript(`(async () => {
          const deadline = Date.now() + 12000;
          while (!window.__ritmoAppReady && Date.now() < deadline) {
            await new Promise(resolve => setTimeout(resolve, 50));
          }
                    const smokePhase = ${JSON.stringify(smokePhase)};
          const smokeTrackId = ${JSON.stringify(smokeTrackId)};

          const smokeAudioFilename = "RITMO-CI-CONVERTER-INTEGRATION.wav";
          const smokeAudioStem = smokeAudioFilename.replace(/\\.wav$/i, "");
          function createSmokeWav() {
            const sampleRate = 44100;
            const frames = Math.floor(sampleRate * 1.25);
            const dataBytes = frames * 2;
            const buffer = new ArrayBuffer(44 + dataBytes);
            const view = new DataView(buffer);
            const writeAscii = (offset, value) => {
              for (let index = 0; index < value.length; index++) view.setUint8(offset + index, value.charCodeAt(index));
            };
            writeAscii(0, "RIFF");
            view.setUint32(4, buffer.byteLength - 8, true);
            writeAscii(8, "WAVE");
            writeAscii(12, "fmt ");
            view.setUint32(16, 16, true);
            view.setUint16(20, 1, true);
            view.setUint16(22, 1, true);
            view.setUint32(24, sampleRate, true);
            view.setUint32(28, sampleRate * 2, true);
            view.setUint16(32, 2, true);
            view.setUint16(34, 16, true);
            writeAscii(36, "data");
            view.setUint32(40, dataBytes, true);
            for (let frame = 0; frame < frames; frame++) {
              const sample = Math.round(Math.sin(2 * Math.PI * 440 * frame / sampleRate) * 1200);
              view.setInt16(44 + frame * 2, sample, true);
            }
            return new File([buffer], smokeAudioFilename, { type: "audio/wav", lastModified: Date.now() });
          }
          async function waitFor(test, message, timeoutMs = 15000) {
            const end = Date.now() + timeoutMs;
            while (Date.now() < end) {
              const value = test();
              if (value) return value;
              await new Promise(resolve => setTimeout(resolve, 25));
            }
            throw new Error(message);
          }
          async function openSmokeLibrary() {
            const request = indexedDB.open("ritmo-library", 3);
            return await new Promise((resolve, reject) => {
              request.onsuccess = () => resolve(request.result);
              request.onerror = () => reject(request.error || new Error("No se pudo abrir la biblioteca IndexedDB."));
              request.onblocked = () => reject(new Error("La apertura de IndexedDB quedó bloqueada en el perfil de prueba."));
            });
          }
          async function testConvertedTrackPersistence() {
            const db = await openSmokeLibrary();
            if (smokePhase === "write") {
              db.close();
              return { passed: true, phase: smokePhase, awaitingRestart: true };
            }
            try {
              const records = await new Promise((resolve, reject) => {
                const tx = db.transaction("tracks", "readonly");
                const request = tx.objectStore("tracks").getAll();
                request.onsuccess = () => resolve(request.result || []);
                request.onerror = () => reject(request.error || new Error("No se pudieron leer las pistas importadas por el conversor."));
                tx.onabort = () => reject(tx.error || new Error("Se canceló la lectura de las pistas importadas."));
              });
              const expected = smokeAudioStem.toLowerCase();
              const savedTrack = records.find(record => JSON.stringify(record).toLowerCase().includes(expected));
              if (!savedTrack) throw new Error("El WAV convertido y agregado desde la interfaz no sobrevivió al reinicio.");
              await new Promise((resolve, reject) => {
                const tx = db.transaction("tracks", "readwrite");
                tx.objectStore("tracks").delete(savedTrack.id);
                tx.oncomplete = resolve;
                tx.onerror = () => reject(tx.error || new Error("No se pudo limpiar la pista importada por el conversor."));
                tx.onabort = () => reject(tx.error || new Error("Se canceló la limpieza de la pista importada."));
              });
              return { passed: true, phase: smokePhase, survivedRestart: true, cleaned: true };
            } finally {
              db.close();
            }
          }
          async function testConverterAndAudioEngine() {
            const sourceFile = createSmokeWav();
            const converterInput = document.getElementById("converter-files");
            if (!converterInput || typeof DataTransfer !== "function") {
              throw new Error("El smoke test no dispone de selección de archivos para comprobar el conversor.");
            }
            const transfer = new DataTransfer();
            transfer.items.add(sourceFile);
            converterInput.files = transfer.files;
            converterInput.dispatchEvent(new Event("change", { bubbles: true }));
            const startButton = document.getElementById("converter-start");
            if (!startButton || startButton.disabled) {
              throw new Error("La biblioteca de entrada no habilitó la conversión del WAV sintético.");
            }
            startButton.click();
            const status = await waitFor(() => {
              const value = document.getElementById("converter-status")?.textContent || "";
              return value.startsWith("Terminado:") ? value : null;
            }, "El conversor no terminó dentro del tiempo de la prueba.", 30000);
            if (status !== "Terminado: 1 convertido(s), 0 con error.") {
              throw new Error("La conversión integrada falló: " + status);
            }
            const resultItem = document.querySelector("#converter-results .converter-result");
            if (!resultItem || resultItem.dataset.tone === "error") {
              throw new Error("El conversor no generó un resultado válido para la pista sintética.");
            }
            const download = resultItem.querySelector("a[download]");
            const saveButton = resultItem.querySelector(".converter-library-save");
            if (!download || !saveButton) {
              throw new Error("El resultado no ofrece descarga WAV y guardado a biblioteca.");
            }
            const response = await fetch(download.href);
            if (!response.ok) throw new Error("No se pudo leer el WAV generado por la interfaz.");
            const convertedBlob = await response.blob();
            if (convertedBlob.size < 52) throw new Error("El WAV generado está vacío o incompleto.");
            const header = new DataView(await convertedBlob.slice(0, 44).arrayBuffer());
            const ascii = (offset, size) => Array.from({ length: size }, (_, i) =>
              String.fromCharCode(header.getUint8(offset + i))).join("");
            if (ascii(0, 4) !== "RIFF" || ascii(8, 4) !== "WAVE" ||
                ascii(12, 4) !== "fmt " || ascii(36, 4) !== "data" ||
                header.getUint16(20, true) !== 1 || header.getUint16(22, true) !== 2 ||
                header.getUint16(34, true) !== 16 ||
                header.getUint32(40, true) !== convertedBlob.size - 44) {
              throw new Error("El resultado no es un WAV PCM16 estéreo con longitudes válidas.");
            }
            saveButton.click();
            await waitFor(() => saveButton.dataset.librarySaved === "true" ? true :
              (saveButton.textContent === "Reintentar" ? (() => {
                throw new Error(resultItem.querySelector("small")?.textContent || "No se pudo guardar el WAV en la biblioteca.");
              })() : null),
            "El conversor no pudo guardar el WAV mediante la importación habitual.", 15000);
            document.querySelector('[data-view="library"]')?.click();
            const search = document.getElementById("library-search");
            if (!search) throw new Error("No se encontró la búsqueda de biblioteca para comprobar la pista convertida.");
            search.value = smokeAudioStem;
            search.dispatchEvent(new Event("input", { bubbles: true }));
            const trackCard = await waitFor(() => {
              const cards = Array.from(document.querySelectorAll(
                "#library-grid [data-library-card], #library-tracks [data-track-row]"
              ));
              return cards.find(card => (card.textContent || "").toLowerCase().includes(smokeAudioStem.toLowerCase())) || null;
            }, "El WAV guardado no apareció al buscarlo en la biblioteca.", 8000);

            const audio = document.getElementById("audio-engine");
            if (!audio) throw new Error("No se encontró el motor de audio del reproductor.");
            const previousMuted = audio.muted;
            const previousVolume = audio.volume;
            const previousSrc = audio.getAttribute("src");
            const audioUrl = URL.createObjectURL(sourceFile);
            let engineStarted = false;
            try {
              audio.pause();
              audio.muted = true;
              audio.volume = 0;
              audio.src = audioUrl;
              audio.load();
              await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                  cleanup();
                  reject(new Error("El motor de audio no leyó los metadatos de la pista de prueba."));
                }, 5000);
                const cleanup = () => {
                  clearTimeout(timeout);
                  audio.removeEventListener("loadedmetadata", ready);
                  audio.removeEventListener("error", failed);
                };
                const ready = () => { cleanup(); resolve(); };
                const failed = () => { cleanup(); reject(new Error("El motor de audio rechazó el WAV sintético.")); };
                audio.addEventListener("loadedmetadata", ready);
                audio.addEventListener("error", failed);
                if (audio.readyState >= 1) ready();
              });
              if (!Number.isFinite(audio.duration) || audio.duration < 1) {
                throw new Error("El motor de audio informó una duración inválida para el WAV.");
              }
              await audio.play();
              await new Promise(resolve => setTimeout(resolve, 180));
              engineStarted = !audio.paused && audio.currentTime > 0;
              audio.pause();
              if (!engineStarted) throw new Error("El motor de audio no inició la reproducción silenciada de prueba.");
            } finally {
              audio.pause();
              if (previousSrc === null) audio.removeAttribute("src");
              else audio.setAttribute("src", previousSrc);
              audio.muted = previousMuted;
              audio.volume = previousVolume;
              audio.load();
              URL.revokeObjectURL(audioUrl);
            }
            return {
              passed: true,
              conversion: { converted: true, wavPcm16Stereo: true, outputBytes: convertedBlob.size },
              library: { saved: true, searchable: true, title: smokeAudioStem, displayed: Boolean(trackCard) },
              audioEngine: { passed: true, playedMuted: engineStarted, duration: 1.25 }
            };
          }

          async function testLibraryPersistence() {
            const request = indexedDB.open("ritmo-library", 3);
            const db = await new Promise((resolve, reject) => {
              request.onsuccess = () => resolve(request.result);
              request.onerror = () => reject(request.error || new Error("No se pudo abrir la biblioteca IndexedDB."));
              request.onblocked = () => reject(new Error("La apertura de IndexedDB quedó bloqueada en el perfil de prueba."));
            });
            const stores = Array.from(db.objectStoreNames);
            const missingStores = ["tracks", "history", "playlists", "appSettings"].filter(name => !stores.includes(name));
            if (missingStores.length) {
              db.close();
              throw new Error("Faltan almacenes de biblioteca: " + missingStores.join(", "));
            }
            const testTitle = "__RITMO_WINDOWS_RESTART_SMOKE__";
            if (smokePhase === "write") {
              await new Promise((resolve, reject) => {
                let tx;
                try {
                  tx = db.transaction("tracks", "readwrite");
                  tx.oncomplete = resolve;
                  tx.onerror = () => reject(tx.error || new Error("No se pudo guardar la pista de prueba."));
                  tx.onabort = () => reject(tx.error || new Error("Se canceló el guardado de la pista de prueba."));
                  tx.objectStore("tracks").put({
                    id: smokeTrackId,
                    title: testTitle,
                    artist: "Ritmo CI",
                    album: "Prueba de persistencia",
                    genre: "Test",
                    duration: 0,
                    addedAt: Date.now(),
                    favorite: false
                  });
                } catch (error) {
                  try { tx?.abort(); } catch {}
                  reject(error);
                }
              });
              db.close();
              return { passed: true, phase: smokePhase, stores, saved: true, trackId: smokeTrackId };
            }
            if (smokePhase === "verify") {
              const record = await new Promise((resolve, reject) => {
                let tx;
                try {
                  tx = db.transaction("tracks", "readonly");
                  const getRequest = tx.objectStore("tracks").get(smokeTrackId);
                  getRequest.onsuccess = () => resolve(getRequest.result || null);
                  getRequest.onerror = () => reject(getRequest.error || new Error("No se pudo leer la pista guardada."));
                  tx.onabort = () => reject(tx.error || new Error("Se canceló la lectura de la biblioteca."));
                } catch (error) {
                  reject(error);
                }
              });
              if (!record || record.title !== testTitle) {
                db.close();
                throw new Error("La pista de prueba no sobrevivió al cierre y reapertura de Ritmo.");
              }
              await new Promise((resolve, reject) => {
                let tx;
                try {
                  tx = db.transaction("tracks", "readwrite");
                  tx.oncomplete = resolve;
                  tx.onerror = () => reject(tx.error || new Error("No se pudo limpiar la pista de prueba."));
                  tx.onabort = () => reject(tx.error || new Error("Se canceló la limpieza de la pista de prueba."));
                  tx.objectStore("tracks").delete(smokeTrackId);
                } catch (error) {
                  try { tx?.abort(); } catch {}
                  reject(error);
                }
              });
              db.close();
              return { passed: true, phase: smokePhase, stores, survivedRestart: true, cleaned: true, trackId: smokeTrackId };
            }
            db.close();
            throw new Error("Fase de prueba de persistencia desconocida: " + smokePhase);
          }
          const selectors = {
            appShell: ".app-shell",
            homeView: "#home-view",
            libraryView: "#library-view",
            librarySearch: "#library-search",
            converterView: "#converter-view",
            converterFiles: "#converter-files",
            converterStart: "#converter-start",
            audioEngine: "#audio-engine",
            playButton: "#play-button",
            bootError: "#app-boot-error"
          };
          const elements = Object.fromEntries(Object.entries(selectors).map(([name, selector]) => [
            name, Boolean(document.querySelector(selector))
          ]));
          const missing = Object.entries(elements).filter(([, present]) => !present).map(([name]) => name);
          const bootError = document.querySelector("#app-boot-error");
          if (!window.__ritmoAppReady) missing.push("app-initialization");
          if (bootError && !bootError.hidden) missing.push("boot-error-visible");

          const navigation = {};
          for (const view of ["library", "converter", "home"]) {
            const button = document.querySelector('[data-view="' + view + '"]');
            const panel = document.getElementById(view + "-view");
            if (!button || !panel) {
              navigation[view] = false;
              missing.push("navigation-" + view);
              continue;
            }
            button.click();
            navigation[view] = !panel.hidden && button.classList.contains("active");
            if (!navigation[view]) missing.push("navigation-" + view);
          }
          const converterIntegration = smokePhase === "write"
            ? await testConverterAndAudioEngine()
            : { passed: true, skipped: true, reason: "La conversión e importación se comprueban en la primera ejecución." };
          const convertedTrackPersistence = await testConvertedTrackPersistence();
          const persistentLibrary = await testLibraryPersistence();
          return {
            ready: window.__ritmoAppReady === true,
            title: document.title,
            elements,
            navigation,
            missing,
            audioIdle: Boolean(document.querySelector("#audio-engine")?.paused),
            converterIntegration,
            convertedTrackPersistence,
            persistentLibrary
          };
        })()`, true);
        const passed = result.ready && result.missing.length === 0 && result.audioIdle &&
          result.persistentLibrary?.passed === true && result.converterIntegration?.passed === true &&
          result.convertedTrackPersistence?.passed === true;
        await finishSmokeTest(passed ? 0 : 1, result);
      } catch (error) {
        console.error("La prueba de inicio de Ritmo para PC falló:", error);
        await finishSmokeTest(1, { error: error?.message || String(error) });
      }
    });
  }
  await mainWindow.loadURL(startUrl);
}

if (!hasSingleInstance) {
  app.quit();
} else {
  app.setAppUserModelId("com.ritmo.player");
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  app.whenReady().then(async () => {
    try {
      await createMainWindow();
    } catch (error) {
      console.error("No se pudo iniciar Ritmo para PC:", error);
      if (smokeTest) {
        await finishSmokeTest(1, { error: error?.message || String(error) });
        return;
      }
      await dialog.showMessageBox({
        type: "error",
        title: "Ritmo no pudo iniciarse",
        message: "No se pudo iniciar el servidor local de Ritmo.",
        detail: error?.code === "EADDRINUSE"
          ? "El puerto local " + APP_PORT + " ya está ocupado. Cerrá la otra instancia de Ritmo y volvé a abrirlo."
          : (error?.message || "Revisá la instalación y volvé a intentar.")
      });
      app.quit();
    }
  });
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow().catch(error => {
        console.error("No se pudo reabrir Ritmo:", error);
        app.quit();
      });
    }
  });
  app.on("before-quit", () => {
    if (server?.listening) server.close();
    server = null;
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
