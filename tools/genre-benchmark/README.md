# Benchmark local de géneros de Ritmo

Esta herramienta mide el clasificador acústico que ya utiliza Ritmo. No modifica el reproductor, no entrena un modelo y no incluye canciones. Lee WAV locales, ejecuta el modelo ONNX cuantizado en CPU y genera métricas reproducibles.

## Alcance actual

El benchmark mide las diez etiquetas del modelo actual: Blues, Clásica, Country, Disco, Hip-Hop, Jazz, Metal, Pop, Reggae y Rock. **No evalúa Cumbia, J-Pop, City Pop, Synthwave ni otras subetiquetas** porque el modelo no las predice.

Usa el mismo ID/revisión del modelo y comparte con Ritmo la selección, normalización y agregación de las ventanas. Decodifica directamente WAV PCM16 y convierte a mono 16 kHz; la app decodifica mediante AudioContext, por lo que esa etapa no es bit a bit idéntica. La inferencia usa Transformers.js 3.7.2, ONNX Runtime CPU, dos hilos intra-op y uno inter-op. La primera ejecución necesita Internet para descargar el runtime y los pesos; las canciones de la prueba permanecen locales.

## Preparar un conjunto de prueba

1. Crea una carpeta fuera del repositorio, por ejemplo `D:/Ritmo-Genre-Test/`.
2. Dentro crea `audio/` y coloca WAV PCM16 mono o estéreo. Se aceptan WAV PCM enteros de 16 bits entre 8 y 96 kHz, de hasta 40 MiB por pista. Usa el conversor de Ritmo para preparar copias WAV PCM16; no hace falta cambiar tus archivos originales.
3. Copia `manifest.example.json` como `manifest.json` y registra cada pista. La ruta `file` es relativa a la carpeta donde está el manifiesto.
4. Usa una sola etiqueta principal revisada por persona para cada pista. Registra un `artistKey` seudónimo y no uses la misma persona/artista en más de un split cuando construyas conjuntos de desarrollo y test.
5. Declara la base de derechos para cada grabación. No agregues material de terceros si no tienes permiso para usarlo en este benchmark.

Ejemplo de una entrada:

```json
{
  "id": "clip-001",
  "file": "audio/clip-001.wav",
  "artistKey": "artist-001",
  "expectedGenre": "Rock",
  "rights": {
    "basis": "owned",
    "reference": "Grabación propia"
  }
}
```

Los valores admitidos para `rights.basis` son `owned`, `creative-commons` y `permission`. En material Creative Commons añade también el campo `license`; en todos los casos `reference` debe describir la procedencia, licencia o autorización. Esta declaración ayuda a documentar el conjunto, pero no sustituye tu comprobación de derechos.

## Ejecutar en Windows

Requiere Node.js 22 o posterior. Desde la carpeta raíz del repositorio:

```powershell
npm --prefix tools/genre-benchmark install --no-audit --no-fund
npm --prefix tools/genre-benchmark run evaluate -- --manifest "D:/Ritmo-Genre-Test/manifest.json"
```

Para elegir dónde guardar el JSON de resultados:

```powershell
npm --prefix tools/genre-benchmark run evaluate -- --manifest "D:/Ritmo-Genre-Test/manifest.json" --output "D:/Ritmo-Genre-Test/results.json"
```

La herramienta valida las rutas y rechaza rutas absolutas, traversal con `..`, symlinks fuera de la carpeta del manifiesto, archivos grandes y WAVs con formatos no compatibles. El informe guarda IDs seudónimos, géneros, puntajes agregados y medidas; no guarda rutas locales, nombres reales ni el audio.

## Qué informa

- exactitud top-1 y top-3;
- macro-F1 y macro-recall sobre las clases que sí tienen muestras;
- precisión, recall, F1 y soporte por clase;
- matriz de confusión, incluidos resultados sin clasificar;
- estabilidad top-1 entre fragmentos para las pistas analizadas con dos ventanas;
- tiempo de carga, latencia media, mediana y percentil 95;
- máximo RSS observado después de procesar cada pista.

El máximo RSS es una observación periódica del proceso, no un perfilador de picos transitorios. Las puntuaciones del modelo no se interpretan como probabilidades calibradas. No compares resultados de conjuntos distintos sin revisar su balance de clases, licencias, artistas y criterios de etiquetado.

## Limitación de taxonomía y licencias

Discogs-EffNet ofrece predicciones multi-etiqueta dirigidas a 400 estilos, pero los modelos MTG listados por Essentia se distribuyen bajo CC BY-NC-SA 4.0, con opción de licencia propietaria. MTG-Jamendo proporciona splits con 87 etiquetas de género, pero su metadata es CC BY-NC-SA 4.0 y el dataset limita el uso a investigación académica no comercial salvo autorización de Jamendo. No se descargan ni integran esos modelos/datasets en Ritmo desde esta herramienta. Primero hay que aclarar el uso y los derechos, y adaptar la evaluación a modelos multi-etiqueta.

Referencias:
- https://essentia.upf.edu/models.html
- https://github.com/MTG/mtg-jamendo-dataset
- https://huggingface.co/SeyedAli/Musical-genres-Classification-Hubert-V1


## Evaluación multi-etiqueta para modelos de estilos

El evaluador multi-etiqueta es independiente del motor de inferencia. Consume un JSON con las puntuaciones ya calculadas por un adaptador; **no descarga ni ejecuta EffNet** y no convierte sus métricas publicadas en resultados de Ritmo.

1. El adaptador debe producir una puntuación entre 0 y 1 para cada etiqueta de labels y cada pista. Para EffNet, conserva las etiquetas exactas de Discogs, por ejemplo Latin---Cumbia o Pop---City Pop; no traduzcas ni unas categorías padre/hija durante la medición.
2. Registra expectedLabels revisadas por una persona, artistKey seudónimo y procedencia/derechos por pista. No reutilices un artista entre validation y test.
3. Ejecuta primero validation para elegir los umbrales; fija la política antes de abrir el resultado test.

Ejemplo del documento de predicciones:

```json
{
  "schemaVersion": 1,
  "datasetName": "Colección autorizada",
  "split": "validation",
  "model": { "id": "modelo-candidato", "revision": "sha-o-versión" },
  "labels": ["Electronic---Synthwave", "Pop---City Pop", "Latin---Cumbia"],
  "tracks": [{
    "id": "clip-001",
    "artistKey": "artist-001",
    "expectedLabels": ["Electronic---Synthwave", "Pop---City Pop"],
    "scores": {
      "Electronic---Synthwave": 0.81,
      "Pop---City Pop": 0.42,
      "Latin---Cumbia": 0.03
    },
    "rights": { "basis": "owned", "reference": "Grabación propia" }
  }]
}
```

El documento manifest.multilabel.example.json contiene solo datos sintéticos, no audio ni una estimación de rendimiento.

Ejecutar en Windows, desde la raíz del repositorio:

```powershell
npm --prefix tools/genre-benchmark run evaluate:multilabel -- --input "D:/Ritmo-Genre-Test/predictions.json" --thresholds 0.25,0.5 --top-k 3,5
```

El informe incluye:

- mAP (mean average precision) calculada por ranking de las puntuaciones, agrupando empates;
- precision, recall y F1 micro/macro a cada umbral explícito;
- precision/recall por etiqueta y soporte, con clases sin ejemplos marcadas como tales;
- precision y recall top-k, independientes del umbral.

No trates los scores sigmoid como probabilidades calibradas. mAP no usa un umbral; F1 sí. No elijas un umbral mirando el conjunto final test. Con 400 estilos, una métrica agregada no sustituye la revisión de soporte y falsos positivos de cada etiqueta.
