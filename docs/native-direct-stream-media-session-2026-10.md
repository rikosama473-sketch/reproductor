# Reproducción nativa de enlaces directos — 19 de octubre de 2026

## Hallazgo
Los archivos seleccionados/importados desde Android podían usar Media3, pero las fuentes directas de audio guardadas en la biblioteca pasaban siempre por el elemento HTML `audio`. En Android WebView eso puede depender de la integración de Media Session del navegador, en vez de la sesión nativa del servicio de medios.

## Corrección
- Las URL HTTPS directas de audio usan `RitmoPlaybackService` / Media3 en Android, publicando título y artista en la sesión del sistema.
- Se excluyen enlaces `.m3u8`, porque el paquete actual no incluye el módulo HLS de Media3.
- Si Media3 falla inmediatamente o informa un error de formato/red de manera asíncrona, Ritmo intenta una única vez el reproductor HTML de la fuente.
- Se agregó una comprobación de identidad de solicitud tras la lectura del estado nativo para evitar que una respuesta vieja altere el estado de la reproducción alternativa más reciente.
- Se incrementó el shell de `ritmo-shell-v33` a `ritmo-shell-v34` y se añadieron pruebas automatizadas del contrato de selección/fallback.

## Fuentes técnicas
- Android Developers, reproducción progresiva con `MediaItem` y `setMediaItem`: https://developer.android.com/media/media3/exoplayer/progressive
- Android Developers, servicio de reproducción de fondo y sesión de medios: https://developer.android.com/reference/androidx/media3/session/MediaSessionService
- Android Developers, HLS requiere el módulo `media3-exoplayer-hls`: https://developer.android.com/media/media3/exoplayer/hls

## Límites de validación
La mejora aplica a enlaces directos compatibles de audio (por ejemplo, una URL HTTPS de MP3/OGG/AAC que realmente sirva el recurso); no garantiza que todo servidor acepte Media3 o comparta un códec. La ruta web alternativa se mantiene. YouTube embebido no se convierte en una sesión Media3 nativa; necesita tratarse separadamente. La experiencia de pantalla bloqueada requiere todavía prueba en un teléfono real.
