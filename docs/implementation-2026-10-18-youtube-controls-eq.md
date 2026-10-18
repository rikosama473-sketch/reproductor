# Implementación de búsqueda YouTube, controles multimedia y preajustes EQ

Fecha: 18 de octubre de 2026. Rama objetivo: `main`.

## Cambios implementados

- Si la búsqueda se envía sin una clave de YouTube Data API, Ritmo abre automáticamente la búsqueda pública oficial en vez de quedarse sin resultados. La búsqueda integrada dentro de Ritmo sigue disponible cuando el usuario configura su propia clave.
- La Media Session web publica el título y estado del video seleccionado desde el reproductor oficial IFrame de YouTube; los eventos de reproducción confirmada actualizan el estado y los controles de play/pause/seek se conectan al API IFrame.
- Los archivos elegidos con el selector Android conservan su URI nativa cuando Android confirma un permiso persistente. Ritmo los entrega a Media3 para mantenerlos bajo la sesión multimedia nativa y evitar copiar innecesariamente cada archivo a IndexedDB. Si el proveedor no concede un permiso persistente, se mantiene la ruta de copia de respaldo.
- El ecualizador añade perfiles Plano, Acústico, Pop, Rock, Clásico, Jazz, Más graves y Voces; los tres deslizadores siguen disponibles para ajustes manuales. El ecualizador se aplica a archivos locales, no intenta procesar audio dentro del iframe de YouTube ni fuentes remotas sujetas a CORS.
- Se amplían las comprobaciones automatizadas de los perfiles y de la integración. Se invalida la versión de caché PWA para que el shell actualizado no reutilice recursos viejos.

## Fuentes técnicas y límites

- YouTube Data API, Search: list: https://developers.google.com/youtube/v3/docs/search/list — la búsqueda integrada usa la API oficial y su cuota; no se añade un scraper no oficial ni se simula una API ilimitada.
- YouTube IFrame Player API: https://developers.google.com/youtube/iframe_api_reference — controla reproducción/pausa y observa eventos del reproductor incrustado.
- MDN, Media Session API: https://developer.mozilla.org/en-US/docs/Web/API/Media_Session_API — permite publicar metadatos y action handlers a los controles globales, siempre que navegador y sistema los admitan.
- AndroidX Media3, MediaSessionService: https://developer.android.com/reference/androidx/media3/session/MediaSessionService — describe la sesión nativa y la notificación de reproducción en primer plano de Android.

La API Media Session del navegador no garantiza el mismo resultado en todas las versiones del WebView. Los archivos con URI Android persistente van por Media3; los videos de YouTube siguen reproducidos por su reproductor oficial y la disponibilidad de sus controles en segundo plano debe confirmarse en dispositivo real. La CI puede comprobar empaquetado y pruebas de código, pero no reemplaza esa prueba física.
