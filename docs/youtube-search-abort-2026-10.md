# Cancelación de búsquedas de YouTube obsoletas — 19 de octubre de 2026

## Hallazgo y corrección
La UI ya descartaba resultados de una búsqueda antigua por su ID de solicitud, pero no cancelaba la petición HTTP ni la petición secundaria que comprueba si los vídeos pueden incrustarse. Al escribir varias consultas rápidamente, el navegador podía seguir gastando red y cuota en resultados que la interfaz ya no iba a mostrar.

- Al comenzar una consulta nueva, se cancela la anterior mediante `AbortController`.
- La solicitud principal de `search.list` y la comprobación secundaria de `videos.list` comparten el mismo `AbortSignal`.
- `AbortError` debido a la cancelación no aparece como un error de usuario.
- `Cargar más` se deshabilita mientras una búsqueda está en curso para prevenir pulsaciones repetidas y páginas duplicadas.
- Se incrementó el shell PWA a `ritmo-shell-v32` y se añadieron aserciones de regresión.

## Investigación externa
MDN documenta que `AbortController.abort()` puede cancelar un fetch y la lectura de su cuerpo: https://developer.mozilla.org/en-US/docs/Web/API/AbortController . La documentación de YouTube confirma que cada solicitud de búsqueda ocupa cuota de API y que las peticiones de paginación también cuestan cuota: https://developers.google.com/youtube/data/determine_quota_cost?hl=en . Por eso evitar consultas obsoletas reduce trabajo y ayuda a no agotar la cuota por solicitudes redundantes.

Se verificaron tres instancias públicas de Invidious (19-10-2026): [Nadeko](https://inv.nadeko.net/api/v1/search?q=lofi%20girl&type=video) devolvió 403 “Endpoint disabled”, [NerdVPN](https://invidious.nerdvpn.de/api/v1/search?q=lofi%20girl&type=video) pidió autenticación (401), y [Tiekoetter](https://invidious.tiekoetter.com/api/v1/search?q=lofi%20girl&type=video) devolvió 403. Las tres respuestas también fallaron CORS desde una página web común, por lo que no son un sustituto estable de la API oficial sin clave.

## Validación
Las aserciones se ejecutan dentro de `npm run validate`; el nuevo commit necesita pasar CI, despliegue y build Android para declararse verificado.
