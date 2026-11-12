import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  calculateMultiLabelMetrics,
  normalizeMultiLabelName,
  validateMultiLabelDocument
} from "../tools/genre-benchmark/multilabel-core.mjs";

const labels = [
  "Electronic---Synthwave",
  "Pop---City Pop",
  "Latin---Cumbia"
];

function track(id, expectedLabels, scores) {
  return {
    id,
    artistKey: "artist-" + id,
    expectedLabels,
    scores,
    rights: { basis: "owned", reference: "Audio propio de prueba" }
  };
}

const tracks = [
  track("clip-001", [labels[0], labels[1]], {
    [labels[0]]: 0.9, [labels[1]]: 0.8, [labels[2]]: 0.1
  }),
  track("clip-002", [labels[1]], {
    [labels[0]]: 0.4, [labels[1]]: 0.6, [labels[2]]: 0.2
  }),
  track("clip-003", [labels[2]], {
    [labels[0]]: 0.3, [labels[1]]: 0.3, [labels[2]]: 0.5
  }),
  track("clip-004", [labels[0]], {
    [labels[0]]: 0.2, [labels[1]]: 0.3, [labels[2]]: 0.4
  })
];

const document = {
  schemaVersion: 1,
  datasetName: "fixture multi-etiqueta sintético",
  split: "validation",
  model: { id: "synthetic-fixture", revision: "test-v1" },
  labels,
  tracks
};

assert.equal(normalizeMultiLabelName("  Pop---City Pop  "), "Pop---City Pop");
assert.deepEqual(validateMultiLabelDocument(document), []);
assert.ok(validateMultiLabelDocument({ ...document, split: "training" })
  .some(error => error.includes("split debe ser validation o test")));
assert.ok(validateMultiLabelDocument({
  ...document,
  tracks: [track("bad", ["Rock"], { [labels[0]]: 0.5, [labels[1]]: 0.5, [labels[2]]: 0.5 })]
}).some(error => error.includes("expectedLabels contiene")));
assert.ok(validateMultiLabelDocument({
  ...document,
  tracks: [track("bad-score", [labels[0]], { [labels[0]]: 1.2, [labels[1]]: 0.5, [labels[2]]: 0.5 })]
}).some(error => error.includes("entre 0 y 1")));
assert.ok(validateMultiLabelDocument({
  ...document,
  tracks: [track("missing-score", [labels[0]], { [labels[0]]: 0.5, [labels[1]]: 0.5 })]
}).some(error => error.includes("scores")));
assert.ok(validateMultiLabelDocument({
  ...document,
  labels: [...labels, labels[0]]
}).some(error => error.includes("duplicadas")));
const missingLicense = track("cc-track", [labels[0]], {
  [labels[0]]: 0.5, [labels[1]]: 0.5, [labels[2]]: 0.5
});
missingLicense.rights = { basis: "creative-commons", reference: "Metadata de ejemplo" };
assert.ok(validateMultiLabelDocument({ ...document, tracks: [missingLicense] })
  .some(error => error.includes("rights.license")));

const metrics = calculateMultiLabelMetrics(tracks, labels, [0.5, 0.7], [1, 2]);
assert.equal(metrics.sampleCount, 4);
assert.equal(metrics.labelCount, 3);
assert.equal(metrics.positiveLabelCount, 5);
assert.ok(Math.abs(metrics.macroAveragePrecision - (11 / 12)) < 0.000001);
assert.ok(Math.abs(metrics.averagePrecisionByLabel[labels[0]] - 0.75) < 0.000001);
assert.equal(metrics.averagePrecisionByLabel[labels[1]], 1);
assert.equal(metrics.averagePrecisionByLabel[labels[2]], 1);
assert.equal(metrics.thresholdMetrics[0].micro.truePositive, 4);
assert.equal(metrics.thresholdMetrics[0].micro.falsePositive, 0);
assert.equal(metrics.thresholdMetrics[0].micro.falseNegative, 1);
assert.ok(Math.abs(metrics.thresholdMetrics[0].micro.f1 - (8 / 9)) < 0.000001);
assert.ok(Math.abs(metrics.thresholdMetrics[0].macro.f1 - (8 / 9)) < 0.000001);
assert.equal(metrics.thresholdMetrics[1].micro.truePositive, 2);
assert.equal(metrics.thresholdMetrics[1].micro.falsePositive, 0);
assert.equal(metrics.thresholdMetrics[1].micro.falseNegative, 3);
assert.equal(metrics.topK[0].k, 1);
assert.equal(metrics.topK[0].hits, 3);
assert.equal(metrics.topK[0].precision, 0.75);
assert.equal(metrics.topK[0].recall, 0.6);
assert.equal(metrics.topK[1].k, 2);
assert.equal(metrics.topK[1].hits, 4);
assert.equal(metrics.topK[1].precision, 0.5);
assert.equal(metrics.topK[1].recall, 0.8);

const noSupportLabels = ["Rock", "Jazz"];
const noSupport = calculateMultiLabelMetrics([
  track("only-rock", ["Rock"], { Rock: 0.8, Jazz: 0.2 })
], noSupportLabels, [0.5], [1]);
assert.equal(noSupport.averagePrecisionByLabel.Jazz, null);
assert.ok(noSupport.classesWithoutSupport.includes("Jazz"));
assert.equal(noSupport.thresholdMetrics[0].perLabel.Jazz.support, 0);

assert.throws(
  () => calculateMultiLabelMetrics(tracks, labels, [1.1], [3]),
  /thresholds/
);
assert.throws(
  () => calculateMultiLabelMetrics(tracks, labels, [0.5], [0]),
  /topKValues/
);

console.log("Multi-label genre evaluation checks passed: mAP, threshold micro/macro-F1, top-k and manifest safeguards.");


const tempDirectory = await mkdtemp(path.join(os.tmpdir(), "ritmo-multilabel-cli-check-"));
try {
  const inputPath = fileURLToPath(new URL(
    "../tools/genre-benchmark/manifest.multilabel.example.json",
    import.meta.url
  ));
  const outputPath = path.join(tempDirectory, "metrics.json");
  const evaluatorPath = fileURLToPath(new URL(
    "../tools/genre-benchmark/evaluate-multilabel.mjs",
    import.meta.url
  ));
  const originalInput = await readFile(inputPath, "utf8");
  const args = [
    evaluatorPath,
    "--input", inputPath,
    "--output", outputPath,
    "--thresholds", "0.25,0.5",
    "--top-k", "1,2"
  ];
  const run = spawnSync(process.execPath, args, {
    encoding: "utf8",
    timeout: 30000
  });
  assert.equal(run.error, undefined, "The multi-label CLI should launch.");
  assert.equal(run.status, 0, "CLI failed:\n" + run.stdout + "\n" + run.stderr);
  assert.match(run.stdout, /Métricas multi-etiqueta calculadas/);

  const report = JSON.parse(await readFile(outputPath, "utf8"));
  assert.equal(report.dataset.trackCount, 3);
  assert.equal(report.dataset.labelCount, 3);
  assert.equal(report.model.id, "synthetic-fixture-only");
  assert.equal(report.metrics.sampleCount, 3);
  assert.equal(report.tracks.length, 3);
  assert.ok(Array.isArray(report.metrics.thresholdMetrics));
  assert.ok(Array.isArray(report.metrics.topK));
  assert.equal(await readFile(inputPath, "utf8"), originalInput,
    "The CLI must not modify the prediction document.");

  const overwrite = spawnSync(process.execPath, args, {
    encoding: "utf8",
    timeout: 30000
  });
  assert.notEqual(overwrite.status, 0, "An existing metrics report must never be overwritten.");
  assert.match(overwrite.stderr, /El informe ya existe/);
  const afterOverwriteAttempt = JSON.parse(await readFile(outputPath, "utf8"));
  assert.equal(afterOverwriteAttempt.dataset.trackCount, 3);

  const sameInputOutput = spawnSync(process.execPath, [
    evaluatorPath, "--input", inputPath, "--output", inputPath
  ], {
    encoding: "utf8",
    timeout: 30000
  });
  assert.notEqual(sameInputOutput.status, 0,
    "The CLI must reject an output path that would replace its input document.");
  assert.equal(await readFile(inputPath, "utf8"), originalInput);
} finally {
  await rm(tempDirectory, { recursive: true, force: true });
}

console.log("Multi-label CLI integration checks passed: report generation, input preservation and no-overwrite protection.");
