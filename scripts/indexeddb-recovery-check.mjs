import assert from "node:assert/strict";

const requests = [];
let lateConnectionClosed = false;

const fakeDb = {
  objectStoreNames: { contains: () => true },
  close() {},
  transaction() {
    return {
      objectStore() {
        return {
          getAll() {
            const request = { result: [] };
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
console.log("IndexedDB blocked-open recovery tests passed.");
