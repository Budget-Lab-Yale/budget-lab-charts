// Render a slide-chart working folder (chart.yaml + data + source.json) into <name>.png and
// <name>.svg at a slide frame, using the pinned engine's buildExportSvg in Playwright Chromium.
//
// Usage: node scripts/slides/render-slide.mjs <working folder> --frame <below-title|full|half> [--keep-source]
//
// Output is always exactly the frame: content shorter than the frame is padded below (top-aligned,
// with a warning); content taller than the frame is an error. It never clips or scales.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { REPO_ROOT, buildTblChartCmd } from "../lib.mjs";
import { FRAMES, getFrame } from "./frames.mjs";
import { assertOutsideArchive } from "./paths.mjs";
import { localDataFile } from "./fetch-archived.mjs";
import { readSource, writeSource } from "./source-json.mjs";
import { altText, effectiveSelections, typeName } from "./alt-text.mjs";
import { buildPalette, lintPaletteUse } from "../palette-lint.mjs";

const USAGE = `Usage: node scripts/slides/render-slide.mjs <working folder> --frame <${Object.keys(FRAMES).join("|")}> [--keep-source]`;

// An error whose message is already the one paragraph the user should see. `stale` marks a failure
// of the spec or its render, after which an earlier <name>.png/.svg no longer matches the folder.
class SlideError extends Error {}
const fail = (msg, { stale = false } = {}) => { throw Object.assign(new SlideError(msg), { stale }); };
const oneLine = (s) => String(s ?? "").replace(/\s*\r?\n\s*/g, " ").trim();
const firstLine = (e) => String(e?.message ?? e).split(/\r?\n/)[0];

export function parseArgs(argv) {
  const opts = { folder: undefined, frame: undefined, keepSource: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--frame") opts.frame = argv[++i];
    else if (a.startsWith("--frame=")) opts.frame = a.slice("--frame=".length);
    else if (a === "--keep-source") opts.keepSource = true;
    else if (a.startsWith("--")) fail(`Unknown option ${a}. ${USAGE}`);
    else if (opts.folder === undefined) opts.folder = a;
    else fail(`Unexpected argument "${a}". ${USAGE}`);
  }
  if (!opts.folder || !opts.frame) fail(USAGE);
  return opts;
}

function pinnedEngineVersion(repoRoot) {
  try {
    return JSON.parse(readFileSync(join(repoRoot, "node_modules", "budget-lab-chart-engine", "package.json"), "utf8")).version;
  } catch {
    fail("budget-lab-chart-engine is not installed in the charts repo; run npm ci (npm run slides:preflight checks the setup).");
  }
}

function readBundle(repoRoot) {
  const dir = mkdtempSync(join(tmpdir(), "slides-render-"));
  try {
    const c = buildTblChartCmd(["assets", "-o", dir, "--json"], repoRoot);
    const r = spawnSync(c.executable, c.args, { ...c.options, encoding: "utf8" });
    if (r.status !== 0) fail(`Could not build the engine bundle (tbl-chart assets): ${oneLine(r.stderr || r.error?.message || `exit ${r.status}`)}. Run npm ci, then npm run slides:preflight.`);
    const out = JSON.parse(r.stdout);
    return { js: readFileSync(join(dir, out.runtime), "utf8"), css: readFileSync(join(dir, out.styles), "utf8") };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Reading under charts/ is refused like writing there: chart.yaml is checked through any symlink,
// and a local data source must be a bare filename in the folder (fetch-archived's rule), checked
// again once resolved. Only { url: "http(s)://..." } data is left to loadData to fetch.
const guardRead = (p, repoRoot) => {
  try { assertOutsideArchive(p, repoRoot); } catch (e) { fail(e.message, { stale: true }); }
};

export async function loadSpecAndRows(folder, repoRoot = REPO_ROOT) {
  const specPath = join(folder, "chart.yaml");
  guardRead(specPath, repoRoot);
  if (!existsSync(specPath)) fail(`No chart.yaml in ${folder}. Fetch or capture a figure into the folder first.`);
  let spec;
  try {
    spec = parseYaml(readFileSync(specPath, "utf8"));
  } catch (e) {
    fail(`chart.yaml in ${folder} is not valid YAML: ${oneLine(e.message)}`, { stale: true });
  }
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) fail(`chart.yaml in ${folder} is not a chart spec (expected a YAML mapping).`);
  if (spec.data == null) fail(`chart.yaml in ${folder} has no data field.`);
  let dataName;
  try {
    dataName = localDataFile(spec.data);
  } catch (e) {
    fail(`chart.yaml in ${folder}: ${e.message} Copy the data file into the folder, or give remote data as { url: "https://..." }.`, { stale: true });
  }
  if (dataName) guardRead(resolve(folder, dataName), repoRoot);
  const { loadData } = await import("budget-lab-chart-engine/data");
  let rows;
  try {
    rows = await loadData(spec.data, { baseDir: folder });
  } catch (e) {
    fail(`Could not load the chart's data (${typeof spec.data === "string" ? spec.data : JSON.stringify(spec.data)}) from ${folder}: ${oneLine(e.message)}`, { stale: true });
  }
  return { spec, rows };
}

async function validate(spec, rows, source, pinned) {
  const { validateChart } = await import("budget-lab-chart-engine/spec");
  const v = validateChart(spec, rows);
  if (v.valid) return;
  const errors = (v.errors ?? []).map((e) => oneLine(typeof e === "string" ? e : e?.message ?? JSON.stringify(e)));
  let msg = `chart.yaml failed validation against engine ${pinned}: ${errors.join("; ")}.`;
  if (source?.origin === "interactive") {
    msg += ` This spec was captured from a tool that vendors engine ${source.tool_engine_version ?? "(unknown version)"}; the charts repo pins ${pinned}. Edit chart.yaml to the pinned engine's schema (ENGINE-CONFIG-SPEC.md) and rerun.`;
  }
  fail(msg, { stale: true });
}

// The archive's palette lint never sees a working folder, so it runs here. New data (no recognised
// origin) must meet the house palette; an interactive capture keeps its tool's colours and an
// archived figure was already gated by validate-all, so for those a finding is only a warning.
export function paletteFindings(spec, source, name, palette) {
  const { errors, warnings } = lintPaletteUse(spec, `${name}/chart.yaml`, palette);
  const origin = source?.origin;
  if (origin === "archived" || origin === "interactive") {
    const why = origin === "interactive"
      ? " (kept: the interactive tool chose this colour)"
      : " (unexpected: archived figures already pass the archive's palette gate)";
    return { error: null, warnings: [...errors.map((e) => `${e}${why}`), ...warnings] };
  }
  if (!errors.length) return { error: null, warnings };
  return {
    error: `chart.yaml does not meet the house palette: ${errors.map(oneLine).join(" ")} New figures take series colours from the categorical ramp (the series-colour rule in the charts repo's CLAUDE.md).`,
    warnings,
  };
}

// Runs in the page. Returns the export's natural size and, when it fits, the framed SVG + PNG.
async function renderInPage({ spec, rows, selections, frame }) {
  let svg;
  try {
    svg = BudgetLabChart.buildExportSvg(spec, rows, {
      selections,
      frame: { width: frame.width, height: frame.height, logoTop: frame.logoTop, fillPanes: frame.fillPanes, fitRows: frame.fitRows },
    });
  } catch (e) {
    return { error: String(e && e.message ? e.message : e) };
  }
  const w = +svg.getAttribute("width");
  const h = +svg.getAttribute("height");
  if (Math.round(w) !== frame.width || h > frame.height) return { w, h };
  // Pad to the frame. The export paints a white background rect over its own height;
  // stretch it too so the padding matches the chart's ground instead of showing as a seam.
  svg.setAttribute("width", String(frame.width));
  svg.setAttribute("height", String(frame.height));
  const bg = svg.querySelector(":scope > rect");
  if (bg && +bg.getAttribute("x") === 0 && +bg.getAttribute("y") === 0) bg.setAttribute("height", String(frame.height));
  const str = new XMLSerializer().serializeToString(svg);
  const img = new Image();
  const url = URL.createObjectURL(new Blob([str], { type: "image/svg+xml;charset=utf-8" }));
  try {
    await new Promise((ok, bad) => { img.onload = ok; img.onerror = () => bad(new Error("the export SVG did not load as an image")); img.src = url; });
  } catch (e) {
    return { error: e.message };
  } finally {
    URL.revokeObjectURL(url);
  }
  const S = frame.scale;
  const c = document.createElement("canvas");
  c.width = Math.round(frame.width * S);
  c.height = Math.round(frame.height * S);
  const ctx = c.getContext("2d");
  ctx.scale(S, S);
  ctx.drawImage(img, 0, 0);
  return { w, h, svg: str, png: c.toDataURL("image/png").split(",")[1] };
}

async function renderInChromium({ js, css }, payload) {
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch (e) {
    fail(`Playwright is not installed (${firstLine(e)}). Run npm ci, then npm run slides:preflight.`);
  }
  let browser;
  try {
    browser = await chromium.launch({ args: ["--no-sandbox"] });
  } catch (e) {
    fail(`Chromium failed to launch: ${firstLine(e)}. Run npx playwright install chromium, then npm run slides:preflight.`);
  }
  try {
    const page = await browser.newPage();
    await page.setContent(
      `<!doctype html><html><head><style>${css}</style></head><body><div style="font-family:Figtree">` +
        `<span style="font-weight:500">a</span><span style="font-weight:600">a</span>` +
        `<span style="font-weight:700">a</span><span style="font-weight:800">a</span></div></body></html>`,
    );
    await page.addScriptTag({ content: js });
    await page.evaluate(async () => {
      await Promise.all(["500 12px Figtree", "600 12px Figtree", "700 12px Figtree", "800 22px Figtree"].map((f) => document.fonts.load(f)));
      await document.fonts.ready;
    });
    return await page.evaluate(renderInPage, payload);
  } finally {
    await browser.close();
  }
}

// A timeline keeps its own width whatever the frame says; rasterising it onto the frame's canvas
// would clip it or leave a gap, so it is refused.
export function widthError(spec, w, frameName, frame) {
  if (Math.round(w) === frame.width) return null;
  return `${typeName(spec.chartType) ?? "These"} charts keep their own width (${w} px) and can't be fitted to the ${frameName} frame (${frame.width} px).`;
}

// Horizontal bar/stacked (and dumbbell) charts take their height from their row count, not the
// frame, so a bigger frame only helps when the rendered height already fits it.
// Mirrors the engine's growsWithRows (src/engine/figure.ts), which the package does not export.
// small_multiples is deliberately not checked: on these chart types normalizeSpec draws the facets
// as groups of one chart (spec/facet-groups.ts), so export-png's `!isFigure && growsWithRows` holds
// for them too (probed: a faceted horizontal bar compresses identically with fitRows).
function rowSized(spec) {
  if (spec.chartType === "bar" || spec.chartType === "stacked") return spec.orientation === "horizontal";
  return spec.chartType === "dumbbell" && spec.orientation !== "vertical";
}
function rowCount(spec, rows) {
  // Same column roles as the engine's resolveColumns (src/spec/columns.ts).
  const c = spec.columns ?? {};
  const x = c.category ?? c.x ?? "time";
  const group = (c.section != null && c.section !== "" ? c.section : null) ?? c.facet ?? null;
  return new Set(rows.map((r) => (group ? JSON.stringify([r[group], r[x]]) : String(r[x])))).size;
}

export function overflowError(spec, rows, h, frameName, frame, frames = FRAMES) {
  if (h <= frame.height) return null;
  const head = `Rendered chart is taller than the ${frameName} frame (${h} > ${frame.height} px).`;
  const full = frames.full;
  const fitsFull = frameName !== "full" && full && h <= full.height;
  if (rowSized(spec)) {
    const n = rowCount(spec, rows);
    return `${head} A horizontal ${typeName(spec.chartType).toLowerCase()} chart's height comes from its number of rows (${n} rows), not the frame${frame.fitRows ? ", and fitRows has already tightened them to the minimum readable spacing," : ","} so it needs fewer categories or splitting across two slides.` +
      (fitsFull ? ` At ${h} px it would fit the full frame (--frame full).` : "");
  }
  const tries = [frameName !== "full" ? "--frame full" : null, "fewer categories", "small_multiples.columns"].filter(Boolean);
  return `${head} Try ${tries.slice(0, -1).join(", ")}, or ${tries.at(-1)}.`;
}

export function pngDimensions(buf) {
  const sig = "89504e470d0a1a0a";
  if (buf.length < 24 || buf.subarray(0, 8).toString("hex") !== sig || buf.subarray(12, 16).toString("latin1") !== "IHDR") return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

export async function renderSlide({ folder: folderArg, frame: frameName, keepSource = false }, repoRoot = REPO_ROOT) {
  const folder = resolve(folderArg);
  assertOutsideArchive(folder, repoRoot);
  if (!existsSync(folder)) fail(`Working folder not found: ${folder}`);
  let frame;
  try {
    frame = getFrame(frameName);
  } catch (e) {
    fail(e.message);
  }
  const name = basename(folder);
  const pngPath = join(folder, `${name}.png`);
  const svgPath = join(folder, `${name}.svg`);
  assertOutsideArchive(pngPath, repoRoot);
  assertOutsideArchive(svgPath, repoRoot);

  const pinned = pinnedEngineVersion(repoRoot);
  assertOutsideArchive(join(folder, "source.json"), repoRoot);
  let source;
  try {
    source = readSource(folder) ?? {};
  } catch (e) {
    fail(`source.json in ${folder} is not valid JSON: ${oneLine(e.message)}`);
  }
  try {
    return await renderInto({ folder, name, pngPath, svgPath, frameName, frame, keepSource, source, pinned }, repoRoot);
  } catch (e) {
    if (!(e instanceof SlideError && e.stale)) throw e;
    const removed = [pngPath, svgPath].filter((p) => existsSync(p));
    for (const p of removed) rmSync(p, { force: true });
    if (removed.length) {
      e.message += ` The earlier ${removed.map((p) => basename(p)).join(" and ")} ${removed.length > 1 ? "were" : "was"} removed so a stale render can't be inserted.`;
    }
    throw e;
  }
}

async function renderInto({ folder, name, pngPath, svgPath, frameName, frame, keepSource, source, pinned }, repoRoot) {
  const stored = source.selections && typeof source.selections === "object" ? source.selections : {};
  const { spec, rows } = await loadSpecAndRows(folder, repoRoot);
  await validate(spec, rows, source, pinned);
  const warnings = [];
  let palette;
  try {
    palette = buildPalette(repoRoot);
  } catch (e) {
    fail(`The house palette could not be read for the palette check: ${oneLine(e.message)}`);
  }
  const lint = paletteFindings(spec, source, name, palette);
  if (lint.error) fail(lint.error, { stale: true });
  warnings.push(...lint.warnings);
  // Resolved here, not left to the engine: an explicit {} stops the engine resolving the default
  // option, and with it that option's colour accent.
  const selections = effectiveSelections(spec, stored);
  const alt = altText(spec, selections);
  if (!keepSource) { delete spec.source; delete spec.note; }

  const bundle = readBundle(repoRoot);
  const out = await renderInChromium(bundle, { spec, rows, selections, frame });
  if (out.error) fail(`The engine could not render the chart: ${oneLine(out.error)}`, { stale: true });
  const sizeError = widthError(spec, out.w, frameName, frame) ?? overflowError(spec, rows, out.h, frameName, frame);
  if (sizeError) fail(sizeError, { stale: true });
  if (out.h < frame.height) warnings.push(`padded ${frame.height - out.h} px below the chart (it renders ${out.h} px tall in the ${frame.height} px ${frameName} frame).`);

  const png = Buffer.from(out.png, "base64");
  const dims = pngDimensions(png);
  const want = { width: Math.round(frame.width * frame.scale), height: Math.round(frame.height * frame.scale) };
  if (!dims || dims.width !== want.width || dims.height !== want.height) {
    fail(`The rasterised PNG is ${dims ? `${dims.width}x${dims.height}` : "not a PNG"}, expected ${want.width}x${want.height}; nothing was written.`);
  }
  writeFileSync(svgPath, out.svg, "utf-8");
  writeFileSync(pngPath, png);
  const written = pngDimensions(readFileSync(pngPath));
  if (!written || written.width !== want.width || written.height !== want.height) {
    fail(`${pngPath} reads back as ${written ? `${written.width}x${written.height}` : "not a PNG"}, expected ${want.width}x${want.height}.`);
  }
  writeSource(folder, { engine_version: pinned, frame: frameName, keep_source: !!keepSource, alt_text: alt }, repoRoot);
  return { folder, name, pngPath, svgPath, width: want.width, height: want.height, warnings, alt_text: alt };
}

async function main() {
  try {
    const opts = parseArgs(process.argv.slice(2));
    const r = await renderSlide(opts);
    for (const w of r.warnings) console.error(`Warning: ${w}`);
    console.log(`Rendered ${r.name}.png (${r.width}x${r.height}) and ${r.name}.svg in ${r.folder}`);
  } catch (e) {
    console.error(e instanceof SlideError ? e.message : `render-slide failed: ${oneLine(firstLine(e))}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
