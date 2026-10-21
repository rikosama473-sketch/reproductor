import assert from "node:assert/strict";
import { areBlobsByteIdentical, classifyAudioImportFiles, findIdenticalBlobCandidate, importedFileFingerprint, MAX_BLOB_COMPARE_CHUNK_BYTES } from "../src/import-fingerprint.js";

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

// Exact duplicate detection compares every byte in bounded chunks, rather than
// trusting equal filenames, sizes, modification times, or only a sampled prefix.
{
  const source = new Uint8Array(700 * 1024 + 37);
  for (let index = 0; index < source.length; index++) source[index] = (index * 31 + 7) & 0xff;
  const original = new Blob([source]);
  const renamedCopy = new Blob([source.slice()]);
  assert.equal(await areBlobsByteIdentical(original, renamedCopy, { chunkSize: 64 * 1024 }), true,
    "Different names do not affect a byte-identical file comparison");

  const changedTail = source.slice();
  changedTail[changedTail.length - 1] ^= 0xff;
  assert.equal(await areBlobsByteIdentical(original, new Blob([changedTail]), { chunkSize: 64 * 1024 }), false,
    "A difference in the final chunk must not be missed");
  assert.equal(await areBlobsByteIdentical(original, new Blob([source.slice(0, -1)])), false,
    "Different byte lengths cannot be identical");
  assert.equal(await areBlobsByteIdentical(new Blob([]), new Blob([])), false,
    "Empty files are not treated as useful duplicate audio candidates");

  let chunksRead = 0;
  const boundedReader = {
    size: source.length,
    slice(start, end) {
      assert.ok(end - start <= MAX_BLOB_COMPARE_CHUNK_BYTES,
        "The comparator must never request a chunk larger than its memory bound");
      chunksRead++;
      return new Blob([source.slice(start, end)]);
    }
  };
  assert.equal(await areBlobsByteIdentical(boundedReader, original, { chunkSize: 64 * 1024 }), true);
  assert.equal(chunksRead, Math.ceil(source.length / (64 * 1024)),
    "Only one bounded slice per chunk should be read from the instrumented Blob");

  const controller = new AbortController();
  const abortingBlob = {
    size: source.length,
    slice(start, end) {
      const chunk = new Blob([source.slice(start, end)]);
      if (start === 0) controller.abort();
      return chunk;
    }
  };
  await assert.rejects(
    areBlobsByteIdentical(abortingBlob, original, { chunkSize: 64 * 1024, signal: controller.signal }),
    error => error?.name === "AbortError",
    "Cancellation during a chunk read must stop the comparison before the next chunk"
  );
}


// A failed source read must not cause a file to be discarded. If another
// candidate proves byte-identical, the verified match is sufficient.
{
  const reference = new Blob([new Uint8Array([1, 2, 3, 4])]);
  const unreadable = {
    size: 4,
    slice() { return { arrayBuffer: async () => { throw new Error("provider read failed"); } }; }
  };
  const distinct = new Blob([new Uint8Array([1, 2, 3, 5])]);
  const unmatched = await findIdenticalBlobCandidate(reference, [unreadable, distinct]);
  assert.deepEqual(unmatched, { identical: false, comparisonFailed: true },
    "Unreadable candidates must be reported as inconclusive, not matches");

  const matched = await findIdenticalBlobCandidate(reference, [unreadable, new Blob([new Uint8Array([1, 2, 3, 4])])]);
  assert.deepEqual(matched, { identical: true, comparisonFailed: false },
    "A confirmed exact match can be used even if another candidate failed to read");

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    findIdenticalBlobCandidate(reference, [reference], { signal: controller.signal }),
    error => error?.name === "AbortError",
    "Explicit cancellation must propagate instead of being downgraded to a read warning"
  );
}


// Empty/unreadable audio files are separated before importing; unsupported
// documents are not mislabeled as corrupt audio.
{
  const result = classifyAudioImportFiles([
    { name: "track.mp3", type: "audio/mpeg", size: 1024 },
    { name: "no-extension", type: "audio/ogg", size: 50 },
    { name: "empty.mp3", type: "", size: 0 },
    { name: "unknown-size.wav", type: "audio/wav", size: Number.NaN },
    { name: "notes.txt", type: "text/plain", size: 400 },
    { name: "cover.png", type: "image/png", size: 2048 }
  ]);
  assert.deepEqual(result.files.map(file => file.name), ["track.mp3", "no-extension"],
    "Recognized audio files with nonzero known sizes should remain importable");
  assert.deepEqual(result.emptyFiles.map(file => file.name), ["empty.mp3", "unknown-size.wav"],
    "Empty or invalid-size audio entries should be rejected before persistence");
  assert.equal(result.unsupportedCount, 2,
    "Non-audio files should be counted as unsupported rather than corrupt audio");
}

console.log("Import fingerprint checks passed: folder paths, Android URIs and saved fallback identity.");
