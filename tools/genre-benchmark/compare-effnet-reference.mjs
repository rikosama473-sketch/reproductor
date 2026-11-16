#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  EFFNET_REFERENCE_CONFIG,
  compareEffnetMelFrames,
  validateEffnetReference
} from "./effnet-reference.mjs";
import { parsePcm16Wav } from "./core.mjs";
import { extractMusiCNNMelFrames } from "./effnet-preprocess.mjs";

const MAX_AUDIO_BYTES = 40 * 1024 * 1024;
const MAX_REFERENCE_BYTES = 128 * 1024 * 1024;

function parseArgs(argv) {
  const options = { audio: null, reference: null, output: null, atol: 1e-3, rtol: 1e-3, help: false };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (["--audio", "--reference", "--output", "--atol", "--rtol"].includes(arg)) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error("Falta un valor para " + arg + ".");
      if (arg === "--audio") options.audio = value;
      else if (arg === "--reference") options.reference = value;
      else if (arg === "--output") options.output = value;
      else {
        const numeric = Number(value);
        if (!Number.isFinite(numeric) || numeric < 0) throw new Error(arg + " debe ser un número no negativo.");
        options[arg === "--atol" ? "atol" : "rtol"] = numeric;
      }
      index++;
    } else {
      throw new Error("Argumento no reconocido: " + arg + ".");
    }
  }
  return options;
}

function printHelp() {
  console.log([
    "Ritmo — comparación numérica de los mel frames EffNet",
    "",
    "Uso:",
    "  node tools/genre-benchmark/compare-effnet-reference.mjs --audio audio-16k-mono.wav --reference essentia-reference.json",
    "",
    "Opciones:",
    "  --output informe.json",
    "  --atol 0.001   tolerancia absoluta (por defecto 1e-3)",
    "  --rtol 0.001   tolerancia relativa (por defecto 1e-3)",
    "",
    "El WAV debe ser PCM16, mono y 16 kHz. No se remuestrea ni se sube audio.",
    "La comparación exige el mismo SHA-256 del WAV en el documento de referencia."
  ].join("\n"));
}

async function canonicalExistingPath(requestedPath) {
  return realpath(path.resolve(requestedPath));
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  if (!options.audio || !options.reference) {
    printHelp();
    throw new Error("Indicá --audio y --reference.");
  }

  const audioPath = await canonicalExistingPath(options.audio);
  const referencePath = await canonicalExistingPath(options.reference);
  const [audioStats, referenceStats] = await Promise.all([
    stat(audioPath),
    stat(referencePath)
  ]);
  if (!audioStats.isFile() || audioStats.size <= 0 || audioStats.size > MAX_AUDIO_BYTES) {
    throw new Error("El WAV debe ser un archivo regular de entre 1 byte y 40 MiB.");
  }
  if (!referenceStats.isFile() || referenceStats.size <= 0 ||
      referenceStats.size > MAX_REFERENCE_BYTES) {
    throw new Error("La referencia debe ser un archivo regular de hasta 128 MiB.");
  }

  const [audioBytes, referenceText] = await Promise.all([
    readFile(audioPath),
    readFile(referencePath, "utf8")
  ]);
  const audioSha256 = createHash("sha256").update(audioBytes).digest("hex");
  const reference = JSON.parse(referenceText);
  const referenceErrors = validateEffnetReference(reference);
  if (referenceErrors.length) {
    throw new Error("Referencia Essentia inválida:\n- " + referenceErrors.join("\n- "));
  }
  if (reference.audio.sha256.toLowerCase() !== audioSha256) {
    throw new Error("El SHA-256 del WAV no coincide con audio.sha256 de la referencia. Exportá otra vez usando exactamente este archivo.");
  }

  const parsedAudio = parsePcm16Wav(audioBytes);
  if (parsedAudio.sampleRate !== EFFNET_REFERENCE_CONFIG.sampleRateHz ||
      parsedAudio.numberOfChannels !== EFFNET_REFERENCE_CONFIG.channels) {
    throw new Error("El WAV debe ser PCM16 mono a 16000 Hz. No se remuestrea: prepará una copia explícita para evitar diferencias de entrada.");
  }

  const localSamples = parsedAudio.getChannelData(0);
  const localFrames = extractMusiCNNMelFrames(localSamples);
  const result = compareEffnetMelFrames(localFrames, reference.frames, {
    absoluteTolerance: options.atol,
    relativeTolerance: options.rtol
  });
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    audio: {
      sha256: audioSha256,
      sampleRateHz: parsedAudio.sampleRate,
      channels: parsedAudio.numberOfChannels,
      sampleCount: parsedAudio.length,
      durationSeconds: parsedAudio.duration
    },
    reference: {
      engine: reference.source.engine,
      algorithm: reference.source.algorithm,
      version: reference.source.version
    },
    comparison: {
      absoluteTolerance: options.atol,
      relativeTolerance: options.rtol,
      formula: "abs(local - reference) <= atol + rtol * abs(reference)",
      ...result
    }
  };

  const outputPath = path.resolve(options.output || (options.reference + ".comparison.json"));
  const protectedPaths = new Set([audioPath, referencePath]);
  if (protectedPaths.has(outputPath)) {
    throw new Error("El informe no puede sobrescribir el WAV ni el JSON de referencia.");
  }
  await writeFile(outputPath, JSON.stringify(report, null, 2) + "\n", { flag: "wx" }).catch(error => {
    if (error?.code === "EEXIST") {
      throw new Error("El informe ya existe; elegí otro --output para no sobrescribirlo.");
    }
    throw error;
  });

  const summary = result.passed
    ? "PASS: todos los valores quedan dentro de la tolerancia."
    : result.reason === "frame-count-mismatch"
      ? "FAIL: no coincide la cantidad de frames."
      : "FAIL: hay valores fuera de tolerancia.";
  console.log(summary);
  console.log("Frames locales/referencia: " + result.actualFrameCount + "/" + result.referenceFrameCount);
  console.log("Valores comparados: " + result.comparedValueCount);
  console.log("Máximo error absoluto: " + (result.maxAbsoluteError ?? "n/d"));
  console.log("MAE: " + (result.meanAbsoluteError ?? "n/d"));
  console.log("RMSE: " + (result.rootMeanSquareError ?? "n/d"));
  console.log("Correlación Pearson: " + (result.pearsonCorrelation ?? "n/d"));
  console.log("Dentro de tolerancia: " + (result.withinToleranceRate * 100).toFixed(3) + " %");
  console.log("Informe: " + outputPath);
  if (!result.passed) process.exitCode = 2;
}

run().catch(error => {
  console.error("\nComparación cancelada: " + (error?.stack || error?.message || String(error)));
  process.exitCode = 1;
});
