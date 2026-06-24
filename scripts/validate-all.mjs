/**
 * validate-all.mjs — validate every chart in charts/.
 *
 * Two stages:
 *   1. Structural / identity checks (this repo's organization rules).
 *   2. `tbl-chart validate` on every chart.yaml (the engine's spec schema).
 *
 * Exit 0 if all pass. Exit 1 if any fail. Stage 1 fails fast before stage 2.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { listCharts, buildTblChartCmd } from "./lib.mjs";

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
