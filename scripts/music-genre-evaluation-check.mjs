import assert from "node:assert/strict";
import {
  BENCHMARK_GENRES,
  calculateGenreMetrics,
  normalizeBenchmarkGenre,
  parsePcm16Wav,
  percentile,
  resolveManifestTrackPath,
  validateBenchmarkManifest
} from "../tools/genre-benchmark/core.mjs";

function makePcm16Wav({ channels = 1, sampleRate = 8000, frames = 24000 } = {}) {
  const blockAlign = channels * 2;
  const dataSize = frames * blockAlign;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * blockAlign, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataSize, 40);
  for (let frame = 0; frame < frames; frame++) {
    for (let channel = 0; channel < channels; channel++) {
      buffer.writeInt16LE(channel === 0 ? 16384 : -16384, 44 + frame * blockAlign + channel * 2);
    }
  }
  return buffer;
}

assert.deepEqual(BENCHMARK_GENRES, [
  "Blues", "Clásica", "Country", "Disco", "Hip-Hop",
  "Jazz", "Metal", "Pop", "Reggae", "Rock"
]);
assert.equal(normalizeBenchmarkGenre("classical"), "Clásica");
assert.equal(normalizeBenchmarkGenre("Clásica"), "Clásica");
assert.equal(normalizeBenchmarkGenre("hiphop"), "Hip-Hop");
assert.equal(normalizeBenchmarkGenre("hip-hop"), "Hip-Hop");
assert.equal(normalizeBenchmarkGenre("cumbia"), null, "Do not map unsupported subgenres to an unrelated model class.");

const manifest = {
  schemaVersion: 1,
  datasetName: "test local",
  split: "test",
  tracks: [{
    id: "clip-001",
    file: "audio/clip-001.wav",
    artistKey: "artist-001",
    expectedGenre: "Rock",
    rights: { basis: "owned", reference: "Grabación propia" }
  }]
};
assert.deepEqual(validateBenchmarkManifest(manifest), []);
assert.ok(validateBenchmarkManifest({ ...manifest, tracks: [] }).some(error => error.includes("al menos una pista")));
assert.ok(validateBenchmarkManifest({
  ...manifest,
  tracks: [{ ...manifest.tracks[0], file: "../clip.wav" }]
}).some(error => error.includes("ruta WAV relativa")));
assert.ok(validateBenchmarkManifest({
  ...manifest,
  tracks: [{ ...manifest.tracks[0], file: "C:\\music\\clip.wav" }]
}).some(error => error.includes("ruta WAV relativa")));
assert.ok(validateBenchmarkManifest({
  ...manifest,
  tracks: [{ ...manifest.tracks[0], rights: { basis: "creative-commons", reference: "URL" } }]
}).some(error => error.includes("rights.license")));
assert.ok(validateBenchmarkManifest({
  ...manifest,
  tracks: [{ ...manifest.tracks[0], expectedGenre: "City Pop" }]
}).some(error => error.includes("diez categorías")));

assert.equal(
  resolveManifestTrackPath("/tmp/ritmo-benchmark", "audio/clip-001.wav"),
  "/tmp/ritmo-benchmark/audio/clip-001.wav"
);
assert.throws(
  () => resolveManifestTrackPath("/tmp/ritmo-benchmark", "../outside.wav"),
  /no puede salir/
);
assert.throws(
  () => resolveManifestTrackPath("/tmp/ritmo-benchmark", "D:\\outside.wav"),
  /no puede salir/
);

const mono = parsePcm16Wav(makePcm16Wav());
assert.equal(mono.sampleRate, 8000);
assert.equal(mono.numberOfChannels, 1);
assert.equal(mono.length, 24000);
assert.equal(mono.duration, 3);
assert.ok(Math.abs(mono.getChannelData(0)[0] - 0.5) < 0.0001);

const stereo = parsePcm16Wav(makePcm16Wav({ channels: 2, frames: 8000 }));
assert.equal(stereo.numberOfChannels, 2);
assert.ok(Math.abs(stereo.getChannelData(0)[0] - 0.5) < 0.0001);
assert.ok(Math.abs(stereo.getChannelData(1)[0] + 0.5) < 0.0001);
assert.throws(() => parsePcm16Wav(Buffer.from("not a wav")), /WAV RIFF válido/);

const floatWav = makePcm16Wav();
floatWav.writeUInt16LE(3, 20);
assert.throws(() => parsePcm16Wav(floatWav), /PCM entero de 16 bits/);

const metrics = calculateGenreMetrics([
  {
    expectedGenre: "Rock",
    predictedGenre: "Rock",
    top3: ["Rock", "Jazz", "Pop"],
    segmentCount: 2,
    segmentTop1: ["Rock", "Rock"]
  },
  {
    expectedGenre: "Jazz",
    predictedGenre: "Pop",
    top3: ["Pop", "Jazz", "Rock"],
    segmentCount: 1,
    segmentTop1: ["Pop"]
  }
]);
assert.equal(metrics.sampleCount, 2);
assert.equal(metrics.correct, 1);
assert.equal(metrics.accuracy, 0.5);
assert.equal(metrics.top3Accuracy, 1);
assert.equal(metrics.macroF1PresentClasses, 0.5);
assert.equal(metrics.macroRecallPresentClasses, 0.5);
assert.equal(metrics.perClass.Rock.f1, 1);
assert.equal(metrics.perClass.Jazz.f1, 0);
assert.equal(metrics.confusionMatrix.values.Jazz.Pop, 1);
assert.equal(metrics.multiSegmentTrackCount, 1);
assert.equal(metrics.multiSegmentStableTop1Rate, 1);
assert.ok(metrics.classesWithoutSupport.includes("Blues"));

const unclassified = calculateGenreMetrics([{
  expectedGenre: "Blues",
  predictedGenre: null,
  top3: [],
  segmentCount: 1,
  segmentTop1: [null]
}]);
assert.equal(unclassified.confusionMatrix.values.Blues["Sin clasificación"], 1);
assert.equal(unclassified.accuracy, 0);
assert.equal(percentile([10, 20, 30, 40], 0.5), 20);
assert.equal(percentile([10, 20, 30, 40], 0.95), 40);
assert.equal(percentile([], 0.95), null);

console.log("Local genre benchmark core checks passed.");
