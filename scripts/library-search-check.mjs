import assert from "node:assert/strict";
import { matchesLibrarySearch, normalizeLibrarySearchText } from "../src/library-search.js";

assert.equal(normalizeLibrarySearchText("MÚSICA"), "musica");
assert.equal(normalizeLibrarySearchText("  MúsIca   Rápida  "), "musica rapida");
assert.equal(normalizeLibrarySearchText("N\u0303andú"), "ñandu", "Decomposed ñ should normalize the same as composed ñ");
assert.equal(normalizeLibrarySearchText("Ñandú"), "ñandu");
assert.notEqual(normalizeLibrarySearchText("ano"), normalizeLibrarySearchText("año"),
  "Spanish ñ must remain distinct from n");

const track = {
  title: "Canción de Música",
  artist: "Niña del Mar",
  album: "Álbum: Raíces",
  name: "Cancion_de_Musica.mp3",
  sourcePath: "C:/Audio/Latino"
};
assert.equal(matchesLibrarySearch(track, "musica"), true, "Unaccented queries must match accented song titles");
assert.equal(matchesLibrarySearch(track, "MÚSICA"), true, "Matching is case insensitive");
assert.equal(matchesLibrarySearch(track, "niña del"), true, "Exact Spanish ñ should remain searchable");
assert.equal(matchesLibrarySearch(track, "nina del"), false, "Search keeps ñ distinct from n");
assert.equal(matchesLibrarySearch(track, "raices"), true, "Accent-insensitive matching should cover album metadata");
assert.equal(matchesLibrarySearch(track, "audio latino"), true, "Multi-word search should span source path metadata");
assert.equal(matchesLibrarySearch(track, "musica.mp3"), true, "File names remain searchable");
assert.equal(matchesLibrarySearch(track, "año"), false, "Queries preserve meaningful ñ/n distinctions");
assert.equal(matchesLibrarySearch({ title: "El año perdido" }, "ano"), false);
assert.equal(matchesLibrarySearch({ title: "El año perdido" }, "año"), true);
assert.equal(matchesLibrarySearch(track, "   "), true, "An empty query leaves the library unfiltered");
assert.equal(matchesLibrarySearch(null, "musica"), false);
assert.equal(matchesLibrarySearch(track, null), true);

console.log("Library-search checks passed: accent/case folding, Spanish ñ distinction, NFC/NFD text, multi-field search and empty-query behavior.");
