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

## Estado verificado de CI y benchmark (11 de noviembre de 2026)

- La rama `main` incorpora el benchmark local mediante `cbc7f6c2e4a97ef4a647ef4de19257155879c2d7`.
- Windows #149 y el build posterior #176 quedaron aprobados sobre sus respectivos SHA. En particular, Windows #177 (run `42961804735`) aprobó el smoke test del paquete de `main` con `RITMO_TEST_ACOUSTIC_CLASSIFIER=1`: la prueba ejecutó la inferencia local real en el portable y el instalador NSIS, además de comprobar instalación, persistencia, conversión y desinstalación. Artefacto: `Ritmo-Windows-177-a0ebd4159919aa50a44b88b6fe24fb2104c0a541`, SHA-256 del ZIP `7e36d997a39f9543c656a1cd049c4943f231d86487aafc0cade189dd3301c341`.
- Cambio de workflow integrado directamente en `main`: `a0ebd4159919aa50a44b88b6fe24fb2104c0a541`. Desde ese commit, las compilaciones Windows de `push` a `main` activan la prueba de inferencia acústica, no solo los PRs de ramas con `genre`.
- Android #395 y Validate #883 aprobaron sobre el mismo SHA. Validate ejecutó `check:runtime`, las pruebas del núcleo del benchmark y las regresiones del clasificador.
- Pages #213 no quedó aprobado: la acción subió correctamente `github-pages-1` y, en el reintento, `github-pages-2`; ambos artefactos aparecen en la API de GitHub. Sin embargo, `actions/deploy-pages@v5` terminó informando que no encontraba el artefacto por nombre. Reintentar solo el job no lo resolvió. Tratarlo como bloqueo de despliegue de Pages / resolución de artefactos hasta que un nuevo run publique correctamente; no declarar CI global verde.

## Investigación de modelo para subgéneros

### Candidato de laboratorio: Discogs-EffNet

La documentación oficial de Essentia describe Discogs-EffNet como un modelo multi-etiqueta con 400 estilos Discogs. La taxonomía oficial incluye etiquetas cercanas a los objetivos de Ritmo: `Latin---Cumbia`, `Electronic---Synthwave`, `Pop---City Pop`, `Pop---J-pop`, y numerosos estilos de Rock y Metal. Esto lo hace un candidato más adecuado para experimentar con subgéneros que el modelo actual de diez clases.

El índice oficial publica discogs-effnet-bsdynamic-1.onnx (18.027.718 bytes). La metadata oficial confirma que el propio ONNX devuelve tanto 400 scores de estilo (salida Sigmoid) como embeddings de 1280 dimensiones. Su entrada no es audio PCM directo: es un mel-espectrograma con forma [batch, 128, 96], a partir de audio mono de 16 kHz. Por tanto, el ONNX ya incluye la cabeza de predicción multi-etiqueta; el trabajo técnico pendiente es reproducir exactamente el preprocesado de mel-espectrograma y comprobar la inferencia CPU con las mismas ventanas de audio. Essentia publica además una cabeza de clasificación separada de unos 2,06 MB que acepta embeddings de 1280 dimensiones y devuelve las mismas 400 salidas; esa ruta sirve si se usa un extractor de embeddings, no es requisito para usar la salida de predicción incluida en el ONNX.

La metadata del modelo informa 400 salidas sigmoid y métricas ROC-AUC 0,95417 / PR-AUC 0,20629 sobre Discogs-4M. Esos números son del entorno/dataset del modelo; no predicen la precisión de Ritmo en una colección independiente y no se deben comparar directamente con el top-1 del modelo actual.

**Licencia:** Essentia declara CC BY-NC-SA 4.0 para los modelos MTG, con alternativa propietaria bajo solicitud. No empaquetar el modelo en Ritmo ni distribuirlo dentro del instalador antes de comprobar que la licencia cubre el uso, distribución y cualquier modalidad de monetización prevista.

### Alternativa más pesada: MAEST

Essentia ofrece variantes MAEST multi-etiqueta de 400/519 estilos. Sus archivos ONNX principales se sitúan aproximadamente entre 344 y 348 MB, antes de contar cabezas y runtime. Por tamaño y objetivo de bajo consumo, queda como referencia comparativa, no como primera integración para el equipo objetivo de Ritmo.

### Dataset auxiliar: MTG-Jamendo

MTG-Jamendo proporciona más de 55.000 pistas completas y splits de investigación con 87 etiquetas de género, además de etiquetas de instrumentos y estados/temas. Su audio usa licencias Creative Commons individuales; la metadata tiene CC BY-NC-SA 4.0 y el proyecto restringe el dataset a investigación académica no comercial salvo autorización escrita de Jamendo. No descargar ni redistribuir el conjunto completo (el propio repositorio informa cientos de GB de audio) ni asumir que todas sus pistas son reutilizables de la misma forma.

### Protocolo necesario antes de elegir un modelo

1. Mantener dos evaluaciones separadas: el benchmark single-label de las diez clases actuales y un benchmark multi-label para los candidatos de 400 estilos.
2. Separar artistas entre `validation` y `test`; revisar etiquetas con personas y documentar fuentes/licencias por pista. Los tags comunitarios sirven como anotación inicial, no como verdad infalible.
3. Para el modelo multi-label informar mAP / PR-AUC, micro y macro precision-recall-F1 a umbrales declarados, top-k y estabilidad entre fragmentos. Agregar categorías padre/hijas solo después de fijar una taxonomía y reglas de evaluación.
4. Comparar en el mismo equipo: peso descargado/instalado, RSS pico, RAM adicional, CPU, hilos, latencia fría/caliente y precisión por estilo.
5. No añadir etiquetas a Ritmo por la mera salida del modelo. Incorporar un estilo solo si tiene soporte suficiente en el conjunto de prueba y se documenta su tasa de falsos positivos.

## Datos reales todavía pendientes

El benchmark actual ya es ejecutable, pero `manifest.example.json` está vacío y no se han registrado canciones etiquetadas ni resultados de precisión reales. No hay base para afirmar que el modelo actual acierta mejor o peor con música real. Para producir métricas válidas hace falta una carpeta local con pistas autorizadas y un manifiesto completado; los archivos de audio no deben añadirse al repositorio. Hasta entonces, estado: **herramienta y pruebas sintéticas validadas; benchmark real pendiente**.

Referencias primarias:
- Essentia models: https://essentia.upf.edu/models.html
- Discogs-EffNet metadata: https://essentia.upf.edu/models/feature-extractors/discogs-effnet/discogs-effnet-bs64-1.json
- Essentia ONNX index: https://essentia.upf.edu/models/feature-extractors/discogs-effnet/
- MTG-Jamendo dataset and licenses: https://github.com/MTG/mtg-jamendo-dataset


## Evaluador multi-etiqueta independiente (12 de noviembre de 2026)

Se añadió un evaluador puro de métricas para recibir los scores ya calculados por un adaptador de modelo. No ejecuta ni descarga EffNet y no contiene canciones.

- Acepta un vector de scores entre 0 y 1 para cada una de las etiquetas del modelo por pista, además de una lista de expectedLabels confirmadas por una persona.
- Calcula mAP con empates agrupados, micro/macro precision-recall-F1 a umbrales explícitos, métricas por etiqueta y top-k precision/recall.
- Exige ID de modelo/revisión, split validation o test, artista seudónimo y declaración de procedencia/derechos.
- Rechaza etiquetas duplicadas/desconocidas, scores ausentes o fuera de rango, pistas sin etiqueta esperada y manifiestos incompletos.
- El informe conserva IDs seudónimos, etiquetas y top-5 sugeridos; no guarda WAV, rutas locales ni los 400 scores completos por pista.

La plantilla manifest.multilabel.example.json usa datos sintéticos y está marcada como tal: no sirve como benchmark musical ni como evidencia de exactitud. El evaluador es infraestructura validada por pruebas unitarias; sigue pendiente crear el adaptador de inferencia EffNet con preprocesado equivalente a Essentia, y después medirlo con pistas autorizadas.

La metadata oficial del ONNX discogs-effnet-bsdynamic-1 identifica 400 etiquetas, entrada mel-espectrograma [batch,128,96], salida sigmoid [batch,400] y embeddings [batch,1280]. Por ello, el ONNX dinámico de EffNet contiene directamente las predicciones de estilo; la cabeza separada genre_discogs400-discogs-effnet-1.pb es una vía alternativa sobre embeddings. No basta con pasar audio PCM al ONNX: hay que igualar su preprocesado de mel-espectrograma.

El preprocesado documentado por Essentia para TensorflowInputMusiCNN usa frames de 512 muestras a 16 kHz (ventana Hann, sin normalización de ventana), espectro de 257 bins, 96 bandas mel, warping Slaney, weighting linear, normalización unit_tri y compresión log10 después de sumar 1 a 10.000 veces la energía mel. TensorflowPredictEffnetDiscogs agrupa 128 frames por parche; el salto predeterminado es 62 frames (aprox. 1,008 predicciones por segundo), aunque permite configurar otro salto. El ONNX espera el tensor [batch,128,96]. Para que las métricas sean comparables, el adaptador debe fijar y registrar frame hop, política de padding del último frame/parche y agregación de scores entre parches; no basta con igualar solo la forma del tensor.

Referencias de modelo:
- Metadata ONNX: https://essentia.upf.edu/models/feature-extractors/discogs-effnet/discogs-effnet-bsdynamic-1.json
- Metadata de la cabeza alternativa: https://essentia.upf.edu/models/classification-heads/genre_discogs400/genre_discogs400-discogs-effnet-1.json
- Índice de pesos ONNX: https://essentia.upf.edu/models/feature-extractors/discogs-effnet/


### Preprocesamiento confirmado y límite de licencia

La documentación oficial de Essentia confirma una cadena concreta para EffNet: audio mono a 16 kHz; extracción MusiCNN con frames de 512 muestras, ventana Hann no normalizada, 96 bandas mel Slaney/unit_tri y compresión log10; los frames se agrupan en parches de 128 × 96. El salto predeterminado entre parches es 62 frames. La implementación de referencia de Essentia se publica bajo AGPLv3, mientras que los pesos MTG siguen CC BY-NC-SA 4.0. El evaluador multi-etiqueta de Ritmo no depende de Essentia ni contiene esos pesos. Antes de crear un adaptador autónomo habrá que validar numéricamente sus mel features contra vectores de referencia de Essentia y revisar qué licencia/ruta de distribución es aceptable; no se está copiando ni empaquetando la biblioteca de referencia.


## Preprocesador EffNet: primer prototipo aislado (13 de noviembre de 2026)

Se añadió `tools/genre-benchmark/effnet-preprocess.mjs`, independiente del reproductor y sin dependencias externas. Implementa el transform de características documentado por Essentia a partir de sus parámetros: frame de 512, hop de 256, ventana Hann sin normalización, 96 bandas Mel Slaney, filtros unit-triangle, potencia y compresión `log10(1 + 10000 × energía)`. Reproduce el FrameCutter por defecto (`startFromZero=false`): empieza con el frame centrado en la muestra cero y retiene el último frame iniciado dentro de la señal incluso cuando su centro llega al final. Agrupa 128 frames por parche con hop 62 y devuelve el tensor `[n,128,96]` que declara el ONNX.

La implementación no contiene código de Essentia ni descarga sus binarios. El test unitario comprueba framing centrado, número de parches, dimensiones, silencio y datos no finitos. **Estado: prototipo de preprocesamiento y pruebas estructurales aprobados; paridad numérica con Essentia pendiente.** No conectar el ONNX ni considerar equivalentes sus scores hasta comparar los mel frames contra una salida de referencia de Essentia (tolerancia objetivo inicial 1e-3, según la reproducción publicada por un colaborador de MTG).

El modelo sigue fuera de Ritmo por licencia pendiente: CC BY-NC-SA 4.0 según la página de licencias de MTG. Essentia como biblioteca usa AGPLv3 para aplicaciones no comerciales; este prototipo no depende de la biblioteca.

Referencias:
- https://essentia.upf.edu/reference/std_TensorflowInputMusiCNN.html
- https://essentia.upf.edu/reference/streaming_TensorflowPredictEffnetDiscogs.html
- https://essentia.upf.edu/licensing_information.html
- https://github.com/MTG/essentia/issues/1471
