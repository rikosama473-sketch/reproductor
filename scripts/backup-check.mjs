import assert from "node:assert/strict";
import {
  createRitmoBackup,
  parseRitmoBackup,
  MAX_BACKUP_AUDIO_BYTES,
  RITMO_BACKUP_FORMAT
} from "../src/backup.js";

const audioBytes = Uint8Array.from([0, 1, 2, 44, 128, 255]);
const coverBytes = Uint8Array.from([10, 20, 30, 40]);
const characterBytes = Uint8Array.from([80, 90, 100, 110, 120]);
const audio = new Blob([audioBytes], { type: "audio/mpeg" });
const artwork = new Blob([coverBytes], { type: "image/png" });
const character = new Blob([characterBytes], { type: "image/png" });
const fixture = {
  tracks: [
    {
      id: "track-1", kind: "file", name: "theme.mp3", title: "Theme",
      artist: "Artist", favorite: true, addedAt: 1, size: audio.size,
      blob: audio, artworkBlob: artwork, nativePath: "/private/Music/theme.mp3",
      nativeUri: "content://private/theme"
    },
    { id: "track-2", kind: "url", url: "https://example.org/music.ogg", title: "Online track" }
  ],
  history: [{ id: "history-1", trackId: "track-1", playedAt: 10 }],
  playlists: [{ id: "playlist-1", name: "Favorites", trackIds: ["track-1"], updatedAt: 11 }],
  settings: [
    { key: "character-companion", value: { fileName: "pibara.png", blob: character } },
    { key: "youtube-api-key", value: "must-not-export-this" }
  ],
  preferences: [
    { key: "ritmo.audio-preferences.v1", value: '{"volume":0.5}' },
    { key: "ritmo.music-recognition-token.v1", value: "secret-token" },
    { key: "third-party.private", value: "ignore" }
  ]
};

const metadataBackup = await createRitmoBackup({ ...fixture, now: 0 });
const metadataDocument = JSON.parse(metadataBackup.json);
assert.equal(metadataDocument.format, RITMO_BACKUP_FORMAT);
assert.equal(metadataDocument.version, 1);
assert.equal(metadataDocument.includesAudio, false);
assert.equal(metadataDocument.counts.tracks, 2);
assert.equal(metadataBackup.filename, "ritmo-respaldo-1970-01-01.json");
assert.ok(!metadataBackup.json.includes("must-not-export-this"), "API-key settings must be excluded");
assert.ok(!metadataBackup.json.includes("secret-token"), "Token preferences must be excluded");
assert.ok(!metadataBackup.json.includes("/private/Music/theme.mp3"), "Native paths must not be exported");
assert.ok(!metadataBackup.json.includes("content://private/theme"), "Native URIs must not be exported");

const parsedMetadata = await parseRitmoBackup(metadataBackup.json);
assert.equal(parsedMetadata.tracks[0].audioMissingInBackup, true);
assert.equal(parsedMetadata.tracks[0].blob, undefined, "Metadata-only backups must omit audio bytes");
assert.ok(parsedMetadata.tracks[0].artworkBlob instanceof Blob, "Small embedded artwork should be retained");
assert.equal(parsedMetadata.tracks[0].nativePath, undefined, "Imported tracks must not inherit device paths from a file");
assert.ok(parsedMetadata.settings[0].value.blob instanceof Blob, "A user-selected character image must be backed up");
assert.deepEqual(parsedMetadata.preferences.map(item => item.key), ["ritmo.audio-preferences.v1"]);
assert.equal(parsedMetadata.history.length, 1);
assert.equal(parsedMetadata.playlists[0].trackIds[0], "track-1");

const fullBackup = await createRitmoBackup({ ...fixture, includeAudio: true, now: 1000 });
assert.equal(fullBackup.stats.includesAudio, true);
assert.equal(fullBackup.stats.audioBytes, audio.size);
const parsedFull = await parseRitmoBackup(fullBackup.json);
assert.ok(parsedFull.tracks[0].blob instanceof Blob, "Full backups must round-trip local audio");
assert.equal(parsedFull.tracks[0].blob.type, "audio/mpeg");
assert.deepEqual([...new Uint8Array(await parsedFull.tracks[0].blob.arrayBuffer())], [...audioBytes]);
assert.equal(parsedFull.tracks[0].audioMissingInBackup, undefined);

await assert.rejects(
  () => createRitmoBackup({
    tracks: [{ id: "large", kind: "file", blob: new Blob([new Uint8Array(MAX_BACKUP_AUDIO_BYTES + 1)]) }],
    includeAudio: true
  }),
  /supera 18 MiB/
);
await assert.rejects(() => parseRitmoBackup("not-json"), /JSON válido/);
await assert.rejects(() => parseRitmoBackup(JSON.stringify({ format: "other", version: 1, data: {} })), /no es un respaldo reconocido/);
await assert.rejects(() => parseRitmoBackup(JSON.stringify({ format: RITMO_BACKUP_FORMAT, version: 999, data: {} })), /no es compatible/);
await assert.rejects(() => parseRitmoBackup(JSON.stringify({
  format: RITMO_BACKUP_FORMAT, version: 1, data: { tracks: [{ title: "missing id" }] }
})), /sin identificador válido/);
await assert.rejects(() => parseRitmoBackup(JSON.stringify({
  format: RITMO_BACKUP_FORMAT, version: 1, data: {
    tracks: [{ id: "bad-blob", kind: "file", blob: { __ritmoBackupBlobV1: true, type: "audio/mpeg", size: 1, data: "A?" } }]
  }
})), /demasiados registros|adjunto|incompleto|inválido/);

// Export must reject the same untrusted nesting depth accepted by import, before
// recursion reaches the JavaScript stack limit.
{
  let deeplyNested = { leaf: true };
  for (let index = 0; index < 45; index++) deeplyNested = { child: deeplyNested };
  await assert.rejects(
    createRitmoBackup({ settings: [{ key: "ritmo.test.deep", value: deeplyNested }] }),
    /demasiado anidados/,
    "A deeply nested setting must produce a controlled backup error, not a stack overflow"
  );
}
{
  const oversizedList = new Array(100001).fill(null);
  await assert.rejects(
    createRitmoBackup({ settings: [{ key: "ritmo.test.list", value: oversizedList }] }),
    /lista.*demasiado extensa/,
    "A nested collection beyond the import-safe limit must be rejected before serialization"
  );
}

console.log("Backup checks passed: metadata and optional audio round-trip, custom character and artwork preservation, device-path redaction, credential exclusion, bounded nesting/arrays and malformed-file rejection.");
