import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(mobileRoot, "..");
const result = spawnSync(process.execPath, [path.join(repositoryRoot, "scripts", "prepare-android-native.mjs")], {
  cwd: mobileRoot,
  stdio: "inherit",
  env: {
    ...process.env,
    RITMO_ANDROID_ROOT: path.join(mobileRoot, "android"),
    RITMO_CAPACITOR_CONFIG: path.join(mobileRoot, "capacitor.config.json")
  }
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
