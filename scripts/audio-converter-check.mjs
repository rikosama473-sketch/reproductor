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

// Standard quad layout mixes corresponding left/right surround channels at half gain.
{
  const quad = fakeBuffer([[0.2], [0.4], [0.6], [-0.2]]);
  const quadStereo = new DataView(await encodePcm16Wav(quad, 2).arrayBuffer());
  assert.equal(quadStereo.getUint16(22, true), 2);
  assert.equal(quadStereo.getInt16(44, true), Math.round(0.4 * 32767));
  assert.equal(quadStereo.getInt16(46, true), Math.round(0.1 * 32767));
  const quadMono = new DataView(await encodePcm16Wav(quad, 1).arrayBuffer());
  assert.equal(quadMono.getInt16(44, true), Math.round(0.25 * 32767));
}

// Standard 5.1 layout mixes center and matching surrounds into left/right;
// LFE is deliberately discarded rather than injected into only one side.
{
  const surround51 = fakeBuffer([[0.1], [-0.1], [0.2], [0.8], [0.3], [-0.3]]);
  const stereo51 = new DataView(await encodePcm16Wav(surround51, 2).arrayBuffer());
  const expectedLeft = 0.1 + Math.SQRT1_2 * (0.2 + 0.3);
  const expectedRight = -0.1 + Math.SQRT1_2 * (0.2 - 0.3);
  assert.equal(stereo51.getInt16(44, true), Math.round(expectedLeft * 32767));
  assert.equal(stereo51.getInt16(46, true), Math.round(expectedRight * 32768));
  const mono51 = new DataView(await encodePcm16Wav(surround51, 1).arrayBuffer());
  assert.equal(mono51.getInt16(44, true), Math.round(0.2 * 32767), "Mono 5.1 downmix must omit LFE.");
}

// Peak protection applies one fixed gain to a hot 5.1 mix instead of hard-clipping
// every channel independently; normal-level mixes retain their original gain.
{
  const hot51 = fakeBuffer([[1], [1], [1], [1], [1], [1]]);
  const stereoHot = new DataView(await encodePcm16Wav(hot51, 2).arrayBuffer());
  assert.equal(stereoHot.getInt16(44, true), 32767, "Hot 5.1 left mix should be attenuated to full scale without clipping.");
  assert.equal(stereoHot.getInt16(46, true), 32767, "Hot 5.1 right mix should share the same static gain.");
  const monoHot = new DataView(await encodePcm16Wav(hot51, 1).arrayBuffer());
  assert.equal(monoHot.getInt16(44, true), 32767, "Hot mono downmix should be peak-protected.");
}

// Unknown channel counts use a conservative discrete fallback.
{
  const unknownLayout = fakeBuffer([[0.2], [-0.4], [0.9]]);
  const converted = new DataView(await encodePcm16Wav(unknownLayout, 2).arrayBuffer());
  assert.equal(converted.getInt16(44, true), Math.round(0.2 * 32767));
  assert.equal(converted.getInt16(46, true), Math.round(-0.4 * 32768));
}
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

// Cancellation during the metadata probe must release the temporary URL immediately.
{
  const controller = new AbortController();
  let revoked = 0;
  const fakeAudio = () => {
    const handlers = new Map();
    return {
      duration: NaN,
      preload: "",
      src: "",
      addEventListener(name, fn) { handlers.set(name, fn); },
      removeEventListener(name) { handlers.delete(name); },
      removeAttribute(name) { if (name === "src") this.src = ""; },
      pause() {},
      load() {}
    };
  };
  const pending = probeAudioFileDuration({ name: "pending.wav" }, {
    createAudioElement: fakeAudio,
    createObjectURL: () => "blob:pending-audio",
    revokeObjectURL: () => { revoked++; },
    timeoutMs: 1000,
    signal: controller.signal
  });
  controller.abort();
  await assert.rejects(pending, error => error?.name === "AbortError");
  assert.equal(revoked, 1, "Abort should release the metadata probe URL.");
}

// A cancellation during/after metadata lookup must prevent file reads and decode.
{
  const controller = new AbortController();
  let arrayBufferCalls = 0;
  let decodeCalls = 0;
  const file = { size: 16, arrayBuffer: async () => { arrayBufferCalls++; return new ArrayBuffer(16); } };
  const context = { sampleRate: 44100, decodeAudioData: async () => { decodeCalls++; return fakeBuffer([[0, 0]]); } };
  await assert.rejects(
    convertAudioFileToWav(file, context, {
      durationProbe: async () => { controller.abort(); return 1; },
      signal: controller.signal,
      maxOutputBytes: 200000
    }),
    error => error?.name === "AbortError"
  );
  assert.equal(arrayBufferCalls, 0, "A cancelled conversion must not read the compressed file.");
  assert.equal(decodeCalls, 0, "A cancelled conversion must not begin decoding.");
}

// The browser cannot stop a decodeAudioData() call already in progress, but the
// result must be discarded and must not proceed to WAV allocation after cancel.
{
  const controller = new AbortController();
  let decodedResolve;
  let decodeStartedResolve;
  const decodeStarted = new Promise(resolve => { decodeStartedResolve = resolve; });
  const file = { size: 16, arrayBuffer: async () => new ArrayBuffer(16) };
  const context = {
    sampleRate: 44100,
    decodeAudioData: async () => {
      decodeStartedResolve();
      return await new Promise(resolve => { decodedResolve = resolve; });
    }
  };
  const pending = convertAudioFileToWav(file, context, {
    durationProbe: async () => 1,
    signal: controller.signal,
    maxOutputBytes: 200000
  });
  await decodeStarted;
  controller.abort();
  decodedResolve(fakeBuffer([[0, 0]]));
  await assert.rejects(pending, error => error?.name === "AbortError");
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
