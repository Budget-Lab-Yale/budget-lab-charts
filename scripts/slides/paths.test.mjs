import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REPO_ROOT } from "../lib.mjs";
import { assertOutsideArchive, slideChartsDir } from "./paths.mjs";

test("rejects paths inside charts/", () => {
  assert.throws(() => assertOutsideArchive(join(REPO_ROOT, "charts", "x")), /archive/);
  assert.throws(() => assertOutsideArchive(join(REPO_ROOT, "charts")), /archive/);
});

test("rejects a path reaching charts/ via ..", () => {
  assert.throws(() => assertOutsideArchive(join(REPO_ROOT, "scripts", "..", "charts", "x")), /archive/);
});

test("case-insensitive on win32", { skip: process.platform !== "win32" }, () => {
  assert.throws(() => assertOutsideArchive(join(REPO_ROOT, "CHARTS", "x")), /archive/);
});

test("accepts a SharePoint-style path with em dash and apostrophe", () => {
  const base = mkdtempSync(join(tmpdir(), "slides-paths-"));
  try {
    const deck = join(base, "Budget Lab Sharepoint", "20261015 Russell Sage — O'Neil deck");
    mkdirSync(deck, { recursive: true });
    const p = join(deck, "Slide charts", "x");
    assert.doesNotThrow(() => assertOutsideArchive(p));
    assert.equal(slideChartsDir(join(deck, "deck.pptx")), join(deck, "Slide charts"));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("rejects a directory whose name merely starts with '..' inside charts/", () => {
  assert.throws(() => assertOutsideArchive(join(REPO_ROOT, "charts", "..slide-work", "new")), /archive/);
  assert.throws(() => assertOutsideArchive(join(REPO_ROOT, "charts", "..foo", "x")), /archive/);
});

test("rejects a raw path reaching charts/ via .. (not normalised by join)", () => {
  assert.throws(() => assertOutsideArchive(REPO_ROOT + "/scripts/../charts/x"), /archive/);
});

// The targets below do not exist, and nothing is created under charts/: a write through either
// link would create its target there, so the guard must follow the link, not stop at its name.
function linkOrSkip(t, target, path, type) {
  try { symlinkSync(target, path, type); return true; }
  catch (e) { t.skip(`cannot create links here (${e.code})`); return false; }
}

test("rejects a dangling file symlink whose target is inside charts/", (t) => {
  const base = mkdtempSync(join(tmpdir(), "slides-paths-"));
  try {
    const link = join(base, "chart.yaml");
    if (!linkOrSkip(t, join(REPO_ROOT, "charts", "__slides_test_missing__.yaml"), link, "file")) return;
    assert.throws(() => assertOutsideArchive(link), /archive/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("rejects a path under a dangling directory link into charts/", (t) => {
  const base = mkdtempSync(join(tmpdir(), "slides-paths-"));
  try {
    const link = join(base, "w");
    if (!linkOrSkip(t, join(REPO_ROOT, "charts", "__slides_test_missing__"), link, "junction")) return;
    assert.throws(() => assertOutsideArchive(join(link, "chart.yaml")), /archive/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("a dangling link pointing outside charts/ is accepted", (t) => {
  const base = mkdtempSync(join(tmpdir(), "slides-paths-"));
  try {
    const link = join(base, "chart.yaml");
    if (!linkOrSkip(t, join(base, "elsewhere", "missing.yaml"), link, "file")) return;
    assert.doesNotThrow(() => assertOutsideArchive(link));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
