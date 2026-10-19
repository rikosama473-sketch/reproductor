import assert from "node:assert/strict";
import { importedFileFingerprint } from "../src/import-fingerprint.js";

const modified = 1_760_000_000_000;
const fileA = { name: "theme.mp3", size: 4096, lastModified: modified, webkitRelativePath: "Disc A/theme.mp3" };
const fileB = { name: "theme.mp3", size: 4096, lastModified: modified, webkitRelativePath: "Disc B/theme.mp3" };

assert.notEqual(
  importedFileFingerprint(fileA),
  importedFileFingerprint(fileB),
  "Different relative folders must not collapse into one import just because metadata matches"
);
assert.equal(
  importedFileFingerprint(fileA),
  importedFileFingerprint({ ...fileA }),
  "Re-importing the same relative path and metadata should still be recognized"
);

const androidFileA = { name: "song.mp3", size: 8192, lastModified: modified };
const androidFileB = { name: "song.mp3", size: 8192, lastModified: modified };
const androidKeys = new Map([
  [androidFileA, "content://provider/document/album-a-song"],
  [androidFileB, "content://provider/document/album-b-song"]
]);
assert.notEqual(
  importedFileFingerprint(androidFileA, { dedupeKeysByFile: androidKeys }),
  importedFileFingerprint(androidFileB, { dedupeKeysByFile: androidKeys }),
  "Android document URIs must distinguish same-named files from different folders"
);

const persistedTrack = {
  id: "track-a",
  name: "song.mp3",
  sourcePath: "song.mp3",
  dedupeKey: "content://provider/document/album-a-song",
  size: androidFileA.size,
  lastModified: androidFileA.lastModified
};
assert.equal(
  importedFileFingerprint(androidFileA, { dedupeKeysByFile: androidKeys }),
  importedFileFingerprint(persistedTrack),
  "An Android fallback import must be recognized as the same item after it is stored in IndexedDB"
);

const pathTrack = { name: "song.mp3", sourcePath: "song.mp3", nativePath: "/data/user/0/ritmo/ritmo-audio/abc-song.mp3", size: 99, lastModified: modified };
const pathFile = { name: "song.mp3", size: 99, lastModified: modified };
assert.equal(
  importedFileFingerprint(pathFile, { nativePathsByFile: new Map([[pathFile, pathTrack.nativePath]]) }),
  importedFileFingerprint(pathTrack),
  "Native fallback paths must be stable between pre-save duplicate detection and later imports"
);

const uriTrackA = { nativeUri: "content://media/audio/100", sourcePath: "same.mp3", name: "same.mp3", size: 900, lastModified: modified };
const uriTrackB = { nativeUri: "content://media/audio/101", sourcePath: "same.mp3", name: "same.mp3", size: 900, lastModified: modified };
assert.notEqual(importedFileFingerprint(uriTrackA), importedFileFingerprint(uriTrackB), "Native URI identities must stay distinct");
console.log("Import fingerprint checks passed: folder paths, Android URIs and saved fallback identity.");
