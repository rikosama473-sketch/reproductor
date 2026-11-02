#!/usr/bin/env node
import { readFile, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import {
  AUDIO_GENRE_MODEL_ID,
  AUDIO_GENRE_MODEL_REVISION,
  AUDIO_GENRE_SAMPLE_RATE,
  AUDIO_GENRE_ANALYSIS_SECONDS,
  MAX_AUDIO_GENRE_FILE_BYTES,
  extractDistributedMonoSamples,
  aggregateAcousticGenrePredictions
} from "../../src/music-genre-classifier.js";
import {
  calculateGenreMetrics,
  parsePcm16Wav,
  percentile,
  resolveManifestTrackPath,
  validateBenchmarkManifest
} from "./core.mjs";

const RUNTIME_VERSION = "3.7.2";
const MAX_DATASET_TRACKS = 5000;

function parseArgs(argv) {
  const options = { manifest: null, output: null, help: false };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--manifest" || arg === "--output") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`Falta un valor para ${arg}.`);
      options[arg === "--manifest" ? "manifest" : "output"] = value;
      index++;
    } else {
      throw new Error(`Argumento no reconocido: ${arg}.`);
    }
  }
  return options;
}

function printHelp() {
  console.log([
    "Ritmo — benchmark local del clasificador de géneros",
    "",
    "Uso:",
    "  npm --prefix tools/genre-benchmark install",
    "  npm --prefix tools/genre-benchmark run evaluate -- --manifest ./mi-prueba/manifest.json",
    "",
    "Opcional:",
    "  --output ./mi-prueba/resultados.json",
    "",
    "El manifiesto enumera WAV PCM16 locales y etiquetas de referencia. El audio nunca se sube.",
    "La primera ejecución descarga el runtime/modelo; la inferencia usa CPU con 2 hilos intra-op."
  ].join("\n"));
}

function assertInsideRoot(root, candidate) {
  const relative = path.relative(root, candidate);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("La ruta de un audio sale de la carpeta del manifiesto.");
  }
}

async function loadManifest(manifestPath) {
  const absolutePath = path.resolve(manifestPath);
  const manifestDirectory = await realpath(path.dirname(absolutePath));
  const parsed = JSON.parse(await readFile(absolutePath, "utf8"));
  const errors = validateBenchmarkManifest(parsed);
  if (errors.length) {
    throw new Error("Manifiesto inválido:\n- " + errors.join("\n- "));
  }
  if (parsed.tracks.length > MAX_DATASET_TRACKS) {
    throw new Error(`El límite es ${MAX_DATASET_TRACKS} pistas por ejecución.`);
  }
  return { manifest: parsed, manifestDirectory };
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  if (!options.manifest) {
    printHelp();
    throw new Error("Indicá --manifest con el conjunto de prueba.");
  }

  const { manifest, manifestDirectory } = await loadManifest(options.manifest);
  const audioFiles = [];
  for (const track of manifest.tracks) {
    const requestedPath = resolveManifestTrackPath(manifestDirectory, track.file);
    const canonicalPath = await realpath(requestedPath);
    assertInsideRoot(manifestDirectory, canonicalPath);
    const fileStats = await stat(canonicalPath);
    if (!fileStats.isFile()) throw new Error(`El recurso de la pista ${track.id} no es un archivo regular.`);
    if (fileStats.size <= 0 || fileStats.size > MAX_AUDIO_GENRE_FILE_BYTES) {
      throw new Error(`La pista ${track.id} debe pesar entre 1 byte y 40 MiB.`);
    }
    audioFiles.push({ track, path: canonicalPath, sizeBytes: fileStats.size });
  }

  console.log(`Dataset: ${manifest.datasetName} (${manifest.split}), ${audioFiles.length} pistas.`);
  console.log("Las canciones se procesan localmente. No se enviarán archivos de audio.");

  const { pipeline, env } = await import("@huggingface/transformers");
  env.allowRemoteModels = true;
  env.allowLocalModels = true;

  const modelLoadStart = performance.now();
  const classifier = await pipeline("audio-classification", AUDIO_GENRE_MODEL_ID, {
    revision: AUDIO_GENRE_MODEL_REVISION,
    dtype: "q8",
    session_options: {
      executionProviders: ["cpu"],
      intraOpNumThreads: 2,
      interOpNumThreads: 1,
      executionMode: "sequential"
    },
    progress_callback: detail => {
      if (detail?.status === "progress" && Number.isFinite(detail.progress)) {
        const filename = String(detail.file || "modelo").split("/").pop();
        process.stdout.write(`\rDescargando ${filename}: ${Math.round(detail.progress)} %   `);
      } else if (detail?.status === "done") {
        process.stdout.write("\nModelo descargado; preparando inferencia local…\n");
      }
    }
  });
  const modelLoadMs = performance.now() - modelLoadStart;

  const trackResults = [];
  const trackTimes = [];
  let maxObservedRss = process.memoryUsage().rss;
  for (let index = 0; index < audioFiles.length; index++) {
    const item = audioFiles[index];
    process.stdout.write(`[${index + 1}/${audioFiles.length}] ${item.track.id}… `);

    const encoded = await readFile(item.path);
    const audioBuffer = parsePcm16Wav(encoded);
    if (audioBuffer.duration < 3) {
      throw new Error(`La pista ${item.track.id} dura menos de 3 segundos.`);
    }
    const samples = extractDistributedMonoSamples(
      audioBuffer,
      AUDIO_GENRE_SAMPLE_RATE,
      AUDIO_GENRE_ANALYSIS_SECONDS,
      2
    );

    const segmentPredictions = [];
    const inferenceStart = performance.now();
    for (const segment of samples) {
      const predictions = await classifier(segment, { top_k: 10 });
      if (!Array.isArray(predictions) || predictions.length === 0) {
        throw new Error(`El modelo no devolvió predicciones para ${item.track.id}.`);
      }
      segmentPredictions.push(predictions.map(prediction => ({
        label: prediction?.label,
        score: prediction?.score
      })));
    }
    const inferenceMs = performance.now() - inferenceStart;
    const aggregated = aggregateAcousticGenrePredictions(segmentPredictions, 3);
    const segmentTop1 = segmentPredictions.map(predictions => predictions[0]?.label || null);
    const result = {
      id: item.track.id,
      expectedGenre: item.track.expectedGenre,
      predictedGenre: aggregated[0]?.label || null,
      top3: aggregated.map(prediction => prediction.label),
      segmentCount: samples.length,
      segmentTop1,
      stableTop1: segmentTop1.length > 0 && segmentTop1.every(label => label === segmentTop1[0]),
      inferenceMs: Math.round(inferenceMs * 100) / 100,
      durationSeconds: Math.round(audioBuffer.duration * 100) / 100,
      topScores: aggregated.map(prediction => ({
        label: prediction.label,
        score: Math.round(prediction.score * 10000) / 10000,
        firstPlaceVotes: prediction.topRankVotes
      }))
    };
    trackResults.push(result);
    trackTimes.push(inferenceMs);
    maxObservedRss = Math.max(maxObservedRss, process.memoryUsage().rss);
    console.log(`${result.predictedGenre || "Sin clasificación"} (${result.inferenceMs} ms)`);
  }

  const metrics = calculateGenreMetrics(trackResults);
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    dataset: {
      name: manifest.datasetName,
      split: manifest.split,
      trackCount: manifest.tracks.length,
      labelPolicy: "Una etiqueta principal por pista, revisada por una persona. Las pistas multi-género necesitan un protocolo separado."
    },
    model: {
      id: AUDIO_GENRE_MODEL_ID,
      revision: AUDIO_GENRE_MODEL_REVISION,
      runtime: "@huggingface/transformers",
      runtimeVersion: RUNTIME_VERSION,
      quantization: "q8",
      executionProvider: "cpu",
      intraOpThreads: 2,
      interOpThreads: 1
    },
    preprocessing: {
      sampleRateHz: AUDIO_GENRE_SAMPLE_RATE,
      channels: "mono",
      format: "WAV PCM16",
      maxSegmentSeconds: AUDIO_GENRE_ANALYSIS_SECONDS,
      maxSegmentsPerTrack: 2
    },
    timing: {
      modelLoadMs: Math.round(modelLoadMs * 100) / 100,
      meanInferenceMsPerTrack: trackTimes.length
        ? Math.round((trackTimes.reduce((sum, value) => sum + value, 0) / trackTimes.length) * 100) / 100
        : null,
      medianInferenceMsPerTrack: percentile(trackTimes, 0.5),
      p95InferenceMsPerTrack: percentile(trackTimes, 0.95),
      maxObservedRssMiB: Math.round(maxObservedRss / (1024 * 1024) * 100) / 100
    },
    metrics,
    tracks: trackResults
  };

  const outputPath = path.resolve(options.output || options.manifest.replace(/\.json$/i, ".results.json"));
  await writeFile(outputPath, JSON.stringify(report, null, 2) + "\n", { flag: "w" });

  console.log("");
  console.log(`Exactitud top-1: ${metrics.accuracy === null ? "n/d" : (metrics.accuracy * 100).toFixed(1) + " %"}`);
  console.log(`Exactitud top-3: ${metrics.top3Accuracy === null ? "n/d" : (metrics.top3Accuracy * 100).toFixed(1) + " %"}`);
  console.log(`Macro-F1 (clases presentes): ${metrics.macroF1PresentClasses === null ? "n/d" : metrics.macroF1PresentClasses.toFixed(3)}`);
  console.log(`Estabilidad top-1 (pistas con dos fragmentos): ${metrics.multiSegmentStableTop1Rate === null ? "n/d" : (metrics.multiSegmentStableTop1Rate * 100).toFixed(1) + " %"}`);
  console.log(`Informe: ${outputPath}`);
  console.log("Nota: son resultados de este conjunto local, no una garantía de calidad general ni probabilidades calibradas.");
}

run().catch(error => {
  console.error("\nBenchmark cancelado: " + (error?.stack || error?.message || String(error)));
  process.exitCode = 1;
});
