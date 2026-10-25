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

console.log("Native metadata merge checks passed: legacy fallback preservation, real tag refresh, and per-field user overrides.");
