# Spotify y radios públicas sin clave propia — 19 de octubre de 2026

## Qué se añadió

- Carga de enlaces compartidos de Spotify (canción, álbum, lista, artista, show o episodio) mediante el iFrame API oficial. No se pide a cada usuario una clave de desarrollador.
- La búsqueda del título abre los resultados públicos de Spotify sin consultar su Web API. La metadata opcional usa el endpoint público oEmbed.
- Los controles del reproductor inferior (reproducir, pausar y posición para episodios cuando el embed emite esos eventos) siguen el estado del iFrame API oficial. El compañero animado se sincroniza cuando el API está disponible. Si no, se muestra el iframe oficial con sus propios controles.
- Búsqueda pública de emisoras a través del directorio Radio Browser, sin cuenta ni API key del usuario. Se prueban mirrors alternativos, solo se listan streams HTTPS compatibles y el inicio de reproducción notifica el clic al directorio.
- El nuevo código está en el shell offline; la búsqueda, los widgets y las emisiones siguen necesitando conexión.

## Límites transparentes

- Un embed de Spotify no equivale a la Web API ni permite descargar canciones. Spotify decide si una pista completa está disponible, muestra una vista previa o pide iniciar sesión. El widget tiene sus propios controles de volumen y no garantiza los controles Android en pantalla bloqueada.
- Se aceptan URL públicas completas de `open.spotify.com` y URIs Spotify; se rechazan hosts no oficiales y enlaces acortados.
- Las radios pueden desconectarse, cambiar URL, usar geobloqueo o mostrar anuncios. Ritmo no aloja audio ni garantiza los metadatos de terceros. Se omiten streams HTTP y HLS `.m3u8`, que no están habilitados como ruta nativa general en esta compilación.

## Fuentes técnicas

- Spotify Embeds: https://developer.spotify.com/documentation/embeds
- Spotify iFrame API: https://developer.spotify.com/documentation/embeds/references/iframe-api
- Spotify Embed troubleshooting: https://developer.spotify.com/documentation/embeds/tutorials/troubleshooting
- Spotify Web API: https://developer.spotify.com/documentation/web-api/reference
- Radio Browser API reference: https://docs.radio-browser.info/

## Validación

`scripts/online-services-check.mjs` valida enlaces Spotify, rechaza hosts falsos, verifica streams HTTPS, excluye HLS y prueba el fallback de mirror. CI debe completar la batería y compilar la APK antes de distribuir una versión candidata.
