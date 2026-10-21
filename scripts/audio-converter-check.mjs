import assert from "node:assert/strict";
import { encodePcm16Wav } from "../src/audio-converter.js";

function fakeBuffer(channelSamples, sampleRate = 44100) {
  return {
    numberOfChannels: channelSamples.length,
    length: channelSamples[0].length,
    sampleRate,
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

const expanded = new DataView(await encodePcm16Wav(mono, 2).arrayBuffer());
assert.equal(expanded.getUint16(22, true), 2, "Mono source may be duplicated to stereo");
assert.equal(expanded.getInt16(44, true), expanded.getInt16(46, true));

const surround = fakeBuffer([[1, 0], [0, 1], [-1, 0], [0, -1]]);
const downmix = new DataView(await encodePcm16Wav(surround, 2).arrayBuffer());
assert.equal(downmix.getUint16(22, true), 2, "Multichannel sources are downmixed to stereo");
assert.throws(() => encodePcm16Wav({ length: 0 }), /muestras válidas/);
console.log("Audio converter tests passed: RIFF/WAVE header, PCM16 samples, mono/stereo and multichannel downmix.");
