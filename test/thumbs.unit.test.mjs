import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { thumbCachePath, planThumbs } from "../scripts/thumbs.mjs";

test("cache path is content-addressed under .build/thumbs", () => {
  assert.equal(thumbCachePath("ai-fiscal/x", "abc"), ".build/thumbs/ai-fiscal/x/abc.png");
});

/** Lay out a fake _site (and optional prior gh-pages) tree from a list of relative paths. */
function fixture(paths) {
  const root = mkdtempSync(join(tmpdir(), "thumbs-plan-"));
  for (const rel of paths) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, "x");
  }
  return root;
}

const charts = [{ id: "col/one" }, { id: "col/two" }];
const hashes = new Map([["col/one", "h1"], ["col/two", "h2"]]);

test("a chart with no cached thumbnail for its hash is a miss", () => {
  const outDir = fixture(["col/one/index.html", "col/two/index.html"]);
  const { hits, misses, skipped } = planThumbs({ charts, hashById: hashes, outDir });
  assert.deepEqual(misses.map((m) => m.id), ["col/one", "col/two"]);
  assert.deepEqual(hits, []);
  assert.deepEqual(skipped, []);
});

test("a thumbnail already in the _site cache is a hit", () => {
  const outDir = fixture([
    "col/one/index.html",
    "col/two/index.html",
    ".build/thumbs/col/one/h1.png",
  ]);
  const { hits, misses } = planThumbs({ charts, hashById: hashes, outDir });
  assert.deepEqual(hits.map((h) => h.id), ["col/one"]);
  assert.deepEqual(misses.map((m) => m.id), ["col/two"]);
});

test("a thumbnail carried in the prior gh-pages cache is a hit, not a re-render", () => {
  const outDir = fixture(["col/one/index.html", "col/two/index.html"]);
  const ghPagesDir = fixture([".build/thumbs/col/two/h2.png"]);
  const { hits, misses } = planThumbs({ charts, hashById: hashes, ghPagesDir, outDir });
  assert.deepEqual(hits.map((h) => h.id), ["col/two"]);
  assert.deepEqual(misses.map((m) => m.id), ["col/one"]);
});

test("a stale cached hash does not satisfy a changed chart", () => {
  const outDir = fixture(["col/one/index.html", ".build/thumbs/col/one/h-old.png"]);
  const { hits, misses } = planThumbs({ charts: [{ id: "col/one" }], hashById: hashes, outDir });
  assert.deepEqual(hits, []);
  assert.deepEqual(misses.map((m) => m.id), ["col/one"]);
});

test("a chart with no assembled page is skipped, never screenshotted", () => {
  const outDir = fixture(["col/one/index.html"]);
  const { misses, skipped } = planThumbs({ charts, hashById: hashes, outDir });
  assert.deepEqual(skipped, ["col/two"]);
  assert.deepEqual(misses.map((m) => m.id), ["col/one"]);
});

test("a chart missing from the manifest is a miss, not a silent skip", () => {
  const outDir = fixture(["col/one/index.html"]);
  const { hits, misses } = planThumbs({
    charts: [{ id: "col/one" }],
    hashById: new Map(),
    outDir,
  });
  assert.deepEqual(hits, []);
  assert.deepEqual(misses.map((m) => m.id), ["col/one"]);
});
