# Ritmo — reproductor musical personal

Ritmo es una aplicación web progresiva (PWA), sin framework ni dependencias de compilación, orientada a una experiencia de reproductor musical cuidada y respetuosa de la privacidad.

## Plataformas separadas: móvil primero y PC

El código del reproductor se conserva en una sola fuente compartida en la raíz, pero cada plataforma tiene su propia carpeta de configuración y salida generada para que sus dependencias y artefactos no se mezclen:

- **Móvil Android — `mobile/`**: prioridad de empaquetado nativo, permisos de biblioteca musical, selector de archivos/carpetas y reproducción Media3. Para prepararlo, ejecutá `npm install --prefix mobile` y después `npm --prefix mobile run android:init` (primera vez) o `npm --prefix mobile run android:sync` (actualizaciones).
- **PC / navegador de escritorio — `desktop/`**: PWA preparada de forma independiente, sin el puente nativo de Android. Ejecutá `npm --prefix desktop run start` para preparar y abrir el reproductor en `http://127.0.0.1:4173`. `desktop/dist` es la salida publicada; no es un instalador .exe.
- **Pruebas**: desde la raíz, `npm install --prefix mobile` y `npm run validate` prueban el paquete Android y ambas salidas. La aplicación móvil de navegador también puede abrir la PWA en el teléfono, pero iOS todavía no tiene un paquete nativo propio.

Las carpetas `mobile/www`, `mobile/android` y `desktop/dist` se generan automáticamente: no las edites a mano. Los cambios funcionales se hacen en los archivos compartidos de la raíz y luego se reconstruye cada salida.


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
- La importación lee etiquetas de texto ID3v2 de MP3 y carátulas JPEG/PNG incrustadas en ID3 APIC/PIC (máximo 512 KiB por imagen); todavía no lee etiquetas Vorbis/MP4, no edita las etiquetas originales y no extrae letras sincronizadas.
- La cola reproduce la biblioteca cargada; todavía no tiene administración manual de cola ni listas de reproducción editables.
- Un reproductor web no garantiza la reproducción en segundo plano o controles de pantalla bloqueada en todos los navegadores/dispositivos.
- La compatibilidad PWA depende del navegador. La carpeta `mobile/` empaqueta la versión Android nativa; iOS nativo todavía no se declara compatible.


## Conversor de audio local — primera etapa

La vista **Convertir audio** convierte uno o varios archivos a WAV RIFF con muestras PCM enteras de 16 bits. Permite solicitar 44,1 o 48 kHz y salida mono o estéreo; el navegador puede no aceptar la frecuencia solicitada y Ritmo muestra la frecuencia real utilizada. Los archivos se decodifican uno por uno y se generan enlaces para descargar los WAV. Los originales no se modifican ni se eliminan.

Para evitar agotar la memoria, esta primera versión limita cada entrada a 50 MiB y 7 minutos, una tanda a 5 archivos y 100 MiB de entrada, y los resultados retenidos a 120 MiB. Antes de decodificar, el conversor intenta leer la duración desde los metadatos del navegador y rechaza pistas de más de siete minutos; también estima el tamaño WAV para respetar el espacio restante de resultados. Cada archivo descargado recibe además un nombre seguro y único dentro de la tanda, para evitar colisiones cuando diferentes formatos comparten el mismo nombre base. Las entradas quad y 5.1 usan matrices de mezcla estéreo/mono definidas por Web Audio; se omite el canal LFE al reducir el número de canales. Antes de codificar PCM16 se mide el pico de la mezcla y, solo si excedería escala completa, se aplica una atenuación fija a toda la salida: evita recorte duro sin comprimir la dinámica relativa. Para layouts no estándar, Ritmo no adivina la posición de los altavoces y conserva únicamente los canales de salida disponibles. Si el navegador no puede confirmar una duración finita, la conversión se cancela por seguridad. Aun con esta comprobación, los límites de memoria se vuelven a validar después de decodificar, porque el navegador no expone un decodificador PCM de streaming en esta arquitectura. Antes de reservar el WAV final, el conversor vuelve a calcular el tamaño a partir de los fotogramas decodificados y rechaza salidas que excedan el presupuesto real disponible; después verifica la cabecera RIFF, PCM16, frecuencia, canales, alineación y la longitud exacta de los datos leyendo solo los 44 bytes de cabecera. La verificación estructural no reproduce el resultado ni sustituye una escucha o un decodificador externo. La decodificación requiere el archivo completo en memoria; por eso todavía no es adecuada para grabaciones largas ni bibliotecas enteras. Solo funcionan los formatos que el navegador y sus códecs puedan decodificar. Cada WAV verificado también tiene una vista previa reproducible desde los resultados; el reproductor se abre solo cuando se solicita y usa el mismo Blob que se descarga. Si el navegador no consigue reproducir la vista previa, la descarga sigue disponible. El WAV de salida no conserva etiquetas ni carátulas embebidas. No incluye aún codificación de salida MP3/AAC/FLAC/Ogg, edición de etiquetas ni guardado en una carpeta elegida. La cancelación interrumpe la comprobación de metadatos y evita iniciar una lectura/decodificación pendiente; si `decodeAudioData()` ya está ejecutándose, el navegador no permite detener esa llamada y Ritmo descarta el resultado cuando termina.

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

La importación se procesa en lotes de 20, conserva los blobs originales sin recodificarlos y evita una transacción única gigante. El navegador decide la cuota real disponible. En archivos MP3 se leen los textos ID3v2 de título, artista, álbum y género, y se extrae la primera portada JPEG/PNG compatible; si hay varias, se prioriza la imagen de tipo «cover frontal». Las portadas quedan guardadas como Blob local junto con el audio, se muestran en la biblioteca y en el reproductor, y se ofrecen a Media Session cuando el navegador admite esa API. La lectura examina solo los primeros 2 MiB de la etiqueta, conserva como máximo 512 KiB de imagen por pista y limita las dimensiones a 4096 × 4096 y 8,39 megapíxeles por portada antes de que el navegador intente decodificarla. Descarta MIME no soportados, firmas/dimensiones inconsistentes, enlaces remotos y portadas sobredimensionadas; si el navegador rechaza una imagen, Ritmo vuelve al placeholder y guarda ese resultado para no repetir la decodificación fallida. Las pistas MP3 importadas antes de esta mejora se vuelven a analizar de forma diferida la primera vez que se reproducen; no se modifica ni recodifica el audio original. En otros formatos, el título se sigue infiriendo del nombre del archivo.

En nuevas importaciones, Ritmo también compara por bytes exactos los archivos de igual tamaño cuando conserva acceso a ambos como `Blob`. La lectura se hace en bloques de hasta 256 KiB por defecto (con tope de 1 MiB), sin cargar la pista completa en memoria. Así se omiten copias binarias idénticas aunque tengan otro nombre o carpeta, pero no se confunden archivos distintos por compartir tamaño o nombre. Es una comparación de archivos, no una huella acústica: una misma canción recodificada o con etiquetas diferentes no se clasifica como idéntica. La app nunca elimina los originales. Las pistas nativas Android sin un `Blob` accesible siguen deduplicándose por URI/identidad y no se comparan por contenido.

Antes de analizar etiquetas o guardar, la importación omite archivos de audio con tamaño cero o tamaño no válido y muestra cuántos se rechazaron; los archivos no compatibles siguen diferenciándose de archivos de audio vacíos. Un archivo vacío no se añade a la biblioteca como una pista aparentemente válida.

Formatos frecuentes en navegadores modernos incluyen MP3, AAC/M4A, WAV, Ogg Vorbis/Opus, WebM Opus y FLAC, dependiendo del navegador, sistema y códec. La interfaz informa `canPlayType()` para varios tipos. WMA, APE, AIFF y otros códecs poco comunes no están garantizados. No se falsifica compatibilidad. La importación conserva los originales; el conversor local puede crear WAV PCM16 únicamente desde formatos que el navegador consiga decodificar, con límites explícitos de tamaño y duración.

Las reproducciones de YouTube solo guardan metadatos del historial, nunca archivos de audio. La app usa el reproductor oficial, y ese contenido no está disponible sin conexión.


## Ajustes de audio, diagnóstico y recuperación

- **Cola de reproducción real:** el botón de cola abre una vista con las canciones que van a sonar, permite reproducir una pista de inmediato, reordenar elementos, quitar entradas sin borrar los archivos y volver al orden de biblioteca. Los cambios de orden hechos desde esa vista son de la sesión y no reescriben las listas guardadas.
- **Silencio con memoria de volumen:** el control del altavoz silencia y restaura el último volumen audible; el volumen se conserva en las preferencias locales.

El botón de configuración permite modificar el sonido y comprobar qué APIs ofrece el navegador:

- **Ecualizador de tres bandas para archivos locales:** graves, medios/voces y agudos de −12 a +12 dB, guardados como preferencias del dispositivo. Incluye perfiles para piano clásico, instrumental, orquesta, bandas sonoras, acústica, Pop/Rock/Jazz, voces, electrónica, cyberpunk, synthwave, ambient y bandas sonoras de videojuegos/anime; cada perfil describe su intención tonal, pero la curva es amplia (solo tres bandas) y no promete mejorar todos los temas. El modo **Limpio (sin procesamiento)** desactiva tanto el ecualizador como el limitador; **Plano** deja las bandas en 0 dB y permite controlar el limitador aparte. Incluye un compresor suave opcional para moderar picos. No modifica el archivo original. Las fuentes online se reproducen con el motor directo: algunas bloquean el acceso CORS que el procesamiento Web Audio necesitaría, así que Ritmo evita ponerlas en una ruta que podría dejarlas mudas. El limitador suave también pertenece a esa ruta Web Audio local; la integración nativa Media3 de Android aplica las bandas del ecualizador cuando el efecto del dispositivo está disponible, pero no implementa el limitador.
- **Sonidos de interfaz con prioridad de voz:** 88 perfiles sintetizados localmente, agrupados por carácter, más un modo automático por género y opciones manuales Suave/Pop/Rock/Cyber. Lee el género ID3 de MP3 al importarlos y completa esa etiqueta de forma perezosa en archivos MP3 ya guardados, sin reimportarlos; también reconoce etiquetas de estaciones de radio. Sin etiquetas conocidas mantiene un pulso discreto o permite elegir el modo a mano. Los efectos permanecen desactivados hasta que el usuario los active; el volumen inicial para instalaciones nuevas es del 15 % y, al detectar música o vídeo, la ganancia de efectos se atenúa al 4 % del nivel configurado. El ritmo añade solo microacentos al hacer clic y ajusta la separación mínima según el modo resuelto: 170 ms en Pop, 150 ms en Cyber, 210 ms en Rock y 240 ms en Suave. Los acentos adicionales suenan solo en algunas interacciones: uno de cada dos clics en Pop/Rock y uno de cada tres en Cyber. No se reproduce en bucle ni promete sincronización BPM. El estado de reproducción de los motores HTML, YouTube/Spotify y Media3 de Android activa la atenuación; si la música empieza mientras un efecto aún decae, se reduce de inmediato. Se silencian durante las muestras del estudio vocal o la síntesis de voz del navegador; los controles de diseño del personaje/estudio vocal no emiten sonidos, ni hay efectos de escritura, hover o scroll. Las tandas recientes incluyen Clavicémbalo mate, Órgano vintage suave, Bajo redondo, Taiko amortiguado, Láser mate, Terminal silenciosa, Glitch delicado, FM cristalino suave, Synth-pop cálido, Pulso neón, Sueño vaporoso, Casete analógico, Cuerda pizzicato, Ocarina tenue, Bloque de madera, Guitarra de nylon, Bombo acolchado, Canicas, FM profunda, Ondulación, Vibráfono aterciopelado, Shamisen tenue, Caña suave, Metal apagado, Tambor de marco, Bajo de circuito, Barrido suave, Circuito digital, Saxo aterciopelado, Chelo cálido, Clavinet suave, Metalófono mate, Conga acolchada, Subgrave sintético, Pad de seda y Campana tubular tenue. Cada perfil es un timbre sintetizado corto; no son grabaciones reales. Sin dependencias ni descargas de audio; las preferencias ya guardadas se conservan.
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
- Para preparar el proyecto nativo en tu máquina: instalá Node.js 22 o superior, JDK 21 y Android SDK (API 36); luego ejecutá `npm install --prefix mobile`, `npm --prefix mobile run android:init` (solo la primera vez) y `npm --prefix mobile run android:sync`. Compilá dentro de `mobile/android/` con `./gradlew assembleDebug` (Windows: `gradlew.bat assembleDebug`).
- Para distribuir actualizaciones sin perder instalaciones existentes o publicar en Play Console hace falta configurar una clave privada de lanzamiento y protegerla como secreto del entorno de compilación. No debe guardarse en este repositorio público.

Detalles y fuentes del empaquetado: [docs/android-apk-packaging.md](docs/android-apk-packaging.md).
