# Corrección de identidad al importar audio — 19 de octubre de 2026

## Problema reproducido en el código

La deduplicación comparaba ruta disponible, tamaño y fecha de modificación. En las importaciones Android que necesitan una copia de respaldo, el `File` sintético solo conservaba el nombre visible. Dos canciones distintas en carpetas diferentes podían coincidir si tenían el mismo nombre, tamaño y fecha, por lo que la segunda se descartaba como si ya existiera.

La API `File` expone el nombre, tamaño y marca de modificación, pero estas propiedades no son una identidad única. Para selección de carpetas, `webkitRelativePath` conserva además la ruta relativa cuando el navegador la proporciona; ver [MDN: File.webkitRelativePath](https://developer.mozilla.org/en-US/docs/Web/API/File/webkitRelativePath) y [MDN: File.lastModified](https://developer.mozilla.org/en-US/docs/Web/API/File/lastModified).

## Solución aplicada

- Centralizada la huella de importación en `src/import-fingerprint.js`.
- La identidad prefiere una clave deduplicadora guardada o una URI/ruta nativa, después la ruta relativa completa, y solo finalmente el nombre.
- Para importaciones Android sin permiso persistente, se conserva la URI original como `dedupeKey` al guardar el Blob de respaldo.
- Se conserva la comparación de tamaño y fecha como componentes de la huella, sin tratarlos como la única identidad.
- Añadidos tests para archivos de igual nombre/metadata en distintas carpetas, URI Android distintas, reimportación del mismo fallback y coincidencia antes/después de guardar.
- La función nueva se añadió al shell offline y se incrementó la caché PWA a `ritmo-shell-v29`.

## Validación

La suite `scripts/import-fingerprint-check.mjs` cubre las colisiones anteriores. Se ejecuta dentro de `npm run validate` y la compilación Android usa ese mismo conjunto.
