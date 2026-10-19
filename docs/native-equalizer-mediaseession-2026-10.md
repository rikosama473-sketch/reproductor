# Ecualizador nativo y controles de pantalla bloqueada — 19 de octubre de 2026

## Problema
La selección del motor evitaba Media3 cuando el ecualizador estaba activado. En ese caso una pista local volvía al audio web, lo que podía dejar los controles de bloqueo sujetos a las limitaciones del WebView.

## Solución
- Las pistas Android con URI/ruta nativa siguen usando Media3 aunque el ecualizador esté activo.
- El servicio Android configura un `android.media.audiofx.Equalizer` asociado al ID de sesión de audio real del reproductor, no a la mezcla global.
- Graves, medios y agudos se asignan a las bandas que el dispositivo expone; los niveles se limitan al rango soportado.
- Los valores se actualizan al cambiar el preajuste, la casilla Activar o los deslizadores, sin reiniciar la sesión de reproducción.
- Si el dispositivo no puede crear el efecto, el servicio mantiene la reproducción Media3 y reporta que el EQ nativo no está disponible.
- Para archivos sin URI/ruta nativa se mantiene el flujo web de respaldo.
- La caché PWA subió a `ritmo-shell-v31` y se agregaron controles automáticos para evitar regresiones.

## Fuentes oficiales
- Android Media3 — [Background playback with a MediaSessionService](https://developer.android.com/media/media3/session/background-playback): servicio de sesión para audio en segundo plano y notificación de medios.
- Android API — [Equalizer](https://developer.android.com/reference/android/media/audiofx/Equalizer): el efecto se asocia a un ID de sesión y expone bandas, frecuencias y rango de nivel.
- Android API — [MediaSessionService](https://developer.android.com/reference/androidx/media3/session/MediaSessionService): ciclo de vida de sesión y controles multimedia.

## Limitación
CI puede compilar el puente y comprobar sus llamadas, pero no confirma que todos los fabricantes permitan el mismo efecto ni que la notificación aparezca igual en cada teléfono; eso requiere pruebas en un dispositivo físico.
