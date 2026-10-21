import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distRoot = path.resolve(desktopRoot, "dist");
const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".woff2", "font/woff2"],
  [".ico", "image/x-icon"]
]);
const port = Number(process.env.PORT || 4173);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT debe ser un entero entre 1 y 65535.");
const ready = await stat(distRoot).catch(() => null);
if (!ready?.isDirectory()) throw new Error("No existe desktop/dist. Ejecutá npm run prepare primero.");

const server = createServer(async (request, response) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { "content-type": "text/plain; charset=utf-8", "allow": "GET, HEAD" });
    response.end("Método no permitido.");
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url || "/", "http://localhost").pathname);
  } catch {
    response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
    response.end("Ruta no válida.");
    return;
  }
  if (pathname === "/") pathname = "/index.html";
  const target = path.resolve(distRoot, "." + pathname);
  if (target !== distRoot && !target.startsWith(distRoot + path.sep)) {
    response.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
    response.end("Acceso denegado.");
    return;
  }

  try {
    const info = await stat(target);
    if (!info.isFile()) throw new Error("No es un archivo.");
    const body = await readFile(target);
    const headers = {
      "content-type": mimeTypes.get(path.extname(target).toLowerCase()) || "application/octet-stream",
      "x-content-type-options": "nosniff",
      "cache-control": /\/(?:index\.html|sw\.js|manifest\.webmanifest)$/.test(pathname) ? "no-cache" : "no-store",
      "content-length": body.length
    };
    response.writeHead(200, headers);
    response.end(request.method === "HEAD" ? undefined : body);
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8", "x-content-type-options": "nosniff" });
    response.end("No se encontró el archivo.");
  }
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write("Ritmo para PC disponible en http://127.0.0.1:" + port + "\n");
});
