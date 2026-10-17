export function createYoutubeHistoryController({
  addHistoryEntry,
  getHistory,
  createId,
  now = () => Date.now(),
  onHistoryUpdated = () => {}
}) {
  let generation = 0;
  let activeSession = null;

  return {
    select(videoId, title = "Video de YouTube") {
      activeSession = {
        sessionId: ++generation,
        videoId,
        title: String(title || "Video de YouTube"),
        recorded: false
      };
      return activeSession.sessionId;
    },

    cancel() {
      generation += 1;
      activeSession = null;
    },

    getCurrentSession() {
      return activeSession ? { ...activeSession } : null;
    },

    recordPlaying(actualVideoId) {
      const session = activeSession;
      if (!session || session.recorded || !actualVideoId || actualVideoId !== session.videoId) return false;

      // Mark before async persistence to make duplicate PLAYING/buffering events idempotent.
      session.recorded = true;
      const entry = {
        id: createId(),
        kind: "youtube",
        videoId: session.videoId,
        title: session.title,
        artist: "YouTube",
        playedAt: now(),
        embeddable: true,
        madeForKids: false,
        source: "YouTube"
      };

      Promise.resolve()
        .then(() => addHistoryEntry(entry))
        .then(() => getHistory(250))
        .then(history => onHistoryUpdated(history))
        .catch(() => {});
      return true;
    }
  };
}
