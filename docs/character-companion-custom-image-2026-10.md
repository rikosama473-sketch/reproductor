# Personaje acompañante configurable — 20 de octubre de 2026

## Hallazgo y corrección

El acompañante usaba un único PNG incluido en el repositorio, sin un lugar visible para elegir una imagen personal y conservarla entre sesiones. Guardar un GIF de varios megabytes en localStorage tampoco sería adecuado.

Ritmo ahora acepta PNG, APNG, JPG, GIF, WebP o AVIF desde **Configuración → Tu personaje acompañante**. Los GIF/WebP/APNG conservan sus fotogramas; las imágenes fijas usan el movimiento CSS ligero existente. La selección se valida antes de guardarse: máximo 8 MB, 2048 × 2048 y 4.194.304 píxeles totales. El Blob se guarda en un object store de IndexedDB separado de la biblioteca musical (migración de DB v2 a v3 que conserva los stores previos), solo en este dispositivo. Hay una opción para restaurar el PNG original.

La app también aclara ahora que, sin clave, Ritmo intenta la búsqueda comunitaria dentro de la aplicación y conserva la búsqueda web como respaldo.

## Pruebas

El script de regresión character-companion-check.mjs cubre formatos admitidos, archivos vacíos/no admitidos, límites de tamaño/dimensiones, persistencia de ajustes, caché offline y presencia de la función en el paquete Android. La imagen personalizada permanece en IndexedDB de cada instalación. Si se borra el almacenamiento local o se reinstala sin conservar los datos, habrá que seleccionarla otra vez.

## Fuentes y límite conocido

- IndexedDB del navegador: https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API
- Media Session API: la disponibilidad de controles del sistema depende del navegador/plataforma: https://developer.mozilla.org/en-US/docs/Web/API/MediaSession
- Android Media3 recomienda alojar reproductor y sesión en el servicio MediaSessionService para notificaciones y reproducción de fondo: https://developer.android.com/media/media3/session/background-playback

Este cambio no afirma resolver la pantalla bloqueada: Media3 cubre pistas locales y URLs directas de audio compatibles; YouTube/Spotify embebidos dependen de la sesión web. Los controles de cada fuente requieren prueba manual en un Android físico.
