/**
 * thumbs.mjs — generate gallery card thumbnails into _site/<id>/thumb.png.
 *
 * Headless-screenshots each assembled chart page's `.figure-card`. These are TRANSIENT build
 * artifacts (a visual nicety for the landing-page gallery) — never committed, never diffed. This
 * replaces the old committed baseline.png, which was a visual lock we no longer keep (charts are
 * reviewed live via the PR preview deploy instead).
 *
 * Run AFTER `npm run site` (it reads _site/<id>/index.html). Requires Chromium:
 *   npx playwright install chromium
 */

import { chromium } from "playwright";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { listCharts, REPO_ROOT } from "./lib.mjs";

const OUT = join(REPO_ROOT, "_site");
// Card render width (px). The gallery shows these scaled down; a mid width renders the chart at a
// representative size without being huge. deviceScaleFactor:2 keeps them crisp.
const CARD_WIDTH = 560;

if (!existsSync(OUT)) {
  console.error("_site/ not found — run `npm run site` first.");
  process.exit(1);
}

const charts = await listCharts();
console.log(`Generating ${charts.length} thumbnail(s)...\n`);

let browser;
try {
  browser = await chromium.launch();
} catch (err) {
  console.error(
    `thumbs: could not launch Chromium (${err.message}).\nInstall it with: npx playwright install chromium`,
  );
  process.exit(1);
}

const page = await browser.newPage({ viewport: { width: CARD_WIDTH, height: 800 }, deviceScaleFactor: 2 });
let made = 0;
for (const { id } of charts) {
  const pagePath = join(OUT, id, "index.html");
  if (!existsSync(pagePath)) {
    console.warn(`  ! ${id}: no _site page — skipped`);
    continue;
  }
  try {
    await page.goto(pathToFileURL(pagePath).href, { waitUntil: "networkidle" });
    await page.waitForSelector(".figure-card svg", { timeout: 10_000 });
    await page.waitForTimeout(250); // let fonts settle
    const card = page.locator(".figure-card").first();
    await card.screenshot({ path: join(OUT, id, "thumb.png") });
    made++;
    console.log(`  + ${id}/thumb.png`);
  } catch (err) {
    console.warn(`  ! ${id}: thumbnail failed (${err.message})`);
  }
}

await browser.close();
console.log(`\nDone. ${made}/${charts.length} thumbnail(s) written into _site/.`);
