import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyEngineAssets,
  classifyForPrune,
  classifyThumbCache,
  collectLiveHashes,
  parseKeepEngine,
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

// ── Shared engine assets ──────────────────────────────────────────────────────

const asset = (name) => ({
  name,
  version: (name.match(/^engine-(.+)\.js$/) ?? name.match(/^chart-(.+)\.css$/))[1],
  rel: `embed/v1/${name}`,
});

test("keeps the live engine versions and deletes superseded ones", () => {
  const r = classifyEngineAssets({
    assets: ["engine-1.10.0.js", "chart-1.10.0.css", "engine-1.9.0.js", "chart-1.9.0.css",
             "engine-1.8.1.js", "chart-1.8.1.css"].map(asset),
    // Current deploy plus the version it replaced, which cached page HTML still asks for.
    liveVersions: new Set(["1.10.0", "1.9.0"]),
  });
  assert.deepEqual(r.deleteAssets.map((a) => a.name).sort(), ["chart-1.8.1.css", "engine-1.8.1.js"]);
  assert.equal(r.keepAssets.length, 4);
});

test("prerelease-style versions round-trip through the filename", () => {
  const r = classifyEngineAssets({
    assets: [asset("engine-2.0.0-rc.1.js")],
    liveVersions: new Set(["2.0.0-rc.1"]),
  });
  assert.deepEqual(r.deleteAssets, []);
  assert.equal(r.keepAssets[0].version, "2.0.0-rc.1");
});

test("parseKeepEngine drops empty tokens", () => {
  assert.deepEqual(parseKeepEngine("1.9.0, 1.8.1 ,"), ["1.9.0", "1.8.1"]);
  assert.deepEqual(parseKeepEngine(""), []);
  assert.deepEqual(parseKeepEngine(undefined), []);
});
