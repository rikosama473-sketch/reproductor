import { normalizeId3Genre } from "./music-genres.js";

const GENERIC_ARTIST = "Artista desconocido";

function usableGenre(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const normalized = normalizeId3Genre(raw);
  if (normalized) return normalized;
  // A bare unknown numeric value is an unsupported legacy code, not a genre.
  return /^\(?[0-9]{1,3}\)?$/.test(raw) ? "" : raw;
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

/**
 * Merge metadata discovered during a native Android scan without undoing
 * fields a user explicitly edited in Ritmo. Legacy tracks also keep their
 * existing title/artist when a provider only returns filename-based or generic
 * fallback values instead of real tags.
 */
export function mergeNativeTrackMetadata(existingTrack, discoveredTrack, fallbackTitle = "") {
  const existing = record(existingTrack);
  const discovered = record(discoveredTrack);
  const overrides = record(existing.userMetadataOverrides);

  const existingTitle = String(existing.title ?? "");
  const discoveredTitle = String(discovered.title ?? "").trim();
  const fallback = String(fallbackTitle ?? "").trim();
  const discoveredTitleIsGeneric = discoveredTitle.toLowerCase() === "<unknown>";
  const existingTitleIsGeneric = existingTitle.trim().toLowerCase() === "<unknown>";
  let title;
  if (overrides.title === true) {
    title = existingTitle;
  } else if (discoveredTitle && !discoveredTitleIsGeneric && discoveredTitle !== fallback) {
    title = discoveredTitle;
  } else {
    // MediaStore can expose the literal "<unknown>" placeholder. Prefer a
    // previous useful title, then the filename-derived fallback, over that token.
    title = (existingTitle && !existingTitleIsGeneric ? existingTitle : "") ||
      fallback || discoveredTitle || "";
  }

  const existingArtist = String(existing.artist ?? "");
  const discoveredArtist = String(discovered.artist ?? "").trim();
  let artist;
  if (overrides.artist === true) {
    artist = existingArtist;
  } else if (discoveredArtist && discoveredArtist !== GENERIC_ARTIST) {
    artist = discoveredArtist;
  } else {
    artist = existingArtist || discoveredArtist || GENERIC_ARTIST;
  }

  const existingAlbum = String(existing.album ?? "");
  const discoveredAlbum = String(discovered.album ?? "").trim();
  const album = overrides.album === true ? existingAlbum : (discoveredAlbum || existingAlbum);

  const existingGenre = String(existing.genre ?? "");
  const discoveredGenre = usableGenre(discovered.genre);
  const normalizedExistingGenre = usableGenre(existingGenre);
  const genre = overrides.genre === true
    ? existingGenre
    : (discoveredGenre || normalizedExistingGenre || existingGenre);

  return { title, artist, album, genre };
}
