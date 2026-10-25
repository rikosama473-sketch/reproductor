import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultDistRoot = path.join(desktopRoot, "dist");
const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".webp", "image/webp"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".avif", "image/avif"],
  [".wav", "audio/wav"],
  [".mp3", "audio/mpeg"],
  [".ogg", "audio/ogg"],
  [".flac", "audio/flac"],
  [".m4a", "audio/mp4"],
  [".mp4", "audio/mp4"],
  [".webm", "audio/webm"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".woff2", "font/woff2"],
  [".ico", "image/x-icon"]
]);

/**
 * Serve the prepared desktop shell from loopback only. Port 0 is useful for
 * isolated tests; the installed app uses a stable explicit port so IndexedDB
 * and service-worker storage keep the same origin between launches.
 */
export function createDesktopServer({
  root = defaultDistRoot,
  host = "127.0.0.1",
  port = 4173
} = {}) {
  const resolvedRoot = path.resolve(root);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error("El puerto local debe ser un entero entre 0 y 65535.");
  }
  if (host !== "127.0.0.1" && host !== "::1" && host !== "localhost") {
    throw new Error("El servidor de Ritmo solo puede enlazarse a la interfaz local.");
  }

  return createServer(async (request, response) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, {
        "content-type": "text/plain; charset=utf-8",
        "allow": "GET, HEAD",
        "x-content-type-options": "nosniff"
      });
      response.end("Método no permitido.");
      return;
    }

    let pathname;
    try {
      pathname = decodeURIComponent(new URL(request.url || "/", "http://localhost").pathname);
    } catch {
      response.writeHead(400, {
        "content-type": "text/plain; charset=utf-8",
        "x-content-type-options": "nosniff"
      });
      response.end("Ruta no válida.");
      return;
    }
    if (pathname === "/") pathname = "/index.html";

    const target = path.resolve(resolvedRoot, "." + pathname);
    if (target !== resolvedRoot && !target.startsWith(resolvedRoot + path.sep)) {
      response.writeHead(403, {
        "content-type": "text/plain; charset=utf-8",
        "x-content-type-options": "nosniff"
      });
      response.end("Acceso denegado.");
      return;
    }

    try {
      const info = await stat(target);
      if (!info.isFile()) throw new Error("No es un archivo.");
      const body = await readFile(target);
      response.writeHead(200, {
        "content-type": mimeTypes.get(path.extname(target).toLowerCase()) || "application/octet-stream",
        "x-content-type-options": "nosniff",
        "cache-control": /\/(?:index\.html|sw\.js|manifest\.webmanifest)$/.test(pathname) ? "no-cache" : "no-store",
        "content-length": body.length
      });
      response.end(request.method === "HEAD" ? undefined : body);
    } catch {
      response.writeHead(404, {
        "content-type": "text/plain; charset=utf-8",
        "x-content-type-options": "nosniff"
      });
      response.end("No se encontró el archivo.");
    }
  });
}
