/**
 * Map an array with a bounded number of asynchronous tasks while preserving
 * input order. On the first rejection, no new work is started; already-running
 * tasks are allowed to settle before the error is rethrown.
 */
export async function mapWithConcurrency(items, concurrency = 1, mapper) {
  if (!Array.isArray(items)) throw new TypeError("Se esperaba una lista de elementos.");
  if (typeof mapper !== "function") throw new TypeError("Se esperaba una función de transformación.");
  if (items.length === 0) return [];

  const requested = Number(concurrency);
  const limit = Math.min(items.length, Number.isFinite(requested) ? Math.max(1, Math.floor(requested)) : 1);
  const results = new Array(items.length);
  let nextIndex = 0;
  let failed = false;
  let firstError;

  async function worker() {
    while (!failed) {
      const index = nextIndex++;
      if (index >= items.length) return;
      try {
        results[index] = await mapper(items[index], index, items);
      } catch (error) {
        if (!failed) {
          failed = true;
          firstError = error;
        }
        return;
      }
    }
  }

  await Promise.all(Array.from({ length: limit }, () => worker()));
  if (failed) throw firstError;
  return results;
}
