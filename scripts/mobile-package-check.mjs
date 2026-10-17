import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const cap = JSON.parse(await readFile(path.join(root, "capacitor.config.json"), "utf8"));
assert.equal(pkg.dependencies?.["@capacitor/core"], "8.5.3", "Capacitor Core must use the reviewed stable version");
assert.equal(pkg.dependencies?.["@capacitor/android"], "8.5.3", "Capacitor Android must match Core");
assert.equal(pkg.devDependencies?.["@capacitor/cli"], "8.5.3", "Capacitor CLI must match Core");
assert.equal(cap.appId, "com.rikosama473.ritmo", "Android package ID must stay stable");
assert.equal(cap.appName, "Ritmo");
assert.equal(cap.webDir, "www");
assert.equal(cap.server?.androidScheme, "https", "Packaged Android assets need a secure local origin for browser APIs");

const html = await readFile(path.join(root, "www/index.html"), "utf8");
const sw = await readFile(path.join(root, "www/sw.js"), "utf8");
assert.match(html, /src=["']\.\/src\/app\.js["']/, "Bundled HTML must load the real app module");
assert.match(html, /id=["']file-picker["']/, "Android UI must retain its audio file picker");
assert.match(sw, /ritmo-shell-v17/, "Android package should contain the latest offline shell");
for (const name of ["index.html", "styles.css", "sw.js", "manifest.webmanifest", "src/app.js", "src/storage.js", "assets/icon.svg"]) {
  const info = await stat(path.join(root, "www", name)).catch(() => null);
  assert.ok(info?.isFile(), "Missing mobile asset: " + name);
}
console.log("Android packaging checks passed: app ID, pinned Capacitor version, HTTPS local origin, file picker, v17 shell, and required assets.");
