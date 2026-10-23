/**
 * Normalize library-search text without mutating the original metadata.
 * Accented vowels compare with their unaccented forms, but Spanish ñ remains
 * distinct from n so searches keep their meaning.
 */
export function normalizeLibrarySearchText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/n\u0303/gi, "ñ")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[_.\/\\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase();
}

/**
 * Match title, artist, album and source labels in the local library.
 * Joining fields keeps multi-word queries working across the same metadata
 * boundaries that the old implementation searched.
 */
export function matchesLibrarySearch(track, query) {
  const normalizedQuery = normalizeLibrarySearchText(query);
  if (!normalizedQuery) return true;
  if (!track || typeof track !== "object") return false;
  const searchable = [track.title, track.artist, track.album, track.name, track.sourcePath]
    .filter(value => value !== null && value !== undefined && String(value).trim() !== "")
    .map(String)
    .join(" ");
  return normalizeLibrarySearchText(searchable).includes(normalizedQuery);
}
