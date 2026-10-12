// Capture the exact spec and rows an interactive tool rendered, for a given URL state, into a
// slide-chart working folder (chart.yaml + data.csv + source.json) that render-slide.mjs renders.
//
// Usage: node scripts/slides/capture-interactive.mjs "<url>" [--pick <name-or-number> --to <working folder>]
//
// Without --pick it lists what the page mounted and writes nothing. It works by wrapping the tool's
// own engine script (the classic-script IIFE that declares `var BudgetLabChart`) so every
// mountChart/mountTable call is recorded with its spec, rows and selections.
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stringify as toYaml } from "yaml";
import { assertOutsideArchive } from "./paths.mjs";
import { writeSource } from "./source-json.mjs";

const USAGE = 'Usage: node scripts/slides/capture-interactive.mjs "<url>" [--pick <name-or-number> --to <working folder>]';
const NO_CAPTURES = "no charts were captured — this tool may not keep its state in the URL; only its default view can be captured";
const SETTLE_MS = 1_000;
const CAP_MS = 20_000;

// An error whose message is already the one paragraph the user should see.
class CaptureError extends Error {}
const fail = (msg) => { throw new CaptureError(msg); };
const firstLine = (e) => String(e?.message ?? e).split(/\r?\n/)[0];

// Appended to the engine script. esbuild's export object has getter-only properties, so the global
// is reassigned to a copy with wrapped mount functions rather than patched in place. The leading
// newline keeps it out of a trailing `//# sourceMappingURL` comment.
const SUFFIX = `
;(function () {
  if (typeof BudgetLabChart === "undefined") return;
  var cap = (window.__tblCaptures = window.__tblCaptures || []);
  var o = BudgetLabChart, clone = function (v) { return v == null ? null : JSON.parse(JSON.stringify(v)); };
  var wrap = function (kind, fn) {
    return function (el, opts) {
      try { cap.push({ kind: kind, spec: clone(opts.spec), rows: clone(opts.rows || []),
        selections: clone(opts.selections), downloadName: opts.downloadName || null }); } catch (e) {}
      return fn.apply(this, arguments);
    };
  };
  var next = {}; for (var k in o) next[k] = o[k];
  next.mountChart = wrap("chart", o.mountChart); next.mountTable = wrap("table", o.mountTable);
  window.__tblEngineVersion = o.version || null;
  BudgetLabChart = next;
})();
`;

export function parseArgs(argv) {
  const opts = { url: undefined, pick: undefined, to: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--pick") opts.pick = argv[++i];
    else if (a.startsWith("--pick=")) opts.pick = a.slice("--pick=".length);
    else if (a === "--to") opts.to = argv[++i];
    else if (a.startsWith("--to=")) opts.to = a.slice("--to=".length);
    else if (a.startsWith("--")) fail(`Unknown option ${a}. ${USAGE}`);
    else if (opts.url === undefined) opts.url = a;
    else fail(`Unexpected argument "${a}". ${USAGE}`);
  }
  if (!opts.url) fail(USAGE);
  let u;
  try { u = new URL(opts.url); } catch { u = null; }
  if (!u || !/^https?:$/.test(u.protocol)) fail(`"${opts.url}" is not an http(s) URL. ${USAGE}`);
  if ((opts.pick === undefined) !== (opts.to === undefined) || opts.pick === "" || opts.to === "") {
    fail(`--pick and --to go together. ${USAGE}`);
  }
  return opts;
}

// RFC 4180: quote a field holding a comma, quote, CR or LF; double embedded quotes.
const csvField = (v) => {
  const s = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(rows) {
  if (!rows.length) return "";
  const keys = [];
  const seen = new Set();
  for (const r of rows) for (const k of Object.keys(r)) if (!seen.has(k)) { seen.add(k); keys.push(k); }
  return [keys, ...rows.map((r) => keys.map((k) => r[k]))].map((cells) => cells.map(csvField).join(",")).join("\n") + "\n";
}

// A tool re-mounts a figure on every control change; the last call is what is on screen.
export function dedupeCaptures(captures) {
  const byKey = new Map();
  for (const c of captures) byKey.set(JSON.stringify([c.spec, c.selections]), c);
  return [...byKey.values()];
}

export function pickCapture(captures, pick) {
  if (/^\d+$/.test(pick)) {
    const c = captures[Number(pick) - 1];
    if (c) return c;
  } else {
    const hits = captures.map((c, i) => [c, i + 1]).filter(([c]) => c.downloadName === pick);
    if (hits.length === 1) return hits[0][0];
    if (hits.length > 1) fail(`"${pick}" names ${hits.length} captured figures (${hits.map(([, n]) => n).join(", ")}); pick by number.`);
  }
  fail(`No captured figure "${pick}". Run without --pick to list them.`);
}

export function listing(captures, url, engineVersion) {
  const rows = captures.map((c, i) => [`${i + 1}.`, c.downloadName ?? "(unnamed)", c.kind, c.spec?.title ?? ""]);
  const widths = [0, 1, 2].map((j) => Math.max(...rows.map((r) => r[j].length)));
  const head = `${captures.length} figure${captures.length === 1 ? "" : "s"} captured from ${url} (tool engine ${engineVersion ?? "unknown"}):`;
  return [head, ...rows.map((r) => `  ${r[0].padStart(widths[0])} ${r[1].padEnd(widths[1])}  ${r[2].padEnd(widths[2])}  ${r[3]}`.trimEnd())].join("\n");
}

async function engineVersionFrom(page, scriptUrl, fromPage) {
  if (fromPage) return String(fromPage);
  if (!scriptUrl) return null;
  try {
    const r = await page.request.get(new URL("VERSION", scriptUrl).href);
    const v = r.ok() ? (await r.text()).trim() : "";
    return /^v?\d+\.\d+\.\d+\S*$/.test(v) ? v.replace(/^v/, "") : null;
  } catch {
    return null;
  }
}

export async function captureInteractive(url, { settleMs = SETTLE_MS, capMs = CAP_MS } = {}) {
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
    let engineScript = null;
    // A predicate, not "**/*.js": tools load their scripts with a cache-busting query (live.js?v=…),
    // which a glob ending in .js does not match.
    await page.route((u) => u.pathname.toLowerCase().endsWith(".js"), async (route) => {
      let response;
      try {
        response = await route.fetch();
      } catch {
        return route.continue().catch(() => {});
      }
      const body = await response.body();
      if (!body.toString("latin1").includes("var BudgetLabChart")) return route.fulfill({ response });
      engineScript ??= route.request().url();
      // The body is already decoded, so drop the original encoding and length headers.
      const headers = { ...response.headers() };
      for (const h of ["content-encoding", "content-length", "transfer-encoding"]) delete headers[h];
      return route.fulfill({ status: response.status(), headers, body: Buffer.concat([body, Buffer.from(SUFFIX, "utf8")]) });
    });

    let resp;
    try {
      resp = await page.goto(url, { waitUntil: "load", timeout: 60_000 });
    } catch (e) {
      fail(`Could not load ${url}: ${firstLine(e)}`);
    }
    if (resp && !resp.ok()) fail(`Could not load ${url}: HTTP ${resp.status()}.`);
    await page.waitForLoadState("networkidle", { timeout: capMs }).catch(() => {});

    const count = () => page.evaluate(() => (window.__tblCaptures || []).length);
    const start = Date.now();
    let last = await count(), since = Date.now();
    while (Date.now() - since < settleMs && Date.now() - start < capMs) {
      await page.waitForTimeout(100);
      const n = await count();
      if (n !== last) { last = n; since = Date.now(); }
    }
    const raw = await page.evaluate(() => ({ captures: window.__tblCaptures || [], version: window.__tblEngineVersion || null }));
    return { captures: dedupeCaptures(raw.captures), engineVersion: await engineVersionFrom(page, engineScript, raw.version) };
  } finally {
    await browser.close();
  }
}

export function writeCapture(to, cap, { url, engineVersion }) {
  const dir = resolve(to);
  const files = [
    ["chart.yaml", toYaml({ ...cap.spec, data: "data.csv" })],
    ["data.csv", toCsv(cap.rows ?? [])],
  ];
  for (const [name] of [...files, ["source.json"]]) assertOutsideArchive(join(dir, name));
  mkdirSync(dir, { recursive: true });
  for (const [name, text] of files) writeFileSync(join(dir, name), text, "utf-8");
  writeSource(dir, {
    origin: "interactive",
    url,
    captured_at: new Date().toISOString(),
    selections: cap.selections ?? {},
    tool_engine_version: engineVersion,
  });
  return dir;
}

export async function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  if (opts.to) assertOutsideArchive(resolve(opts.to));
  const { captures, engineVersion } = await captureInteractive(opts.url);
  if (!captures.length) fail(NO_CAPTURES);
  if (opts.pick === undefined) {
    console.log(listing(captures, opts.url, engineVersion));
    return;
  }
  const cap = pickCapture(captures, opts.pick);
  const name = cap.downloadName ?? `#${opts.pick}`;
  if (cap.kind !== "chart") fail(`"${name}" is a table; tables are not supported as slide charts.`);
  const dir = writeCapture(opts.to, cap, { url: opts.url, engineVersion });
  console.log(`Captured ${name} (tool engine ${engineVersion ?? "unknown"}) -> ${dir}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (e) {
    console.error(e instanceof CaptureError || /inside the published archive/.test(e?.message) ? e.message : `capture-interactive failed: ${firstLine(e)}`);
    process.exitCode = 1;
  }
}
