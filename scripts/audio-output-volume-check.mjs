import assert from "node:assert/strict";
import { createAudioOutputVolumeController } from "../src/audio-output-volume.js";

const defaultAudio = { volume: 0.8 };
const equalizedAudio = { volume: 0.8 };
let audioGraph = null;
let audioContext = null;
const gainCalls = [];
const controller = createAudioOutputVolumeController({
  defaultAudio,
  equalizedAudio,
  getAudioGraph: () => audioGraph,
  getAudioContext: () => audioContext
});

// Before the EQ graph exists, both media elements use the native volume API.
assert.equal(controller.setVolume(0.4), 0.4);
assert.equal(defaultAudio.volume, 0.4);
assert.equal(equalizedAudio.volume, 0.4);

// Once connected to Web Audio, output level is applied downstream with GainNode.
// The media element stays at unity to prevent double attenuation on browsers
// that support both volume controls.
audioGraph = {
  outputGain: {
    gain: {
      value: 1,
      setTargetAtTime(value, currentTime, timeConstant) {
        gainCalls.push({ value, currentTime, timeConstant });
      }
    }
  }
};
audioContext = { currentTime: 12.5 };
assert.equal(controller.setVolume(0.25), 0.25);
assert.equal(defaultAudio.volume, 0.25);
assert.equal(equalizedAudio.volume, 1);
assert.deepEqual(gainCalls.at(-1), { value: 0.25, currentTime: 12.5, timeConstant: 0.015 });

// Muting must reach the actual Web Audio output, and values must stay in range.
assert.equal(controller.setVolume(0), 0);
assert.equal(gainCalls.at(-1).value, 0);
assert.equal(controller.setVolume(2), 1);
assert.equal(gainCalls.at(-1).value, 1);
assert.equal(controller.setVolume(-1), 0);
assert.equal(gainCalls.at(-1).value, 0);
assert.equal(controller.setVolume(Number.NaN), 0);
assert.equal(gainCalls.at(-1).value, 0);

console.log("Audio output volume tests passed: native engine, GainNode, mute, and clamping.");
