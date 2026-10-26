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
assert.equal(packageJson.scripts["smoke:release"], "node scripts/smoke-test-release.mjs", "The packaged Windows smoke test must remain available.");
assert.equal(packageJson.build.appId, "com.ritmo.player");
assert.equal(packageJson.build.directories.buildResources, "../assets", "Windows installer should use the existing Ritmo icon.");
assert.ok(packageJson.build.files.includes("!**/node_modules/ritmo-workspace/**"), "The workspace root must not be packed into the desktop runtime as a nested application.");
assert.ok(packageJson.build.files.includes("!**/desktop/release/**"), "Generated Windows release output must never be recursively included in the app.");
assert.ok(packageJson.build.files.includes("!**/release/win-unpacked/**"), "Electron unpacked output must not recursively include its own build directory.");
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
assert.match(electronSource, /if \(smokeTest\) app\.commandLine\.appendSwitch\("use-fake-device-for-media-stream"\)/,
  "A fake media device must only be enabled in the isolated desktop release smoke test.");
assert.match(electronSource, /async function testDesktopMicrophonePermission\(\)/,
  "The release smoke test must exercise the actual Electron media permission handlers.");
assert.match(electronSource, /navigator\.mediaDevices\.getUserMedia\(\{ audio: true, video: false \}\)/,
  "The desktop smoke test must request audio capture.");
assert.match(electronSource, /navigator\.mediaDevices\.getUserMedia\(\{ audio: false, video: true \}\)/,
  "The desktop smoke test must verify that video capture is rejected.");
assert.match(electronSource, /result\.desktopMicrophone\?\.passed === true/,
  "The release smoke test cannot pass if microphone permission checks fail.");
assert.match(electronSource, /setPermissionCheckHandler/, "Desktop APIs must explicitly check media permission.");
assert.match(electronSource, /setPermissionRequestHandler/, "Desktop APIs must explicitly handle microphone permission requests.");
assert.match(electronSource, /isTrustedAppOrigin\(requestingOrigin\)/, "Only the local app origin may pass media permission checks.");
assert.match(electronSource, /details\?\.mediaType === "audio"/, "Media permission checks should allow only audio, not camera.");
assert.match(electronSource, /mediaTypes\.includes\("audio"\) && !mediaTypes\.includes\("video"\)/, "Permission request must reject any capture request that includes video.");
assert.match(electronSource, /webContents === mainWindow\?\.webContents/, "External windows must not receive microphone permission.");

assert.match(workflowSource, /runs-on: windows-latest/);
assert.match(workflowSource, /uses: actions\/upload-artifact@v7/, "Windows artifact upload must use the current Node.js 24-compatible action.");
assert.match(workflowSource, /npm --prefix desktop run smoke:release/, "The Windows workflow must launch and test the packaged portable executable.");
assert.match(electronSource, /RITMO_DESKTOP_SMOKE_TEST/);
assert.match(electronSource, /app\.setPath\("userData"/, "The desktop smoke test must use an isolated, disposable profile.");
assert.match(electronSource, /testLibraryPersistence/, "The packaged smoke test must exercise the actual IndexedDB library.");
assert.match(electronSource, /survivedRestart|saved:/, "The smoke test must report library persistence.");
assert.match(workflowSource, /Ritmo-Windows-\$\{\{ github\.run_number \}\}/);
assert.match(workflowSource, /tags:\s*\["v\*"\]/, "Version tags must trigger a Windows release build.");
assert.match(workflowSource, /Verify release tag matches the desktop version/, "A tag must match the desktop package version before packaging.");
assert.match(workflowSource, /publish-release:\s*\n\s*name: Publish verified Windows build to GitHub Releases\s*\n\s*if: startsWith\(github\.ref, 'refs\/tags\/v'\)\s*\n\s*needs: build-windows\s*\n\s*runs-on: ubuntu-latest\s*\n\s*permissions:\s*\n\s*contents: write/s, "Release publishing must be isolated to successful version-tag builds with scoped write permission.");
assert.match(workflowSource, /uses: actions\/download-artifact@v7/, "Release publishing must use the artifact from the tested build.");
assert.match(workflowSource, /uses: softprops\/action-gh-release@v2/, "Verified Windows builds must be published as a GitHub Release.");
assert.match(workflowSource, /Ritmo-Windows-SHA256\.txt/, "The release must include the artifact checksums.");
assert.match(readme, /GitHub Releases de Ritmo/);
assert.match(readme, /Los artefactos de Actions se conservan 30 días/);

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
