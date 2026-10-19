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
