/**
 * validate-all.mjs — run `tbl-chart validate` on every chart in charts/.
 *
 * Exit 0 if all pass. Exit 1 if any fail.
 */

import { spawnSync } from "node:child_process";
import { listCharts, buildTblChartCmd } from "./lib.mjs";

const charts = await listCharts();

if (charts.length === 0) {
  console.error("No charts found under charts/");
  process.exit(1);
}

console.log(`Validating ${charts.length} chart(s)...\n`);

let allPassed = true;

for (const { specPath, id } of charts) {
  const { executable, args, options } = buildTblChartCmd(["validate", specPath]);
  const result = spawnSync(executable, args, {
    ...options,
    stdio: "pipe",
    encoding: "utf-8",
  });

  const passed = result.status === 0;
  const icon = passed ? "PASS" : "FAIL";
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
  console.log(`All ${charts.length} chart(s) validated successfully.`);
} else {
  console.error("One or more charts failed validation.");
  process.exit(1);
}
