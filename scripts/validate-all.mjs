/**
 * validate-all.mjs — validate every chart in charts/.
 *
 * Four stages:
 *   1. Structural / identity checks (this repo's organization rules).
 *   2. `tbl-chart validate` on every chart.yaml (the engine's spec schema).
 *   3. catalog/index.json builds from every chart's spec.
 *   4. The vendored ENGINE-CONFIG-SPEC.md matches the pinned engine.
 *
 * Exit 0 if all pass. Exit 1 if any fail. Stage 1 fails fast before stage 2.
 *
 * Stage 2 is one `tbl-chart` process per chart and the cost is almost entirely Node startup, so
 * the spawns run through a bounded pool (VALIDATE_CONCURRENCY, default = cores capped at 4).
 * Output is buffered per chart and printed in listCharts() order, so the log stays deterministic
 * regardless of completion order.
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";
import { listCharts, buildTblChartCmd } from "./lib.mjs";
import { runPool } from "./pool.mjs";
import { buildCatalog, serializeCatalog } from "./build-catalog.mjs";
import { readEngineSemver } from "./incremental.mjs";
import {
  buildVendoredSpec,
  normalizeEol,
  readEngineSpec,
  VENDORED_SPEC_PATH,
} from "./vendor-spec.mjs";

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const COLLECTION_FILE_BY_KIND = { oneoff: "article.yaml", tracker: "tracker.yaml" };

const charts = await listCharts();

if (charts.length === 0) {
  console.error("No charts found under charts/");
  process.exit(1);
}

// --- Stage 1: structural / identity validation ---
console.log("Checking structure & identity...\n");

const structuralErrors = [];
const collectionSlugOwner = new Map(); // slug -> collectionDir (detects repo-wide collisions)
// collectionDir -> { figures, chartSlugs } so we can check the figures map against real folders.
const collectionFolders = new Map();

for (const { id, kind, chartSlug, collectionDir, collectionFile, collection } of charts) {
  // kind / tree
  if (kind === "unknown") {
    structuralErrors.push(`${id}: chart is not under charts/articles/ or charts/trackers/`);
    continue;
  }

  // collection file matches its tree, and the other class's file is absent (the kind guard)
  if (!existsSync(collectionFile)) {
    structuralErrors.push(`${id}: missing ${COLLECTION_FILE_BY_KIND[kind]} in ${collectionDir}`);
  }
  const wrongKind = kind === "tracker" ? "oneoff" : "tracker";
  const wrongFile = join(collectionDir, COLLECTION_FILE_BY_KIND[wrongKind]);
  if (existsSync(wrongFile)) {
    structuralErrors.push(
      `${id}: ${COLLECTION_FILE_BY_KIND[wrongKind]} found under a ${kind} tree — collection file must match its tree`
    );
  }

  // slugs / folder-name format
  if (!collection.slug) {
    structuralErrors.push(`${id}: collection file has no slug`);
  } else if (!SLUG_RE.test(collection.slug)) {
    structuralErrors.push(`${id}: collection slug "${collection.slug}" must be lowercase/ASCII/hyphenated`);
  }
  if (!SLUG_RE.test(chartSlug)) {
    structuralErrors.push(`${id}: chart folder name "${chartSlug}" must be lowercase/ASCII/hyphenated`);
  }

  // collection slug unique repo-wide (chart folders are unique within a collection by the filesystem)
  if (collection.slug) {
    const prior = collectionSlugOwner.get(collection.slug);
    if (prior && prior !== collectionDir) {
      structuralErrors.push(`collection slug "${collection.slug}" is used by two collections: ${prior} and ${collectionDir}`);
    } else {
      collectionSlugOwner.set(collection.slug, collectionDir);
    }
  }

  // accumulate chart folders + the (optional) figures map for the post-loop cross-check
  if (!collectionFolders.has(collectionDir)) {
    collectionFolders.set(collectionDir, { figures: collection.figures, chartSlugs: new Set() });
  }
  collectionFolders.get(collectionDir).chartSlugs.add(chartSlug);
}

// The optional `figures:` map (chart-folder slug -> eyebrow label) must reference real folders —
// a stale/typo'd key would silently fail to number its chart at render time.
for (const [collectionDir, { figures, chartSlugs }] of collectionFolders) {
  if (!figures || typeof figures !== "object") continue;
  for (const key of Object.keys(figures)) {
    if (!chartSlugs.has(key)) {
      structuralErrors.push(`${collectionDir}: figures key "${key}" matches no chart folder in this collection`);
    }
  }
}

if (structuralErrors.length > 0) {
  console.error("Structural validation failed:");
  for (const e of [...new Set(structuralErrors)]) console.error(`  - ${e}`);
  process.exit(1);
}
console.log("Structure & identity OK.\n");

// --- Stage 2: engine spec validation ---
console.log(`Validating ${charts.length} chart(s)...\n`);

const concurrency = Number(process.env.VALIDATE_CONCURRENCY) || Math.min(os.cpus().length, 4);

/** Run `tbl-chart validate <specPath>` and capture its exit status + streams. */
function validateSpec(specPath) {
  const { executable, args, options } = buildTblChartCmd(["validate", specPath]);
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf-8");
    child.stderr.setEncoding("utf-8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

const results = await runPool(charts, concurrency, ({ specPath }) => validateSpec(specPath));

let allPassed = true;

for (const [i, { id }] of charts.entries()) {
  const { status, stdout, stderr } = results[i];
  const passed = status === 0;
  console.log(`[${passed ? "PASS" : "FAIL"}] ${id}`);

  if (stdout.trim()) console.log(stdout.trimEnd());
  if (stderr.trim()) console.error(stderr.trimEnd());
  if (!passed) allPassed = false;
}

if (!allPassed) {
  console.log();
  console.error("One or more charts failed validation.");
  process.exit(1);
}

// --- Stage 3: the catalog builds ---
// catalog/index.json is a build artifact — CI regenerates it immediately before `npm run site`, so
// there is no committed copy to go stale and nothing here to compare against. (It was committed and
// byte-compared until Aug 2026; a contributor retitling a figure through the GitHub web UI then had
// no way to satisfy that gate.) What is still worth gating is that the catalog *constructs*:
// buildCatalog reads every spec and collection file, so a chart.yaml or article.yaml that passes the
// engine's schema but breaks catalog assembly fails the merge gate rather than the deploy.
console.log();
console.log("Building catalog/index.json in memory...\n");

let catalogError = null;
try {
  const catalog = buildCatalog(charts);
  if (catalog.length !== charts.length) {
    catalogError = `Catalog built ${catalog.length} entries for ${charts.length} chart(s).`;
  }
  // Serialize as well, because JSON.stringify is where the artifact actually fails: a
  // self-referential YAML anchor in a collection file (`title: &a { self: *a }`) is parsed into a
  // circular object that survives buildCatalog untouched and throws only here. Building without
  // serializing would pass the merge gate and then break `npm run catalog` in both CI build jobs.
  serializeCatalog(catalog);
} catch (err) {
  catalogError = `catalog/index.json failed to build: ${err.message}`;
}

if (catalogError) {
  console.error(catalogError);
  process.exit(1);
}
console.log(`Catalog builds cleanly (${charts.length} entries).\n`);

// --- Stage 4: vendored engine spec is current ---
// The figure schema is documented by a verbatim copy of the pinned engine's CONFIG-SPEC.md so an
// author never has to open the engine repo. The previous hand-maintained copy drifted 45 fields
// behind over eight repins, which is why this is a gate rather than a checklist item.
console.log("Checking vendored ENGINE-CONFIG-SPEC.md...\n");

const engineSemver = readEngineSemver();
let vendorError = null;
try {
  const expectedSpec = normalizeEol(
    buildVendoredSpec({ specText: readEngineSpec(), version: engineSemver }),
  );
  const committedSpec = existsSync(VENDORED_SPEC_PATH)
    ? normalizeEol(readFileSync(VENDORED_SPEC_PATH, "utf-8"))
    : null;

  if (committedSpec === null) {
    vendorError = "ENGINE-CONFIG-SPEC.md is missing — run `npm run vendor-spec` and commit it.";
  } else if (committedSpec !== expectedSpec) {
    vendorError =
      `ENGINE-CONFIG-SPEC.md does not match the pinned engine (v${engineSemver}) — ` +
      "run `npm run vendor-spec` and commit the result.";
  }
} catch (err) {
  vendorError = err.message;
}

if (vendorError) {
  console.error(vendorError);
  process.exit(1);
}
console.log(`Vendored spec matches engine v${engineSemver}.\n`);

console.log(`All ${charts.length} chart(s) validated successfully.`);
