import assert from "node:assert/strict";
import { mapWithConcurrency } from "../src/concurrent-map.js";

{
  let active = 0;
  let maxActive = 0;
  const input = Array.from({ length: 17 }, (_, index) => index);
  const result = await mapWithConcurrency(input, 4, async (value, index, source) => {
    assert.equal(source, input);
    active++;
    maxActive = Math.max(maxActive, active);
    await new Promise(resolve => setTimeout(resolve, (index % 3) + 1));
    active--;
    return value * 10;
  });
  assert.equal(maxActive, 4, "The pool should use its configured concurrency when there is enough work.");
  assert.deepEqual(result, input.map(value => value * 10), "Results must preserve input order despite out-of-order completion.");
}
{
  assert.deepEqual(await mapWithConcurrency([], 4, async value => value), []);
  assert.deepEqual(await mapWithConcurrency([3, 2, 1], 99, value => value), [3, 2, 1],
    "Concurrency above the item count must be clamped safely.");
}
{
  const input = Array.from({ length: 12 }, (_, index) => index);
  const started = [];
  let active = 0;
  let maxActive = 0;
  await assert.rejects(
    mapWithConcurrency(input, 3, async value => {
      started.push(value);
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise(resolve => setTimeout(resolve, value === 1 ? 1 : 6));
      active--;
      if (value === 1) throw new Error("metadata read failed");
      return value;
    }),
    /metadata read failed/
  );
  assert.equal(maxActive, 3, "A failing task must not exceed the configured concurrency.");
  assert.deepEqual(started, [0, 1, 2], "A failure should stop the pool from scheduling more files.");
}
{
  assert.throws(() => mapWithConcurrency(null, 2, value => value), /lista de elementos/);
  assert.throws(() => mapWithConcurrency([1], 2, null), /función de transformación/);
}
console.log("Concurrent-map checks passed: bounded workers, input-order preservation, empty lists, argument validation and failure stop.");
