import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mobileRoot = path.join(root, "mobile");
const desktopRoot = path.join(root, "desktop");
const mobilePackage = JSON.parse(await readFile(path.join(mobileRoot, "package.json"), "utf8"));
const desktopPackage = JSON.parse(await readFile(path.join(desktopRoot, "package.json"), "utf8"));
const capacitor = JSON.parse(await readFile(path.join(mobileRoot, "capacitor.config.json"), "utf8"));

assert.equal(capacitor.webDir, "www", "Android must use its private mobile/www staging folder");
assert.equal(mobilePackage.dependencies?.["@capacitor/android"], "8.5.3", "Only the mobile app should declare the Android Capacitor platform");
assert.equal(desktopPackage.scripts?.prepare, "node scripts/prepare.mjs", "Desktop must have its own PWA build entry point");
assert.equal(desktopPackage.scripts?.start, "npm run prepare && node scripts/serve.mjs", "Desktop must have an independent PC run command");
assert.equal(desktopPackage.dependencies, undefined, "Desktop staging should not require runtime/build dependencies");
assert.equal(desktopPackage.devDependencies, undefined, "Desktop staging should not require runtime/build dependencies");

const generated = spawnSync(process.execPath, [path.join(desktopRoot, "scripts", "prepare.mjs")], {
  cwd: root,
  encoding: "utf8"
});
assert.equal(generated.status, 0, "Desktop PWA staging must succeed: " + (generated.stderr || generated.stdout || ""));
const mobileHtml = await readFile(path.join(mobileRoot, "www", "index.html"), "utf8");
const desktopHtml = await readFile(path.join(desktopRoot, "dist", "index.html"), "utf8");
const mobileWorker = await readFile(path.join(mobileRoot, "www", "sw.js"), "utf8");
const desktopWorker = await readFile(path.join(desktopRoot, "dist", "sw.js"), "utf8");
const capacitorTag = '<script src="./capacitor.js"></script>';
const appTag = '<script type="module" src="./src/app.js"></script>';
assert.ok(mobileHtml.indexOf(capacitorTag) >= 0 && mobileHtml.indexOf(capacitorTag) < mobileHtml.indexOf(appTag),
  "Mobile must load the Capacitor bridge before the app module");
assert.ok(desktopHtml.includes(appTag), "PC must load the shared real app module");
assert.ok(!desktopHtml.includes(capacitorTag), "PC must not load Android's native bridge");
assert.match(mobileWorker, /ritmo-shell-v64/, "Mobile cache version must be independent from PC");
assert.match(mobileWorker, /capacitor\\.js/, "Mobile offline shell must include the native bridge runtime");
assert.match(desktopWorker, /ritmo-shell-v63/, "PC must keep the web-only shell version");
assert.doesNotMatch(desktopWorker, /capacitor\\.js/, "PC shell must not require an Android-only file");
assert.notEqual(path.join(mobileRoot, "www"), path.join(desktopRoot, "dist"), "Mobile and desktop build outputs must be separate");

for (const name of ["src/app.js", "src/storage.js", "src/audio-converter.js", "src/equalizer-presets.js"]) {
  const source = await readFile(path.join(root, name), "utf8");
  const mobile = await readFile(path.join(mobileRoot, "www", name), "utf8");
  const desktop = await readFile(path.join(desktopRoot, "dist", name), "utf8");
  assert.equal(mobile, source, "Mobile must stage the canonical source: " + name);
  assert.equal(desktop, source, "PC must stage the canonical source: " + name);
}
for (const [label, base] of [["mobile", path.join(mobileRoot, "www")], ["desktop", path.join(desktopRoot, "dist")]]) {
  const worker = await readFile(path.join(base, "sw.js"), "utf8");
  const block = worker.match(/const APP_SHELL = \[([\s\S]*?)\];/);
  assert.ok(block, label + " needs a service-worker shell manifest");
  const entries = [...block[1].matchAll(/["']\.\/([^"']*)["']/g)].map(match => match[1]).filter(Boolean);
  for (const entry of entries) {
    const info = await stat(path.join(base, entry)).catch(() => null);
    assert.ok(info?.isFile(), label + " shell resource missing: " + entry);
  }
}
console.log("Platform separation passed: mobile/www and desktop/dist are independent, valid shells backed by one canonical source.");
