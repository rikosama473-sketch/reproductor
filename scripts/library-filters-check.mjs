import assert from "node:assert/strict";
import {
  filterAndSortLibraryTracks,
  getLibraryFacetOptions,
  hasActiveLibraryFilters,
  libraryFolderLabel
} from "../src/library-filters.js";

const tracks = [
  { id: "a", title: "Árbol de cristal", artist: "Música Norte", album: "Sueños", genre: "Pop", sourcePath: "C:\\Música\\Árbol.mp3", duration: 210, addedAt: 30 },
  { id: "b", title: "Lluvia", artist: "Sol", album: "Mar", genre: "Rock", sourcePath: "C:\\Música\\Lluvia.mp3", duration: 150, addedAt: 10 },
  { id: "c", title: "Bruma", artist: "Música Norte", album: "Noche", genre: "Ambient", sourcePath: "D:/Archivo/Bruma.mp3", duration: 95, addedAt: 20 },
  { id: "d", title: "Sin datos", artist: "", album: "", genre: "", sourcePath: "sin-carpeta.mp3", addedAt: 5 }
];

assert.equal(libraryFolderLabel(tracks[0]), "C:/Música");
assert.equal(libraryFolderLabel(tracks[2]), "D:/Archivo");
assert.equal(libraryFolderLabel(tracks[3]), "Sin carpeta");
assert.deepEqual(getLibraryFacetOptions(tracks, "artist"), ["Música Norte", "Sol"]);
assert.deepEqual(getLibraryFacetOptions(tracks, "genre"), ["Ambient", "Pop", "Rock"]);
assert.deepEqual(getLibraryFacetOptions(tracks, "folder"), ["C:/Música", "D:/Archivo", "Sin carpeta"]);
assert.deepEqual(filterAndSortLibraryTracks(tracks, { artist: "musica norte", genre: "pop" }).map(t => t.id), ["a"]);
assert.deepEqual(filterAndSortLibraryTracks(tracks, { query: "arbol" }).map(t => t.id), ["a"]);
assert.deepEqual(filterAndSortLibraryTracks(tracks, { folder: "c:\\música", sort: "title-asc" }).map(t => t.id), ["a", "b"]);
assert.deepEqual(filterAndSortLibraryTracks(tracks, { sort: "title-asc" }).map(t => t.id), ["a", "c", "b", "d"]);
assert.deepEqual(filterAndSortLibraryTracks(tracks, { sort: "duration-asc" }).map(t => t.id), ["c", "b", "a", "d"]);
assert.deepEqual(filterAndSortLibraryTracks(tracks, { sort: "duration-desc" }).map(t => t.id), ["a", "b", "c", "d"]);
assert.equal(hasActiveLibraryFilters({ sort: "artist-asc" }), false);
assert.equal(hasActiveLibraryFilters({ album: "Sueños" }), true);
assert.deepEqual(filterAndSortLibraryTracks(null), []);
console.log("Library facets, accent-insensitive filters, folder grouping and stable sort checks passed.");
