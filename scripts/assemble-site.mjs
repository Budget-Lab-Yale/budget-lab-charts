/**
 * assemble-site.mjs — assemble the publishable site into _site/.
 *
 * Layout produced (served at the Pages root):
 *   _site/index.html                  # the landing page (from site/)
 *   _site/catalog/index.json          # the figure catalog
 *   _site/<collection>/<chart>/index.html  # each chart's live page (from dist/)
 *   _site/<collection>/<chart>/data.csv
 *   _site/<collection>/<chart>/baseline.png  # thumbnail (from the chart's baseline)
 *
 * Run AFTER `npm run build` and `npm run catalog`. The landing page fetches
 * ./catalog/index.json at runtime and links to ./<id>/ pages + ./<id>/baseline.png thumbs.
 */

import { cp, mkdir, rm, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { listCharts, REPO_ROOT } from "./lib.mjs";

const DIST = join(REPO_ROOT, "dist");
const CATALOG = join(REPO_ROOT, "catalog", "index.json");
const SITE_SRC = join(REPO_ROOT, "site");
const OUT = join(REPO_ROOT, "_site");

if (!existsSync(DIST)) {
  console.error("dist/ not found — run `npm run build` first.");
  process.exit(1);
}
if (!existsSync(CATALOG)) {
  console.error("catalog/index.json not found — run `npm run catalog` first.");
  process.exit(1);
}

console.log("Assembling _site/ ...\n");

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

// 1. Chart pages + data (dist/<id>/...) -> _site/<id>/...
await cp(DIST, OUT, { recursive: true });
console.log("  + chart pages (from dist/)");

// 2. Catalog -> _site/catalog/index.json
await mkdir(join(OUT, "catalog"), { recursive: true });
await cp(CATALOG, join(OUT, "catalog", "index.json"));
console.log("  + catalog/index.json");

// 3. Baseline thumbnails -> _site/<id>/baseline.png
const charts = await listCharts();
let thumbs = 0;
for (const { dir, id } of charts) {
  const baseline = join(dir, "baseline.png");
  if (existsSync(baseline)) {
    await cp(baseline, join(OUT, id, "baseline.png"));
    thumbs++;
  } else {
    console.warn(`  ! no baseline.png for ${id} — card will show a blank thumbnail`);
  }
}
console.log(`  + ${thumbs} baseline thumbnail(s)`);

// 4. Landing page + any other static assets in site/ -> _site/
for (const entry of await readdir(SITE_SRC, { withFileTypes: true })) {
  await cp(join(SITE_SRC, entry.name), join(OUT, entry.name), { recursive: true });
}
console.log("  + landing page (from site/)");

console.log(`\nDone. Serve _site/ to preview (e.g. \`npx http-server _site\` or \`python -m http.server -d _site\`).`);
