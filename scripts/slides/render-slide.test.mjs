// Integration tests for render-slide.mjs. They launch Playwright Chromium, so every render runs once,
// concurrently, in `before`, and the assertions share the results.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { REPO_ROOT } from "../lib.mjs";
import { altText, effectiveSelections, resolveTitle } from "./alt-text.mjs";
import { loadSpecAndRows, overflowError, paletteFindings, widthError } from "./render-slide.mjs";
import { buildPalette } from "../palette-lint.mjs";

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
  fit28: ["fit-bars", ["--frame", "below-title"]],
  near30: ["tall-bars", ["--frame", "below-title"]],
  tall: ["overflow-bars", ["--frame", "half"]],
  token: ["title-token", ["--frame", "below-title"]],
  unknown: ["unknown-field", ["--frame", "full"]],
  short: ["short-bars", ["--frame", "full", "--keep-source"]],
  timeline: ["timeline", ["--frame", "half"]],
  accent: ["accent", ["--frame", "below-title"]],
  navyNew: ["navy-new-data", ["--frame", "full"]],
  navyTool: ["navy-interactive", ["--frame", "full"]],
};

before(async () => {
  root = mkdtempSync(join(tmpdir(), "Budget Lab Sharepoint — Russell Sage's deck "));
  await Promise.all(Object.entries(JOBS).map(async ([key, [fixture, args]]) => {
    const dir = stage(fixture);
    // An earlier render that a failed re-render must not leave behind.
    if (key === "tall" || key === "navyNew") for (const ext of ["png", "svg"]) writeFileSync(join(dir, `${fixture}.${ext}`), "stale");
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

test("2. half frame, 60 horizontal bars: exit 1, both heights, minimum-spacing advice, no PNG", () => {
  const r = runs.tall;
  assert.equal(r.code, 1);
  assert.match(r.stderr, /taller than the half frame \(\d+ > 618 px\)/);
  assert.match(r.stderr, /\(60 rows\)/);
  assert.match(r.stderr, /minimum readable spacing/);
  // Still taller than the full frame at the floor, so suggesting full would be wrong.
  assert.ok(+r.stderr.match(/\((\d+) > 618 px\)/)[1] > 720);
  assert.doesNotMatch(r.stderr, /--frame full/);
  assert.doesNotMatch(r.stderr, NO_STACK);
  assert.equal(existsSync(out("tall", "png")), false, "no clipped PNG is written, and the stale one is gone");
  assert.equal(existsSync(out("tall", "svg")), false);
  assert.match(r.stderr, /The earlier overflow-bars\.png and overflow-bars\.svg were removed/);
});

test("2b. 28 horizontal bars fit below-title with fitRows: exactly 3200x1545, no overflow error", () => {
  const r = runs.fit28;
  assert.equal(r.code, 0, r.stderr);
  assert.doesNotMatch(r.stderr, /taller/);
  assert.deepEqual(pngSize(out("fit28", "png")), { width: 3200, height: 1545 });
});

// Measured against engine v1.17.0 (below-title, 618 px): 28 rows fit, 30 render 627, 34 render 691
// (about 16 px per row at the floor), and full is 720. 34 is far enough over that a small engine metric
// change cannot flip it, and under 720 so the --frame full advice still applies.
test("2c. 34 bars at the row floor still overflow below-title; it fits full, and the message says so", () => {
  const r = runs.near30;
  assert.equal(r.code, 1);
  assert.match(r.stderr, /taller than the below-title frame \(\d+ > 618 px\)/);
  assert.match(r.stderr, /\(34 rows\).*minimum readable spacing.*--frame full/);
  assert.equal(existsSync(out("near30", "png")), false);
});

test("3. title token resolves to the stored selection's label in the SVG and alt_text", () => {
  const r = runs.token;
  assert.equal(r.code, 0, r.stderr);
  const text = svgText(readFileSync(out("token", "svg"), "utf8"));
  assert.match(text, /by Trading Partner/);
  assert.doesNotMatch(text, /\{|by Sector|by country/);
  const alt = source(r.dir).alt_text;
  assert.match(alt, /by Trading Partner/);
  assert.doesNotMatch(alt, /\{|by Sector|by country/);
});

test("3b. no stored selection: default label in title and alt_text, and the option's colour accent", () => {
  const r = runs.accent;
  assert.equal(r.code, 0, r.stderr);
  const svg = readFileSync(out("accent", "svg"), "utf8");
  assert.match(svgText(svg), /by Sector/);
  assert.match(source(r.dir).alt_text, /by Sector/);
  const palette = buildPalette(REPO_ROOT);
  const red = [...palette.hexToNames].find(([, names]) => names.includes("red"))[0];
  const blue = [...palette.hexToNames].find(([, names]) => names.includes("blue"))[0];
  const strokes = [...svg.matchAll(/stroke="(#[0-9a-fA-F]{6})"/g)].map((m) => m[1].toLowerCase());
  assert.ok(strokes.includes(red), `the line takes the default option's red accent (${red}); strokes: ${[...new Set(strokes)]}`);
  assert.ok(!strokes.includes(blue), "the line is not the ramp's default blue");
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

// Few rows are padded, not stretched: fitRows never expands, so the SVG root stays at the frame.
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

test("7. a timeline keeps its own width: exit 1 in half, no PNG", () => {
  const r = runs.timeline;
  assert.equal(r.code, 1);
  assert.match(r.stderr, /Timeline charts keep their own width \(\d+ px\) and can't be fitted to the half frame \(640 px\)/);
  assert.doesNotMatch(r.stderr, NO_STACK);
  assert.equal(existsSync(out("timeline", "png")), false);
});

test("overflow and width messages depend on the case", () => {
  const half = { width: 640, height: 618, fitRows: true }, full = { width: 1280, height: 720, fitRows: true };
  const frames = { half, full };
  const hbar = { chartType: "bar", orientation: "horizontal", columns: { x: "c", value: "v" } };
  const rows = Array.from({ length: 22 }, (_, i) => ({ c: `C${i}`, v: "1" }));
  assert.equal(overflowError(hbar, rows, 618, "half", half, frames), null);
  const fits = overflowError(hbar, rows, 700, "half", half, frames);
  assert.match(fits, /taller than the half frame \(700 > 618 px\).*\(22 rows\).*minimum readable spacing.*--frame full/);
  assert.doesNotMatch(overflowError(hbar, rows, 782, "half", half, frames), /--frame full/);
  // Without fitRows nothing was tightened, so the message must not claim it.
  assert.doesNotMatch(overflowError(hbar, rows, 700, "half", { ...half, fitRows: false }, frames), /already tightened|minimum readable/);
  assert.doesNotMatch(overflowError(hbar, rows, 782, "full", full, frames), /--frame full/);
  const line = { chartType: "line" };
  assert.match(overflowError(line, [], 700, "half", half, frames), /Try --frame full, fewer categories, or small_multiples\.columns\./);
  assert.match(overflowError(line, [], 800, "full", full, frames), /Try fewer categories, or small_multiples\.columns\./);
  const faceted = { ...hbar, columns: { ...hbar.columns, facet: "f" }, small_multiples: { columns: 1 } };
  assert.match(overflowError(faceted, [{ f: "a", c: "x" }, { f: "b", c: "x" }], 700, "half", half, frames), /\(2 rows\).*already tightened/);
  assert.equal(widthError({ chartType: "timeline" }, 640, "half", half), null);
  assert.equal(widthError({ chartType: "timeline" }, 1000, "half", half),
    "Timeline charts keep their own width (1000 px) and can't be fitted to the half frame (640 px).");
});

test("8. palette: new data with bar_color navy fails; the same spec from an interactive tool warns", () => {
  const bad = runs.navyNew;
  assert.equal(bad.code, 1);
  assert.match(bad.stderr, /house palette.*bar_color is "navy"/);
  assert.doesNotMatch(bad.stderr, NO_STACK);
  assert.equal(existsSync(out("navyNew", "png")), false, "the stale PNG is removed");
  const ok = runs.navyTool;
  assert.equal(ok.code, 0, ok.stderr);
  assert.match(ok.stderr, /Warning: .*bar_color is "navy".*interactive tool/);
  assert.equal(existsSync(out("navyTool", "png")), true);
});

test("palette findings by origin", () => {
  const palette = buildPalette(REPO_ROOT);
  const spec = { chartType: "bar", bar_color: "navy" };
  assert.match(paletteFindings(spec, {}, "f", palette).error, /bar_color is "navy"/);
  assert.match(paletteFindings(spec, { origin: "something" }, "f", palette).error, /bar_color/);
  for (const origin of ["interactive", "archived"]) {
    const r = paletteFindings(spec, { origin }, "f", palette);
    assert.equal(r.error, null);
    assert.match(r.warnings.join(" "), /bar_color is "navy"/);
  }
  assert.deepEqual(paletteFindings({ chartType: "bar", bar_color: "blue" }, {}, "f", palette), { error: null, warnings: [] });
});

test("strict frame bounds: 619 overflows a 618 frame, 618 fits; widths compare after rounding", () => {
  const half = { width: 640, height: 618 };
  const line = { chartType: "line" };
  assert.match(overflowError(line, [], 619, "half", half), /\(619 > 618 px\)/);
  assert.equal(overflowError(line, [], 618, "half", half), null);
  assert.equal(widthError(line, 640, "half", half), null);
  assert.equal(widthError(line, 640.4, "half", half), null);
  assert.match(widthError(line, 641, "half", half), /\(641 px\)/);
});

test("row count uses the engine's column roles: columns.category wins over x", () => {
  const half = { width: 640, height: 618 }, frames = { half, full: { width: 1280, height: 720 } };
  const spec = { chartType: "bar", orientation: "horizontal", columns: { category: "cat", x: "other", value: "v" } };
  const rows = Array.from({ length: 30 }, (_, i) => ({ cat: `C${i}`, other: "same", v: "1" }));
  assert.match(overflowError(spec, rows, 845, "half", half, frames), /\(30 rows\)/);
});

test("effectiveSelections falls back per key", () => {
  const spec = { title: "{a} {b}", title_selectors: {
    a: { options: [{ id: "a1" }, { id: "a2" }], default: "a2" },
    b: { options: [{ id: "b1" }, { id: "b2" }] },
  } };
  assert.deepEqual(effectiveSelections(spec, { a: "nope", b: "b2" }), { a: "a2", b: "b2" });
  assert.deepEqual(effectiveSelections(spec, {}), { a: "a2", b: "b1" });
  assert.equal(effectiveSelections({ title: "x" }, { a: "a1" }), undefined);
});

// Input reads: chart.yaml and its data file are read only from the working folder, never the archive.
const ARCHIVED_CSV = join(REPO_ROOT, "charts", "articles", "2026", "10", "revenue-potential-top-taxes", "capital-gains-laffer-curve", "data.csv");
const LAFFER_SPEC = readFileSync(join(FIXTURES, "laffer", "chart.yaml"), "utf8").replace(/^data:.*$/m, "");

function inputFolder(data) {
  const dir = join(mkdtempSync(join(tmpdir(), "slides input — it's ")), "w");
  mkdirSync(dir);
  writeFileSync(join(dir, "chart.yaml"), `${LAFFER_SPEC}\ndata: ${JSON.stringify(data)}\n`);
  return dir;
}
const cleanup = (dir) => rmSync(join(dir, ".."), { recursive: true, force: true });

test("input: a bare data filename loads from the folder", async () => {
  const dir = inputFolder("data.csv");
  try {
    copyFileSync(join(FIXTURES, "laffer", "data.csv"), join(dir, "data.csv"));
    const { rows } = await loadSpecAndRows(dir);
    assert.ok(rows.length > 0);
  } finally { cleanup(dir); }
});

test("input: an absolute data path into the archive is refused", async () => {
  for (const data of [ARCHIVED_CSV, { file: ARCHIVED_CSV }, ARCHIVED_CSV.replace(/\\/g, "/")]) {
    const dir = inputFolder(data);
    try {
      await assert.rejects(loadSpecAndRows(dir), /only a bare filename/, JSON.stringify(data));
    } finally { cleanup(dir); }
  }
});

test("input: drive, file:// and UNC forms of an archive path are refused, never read", async () => {
  const fwd = ARCHIVED_CSV.replace(/\\/g, "/");
  for (const data of [
    fwd.replace(/^([A-Za-z]):\//, "$1://"), // C://dev/... : looked like a URL, loadData read it as a file
    `file:///${fwd}`,
    { file: `file:///${fwd}` },
    "\\\\localhost\\" + ARCHIVED_CSV.replace(/^([A-Za-z]):/, "$1$"), // \\localhost\C$\... (UNC)
    "https://example.com/data.csv", // a string is a file to loadData
    { url: `file:///${fwd}` },
  ]) {
    const dir = inputFolder(data);
    try {
      await assert.rejects(loadSpecAndRows(dir), /only a bare filename|http\(s\)/, JSON.stringify(data));
    } finally { cleanup(dir); }
  }
});

test("input: a ../ data path is refused", async () => {
  for (const data of ["../data.csv", { file: "../data.csv" }, "..\\data.csv", "sub/data.csv"]) {
    const dir = inputFolder(data);
    try {
      writeFileSync(join(dir, "..", "data.csv"), readFileSync(join(FIXTURES, "laffer", "data.csv")));
      await assert.rejects(loadSpecAndRows(dir), /only a bare filename/, JSON.stringify(data));
    } finally { cleanup(dir); }
  }
});

test("input: URL data is not treated as a local path", async () => {
  // Port 9 on loopback refuses at once: the failure is the fetch, not a path refusal.
  const dir = inputFolder({ url: "http://127.0.0.1:9/data.csv", format: "csv" });
  try {
    await assert.rejects(loadSpecAndRows(dir), (e) => /Could not load the chart's data/.test(e.message) && !/bare filename|archive/.test(e.message));
  } finally { cleanup(dir); }
});

function linkOrSkip(t, target, path) {
  try { symlinkSync(target, path); return true; }
  catch (e) { t.skip(`cannot create symlinks here (${e.code})`); return false; }
}

test("input: a chart.yaml symlinked into a (fake) archive is refused", async (t) => {
  const base = mkdtempSync(join(tmpdir(), "slides input link "));
  try {
    const fakeRoot = join(base, "repo");
    mkdirSync(join(fakeRoot, "charts", "a"), { recursive: true });
    writeFileSync(join(fakeRoot, "charts", "a", "chart.yaml"), `${LAFFER_SPEC}\ndata: data.csv\n`);
    copyFileSync(join(FIXTURES, "laffer", "data.csv"), join(fakeRoot, "charts", "a", "data.csv"));
    const w = join(base, "w");
    mkdirSync(w);
    copyFileSync(join(FIXTURES, "laffer", "data.csv"), join(w, "data.csv"));
    if (!linkOrSkip(t, join(fakeRoot, "charts", "a", "chart.yaml"), join(w, "chart.yaml"))) return;
    await assert.rejects(loadSpecAndRows(w, fakeRoot), /inside the published archive/);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("input: a data file symlinked into a (fake) archive is refused", async (t) => {
  const base = mkdtempSync(join(tmpdir(), "slides input link "));
  try {
    const fakeRoot = join(base, "repo");
    mkdirSync(join(fakeRoot, "charts", "a"), { recursive: true });
    copyFileSync(join(FIXTURES, "laffer", "data.csv"), join(fakeRoot, "charts", "a", "data.csv"));
    const w = join(base, "w");
    mkdirSync(w);
    writeFileSync(join(w, "chart.yaml"), `${LAFFER_SPEC}\ndata: data.csv\n`);
    if (!linkOrSkip(t, join(fakeRoot, "charts", "a", "data.csv"), join(w, "data.csv"))) return;
    await assert.rejects(loadSpecAndRows(w, fakeRoot), /inside the published archive/);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

for (const [what, yaml, msg] of [
  ["a non-mapping chart.yaml", "- just\n- a list\n", /expected a YAML mapping/],
  ["a chart.yaml with no data field", `${LAFFER_SPEC}\n`, /no data field/],
]) {
  test(`input: ${what} removes the earlier render`, async () => {
    const dir = inputFolder("data.csv");
    try {
      writeFileSync(join(dir, "chart.yaml"), yaml);
      for (const ext of ["png", "svg"]) writeFileSync(join(dir, `w.${ext}`), "stale");
      const r = await run([dir, "--frame", "full"]);
      assert.equal(r.code, 1);
      assert.match(r.stderr, msg);
      assert.equal(existsSync(join(dir, "w.png")), false);
      assert.equal(existsSync(join(dir, "w.svg")), false);
    } finally { cleanup(dir); }
  });
}

test("input: the CLI refuses a ../ data path in one paragraph and removes the earlier render", async () => {
  const dir = inputFolder("../data.csv");
  try {
    for (const ext of ["png", "svg"]) writeFileSync(join(dir, `w.${ext}`), "stale");
    const r = await run([dir, "--frame", "full"]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /only a bare filename/);
    assert.doesNotMatch(r.stderr, NO_STACK);
    assert.equal(r.stderr.trim().split(/\r?\n/).length, 1, "one paragraph");
    assert.equal(existsSync(join(dir, "w.png")), false);
  } finally { cleanup(dir); }
});
