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
