import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyForPrune, parseOpenPrs, shouldSkipPrune } from "../scripts/prune.mjs";

const dir = (name) => ({ name, isDir: true });

test("keeps protected paths, prunes orphan chart + closed previews", () => {
  const r = classifyForPrune({
    entries: ["catalog", "embed", "fonts", "index.html", ".nojekyll", ".build",
              "col-a/chart-1", "col-a/chart-2", "col-dead/old", "pr-preview/pr-6", "pr-preview/pr-99"]
      .map(dir),
    manifestIds: ["col-a/chart-1", "col-a/chart-2"],
    openPrNumbers: [99],
  });
  assert.deepEqual(r.deleteChartDirs.sort(), ["col-dead/old"]);
  assert.deepEqual(r.deletePreviewDirs.sort(), ["pr-preview/pr-6"]);
  for (const p of ["catalog", "embed", "fonts", "index.html", ".nojekyll", ".build",
                   "col-a/chart-1", "col-a/chart-2", "pr-preview/pr-99"]) assert.ok(r.keep.includes(p));
});

test("never prunes the checkout's own .git metadata dir", () => {
  const r = classifyForPrune({
    entries: [".git", "col-a/chart-1"].map(dir),
    manifestIds: ["col-a/chart-1"],
    openPrNumbers: [],
  });
  assert.ok(r.keep.includes(".git"));
  assert.ok(!r.deleteChartDirs.includes(".git"));
});

test("unrecognized top-level file is kept, never pruned as a chart dir", () => {
  const r = classifyForPrune({
    entries: [{ name: "robots.txt", isDir: false }, { name: "col-a/chart-1", isDir: true }],
    manifestIds: ["col-a/chart-1"],
    openPrNumbers: [],
  });
  assert.ok(r.keep.includes("robots.txt"));
  assert.ok(!r.deleteChartDirs.includes("robots.txt"));
});

test("shouldSkipPrune guards against empty / missing manifest", () => {
  assert.equal(shouldSkipPrune(null), true);
  assert.equal(shouldSkipPrune({ charts: {} }), true);
  assert.equal(shouldSkipPrune({}), true);
  assert.equal(shouldSkipPrune({ charts: { "col-a/chart-1": { hash: "x" } } }), false);
});

test("parseOpenPrs drops empty/NaN tokens", () => {
  assert.deepEqual(parseOpenPrs(""), []);
  assert.deepEqual(parseOpenPrs("6, 99"), [6, 99]);
  assert.deepEqual(parseOpenPrs("6,,x,7"), [6, 7]);
});
