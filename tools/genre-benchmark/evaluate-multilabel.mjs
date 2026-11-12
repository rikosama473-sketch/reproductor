#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { calculateMultiLabelMetrics, validateMultiLabelDocument } from "./multilabel-core.mjs";

function parseNumberList(value, name, { integer = false } = {}) {
  const items = String(value || "").split(",").map(item => item.trim());
  if (!items.length || items.some(item => !item)) throw new Error(name + " contiene un valor vacío.");
  const values = items.map(Number);
  if (values.some(value => !Number.isFinite(value) || (integer && !Number.isInteger(value)))) {
    throw new Error(name + " contiene un valor numérico inválido.");
  }
  return values;
}

function parseArgs(argv) {
  const options = {
    input: null,
    output: null,
    thresholds: [0.25, 0.5],
    topK: [3, 5],
    help: false
  };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") options.help = true;
    else if (["--input", "--output", "--thresholds", "--top-k"].includes(argument)) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error("Falta un valor para " + argument + ".");
      if (argument === "--input") options.input = value;
      else if (argument === "--output") options.output = value;
      else if (argument === "--thresholds") options.thresholds = parseNumberList(value, argument);
      else options.topK = parseNumberList(value, argument, { integer: true });
      index++;
    } else {
      throw new Error("Argumento no reconocido: " + argument + ".");
    }
  }
  return options;
}

function printHelp() {
  console.log([
    "Ritmo — evaluación multi-etiqueta de estilos musicales",
    "",
    "Uso:",
    "  npm --prefix tools/genre-benchmark run evaluate:multilabel -- --input ./predicciones.json",
    "",
    "Opciones:",
    "  --output ./metricas.json",
    "  --thresholds 0.25,0.5",
    "  --top-k 3,5",
    "",
    "El input contiene scores ya calculados por un adaptador de modelo; esta herramienta no ejecuta ni descarga modelos.",
    "Usa validation para fijar umbrales y reserva test para una única evaluación final."
  ].join("\n"));
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  if (!options.input) {
    printHelp();
    throw new Error("Indicá --input con el documento de predicciones multi-etiqueta.");
  }

  const inputPath = path.resolve(options.input);
  const document = JSON.parse(await readFile(inputPath, "utf8"));
  const errors = validateMultiLabelDocument(document);
  if (errors.length) throw new Error("Documento inválido:\n- " + errors.join("\n- "));

  const metrics = calculateMultiLabelMetrics(
    document.tracks,
    document.labels,
    options.thresholds,
    options.topK
  );
  const outputPath = path.resolve(options.output || (options.input + ".metrics.json"));
  if (outputPath === inputPath) throw new Error("El informe no puede sobrescribir el documento de entrada.");

  const topPredictions = document.tracks.map(track => ({
    id: track.id,
    artistKey: track.artistKey,
    expectedLabels: track.expectedLabels,
    topFive: Object.entries(track.scores)
      .sort((left, right) => right[1] - left[1] ||
        (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0))
      .slice(0, 5)
      .map(([label, score]) => ({ label, score }))
  }));
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    dataset: {
      name: document.datasetName,
      split: document.split,
      trackCount: document.tracks.length,
      artistCount: new Set(document.tracks.map(track => track.artistKey)).size,
      labelCount: document.labels.length,
      annotationPolicy: "Etiquetas esperadas revisadas por una persona; no son inferidas por el modelo."
    },
    model: {
      id: document.model.id,
      revision: document.model.revision,
      runtime: document.model.runtime || null,
      quantization: document.model.quantization || null
    },
    metrics,
    tracks: topPredictions
  };

  await writeFile(outputPath, JSON.stringify(report, null, 2) + "\n", { flag: "wx" }).catch(error => {
    if (error?.code === "EEXIST") {
      throw new Error("El informe ya existe; indicá otro --output para no sobrescribirlo.");
    }
    throw error;
  });

  console.log("Métricas multi-etiqueta calculadas.");
  console.log("Pistas: " + metrics.sampleCount + "; etiquetas: " + metrics.labelCount);
  console.log("mAP: " + (metrics.macroAveragePrecision === null ? "n/d" : metrics.macroAveragePrecision.toFixed(4)));
  for (const item of metrics.thresholdMetrics) {
    console.log("Umbral " + item.threshold + " — micro-F1: " + item.micro.f1.toFixed(4) +
      "; macro-F1: " + (item.macro.f1 === null ? "n/d" : item.macro.f1.toFixed(4)));
  }
  for (const item of metrics.topK) {
    console.log("Top-" + item.k + " — precision: " + item.precision.toFixed(4) +
      "; recall: " + item.recall.toFixed(4));
  }
  console.log("Informe: " + outputPath);
  console.log("Los scores son salidas del modelo, no probabilidades calibradas ni exactitud general.");
}

run().catch(error => {
  console.error("\nEvaluación multi-etiqueta cancelada: " + (error?.stack || error?.message || String(error)));
  process.exitCode = 1;
});
