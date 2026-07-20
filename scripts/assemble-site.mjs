/**
 * assemble-site.mjs — assemble the publishable site into _site/.
 *
 * Layout produced (served at the Pages root):
 *   _site/index.html                  # the landing page (from site/)
 *   _site/catalog/index.json          # the figure catalog
 *   _site/<collection>/<chart>/index.html  # each chart's live page (from dist/)
 *   _site/<collection>/<chart>/data.csv
 *
 * Run AFTER `npm run build` and `npm run catalog`. Card thumbnails (./<id>/thumb.png) are
 * produced separately by `npm run thumbs` (a headless screenshot of each rendered page), so they
 * are transient build artifacts — never committed. The landing page fetches ./catalog/index.json
 * at runtime and links to ./<id>/ pages + ./<id>/thumb.png thumbnails.
 */

// Synchronous fs throughout: async fs.cp({recursive}) has a file-dropping race on Node 20
// (the CI runtime) that silently omitted per-chart index.html. cpSync is deterministic.
import { cpSync, mkdirSync, rmSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./lib.mjs";
import { readManifest, writeManifest } from "./incremental.mjs";

const DIST = join(REPO_ROOT, "dist");
const CATALOG = join(REPO_ROOT, "catalog", "index.json");
const SITE_SRC = join(REPO_ROOT, "site");
const OUT = join(REPO_ROOT, "_site");

if (!existsSync(DIST)) {
  console.error("dist/ not found — run `npm run build` first.");
  process.exit(1);
}
if (!existsSync(CATALOG)) {
  console.error("catalog/index.json not found — run `npm run catalog` first.");
  process.exit(1);
}

console.log("Assembling _site/ ...\n");

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// 1. Chart pages + data (dist/<id>/...) -> _site/<id>/...
cpSync(DIST, OUT, { recursive: true });
console.log("  + chart pages (from dist/)");

// 2. Catalog -> _site/catalog/index.json
mkdirSync(join(OUT, "catalog"), { recursive: true });
cpSync(CATALOG, join(OUT, "catalog", "index.json"));
console.log("  + catalog/index.json");

// 3. Embed framework (embed/v1/: loader + vendored iframe-resizer) -> _site/embed/
const EMBED_SRC = join(REPO_ROOT, "embed");
if (existsSync(EMBED_SRC)) {
  cpSync(EMBED_SRC, join(OUT, "embed"), { recursive: true });
  console.log("  + embed framework (from embed/)");
}

// 4. Landing page + any other static assets in site/ -> _site/
for (const entry of readdirSync(SITE_SRC, { withFileTypes: true })) {
  cpSync(join(SITE_SRC, entry.name), join(OUT, entry.name), { recursive: true });
}
console.log("  + landing page (from site/)");

// 5. Build manifest (dist/.manifest.json) -> _site/.build/manifest.json
const DIST_MANIFEST = join(DIST, ".manifest.json");
const manifest = readManifest(DIST_MANIFEST);
if (manifest) {
  writeManifest(join(OUT, ".build", "manifest.json"), manifest);
  console.log("  + .build/manifest.json");

  // 6. Cache carry-forward: pre-populate _site/.build/thumbs with still-live prior thumbnails so
  // the thumbs step only screenshots genuine misses (guarded on GH_PAGES_DIR being set).
  const ghPagesDir = process.env.GH_PAGES_DIR;
  if (ghPagesDir) {
    let carried = 0;
    for (const [id, entry] of Object.entries(manifest.charts ?? {})) {
      const hash = entry?.hash;
      if (!hash) continue;
      const rel = join(".build", "thumbs", id, `${hash}.png`);
      const src = join(ghPagesDir, rel);
      const dest = join(OUT, rel);
      if (existsSync(src) && !existsSync(dest)) {
        mkdirSync(join(OUT, ".build", "thumbs", id), { recursive: true });
        cpSync(src, dest);
        carried++;
      }
    }
    if (carried > 0) console.log(`  + carried forward ${carried} cached thumbnail(s) from GH_PAGES_DIR`);
  }
} else {
  console.warn("  ! dist/.manifest.json not found — _site/.build/manifest.json not written");
}

console.log(`\nNext: \`npm run thumbs\` to generate card thumbnails, then serve _site/ (e.g. \`npx http-server _site\`).`);
