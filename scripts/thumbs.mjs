/**
 * thumbs.mjs — generate gallery card thumbnails into _site/<id>/thumb.png.
 *
 * Headless-screenshots each assembled chart page's `.figure-card`. These are TRANSIENT build
 * artifacts (a visual nicety for the landing-page gallery) — never committed, never diffed. This
 * replaces the old committed baseline.png, which was a visual lock we no longer keep (charts are
 * reviewed live via the PR preview deploy instead).
 *
 * Incremental + content-addressed cache: thumbnails are keyed by each chart's content hash (from
 * the build manifest). A hit in the new (`_site/.build/thumbs`) or prior (`${GH_PAGES_DIR}/.build/
 * thumbs`) cache is copied out instead of re-screenshotted. Misses are screenshotted through a
 * bounded pool of reusable Chromium pages (THUMB_CONCURRENCY).
 *
 * Run AFTER `npm run site` (it reads _site/<id>/index.html). Chromium is only needed when there is
 * at least one miss, so CI asks first and installs the browser only then:
 *   node scripts/thumbs.mjs --plan     # prints the miss count; writes misses=N to $GITHUB_OUTPUT
 *   npx playwright install chromium --only-shell
 */

import { existsSync, mkdirSync, copyFileSync, appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import os from "node:os";
import { listCharts, REPO_ROOT } from "./lib.mjs";
import { runPool } from "./pool.mjs";
import { readManifest } from "./incremental.mjs";

const OUT = join(REPO_ROOT, "_site");
// Card render width (px). The gallery shows these scaled down; a mid width renders the chart at a
// representative size without being huge. deviceScaleFactor:2 keeps them crisp.
const CARD_WIDTH = 560;

/** Relative, content-addressed cache path for a chart's thumbnail. */
export function thumbCachePath(id, hash) {
  return `.build/thumbs/${id}/${hash}.png`;
}

/**
 * Classify every chart as a cache-hit (thumbnail already exists for its content hash), a miss
 * (needs screenshotting), or skipped (no assembled page). Read-only: copies nothing, so `--plan`
 * can answer "is Chromium needed?" without touching _site/.
 *
 * @returns {{ hits: {id, thumbOut, cached}[], misses: {id, pagePath, thumbOut, hash}[], skipped: string[] }}
 */
export function planThumbs({ charts, hashById, ghPagesDir, outDir = OUT }) {
  const hits = [];
  const misses = [];
  const skipped = [];

  for (const { id } of charts) {
    const pagePath = join(outDir, id, "index.html");
    if (!existsSync(pagePath)) {
      skipped.push(id);
      continue;
    }

    const hash = hashById.get(id);
    const thumbOut = join(outDir, id, "thumb.png");
    const rel = hash ? thumbCachePath(id, hash) : null;
    const newHit = rel ? join(outDir, rel) : null;
    const priorHit = rel && ghPagesDir ? join(ghPagesDir, rel) : null;
    const cached =
      newHit && existsSync(newHit) ? newHit : priorHit && existsSync(priorHit) ? priorHit : null;

    if (cached) hits.push({ id, thumbOut, cached, newHit });
    else misses.push({ id, pagePath, thumbOut, hash });
  }

  return { hits, misses, skipped };
}

/** Resolve the chart list + content hashes that `planThumbs` needs. */
async function loadPlanInputs() {
  const charts = await listCharts();

  // Read hashes: prefer the assembled _site manifest, else the dist manifest.
  const manifest =
    readManifest(join(OUT, ".build", "manifest.json")) ??
    readManifest(join(REPO_ROOT, "dist", ".manifest.json"));
  const hashById = new Map(
    Object.entries(manifest?.charts ?? {}).map(([id, entry]) => [id, entry?.hash]),
  );

  return { charts, hashById, ghPagesDir: process.env.GH_PAGES_DIR };
}

/**
 * `--plan`: report how many thumbnails would need screenshotting, so CI can skip the Chromium
 * download entirely when the answer is zero. Never launches a browser.
 */
async function plan() {
  if (!existsSync(OUT)) {
    console.error("_site/ not found — run `npm run site` first.");
    process.exit(1);
  }

  const { charts, hashById, ghPagesDir } = await loadPlanInputs();
  const { hits, misses, skipped } = planThumbs({ charts, hashById, ghPagesDir });

  console.log(
    `thumbs plan: ${misses.length} to screenshot, ${hits.length} cached, ${skipped.length} without a page (of ${charts.length})`,
  );
  for (const miss of misses) console.log(`  ~ ${miss.id} (needs screenshot)`);

  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `misses=${misses.length}\n`);
  }
}

async function main() {
  if (!existsSync(OUT)) {
    console.error("_site/ not found — run `npm run site` first.");
    process.exit(1);
  }

  const { charts, hashById, ghPagesDir } = await loadPlanInputs();

  console.log(`Generating ${charts.length} thumbnail(s)...\n`);

  const { hits, misses, skipped } = planThumbs({ charts, hashById, ghPagesDir });

  for (const id of skipped) console.warn(`  ! ${id}: no _site page — skipped`);
  for (const { id, thumbOut, cached, newHit } of hits) {
    // Copy to the served thumb AND ensure it lives in the new cache for carry-forward.
    copyOut(cached, thumbOut);
    copyOut(cached, newHit);
    console.log(`  = ${id}/thumb.png (cache-hit)`);
  }

  let madeCount = 0;

  if (misses.length > 0) {
    let browser;
    try {
      const { chromium } = await import("playwright");
      browser = await chromium.launch({ args: ["--no-sandbox"] }); // --no-sandbox: CI runners
    } catch (err) {
      console.error(
        `thumbs: could not launch Chromium (${err.message}).\nInstall it with: npx playwright install chromium --only-shell`,
      );
      process.exit(1);
    }

    const K = Number(process.env.THUMB_CONCURRENCY) || Math.min(os.cpus().length, 4);
    const poolSize = Math.min(K, misses.length);

    // Pre-create K reusable pages and hand them out via a free-list so no two workers share a page.
    const pages = [];
    for (let i = 0; i < poolSize; i++) {
      pages.push(
        await browser.newPage({ viewport: { width: CARD_WIDTH, height: 800 }, deviceScaleFactor: 2 }),
      );
    }
    const freePages = [...pages];

    await runPool(misses, poolSize, async (miss) => {
      const page = freePages.pop();
      try {
        await screenshotChart(page, miss);
        madeCount++;
      } catch (err) {
        console.warn(`  ! ${miss.id}: thumbnail failed (${err.message})`);
      } finally {
        freePages.push(page);
      }
    });

    await browser.close();
  }

  console.log();
  console.log(`thumbs: screenshotted ${madeCount}, cache-hit ${hits.length} (of ${charts.length})`);
}

/** Screenshot one chart page's `.figure-card` and write to the served thumb + the content cache. */
async function screenshotChart(page, { id, pagePath, thumbOut, hash }) {
  await page.goto(pathToFileURL(pagePath).href, { waitUntil: "networkidle" });
  await page.waitForSelector(".figure-card svg", { timeout: 10_000 });
  await page.waitForTimeout(250); // let fonts settle
  const card = page.locator(".figure-card").first();
  mkdirSync(dirname(thumbOut), { recursive: true });
  await card.screenshot({ path: thumbOut });
  if (hash) copyOut(thumbOut, join(OUT, thumbCachePath(id, hash)));
  console.log(`  + ${id}/thumb.png`);
}

/** Copy src -> dest, creating parent dirs; no-op if already the same path. */
function copyOut(src, dest) {
  if (src === dest) return;
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.slice(2).includes("--plan")) await plan();
  else await main();
}
