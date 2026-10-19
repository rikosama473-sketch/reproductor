import assert from "node:assert/strict";
import { createAsyncGenerationGate } from "../src/async-generation-gate.js";

const gate = createAsyncGenerationGate();
const oldGeneration = gate.invalidate();
assert.equal(gate.tryStart(oldGeneration), true);
assert.equal(gate.tryStart(oldGeneration), false, "A generation must not run duplicate polls");

const currentGeneration = gate.invalidate();
assert.notEqual(currentGeneration, oldGeneration);
assert.equal(gate.tryStart(currentGeneration), true, "A new session must start without waiting for the obsolete promise");

// Reproduce the race: A settles after B has already acquired its in-flight slot.
gate.finish(oldGeneration);
assert.equal(gate.tryStart(currentGeneration), false,
  "A stale completion must not clear the active generation's lock");
gate.finish(currentGeneration);
assert.equal(gate.tryStart(currentGeneration), true,
  "The current generation must be able to poll again after its own completion");

const nextGeneration = gate.invalidate();
assert.equal(gate.tryStart(currentGeneration), false, "Invalidated generations cannot restart");
assert.equal(gate.tryStart(nextGeneration), true);
gate.finish(nextGeneration);
assert.equal(gate.tryStart(nextGeneration), true, "The next generation's slot must release normally");

console.log("Async generation gate regressions passed.");
