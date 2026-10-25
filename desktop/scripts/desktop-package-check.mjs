import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDesktopServer } from "./static-server.mjs";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(desktopRoot, "..");
const distRoot = path.join(desktopRoot, "dist");

const [packageSource, electronSource, workflowSource, readme] = await Promise.all([
  readFile(path.join(desktopRoot, "package.json"), "utf8"),
  readFile(path.join(desktopRoot, "electron", "main.mjs"), "utf8"),
  readFile(path.join(repositoryRoot, ".github", "workflows", "desktop-windows.yml"), "utf8"),
  readFile(path.join(desktopRoot, "README.md"), "utf8")
]);
const packageJson = JSON.parse(packageSource);

assert.equal(packageJson.main, "electron/main.mjs");
assert.equal(packageJson.devDependencies.electron, "45.0.0", "Electron runtime must be pinned to a stable release.");
assert.equal(packageJson.devDependencies["electron-builder"], "26.18.0", "Windows packaging tool must be pinned.");
assert.equal(packageJson.build.appId, "com.ritmo.player");
assert.equal(packageJson.build.directories.buildResources, "../assets", "Windows installer should use the existing Ritmo icon.");
assert.equal(packageJson.build.win.target.length, 2);
assert.deepEqual(packageJson.build.win.target.map(target => target.target), ["nsis", "portable"]);
assert.equal(packageJson.build.nsis.oneClick, false, "Installer should show its setup wizard.");
assert.equal(packageJson.build.nsis.deleteAppDataOnUninstall, false, "Uninstalling must not erase the user's music library.");
assert.match(electronSource, /APP_PORT = 41739/, "Desktop origin must remain stable so the saved library persists between launches.");
assert.match(electronSource, /nodeIntegration: false/);
assert.match(electronSource, /contextIsolation: true/);
assert.match(electronSource, /sandbox: true/);
assert.match(electronSource, /setWindowOpenHandler/);
assert.match(electronSource, /requestSingleInstanceLock/);
assert.match(workflowSource, /runs-on: windows-latest/);
assert.match(workflowSource, /Ritmo-Windows-\$\{\{ github\.run_number \}\}/);
assert.match(readme, /Ritmo-Windows/);

const prepared = spawnSync(process.execPath, [path.join(desktopRoot, "scripts", "prepare.mjs")], {
  cwd: repositoryRoot,
  encoding: "utf8"
});
assert.equal(prepared.status, 0,
  "Desktop static bundle preparation must succeed: " + (prepared.stderr || prepared.stdout || ""));
for (const file of ["index.html", "styles.css", "sw.js", "manifest.webmanifest", "src/app.js", "src/concurrent-map.js", "assets/icon.svg"]) {
  const info = await stat(path.join(distRoot, file)).catch(() => null);
  assert.ok(info?.isFile(), "Prepared PC bundle must include " + file);
}

const server = createDesktopServer({ root: distRoot, host: "127.0.0.1", port: 0 });
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const address = server.address();
const base = "http://127.0.0.1:" + address.port;
try {
  const home = await fetch(base + "/");
  assert.equal(home.status, 200);
  assert.match(home.headers.get("content-type") || "", /text\/html/);
  assert.equal(home.headers.get("x-content-type-options"), "nosniff");
  const html = await home.text();
  assert.match(html, /\.\/src\/app\.js/);
  assert.doesNotMatch(html, /\.\/capacitor\.js/, "Windows desktop should not load Android's bridge.");

  const appModule = await fetch(base + "/src/app.js");
  assert.equal(appModule.status, 200);
  assert.match(appModule.headers.get("content-type") || "", /javascript/);
  assert.match(await appModule.text(), /import \{ mapWithConcurrency \}/);

  const head = await fetch(base + "/styles.css", { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.ok(Number(head.headers.get("content-length")) > 0);

  const unsupportedMethod = await fetch(base + "/", { method: "POST" });
  assert.equal(unsupportedMethod.status, 405);

  const traversal = await fetch(base + "/%2e%2e%2fpackage.json");
  assert.equal(traversal.status, 403, "Encoded traversal must not read files outside the prepared bundle.");

  const malformed = await fetch(base + "/%E0%A4%A");
  assert.equal(malformed.status, 400, "Malformed escaped paths must be rejected cleanly.");

  const missing = await fetch(base + "/not-a-real-resource.bin");
  assert.equal(missing.status, 404);
} finally {
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

console.log("Windows desktop checks passed: shared bundle, persistent origin, app isolation, HTTP routes, traversal denial, errors and installer targets.");
