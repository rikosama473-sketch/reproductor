import assert from "node:assert/strict";

const historyRows = Array.from({ length: 7 }, (_, index) => ({
  id: "history-" + index,
  playedAt: 7000 - index * 1000
}));
let historyRowsVisited = 0;
let historyGetAllCalls = 0;

const fakeDb = {
  objectStoreNames: { contains: () => true },
  close() {},
  transaction(storeName) {
    return {
      objectStore() {
        return {
          getAll() {
            historyGetAllCalls += storeName === "history" ? 1 : 0;
            const request = { result: storeName === "history" ? [...historyRows] : [] };
            queueMicrotask(() => request.onsuccess?.());
            return request;
          },
          index(indexName) {
            assert.equal(storeName, "history", "only history queries should request the playedAt index");
            assert.equal(indexName, "playedAt", "history retrieval must use the indexed timestamp");
            const rows = [...historyRows].sort((a, b) => b.playedAt - a.playedAt);
            return {
              openCursor(_range, direction) {
                assert.equal(direction, "prev", "history must traverse newest-first");
                let position = 0;
                const request = { result: null, error: null, onsuccess: null, onerror: null };
                const dispatch = () => {
                  if (position >= rows.length) {
                    request.result = null;
                  } else {
                    historyRowsVisited += 1;
                    const row = rows[position];
                    request.result = {
                      value: row,
                      continue() {
                        position += 1;
                        queueMicrotask(dispatch);
                      }
                    };
                  }
                  request.onsuccess?.();
                };
                queueMicrotask(dispatch);
                return request;
              }
            };
          }
        };
      }
    };
  }
};

globalThis.indexedDB = {
  open(name, version) {
    const request = {
      name,
      version,
      result: fakeDb,
      error: null,
      onupgradeneeded: null,
      onsuccess: null,
      onerror: null,
      onblocked: null
    };
    queueMicrotask(() => request.onsuccess?.());
    return request;
  }
};

const storage = await import("../src/storage.js?history-limit-regression");

assert.deepEqual(await storage.getHistory(0), [], "limit zero must return an empty history");
assert.equal((await storage.getHistory(1)).length, 1, "a positive limit returns exactly that many rows");
historyRowsVisited = 0;
assert.equal((await storage.getHistory(3)).length, 3, "cursor retrieval returns the requested window");
assert.equal(historyRowsVisited, 3, "history retrieval must stop when the limit is reached instead of scanning all rows");
assert.equal((await storage.getHistory(3.8)).length, 3, "fractional limits are truncated to whole entries");
assert.equal((await storage.getHistory()).length, historyRows.length, "omitting the argument keeps the default limit");
assert.equal((await storage.getHistory(null)).length, historyRows.length, "null uses the default limit");
assert.deepEqual(await storage.getHistory(-5), [], "negative limits clamp to zero");
assert.equal(historyGetAllCalls, 0, "history queries must not materialize the full store with getAll()");
assert.equal(historyRowsVisited, 3, "zero and negative limits must return without scanning the index");
console.log("History limit regression tests passed: bounded reverse-index reads, zero scans for empty windows, fractional/default/null/negative limits.");
