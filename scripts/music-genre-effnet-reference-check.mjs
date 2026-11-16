import assert from "node:assert/strict";
import {
  EFFNET_REFERENCE_CONFIG,
  compareEffnetMelFrames,
  validateEffnetReference
} from "../tools/genre-benchmark/effnet-reference.mjs";

const makeFrame = value => new Float32Array(96).fill(value);
const actual = [makeFrame(0), makeFrame(0.5), makeFrame(1)];
const referenceFrames = actual.map(frame => Array.from(frame));
const baseReference = {
  schemaVersion: 1,
  source: { engine: "Essentia", algorithm: "TensorflowInputMusiCNN", version: "test-reference" },
  audio: { sha256: "a".repeat(64), sampleRateHz: 16000, channels: 1, sampleFormat: "PCM16" },
  config: { ...EFFNET_REFERENCE_CONFIG },
  frames: referenceFrames
};

assert.deepEqual(validateEffnetReference(baseReference), []);

const exact = compareEffnetMelFrames(actual, referenceFrames);
assert.equal(exact.passed, true);
assert.equal(exact.comparedValueCount, 3 * 96);
assert.equal(exact.withinToleranceRate, 1);
assert.equal(exact.maxAbsoluteError, 0);
assert.equal(exact.meanAbsoluteError, 0);
assert.equal(exact.rootMeanSquareError, 0);
assert.ok(Math.abs(exact.pearsonCorrelation - 1) < 1e-12);

const tinyDifference = referenceFrames.map(frame => frame.slice());
tinyDifference[1][7] += 0.0005;
const withinTolerance = compareEffnetMelFrames(actual, tinyDifference, {
  absoluteTolerance: 0.001,
  relativeTolerance: 0.001
});
assert.equal(withinTolerance.passed, true);
assert.equal(withinTolerance.outsideToleranceCount, 0);

const outsideToleranceFrames = referenceFrames.map(frame => frame.slice());
outsideToleranceFrames[2][95] += 0.01;
const outsideTolerance = compareEffnetMelFrames(actual, outsideToleranceFrames);
assert.equal(outsideTolerance.passed, false);
assert.equal(outsideTolerance.outsideToleranceCount, 1);
assert.equal(outsideTolerance.worstValue.frameIndex, 2);
assert.equal(outsideTolerance.worstValue.bandIndex, 95);
assert.ok(outsideTolerance.worstBands[0].meanAbsoluteError > 0);

const mismatchedFrames = compareEffnetMelFrames(actual, referenceFrames.slice(0, 2));
assert.equal(mismatchedFrames.passed, false);
assert.equal(mismatchedFrames.reason, "frame-count-mismatch");
assert.equal(mismatchedFrames.comparedValueCount, 0);

assert.throws(() => compareEffnetMelFrames(actual, referenceFrames, {
  absoluteTolerance: -1
}), /non-negativos/);
assert.throws(() => compareEffnetMelFrames(
  [new Float32Array([Number.NaN, ...new Array(95).fill(0)])],
  [new Array(96).fill(0)]
), /NaN ni infinitos/);

const invalidHash = structuredClone(baseReference);
invalidHash.audio.sha256 = "not-a-hash";
assert.ok(validateEffnetReference(invalidHash).some(error => error.includes("audio.sha256")));

const wrongConfig = structuredClone(baseReference);
wrongConfig.config.melBands = 64;
assert.ok(validateEffnetReference(wrongConfig).some(error => error.includes("config.melBands")));

const invalidBand = structuredClone(baseReference);
invalidBand.frames[0][0] = Number.NaN;
assert.ok(validateEffnetReference(invalidBand).some(error => error.includes("frames[0]")));

const flat = compareEffnetMelFrames([makeFrame(0)], [Array.from(makeFrame(0))]);
assert.equal(flat.passed, true);
assert.equal(flat.pearsonCorrelation, null,
  "Pearson correlation is undefined when both compared vectors have zero variance.");

const invalidAudioRate = structuredClone(baseReference);
invalidAudioRate.audio.sampleRateHz = 44100;
assert.ok(validateEffnetReference(invalidAudioRate).some(error => error.includes("audio.sampleRateHz")));

console.log("EffNet reference checks passed: schema, frame shape, absolute/relative tolerances, MAE/RMSE, correlation and mismatch handling.");
