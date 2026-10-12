import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

test("writeSource merges", () => {
  const base = mkdtempSync(join(tmpdir(), "slides src "));
  try {
    assert.equal(readSource(base), null);
    writeSource(base, { a: 1 });
    writeSource(base, { b: 2 });
    assert.deepEqual(readSource(base), { a: 1, b: 2 });
  } finally { rmSync(base, { recursive: true, force: true }); }
});

import { writeFileSync, readFileSync, symlinkSync } from "node:fs";
import { localDataFile, writeFigure } from "./fetch-archived.mjs";

const bytes = (s) => Buffer.from(s, "utf-8");

test("localDataFile: string and { file } are local; URL and other objects are not", () => {
  assert.equal(localDataFile("data.csv"), "data.csv");
  assert.equal(localDataFile({ file: "data.csv" }), "data.csv");
  assert.equal(localDataFile("https://example.com/x.csv"), null);
  assert.equal(localDataFile({ url: "https://example.com/x.csv" }), null);
  assert.equal(localDataFile(undefined), null);
  assert.throws(() => localDataFile({ file: "../secret.csv" }), /bare filename/);
  assert.throws(() => localDataFile("a/b.csv"), /bare filename/);
  assert.throws(() => localDataFile(".."), /bare filename/);
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
