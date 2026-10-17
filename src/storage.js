const DB_NAME = "ritmo-library";
const DB_VERSION = 2;
const TRACKS = "tracks";
const HISTORY = "history";
const PLAYLISTS = "playlists";
let databasePromise;

function openDatabase() {
  if (databasePromise) return databasePromise;
  if (!("indexedDB" in globalThis)) {
    return Promise.reject(new Error("Este navegador no permite almacenamiento local persistente."));
  }

  let openingPromise;
  let wasBlocked = false;
  openingPromise = new Promise((resolve, reject) => {
    let request;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (error) {
      // The promise executor runs before openingPromise is assigned, so reset
      // the singleton in a microtask after the assignment has completed.
      queueMicrotask(() => {
        if (databasePromise === openingPromise) databasePromise = null;
      });
      reject(error);
      return;
    }

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
      const db = request.result;
      // The request can still succeed after "blocked" was reported. Its promise
      // has already been rejected, so close this late connection to avoid leaks.
      if (wasBlocked) {
        db.close();
        if (databasePromise === openingPromise) databasePromise = null;
        return;
      }
      db.onversionchange = () => {
        db.close();
        if (databasePromise === openingPromise) databasePromise = null;
      };
      resolve(db);
    };

    request.onerror = () => {
      if (databasePromise === openingPromise) databasePromise = null;
      reject(request.error || new Error("No se pudo abrir la biblioteca."));
    };

    request.onblocked = () => {
      wasBlocked = true;
      if (databasePromise === openingPromise) databasePromise = null;
      reject(new Error("La biblioteca está siendo utilizada por otra pestaña. Cerrá las otras pestañas de Ritmo y volvé a intentar."));
    };
  });

  databasePromise = openingPromise;
  return openingPromise;
}

function storeTransaction(storeName, mode, operation) {
  return openDatabase().then(db => new Promise((resolve, reject) => {
    let tx;
    let request;
    try {
      tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      // Attach transaction handlers before queuing requests so failures are
      // observed even when setup itself throws synchronously.
      tx.oncomplete = () => resolve(request && request.result !== undefined ? request.result : request);
      tx.onerror = () => reject(tx.error || new Error("Falló una operación de almacenamiento."));
      tx.onabort = () => reject(tx.error || new Error("La operación se canceló."));
      request = operation(store);
    } catch (error) {
      // A helper callback can throw after it has already queued a write. Abort
      // the transaction to prevent those earlier requests from committing.
      if (tx) {
        try { tx.abort(); } catch {}
      }
      reject(error);
    }
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
    let tx;
    let operationError = null;
    try {
      tx = db.transaction(TRACKS, "readwrite");
      // Observe the transaction before scheduling writes so a synchronous setup
      // failure can abort and roll back any earlier requests in this batch.
      tx.oncomplete = () => resolve(tracks.length);
      tx.onerror = () => reject(operationError || tx.error || new Error("No se pudieron guardar los archivos."));
      tx.onabort = () => reject(operationError || tx.error || new Error("Se canceló la importación."));
      const store = tx.objectStore(TRACKS);
      for (const track of tracks) store.put(track);
    } catch (error) {
      operationError = error;
      if (tx) {
        try { tx.abort(); } catch { reject(error); }
      } else {
        reject(error);
      }
    }
  });
}
export async function deleteTrack(trackId) { return storeTransaction(TRACKS, "readwrite", store => store.delete(trackId)); }

// Delete a track and remove its ID from every playlist in one readwrite
// transaction. If any playlist update fails, IndexedDB aborts the whole change
// instead of leaving partially-cleaned references behind.
export async function deleteTrackAndPrunePlaylists(trackId) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([TRACKS, PLAYLISTS], "readwrite");
    const tracksStore = tx.objectStore(TRACKS);
    const playlistsStore = tx.objectStore(PLAYLISTS);
    let operationError = null;

    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error || new Error("No se pudo eliminar la canción y actualizar sus listas."));
    tx.onabort = () => reject(operationError || tx.error || new Error("Se canceló la eliminación de la canción."));

    try {
      tracksStore.delete(trackId);
      const cursorRequest = playlistsStore.openCursor();
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor) return;
        const playlist = cursor.value;
        const trackIds = Array.isArray(playlist.trackIds) ? playlist.trackIds : [];
        if (trackIds.includes(trackId)) {
          cursor.update({
            ...playlist,
            trackIds: trackIds.filter(id => id !== trackId),
            updatedAt: Date.now()
          });
        }
        cursor.continue();
      };
      cursorRequest.onerror = () => {
        operationError = cursorRequest.error || new Error("No se pudieron revisar las listas.");
        try { tx.abort(); } catch {}
      };
    } catch (error) {
      operationError = error;
      try { tx.abort(); } catch { reject(error); }
    }
  });
}

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