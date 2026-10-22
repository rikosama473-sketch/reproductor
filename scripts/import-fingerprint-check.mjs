import assert from "node:assert/strict";
import { areBlobsByteIdentical, classifyAudioImportFiles, classifyImportDuplicate, findIdenticalBlobCandidate, importedFileFingerprint, MAX_BLOB_COMPARE_CHUNK_BYTES, MAX_BLOB_COMPARE_CANDIDATES, MAX_BLOB_COMPARISON_BYTES_PER_SEARCH, MAX_BLOB_COMPARE_CANDIDATES_PER_IMPORT_BATCH, MAX_BLOB_COMPARISON_BYTES_PER_IMPORT_BATCH, BLOB_COMPARE_YIELD_EVERY_CHUNKS } from "../src/import-fingerprint.js";

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


// Large equality checks periodically yield to the browser instead of monopolizing
// the main thread; cancellation received during a yield is honored immediately.
{
  const chunkSize = 16 * 1024;
  const bytes = new Uint8Array(chunkSize * 10 + 17);
  for (let index = 0; index < bytes.length; index++) bytes[index] = (index * 19 + 5) & 0xff;
  const left = new Blob([bytes]);
  const right = new Blob([bytes.slice()]);
  let yields = 0;
  assert.equal(
    await areBlobsByteIdentical(left, right, {
      chunkSize,
      yieldControl: async () => { yields++; }
    }),
    true,
    "Yielding must not change the byte-identical result"
  );
  assert.equal(BLOB_COMPARE_YIELD_EVERY_CHUNKS, 4);
  assert.equal(yields, 2, "A 10-chunk comparison must yield after chunks 4 and 8");

  const controller = new AbortController();
  let abortYields = 0;
  await assert.rejects(
    areBlobsByteIdentical(left, right, {
      chunkSize,
      signal: controller.signal,
      yieldControl: async () => {
        abortYields++;
        controller.abort();
      }
    }),
    error => error?.name === "AbortError",
    "Cancellation received while yielding must end the comparison"
  );
  assert.equal(abortYields, 1, "Cancellation should stop at the first scheduled yield");
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


// Duplicate detection has a bounded candidate count and byte-read budget.
// When the search becomes inconclusive, imports remain intact instead of being dropped.
{
  const input = new Blob([new Uint8Array([1, 2, 3, 4])]);
  const different = new Blob([new Uint8Array([1, 2, 3, 5])]);
  const identical = new Blob([new Uint8Array([1, 2, 3, 4])]);
  let lateCandidateReads = 0;
  const lateCandidate = {
    size: 4,
    slice() {
      lateCandidateReads++;
      return identical.slice(0, 4);
    }
  };

  const byCount = await findIdenticalBlobCandidate(input, [different, lateCandidate], { maxCandidates: 1 });
  assert.deepEqual(byCount, { identical: false, comparisonFailed: true },
    "Candidate caps must be inconclusive rather than pretending the file is unique");
  assert.equal(lateCandidateReads, 0, "Candidates beyond the cap must not be read");

  let lateByteCandidateReads = 0;
  const lateByteCandidate = {
    size: 4,
    slice() {
      lateByteCandidateReads++;
      return identical.slice(0, 4);
    }
  };
  const byBytes = await findIdenticalBlobCandidate(input, [different, lateByteCandidate], { maxComparisonBytes: 8 });
  assert.deepEqual(byBytes, { identical: false, comparisonFailed: true },
    "The byte-read budget must stop before exceeding the configured allowance");
  assert.equal(lateByteCandidateReads, 0, "Candidates beyond the byte budget must not be read");

  assert.equal(MAX_BLOB_COMPARE_CANDIDATES, 128);
  assert.equal(MAX_BLOB_COMPARISON_BYTES_PER_SEARCH, 128 * 1024 * 1024);
  assert.equal(MAX_BLOB_COMPARE_CANDIDATES_PER_IMPORT_BATCH, 256);
  assert.equal(MAX_BLOB_COMPARISON_BYTES_PER_IMPORT_BATCH, 128 * 1024 * 1024);

  const batchBudget = { remainingCandidates: 10, remainingBytes: 8 };
  let nextFileReads = 0;
  const nextFileCandidate = {
    size: 4,
    slice() {
      nextFileReads++;
      return identical.slice(0, 4);
    }
  };
  const firstFileSearch = await findIdenticalBlobCandidate(input, [different, nextFileCandidate], { budget: batchBudget });
  assert.deepEqual(firstFileSearch, { identical: false, comparisonFailed: true },
    "The batch-wide byte budget must stop a later candidate after the previous comparison consumes the budget");
  assert.equal(batchBudget.remainingBytes, 0);
  assert.equal(nextFileReads, 0);

  const secondFileSearch = await findIdenticalBlobCandidate(input, [nextFileCandidate], { budget: batchBudget });
  assert.deepEqual(secondFileSearch, { identical: false, comparisonFailed: true },
    "Subsequent files must respect the same cumulative import budget");
  assert.equal(nextFileReads, 0, "Exhausting the batch budget must not read later candidates");
}
 
// Identity keys are only conclusive when stored bytes cannot be compared.
// If accessible bytes disagree, preserve the updated file instead of silently skipping it.
{
  const fingerprint = "Disc A/track.mp3|4|1234";
  const existingFingerprints = new Set([fingerprint]);
  const changedOriginal = new Blob([new Uint8Array([1, 2, 3, 4])]);
  const modifiedContent = new Blob([new Uint8Array([1, 2, 3, 5])]);
  let inaccessibleCandidateReads = 0;
  const inaccessibleFingerprintSet = new Set();
  const fastPath = await classifyImportDuplicate(changedOriginal, {
    fingerprint,
    existingFingerprints,
    comparableFingerprints: inaccessibleFingerprintSet,
    candidates: [{ size: 4, slice() { inaccessibleCandidateReads++; return modifiedContent.slice(); } }]
  });
  assert.deepEqual(fastPath, { action: "skip-identity", comparisonFailed: false, identityCollision: false },
    "Native tracks without a comparable saved Blob should retain the URI/identity fast path");
  assert.equal(inaccessibleCandidateReads, 0, "The identity fast path should avoid unnecessary reads when no same-identity Blob is comparable");

  const comparableFingerprints = new Set([fingerprint]);
  const changed = await classifyImportDuplicate(changedOriginal, {
    fingerprint,
    existingFingerprints,
    comparableFingerprints,
    candidates: [modifiedContent]
  });
  assert.deepEqual(changed, { action: "keep", comparisonFailed: false, identityCollision: true },
    "Changed bytes with the same fingerprint must be retained when all comparable candidates differ");

  const byteMatch = await classifyImportDuplicate(changedOriginal, {
    fingerprint,
    existingFingerprints,
    comparableFingerprints,
    candidates: [modifiedContent, new Blob([new Uint8Array([1, 2, 3, 4])])]
  });
  assert.deepEqual(byteMatch, { action: "skip-identity", comparisonFailed: false, identityCollision: false },
    "An exact content match remains skippable even when path metadata matches");

  const newFingerprintDuplicate = await classifyImportDuplicate(changedOriginal, {
    fingerprint: "Disc B/track.mp3|4|1234",
    existingFingerprints,
    comparableFingerprints,
    candidates: [changedOriginal]
  });
  assert.deepEqual(newFingerprintDuplicate, { action: "skip-content", comparisonFailed: false, identityCollision: false },
    "Files with different identities but identical bytes should still be deduplicated");

  const unreadable = { size: 4, slice() { return { arrayBuffer: async () => { throw new Error("provider read failed"); } }; } };
  const inconclusive = await classifyImportDuplicate(changedOriginal, {
    fingerprint,
    existingFingerprints,
    comparableFingerprints,
    candidates: [unreadable]
  });
  assert.deepEqual(inconclusive, { action: "keep", comparisonFailed: true, identityCollision: true },
    "An unreadable comparison must preserve the incoming file rather than assume it is a duplicate");
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

console.log("Import fingerprint checks passed: identity collisions, bounded duplicate scans, cancellation and cooperative yielding.");
