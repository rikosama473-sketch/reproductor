# Corrección de sondeos nativos obsoletos — 19 de octubre de 2026

## Hallazgo

El estado de Media3 se consulta de forma asíncrona. Un sondeo iniciado antes de un cambio de pista podía terminar después; al reutilizar el mismo identificador de canción, su respuesta no siempre podía distinguirse por el ID de la pista. Además, el indicador global de consulta pendiente podía ser liberado por una consulta vieja que terminara después de iniciar otra sesión.

Los navegadores y WebView pueden retrasar los temporizadores cuando el documento está oculto. Por eso, regresar a la app no debe depender de que el siguiente intervalo atrasado actualice la pantalla.

## Implementación

- Cada generación de sondeos invalida las respuestas de generaciones anteriores, al detener, cambiar de pista o reanudar el sondeo.
- Las respuestas obsoletas ya no pueden cambiar el estado visual ni liberar el indicador de consulta de la sesión actual.
- Una solicitud de reproducción reemplazada se descarta antes de aplicar su respuesta nativa.
- Al volver a una app visible, el estado Media3 se vuelve a consultar inmediatamente.
- Se avanzó el nombre de caché del Service Worker a `ritmo-shell-v35`, para que la nueva lógica llegue también a instalaciones PWA existentes.

## Regresiones y fuente técnica

`scripts/android-music-library-check.mjs` verifica la generación, el descarte de respuestas tardías, la protección del indicador y la sincronización al volver a la app.

La [Page Visibility API de MDN](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API) documenta que los temporizadores pueden limitarse en páginas ocultas y que `visibilitychange` permite detectar el retorno a primer plano. La [documentación oficial de Media3](https://developer.android.com/media/media3/session/background-playback) describe el servicio de sesión que mantiene la reproducción nativa en segundo plano.

## Alcance

La corrección evita que la interfaz de Ritmo adopte estados nativos desactualizados. No demuestra por sí sola el comportamiento de los controles de bloqueo en todos los teléfonos; esa comprobación necesita un dispositivo físico. La reproducción incrustada de YouTube sigue dependiendo del reproductor oficial y no se trata como un stream de audio nativo.
