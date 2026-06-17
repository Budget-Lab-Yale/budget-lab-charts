/**
 * build-catalog.mjs — generate catalog/index.json from all charts in charts/.
 *
 * Each entry: { id, title, eyebrow, article, date, path, dataPath, engineVersion, tags }
 *
 * Writes catalog/index.json (committed to the repo).
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, relative } from "node:path";
import { parse as parseYaml } from "yaml";
import { listCharts, REPO_ROOT } from "./lib.mjs";

function readYaml(filePath) {
  const text = readFileSync(filePath, "utf-8");
  return parseYaml(text);
}

const charts = await listCharts();

if (charts.length === 0) {
  console.error("No charts found under charts/");
  process.exit(1);
}

console.log(`Building catalog for ${charts.length} chart(s)...\n`);

const catalog = [];

for (const { dir, specPath, id, articleDir } of charts) {
  const spec = readYaml(specPath);

  // Load article.yaml for date/engineVersion/article title
  let article = {};
  try {
    article = readYaml(join(articleDir, "article.yaml"));
  } catch {
    // article.yaml missing — use defaults
  }

  const engineVersion = spec.engineVersion ?? article.engineVersion ?? "unknown";
  const relPath = relative(REPO_ROOT, specPath).replace(/\\/g, "/");
  const dataPath = relative(REPO_ROOT, join(dir, "data.csv")).replace(/\\/g, "/");

  catalog.push({
    id,
    title: spec.title ?? "",
    eyebrow: spec.eyebrow ?? "",
    article: article.title ?? "",
    date: article.date ?? "",
    path: relPath,
    dataPath,
    engineVersion,
    tags: spec.tags ?? [],
  });

  console.log(`  + ${id}`);
}

const outDir = join(REPO_ROOT, "catalog");
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, "index.json");
writeFileSync(outFile, JSON.stringify(catalog, null, 2) + "\n", "utf-8");

console.log(`\nWrote catalog/index.json with ${catalog.length} chart(s).`);
