import assert from "node:assert/strict";
import { schedulePlaybackPositionRestore, setPlaybackPosition } from "../src/playback-position.js";

function mediaElement({ duration = 60 } = {}) {
  const listeners = new Map();
  return {
    duration, readyState: 0, currentTime: 0,
    addEventListener(type, callback) {
      const bucket = listeners.get(type) || new Set();
      bucket.add(callback);
      listeners.set(type, bucket);
    },
    removeEventListener(type, callback) { listeners.get(type)?.delete(callback); },
    dispatch(type) { for (const callback of [...(listeners.get(type) || [])]) callback(); },
    listenerCount(type) { return listeners.get(type)?.size || 0; },
    firstListener(type) { return [...(listeners.get(type) || [])][0]; }
  };
}

// A valid restoration clamps to the real duration and unregisters itself.
{
  const element = mediaElement({ duration: 42 });
  let settled = 0;
  schedulePlaybackPositionRestore(element, 99, { onSettled: () => settled++ });
  assert.equal(element.listenerCount("loadedmetadata"), 1);
  element.dispatch("loadedmetadata");
  assert.equal(element.currentTime, 42);
  assert.equal(element.listenerCount("loadedmetadata"), 0);
  assert.equal(settled, 1);
}

// Reproduce a queued loadedmetadata callback after a new track takes over the
// very same media element. It must not seek the new selection to the old time.
{
  const element = mediaElement({ duration: 180 });
  let request = 10;
  let activeElement = element;
  schedulePlaybackPositionRestore(element, 125, {
    isCurrentRequest: () => request === 10,
    isActiveElement: candidate => candidate === activeElement
  });
  const queuedCallback = element.firstListener("loadedmetadata");
  request = 11;
  queuedCallback();
  assert.equal(element.currentTime, 0, "a stale request must not move the newly selected track");
  assert.equal(element.listenerCount("loadedmetadata"), 0, "the fired listener must unregister itself");
}

// Switching the active engine also invalidates an otherwise current callback.
{
  const element = mediaElement();
  const otherEngine = mediaElement();
  let activeElement = element;
  schedulePlaybackPositionRestore(element, 18, { isActiveElement: candidate => candidate === activeElement });
  const queuedCallback = element.firstListener("loadedmetadata");
  activeElement = otherEngine;
  queuedCallback();
  assert.equal(element.currentTime, 0, "an inactive engine must not receive a delayed seek");
}

// Cancellation actively removes the deferred listener, not merely its effect.
{
  const element = mediaElement();
  let settled = 0;
  const cancel = schedulePlaybackPositionRestore(element, 22, { onSettled: () => settled++ });
  assert.equal(cancel(), true);
  assert.equal(cancel(), false, "cancellation should be idempotent");
  assert.equal(element.listenerCount("loadedmetadata"), 0);
  element.dispatch("loadedmetadata");
  assert.equal(element.currentTime, 0);
  assert.equal(settled, 1);
}

// Invalid/non-positive positions do not seek; duration may be unavailable.
{
  const element = mediaElement({ duration: Number.NaN });
  assert.equal(setPlaybackPosition(element, 0), false);
  assert.equal(setPlaybackPosition(element, -2), false);
  assert.equal(element.currentTime, 0);
  assert.equal(setPlaybackPosition(element, 15), true);
  assert.equal(element.currentTime, 15);
}
console.log("Playback-position checks passed: stale request protection, inactive engine guard, listener cancellation and duration clamping.");
