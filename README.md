# Ritmo — reproductor musical personal

Ritmo es una aplicación web progresiva (PWA), sin framework ni dependencias de compilación, orientada a una experiencia de reproductor musical cuidada y respetuosa de la privacidad.

## Estado de esta base

- Importar varios archivos de audio y guardarlos en IndexedDB en el dispositivo.
- Biblioteca persistente con búsqueda, favoritos y vistas de archivos locales / fuentes online.
- Reproducción con anterior/siguiente, aleatorio, repetición (cola o canción), barra de tiempo y volumen.
- Añadir URL directa de un archivo o radio que el navegador pueda reproducir.
- PWA instalable, shell cacheado mediante Service Worker y biblioteca local disponible sin internet después de importar los archivos.
- Interfaz responsive para escritorio, móvil y tablet; atajos de teclado básicos.

## Investigación técnica y soluciones a errores

El informe [`docs/technical-error-research-2026-10-18.md`](docs/technical-error-research-2026-10-18.md) relaciona documentación oficial y changelogs con riesgos reales de Ritmo, y describe las pruebas añadidas en `main`.

La búsqueda MediaStore limita la primera carga a 10.000 resultados y avisa si la biblioteca es mayor; las rutas de copia de audio usan una clave SHA-256 basada en la URI.

## Validación de cambios

La validación y la compilación Android comparten la misma batería de regresión mediante `npm run validate`. La APK no se genera si fallan las pruebas de sintaxis, almacenamiento, PWA o navegación táctil.

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


## Ajustes de audio, diagnóstico y recuperación

- **Cola de reproducción real:** el botón de cola abre una vista con las canciones que van a sonar, permite reproducir una pista de inmediato, reordenar elementos, quitar entradas sin borrar los archivos y volver al orden de biblioteca. Los cambios de orden hechos desde esa vista son de la sesión y no reescriben las listas guardadas.
- **Silencio con memoria de volumen:** el control del altavoz silencia y restaura el último volumen audible; el volumen se conserva en las preferencias locales.

El botón de configuración permite modificar el sonido y comprobar qué APIs ofrece el navegador:

- **Ecualizador de tres bandas para archivos locales:** graves, medios/voces y agudos de −12 a +12 dB, guardados como preferencias del dispositivo. Incluye un compresor suave opcional para moderar picos. No modifica el archivo original. Las fuentes online se reproducen con el motor directo: algunas bloquean el acceso CORS que el procesamiento Web Audio necesitaría, así que Ritmo evita ponerlas en una ruta que podría dejarlas mudas.
- **Sonidos de interfaz con prioridad de voz:** 52 perfiles sintetizados localmente, agrupados por carácter, más un modo rítmico automático/Pop/Cyber. Usa el género ID3 de MP3 cuando existe y reconoce etiquetas de estaciones de radio; sin etiquetas conocidas mantiene un pulso discreto o permite elegir el modo a mano. Los efectos permanecen desactivados hasta que el usuario los active; el volumen inicial para instalaciones nuevas es del 15 % y, al detectar música o vídeo, la ganancia de efectos se atenúa al 4 % del nivel configurado. El ritmo añade solo microacentos al hacer clic; no se reproduce en bucle ni promete sincronización BPM. Se silencian durante las muestras del estudio vocal o la síntesis de voz del navegador; los controles de diseño del personaje/estudio vocal no emiten sonidos, ni hay efectos de escritura, hover o scroll. Sin dependencias ni descargas de audio; las preferencias ya guardadas se conservan.
- **Errores recuperables:** muestra avisos específicos para falta de conexión, espera de datos, interrupciones, decodificación y formatos incompatibles; el botón Reintentar vuelve a cargar la fuente y trata de continuar desde la posición anterior.
- **Temporizador para dormir:** 15, 30, 45, 60, 90 o 120 minutos, con desvanecimiento de volumen de cinco segundos opcional. Detiene el audio nativo y cierra el reproductor incrustado de YouTube cuando el temporizador finaliza. Como cualquier temporizador JavaScript, puede retrasarse si el sistema suspende o finaliza la página.
- **Mantener pantalla despierta:** opción explícita que solicita la Screen Wake Lock API. Solo funciona en navegadores compatibles, normalmente bajo HTTPS y mientras la página está visible; el sistema puede rechazarla o revocarla. No evita que Android, iOS o el navegador cierren la aplicación, y no concede reproducción en segundo plano a YouTube.
- **Diagnóstico y almacenamiento:** muestra soporte detectado para Media Session, Web Audio, Wake Lock, IndexedDB y Service Worker, conexión y cuota local. El usuario puede volver a solicitar almacenamiento persistente, pero la decisión corresponde al navegador.
- **Guardar una fuente directa offline:** en una pista que proviene de una URL directa se muestra el control de descarga. Requiere confirmar que el sitio permite conservar el audio; el navegador también debe permitir leer la respuesta mediante CORS. Se rechazan respuestas que parecen páginas HTML, se limita cada descarga a 150 MB y se revisa la cuota de almacenamiento antes de guardar una copia local. No se eluden logins, CORS, paywalls, DRM, ni permisos del servidor.

## Qué no se descarga desde YouTube

La búsqueda, los metadatos y el reproductor incrustado usan las vías oficiales. Ritmo **no extrae ni guarda el audio de videos de YouTube**, ni bloquea los anuncios o habilita la reproducción en segundo plano por fuera de lo permitido por YouTube. Sin clave API, la búsqueda pública continúa disponible en una pestaña del navegador. Para música gratuita guardable offline, usá archivos propios o catálogos que autoricen claramente la descarga (por ejemplo, dominio público o licencias Creative Commons); conservá la atribución y revisá las condiciones de cada obra.


## Música gratuita con licencia abierta

La vista **Música online** incorpora búsqueda de audio en la API pública de Internet Archive. No requiere clave, registro ni suscripción: filtra resultados cuyo metadato declara una licencia Creative Commons. Antes de mostrar archivos, Ritmo consulta la ficha de metadatos, verifica que el elemento sea audio y que la licencia declarada apunte al dominio oficial creativecommons.org, y lista formatos de audio conocidos.

Cada resultado enlaza a su ficha de origen y muestra la licencia declarada. Con **Agregar** se guarda una referencia de streaming en la biblioteca; **Reproducir** la añade y empieza a sonar. **Descargar original** abre el archivo servido por Internet Archive para que el navegador pueda descargarlo sin que Ritmo intente superar las restricciones CORS de los servidores de archivos. Después, importá el archivo descargado para usarlo de verdad sin conexión. Si un ítem no permite verificar licencia o archivos, Ritmo no ofrece sus pistas a través de esta integración.

La búsqueda es un filtro de metadatos, no una garantía legal absoluta: verificá la licencia en la ficha de cada obra, respetá atribución, uso no comercial y restricciones de obras derivadas donde apliquen. La aplicación no almacena localmente las copias del catálogo automáticamente.


> Auditoría técnica de ciclo de vida de Media3, recuperación del controlador y fuentes oficiales (18/10/2026): [informe técnico](docs/technical-error-research-2026-10-mediacontroller-lifecycle.md).

## Uso en teléfonos táctiles

Ritmo incluye navegación inferior para pantallas pequeñas y zonas de toque grandes. Si el reproductor no logra iniciar, aparecerá un aviso de recuperación con opción para recargar en vez de dejar botones aparentemente muertos. La compatibilidad exacta debe comprobarse en el navegador o WebView de cada teléfono.

## APK para Android

Ritmo también puede empaquetarse como aplicación Android con Capacitor. Cada cambio enviado a `main` ejecuta el workflow **Build Ritmo Android APK**, que compila un APK de depuración, verifica su firma y publica el archivo más una suma SHA-256 en el artefacto de esa ejecución.

- **Descargar la APK más reciente:** abrí [Actions → Build Ritmo Android APK](https://github.com/rikosama473-sketch/reproductor/actions/workflows/android-apk.yml?query=branch%3Amain), entrá en la última ejecución correcta de `main` y descargá el artefacto `Ritmo-APK-…`.
- La app incluye los archivos web del commit y puede funcionar sin conexión después de importar música local. Las búsquedas por internet y fuentes online siguen necesitando conexión.
- En Android, **Buscar música del teléfono** pide el permiso de audio del sistema y consulta las canciones indexadas por Android; **Importar archivos** abre el selector nativo para navegar por carpetas y elegir varios audios. El selector solo comparte los archivos que elegís; el permiso amplio se solicita únicamente al escanear la biblioteca.
- Es una APK de depuración firmada automáticamente por las herramientas Android, pensada para instalación personal y pruebas. **No es una publicación de Google Play ni una firma de lanzamiento permanente**; no uses esta firma como clave de distribución. Según el certificado de depuración de cada runner, una nueva APK podría exigir desinstalar la anterior antes de instalarla; desinstalar la app puede borrar sus archivos locales.
- Para preparar el proyecto nativo en tu máquina: instalá Node.js 22 o superior, JDK 21 y el Android SDK (API 36); luego ejecutá `npm install`, `npm run android:init` (solo la primera vez) y `npm run android:sync`. En `android/`, ejecutá `./gradlew assembleDebug` (Windows: `gradlew.bat assembleDebug`).
- Para distribuir actualizaciones sin perder instalaciones existentes o publicar en Play Console hace falta configurar una clave privada de lanzamiento y protegerla como secreto del entorno de compilación. No debe guardarse en este repositorio público.

Detalles y fuentes del empaquetado: [docs/android-apk-packaging.md](docs/android-apk-packaging.md).
