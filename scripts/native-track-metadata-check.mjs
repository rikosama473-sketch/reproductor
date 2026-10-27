import assert from "node:assert/strict";
import { mergeNativeTrackMetadata } from "../src/native-track-metadata.js";

// Legacy tracks have no override markers yet. Keep existing corrections when SAF
// only supplies the filename as a title and a generic artist placeholder.
{
  const result = mergeNativeTrackMetadata(
    { title: "Título corregido", artist: "Artista corregido", album: "Álbum conservado", genre: "Rock" },
    { title: "Tema", artist: "Artista desconocido", album: "" },
    "Tema"
  );
  assert.deepEqual(result, {
    title: "Título corregido",
    artist: "Artista corregido",
    album: "Álbum conservado",
    genre: "Rock"
  });
}

// Real provider metadata refreshes untouched fields.
{
  const result = mergeNativeTrackMetadata(
    { title: "Título anterior", artist: "Artista anterior", album: "Álbum anterior", genre: "Rock" },
    { title: "Título de etiquetas", artist: "Artista de etiquetas", album: "Álbum actualizado", genre: "Jazz" },
    "nombre-del-archivo"
  );
  assert.deepEqual(result, {
    title: "Título de etiquetas",
    artist: "Artista de etiquetas",
    album: "Álbum actualizado",
    genre: "Jazz"
  });
}

// Once the user explicitly edits a field, future scans must not overwrite it
// even when the device reports new valid tags. Intentionally blank fields stay blank.
{
  const result = mergeNativeTrackMetadata(
    {
      title: "Mi título",
      artist: "Mi artista",
      album: "",
      genre: "Mi género",
      userMetadataOverrides: { title: true, artist: true, album: true, genre: true }
    },
    { title: "Nuevo título", artist: "Nuevo artista", album: "Nuevo álbum", genre: "Nuevo género" },
    "nombre"
  );
  assert.deepEqual(result, { title: "Mi título", artist: "Mi artista", album: "", genre: "Mi género" });
}

// The policy is per field: a manually edited artist survives, while untouched
// title and album can still refresh from useful provider metadata.
{
  const result = mergeNativeTrackMetadata(
    { title: "Título anterior", artist: "Artista manual", album: "Álbum anterior", userMetadataOverrides: { artist: true } },
    { title: "Título real", artist: "Artista nuevo", album: "Álbum nuevo" },
    "nombre"
  );
  assert.deepEqual(result, {
    title: "Título real",
    artist: "Artista manual",
    album: "Álbum nuevo",
    genre: ""
  });
}

// MediaStore may return the literal "<unknown>" title token. It must not replace
// a useful title or leak into the visible library when a filename fallback exists.
{
  const kept = mergeNativeTrackMetadata(
    { title: "Título que ya servía", artist: "Artista" },
    { title: "<unknown>", artist: "Artista", album: "" },
    "cancion"
  );
  assert.equal(kept.title, "Título que ya servía",
    "A generic MediaStore title must not overwrite the saved title.");

  const fallback = mergeNativeTrackMetadata(
    { title: "<unknown>", artist: "Artista" },
    { title: "<unknown>", artist: "Artista desconocido" },
    "cancion"
  );
  assert.equal(fallback.title, "cancion",
    "When no useful title exists, use the filename fallback instead of the provider placeholder.");
  assert.equal(fallback.artist, "Artista",
    "The existing artist should still survive a generic provider response.");
}

// An explicit title override wins even if its text happens to match the generic token.
{
  const result = mergeNativeTrackMetadata(
    { title: "<unknown>", userMetadataOverrides: { title: true } },
    { title: "Título real" },
    "archivo"
  );
  assert.equal(result.title, "<unknown>",
    "A user override is authoritative, including an intentionally unusual or blank value.");
}

// MediaStore genre values use the same normalization as imported file metadata.
{
  const mapped = mergeNativeTrackMetadata(
    { title: "Tema", artist: "Artista", genre: "Jazz" },
    { title: "Tema", artist: "Artista", genre: "17" },
    "Tema"
  );
  assert.equal(mapped.genre, "Rock", "Native numeric genre codes should be canonicalized.");
  const unknown = mergeNativeTrackMetadata(
    { title: "Tema", artist: "Artista", genre: "Jazz" },
    { title: "Tema", artist: "Artista", genre: "193" },
    "Tema"
  );
  assert.equal(unknown.genre, "Jazz", "Unknown native genre codes must not overwrite valid metadata.");
  const compound = mergeNativeTrackMetadata(
    { title: "Tema", artist: "Artista", genre: "" },
    { title: "Tema", artist: "Artista", genre: "pop / funk" },
    "Tema"
  );
  assert.equal(compound.genre, "Pop/Funk", "Native tags should retain a known compound genre.");
  const mixed = mergeNativeTrackMetadata(
    { title: "Tema", artist: "Artista", genre: "" },
    { title: "Tema", artist: "Artista", genre: "Jazz, pop / funk" },
    "Tema"
  );
  assert.equal(mixed.genre, "Jazz / Pop/Funk", "Native multi-genre tags must preserve compound labels.");
}
console.log("Native metadata merge checks passed: legacy fallback preservation, genre canonicalization, real tag refresh, and per-field user overrides.");
