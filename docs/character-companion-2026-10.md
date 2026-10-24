# Compañero animado de Ritmo — 19 de octubre de 2026

## Implementación
**Corrección de referencia (24 de octubre de 2026):** la ilustración del acompañante es el personaje original del usuario, Pibara, recortado de su imagen aportada con cabello castaño y ojos dorados. El recurso canónico ahora es `assets/pibara-avatar.webp`; no se debe volver a una capibara ni a una mascota genérica. El acompañante aparece cuando el reproductor confirma reproducción activa (audio web, Media3 Android o YouTube) y se oculta al pausar o detener. Una animación CSS ligera simula pasos/balanceo y una nota musical acompaña el movimiento. No se introdujo ninguna dependencia externa.

La posición se adapta al reproductor y a la navegación móvil; el elemento tiene `pointer-events: none` para no interceptar toques. El WebP transparente se copia al paquete Capacitor y entra en la caché inicial del Service Worker, por lo que está disponible en el APK y tras la primera instalación offline. La preferencia de accesibilidad `prefers-reduced-motion` desactiva el movimiento.

## Fuentes técnicas
- MDN, `prefers-reduced-motion`: https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/%40media/prefers-reduced-motion
- Android Developers, `MediaSessionService` (contexto de reproducción en segundo plano; el compañero de pantalla solo refleja el estado publicado por el reproductor): https://developer.android.com/reference/androidx/media3/session/MediaSessionService

## Validación prevista
Las comprobaciones smoke, táctiles y de empaquetado verifican el estado de reproducción, el respeto a movimiento reducido, que el personaje no bloquee botones y que el WebP de Pibara forme parte del shell offline y del sitio empaquetado para Android. La animación se reduce a una sola imagen WebP con transformaciones CSS; no es un GIF rasterizado, lo que reduce el tamaño y evita una dependencia externa.
