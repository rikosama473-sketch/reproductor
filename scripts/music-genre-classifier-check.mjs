import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  AUDIO_GENRE_MODEL_ID,
  AUDIO_GENRE_MODEL_REVISION,
  AUDIO_GENRE_SAMPLE_RATE,
  AUDIO_GENRE_ANALYSIS_SECONDS,
  AUDIO_GENRE_MAX_SEGMENTS,
  MAX_AUDIO_GENRE_FILE_BYTES,
  normalizeAcousticGenrePredictions,
  aggregateAcousticGenrePredictions,
  extractCenteredMonoSamples,
  extractDistributedMonoSamples,
  decodeLocalAudioBlob,
  classifyLocalAudioTrack
} from "../src/music-genre-classifier.js";

assert.equal(AUDIO_GENRE_MODEL_ID, "onnx-community/Musical-genres-Classification-Hubert-V1-ONNX");
assert.match(AUDIO_GENRE_MODEL_REVISION, /^[a-f0-9]{40}$/);
assert.equal(AUDIO_GENRE_SAMPLE_RATE, 16000);
assert.equal(AUDIO_GENRE_ANALYSIS_SECONDS, 12);
assert.equal(AUDIO_GENRE_MAX_SEGMENTS, 2);
assert.equal(MAX_AUDIO_GENRE_FILE_BYTES, 40 * 1024 * 1024);

assert.deepEqual(normalizeAcousticGenrePredictions([
  { label: "rock", score: 0.5 },
  { label: "pop", score: 0.8 },
  { label: "hiphop", score: 0.6 },
  { label: "jazz", score: 0.4 },
  { label: "rock", score: 0.7 },
  { label: "synthwave", score: 0.99 },
  { label: "metal", score: Number.NaN },
  { label: "blues", score: 1.1 }
]), [
  { label: "Pop", score: 0.8 },
  { label: "Hip-Hop", score: 0.6 },
  { label: "Rock", score: 0.7 }
].sort((a, b) => b.score - a.score), "Only model-supported genres survive, duplicate labels keep their strongest score, and results are ranked.");
assert.deepEqual(normalizeAcousticGenrePredictions([{ label: "classical", score: 0.3 }]), [{ label: "Clásica", score: 0.3 }]);
assert.deepEqual(normalizeAcousticGenrePredictions(null), []);
assert.deepEqual(normalizeAcousticGenrePredictions([{ label: "reggae", score: -1 }]), []);

const aggregated = aggregateAcousticGenrePredictions([
  [{ label: "jazz", score: 0.8 }, { label: "pop", score: 0.2 }],
  [{ label: "pop", score: 0.7 }, { label: "jazz", score: 0.3 }]
]);
assert.deepEqual(aggregated.map(item => item.label), ["Jazz", "Pop"]);
assert.ok(Math.abs(aggregated[0].score - 0.55) < 0.000001);
assert.ok(Math.abs(aggregated[1].score - 0.45) < 0.000001);
assert.equal(aggregated[0].segmentCount, 2);
assert.equal(aggregated[0].topRankVotes, 1, "The average winner must also expose top-rank disagreement between windows.");
assert.deepEqual(aggregateAcousticGenrePredictions([]), []);

const samples = extractCenteredMonoSamples({
  sampleRate: 8000,
  length: 32000,
  numberOfChannels: 2,
  getChannelData(channel) {
    return Float32Array.from({ length: 32000 }, (_, index) => channel === 0 ? index / 32000 : -(index / 32000));
  }
}, 16000, 1);
assert.equal(samples.length, 16000, "Resample to 16 kHz and cap the analysis window.");
assert.ok(samples.every(Number.isFinite));
assert.ok(Math.abs(samples.reduce((sum, value) => sum + value, 0) / samples.length) < 0.0001, "Stereo is downmixed without biasing one channel.");

const sourceData = Float32Array.from({ length: 8000 * 40 }, (_, index) => index / (8000 * 40));
const longBuffer = {
  sampleRate: 8000,
  length: sourceData.length,
  numberOfChannels: 1,
  getChannelData() { return sourceData; }
};
const distributed = extractDistributedMonoSamples(longBuffer, 16000, 12, 2);
assert.equal(distributed.length, 2, "Long tracks should be sampled at two separated positions.");
assert.ok(distributed.every(segment => segment instanceof Float32Array && segment.length === 16000 * 12));
const firstMean = distributed[0].reduce((sum, value) => sum + value, 0) / distributed[0].length;
const secondMean = distributed[1].reduce((sum, value) => sum + value, 0) / distributed[1].length;
assert.ok(secondMean > firstMean + 0.1, "Distributed windows must represent different portions of the track.");

const shortData = new Float32Array(8000 * 18);
const shortSegments = extractDistributedMonoSamples({
  sampleRate: 8000,
  length: shortData.length,
  numberOfChannels: 1,
  getChannelData() { return shortData; }
}, 16000, 12, 2);
assert.equal(shortSegments.length, 1, "Short tracks should retain one centered window instead of analyzing near-duplicates.");

await assert.rejects(
  decodeLocalAudioBlob(new Blob([new Uint8Array(MAX_AUDIO_GENRE_FILE_BYTES + 1)]), {
    AudioContextClass: class { constructor() { throw new Error("Decoder must not start for an oversized file."); } }
  }),
  /40 MB/
);
await assert.rejects(classifyLocalAudioTrack({ title: "Remote stream" }), /archivos locales/);

let timedOutDecoderClosed = false;
await assert.rejects(
  decodeLocalAudioBlob(new Blob([new Uint8Array([1, 2, 3])]), {
    AudioContextClass: class {
      async decodeAudioData() { return await new Promise(() => {}); }
      async close() { timedOutDecoderClosed = true; }
    },
    decodeTimeoutMs: 50
  }),
  /decodificación del audio tardó demasiado/,
  "Audio decoding must reject instead of leaving the metadata editor waiting indefinitely."
);
assert.equal(timedOutDecoderClosed, true, "Close the AudioContext after decode timeout.");

let workerTerminated = false;
let transferredSegmentCount = 0;
const fakeWorker = {
  onmessage: null,
  onerror: null,
  postMessage(message, transfer) {
    transferredSegmentCount = message.samples.length;
    assert.equal(message.type, "classify");
    assert.equal(transfer.length, 2, "Each local segment should be transferred to the worker without copying.");
    assert.equal(transfer[0], message.samples[0].buffer);
    assert.equal(transfer[1], message.samples[1].buffer);
    queueMicrotask(() => {
      this.onmessage?.({ data: { type: "progress", message: "Test de progreso" } });
      this.onmessage?.({ data: { type: "result", segmentPredictions: [
        [{ label: "jazz", score: 0.8 }, { label: "pop", score: 0.2 }],
        [{ label: "pop", score: 0.7 }, { label: "jazz", score: 0.3 }]
      ] } });
    });
  },
  terminate() { workerTerminated = true; }
};
const progress = [];
const results = await classifyLocalAudioTrack({ blob: new Blob(["local sample"]) }, {
  decodeAudio: async () => [
    new Float32Array(AUDIO_GENRE_SAMPLE_RATE * 12),
    new Float32Array(AUDIO_GENRE_SAMPLE_RATE * 12)
  ],
  workerFactory: () => fakeWorker,
  onProgress: message => progress.push(message),
  timeoutMs: 1000
});
assert.deepEqual(results.map(item => item.label), ["Jazz", "Pop"]);
assert.ok(Math.abs(results[0].score - 0.55) < 0.000001);
assert.equal(results[0].segmentCount, 2);
assert.equal(results[0].topRankVotes, 1);
assert.equal(transferredSegmentCount, 2);
assert.ok(workerTerminated, "The temporary worker must terminate after a result.");
assert.deepEqual(progress, ["Test de progreso"]);

const appSource = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
const htmlSource = await readFile(new URL("../index.html", import.meta.url), "utf8");
const workerSource = await readFile(new URL("../src/music-genre-classifier-worker.js", import.meta.url), "utf8");
assert.match(htmlSource, /id="metadata-genre-audio-classify"/, "Expose the local acoustic classifier from the metadata editor.");
assert.match(htmlSource, /id="metadata-genre-audio-results"/, "Provide a dedicated accessible result region.");
assert.match(htmlSource, /solo 10 géneros amplios/i, "Explain model scope before the user starts.");
assert.match(htmlSource, /hasta 24 segundos en dos fragmentos separados/i, "Explain the bounded multi-window analysis.");
assert.match(appSource, /classifyLocalAudioTrack\(track/, "Only the selected local track should be passed to acoustic classification.");
assert.match(appSource, /Primera opción en/, "Show whether each genre consistently ranked first across segments.");
assert.match(appSource, /todavía no cambió ningún metadato guardado/, "Predictions must require user confirmation.");
assert.match(workerSource, /https:\/\/cdn\.jsdelivr\.net\/npm\/@huggingface\/transformers@3\.7\.2/, "Pin the runtime version.");
assert.match(workerSource, /revision:\s*AUDIO_GENRE_MODEL_REVISION/, "Pass the pinned model revision into the Transformers.js loader.");
assert.match(workerSource, /numThreads = 2/, "Limit CPU inference concurrency.");
assert.match(workerSource, /classifier\(samples\[index\]/, "Run inference separately for each local segment.");
assert.doesNotMatch(workerSource, /fetch\s*\([^)]*(?:samples|audio|blob)/i, "Never send audio samples to a remote endpoint.");

console.log("Local acoustic genre classifier checks passed.");
