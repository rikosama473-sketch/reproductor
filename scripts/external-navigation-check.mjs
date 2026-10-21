import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { normalizeExternalMediaUrl } from "../src/external-navigation.js";

const allowed = [
  "https://youtube.com/watch?v=dQw4w9WgXcQ",
  "https://www.youtube.com/results?search_query=lofi%20music",
  "https://open.spotify.com/search/ambient"
];
for (const value of allowed) assert.equal(normalizeExternalMediaUrl(value), new URL(value).href);

const rejected = [
  "",
  "not a URL",
  "javascript:alert(1)",
  "http://youtube.com/watch?v=dQw4w9WgXcQ",
  "https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ",
  "https://youtube.com@evil.example/watch?v=dQw4w9WgXcQ",
  "https://youtube.com:8443/watch?v=dQw4w9WgXcQ",
  "https://youtube.com/account",
  "https://open.spotify.com/artist/someone",
  "https://user:pass@open.spotify.com/search/jazz",
  "https://evil.example/results?search_query=music"
];
for (const value of rejected) assert.equal(normalizeExternalMediaUrl(value), null, "External link should be rejected: " + value);
assert.equal(normalizeExternalMediaUrl("x".repeat(2049)), null);

const app = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
const native = await readFile(new URL("../native/android/RitmoPlaybackPlugin.java", import.meta.url), "utf8");
const mobilePackage = await readFile(new URL("../scripts/prepare-android-native.mjs", import.meta.url), "utf8");
const serviceWorker = await readFile(new URL("../sw.js", import.meta.url), "utf8");

assert.match(app, /import \{ normalizeExternalMediaUrl \} from "\.\/external-navigation\.js"/);
assert.match(app, /openExternal: invoke\("openExternal"\)/);
assert.match(app, /const safeUrl = normalizeExternalMediaUrl\(url\)/);
assert.match(app, /plugin\?\.openExternal/);
assert.match(app, /plugin\.openExternal\(\{ url: safeUrl \}\)\.catch/);
assert.match(app, /openExternalWebFallback\(safeUrl\)/, "The regular web/PWA route remains available.");
assert.match(native, /public void openExternal\(PluginCall call\)/);
assert.match(native, /new Intent\(Intent\.ACTION_VIEW, uri\)/);
assert.match(native, /intent\.addCategory\(Intent\.CATEGORY_BROWSABLE\)/);
assert.match(native, /isAllowedExternalMediaUri\(uri\)/);
assert.match(native, /"youtube\.com"\.equals\(host\)/);
assert.match(native, /"www\.youtube\.com"\.equals\(host\)/);
assert.match(native, /"open\.spotify\.com"\.equals\(host\)/);
assert.match(native, /"https"\.equalsIgnoreCase\(uri\.getScheme\(\)\)/);
assert.match(mobilePackage, /RitmoPlaybackPlugin/);
assert.match(serviceWorker, /ritmo-shell-v53/);
assert.match(serviceWorker, /"\.\/src\/external-navigation\.js"/);
assert.match(app, /youtubeSearchURL\(query\)/);
assert.match(app, /youtubeVideoURL\(videoId\)/);

console.log("External navigation checks passed: strict HTTPS allowlist, Android ACTION_VIEW route and safe web fallback.");
