// test/build-all.integration.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, cpSync, readdirSync } from "node:fs";
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

// Reused pages are copied from gh-pages, never re-rendered, so the static fallback must be
// strip-and-inserted on that path too: a page published before the fallback existed gets one, and a
// stale block is replaced rather than duplicated.
test("reused pages get exactly one fresh static block", { concurrency: false }, () => {
  run({ GH_PAGES_DIR: "" });
  const gh = mkdtempSync(join(tmpdir(), "ghp-"));
  cpSync(join(process.cwd(), "dist"), gh, { recursive: true });
  mkdirSync(join(gh, ".build"), { recursive: true });
  cpSync(join(gh, ".manifest.json"), join(gh, ".build", "manifest.json"));

  const strip = (html) => html
    .replace(/<!-- tbl-static-head:start -->[\s\S]*?<!-- tbl-static-head:end -->/g, "")
    .replace(/<!-- tbl-static:start -->[\s\S]*?<!-- tbl-static:end -->/g, "");
  const prePage = join(gh, "scf-2025-tax-takeaways", "estate-tax-exemption", "index.html");
  writeFileSync(prePage, strip(readFileSync(prePage, "utf8")));
  const stalePage = join(gh, "scf-2025-tax-takeaways", "roth-ira", "index.html");
  writeFileSync(stalePage, readFileSync(stalePage, "utf8")
    .replace(/<!-- tbl-static:start -->[\s\S]*?<!-- tbl-static:end -->/, "<!-- tbl-static:start -->STALE<!-- tbl-static:end -->"));

  const out = run({ GH_PAGES_DIR: gh });
  assert.match(out, /rendered 0,/);

  const dist = join(process.cwd(), "dist");
  for (const collection of readdirSync(dist, { withFileTypes: true })) {
    if (!collection.isDirectory()) continue;
    for (const chart of readdirSync(join(dist, collection.name))) {
      const html = readFileSync(join(dist, collection.name, chart, "index.html"), "utf8");
      for (const marker of ["tbl-static-head:start", "tbl-static-head:end", "tbl-static:start", "tbl-static:end"]) {
        assert.equal(html.split(`<!-- ${marker} -->`).length - 1, 1, `${collection.name}/${chart}: ${marker}`);
      }
    }
  }
  // A reused page must come out byte-identical to the rendered one, or every page churns on gh-pages
  // the first deploy after it was rendered.
  const untouched = join("ai-fiscal", "atr-by-decile", "index.html");
  assert.equal(readFileSync(join(dist, untouched), "utf8"), readFileSync(join(gh, untouched), "utf8"));
  const pre = readFileSync(join(dist, "scf-2025-tax-takeaways", "estate-tax-exemption", "index.html"), "utf8");
  assert.match(pre, /<h1>Figure 1 — Households age 75\+ and their wealth above the estate tax exemption<\/h1>/);
  assert.doesNotMatch(readFileSync(join(dist, "scf-2025-tax-takeaways", "roth-ira", "index.html"), "utf8"), /STALE/);
});
