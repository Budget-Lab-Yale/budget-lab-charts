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
