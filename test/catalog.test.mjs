import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listCharts } from "../scripts/lib.mjs";
import { buildCatalog } from "../scripts/build-catalog.mjs";

test("buildCatalog sets hasData from the presence of data.csv", async () => {
  const root = mkdtempSync(join(tmpdir(), "catalog-test-"));
  try {
    const coll = join(root, "articles", "2026", "01", "demo");
    mkdirSync(join(coll, "a"), { recursive: true });
    mkdirSync(join(coll, "b"), { recursive: true });
    writeFileSync(
      join(coll, "article.yaml"),
      'title: "Demo"\nslug: demo\nurl: ""\ndate: "2026-01-01"\nfigures:\n  a: "Figure 1"\n  b: "Figure 2"\n',
    );
    writeFileSync(join(coll, "a", "chart.yaml"), 'title: "A"\ndata: data.csv\n');
    writeFileSync(join(coll, "b", "chart.yaml"), 'title: "B"\ndata: data.csv\n');
    writeFileSync(join(coll, "a", "data.csv"), "x,y\n1,2\n");

    const catalog = buildCatalog(await listCharts(root));
    const byId = Object.fromEntries(catalog.map((e) => [e.id, e]));
    assert.equal(byId["demo/a"].hasData, true);
    assert.equal(byId["demo/b"].hasData, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
