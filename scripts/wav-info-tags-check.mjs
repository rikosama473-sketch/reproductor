import assert from "node:assert/strict";
import {
  MAX_WAV_INFO_CHUNKS,
  MAX_WAV_METADATA_BYTES,
  isWavMetadataFilename,
  parseWavInfoComments,
  readWavInfoMetadata
} from "../src/wav-info-tags.js";

function ascii(value) {
  return Uint8Array.from([...value].map(char => char.charCodeAt(0)));
}
function uint32(value) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return bytes;
}
function join(parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}
function chunk(id, payload) {
  return join([ascii(id), uint32(payload.length), payload, ...(payload.length & 1 ? [Uint8Array.of(0)] : [])]);
}
function infoField(id, value) {
  return chunk(id, join([new TextEncoder().encode(value), Uint8Array.of(0)]));
}
function infoList(fields) { return chunk("LIST", join([ascii("INFO"), ...fields])); }
function wav(chunks) {
  const body = join([ascii("WAVE"), ...chunks]);
  return join([ascii("RIFF"), uint32(body.length), body]);
}

assert.equal(isWavMetadataFilename("song.wav"), true);
assert.equal(isWavMetadataFilename("LIVE.WAVE"), true);
assert.equal(isWavMetadataFilename("song.flac"), false);
assert.equal(MAX_WAV_METADATA_BYTES, 2 * 1024 * 1024);
assert.ok(MAX_WAV_INFO_CHUNKS >= 1024);

{
  const sample = wav([infoList([
    infoField("INAM", "Tema de prueba"),
    infoField("IART", "Riko"),
    infoField("IPRD", "Álbum de prueba"),
    infoField("IGNR", "Rock"),
    infoField("ICMT", "campo no usado")
  ])]);
  const metadata = parseWavInfoComments(sample, { title: "Nombre de archivo", artist: "Artista desconocido" });
  assert.equal(metadata.title, "Tema de prueba");
  assert.equal(metadata.artist, "Riko");
  assert.equal(metadata.album, "Álbum de prueba");
  assert.equal(metadata.genre, "Rock");
}
{
  const metadata = parseWavInfoComments(wav([infoList([infoField("IGNR", "17")])]), { genre: "Metal" });
  assert.equal(metadata.genre, "Rock", "WAV numeric genre tags should match ID3 genre mapping.");
  const compound = parseWavInfoComments(wav([infoList([infoField("IGNR", "pop / funk")])]), {});
  assert.equal(compound.genre, "Pop/Funk", "WAV must preserve compound genre labels.");
  const mixedCompound = parseWavInfoComments(wav([infoList([infoField("IGNR", "Jazz, pop / funk")])]), {});
  assert.equal(mixedCompound.genre, "Jazz / Pop/Funk", "WAV multi-genre tags must keep compound labels intact.");
  const unsupported = parseWavInfoComments(wav([infoList([infoField("IGNR", "193")])]), { genre: "Metal" });
  assert.equal(unsupported.genre, "Metal", "An unknown numeric genre must not erase fallback metadata.");
}
{
  const sample = wav([infoList([
    infoField("INAM", "  Primera canción  \0"),
    infoField("INAM", "No debería reemplazarla"),
    infoField("IART", "Artista\n principal")
  ])]);
  const metadata = parseWavInfoComments(sample);
  assert.equal(metadata.title, "Primera canción");
  assert.equal(metadata.artist, "Artista principal");
}
{
  const sample = wav([chunk("JUNK", Uint8Array.of(1, 2, 3)), infoList([infoField("IART", "Artista tras JUNK")])]);
  assert.equal(parseWavInfoComments(sample).artist, "Artista tras JUNK");
}
{
  assert.deepEqual(parseWavInfoComments(ascii("NOT A WAVE FILE")), {});
  const badInfo = join([ascii("INFO"), ascii("INAM"), uint32(4096), ascii("short")]);
  assert.deepEqual(parseWavInfoComments(wav([chunk("LIST", badInfo)]), { title: "Fallback" }), { title: "Fallback" });
}
// A 2 MiB audio payload precedes the INFO list. The reader must skip the sample
// chunk by offset instead of reading it and still find the metadata that follows.
{
  const data = new Uint8Array(2 * 1024 * 1024 + 32);
  const largeWav = new Blob([wav([
    chunk("data", data),
    infoList([infoField("INAM", "Después del audio"), infoField("IART", "Intérprete")])
  ])]);
  const metadata = await readWavInfoMetadata(largeWav, { artist: "Desconocido" });
  assert.equal(metadata.title, "Después del audio");
  assert.equal(metadata.artist, "Intérprete");
}
// Count requested Blob ranges and make sure the payload itself isn't read.
{
  const data = new Uint8Array(512 * 1024);
  const backing = new Blob([wav([chunk("data", data), infoList([infoField("INAM", "Lectura por offset")])])]);
  const requested = [];
  const tracked = {
    size: backing.size,
    slice(start, end) { requested.push({ start, end, size: end - start }); return backing.slice(start, end); }
  };
  assert.equal((await readWavInfoMetadata(tracked)).title, "Lectura por offset");
  assert.ok(requested.every(request => request.size <= MAX_WAV_METADATA_BYTES), "Metadata reads must be bounded.");
  assert.ok(!requested.some(request => request.start >= 20 && request.start < 20 + data.length && request.size > 8),
    "Raw sample bytes must not be read to inspect metadata.");
}
// The total byte budget includes RIFF headers as well as LIST payloads.
{
  const nearLimitPayload = join([
    ascii("adtl"),
    new Uint8Array(MAX_WAV_METADATA_BYTES - 24)
  ]);
  const backing = new Blob([wav([
    chunk("LIST", nearLimitPayload),
    infoList([infoField("INAM", "No debe leerse fuera del presupuesto")])
  ])]);
  const requested = [];
  const tracked = {
    size: backing.size,
    slice(start, end) { requested.push({ start, end, size: end - start }); return backing.slice(start, end); }
  };
  const metadata = await readWavInfoMetadata(tracked, { title: "Fallback" });
  assert.equal(metadata.title, "Fallback", "Metadata beyond the read budget must not be scanned.");
  assert.ok(requested.reduce((sum, range) => sum + range.size, 0) <= MAX_WAV_METADATA_BYTES,
    "The reader's aggregate Blob reads must never exceed the metadata budget.");
}
{
  assert.deepEqual(await readWavInfoMetadata(new Blob(["not a WAV file"]), { title: "Fallback" }), { title: "Fallback" });
  assert.deepEqual(await readWavInfoMetadata(null, { title: "Fallback" }), { title: "Fallback" });
}
console.log("WAV INFO metadata tests passed: fields, padding, malformed chunks, bounded offset reads and metadata after large audio payloads.");
