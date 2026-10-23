export const MUSIC_RECOGNITION_TOKEN_STORAGE_KEY = "ritmo.music-recognition-token.v1";
export const MUSIC_RECOGNITION_RECORDING_MS = 8000;
export const MUSIC_RECOGNITION_MAX_RESULT_TEXT = 240;

const MUSIC_SOURCE_HOSTS = Object.freeze([
  "youtube.com",
  "spotify.com",
  "music.apple.com",
  "apple.com",
  "mzstatic.com",
  "itunes.apple.com",
  "deezer.com",
  "musicbrainz.org",
  "bandcamp.com",
  "lis.tn",
  "song.link"
]);

function getStorage(storage) {
  if (storage !== undefined) return storage;
  try { return globalThis.localStorage; } catch { return null; }
}

function cleanText(value, maxLength = MUSIC_RECOGNITION_MAX_RESULT_TEXT) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

export function normalizeMusicRecognitionToken(value) {
  const token = String(value ?? "").trim();
  if (!token || token.length > 512 || /[\r\n\t]/.test(token)) return "";
  return token;
}

export function readMusicRecognitionToken(storage) {
  try {
    return normalizeMusicRecognitionToken(getStorage(storage)?.getItem(MUSIC_RECOGNITION_TOKEN_STORAGE_KEY));
  } catch {
    return "";
  }
}

export function persistMusicRecognitionToken(value, storage) {
  const token = normalizeMusicRecognitionToken(value);
  if (!token) return false;
  try {
    const target = getStorage(storage);
    if (!target || typeof target.setItem !== "function") return false;
    target.setItem(MUSIC_RECOGNITION_TOKEN_STORAGE_KEY, token);
    return true;
  } catch {
    return false;
  }
}

export function clearMusicRecognitionToken(storage) {
  try {
    const target = getStorage(storage);
    if (!target || typeof target.removeItem !== "function") return false;
    target.removeItem(MUSIC_RECOGNITION_TOKEN_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

export function normalizeMusicSourceUrl(value) {
  if (typeof value !== "string" || !value.trim() || value.length > 2048) return "";
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return "";
    const host = url.hostname.toLowerCase();
    if (!MUSIC_SOURCE_HOSTS.some(allowed => host === allowed || host.endsWith("." + allowed))) return "";
    return url.href;
  } catch {
    return "";
  }
}

export function buildMusicSearchSources(query) {
  const value = cleanText(query, 180);
  if (!value) return [];
  const term = encodeURIComponent(value);
  return [
    { id: "youtube", label: "YouTube", description: "Videos y grabaciones", url: "https://www.youtube.com/results?search_query=" + term },
    { id: "spotify", label: "Spotify", description: "Canciones y álbumes", url: "https://open.spotify.com/search/" + term },
    { id: "apple-music", label: "Apple Music", description: "Ediciones y catálogo", url: "https://music.apple.com/search?term=" + term },
    { id: "deezer", label: "Deezer", description: "Canciones y álbumes", url: "https://www.deezer.com/search/" + term },
    { id: "musicbrainz", label: "MusicBrainz", description: "Metadatos y grabaciones", url: "https://musicbrainz.org/search?query=" + term + "&type=recording&method=indexed" },
    { id: "bandcamp", label: "Bandcamp", description: "Lanzamientos independientes", url: "https://bandcamp.com/search?q=" + term }
  ];
}

function source(label, rawUrl, id) {
  const url = normalizeMusicSourceUrl(rawUrl);
  return url ? { id, label, url } : null;
}

export function normalizeMusicRecognitionResult(payload) {
  if (!payload || typeof payload !== "object") throw new TypeError("El servicio devolvió una respuesta que no es válida.");
  if (String(payload.status || "").toLowerCase() !== "success") {
    const error = payload.error;
    const message = typeof error === "string" ? error : (error?.error_message || error?.message || payload.message);
    throw new Error(cleanText(message, 300) || "El servicio de reconocimiento rechazó la solicitud. Revisá el token y el límite de uso.");
  }
  const result = payload.result;
  if (!result || typeof result !== "object") return null;

  const title = cleanText(result.title);
  const artist = cleanText(result.artist);
  if (!title || !artist) return null;

  const apple = result.apple_music && typeof result.apple_music === "object" ? result.apple_music : null;
  const spotify = result.spotify && typeof result.spotify === "object" ? result.spotify : null;
  const deezer = result.deezer && typeof result.deezer === "object" ? result.deezer : null;
  const musicbrainz = Array.isArray(result.musicbrainz) ? result.musicbrainz : [];
  const artworkTemplate = cleanText(apple?.artwork?.url, 2048);
  const artworkUrl = artworkTemplate
    ? normalizeMusicSourceUrl(artworkTemplate.replace(/\{w\}/g, "320").replace(/\{h\}/g, "320"))
    : "";
  const previewUrl = normalizeMusicSourceUrl(apple?.previews?.[0]?.url);

  const sources = [
    source("Apple Music", apple?.url, "apple-music"),
    source("Spotify", spotify?.external_urls?.spotify || spotify?.track?.external_urls?.spotify, "spotify"),
    source("Deezer", deezer?.link || deezer?.url, "deezer"),
    source("Ficha de reconocimiento", result.song_link, "recognition")
  ].filter(Boolean);

  const recordingId = cleanText(musicbrainz[0]?.id || musicbrainz[0]?.recording?.id, 80);
  if (/^[a-f0-9-]{32,36}$/i.test(recordingId)) {
    sources.push({ id: "musicbrainz-recording", label: "MusicBrainz", url: "https://musicbrainz.org/recording/" + encodeURIComponent(recordingId) });
  }

  return {
    title,
    artist,
    album: cleanText(result.album),
    releaseDate: cleanText(result.release_date || apple?.releaseDate),
    label: cleanText(result.label),
    timecode: cleanText(result.timecode, 40),
    isrc: cleanText(result.isrc || spotify?.external_ids?.isrc || apple?.isrc, 32),
    artworkUrl,
    previewUrl,
    sources,
    searchSources: buildMusicSearchSources(artist + " " + title)
  };
}
