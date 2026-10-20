# Búsqueda de YouTube sin clave — 20 de octubre de 2026

## Hallazgo en Ritmo

La búsqueda original usaba YouTube Data API v3. Sin una clave local, el botón abría directamente la web de YouTube, de modo que no se buscaban resultados dentro de la interfaz. La API oficial sigue siendo la ruta preferida cuando el usuario configura su propia clave; su cuota es limitada y las solicitudes adicionales de páginas consumen cuota.

## Cambio aplicado

- Se añadió un proveedor alternativo de búsqueda a `src/online-services.js`, usando exclusivamente instancias HTTPS incluidas en la lista pública de instancias de Invidious: `invidious.nerdvpn.de`, `yt.chocolatemoo53.com`, `invidious.tiekoetter.com`, `invidious.f5.si` e `inv.nadeko.net`.
- Cuando no hay clave de YouTube, Ritmo intenta primero buscar y mostrar resultados dentro de la aplicación. Cada instancia tiene un tiempo máximo de espera y, si falla, se intenta la siguiente. Si todas fallan, la búsqueda web de YouTube sigue disponible mediante el botón de respaldo.
- El proveedor omite cookies y credenciales, limita la búsqueda a videos, valida el ID y los campos recibidos, y usa miniaturas canónicas de `i.ytimg.com` en lugar de confiar en dominios arbitrarios del resultado.
- Las instancias comunitarias no informan con el mismo nivel de verificación los campos oficiales de incrustación y contenido infantil. Esos resultados se marcan como no verificados y se abren en YouTube: **no** se habilita “Reproducir aquí” sin la verificación de estado de YouTube Data API v3.
- La interfaz explica que la instancia comunitaria recibe la consulta y que se requiere una clave oficial para comprobar permisos de incrustación. El caché del shell offline pasó a `ritmo-shell-v39`.

## Pruebas

`scripts/online-services-check.mjs` cubre la lista permitida de hosts, URLs de consulta, normalización de resultados, rechazo de IDs malformados, fallo de una instancia con reintento en la siguiente y cancelación de búsqueda. Las comprobaciones del shell PWA y paquete Android quedaron sincronizadas con la versión de caché.

La validación automática prueba la lógica usando respuestas simuladas; no demuestra que todas las instancias públicas estén disponibles en todo momento ni que los videos acepten reproducción incrustada. Si las instancias están caídas, bloquean CORS o tienen CAPTCHA, Ritmo conserva el respaldo a YouTube web.

## Comprobación puntual de disponibilidad — 20 de octubre de 2026

Se comprobó la búsqueda de `lofi music` en un navegador sin autenticación. `https://invidious.f5.si/api/v1/search` devolvió HTTP 200 y un arreglo JSON válido con 20 videos, por lo que ahora se intenta primero. En la misma comprobación, `invidious.nerdvpn.de` pidió autenticación (401), `yt.chocolatemoo53.com` e `invidious.tiekoetter.com` devolvieron 403, y `inv.nadeko.net` indicó que el endpoint estaba deshabilitado (403). Son resultados puntuales del entorno de verificación, no una garantía de disponibilidad para todas las regiones o futuras fechas. El código conserva el reintento de las otras instancias listadas.

## Fuentes técnicas

- YouTube Data API v3, método oficial `search.list`: https://developers.google.com/youtube/data/reference/rest/v3/search/list
- Invidious, contrato documentado de búsqueda `GET /api/v1/search`: https://docs.invidious.io/api/
- Invidious, lista de instancias públicas y advertencia de usar instancias no listadas bajo propio riesgo: https://docs.invidious.io/instances/
