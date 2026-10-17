import assert from "node:assert/strict";
import { createYoutubeHistoryController } from "../src/youtube-history.js";

const saved = [];
const rendered = [];
let generatedId = 0;
const controller = createYoutubeHistoryController({
  addHistoryEntry: async entry => { saved.push(entry); },
  getHistory: async limit => {
    assert.equal(limit, 250);
    return [...saved].reverse();
  },
  createId: () => "history-" + (++generatedId),
  now: () => 1729166400000,
  onHistoryUpdated: history => rendered.push(history)
});

const firstSessionId = controller.select("aaaaaaaaaaa", "Tema A");
assert.equal(controller.getCurrentSession().sessionId, firstSessionId);
assert.equal(saved.length, 0, "Selecting a video must not create a playback history entry");
assert.equal(controller.recordPlaying("bbbbbbbbbbb"), false, "A stale/other video event must be ignored");
assert.equal(saved.length, 0, "A mismatched playback event must not write history");

assert.equal(controller.recordPlaying("aaaaaaaaaaa"), true, "Confirmed PLAYING should write the selected video");
assert.equal(controller.recordPlaying("aaaaaaaaaaa"), false, "Repeated PLAYING events must not duplicate the same session");
await new Promise(resolve => setImmediate(resolve));
assert.equal(saved.length, 1);
assert.deepEqual(
  { videoId: saved[0].videoId, title: saved[0].title, artist: saved[0].artist, playedAt: saved[0].playedAt },
  { videoId: "aaaaaaaaaaa", title: "Tema A", artist: "YouTube", playedAt: 1729166400000 }
);
assert.equal(rendered.length, 1, "Persisted history refreshes after the write succeeds");

controller.select("bbbbbbbbbbb", "Tema B");
controller.select("ccccccccccc", "Tema C");
assert.equal(controller.recordPlaying("bbbbbbbbbbb"), false, "Late events from an older selection must be ignored");
assert.equal(controller.recordPlaying("ccccccccccc"), true, "The latest selected video can be recorded");
await new Promise(resolve => setImmediate(resolve));
assert.equal(saved.length, 2);
assert.equal(saved[1].videoId, "ccccccccccc");

controller.select("ddddddddddd", "Tema D");
controller.cancel();
assert.equal(controller.recordPlaying("ddddddddddd"), false, "Leaving the player cancels the pending session");
await new Promise(resolve => setImmediate(resolve));
assert.equal(saved.length, 2, "Canceled playback must not write history");

console.log("YouTube playback-history checks passed: confirmed starts only, idempotent events, and stale-session cancellation.");
