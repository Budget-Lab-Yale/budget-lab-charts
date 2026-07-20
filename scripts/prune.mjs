/**
 * prune.mjs — manifest-driven pruning of stale content from a gh-pages checkout.
 *
 * The gh-pages branch accumulates published chart dirs, PR preview dirs, and the `.build/`
 * incremental-build cache (manifest + content-addressed thumbnails). Over time, collections get
 * renamed/removed and PRs get closed, leaving orphaned directories behind. This script deletes
 * only what the current production manifest + open-PR list say are no longer live, behind a
 * protected-path whitelist so build state, embed framework, and site chrome are never touched.
 *
 * Usage (run against a gh-pages checkout, e.g. from CI):
 *   GH_PAGES_DIR=.gh-pages node scripts/prune.mjs --open-prs "6,42,99"
 */

import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { readManifest } from "./incremental.mjs";

/** Top-level paths that are never candidates for deletion. `pr-preview` itself is protected —
 * only its `pr-<n>` children are ever pruned. */
const PROTECTED = new Set([
  "catalog",
  "embed",
  "fonts",
  "index.html",
  "CNAME",
  ".nojekyll",
  ".build",
  "pr-preview",
]);

/**
 * Pure classifier over a flat list of gh-pages entries (built by `main()`'s 2-level walk).
 *
 * `entries` mixes: protected top-level names (kept as-is), whole-collection dirs that no longer
 * have any surviving chart (single segment, e.g. "col-dead"), individual `<collection>/<chart>`
 * dirs (two segments), and `pr-preview/pr-<n>` preview dirs.
 *
 * @param {{ entries: string[], manifestIds: string[], openPrNumbers: number[] }} args
 * @returns {{ deleteChartDirs: string[], deletePreviewDirs: string[], keep: string[] }}
 */
export function classifyForPrune({ entries, manifestIds, openPrNumbers }) {
  const manifestSet = new Set(manifestIds);
  const openSet = new Set(openPrNumbers.map(String));

  const deleteChartDirs = [];
  const deletePreviewDirs = [];
  const keep = [];

  for (const entry of entries) {
    if (PROTECTED.has(entry)) {
      keep.push(entry);
      continue;
    }

    if (entry.startsWith("pr-preview/")) {
      const m = entry.match(/^pr-preview\/pr-(\d+)$/);
      if (m && !openSet.has(m[1])) {
        deletePreviewDirs.push(entry);
      } else {
        keep.push(entry);
      }
      continue;
    }

    const segments = entry.split("/");
    if (segments.length >= 2) {
      // A specific <collection>/<chart> dir.
      if (manifestSet.has(entry)) {
        keep.push(entry);
      } else {
        deleteChartDirs.push(entry);
      }
    } else {
      // A whole collection dir presented undescended — delete only if none of its charts survive.
      const prefix = `${entry}/`;
      const hasSurvivor = manifestIds.some((id) => id.startsWith(prefix));
      if (hasSurvivor) {
        keep.push(entry);
      } else {
        deleteChartDirs.push(entry);
      }
    }
  }

  return { deleteChartDirs, deletePreviewDirs, keep };
}

/** Parse `--open-prs "6,42,99"` from argv into an array of numbers (empty if absent/blank). */
function parseOpenPrs(argv) {
  const idx = argv.indexOf("--open-prs");
  if (idx === -1 || idx + 1 >= argv.length) return [];
  return argv[idx + 1]
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n));
}

/** Walk `ghPagesDir` two levels deep, producing the flat `entries` list `classifyForPrune` expects. */
function buildEntries(ghPagesDir, manifestIds) {
  const entries = [];

  for (const top of readdirSync(ghPagesDir, { withFileTypes: true })) {
    const name = top.name;
    if (PROTECTED.has(name) || !top.isDirectory()) {
      entries.push(name);
      continue;
    }
    // A collection dir descends to per-chart entries only if it still has a survivor; otherwise
    // it's left as one segment so classifyForPrune prunes the whole dir in one shot.
    const hasSurvivor = manifestIds.some((id) => id.startsWith(`${name}/`));
    if (!hasSurvivor) {
      entries.push(name);
      continue;
    }
    for (const child of readdirSync(join(ghPagesDir, name), { withFileTypes: true })) {
      if (child.isDirectory()) entries.push(`${name}/${child.name}`);
    }
  }

  const prPreviewDir = join(ghPagesDir, "pr-preview");
  if (existsSync(prPreviewDir)) {
    for (const child of readdirSync(prPreviewDir, { withFileTypes: true })) {
      if (child.isDirectory()) entries.push(`pr-preview/${child.name}`);
    }
  }

  return entries;
}

async function main() {
  const ghPagesDir = process.env.GH_PAGES_DIR;
  if (!ghPagesDir || !existsSync(ghPagesDir)) {
    console.error("GH_PAGES_DIR not set or missing — nothing to prune.");
    process.exit(1);
  }

  const manifest = readManifest(join(ghPagesDir, ".build", "manifest.json"));
  const manifestIds = Object.keys(manifest?.charts ?? {});
  const openPrNumbers = parseOpenPrs(process.argv.slice(2));

  const entries = buildEntries(ghPagesDir, manifestIds);
  const { deleteChartDirs, deletePreviewDirs, keep } = classifyForPrune({
    entries,
    manifestIds,
    openPrNumbers,
  });

  for (const dir of [...deleteChartDirs, ...deletePreviewDirs]) {
    rmSync(join(ghPagesDir, dir), { recursive: true, force: true });
    console.log(`  - ${dir}`);
  }

  console.log();
  console.log(
    `prune: deleted ${deleteChartDirs.length} chart dir(s), ${deletePreviewDirs.length} preview dir(s); kept ${keep.length}`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
