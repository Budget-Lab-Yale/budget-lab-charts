// Integration tests for render-slide.mjs. They launch Playwright Chromium, so every render runs once,
// concurrently, in `before`, and the assertions share the results.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { REPO_ROOT } from "../lib.mjs";
import { altText, resolveTitle } from "./alt-text.mjs";

const SCRIPT = fileURLToPath(new URL("./render-slide.mjs", import.meta.url));
const FIXTURES = fileURLToPath(new URL("./fixtures/", import.meta.url));
const PINNED = JSON.parse(readFileSync(join(REPO_ROOT, "node_modules", "budget-lab-chart-engine", "package.json"), "utf8")).version;

let root;
const runs = {};

function run(args) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [SCRIPT, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    p.stdout.setEncoding("utf8").on("data", (d) => (stdout += d));
    p.stderr.setEncoding("utf8").on("data", (d) => (stderr += d));
    p.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

// A SharePoint-style deck folder: spaces, an apostrophe, an em dash.
function stage(fixture, name = fixture) {
  const dir = join(root, "Slide charts", name);
  mkdirSync(dir, { recursive: true });
  // Not cpSync: on Windows (Node 24) it silently copies nothing into a destination whose path has an em dash.
  for (const f of readdirSync(join(FIXTURES, fixture))) copyFileSync(join(FIXTURES, fixture, f), join(dir, f));
  return dir;
}

const pngSize = (p) => {
  const b = readFileSync(p);
  assert.equal(b.subarray(1, 4).toString("latin1"), "PNG");
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
};
const svgRoot = (svg) => svg.match(/^<svg\b[^>]*>/)[0];
const svgText = (svg) => svg.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ");
const source = (dir) => JSON.parse(readFileSync(join(dir, "source.json"), "utf8"));
const NO_STACK = /\n\s+at\s/;

const JOBS = {
  laffer: ["laffer", ["--frame", "below-title"]],
  tall: ["tall-bars", ["--frame", "half"]],
  token: ["title-token", ["--frame", "below-title"]],
  unknown: ["unknown-field", ["--frame", "full"]],
  short: ["short-bars", ["--frame", "full", "--keep-source"]],
};

before(async () => {
  root = mkdtempSync(join(tmpdir(), "Budget Lab Sharepoint — Russell Sage's deck "));
  await Promise.all(Object.entries(JOBS).map(async ([key, [fixture, args]]) => {
    const dir = stage(fixture);
    runs[key] = { dir, name: fixture, ...(await run([dir, ...args])) };
  }));
}, { timeout: 240_000 });

after(() => root && rmSync(root, { recursive: true, force: true }));

const out = (key, ext) => join(runs[key].dir, `${runs[key].name}.${ext}`);

test("1. Laffer below-title: 3200x1545 PNG, 1280x618 SVG, alt_text and source.json fields", () => {
  const r = runs.laffer;
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(pngSize(out("laffer", "png")), { width: 3200, height: 1545 });
  const svg = readFileSync(out("laffer", "svg"), "utf8");
  assert.match(svgRoot(svg), /\bwidth="1280"/);
  assert.match(svgRoot(svg), /\bheight="618"/);
  const s = source(r.dir);
  assert.ok(s.alt_text.startsWith("Line chart: Capital Gains Laffer Curve"), s.alt_text);
  assert.equal(s.engine_version, PINNED);
  assert.equal(s.frame, "below-title");
  assert.equal(s.keep_source, false);
});

test("2. half frame, 30 horizontal bars: exit 1, both heights, suggests full, no PNG", () => {
  const r = runs.tall;
  assert.equal(r.code, 1);
  assert.match(r.stderr, /taller than the half frame \(\d+ > 618 px\)/);
  assert.match(r.stderr, /--frame full/);
  assert.doesNotMatch(r.stderr, NO_STACK);
  assert.equal(existsSync(out("tall", "png")), false, "no clipped PNG is written");
  assert.equal(existsSync(out("tall", "svg")), false);
});

test("3. title token resolves to the option label in the SVG and alt_text", () => {
  const r = runs.token;
  assert.equal(r.code, 0, r.stderr);
  const text = svgText(readFileSync(out("token", "svg"), "utf8"));
  assert.match(text, /by Sector/);
  assert.doesNotMatch(text, /\{/);
  const alt = source(r.dir).alt_text;
  assert.match(alt, /by Sector/);
  assert.doesNotMatch(alt, /\{|by sector/);
});

test("4. unknown field: exit 1 with the validator message and the engine-version sentence", () => {
  const r = runs.unknown;
  assert.equal(r.code, 1);
  assert.match(r.stderr, /unknown property "colour_scheme"/);
  assert.match(r.stderr, new RegExp(`vendors engine 1\\.13\\.0; the charts repo pins ${PINNED.replace(/\./g, "\\.")}`));
  assert.doesNotMatch(r.stderr, NO_STACK);
  assert.equal(r.stderr.trim().split(/\r?\n/).length, 1, "one paragraph");
});

test("5. source line: dropped by default, kept with --keep-source", () => {
  assert.doesNotMatch(svgText(readFileSync(out("laffer", "svg"), "utf8")), /Source:/);
  assert.match(svgText(readFileSync(out("short", "svg"), "utf8")), /Source:/);
  assert.equal(source(runs.short.dir).keep_source, true);
});

test("6. shorter than the frame: padded to exactly 3200x1800 with a warning", () => {
  const r = runs.short;
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(pngSize(out("short", "png")), { width: 3200, height: 1800 });
  assert.match(svgRoot(readFileSync(out("short", "svg"), "utf8")), /\bheight="720"/);
  assert.match(r.stderr, /padded \d+ px below the chart/);
});

test("alt-text: resolveTitle uses the selected option's label, then default, then first option", () => {
  const spec = {
    chartType: "stacked",
    title: "GDP by {dimension}",
    subtitle: "Percent",
    title_selectors: { dimension: { options: [{ id: "sector", label: "Sector" }, { id: "country", label: "Trading Partner" }, { id: "raw" }] } },
  };
  assert.equal(resolveTitle(spec, { dimension: "country" }), "GDP by Trading Partner");
  assert.equal(resolveTitle(spec, {}), "GDP by Sector");
  assert.equal(resolveTitle(spec, { dimension: "nope" }), "GDP by Sector");
  assert.equal(resolveTitle(spec, { dimension: "raw" }), "GDP by raw");
  assert.equal(resolveTitle({ ...spec, title_selectors: { dimension: { ...spec.title_selectors.dimension, default: "country" } } }), "GDP by Trading Partner");
  assert.equal(altText(spec, { dimension: "country" }), "Stacked bar chart: GDP by Trading Partner. Percent");
  assert.equal(altText({ chartType: "mystery", title: "T" }), "Chart: T.");
});
