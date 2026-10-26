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
const hasSingleInstance = app.requestSingleInstanceLock();
let server = null;
let mainWindow = null;
let appOrigin = "";

const smokeTest = process.env.RITMO_DESKTOP_SMOKE_TEST === "1";
const smokeTestId = String(process.env.RITMO_DESKTOP_SMOKE_TEST_ID || "")
  .replace(/[^a-zA-Z0-9-]/g, "")
  .slice(0, 64);
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
          return {
            ready: window.__ritmoAppReady === true,
            title: document.title,
            elements,
            navigation,
            missing,
            audioIdle: Boolean(document.querySelector("#audio-engine")?.paused)
          };
        })()`, true);
        const passed = result.ready && result.missing.length === 0 && result.audioIdle;
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
