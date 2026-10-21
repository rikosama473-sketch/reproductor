import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { clearMediaSession, clearMediaSessionPositionState } from "../src/media-session-state.js";

const oldMetadata = { title: "Previously playing track" };
const positionStateCalls = [];
const mediaSession = {
  metadata: oldMetadata,
  playbackState: "paused",
  setPositionState(...args) { positionStateCalls.push(args); }
};
const state = { mediaSessionTrackId: "previous-track" };

clearMediaSession(mediaSession, state);
assert.equal(mediaSession.metadata, null, "clearing selection must remove the old OS-facing metadata");
assert.equal(mediaSession.playbackState, "none", "clearing selection must announce no active media");
assert.equal(state.mediaSessionTrackId, null, "the app must forget its last published track ID");
assert.deepEqual(positionStateCalls, [[]], "clearing a track must remove its OS-facing progress/seek state");

const guardedSession = Object.defineProperties({}, {
  metadata: { set() { throw new Error("metadata setter unavailable"); } },
  playbackState: { set() { throw new Error("playback setter unavailable"); } },
  setPositionState: { value() { throw new Error("position state unavailable"); } }
});
const guardedState = { mediaSessionTrackId: "another-track" };
assert.doesNotThrow(() => clearMediaSession(guardedSession, guardedState), "unsupported/throwing session setters must not break track cleanup");
assert.equal(guardedState.mediaSessionTrackId, null, "internal metadata reference is cleared even if an API setter throws");
assert.doesNotThrow(() => clearMediaSession(null, guardedState), "cleanup tolerates a missing session object");
assert.doesNotThrow(() => clearMediaSessionPositionState({}), "position cleanup tolerates browsers without Media Session position support");
assert.doesNotThrow(() => clearMediaSessionPositionState({ setPositionState() { throw new Error("unsupported"); } }), "position cleanup is defensive when the API rejects a clear request");

const appSource = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
assert.match(appSource, /clearMediaSessionPositionState\(navigator\.mediaSession\)/, "invalid or unavailable duration must clear stale system progress");
assert.match(appSource, /Number\.isFinite\(position\) && position >= 0/, "only safe, non-negative positions may be published");

console.log("Media Session state tests passed: metadata, playback state, progress cleanup, safe position updates, and defensive API handling.");
