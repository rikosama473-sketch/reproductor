export const MAX_PLAYLIST_NAME_LENGTH = 80;
export function normalizePlaylistName(value) {
  if (typeof value !== "string") throw new TypeError("El nombre de la lista no es válido.");
  const name = value.normalize("NFC").trim().replace(/\s+/gu, " ");
  if (!name) throw new TypeError("Escribí un nombre para la lista.");
  if (Array.from(name).length > MAX_PLAYLIST_NAME_LENGTH) throw new RangeError("El nombre de la lista no puede superar los 80 caracteres.");
  return name;
}
function assertPlaylist(playlist) {
  if (!playlist || typeof playlist !== "object" || Array.isArray(playlist) ||
      typeof playlist.id !== "string" || !playlist.id.trim() || !Array.isArray(playlist.trackIds)) {
    throw new TypeError("La lista de reproducción no es válida.");
  }
}
function normalizeUpdatedAt(value) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp < 0) throw new TypeError("La fecha de modificación de la lista no es válida.");
  return timestamp;
}
export function renamePlaylist(playlist, name, updatedAt = Date.now()) {
  assertPlaylist(playlist);
  return { ...playlist, name: normalizePlaylistName(name), updatedAt: normalizeUpdatedAt(updatedAt) };
}
export function movePlaylistTrack(playlist, trackId, direction, updatedAt = Date.now()) {
  assertPlaylist(playlist);
  if (direction !== -1 && direction !== 1) throw new TypeError("La dirección debe ser -1 (arriba) o 1 (abajo).");
  const from = playlist.trackIds.indexOf(trackId);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= playlist.trackIds.length) return null;
  const trackIds = [...playlist.trackIds];
  [trackIds[from], trackIds[to]] = [trackIds[to], trackIds[from]];
  return { ...playlist, trackIds, updatedAt: normalizeUpdatedAt(updatedAt) };
}
export function removePlaylistTrack(playlist, trackId, updatedAt = Date.now()) {
  assertPlaylist(playlist);
  if (!playlist.trackIds.includes(trackId)) return null;
  return { ...playlist, trackIds: playlist.trackIds.filter(id => id !== trackId), updatedAt: normalizeUpdatedAt(updatedAt) };
}
