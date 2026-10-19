// Coordinates overlapping asynchronous work across logical generations.
// A stale promise cannot clear the in-flight slot of a newer generation.
export function createAsyncGenerationGate() {
  let generation = 0;
  let inFlightGeneration = null;

  function invalidate() {
    generation += 1;
    inFlightGeneration = null;
    return generation;
  }
  function isCurrent(candidate) {
    return candidate === generation;
  }
  function tryStart(candidate) {
    if (!isCurrent(candidate) || inFlightGeneration === candidate) return false;
    inFlightGeneration = candidate;
    return true;
  }
  function finish(candidate) {
    if (isCurrent(candidate) && inFlightGeneration === candidate) inFlightGeneration = null;
  }
  return Object.freeze({ invalidate, isCurrent, tryStart, finish });
}
