import { getAllTracks, saveManyTracks, saveTrack, deleteTrack, estimateStorage, requestPersistentStorage } from "./storage.js";

const $ = selector => document.querySelector(selector);
const audio = $("#audio-engine");
const filePicker = $("#file-picker");
const folderPicker = $("#folder-picker");
const state = { tracks: [], currentId: null, view: "home", shuffle: false, repeat: "off", query: "", objectUrls: new Map(), installPrompt: null, toastTimer: null, sleepTimer: null, youtubeResults: [], youtubeNextPageToken: null, youtubeQuery: "" };

const viewNames = { home: "Inicio", library: "Mi biblioteca", favorites: "Favoritos", offline: "Sin conexión", online: "Música online" };

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}
function id() {
  return globalThis.crypto?.randomUUID ? crypto.randomUUID() : "track-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}
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
    '<div class="track-actions"><button class="row-icon' + favClass + '" data-favorite="' + escapeHTML(track.id) + '" aria-label="' + (track.favorite ? "Quitar de favoritos" : "Agregar a favoritos") + '">' + (track.favorite ? "♥" : "♡") + '</button><button class="row-icon delete-track" data-delete="' + escapeHTML(track.id) + '" aria-label="Eliminar ' + escapeHTML(track.title) + '" title="Eliminar de la biblioteca">×</button></div></div>';
}
function bindRenderedActions(root) {
  root.querySelectorAll("[data-play]").forEach(button => {
    button.addEventListener("click", event => { event.stopPropagation(); playTrack(button.dataset.play); });
    button.addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); playTrack(button.dataset.play); } });
  });
  root.querySelectorAll("[data-favorite]").forEach(button => button.addEventListener("click", async event => {
    event.stopPropagation();
    const track = getTrack(button.dataset.favorite);
    if (!track) return;
    track.favorite = !track.favorite;
    try { await saveTrack(track); render(); updatePlayerFavorite(); } catch (error) { toast(error.message || "No se pudo guardar el favorito."); }
  }));
  root.querySelectorAll("[data-delete]").forEach(button => button.addEventListener("click", async event => {
    event.stopPropagation();
    const track = getTrack(button.dataset.delete);
    if (!track) return;
    if (!confirm("¿Eliminar «" + track.title + "» de tu biblioteca? El archivo original de tu equipo no se modifica.")) return;
    try {
      if (track.id === state.currentId) await removeCurrent();
      const objectUrl = state.objectUrls.get(track.id);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      state.objectUrls.delete(track.id);
      await deleteTrack(track.id);
      state.tracks = await getAllTracks();
      render();
      toast("Se quitó de tu biblioteca.");
    } catch (error) { toast(error.message || "No se pudo eliminar la canción."); }
  }));
}
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
function render() {
  const all = state.tracks;
  $("#library-count").textContent = String(all.length);
  $("#stat-total").innerHTML = all.length + ' <small>canciones</small>';
  $("#stat-favorites").innerHTML = all.filter(track => track.favorite).length + ' <small>guardadas</small>';
  $("#stat-offline").innerHTML = all.filter(isLocal).length + ' <small>archivos locales</small>';
  $("#library-meta").textContent = sortedForView("library").length + (sortedForView("library").length === 1 ? " canción" : " canciones");
  renderCards("#recent-tracks", all);
  $("#home-empty").hidden = all.length > 0;
  renderTrackList("#library-tracks", sortedForView("library"), "#library-empty");
  renderTrackList("#favorite-tracks", sortedForView("favorites"), "#favorites-empty");
  renderTrackList("#offline-tracks", sortedForView("offline"), "#offline-empty");
  $("#library-empty").hidden = all.length > 0 || Boolean(state.query.trim());
  $("#home-empty").hidden = all.length > 0;
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
function stopYoutubePlayback() {
  const frame = $("#youtube-iframe");
  if (frame && frame.src && frame.src.includes("youtube.com/embed/")) {
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
async function playTrack(trackId, autoplay = true) {
  const track = getTrack(trackId);
  if (!track) return;
  state.currentId = track.id;
  try {
    const url = trackURL(track);
    if (audio.src !== new URL(url, location.href).href) audio.src = url;
    if (autoplay) await audio.play();
    if (!track.lastPlayedAt) track.lastPlayedAt = Date.now();
    else track.lastPlayedAt = Date.now();
    try { await saveTrack(track); } catch { /* La reproducción no debe fallar si no se puede actualizar el historial. */ }
    render();
    updatePlayer();
  } catch (error) {
    toast(error?.name === "NotAllowedError" ? "Tocá reproducir para habilitar el audio." : "No se pudo reproducir. Verificá el archivo o el enlace.");
    updatePlayer();
  }
}
function nextTrack(direction = 1) {
  const candidates = state.tracks;
  if (!candidates.length) return;
  const currentIndex = Math.max(0, candidates.findIndex(track => track.id === state.currentId));
  let nextIndex;
  if (state.shuffle && candidates.length > 1) {
    const others = candidates.map((track, index) => index).filter(index => index !== currentIndex);
    nextIndex = others[Math.floor(Math.random() * others.length)];
  } else {
    nextIndex = currentIndex + direction;
    if (nextIndex >= candidates.length) nextIndex = state.repeat === "all" ? 0 : -1;
    if (nextIndex < 0) nextIndex = state.repeat === "all" ? candidates.length - 1 : -1;
  }
  if (nextIndex < 0) { audio.pause(); return; }
  playTrack(candidates[nextIndex].id);
}
async function importFiles(fileList) {
  const files = [...fileList].filter(file => file.type.startsWith("audio/") || /\.(mp3|m4a|aac|wav|ogg|opus|flac|aiff|wma)$/i.test(file.name));
  if (!files.length) { toast("No encontré archivos de audio compatibles."); return; }
  const existing = new Set(state.tracks.filter(track => isLocal(track)).map(track => track.name + "|" + track.size + "|" + track.lastModified));
  const tracks = [];
  for (const file of files) {
    const fingerprint = file.name + "|" + file.size + "|" + file.lastModified;
    if (existing.has(fingerprint)) continue;
    const meta = metadataForFile(file);
    tracks.push({ id: id(), kind: "file", name: file.name, title: meta.title, artist: meta.artist, album: "", size: file.size, mimeType: file.type || "application/octet-stream", lastModified: file.lastModified, blob: file, favorite: false, addedAt: Date.now() + tracks.length, duration: 0, lastPlayedAt: 0 });
    existing.add(fingerprint);
  }
  if (!tracks.length) { toast("Esos archivos ya están en tu biblioteca."); return; }
  try {
    await saveManyTracks(tracks);
    state.tracks = await getAllTracks();
    render();
    toast(tracks.length + (tracks.length === 1 ? " canción importada" : " canciones importadas") + " · " + formatBytes(tracks.reduce((sum, track) => sum + track.size, 0)));
    requestPersistentStorage().catch(() => {});
    if (!currentTrack()) showView("library");
  } catch (error) {
    toast(error?.name === "QuotaExceededError" ? "No hay suficiente espacio del navegador para guardar esos archivos." : (error.message || "No se pudo importar la música."));
  }
}
async function removeCurrent() {
  const track = currentTrack();
  if (!track) return;
  audio.pause();
  audio.removeAttribute("src");
  if (isLocal(track) && state.objectUrls.has(track.id)) {
    URL.revokeObjectURL(state.objectUrls.get(track.id));
    state.objectUrls.delete(track.id);
  }
  state.currentId = null;
  updatePlayer();
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
  const query = $("#youtube-query").value.trim();
  if (!query) { setYoutubeStatus("Escribí el nombre de una canción o artista para buscar.", "error"); return; }
  state.youtubeQuery = query;
  const key = youtubeApiKey();
  if (!key) {
    setYoutubeStatus("La búsqueda integrada necesita una clave API personal. Podés guardarla en «Configurar búsqueda integrada» o abrir los resultados públicos de YouTube con el botón de arriba.", "info");
    $("#youtube-open-search").classList.add("needs-attention");
    $("#youtube-results").innerHTML = "";
    $("#youtube-load-more").hidden = true;
    return;
  }
  const button = $("#youtube-search-button");
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
    const data = await response.json();
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
    if (!pageToken) state.youtubeResults = items;
    else state.youtubeResults.push(...items);
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
    setYoutubeStatus(error.message || "Falló la búsqueda de YouTube.", "error");
  } finally {
    button.disabled = false;
    button.innerHTML = 'Buscar <span>→</span>';
  }
}
function playYoutubeVideo(videoId, title = "Video de YouTube") {
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId || "")) {
    toast("El enlace de YouTube no contiene un ID de video válido.");
    return;
  }
  const frame = $("#youtube-iframe");
  $("#youtube-current-title").textContent = title;
  $("#youtube-current-link").href = youtubeVideoURL(videoId);
  const origin = location.origin && location.origin !== "null" ? "&origin=" + encodeURIComponent(location.origin) : "";
  frame.src = "https://www.youtube.com/embed/" + encodeURIComponent(videoId) + "?autoplay=1&playsinline=1&rel=0&enablejsapi=1" + origin;
  $("#youtube-player-wrap").hidden = false;
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
  $("#library-search").addEventListener("input", event => { state.query = event.target.value; renderTrackList("#library-tracks", sortedForView("library"), "#library-empty"); $("#library-empty").hidden = state.tracks.length > 0 || Boolean(state.query.trim()); $("#library-meta").textContent = sortedForView("library").length + " canciones"; });
  $("#play-button").addEventListener("click", async () => {
    if (!currentTrack()) return;
    if (audio.paused) { try { await audio.play(); } catch { toast("No se pudo iniciar la reproducción."); } }
    else audio.pause();
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
    track.favorite = !track.favorite;
    try { await saveTrack(track); render(); } catch { toast("No se pudo guardar el favorito."); }
  });
  $("#seek-bar").addEventListener("input", event => { if (Number.isFinite(audio.duration)) audio.currentTime = audio.duration * Number(event.target.value) / 1000; });
  $("#volume-bar").addEventListener("input", event => { audio.volume = Number(event.target.value); });
  audio.volume = 0.8;
  audio.addEventListener("timeupdate", updatePlayer);
  audio.addEventListener("durationchange", async () => {
    const track = currentTrack();
    if (track && Number.isFinite(audio.duration)) { track.duration = audio.duration; try { await saveTrack(track); } catch {} }
    updatePlayer();
  });
  audio.addEventListener("play", updatePlayer);
  audio.addEventListener("pause", updatePlayer);
  audio.addEventListener("ended", () => { if (state.repeat === "one") { audio.currentTime = 0; audio.play().catch(() => {}); } else nextTrack(1); });
  audio.addEventListener("error", () => { if (currentTrack()) toast("La fuente de audio no está disponible o el formato no es compatible."); });
  document.addEventListener("visibilitychange", () => { if (document.hidden) stopYoutubePlayback(); });
  window.addEventListener("online", updateConnection);
  window.addEventListener("offline", updateConnection);
  $("#about-button").addEventListener("click", () => $("#info-dialog").showModal());
  $("#close-info").addEventListener("click", () => $("#info-dialog").close());
  $("#close-info-bottom").addEventListener("click", () => $("#info-dialog").close());
  $("#queue-button").addEventListener("click", () => {
    const list = state.tracks;
    toast(list.length ? "Cola actual: " + list.map(track => track.title).slice(0, 3).join(" · ") + (list.length > 3 ? " …" : "") : "Todavía no hay canciones en la biblioteca.");
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
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
  try {
    state.tracks = await getAllTracks();
  } catch (error) {
    toast(error.message || "No se pudo abrir la biblioteca local.");
    $("#home-empty").hidden = false;
  }
  render();
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