import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
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
