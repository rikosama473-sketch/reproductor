const DB_NAME = "ritmo-library";
const DB_VERSION = 1;
const STORE_NAME = "tracks";
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
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("addedAt", "addedAt", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("No se pudo abrir la biblioteca."));
    request.onblocked = () => reject(new Error("Cerrá otras pestañas de Ritmo y volvé a intentar."));
  });
  return databasePromise;
}

function transaction(mode, operation) {
  return openDatabase().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    let result;
    try { result = operation(store); } catch (error) { reject(error); return; }
    tx.oncomplete = () => resolve(result && result.result !== undefined ? result.result : result);
    tx.onerror = () => reject(tx.error || new Error("Falló una operación de la biblioteca."));
    tx.onabort = () => reject(tx.error || new Error("La operación se canceló."));
  }));
}

export async function getAllTracks() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve((request.result || []).sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0)));
    request.onerror = () => reject(request.error);
  });
}

export async function saveTrack(track) {
  return transaction("readwrite", store => store.put(track));
}

export async function saveManyTracks(tracks) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    for (const track of tracks) store.put(track);
    tx.oncomplete = () => resolve(tracks.length);
    tx.onerror = () => reject(tx.error || new Error("No se pudieron guardar los archivos."));
    tx.onabort = () => reject(tx.error || new Error("Se canceló la importación."));
  });
}

export async function deleteTrack(id) {
  return transaction("readwrite", store => store.delete(id));
}

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