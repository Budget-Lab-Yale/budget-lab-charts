/**
 * snapshot-all.mjs — run `tbl-chart snapshot` on every chart vs its committed baseline.
 *
 * Usage:
 *   node scripts/snapshot-all.mjs           # compare against baselines; fail on mismatch
 *   node scripts/snapshot-all.mjs --update  # regenerate baselines in-place
 *
 * Baselines live next to each chart.yaml as baseline.png, tracked via Git LFS.
 *
 * NOTE: Snapshots are platform-specific (font rendering / anti-aliasing differs by OS).
 * Baselines must be regenerated in the canonical CI/launch environment before the snapshot
 * gate is authoritative. Run --update on that machine and commit the results.
 */

import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { listCharts, buildTblChartCmd } from "./lib.mjs";

const update = process.argv.includes("--update");
const charts = await listCharts();

if (charts.length === 0) {
  console.error("No charts found under charts/");
  process.exit(1);
}

const mode = update ? "Updating" : "Comparing";
console.log(`${mode} snapshots for ${charts.length} chart(s)...\n`);

let allPassed = true;

for (const { dir, specPath, id } of charts) {
  const baselinePath = join(dir, "baseline.png");
  const cliArgs = ["snapshot", specPath, "--baseline", baselinePath];
  if (update) {
    cliArgs.push("--update");
  }

  const { executable, args, options } = buildTblChartCmd(cliArgs);
  const result = spawnSync(executable, args, {
    ...options,
    stdio: "pipe",
    encoding: "utf-8",
  });

  const passed = result.status === 0;
  const icon = update ? (passed ? "UPDATED" : "FAIL") : (passed ? "PASS" : "FAIL");
  console.log(`[${icon}] ${id}`);

  if (result.stdout?.trim()) {
    console.log(result.stdout.trimEnd());
  }
  if (result.stderr?.trim()) {
    console.error(result.stderr.trimEnd());
  }

  if (!passed) {
    allPassed = false;
  }
}

console.log();
if (allPassed) {
  if (update) {
    console.log(`All ${charts.length} baseline(s) updated. Commit the new baseline.png files.`);
  } else {
    console.log(`All ${charts.length} chart(s) match their baselines.`);
  }
} else {
  if (update) {
    console.error("One or more snapshots failed to update.");
  } else {
    console.error("One or more charts differ from their baselines. Run with --update to regenerate.");
  }
  process.exit(1);
}
