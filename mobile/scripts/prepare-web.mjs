import { spawnSync } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(mobileRoot, "..");
const webDir = path.join(mobileRoot, "www");
const mobileRuntimeRoot = path.join(mobileRoot, "node_modules");
const repositoryRuntimeRoot = path.join(repositoryRoot, "node_modules");
const mobileRuntime = await stat(path.join(mobileRuntimeRoot, "@capacitor", "core", "dist", "capacitor.js")).catch(() => null);
const runtimeRoot = mobileRuntime?.isFile() ? mobileRuntimeRoot : repositoryRuntimeRoot;

const result = spawnSync(process.execPath, [path.join(repositoryRoot, "scripts", "prepare-mobile.mjs")], {
  cwd: repositoryRoot,
  stdio: "inherit",
  env: {
    ...process.env,
    RITMO_WEB_DIR: webDir,
    RITMO_NODE_MODULES_DIR: runtimeRoot
  }
});

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
