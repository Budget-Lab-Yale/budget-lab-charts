import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyForPrune,
  classifyThumbCache,
  collectLiveHashes,
  parseOpenPrs,
  shouldSkipPrune,
} from "../scripts/prune.mjs";

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

// ── Thumbnail cache GC ────────────────────────────────────────────────────────

const thumb = (id, hash) => ({ id, hash, rel: `.build/thumbs/${id}/${hash}.png` });

test("thumb cache keeps the live hash and deletes superseded generations", () => {
  const r = classifyThumbCache({
    thumbs: [thumb("col-a/chart-1", "h-new"), thumb("col-a/chart-1", "h-old"),
             thumb("col-dead/old", "h-gone")],
    liveHashes: new Map([["col-a/chart-1", new Set(["h-new"])]]),
  });
  assert.deepEqual(r.keepThumbs.map((t) => t.hash), ["h-new"]);
  assert.deepEqual(r.deleteThumbs.map((t) => t.hash).sort(), ["h-gone", "h-old"]);
});

test("an open PR's hashes stay live so its merge is still a cache hit", () => {
  const liveHashes = collectLiveHashes({
    manifest: { charts: { "col-a/chart-1": { hash: "h-main" } } },
    openPrNumbers: [42, 7],
    readPreviewManifest: (pr) =>
      pr === 42 ? { charts: { "col-a/chart-1": { hash: "h-pr42" } } } : null,
  });
  const r = classifyThumbCache({
    thumbs: [thumb("col-a/chart-1", "h-main"), thumb("col-a/chart-1", "h-pr42"),
             thumb("col-a/chart-1", "h-stale")],
    liveHashes,
  });
  assert.deepEqual(r.keepThumbs.map((t) => t.hash).sort(), ["h-main", "h-pr42"]);
  assert.deepEqual(r.deleteThumbs.map((t) => t.hash), ["h-stale"]);
});

test("collectLiveHashes ignores entries without a hash", () => {
  const live = collectLiveHashes({
    manifest: { charts: { "col-a/chart-1": {}, "col-a/chart-2": { hash: "h" } } },
    openPrNumbers: [],
    readPreviewManifest: () => null,
  });
  assert.equal(live.has("col-a/chart-1"), false);
  assert.deepEqual([...live.get("col-a/chart-2")], ["h"]);
});
