# Resiliencia de búsqueda de YouTube sin clave — 20 de octubre de 2026

## Hallazgo externo aplicable

La búsqueda sin clave de Ritmo usa las instancias públicas de Invidious, no una extracción de audio ni la API oficial de YouTube. Invidious publicó el issue [#5817: “All instances are broken”](https://github.com/iv-org/invidious/issues/5817), abierto el 22 de julio de 2026, donde se reportó que la búsqueda y otros endpoints públicos fallaban tras un cambio de YouTube. Su [lista oficial de instancias](https://docs.invidious.io/instances/) advierte que la lista pública permanece corta debido a problemas recientes de YouTube.

Esto no demuestra que cada instancia esté caída en todo momento. Sí demuestra que una instancia comunitaria es una dependencia externa no garantizada y que Ritmo debe tratar respuestas vacías o errores como algo recuperable.

## Correcciones aplicadas

- `src/online-services.js`: un HTTP 200 con una lista de resultados vacía o formada enteramente por elementos inválidos ya no termina inmediatamente la búsqueda. Ritmo continúa probando las demás instancias permitidas y solo devuelve una lista vacía si ninguna ofreció resultados utilizables.
- `src/app.js`: si ninguna instancia responde, o todas devuelven cero vídeos utilizables, la APK intenta abrir la búsqueda oficial de YouTube mediante el enrutamiento nativo ya existente. No requiere una clave API ni convierte el vídeo en audio. En web/PWA se señala el botón **Abrir búsqueda en YouTube**; se evita intentar abrir ventanas emergentes automáticamente después de una petición asíncrona, porque algunos navegadores las bloquean.
- Se conserva el consentimiento explícito para activar YouTube y las advertencias de Wi-Fi/datos móviles. La búsqueda oficial puede salir de Ritmo, porque no hay una API pública oficial de búsqueda integrada sin clave; el respaldo abre la web o aplicación oficial mediante Android.
- La caché offline sube a `ritmo-shell-v42` y las pruebas actualizan la versión esperada.

## Pruebas de regresión

`scripts/online-services-check.mjs` comprueba un caso que faltaba: primera instancia responde HTTP 200 con una lista vacía, la segunda entrega un resultado válido, y la búsqueda debe recuperar ese resultado en vez de informar falsamente que no hay vídeos. También verifica el respaldo oficial de YouTube en Android y el botón explícito en web.

## Límites

La búsqueda comunitaria sigue dependiendo de terceros y puede fallar por CORS, rate limits o cambios del lado de YouTube. El respaldo evita un callejón sin salida, pero no promete que YouTube reproduzca en segundo plano dentro de Ritmo. Para el reproductor incrustado se respetan las [políticas de desarrolladores de YouTube](https://developers.google.com/youtube/terms/developer-policies-guide); la reproducción en segundo plano queda a cargo de la app/navegador oficial y sus propias funciones.

