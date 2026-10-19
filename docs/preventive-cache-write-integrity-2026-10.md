# Integridad de la caché de audio nativa — 19 de octubre de 2026

## Hallazgo
El respaldo de `copyToPrivateCache` escribía directamente al archivo final si `File.renameTo` fallaba. Si el flujo de bytes daba error a mitad de camino, podía quedar un archivo final no vacío pero incompleto. Las siguientes importaciones reutilizan archivos finales no vacíos, así que esa copia dañada podía aparentar ser válida y producir fallos de reproducción.

La documentación oficial de Java aclara que `File.renameTo` es dependiente de la plataforma, puede fallar y no garantiza atomicidad: [Oracle Java API — File.renameTo](https://docs.oracle.com/en/java/javase/24/docs/api/java.base/java/io/File.html#renameTo(java.io.File)). Android documenta que los documentos elegidos se abren mediante URI/ContentResolver y pueden venir de distintos proveedores: [Android Developers — acceso a documentos y archivos](https://developer.android.com/training/data-storage/shared/documents-files?hl=es).

## Cambio aplicado
- El fallback copia al archivo intermedio `.copying`, no al nombre final que usa el reproductor.
- Hace `sync()` al completar la escritura y solo publica la copia con un renombrado posterior.
- Si copiar o publicar falla, elimina la etapa cuando es posible y propaga el error; la app no devuelve una ruta final que podría contener una copia parcial.
- Añadidas aserciones al control Android estático para evitar que vuelva la escritura directa a la ruta final.

## Corrección de la suite
El CI del commit previo señaló además que `smoke-check.mjs` buscaba la función de huella en `app.js`, a pesar de que ya se había extraído a `src/import-fingerprint.js`. La prueba ahora verifica el módulo exportado y que la aplicación lo importe.

## Validación
La ejecución automática anterior no pasó esa aserción de smoke-check y por eso el empaquetado APK se detuvo antes de compilar. La validación y el APK del nuevo commit deben confirmarse mediante sus ejecuciones de GitHub Actions; esta nota no los presupone.
