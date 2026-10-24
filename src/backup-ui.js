import {
  createRitmoBackup,
  parseRitmoBackup,
  MAX_BACKUP_FILE_BYTES
} from "./backup.js";
import {
  getAllTracks,
  getHistory,
  getPlaylists,
  getAllAppSettings,
  mergeBackupRecords
} from "./storage.js";

const $ = selector => document.querySelector(selector);
const SENSITIVE_KEY = /token|api.?key|secret|password|credential|authorization|oauth/i;
const SAFE_PREFERENCE_KEY = /^ritmo\.[a-z0-9._-]{1,120}$/i;
let busy = false;

function preferenceEntriesForBackup() {
  const entries = [];
  try {
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (!key || !SAFE_PREFERENCE_KEY.test(key) || SENSITIVE_KEY.test(key)) continue;
      const value = localStorage.getItem(key);
      if (typeof value === "string" && value.length <= 200000) entries.push({ key, value });
    }
  } catch {
    // Private browsing and hardened browsers can make localStorage unreadable.
  }
  return entries;
}

function restoreSafePreferences(entries) {
  let restored = 0;
  for (const entry of entries || []) {
    if (!entry || typeof entry.key !== "string" || typeof entry.value !== "string" ||
        !SAFE_PREFERENCE_KEY.test(entry.key) || SENSITIVE_KEY.test(entry.key)) continue;
    try {
      localStorage.setItem(entry.key, entry.value);
      restored++;
    } catch {
      // Keep the database restore valid even if the browser refuses a preference.
    }
  }
  return restored;
}

function setStatus(message, state = "info") {
  const status = $("#backup-status");
  if (!status) return;
  status.textContent = message;
  status.dataset.state = state;
}

function setBusy(next) {
  busy = Boolean(next);
  const exportButton = $("#backup-export");
  const importButton = $("#backup-import-trigger");
  const audioCheckbox = $("#backup-include-audio");
  if (exportButton) exportButton.disabled = busy;
  if (importButton) importButton.disabled = busy;
  if (audioCheckbox) audioCheckbox.disabled = busy;
}

function downloadTextFile(filename, text) {
  const blob = new Blob([text], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
  return blob.size;
}

async function exportBackup() {
  if (busy) return;
  setBusy(true);
  setStatus("Leyendo biblioteca, listas, historial y ajustes…");
  try {
    const [tracks, history, playlists, settings] = await Promise.all([
      getAllTracks(),
      getHistory(5000),
      getPlaylists(),
      getAllAppSettings()
    ]);
    const includeAudio = Boolean($("#backup-include-audio")?.checked);
    const backup = await createRitmoBackup({
      tracks, history, playlists, settings,
      preferences: preferenceEntriesForBackup(),
      includeAudio,
      now: Date.now()
    });
    const bytes = downloadTextFile(backup.filename, backup.json);
    const sizeLabel = formatBytes(bytes);
    const audioLabel = backup.stats.includesAudio
      ? "Incluye " + formatBytes(backup.stats.audioBytes) + " de audio local."
      : "No incluye canciones originales; conserva metadatos y listas. Si restaurás sobre una pista que todavía existe, no borra su archivo local.";
    const omitted = backup.stats.omittedArtwork
      ? " Se omitieron " + backup.stats.omittedArtwork + " carátula(s) por el límite de tamaño."
      : "";
    setStatus(
      "Respaldo descargado (" + sizeLabel + "): " + backup.stats.tracks + " pistas, " +
      backup.stats.playlists + " listas, " + backup.stats.history + " entradas de historial y " +
      backup.stats.settings + " ajustes. " + audioLabel +
      " Se excluyeron tokens y claves API por seguridad." + omitted,
      "success"
    );
  } catch (error) {
    setStatus(error?.message || "No se pudo crear el respaldo.", "error");
  } finally {
    setBusy(false);
  }
}

async function importBackup(file) {
  if (busy || !file) return;
  setBusy(true);
  setStatus("Validando el respaldo. La biblioteca actual no se va a borrar…");
  try {
    if (file.size > MAX_BACKUP_FILE_BYTES) {
      throw new Error("El archivo supera 40 MiB. Elegí un respaldo más pequeño.");
    }
    if (file.size === 0) throw new Error("El archivo está vacío.");
    const parsed = await parseRitmoBackup(await file.text());
    const restored = await mergeBackupRecords({
      tracks: parsed.tracks,
      history: parsed.history,
      playlists: parsed.playlists,
      settings: parsed.settings
    });
    const preferenceCount = restoreSafePreferences(parsed.preferences);
    const audioMissing = parsed.tracks.filter(track => track.audioMissingInBackup === true).length;
    const audioNote = parsed.includesAudio
      ? " El archivo incluía audio local."
      : (audioMissing
        ? " " + audioMissing + " pista(s) quedaron como referencia sin audio porque esa copia no incluía los archivos musicales. Reimportá esos originales si no estaban ya en este dispositivo."
        : " Se conservaron las referencias de biblioteca; los archivos locales ya existentes no se eliminaron.");
    setStatus(
      "Respaldo importado mediante combinación segura: " + restored.tracks + " pistas, " +
      restored.playlists + " listas, " + restored.history + " entradas de historial, " +
      restored.settings + " ajustes y " + preferenceCount + " preferencias. " +
      "Las entradas con el mismo ID se actualizaron; no se borraron otros datos." +
      audioNote + " Se omitieron tokens y claves API. Actualizando la interfaz…",
      "success"
    );
    window.setTimeout(() => window.location.reload(), 900);
  } catch (error) {
    setStatus(error?.message || "No se pudo importar el respaldo. No se aplicaron cambios si falló la validación.", "error");
  } finally {
    setBusy(false);
  }
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB"];
  const index = Math.min(Math.floor(Math.log(Math.max(bytes, 1)) / Math.log(1024)), units.length - 1);
  return (bytes / Math.pow(1024, index)).toFixed(index ? 1 : 0) + " " + units[index];
}

function bind() {
  const exportButton = $("#backup-export");
  const importButton = $("#backup-import-trigger");
  const filePicker = $("#backup-file");
  if (!exportButton || !importButton || !filePicker || exportButton.dataset.backupBound === "true") return;
  exportButton.dataset.backupBound = "true";
  exportButton.addEventListener("click", () => { void exportBackup(); });
  importButton.addEventListener("click", () => filePicker.click());
  filePicker.addEventListener("change", async () => {
    const file = filePicker.files?.[0];
    try { await importBackup(file); }
    finally { filePicker.value = ""; }
  });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind, { once: true });
else bind();
