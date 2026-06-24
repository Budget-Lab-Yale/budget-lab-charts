/**
 * lib.mjs — shared utilities for the budget-lab-charts pipeline scripts.
 *
 * Walks the charts/ directory tree and returns metadata for every chart.yaml found.
 */

import { readdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join, relative, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const CHARTS_ROOT = join(REPO_ROOT, "charts");

// Top-level tree under charts/ -> figure class. The tree is the single source of
// truth for `kind`; validate-all.mjs asserts the collection file matches it.
const KIND_BY_TREE = { articles: "oneoff", trackers: "tracker" };
const COLLECTION_FILE_BY_KIND = { oneoff: "article.yaml", tracker: "tracker.yaml" };

/**
 * Recursively walk a directory, calling `fn` on every entry.
 * @param {string} dir
 * @param {(entry: import("node:fs").Dirent, fullPath: string) => void} fn
 */
async function walk(dir, fn) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    fn(entry, fullPath);
    if (entry.isDirectory()) {
      await walk(fullPath, fn);
    }
  }
}

/**
 * Returns metadata for every chart.yaml found under charts/.
 *
 * Identity is composed as `<collection.slug>/<chart-folder-name>` — dateless and
 * tree-independent. The collection slug is read from the collection file
 * (article.yaml under articles/, tracker.yaml under trackers/); the chart segment
 * is the chart's leaf folder name.
 *
 * @param {string} [chartsRoot] - Optional override; defaults to <repo-root>/charts
 * @returns {Promise<Array<{dir: string, specPath: string, id: string, kind: string,
 *   chartSlug: string, collectionDir: string, collectionFile: string, collection: object}>>}
 */
export async function listCharts(chartsRoot = CHARTS_ROOT) {
  const results = [];

  await walk(chartsRoot, (entry, fullPath) => {
    if (entry.isFile() && entry.name === "chart.yaml") {
      const dir = dirname(fullPath);
      const tree = relative(chartsRoot, dir).replace(/\\/g, "/").split("/")[0];
      const kind = KIND_BY_TREE[tree] ?? "unknown";

      const chartSlug = basename(dir);
      const collectionDir = dirname(dir);
      const collectionFile = join(collectionDir, COLLECTION_FILE_BY_KIND[kind] ?? "article.yaml");

      let collection = {};
      try {
        collection = parseYaml(readFileSync(collectionFile, "utf-8")) ?? {};
      } catch {
        // Collection file missing/unreadable — validate-all.mjs reports this; fall back to folder name.
      }

      const collectionSlug = collection.slug ?? basename(collectionDir);
      const id = `${collectionSlug}/${chartSlug}`;

      results.push({ dir, specPath: fullPath, id, kind, chartSlug, collectionDir, collectionFile, collection });
    }
  });

  // Sort by id for deterministic ordering
  results.sort((a, b) => a.id.localeCompare(b.id));
  return results;
}

/**
 * Returns spawn configuration for the tbl-chart CLI.
 *
 * On Windows, .cmd wrappers cannot be spawned directly by Node's child_process without
 * shell:true (which triggers a DEP0190 security warning when args are passed). The correct
 * approach is to invoke cmd.exe /c explicitly, passing the .cmd path and args as separate
 * tokens so Node never needs to shell-escape them.
 *
 * @param {string[]} cliArgs - Arguments to pass after the command name
 * @param {string} [repoRoot] - Optional override
 * @returns {{ executable: string, args: string[], options: object }}
 */
export function buildTblChartCmd(cliArgs, repoRoot = REPO_ROOT) {
  const isWindows = process.platform === "win32";
  if (isWindows) {
    const cmdPath = join(repoRoot, "node_modules", ".bin", "tbl-chart.cmd");
    return {
      executable: "cmd.exe",
      args: ["/c", cmdPath, ...cliArgs],
      options: { shell: false },
    };
  } else {
    return {
      executable: join(repoRoot, "node_modules", ".bin", "tbl-chart"),
      args: cliArgs,
      options: { shell: false },
    };
  }
}

/**
 * @deprecated Use buildTblChartCmd() instead.
 */
export function getTblChartSpawn(repoRoot = REPO_ROOT) {
  const isWindows = process.platform === "win32";
  const binName = isWindows ? "tbl-chart.cmd" : "tbl-chart";
  return {
    bin: join(repoRoot, "node_modules", ".bin", binName),
    shell: isWindows,
  };
}

/**
 * @deprecated Use buildTblChartCmd() instead.
 */
export function getTblChartBin(repoRoot = REPO_ROOT) {
  return getTblChartSpawn(repoRoot).bin;
}

export { REPO_ROOT, CHARTS_ROOT };
