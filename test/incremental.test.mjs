// test/incremental.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { hashChart, computeRenderVersion, diffCharts } from "../scripts/incremental.mjs";

test("hash is stable and input-sensitive", () => {
  const rv = computeRenderVersion({ engineRef: "e1", thumbsEpoch: 1, fontsEpoch: 1 });
  const a = hashChart({ specBytes: "spec", dataBytes: "1,2", renderVersion: rv });
  assert.equal(a, hashChart({ specBytes: "spec", dataBytes: "1,2", renderVersion: rv }));
  assert.notEqual(a, hashChart({ specBytes: "spec!", dataBytes: "1,2", renderVersion: rv }));
  assert.notEqual(a, hashChart({ specBytes: "spec", dataBytes: "1,3", renderVersion: rv }));
});

test("renderVersion bump invalidates the hash", () => {
  const base = { specBytes: "s", dataBytes: "d" };
  const h1 = hashChart({ ...base, renderVersion: computeRenderVersion({ engineRef: "e1", thumbsEpoch: 1, fontsEpoch: 1 }) });
  const h2 = hashChart({ ...base, renderVersion: computeRenderVersion({ engineRef: "e2", thumbsEpoch: 1, fontsEpoch: 1 }) });
  assert.notEqual(h1, h2);
});

test("diffCharts partitions new/changed/unchanged/removed", () => {
  const prior = { renderVersion: "rv1", charts: { a: { hash: "x" }, gone: { hash: "z" } } };
  const cur = { a: "x", b: "y" }; // a unchanged, b new, gone removed
  const d = diffCharts(cur, prior);
  assert.deepEqual(d.toBuild.sort(), ["b"]);
  assert.deepEqual(d.unchanged.sort(), ["a"]);
  assert.deepEqual(d.removed.sort(), ["gone"]);
});

test("renderVersion mismatch forces full rebuild", () => {
  const prior = { renderVersion: "OLD", charts: { a: { hash: "x" } } };
  const d = diffCharts({ a: "x" }, prior, "NEW");
  assert.deepEqual(d.toBuild, ["a"]);
  assert.deepEqual(d.unchanged, []);
});
