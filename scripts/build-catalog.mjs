/**
 * build-catalog.mjs — generate catalog/index.json from all charts in charts/.
 *
 * Each entry: { id, kind, collection, collectionTitle, title, eyebrow, date, created,
 *               path, dataPath, tags }
 * `id` is the composed <collection.slug>/<chart-folder-name>; `path`/`dataPath` are the
 * (mutable) on-disk locations. Consumers key on `id`.
 *
 * Writes catalog/index.json (committed to the repo — it is the file that ships, so `npm run
 * validate` asserts the committed copy matches what this script would produce). `buildCatalog`
 * and `serializeCatalog` are exported so validate can make that comparison in memory without
 * writing anything.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { parse as parseYaml } from "yaml";
import { listCharts, REPO_ROOT } from "./lib.mjs";

export const CATALOG_PATH = join(REPO_ROOT, "catalog", "index.json");

function readYaml(filePath) {
  const text = readFileSync(filePath, "utf-8");
  return parseYaml(text);
}

/** Build the catalog array from an already-listed set of charts. Pure apart from reading specs. */
export function buildCatalog(charts, { onEntry } = {}) {
  const catalog = [];

  for (const { dir, specPath, id, kind, chartSlug, collection } of charts) {
    const spec = readYaml(specPath);

    const relPath = relative(REPO_ROOT, specPath).replace(/\\/g, "/");
    const dataPath = relative(REPO_ROOT, join(dir, "data.csv")).replace(/\\/g, "/");

    catalog.push({
      id,
      kind,
      collection: collection.slug ?? "",
      collectionTitle: collection.title ?? "",
      title: spec.title ?? "",
      // Eyebrow (figure number) lives in the collection file's figures map, keyed by chart slug.
      eyebrow: collection.figures?.[chartSlug] ?? "",
      // Publication date is identity-bearing only for one-offs; trackers carry an
      // immutable `created` date instead (and are versioned in place via git).
      date: kind === "oneoff" ? (collection.date ?? "") : "",
      created: kind === "tracker" ? (collection.created ?? "") : "",
      cadence: kind === "tracker" ? (collection.cadence ?? "") : "",
      path: relPath,
      dataPath,
      tags: spec.tags ?? [],
    });

    onEntry?.(id);
  }

  return catalog;
}

/** The exact on-disk form of catalog/index.json. Byte-identical output is what validate compares. */
export function serializeCatalog(catalog) {
  return JSON.stringify(catalog, null, 2) + "\n";
}

async function main() {
  const charts = await listCharts();

  if (charts.length === 0) {
    console.error("No charts found under charts/");
    process.exit(1);
  }

  console.log(`Building catalog for ${charts.length} chart(s)...\n`);

  const catalog = buildCatalog(charts, { onEntry: (id) => console.log(`  + ${id}`) });

  mkdirSync(join(REPO_ROOT, "catalog"), { recursive: true });
  writeFileSync(CATALOG_PATH, serializeCatalog(catalog), "utf-8");

  console.log(`\nWrote catalog/index.json with ${catalog.length} chart(s).`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
