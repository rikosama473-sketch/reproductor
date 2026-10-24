const DB_NAME = "ritmo-library";
const DB_VERSION = 3;
const TRACKS = "tracks";
const HISTORY = "history";
const PLAYLISTS = "playlists";
const APP_SETTINGS = "appSettings";
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
      if (!db.objectStoreNames.contains(APP_SETTINGS)) {
        db.createObjectStore(APP_SETTINGS, { keyPath: "key" });
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
  // Normalize the limit before opening IndexedDB. In particular, zero should
  // not trigger a full history scan merely to return an empty array.
  const numericLimit = limit == null ? 100 : Number(limit);
  const resolvedLimit = Math.max(0, Math.min(
    Number.isFinite(numericLimit) ? Math.trunc(numericLimit) : 100,
    5000
  ));
  if (resolvedLimit === 0) return [];

  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    let tx;
    const records = [];
    try {
      tx = db.transaction(HISTORY, "readonly");
      const index = tx.objectStore(HISTORY).index("playedAt");
      // Traverse newest-first and stop as soon as the requested window is full.
      // Avoid getAll()+sort(), whose cost grows with the entire history size.
      const request = index.openCursor(null, "prev");
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve(records);
          return;
        }
        records.push(cursor.value);
        if (records.length >= resolvedLimit) {
          resolve(records);
          return;
        }
        cursor.continue();
      };
      request.onerror = () => reject(request.error || new Error("No se pudo leer el historial."));
      tx.onerror = () => reject(tx.error || new Error("No se pudo leer el historial."));
      tx.onabort = () => reject(tx.error || new Error("Se canceló la lectura del historial."));
    } catch (error) {
      reject(error);
    }
  });
}
export async function addHistoryEntry(entry) { return storeTransaction(HISTORY, "readwrite", store => store.put(entry)); }
export async function clearHistory() { return storeTransaction(HISTORY, "readwrite", store => store.clear()); }
export async function getPlaylists() { return getAllFromStore(PLAYLISTS, "updatedAt", true); }
export async function savePlaylist(playlist) { return storeTransaction(PLAYLISTS, "readwrite", store => store.put(playlist)); }
export async function deletePlaylist(playlistId) { return storeTransaction(PLAYLISTS, "readwrite", store => store.delete(playlistId)); }

export async function getAllAppSettings() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(APP_SETTINGS, "readonly");
      const request = tx.objectStore(APP_SETTINGS).getAll();
      request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result : []);
      request.onerror = () => reject(request.error || new Error("No se pudieron leer los ajustes guardados."));
      tx.onerror = () => reject(tx.error || new Error("No se pudieron leer los ajustes guardados."));
      tx.onabort = () => reject(tx.error || new Error("Se canceló la lectura de los ajustes."));
    } catch (error) {
      reject(error);
    }
  });
}

// Merge a validated backup in one IndexedDB transaction. A metadata-only
// backup must never replace an audio Blob already present on this device.
export async function mergeBackupRecords({ tracks = [], history = [], playlists = [], settings = [] } = {}) {
  if (![tracks, history, playlists, settings].every(Array.isArray)) {
    throw new TypeError("El respaldo tiene colecciones inválidas.");
  }
  if (tracks.length > 25000 || history.length > 5000 || playlists.length > 5000 || settings.length > 500) {
    throw new RangeError("El respaldo supera el límite de registros permitido.");
  }
  const db = await openDatabase();
  const stores = [TRACKS, HISTORY, PLAYLISTS, APP_SETTINGS];
  return new Promise((resolve, reject) => {
    let tx;
    let finished = false;
    const result = { tracks: tracks.length, history: history.length, playlists: playlists.length, settings: settings.length };
    const fail = error => {
      if (finished) return;
      finished = true;
      reject(error || new Error("No se pudo importar el respaldo."));
    };
    try {
      tx = db.transaction(stores, "readwrite");
      tx.oncomplete = () => {
        if (finished) return;
        finished = true;
        resolve(result);
      };
      tx.onerror = () => fail(tx.error || new Error("No se pudo importar el respaldo."));
      tx.onabort = () => fail(tx.error || new Error("Se canceló la importación del respaldo."));
      const tracksStore = tx.objectStore(TRACKS);
      for (const track of tracks) {
        if (!track || (typeof track.id !== "string" && typeof track.id !== "number")) {
          throw new TypeError("Una pista del respaldo no tiene identificador válido.");
        }
        if (track.audioMissingInBackup === true) {
          const request = tracksStore.get(track.id);
          request.onsuccess = () => {
            const existing = request.result;
            const existingAudio = existing && (
              existing.blob instanceof Blob ||
              (typeof existing.nativePath === "string" && existing.nativePath) ||
              (typeof existing.nativeUri === "string" && existing.nativeUri)
            );
            const merged = existingAudio ? {
              ...track,
              ...(existing.blob instanceof Blob ? { blob: existing.blob } : {}),
              ...(existing.artworkBlob instanceof Blob && !(track.artworkBlob instanceof Blob)
                ? { artworkBlob: existing.artworkBlob } : {}),
              ...(existing.nativePath ? { nativePath: existing.nativePath } : {}),
              ...(existing.nativeUri ? { nativeUri: existing.nativeUri } : {}),
              audioMissingInBackup: false
            } : track;
            tracksStore.put(merged);
          };
          request.onerror = () => {
            try { tx.abort(); } catch {}
          };
        } else {
          tracksStore.put(track);
        }
      }
      const historyStore = tx.objectStore(HISTORY);
      for (const entry of history) historyStore.put(entry);
      const playlistsStore = tx.objectStore(PLAYLISTS);
      for (const playlist of playlists) playlistsStore.put(playlist);
      const settingsStore = tx.objectStore(APP_SETTINGS);
      for (const setting of settings) settingsStore.put(setting);
    } catch (error) {
      try { tx?.abort(); } catch {}
      fail(error);
    }
  });
}

export async function getAppSetting(key) {
  const settingKey = String(key ?? "").trim();
  if (!settingKey) throw new TypeError("La clave de configuración no puede estar vacía.");
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(APP_SETTINGS, "readonly");
      const request = tx.objectStore(APP_SETTINGS).get(settingKey);
      request.onsuccess = () => resolve(request.result?.value ?? null);
      request.onerror = () => reject(request.error || new Error("No se pudo leer la configuración guardada."));
      tx.onabort = () => reject(tx.error || new Error("Se canceló la lectura de configuración."));
    } catch (error) {
      reject(error);
    }
  });
}
export async function saveAppSetting(key, value) {
  const settingKey = String(key ?? "").trim();
  if (!settingKey) throw new TypeError("La clave de configuración no puede estar vacía.");
  return storeTransaction(APP_SETTINGS, "readwrite", store => store.put({ key: settingKey, value }));
}
export async function deleteAppSetting(key) {
  const settingKey = String(key ?? "").trim();
  if (!settingKey) throw new TypeError("La clave de configuración no puede estar vacía.");
  return storeTransaction(APP_SETTINGS, "readwrite", store => store.delete(settingKey));
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