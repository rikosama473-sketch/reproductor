import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(mobileRoot, "..");
const result = spawnSync(process.execPath, [path.join(repositoryRoot, "scripts", "configure-android.mjs")], {
  cwd: mobileRoot,
  stdio: "inherit",
  env: process.env
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
