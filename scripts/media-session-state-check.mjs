import assert from "node:assert/strict";
import { clearMediaSession } from "../src/media-session-state.js";

const oldMetadata = { title: "Previously playing track" };
const mediaSession = { metadata: oldMetadata, playbackState: "paused" };
const state = { mediaSessionTrackId: "previous-track" };

clearMediaSession(mediaSession, state);
assert.equal(mediaSession.metadata, null, "clearing selection must remove the old OS-facing metadata");
assert.equal(mediaSession.playbackState, "none", "clearing selection must announce no active media");
assert.equal(state.mediaSessionTrackId, null, "the app must forget its last published track ID");

const guardedSession = Object.defineProperties({}, {
  metadata: { set() { throw new Error("metadata setter unavailable"); } },
  playbackState: { set() { throw new Error("playback setter unavailable"); } }
});
const guardedState = { mediaSessionTrackId: "another-track" };
assert.doesNotThrow(() => clearMediaSession(guardedSession, guardedState), "unsupported/throwing session setters must not break track cleanup");
assert.equal(guardedState.mediaSessionTrackId, null, "internal metadata reference is cleared even if an API setter throws");
assert.doesNotThrow(() => clearMediaSession(null, guardedState), "cleanup tolerates a missing session object");

console.log("Media Session state tests passed: metadata, playback state, internal ID, and defensive API handling.");
