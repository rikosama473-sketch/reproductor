import assert from "node:assert/strict";
import {
  EFFNET_PATCH_HOP_SIZE,
  EFFNET_PATCH_SIZE,
  EFFNET_SAMPLE_RATE,
  MUSICNN_FRAME_SIZE,
  MUSICNN_HOP_SIZE,
  MUSICNN_MEL_BANDS,
  buildEffnetPatchTensor,
  extractMusiCNNMelFrames,
  preprocessEffnetAudio
} from "../tools/genre-benchmark/effnet-preprocess.mjs";

assert.equal(EFFNET_SAMPLE_RATE, 16000);
assert.equal(MUSICNN_FRAME_SIZE, 512);
assert.equal(MUSICNN_HOP_SIZE, 256);
assert.equal(MUSICNN_MEL_BANDS, 96);
assert.equal(EFFNET_PATCH_SIZE, 128);
assert.equal(EFFNET_PATCH_HOP_SIZE, 62);
assert.deepEqual(extractMusiCNNMelFrames(new Float32Array(0)), []);

const silence12s = new Float32Array(EFFNET_SAMPLE_RATE * 12);
const silenceMel = extractMusiCNNMelFrames(silence12s);
assert.equal(silenceMel.length, 750,
  "A 12-second signal at 16 kHz produces 750 centered frames with a 256-sample hop.");
assert.equal(silenceMel[0].length, MUSICNN_MEL_BANDS);
assert.ok(silenceMel.every(frame => frame.every(value => value === 0)),
  "Silence should remain exactly zero after log10(1 + 10000 * melPower).");

const silenceTensor = buildEffnetPatchTensor(silenceMel);
assert.deepEqual(silenceTensor.dims, [11, 128, 96]);
assert.equal(silenceTensor.patchCount, 11);
assert.equal(silenceTensor.data.length, 11 * 128 * 96);
assert.equal(silenceTensor.discardedTailFrames, 2);
assert.ok(silenceTensor.data.every(value => value === 0));

const shortFrames = extractMusiCNNMelFrames(new Float32Array(16000));
assert.equal(shortFrames.length, 63);
assert.equal(buildEffnetPatchTensor(shortFrames).patchCount, 0,
  "A 1-second clip is too short to fill a 128-frame EffNet patch.");

const exactHop = extractMusiCNNMelFrames(new Float32Array(256));
assert.equal(exactHop.length, 1,
  "The frame centered exactly at the signal end must not be emitted.");

const sampleCount = EFFNET_SAMPLE_RATE * 3;
const tone = new Float32Array(sampleCount);
for (let index = 0; index < sampleCount; index++) {
  tone[index] = 0.5 * Math.sin(2 * Math.PI * 440 * index / EFFNET_SAMPLE_RATE);
}
const toneMel = extractMusiCNNMelFrames(tone);
assert.equal(toneMel.length, Math.ceil(sampleCount / MUSICNN_HOP_SIZE));
assert.ok(toneMel.some(frame => frame.some(value => value > 0)),
  "A non-silent sinusoid should produce non-zero log-mel values.");
assert.ok(toneMel.every(frame =>
  frame.length === MUSICNN_MEL_BANDS && frame.every(Number.isFinite)
));

const prepared = preprocessEffnetAudio(tone);
assert.equal(prepared.melFrameCount, toneMel.length);
assert.equal(prepared.dims[1], 128);
assert.equal(prepared.dims[2], 96);
assert.throws(() => extractMusiCNNMelFrames([0, 1, 2]), /Float32Array or Float64Array/);
assert.throws(() => extractMusiCNNMelFrames(new Float32Array([0, Number.NaN])), /finite/);
assert.throws(() => buildEffnetPatchTensor(toneMel, { patchHopSize: 0 }), /positive integer/);
assert.throws(() => buildEffnetPatchTensor(toneMel.slice(0, 128), { patchSize: 64 }), /patchSize=128/);
assert.throws(() => buildEffnetPatchTensor([new Float32Array(95)]), /exactly 96/);

console.log("EffNet preprocessing checks passed: centered framing, 96-band log-mel shape, 128-frame patches, silence and finite-value guards.");
