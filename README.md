# Ritmo — reproductor musical personal

Ritmo es una aplicación web progresiva (PWA), sin framework ni dependencias de compilación, orientada a una experiencia de reproductor musical cuidada y respetuosa de la privacidad.

## Estado de esta base

- Importar varios archivos de audio y guardarlos en IndexedDB en el dispositivo.
- Biblioteca persistente con búsqueda, favoritos y vistas de archivos locales / fuentes online.
- Reproducción con anterior/siguiente, aleatorio, repetición (cola o canción), barra de tiempo y volumen.
- Añadir URL directa de un archivo o radio que el navegador pueda reproducir.
- PWA instalable, shell cacheado mediante Service Worker y biblioteca local disponible sin internet después de importar los archivos.
- Interfaz responsive para escritorio, móvil y tablet; atajos de teclado básicos.

## Publicar la versión online

El workflow `.github/workflows/deploy-pages.yml` publica el sitio estático en GitHub Pages cuando los cambios llegan a `main`. En la primera publicación, si el repositorio no tiene Pages habilitado, abrí **Settings → Pages** y seleccioná **GitHub Actions** como fuente de publicación; luego ejecutá el workflow `Deploy Ritmo to GitHub Pages` desde la pestaña Actions.

La URL esperada para este repositorio es https://rikosama473-sketch.github.io/reproductor/ una vez que Pages haya terminado de publicar correctamente.

## Ejecutar localmente

Los Service Workers requieren un contexto seguro. Para probar localmente, iniciá un servidor estático en la raíz:

```bash
python -m http.server 8000
```

Luego abrí http://localhost:8000. En producción, publicá la carpeta completa en un host estático con HTTPS (GitHub Pages, por ejemplo, sirve para la capa estática).

## Importante sobre online y offline

Los archivos locales se guardan en IndexedDB del navegador; no se suben a ningún servidor. El navegador y el sistema operativo controlan la cuota, y pueden limpiar datos en ciertas circunstancias. La aplicación intenta solicitar almacenamiento persistente, pero el navegador decide si lo concede. Exportar/copiar los originales sigue siendo recomendable.

Los enlaces online guardan solamente la URL y metadatos mínimos. Necesitan conexión, pueden fallar por CORS, tipo MIME, geobloqueo, restricciones del host o formato no compatible. Esta base no descarga, extrae ni vuelve a alojar audio desde YouTube, Spotify u otros servicios; las fuentes deben ser directas y estar autorizadas para su uso.

El almacenamiento offline actual está pensado para archivos importados por el usuario, no para almacenar automáticamente el contenido de URLs externas.

## Limitaciones actuales / siguiente etapa

- No hay todavía catálogo de búsqueda musical online, backend de cuentas ni sincronización en la nube.
- Los metadatos se infieren del nombre del archivo; aún no se leen etiquetas ID3/Vorbis, carátulas embebidas ni letras sincronizadas.
- La cola reproduce la biblioteca cargada; todavía no tiene administración manual de cola ni listas de reproducción editables.
- Un reproductor web no garantiza la reproducción en segundo plano o controles de pantalla bloqueada en todos los navegadores/dispositivos.
- La compatibilidad PWA depende del navegador; para Android/iOS nativos haría falta un empaquetado y una capa de audio nativa.

## Privacidad

Sin cuenta, analítica ni telemetría en esta versión. La tipografía web puede hacer una petición externa; las fuentes de audio online las decide el usuario. Para una distribución totalmente independiente, se puede retirar la fuente tipográfica remota y alojar tipografías propias con sus licencias.

## Licencia

Pendiente de elegir antes de publicar una distribución formal.
## Búsqueda musical de YouTube

Ritmo permite buscar videos musicales desde su interfaz usando la **YouTube Data API v3**. La búsqueda integrada requiere una clave personal de Google Cloud que el usuario introduce en la configuración online; se guarda en el almacenamiento local del navegador, no en el repositorio ni en un servidor de Ritmo. La API tiene cuota gratuita limitada y su disponibilidad depende de que la clave y el proyecto estén configurados correctamente. La clave de una aplicación web no es secreta frente a quien usa el navegador: restringila por sitio web y a YouTube Data API v3 en Google Cloud.

Sin una clave, el botón **Abrir búsqueda en YouTube** continúa disponible y abre los resultados públicos en el navegador. Los videos se reproducen exclusivamente a través del reproductor oficial de YouTube; Ritmo no descarga ni extrae sus streams.

Ritmo es gratuita, sin cuenta, sin suscripción, sin publicidad propia y sin telemetría. No bloquea ni suprime los anuncios servidos por YouTube dentro de su reproductor insertado: las políticas de YouTube para clientes API prohíben restringir la reproducción de anuncios. Para aplicar Brave Shields, el usuario debe abrir YouTube en el navegador Brave con sus protecciones activadas. Una página web no puede activar esas protecciones de forma remota.

Referencias técnicas: [YouTube Data API — search.list](https://developers.google.com/youtube/v3/docs/search/list), [YouTube IFrame Player API](https://developers.google.com/youtube/iframe_api_reference), [políticas para desarrolladores de YouTube](https://developers.google.com/youtube/terms/developer-policies-guide).

Before embedding a search result, Ritmo also consults the official `videos.list` endpoint for `status.madeForKids` and `status.embeddable`. Only a result whose status was successfully checked, which is not designated Made for Kids and is embeddable, is offered in the integrated player. A video marked Made for Kids, an unembeddable video, or a video whose status could not be verified is opened directly in YouTube instead. This follows YouTube's [Made for Kids status guide](https://developers.google.com/youtube/data/guides/made_for_kids_status) and [developer policies](https://developers.google.com/youtube/terms/developer-policies-guide).


## Historial, listas y uso móvil/offline

IndexedDB v2 conserva los archivos importados, el historial de reproducciones y las listas de reproducción en este navegador/dispositivo. El historial guarda un registro por reproducción, no solo la fecha del último tema. Las búsquedas de YouTube completadas se guardan como metadatos de la última consulta para consultar esos resultados previamente vistos sin conexión; reproducir un video de YouTube sigue requiriendo internet. Listas, historial y biblioteca no se sincronizan entre dispositivos en esta versión.

La reproducción local integra Media Session cuando el navegador lo soporta para exponer título, artista, progreso y controles de play/pausa, anterior/siguiente y búsqueda en los controles del sistema. La API tiene soporte desigual y el navegador/OS decide si permite reproducción en segundo plano con la pantalla bloqueada.

La importación se procesa en lotes de 20, conserva los blobs originales sin recodificarlos y evita una transacción única gigante. El navegador decide la cuota real disponible. Los metadatos ID3v2 básicos (título, artista, álbum) se leen de archivos MP3; en otros formatos el título se infiere del nombre de archivo en esta versión.

Formatos frecuentes en navegadores modernos incluyen MP3, AAC/M4A, WAV, Ogg Vorbis/Opus, WebM Opus y FLAC, dependiendo del navegador, sistema y códec. La interfaz informa `canPlayType()` para varios tipos. WMA, APE, AIFF y otros códecs poco comunes no están garantizados. No se falsifica compatibilidad ni se hace transcodificación local en esta versión.

Las reproducciones de YouTube solo guardan metadatos del historial, nunca archivos de audio. La app usa el reproductor oficial, y ese contenido no está disponible sin conexión.
