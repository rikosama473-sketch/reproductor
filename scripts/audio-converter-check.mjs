import assert from "node:assert/strict";
import {
  claimUniqueWavFilename,
  convertAudioFileToWav,
  encodePcm16Wav,
  MAX_CONVERTER_DURATION_SECONDS,
  probeAudioFileDuration
} from "../src/audio-converter.js";

function fakeBuffer(channelSamples, sampleRate = 44100) {
  return {
    numberOfChannels: channelSamples.length,
    length: channelSamples[0].length,
    sampleRate,
    duration: channelSamples[0].length / sampleRate,
    getChannelData(channel) { return Float32Array.from(channelSamples[channel]); }
  };
}
const mono = fakeBuffer([[-1, 0, 1]]);
const monoWav = encodePcm16Wav(mono, 1);
assert.equal(monoWav.type, "audio/wav");
const monoBytes = new DataView(await monoWav.arrayBuffer());
assert.equal(String.fromCharCode(...new Uint8Array(await monoWav.arrayBuffer()).slice(0, 4)), "RIFF");
assert.equal(String.fromCharCode(...new Uint8Array(await monoWav.arrayBuffer()).slice(8, 12)), "WAVE");
assert.equal(monoBytes.getUint16(20, true), 1, "WAV must declare integer PCM");
assert.equal(monoBytes.getUint16(22, true), 1, "Mono output must declare one channel");
assert.equal(monoBytes.getUint32(24, true), 44100);
assert.equal(monoBytes.getUint16(34, true), 16, "Output is signed 16-bit PCM");
assert.equal(monoBytes.getUint32(40, true), 6, "Three mono samples occupy six bytes");
assert.equal(monoBytes.getInt16(44, true), -32768);
assert.equal(monoBytes.getInt16(46, true), 0);
assert.equal(monoBytes.getInt16(48, true), 32767);

const stereo = fakeBuffer([[0.5, -0.5], [0.25, -0.25]]);
const stereoBytes = new DataView(await encodePcm16Wav(stereo, 2).arrayBuffer());
assert.equal(stereoBytes.getUint16(22, true), 2);
assert.equal(stereoBytes.getUint32(28, true), 44100 * 4);
assert.equal(stereoBytes.getUint32(40, true), 8);
const monoDownmix = new DataView(await encodePcm16Wav(stereo, 1).arrayBuffer());
assert.equal(monoDownmix.getUint16(22, true), 1);
assert.equal(monoDownmix.getInt16(44, true), 12287 + 1, "Stereo-to-mono should average both source channels");

const expanded = new DataView(await encodePcm16Wav(mono, 2).arrayBuffer());
assert.equal(expanded.getUint16(22, true), 2, "Mono source may be duplicated to stereo");
assert.equal(expanded.getInt16(44, true), expanded.getInt16(46, true));

const surround = fakeBuffer([[1, 0], [0, 1], [-1, 0], [0, -1]]);
const downmix = new DataView(await encodePcm16Wav(surround, 2).arrayBuffer());
assert.equal(downmix.getUint16(22, true), 2, "Multichannel sources are downmixed to stereo");
assert.throws(() => encodePcm16Wav({ length: 0 }), /muestras válidas/);

// Duplicate basenames and case-only differences must not collide on common filesystems.
{
  const usedNames = new Set();
  assert.equal(claimUniqueWavFilename("Theme.mp3", usedNames), "Theme.wav");
  assert.equal(claimUniqueWavFilename("theme.flac", usedNames), "theme (2).wav");
  assert.equal(claimUniqueWavFilename("CON.ogg", usedNames), "_CON.wav");
  assert.equal(claimUniqueWavFilename("Folder/Track?.mp3", usedNames), "Folder-Track-.wav");
}

// Metadata probing must revoke its temporary URL on success.
{
  let revoked = 0;
  const fakeAudio = () => {
    const handlers = new Map();
    return {
      duration: 2.5,
      preload: "",
      src: "",
      addEventListener(name, fn) { handlers.set(name, fn); },
      removeEventListener(name) { handlers.delete(name); },
      removeAttribute(name) { if (name === "src") this.src = ""; },
      pause() {},
      load() {
        if (this.src) queueMicrotask(() => handlers.get("loadedmetadata")?.());
      }
    };
  };
  const duration = await probeAudioFileDuration({ name: "short.wav" }, {
    createAudioElement: fakeAudio,
    createObjectURL: () => "blob:test-audio",
    revokeObjectURL: url => { assert.equal(url, "blob:test-audio"); revoked++; },
    timeoutMs: 100
  });
  assert.equal(duration, 2.5);
  assert.equal(revoked, 1, "The metadata probe must release its temporary object URL.");
}

// Overlong files must be rejected before reading their bytes or decoding PCM.
{
  let arrayBufferCalls = 0;
  let decodeCalls = 0;
  const file = { size: 1024, arrayBuffer: async () => { arrayBufferCalls++; return new ArrayBuffer(1024); } };
  const context = { sampleRate: 44100, decodeAudioData: async () => { decodeCalls++; return fakeBuffer([[0, 0]]); } };
  await assert.rejects(
    convertAudioFileToWav(file, context, { durationProbe: async () => MAX_CONVERTER_DURATION_SECONDS + 1 }),
    /7 minutos/
  );
  assert.equal(arrayBufferCalls, 0, "Duration rejection must happen before reading the compressed file.");
  assert.equal(decodeCalls, 0, "Duration rejection must happen before decodeAudioData().");
}

// Batch output budget must be enforced using the estimated WAV size before decode.
{
  let decodeCalls = 0;
  const file = { size: 16, arrayBuffer: async () => new ArrayBuffer(16) };
  const context = { sampleRate: 44100, decodeAudioData: async () => { decodeCalls++; return fakeBuffer([[0, 0]]); } };
  await assert.rejects(
    convertAudioFileToWav(file, context, {
      durationProbe: async () => 1,
      maxOutputBytes: 1024
    }),
    /WAV estimado supera/
  );
  assert.equal(decodeCalls, 0, "Output budget rejection must happen before decodeAudioData().");
}

// Successful conversion still produces a valid WAV after preflight.
{
  const file = { size: 16, arrayBuffer: async () => new ArrayBuffer(16) };
  const context = { sampleRate: 44100, decodeAudioData: async () => fakeBuffer([[0, 0]]) };
  const result = await convertAudioFileToWav(file, context, {
    durationProbe: async () => 1,
    maxOutputBytes: 200000
  });
  assert.equal(result.blob.type, "audio/wav");
  assert.equal(result.channels, 2);
  assert.equal(result.blob.size, 52);
}
console.log("Audio converter tests passed: PCM16 RIFF/WAVE, mono/stereo and multichannel output, duration preflight, URL cleanup and batch-output budget.");
