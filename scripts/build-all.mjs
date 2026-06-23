/**
 * build-all.mjs — render every chart to dist/<id>/index.html and copy data.csv.
 *
 * Output: dist/<collection>/<chart>/index.html
 *         dist/<collection>/<chart>/data.csv
 * (<id> = <collection.slug>/<chart-folder-name>; dateless and tree-independent.)
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, copyFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { listCharts, buildTblChartCmd, REPO_ROOT } from "./lib.mjs";

const charts = await listCharts();

if (charts.length === 0) {
  console.error("No charts found under charts/");
  process.exit(1);
}

// Clean dist/ first so renamed/removed charts don't leave stale outputs behind
// (the site deploy assembles from dist/, so stale dirs would otherwise be published).
rmSync(join(REPO_ROOT, "dist"), { recursive: true, force: true });

console.log(`Building ${charts.length} chart(s)...\n`);

let allPassed = true;

for (const { dir, specPath, id } of charts) {
  const outDir = join(REPO_ROOT, "dist", id);
  const outFile = join(outDir, "index.html");

  mkdirSync(outDir, { recursive: true });

  const { executable, args, options } = buildTblChartCmd(["render", specPath, "-o", outFile]);
  const result = spawnSync(executable, args, {
    ...options,
    stdio: "pipe",
    encoding: "utf-8",
  });

  const passed = result.status === 0;
  const icon = passed ? "BUILT" : "FAIL";
  console.log(`[${icon}] ${id} -> dist/${id}/index.html`);

  if (result.stdout?.trim()) {
    console.log(result.stdout.trimEnd());
  }
  if (result.stderr?.trim()) {
    console.error(result.stderr.trimEnd());
  }

  if (passed) {
    // Copy data.csv alongside the HTML
    const srcData = join(dir, "data.csv");
    const dstData = join(outDir, "data.csv");
    try {
      copyFileSync(srcData, dstData);
    } catch {
      // data.csv is optional for some chart types
    }
  } else {
    allPassed = false;
  }
}

console.log();
if (allPassed) {
  console.log(`All ${charts.length} chart(s) built successfully.`);
} else {
  console.error("One or more charts failed to build.");
  process.exit(1);
}
