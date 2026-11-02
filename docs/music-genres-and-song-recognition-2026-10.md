# Géneros musicales y reconocimiento de canciones

## Qué hace Ritmo hoy

Ritmo separa cuatro conceptos que no deben mezclarse:

- **Género guardado:** procede de etiquetas del archivo o de metadatos nativos. Los lectores ID3, Vorbis/FLAC/Opus, WAV y metadatos nativos comparten la normalización en `src/music-genres.js`.
- **Sugerencias de catálogo:** consulta Apple/iTunes por título y artista solo cuando el usuario la solicita. Usa coincidencia textual y el género primario publicado por el catálogo; no escucha la canción.
- **Clasificación acústica local:** analiza una pista importada en el dispositivo con el modelo descrito abajo.
- **Identificación de canción:** intenta reconocer una grabación por un servicio independiente, como AudD. No es una clasificación de género.

Los campos de género ausentes permanecen vacíos hasta que exista una fuente verificable o el usuario los complete. No se deben inventar etiquetas a partir del nombre del archivo o del artista.

## Normalización de etiquetas y sonidos de interfaz

La normalización convierte códigos ID3 conocidos en sus etiquetas, conserva las etiquetas compuestas admitidas y no inventa un género cuando el código es desconocido. Los modificadores ID3 `(RX)` (remix) y `(CR)` (cover) se eliminan antes de interpretar códigos adyacentes, por ejemplo `(RX)(17)` → `Rock` y `(CR)(13)` → `Pop`.

`inferUiSoundRhythm()` **no clasifica el género musical**. Solo decide el ritmo de los sonidos opcionales de la interfaz a partir de etiquetas conocidas; para estilos que no reconoce devuelve `null` y usa el perfil neutro. Esta regla no modifica ni ecualiza el audio de la canción. Los sonidos de interfaz están desactivados por defecto.

## Sugerencias de género desde un catálogo

El editor puede consultar el catálogo de Apple/iTunes por título y artista. La respuesta incluye un género primario catalogado, no una predicción acústica. La interfaz muestra la pista que coincidió y un indicador de similitud textual; ese porcentaje no expresa confianza musical. La persona elige una propuesta y todavía debe pulsar **Guardar cambios**. La búsqueda no modifica el archivo fuente, no analiza el audio y no ejecuta cambios por lotes.

La consulta usa metadatos de texto y no envía el archivo ni un fragmento de audio. Requiere conexión y Modo Internet. La fuente es la [iTunes Search API de Apple](https://performance-partners.apple.com/search-api), que documenta `primaryGenreName` en los resultados de canción. Si el navegador bloquea `fetch()` por CORS, Ritmo usa un callback dentro de un iframe con origen opaco y sin acceso al almacenamiento de la aplicación. Si el catálogo no responde, la ficha queda sin cambios.

Cuando hay varias pistas con el mismo género, la sugerencia conserva la coincidencia título/artista con mayor puntuación textual. Aun así, el catálogo puede ofrecer un género amplio o distinto al que el usuario considera correcto; para estilos minoritarios, lanzamientos regionales o metadatos ausentes, prevalece la revisión humana.

## Clasificador acústico local actual

La opción **Analizar audio local** usa la conversión ONNX de [Musical-genres-Classification-Hubert-V1](https://huggingface.co/SeyedAli/Musical-genres-Classification-Hubert-V1), distribuida en formato compatible con Transformers.js como [ONNX cuantizado](https://huggingface.co/onnx-community/Musical-genres-Classification-Hubert-V1-ONNX). El modelo se ajustó sobre GTZAN y su ficha publica una exactitud de evaluación de 0,84 en ese conjunto; ese dato es autodeclarado por el modelo y Ritmo no lo ha reproducido como una medición independiente ([ficha del modelo](https://huggingface.co/SeyedAli/Musical-genres-Classification-Hubert-V1)). GTZAN cubre solo diez categorías amplias, por lo que esa cifra no garantiza resultados con cualquier catálogo musical.

- **Entrada:** una canción importada localmente, de hasta 40 MB. No admite streaming ni edición por lote.
- **Análisis:** decodifica el audio a mono y 16 kHz. En pistas cortas usa una ventana central de hasta 12 segundos; en pistas suficientemente largas analiza dos fragmentos separados, de hasta 12 segundos cada uno (máximo aproximado de 24 segundos de audio).
- **Agregación:** promedia las puntuaciones de cada etiqueta entre los fragmentos. También muestra en cuántos fragmentos una etiqueta quedó en primer lugar, para que el usuario pueda detectar desacuerdo temporal. Este consenso es una señal de estabilidad entre muestras; **no es una exactitud medida ni una probabilidad calibrada**.
- **Categorías:** Blues, Clásica, Country, Disco, Hip-Hop, Jazz, Metal, Pop, Reggae y Rock. No clasifica directamente subgéneros como Cumbia, J-Pop, City Pop o Synthwave, ni variantes regionales.
- **Privacidad:** la canción no se envía a un servidor ni se sube a Apple/AudD. La primera ejecución requiere conexión para descargar el runtime y los pesos cuantizados (aprox. 24 MB); el procesamiento de las muestras se hace en el worker local con WebAssembly/CPU y máximo dos hilos.
- **No destructivo:** el análisis solo propone etiquetas. La persona elige «Usar género» y después «Guardar cambios»; nunca se altera el archivo de audio ni se sustituye silenciosamente el género existente.

El análisis por fragmentos ayuda a reducir la dependencia de una única parte de la canción, pero no añade conocimiento de subgéneros al modelo. No debe describirse como una solución definitiva para géneros regionales ni como una mejora de precisión probada hasta contrastarlo con una colección autorizada de canciones reales y etiquetas de referencia.

## Reconocimiento de canciones al estilo Shazam/AudD

La identificación de canciones es una función diferente. Ritmo puede capturar un fragmento breve por micrófono y consultar AudD si el usuario habilita Modo Internet, concede permiso de micrófono y configura un token válido. No es exclusiva de teléfonos: también está disponible en la aplicación de escritorio Windows. La solicitud usa audio de la captura con el consentimiento del usuario; no es la misma operación que clasificar localmente una pista de la biblioteca.

La prueba automatizada de escritorio comprueba permisos, consentimiento y empaquetado, pero no sustituye una identificación real con token válido y una canción comercial reproducible. Esa prueba en vivo debe verificarse por separado.

## Próximo criterio de evaluación

Antes de sustituir el modelo o afirmar una mejora de aciertos, Ritmo necesita un conjunto de prueba reproducible con permiso de uso, diversidad regional y etiquetas revisadas por personas. Debe informar al menos exactitud por clase, macro-F1, matriz de confusión, tasa de desacuerdo entre fragmentos, tiempo de inferencia y memoria consumida. Una puntuación global aislada sobre GTZAN no basta para validar Cumbia, J-Pop, City Pop, Synthwave ni otros subgéneros.


## Herramienta local de evaluación (noviembre de 2026)

Se añadió `tools/genre-benchmark/` como herramienta de desarrollo independiente. No se descarga ni ejecuta durante la reproducción normal y no agrega canciones al repositorio.

- Acepta un manifiesto JSON de pistas WAV PCM16 locales, una etiqueta principal revisada por pista, un identificador seudónimo de artista y una declaración de derechos/procedencia.
- Ejecuta exactamente el modelo actual y su revisión fijada; limita la sesión ONNX de CPU a dos hilos intra-op y uno inter-op.
- Informa top-1, top-3, macro-F1, macro-recall, métricas por clase, matriz de confusión, estabilidad entre fragmentos, latencia y memoria RSS observada.
- Rechaza rutas fuera de la carpeta de datos, enlaces simbólicos que escapen de ella, formatos WAV no compatibles y pistas superiores al límite de 40 MiB.
- El JSON de resultados no almacena rutas locales, audio ni nombres reales; solo IDs seudónimos, etiquetas y métricas.

La herramienta mide únicamente las diez clases del modelo actual. No demuestra calidad en subgéneros. Para evaluar taxonomías multi-etiqueta como Discogs 400 o MTG-Jamendo se necesitará un adaptador de modelo y un protocolo multi-etiqueta separado, además de resolver previamente las licencias.

Instrucciones y plantilla: [`tools/genre-benchmark/README.md`](../tools/genre-benchmark/README.md) y [`manifest.example.json`](../tools/genre-benchmark/manifest.example.json).