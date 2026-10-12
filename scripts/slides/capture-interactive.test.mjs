// Integration tests for capture-interactive.mjs. A tiny static server hosts fixtures/tool/ (a fake
// tool with a fake engine); every CLI run launches Chromium, so they run once, concurrently, in
// `before`, and the assertions share the results.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { REPO_ROOT } from "../lib.mjs";
import { dedupeCaptures, parseArgs, pickCapture, toCsv } from "./capture-interactive.mjs";

const SCRIPT = fileURLToPath(new URL("./capture-interactive.mjs", import.meta.url));
const RENDER = fileURLToPath(new URL("./render-slide.mjs", import.meta.url));
const TOOL = fileURLToPath(new URL("./fixtures/tool/", import.meta.url));
const PINNED = JSON.parse(readFileSync(join(REPO_ROOT, "node_modules", "budget-lab-chart-engine", "package.json"), "utf8")).version;
const NO_STACK = /\n\s+at\s/;
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8" };

let server, base, root;
const runs = {};

function run(script, args) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [script, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    p.stdout.setEncoding("utf8").on("data", (d) => (stdout += d));
    p.stderr.setEncoding("utf8").on("data", (d) => (stderr += d));
    p.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}
const capture = (args) => run(SCRIPT, args);

before(async () => {
  server = createServer((req, res) => {
    const path = normalize(join(TOOL, decodeURIComponent(new URL(req.url, "http://x").pathname)));
    if (!path.startsWith(TOOL.replace(/[\\/]$/, "") + sep)) {
      res.writeHead(404).end("not found");
      return;
    }
    try {
      const body = readFileSync(path);
      res.writeHead(200, { "content-type": TYPES[extname(path)] ?? "text/plain; charset=utf-8" }).end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  base = `http://127.0.0.1:${server.address().port}`;
  // A SharePoint-style deck folder: spaces, an apostrophe, an em dash.
  root = mkdtempSync(join(tmpdir(), "Budget Lab Sharepoint — Russell Sage's deck "));
  const url = `${base}/index.html?tab=prices&figure=by-category`;
  const folder = (name) => join(root, "Slide charts", name);
  const jobs = {
    list: [url],
    table: [url, "--pick", "summary-table", "--to", folder("summary-table")],
    chart: [url, "--pick", "by-category", "--to", folder("by-category")],
    unknown: [url, "--pick", "2", "--to", folder("unknown-field")],
    none: [`${base}/no-engine.html`],
    archive: [url, "--pick", "1", "--to", join(REPO_ROOT, "charts", "slide-capture-test")],
  };
  await Promise.all(Object.entries(jobs).map(async ([key, args]) => {
    runs[key] = { dir: args[args.indexOf("--to") + 1], ...(await capture(args)) };
  }));
  runs.unknown.render = await run(RENDER, [runs.unknown.dir, "--frame", "full"]);
}, { timeout: 240_000 });

after(async () => {
  if (root) rmSync(root, { recursive: true, force: true });
  if (server) await new Promise((ok) => server.close(ok));
});

test("parseArgs: url, --pick, --to (both forms); usage errors", () => {
  assert.deepEqual(parseArgs(["https://x/?a=1"]), { url: "https://x/?a=1", pick: undefined, to: undefined });
  assert.deepEqual(parseArgs(["https://x/", "--pick", "2", "--to=C:\\a b\\c"]), { url: "https://x/", pick: "2", to: "C:\\a b\\c" });
  assert.throws(() => parseArgs([]), /Usage/);
  assert.throws(() => parseArgs(["https://x/", "--pick", "a"]), /--pick and --to go together/);
  assert.throws(() => parseArgs(["https://x/", "--to", "d"]), /--pick and --to go together/);
  assert.throws(() => parseArgs(["not a url"]), /http\(s\) URL/);
  assert.throws(() => parseArgs(["https://x/", "--bogus"]), /Unknown option --bogus/);
});

test("toCsv: union of keys in first-seen order, RFC-4180 quoting, empty for missing", () => {
  const csv = toCsv([
    { a: 1, b: 'say "hi"' },
    { a: -0.5, c: "x,y" },
    { b: "two\nlines", c: null, a: "3" },
  ]);
  assert.equal(csv, 'a,b,c\n1,"say ""hi""",\n-0.5,,"x,y"\n3,"two\nlines",\n');
  assert.equal(toCsv([]), "");
});

test("dedupeCaptures: same spec + selections collapses to the last call, in first-seen position", () => {
  const a1 = { kind: "chart", spec: { t: 1 }, selections: null, rows: [1], downloadName: "a" };
  const b = { kind: "chart", spec: { t: 2 }, selections: null, rows: [], downloadName: "b" };
  const a2 = { ...a1, rows: [2] };
  const a3 = { ...a1, selections: { d: "x" }, rows: [3] };
  assert.deepEqual(dedupeCaptures([a1, b, a2, a3]), [a2, b, a3]);
});

test("pickCapture: by 1-based index or downloadName; unknown and ambiguous picks fail", () => {
  const caps = [{ downloadName: "a" }, { downloadName: "b" }, { downloadName: "b" }];
  assert.equal(pickCapture(caps, "1"), caps[0]);
  assert.equal(pickCapture(caps, "a"), caps[0]);
  assert.throws(() => pickCapture(caps, "4"), /No captured figure "4"/);
  assert.throws(() => pickCapture(caps, "z"), /No captured figure "z"/);
  assert.throws(() => pickCapture(caps, "b"), /"b" names 2 captured figures \(2, 3\); pick by number/);
});

test("1. list: 2 charts + 1 table, the re-mount de-duplicated; exits 0", () => {
  const r = runs.list;
  assert.equal(r.code, 0, r.stderr);
  const lines = r.stdout.trim().split(/\r?\n/);
  assert.match(lines[0], /3 figures captured .* \(tool engine 1\.12\.4\)/);
  assert.equal(lines.length, 4, r.stdout);
  assert.match(lines[1], /^\s*1\.\s+by-category\s+chart\s+Change in Prices by \{dimension\}$/);
  assert.match(lines[2], /^\s*2\.\s+unknown-field\s+chart\s+A Spec With an Unknown Field$/);
  assert.match(lines[3], /^\s*3\.\s+summary-table\s+table\s+Summary Statistics$/);
});

test("2. --pick <table>: exit 1, tables are not supported, nothing written", () => {
  const r = runs.table;
  assert.equal(r.code, 1);
  assert.match(r.stderr, /tables are not supported/);
  assert.doesNotMatch(r.stderr, NO_STACK);
  assert.equal(existsSync(r.dir), false);
});

test("3. --pick <chart>: chart.yaml, data.csv, source.json in a path with spaces, an apostrophe, an em dash", async () => {
  const r = runs.chart;
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(readdirSync(r.dir).sort(), ["chart.yaml", "data.csv", "source.json"]);

  const spec = parseYaml(readFileSync(join(r.dir, "chart.yaml"), "utf8"));
  assert.equal(spec.data, "data.csv");
  assert.equal(spec.title, "Change in Prices by {dimension}");
  assert.deepEqual(spec.title_selectors.dimension.options.map((o) => o.id), ["sector", "country"]);

  // The re-mount's rows (the last call), round-tripped through the engine's own CSV reader.
  const { loadData } = await import("budget-lab-chart-engine/data");
  const rows = await loadData(spec.data, { baseDir: r.dir });
  assert.deepEqual(rows, [
    { category: "Canada", value: "1.25", note: 'Includes "USMCA" goods' },
    { category: "Mexico", value: "-0.5", note: "" },
    { category: "EU, incl. UK", value: "0.75", note: "line one\nline two" },
    { category: "Rest of World", value: "3", note: "" },
  ]);

  // The captured spec + rows are valid for the pinned engine.
  const { validateChart } = await import("budget-lab-chart-engine/spec");
  const v = validateChart(spec, rows);
  assert.equal(v.valid, true, JSON.stringify(v.errors));

  const s = JSON.parse(readFileSync(join(r.dir, "source.json"), "utf8"));
  assert.equal(s.origin, "interactive");
  assert.equal(s.url, `${base}/index.html?tab=prices&figure=by-category`);
  assert.deepEqual(s.selections, { dimension: "country" });
  assert.equal(s.tool_engine_version, "1.12.4");
  assert.ok(!Number.isNaN(Date.parse(s.captured_at)) && s.captured_at.endsWith("Z"), s.captured_at);
});

test("4. a spec with an unknown field captures fine; render-slide fails with the validator message and the engine-version sentence", () => {
  const r = runs.unknown;
  assert.equal(r.code, 0, r.stderr);
  const spec = parseYaml(readFileSync(join(r.dir, "chart.yaml"), "utf8"));
  assert.equal(spec.colour_scheme, "blue");
  assert.deepEqual(JSON.parse(readFileSync(join(r.dir, "source.json"), "utf8")).selections, {});

  const rr = r.render;
  assert.equal(rr.code, 1);
  assert.match(rr.stderr, /unknown property "colour_scheme"/);
  assert.match(rr.stderr, new RegExp(`vendors engine 1\\.12\\.4; the charts repo pins ${PINNED.replace(/\./g, "\\.")}`));
  assert.doesNotMatch(rr.stderr, NO_STACK);
});

test("5. a page that never loads a BudgetLabChart script: exit 1, nothing captured", () => {
  const r = runs.none;
  assert.equal(r.code, 1);
  assert.match(r.stderr, /no charts were captured — this tool may not keep its state in the URL; only its default view can be captured/);
  assert.doesNotMatch(r.stderr, NO_STACK);
});

test("6. --to under charts/ is refused before anything is written", () => {
  const r = runs.archive;
  assert.equal(r.code, 1);
  assert.match(r.stderr, /inside the published archive/);
  assert.equal(existsSync(r.dir), false);
});
