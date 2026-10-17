const DB_NAME = "ritmo-library";
const DB_VERSION = 2;
const TRACKS = "tracks";
const HISTORY = "history";
const PLAYLISTS = "playlists";
let databasePromise;

function openDatabase() {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    if (!("indexedDB" in globalThis)) {
      reject(new Error("Este navegador no permite almacenamiento local persistente."));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(TRACKS)) {
        const store = db.createObjectStore(TRACKS, { keyPath: "id" });
        store.createIndex("addedAt", "addedAt", { unique: false });
      }
      if (!db.objectStoreNames.contains(HISTORY)) {
        const store = db.createObjectStore(HISTORY, { keyPath: "id" });
        store.createIndex("playedAt", "playedAt", { unique: false });
        store.createIndex("trackId", "trackId", { unique: false });
      }
      if (!db.objectStoreNames.contains(PLAYLISTS)) {
        const store = db.createObjectStore(PLAYLISTS, { keyPath: "id" });
        store.createIndex("updatedAt", "updatedAt", { unique: false });
      }
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => { request.result.close(); databasePromise = null; };
      resolve(request.result);
    };
    request.onerror = () => { databasePromise = null; reject(request.error || new Error("No se pudo abrir la biblioteca.")); };
    request.onblocked = () => reject(new Error("Cerrá otras pestañas de Ritmo y volvé a intentar."));
  });
  return databasePromise;
}

function storeTransaction(storeName, mode, operation) {
  return openDatabase().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    let request;
    try { request = operation(store); } catch (error) { reject(error); return; }
    tx.oncomplete = () => resolve(request && request.result !== undefined ? request.result : request);
    tx.onerror = () => reject(tx.error || new Error("Falló una operación de almacenamiento."));
    tx.onabort = () => reject(tx.error || new Error("La operación se canceló."));
  }));
}
function getAllFromStore(storeName, sortKey, descending = true) {
  return openDatabase().then(db => new Promise((resolve, reject) => {
    const request = db.transaction(storeName, "readonly").objectStore(storeName).getAll();
    request.onsuccess = () => {
      const records = request.result || [];
      records.sort((a, b) => ((a[sortKey] || 0) - (b[sortKey] || 0)) * (descending ? -1 : 1));
      resolve(records);
    };
    request.onerror = () => reject(request.error || new Error("No se pudieron leer los datos."));
  }));
}
export async function getAllTracks() { return getAllFromStore(TRACKS, "addedAt", true); }
export async function saveTrack(track) { return storeTransaction(TRACKS, "readwrite", store => store.put(track)); }
export async function saveManyTracks(tracks) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(TRACKS, "readwrite");
    const store = tx.objectStore(TRACKS);
    for (const track of tracks) store.put(track);
    tx.oncomplete = () => resolve(tracks.length);
    tx.onerror = () => reject(tx.error || new Error("No se pudieron guardar los archivos."));
    tx.onabort = () => reject(tx.error || new Error("Se canceló la importación."));
  });
}
export async function deleteTrack(trackId) { return storeTransaction(TRACKS, "readwrite", store => store.delete(trackId)); }

export async function getHistory(limit = 100) {
  const records = await getAllFromStore(HISTORY, "playedAt", true);
  return records.slice(0, Math.max(0, Math.min(Number(limit) || 100, 5000)));
}
export async function addHistoryEntry(entry) { return storeTransaction(HISTORY, "readwrite", store => store.put(entry)); }
export async function clearHistory() { return storeTransaction(HISTORY, "readwrite", store => store.clear()); }
export async function getPlaylists() { return getAllFromStore(PLAYLISTS, "updatedAt", true); }
export async function savePlaylist(playlist) { return storeTransaction(PLAYLISTS, "readwrite", store => store.put(playlist)); }
export async function deletePlaylist(playlistId) { return storeTransaction(PLAYLISTS, "readwrite", store => store.delete(playlistId)); }

export async function estimateStorage() {
  if (!navigator.storage || !navigator.storage.estimate) return null;
  try {
    const estimate = await navigator.storage.estimate();
    return { usage: estimate.usage || 0, quota: estimate.quota || 0 };
  } catch { return null; }
}
export async function requestPersistentStorage() {
  if (!navigator.storage || !navigator.storage.persist) return false;
  try { return await navigator.storage.persist(); } catch { return false; }
}