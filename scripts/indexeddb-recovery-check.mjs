import assert from "node:assert/strict";

const requests = [];
let lateConnectionClosed = false;
let transactionAborted = false;
let attemptedQueuedWrite = false;
let putCallCount = 0;
let failPutOnCall = 1;
let successfullyQueuedWrites = 0;

const fakeDb = {
  objectStoreNames: { contains: () => true },
  close() {},
  transaction() {
    const tx = {
      oncomplete: null,
      onerror: null,
      onabort: null,
      abort() {
        transactionAborted = true;
        queueMicrotask(() => tx.onabort?.());
      },
      objectStore() {
        return {
          getAll() {
            const request = { result: [] };
            queueMicrotask(() => request.onsuccess?.());
            return request;
          },
          put() {
            putCallCount += 1;
            if (putCallCount === failPutOnCall) {
              // Model a later put() throwing after earlier requests were queued.
              attemptedQueuedWrite = true;
              throw new Error("simulated synchronous write failure");
            }
            successfullyQueuedWrites += 1;
            return {};
          }
        };
      }
    };
    return tx;
  }
};

globalThis.indexedDB = {
  open(name, version) {
    const request = {
      name,
      version,
      result: null,
      error: null,
      onupgradeneeded: null,
      onsuccess: null,
      onerror: null,
      onblocked: null
    };
    requests.push(request);
    return request;
  }
};

const storage = await import("../src/storage.js?indexeddb-recovery-test");
const firstAttempt = storage.getAllTracks();
assert.equal(requests.length, 1, "first storage operation should open IndexedDB");
requests[0].onblocked?.();
await assert.rejects(firstAttempt, /otra pestaña/i, "a blocked open should produce a user-readable error");

const secondAttempt = storage.getAllTracks();
assert.equal(requests.length, 2, "a rejected blocked open must not poison subsequent retries");

// IndexedDB may still report success for an open request after its blocked event.
requests[0].result = {
  ...fakeDb,
  close() { lateConnectionClosed = true; }
};
requests[0].onsuccess?.();
assert.equal(lateConnectionClosed, true, "a late connection after rejection must be closed");

requests[1].onblocked?.();
await assert.rejects(secondAttempt, /otra pestaña/i);

const thirdAttempt = storage.getAllTracks();
assert.equal(requests.length, 3, "a second blocked attempt should also permit another retry");
requests[2].result = fakeDb;
requests[2].onsuccess?.();
assert.deepEqual(await thirdAttempt, [], "storage should recover once another tab no longer blocks opening");

await assert.rejects(
  storage.saveTrack({ id: "queued-then-failed", title: "Regression test" }),
  /simulated synchronous write failure/,
  "storage should surface synchronous write setup failures"
);
assert.equal(attemptedQueuedWrite, true, "the test should simulate a queued write before the later exception");
assert.equal(transactionAborted, true, "the transaction must abort so a queued write cannot commit after setup fails");

// A bulk import must also roll back when a later put() fails synchronously.
transactionAborted = false;
attemptedQueuedWrite = false;
putCallCount = 0;
failPutOnCall = 2;
successfullyQueuedWrites = 0;
await assert.rejects(
  storage.saveManyTracks([{ id: "first-in-batch" }, { id: "invalid-in-batch" }]),
  /simulated synchronous write failure/,
  "bulk import should surface a synchronous put() failure"
);
assert.equal(successfullyQueuedWrites, 1, "the scenario must queue an earlier write before the second put() fails");
assert.equal(attemptedQueuedWrite, true, "the second put() should fail after the first write was queued");
assert.equal(transactionAborted, true, "bulk import must abort instead of committing a partial batch");
console.log("IndexedDB blocked-open recovery, single-write rollback, and atomic bulk-import rollback tests passed.");
