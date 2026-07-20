// test/pool.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { runPool } from "../scripts/pool.mjs";

test("preserves input order regardless of completion order", async () => {
  const out = await runPool([30, 10, 20], 3, async (ms, i) => {
    await new Promise((r) => setTimeout(r, ms));
    return i;
  });
  assert.deepEqual(out, [0, 1, 2]);
});

test("never exceeds the concurrency cap", async () => {
  let active = 0, peak = 0;
  await runPool([...Array(20).keys()], 4, async () => {
    active++; peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 5));
    active--;
  });
  assert.ok(peak <= 4, `peak ${peak} exceeded 4`);
});

test("rejects if a worker throws", async () => {
  await assert.rejects(
    runPool([1, 2, 3], 2, async (n) => { if (n === 2) throw new Error("boom"); }),
    /boom/,
  );
});
