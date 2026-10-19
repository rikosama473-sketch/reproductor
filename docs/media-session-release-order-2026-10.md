# Orden de liberación de Media3 — 19 de octubre de 2026

## Hallazgo y solución
`RitmoPlaybackService.onDestroy()` liberaba `ExoPlayer` antes de llamar a `MediaSession.release()`. La referencia oficial de Media3 especifica que la app debe liberar la sesión y después el reproductor subyacente. El orden se corrigió: ecualizador, sesión, reproductor y finalmente `super.onDestroy()`.

## Regresión
`scripts/android-music-library-check.mjs` inspecciona el cuerpo de `onDestroy()` y falla si el orden de `mediaSession.release()` y `player.release()` se invierte o si falta alguna liberación.

## Fuente
- Android Developers, API de MediaSession (la aplicación debe liberar la sesión; el reproductor subyacente se libera después): https://developer.android.com/reference/androidx/media3/session/MediaSession
- Android Developers, reproducción en segundo plano con MediaSessionService: https://developer.android.com/media/media3/session/background-playback

## Alcance de validación
El orden se comprueba automáticamente y la compilación Android debe comprobar que los cambios Java compilan. La notificación, la pantalla bloqueada y los botones del sistema todavía requieren confirmación en un dispositivo físico.
