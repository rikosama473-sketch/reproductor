import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDesktopServer } from "./static-server.mjs";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distRoot = path.join(desktopRoot, "dist");
const ready = await stat(distRoot).catch(() => null);
if (!ready?.isDirectory()) throw new Error("No existe desktop/dist. Ejecutá npm run prepare primero.");

const directRun = process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (directRun) {
  const port = Number(process.env.PORT || 4173);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT debe ser un entero entre 1 y 65535.");
  }
  const server = createDesktopServer({ root: distRoot, host: "127.0.0.1", port });
  server.on("error", error => {
    console.error("No se pudo iniciar el servidor de Ritmo para PC:", error.message);
    process.exitCode = 1;
  });
  server.listen(port, "127.0.0.1", () => {
    process.stdout.write("Ritmo para PC disponible en http://127.0.0.1:" + port + "\n");
  });
}
