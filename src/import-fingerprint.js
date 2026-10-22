/**
 * Build a repeatable import identity without reading/decompressing file bytes.
 * Prefer stable Android URI/path identity or the full relative path when available;
 * filename, size and modification time alone can collide across music folders.
 */
export function importedFileFingerprint(fileOrTrack, options = {}) {
  const source = fileOrTrack && typeof fileOrTrack === "object" ? fileOrTrack : {};
  const mappedPath = options && typeof options === "object"
    ? options.nativePathsByFile?.get(fileOrTrack)
    : "";
  const mappedKey = options && typeof options === "object"
    ? options.dedupeKeysByFile?.get(fileOrTrack)
    : "";
  const identity = mappedKey || source.dedupeKey || source.nativeUri || source.nativePath ||
    mappedPath || source.webkitRelativePath || source.sourcePath || source.name || "";
  const normalizedIdentity = String(identity).replace(/\\/g, "/");
  const size = Math.max(0, Number(source.size) || 0);
  const lastModified = Math.max(0, Number(source.lastModified) || 0);
  return normalizedIdentity + "|" + size + "|" + lastModified;
}


/**
 * Compare two Blob-like files byte-for-byte without reading either complete file
 * into memory. This detects exact copies, not different encodings of the same song.
 * The caller should bucket candidates by size before comparing them.
 */
export const DEFAULT_BLOB_COMPARE_CHUNK_BYTES = 256 * 1024;
export const MAX_BLOB_COMPARE_CHUNK_BYTES = 1024 * 1024;
// Bound per-file duplicate detection so equal-size buckets from a large library
// cannot cause unbounded synchronous import work or gigabytes of repeated reads.
export const MAX_BLOB_COMPARE_CANDIDATES = 128;
export const MAX_BLOB_COMPARISON_BYTES_PER_SEARCH = 128 * 1024 * 1024;

function throwIfBlobComparisonAborted(signal) {
  if (!signal?.aborted) return;
  const error = new Error("La comparación de archivos fue cancelada.");
  error.name = "AbortError";
  throw error;
}

export async function areBlobsByteIdentical(left, right, {
  chunkSize = DEFAULT_BLOB_COMPARE_CHUNK_BYTES,
  signal
} = {}) {
  if (!left || !right || typeof left.slice !== "function" || typeof right.slice !== "function" ||
      !Number.isSafeInteger(Number(left.size)) || !Number.isSafeInteger(Number(right.size))) {
    return false;
  }
  const size = Number(left.size);
  if (size <= 0 || size !== Number(right.size)) return false;

  const requestedChunkSize = Number(chunkSize);
  const chunkBytes = Math.max(1, Math.min(
    MAX_BLOB_COMPARE_CHUNK_BYTES,
    Number.isFinite(requestedChunkSize) && requestedChunkSize > 0
      ? Math.floor(requestedChunkSize)
      : DEFAULT_BLOB_COMPARE_CHUNK_BYTES
  ));

  for (let offset = 0; offset < size; offset += chunkBytes) {
    throwIfBlobComparisonAborted(signal);
    const end = Math.min(size, offset + chunkBytes);
    const leftChunk = left.slice(offset, end);
    const rightChunk = right.slice(offset, end);
    if (!leftChunk || !rightChunk ||
        typeof leftChunk.arrayBuffer !== "function" || typeof rightChunk.arrayBuffer !== "function") {
      return false;
    }
    const [leftBuffer, rightBuffer] = await Promise.all([
      leftChunk.arrayBuffer(),
      rightChunk.arrayBuffer()
    ]);
    throwIfBlobComparisonAborted(signal);
    if (leftBuffer.byteLength !== rightBuffer.byteLength) return false;
    const leftBytes = new Uint8Array(leftBuffer);
    const rightBytes = new Uint8Array(rightBuffer);
    for (let index = 0; index < leftBytes.length; index++) {
      if (leftBytes[index] !== rightBytes[index]) return false;
    }
  }
  return true;
}

/**
 * Look for an exact content match. Unreadable candidates are recorded but do
 * not stop the search; the caller must keep the incoming file if no verified
 * match is found. A confirmed match is conclusive even if another candidate
 * could not be read.
 */
export async function findIdenticalBlobCandidate(blob, candidates, options = {}) {
  const settings = options && typeof options === "object" ? options : {};
  const {
    maxCandidates: requestedMaxCandidates,
    maxComparisonBytes: requestedMaxComparisonBytes,
    ...comparisonOptions
  } = settings;
  const maxCandidates = Number.isSafeInteger(Number(requestedMaxCandidates)) && Number(requestedMaxCandidates) >= 0
    ? Math.min(MAX_BLOB_COMPARE_CANDIDATES, Number(requestedMaxCandidates))
    : MAX_BLOB_COMPARE_CANDIDATES;
  const maxComparisonBytes = Number.isSafeInteger(Number(requestedMaxComparisonBytes)) && Number(requestedMaxComparisonBytes) >= 0
    ? Math.min(MAX_BLOB_COMPARISON_BYTES_PER_SEARCH, Number(requestedMaxComparisonBytes))
    : MAX_BLOB_COMPARISON_BYTES_PER_SEARCH;
  const sourceSize = Number(blob?.size);
  let candidateCount = 0;
  let comparisonBytes = 0;
  let comparisonFailed = false;

  for (const candidate of candidates || []) {
    if (candidateCount >= maxCandidates) {
      return { identical: false, comparisonFailed: true };
    }
    candidateCount++;

    // Each byte-identical check reads both inputs. Stop before an attempt that
    // would exceed the per-file I/O budget; the caller must keep the file when
    // the result is inconclusive rather than risk discarding a real track.
    const candidateSize = Number(candidate?.size);
    if (Number.isSafeInteger(sourceSize) && sourceSize > 0 &&
        Number.isSafeInteger(candidateSize) && candidateSize === sourceSize) {
      const estimatedBytes = sourceSize * 2;
      if (!Number.isSafeInteger(estimatedBytes) ||
          comparisonBytes + estimatedBytes > maxComparisonBytes) {
        return { identical: false, comparisonFailed: true };
      }
      comparisonBytes += estimatedBytes;
    }

    try {
      if (await areBlobsByteIdentical(blob, candidate, comparisonOptions)) {
        return { identical: true, comparisonFailed: false };
      }
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      comparisonFailed = true;
    }
  }
  return { identical: false, comparisonFailed };
}


const SUPPORTED_AUDIO_EXTENSION = /\.(mp3|m4a|mp4|aac|wav|wave|ogg|oga|opus|webm|flac|aiff|aif|alac|wma|ape|mp2|mid|midi|caf|3gp|amr)$/i;

/**
 * Separate supported audio selections from empty/unreadable audio files before
 * metadata scans or persistence. FileList entries should be File objects.
 */
export function classifyAudioImportFiles(fileList) {
  const files = [];
  const emptyFiles = [];
  let unsupportedCount = 0;
  for (const file of Array.from(fileList || [])) {
    const name = typeof file?.name === "string" ? file.name : "";
    const type = typeof file?.type === "string" ? file.type : "";
    if (!(type.startsWith("audio/") || SUPPORTED_AUDIO_EXTENSION.test(name))) {
      unsupportedCount++;
      continue;
    }
    if (!Number.isSafeInteger(file.size) || file.size <= 0) {
      emptyFiles.push(file);
      continue;
    }
    files.push(file);
  }
  return { files, emptyFiles, unsupportedCount };
}
