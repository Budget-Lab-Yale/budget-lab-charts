// scripts/pool.mjs
/** Run `worker` over `items` with at most `concurrency` in flight. Results keep input order. */
export async function runPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let next = 0;
  const n = Math.max(1, Math.min(concurrency | 0 || 1, items.length || 1));
  async function drain() {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, drain));
  return results;
}
