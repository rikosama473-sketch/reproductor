import assert from "node:assert/strict";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const androidRoot = path.join(root, "android");
const config = JSON.parse(await readFile(path.join(root, "capacitor.config.json"), "utf8"));
assert.equal(config.appId, "com.rikosama473.ritmo", "El puente debe usar el package ID de Ritmo");
const javaDirectory = path.join(androidRoot, "app", "src", "main", "java", ...config.appId.split("."));
const targetJava = path.join(javaDirectory, "RitmoMusicLibraryPlugin.java");
const mainActivity = path.join(javaDirectory, "MainActivity.java");
const manifest = path.join(androidRoot, "app", "src", "main", "AndroidManifest.xml");

await mkdir(javaDirectory, { recursive: true });
await copyFile(path.join(root, "native", "android", "RitmoMusicLibraryPlugin.java"), targetJava);
let activity = await readFile(mainActivity, "utf8");
if (!activity.includes("registerPlugin(RitmoMusicLibraryPlugin.class)")) {
  if (!activity.includes("import android.os.Bundle;")) {
    activity = activity.replace(/^package ([^;]+);/m, "$&\n\nimport android.os.Bundle;");
  }
  const emptyClass = /public class MainActivity extends BridgeActivity\s*\{\s*\}/;
  if (emptyClass.test(activity)) {
    activity = activity.replace(emptyClass, `public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    registerPlugin(RitmoMusicLibraryPlugin.class);
    super.onCreate(savedInstanceState);
  }
}`);
  } else if (/public class MainActivity extends BridgeActivity\s*\{/.test(activity)) {
    activity = activity.replace(/public class MainActivity extends BridgeActivity\s*\{/, `public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    registerPlugin(RitmoMusicLibraryPlugin.class);
    super.onCreate(savedInstanceState);
  }`);
  } else {
    throw new Error("No se pudo registrar RitmoMusicLibraryPlugin en MainActivity.java.");
  }
  await writeFile(mainActivity, activity);
}
let manifestText = await readFile(manifest, "utf8");
for (const permission of [
  '<uses-permission android:name="android.permission.READ_MEDIA_AUDIO" />',
  '<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32" />'
]) {
  const name = permission.match(/android:name="([^"]+)"/)[1];
  if (!manifestText.includes(name)) manifestText = manifestText.replace(/(<manifest\b[^>]*>)/, "$1\n    " + permission);
}
await writeFile(manifest, manifestText);
assert.match(activity, /registerPlugin\(RitmoMusicLibraryPlugin\.class\)/);
assert.match(manifestText, /android\.permission\.READ_MEDIA_AUDIO/);
assert.match(manifestText, /READ_EXTERNAL_STORAGE[^>]*maxSdkVersion="32"/);
console.log("Puente nativo de música instalado: permisos granulares, MediaStore y selector de documentos.");
