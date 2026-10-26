import { mapWithConcurrency } from "./concurrent-map.js";
import { getAllTracks, saveManyTracks, saveTrack, deleteTrackAndPrunePlaylists, getHistory, addHistoryEntry, clearHistory, getPlaylists, savePlaylist, deletePlaylist, estimateStorage, requestPersistentStorage, getAppSetting, saveAppSetting, deleteAppSetting } from "./storage.js";
import { normalizePlaylistName, renamePlaylist, movePlaylistTrack, removePlaylistTrack } from "./playlist-editing.js";
import { createYoutubeHistoryController } from "./youtube-history.js";
import { createAudioOutputVolumeController } from "./audio-output-volume.js";
import { clearMediaSession, clearMediaSessionPositionState } from "./media-session-state.js";
import { readableYoutubePlayerError } from "./youtube-player-errors.js";
import { EQUALIZER_PRESETS, getEqualizerPreset, normalizeSavedEqualizerProfiles, upsertSavedEqualizerProfile, removeSavedEqualizerProfile, MAX_SAVED_EQUALIZER_PROFILES } from "./equalizer-presets.js";
import { classifyAudioImportFiles, classifyImportDuplicate, importedFileFingerprint, MAX_BLOB_COMPARE_CANDIDATES_PER_IMPORT_BATCH, MAX_BLOB_COMPARISON_BYTES_PER_IMPORT_BATCH } from "./import-fingerprint.js";
import { parseId3Tags, validateEmbeddedArtwork, MAX_EMBEDDED_ARTWORK_BYTES } from "./id3-tags.js";
import { parseFlacVorbisComments, parseOggVorbisComments, isVorbisMetadataFilename, MAX_VORBIS_METADATA_BYTES } from "./vorbis-comments.js";
import { isWavMetadataFilename, readWavInfoMetadata } from "./wav-info-tags.js";
import { convertAudioFileToWav, MAX_CONVERTER_FILES, MAX_CONVERTER_INPUT_BYTES, MAX_CONVERTER_TOTAL_INPUT_BYTES, MAX_CONVERTER_OUTPUT_BYTES, claimUniqueWavFilename } from "./audio-converter.js";
import { createAsyncGenerationGate } from "./async-generation-gate.js";
import { schedulePlaybackPositionRestore, setPlaybackPosition } from "./playback-position.js";
import { normalizeSavedAudioLevel, normalizeSavedLimiterPreference } from "./audio-preferences.js";
import { parseSpotifyShareLink, searchRadioBrowser, radioStationClickUrl, readYoutubeModeEnabled, persistYoutubeModeEnabled, readNetworkModeEnabled, persistNetworkModeEnabled, networkModeCanUseInternet, SAVED_RADIO_STATIONS_SETTING_KEY, isRadioStationTrack, migrateRadioStationsFromTracks, upsertSavedRadioStation, removeSavedRadioStation } from "./online-services.js";
import { validateCompanionImage, validateCompanionImageDimensions } from "./character-companion.js";
import { createMusicFinderController } from "./music-finder-ui.js";
import { normalizeExternalMediaUrl } from "./external-navigation.js";
import { matchesLibrarySearch } from "./library-search.js";
import { filterAndSortLibraryTracks, getLibraryFacetOptions, hasActiveLibraryFilters, LIBRARY_SORT_OPTIONS } from "./library-filters.js";
import { mergeNativeTrackMetadata } from "./native-track-metadata.js";
import { normalizeId3Genre } from "./music-genres.js";
import { preserveKnownScanNumber } from "./native-track-scan.js";

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
  const result = audioOutputVolume.setVolume(value);
  if (state.nativePlayback?.active) {
    nativePlaybackPlugin()?.setVolume({ volume: Math.max(0, Math.min(1, Number(value) || 0)) }).catch(() => {});
  }
  return result;
}
let screenWakeLock = null;
let playbackRequestId = 0;
let pendingPlaybackPositionCancel = null;
// Identifies a play() request that has not reached confirmed playback yet.
// Pause must cancel intent even while the media element still reports paused.
let pendingPlaybackRequestId = null;
let nativePlaybackPollTimer = null;
const nativePlaybackPollGate = createAsyncGenerationGate();
let nativeUrlFallbackInProgressFor = null;
let youtubeSearchRequestId = 0;
let youtubeSearchAbortController = null;
let youtubeModeEnabledState = readYoutubeModeEnabled();
let networkModeEnabledState = readNetworkModeEnabled();
let archiveSearchRequestId = 0;
let serviceWorkerStatus = "No comprobado";
const AUDIO_PREFS_KEY = "ritmo.audio-preferences.v1";
const DEFAULT_AUDIO_PREFS = { equalizerEnabled: false, eqPreset: "custom", bass: 0, mid: 0, treble: 0, limiter: false, limiterOptIn: false, userEqProfiles: [], keepScreenAwake: false, fadeOutAtEnd: true, volume: 0.8, lastAudibleVolume: 0.8 };
function loadAudioPreferences() {
  try {
    const saved = JSON.parse(localStorage.getItem(AUDIO_PREFS_KEY) || "null");
    const userEqProfiles = normalizeSavedEqualizerProfiles(saved?.userEqProfiles);
    const savedPresetExists = saved && (
      saved.eqPreset === "custom" ||
      Object.prototype.hasOwnProperty.call(EQUALIZER_PRESETS, saved.eqPreset) ||
      userEqProfiles.some(profile => "user:" + profile.id === saved.eqPreset)
    );
    return {
      ...DEFAULT_AUDIO_PREFS,
      ...(saved && typeof saved === "object" ? saved : {}),
      userEqProfiles,
      eqPreset: savedPresetExists ? saved.eqPreset : "custom",
      bass: Math.max(-12, Math.min(12, Number(saved?.bass) || 0)),
      mid: Math.max(-12, Math.min(12, Number(saved?.mid) || 0)),
      treble: Math.max(-12, Math.min(12, Number(saved?.treble) || 0)),
      equalizerEnabled: saved?.equalizerEnabled === true,
      ...normalizeSavedLimiterPreference(saved),
      keepScreenAwake: saved?.keepScreenAwake === true,
      fadeOutAtEnd: saved?.fadeOutAtEnd !== false,
      volume: normalizeSavedAudioLevel(saved?.volume, DEFAULT_AUDIO_PREFS.volume),
      lastAudibleVolume: normalizeSavedAudioLevel(saved?.lastAudibleVolume, DEFAULT_AUDIO_PREFS.lastAudibleVolume, 0.01)
    };
  } catch { return { ...DEFAULT_AUDIO_PREFS }; }
}
const audioPrefs = loadAudioPreferences();
const filePicker = $("#file-picker");
const folderPicker = $("#folder-picker");
const state = { tracks: [], history: [], playlists: [], currentId: null, currentPlaylistId: null, queueIds: null, view: "home", shuffle: false, repeat: "off", query: "", objectUrls: new Map(), installPrompt: null, toastTimer: null, sleepTimer: null, sleepEndsAt: null, sleepFadeTimer: null, youtubeResults: [], youtubeNextPageToken: null, youtubeQuery: "", archiveQuery: "", archiveOffset: 0, archiveTotal: 0, archiveResults: [], archiveFileCache: new Map(), mediaSessionTrackId: null, mediaSessionArtworkUrl: "", nativeMusicPlugin: null, nativePlayerPlugin: null,
  nativePlayback: { active: false, isPlaying: false, currentTime: 0, duration: 0, playbackState: "idle", trackId: null, endedHandled: false } };
 
const LIBRARY_VIEW_KEY = "ritmo.library-view.v1";
const LIBRARY_FILTERS_KEY = "ritmo.library-filters.v1";
let libraryMode = (() => {
  try { return localStorage.getItem(LIBRARY_VIEW_KEY) === "list" ? "list" : "grid"; }
  catch { return "grid"; }
})();
function readSavedLibraryFilters() {
  try {
    const saved = JSON.parse(localStorage.getItem(LIBRARY_FILTERS_KEY) || "{}");
    const allowedSorts = new Set(LIBRARY_SORT_OPTIONS.map(option => option.value));
    return {
      artist: typeof saved.artist === "string" ? saved.artist : "",
      album: typeof saved.album === "string" ? saved.album : "",
      genre: typeof saved.genre === "string" ? saved.genre : "",
      folder: typeof saved.folder === "string" ? saved.folder : "",
      sort: allowedSorts.has(saved.sort) ? saved.sort : "added"
    };
  } catch {
    return { artist: "", album: "", genre: "", folder: "", sort: "added" };
  }
}
let libraryFilters = readSavedLibraryFilters();
const selectedLibraryTrackIds = new Set();
let metadataEditingTrackIds = [];
let metadataTouchedFields = new Set();


const viewNames = { home: "Inicio", library: "Mi biblioteca", favorites: "Favoritos", history: "Historial", playlists: "Mis listas", offline: "Sin conexión", finder: "Encontrar música", online: "Música online", voices: "Estudio de voces", converter: "Convertir audio" };
let voicePreviewPausedPlayback = null;
let converterFiles = [];
let converterRunning = false;
let converterCancelRequested = false;
let converterAudioContext = null;
let converterAbortController = null;
let converterOutputUrls = [];
const converterPreviewElements = new Set();
let activeConverterPreview = null;
let converterOutputBytes = 0;
let converterOutputFilenames = new Set();
let converterLibraryImportInProgress = false;


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
function getTrack(trackId) { return state.tracks.find(track => track.id === trackId); }
function currentTrack() { return getTrack(state.currentId); }
const trackGenreReadsInProgress = new Set();
const artworkObjectUrls = new Map();
const nativeArtworkReadsInProgress = new Set();
function notifySoundTrackContext(track) {
  window.dispatchEvent(new CustomEvent("ritmo:track-context", {
    detail: { genre: String(track?.genre || ""), radioTags: String(track?.radioTags || "") }
  }));
}
function backfillTrackGenre(track) {
  if (!track || track.metadataScanned === true || !(track.blob instanceof Blob) ||
      (!/\.mp3$/i.test(track.name || "") && !isVorbisMetadataFilename(track.name || "") && !isWavMetadataFilename(track.name || "")) ||
      trackGenreReadsInProgress.has(track.id)) return;
  trackGenreReadsInProgress.add(track.id);
  void readAudioMetadata(track.blob, track.name).then(metadata => {
    const current = getTrack(track.id);
    if (!current) return;
    let changed = false;
    if (!current.genre && metadata.genre) {
      current.genre = metadata.genre;
      changed = true;
    }
    if (!current.artworkBlob && metadata.artwork instanceof Uint8Array &&
        (metadata.artworkMimeType === "image/jpeg" || metadata.artworkMimeType === "image/png") &&
        metadata.artwork.byteLength <= MAX_EMBEDDED_ARTWORK_BYTES) {
      current.artworkBlob = new Blob([metadata.artwork], { type: metadata.artworkMimeType });
      changed = true;
    }
    if (current.metadataScanned !== true) {
      current.metadataScanned = true;
      changed = true;
    }
    if (!changed) return;
    return saveTrack(current).then(() => {
      if (state.currentId === current.id) {
        notifySoundTrackContext(current);
        // The same track may already have published a fallback icon to the OS.
        state.mediaSessionTrackId = null;
      }
      render();
      if (state.currentId === current.id) updateMediaSession();
    });
  }).catch(() => {}).finally(() => trackGenreReadsInProgress.delete(track.id));
}
function decodeNativeArtworkBase64(value, mimeType) {
  const base64 = String(value || "");
  const maxEncodedLength = Math.ceil(MAX_EMBEDDED_ARTWORK_BYTES / 3) * 4;
  if (!base64 || base64.length > maxEncodedLength || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64) || base64.length % 4 !== 0) return null;
  try {
    const binary = atob(base64);
    if (binary.length > MAX_EMBEDDED_ARTWORK_BYTES) return null;
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    return validateEmbeddedArtwork(bytes, mimeType);
  } catch {
    return null;
  }
}
function backfillNativeTrackArtwork(track) {
  if (!track || track.artworkBlob instanceof Blob || track.nativeArtworkScanned === true ||
      (!track.nativeUri && !track.nativePath) || nativeArtworkReadsInProgress.has(track.id)) return;
  const plugin = nativeMusicPlugin();
  if (!plugin?.getEmbeddedArtwork) return;
  nativeArtworkReadsInProgress.add(track.id);
  void plugin.getEmbeddedArtwork({ uri: String(track.nativeUri || ""), path: String(track.nativePath || "") }).then(async result => {
    const current = getTrack(track.id);
    if (!current || current.artworkBlob instanceof Blob || current.nativeArtworkScanned === true) return;
    const bytes = result?.found === true
      ? decodeNativeArtworkBase64(result.base64, result.mimeType)
      : null;
    if (bytes) {
      const mimeType = String(result.mimeType).toLowerCase();
      current.artworkBlob = new Blob([bytes], { type: mimeType });
      current.artworkInvalid = false;
    }
    current.nativeArtworkScanned = true;
    await saveTrack(current);
    if (!getTrack(current.id)) return;
    render();
    if (state.currentId === current.id) {
      state.mediaSessionArtworkUrl = "";
      state.mediaSessionTrackId = null;
      updateMediaSession();
    }
  }).catch(error => {
    // File permissions can expire for document providers. Leave the track
    // retryable on the next play rather than persisting a false "no cover".
    console.debug("No se pudo leer la portada nativa de " + track.name + ".", error);
  }).finally(() => nativeArtworkReadsInProgress.delete(track.id));
}

function isLocal(track) {
  return track?.kind === "file" && (
    track.blob instanceof Blob ||
    (typeof track.nativePath === "string" && Boolean(track.nativePath)) ||
    (typeof track.nativeUri === "string" && Boolean(track.nativeUri))
  );
}
function isNativeAndroidShell() {
  const bridge = window.Capacitor;
  const platform = typeof bridge?.getPlatform === "function" ? bridge.getPlatform() : "";
  return Boolean(window.androidBridge) || platform === "android" ||
    (platform !== "web" && typeof bridge?.nativePromise === "function");
}
function nativeMusicPlugin() {
  const bridge = window.Capacitor;
  if (!isNativeAndroidShell() || typeof bridge?.nativePromise !== "function") return null;
  if (!state.nativeMusicPlugin) {
    // This app ships vanilla ES modules and does not bundle an @capacitor/core import.
    // Use the native Promise bridge directly when registerPlugin is absent.
    const invoke = method => options => bridge.nativePromise("RitmoMusicLibrary", method, options || {});
    state.nativeMusicPlugin = {
      requestAudioPermission: invoke("requestAudioPermission"),
      listAudio: invoke("listAudio"),
      pickAudioFiles: invoke("pickAudioFiles"),
      pickAudioFolder: invoke("pickAudioFolder"),
      listAudioFromTree: invoke("listAudioFromTree"),
      resolveAudioPath: invoke("resolveAudioPath"),
      pruneAudioCache: invoke("pruneAudioCache"),
      getEmbeddedArtwork: invoke("getEmbeddedArtwork")
    };
  }
  return state.nativeMusicPlugin;
}
async function pruneNativeAudioCache() {
  const plugin = nativeMusicPlugin();
  if (!plugin?.pruneAudioCache) return;
  try {
    const keepPaths = state.tracks.map(track => String(track.nativePath || "")).filter(Boolean);
    const result = await plugin.pruneAudioCache({ keepPaths });
    if (Number(result?.failed) > 0) {
      console.warn("Ritmo no pudo retirar " + Number(result.failed) + " archivo(s) huérfano(s) de su caché de audio.");
    }
  } catch (error) {
    // Cleanup is best-effort: it must never block importing or playing music.
    console.warn("No se pudo revisar la caché local de audio.", error);
  }
}
function nativePlaybackPlugin() {
  const bridge = window.Capacitor;
  if (!isNativeAndroidShell() || typeof bridge?.nativePromise !== "function") return null;
  if (!state.nativePlayerPlugin) {
    const invoke = method => options => bridge.nativePromise("RitmoPlayback", method, options || {});
    state.nativePlayerPlugin = {
      play: invoke("play"), pause: invoke("pause"), resume: invoke("resume"),
      seekTo: invoke("seekTo"), setVolume: invoke("setVolume"),
      setEqualizer: invoke("setEqualizer"),
      openExternal: invoke("openExternal"),
      getState: invoke("getState"), stop: invoke("stop")
    };
  }
  return state.nativePlayerPlugin;
}
function nativeEqualizerPayload() {
  return {
    enabled: Boolean(audioPrefs.equalizerEnabled),
    bass: Math.max(-12, Math.min(12, Number(audioPrefs.bass) || 0)),
    mid: Math.max(-12, Math.min(12, Number(audioPrefs.mid) || 0)),
    treble: Math.max(-12, Math.min(12, Number(audioPrefs.treble) || 0))
  };
}
async function applyNativeEqualizerPreferences() {
  const plugin = nativePlaybackPlugin();
  if (!state.nativePlayback.active || !plugin?.setEqualizer) return false;
  const result = await plugin.setEqualizer(nativeEqualizerPayload());
  if (audioPrefs.equalizerEnabled && result?.supported === false) {
    $("#eq-status").textContent = "Android no ofrece un ecualizador de sesión compatible en este dispositivo. La reproducción y los controles del sistema siguen activos.";
  }
  return true;
}
function playbackIsPaused() {
  if (state.nativePlayback.active) return !state.nativePlayback.isPlaying;
  if (!currentTrack() && spotifyCurrentEmbed && spotifyControllerReady) return spotifyMediaPlaybackState !== "playing";
  if (youtubeHistory.getCurrentSession()) return youtubeMediaPlaybackState !== "playing";
  return audio.paused;
}
function playbackCurrentTime() {
  if (state.nativePlayback.active) return Math.max(0, Number(state.nativePlayback.currentTime) || 0);
  if (!currentTrack() && spotifyCurrentEmbed && spotifyControllerReady) return Math.max(0, Number(spotifyCurrentTime) || 0);
  if (youtubeHistory.getCurrentSession() && youtubePlayer?.getCurrentTime) {
    try { return Math.max(0, Number(youtubePlayer.getCurrentTime()) || 0); } catch {}
  }
  return audio.currentTime;
}
function playbackDuration() {
  if (state.nativePlayback.active) return Number(state.nativePlayback.duration) > 0 ? Number(state.nativePlayback.duration) : Number.NaN;
  if (!currentTrack() && spotifyCurrentEmbed && spotifyControllerReady) return Number.isFinite(spotifyDuration) && spotifyDuration > 0 ? spotifyDuration : Number.NaN;
  if (youtubeHistory.getCurrentSession() && youtubePlayer?.getDuration) {
    try { const duration = Number(youtubePlayer.getDuration()); return duration > 0 && Number.isFinite(duration) ? duration : Number.NaN; } catch {}
  }
  return audio.duration;
}
function seekPlayback(seconds) {
  const position = Math.max(0, Number(seconds) || 0);
  if (!currentTrack() && spotifyCurrentEmbed && spotifyControllerReady) {
    try { spotifyEmbedController?.seek(Math.round(position)); } catch {}
    updatePlayer();
    updateMediaSession();
    return;
  }
  if (!state.nativePlayback.active && youtubeHistory.getCurrentSession()) {
    try { if (youtubePlayer?.seekTo) youtubePlayer.seekTo(position, true); } catch {}
    updatePlayer();
    updateMediaSession();
    return;
  }
  if (state.nativePlayback.active) {
    state.nativePlayback.currentTime = position;
    const plugin = nativePlaybackPlugin();
    if (plugin?.seekTo) plugin.seekTo({ positionMs: Math.round(position * 1000) }).catch(error => {
      showPlaybackStatus(error?.message || "No se pudo cambiar la posición de reproducción.", "warning", true);
    });
    updatePlayer();
    updateMediaSession();
    return;
  }
  try { audio.currentTime = position; } catch {}
}
function invalidateNativePlaybackPolling() {
  const generation = nativePlaybackPollGate.invalidate();
  if (nativePlaybackPollTimer) clearInterval(nativePlaybackPollTimer);
  nativePlaybackPollTimer = null;
  return generation;
}
function stopNativePlayback() {
  const wasActive = state.nativePlayback.active;
  invalidateNativePlaybackPolling();
  state.nativePlayback = { active: false, isPlaying: false, currentTime: 0, duration: 0, playbackState: "idle", trackId: null, endedHandled: false };
  if (wasActive) {
    const plugin = nativePlaybackPlugin();
    return plugin?.stop().catch(() => {}) || Promise.resolve();
  }
  return Promise.resolve();
}
function acceptNativePlaybackState(result) {
  if (!state.nativePlayback.active || state.nativePlayback.trackId !== state.currentId || !result) return;
  state.nativePlayback.isPlaying = Boolean(result.isPlaying);
  state.nativePlayback.playbackState = String(result.playbackState || "idle");
  state.nativePlayback.currentTime = Math.max(0, Number(result.positionMs) || 0) / 1000;
  const duration = Math.max(0, Number(result.durationMs) || 0) / 1000;
  if (duration > 0) {
    state.nativePlayback.duration = duration;
    const track = currentTrack();
    if (track && Math.abs((Number(track.duration) || 0) - duration) > 1) {
      track.duration = duration;
      saveTrack(track).catch(() => {});
    }
  }
  if (result.error) {
    const failedTrack = currentTrack();
    if (failedTrack?.kind === "url" && failedTrack.url && nativeUrlFallbackInProgressFor !== failedTrack.id) {
      // Media3 can report HTTP/format failures asynchronously after play() returns.
      // Try HTML audio once; it can support a different set of streaming sources.
      nativeUrlFallbackInProgressFor = failedTrack.id;
      const resumeAt = state.nativePlayback.currentTime;
      toast("Android no pudo abrir esa fuente; probando el reproductor del navegador.");
      void playTrack(failedTrack.id, true, {
        keepQueue: true, skipHistory: true, forceReload: true, resumeAt, forceWebPlayback: true
      });
      return;
    }
    showPlaybackStatus("Android no pudo reproducir esta pista: " + result.error, "error", true);
  } else if (audioPrefs.equalizerEnabled && result.equalizerSupported === false) {
    showPlaybackStatus("Esta pista sigue reproduciéndose en Android, pero el dispositivo no admite el ecualizador nativo. Los controles de pantalla bloqueada se mantienen.", "warning", true);
  } else if (state.nativePlayback.playbackState === "ready") showPlaybackStatus("");
  if (state.nativePlayback.playbackState === "ended" && !state.nativePlayback.endedHandled) {
    state.nativePlayback.endedHandled = true;
    const track = currentTrack();
    if (state.repeat === "one" && track) playTrack(track.id, true, { keepQueue: true, skipHistory: true, forceReload: true });
    else nextTrack(1);
  }
  updatePlayer();
  updateMediaSession();
}
function startNativePlaybackPolling() {
  const generation = invalidateNativePlaybackPolling();
  const poll = async () => {
    if (!nativePlaybackPollGate.isCurrent(generation) || !state.nativePlayback.active ||
        !nativePlaybackPollGate.tryStart(generation)) return;
    const plugin = nativePlaybackPlugin();
    if (!plugin?.getState) {
      nativePlaybackPollGate.finish(generation);
      return;
    }
    try {
      const result = await plugin.getState();
      if (!nativePlaybackPollGate.isCurrent(generation)) return;
      acceptNativePlaybackState(result);
    } catch (error) {
      if (nativePlaybackPollGate.isCurrent(generation) && state.nativePlayback.active) {
        showPlaybackStatus(error?.message || "No se pudo consultar el estado de reproducción nativa.", "warning", true);
      }
    } finally {
      // A stale completion cannot release the slot acquired by a newer generation.
      nativePlaybackPollGate.finish(generation);
    }
  };
  void poll();
  nativePlaybackPollTimer = setInterval(poll, 700);
}

function sourceLabel(track) { return isLocal(track) ? "En este dispositivo" : "Streaming online"; }
function toast(message) {
  const node = $("#toast");
  node.textContent = message;
  node.classList.add("show");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => node.classList.remove("show"), 2800);
}
function trackURL(track) {
  // When the user enables EQ, decode the durable IndexedDB Blob in Web Audio.
  // The private/native file path remains available for Media3 when EQ is off.
  if (audioPrefs.equalizerEnabled && track?.blob instanceof Blob) {
    if (!state.objectUrls.has(track.id)) state.objectUrls.set(track.id, URL.createObjectURL(track.blob));
    return state.objectUrls.get(track.id);
  }
  if (track?.nativePath) {
    const bridge = window.Capacitor;
    if (typeof bridge?.convertFileSrc !== "function") throw new Error("Android no pudo abrir la ruta de esta canción.");
    return bridge.convertFileSrc(track.nativePath);
  }
  if (track?.blob instanceof Blob) {
    if (!state.objectUrls.has(track.id)) state.objectUrls.set(track.id, URL.createObjectURL(track.blob));
    return state.objectUrls.get(track.id);
  }
  if (track?.nativeUri) throw new Error("La canción necesita resolver su ruta del dispositivo antes de reproducirse.");
  return track?.url || "";
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
function trackArtworkUrl(track) {
  const blob = track?.artworkBlob;
  if (track?.artworkInvalid === true || !(blob instanceof Blob) || blob.size < 8 ||
      blob.size > MAX_EMBEDDED_ARTWORK_BYTES ||
      !["image/jpeg", "image/png"].includes(String(blob.type || "").toLowerCase())) return "";
  const cached = artworkObjectUrls.get(track.id);
  if (cached?.blob === blob) return cached.url;
  if (cached) {
    try { URL.revokeObjectURL(cached.url); } catch {}
    artworkObjectUrls.delete(track.id);
  }
  try {
    const url = URL.createObjectURL(blob);
    artworkObjectUrls.set(track.id, { blob, url });
    return url;
  } catch {
    return "";
  }
}
function releaseUnusedArtworkObjectUrls() {
  for (const [trackId, entry] of artworkObjectUrls) {
    const track = getTrack(trackId);
    if (track?.artworkBlob === entry.blob && track?.artworkInvalid !== true) continue;
    try { URL.revokeObjectURL(entry.url); } catch {}
    artworkObjectUrls.delete(trackId);
  }
}
function releaseAllArtworkObjectUrls() {
  for (const entry of artworkObjectUrls.values()) {
    try { URL.revokeObjectURL(entry.url); } catch {}
  }
  artworkObjectUrls.clear();
}
window.addEventListener("pagehide", event => {
  if (!event.persisted) releaseAllArtworkObjectUrls();
});
function artworkImageHTML(track, className = "album-artwork") {
  const url = trackArtworkUrl(track);
  return url ? '<img class="' + className + '" data-artwork-track="' + escapeHTML(track.id) +
    '" src="' + escapeHTML(url) + '" alt="" loading="lazy" decoding="async">' : "";
}
document.addEventListener("error", event => {
  const image = event.target;
  if (!(image instanceof HTMLImageElement) || !image.classList.contains("album-artwork")) return;
  const track = getTrack(image.dataset.artworkTrack);
  if (!track || track.artworkInvalid === true) return;
  // A valid tag header can still contain corrupt compressed pixels. Remember
  // that the browser rejected this artwork so rendering falls back to the
  // placeholder instead of retrying the same broken decode on every view.
  track.artworkInvalid = true;
  state.mediaSessionArtworkUrl = "";
  state.mediaSessionTrackId = null;
  void saveTrack(track).catch(() => {});
  render();
  if (state.currentId === track.id) updateMediaSession();
}, true);
function coverHTML(track, extra = "") {
  const artwork = artworkImageHTML(track);
  return '<div class="track-mini-cover ' + coverClass(track) + (artwork ? " has-artwork" : "") + " " + extra + '">' +
    (artwork || "♫") + '</div>';
}
function coverCardHTML(track) {
  const artwork = artworkImageHTML(track);
  return '<div class="cover-art ' + coverClass(track) + (artwork ? " has-artwork" : "") + '">' +
    (artwork || "<span>♫</span>") +
    '<button class="card-play" data-play="' + escapeHTML(track.id) + '" aria-label="Reproducir ' + escapeHTML(track.title) + '">▶</button></div>';
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
function syncLibraryFilterControls() {
  const facets = [
    { field: "artist", selector: "#library-filter-artist", placeholder: "Todos los artistas" },
    { field: "album", selector: "#library-filter-album", placeholder: "Todos los álbumes" },
    { field: "genre", selector: "#library-filter-genre", placeholder: "Todos los géneros" },
    { field: "folder", selector: "#library-filter-folder", placeholder: "Todas las carpetas" }
  ];
  for (const facet of facets) {
    const select = $(facet.selector);
    if (!select) continue;
    const values = getLibraryFacetOptions(state.tracks, facet.field);
    if (libraryFilters[facet.field] && !values.some(value =>
      value.localeCompare(libraryFilters[facet.field], "es", { sensitivity: "base" }) === 0)) {
      libraryFilters[facet.field] = "";
    }
    select.innerHTML = '<option value="">' + escapeHTML(facet.placeholder) + '</option>' +
      values.map(value => '<option value="' + escapeHTML(value) + '">' + escapeHTML(value) + '</option>').join("");
    select.value = libraryFilters[facet.field];
  }
  const sort = $("#library-sort");
  if (sort) {
    if (!LIBRARY_SORT_OPTIONS.some(option => option.value === libraryFilters.sort)) libraryFilters.sort = "added";
    sort.value = libraryFilters.sort;
  }
}
function persistLibraryFilters() {
  try { localStorage.setItem(LIBRARY_FILTERS_KEY, JSON.stringify(libraryFilters)); } catch {}
}
function syncLibrarySelection() {
  for (const trackId of [...selectedLibraryTrackIds]) {
    if (!state.tracks.some(track => String(track.id) === trackId)) selectedLibraryTrackIds.delete(trackId);
  }
  document.querySelectorAll("[data-select-track]").forEach(button => {
    const trackId = String(button.dataset.selectTrack || button.closest("[data-library-card]")?.dataset.libraryCard || button.closest("[data-track-row]")?.dataset.trackRow || "");
    if (!trackId) return;
    const selected = selectedLibraryTrackIds.has(trackId);
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-pressed", String(selected));
    if (button.classList.contains("track-index")) button.textContent = selected ? "✓" : button.dataset.defaultLabel;
    else button.textContent = selected ? "✓" : "○";
    button.title = selected ? "Quitar de la selección" : "Seleccionar canción";
    button.setAttribute("aria-label", selected ? "Quitar de la selección" : "Seleccionar canción");
  });
  const visibleIds = sortedForView("library").map(track => String(track.id));
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(trackId => selectedLibraryTrackIds.has(trackId));
  const selectVisible = $("#library-select-visible");
  if (selectVisible) selectVisible.textContent = allVisibleSelected ? "Desmarcar visibles" : "Seleccionar visibles";
  const bulkEdit = $("#library-bulk-edit");
  if (bulkEdit) {
    bulkEdit.hidden = selectedLibraryTrackIds.size === 0;
    bulkEdit.disabled = selectedLibraryTrackIds.size === 0;
    bulkEdit.textContent = "Editar seleccionadas (" + selectedLibraryTrackIds.size + ")";
  }
  const status = $("#library-selection-status");
  if (status) status.textContent = selectedLibraryTrackIds.size
    ? selectedLibraryTrackIds.size + (selectedLibraryTrackIds.size === 1 ? " canción seleccionada" : " canciones seleccionadas")
    : "Sin selección";
}
function renderLibrarySection() {
  syncLibraryFilterControls();
  const visible = sortedForView("library");
  $("#library-meta").textContent = visible.length + (visible.length === 1 ? " canción" : " canciones");
  renderTrackList("#library-tracks", visible, "#library-empty");
  renderLibraryGrid(visible);
  syncLibraryViewControls();
  const libraryTrackCount = state.tracks.filter(track => !isRadioStationTrack(track)).length;
  $("#library-empty").hidden = libraryTrackCount > 0;
  $("#library-no-results").hidden = !(libraryTrackCount > 0 &&
    hasActiveLibraryFilters({ query: state.query, ...libraryFilters }) && visible.length === 0);
  syncLibrarySelection();
}
function openTrackMetadataEditor(trackIds) {
  const ids = [...new Set((trackIds || []).map(String))];
  const tracks = ids.map(id => state.tracks.find(track => String(track.id) === id)).filter(Boolean);
  if (!tracks.length) { toast("Seleccioná al menos una canción para editar."); return; }
  metadataEditingTrackIds = tracks.map(track => String(track.id));
  metadataTouchedFields = new Set();
  const bulk = tracks.length > 1;
  const titleRow = $("#metadata-title-row");
  const titleInput = $("#metadata-title");
  if (titleRow) titleRow.hidden = bulk;
  if (titleInput) {
    titleInput.disabled = bulk;
    titleInput.value = bulk ? "" : String(tracks[0].title || "");
  }
  for (const field of ["artist", "album", "genre"]) {
    const input = $("#metadata-" + field);
    if (input) input.value = bulk ? "" : String(tracks[0][field] || "");
  }
  const note = $("#metadata-editor-note");
  if (note) note.textContent = bulk
    ? "Edición por lote de " + tracks.length + " canciones. Dejá vacío un campo para conservar el valor de cada una. El título se edita de a una canción."
    : "Los cambios se guardan solo en la biblioteca de Ritmo; el archivo original no se modifica ni se recodifica.";
  const status = $("#metadata-editor-status");
  if (status) status.textContent = "";
  const dialog = $("#metadata-dialog");
  if (dialog && !dialog.open) dialog.showModal();
}
async function saveTrackMetadata(event) {
  event.preventDefault();
  const tracks = metadataEditingTrackIds.map(id => state.tracks.find(track => String(track.id) === id)).filter(Boolean);
  if (!tracks.length) { $("#metadata-dialog")?.close(); return; }
  const bulk = tracks.length > 1;
  const fields = bulk ? ["artist", "album", "genre"] : ["title", "artist", "album", "genre"];
  const values = Object.fromEntries(fields.map(field => [field, String($("#metadata-" + field)?.value ?? "").trim()]));
  const updates = fields.filter(field => metadataTouchedFields.has(field) && (!bulk || values[field] !== ""));
  if (!updates.length) {
    const status = $("#metadata-editor-status");
    if (status) status.textContent = "No cambiaste ningún campo.";
    return;
  }
  const snapshots = tracks.map(track => ({
    track,
    fields: Object.fromEntries(updates.map(field => [field, track[field]])),
    hadUserMetadataOverrides: Object.prototype.hasOwnProperty.call(track, "userMetadataOverrides"),
    userMetadataOverrides: track.userMetadataOverrides && typeof track.userMetadataOverrides === "object" &&
      !Array.isArray(track.userMetadataOverrides) ? { ...track.userMetadataOverrides } : track.userMetadataOverrides
  }));
  for (const track of tracks) {
    for (const field of updates) track[field] = values[field];
    const overrides = track.userMetadataOverrides && typeof track.userMetadataOverrides === "object" &&
      !Array.isArray(track.userMetadataOverrides) ? track.userMetadataOverrides : {};
    track.userMetadataOverrides = {
      ...overrides,
      ...Object.fromEntries(updates.map(field => [field, true]))
    };
  }
  try {
    await saveManyTracks(tracks);
    $("#metadata-dialog")?.close();
    selectedLibraryTrackIds.clear();
    render();
    if (tracks.some(track => String(track.id) === String(state.currentId))) {
      updateMediaSession();
      updatePlayer();
    }
    toast(updates.length + " campo(s) actualizado(s) en " + tracks.length + (tracks.length === 1 ? " canción." : " canciones."));
  } catch (error) {
    for (const snapshot of snapshots) {
      Object.assign(snapshot.track, snapshot.fields);
      if (snapshot.hadUserMetadataOverrides) snapshot.track.userMetadataOverrides = snapshot.userMetadataOverrides;
      else delete snapshot.track.userMetadataOverrides;
    }
    render();
    const status = $("#metadata-editor-status");
    if (status) status.textContent = error?.message || "No se pudieron guardar los cambios.";
    toast("No se guardaron los metadatos. Se revirtieron los cambios.");
  }
}
function bindLibraryManagementEvents() {
  for (const field of ["artist", "album", "genre", "folder"]) {
    const select = $("#library-filter-" + field);
    select?.addEventListener("change", () => {
      libraryFilters[field] = select.value;
      persistLibraryFilters();
      renderLibrarySection();
    });
  }
  $("#library-sort")?.addEventListener("change", event => {
    libraryFilters.sort = event.target.value;
    persistLibraryFilters();
    renderLibrarySection();
  });
  $("#library-select-visible")?.addEventListener("click", () => {
    const visibleIds = sortedForView("library").map(track => String(track.id));
    const clear = visibleIds.length > 0 && visibleIds.every(id => selectedLibraryTrackIds.has(id));
    for (const id of visibleIds) {
      if (clear) selectedLibraryTrackIds.delete(id);
      else selectedLibraryTrackIds.add(id);
    }
    syncLibrarySelection();
  });
  $("#library-bulk-edit")?.addEventListener("click", () => openTrackMetadataEditor([...selectedLibraryTrackIds]));
  $("#track-metadata-form")?.addEventListener("submit", saveTrackMetadata);
  for (const field of ["title", "artist", "album", "genre"]) {
    $("#metadata-" + field)?.addEventListener("input", () => metadataTouchedFields.add(field));
  }
  $("#metadata-cancel")?.addEventListener("click", () => $("#metadata-dialog")?.close());
  $("#metadata-close")?.addEventListener("click", () => $("#metadata-dialog")?.close());
}

function renderLibraryGrid(list) {
  const root = $("#library-grid");
  if (!root) return;
  root.innerHTML = list.map((track, index) => {
    const active = track.id === state.currentId;
    const favoriteClass = track.favorite ? " is-favorite" : "";
    const artwork = artworkImageHTML(track);
    const hasArtwork = artwork ? " has-artwork" : "";
    const source = isLocal(track) ? "EN ESTE DISPOSITIVO" : (networkModeIsAvailable() ? "STREAMING ONLINE" : "🔒 ONLINE BLOQUEADO");
    const download = track.kind !== "url" ? "" : track.sourceProvider === "Internet Archive"
      ? '<a class="row-icon archive-track-download" href="' + escapeHTML(track.url) + '" target="_blank" rel="noopener noreferrer" title="Abrir archivo original" aria-label="Abrir archivo original">⇩</a>'
      : '<button class="row-icon" type="button" data-download-track="' + escapeHTML(track.id) + '" title="Guardar sin conexión si está permitido" aria-label="Guardar audio online sin conexión">⇩</button>';
    return '<article class="library-album-card' + (active ? " library-album-active" : "") + '" data-library-card="' + escapeHTML(track.id) + '">' +
      '<button class="library-album-art ' + coverClass(track) + hasArtwork + '" type="button" data-play="' + escapeHTML(track.id) + '" aria-label="Reproducir ' + escapeHTML(track.title) + '">' +
      artwork + '<span class="library-art-stamp">' + String(index + 1).padStart(2, "0") + '</span>' +
      (hasArtwork ? "" : '<span class="library-art-glyph">♫</span>') +
      '<span class="library-art-caption">' + escapeHTML(track.album || "RITMO MIX") + '</span><span class="library-art-play">▶</span></button>' +
      '<div class="library-album-meta"><div class="library-album-title-row"><div class="library-album-title"><strong title="' + escapeHTML(track.title) + '">' + escapeHTML(track.title) + '</strong><small>' + escapeHTML(track.artist || "Artista desconocido") + '</small></div><span class="library-album-status' + (active ? " is-live" : "") + '" title="' + (active ? "Pista seleccionada" : source) + '">' + (active ? "♫" : (isLocal(track) ? "●" : "↗")) + '</span></div>' +
      '<div class="library-album-actions"><span class="library-album-source">' + source + '</span><div class="library-album-buttons"><button class="row-icon track-select-button" data-select-track type="button" aria-pressed="false" title="Seleccionar canción" aria-label="Seleccionar canción">○</button><button class="row-icon" type="button" data-edit-tags title="Editar metadatos" aria-label="Editar metadatos">✎</button><button class="row-icon" data-add-playlist="' + escapeHTML(track.id) + '" type="button" title="Agregar a una lista" aria-label="Agregar a una lista">☷</button>' + download +
      '<button class="row-icon' + favoriteClass + '" data-favorite="' + escapeHTML(track.id) + '" type="button" aria-label="' + (track.favorite ? "Quitar de favoritos" : "Agregar a favoritos") + '" title="Favorito">' + (track.favorite ? "♥" : "♡") + '</button><button class="row-icon delete-track" data-delete="' + escapeHTML(track.id) + '" type="button" aria-label="Eliminar ' + escapeHTML(track.title) + '" title="Eliminar de la biblioteca">×</button></div></div></div></article>';
  }).join("");
  bindRenderedActions(root);
}

function sortedForView(view) {
  const libraryTracks = state.tracks.filter(track => !isRadioStationTrack(track));
  if (view === "library") return filterAndSortLibraryTracks(libraryTracks, { query: state.query, ...libraryFilters });
  let tracks = libraryTracks;
  if (view === "favorites") tracks = tracks.filter(track => track.favorite);
  if (view === "offline") tracks = tracks.filter(isLocal);
  return tracks;
}
function trackRow(track, index) {
  const active = track.id === state.currentId;
  const lockedOnline = !isLocal(track) && !networkModeIsAvailable();
  const favClass = track.favorite ? " is-favorite" : "";
  return '<div class="track-row' + (active ? ' currently-playing' : '') + '" data-track-row="' + escapeHTML(track.id) + '">' +
    '<button type="button" class="track-index track-select-button' + (selectedLibraryTrackIds.has(String(track.id)) ? " is-selected" : "") + '" data-select-track="' + escapeHTML(track.id) + '" data-default-label="' + (active && !playbackIsPaused() ? "♫" : String(index + 1).padStart(2, "0")) + '" aria-pressed="' + String(selectedLibraryTrackIds.has(String(track.id))) + '" title="Seleccionar canción" aria-label="Seleccionar canción">' + (selectedLibraryTrackIds.has(String(track.id)) ? "✓" : (active && !playbackIsPaused() ? "♫" : String(index + 1).padStart(2, "0"))) + '</button>' +
    '<div class="track-main" data-play="' + escapeHTML(track.id) + '" role="button" tabindex="0" aria-label="Reproducir ' + escapeHTML(track.title) + '">' + coverHTML(track) +
    '<div class="track-copy"><strong>' + escapeHTML(track.title) + '</strong><small>' + escapeHTML(track.artist || "Artista desconocido") + '</small></div></div>' +
    '<span class="source-tag' + (isLocal(track) ? "" : " stream" + (lockedOnline ? " network-locked" : "")) + '">' + (isLocal(track) ? "Offline" : (lockedOnline ? "🔒 Online" : "Online")) + '</span>' +
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
  root.querySelectorAll("[data-select-track]").forEach(button => button.addEventListener("click", event => {
    event.stopPropagation();
    const trackId = String(button.dataset.selectTrack || button.closest("[data-library-card]")?.dataset.libraryCard || button.closest("[data-track-row]")?.dataset.trackRow || "");
    if (!trackId) return;
    if (selectedLibraryTrackIds.has(trackId)) selectedLibraryTrackIds.delete(trackId);
    else selectedLibraryTrackIds.add(trackId);
    syncLibrarySelection();
  }));
  root.querySelectorAll("[data-edit-tags]").forEach(button => button.addEventListener("click", event => {
    event.stopPropagation();
    const trackId = String(button.closest("[data-library-card]")?.dataset.libraryCard || "");
    if (trackId) openTrackMetadataEditor([trackId]);
  }));
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
      void pruneNativeAudioCache();
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
async function renamePlaylistById(playlistId) {
  const list = state.playlists.find(item => item.id === playlistId);
  if (!list) return;
  const answer = prompt("Nuevo nombre para la lista:", list.name);
  if (answer === null) return;
  try {
    await savePlaylist(renamePlaylist(list, answer));
    state.playlists = await getPlaylists();
    renderPlaylists();
    toast("Lista renombrada.");
  } catch (error) { toast(error.message || "No se pudo renombrar la lista."); }
}
async function movePlaylistTrackById(playlistId, trackId, direction) {
  const list = state.playlists.find(item => item.id === playlistId);
  if (!list) return;
  try {
    const updated = movePlaylistTrack(list, trackId, direction);
    if (!updated) return;
    await savePlaylist(updated);
    state.playlists = await getPlaylists();
    renderPlaylists();
  } catch (error) { toast(error.message || "No se pudo reordenar la lista."); }
}
function renderPlaylists() {
  const root = $("#playlists-list");
  const activeId = state.currentPlaylistId;
  root.innerHTML = state.playlists.map(list => '<article class="playlist-card"><div class="playlist-cover"><span>♫</span><i>✦</i></div><div class="playlist-card-copy"><strong>' + escapeHTML(list.name) + '</strong><small>' + list.trackIds.length + (list.trackIds.length === 1 ? ' canción' : ' canciones') + '</small></div><div class="playlist-card-actions"><button class="button button-soft" data-open-playlist="' + escapeHTML(list.id) + '">Abrir</button><button class="button button-soft" data-rename-playlist="' + escapeHTML(list.id) + '" aria-label="Renombrar lista ' + escapeHTML(list.name) + '" title="Renombrar lista">Renombrar</button><button class="row-icon delete-track" data-delete-playlist="' + escapeHTML(list.id) + '" aria-label="Eliminar lista ' + escapeHTML(list.name) + '" title="Eliminar lista">×</button></div></article>').join("");
  root.querySelectorAll("[data-open-playlist]").forEach(button => button.addEventListener("click", () => { state.currentPlaylistId = button.dataset.openPlaylist; renderPlaylists(); }));
  root.querySelectorAll("[data-rename-playlist]").forEach(button => button.addEventListener("click", () => { void renamePlaylistById(button.dataset.renamePlaylist); }));
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
    const editActions = document.createElement("span");
    editActions.className = "playlist-track-edit-actions";
    for (const direction of [-1, 1]) {
      const moveButton = document.createElement("button");
      moveButton.type = "button";
      moveButton.className = "row-icon";
      moveButton.textContent = direction < 0 ? "↑" : "↓";
      moveButton.title = direction < 0 ? "Subir canción en la lista" : "Bajar canción en la lista";
      moveButton.setAttribute("aria-label", (direction < 0 ? "Subir " : "Bajar ") + (getTrack(row.dataset.trackRow)?.title || "canción"));
      moveButton.dataset.playlistTrackMove = direction < 0 ? "up" : "down";
      moveButton.disabled = direction < 0 ? index === 0 : index === tracks.length - 1;
      moveButton.addEventListener("click", event => {
        event.stopPropagation();
        void movePlaylistTrackById(selected.id, row.dataset.trackRow, direction);
      });
      editActions.append(moveButton);
    }
    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "row-icon delete-track";
    removeButton.textContent = "−";
    removeButton.title = "Quitar de esta lista";
    removeButton.setAttribute("aria-label", "Quitar " + (getTrack(row.dataset.trackRow)?.title || "canción") + " de esta lista");
    removeButton.dataset.playlistTrackRemove = "true";
    removeButton.addEventListener("click", async event => {
      event.stopPropagation();
      const list = state.playlists.find(item => item.id === selected.id);
      if (!list) return;
      try {
        const updated = removePlaylistTrack(list, row.dataset.trackRow);
        if (!updated) return;
        await savePlaylist(updated);
        state.playlists = await getPlaylists();
        renderPlaylists();
        toast("Canción quitada de la lista.");
      } catch (error) {
        renderPlaylists();
        toast(error.message || "No se pudo actualizar la lista.");
      }
    });
    actions.prepend(editActions);
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
  const position = Number.isFinite(playbackCurrentTime()) ? playbackCurrentTime() : 0;
  playTrack(track.id, true, { keepQueue: true, resumeAt: position, skipHistory: true, forceReload: true });
}

// Route every resume through the request-token-aware player. Calling
// audio.play() directly from a UI/system control can revive the previous
// source while a newer selection is still preparing its engine.
function resumeCurrentTrack() {
  const track = currentTrack();
  if (!track) {
    if (spotifyCurrentEmbed && spotifyControllerReady) {
      try { spotifyEmbedController?.resume(); } catch { toast("Usá el botón Reproducir del widget de Spotify."); }
      return;
    }
    if (youtubeHistory.getCurrentSession()) {
      try { if (youtubePlayer?.playVideo) youtubePlayer.playVideo(); }
      catch { toast("No se pudo reanudar el video de YouTube."); }
    }
    return;
  }
  const position = Number.isFinite(playbackCurrentTime()) ? playbackCurrentTime() : 0;
  playTrack(track.id, true, { keepQueue: true, resumeAt: position, skipHistory: true });
}
function cancelPendingPlaybackPositionRestore() {
  const cancel = pendingPlaybackPositionCancel;
  pendingPlaybackPositionCancel = null;
  cancel?.();
}
function cancelPendingPlaybackIntent() {
  playbackRequestId += 1;
  pendingPlaybackRequestId = null;
  cancelPendingPlaybackPositionRestore();
}
function pauseCurrentTrack() {
  if (!currentTrack() && spotifyCurrentEmbed && spotifyControllerReady) {
    cancelPendingPlaybackIntent();
    spotifyMediaPlaybackState = "paused";
    try { spotifyEmbedController?.pause(); } catch {}
    updatePlayer();
    updateMediaSession();
    return;
  }
  if (!currentTrack() && youtubeHistory.getCurrentSession()) {
    cancelPendingPlaybackIntent();
    youtubeMediaPlaybackState = "paused";
    try { if (youtubePlayer?.pauseVideo) youtubePlayer.pauseVideo(); } catch {}
    updatePlayer();
    updateMediaSession();
    return;
  }
  // Cancel asynchronous intent as well as pausing current media. A late
  // AudioContext.resume() or play() continuation must not restart the track.
  cancelPendingPlaybackIntent();
  if (state.nativePlayback.active) {
    state.nativePlayback.isPlaying = false;
    nativePlaybackPlugin()?.pause().catch(error => showPlaybackStatus(error?.message || "No se pudo pausar el audio.", "warning", true));
  } else audio.pause();
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
function renderSavedEqualizerProfileOptions() {
  const group = $("#eq-user-profiles");
  if (!group) return;
  audioPrefs.userEqProfiles = normalizeSavedEqualizerProfiles(audioPrefs.userEqProfiles);
  group.replaceChildren();
  for (const profile of audioPrefs.userEqProfiles) {
    const option = document.createElement("option");
    option.value = "user:" + profile.id;
    option.textContent = profile.name;
    group.append(option);
  }
  group.hidden = audioPrefs.userEqProfiles.length === 0;
}
function syncSettingsUI() {
  renderSavedEqualizerProfileOptions();
  $("#eq-enabled").checked = audioPrefs.equalizerEnabled;
  const presetSelect = $("#eq-preset");
  presetSelect.value = audioPrefs.eqPreset || "custom";
  if (!presetSelect.value) {
    audioPrefs.eqPreset = "custom";
    presetSelect.value = "custom";
  }
  $("#eq-profile-delete").disabled = !presetSelect.value.startsWith("user:");
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
function serviceWorkerDiagnosticStatus() {
  if (!("serviceWorker" in navigator)) return "No disponible en este navegador";
  if (location.protocol === "file:") return "Requiere HTTPS o localhost";
  return serviceWorkerStatus || (navigator.serviceWorker.controller ? "Controlador activo" : "Todavía no controla esta página");
}
async function renderDiagnostics() {
  const rows = [
    ["Motor Android Media3", nativePlaybackPlugin() ? "Disponible en la APK" : "Solo reproducción del navegador"],
    ["Audio nativo", defaultAudio.canPlayType ? "Disponible" : "No disponible"],
    ["Controles de pantalla bloqueada", "mediaSession" in navigator ? "API disponible (depende del navegador y sistema)" : "No disponible en este navegador"],
    ["Ecualizador local", (window.AudioContext || window.webkitAudioContext) ? "Disponible para archivos locales" : "No disponible en este navegador"],
    ["Mantener pantalla despierta", navigator.wakeLock ? "API disponible; requiere que Ritmo esté visible" : "No compatible en este navegador"],
    ["IndexedDB", "indexedDB" in window ? "Disponible en este navegador" : "No disponible"],
    ["Service Worker / modo sin conexión", serviceWorkerDiagnosticStatus()],
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
    if (audioPrefs.fadeOutAtEnd && !playbackIsPaused()) {
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
          pauseCurrentTrack();
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
  const position = Number.isFinite(playbackCurrentTime()) ? playbackCurrentTime() : 0;
  const wasPlaying = !playbackIsPaused();
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
  try {
    const name = normalizePlaylistName($("#playlist-name").value);
    const list = { id: id(), name, trackIds: [], createdAt: Date.now(), updatedAt: Date.now() };
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
  if (state.nativePlayback.active) {
    if ("mediaSession" in navigator) clearMediaSession(navigator.mediaSession, state);
    return;
  }
  if (!("mediaSession" in navigator)) return;
  const track = currentTrack();
  const youtubeSession = track ? null : youtubeHistory.getCurrentSession();
  if (youtubeSession) {
    // Do not expose the embedded YouTube player through Ritmo's system
    // MediaSession: YouTube's developer policy forbids clients from offering
    // background playback when their window is minimized or closed.
    clearMediaSession(navigator.mediaSession, state);
    return;
  }
  const spotifySession = !track && spotifyCurrentEmbed && spotifyControllerReady ? spotifyCurrentEmbed : null;
  if (!track && !youtubeSession && !spotifySession) { clearMediaSession(navigator.mediaSession, state); return; }
  const sessionKey = youtubeSession ? "youtube:" + youtubeSession.sessionId : spotifySession ? "spotify:" + spotifySession.uri : track.id;
  const artworkUrl = trackArtworkUrl(track);
  if ((state.mediaSessionTrackId !== sessionKey || state.mediaSessionArtworkUrl !== artworkUrl) && "MediaMetadata" in window) {
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: youtubeSession ? (youtubeSession.title || "Video de YouTube") : spotifySession ? (spotifySession.title || spotifySession.label) : (track.title || "Audio sin título"),
        artist: youtubeSession ? "YouTube" : spotifySession ? "Spotify · Reproductor oficial" : (track.artist || "Artista desconocido"),
        album: youtubeSession ? "Ritmo · YouTube" : spotifySession ? "Spotify Embed" : (track.album || "Ritmo"),
        artwork: artworkUrl && track?.artworkBlob
          ? [{ src: artworkUrl, type: track.artworkBlob.type }]
          : [{ src: new URL("./assets/icon.svg", location.href).href, sizes: "any", type: "image/svg+xml" }]
      });
      state.mediaSessionTrackId = sessionKey;
      state.mediaSessionArtworkUrl = artworkUrl;
    } catch {}
  }
  if (youtubeSession) {
    const playbackState = youtubeMediaPlaybackState === "playing" ? "playing" :
      youtubeMediaPlaybackState === "ended" ? "none" : "paused";
    try { navigator.mediaSession.playbackState = playbackState; } catch {}
  } else if (spotifySession) {
    const playbackState = spotifyMediaPlaybackState === "playing" ? "playing" :
      spotifyMediaPlaybackState === "ended" ? "none" : "paused";
    try { navigator.mediaSession.playbackState = playbackState; } catch {}
  } else {
    try { navigator.mediaSession.playbackState = playbackIsPaused() ? "paused" : "playing"; } catch {}
  }
  const duration = playbackDuration();
  const position = playbackCurrentTime();
  const requestedRate = Number(audio.playbackRate);
  const playbackRate = Number.isFinite(requestedRate) && requestedRate !== 0 ? requestedRate : 1;
  if (Number.isFinite(duration) && duration > 0 && Number.isFinite(position) && position >= 0 &&
      typeof navigator.mediaSession.setPositionState === "function") {
    try {
      navigator.mediaSession.setPositionState({
        duration,
        position: Math.max(0, Math.min(position, duration)),
        playbackRate
      });
    } catch {
      // Invalid/stale position data must never break playback or leave an old seek bar behind.
      clearMediaSessionPositionState(navigator.mediaSession);
    }
  } else {
    // A new track may not report its duration yet. Clear the previous track's OS seek bar
    // rather than showing stale progress while metadata and playback are transitioning.
    clearMediaSessionPositionState(navigator.mediaSession);
  }
}
function setupMediaSession() {
  if (!("mediaSession" in navigator)) return;
  const handlers = {
    play: () => resumeCurrentTrack(), pause: () => pauseCurrentTrack(), stop: () => pauseCurrentTrack(),
    previoustrack: () => { if (spotifyCurrentEmbed && spotifyControllerReady) { try { spotifyEmbedController?.restart(); } catch {} } else if (youtubeHistory.getCurrentSession()) seekPlayback(0); else $("#previous-button").click(); },
    nexttrack: () => { if (!spotifyCurrentEmbed && !youtubeHistory.getCurrentSession()) $("#next-button").click(); },
    seekbackward: details => { seekPlayback(Math.max(0, playbackCurrentTime() - (details.seekOffset || 10))); },
    seekforward: details => { const step = details.seekOffset || 10; seekPlayback(Number.isFinite(playbackDuration()) ? Math.min(playbackDuration(), playbackCurrentTime() + step) : playbackCurrentTime() + step); },
    seekto: details => { if (Number.isFinite(playbackDuration()) && Number.isFinite(details.seekTime)) seekPlayback(Math.max(0, Math.min(playbackDuration(), details.seekTime))); }
  };
  for (const [action, handler] of Object.entries(handlers)) { try { navigator.mediaSession.setActionHandler(action, handler); } catch {} }
}
function render() {
  releaseUnusedArtworkObjectUrls();
  const all = state.tracks.filter(track => !isRadioStationTrack(track));
  $("#library-count").textContent = String(all.length);
  $("#stat-total").innerHTML = all.length + ' <small>canciones</small>';
  $("#stat-favorites").innerHTML = all.filter(track => track.favorite).length + ' <small>guardadas</small>';
  $("#stat-offline").innerHTML = all.filter(isLocal).length + ' <small>archivos locales</small>';
  renderCards("#recent-tracks", all);
  $("#home-empty").hidden = all.length > 0;
  renderLibrarySection();
  renderTrackList("#favorite-tracks", sortedForView("favorites"), "#favorites-empty");
  renderTrackList("#offline-tracks", sortedForView("offline"), "#offline-empty");
  $("#home-empty").hidden = all.length > 0;
  renderHistory();
  renderPlaylists();
  renderQueue();
  renderFormatCapabilities();
  updatePlayer();
  updateConnection();
}
const CHARACTER_COMPANION_SETTING_KEY = "character-companion-image";
const DEFAULT_CHARACTER_COMPANION_SRC = "./assets/pibara-avatar.webp";
let customCharacterCompanionUrl = null;
let characterCompanionSource = DEFAULT_CHARACTER_COMPANION_SRC;

function setCharacterCompanionStatus(fileName, message) {
  const name = $("#character-companion-file-name");
  const status = $("#character-companion-status");
  if (name) name.textContent = fileName || "Personaje predeterminado de Ritmo";
  if (status) status.textContent = message || "";
}
function setCharacterCompanionSource(source) {
  characterCompanionSource = String(source || DEFAULT_CHARACTER_COMPANION_SRC);
  const companion = $("#character-companion");
  const image = $("#character-companion-image");
  const preview = $("#character-companion-preview");
  // Keep the upload available for Settings, but don't keep the mini-player's
  // animated decoder active while the companion is hidden.
  if (image) {
    if (companion && !companion.hidden) image.src = characterCompanionSource;
    else image.removeAttribute("src");
  }
  if (preview) preview.src = characterCompanionSource;
}
function useDefaultCharacterCompanion(message = "Se usa el personaje incluido con Ritmo.") {
  const oldUrl = customCharacterCompanionUrl;
  customCharacterCompanionUrl = null;
  setCharacterCompanionSource(DEFAULT_CHARACTER_COMPANION_SRC);
  setCharacterCompanionStatus("Personaje predeterminado de Ritmo", message);
  if (oldUrl) URL.revokeObjectURL(oldUrl);
}
function useCustomCharacterCompanion(blob, fileName, mimeType) {
  const nextUrl = URL.createObjectURL(blob);
  const oldUrl = customCharacterCompanionUrl;
  customCharacterCompanionUrl = nextUrl;
  setCharacterCompanionSource(nextUrl);
  const animated = ["image/gif", "image/webp", "image/apng"].includes(mimeType);
  setCharacterCompanionStatus(fileName, animated
    ? "Animación cargada. Se mostrará en miniatura mientras la música esté sonando."
    : "Imagen cargada. Ritmo aplicará movimiento ligero mientras suene la música.");
  if (oldUrl) URL.revokeObjectURL(oldUrl);
}
async function inspectCharacterCompanionImage(blob) {
  const probeUrl = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = probeUrl;
    if (typeof image.decode === "function") await image.decode();
    else await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error("No se pudo decodificar la imagen."));
    });
    return validateCompanionImageDimensions(image.naturalWidth, image.naturalHeight);
  } catch (error) {
    if (error instanceof RangeError || error instanceof TypeError) throw error;
    throw new Error("El archivo no es una imagen compatible o está dañado.");
  } finally {
    URL.revokeObjectURL(probeUrl);
  }
}
async function loadSavedCharacterCompanion() {
  try {
    const saved = await getAppSetting(CHARACTER_COMPANION_SETTING_KEY);
    if (!saved?.blob || !(saved.blob instanceof Blob)) {
      useDefaultCharacterCompanion();
      return;
    }
    const details = validateCompanionImage({
      name: saved.fileName || "personaje",
      type: saved.mimeType || saved.blob.type,
      size: saved.blob.size
    });
    await inspectCharacterCompanionImage(saved.blob);
    useCustomCharacterCompanion(saved.blob, details.fileName, details.mimeType);
  } catch (error) {
    useDefaultCharacterCompanion("No se pudo cargar tu imagen guardada; se usa el personaje incluido. Podés volver a elegirla.");
    console.warn("No se pudo restaurar el personaje acompañante.", error);
  }
}
async function chooseCharacterCompanion(file) {
  if (!file) return;
  const status = $("#character-companion-status");
  if (status) status.textContent = "Validando imagen…";
  try {
    const details = validateCompanionImage(file);
    await inspectCharacterCompanionImage(file);
    const blob = file.slice(0, file.size, details.mimeType);
    await saveAppSetting(CHARACTER_COMPANION_SETTING_KEY, {
      blob, fileName: details.fileName, mimeType: details.mimeType, savedAt: Date.now()
    });
    useCustomCharacterCompanion(blob, details.fileName, details.mimeType);
    toast("Tu personaje quedó guardado en este dispositivo.");
  } catch (error) {
    const message = error?.message || "No se pudo guardar esta imagen.";
    if (status) status.textContent = message;
    toast(message);
  }
}
async function resetCharacterCompanion() {
  try {
    await deleteAppSetting(CHARACTER_COMPANION_SETTING_KEY);
    useDefaultCharacterCompanion();
    toast("Se restauró el personaje de Ritmo.");
  } catch (error) {
    const message = error?.message || "No se pudo restaurar el personaje.";
    setCharacterCompanionStatus($("#character-companion-file-name")?.textContent, message);
    toast(message);
  }
}

function syncCharacterCompanion(playing) {
  const companion = $("#character-companion");
  if (!companion) return;
  const image = $("#character-companion-image");
  const isPlaying = Boolean(playing || (spotifyCurrentEmbed && spotifyControllerReady && spotifyMediaPlaybackState === "playing"));
  if (isPlaying) {
    if (image && image.getAttribute("src") !== characterCompanionSource) image.src = characterCompanionSource;
    companion.hidden = false;
  } else {
    companion.hidden = true;
    // Removing src stops decoding animated GIF/WebP/APNG frames while music
    // is paused; the object URL and saved IndexedDB blob remain available.
    if (image?.hasAttribute("src")) image.removeAttribute("src");
  }
  companion.classList.toggle("is-playing", isPlaying);
}
function updatePlayer() {
  const track = currentTrack();
  const youtubeSession = track ? null : youtubeHistory.getCurrentSession();
  const spotifySession = !track && !youtubeSession ? spotifyCurrentEmbed : null;
  const spotifyControlled = Boolean(spotifySession && spotifyControllerReady);
  const externalSession = Boolean(youtubeSession || spotifySession);
  const hasMedia = Boolean(track || youtubeSession || spotifyControlled);
  // Let UI sounds know about every playback engine. Native Media3 playback
  // has no active HTMLMediaElement, so DOM-only ducking misses it on Android.
  const uiSoundPlaybackSource = state.nativePlayback.active ? "native"
    : youtubeSession ? "youtube"
      : spotifyControlled ? "spotify"
        : track ? "local" : "none";
  const uiSoundIsPlaying = state.nativePlayback.active ? Boolean(state.nativePlayback.isPlaying)
    : youtubeSession ? youtubeMediaPlaybackState === "playing"
      : spotifyControlled ? spotifyMediaPlaybackState === "playing"
        : Boolean(track && !audio.paused && !audio.ended);
  window.dispatchEvent(new CustomEvent("ritmo:playback-context", {
    detail: { playing: uiSoundIsPlaying, source: uiSoundPlaybackSource }
  }));
  syncCharacterCompanion(hasMedia && !playbackIsPaused());
  $("#player-title").textContent = track ? track.title : youtubeSession ? youtubeSession.title : spotifySession ? (spotifySession.title || spotifySession.label) : "Todavía no suena nada";
  $("#player-artist").textContent = track ? (track.artist || sourceLabel(track)) : youtubeSession ? "YouTube · Video online" : spotifySession ? "Spotify · Reproductor oficial" : "Elegí una canción de tu biblioteca";
  $("#play-button").disabled = !hasMedia;
  $("#previous-button").disabled = externalSession || !state.tracks.length;
  $("#next-button").disabled = externalSession || !state.tracks.length;
  $("#seek-bar").disabled = !hasMedia || (spotifySession && spotifySession.type !== "episode");
  $("#player-favorite").disabled = !track;
  const playerArtwork = trackArtworkUrl(track);
  const playerCover = $("#player-cover");
  playerCover.className = "cover-thumb cover-placeholder " + (track ? coverClass(track) : "") + (playerArtwork ? " has-artwork" : "");
  playerCover.innerHTML = playerArtwork ? '<img class="album-artwork" data-artwork-track="' + escapeHTML(track.id) +
    '" src="' + escapeHTML(playerArtwork) + '" alt="" decoding="async">' : "<span>♫</span>";
  $("#player-favorite").textContent = track?.favorite ? "♥" : "♡";
  $("#player-favorite").classList.toggle("is-favorite", Boolean(track?.favorite));
  $("#player-favorite").setAttribute("aria-label", track?.favorite ? "Quitar de favoritos" : "Marcar favorito");
  $("#play-button").textContent = playbackIsPaused() ? "▶" : "Ⅱ";
  $("#play-button").setAttribute("aria-label", playbackIsPaused() ? "Reproducir" : "Pausar");
  $("#shuffle-button").classList.toggle("active", state.shuffle);
  $("#repeat-button").classList.toggle("active", state.repeat !== "off");
  $("#repeat-button").setAttribute("aria-label", "Repetición: " + ({ off: "desactivada", all: "toda la cola", one: "una canción" }[state.repeat]));
  $("#repeat-button").textContent = state.repeat === "one" ? "↻¹" : "↻";
  $("#shuffle-button").disabled = Boolean(spotifySession);
  $("#repeat-button").disabled = Boolean(spotifySession);
  const isOnline = track && !isLocal(track);
  $("#current-time").textContent = formatTime(playbackCurrentTime());
  $("#duration-time").textContent = formatTime(Number.isFinite(playbackDuration()) ? playbackDuration() : track?.duration);
  $("#seek-bar").value = Number.isFinite(playbackDuration()) && playbackDuration() > 0 ? String(Math.round(playbackCurrentTime() / playbackDuration() * 1000)) : "0";
  const expandedTitle = $("#expanded-title");
  if (expandedTitle) {
    $("#expanded-title").textContent = track ? track.title : youtubeSession ? youtubeSession.title : spotifySession ? (spotifySession.title || spotifySession.label) : "Todavía no suena nada";
    $("#expanded-artist").textContent = track ? (track.artist || sourceLabel(track)) : youtubeSession ? "YouTube · Video online" : spotifySession ? "Spotify · Reproductor oficial" : "Elegí una canción de tu biblioteca";
    $("#expanded-cover").className = "expanded-cover-art " + (track ? coverClass(track) : "tone-purple");
    $("#expanded-art-backdrop").className = "immersive-backdrop " + (track ? coverClass(track) : "tone-purple");
    $("#expanded-favorite-button").disabled = !track;
    $("#expanded-favorite-button").textContent = track?.favorite ? "♥" : "♡";
    $("#expanded-favorite-button").classList.toggle("is-favorite", Boolean(track?.favorite));
    $("#expanded-favorite-button").setAttribute("aria-label", track?.favorite ? "Quitar de favoritos" : "Agregar a favoritos");
    $("#expanded-play-button").disabled = !hasMedia;
    $("#expanded-play-button").textContent = playbackIsPaused() ? "▶" : "Ⅱ";
    $("#expanded-play-button").setAttribute("aria-label", playbackIsPaused() ? "Reproducir" : "Pausar");
    $("#expanded-previous-button").disabled = externalSession || !state.tracks.length;
    $("#expanded-next-button").disabled = externalSession || !state.tracks.length;
    $("#expanded-seek-bar").disabled = !hasMedia || (spotifySession && spotifySession.type !== "episode");
    $("#expanded-current-time").textContent = formatTime(playbackCurrentTime());
    $("#expanded-duration-time").textContent = formatTime(Number.isFinite(playbackDuration()) ? playbackDuration() : track?.duration);
    $("#expanded-seek-bar").value = Number.isFinite(playbackDuration()) && playbackDuration() > 0 ? String(Math.round(playbackCurrentTime() / playbackDuration() * 1000)) : "0";
    $("#expanded-volume-bar").value = $("#volume-bar").value;
    $("#expanded-shuffle-button").classList.toggle("active", state.shuffle);
    $("#expanded-repeat-button").classList.toggle("active", state.repeat !== "off");
    $("#expanded-repeat-button").textContent = state.repeat === "one" ? "↻¹" : "↻";
    $("#expanded-repeat-button").setAttribute("aria-label", "Repetición: " + ({ off: "desactivada", all: "toda la cola", one: "una canción" }[state.repeat]));
    $("#expanded-shuffle-button").disabled = Boolean(spotifySession);
    $("#expanded-repeat-button").disabled = Boolean(spotifySession);
    $("#expanded-source-label").textContent = track ? (isLocal(track) ? "Archivo local · disponible sin conexión" : "Fuente online · requiere conexión") : youtubeSession ? "YouTube · requiere conexión" : spotifySession ? "Spotify · widget oficial; volumen dentro del reproductor" : "Listo cuando vos quieras";
  }
  $("#volume-bar").disabled = Boolean(spotifySession);
  $("#expanded-volume-bar").disabled = Boolean(spotifySession);
  $("#volume-mute-button").disabled = Boolean(spotifySession);
  updateMuteButton();
}
function updatePlayerFavorite() {
  const track = currentTrack();
  $("#player-favorite").textContent = track?.favorite ? "♥" : "♡";
  $("#player-favorite").classList.toggle("is-favorite", Boolean(track?.favorite));
}
function networkModeIsAvailable() {
  return networkModeCanUseInternet(networkModeEnabledState, navigator.onLine);
}
function requireInternetMode(action = "esta función") {
  if (!networkModeEnabledState) {
    toast("🔒 Modo sin conexión: " + action + " está bloqueado. Activá Modo Internet para continuar.");
    return false;
  }
  if (!navigator.onLine) {
    toast("✕ No se detecta conexión de red. Conectá Wi-Fi o datos móviles para " + action + ".");
    return false;
  }
  return true;
}
function syncNetworkModeControls() {
  const toggle = $("#network-mode-toggle");
  const locked = !networkModeIsAvailable();
  if (toggle) {
    toggle.dataset.mode = networkModeEnabledState ? "online" : "offline";
    toggle.setAttribute("aria-pressed", String(networkModeEnabledState));
    toggle.setAttribute("aria-label", networkModeEnabledState ? "Modo Internet activo" : "Modo sin conexión activo");
    toggle.title = networkModeEnabledState ? "Modo Internet: las funciones online están permitidas" : "Modo sin conexión: las funciones online están bloqueadas";
  }
  const icon = $("#network-mode-icon");
  if (icon) icon.textContent = networkModeEnabledState ? "↗" : "🔒";
  const label = $("#network-mode-label");
  if (label) label.textContent = networkModeEnabledState ? "Internet" : "Sin conexión";
  document.body.classList.toggle("network-mode-offline", !networkModeEnabledState);
  document.body.classList.toggle("network-connectivity-offline", !navigator.onLine);

  const navLock = $("#online-nav-lock");
  if (navLock) navLock.hidden = !locked;
  const radioLock = $("#radio-nav-lock");
  if (radioLock) radioLock.hidden = !locked;
  const homeButton = $("#home-online-button");
  if (homeButton) {
    homeButton.classList.toggle("network-locked", locked);
    homeButton.title = locked ? "🔒 Activá Modo Internet y conectate para abrir estas funciones" : "Añadir una fuente online";
  }

  const onlineView = $("#online-view");
  const note = $("#network-locked-note");
  if (onlineView) onlineView.classList.toggle("network-locked", locked);
  if (musicFinderController) musicFinderController.syncNetworkState(locked);
  if (note) note.hidden = !locked;
  const title = $("#network-locked-title");
  if (title) title.textContent = !networkModeEnabledState ? "🔒 Modo sin conexión activo" : "✕ El dispositivo no tiene conexión";
  const description = $("#network-locked-description");
  if (description) description.textContent = !networkModeEnabledState
    ? "Buscadores, radios por internet, YouTube, Spotify y streams externos están bloqueados. Podés importar y escuchar archivos locales. Este modo no apaga el Wi-Fi ni los datos del teléfono."
    : "Ritmo no detecta conexión de red. Las búsquedas, radios y streams online quedan bloqueados hasta que vuelva internet; tu música local sigue disponible.";
  const enable = $("#network-enable-internet");
  if (enable) enable.hidden = networkModeEnabledState;

  if (onlineView) {
    onlineView.querySelectorAll("a[href]").forEach(link => {
      link.setAttribute("aria-disabled", String(locked));
      if (locked) link.setAttribute("tabindex", "-1");
      else link.removeAttribute("tabindex");
    });
  }
}
function setNetworkModeEnabled(enabled) {
  const next = Boolean(enabled);
  if (next === networkModeEnabledState) { syncNetworkModeControls(); return; }
  const persisted = persistNetworkModeEnabled(next);
  networkModeEnabledState = next;
  if (!next) {
    musicFinderController?.cancelCapture("La identificación se canceló porque activaste el modo sin conexión.");
    youtubeSearchAbortController?.abort();
    youtubeSearchAbortController = null;
    youtubeSearchRequestId++;
    radioSearchAbortController?.abort();
    radioSearchAbortController = null;
    radioSearchRequestId++;
    archiveSearchRequestId++;
    stopYoutubePlayback();
    stopSpotifyEmbed({ preserveSaved: true, refresh: false });
    state.youtubeResults = [];
    state.youtubeNextPageToken = null;
    state.youtubeQuery = "";
    state.archiveResults = [];
    state.archiveFileCache.clear();
    $("#youtube-results")?.replaceChildren();
    $("#youtube-load-more").hidden = true;
    $("#archive-results")?.replaceChildren();
    $("#archive-load-more").hidden = true;
    $("#radio-results")?.replaceChildren();
    radioStations = [];
    const activeTrack = currentTrack();
    if (activeTrack && !isLocal(activeTrack)) void removeCurrent();
  } else if (navigator.onLine) {
    let savedSpotifyLink = "";
    try { savedSpotifyLink = localStorage.getItem(SPOTIFY_EMBED_STORAGE) || ""; } catch {}
    if (savedSpotifyLink && !spotifyCurrentEmbed) void loadSpotifyEmbed(savedSpotifyLink, { persist: false });
  }
  syncYoutubeModeControls();
  syncNetworkModeControls();
  updateYoutubeNetworkStatus();
  if (!persisted) toast(next ? "Modo Internet activo durante esta sesión; no se pudo guardar la preferencia." : "Modo sin conexión activo durante esta sesión; no se pudo guardar la preferencia.");
  else toast(next ? "Modo Internet activado. Las funciones online vuelven a estar disponibles si hay conexión." : "Modo sin conexión activado. Se detuvo el audio online y se bloquearon sus controles.");
}
function updateConnection() {
  const online = navigator.onLine;
  $("#connection-label").textContent = online ? "Conectado" : "Sin conexión";
  $("#connection-dot").classList.toggle("offline", !online);
  syncYoutubeModeControls();
  syncNetworkModeControls();
}
let youtubePlayer = null;
let youtubePlayerApiPromise = null;
let youtubeMediaPlaybackState = "none";
let youtubeProgressTimer = null;

function startYoutubeProgressUpdates() {
  if (youtubeProgressTimer !== null) return;
  youtubeProgressTimer = setInterval(() => {
    if (!youtubeHistory.getCurrentSession() || youtubeMediaPlaybackState !== "playing") {
      clearInterval(youtubeProgressTimer);
      youtubeProgressTimer = null;
      return;
    }
    updatePlayer();
    updateMediaSession();
  }, 1000);
}

function recordConfirmedYoutubePlayback(event) {
  if (!window.YT || !event || !youtubeHistory.getCurrentSession()) return;
  const player = event.target;
  const actualVideoId = player?.getVideoData?.()?.video_id || "";
  const selected = youtubeHistory.getCurrentSession();
  if (actualVideoId && selected.videoId !== actualVideoId) return;
  const eventState = event.data;
  if (eventState === window.YT.PlayerState.PLAYING) {
    if (typeof player?.getPlayerState === "function" && player.getPlayerState() !== window.YT.PlayerState.PLAYING) return;
    youtubeMediaPlaybackState = "playing";
    youtubeHistory.recordPlaying(actualVideoId);
    startYoutubeProgressUpdates();
  } else if (eventState === window.YT.PlayerState.PAUSED) {
    youtubeMediaPlaybackState = "paused";
  } else if (eventState === window.YT.PlayerState.ENDED) {
    youtubeMediaPlaybackState = "ended";
  } else if (eventState === window.YT.PlayerState.BUFFERING) {
    youtubeMediaPlaybackState = "buffering";
  } else if (eventState === window.YT.PlayerState.CUED) {
    youtubeMediaPlaybackState = "paused";
  } else {
    return;
  }
  updatePlayer();
  updateMediaSession();
}

function attachYoutubePlayer(frame) {
  if (youtubePlayer || !window.YT?.Player || !frame) return;
  try {
    youtubePlayer = new window.YT.Player(frame, {
      events: {
        onReady: event => {
          const iframe = event.target.getIframe();
          iframe.title = "Reproductor oficial de YouTube";
          iframe.referrerPolicy = "strict-origin-when-cross-origin";
          iframe.setAttribute("allow", "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share");
          iframe.setAttribute("allowfullscreen", "");
          if (event.target.getPlayerState() === window.YT.PlayerState.PLAYING) {
            recordConfirmedYoutubePlayback({ target: event.target, data: window.YT.PlayerState.PLAYING });
          }
        },
        onStateChange: recordConfirmedYoutubePlayback,
        onError: event => {
          const session = youtubeHistory.getCurrentSession();
          if (!session) return;
          let failedVideoId = "";
          try { failedVideoId = event.target?.getVideoData?.()?.video_id || ""; } catch {}
          if (failedVideoId && failedVideoId !== session.videoId) return;
          setYoutubeStatus(readableYoutubePlayerError(event.data), "error");
        },
        onAutoplayBlocked: () => {
          if (!youtubeHistory.getCurrentSession()) return;
          setYoutubeStatus("El navegador bloqueó el inicio automático. Probá el control Reproducir del reproductor o usá «Abrir en YouTube»; este bloqueo depende de la política del navegador.", "info");
        }
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
  youtubeMediaPlaybackState = "none";
  if (youtubeProgressTimer !== null) clearInterval(youtubeProgressTimer);
  youtubeProgressTimer = null;
  if ("mediaSession" in navigator) clearMediaSession(navigator.mediaSession, state);
  const frame = $("#youtube-iframe");
  if (youtubePlayer) {
    try { youtubePlayer.stopVideo(); } catch {}
    youtubePlayer = null;
  }
  // stopVideo() pauses playback but leaves the YouTube document and network
  // resources alive. Unload the iframe every time we leave this mode.
  if (frame) frame.src = "about:blank";
  const wrap = $("#youtube-player-wrap");
  if (wrap) wrap.hidden = true;
}
function setMobileMenuOpen(open) {
  const sidebar = $("#sidebar");
  if (!sidebar) return;
  const isOpen = Boolean(open);
  sidebar.classList.toggle("open", isOpen);
  const scrim = $("#sidebar-scrim");
  if (scrim) scrim.hidden = !isOpen;
  const more = $("#mobile-more-toggle");
  if (more) more.setAttribute("aria-expanded", String(isOpen));
  const toggle = $("#menu-toggle");
  if (toggle) toggle.setAttribute("aria-expanded", String(isOpen));
}
function clearConverterOutputUrls() {
  for (const preview of converterPreviewElements) {
    try {
      preview.pause();
      preview.removeAttribute("src");
      preview.load();
    } catch {}
  }
  converterPreviewElements.clear();
  activeConverterPreview = null;
  for (const url of converterOutputUrls) URL.revokeObjectURL(url);
  converterOutputUrls = [];
  converterOutputBytes = 0;
  converterOutputFilenames = new Set();
}
function renderConverterSelection(preserveStatus = false) {
  const list = $("#converter-file-list");
  const summary = $("#converter-selection-summary");
  const start = $("#converter-start");
  if (!list || !summary || !start) return;
  list.replaceChildren();
  const totalBytes = converterFiles.reduce((sum, file) => sum + (Number(file.size) || 0), 0);
  const invalid = converterFiles.some(file => !file.size || file.size > MAX_CONVERTER_INPUT_BYTES) ||
    converterFiles.length > MAX_CONVERTER_FILES || totalBytes > MAX_CONVERTER_TOTAL_INPUT_BYTES;
  summary.textContent = converterFiles.length
    ? converterFiles.length + (converterFiles.length === 1 ? " archivo · " : " archivos · ") + formatBytes(totalBytes)
    : "Todavía no elegiste archivos.";
  if (!converterFiles.length) {
    const empty = document.createElement("li");
    empty.className = "converter-empty";
    empty.textContent = "Los archivos seleccionados aparecerán aquí.";
    list.append(empty);
  } else {
    for (const file of converterFiles) {
      const item = document.createElement("li");
      const copy = document.createElement("span");
      copy.className = "converter-file-copy";
      const name = document.createElement("strong");
      name.textContent = file.name || "Audio sin nombre";
      const detail = document.createElement("small");
      detail.textContent = !file.size ? "Archivo vacío" : file.size > MAX_CONVERTER_INPUT_BYTES
        ? "Supera el límite de 50 MiB" : formatBytes(file.size);
      copy.append(name, detail);
      const size = document.createElement("span");
      size.className = "converter-file-size";
      size.textContent = file.size ? formatBytes(file.size) : "0 B";
      item.append(copy, size);
      list.append(item);
    }
  }
  if (!converterRunning) {
    start.disabled = !converterFiles.length || invalid;
    if (preserveStatus) return;
    if (converterFiles.length > MAX_CONVERTER_FILES) $("#converter-status").textContent = "Elegí como máximo cinco archivos por tanda.";
    else if (totalBytes > MAX_CONVERTER_TOTAL_INPUT_BYTES) $("#converter-status").textContent = "La tanda supera los 100 MiB permitidos.";
    else if (converterFiles.some(file => !file.size || file.size > MAX_CONVERTER_INPUT_BYTES)) $("#converter-status").textContent = "Quitá los archivos vacíos o mayores de 50 MiB.";
    else if (!converterFiles.length) $("#converter-status").textContent = "Esperando archivos.";
    else $("#converter-status").textContent = "Listo para convertir " + converterFiles.length + (converterFiles.length === 1 ? " archivo." : " archivos.");
  }
}
async function addConvertedWavToLibrary(blob, filename, button, description, detail, sourceFile = null) {
  if (button.dataset.librarySaved === "true") return;
  if (converterLibraryImportInProgress) {
    description.textContent = detail + " · Esperá a que termine el guardado de otro WAV.";
    return;
  }
  converterLibraryImportInProgress = true;
  button.disabled = true;
  button.textContent = "Guardando…";
  try {
    if (!(blob instanceof Blob) || !blob.size) {
      throw new Error("El WAV convertido ya no está disponible. Repetí la conversión.");
    }
    if (typeof File !== "function") {
      throw new Error("Este navegador no permite guardar el resultado directamente. Descargá el WAV e importalo desde la biblioteca.");
    }
    const outputFile = new File([blob], filename, { type: "audio/wav", lastModified: Date.now() });
    let sourceMetadata = null;
    if (sourceFile) {
      try { sourceMetadata = await readAudioMetadata(sourceFile); } catch {}
    }
    const metadataOverridesByFile = sourceMetadata ? new Map([[outputFile, sourceMetadata]]) : undefined;
    const result = await importFiles([outputFile], { navigateToLibrary: false, metadataOverridesByFile });
    if (result?.saved > 0) {
      button.textContent = "Agregado a biblioteca";
      button.dataset.librarySaved = "true";
      return;
    }
    if ((result?.skippedByContent || 0) + (result?.skippedByIdentity || 0) > 0) {
      button.textContent = "Ya estaba en biblioteca";
      button.dataset.librarySaved = "true";
      return;
    }
    throw result?.failure || new Error("No se pudo confirmar que el WAV se haya guardado en la biblioteca.");
  } catch (error) {
    const message = error?.message || "No se pudo guardar el WAV en la biblioteca.";
    description.textContent = detail + " · " + message;
    button.textContent = "Reintentar";
    button.disabled = false;
  } finally {
    converterLibraryImportInProgress = false;
  }
}

function appendConverterResult(fileName, detail, blob = null, tone = "success", sourceFile = null) {
  const list = $("#converter-results");
  const item = document.createElement("li");
  item.className = "converter-result";
  if (tone === "error") item.dataset.tone = "error";
  const copy = document.createElement("span");
  copy.className = "converter-result-copy";
  const title = document.createElement("strong");
  title.textContent = fileName;
  const description = document.createElement("small");
  description.textContent = detail;
  copy.append(title, description);
  item.append(copy);
  if (blob) {
    const url = URL.createObjectURL(blob);
    converterOutputUrls.push(url);
    const link = document.createElement("a");
    link.href = url;
    link.download = claimUniqueWavFilename(fileName, converterOutputFilenames);
    link.textContent = "Descargar WAV";
    link.setAttribute("aria-label", "Descargar WAV convertido de " + fileName);
    item.append(link);

    const libraryButton = document.createElement("button");
    libraryButton.type = "button";
    libraryButton.className = "button button-soft converter-library-save";
    libraryButton.textContent = "Agregar a biblioteca";
    libraryButton.setAttribute("aria-label", "Agregar " + link.download + " a la biblioteca");
    libraryButton.addEventListener("click", () => {
      void addConvertedWavToLibrary(blob, link.download, libraryButton, description, detail, sourceFile);
    });
    item.append(libraryButton);

    // Preview the exact verified Blob using native browser controls. The player
    // stays hidden and does not preload audio until the user explicitly opens it.
    const previewToggle = document.createElement("button");
    previewToggle.type = "button";
    previewToggle.className = "button button-soft converter-preview-toggle";
    previewToggle.textContent = "Escuchar";
    previewToggle.setAttribute("aria-label", "Reproducir una vista previa de " + fileName);
    previewToggle.setAttribute("aria-expanded", "false");

    const preview = document.createElement("audio");
    preview.controls = true;
    preview.preload = "none";
    preview.hidden = true;
    preview.src = url;
    preview.setAttribute("aria-label", "Vista previa del WAV convertido de " + fileName);
    converterPreviewElements.add(preview);

    preview.addEventListener("play", () => {
      if (activeConverterPreview && activeConverterPreview !== preview) activeConverterPreview.pause();
      activeConverterPreview = preview;
    });
    preview.addEventListener("pause", () => {
      if (activeConverterPreview === preview) activeConverterPreview = null;
    });
    preview.addEventListener("ended", () => {
      if (activeConverterPreview === preview) activeConverterPreview = null;
    });
    preview.addEventListener("error", () => {
      description.textContent = detail + " · El navegador no pudo reproducir la vista previa; podés descargar el WAV para probarlo con otro reproductor.";
    });
    previewToggle.addEventListener("click", () => {
      if (preview.hidden) {
        preview.hidden = false;
        previewToggle.textContent = "Ocultar";
        previewToggle.setAttribute("aria-expanded", "true");
        // This click is a real user gesture, so request playback here instead
        // of making "Escuchar" only reveal a second Play button.
        const playback = preview.play();
        if (playback && typeof playback.catch === "function") {
          playback.catch(error => {
            const message = error?.name === "NotAllowedError"
              ? "El navegador bloqueó el inicio de la vista previa; usá ▶ en los controles del reproductor."
              : "No se pudo iniciar la vista previa en este navegador; todavía podés descargar el WAV.";
            description.textContent = detail + " · " + message;
          });
        }
      } else {
        preview.pause();
        preview.currentTime = 0;
        preview.hidden = true;
        previewToggle.textContent = "Escuchar";
        previewToggle.setAttribute("aria-expanded", "false");
      }
    });
    item.append(previewToggle, preview);
  }
  list.append(item);
}
function clearConverterWorkspace() {
  if (converterRunning) return;
  clearConverterOutputUrls();
  converterFiles = [];
  $("#converter-files").value = "";
  $("#converter-results").replaceChildren();
  $("#converter-progress").value = 0;
  $("#converter-progress-label").textContent = "0%";
  renderConverterSelection();
}
async function runAudioConversion() {
  if (converterRunning || !converterFiles.length) return;
  const files = [...converterFiles];
  const totalInputBytes = files.reduce((sum, file) => sum + (Number(file.size) || 0), 0);
  if (files.length > MAX_CONVERTER_FILES || totalInputBytes > MAX_CONVERTER_TOTAL_INPUT_BYTES ||
      files.some(file => !file.size || file.size > MAX_CONVERTER_INPUT_BYTES)) {
    renderConverterSelection();
    return;
  }
  // Starting another batch revokes the prior result URLs. Confirm first so
  // users don't accidentally lose converted WAVs they haven't downloaded yet.
  if (converterOutputUrls.length && !window.confirm(
    "Iniciar otra tanda quitará del conversor los WAV de la tanda anterior y sus vistas previas. Descargá los archivos que quieras conservar. ¿Continuar?"
  )) return;
  clearConverterOutputUrls();
  $("#converter-results").replaceChildren();
  converterRunning = true;
  converterCancelRequested = false;
  converterAbortController = new AbortController();
  $("#converter-start").disabled = true;
  $("#converter-cancel").disabled = false;
  $("#converter-clear").disabled = true;
  $("#converter-files").disabled = true;
  const requestedRate = Number($("#converter-sample-rate").value) === 48000 ? 48000 : 44100;
  const channels = Number($("#converter-channels").value) === 1 ? 1 : 2;
  let converted = 0, failed = 0;
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error("Este navegador no ofrece Web Audio para decodificar archivos.");
    try { converterAudioContext = new AudioContextClass({ sampleRate: requestedRate }); }
    catch { converterAudioContext = new AudioContextClass(); }
    const actualRate = Number(converterAudioContext.sampleRate) || requestedRate;
    if (actualRate !== requestedRate) {
      $("#converter-status").textContent = "El dispositivo usa " + Math.round(actualRate / 1000 * 10) / 10 + " kHz; se usará esa frecuencia real.";
    }
    for (let index = 0; index < files.length; index++) {
      if (converterCancelRequested) break;
      const file = files[index];
      $("#converter-status").textContent = "Convirtiendo " + (index + 1) + " de " + files.length + ": " + file.name;
      try {
        const result = await convertAudioFileToWav(file, converterAudioContext, { channels, maxOutputBytes: MAX_CONVERTER_OUTPUT_BYTES - converterOutputBytes, signal: converterAbortController?.signal });
        if (converterCancelRequested) break;
        if (converterOutputBytes + result.blob.size > MAX_CONVERTER_OUTPUT_BYTES) {
          throw new Error("La tanda superaría el límite de 120 MiB de resultados. Descargá los WAV actuales y empezá otra tanda.");
        }
        converterOutputBytes += result.blob.size;
        const rate = Math.round(result.sampleRate / 1000 * 10) / 10;
        appendConverterResult(file.name, formatBytes(result.blob.size) + " · " + formatTime(result.duration) +
          " · " + rate + " kHz · " + result.channels + (result.channels === 1 ? " canal" : " canales"), result.blob, "success", file);
        converted++;
      } catch (error) {
        if (converterCancelRequested && error?.name === "AbortError") break;
        failed++;
        appendConverterResult(file.name, error?.message || "No se pudo convertir este archivo.", null, "error");
      }
      $("#converter-progress").value = Math.round(((index + 1) / files.length) * 100);
      $("#converter-progress-label").textContent = $("#converter-progress").value + "%";
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    if (converterCancelRequested) $("#converter-status").textContent = "Tanda cancelada. " + converted + " archivo(s) convertido(s); los resultados ya preparados siguen disponibles.";
    else $("#converter-status").textContent = "Terminado: " + converted + " convertido(s), " + failed + " con error.";
    if (!converterCancelRequested) {
      $("#converter-progress").value = 100;
      $("#converter-progress-label").textContent = "100%";
    }
  } catch (error) {
    $("#converter-status").textContent = error?.message || "No se pudo iniciar el conversor.";
  } finally {
    try { await converterAudioContext?.close(); } catch {}
    converterAudioContext = null;
    converterAbortController = null;
    converterRunning = false;
    $("#converter-start").disabled = !converterFiles.length;
    $("#converter-cancel").disabled = true;
    $("#converter-clear").disabled = false;
    $("#converter-files").disabled = false;
    renderConverterSelection(true);
  }
}
function bindAudioConverterEvents() {
  $("#converter-files").addEventListener("change", event => {
    converterFiles = Array.from(event.currentTarget.files || []);
    renderConverterSelection();
  });
  $("#converter-start").addEventListener("click", runAudioConversion);
  $("#converter-cancel").addEventListener("click", () => {
    if (!converterRunning) return;
    converterCancelRequested = true;
    converterAbortController?.abort();
    $("#converter-cancel").disabled = true;
    $("#converter-status").textContent = "Cancelación solicitada. Si se están leyendo metadatos, se detendrá ahora; una decodificación ya iniciada no se puede interrumpir y su resultado se descartará al terminar.";
  });
  $("#converter-clear").addEventListener("click", clearConverterWorkspace);
  window.addEventListener("pagehide", clearConverterOutputUrls);
  renderConverterSelection();
}

function showView(view) {
  if (!viewNames[view]) return;
  if (view !== "online") stopYoutubePlayback();
  state.view = view;
  document.querySelectorAll(".view-panel").forEach(node => { node.hidden = node.id !== view + "-view"; });
  document.querySelectorAll(".nav-item").forEach(node => node.classList.toggle("active", node.dataset.view === view));
  $("#page-crumb").textContent = viewNames[view];
  setMobileMenuOpen(false);
  if (view === "library") $("#library-search").focus({ preventScroll: true });
}
async function playTrack(trackId, autoplay = true, options = {}) {
  const track = getTrack(trackId);
  if (!track) return;
  if (!isLocal(track) && !requireInternetMode("reproducir esta fuente online")) return;
  stopSpotifyEmbed({ preserveSaved: true, refresh: false });
  const requestId = ++playbackRequestId;
  cancelPendingPlaybackPositionRestore();
  pendingPlaybackRequestId = autoplay ? requestId : null;
  const isCurrentPlaybackRequest = () => requestId === playbackRequestId;
  // Invalidate pending state reads as soon as a newer play request arrives.
  if (state.nativePlayback.active) invalidateNativePlaybackPolling();
  if (!options.forceWebPlayback) nativeUrlFallbackInProgressFor = null;
  const isNativeDirectStream = track.kind === "url" && typeof track.url === "string" &&
    /^https:\/\//i.test(track.url) && !/\.m3u8(?:[?#]|$)/i.test(track.url);
  let useNativePlayer = Boolean(!options.forceWebPlayback &&
    (track.nativeUri || track.nativePath || isNativeDirectStream) && nativePlaybackPlugin());
  if (track.nativeUri && !useNativePlayer) {
    const plugin = nativeMusicPlugin();
    if (!plugin?.resolveAudioPath) {
      pendingPlaybackRequestId = null;
      showPlaybackStatus("No está disponible el acceso nativo a esta canción. Volvé a buscar la música del teléfono.", "error", false);
      return;
    }
    try {
      const resolved = await plugin.resolveAudioPath({ uri: track.nativeUri, name: track.name });
      if (!isCurrentPlaybackRequest()) return;
      track.nativePath = String(resolved?.path || "");
      if (!track.nativePath) throw new Error("Android no devolvió una ruta reproducible para esta canción.");
      await saveTrack(track);
    } catch (error) {
      if (!isCurrentPlaybackRequest()) return;
      pendingPlaybackRequestId = null;
      const message = error?.message || "No pude abrir este archivo desde el almacenamiento del teléfono.";
      showPlaybackStatus(message, "error", false);
      toast(message);
      updatePlayer();
      return;
    }
  }
  if (!useNativePlayer && state.nativePlayback.active) {
    await stopNativePlayback();
    if (!isCurrentPlaybackRequest()) return;
  }
  if (!$("#youtube-player-wrap").hidden) stopYoutubePlayback();
  if (Array.isArray(options.queueIds)) state.queueIds = options.queueIds.filter(id => Boolean(getTrack(id)));
  else if (!options.keepQueue) state.queueIds = null;
  state.currentId = track.id;
  notifySoundTrackContext(track);
  backfillTrackGenre(track);
  backfillNativeTrackArtwork(track);
  try {
    if (useNativePlayer) {
      // Pass MediaStore/SAF URI directly to Media3 instead of copying audio into app cache.
      for (const engine of [defaultAudio, equalizedAudio]) {
        engine.pause();
        engine.removeAttribute("src");
        engine.load();
      }
      audio = defaultAudio;
      releaseUnusedObjectURLs(null);
      state.nativePlayback = {
        active: true, isPlaying: false, currentTime: Math.max(0, Number(options.resumeAt) || 0),
        duration: Math.max(0, Number(track.duration) || 0), playbackState: "buffering",
        trackId: track.id, endedHandled: false
      };
      try {
        const nativePlayer = nativePlaybackPlugin();
        const nativeUri = track.nativeUri || (track.kind === "url" ? track.url : "");
        await nativePlayer.play({
          uri: nativeUri || "", path: nativeUri ? "" : track.nativePath, title: track.title || track.name || "Audio sin título",
          artist: track.artist || "Artista desconocido", album: track.album || "Ritmo",
          autoplay: Boolean(autoplay),
          positionMs: Math.max(0, Math.round((Number(options.resumeAt) || 0) * 1000)),
          volume: Math.max(0, Math.min(1, Number($("#volume-bar").value) || 0)),
          ...nativeEqualizerPayload()
        });
        if (!isCurrentPlaybackRequest()) return;
        startNativePlaybackPolling();
        const nativeState = await nativePlayer.getState();
        if (!isCurrentPlaybackRequest()) return;
        acceptNativePlaybackState(nativeState);
        // acceptNativePlaybackState can switch tracks or begin a web fallback.
        // Never let this stale play request clear the newer request's intent.
        if (!isCurrentPlaybackRequest()) return;
      } catch (nativeError) {
        await stopNativePlayback();
        if (!isCurrentPlaybackRequest()) return;
        // Fall back to Web Audio if Media3 cannot open this URI/path. Picker imports
        // that needed a temporary-URI copy retain their IndexedDB Blob as a durable fallback.
        if (track.nativeUri) {
          const libraryPlugin = nativeMusicPlugin();
          if (!libraryPlugin?.resolveAudioPath) {
            if (!(track.blob instanceof Blob)) throw nativeError;
            track.nativePath = "";
          } else {
            toast("El reproductor nativo no abrió este archivo; probando la reproducción compatible.");
            try {
              const resolved = await libraryPlugin.resolveAudioPath({ uri: track.nativeUri, name: track.name, forceRefresh: true });
              if (!isCurrentPlaybackRequest()) return;
              track.nativePath = String(resolved?.path || "");
              if (!track.nativePath) throw nativeError;
              await saveTrack(track);
            } catch (pathError) {
              if (!(track.blob instanceof Blob)) throw pathError;
              track.nativePath = "";
              await saveTrack(track).catch(() => {});
            }
          }
        } else if (track.kind === "url" && track.url) {
          toast("Android no abrió esta fuente directa; probando el reproductor del navegador.");
        } else if (track.blob instanceof Blob) {
          // A cached file may have been evicted or its permissions may have changed.
          track.nativePath = "";
          await saveTrack(track).catch(() => {});
        } else {
          throw nativeError;
        }
        useNativePlayer = false;
      }
    }
    if (!useNativePlayer) {
      if (state.nativePlayback.active) {
        await stopNativePlayback();
        if (!isCurrentPlaybackRequest()) return;
      }
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
        if (targetEngine.readyState >= 1) {
          if (isCurrentPlaybackRequest() && targetEngine === audio) {
            setPlaybackPosition(targetEngine, options.resumeAt);
          }
        } else {
          let cancelRestore;
          cancelRestore = schedulePlaybackPositionRestore(targetEngine, options.resumeAt, {
            isCurrentRequest: isCurrentPlaybackRequest,
            isActiveElement: element => element === audio,
            onSettled: () => {
              if (pendingPlaybackPositionCancel === cancelRestore) pendingPlaybackPositionCancel = null;
            }
          });
          pendingPlaybackPositionCancel = cancelRestore;
        }
      }
      if (autoplay) await audio.play();
      if (!isCurrentPlaybackRequest()) return;

    }
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
    if (useNativePlayer) void stopNativePlayback();
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
  const candidates = ids.map(trackId => getTrack(trackId)).filter(track => Boolean(track) && (isLocal(track) || networkModeIsAvailable()));
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
async function readAudioMetadata(file, filename = file?.name || "") {
  const metadataName = String(filename || file?.name || "audio");
  const fallback = metadataForFile({ name: metadataName });
  const isMp3 = /\.mp3$/i.test(metadataName);
  const isVorbis = isVorbisMetadataFilename(metadataName);
  const isWav = isWavMetadataFilename(metadataName);
  if (!file || file.size < (isWav ? 12 : 10) || (!isMp3 && !isVorbis && !isWav)) return fallback;
  if (isWav) return readWavInfoMetadata(file, fallback);
  try {
    // Read only a bounded prefix; never decode or rewrite the original audio.
    const scanLimit = isMp3 ? 2 * 1024 * 1024 : MAX_VORBIS_METADATA_BYTES;
    const bytes = new Uint8Array(await file.slice(0, Math.min(file.size, scanLimit)).arrayBuffer());
    if (isMp3) return parseId3Tags(bytes, fallback);
    return /\.flac$/i.test(metadataName)
      ? parseFlacVorbisComments(bytes, fallback)
      : parseOggVorbisComments(bytes, fallback);
  } catch {
    return fallback;
  }
}
async function downloadStreamOffline(trackId) {
  if (!requireInternetMode("descargar una fuente online")) return;
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
      artist: source.artist || "Fuente online", album: source.album || "", genre: source.genre || source.radioTags || "", blob, size: blob.size,
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

async function openAudioImport() {
  const plugin = nativeMusicPlugin();
  if (!plugin?.pickAudioFiles || !plugin?.resolveAudioPath) {
    if (isNativeAndroidShell()) {
      const message = "No se pudo conectar con el selector nativo de Ritmo. Cerrá y volvé a abrir la APK actualizada; no se abrió el selector web.";
      toast(message);
      showPlaybackStatus(message, "error", false);
      return;
    }
    filePicker.click();
    return;
  }
  try {
    const result = await plugin.pickAudioFiles();
    const selected = Array.isArray(result?.files) ? result.files : [];
    if (!selected.length) return;
    const knownNativeUris = new Set(state.tracks.filter(track => track.nativeUri).map(track => track.nativeUri));
    const nativeTracks = [];
    const fallbackFiles = [];
    const fallbackNativePaths = new Map();
    const fallbackDedupeKeys = new Map();
    for (const item of selected) {
      if (!item?.uri || !item?.name) continue;
      const uri = String(item.uri);
      if (item.persisted === true) {
        if (knownNativeUris.has(uri)) continue;
        knownNativeUris.add(uri);
        const name = String(item.name);
        nativeTracks.push({
          id: "android-picked-audio-" + id(),
          kind: "file",
          name,
          sourcePath: uri,
          nativeUri: uri,
          nativePath: "",
          title: String(item.title || titleFromFilename(name)),
          artist: String(item.artist || "Artista desconocido"),
          album: String(item.album || ""),
          size: Math.max(0, Number(item.size) || 0),
          mimeType: String(item.mimeType || "application/octet-stream"),
          lastModified: Number(item.lastModified) || Date.now(),
          favorite: false,
          addedAt: Date.now() + nativeTracks.length,
          duration: Math.max(0, Number(item.duration) || 0) / 1000,
          lastPlayedAt: 0
        });
        continue;
      }
      // Some document providers grant temporary access only; copy the audio now.
      const resolved = item.path ? { path: item.path } : await plugin.resolveAudioPath({ uri, name: item.name });
      const localURL = window.Capacitor.convertFileSrc(resolved.path);
      const response = await fetch(localURL);
      if (!response.ok) throw new Error("Android no pudo leer " + item.name + ".");
      const blob = await response.blob();
      if (!blob.size) throw new Error("El archivo está vacío o el proveedor no permitió leer " + item.name + ".");
      const importedFile = new File([blob], item.name, {
        type: item.mimeType || blob.type || "application/octet-stream",
        lastModified: Number(item.lastModified) || Date.now()
      });
      fallbackFiles.push(importedFile);
      // Stable URI identity keeps different provider folders distinct even when
      // filenames, file sizes and modification timestamps happen to match.
      fallbackDedupeKeys.set(importedFile, uri);
      // Keep the resolved native route for Media3 notification/lock-screen support,
      // while persisting the Blob as an offline fallback if Android clears its cache.
      if (resolved?.path) fallbackNativePaths.set(importedFile, String(resolved.path));
    }
    if (nativeTracks.length) {
      for (let offset = 0; offset < nativeTracks.length; offset += 100) {
        await saveManyTracks(nativeTracks.slice(offset, offset + 100));
      }
      state.tracks = await getAllTracks();
      render();
      toast(nativeTracks.length + " archivo(s) agregado(s) con reproducción nativa y controles del sistema.");
    }
    if (fallbackFiles.length) await importFiles(fallbackFiles, {
      nativePathsByFile: fallbackNativePaths,
      dedupeKeysByFile: fallbackDedupeKeys
    });
    if (!nativeTracks.length && !fallbackFiles.length) {
      toast("Los archivos seleccionados ya están en tu biblioteca o el proveedor no devolvió un acceso reutilizable.");
    }
  } catch (error) {
    const message = error?.message || "No se pudieron abrir los archivos seleccionados.";
    toast(message);
    showPlaybackStatus(message, "warning", false);
  }
}

async function scanDeviceMusic() {
  const plugin = nativeMusicPlugin();
  if (!plugin?.requestAudioPermission || !plugin?.listAudio) {
    const message = isNativeAndroidShell()
      ? "Ritmo detectó Android, pero no pudo iniciar el puente nativo de música. Actualizá la APK y volvé a abrirla."
      : "La búsqueda automática de música requiere la APK Android. En la web podés elegir archivos manualmente.";
    toast(message);
    showPlaybackStatus(message, "error", false);
    if (!isNativeAndroidShell()) await openAudioImport();
    return;
  }
  const buttons = [...document.querySelectorAll("[data-scan-device-music]")];
  buttons.forEach(button => { button.disabled = true; button.textContent = "Buscando música…"; });
  try {
    toast("Android te pedirá permiso para buscar canciones en este dispositivo.");
    const permission = await plugin.requestAudioPermission();
    if (!permission?.granted) {
      toast("Sin permiso de audio no se puede buscar la biblioteca del teléfono. Podés elegir archivos desde carpetas.");
      return;
    }
    const result = await plugin.listAudio({ query: "" });
    const files = Array.isArray(result?.files) ? result.files : [];
    if (!files.length) {
      toast("No encontré audio indexado. Probá «Importar archivos» para explorar carpetas.");
      return;
    }
    const knownByUri = new Map(state.tracks.filter(track => track.nativeUri).map(track => [track.nativeUri, track]));
    const scanned = files.map((item, index) => {
      const uri = String(item.uri || "");
      const old = uri ? knownByUri.get(uri) : null;
      const name = String(item.name || item.displayName || ("audio-" + (item.id || index)));
      return {
        ...(old || {}),
        id: old?.id || ("android-audio-" + String(item.id || uri || index)),
        kind: "file",
        name,
        sourcePath: uri || name,
        nativePath: old?.nativePath || "",
        nativeUri: uri || old?.nativeUri || "",
        ...mergeNativeTrackMetadata(old, item, titleFromFilename(name)),
        size: preserveKnownScanNumber(old?.size, item.size),
        mimeType: String(item.mimeType || "application/octet-stream"),
        lastModified: preserveKnownScanNumber(old?.lastModified, item.lastModified),
        favorite: Boolean(old?.favorite),
        addedAt: Number(old?.addedAt) || Date.now() + index,
        duration: preserveKnownScanNumber(old?.duration, item.duration, 1000),
        lastPlayedAt: Number(old?.lastPlayedAt) || 0
      };
    });
    for (let offset = 0; offset < scanned.length; offset += 100) {
      await saveManyTracks(scanned.slice(offset, offset + 100));
    }
    state.tracks = await getAllTracks();
    render();
    showView("library");
    toast(result?.truncated
      ? "Encontré los primeros " + files.length + " archivos de audio. La biblioteca es muy grande; elegí Música o una subcarpeta para limitar la búsqueda."
      : "Encontré " + files.length + " archivos de audio. Usá Buscar en biblioteca para filtrar por artista, canción o MP3.");
  } catch (error) {
    const message = error?.message || "No se pudo consultar la biblioteca de música de Android.";
    toast(message);
    showPlaybackStatus(message, "error", false);
  } finally {
    buttons.forEach(button => { button.disabled = false; button.textContent = "Buscar música del teléfono"; });
  }
}

async function browseAudioFolder() {
  const plugin = nativeMusicPlugin();
  if (!plugin?.pickAudioFolder || !plugin?.listAudioFromTree || !plugin?.resolveAudioPath) {
    if (isNativeAndroidShell()) {
      const message = "No se pudo iniciar la selección nativa de carpetas. Actualizá la APK y volvé a abrirla.";
      toast(message);
      showPlaybackStatus(message, "error", false);
      return;
    }
    if (folderPicker.hasAttribute("webkitdirectory")) folderPicker.click();
    else filePicker.click();
    return;
  }
  const buttons = [...document.querySelectorAll("[data-pick-audio-folder]")];
  buttons.forEach(button => { button.disabled = true; button.textContent = "Abriendo carpetas…"; });
  try {
    const picked = await plugin.pickAudioFolder();
    if (!picked?.treeUri) return;
    const result = await plugin.listAudioFromTree({ treeUri: picked.treeUri });
    const files = Array.isArray(result?.files) ? result.files : [];
    if (!files.length) {
      toast("No encontré MP3 ni otros audios compatibles en esa carpeta. Elegí la carpeta donde guardás la música.");
      return;
    }
    const knownByUri = new Map(state.tracks.filter(track => track.nativeUri).map(track => [track.nativeUri, track]));
    const scanned = files.map((item, index) => {
      const uri = String(item.uri || "");
      const old = uri ? knownByUri.get(uri) : null;
      const name = String(item.name || ("audio-" + (item.id || index)));
      return {
        ...(old || {}),
        id: old?.id || ("android-tree-audio-" + String(item.id || uri || index)),
        kind: "file",
        name,
        sourcePath: uri || name,
        nativePath: "",
        nativeUri: uri,
        ...mergeNativeTrackMetadata(old, item, titleFromFilename(name)),
        size: preserveKnownScanNumber(old?.size, item.size),
        mimeType: String(item.mimeType || "application/octet-stream"),
        lastModified: preserveKnownScanNumber(old?.lastModified, item.lastModified),
        favorite: Boolean(old?.favorite),
        addedAt: Number(old?.addedAt) || Date.now() + index,
        duration: preserveKnownScanNumber(old?.duration, item.duration, 1000),
        lastPlayedAt: Number(old?.lastPlayedAt) || 0
      };
    });
    for (let offset = 0; offset < scanned.length; offset += 100) {
      await saveManyTracks(scanned.slice(offset, offset + 100));
    }
    state.tracks = await getAllTracks();
    render();
    showView("library");
    toast(result?.truncated
      ? "Mostré " + scanned.length + " audios. La carpeta es muy grande; elegí una subcarpeta para ver el resto."
      : "Encontré " + scanned.length + " audios en la carpeta. Tocá una canción para reproducirla.");
  } catch (error) {
    const message = error?.message || "No se pudo explorar esa carpeta de música.";
    toast(message);
    showPlaybackStatus(message, "error", false);
  } finally {
    buttons.forEach(button => { button.disabled = false; button.textContent = "Elegir carpeta de música"; });
  }
}

async function importFiles(fileList, options = {}) {
  const selection = classifyAudioImportFiles(fileList);
  const files = selection.files;
  const skippedEmptyFiles = selection.emptyFiles.length;
  const skippedUnsupportedFiles = selection.unsupportedCount;
  const skippedInputNotes = [];
  if (skippedUnsupportedFiles) skippedInputNotes.push(skippedUnsupportedFiles + " archivo(s) no compatible(s) omitido(s)");
  if (skippedEmptyFiles) skippedInputNotes.push(skippedEmptyFiles + " archivo(s) de audio vacío(s) o no legible(s) omitido(s)");
  const skippedInputSummary = skippedInputNotes.length ? " · " + skippedInputNotes.join(" · ") : "";
  if (!files.length) {
    toast(skippedInputSummary
      ? "No se importó ningún archivo." + skippedInputSummary + "."
      : "No encontré archivos de audio compatibles.");
    return {
      saved: 0, bytesSaved: 0, skippedByIdentity: 0, skippedByContent: 0,
      comparisonWarnings: 0, skippedEmptyFiles, skippedUnsupportedFiles, failure: null
    };
  }

  const localTracks = state.tracks.filter(track => isLocal(track));
  const existing = new Set(localTracks.map(track => importedFileFingerprint(track)));
  const comparableFingerprints = new Set();
  const candidatesBySize = new Map();
  const registerCandidate = blob => {
    if (!blob || typeof blob.slice !== "function" ||
        !Number.isSafeInteger(Number(blob.size)) || Number(blob.size) <= 0) return;
    const size = Number(blob.size);
    const bucket = candidatesBySize.get(size) || [];
    bucket.push(blob);
    candidatesBySize.set(size, bucket);
  };
  // Browser-imported files keep a Blob, so they can be compared exactly in
  // bounded chunks. Native Android records without accessible bytes stay URI-based.
  for (const track of localTracks) {
    registerCandidate(track.blob);
    const trackSize = Number(track.size);
    if (track.blob && typeof track.blob.slice === "function" &&
        Number.isSafeInteger(trackSize) && trackSize > 0 &&
        Number(track.blob.size) === trackSize) {
      comparableFingerprints.add(importedFileFingerprint(track));
    }
  }

  const uniqueFiles = [];
  let skippedByIdentity = 0;
  let skippedByContent = 0;
  let comparisonWarnings = 0;
  let comparisonStatusShown = false;
  const duplicateComparisonBudget = {
    remainingCandidates: MAX_BLOB_COMPARE_CANDIDATES_PER_IMPORT_BATCH,
    remainingBytes: MAX_BLOB_COMPARISON_BYTES_PER_IMPORT_BATCH
  };
  for (const file of files) {
    const fingerprint = importedFileFingerprint(file, options);
    const knownIdentity = existing.has(fingerprint);
    if (knownIdentity && !comparableFingerprints.has(fingerprint)) {
      skippedByIdentity++;
      continue;
    }

    const fileSize = Number(file.size);
    const candidates = Number.isSafeInteger(fileSize) && fileSize > 0
      ? (candidatesBySize.get(fileSize) || [])
      : [];
    if (candidates.length && !comparisonStatusShown) {
      toast("Comprobando copias idénticas por contenido…");
      comparisonStatusShown = true;
    }
    const decision = await classifyImportDuplicate(file, {
      fingerprint,
      existingFingerprints: existing,
      comparableFingerprints,
      candidates,
      comparisonOptions: { budget: duplicateComparisonBudget }
    });
    if (decision.comparisonFailed) comparisonWarnings++;
    if (decision.action === "skip-identity") {
      skippedByIdentity++;
      continue;
    }
    if (decision.action === "skip-content") {
      skippedByContent++;
      existing.add(fingerprint);
      // Even skipped files have comparable bytes: keep checking subsequent
      // selections with this same fingerprint for a later content change.
      comparableFingerprints.add(fingerprint);
      continue;
    }
    existing.add(fingerprint);
    uniqueFiles.push(file);
    registerCandidate(file);
    if (typeof file.slice === "function" && Number(file.size) > 0 &&
        Number.isSafeInteger(Number(file.size))) {
      comparableFingerprints.add(fingerprint);
    }
  }

  if (!uniqueFiles.length) {
    const details = [];
    if (skippedByIdentity) details.push(skippedByIdentity + " ya se reconocían por su ruta o identidad");
    if (skippedByContent) details.push(skippedByContent + " eran copias binarias idénticas");
    if (comparisonWarnings) details.push(comparisonWarnings + " comprobación(es) fallida(s); esos archivos no se descartaron");
    if (skippedUnsupportedFiles) details.push(skippedUnsupportedFiles + " archivo(s) no compatible(s) omitido(s)");
    if (skippedEmptyFiles) details.push(skippedEmptyFiles + " archivo(s) de audio vacío(s) o no legible(s) omitido(s)");
    toast(details.length
      ? "No se importaron archivos nuevos: " + details.join(" · ") + "."
      : "Esos archivos ya están en tu biblioteca.");
    return {
      saved: 0, bytesSaved: 0, skippedByIdentity, skippedByContent,
      comparisonWarnings, skippedEmptyFiles, skippedUnsupportedFiles, failure: null
    };
  }

  let saved = 0, bytesSaved = 0, failure = null;
  const BATCH_SIZE = 20;
  const IMPORT_METADATA_CONCURRENCY = 4;
  for (let offset = 0; offset < uniqueFiles.length; offset += BATCH_SIZE) {
    const batch = uniqueFiles.slice(offset, offset + BATCH_SIZE);
    toast("Importando " + Math.min(offset + batch.length, uniqueFiles.length) + " de " + uniqueFiles.length + " archivos…");
    try {
      const tracks = await mapWithConcurrency(batch, IMPORT_METADATA_CONCURRENCY, async file => {
        const meta = options.metadataOverridesByFile?.get(file) || await readAudioMetadata(file);
        return { id: id(), kind: "file", name: file.name, sourcePath: file.webkitRelativePath || file.name, title: meta.title, artist: meta.artist, album: meta.album || "", genre: meta.genre || "",
          ...(meta.artwork instanceof Uint8Array && (meta.artworkMimeType === "image/jpeg" || meta.artworkMimeType === "image/png") &&
              meta.artwork.byteLength <= MAX_EMBEDDED_ARTWORK_BYTES
            ? { artworkBlob: new Blob([meta.artwork], { type: meta.artworkMimeType }) } : {}),
          metadataScanned: options.metadataOverridesByFile?.has(file) === true || /\.mp3$/i.test(file.name) || isVorbisMetadataFilename(file.name) || isWavMetadataFilename(file.name),
          size: file.size, mimeType: file.type || "application/octet-stream", lastModified: file.lastModified,
          nativePath: String(options.nativePathsByFile?.get(file) || ""),
          dedupeKey: String(options.dedupeKeysByFile?.get(file) || ""),
          blob: file, favorite: false, addedAt: Date.now() + saved, duration: 0, lastPlayedAt: 0 };
      });
      await saveManyTracks(tracks);
      saved += tracks.length;
      bytesSaved += tracks.reduce((sum, track) => sum + track.size, 0);
    } catch (error) { failure = error; break; }
  }
  try { state.tracks = await getAllTracks(); } catch {}
  render();
  if (saved) {
    const duplicateNote = skippedByContent
      ? " · " + skippedByContent + " copia(s) idéntica(s) omitida(s)"
      : "";
    const comparisonNote = comparisonWarnings
      ? " · " + comparisonWarnings + " comprobación(es) no concluyentes; se conservaron"
      : "";
    toast(saved + (saved === 1 ? " archivo importado" : " archivos importados") + " · " +
      formatBytes(bytesSaved) + duplicateNote + comparisonNote + skippedInputSummary + (failure ? " · importación parcial" : ""));
    requestPersistentStorage().catch(() => {});
    if (!currentTrack() && options.navigateToLibrary !== false) showView("library");
  } else {
    const failureMessage = failure?.name === "QuotaExceededError"
      ? "No hay espacio suficiente en el navegador. Importá menos archivos por vez o liberá almacenamiento."
      : (failure?.message || "No se pudo importar la música.");
    toast(failureMessage + skippedInputSummary);
  }
  return { saved, bytesSaved, skippedByIdentity, skippedByContent, comparisonWarnings, skippedEmptyFiles, skippedUnsupportedFiles, failure };
}
async function removeCurrent() {
  // Invalidate any play()/AudioContext continuation that is still awaiting a
  // result; otherwise it could restore the source after the user removes it.
  cancelPendingPlaybackIntent();
  const track = currentTrack();
  if (!track) return;
  await stopNativePlayback();
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
  if (!requireInternetMode("agregar una fuente online")) return;
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


const SPOTIFY_EMBED_STORAGE = "ritmo.spotify-embed-link.v1";
let spotifyIFrameApi = null;
let spotifyIFrameApiPromise = null;
let spotifyEmbedController = null;
let spotifyCurrentEmbed = null;
let spotifyControllerReady = false;
let spotifyMediaPlaybackState = "none";
let spotifyCurrentTime = 0;
let spotifyDuration = Number.NaN;
let spotifyProgressTimer = null;
let spotifyEmbedRequestId = 0;
let radioStations = [];
let savedRadioStations = [];
let radioSearchRequestId = 0;
let radioSearchAbortController = null;

function setSpotifyStatus(message, tone = "") {
  const status = $("#spotify-status");
  if (!status) return;
  status.textContent = message;
  status.dataset.tone = tone;
}
function ensureSpotifyIFrameApi() {
  if (spotifyIFrameApi) return Promise.resolve(spotifyIFrameApi);
  if (spotifyIFrameApiPromise) return spotifyIFrameApiPromise;
  spotifyIFrameApiPromise = new Promise((resolve, reject) => {
    const previousReady = window.onSpotifyIframeApiReady;
    let settled = false;
    let timeout;
    const finish = api => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (!api || typeof api.createController !== "function") {
        spotifyIFrameApiPromise = null;
        reject(new Error("Spotify no devolvió una API de reproductor compatible."));
        return;
      }
      spotifyIFrameApi = api;
      resolve(api);
    };
    const readyHandler = api => {
      finish(api);
      try { if (typeof previousReady === "function") previousReady(api); } catch {}
    };
    window.onSpotifyIframeApiReady = readyHandler;
    timeout = setTimeout(() => {
      spotifyIFrameApiPromise = null;
      const pending = document.querySelector('script[src="https://open.spotify.com/embed/iframe-api/v1"]');
      if (pending && !spotifyIFrameApi) pending.remove();
      if (window.onSpotifyIframeApiReady === readyHandler) window.onSpotifyIframeApiReady = previousReady;
      reject(new Error("La API del reproductor de Spotify no respondió; se intentará cargar su widget directo."));
    }, 12000);
    let script = document.querySelector('script[src="https://open.spotify.com/embed/iframe-api/v1"]');
    if (!script) {
      script = document.createElement("script");
      script.src = "https://open.spotify.com/embed/iframe-api/v1";
      script.async = true;
    }
    script.addEventListener("error", () => {
      if (settled) return;
      clearTimeout(timeout);
      spotifyIFrameApiPromise = null;
      if (window.onSpotifyIframeApiReady === readyHandler) window.onSpotifyIframeApiReady = previousReady;
      reject(new Error("No se pudo cargar la API del reproductor de Spotify."));
    }, { once: true });
    if (!script.isConnected) document.head.appendChild(script);
  });
  return spotifyIFrameApiPromise;
}
function stopSpotifyEmbed({ preserveSaved = true, refresh = true } = {}) {
  spotifyEmbedRequestId += 1;
  if (spotifyProgressTimer !== null) clearInterval(spotifyProgressTimer);
  spotifyProgressTimer = null;
  if (spotifyEmbedController) {
    try { spotifyEmbedController.destroy(); } catch {}
  }
  spotifyEmbedController = null;
  spotifyCurrentEmbed = null;
  spotifyControllerReady = false;
  spotifyMediaPlaybackState = "none";
  spotifyCurrentTime = 0;
  spotifyDuration = Number.NaN;
  const mount = $("#spotify-embed-mount");
  if (mount) mount.replaceChildren();
  const shell = $("#spotify-embed-shell");
  if (shell) shell.hidden = true;
  if (!preserveSaved) {
    try { localStorage.removeItem(SPOTIFY_EMBED_STORAGE); } catch {}
  }
  if (refresh) {
    updatePlayer();
    updateMediaSession();
  }
}
function spotifyPlaybackUpdate(data, requestId) {
  if (requestId !== spotifyEmbedRequestId || !spotifyCurrentEmbed || !spotifyControllerReady || !data) return;
  spotifyMediaPlaybackState = data.isPaused ? "paused" : data.isBuffering ? "buffering" : "playing";
  const durationMs = Math.max(0, Number(data.duration) || 0);
  const positionMs = Math.max(0, Number(data.position) || 0);
  spotifyDuration = durationMs > 0 ? durationMs / 1000 : Number.NaN;
  spotifyCurrentTime = positionMs / 1000;
  if (spotifyMediaPlaybackState === "playing") {
    if (spotifyProgressTimer === null) {
      spotifyProgressTimer = setInterval(() => {
        if (!spotifyCurrentEmbed || spotifyMediaPlaybackState !== "playing") {
          clearInterval(spotifyProgressTimer);
          spotifyProgressTimer = null;
          return;
        }
        updatePlayer();
        updateMediaSession();
      }, 1000);
    }
  } else if (spotifyProgressTimer !== null) {
    clearInterval(spotifyProgressTimer);
    spotifyProgressTimer = null;
  }
  if (spotifyMediaPlaybackState === "playing") setSpotifyStatus("Spotify está reproduciendo desde su widget oficial. La disponibilidad de canciones completas depende de Spotify.", "success");
  else if (spotifyMediaPlaybackState === "paused") setSpotifyStatus("Spotify está en pausa. Podés continuar desde el widget o con el botón Reproducir de Ritmo.", "info");
  updatePlayer();
  updateMediaSession();
}
function createSpotifyFallback(host, descriptor, requestId) {
  if (requestId !== spotifyEmbedRequestId || !host?.isConnected) return;
  spotifyControllerReady = false;
  const frame = document.createElement("iframe");
  frame.title = descriptor.label + " · Widget oficial de Spotify";
  frame.src = descriptor.embedUrl;
  frame.width = "100%";
  frame.height = descriptor.type === "track" ? "152" : "352";
  frame.loading = "lazy";
  frame.referrerPolicy = "strict-origin-when-cross-origin";
  frame.allow = "autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture";
  frame.setAttribute("allowfullscreen", "");
  frame.style.border = "0";
  frame.style.borderRadius = "12px";
  host.replaceChildren(frame);
  setSpotifyStatus("Widget oficial cargado. Usá los controles dentro de Spotify; este navegador no habilitó los controles integrados de Ritmo.", "warning");
  updatePlayer();
}
async function loadSpotifyEmbed(rawLink, { persist = true } = {}) {
  if (!requireInternetMode("abrir Spotify")) return false;
  const descriptor = parseSpotifyShareLink(rawLink);
  if (!descriptor) {
    setSpotifyStatus("Pegá un enlace https://open.spotify.com válido de una canción, álbum, lista, artista o podcast. No se admiten webs parecidas ni enlaces acortados.", "error");
    return false;
  }
  stopSpotifyEmbed({ preserveSaved: true, refresh: false });
  notifySoundTrackContext(null);
  const requestId = ++spotifyEmbedRequestId;
  spotifyCurrentEmbed = { ...descriptor, title: descriptor.label };
  spotifyMediaPlaybackState = "paused";
  spotifyCurrentTime = 0;
  spotifyDuration = Number.NaN;
  if (persist) {
    try { localStorage.setItem(SPOTIFY_EMBED_STORAGE, descriptor.canonicalUrl); } catch {}
  }
  try {
    cancelPendingPlaybackIntent();
    if (youtubeHistory.getCurrentSession() || !$("#youtube-player-wrap").hidden) stopYoutubePlayback();
    await stopNativePlayback();
    for (const engine of [defaultAudio, equalizedAudio]) {
      engine.pause();
      engine.removeAttribute("src");
      engine.load();
    }
    audio = defaultAudio;
    releaseUnusedObjectURLs(null);
    state.currentId = null;
    state.queueIds = null;
    render();
  } catch (error) {
    console.warn("No se pudo detener la fuente anterior antes de abrir Spotify.", error);
  }
  if (requestId !== spotifyEmbedRequestId || !spotifyCurrentEmbed) return false;
  const shell = $("#spotify-embed-shell");
  const mount = $("#spotify-embed-mount");
  shell.hidden = false;
  mount.replaceChildren();
  const host = document.createElement("div");
  host.className = "spotify-embed-host";
  mount.append(host);
  $("#spotify-share-link").value = descriptor.canonicalUrl;
  setSpotifyStatus("Cargando el widget oficial de Spotify…", "info");
  updatePlayer();
  updateMediaSession();
  fetch("https://open.spotify.com/oembed?url=" + encodeURIComponent(descriptor.canonicalUrl), {
    mode: "cors", credentials: "omit", cache: "no-store"
  }).then(response => response.ok ? response.json() : null).then(data => {
    if (requestId !== spotifyEmbedRequestId || !spotifyCurrentEmbed || !data || typeof data.title !== "string") return;
    spotifyCurrentEmbed.title = data.title.slice(0, 220) || descriptor.label;
    updatePlayer();
    updateMediaSession();
  }).catch(() => {});
  try {
    const api = await ensureSpotifyIFrameApi();
    if (requestId !== spotifyEmbedRequestId || !spotifyCurrentEmbed) return false;
    api.createController(host, {
      uri: descriptor.uri, width: "100%", height: descriptor.type === "track" ? "152" : "352"
    }, controller => {
      if (requestId !== spotifyEmbedRequestId || !spotifyCurrentEmbed) {
        try { controller.destroy(); } catch {}
        return;
      }
      spotifyEmbedController = controller;
      spotifyControllerReady = true;
      controller.addListener("ready", () => {
        if (requestId !== spotifyEmbedRequestId) return;
        setSpotifyStatus("Widget listo. Tocá reproducir en Spotify o usá los controles de Ritmo. Spotify puede pedir cuenta o reproducir vistas previas.", "success");
        updatePlayer();
      });
      controller.addListener("playback_update", event => spotifyPlaybackUpdate(event?.data, requestId));
      controller.addListener("playback_started", event => {
        if (requestId !== spotifyEmbedRequestId) return;
        const playingUri = String(event?.data?.playingURI || "");
        if (playingUri.startsWith("spotify:")) spotifyCurrentEmbed.playingURI = playingUri;
      });
      setSpotifyStatus("Widget oficial listo. La disponibilidad de la pista la decide Spotify.", "success");
      updatePlayer();
      updateMediaSession();
    });
  } catch (error) {
    if (requestId !== spotifyEmbedRequestId) return false;
    createSpotifyFallback(host, descriptor, requestId);
    console.warn("Spotify iFrame API no disponible; se usa el embed directo.", error);
  }
  return true;
}
function renderRadioStations(stations, saved = false) {
  return (stations || []).map(station => {
    const details = [station.country, station.language, station.codec, station.bitrate ? station.bitrate + " kbps" : ""].filter(Boolean).join(" · ");
    const tags = station.tags ? '<p class="radio-station-tags">' + escapeHTML(station.tags) + '</p>' : "";
    const homeLink = station.homepage
      ? '<a class="archive-download-link" href="' + escapeHTML(station.homepage) + '" target="_blank" rel="noopener noreferrer">Web de la emisora ↗</a>'
      : "";
    const buttons = '<button type="button" class="button button-primary" data-radio-play="' + escapeHTML(station.stationuuid) + '">▶ Escuchar</button>' +
      (saved
        ? '<button type="button" class="button button-soft" data-radio-remove="' + escapeHTML(station.stationuuid) + '">Quitar guardada</button>'
        : '<button type="button" class="button button-soft" data-radio-add="' + escapeHTML(station.stationuuid) + '">Guardar emisora</button>');
    return '<article class="archive-result radio-station-result"><div class="archive-result-main">' +
      '<div class="archive-result-label">RADIO BROWSER · STREAM HTTPS</div><strong>' + escapeHTML(station.name) + '</strong>' +
      '<small>' + escapeHTML(details || "Emisión online") + '</small>' + tags +
      '<div class="archive-result-actions">' + buttons + homeLink + '</div></div></article>';
  }).join("");
}
function renderSavedRadioStations() {
  const root = $("#saved-radio-stations");
  if (!root) return;
  root.innerHTML = renderRadioStations(savedRadioStations, true);
  $("#saved-radio-count").textContent = String(savedRadioStations.length);
  $("#saved-radio-empty").hidden = savedRadioStations.length > 0;
}
async function loadSavedRadioStations(tracks) {
  const stored = await getAppSetting(SAVED_RADIO_STATIONS_SETTING_KEY);
  const migration = migrateRadioStationsFromTracks(stored, tracks);
  savedRadioStations = migration.stations;
  // Settings are a separate collection; legacy track records stay available
  // until a user explicitly removes a station, preserving old playback/history.
  if (JSON.stringify(Array.isArray(stored) ? stored : []) !== JSON.stringify(savedRadioStations)) {
    await saveAppSetting(SAVED_RADIO_STATIONS_SETTING_KEY, savedRadioStations);
  }
  renderSavedRadioStations();
  return migration;
}
async function removeSavedRadioStationFromCollection(stationuuid) {
  const station = savedRadioStations.find(item => item.stationuuid === stationuuid);
  if (!station) return;
  const relatedTracks = state.tracks.filter(track => isRadioStationTrack(track) &&
    (track.radioStationUuid === stationuuid || track.url === station.url));
  try {
    if (relatedTracks.some(track => track.id === state.currentId)) await removeCurrent();
    for (const track of relatedTracks) {
      const objectUrl = state.objectUrls.get(track.id);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      state.objectUrls.delete(track.id);
      await deleteTrackAndPrunePlaylists(track.id);
    }
    const next = removeSavedRadioStation(savedRadioStations, stationuuid);
    await saveAppSetting(SAVED_RADIO_STATIONS_SETTING_KEY, next);
    savedRadioStations = next;
    state.tracks = await getAllTracks();
    state.playlists = await getPlaylists();
    renderSavedRadioStations();
    render();
    toast("Se quitó la emisora guardada.");
  } catch (error) {
    toast(error?.message || "No se pudo quitar la emisora guardada.");
  }
}
async function searchRadioStations() {
  if (!requireInternetMode("buscar emisoras")) return;
  const input = $("#radio-query");
  const button = $("#radio-search-button");
  const status = $("#radio-status");
  const query = input.value.trim();
  const filter = $("#radio-filter").value;
  if (!query) {
    status.textContent = "Escribí un nombre, género, país o idioma para buscar emisoras.";
    input.focus();
    return;
  }
  if (!navigator.onLine) {
    status.textContent = "El directorio de radios necesita conexión. Tu biblioteca local sigue disponible offline.";
    return;
  }
  radioSearchAbortController?.abort();
  const requestId = ++radioSearchRequestId;
  const controller = new AbortController();
  radioSearchAbortController = controller;
  button.disabled = true;
  button.textContent = "Buscando…";
  status.textContent = "Buscando en el directorio público de Radio Browser…";
  try {
    const result = await searchRadioBrowser(query, filter, { signal: controller.signal });
    if (requestId !== radioSearchRequestId) return;
    radioStations = result.stations;
    renderRadioStations(radioStations);
    if (radioStations.length) {
      status.textContent = "Encontré " + radioStations.length + " emisoras con stream HTTPS reproducible. La disponibilidad puede cambiar y la radio original controla la emisión.";
      status.dataset.tone = "success";
    } else if (result.received > 0) {
      status.textContent = "El directorio devolvió " + result.received + " coincidencias, pero ninguna tenía un stream HTTPS compatible. Probá otro filtro.";
      status.dataset.tone = "warning";
    } else {
      status.textContent = "No encontré emisoras para esa búsqueda. Probá otro nombre, género, país o idioma.";
      status.dataset.tone = "info";
    }
  } catch (error) {
    if (requestId === radioSearchRequestId && error?.name !== "AbortError") {
      status.textContent = error?.message || "No se pudo consultar Radio Browser.";
      status.dataset.tone = "error";
    }
  } finally {
    if (requestId === radioSearchRequestId) {
      button.disabled = false;
      button.textContent = "Buscar radios";
      if (radioSearchAbortController === controller) radioSearchAbortController = null;
    }
  }
}
async function addRadioStation(stationuuid, playNow = false) {
  if (!requireInternetMode("agregar o reproducir una emisora")) return;
  const station = radioStations.find(item => item.stationuuid === stationuuid) ||
    savedRadioStations.find(item => item.stationuuid === stationuuid);
  if (!station || !station.url) {
    toast("Esta emisora no tiene un stream HTTPS compatible disponible.");
    return;
  }
  const previousSavedStations = savedRadioStations;
  const nextSavedStations = upsertSavedRadioStation(savedRadioStations, station);
  try {
    await saveAppSetting(SAVED_RADIO_STATIONS_SETTING_KEY, nextSavedStations);
    savedRadioStations = nextSavedStations;
    renderSavedRadioStations();
  } catch (error) {
    toast(error?.message || "No se pudo guardar la emisora.");
    return;
  }

  let track = state.tracks.find(item => item.kind === "url" && item.url === station.url);
  if (!track) {
    track = {
      id: id(), kind: "url", url: station.url, name: station.name, title: station.name,
      artist: [station.country, station.language].filter(Boolean).join(" · ") || "Radio online",
      album: ["Radio Browser", station.codec].filter(Boolean).join(" · "),
      favorite: false, addedAt: Date.now(), duration: 0, lastPlayedAt: 0,
      sourceProvider: "Radio Browser", sourcePage: station.homepage || station.url,
      radioStationUuid: station.stationuuid, radioTags: station.tags
    };
    try {
      await saveTrack(track);
      state.tracks = await getAllTracks();
      render();
      toast("Emisora guardada en «Mis radios». La canción original no se mezcla con las emisoras.");
    } catch (error) {
      savedRadioStations = previousSavedStations;
      await saveAppSetting(SAVED_RADIO_STATIONS_SETTING_KEY, previousSavedStations).catch(() => {});
      renderSavedRadioStations();
      toast(error?.message || "No se pudo guardar la emisora.");
      return;
    }
  } else {
    toast("Emisora guardada en «Mis radios».");
  }
  if (playNow) {
    void fetch(radioStationClickUrl(station.stationuuid), {
      mode: "cors", credentials: "omit", cache: "no-store"
    }).catch(() => {});
    await playTrack(track.id);
  }
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
function openExternalWebFallback(url) {
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
function openExternal(url) {
  if (!requireInternetMode("abrir un servicio externo")) return false;
  const safeUrl = normalizeExternalMediaUrl(url);
  if (!safeUrl) {
    console.warn("Ritmo rechazó un enlace externo que no pertenece a un servicio multimedia permitido.");
    return false;
  }
  const plugin = nativePlaybackPlugin();
  if (plugin?.openExternal) {
    // On Android, let the OS choose the official YouTube app or the user's
    // default browser (for example Brave). Keep a safe web fallback for older APKs.
    void plugin.openExternal({ url: safeUrl }).catch(error => {
      console.warn("No se pudo abrir el enlace con el enrutamiento nativo de Android.", error);
      openExternalWebFallback(safeUrl);
    });
    return true;
  }
  openExternalWebFallback(safeUrl);
  return true;
}

function bindOnlineServiceEvents() {
  $("#spotify-embed-form").addEventListener("submit", event => {
    event.preventDefault();
    void loadSpotifyEmbed($("#spotify-share-link").value);
  });
  $("#spotify-search-form").addEventListener("submit", event => {
    event.preventDefault();
    const query = $("#spotify-search-query").value.trim();
    if (!query) { $("#spotify-search-query").focus(); return; }
    openExternal("https://open.spotify.com/search/" + encodeURIComponent(query));
  });
  $("#radio-search-form").addEventListener("submit", event => {
    event.preventDefault();
    void searchRadioStations();
  });
  $("#radio-results").addEventListener("click", event => {
    const play = event.target.closest("[data-radio-play]");
    if (play) { void addRadioStation(play.dataset.radioPlay, true); return; }
    const add = event.target.closest("[data-radio-add]");
    if (add) void addRadioStation(add.dataset.radioAdd, false);
  });
  $("#saved-radio-stations").addEventListener("click", event => {
    const play = event.target.closest("[data-radio-play]");
    if (play) { void addRadioStation(play.dataset.radioPlay, true); return; }
    const remove = event.target.closest("[data-radio-remove]");
    if (remove) void removeSavedRadioStationFromCollection(remove.dataset.radioRemove);
  });
  let savedLink = "";
  try { savedLink = localStorage.getItem(SPOTIFY_EMBED_STORAGE) || ""; } catch {}
  if (savedLink && networkModeEnabledState && navigator.onLine) void loadSpotifyEmbed(savedLink, { persist: false });
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
  if (!requireInternetMode("consultar los detalles del catálogo")) return;
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
  if (!requireInternetMode("agregar audio de Internet Archive")) return;
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
  if (!requireInternetMode("buscar en Internet Archive")) return;
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
function fallbackToOfficialYoutubeSearch(query, message) {
  const nativePlugin = isNativeAndroidShell() ? nativePlaybackPlugin() : null;
  if (nativePlugin?.openExternal) {
    setYoutubeStatus(message + " Intentando abrir la búsqueda oficial de YouTube; no hace falta una clave API.", "warning");
    openExternal(youtubeSearchURL(query));
    return;
  }
  $("#youtube-open-search").classList.add("needs-attention");
  setYoutubeStatus(message + " Tocá «Abrir búsqueda en YouTube» para continuar; no hace falta una clave API.", "error");
}
function updateYoutubeNetworkStatus() {
  const status = $("#youtube-network-status");
  if (!status) return;
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  const network = !navigator.onLine ? "Sin conexión." :
    connection?.type === "wifi" ? "Red detectada: Wi-Fi." :
    connection?.type === "cellular" ? "Red detectada: datos móviles." :
    "Conexión disponible; este navegador no confirma si es Wi-Fi o datos móviles.";
  const saver = connection?.saveData === true ? " El ahorro de datos del navegador está activado." : "";
  status.textContent = network + saver + " El consumo y el costo dependen de la calidad y duración; Ritmo no puede calcularlos por adelantado.";
}
function syncYoutubeModeControls() {
  const enabled = youtubeModeEnabledState;
  const toggle = $("#youtube-mode-toggle");
  if (toggle) {
    toggle.textContent = enabled ? "Apagar YouTube" : "Activar YouTube";
    toggle.setAttribute("aria-pressed", String(enabled));
  }
  for (const selector of ["#youtube-query", "#youtube-search-button", "#youtube-open-search", "#youtube-load-more"]) {
    const control = $(selector);
    if (control) control.disabled = !enabled;
  }
  const stateLabel = $("#youtube-mode-label");
  if (stateLabel) stateLabel.textContent = enabled ? "YouTube está activado dentro de Ritmo" : "YouTube está apagado";
  const description = $("#youtube-mode-description");
  if (description) description.textContent = enabled
    ? "Las búsquedas y el reproductor integrado están habilitados. Usá Apagar YouTube para detenerlo y descargar sus recursos."
    : "No se harán búsquedas ni se mantendrá cargado el reproductor de YouTube hasta que lo actives.";
  updateYoutubeNetworkStatus();
}
function setYoutubeModeEnabled(enabled) {
  const next = Boolean(enabled);
  const persisted = persistYoutubeModeEnabled(next);
  youtubeModeEnabledState = next;
  if (!next) {
    youtubeSearchAbortController?.abort();
    youtubeSearchAbortController = null;
    youtubeSearchRequestId++;
    stopYoutubePlayback();
    state.youtubeResults = [];
    state.youtubeNextPageToken = null;
    state.youtubeQuery = "";
    $("#youtube-results").replaceChildren();
    $("#youtube-load-more").hidden = true;
  }
  syncYoutubeModeControls();
  if (!persisted) {
    setYoutubeStatus(next
      ? "YouTube está activado solo durante esta sesión porque el navegador no permitió guardar la preferencia."
      : "YouTube está apagado. La preferencia no pudo guardarse en este navegador.", "warning");
  } else if (next) {
    setYoutubeStatus("YouTube activado. Sin clave, la búsqueda envía tu consulta a una instancia pública de Invidious. El reproductor integrado no ofrece audio en segundo plano; para evitar consumo móvil, apagalo al terminar.", "info");
  } else {
    setYoutubeStatus("YouTube apagado. Se cancelaron las búsquedas y se descargó el reproductor integrado. La música local y las radios compatibles siguen disponibles.", "info");
  }
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
    const statusNote = item.ritmoSource === "invidious"
      ? '<div class="youtube-result-safety">Resultado comunitario: los permisos de incrustación no están verificados</div>'
      : item.ritmoStatusVerified !== true
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
async function annotateYoutubeVideoStatus(items, key, signal) {
  const ids = (items || []).map(item => item.id?.videoId).filter(value => /^[A-Za-z0-9_-]{11}$/.test(value || ""));
  if (!ids.length) return [];
  const params = new URLSearchParams({ part: "status", id: ids.join(","), key });
  const response = await fetch("https://www.googleapis.com/youtube/v3/videos?" + params.toString(), { signal });
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
  if (!requireInternetMode("buscar en YouTube")) {
    setYoutubeStatus(networkModeEnabledState ? "No hay conexión. Las búsquedas quedan bloqueadas hasta que vuelva internet." : "🔒 Modo sin conexión activo: la búsqueda de YouTube está bloqueada.", "info");
    return;
  }
  if (!youtubeModeEnabledState) {
    setYoutubeStatus("YouTube está apagado. Tocá «Activar YouTube» y confirmá el aviso de consumo para buscar.", "info");
    return;
  }
  // A newer query supersedes the previous search and its follow-up status lookup.
  // Abort both network requests to avoid stale work and needless API quota use.
  youtubeSearchAbortController?.abort();
  youtubeSearchAbortController = null;
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
    loadButton.disabled = false;
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
    loadButton.disabled = false;
    button.innerHTML = 'Buscar <span>→</span>';
    return;
  }
  const key = youtubeApiKey();
  if (!key) {
    // A no-key search stays inside Ritmo first. The query is sent only to one of
    // the public community instances documented by Invidious; its results are
    // explicitly marked unverified and open on YouTube instead of being embedded.
    if (!pageToken) {
      state.youtubeResults = [];
      renderYoutubeResults([], false);
    }
    button.disabled = true;
    loadButton.disabled = true;
    button.textContent = "Buscando…";
    loadButton.hidden = true;
    setYoutubeStatus("Buscando sin clave mediante una instancia pública de Invidious. Esa instancia recibe tu consulta; los resultados comunitarios se abren en YouTube porque no se pueden verificar sus permisos de incrustación.", "info");
    const abortController = new AbortController();
    youtubeSearchAbortController = abortController;
    try {
      const result = await searchInvidiousYoutube(query, { signal: abortController.signal });
      if (!isCurrentYoutubeSearch()) return;
      const items = result.items;
      state.youtubeResults = items;
      state.youtubeNextPageToken = null;
      persistYoutubeSearchCache(query, items);
      renderYoutubeResults(items, false);
      loadButton.hidden = true;
      $("#youtube-open-search").classList.remove("needs-attention");
      if (items.length) {
        setYoutubeStatus("Encontré " + items.length + " resultados para «" + query + "» mediante " + new URL(result.instance).hostname + ". La instancia recibió tu consulta; abrí en YouTube para reproducirlos.", "success");
      } else {
        fallbackToOfficialYoutubeSearch(query, "La búsqueda comunitaria no devolvió videos utilizables para «" + query + "».");
      }
    } catch (error) {
      if (isCurrentYoutubeSearch() && error?.name !== "AbortError") {
        fallbackToOfficialYoutubeSearch(query, "Las instancias comunitarias de búsqueda no respondieron (" + (error?.message || "error de conexión") + ").");
      }
    } finally {
      if (isCurrentYoutubeSearch()) {
        button.disabled = false;
        loadButton.disabled = false;
        button.innerHTML = 'Buscar <span>→</span>';
        if (youtubeSearchAbortController === abortController) youtubeSearchAbortController = null;
      }
    }
    return;
  }
  if (!pageToken) {
    state.youtubeResults = [];
    renderYoutubeResults([], false);
  }
  button.disabled = true;
  loadButton.disabled = true;
  button.textContent = "Buscando…";
  setYoutubeStatus("Buscando canciones y comprobando el estado de los videos…", "info");
  const abortController = new AbortController();
  youtubeSearchAbortController = abortController;
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
    const response = await fetch("https://www.googleapis.com/youtube/v3/search?" + params.toString(), { signal: abortController.signal });
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
      items = await annotateYoutubeVideoStatus(rawItems, key, abortController.signal);
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
    if (isCurrentYoutubeSearch() && error?.name !== "AbortError") {
      setYoutubeStatus(error.message || "Falló la búsqueda de YouTube.", "error");
    }
  } finally {
    if (isCurrentYoutubeSearch()) {
      button.disabled = false;
      loadButton.disabled = false;
      button.innerHTML = 'Buscar <span>→</span>';
      if (youtubeSearchAbortController === abortController) youtubeSearchAbortController = null;
    }
  }
}
function playYoutubeVideo(videoId, title = "Video de YouTube") {
  if (!youtubeModeEnabledState) {
    setYoutubeStatus("YouTube está apagado. Activá YouTube antes de reproducir un video.", "info");
    return;
  }
  stopSpotifyEmbed({ preserveSaved: true, refresh: false });
  if (!navigator.onLine) { toast("Para reproducir YouTube necesitás conexión. Los resultados guardados y la biblioteca local siguen disponibles offline."); return; }
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId || "")) {
    toast("El enlace de YouTube no contiene un ID de video válido.");
    return;
  }
  notifySoundTrackContext(null);
  // Selecting a YouTube video supersedes any native-audio request still awaiting play().
  cancelPendingPlaybackIntent();
  const frame = $("#youtube-iframe");
  frame.referrerPolicy = "strict-origin-when-cross-origin";
  const wrap = $("#youtube-player-wrap");
  wrap.hidden = false;
  // User-selected playback must begin with the official player visible, not in a
  // hidden iframe. Avoid smooth scrolling because it could autoplay while offscreen.
  wrap.scrollIntoView({ behavior: "auto", block: "center" });
  const sessionId = youtubeHistory.select(videoId, title);
  youtubeMediaPlaybackState = "buffering";
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
  void stopNativePlayback();
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
  releaseUnusedObjectURLs(null);
  state.currentId = null;
  state.queueIds = null;
  updatePlayer();
  updateMediaSession();
  renderQueue();
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
  bindAudioConverterEvents();
  musicFinderController.bindEvents();
  bindLibraryManagementEvents();
  $("#network-mode-toggle").addEventListener("click", () => setNetworkModeEnabled(!networkModeEnabledState));
  $("#network-enable-internet").addEventListener("click", () => setNetworkModeEnabled(true));
  document.querySelectorAll("[data-go-radio]").forEach(button => button.addEventListener("click", () => {
    showView("online");
    const target = networkModeIsAvailable() ? document.querySelector(".radio-directory-section") : $("#network-locked-note");
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  }));
  $("#online-view").addEventListener("click", event => {
    if (networkModeIsAvailable()) return;
    if (event.target.closest("#network-enable-internet")) return;
    const target = event.target.closest("button, a[href]");
    if (!target || target.disabled) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    requireInternetMode("usar esta opción online");
  }, true);
  document.addEventListener("click", event => {
    if (networkModeIsAvailable()) return;
    const link = event.target.closest("a.archive-track-download[href]");
    if (!link) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    requireInternetMode("abrir o descargar un archivo externo");
  }, true);
  window.addEventListener("ritmo:voice-preview-start", event => {
    if (event.detail?.pauseMusic !== true || voicePreviewPausedPlayback || playbackIsPaused()) return;
    pauseCurrentTrack();
    voicePreviewPausedPlayback = { trackId: state.currentId, requestId: playbackRequestId };
  });
  window.addEventListener("ritmo:voice-preview-end", () => {
    const snapshot = voicePreviewPausedPlayback;
    voicePreviewPausedPlayback = null;
    if (!snapshot || snapshot.trackId !== state.currentId || snapshot.requestId !== playbackRequestId || !playbackIsPaused()) return;
    resumeCurrentTrack();
  });
  document.addEventListener("visibilitychange", () => {
    // WebView/browser timers can be throttled while hidden; resync immediately on return.
    if (!document.hidden && state.nativePlayback.active) startNativePlaybackPolling();
  });
  $("#volume-bar").value = String(audioPrefs.volume);
  try { setOutputVolume(audioPrefs.volume); } catch (error) { console.warn("No se pudo restaurar el volumen inicial; la interfaz seguirá disponible.", error); }
  if (audioPrefs.volume > 0.001) audioPrefs.lastAudibleVolume = audioPrefs.volume;
  document.querySelectorAll("[data-view]").forEach(button => button.addEventListener("click", () => showView(button.dataset.view)));
  document.querySelectorAll("[data-go-view]").forEach(button => button.addEventListener("click", () => showView(button.dataset.goView)));
  ["hero-import", "empty-import", "library-import", "library-empty-import", "offline-import"].forEach(selector => {
    const node = $("#" + selector);
    if (node) node.addEventListener("click", openAudioImport);
  });
  document.querySelectorAll("[data-scan-device-music]").forEach(button => {
    button.addEventListener("click", scanDeviceMusic);
  });
  document.querySelectorAll("[data-pick-audio-folder]").forEach(button => {
    button.addEventListener("click", browseAudioFolder);
  });
  $("#menu-toggle").addEventListener("click", () => setMobileMenuOpen(!$("#sidebar").classList.contains("open")));
  $("#sidebar-scrim").addEventListener("click", () => setMobileMenuOpen(false));
  $("#mobile-more-toggle").addEventListener("click", () => setMobileMenuOpen(!$("#sidebar").classList.contains("open")));
  $("#character-companion-choose").addEventListener("click", () => $("#character-companion-file").click());
  $("#character-companion-file").addEventListener("change", async event => {
    const picker = event.currentTarget;
    try { await chooseCharacterCompanion(picker.files?.[0]); }
    finally { picker.value = ""; }
  });
  $("#character-companion-reset").addEventListener("click", resetCharacterCompanion);
  filePicker.addEventListener("change", async () => { await importFiles(filePicker.files); filePicker.value = ""; });
  folderPicker.addEventListener("change", async () => { await importFiles(folderPicker.files); folderPicker.value = ""; });
  $("#youtube-search-form").addEventListener("submit", event => { event.preventDefault(); searchYoutube(); });
  $("#youtube-mode-toggle").addEventListener("click", () => {
    if (youtubeModeEnabledState) {
      setYoutubeModeEnabled(false);
      return;
    }
    const accepted = window.confirm(
      "¿Activar YouTube dentro de Ritmo?\n\nLas búsquedas y los videos usan Internet y pueden consumir datos móviles. Ritmo no puede anticipar el gasto ni saber siempre si estás en Wi-Fi. Si tu plan es limitado, preferí Wi-Fi.\n\nSin clave API, la consulta se envía a una instancia pública de Invidious; con una clave, se envía a Google. El reproductor integrado de YouTube no puede ofrecer reproducción en segundo plano desde Ritmo.\n\n¿Activar YouTube?"
    );
    if (accepted) setYoutubeModeEnabled(true);
  });
  window.addEventListener("online", updateYoutubeNetworkStatus);
  window.addEventListener("offline", updateYoutubeNetworkStatus);
  const networkInfo = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  networkInfo?.addEventListener?.("change", updateYoutubeNetworkStatus);
  bindOnlineServiceEvents();
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
  $("#playlist-rename-button").addEventListener("click", () => { if (state.currentPlaylistId) void renamePlaylistById(state.currentPlaylistId); });
  $("#playlist-play-all").addEventListener("click", () => {
    const list = state.playlists.find(item => item.id === state.currentPlaylistId);
    if (!list) return;
    const firstTrack = list.trackIds.map(trackId => getTrack(trackId)).find(Boolean);
    if (!firstTrack) { toast("Esta lista no contiene canciones disponibles en la biblioteca."); return; }
    playTrack(firstTrack.id, true, { queueIds: list.trackIds });
  });
  $("#library-search").addEventListener("input", event => {
    state.query = event.target.value;
    renderLibrarySection();
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
    if (Number.isFinite(playbackDuration())) seekPlayback(playbackDuration() * Number(event.target.value) / 1000);
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
    if (!currentTrack() && !youtubeHistory.getCurrentSession() && !(spotifyCurrentEmbed && spotifyControllerReady)) return;
    // A request can be pending while playbackIsPaused() is still true. Treat a tap
    // during that window as cancellation, not as another Play request.
    if (pendingPlaybackRequestId !== null || !playbackIsPaused()) pauseCurrentTrack();
    else resumeCurrentTrack();
    updatePlayer();
  });
  $("#previous-button").addEventListener("click", () => {
    if (playbackCurrentTime() > 3) seekPlayback(0);
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
  $("#seek-bar").addEventListener("input", event => { if (Number.isFinite(playbackDuration())) seekPlayback(playbackDuration() * Number(event.target.value) / 1000); });
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
    if (audio === equalizedAudio && audioContext && !playbackIsPaused() && audioContext.state !== "running") {
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
    if (audioPrefs.equalizerEnabled && audioPrefs.eqPreset === "clean") audioPrefs.eqPreset = "flat";
    saveAudioPreferences();
    syncSettingsUI();
    const track = currentTrack();
    const nativeTrackActive = Boolean(state.nativePlayback.active && track &&
      state.nativePlayback.trackId === track.id && (track.nativeUri || track.nativePath));
    if (nativeTrackActive) {
      try {
        const applied = await applyNativeEqualizerPreferences();
        if (!applied) throw new Error("No se pudo actualizar el ecualizador Android.");
      } catch (error) {
        $("#eq-status").textContent = error.message || "No se pudo cambiar el ecualizador nativo.";
        return;
      }
      $("#eq-status").textContent = audioPrefs.equalizerEnabled
        ? "Preajuste aplicado al reproductor Android; los controles de pantalla bloqueada siguen activos."
        : "Ecualizador desactivado; la reproducción continúa en Android.";
      return;
    }
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
    const control = $("#" + controlId);
    control.addEventListener("input", event => {
      audioPrefs[key] = Number(event.target.value);
      audioPrefs.eqPreset = "custom";
      saveAudioPreferences();
      syncSettingsUI();
    });
    control.addEventListener("change", async () => {
      const track = currentTrack();
      if (!state.nativePlayback.active || !track || state.nativePlayback.trackId !== track.id) return;
      try { await applyNativeEqualizerPreferences(); }
      catch (error) { $("#eq-status").textContent = error.message || "No se pudo actualizar el ecualizador Android."; }
    });
  }
  $("#eq-preset").addEventListener("change", async event => {
    const presetName = event.target.value;
    const selectedSavedProfile = audioPrefs.userEqProfiles.find(profile => "user:" + profile.id === presetName);
    $("#eq-profile-name").value = selectedSavedProfile?.name || "";
    if (presetName === "custom") {
      audioPrefs.eqPreset = "custom";
      saveAudioPreferences();
      return;
    }
    if (presetName === "clean") {
      Object.assign(audioPrefs, {
        eqPreset: "clean", bass: 0, mid: 0, treble: 0,
        equalizerEnabled: false, limiter: false
      });
      saveAudioPreferences();
      syncSettingsUI();
      const track = currentTrack();
      const nativeTrackActive = Boolean(state.nativePlayback.active && track &&
        state.nativePlayback.trackId === track.id && (track.nativeUri || track.nativePath));
      if (nativeTrackActive) {
        try { await applyNativeEqualizerPreferences(); }
        catch (error) { $("#eq-status").textContent = error.message || "No se pudo activar el modo limpio en Android."; return; }
      } else if (track && isLocal(track)) {
        applyCurrentEnginePreference();
      }
      $("#eq-status").textContent = nativeTrackActive
        ? "Modo limpio: ecualizador nativo desactivado. Media3 Android no aplica el limitador suave en esta integración."
        : track && isLocal(track)
          ? "Modo limpio activado: ecualizador y limitador apagados en el procesamiento Web Audio; el archivo original no se modifica."
          : "Modo limpio guardado para archivos locales: ecualizador y limitador desactivados cuando se use el procesamiento Web Audio.";
      return;
    }
    const savedProfile = selectedSavedProfile;
    const values = savedProfile
      ? { bass: savedProfile.bass, mid: savedProfile.mid, treble: savedProfile.treble }
      : getEqualizerPreset(presetName);
    if (!values) {
      audioPrefs.eqPreset = "custom";
      syncSettingsUI();
      return;
    }
    Object.assign(audioPrefs, values, { eqPreset: presetName, equalizerEnabled: true });
    saveAudioPreferences();
    syncSettingsUI();
    const track = currentTrack();
    const nativeTrackActive = Boolean(state.nativePlayback.active && track &&
      state.nativePlayback.trackId === track.id && (track.nativeUri || track.nativePath));
    if (nativeTrackActive) {
      try { await applyNativeEqualizerPreferences(); }
      catch (error) { $("#eq-status").textContent = error.message || "No se pudo aplicar el preajuste Android."; return; }
    } else if (track && isLocal(track)) {
      try { await ensureAudioProcessing(); }
      catch (error) {
        audioPrefs.equalizerEnabled = false;
        saveAudioPreferences();
        syncSettingsUI();
        $("#eq-status").textContent = error.message || "No se pudo iniciar el ecualizador.";
        return;
      }
      applyCurrentEnginePreference();
    }
    const profile = savedProfile
      ? { label: savedProfile.name, description: "Perfil personalizado guardado en este dispositivo." }
      : EQUALIZER_PRESETS[presetName];
    $("#eq-status").textContent = track && isLocal(track)
      ? "Perfil «" + profile.label + "» aplicado a este archivo local. " + profile.description
      : "Perfil «" + profile.label + "» guardado para archivos locales; no procesa fuentes online. " + profile.description;
  });
  $("#eq-profile-save").addEventListener("click", () => {
    const name = String($("#eq-profile-name").value || "").trim().replace(/\s+/g, " ").slice(0, 40);
    if (!name) {
      $("#eq-status").textContent = "Escribí un nombre para guardar el perfil.";
      $("#eq-profile-name").focus();
      return;
    }
    const existing = audioPrefs.userEqProfiles.find(profile =>
      profile.name.toLocaleLowerCase() === name.toLocaleLowerCase()
    );
    if (existing && !window.confirm("«" + existing.name + "» ya existe. ¿Querés reemplazar sus valores por los actuales?")) return;
    const id = existing?.id || ("saved-" + (globalThis.crypto?.randomUUID
      ? crypto.randomUUID()
      : Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10)));
    try {
      audioPrefs.userEqProfiles = upsertSavedEqualizerProfile(audioPrefs.userEqProfiles, {
        id, name, bass: audioPrefs.bass, mid: audioPrefs.mid, treble: audioPrefs.treble
      });
      audioPrefs.eqPreset = "user:" + id;
      saveAudioPreferences();
      syncSettingsUI();
      $("#eq-profile-name").value = name;
      $("#eq-status").textContent = "Perfil «" + name + "» guardado en este dispositivo. Seleccionalo para recuperar estos valores.";
    } catch (error) {
      $("#eq-status").textContent = error?.message || "No se pudo guardar el perfil personalizado.";
    }
  });
  $("#eq-profile-delete").addEventListener("click", () => {
    const selected = $("#eq-preset").value;
    if (!selected.startsWith("user:")) return;
    const id = selected.slice("user:".length);
    const profile = audioPrefs.userEqProfiles.find(item => item.id === id);
    if (!profile || !window.confirm("¿Eliminar el perfil «" + profile.name + "» de este dispositivo?")) return;
    audioPrefs.userEqProfiles = removeSavedEqualizerProfile(audioPrefs.userEqProfiles, id);
    audioPrefs.eqPreset = "custom";
    saveAudioPreferences();
    syncSettingsUI();
    $("#eq-profile-name").value = profile.name;
    $("#eq-status").textContent = "Perfil «" + profile.name + "» eliminado de este dispositivo; no se borró ningún archivo de audio.";
  });
  $("#limiter-toggle").addEventListener("change", event => {
    audioPrefs.limiter = event.target.checked;
    audioPrefs.limiterOptIn = true;
    if (audioPrefs.limiter && audioPrefs.eqPreset === "clean") audioPrefs.eqPreset = "flat";
    saveAudioPreferences();
    syncSettingsUI();
    applyAudioGraphPreferences();
    const track = currentTrack();
    const nativeTrackActive = Boolean(state.nativePlayback.active && track &&
      state.nativePlayback.trackId === track.id && (track.nativeUri || track.nativePath));
    $("#eq-status").textContent = nativeTrackActive
      ? "Preferencia guardada. El limitador suave solo se aplica a archivos locales reproducidos por Web Audio; Media3 Android no ofrece este limitador en la integración actual."
      : (audioPrefs.limiter && !audioPrefs.equalizerEnabled)
        ? "Preferencia guardada. Para aplicarlo, activá también el ecualizador; no se modifica ningún archivo original."
        : "Preferencia guardada. El limitador suave se aplica al procesamiento Web Audio de archivos locales; no cambia el archivo original.";
  });
  $("#eq-reset").addEventListener("click", () => {
    audioPrefs.eqPreset = "flat"; audioPrefs.bass = 0; audioPrefs.mid = 0; audioPrefs.treble = 0; audioPrefs.limiter = false; audioPrefs.limiterOptIn = true;
    saveAudioPreferences(); syncSettingsUI();
    $("#eq-status").textContent = "Ecualizador restablecido al perfil Plano.";
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
    if (event.key === "ArrowRight" && currentTrack() && Number.isFinite(playbackDuration())) seekPlayback(Math.min(playbackDuration(), playbackCurrentTime() + 5));
    if (event.key === "ArrowLeft" && currentTrack()) seekPlayback(Math.max(0, playbackCurrentTime() - 5));
  });
}
const musicFinderController = createMusicFinderController({
  $,
  escapeHTML,
  toast,
  getTracks: () => state.tracks,
  getTrack,
  isLocal,
  playTrack,
  requireInternetMode,
  networkModeIsAvailable
});

async function init() {
  bindEvents();
  updateYoutubeKeyStatus();
  syncYoutubeModeControls();
  syncNetworkModeControls();
  updateConnection();
  if (!youtubeModeEnabledState) setYoutubeStatus("YouTube está apagado para evitar búsquedas y carga de videos sin tu permiso. Activá el interruptor si querés usarlo.", "info");
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    // The new worker skips waiting and claims existing clients. When a tab that
    // already had a controller changes to the new worker, its HTML/JS may still
    // be the old build; prompt a safe, user-initiated reload instead of forcing
    // a reload in the middle of playback.
    const hadController = Boolean(navigator.serviceWorker.controller);
    let updatePromptShown = false;
    serviceWorkerStatus = hadController ? "Controlador activo" : "Registrando…";
    const refreshServiceWorkerDiagnostic = () => {
      if ($("#settings-dialog")?.open) {
        renderDiagnostics().catch(error => console.warn("No se pudo actualizar el diagnóstico del Service Worker.", error));
      }
    };
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      serviceWorkerStatus = "Controlador activo; modo sin conexión disponible";
      if (hadController && !updatePromptShown) {
        updatePromptShown = true;
        $("#app-update-banner").hidden = false;
      }
      refreshServiceWorkerDiagnostic();
    });
    navigator.serviceWorker.register("./sw.js").then(registration => {
      serviceWorkerStatus = registration.active
        ? "Registrado y activo"
        : "Registrado; activación pendiente";
      refreshServiceWorkerDiagnostic();
    }).catch(error => {
      serviceWorkerStatus = "Error de registro; modo sin conexión no garantizado";
      console.warn("No se pudo registrar el Service Worker; el modo sin conexión no está garantizado.", error);
      refreshServiceWorkerDiagnostic();
    });
  } else {
    serviceWorkerStatus = "serviceWorker" in navigator
      ? "Requiere HTTPS o localhost"
      : "No disponible en este navegador";
  }
  const [tracksResult, historyResult, playlistsResult] = await Promise.allSettled([
    getAllTracks(),
    getHistory(250),
    getPlaylists()
  ]);
  if (tracksResult.status === "fulfilled") {
    state.tracks = tracksResult.value;
    try {
      await loadSavedRadioStations(state.tracks);
    } catch (error) {
      toast(error?.message || "No se pudo cargar la colección de radios guardadas.");
    }
    void pruneNativeAudioCache();
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
  void loadSavedCharacterCompanion();
  showView("home");
  window.__ritmoAppReady = true;
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