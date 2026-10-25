import { app, BrowserWindow, dialog, shell } from "electron";
import path from "node:path";
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
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("closed", () => { mainWindow = null; });
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
