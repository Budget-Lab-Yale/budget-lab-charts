/**
 * e2e.test.mjs — end-to-end incremental-BUILD check (chromium-free; thumbs not exercised).
 *
 * Flow:
 *   1. Full build (no GH_PAGES_DIR) of the repo's real charts.
 *   2. Snapshot dist/ into a temp gh-pages dir; move dist/.manifest.json -> gh/.build/manifest.json.
 *   3. Rebuild with GH_PAGES_DIR=gh; expect everything reused, nothing rendered.
 *   4. Mutate one real data.csv; rebuild; expect exactly 1 chart rendered.
 * The mutated file is restored in a finally so the working tree is left clean.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = process.cwd();

/** Run build-all.mjs and return combined stdout. */
function runBuild(env) {
  return execFileSync(process.execPath, ["scripts/build-all.mjs"], {
    cwd: REPO,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
}

/** Find the first data.csv under charts/. */
function findDataCsv(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      const found = findDataCsv(p);
      if (found) return found;
    } else if (e.name === "data.csv") {
      return p;
    }
  }
  return null;
}

test("incremental build reuses unchanged charts and renders only what changed", { concurrency: false }, () => {
  const dataCsv = findDataCsv(join(REPO, "charts"));
  assert.ok(dataCsv, "expected at least one charts/**/data.csv");
  const original = readFileSync(dataCsv);

  try {
    // 1. Full build (GH_PAGES_DIR="" forces a full, non-incremental build).
    runBuild({ GH_PAGES_DIR: "" });

    // 2. Snapshot dist/ into a temp gh-pages dir and stage the prior manifest.
    const gh = mkdtempSync(join(tmpdir(), "ghp-"));
    cpSync(join(REPO, "dist"), gh, { recursive: true });
    mkdirSync(join(gh, ".build"), { recursive: true });
    cpSync(join(gh, ".manifest.json"), join(gh, ".build", "manifest.json"));

    // 3. Rebuild pointing at the snapshot: nothing changed -> all reused, none rendered.
    const noChange = runBuild({ GH_PAGES_DIR: gh });
    assert.match(noChange, /reused \d+/);
    assert.doesNotMatch(noChange, /rendered [1-9]/);

    // 4. Mutate one data.csv (append a harmless byte) and rebuild: exactly 1 rendered.
    writeFileSync(dataCsv, Buffer.concat([original, Buffer.from("\n")]));
    const oneChange = runBuild({ GH_PAGES_DIR: gh });
    assert.match(oneChange, /rendered 1/);
  } finally {
    // Restore the mutated file so the working tree is left clean.
    writeFileSync(dataCsv, original);
  }
});
