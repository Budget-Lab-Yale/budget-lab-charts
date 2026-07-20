// test/build-all.integration.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Helper: run build-all against a temp charts root + gh-pages dir.
function run(env) {
  return execFileSync(process.execPath, ["scripts/build-all.mjs"], {
    env: { ...process.env, ...env }, encoding: "utf8",
  });
}

test("second build with no change reuses instead of rendering", { concurrency: false }, () => {
  // Build once (full), snapshot dist -> gh-pages dir, build again pointing at it.
  const out1 = run({}); // full build of the repo's real charts
  const gh = mkdtempSync(join(tmpdir(), "ghp-"));
  cpSync(join(process.cwd(), "dist"), gh, { recursive: true });
  // move dist/.manifest.json into gh/.build/manifest.json
  mkdirSync(join(gh, ".build"), { recursive: true });
  cpSync(join(gh, ".manifest.json"), join(gh, ".build", "manifest.json"));
  const out2 = run({ GH_PAGES_DIR: gh });
  assert.match(out2, /reused \d+/);
  assert.doesNotMatch(out2, /rendered [1-9]/); // 0 rendered on a no-op rebuild
});
