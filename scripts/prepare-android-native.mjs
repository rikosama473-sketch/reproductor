import assert from "node:assert/strict";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const androidRoot = path.resolve(process.env.RITMO_ANDROID_ROOT || path.join(root, "android"));
const configPath = path.resolve(process.env.RITMO_CAPACITOR_CONFIG || path.join(root, "capacitor.config.json"));
const config = JSON.parse(await readFile(configPath, "utf8"));
assert.equal(config.appId, "com.rikosama473.ritmo", "El puente debe usar el package ID de Ritmo");
const javaDirectory = path.join(androidRoot, "app", "src", "main", "java", ...config.appId.split("."));
const targetJava = path.join(javaDirectory, "RitmoMusicLibraryPlugin.java");
const mainActivity = path.join(javaDirectory, "MainActivity.java");
const manifest = path.join(androidRoot, "app", "src", "main", "AndroidManifest.xml");
const gradleFile = path.join(androidRoot, "app", "build.gradle");

await mkdir(javaDirectory, { recursive: true });
await copyFile(path.join(root, "mobile", "native", "android", "RitmoMusicLibraryPlugin.java"), targetJava);
await copyFile(path.join(root, "mobile", "native", "android", "RitmoPlaybackPlugin.java"), path.join(javaDirectory, "RitmoPlaybackPlugin.java"));
await copyFile(path.join(root, "mobile", "native", "android", "RitmoPlaybackService.java"), path.join(javaDirectory, "RitmoPlaybackService.java"));

let activity = await readFile(mainActivity, "utf8");
if (!activity.includes("import android.os.Bundle;")) {
  activity = activity.replace(/^package ([^;]+);/m, "$&\n\nimport android.os.Bundle;");
}
const pluginClasses = ["RitmoMusicLibraryPlugin", "RitmoPlaybackPlugin"];
if (!/public void onCreate\(Bundle savedInstanceState\)/.test(activity)) {
  const classOpen = /public class MainActivity extends BridgeActivity\s*\{/;
  if (!classOpen.test(activity)) throw new Error("No se encontró MainActivity de Capacitor.");
  const registration = pluginClasses.map(name => "    registerPlugin(" + name + ".class);").join("\n");
  activity = activity.replace(classOpen, match => match + `
  @Override
  public void onCreate(Bundle savedInstanceState) {
${registration}
    super.onCreate(savedInstanceState);
  }
`);
} else {
  for (const name of pluginClasses) {
    if (activity.includes("registerPlugin(" + name + ".class)")) continue;
    const superCall = "super.onCreate(savedInstanceState);";
    const index = activity.indexOf(superCall);
    if (index < 0) throw new Error("No se encontró super.onCreate para registrar " + name + ".");
    activity = activity.slice(0, index) + "registerPlugin(" + name + ".class);\n    " + activity.slice(index);
  }
}
await writeFile(mainActivity, activity, "utf8");
for (const name of pluginClasses) {
  assert.match(activity, new RegExp("registerPlugin\\(" + name + "\\.class\\)"), "Falta registrar " + name);
}

let manifestText = await readFile(manifest, "utf8");
const permissions = [
  '<uses-permission android:name="android.permission.READ_MEDIA_AUDIO" />',
  '<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32" />',
  '<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />',
  '<uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK" />'
];
for (const permission of permissions) {
  const name = permission.match(/android:name="([^"]+)"/)[1];
  if (!manifestText.includes(name)) manifestText = manifestText.replace(/(<manifest\b[^>]*>)/, "$1\n    " + permission);
}
const playbackService = `    <service
        android:name=".RitmoPlaybackService"
        android:exported="true"
        android:foregroundServiceType="mediaPlayback">
        <intent-filter>
            <action android:name="androidx.media3.session.MediaSessionService" />
            <action android:name="android.media.browse.MediaBrowserService" />
        </intent-filter>
    </service>`;
if (!manifestText.includes('android:name=".RitmoPlaybackService"')) {
  if (!manifestText.includes("</application>")) throw new Error("No se encontró el cierre de application en AndroidManifest.xml.");
  manifestText = manifestText.replace("</application>", playbackService + "\n</application>");
}
await writeFile(manifest, manifestText, "utf8");

let gradle = await readFile(gradleFile, "utf8");
const media3Dependencies = [
  "implementation 'androidx.media3:media3-exoplayer:1.11.1'",
  "implementation 'androidx.media3:media3-session:1.11.1'"
];
for (const dependency of media3Dependencies) {
  const artifact = dependency.match(/androidx\.media3:[^']+/)[0];
  if (!gradle.includes(artifact)) {
    const dependencyBlock = /dependencies\s*\{/.exec(gradle);
    if (!dependencyBlock) throw new Error("No se encontró el bloque dependencies de android/app/build.gradle.");
    const insertAt = dependencyBlock.index + dependencyBlock[0].length;
    gradle = gradle.slice(0, insertAt) + "\n    " + dependency + gradle.slice(insertAt);
  }
}
await writeFile(gradleFile, gradle, "utf8");

assert.match(manifestText, /android\.permission\.READ_MEDIA_AUDIO/);
assert.match(manifestText, /READ_EXTERNAL_STORAGE[^>]*maxSdkVersion="32"/);
assert.match(manifestText, /FOREGROUND_SERVICE_MEDIA_PLAYBACK/);
assert.match(manifestText, /RitmoPlaybackService/);
assert.match(gradle, /media3-exoplayer:1\.11\.1/);
assert.match(gradle, /media3-session:1\.11\.1/);
console.log("Puentes nativos instalados: MediaStore, selector de carpetas y reproducción Media3 en servicio.");
