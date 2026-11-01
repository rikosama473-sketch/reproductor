import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  AUDIO_GENRE_MODEL_ID,
  AUDIO_GENRE_MODEL_REVISION,
  AUDIO_GENRE_SAMPLE_RATE,
  AUDIO_GENRE_ANALYSIS_SECONDS,
  MAX_AUDIO_GENRE_FILE_BYTES,
  normalizeAcousticGenrePredictions,
  extractCenteredMonoSamples,
  decodeLocalAudioBlob,
  classifyLocalAudioTrack
} from "../src/music-genre-classifier.js";

assert.equal(AUDIO_GENRE_MODEL_ID, "onnx-community/Musical-genres-Classification-Hubert-V1-ONNX");
assert.match(AUDIO_GENRE_MODEL_REVISION, /^[a-f0-9]{40}$/);
assert.equal(AUDIO_GENRE_SAMPLE_RATE, 16000);
assert.equal(AUDIO_GENRE_ANALYSIS_SECONDS, 12);
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
  { label: "Rock", score: 0.7 },
  { label: "Pop", score: 0.8 },
  { label: "Hip-Hop", score: 0.6 }
].sort((a, b) => b.score - a.score), "Only model-supported genres survive, duplicates keep their strongest score, and results are score-ranked.");
assert.deepEqual(normalizeAcousticGenrePredictions([{ label: "classical", score: 0.3 }]), [{ label: "Clásica", score: 0.3 }]);
assert.deepEqual(normalizeAcousticGenrePredictions(null), []);
assert.deepEqual(normalizeAcousticGenrePredictions([{ label: "reggae", score: -1 }]), []);

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
let transferredSamplesLength = 0;
const fakeWorker = {
  onmessage: null,
  onerror: null,
  postMessage(message, transfer) {
    transferredSamplesLength = message.samples.length;
    assert.equal(message.type, "classify");
    assert.equal(transfer[0], message.samples.buffer);
    queueMicrotask(() => {
      this.onmessage?.({ data: { type: "progress", message: "Test de progreso" } });
      this.onmessage?.({ data: { type: "result", predictions: [
        { label: "jazz", score: 0.7 },
        { label: "pop", score: 0.6 }
      ] } });
    });
  },
  terminate() { workerTerminated = true; }
};
const progress = [];
const results = await classifyLocalAudioTrack({ blob: new Blob(["local sample"]) }, {
  decodeAudio: async () => new Float32Array(AUDIO_GENRE_SAMPLE_RATE * 4),
  workerFactory: () => fakeWorker,
  onProgress: message => progress.push(message),
  timeoutMs: 1000
});
assert.deepEqual(results.map(item => item.label), ["Jazz", "Pop"]);
assert.equal(transferredSamplesLength, AUDIO_GENRE_SAMPLE_RATE * 4);
assert.ok(workerTerminated, "The temporary worker must terminate after a result.");
assert.deepEqual(progress, ["Test de progreso"]);
const appSource = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
const htmlSource = await readFile(new URL("../index.html", import.meta.url), "utf8");
const workerSource = await readFile(new URL("../src/music-genre-classifier-worker.js", import.meta.url), "utf8");
assert.match(htmlSource, /id="metadata-genre-audio-classify"/, "Expose the local acoustic classifier from the metadata editor.");
assert.match(htmlSource, /id="metadata-genre-audio-results"/, "Provide a dedicated accessible result region.");
assert.match(htmlSource, /solo 10 géneros amplios/i, "Explain model scope before the user starts.");
assert.match(appSource, /classifyLocalAudioTrack\(track/, "Only the selected local track should be passed to acoustic classification.");
assert.match(appSource, /todavía no cambió ningún metadato guardado/, "Predictions must require user confirmation.");
assert.match(workerSource, /https:\/\/cdn\.jsdelivr\.net\/npm\/@huggingface\/transformers@3\.7\.2/, "Pin the runtime version.");
assert.match(workerSource, /revision:\s*AUDIO_GENRE_MODEL_REVISION/, "Pass the pinned model revision into the Transformers.js loader.");
assert.match(workerSource, /numThreads = 2/, "Limit CPU inference concurrency.");
assert.doesNotMatch(workerSource, /fetch\s*\([^)]*(?:samples|audio|blob)/i, "Never send audio samples to a remote endpoint.");

console.log("Local acoustic genre classifier checks passed.");
