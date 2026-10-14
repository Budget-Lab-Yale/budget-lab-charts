import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { REPO_ROOT } from "../lib.mjs";
import { readSource, writeSource } from "./source-json.mjs";

const SCRIPT = join(REPO_ROOT, "scripts", "slides", "fetch-archived.mjs");
const LAFFER = "articles/2026/10/revenue-potential-top-taxes/capital-gains-laffer-curve";
const run = (args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf-8" });

test("fetches chart.yaml and data.csv into a spaced path and writes source.json", () => {
  const base = mkdtempSync(join(tmpdir(), "slides fetch — it's "));
  try {
    const to = join(base, "Slide charts", "laffer");
    const r = run([LAFFER, "--to", to]);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(existsSync(join(to, "chart.yaml")));
    assert.ok(existsSync(join(to, "data.csv")));
    const src = readSource(to);
    assert.equal(src.origin, "archived");
    assert.equal(src.ref, LAFFER);
    assert.match(src.commit, /^[0-9a-f]{40}$/);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("resolves <slug>/<figure> by search", () => {
  const base = mkdtempSync(join(tmpdir(), "slides fetch "));
  try {
    const r = run(["revenue-potential-top-taxes/capital-gains-laffer-curve", "--to", join(base, "x")]);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(readSource(join(base, "x")).ref, LAFFER);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("resolves <collection slug>/<figure> when the slug differs from the folder name", () => {
  // article.yaml says slug: "emp-dispersion"; the folder is emp-dispersion-graphs.
  const base = mkdtempSync(join(tmpdir(), "slides fetch "));
  try {
    const r = run(["emp-dispersion/lfp-by-education", "--to", join(base, "e")]);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(readSource(join(base, "e")).ref, "articles/2026/09/emp-dispersion-graphs/lfp-by-education");
    assert.ok(existsSync(join(base, "e", "data.csv")));
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("a slug match still needs the figure to exist", () => {
  const base = mkdtempSync(join(tmpdir(), "slides fetch "));
  try {
    const r = run(["emp-dispersion/no-such-figure", "--to", join(base, "e")]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /No figure matches/);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("rejects table figures", () => {
  const base = mkdtempSync(join(tmpdir(), "slides fetch "));
  try {
    const r = run(["articles/2026/07/ai-fiscal/key-parameters", "--to", join(base, "t")]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /tables are not supported/);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("refuses --to inside charts/", () => {
  const r = run([LAFFER, "--to", join(REPO_ROOT, "charts", "tmp-slide-test")]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Refusing/);
  assert.ok(!existsSync(join(REPO_ROOT, "charts", "tmp-slide-test")));
});

test("unknown figure fails", () => {
  const base = mkdtempSync(join(tmpdir(), "slides fetch "));
  try {
    const r = run(["no-such-slug/nope", "--to", join(base, "n")]);
    assert.notEqual(r.status, 0);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

// writeSource merges because render-slide adds its keys to what fetch or capture wrote; fetch and
// capture themselves replace source.json (tested below).
test("writeSource merges (render-slide's keys join the fetch/capture keys)", () => {
  const base = mkdtempSync(join(tmpdir(), "slides src "));
  try {
    assert.equal(readSource(base), null);
    writeSource(base, { origin: "archived", ref: "r" });
    writeSource(base, { frame: "full", alt_text: "a" });
    assert.deepEqual(readSource(base), { origin: "archived", ref: "r", frame: "full", alt_text: "a" });
  } finally { rmSync(base, { recursive: true, force: true }); }
});

// A folder that last held an interactive capture and a render of it.
const PRIOR = {
  origin: "interactive", url: "https://example.com/tool?x=1", captured_at: "2026-10-01T00:00:00.000Z",
  selections: { dimension: "country" }, tool_engine_version: "1.13.0",
  engine_version: "1.16.3", frame: "half", keep_source: true, alt_text: "Line chart: an older figure",
};
function seedPrior(dir) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "source.json"), JSON.stringify(PRIOR, null, 2));
  for (const ext of ["png", "svg"]) writeFileSync(join(dir, `${basename(dir)}.${ext}`), "old render");
}

test("fetch replaces source.json and removes the earlier render", () => {
  const base = mkdtempSync(join(tmpdir(), "slides fetch — it's "));
  try {
    const to = join(base, "Slide charts", "laffer");
    seedPrior(to);
    const r = run([LAFFER, "--to", to]);
    assert.equal(r.status, 0, r.stderr);
    const src = readSource(to);
    assert.deepEqual(Object.keys(src).sort(), ["commit", "origin", "ref"], "replaced, not merged");
    assert.equal(src.ref, LAFFER);
    assert.equal(existsSync(join(to, "laffer.png")), false);
    assert.equal(existsSync(join(to, "laffer.svg")), false);
    assert.match(r.stderr, /Removed the earlier laffer\.png and laffer\.svg/);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

import { readFileSync, symlinkSync } from "node:fs";
import { localDataFile, writeFigure } from "./fetch-archived.mjs";

const bytes = (s) => Buffer.from(s, "utf-8");

// The engine's loadData reads every string, and every object with a `file` key, from disk; only an
// object without `file` is fetched, from its `url`. So only { url: "http(s)://..." } is remote.
test("localDataFile follows loadData: strings and { file } are local, only { url: http(s) } is remote", () => {
  assert.equal(localDataFile("data.csv"), "data.csv");
  assert.equal(localDataFile({ file: "data.csv" }), "data.csv");
  assert.equal(localDataFile({ url: "https://example.com/x.csv" }), null);
  assert.equal(localDataFile({ url: "http://example.com/x.json", map: {} }), null);
  assert.equal(localDataFile(undefined), null);
  assert.throws(() => localDataFile({ file: "../secret.csv" }), /bare filename/);
  assert.throws(() => localDataFile("a/b.csv"), /bare filename/);
  assert.throws(() => localDataFile(".."), /bare filename/);
  const archived = "C:\\dev\\GitHub\\budget-lab-charts\\charts\\a\\data.csv";
  for (const s of [
    "C://dev/GitHub/budget-lab-charts/charts/a/data.csv", // matched the old URL regex: read as a file
    archived,
    "file:///C:/dev/GitHub/budget-lab-charts/charts/a/data.csv",
    "\\\\server\\share\\charts\\a\\data.csv",
    "https://example.com/x.csv", // a string is a file path to loadData, never fetched
    "C:data.csv", // drive-relative
    "data.csv:stream",
  ]) {
    assert.throws(() => localDataFile(s), /bare filename/, s);
    assert.throws(() => localDataFile({ file: s }), /bare filename/, `{ file: ${s} }`);
  }
  // { file } wins over url in loadData, so it is local even beside a url.
  assert.throws(() => localDataFile({ file: archived, url: "https://example.com/x.csv" }), /bare filename/);
  // Anything else the engine would fetch must be http(s).
  for (const url of ["file:///C:/x/charts/a/data.csv", "C://x/charts/a/data.csv", "data:text/csv,a", undefined]) {
    assert.throws(() => localDataFile({ url }), /http\(s\)/, String(url));
  }
  assert.throws(() => localDataFile({ file: 7 }), /bare filename/);
  assert.throws(() => localDataFile(["a"]), /bare filename/);
});

test("writeFigure copies object-form data and keeps the spec as-is", () => {
  const base = mkdtempSync(join(tmpdir(), "slides wf — it's "));
  try {
    const spec = "data:\n  file: data.csv\n";
    writeFigure(join(base, "w"), bytes(spec), () => bytes("a,b\n1,2\n"), { origin: "archived" });
    assert.equal(readFileSync(join(base, "w", "chart.yaml"), "utf-8"), spec);
    assert.equal(readFileSync(join(base, "w", "data.csv"), "utf-8"), "a,b\n1,2\n");
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("writeFigure refuses { file: ../secret.csv } and leaves an existing chart.yaml untouched", () => {
  const base = mkdtempSync(join(tmpdir(), "slides wf "));
  try {
    const w = join(base, "w");
    mkdirSync(w);
    writeFileSync(join(w, "chart.yaml"), "original");
    assert.throws(() => writeFigure(w, bytes("data:\n  file: ../secret.csv\n"), () => bytes("x"), {}), /bare filename/);
    assert.equal(readFileSync(join(w, "chart.yaml"), "utf-8"), "original");
    // a failing blob read also leaves it untouched
    assert.throws(() => writeFigure(w, bytes("data: data.csv\n"), () => { throw new Error("missing blob"); }, {}), /missing blob/);
    assert.equal(readFileSync(join(w, "chart.yaml"), "utf-8"), "original");
    assert.equal(readSource(w), null);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

function linkOrSkip(t, target, path) {
  try { symlinkSync(target, path); return true; }
  catch (e) { t.skip(`cannot create symlinks here (${e.code})`); return false; }
}

test("writeFigure refuses to write through a symlink into the archive", (t) => {
  const base = mkdtempSync(join(tmpdir(), "slides link "));
  try {
    const fakeRoot = join(base, "repo");
    const archived = join(fakeRoot, "charts", "a", "chart.yaml");
    mkdirSync(join(fakeRoot, "charts", "a"), { recursive: true });
    writeFileSync(archived, "published");
    const w = join(base, "w");
    mkdirSync(w);
    if (!linkOrSkip(t, archived, join(w, "chart.yaml"))) return;
    assert.throws(() => writeFigure(w, bytes("x: 1\n"), () => bytes(""), {}, fakeRoot), /archive/);
    assert.equal(readFileSync(archived, "utf-8"), "published");
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("writeSource refuses to write through a symlink into the archive", (t) => {
  const base = mkdtempSync(join(tmpdir(), "slides link "));
  try {
    const fakeRoot = join(base, "repo");
    const archived = join(fakeRoot, "charts", "a", "source.json");
    mkdirSync(join(fakeRoot, "charts", "a"), { recursive: true });
    writeFileSync(archived, "{}");
    const w = join(base, "w");
    mkdirSync(w);
    if (!linkOrSkip(t, archived, join(w, "source.json"))) return;
    assert.throws(() => writeSource(w, { a: 1 }, fakeRoot), /archive/);
    assert.equal(readFileSync(archived, "utf-8"), "{}");
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("writeFigure writes source.json fresh and removes <folder>.png/.svg (no network)", () => {
  const base = mkdtempSync(join(tmpdir(), "slides wf — it's "));
  try {
    const w = join(base, "my-chart");
    seedPrior(w);
    writeFileSync(join(w, "other.png"), "not this folder's render");
    const r = writeFigure(w, bytes("data: data.csv\n"), () => bytes("a,b\n1,2\n"), { origin: "archived", ref: "x/y", commit: "c" });
    assert.deepEqual(readSource(w), { origin: "archived", ref: "x/y", commit: "c" });
    assert.deepEqual(r.removed, ["my-chart.png", "my-chart.svg"]);
    assert.equal(existsSync(join(w, "my-chart.png")), false);
    assert.equal(existsSync(join(w, "my-chart.svg")), false);
    assert.equal(existsSync(join(w, "other.png")), true);
    // Nothing to remove the second time.
    assert.deepEqual(writeFigure(w, bytes("data: data.csv\n"), () => bytes("a,b\n"), { origin: "archived" }).removed, []);
  } finally { rmSync(base, { recursive: true, force: true }); }
});
