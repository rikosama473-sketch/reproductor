# Destino de retorno de la notificación multimedia — 19 de octubre de 2026

## Hallazgo y solución

La sesión Media3 no declaraba una actividad de destino. La reproducción en segundo plano podía seguir funcionando, pero la notificación no tenía un destino explícito para que el usuario tocara el área de contenido y volviera a Ritmo.

`RitmoPlaybackService.onCreate()` ahora construye un `PendingIntent` inmutable para `MainActivity`, reusa la actividad si ya existe y lo registra con `MediaSession.Builder.setSessionActivity()`. Añadí regresiones al control Android de origen.

## Fuente primaria

La referencia oficial de [MediaSession.Builder.setSessionActivity](https://developer.android.com/reference/androidx/media3/session/MediaSession.Builder) especifica que el `PendingIntent` se utiliza para abrir la actividad asociada a la sesión cuando se toca la notificación.

## Alcance

Este cambio enlaza la notificación con Ritmo. **No es una solución por sí solo a que Android omita toda notificación o los controles en la pantalla bloqueada.** Media3 genera la notificación estándar cuando la sesión está reproduciendo; verificar qué muestra cada dispositivo sigue requiriendo instalar esta APK y probarla en un teléfono real, revisando también las opciones de notificaciones y controles multimedia del sistema.
