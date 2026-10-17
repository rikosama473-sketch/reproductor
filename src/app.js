import { getAllTracks, saveManyTracks, saveTrack, deleteTrackAndPrunePlaylists, getHistory, addHistoryEntry, clearHistory, getPlaylists, savePlaylist, deletePlaylist, estimateStorage, requestPersistentStorage } from "./storage.js";
import { createYoutubeHistoryController } from "./youtube-history.js";
import { createAudioOutputVolumeController } from "./audio-output-volume.js";
import { clearMediaSession } from "./media-session-state.js";

const $ = selector => document.querySelector(selector);
const defaultAudio = $("#audio-engine");
const equalizedAudio = new Audio();
equalizedAudio.preload = "metadata";
let audio = defaultAudio;
let audioContext = null;
let audioGraph = null;
const audioOutputVolume = createAudioOutputVolumeController({
  defaultAudio,
  equalizedAudio,
  getAudioGraph: () => audioGraph,
  getAudioContext: () => audioContext
});
function setOutputVolume(value) {
  return audioOutputVolume.setVolume(value);
}
let screenWakeLock = null;
let playbackRequestId = 0;
// Identifies a play() request that has not reached confirmed playback yet.
// Pause must cancel intent even while the media element still reports paused.
let pendingPlaybackRequestId = null;
let youtubeSearchRequestId = 0;
let archiveSearchRequestId = 0;
const AUDIO_PREFS_KEY = "ritmo.audio-preferences.v1";
const DEFAULT_AUDIO_PREFS = { equalizerEnabled: false, bass: 0, mid: 0, treble: 0, limiter: true, keepScreenAwake: false, fadeOutAtEnd: true, volume: 0.8, lastAudibleVolume: 0.8 };
function loadAudioPreferences() {
  try {
    const saved = JSON.parse(localStorage.getItem(AUDIO_PREFS_KEY) || "null");
    return {
      ...DEFAULT_AUDIO_PREFS,
      ...(saved && typeof saved === "object" ? saved : {}),
      bass: Math.max(-12, Math.min(12, Number(saved?.bass) || 0)),
      mid: Math.max(-12, Math.min(12, Number(saved?.mid) || 0)),
      treble: Math.max(-12, Math.min(12, Number(saved?.treble) || 0)),
      equalizerEnabled: saved?.equalizerEnabled === true,
      limiter: saved?.limiter !== false,
      keepScreenAwake: saved?.keepScreenAwake === true,
      fadeOutAtEnd: saved?.fadeOutAtEnd !== false,
      volume: Number.isFinite(Number(saved?.volume)) ? Math.max(0, Math.min(1, Number(saved.volume))) : 0.8,
      lastAudibleVolume: Number.isFinite(Number(saved?.lastAudibleVolume)) ? Math.max(0.01, Math.min(1, Number(saved.lastAudibleVolume))) : 0.8
    };
  } catch { return { ...DEFAULT_AUDIO_PREFS }; }
}
const audioPrefs = loadAudioPreferences();
const filePicker = $("#file-picker");
const folderPicker = $("#folder-picker");
const state = { tracks: [], history: [], playlists: [], currentId: null, currentPlaylistId: null, queueIds: null, view: "home", shuffle: false, repeat: "off", query: "", objectUrls: new Map(), installPrompt: null, toastTimer: null, sleepTimer: null, sleepEndsAt: null, sleepFadeTimer: null, youtubeResults: [], youtubeNextPageToken: null, youtubeQuery: "", archiveQuery: "", archiveOffset: 0, archiveTotal: 0, archiveResults: [], archiveFileCache: new Map(), mediaSessionTrackId: null };
 
const LIBRARY_VIEW_KEY = "ritmo.library-view.v1";
let libraryMode = (() => {
  try { return localStorage.getItem(LIBRARY_VIEW_KEY) === "list" ? "list" : "grid"; }
  catch { return "grid"; }
})();


const viewNames = { home: "Inicio", library: "Mi biblioteca", favorites: "Favoritos", history: "Historial", playlists: "Mis listas", offline: "Sin conexión", online: "Música online" };

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}
function id() {
  return globalThis.crypto?.randomUUID ? crypto.randomUUID() : "track-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}
const youtubeHistory = createYoutubeHistoryController({
  addHistoryEntry,
  getHistory,
  createId: id,
  now: () => Date.now(),
  onHistoryUpdated: history => { state.history = history; renderHistory(); }
});
function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60).toString().padStart(2, "0");
  return m + ":" + s;
}
function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return (bytes / Math.pow(1024, index)).toFixed(index ? 1 : 0) + " " + units[index];
}
function titleFromFilename(name) {
  return String(name || "Audio sin título").replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").trim() || "Audio sin título";
}
function metadataForFile(file) {
  const clean = titleFromFilename(file.name);
  const split = clean.split(" - ");
  return { title: split.length > 1 ? split.slice(1).join(" - ").trim() : clean, artist: split.length > 1 ? split[0].trim() : "Artista desconocido" };
}
function importedFileFingerprint(fileOrTrack) {
  const path = String(fileOrTrack.webkitRelativePath || fileOrTrack.sourcePath || fileOrTrack.name || "").replace(/\\/g, "/");
  return path + "|" + fileOrTrack.size + "|" + fileOrTrack.lastModified;
}
function getTrack(trackId) { return state.tracks.find(track => track.id === trackId); }
function currentTrack() { return getTrack(state.currentId); }
function isLocal(track) { return track?.kind === "file" && track.blob instanceof Blob; }
function sourceLabel(track) { return isLocal(track) ? "En este dispositivo" : "Streaming online"; }
function toast(message) {
  const node = $("#toast");
  node.textContent = message;
  node.classList.add("show");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => node.classList.remove("show"), 2800);
}
function trackURL(track) {
  if (isLocal(track)) {
    if (!state.objectUrls.has(track.id)) state.objectUrls.set(track.id, URL.createObjectURL(track.blob));
    return state.objectUrls.get(track.id);
  }
  return track.url;
}

// Only the currently selected local track needs a live object URL. Revoking
// inactive URLs releases their backing Blob references in long listening sessions.
function releaseUnusedObjectURLs(activeTrackId = null) {
  for (const [trackId, objectUrl] of state.objectUrls) {
    if (trackId === activeTrackId) continue;
    try { URL.revokeObjectURL(objectUrl); } catch {}
    state.objectUrls.delete(trackId);
  }
}
function normalizeAudioURL(raw) {
  let parsed;
  try { parsed = new URL(raw); } catch { throw new Error("Ingresá una URL válida."); }
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Solo se aceptan enlaces http o https.");
  if (parsed.username || parsed.password) throw new Error("Por seguridad, no se aceptan credenciales dentro de la URL.");
  if (/youtu\.be|youtube\.com|spotify\.com|music\.apple\.com/i.test(parsed.hostname)) {
    throw new Error("Este campo necesita un enlace directo al audio, no una página de una plataforma.");
  }
  return parsed.href;
}
function coverClass(track) {
  const palettes = ["tone-lilac", "tone-blue", "tone-rose", "tone-green", "tone-amber", "tone-purple"];
  let hash = 0;
  for (const char of (track?.title || "ritmo")) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return palettes[Math.abs(hash) % palettes.length];
}
function coverHTML(track, extra = "") {
  return '<div class="track-mini-cover ' + coverClass(track) + " " + extra + '">♫</div>';
}
function coverCardHTML(track) {
  return '<div class="cover-art ' + coverClass(track) + '"><span>♫</span><button class="card-play" data-play="' + escapeHTML(track.id) + '" aria-label="Reproducir ' + escapeHTML(track.title) + '">▶</button></div>';
}
function syncLibraryViewControls() {
  const listView = $("#library-list-view");
  const gridView = $("#library-grid");
  if (listView) listView.hidden = libraryMode !== "list";
  if (gridView) gridView.hidden = libraryMode !== "grid";
  document.querySelectorAll("[data-library-mode]").forEach(button => {
    const active = button.dataset.libraryMode === libraryMode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}
function setLibraryMode(mode) {
  if (mode !== "grid" && mode !== "list") return;
  libraryMode = mode;
  try { localStorage.setItem(LIBRARY_VIEW_KEY, mode); } catch {}
  syncLibraryViewControls();
}
function renderLibraryGrid(list) {
  const root = $("#library-grid");
  if (!root) return;
  root.innerHTML = list.map((track, index) => {
    const active = track.id === state.currentId;
    const favoriteClass = track.favorite ? " is-favorite" : "";
    const source = isLocal(track) ? "EN ESTE DISPOSITIVO" : "STREAMING ONLINE";
    const download = track.kind !== "url" ? "" : track.sourceProvider === "Internet Archive"
      ? '<a class="row-icon archive-track-download" href="' + escapeHTML(track.url) + '" target="_blank" rel="noopener noreferrer" title="Abrir archivo original" aria-label="Abrir archivo original">⇩</a>'
      : '<button class="row-icon" type="button" data-download-track="' + escapeHTML(track.id) + '" title="Guardar sin conexión si está permitido" aria-label="Guardar audio online sin conexión">⇩</button>';
    return '<article class="library-album-card' + (active ? " library-album-active" : "") + '" data-library-card="' + escapeHTML(track.id) + '">' +
      '<button class="library-album-art ' + coverClass(track) + '" type="button" data-play="' + escapeHTML(track.id) + '" aria-label="Reproducir ' + escapeHTML(track.title) + '">' +
      '<span class="library-art-stamp">' + String(index + 1).padStart(2, "0") + '</span><span class="library-art-glyph">♫</span><span class="library-art-caption">' + escapeHTML(track.album || "RITMO MIX") + '</span><span class="library-art-play">▶</span></button>' +
      '<div class="library-album-meta"><div class="library-album-title-row"><div class="library-album-title"><strong title="' + escapeHTML(track.title) + '">' + escapeHTML(track.title) + '</strong><small>' + escapeHTML(track.artist || "Artista desconocido") + '</small></div><span class="library-album-status' + (active ? " is-live" : "") + '" title="' + (active ? "Pista seleccionada" : source) + '">' + (active ? "♫" : (isLocal(track) ? "●" : "↗")) + '</span></div>' +
      '<div class="library-album-actions"><span class="library-album-source">' + source + '</span><div class="library-album-buttons"><button class="row-icon" data-add-playlist="' + escapeHTML(track.id) + '" type="button" title="Agregar a una lista" aria-label="Agregar a una lista">☷</button>' + download +
      '<button class="row-icon' + favoriteClass + '" data-favorite="' + escapeHTML(track.id) + '" type="button" aria-label="' + (track.favorite ? "Quitar de favoritos" : "Agregar a favoritos") + '" title="Favorito">' + (track.favorite ? "♥" : "♡") + '</button><button class="row-icon delete-track" data-delete="' + escapeHTML(track.id) + '" type="button" aria-label="Eliminar ' + escapeHTML(track.title) + '" title="Eliminar de la biblioteca">×</button></div></div></div></article>';
  }).join("");
  bindRenderedActions(root);
}

function sortedForView(view) {
  let tracks = [...state.tracks];
  if (view === "favorites") tracks = tracks.filter(track => track.favorite);
  if (view === "offline") tracks = tracks.filter(isLocal);
  if (view === "library" && state.query.trim()) {
    const query = state.query.toLocaleLowerCase();
    tracks = tracks.filter(track => (track.title + " " + track.artist + " " + (track.album || "")).toLocaleLowerCase().includes(query));
  }
  return tracks;
}
function trackRow(track, index) {
  const active = track.id === state.currentId;
  const favClass = track.favorite ? " is-favorite" : "";
  return '<div class="track-row' + (active ? ' currently-playing' : '') + '" data-track-row="' + escapeHTML(track.id) + '">' +
    '<span class="track-index">' + (active && !audio.paused ? "♫" : String(index + 1).padStart(2, "0")) + '</span>' +
    '<div class="track-main" data-play="' + escapeHTML(track.id) + '" role="button" tabindex="0" aria-label="Reproducir ' + escapeHTML(track.title) + '">' + coverHTML(track) +
    '<div class="track-copy"><strong>' + escapeHTML(track.title) + '</strong><small>' + escapeHTML(track.artist || "Artista desconocido") + '</small></div></div>' +
    '<span class="source-tag' + (isLocal(track) ? "" : " stream") + '">' + (isLocal(track) ? "Offline" : "Online") + '</span>' +
    '<span class="track-duration">' + (track.duration ? formatTime(track.duration) : "—") + '</span>' +
    '<div class="track-actions"><button class="row-icon" data-add-playlist="' + escapeHTML(track.id) + '" title="Agregar a una lista" aria-label="Agregar a una lista">☷</button>' + (track.kind === "url" ? (track.sourceProvider === "Internet Archive"
      ? '<a class="row-icon archive-track-download" href="' + escapeHTML(track.url) + '" target="_blank" rel="noopener noreferrer" title="Abrir archivo original para descargar" aria-label="Abrir archivo original para descargar">⇩</a>'
      : '<button class="row-icon" type="button" data-download-track="' + escapeHTML(track.id) + '" title="Guardar sin conexión (si está permitido)" aria-label="Guardar audio online sin conexión">⇩</button>') : '') + '<button class="row-icon' + favClass + '" data-favorite="' + escapeHTML(track.id) + '" aria-label="' + (track.favorite ? "Quitar de favoritos" : "Agregar a favoritos") + '">' + (track.favorite ? "♥" : "♡") + '</button><button class="row-icon delete-track" data-delete="' + escapeHTML(track.id) + '" aria-label="Eliminar ' + escapeHTML(track.title) + '" title="Eliminar de la biblioteca">×</button></div></div>';
}
function bindRenderedActions(root) {
  root.querySelectorAll("[data-play]").forEach(button => {
    const play = () => {
      const playlist = root.dataset.playlistContext ? state.playlists.find(list => list.id === root.dataset.playlistContext) : null;
      playTrack(button.dataset.play, true, playlist ? { queueIds: playlist.trackIds } : {});
    };
    button.addEventListener("click", event => { event.stopPropagation(); play(); });
    button.addEventListener("keydown", event => { if (button.tagName !== "BUTTON" && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); play(); } });
  });
  root.querySelectorAll("[data-favorite]").forEach(button => button.addEventListener("click", async event => {
    event.stopPropagation();
    const track = getTrack(button.dataset.favorite);
    if (!track) return;
    const previousFavorite = track.favorite;
    track.favorite = !previousFavorite;
    try {
      await saveTrack(track);
      render();
      updatePlayerFavorite();
    } catch (error) {
      track.favorite = previousFavorite;
      render();
      updatePlayerFavorite();
      toast(error.message || "No se pudo guardar el favorito.");
    }
  }));
  root.querySelectorAll("[data-delete]").forEach(button => button.addEventListener("click", async event => {
    event.stopPropagation();
    const track = getTrack(button.dataset.delete);
    if (!track) return;
    if (!confirm("¿Eliminar «" + track.title + "» de tu biblioteca? El archivo original de tu equipo no se modifica.")) return;
    try {
      if (track.id === state.currentId) await removeCurrent();
      const objectUrl = state.objectUrls.get(track.id);
      await deleteTrackAndPrunePlaylists(track.id);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      state.objectUrls.delete(track.id);
      state.tracks = await getAllTracks();
      state.playlists = await getPlaylists();
      if (Array.isArray(state.queueIds)) state.queueIds = state.queueIds.filter(trackId => trackId !== track.id);
      render();
      toast("Se quitó de tu biblioteca.");
    } catch (error) { toast(error.message || "No se pudo eliminar la canción."); }
  }));

  root.querySelectorAll("[data-download-track]").forEach(button => button.addEventListener("click", event => {
    event.stopPropagation();
    downloadStreamOffline(button.dataset.downloadTrack);
  }));
  root.querySelectorAll("[data-add-playlist]").forEach(button => button.addEventListener("click", async event => {
    event.stopPropagation();
    const track = getTrack(button.dataset.addPlaylist);
    if (!track) return;
    if (!state.playlists.length) {
      showView("playlists");
      $("#playlist-name").focus();
      toast("Creá una lista primero; después podés agregarle canciones.");
      return;
    }
    const choices = state.playlists.map((list, index) => (index + 1) + ". " + list.name).join("\n");
    const answer = prompt("¿A qué lista agregamos «" + track.title + "»? Escribí el número:\n" + choices);
    if (answer === null) return;
    const list = state.playlists[Number.parseInt(answer, 10) - 1];
    if (!list) { toast("Ese número no corresponde a una lista."); return; }
    if (list.trackIds.includes(track.id)) { toast("La canción ya está en esa lista."); return; }
    const previousTrackIds = [...list.trackIds];
    const previousUpdatedAt = list.updatedAt;
    list.trackIds.push(track.id);
    list.updatedAt = Date.now();
    try {
      await savePlaylist(list);
      state.playlists = await getPlaylists();
      renderPlaylists();
      toast("Se agregó a «" + list.name + "».");
    } catch (error) {
      list.trackIds = previousTrackIds;
      list.updatedAt = previousUpdatedAt;
      renderPlaylists();
      toast(error.message || "No se pudo actualizar la lista.");
    }
  }));
function renderTrackList(selector, list, emptySelector) {
  const root = $(selector);
  root.innerHTML = list.map((track, index) => trackRow(track, index)).join("");
  bindRenderedActions(root);
  if (emptySelector) $(emptySelector).hidden = list.length > 0;
}
function renderCards(selector, list) {
  const root = $(selector);
  root.innerHTML = list.slice(0, 4).map(track => '<article class="track-card" data-card="' + escapeHTML(track.id) + '">' + coverCardHTML(track) +
    '<strong title="' + escapeHTML(track.title) + '">' + escapeHTML(track.title) + '</strong><small>' + escapeHTML(track.artist || "Artista desconocido") + '</small></article>').join("");
  root.querySelectorAll("[data-card]").forEach(card => card.addEventListener("click", event => {
    const playButton = event.target.closest("[data-play]");
    playTrack(playButton ? playButton.dataset.play : card.dataset.card);
  }));
  root.querySelectorAll("[data-play]").forEach(button => button.addEventListener("click", event => { event.stopPropagation(); playTrack(button.dataset.play); }));
}

function renderHistory() {
  const root = $("#history-tracks");
  $("#history-count").textContent = String(state.history.length);
  root.innerHTML = state.history.slice(0, 250).map((entry, index) => {
    const track = entry.trackId ? getTrack(entry.trackId) : null;
    const when = entry.playedAt ? new Date(entry.playedAt).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" }) : "";
    const isYoutube = entry.kind === "youtube";
    const action = isYoutube
      ? '<button class="button button-soft history-play" data-history-youtube="' + escapeHTML(entry.videoId || "") + '" data-history-title="' + escapeHTML(entry.title || "") + '" data-history-embeddable="' + String(entry.embeddable === true) + '" data-history-kids="' + String(entry.madeForKids === true) + '">▶ Volver a escuchar</button>'
      : track
        ? '<button class="button button-soft history-play" data-play="' + escapeHTML(track.id) + '">▶ Volver a escuchar</button>'
        : '<span class="history-unavailable">Archivo ya quitado</span>';
    const label = isYoutube ? "YouTube" : track ? (isLocal(track) ? "Archivo local" : "Stream online") : (entry.kind === "file" ? "Archivo local" : "Stream online");
    return '<article class="history-row"><span class="history-index">' + String(index + 1).padStart(2, "0") + '</span><div class="history-track-copy"><strong>' + escapeHTML(entry.title || "Audio sin título") + '</strong><small>' + escapeHTML(entry.artist || "Artista desconocido") + ' · ' + escapeHTML(label) + '</small></div><time>' + escapeHTML(when) + '</time>' + action + '</article>';
  }).join("");
  $("#history-empty").hidden = state.history.length > 0;
  root.querySelectorAll("[data-play]").forEach(button => button.addEventListener("click", () => playTrack(button.dataset.play)));
  root.querySelectorAll("[data-history-youtube]").forEach(button => button.addEventListener("click", () => {
    if (!navigator.onLine) { toast("Este video necesita internet. Su ficha permanece disponible en el historial offline."); return; }
    if (button.dataset.historyEmbeddable === "true" && button.dataset.historyKids !== "true") {
      showView("online");
      playYoutubeVideo(button.dataset.historyYoutube, button.dataset.historyTitle || "Video de YouTube");
    } else openExternal(youtubeVideoURL(button.dataset.historyYoutube));
  }));
}
function renderPlaylists() {
  const root = $("#playlists-list");
  const activeId = state.currentPlaylistId;
  root.innerHTML = state.playlists.map(list => '<article class="playlist-card"><div class="playlist-cover"><span>♫</span><i>✦</i></div><div class="playlist-card-copy"><strong>' + escapeHTML(list.name) + '</strong><small>' + list.trackIds.length + (list.trackIds.length === 1 ? ' canción' : ' canciones') + '</small></div><div class="playlist-card-actions"><button class="button button-soft" data-open-playlist="' + escapeHTML(list.id) + '">Abrir</button><button class="row-icon delete-track" data-delete-playlist="' + escapeHTML(list.id) + '" aria-label="Eliminar lista ' + escapeHTML(list.name) + '" title="Eliminar lista">×</button></div></article>').join("");
  root.querySelectorAll("[data-open-playlist]").forEach(button => button.addEventListener("click", () => { state.currentPlaylistId = button.dataset.openPlaylist; renderPlaylists(); }));
  root.querySelectorAll("[data-delete-playlist]").forEach(button => button.addEventListener("click", async () => {
    const list = state.playlists.find(item => item.id === button.dataset.deletePlaylist);
    if (!list || !confirm("¿Eliminar la lista «" + list.name + "»? Las canciones seguirán en tu biblioteca.")) return;
    try {
      await deletePlaylist(list.id);
      state.playlists = await getPlaylists();
      if (state.currentPlaylistId === list.id) state.currentPlaylistId = null;
      renderPlaylists();
      toast("Lista eliminada.");
    } catch (error) { toast(error.message || "No se pudo eliminar la lista."); }
  }));
  const detail = $("#playlist-detail");
  const selected = state.playlists.find(list => list.id === activeId);
  detail.hidden = !selected;
  root.hidden = Boolean(selected);
  $("#playlists-empty").hidden = Boolean(selected) || state.playlists.length > 0;
  if (!selected) return;
  $("#playlist-detail-title").textContent = selected.name;
  const tracks = selected.trackIds.map(trackId => getTrack(trackId)).filter(Boolean);
  $("#playlist-detail-count").textContent = tracks.length + (tracks.length === 1 ? " canción" : " canciones");
  const tracksRoot = $("#playlist-detail-tracks");
  tracksRoot.dataset.playlistContext = selected.id;
  tracksRoot.innerHTML = tracks.map((track, index) => trackRow(track, index)).join("");
  tracksRoot.querySelectorAll("[data-track-row]").forEach(row => {
    const actions = row.querySelector(".track-actions");
    if (!actions) return;
    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "row-icon delete-track";
    removeButton.textContent = "−";
    removeButton.title = "Quitar de esta lista";
    removeButton.setAttribute("aria-label", "Quitar canción de esta lista");
    removeButton.addEventListener("click", async event => {
      event.stopPropagation();
      const list = state.playlists.find(item => item.id === state.currentPlaylistId);
      if (!list) return;
      const previousTrackIds = [...list.trackIds];
      const previousUpdatedAt = list.updatedAt;
      list.trackIds = list.trackIds.filter(trackId => trackId !== row.dataset.trackRow);
      list.updatedAt = Date.now();
      try {
        await savePlaylist(list);
        state.playlists = await getPlaylists();
        renderPlaylists();
        toast("Canción quitada de la lista.");
      } catch (error) {
        list.trackIds = previousTrackIds;
        list.updatedAt = previousUpdatedAt;
        renderPlaylists();
        toast(error.message || "No se pudo actualizar la lista.");
      }
    });
    actions.prepend(removeButton);
  });
  bindRenderedActions(tracksRoot);
  $("#playlist-detail-empty").hidden = tracks.length > 0;
  $("#playlist-play-all").disabled = !tracks.length;
}
function saveAudioPreferences() {
  try { localStorage.setItem(AUDIO_PREFS_KEY, JSON.stringify(audioPrefs)); } catch {}
}
function applyAudioGraphPreferences() {
  if (!audioGraph || !audioContext) return;
  const now = audioContext.currentTime;
  audioGraph.bass.gain.setTargetAtTime(audioPrefs.bass, now, 0.02);
  audioGraph.mid.gain.setTargetAtTime(audioPrefs.mid, now, 0.02);
  audioGraph.treble.gain.setTargetAtTime(audioPrefs.treble, now, 0.02);
  audioGraph.compressor.threshold.setTargetAtTime(audioPrefs.limiter ? -8 : 0, now, 0.02);
  audioGraph.compressor.knee.setTargetAtTime(audioPrefs.limiter ? 8 : 0, now, 0.02);
  audioGraph.compressor.ratio.setTargetAtTime(audioPrefs.limiter ? 8 : 1, now, 0.02);
  audioGraph.outputGain.gain.setTargetAtTime(audioPrefs.volume, now, 0.02);
}
async function ensureAudioProcessing() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) throw new Error("Este navegador no permite aplicar el ecualizador.");
  if (!audioContext) audioContext = new AudioContextClass();
  if (!audioGraph) {
    const source = audioContext.createMediaElementSource(equalizedAudio);
    const bass = audioContext.createBiquadFilter();
    bass.type = "lowshelf";
    bass.frequency.value = 120;
    const mid = audioContext.createBiquadFilter();
    mid.type = "peaking";
    mid.frequency.value = 1000;
    mid.Q.value = 0.85;
    const treble = audioContext.createBiquadFilter();
    treble.type = "highshelf";
    treble.frequency.value = 8000;
    const compressor = audioContext.createDynamicsCompressor();
    compressor.attack.value = 0.003;
    compressor.release.value = 0.22;
    const outputGain = audioContext.createGain();
    source.connect(bass);
    bass.connect(mid);
    mid.connect(treble);
    treble.connect(compressor);
    compressor.connect(outputGain);
    outputGain.connect(audioContext.destination);
    audioGraph = { bass, mid, treble, compressor, outputGain };
    applyAudioGraphPreferences();
    setOutputVolume(audioPrefs.volume);
  }
  if (audioContext.state !== "running") await audioContext.resume();
  if (audioContext.state !== "running") throw new Error("El navegador mantuvo suspendido el motor de sonido.");
}
function showPlaybackStatus(message, kind = "info", allowRetry = false) {
  const panel = $("#playback-status");
  if (!panel) return;
  $("#playback-status-message").textContent = message || "";
  panel.classList.toggle("is-error", kind === "error");
  panel.classList.toggle("is-warning", kind === "warning");
  panel.hidden = !message;
  $("#playback-retry").hidden = !allowRetry;
}
function mediaErrorMessage(track, error) {
  if (!navigator.onLine && !isLocal(track)) return "Sin conexión: esta fuente online no puede reproducirse en este momento.";
  if (error?.code === 1) return "La reproducción se interrumpió. Volvé a intentarlo.";
  if (error?.code === 2) return "Falló la conexión con la fuente de audio. Revisá internet o reintentá.";
  if (error?.code === 3) return "El navegador no pudo decodificar este audio. Probá otro formato compatible.";
  if (error?.code === 4) return "Formato o fuente no compatible. Probá MP3, M4A/AAC, WAV, Ogg/Opus o FLAC si tu navegador los admite.";
  return "No se pudo cargar el audio. La fuente puede estar caída, restringida o usar un formato incompatible.";
}
function retryCurrentPlayback() {
  const track = currentTrack();
  if (!track) return;
  const position = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
  playTrack(track.id, true, { keepQueue: true, resumeAt: position, skipHistory: true, forceReload: true });
}

// Route every resume through the request-token-aware player. Calling
// audio.play() directly from a UI/system control can revive the previous
// source while a newer selection is still preparing its engine.
function resumeCurrentTrack() {
  const track = currentTrack();
  if (!track) return;
  const position = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
  playTrack(track.id, true, { keepQueue: true, resumeAt: position, skipHistory: true });
}
function cancelPendingPlaybackIntent() {
  playbackRequestId += 1;
  pendingPlaybackRequestId = null;
}
function pauseCurrentTrack() {
  // Cancel asynchronous intent as well as pausing current media. A late
  // AudioContext.resume() or play() continuation must not restart the track.
  cancelPendingPlaybackIntent();
  audio.pause();
  updatePlayer();
  updateMediaSession();
}
function bindAudioEngineEvents(element) {
  const isActive = () => element === audio;
  element.addEventListener("timeupdate", () => { if (isActive()) { updatePlayer(); updateMediaSession(); } });
  element.addEventListener("durationchange", async () => {
    if (!isActive()) return;
    const track = currentTrack();
    if (track && Number.isFinite(element.duration)) { track.duration = element.duration; try { await saveTrack(track); } catch {} }
    updatePlayer();
  });
  element.addEventListener("play", () => { if (isActive()) { showPlaybackStatus(""); updatePlayer(); updateMediaSession(); } });
  element.addEventListener("playing", () => { if (isActive()) { showPlaybackStatus(""); updatePlayer(); updateMediaSession(); } });
  element.addEventListener("pause", () => { if (isActive()) { updatePlayer(); updateMediaSession(); } });
  element.addEventListener("waiting", () => {
    if (isActive() && !element.paused) showPlaybackStatus("Esperando datos de audio… Si no continúa, podés reintentar.", "warning", true);
  });
  element.addEventListener("stalled", () => {
    if (isActive() && !element.paused) showPlaybackStatus("La fuente dejó de enviar datos temporalmente. Revisá la conexión o reintentá.", "warning", true);
  });
  element.addEventListener("ended", () => {
    if (!isActive()) return;
    if (state.repeat === "one") { element.currentTime = 0; resumeCurrentTrack(); }
    else nextTrack(1);
  });
  element.addEventListener("error", () => {
    if (!isActive() || !currentTrack()) return;
    showPlaybackStatus(mediaErrorMessage(currentTrack(), element.error), "error", true);
  });
}
function syncSettingsUI() {
  $("#eq-enabled").checked = audioPrefs.equalizerEnabled;
  $("#eq-bass").value = String(audioPrefs.bass);
  $("#eq-mid").value = String(audioPrefs.mid);
  $("#eq-treble").value = String(audioPrefs.treble);
  $("#limiter-toggle").checked = audioPrefs.limiter;
  $("#keep-screen-awake").checked = audioPrefs.keepScreenAwake;
  $("#sleep-fade").checked = audioPrefs.fadeOutAtEnd;
  for (const [id, value] of [["eq-bass-value", audioPrefs.bass], ["eq-mid-value", audioPrefs.mid], ["eq-treble-value", audioPrefs.treble]]) {
    $("#" + id).textContent = (value > 0 ? "+" : "") + value + " dB";
  }
  applyAudioGraphPreferences();
}
async function renderStorageStatus() {
  const node = $("#storage-permission-status");
  try {
    const persisted = navigator.storage?.persisted ? await navigator.storage.persisted() : false;
    const estimate = await estimateStorage();
    node.textContent = !navigator.storage?.persist
      ? "Este navegador no ofrece el control de almacenamiento persistente."
      : persisted
        ? "Almacenamiento persistente concedido; el navegador reduce el riesgo de limpiar la biblioteca automáticamente."
        : "El navegador todavía no concedió almacenamiento persistente. Podés solicitarlo con el botón.";
    if (estimate?.quota) node.textContent += " Espacio: " + formatBytes(estimate.usage) + " usados de " + formatBytes(estimate.quota) + ".";
  } catch { node.textContent = "No se pudo consultar el permiso o la cuota de almacenamiento."; }
}
async function renderDiagnostics() {
  const rows = [
    ["Audio nativo", defaultAudio.canPlayType ? "Disponible" : "No disponible"],
    ["Controles de pantalla bloqueada", "mediaSession" in navigator ? "API disponible (depende del navegador y sistema)" : "No disponible en este navegador"],
    ["Ecualizador local", (window.AudioContext || window.webkitAudioContext) ? "Disponible para archivos locales" : "No disponible en este navegador"],
    ["Mantener pantalla despierta", navigator.wakeLock ? "API disponible; requiere que Ritmo esté visible" : "No compatible en este navegador"],
    ["IndexedDB", "indexedDB" in window ? "Disponible en este navegador" : "No disponible"],
    ["Service Worker / modo sin conexión", "serviceWorker" in navigator ? "API disponible" : "No disponible"],
    ["Conexión", navigator.onLine ? "Conectado" : "Sin conexión"],
    ["Fuente actual", currentTrack() ? (isLocal(currentTrack()) ? "Archivo local" : "Fuente online") : "No hay una canción activa"]
  ];
  $("#diagnostics-list").innerHTML = rows.map(([label, value]) => '<div class="diagnostic-row"><span>' + escapeHTML(label) + '</span><strong>' + escapeHTML(value) + '</strong></div>').join("");
  await renderStorageStatus();
}
async function requestScreenWakeLock() {
  if (!audioPrefs.keepScreenAwake) return;
  if (!navigator.wakeLock?.request) {
    $("#wake-lock-status").textContent = "Este navegador no admite el bloqueo de pantalla desde una web.";
    return;
  }
  if (document.visibilityState !== "visible") {
    $("#wake-lock-status").textContent = "Se intentará activar cuando Ritmo vuelva a estar visible.";
    return;
  }
  try {
    if (screenWakeLock && !screenWakeLock.released) return;
    screenWakeLock = await navigator.wakeLock.request("screen");
    screenWakeLock.addEventListener("release", () => {
      screenWakeLock = null;
      if (audioPrefs.keepScreenAwake) $("#wake-lock-status").textContent = "El sistema liberó el bloqueo de pantalla; Ritmo puede volver a solicitarlo al estar visible.";
    });
    $("#wake-lock-status").textContent = "Activo mientras Ritmo permanece visible. No impide que el sistema cierre o suspenda la aplicación.";
  } catch (error) {
    screenWakeLock = null;
    $("#wake-lock-status").textContent = error?.name === "NotAllowedError"
      ? "El navegador o el sistema rechazó el permiso (por ejemplo, por batería baja o porque la página no está visible)."
      : "No se pudo mantener la pantalla despierta en este momento.";
  }
}
async function releaseScreenWakeLock() {
  if (!screenWakeLock) return;
  const lock = screenWakeLock;
  screenWakeLock = null;
  try { await lock.release(); } catch {}
}
function startSleepTimer(minutes) {
  clearTimeout(state.sleepTimer);
  state.sleepTimer = null;
  state.sleepEndsAt = null;
  if (state.sleepFadeTimer) { clearInterval(state.sleepFadeTimer); state.sleepFadeTimer = null; }
  const volume = Number($("#volume-bar").value);
  setOutputVolume(volume);
  if (!minutes) {
    $("#sleep-status").textContent = "Temporizador desactivado.";
    return;
  }
  state.sleepEndsAt = Date.now() + minutes * 60_000;
  state.sleepTimer = setTimeout(() => {
    state.sleepTimer = null;
    state.sleepEndsAt = null;
    if (audioPrefs.fadeOutAtEnd && !audio.paused) {
      let step = 0;
      const steps = 20;
      state.sleepFadeTimer = setInterval(() => {
        step += 1;
        // Read the current slider preference on every tick so a volume change
        // during the timer/fade isn't overwritten by an old captured value.
        const currentVolume = Number($("#volume-bar").value);
        const fadedVolume = currentVolume * Math.max(0, 1 - step / steps);
        setOutputVolume(fadedVolume);
        if (step >= steps) {
          clearInterval(state.sleepFadeTimer);
          state.sleepFadeTimer = null;
          // The timer must cancel requests that are preparing to play, not
          // merely pause media elements that have not started yet.
          cancelPendingPlaybackIntent();
          defaultAudio.pause();
          equalizedAudio.pause();
          const restoredVolume = Number($("#volume-bar").value);
          setOutputVolume(restoredVolume);
          stopYoutubePlayback();
          updatePlayer();
          updateMediaSession();
          showPlaybackStatus("Temporizador finalizado: música detenida.", "info", false);
          toast("Temporizador finalizado.");
        }
      }, 250);
    } else {
      pauseCurrentTrack();
      stopYoutubePlayback();
      updatePlayer();
      showPlaybackStatus("Temporizador finalizado: música detenida.", "info", false);
      toast("Temporizador finalizado.");
    }
  }, minutes * 60_000);
  $("#sleep-status").textContent = "La música se detendrá en " + (minutes >= 60 ? (minutes / 60) + (minutes === 60 ? " hora." : " horas.") : minutes + " minutos.");
}
function applyCurrentEnginePreference() {
  const track = currentTrack();
  if (!track || !isLocal(track)) return;
  const position = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
  const wasPlaying = !audio.paused;
  playTrack(track.id, wasPlaying, { keepQueue: true, resumeAt: position, skipHistory: true });
}
function openSettings() {
  syncSettingsUI();
  $("#settings-dialog").showModal();
  renderDiagnostics();
}

function activeQueueIds() {
  return (Array.isArray(state.queueIds) ? state.queueIds : state.tracks.map(track => track.id))
    .filter(trackId => Boolean(getTrack(trackId)));
}
function renderQueue() {
  const root = $("#queue-items");
  if (!root) return;
  const ids = activeQueueIds();
  const custom = Array.isArray(state.queueIds);
  const currentInQueue = ids.includes(state.currentId);
  $("#queue-summary").textContent = (custom ? "Cola personalizada o de lista" : "Orden actual de tu biblioteca") +
    " · " + ids.length + (ids.length === 1 ? " canción" : " canciones") +
    (currentInQueue ? " · La canción activa está marcada." : "");
  root.innerHTML = ids.map((trackId, index) => {
    const track = getTrack(trackId);
    const active = track.id === state.currentId;
    return '<article class="queue-row' + (active ? ' queue-row-active' : '') + '" data-queue-row="' + escapeHTML(track.id) + '">' +
      '<span class="queue-position">' + String(index + 1).padStart(2, "0") + '</span>' +
      '<div class="queue-track-copy"><strong>' + escapeHTML(track.title) + '</strong><small>' + escapeHTML(track.artist || "Artista desconocido") + ' · ' + (active ? "Sonando" : "En cola") + '</small></div>' +
      '<div class="queue-row-actions">' +
      '<button class="row-icon" data-queue-play="' + escapeHTML(track.id) + '" type="button" aria-label="Reproducir ' + escapeHTML(track.title) + '" title="Reproducir ahora">▶</button>' +
      '<button class="row-icon" data-queue-up="' + escapeHTML(track.id) + '" type="button" aria-label="Mover ' + escapeHTML(track.title) + ' hacia arriba" title="Mover hacia arriba" ' + (index === 0 ? "disabled" : "") + '>↑</button>' +
      '<button class="row-icon" data-queue-down="' + escapeHTML(track.id) + '" type="button" aria-label="Mover ' + escapeHTML(track.title) + ' hacia abajo" title="Mover hacia abajo" ' + (index === ids.length - 1 ? "disabled" : "") + '>↓</button>' +
      '<button class="row-icon delete-track" data-queue-remove="' + escapeHTML(track.id) + '" type="button" aria-label="Quitar ' + escapeHTML(track.title) + ' de la cola" title="Quitar de la cola">×</button></div></article>';
  }).join("");
  $("#queue-empty").hidden = ids.length > 0;
  root.querySelectorAll("[data-queue-play]").forEach(button => button.addEventListener("click", () => {
    const options = Array.isArray(state.queueIds) ? { queueIds: state.queueIds } : {};
    playTrack(button.dataset.queuePlay, true, options);
    renderQueue();
  }));
  for (const [action, delta] of [["up", -1], ["down", 1]]) {
    root.querySelectorAll("[data-queue-" + action + "]").forEach(button => button.addEventListener("click", () => {
      if (!Array.isArray(state.queueIds)) state.queueIds = state.tracks.map(track => track.id);
      const position = state.queueIds.indexOf(button.dataset["queue" + (action === "up" ? "Up" : "Down")]);
      const other = position + delta;
      if (position < 0 || other < 0 || other >= state.queueIds.length) return;
      [state.queueIds[position], state.queueIds[other]] = [state.queueIds[other], state.queueIds[position]];
      renderQueue();
    }));
  }
  root.querySelectorAll("[data-queue-remove]").forEach(button => button.addEventListener("click", () => {
    if (!Array.isArray(state.queueIds)) state.queueIds = state.tracks.map(track => track.id);
    state.queueIds = state.queueIds.filter(trackId => trackId !== button.dataset.queueRemove);
    renderQueue();
    toast("Canción quitada de la cola. El archivo sigue en tu biblioteca.");
  }));
}
function updateMuteButton() {
  const button = $("#volume-mute-button");
  if (!button) return;
  const muted = Number($("#volume-bar").value) <= 0.001;
  button.textContent = muted ? "◖×" : "◖))";
  button.setAttribute("aria-label", muted ? "Activar sonido" : "Silenciar");
  button.setAttribute("title", muted ? "Activar sonido" : "Silenciar");
}
function toggleMute() {
  const slider = $("#volume-bar");
  if (Number(slider.value) > 0.001) {
    audioPrefs.lastAudibleVolume = Number(slider.value);
    audioPrefs.volume = 0;
  } else {
    audioPrefs.volume = Math.max(0.01, Math.min(1, Number(audioPrefs.lastAudibleVolume) || 0.8));
  }
  slider.value = String(audioPrefs.volume);
  setOutputVolume(audioPrefs.volume);
  $("#expanded-volume-bar").value = String(audioPrefs.volume);
  saveAudioPreferences();
  updateMuteButton();
}

function renderFormatCapabilities() {
  const formats = [
    ["MP3", "audio/mpeg"], ["M4A / MP4 audio", "audio/mp4"], ["AAC", "audio/aac"],
    ["WAV", "audio/wav"], ["Ogg Vorbis", 'audio/ogg; codecs="vorbis"'], ["Ogg Opus", 'audio/ogg; codecs="opus"'],
    ["WebM Opus", 'audio/webm; codecs="opus"'], ["FLAC", "audio/flac"], ["AIFF", "audio/aiff"], ["WMA / APE", ""]
  ];
  const probe = document.createElement("audio");
  $("#format-capabilities").innerHTML = formats.map(([name, mime]) => {
    if (!mime) return '<span class="format-chip limited"><i></i>' + escapeHTML(name) + '<small>limitado</small></span>';
    const answer = probe.canPlayType(mime);
    const stateClass = answer === "probably" ? "yes" : answer === "maybe" ? "maybe" : "limited";
    const text = answer === "probably" ? "probable" : answer === "maybe" ? "posible" : "limitado";
    return '<span class="format-chip ' + stateClass + '"><i></i>' + escapeHTML(name) + '<small>' + text + '</small></span>';
  }).join("");
}
async function createPlaylist(event) {
  event.preventDefault();
  const name = $("#playlist-name").value.trim();
  if (!name) return;
  const list = { id: id(), name, trackIds: [], createdAt: Date.now(), updatedAt: Date.now() };
  try {
    await savePlaylist(list);
    state.playlists = await getPlaylists();
    state.currentPlaylistId = list.id;
    $("#playlist-name").value = "";
    renderPlaylists();
    toast("Lista «" + name + "» creada.");
  } catch (error) { toast(error.message || "No se pudo crear la lista."); }
}
async function clearPlaybackHistory() {
  if (!state.history.length) return;
  if (!confirm("¿Limpiar todo el historial de reproducciones de este dispositivo? La biblioteca y las listas no se borran.")) return;
  try { await clearHistory(); state.history = []; renderHistory(); toast("Historial limpiado."); }
  catch (error) { toast(error.message || "No se pudo limpiar el historial."); }
}
function updateMediaSession() {
  if (!("mediaSession" in navigator)) return;
  const track = currentTrack();
  if (!track) { clearMediaSession(navigator.mediaSession, state); return; }
  if (state.mediaSessionTrackId !== track.id && "MediaMetadata" in window) {
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title || "Audio sin título", artist: track.artist || "Artista desconocido", album: track.album || "Ritmo",
        artwork: [{ src: new URL("./assets/icon.svg", location.href).href, sizes: "any", type: "image/svg+xml" }]
      });
      state.mediaSessionTrackId = track.id;
    } catch {}
  }
  try { navigator.mediaSession.playbackState = audio.paused ? "paused" : "playing"; } catch {}
  if (Number.isFinite(audio.duration) && audio.duration > 0 && typeof navigator.mediaSession.setPositionState === "function") {
    try { navigator.mediaSession.setPositionState({ duration: audio.duration, position: Math.min(audio.currentTime, audio.duration), playbackRate: audio.playbackRate || 1 }); } catch {}
  }
}
function setupMediaSession() {
  if (!("mediaSession" in navigator)) return;
  const handlers = {
    play: () => resumeCurrentTrack(), pause: () => pauseCurrentTrack(), stop: () => pauseCurrentTrack(),
    previoustrack: () => $("#previous-button").click(), nexttrack: () => $("#next-button").click(),
    seekbackward: details => { audio.currentTime = Math.max(0, audio.currentTime - (details.seekOffset || 10)); },
    seekforward: details => { const step = details.seekOffset || 10; audio.currentTime = Number.isFinite(audio.duration) ? Math.min(audio.duration, audio.currentTime + step) : audio.currentTime + step; },
    seekto: details => { if (Number.isFinite(audio.duration) && Number.isFinite(details.seekTime)) audio.currentTime = Math.max(0, Math.min(audio.duration, details.seekTime)); }
  };
  for (const [action, handler] of Object.entries(handlers)) { try { navigator.mediaSession.setActionHandler(action, handler); } catch {} }
}
\nfunction render() {
  const all = state.tracks;
  $("#library-count").textContent = String(all.length);
  $("#stat-total").innerHTML = all.length + ' <small>canciones</small>';
  $("#stat-favorites").innerHTML = all.filter(track => track.favorite).length + ' <small>guardadas</small>';
  $("#stat-offline").innerHTML = all.filter(isLocal).length + ' <small>archivos locales</small>';
  const visibleLibraryTracks = sortedForView("library");
  $("#library-meta").textContent = visibleLibraryTracks.length + (visibleLibraryTracks.length === 1 ? " canción" : " canciones");
  renderCards("#recent-tracks", all);
  $("#home-empty").hidden = all.length > 0;
  renderTrackList("#library-tracks", visibleLibraryTracks, "#library-empty");
  renderLibraryGrid(visibleLibraryTracks);
  syncLibraryViewControls();
  renderTrackList("#favorite-tracks", sortedForView("favorites"), "#favorites-empty");
  renderTrackList("#offline-tracks", sortedForView("offline"), "#offline-empty");
  $("#library-empty").hidden = all.length > 0;
  $("#library-no-results").hidden = !(all.length > 0 && Boolean(state.query.trim()) && visibleLibraryTracks.length === 0);
  $("#home-empty").hidden = all.length > 0;
  renderHistory();
  renderPlaylists();
  renderQueue();
  renderFormatCapabilities();
  updatePlayer();
  updateConnection();
}
function updatePlayer() {
  const track = currentTrack();
  $("#player-title").textContent = track ? track.title : "Todavía no suena nada";
  $("#player-artist").textContent = track ? (track.artist || sourceLabel(track)) : "Elegí una canción de tu biblioteca";
  $("#play-button").disabled = !track;
  $("#previous-button").disabled = !state.tracks.length;
  $("#next-button").disabled = !state.tracks.length;
  $("#seek-bar").disabled = !track;
  $("#player-favorite").disabled = !track;
  $("#player-cover").className = "cover-thumb cover-placeholder " + (track ? coverClass(track) : "");
  $("#player-favorite").textContent = track?.favorite ? "♥" : "♡";
  $("#player-favorite").classList.toggle("is-favorite", Boolean(track?.favorite));
  $("#player-favorite").setAttribute("aria-label", track?.favorite ? "Quitar de favoritos" : "Marcar favorito");
  $("#play-button").textContent = audio.paused ? "▶" : "Ⅱ";
  $("#play-button").setAttribute("aria-label", audio.paused ? "Reproducir" : "Pausar");
  $("#shuffle-button").classList.toggle("active", state.shuffle);
  $("#repeat-button").classList.toggle("active", state.repeat !== "off");
  $("#repeat-button").setAttribute("aria-label", "Repetición: " + ({ off: "desactivada", all: "toda la cola", one: "una canción" }[state.repeat]));
  $("#repeat-button").textContent = state.repeat === "one" ? "↻¹" : "↻";
  const isOnline = track && !isLocal(track);
  $("#current-time").textContent = formatTime(audio.currentTime);
  $("#duration-time").textContent = formatTime(Number.isFinite(audio.duration) ? audio.duration : track?.duration);
  $("#seek-bar").value = Number.isFinite(audio.duration) && audio.duration > 0 ? String(Math.round(audio.currentTime / audio.duration * 1000)) : "0";
  const expandedTitle = $("#expanded-title");
  if (expandedTitle) {
    $("#expanded-title").textContent = track ? track.title : "Todavía no suena nada";
    $("#expanded-artist").textContent = track ? (track.artist || sourceLabel(track)) : "Elegí una canción de tu biblioteca";
    $("#expanded-cover").className = "expanded-cover-art " + (track ? coverClass(track) : "tone-purple");
    $("#expanded-art-backdrop").className = "immersive-backdrop " + (track ? coverClass(track) : "tone-purple");
    $("#expanded-favorite-button").disabled = !track;
    $("#expanded-favorite-button").textContent = track?.favorite ? "♥" : "♡";
    $("#expanded-favorite-button").classList.toggle("is-favorite", Boolean(track?.favorite));
    $("#expanded-favorite-button").setAttribute("aria-label", track?.favorite ? "Quitar de favoritos" : "Agregar a favoritos");
    $("#expanded-play-button").disabled = !track;
    $("#expanded-play-button").textContent = audio.paused ? "▶" : "Ⅱ";
    $("#expanded-play-button").setAttribute("aria-label", audio.paused ? "Reproducir" : "Pausar");
    $("#expanded-previous-button").disabled = !state.tracks.length;
    $("#expanded-next-button").disabled = !state.tracks.length;
    $("#expanded-seek-bar").disabled = !track;
    $("#expanded-current-time").textContent = formatTime(audio.currentTime);
    $("#expanded-duration-time").textContent = formatTime(Number.isFinite(audio.duration) ? audio.duration : track?.duration);
    $("#expanded-seek-bar").value = Number.isFinite(audio.duration) && audio.duration > 0 ? String(Math.round(audio.currentTime / audio.duration * 1000)) : "0";
    $("#expanded-volume-bar").value = $("#volume-bar").value;
    $("#expanded-shuffle-button").classList.toggle("active", state.shuffle);
    $("#expanded-repeat-button").classList.toggle("active", state.repeat !== "off");
    $("#expanded-repeat-button").textContent = state.repeat === "one" ? "↻¹" : "↻";
    $("#expanded-repeat-button").setAttribute("aria-label", "Repetición: " + ({ off: "desactivada", all: "toda la cola", one: "una canción" }[state.repeat]));
    $("#expanded-source-label").textContent = track ? (isLocal(track) ? "Archivo local · disponible sin conexión" : "Fuente online · requiere conexión") : "Listo cuando vos quieras";
  }
  updateMuteButton();
}
function updatePlayerFavorite() {
  const track = currentTrack();
  $("#player-favorite").textContent = track?.favorite ? "♥" : "♡";
  $("#player-favorite").classList.toggle("is-favorite", Boolean(track?.favorite));
}
function updateConnection() {
  const online = navigator.onLine;
  $("#connection-label").textContent = online ? "Conectado" : "Sin conexión";
  $("#connection-dot").classList.toggle("offline", !online);
}
let youtubePlayer = null;
let youtubePlayerApiPromise = null;

function recordConfirmedYoutubePlayback(event) {
  if (!window.YT || event.data !== window.YT.PlayerState.PLAYING) return;
  const player = event.target;
  if (typeof player?.getPlayerState === "function" && player.getPlayerState() !== window.YT.PlayerState.PLAYING) return;
  youtubeHistory.recordPlaying(player?.getVideoData?.()?.video_id);
}

function attachYoutubePlayer(frame) {
  if (youtubePlayer || !window.YT?.Player || !frame) return;
  try {
    youtubePlayer = new window.YT.Player(frame, {
      events: {
        onReady: event => {
          const iframe = event.target.getIframe();
          iframe.title = "Reproductor oficial de YouTube";
          iframe.setAttribute("allow", "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share");
          iframe.setAttribute("allowfullscreen", "");
          if (event.target.getPlayerState() === window.YT.PlayerState.PLAYING) {
            youtubeHistory.recordPlaying(event.target.getVideoData()?.video_id);
          }
        },
        onStateChange: recordConfirmedYoutubePlayback
      }
    });
  } catch {
    // Direct iframe playback remains available even if the optional event API fails.
    youtubePlayer = null;
  }
}

function ensureYoutubePlayerApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (youtubePlayerApiPromise) return youtubePlayerApiPromise;

  youtubePlayerApiPromise = new Promise((resolve, reject) => {
    const previousReady = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      try { if (typeof previousReady === "function") previousReady(); } catch {}
      resolve(window.YT);
    };
    let script = document.querySelector('script[src="https://www.youtube.com/iframe_api"]');
    if (!script) {
      script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      script.async = true;
    }
    script.addEventListener("error", () => {
      youtubePlayerApiPromise = null;
      reject(new Error("No se pudo cargar la API de eventos de YouTube."));
    }, { once: true });
    if (!script.isConnected) document.head.appendChild(script);
  });
  return youtubePlayerApiPromise;
}

function stopYoutubePlayback() {
  youtubeHistory.cancel();
  const frame = $("#youtube-iframe");
  if (youtubePlayer) {
    try { youtubePlayer.stopVideo(); } catch {}
  } else if (frame && frame.src && frame.src.includes("youtube.com/embed/")) {
    frame.src = "about:blank";
  }
  const wrap = $("#youtube-player-wrap");
  if (wrap) wrap.hidden = true;
}
function showView(view) {
  if (!viewNames[view]) return;
  if (view !== "online") stopYoutubePlayback();
  state.view = view;
  document.querySelectorAll(".view-panel").forEach(node => { node.hidden = node.id !== view + "-view"; });
  document.querySelectorAll(".nav-item").forEach(node => node.classList.toggle("active", node.dataset.view === view));
  $("#page-crumb").textContent = viewNames[view];
  $("#sidebar").classList.remove("open");
  if (view === "library") $("#library-search").focus({ preventScroll: true });
}
async function playTrack(trackId, autoplay = true, options = {}) {
  const track = getTrack(trackId);
  if (!track) return;
  const requestId = ++playbackRequestId;
  pendingPlaybackRequestId = autoplay ? requestId : null;
  const isCurrentPlaybackRequest = () => requestId === playbackRequestId;
  if (!$("#youtube-player-wrap").hidden) stopYoutubePlayback();
  if (Array.isArray(options.queueIds)) state.queueIds = options.queueIds.filter(id => Boolean(getTrack(id)));
  else if (!options.keepQueue) state.queueIds = null;
  state.currentId = track.id;
  try {
    let desiredEngine = isLocal(track) && audioPrefs.equalizerEnabled ? equalizedAudio : defaultAudio;
    if (desiredEngine === equalizedAudio) {
      try {
        await ensureAudioProcessing();
        if (!isCurrentPlaybackRequest()) return;
      } catch (error) {
        if (!isCurrentPlaybackRequest()) return;
        audioPrefs.equalizerEnabled = false;
        saveAudioPreferences();
        syncSettingsUI();
        desiredEngine = defaultAudio;
        toast(error.message || "Ecualizador no disponible; se usará el audio original.");
      }
    }
    if (!isCurrentPlaybackRequest()) return;
    if (desiredEngine !== audio) {
      const previousEngine = audio;
      previousEngine.pause();
      previousEngine.removeAttribute("src");
      previousEngine.load();
      audio = desiredEngine;
    }
    setOutputVolume(Number($("#volume-bar").value));
    const url = trackURL(track);
    const resolvedURL = new URL(url, location.href).href;
    if (audio.src !== resolvedURL || options.forceReload) {
      audio.src = url;
      audio.load();
    }
    releaseUnusedObjectURLs(isLocal(track) ? track.id : null);
    if (Number.isFinite(options.resumeAt) && options.resumeAt > 0) {
      const targetEngine = audio;
      const restorePosition = () => {
        try { targetEngine.currentTime = Number.isFinite(targetEngine.duration) && targetEngine.duration > 0 ? Math.min(options.resumeAt, targetEngine.duration) : options.resumeAt; } catch {}
      };
      if (targetEngine.readyState >= 1) restorePosition();
      else targetEngine.addEventListener("loadedmetadata", restorePosition, { once: true });
    }
    if (autoplay) await audio.play();
    if (!isCurrentPlaybackRequest()) return;
    pendingPlaybackRequestId = null;
    showPlaybackStatus("");
    if (autoplay && !options.skipHistory) {
      track.lastPlayedAt = Date.now();
      try { await saveTrack(track); } catch {}
      try {
        await addHistoryEntry({ id: id(), trackId: track.id, kind: track.kind, title: track.title,
          artist: track.artist || "Artista desconocido", album: track.album || "", playedAt: Date.now(),
          source: isLocal(track) ? "Archivo local" : "Stream online" });
        const refreshedHistory = await getHistory(250);
        if (isCurrentPlaybackRequest()) state.history = refreshedHistory;
      } catch {}
    }
    if (!isCurrentPlaybackRequest()) return;
    render();
    updatePlayer();
  } catch (error) {
    if (!isCurrentPlaybackRequest()) return;
    pendingPlaybackRequestId = null;
    const extension = (track.name || track.url || "").split(/[?#]/)[0].split(".").pop()?.toUpperCase();
    const message = error?.name === "NotAllowedError"
      ? "El navegador bloqueó el inicio automático. Tocá Reproducir para habilitar el audio."
      : (error?.message || ("No se pudo reproducir (" + (extension || "formato desconocido") + "). Puede que falte el códec o que la fuente no admita reproducción directa."));
    showPlaybackStatus(message, "error", true);
    toast(message);
    updatePlayer();
  }
}
function nextTrack(direction = 1) {
  const ids = Array.isArray(state.queueIds) ? state.queueIds.filter(trackId => Boolean(getTrack(trackId))) : state.tracks.map(track => track.id);
  const candidates = ids.map(trackId => getTrack(trackId)).filter(Boolean);
  if (!candidates.length) { pauseCurrentTrack(); return; }
  const foundIndex = candidates.findIndex(track => track.id === state.currentId);
  const currentIndex = foundIndex >= 0 ? foundIndex : (direction > 0 ? -1 : candidates.length);
  let nextIndex;
  if (state.shuffle && candidates.length > 1) {
    const others = candidates.map((track, index) => index).filter(index => index !== currentIndex);
    nextIndex = others[Math.floor(Math.random() * others.length)];
  } else {
    nextIndex = currentIndex + direction;
    if (nextIndex >= candidates.length) nextIndex = state.repeat === "all" ? 0 : -1;
    if (nextIndex < 0) nextIndex = state.repeat === "all" ? candidates.length - 1 : -1;
  }
  if (nextIndex < 0) { pauseCurrentTrack(); return; }
  playTrack(candidates[nextIndex].id, true, { keepQueue: true });
}
async function readMp3Tags(file) {
  const fallback = metadataForFile(file);
  if (!/\.mp3$/i.test(file.name) || file.size < 10) return fallback;
  try {
    const bytes = new Uint8Array(await file.slice(0, Math.min(file.size, 2 * 1024 * 1024)).arrayBuffer());
    if (String.fromCharCode(bytes[0], bytes[1], bytes[2]) !== "ID3") return fallback;
    const version = bytes[3];
    const tagSize = ((bytes[6] & 0x7f) << 21) | ((bytes[7] & 0x7f) << 14) | ((bytes[8] & 0x7f) << 7) | (bytes[9] & 0x7f);
    let offset = 10;
    const limit = Math.min(bytes.length, 10 + tagSize);
    const parsed = { ...fallback };
    function decodeText(data) {
      if (!data.length) return "";
      const encoding = data[0], payload = data.slice(1);
      let decoder;
      try { decoder = encoding === 0 ? new TextDecoder("windows-1252") : encoding === 1 ? new TextDecoder("utf-16") : encoding === 2 ? new TextDecoder("utf-16be") : new TextDecoder("utf-8"); }
      catch { decoder = new TextDecoder(); }
      return decoder.decode(payload).replace(/\u0000/g, "").trim();
    }
    while (offset + 10 <= limit) {
      const frameId = String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
      if (!/^[A-Z0-9]{4}$/.test(frameId)) break;
      const sizeBytes = bytes.slice(offset + 4, offset + 8);
      const size = version === 4
        ? ((sizeBytes[0] & 0x7f) << 21) | ((sizeBytes[1] & 0x7f) << 14) | ((sizeBytes[2] & 0x7f) << 7) | (sizeBytes[3] & 0x7f)
        : ((sizeBytes[0] << 24) | (sizeBytes[1] << 16) | (sizeBytes[2] << 8) | sizeBytes[3]);
      if (!size || size < 0 || offset + 10 + size > limit) break;
      if (["TIT2", "TPE1", "TALB"].includes(frameId)) {
        const value = decodeText(bytes.slice(offset + 10, offset + 10 + size));
        if (value) { if (frameId === "TIT2") parsed.title = value; if (frameId === "TPE1") parsed.artist = value; if (frameId === "TALB") parsed.album = value; }
      }
      offset += 10 + size;
    }
    return parsed;
  } catch { return fallback; }
}
async function downloadStreamOffline(trackId) {
  const source = getTrack(trackId);
  if (!source || source.kind !== "url") return;
  if (!confirm("¿El sitio autoriza descargar y guardar este audio para escucharlo sin conexión? Solo se guardará si el servidor permite una descarga directa.")) return;
  if (!navigator.onLine) { toast("Necesitás conexión para guardar esta fuente."); return; }
  const MAX_DOWNLOAD_BYTES = 150 * 1024 * 1024;
  let reader = null;
  try {
    const response = await fetch(source.url, { mode: "cors", credentials: "omit", cache: "no-store" });
    if (!response.ok) throw new Error("El servidor respondió " + response.status + ".");
    const rawType = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    const filename = (() => {
      try { return decodeURIComponent(new URL(source.url).pathname.split("/").pop() || "audio-offline"); }
      catch { return "audio-offline"; }
    })();
    const isAudioExtension = /\.(mp3|m4a|mp4|aac|wav|wave|ogg|oga|opus|webm|flac|aiff|aif|alac|wma|ape|mp2|caf|3gp|amr)$/i.test(filename);
    const genericContentType = !rawType || ["application/octet-stream", "application/x-download", "application/ogg", "video/mp4"].includes(rawType);
    if (rawType.startsWith("text/") || rawType.includes("html") ||
        !(rawType.startsWith("audio/") || (isAudioExtension && genericContentType))) {
      throw new Error("La URL no parece entregar un archivo de audio directo.");
    }
    const declaredLength = Number(response.headers.get("content-length") || 0);
    if (declaredLength > MAX_DOWNLOAD_BYTES) throw new Error("El archivo supera el límite local de 150 MB por descarga.");
    const chunks = [];
    let total = 0;
    if (response.body?.getReader) {
      reader = response.body.getReader();
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        total += part.value.byteLength;
        if (total > MAX_DOWNLOAD_BYTES) {
          await reader.cancel();
          throw new Error("El archivo supera el límite local de 150 MB por descarga.");
        }
        chunks.push(part.value);
      }
    } else {
      const blob = await response.blob();
      if (blob.size > MAX_DOWNLOAD_BYTES) throw new Error("El archivo supera el límite local de 150 MB por descarga.");
      chunks.push(blob);
      total = blob.size;
    }
    if (!total) throw new Error("El servidor devolvió un archivo vacío.");
    const fallbackMimes = {
      mp3: "audio/mpeg", m4a: "audio/mp4", mp4: "audio/mp4", aac: "audio/aac",
      wav: "audio/wav", wave: "audio/wav", ogg: "audio/ogg", oga: "audio/ogg",
      opus: "audio/ogg", webm: "audio/webm", flac: "audio/flac", aiff: "audio/aiff",
      aif: "audio/aiff", alac: "audio/mp4", wma: "audio/x-ms-wma", ape: "audio/ape",
      mp2: "audio/mpeg", caf: "audio/x-caf", "3gp": "audio/3gpp", amr: "audio/amr"
    };
    const extension = filename.split(".").pop().toLowerCase();
    const blobMime = rawType.startsWith("audio/") ? rawType : (fallbackMimes[extension] || "application/octet-stream");
    const blob = new Blob(chunks, { type: blobMime });
    const storage = await estimateStorage();
    if (storage?.quota && storage.usage + blob.size > storage.quota * 0.95) {
      throw new Error("No queda espacio suficiente en el navegador. Liberá almacenamiento antes de descargar.");
    }
    const offlineTrack = {
      id: id(), kind: "file", name: filename, title: source.title || titleFromFilename(filename),
      artist: source.artist || "Fuente online", album: source.album || "", blob, size: blob.size,
      mimeType: blob.type || rawType || "application/octet-stream", lastModified: Date.now(),
      favorite: false, addedAt: Date.now(), duration: source.duration || 0, lastPlayedAt: 0,
      downloadedFromUrl: source.url
    };
    await saveTrack(offlineTrack);
    state.tracks = await getAllTracks();
    try { await requestPersistentStorage(); } catch {}
    render();
    toast("Audio guardado en tu biblioteca offline (" + formatBytes(blob.size) + ").");
  } catch (error) {
    const message = error instanceof TypeError
      ? "No se pudo descargar: el servidor puede bloquear las descargas del navegador (CORS) o requerir permiso. Ritmo no intenta eludir esa restricción."
      : (error.message || "No se pudo guardar la fuente offline.");
    toast(message);
    showPlaybackStatus(message, "warning", false);
  } finally {
    try { reader?.releaseLock(); } catch {}
  }
}

async function importFiles(fileList) {
  const files = [...fileList].filter(file => file.type.startsWith("audio/") || /\.(mp3|m4a|mp4|aac|wav|wave|ogg|oga|opus|webm|flac|aiff|aif|alac|wma|ape|mp2|mid|midi|caf|3gp|amr)$/i.test(file.name));
  if (!files.length) { toast("No encontré archivos de audio compatibles."); return; }
  const existing = new Set(state.tracks.filter(track => isLocal(track)).map(importedFileFingerprint));
  const uniqueFiles = [];
  for (const file of files) {
    const fingerprint = importedFileFingerprint(file);
    if (!existing.has(fingerprint)) { existing.add(fingerprint); uniqueFiles.push(file); }
  }
  if (!uniqueFiles.length) { toast("Esos archivos ya están en tu biblioteca."); return; }
  let saved = 0, bytesSaved = 0, failure = null;
  const BATCH_SIZE = 20;
  for (let offset = 0; offset < uniqueFiles.length; offset += BATCH_SIZE) {
    const batch = uniqueFiles.slice(offset, offset + BATCH_SIZE);
    toast("Importando " + Math.min(offset + batch.length, uniqueFiles.length) + " de " + uniqueFiles.length + " archivos…");
    try {
      const tracks = await Promise.all(batch.map(async file => {
        const meta = await readMp3Tags(file);
        return { id: id(), kind: "file", name: file.name, sourcePath: file.webkitRelativePath || file.name, title: meta.title, artist: meta.artist, album: meta.album || "",
          size: file.size, mimeType: file.type || "application/octet-stream", lastModified: file.lastModified,
          blob: file, favorite: false, addedAt: Date.now() + saved, duration: 0, lastPlayedAt: 0 };
      }));
      await saveManyTracks(tracks);
      saved += tracks.length;
      bytesSaved += tracks.reduce((sum, track) => sum + track.size, 0);
    } catch (error) { failure = error; break; }
  }
  try { state.tracks = await getAllTracks(); } catch {}
  render();
  if (saved) {
    toast(saved + (saved === 1 ? " archivo importado" : " archivos importados") + " · " + formatBytes(bytesSaved) + (failure ? " · importación parcial" : ""));
    requestPersistentStorage().catch(() => {});
    if (!currentTrack()) showView("library");
  } else {
    toast(failure?.name === "QuotaExceededError" ? "No hay espacio suficiente en el navegador. Importá menos archivos por vez o liberá almacenamiento." : (failure?.message || "No se pudo importar la música."));
  }
}
async function removeCurrent() {
  // Invalidate any play()/AudioContext continuation that is still awaiting a
  // result; otherwise it could restore the source after the user removes it.
  cancelPendingPlaybackIntent();
  const track = currentTrack();
  if (!track) return;
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
  releaseUnusedObjectURLs(null);
  state.currentId = null;
  updatePlayer();
  updateMediaSession();
}
async function addStream(event) {
  event.preventDefault();
  const titleInput = $("#stream-title");
  const urlInput = $("#stream-url");
  const message = $("#url-message");
  message.textContent = "";
  let url;
  try { url = normalizeAudioURL(urlInput.value.trim()); }
  catch (error) { message.textContent = error.message; message.style.color = "#ffb4b4"; return; }
  const existing = state.tracks.find(track => track.kind === "url" && track.url === url);
  if (existing) { message.textContent = "Ese enlace ya está en tu biblioteca."; message.style.color = "#ffb98e"; return; }
  const urlName = (() => { try { return decodeURIComponent(new URL(url).pathname.split("/").pop() || "Audio online"); } catch { return "Audio online"; } })();
  const title = titleInput.value.trim() || titleFromFilename(urlName);
  const track = { id: id(), kind: "url", url, name: urlName, title, artist: "Fuente online", favorite: false, addedAt: Date.now(), duration: 0, lastPlayedAt: 0 };
  try {
    await saveTrack(track);
    state.tracks = await getAllTracks();
    render();
    message.style.color = "#a7e6bd";
    message.textContent = "Fuente guardada. Probá reproducirla desde tu biblioteca.";
    titleInput.value = "";
    urlInput.value = "";
    toast("Fuente online agregada.");
    setTimeout(() => showView("library"), 800);
  } catch (error) { message.textContent = error.message || "No se pudo guardar la fuente."; message.style.color = "#ffb4b4"; }
}

const YOUTUBE_KEY_STORAGE = "ritmo.youtube-data-api-key.v1";
const YOUTUBE_SEARCH_CACHE_STORAGE = "ritmo.youtube-search-cache.v1";
function readYoutubeSearchCache() {
  try { const data = JSON.parse(localStorage.getItem(YOUTUBE_SEARCH_CACHE_STORAGE) || "null"); return data && typeof data.query === "string" && Array.isArray(data.items) ? data : null; }
  catch { return null; }
}
function persistYoutubeSearchCache(query, items) {
  try { localStorage.setItem(YOUTUBE_SEARCH_CACHE_STORAGE, JSON.stringify({ query, savedAt: Date.now(), items: (items || []).slice(0, 60) })); } catch {}
}
function youtubeApiKey() {
  try { return localStorage.getItem(YOUTUBE_KEY_STORAGE) || ""; } catch { return ""; }
}
function youtubeSearchURL(query) {
  return "https://www.youtube.com/results?search_query=" + encodeURIComponent(query || "");
}
function youtubeVideoURL(videoId) {
  return "https://www.youtube.com/watch?v=" + encodeURIComponent(videoId);
}
function openExternal(url) {
  const link = document.createElement("a");
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.referrerPolicy = "no-referrer";
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
}
const ARCHIVE_PAGE_SIZE = 12;
const ARCHIVE_AUDIO_EXTENSIONS = /\.(mp3|m4a|aac|wav|wave|ogg|oga|opus|flac|aiff|aif|mp2)$/i;
function archiveItemURL(identifier) {
  return "https://archive.org/details/" + encodeURIComponent(identifier);
}
function archiveFileURL(identifier, name) {
  const encodedName = String(name || "").split("/").map(part => encodeURIComponent(part)).join("/");
  return "https://archive.org/download/" + encodeURIComponent(identifier) + "/" + encodedName;
}
function archiveValue(value) {
  if (Array.isArray(value)) return value.map(item => String(item ?? "")).filter(Boolean).join(", ");
  return String(value ?? "");
}
function renderArchiveResults(items, append = false) {
  const root = $("#archive-results");
  const cards = (items || []).map(item => {
    const identifier = String(item.identifier || "");
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(identifier)) return "";
    const title = archiveValue(item.title) || identifier;
    const creator = archiveValue(item.creator) || "Autoría no indicada en metadatos";
    const year = archiveValue(item.year || item.date);
    const note = "Creative Commons declarado por los metadatos; verificá condiciones específicas en la ficha.";
    return '<article class="archive-result" data-archive-result="' + escapeHTML(identifier) + '">' +
      '<div class="archive-result-main"><div class="archive-result-label">INTERNET ARCHIVE · AUDIO</div><strong>' + escapeHTML(title) + '</strong>' +
      '<small>' + escapeHTML(creator) + (year ? " · " + escapeHTML(year) : "") + '</small><p>' + note + '</p>' +
      '<div class="archive-result-actions"><button class="button button-primary" type="button" data-archive-inspect="' + escapeHTML(identifier) + '">Ver licencia y archivos</button>' +
      '<a class="button button-soft" target="_blank" rel="noopener noreferrer" href="' + escapeHTML(archiveItemURL(identifier)) + '">Abrir ficha ↗</a></div></div>' +
      '<div class="archive-files" data-archive-files="' + escapeHTML(identifier) + '" hidden></div></article>';
  }).join("");
  if (!append) root.innerHTML = "";
  if (cards) root.insertAdjacentHTML("beforeend", cards);
}
function renderArchiveFiles(identifier, container, entry) {
  const license = entry.license;
  const licenseLink = '<a href="' + escapeHTML(license) + '" target="_blank" rel="noopener noreferrer">Leer la licencia Creative Commons ↗</a>';
  const filesHTML = entry.files.map((file, index) => {
    const size = Number(file.size) > 0 ? formatBytes(Number(file.size)) : "Tamaño no indicado";
    const format = archiveValue(file.format) || file.name.split(".").pop().toUpperCase();
    const url = archiveFileURL(identifier, file.name);
    return '<div class="archive-file-row"><div class="archive-file-copy"><strong>' + escapeHTML(file.name) + '</strong><small>' +
      escapeHTML(format) + ' · ' + escapeHTML(size) + '</small></div><div class="archive-file-actions">' +
      '<button class="button button-soft" type="button" data-archive-add="' + escapeHTML(identifier) + '" data-archive-file-index="' + index + '">Agregar</button>' +
      '<button class="button button-primary" type="button" data-archive-play="' + escapeHTML(identifier) + '" data-archive-file-index="' + index + '">Reproducir</button>' +
      '<a class="archive-download-link" href="' + escapeHTML(url) + '" target="_blank" rel="noopener noreferrer">Descargar original ↗</a></div></div>';
  }).join("");
  container.innerHTML = '<div class="archive-license-badge"><strong>Licencia declarada:</strong> ' + licenseLink +
    '<p>Guardá o compartí la obra respetando la licencia indicada. La ficha de origen es la referencia para las condiciones aplicables.</p></div>' +
    '<div class="archive-file-list">' + filesHTML + '</div>';
  container.hidden = false;
}
async function inspectArchiveItem(identifier, button) {
  const container = document.querySelector('[data-archive-files="' + identifier + '"]');
  if (!container) return;
  const cached = state.archiveFileCache.get(identifier);
  if (cached) {
    container.hidden = !container.hidden;
    if (!container.hidden) renderArchiveFiles(identifier, container, cached);
    button.textContent = container.hidden ? "Ver licencia y archivos" : "Ocultar archivos";
    return;
  }
  const original = button.textContent;
  button.disabled = true;
  button.textContent = "Comprobando…";
  container.hidden = false;
  container.innerHTML = '<p class="archive-inline-status">Comprobando licencia y formatos disponibles…</p>';
  try {
    const response = await fetch("https://archive.org/metadata/" + encodeURIComponent(identifier), {
      mode: "cors", credentials: "omit", cache: "no-store"
    });
    if (!response.ok) throw new Error("Internet Archive respondió " + response.status + ".");
    const data = await response.json();
    const metadata = data.metadata || {};
    const result = state.archiveResults.find(item => item.identifier === identifier) || {};
    const license = archiveValue(metadata.licenseurl || result.licenseurl);
    const mediatype = archiveValue(metadata.mediatype || result.mediatype).toLowerCase();
    let parsedLicense = null;
    try { parsedLicense = new URL(license); } catch {}
    const isCCLicense = Boolean(parsedLicense && (parsedLicense.hostname === "creativecommons.org" || parsedLicense.hostname.endsWith(".creativecommons.org")) &&
      /\/(licenses|publicdomain)\//i.test(parsedLicense.pathname));
    if (mediatype !== "audio" || !isCCLicense) {
      throw new Error("No pude verificar una licencia Creative Commons y un tipo de elemento de audio en sus metadatos. Por seguridad no ofrezco estos archivos desde Ritmo; revisá la ficha original.");
    }
    const preferred = { mp3: 0, m4a: 1, aac: 2, ogg: 3, oga: 3, opus: 4, flac: 5, wav: 6, wave: 6, aiff: 7, aif: 7, mp2: 8 };
    const files = (Array.isArray(data.files) ? data.files : [])
      .filter(file => file && typeof file.name === "string" && ARCHIVE_AUDIO_EXTENSIONS.test(file.name) && file.private !== "true")
      .filter(file => !Number(file.size) || Number(file.size) > 0)
      .sort((a, b) => {
        const ae = a.name.split(".").pop().toLowerCase(), be = b.name.split(".").pop().toLowerCase();
        return (preferred[ae] ?? 99) - (preferred[be] ?? 99) || (Number(a.size) || 0) - (Number(b.size) || 0);
      }).slice(0, 12);
    if (!files.length) throw new Error("La ficha declara licencia Creative Commons, pero no encontramos archivos de audio directos en formatos conocidos. Abrí la ficha original para ver todos sus formatos.");
    const entry = { metadata, result, license, files };
    state.archiveFileCache.set(identifier, entry);
    renderArchiveFiles(identifier, container, entry);
  } catch (error) {
    container.innerHTML = '<p class="archive-inline-status archive-inline-error">' + escapeHTML(error.message || "No se pudo verificar este elemento.") +
      ' <a href="' + escapeHTML(archiveItemURL(identifier)) + '" target="_blank" rel="noopener noreferrer">Abrir la ficha original ↗</a></p>';
  } finally {
    button.disabled = false;
    button.textContent = state.archiveFileCache.has(identifier) ? (container.hidden ? "Ver licencia y archivos" : "Ocultar archivos") : original;
  }
}
async function addArchiveFile(identifier, index, playNow = false) {
  const entry = state.archiveFileCache.get(identifier);
  const file = entry?.files[index];
  if (!entry || !file) { toast("Volvé a comprobar la licencia y los archivos de este resultado."); return; }
  const url = archiveFileURL(identifier, file.name);
  let track = state.tracks.find(item => item.kind === "url" && item.url === url);
  if (!track) {
    const baseTitle = archiveValue(entry.metadata.title || entry.result.title) || titleFromFilename(file.name);
    const fileTitle = titleFromFilename(file.name);
    track = {
      id: id(), kind: "url", url, name: file.name,
      title: entry.files.length > 1 ? (baseTitle + " — " + fileTitle) : baseTitle,
      artist: archiveValue(entry.metadata.creator || entry.result.creator) || "Autoría no indicada",
      album: "Internet Archive · Creative Commons", favorite: false,
      addedAt: Date.now(), duration: 0, lastPlayedAt: 0,
      sourceProvider: "Internet Archive", sourcePage: archiveItemURL(identifier),
      licenseUrl: entry.license, archiveIdentifier: identifier, archiveFileName: file.name
    };
    try {
      await saveTrack(track);
      state.tracks = await getAllTracks();
      render();
      toast("Se agregó el audio abierto a tu biblioteca. La pista se reproduce desde Internet Archive.");
    } catch (error) { toast(error.message || "No se pudo agregar esta fuente."); return; }
  } else {
    toast("Ese archivo ya está en tu biblioteca.");
  }
  if (playNow) await playTrack(track.id);
}
async function searchArchiveAudio(loadMore = false) {
  const requestId = ++archiveSearchRequestId;
  const isCurrentArchiveSearch = () => requestId === archiveSearchRequestId;
  const button = $("#archive-search-button");
  const loadButton = $("#archive-load-more");
  const query = loadMore ? state.archiveQuery : $("#archive-query").value.trim();
  if (!query) {
    $("#archive-status").textContent = "Escribí un artista, género o título para buscar.";
    button.disabled = false;
    button.innerHTML = 'Buscar catálogo <span>→</span>';
    loadButton.disabled = false;
    loadButton.textContent = "Cargar más resultados ↓";
    return;
  }
  if (!navigator.onLine) {
    $("#archive-status").textContent = "El catálogo abierto necesita conexión. Tu biblioteca local sigue disponible offline.";
    button.disabled = false;
    button.innerHTML = 'Buscar catálogo <span>→</span>';
    loadButton.disabled = false;
    loadButton.textContent = "Cargar más resultados ↓";
    return;
  }
  if (!loadMore) {
    state.archiveQuery = query;
    state.archiveOffset = 0;
    state.archiveTotal = 0;
    state.archiveResults = [];
    state.archiveFileCache.clear();
    $("#archive-results").innerHTML = "";
    $("#archive-load-more").hidden = true;
  }
  const requestedOffset = state.archiveOffset;
  button.disabled = true;
  loadButton.disabled = true;
  if (!loadMore) button.textContent = "Buscando…";
  else loadButton.textContent = "Cargando…";
  $("#archive-status").textContent = "Buscando audio con licencia Creative Commons declarada en Internet Archive…";
  try {
    const phrase = '"' + query.replace(/["\\]/g, " ").replace(/\s+/g, " ").trim() + '"';
    const searchQuery = 'mediatype:audio AND licenseurl:http*creativecommons.org* AND (title:' + phrase +
      ' OR creator:' + phrase + ' OR subject:' + phrase + ')';
    const url = new URL("https://archive.org/advancedsearch.php");
    url.searchParams.set("q", searchQuery);
    for (const field of ["identifier", "title", "creator", "year", "date", "mediatype", "licenseurl"]) url.searchParams.append("fl[]", field);
    url.searchParams.set("rows", String(ARCHIVE_PAGE_SIZE));
    url.searchParams.set("start", String(requestedOffset));
    url.searchParams.set("output", "json");
    url.searchParams.append("sort[]", "downloads desc");
    const response = await fetch(url.href, { mode: "cors", credentials: "omit", cache: "no-store" });
    if (!isCurrentArchiveSearch()) return;
    if (!response.ok) throw new Error("Internet Archive respondió " + response.status + ".");
    const data = await response.json();
    if (!isCurrentArchiveSearch()) return;
    if (data.responseHeader?.status !== 0 || !data.response) throw new Error("Internet Archive devolvió una respuesta de búsqueda no válida.");
    const docs = (Array.isArray(data.response.docs) ? data.response.docs : []).filter(item =>
      /^[A-Za-z0-9_-]{1,100}$/.test(String(item.identifier || "")) && String(item.mediatype || "audio") === "audio");
    state.archiveResults = loadMore ? state.archiveResults.concat(docs) : docs;
    state.archiveTotal = Number(data.response.numFound) || 0;
    state.archiveOffset = (Number(data.response.start) || 0) + docs.length;
    renderArchiveResults(docs, loadMore);
    loadButton.hidden = state.archiveOffset >= state.archiveTotal || docs.length === 0;
    $("#archive-status").textContent = state.archiveResults.length
      ? "Mostrando " + state.archiveResults.length + " de " + state.archiveTotal + " resultados que declaran una licencia Creative Commons. Abrí “Ver licencia y archivos” para comprobar los metadatos antes de añadir una pista."
      : "No se encontraron audios con licencia Creative Commons declarada para «" + query + "». Probá un término más general o abrí Internet Archive directamente.";
  } catch (error) {
    if (isCurrentArchiveSearch()) {
      $("#archive-status").textContent = (error.message || "No se pudo consultar Internet Archive.") +
        " Podés abrir su búsqueda pública desde " + "https://archive.org/search?query=" + encodeURIComponent(query);
    }
  } finally {
    if (isCurrentArchiveSearch()) {
      button.disabled = false;
      button.innerHTML = 'Buscar catálogo <span>→</span>';
      loadButton.disabled = false;
      loadButton.textContent = "Cargar más resultados ↓";
    }
  }
}

function setYoutubeStatus(message, kind = "info") {
  const status = $("#youtube-status");
  status.className = "youtube-status " + kind;
  status.textContent = message;
}
function readableYoutubeApiError(code, message) {
  if (code === "quotaExceeded" || code === "dailyLimitExceeded") return "La cuota gratuita de búsqueda de YouTube para esta clave se agotó por hoy. Podés seguir buscando abriendo YouTube directamente o probar mañana.";
  if (code === "keyInvalid" || code === "accessNotConfigured" || code === "API_KEY_INVALID") return "La clave API no es válida o YouTube Data API v3 no está habilitada en el proyecto de Google Cloud.";
  if (code === "ipRefererBlocked" || code === "refererNotAllowed") return "La clave está restringida y no acepta el origen de Ritmo. Revisá sus restricciones de sitio web en Google Cloud.";
  if (code === "forbidden") return "Google rechazó la petición. Revisá la clave, las restricciones y que YouTube Data API v3 esté habilitada.";
  return message || "No se pudo consultar YouTube. Comprobá tu conexión y la configuración de la clave.";
}
function renderYoutubeResults(items, append = false) {
  const root = $("#youtube-results");
  const cards = (items || []).map(item => {
    const videoId = item.id?.videoId;
    const snippet = item.snippet || {};
    if (!videoId || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) return "";
    const thumbs = snippet.thumbnails || {};
    const thumbnail = [thumbs.medium?.url, thumbs.high?.url, thumbs.default?.url].find(url => typeof url === "string" && /^https:\/\/i\.ytimg\.com\//.test(url)) || "";
    const title = snippet.title || "Video de YouTube";
    const channel = snippet.channelTitle || "Canal de YouTube";
    const published = snippet.publishedAt ? new Date(snippet.publishedAt).toLocaleDateString("es-AR") : "";
    const canEmbed = item.ritmoStatusVerified === true && item.ritmoMadeForKids === false && item.ritmoEmbeddable === true;
    const thumbnailAction = canEmbed
      ? 'data-yt-play="' + escapeHTML(videoId) + '" data-yt-title="' + escapeHTML(title) + '"'
      : 'data-yt-external="' + escapeHTML(videoId) + '"';
    const playAction = canEmbed
      ? '<button class="button button-primary" type="button" data-yt-play="' + escapeHTML(videoId) + '" data-yt-title="' + escapeHTML(title) + '">▶ Reproducir aquí</button>'
      : '<button class="button button-soft" type="button" data-yt-external="' + escapeHTML(videoId) + '">' + (item.ritmoMadeForKids === true ? 'Abrir contenido infantil en YouTube ↗' : 'Abrir en YouTube ↗') + '</button>';
    const statusNote = item.ritmoStatusVerified !== true
      ? '<div class="youtube-result-safety">No se pudo verificar si se puede incrustar</div>'
      : item.ritmoMadeForKids === true
        ? '<div class="youtube-result-safety">Abrir en YouTube para cuidar la privacidad infantil</div>'
        : !item.ritmoEmbeddable ? '<div class="youtube-result-safety">Este video solo se abre en YouTube</div>' : '';
    return '<article class="youtube-result">' +
      '<button class="youtube-thumbnail" type="button" ' + thumbnailAction + ' aria-label="' + (canEmbed ? 'Reproducir ' : 'Abrir ') + escapeHTML(title) + '">' +
      (thumbnail ? '<img loading="lazy" src="' + escapeHTML(thumbnail) + '" alt="">' : '<span>▶</span>') + '<span class="yt-play-overlay">' + (canEmbed ? '▶' : '↗') + '</span></button>' +
      '<div class="youtube-result-copy"><div class="youtube-result-channel">' + escapeHTML(channel) + '</div><strong>' + escapeHTML(title) + '</strong>' +
      '<p>' + escapeHTML(snippet.description || "Sin descripción disponible.") + '</p><div class="youtube-result-meta">' + escapeHTML(published) + '</div>' +
      statusNote + '<div class="youtube-result-actions">' + playAction + '<a class="button button-soft" href="' + escapeHTML(youtubeVideoURL(videoId)) + '" target="_blank" rel="noopener noreferrer">Ver en YouTube ↗</a></div></div></article>';
  }).join("");
  if (!append) root.innerHTML = "";
  if (cards) root.insertAdjacentHTML("beforeend", cards);
}
async function annotateYoutubeVideoStatus(items, key) {
  const ids = (items || []).map(item => item.id?.videoId).filter(value => /^[A-Za-z0-9_-]{11}$/.test(value || ""));
  if (!ids.length) return [];
  const params = new URLSearchParams({ part: "status", id: ids.join(","), key });
  const response = await fetch("https://www.googleapis.com/youtube/v3/videos?" + params.toString());
  const data = await response.json();
  if (!response.ok || data.error) {
    const error = data.error || {};
    const reason = error.errors?.[0]?.reason || error.status || "";
    throw new Error(readableYoutubeApiError(reason, error.message));
  }
  const statusById = new Map((data.items || []).map(video => [video.id, video.status]));
  return (items || []).map(item => {
    const status = statusById.get(item.id?.videoId);
    const checked = Boolean(status && typeof status.madeForKids === "boolean" && typeof status.embeddable === "boolean");
    return {
      ...item,
      ritmoStatusVerified: checked,
      ritmoMadeForKids: checked ? status.madeForKids : null,
      ritmoEmbeddable: checked && status.embeddable === true
    };
  });
}
async function searchYoutube(pageToken = "") {
  const requestId = ++youtubeSearchRequestId;
  const isCurrentYoutubeSearch = () => requestId === youtubeSearchRequestId;
  const button = $("#youtube-search-button");
  const loadButton = $("#youtube-load-more");
  // Load-more must continue the query that produced the current token, even if
  // the user has typed a different phrase into the search field meanwhile.
  const query = pageToken ? state.youtubeQuery : $("#youtube-query").value.trim();
  if (!query) {
    state.youtubeNextPageToken = null;
    loadButton.hidden = true;
    button.disabled = false;
    button.innerHTML = 'Buscar <span>→</span>';
    setYoutubeStatus("Escribí el nombre de una canción o artista para buscar.", "error");
    return;
  }
  if (!pageToken) {
    state.youtubeQuery = query;
    state.youtubeNextPageToken = null;
    loadButton.hidden = true;
  }
  if (!navigator.onLine) {
    const cached = readYoutubeSearchCache();
    if (cached && cached.query.toLocaleLowerCase() === query.toLocaleLowerCase()) {
      state.youtubeResults = cached.items;
      renderYoutubeResults(cached.items, false);
      $("#youtube-load-more").hidden = true;
      setYoutubeStatus("Sin conexión. Mostrando resultados guardados de «" + cached.query + "». Solo los archivos almacenados localmente pueden reproducirse offline.", "info");
    } else {
      $("#youtube-results").innerHTML = "";
      $("#youtube-load-more").hidden = true;
      setYoutubeStatus("Sin conexión. Podés buscar en tu biblioteca local o volver a ver la última búsqueda guardada de YouTube.", "info");
    }
    state.youtubeNextPageToken = null;
    loadButton.hidden = true;
    button.disabled = false;
    button.innerHTML = 'Buscar <span>→</span>';
    return;
  }
  const key = youtubeApiKey();
  if (!key) {
    setYoutubeStatus("La búsqueda integrada necesita una clave API personal. Podés guardarla en «Configurar búsqueda integrada» o abrir los resultados públicos de YouTube con el botón de arriba.", "info");
    $("#youtube-open-search").classList.add("needs-attention");
    $("#youtube-results").innerHTML = "";
    state.youtubeNextPageToken = null;
    loadButton.hidden = true;
    button.disabled = false;
    button.innerHTML = 'Buscar <span>→</span>';
    return;
  }
  if (!pageToken) {
    state.youtubeResults = [];
    renderYoutubeResults([], false);
  }
  button.disabled = true;
  button.textContent = "Buscando…";
  setYoutubeStatus("Buscando canciones y comprobando el estado de los videos…", "info");
  try {
    const params = new URLSearchParams({
      part: "snippet",
      type: "video",
      videoEmbeddable: "true",
      maxResults: "12",
      q: query,
      key,
      regionCode: "AR",
      relevanceLanguage: "es",
      safeSearch: "moderate"
    });
    if (pageToken) params.set("pageToken", pageToken);
    const response = await fetch("https://www.googleapis.com/youtube/v3/search?" + params.toString());
    if (!isCurrentYoutubeSearch()) return;
    const data = await response.json();
    if (!isCurrentYoutubeSearch()) return;
    if (!response.ok || data.error) {
      const error = data.error || {};
      const reason = error.errors?.[0]?.reason || error.status || "";
      throw new Error(readableYoutubeApiError(reason, error.message));
    }
    const rawItems = Array.isArray(data.items) ? data.items : [];
    let items = rawItems;
    let statusChecked = true;
    try {
      items = await annotateYoutubeVideoStatus(rawItems, key);
    } catch {
      statusChecked = false;
      items = rawItems.map(item => ({ ...item, ritmoStatusVerified: false, ritmoMadeForKids: null, ritmoEmbeddable: false }));
    }
    if (!isCurrentYoutubeSearch()) return;
    if (!pageToken) { state.youtubeResults = items; persistYoutubeSearchCache(query, items); }
    else { state.youtubeResults.push(...items); persistYoutubeSearchCache(query, state.youtubeResults); }
    state.youtubeNextPageToken = data.nextPageToken || null;
    renderYoutubeResults(items, Boolean(pageToken));
    $("#youtube-load-more").hidden = !state.youtubeNextPageToken;
    $("#youtube-open-search").classList.remove("needs-attention");
    if (!statusChecked && items.length) {
      setYoutubeStatus("Encontré resultados, pero no pude verificar los permisos de incrustación. Por seguridad, se abren directamente en YouTube.", "error");
    } else if (items.length) {
      setYoutubeStatus("Encontré " + items.length + " resultados nuevos para «" + query + "». Algunos videos solo se abrirán directamente en YouTube según su estado y disponibilidad.", "success");
    } else {
      setYoutubeStatus("No encontré resultados. Probá otro título o artista.", "info");
    }
  } catch (error) {
    if (isCurrentYoutubeSearch()) setYoutubeStatus(error.message || "Falló la búsqueda de YouTube.", "error");
  } finally {
    if (isCurrentYoutubeSearch()) {
      button.disabled = false;
      button.innerHTML = 'Buscar <span>→</span>';
    }
  }
}
function playYoutubeVideo(videoId, title = "Video de YouTube") {
  if (!navigator.onLine) { toast("Para reproducir YouTube necesitás conexión. Los resultados guardados y la biblioteca local siguen disponibles offline."); return; }
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId || "")) {
    toast("El enlace de YouTube no contiene un ID de video válido.");
    return;
  }
  // Selecting a YouTube video supersedes any native-audio request still awaiting play().
  cancelPendingPlaybackIntent();
  const frame = $("#youtube-iframe");
  const sessionId = youtubeHistory.select(videoId, title);
  $("#youtube-current-title").textContent = title;
  $("#youtube-current-link").href = youtubeVideoURL(videoId);
  const origin = location.origin && location.origin !== "null" ? "&origin=" + encodeURIComponent(location.origin) : "";
  const embedURL = "https://www.youtube.com/embed/" + encodeURIComponent(videoId) + "?autoplay=1&playsinline=1&rel=0&enablejsapi=1" + origin;
  if (youtubePlayer) {
    try {
      youtubePlayer.loadVideoById(videoId);
    } catch {
      youtubePlayer = null;
      frame.src = embedURL;
    }
  } else {
    // Start the official embed immediately from the user's click. The API attaches
    // asynchronously to observe the actual PLAYING state, without delaying autoplay.
    frame.src = embedURL;
    ensureYoutubePlayerApi().then(() => {
      if (youtubeHistory.getCurrentSession()?.sessionId !== sessionId) return;
      attachYoutubePlayer(frame);
    }).catch(() => {
      // Playback remains available through the iframe; without state events we do not
      // claim that the selected video was actually played in the history.
    });
  }
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
  releaseUnusedObjectURLs(null);
  state.currentId = null;
  state.queueIds = null;
  updatePlayer();
  updateMediaSession();
  $("#youtube-player-wrap").hidden = false;
  renderQueue();
  $("#youtube-player-wrap").scrollIntoView({ behavior: "smooth", block: "nearest" });
}
function updateYoutubeKeyStatus(message = "") {
  const status = $("#youtube-key-status");
  if (message) {
    status.textContent = message;
    status.style.color = "#a7e6bd";
    return;
  }
  status.textContent = youtubeApiKey() ? "Hay una clave guardada en este navegador. No se comparte con Ritmo." : "Todavía no hay una clave guardada.";
  status.style.color = "";
}

function bindEvents() {
  $("#volume-bar").value = String(audioPrefs.volume);
  setOutputVolume(audioPrefs.volume);
  if (audioPrefs.volume > 0.001) audioPrefs.lastAudibleVolume = audioPrefs.volume;
  document.querySelectorAll("[data-view]").forEach(button => button.addEventListener("click", () => showView(button.dataset.view)));
  document.querySelectorAll("[data-go-view]").forEach(button => button.addEventListener("click", () => showView(button.dataset.goView)));
  ["hero-import", "empty-import", "library-import", "library-empty-import", "offline-import"].forEach(selector => {
    const node = $("#" + selector);
    if (node) node.addEventListener("click", () => filePicker.click());
  });
  $("#menu-toggle").addEventListener("click", () => $("#sidebar").classList.toggle("open"));
  filePicker.addEventListener("change", async () => { await importFiles(filePicker.files); filePicker.value = ""; });
  folderPicker.addEventListener("change", async () => { await importFiles(folderPicker.files); folderPicker.value = ""; });
  $("#youtube-search-form").addEventListener("submit", event => { event.preventDefault(); searchYoutube(); });
  $("#archive-search-form").addEventListener("submit", event => { event.preventDefault(); searchArchiveAudio(false); });
  $("#archive-load-more").addEventListener("click", () => searchArchiveAudio(true));
  $("#archive-results").addEventListener("click", event => {
    const inspect = event.target.closest("[data-archive-inspect]");
    if (inspect) { inspectArchiveItem(inspect.dataset.archiveInspect, inspect); return; }
    const add = event.target.closest("[data-archive-add]");
    if (add) { addArchiveFile(add.dataset.archiveAdd, Number(add.dataset.archiveFileIndex), false); return; }
    const play = event.target.closest("[data-archive-play]");
    if (play) addArchiveFile(play.dataset.archivePlay, Number(play.dataset.archiveFileIndex), true);
  });
  $("#youtube-open-search").addEventListener("click", () => {
    const query = $("#youtube-query").value.trim() || state.youtubeQuery;
    if (!query) { $("#youtube-query").focus(); setYoutubeStatus("Primero escribí una canción o artista.", "info"); return; }
    openExternal(youtubeSearchURL(query));
  });
  $("#youtube-load-more").addEventListener("click", () => { if (state.youtubeNextPageToken) searchYoutube(state.youtubeNextPageToken); });
  $("#youtube-results").addEventListener("click", event => {
    const external = event.target.closest("[data-yt-external]");
    if (external) {
      openExternal(youtubeVideoURL(external.dataset.ytExternal));
      return;
    }
    const button = event.target.closest("[data-yt-play]");
    if (button) playYoutubeVideo(button.dataset.ytPlay, button.dataset.ytTitle || "Video de YouTube");
  });
  $("#youtube-key-form").addEventListener("submit", event => {
    event.preventDefault();
    const key = $("#youtube-api-key").value.trim();
    if (!key || !/^[A-Za-z0-9_\-]{20,}$/.test(key)) {
      updateYoutubeKeyStatus("Pegá una clave API válida de Google Cloud.");
      $("#youtube-key-status").style.color = "#ffb4b4";
      return;
    }
    try {
      localStorage.setItem(YOUTUBE_KEY_STORAGE, key);
      $("#youtube-api-key").value = "";
      updateYoutubeKeyStatus("Clave guardada en este navegador.");
      setYoutubeStatus("Clave configurada. Ya podés buscar canciones dentro de Ritmo.", "success");
      $("#youtube-open-search").classList.remove("needs-attention");
    } catch {
      updateYoutubeKeyStatus("El navegador no permitió guardar la clave.");
      $("#youtube-key-status").style.color = "#ffb4b4";
    }
  });
  $("#youtube-key-clear").addEventListener("click", () => {
    try { localStorage.removeItem(YOUTUBE_KEY_STORAGE); } catch {}
    $("#youtube-api-key").value = "";
    updateYoutubeKeyStatus("Clave eliminada de este navegador.");
    setYoutubeStatus("Sin clave API, podés seguir abriendo las búsquedas públicas de YouTube.", "info");
  });
  $("#url-form").addEventListener("submit", addStream);
  $("#playlist-create-form").addEventListener("submit", createPlaylist);
  $("#clear-history-button").addEventListener("click", clearPlaybackHistory);
  $("#playlist-back-button").addEventListener("click", () => { state.currentPlaylistId = null; renderPlaylists(); });
  $("#playlist-play-all").addEventListener("click", () => {
    const list = state.playlists.find(item => item.id === state.currentPlaylistId);
    if (!list) return;
    const firstTrack = list.trackIds.map(trackId => getTrack(trackId)).find(Boolean);
    if (!firstTrack) { toast("Esta lista no contiene canciones disponibles en la biblioteca."); return; }
    playTrack(firstTrack.id, true, { queueIds: list.trackIds });
  });
  $("#library-search").addEventListener("input", event => {
    state.query = event.target.value;
    const visibleLibraryTracks = sortedForView("library");
    renderTrackList("#library-tracks", visibleLibraryTracks, "#library-empty");
    renderLibraryGrid(visibleLibraryTracks);
    syncLibraryViewControls();
    $("#library-empty").hidden = state.tracks.length > 0;
    $("#library-no-results").hidden = !(state.tracks.length > 0 && Boolean(state.query.trim()) && visibleLibraryTracks.length === 0);
    $("#library-meta").textContent = visibleLibraryTracks.length + (visibleLibraryTracks.length === 1 ? " canción" : " canciones");
  });
  document.querySelectorAll("[data-library-mode]").forEach(button => button.addEventListener("click", () => setLibraryMode(button.dataset.libraryMode)));
  $("#now-playing-open").addEventListener("click", () => {
    updatePlayer();
    const dialog = $("#now-playing-dialog");
    if (!dialog.open) dialog.showModal();
  });
  $("#close-now-playing").addEventListener("click", () => $("#now-playing-dialog").close());
  $("#now-playing-dialog").addEventListener("click", event => {
    if (event.target === $("#now-playing-dialog")) $("#now-playing-dialog").close();
  });
  $("#expanded-play-button").addEventListener("click", () => $("#play-button").click());
  $("#expanded-previous-button").addEventListener("click", () => $("#previous-button").click());
  $("#expanded-next-button").addEventListener("click", () => $("#next-button").click());
  $("#expanded-shuffle-button").addEventListener("click", () => $("#shuffle-button").click());
  $("#expanded-repeat-button").addEventListener("click", () => $("#repeat-button").click());
  $("#expanded-favorite-button").addEventListener("click", () => $("#player-favorite").click());
  $("#expanded-seek-bar").addEventListener("input", event => {
    if (Number.isFinite(audio.duration)) audio.currentTime = audio.duration * Number(event.target.value) / 1000;
  });
  $("#expanded-volume-bar").addEventListener("input", event => {
    $("#volume-bar").value = event.target.value;
    $("#volume-bar").dispatchEvent(new Event("input", { bubbles: true }));
  });
  $("#expanded-queue-button").addEventListener("click", () => {
    $("#now-playing-dialog").close();
    const queue = $("#queue-dialog");
    if (!queue.open) queue.showModal();
  });
  $("#play-button").addEventListener("click", () => {
    if (!currentTrack()) return;
    // A request can be pending while audio.paused is still true. Treat a tap
    // during that window as cancellation, not as another Play request.
    if (pendingPlaybackRequestId !== null || !audio.paused) pauseCurrentTrack();
    else resumeCurrentTrack();
    updatePlayer();
  });
  $("#previous-button").addEventListener("click", () => {
    if (audio.currentTime > 3) audio.currentTime = 0;
    else nextTrack(-1);
  });
  $("#next-button").addEventListener("click", () => nextTrack(1));
  $("#shuffle-button").addEventListener("click", () => { state.shuffle = !state.shuffle; updatePlayer(); toast(state.shuffle ? "Reproducción aleatoria activada" : "Reproducción aleatoria desactivada"); });
  $("#repeat-button").addEventListener("click", () => {
    state.repeat = ({ off: "all", all: "one", one: "off" })[state.repeat];
    updatePlayer();
    toast(({ off: "Repetición desactivada", all: "Se repetirá toda la cola", one: "Se repetirá esta canción" })[state.repeat]);
  });
  $("#player-favorite").addEventListener("click", async () => {
    const track = currentTrack();
    if (!track) return;
    const previousFavorite = track.favorite;
    track.favorite = !previousFavorite;
    try {
      await saveTrack(track);
      render();
    } catch {
      track.favorite = previousFavorite;
      render();
      updatePlayerFavorite();
      toast("No se pudo guardar el favorito.");
    }
  });
  $("#seek-bar").addEventListener("input", event => { if (Number.isFinite(audio.duration)) audio.currentTime = audio.duration * Number(event.target.value) / 1000; });
  $("#volume-bar").addEventListener("input", event => {
    const volume = Number(event.target.value);
    audioPrefs.volume = volume;
    if (volume > 0.001) audioPrefs.lastAudibleVolume = volume;
    saveAudioPreferences();
    setOutputVolume(volume);
    $("#expanded-volume-bar").value = String(volume);
    updateMuteButton();
  });
  $("#volume-mute-button").addEventListener("click", toggleMute);
  bindAudioEngineEvents(defaultAudio);
  bindAudioEngineEvents(equalizedAudio);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      updateMediaSession();
      releaseScreenWakeLock();
      return;
    }
    if (audioPrefs.keepScreenAwake) requestScreenWakeLock();
    // Mobile browsers may suspend a Web Audio graph while the app is hidden.
    // Try resuming on return; if autoplay policy rejects it, the retry action
    // will resume the context from the user's next explicit interaction.
    if (audio === equalizedAudio && audioContext && !audio.paused && audioContext.state !== "running") {
      audioContext.resume().then(() => {
        if (audioContext?.state === "running") showPlaybackStatus("");
        else showPlaybackStatus("El motor de sonido sigue suspendido. Tocá Reintentar para reanudar el audio.", "warning", true);
      }).catch(() => {
        showPlaybackStatus("El navegador suspendió el motor de sonido. Tocá Reintentar para reanudarlo.", "warning", true);
      });
    }
  });
  $("#app-update-now").addEventListener("click", () => window.location.reload());
  $("#app-update-later").addEventListener("click", () => { $("#app-update-banner").hidden = true; });
  $("#settings-button").addEventListener("click", openSettings);
  $("#close-settings").addEventListener("click", () => $("#settings-dialog").close());
  $("#close-settings-bottom").addEventListener("click", () => $("#settings-dialog").close());
  $("#eq-enabled").addEventListener("change", async event => {
    audioPrefs.equalizerEnabled = event.target.checked;
    saveAudioPreferences();
    syncSettingsUI();
    const track = currentTrack();
    if (event.target.checked && track && isLocal(track)) {
      try { await ensureAudioProcessing(); }
      catch (error) {
        audioPrefs.equalizerEnabled = false;
        saveAudioPreferences();
        syncSettingsUI();
        $("#eq-status").textContent = error.message || "No se pudo iniciar el ecualizador.";
        return;
      }
    }
    $("#eq-status").textContent = audioPrefs.equalizerEnabled ? "Se aplica a los archivos locales; las fuentes online usan el reproductor directo." : "Ecualizador desactivado.";
    applyCurrentEnginePreference();
  });
  for (const [controlId, key] of [["eq-bass", "bass"], ["eq-mid", "mid"], ["eq-treble", "treble"]]) {
    $("#" + controlId).addEventListener("input", event => {
      audioPrefs[key] = Number(event.target.value);
      saveAudioPreferences();
      syncSettingsUI();
    });
  }
  $("#limiter-toggle").addEventListener("change", event => {
    audioPrefs.limiter = event.target.checked;
    saveAudioPreferences();
    applyAudioGraphPreferences();
  });
  $("#eq-reset").addEventListener("click", () => {
    audioPrefs.bass = 0; audioPrefs.mid = 0; audioPrefs.treble = 0; audioPrefs.limiter = true;
    saveAudioPreferences(); syncSettingsUI();
    $("#eq-status").textContent = "Ecualizador restablecido.";
  });
  $("#keep-screen-awake").addEventListener("change", async event => {
    audioPrefs.keepScreenAwake = event.target.checked;
    saveAudioPreferences();
    if (audioPrefs.keepScreenAwake) await requestScreenWakeLock();
    else { await releaseScreenWakeLock(); $("#wake-lock-status").textContent = "Desactivado."; }
  });
  $("#sleep-fade").addEventListener("change", event => { audioPrefs.fadeOutAtEnd = event.target.checked; saveAudioPreferences(); });
  $("#sleep-start").addEventListener("click", () => startSleepTimer(Number($("#sleep-minutes").value)));
  $("#sleep-cancel").addEventListener("click", () => startSleepTimer(0));
  $("#request-storage-button").addEventListener("click", async () => {
    const granted = await requestPersistentStorage();
    await renderStorageStatus();
    if (granted) toast("El navegador concedió almacenamiento persistente.");
    else toast("El navegador no concedió el almacenamiento persistente; puede que no admita la función o la haya rechazado.");
  });
  $("#diagnostics-refresh").addEventListener("click", renderDiagnostics);
  $("#playback-retry").addEventListener("click", retryCurrentPlayback);
  $("#playback-status-close").addEventListener("click", () => showPlaybackStatus(""));
  setupMediaSession();
  window.addEventListener("online", () => {
    updateConnection();
    if (currentTrack() && !isLocal(currentTrack())) showPlaybackStatus("Conexión recuperada. Si el audio no continúa, tocá Reintentar.", "info", true);
  });
  window.addEventListener("offline", () => {
    updateConnection();
    if (currentTrack() && !isLocal(currentTrack())) showPlaybackStatus("Sin conexión: las fuentes online necesitan internet. Los archivos locales siguen disponibles.", "warning", true);
  });
  $("#about-button").addEventListener("click", () => $("#info-dialog").showModal());
  $("#close-info").addEventListener("click", () => $("#info-dialog").close());
  $("#close-info-bottom").addEventListener("click", () => $("#info-dialog").close());
  $("#queue-button").addEventListener("click", () => {
    renderQueue();
    $("#queue-dialog").showModal();
  });
  $("#close-queue").addEventListener("click", () => $("#queue-dialog").close());
  $("#close-queue-bottom").addEventListener("click", () => $("#queue-dialog").close());
  $("#queue-from-library").addEventListener("click", () => {
    state.queueIds = null;
    renderQueue();
    toast("La cola volvió al orden de tu biblioteca.");
  });
  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    state.installPrompt = event;
    $("#install-button").hidden = false;
  });
  $("#install-button").addEventListener("click", async () => {
    if (!state.installPrompt) { toast("Desde el menú del navegador, elegí «Instalar aplicación»."); return; }
    state.installPrompt.prompt();
    await state.installPrompt.userChoice;
    state.installPrompt = null;
    $("#install-button").hidden = true;
  });
  window.addEventListener("keydown", event => {
    if (event.target.matches("input,textarea") || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.code === "Space" && currentTrack()) { event.preventDefault(); $("#play-button").click(); }
    if (event.key === "/") { event.preventDefault(); showView("library"); $("#library-search").focus(); }
    if (event.key === "ArrowRight" && currentTrack() && Number.isFinite(audio.duration)) audio.currentTime = Math.min(audio.duration, audio.currentTime + 5);
    if (event.key === "ArrowLeft" && currentTrack()) audio.currentTime = Math.max(0, audio.currentTime - 5);
  });
}
async function init() {
  bindEvents();
  updateYoutubeKeyStatus();
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    // The new worker skips waiting and claims existing clients. When a tab that
    // already had a controller changes to the new worker, its HTML/JS may still
    // be the old build; prompt a safe, user-initiated reload instead of forcing
    // a reload in the middle of playback.
    const hadController = Boolean(navigator.serviceWorker.controller);
    let updatePromptShown = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!hadController || updatePromptShown) return;
      updatePromptShown = true;
      $("#app-update-banner").hidden = false;
    });
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
  const [tracksResult, historyResult, playlistsResult] = await Promise.allSettled([
    getAllTracks(),
    getHistory(250),
    getPlaylists()
  ]);
  if (tracksResult.status === "fulfilled") {
    state.tracks = tracksResult.value;
  } else {
    $("#home-empty").hidden = false;
  }
  if (historyResult.status === "fulfilled") state.history = historyResult.value;
  if (playlistsResult.status === "fulfilled") state.playlists = playlistsResult.value;
  const storageErrors = [tracksResult, historyResult, playlistsResult].filter(result => result.status === "rejected");
  if (storageErrors.length) {
    const error = storageErrors[0].reason;
    toast(error?.message || "Parte de la biblioteca no pudo cargarse. Revisá el espacio y los permisos del navegador.");
  }
  render();
  syncSettingsUI();
  showView("home");
  estimateStorage().then(result => {
    if (result?.quota) {
      const used = formatBytes(result.usage);
      const total = formatBytes(result.quota);
      const card = document.querySelector(".storage-card p");
      if (card) card.textContent = used + " usados de " + total + " disponibles en este navegador.";
    }
  });
}
init();