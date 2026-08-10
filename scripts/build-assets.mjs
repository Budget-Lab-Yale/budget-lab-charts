/**
 * build-assets.mjs — write the engine's shared runtime + stylesheet into _site/embed/v1/.
 *
 * Every chart page links `../../embed/v1/engine-<version>.js` and `chart-<version>.css` rather than
 * inlining ~1.65 MB of identical bytes, so these two files are what make the built site work.
 *
 * Run AFTER `npm run site` (which creates _site/ and copies embed/) and BEFORE `npm run thumbs`
 * (which loads the assembled pages over file:// and cannot screenshot a chart whose runtime is
 * absent). `npm run all` does this in order.
 *
 * Filenames carry the engine version, so publishing a new engine never overwrites the assets an
 * already-published page asks for. prune.mjs decides when an old version stops being needed.
 */

import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { listCharts, buildTblChartCmd, REPO_ROOT } from "./lib.mjs";
import { readEngineSemver } from "./incremental.mjs";

const OUT = join(REPO_ROOT, "_site");
const ASSET_DIR = join(OUT, "embed", "v1");

if (!existsSync(OUT)) {
  console.error("_site/ not found — run `npm run site` first.");
  process.exit(1);
}

mkdirSync(ASSET_DIR, { recursive: true });

const { executable, args, options } = buildTblChartCmd(["assets", "-o", ASSET_DIR, "--json"]);
const result = spawnSync(executable, args, { ...options, stdio: "pipe", encoding: "utf-8" });

if (result.status !== 0) {
  console.error("tbl-chart assets failed:");
  if (result.stdout?.trim()) console.error(result.stdout.trimEnd());
  if (result.stderr?.trim()) console.error(result.stderr.trimEnd());
  process.exit(1);
}

let manifest;
try {
  manifest = JSON.parse(result.stdout);
} catch {
  console.error(`could not parse tbl-chart assets output as JSON:\n${result.stdout}`);
  process.exit(1);
}

// The pages were rendered against the engine version in node_modules; the assets must be that same
// version or every page links a file that does not exist. Cheap check, catastrophic failure mode.
const expected = readEngineSemver();
if (manifest.version !== expected) {
  console.error(
    `engine version mismatch: pages were built against ${expected} but assets report ` +
      `${manifest.version}. Re-run \`npm run build\` after changing the pinned engine.`,
  );
  process.exit(1);
}

const charts = await listCharts();
console.log(`Wrote shared assets for engine ${manifest.version} to _site/embed/v1/:\n`);
console.log(`  + ${manifest.runtime}`);
console.log(`  + ${manifest.styles}`);
console.log(`\n${charts.length} chart page(s) link these instead of inlining the engine.`);
