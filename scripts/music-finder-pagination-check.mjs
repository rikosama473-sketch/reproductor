import assert from "node:assert/strict";
import { paginateMusicFinderResults } from "../src/music-finder-ui.js";

const empty = paginateMusicFinderResults([], 12, 8);
assert.deepEqual(empty.items, []);
assert.equal(empty.total, 0);
assert.equal(empty.page, 0);
assert.equal(empty.pageCount, 1);
assert.equal(empty.hasPrevious, false);
assert.equal(empty.hasNext, false);

const rows = Array.from({ length: 17 }, (_, id) => ({ id }));
const first = paginateMusicFinderResults(rows, 0, 8);
assert.deepEqual(first.items.map(item => item.id), [0, 1, 2, 3, 4, 5, 6, 7]);
assert.equal(first.total, 17);
assert.equal(first.page, 0);
assert.equal(first.pageCount, 3);
assert.equal(first.hasPrevious, false);
assert.equal(first.hasNext, true);

const middle = paginateMusicFinderResults(rows, 1, 8);
assert.deepEqual(middle.items.map(item => item.id), [8, 9, 10, 11, 12, 13, 14, 15]);
assert.equal(middle.hasPrevious, true);
assert.equal(middle.hasNext, true);

const last = paginateMusicFinderResults(rows, 2, 8);
assert.deepEqual(last.items.map(item => item.id), [16]);
assert.equal(last.page, 2);
assert.equal(last.hasPrevious, true);
assert.equal(last.hasNext, false);

const upperClamped = paginateMusicFinderResults(rows, 999, 8);
assert.equal(upperClamped.page, 2);
assert.deepEqual(upperClamped.items, last.items);
const lowerClamped = paginateMusicFinderResults(rows, -999, 8);
assert.equal(lowerClamped.page, 0);
assert.deepEqual(lowerClamped.items, first.items);
assert.equal(paginateMusicFinderResults(rows, "1.9", 8).page, 1);
assert.equal(paginateMusicFinderResults(rows, Number.NaN, 8).page, 0);

assert.equal(paginateMusicFinderResults(rows, 0, 0).pageSize, 8, "Invalid page size falls back to the safe default");
assert.equal(paginateMusicFinderResults(rows, 0, 999).pageSize, 50, "Page size has a defensive upper bound");
assert.equal(paginateMusicFinderResults({ not: "an array" }, 0).total, 0, "Unexpected result containers fail safely");

console.log("Music-finder pagination checks passed: empty results, page boundaries, ordering, navigation flags and defensive clamping.");
