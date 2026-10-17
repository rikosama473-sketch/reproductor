import assert from "node:assert/strict";

const historyRows = Array.from({ length: 7 }, (_, index) => ({
  id: "history-" + index,
  playedAt: 7000 - index * 1000
}));

const fakeDb = {
  objectStoreNames: { contains: () => true },
  close() {},
  transaction(storeName) {
    return {
      objectStore() {
        return {
          getAll() {
            const request = { result: storeName === "history" ? [...historyRows] : [] };
            queueMicrotask(() => request.onsuccess?.());
            return request;
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
assert.equal((await storage.getHistory(3.8)).length, 3, "fractional limits are truncated to whole entries");
assert.equal((await storage.getHistory()).length, historyRows.length, "omitting the argument keeps the default limit");
assert.equal((await storage.getHistory(null)).length, historyRows.length, "null uses the default limit");
assert.deepEqual(await storage.getHistory(-5), [], "negative limits clamp to zero");
console.log("History limit regression tests passed: zero, positive, fractional, default, null, and negative limits.");
