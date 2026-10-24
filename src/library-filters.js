import { matchesLibrarySearch, normalizeLibrarySearchText } from "./library-search.js";

export const LIBRARY_SORT_OPTIONS = Object.freeze([
  { value: "added", label: "Más recientes" },
  { value: "title-asc", label: "Título A–Z" },
  { value: "artist-asc", label: "Artista A–Z" },
  { value: "album-asc", label: "Álbum A–Z" },
  { value: "duration-asc", label: "Duración: menor primero" },
  { value: "duration-desc", label: "Duración: mayor primero" }
]);

const FACET_FIELDS = Object.freeze(["artist", "album", "genre", "folder"]);

function cleanFacet(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function libraryFolderLabel(track) {
  const explicit = cleanFacet(track?.folder);
  if (explicit) return explicit;
  const sourcePath = cleanFacet(track?.sourcePath || track?.relativePath || "");
  if (!sourcePath) return "Sin carpeta";
  const normalized = sourcePath.replace(/\\/g, "/").replace(/\/+$/, "");
  const slash = normalized.lastIndexOf("/");
  if (slash < 0) return "Sin carpeta";
  return normalized.slice(0, slash) || "Carpeta raíz";
}

export function libraryFacetValue(track, field) {
  if (!track || typeof track !== "object") return "";
  if (field === "folder") return libraryFolderLabel(track);
  return cleanFacet(track[field]);
}

export function getLibraryFacetOptions(tracks, field) {
  if (!FACET_FIELDS.includes(field) || !Array.isArray(tracks)) return [];
  const unique = new Map();
  for (const track of tracks) {
    const value = libraryFacetValue(track, field);
    if (!value) continue;
    const key = normalizeLibrarySearchText(value);
    if (key && !unique.has(key)) unique.set(key, value);
  }
  return [...unique.values()].sort((a, b) =>
    normalizeLibrarySearchText(a).localeCompare(normalizeLibrarySearchText(b), "es", { sensitivity: "base" })
  );
}

function compareText(a, b) {
  return normalizeLibrarySearchText(a).localeCompare(normalizeLibrarySearchText(b), "es", {
    sensitivity: "base", numeric: true
  });
}

function sortTracks(tracks, sort) {
  const safeSort = LIBRARY_SORT_OPTIONS.some(option => option.value === sort) ? sort : "added";
  const indexed = tracks.map((track, index) => ({ track, index }));
  indexed.sort((left, right) => {
    const a = left.track;
    const b = right.track;
    if (safeSort === "added") {
      const diff = (Number(b?.addedAt) || 0) - (Number(a?.addedAt) || 0);
      return diff || left.index - right.index;
    }
    if (safeSort === "duration-asc" || safeSort === "duration-desc") {
      const da = Number(a?.duration);
      const db = Number(b?.duration);
      const validA = Number.isFinite(da) && da >= 0;
      const validB = Number.isFinite(db) && db >= 0;
      if (validA !== validB) return validA ? -1 : 1;
      if (!validA) return left.index - right.index;
      const diff = safeSort === "duration-asc" ? da - db : db - da;
      return diff || left.index - right.index;
    }
    const field = safeSort.startsWith("title") ? "title" : safeSort.startsWith("artist") ? "artist" : "album";
    const va = cleanFacet(a?.[field]);
    const vb = cleanFacet(b?.[field]);
    if (!va && vb) return 1;
    if (va && !vb) return -1;
    return compareText(va, vb) || left.index - right.index;
  });
  return indexed.map(entry => entry.track);
}

export function filterAndSortLibraryTracks(tracks, filters = {}) {
  if (!Array.isArray(tracks)) return [];
  let result = tracks.filter(track => {
    if (filters.query && !matchesLibrarySearch(track, filters.query)) return false;
    for (const field of FACET_FIELDS) {
      const selected = cleanFacet(filters[field]);
      if (selected && normalizeLibrarySearchText(libraryFacetValue(track, field)) !== normalizeLibrarySearchText(selected)) return false;
    }
    return true;
  });
  return sortTracks(result, filters.sort);
}

export function hasActiveLibraryFilters(filters = {}) {
  return Boolean(String(filters.query ?? "").trim() ||
    FACET_FIELDS.some(field => cleanFacet(filters[field])));
}
