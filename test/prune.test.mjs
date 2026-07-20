import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyForPrune } from "../scripts/prune.mjs";

test("keeps protected paths, prunes orphan chart + closed previews", () => {
  const r = classifyForPrune({
    entries: ["catalog", "embed", "fonts", "index.html", ".nojekyll", ".build",
              "col-a/chart-1", "col-a/chart-2", "col-dead/old", "pr-preview/pr-6", "pr-preview/pr-99"],
    manifestIds: ["col-a/chart-1", "col-a/chart-2"],
    openPrNumbers: [99],
  });
  assert.deepEqual(r.deleteChartDirs.sort(), ["col-dead/old"]);
  assert.deepEqual(r.deletePreviewDirs.sort(), ["pr-preview/pr-6"]);
  for (const p of ["catalog", "embed", "fonts", "index.html", ".nojekyll", ".build",
                   "col-a/chart-1", "col-a/chart-2", "pr-preview/pr-99"]) assert.ok(r.keep.includes(p));
});
