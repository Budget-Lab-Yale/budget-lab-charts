import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkNode, checkEngineInstalled, checkEngineVersion, checkBundle,
  checkChromium, checkFigtree, checkPowerPoint, checkPlatform,
  compareVersions, formatResults, exitCode,
} from "./preflight.mjs";

test("compareVersions", () => {
  assert.ok(compareVersions("1.17.0", "1.17.0") === 0);
  assert.ok(compareVersions("1.16.3", "1.17.0") < 0);
  assert.ok(compareVersions("1.100.0", "1.17.0") > 0);
  assert.ok(compareVersions("2.0.0", "1.17.0") > 0);
});

test("checkNode", () => {
  assert.equal(checkNode("v20.0.0").ok, true);
  assert.equal(checkNode("v22.3.1").ok, true);
  const bad = checkNode("v18.19.0");
  assert.equal(bad.ok, false);
  assert.match(bad.fix, /nodejs\.org/);
});

test("checkEngineInstalled", () => {
  assert.equal(checkEngineInstalled(true).ok, true);
  const bad = checkEngineInstalled(false);
  assert.equal(bad.ok, false);
  assert.match(bad.fix, /npm ci/);
});

test("checkEngineVersion", () => {
  assert.equal(checkEngineVersion("1.17.0").ok, true);
  assert.equal(checkEngineVersion("1.18.2").ok, true);
  const old = checkEngineVersion("1.16.3");
  assert.equal(old.ok, false);
  assert.match(old.fix, /git pull, then npm ci \(the repo must pin v1\.17\.0\+\)/);
  assert.equal(checkEngineVersion(null).ok, false);
});

test("checkBundle", () => {
  assert.equal(checkBundle("var x=1;function buildExportSvg(){}").ok, true);
  const bad = checkBundle("var x=1;");
  assert.equal(bad.ok, false);
  assert.match(bad.fix, /git pull, then npm ci/);
  assert.equal(checkBundle(null, "boom").ok, false);
  assert.match(checkBundle(null, "boom").detail, /boom/);
});

test("checkChromium", () => {
  assert.equal(checkChromium({ ok: true }).ok, true);
  const bad = checkChromium({ ok: false, error: "no exe" });
  assert.equal(bad.ok, false);
  assert.match(bad.fix, /npx playwright install chromium/);
});

test("checkFigtree", () => {
  assert.equal(checkFigtree({ ok: true, loaded: true }).ok, true);
  const bad = checkFigtree({ ok: true, loaded: false });
  assert.equal(bad.ok, false);
  assert.match(bad.fix, /Figtree — rerun npm ci/);
  assert.equal(checkFigtree({ ok: false, error: "x" }).ok, false);
});

test("checkPowerPoint", () => {
  assert.equal(checkPowerPoint({ status: 0, stdout: "True\r\n" }).ok, true);
  const no = checkPowerPoint({ status: 0, stdout: "False\r\n" });
  assert.equal(no.ok, false);
  assert.match(no.fix, /desktop PowerPoint \(classic\)/);
  assert.equal(checkPowerPoint({ status: 1, stdout: "" }).ok, false);
  assert.equal(checkPowerPoint(null).ok, false);
});

test("checkPlatform", () => {
  assert.equal(checkPlatform("win32").ok, true);
  const bad = checkPlatform("darwin");
  assert.equal(bad.ok, false);
  assert.match(bad.fix, /needs Windows; rendering still works/);
});

test("formatResults and exitCode", () => {
  const results = [
    { name: "a", ok: true },
    { name: "b", ok: false, fix: "do the thing" },
  ];
  const out = formatResults(results);
  assert.match(out, /OK\s+a/);
  assert.match(out, /FAIL\s+b/);
  assert.match(out, /do the thing/);
  assert.equal(exitCode(results), 1);
  assert.equal(exitCode([results[0]]), 0);
});
