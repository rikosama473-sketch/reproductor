export const MAX_COMPANION_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_COMPANION_IMAGE_DIMENSION = 2048;
export const MAX_COMPANION_IMAGE_PIXELS = 4_194_304;

const MIME_BY_EXTENSION = Object.freeze({
  ".png": "image/png",
  ".apng": "image/apng",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif"
});
const SUPPORTED_MIME_TYPES = new Set(Object.values(MIME_BY_EXTENSION));

export function validateCompanionImage(file) {
  if (!file || typeof file !== "object") throw new TypeError("Elegí una imagen para el personaje.");
  const size = Number(file.size);
  if (!Number.isFinite(size) || size <= 0) throw new TypeError("El archivo de imagen está vacío o no se puede leer.");
  if (size > MAX_COMPANION_IMAGE_BYTES) throw new RangeError("La imagen o el GIF supera los 8 MB. Elegí una versión más liviana.");
  const suppliedName = String(file.name || "personaje").trim();
  const fileName = suppliedName.replaceAll("\\", "/").split("/").pop().slice(0, 120) || "personaje";
  const extension = /\.[^.]+$/.exec(fileName.toLowerCase())?.[0] || "";
  const extensionMime = MIME_BY_EXTENSION[extension] || "";
  const reportedType = String(file.type || "").split(";")[0].trim().toLowerCase();
  if (reportedType && reportedType !== "application/octet-stream" && !SUPPORTED_MIME_TYPES.has(reportedType)) {
    throw new TypeError("Formato no admitido. Usá PNG, JPG, GIF, WebP o AVIF.");
  }
  const mimeType = SUPPORTED_MIME_TYPES.has(reportedType) ? reportedType : extensionMime;
  if (!mimeType || !SUPPORTED_MIME_TYPES.has(mimeType)) throw new TypeError("Formato no admitido. Usá PNG, JPG, GIF, WebP o AVIF.");
  return { fileName, mimeType, size };
}

export function validateCompanionImageDimensions(width, height) {
  const imageWidth = Number(width);
  const imageHeight = Number(height);
  if (!Number.isInteger(imageWidth) || !Number.isInteger(imageHeight) || imageWidth < 1 || imageHeight < 1) {
    throw new TypeError("No se pudieron leer las dimensiones de la imagen.");
  }
  if (imageWidth > MAX_COMPANION_IMAGE_DIMENSION || imageHeight > MAX_COMPANION_IMAGE_DIMENSION ||
      imageWidth * imageHeight > MAX_COMPANION_IMAGE_PIXELS) {
    throw new RangeError("La imagen supera 2048 × 2048 píxeles. Redimensionala antes de usarla como personaje mini.");
  }
  return { width: imageWidth, height: imageHeight };
}
