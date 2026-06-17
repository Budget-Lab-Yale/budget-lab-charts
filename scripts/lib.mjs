/**
 * lib.mjs — shared utilities for the budget-lab-charts pipeline scripts.
 *
 * Walks the charts/ directory tree and returns metadata for every chart.yaml found.
 */

import { readdir, stat } from "node:fs/promises";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const CHARTS_ROOT = join(REPO_ROOT, "charts");

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
 * @param {string} [chartsRoot] - Optional override; defaults to <repo-root>/charts
 * @returns {Promise<Array<{dir: string, specPath: string, id: string, articleDir: string}>>}
 */
export async function listCharts(chartsRoot = CHARTS_ROOT) {
  const results = [];

  await walk(chartsRoot, (entry, fullPath) => {
    if (entry.isFile() && entry.name === "chart.yaml") {
      const dir = dirname(fullPath);
      const id = relative(chartsRoot, dir).replace(/\\/g, "/");
      // articleDir is the parent of the chart folder (holds article.yaml)
      const articleDir = dirname(dir);
      results.push({ dir, specPath: fullPath, id, articleDir });
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
