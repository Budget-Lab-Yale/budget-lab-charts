# Incremental Build Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the CI build render/screenshot only charts whose content changed, in parallel, with all build state (manifest + thumbnail cache) resident on the `gh-pages` branch.

**Architecture:** A content hash per chart (`sha256(renderVersion + spec + data.csv)`) drives incrementality. Prior state is read from a `gh-pages` checkout at `$GH_PAGES_DIR` (`.gh-pages`). Unchanged charts are copied from that checkout; new/changed charts render (child-process pool) and screenshot (Chromium page pool), with thumbnails stored content-addressed at `.build/thumbs/<id>/<hash>.png`. Production deploys prune orphans behind a protected-path whitelist. `main` gains only script/workflow code.

**Tech Stack:** Node 20 ESM, `node:test` + `node:assert` (no new deps), Playwright (existing), `yaml` (existing), GitHub Actions.

## Global Constraints

- Node ≥ 20; ESM (`"type": "module"`). No new runtime dependencies.
- No chart-engine changes; `tbl-chart` renders one spec per invocation.
- Nothing build-generated committed to `main` (no thumbnails, manifest, or cache).
- All new state lives under the `gh-pages` root `.build/` dir: `.build/manifest.json`, `.build/thumbs/<id>/<hash>.png`.
- Scripts degrade to a full build when `$GH_PAGES_DIR` is unset/missing or `--no-incremental` is passed. Default local `npm run all` stays a full build.
- Chart id = `<collection.slug>/<chart-folder>` (from `listCharts()`), already used across scripts.
- Concurrency defaults: `RENDER_CONCURRENCY ?? min(cpus,4)`, `THUMB_CONCURRENCY ?? min(cpus,4)`.

---

## File Structure

| File | Responsibility |
|---|---|
| `scripts/pool.mjs` *(new)* | Generic bounded-concurrency async worker pool. |
| `scripts/incremental.mjs` *(new)* | renderVersion, engine-version read, chart hashing, manifest read/write, chart diff. |
| `scripts/prune.mjs` *(new)* | Manifest-driven gh-pages prune with a protected-path whitelist. |
| `scripts/build-all.mjs` *(modify)* | Incremental render + child-process pool; write `dist/.manifest.json`. |
| `scripts/thumbs.mjs` *(modify)* | Incremental + Chromium page pool + content-addressed cache. |
| `scripts/assemble-site.mjs` *(modify)* | Emit `_site/.build/` (manifest + new/live cache entries). |
| `scripts/lib.mjs` *(unchanged)* | Existing chart listing + spawn helpers. |
| `test/*.test.mjs` *(new)* | Unit + integration tests. |
| `.github/workflows/ci.yml` *(modify)* | Checkout gh-pages → `.gh-pages`; wire env; cache-write on preview; prune on deploy. |
| `package.json` *(modify)* | Add `"test": "node --test"`. |

---

## Task 1: Bounded worker pool (`scripts/pool.mjs`)

**Files:**
- Create: `scripts/pool.mjs`
- Test: `test/pool.test.mjs`

**Interfaces:**
- Produces: `runPool(items: T[], concurrency: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]>` — results in input order; rejects on the first worker rejection after in-flight work settles; never runs more than `concurrency` workers at once.

- [ ] **Step 1: Write the failing test**

```js
// test/pool.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { runPool } from "../scripts/pool.mjs";

test("preserves input order regardless of completion order", async () => {
  const out = await runPool([30, 10, 20], 3, async (ms, i) => {
    await new Promise((r) => setTimeout(r, ms));
    return i;
  });
  assert.deepEqual(out, [0, 1, 2]);
});

test("never exceeds the concurrency cap", async () => {
  let active = 0, peak = 0;
  await runPool([...Array(20).keys()], 4, async () => {
    active++; peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 5));
    active--;
  });
  assert.ok(peak <= 4, `peak ${peak} exceeded 4`);
});

test("rejects if a worker throws", async () => {
  await assert.rejects(
    runPool([1, 2, 3], 2, async (n) => { if (n === 2) throw new Error("boom"); }),
    /boom/,
  );
});
```

- [ ] **Step 2: Run test to verify it fails** — `npm test -- test/pool.test.mjs` → FAIL (module not found).

- [ ] **Step 3: Implement**

```js
// scripts/pool.mjs
/** Run `worker` over `items` with at most `concurrency` in flight. Results keep input order. */
export async function runPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let next = 0;
  const n = Math.max(1, Math.min(concurrency | 0 || 1, items.length || 1));
  async function drain() {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, drain));
  return results;
}
```

- [ ] **Step 4: Run test to verify it passes** — `npm test -- test/pool.test.mjs` → PASS.
- [ ] **Step 5: Commit** — `git add scripts/pool.mjs test/pool.test.mjs && git commit -m "Add bounded worker pool"`

---

## Task 2: Incremental core (`scripts/incremental.mjs`)

**Files:**
- Create: `scripts/incremental.mjs`
- Test: `test/incremental.test.mjs`

**Interfaces:**
- Consumes: `REPO_ROOT` from `lib.mjs`.
- Produces:
  - `FONTS_EPOCH: number` (constant; bump if vendored fonts change).
  - `readEngineVersion(repoRoot?): string` — resolved engine ref from `package-lock.json` (the `git+...#<sha-or-tag>` of `budget-lab-chart-engine`); falls back to `"unknown"`.
  - `computeRenderVersion({ engineRef, thumbsEpoch, fontsEpoch }): string`.
  - `hashChart({ specBytes: Buffer|string, dataBytes: Buffer|string, renderVersion: string }): string` (sha256 hex).
  - `readManifest(path): { renderVersion: string, charts: Record<string,{hash:string}> } | null`.
  - `writeManifest(path, manifest): void`.
  - `diffCharts(currentHashes: Record<string,string>, prior: Manifest|null): { toBuild: string[], unchanged: string[], removed: string[] }` — every id is `toBuild` when `prior` is null or `prior.renderVersion` differs.

- [ ] **Step 1: Write the failing test**

```js
// test/incremental.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { hashChart, computeRenderVersion, diffCharts } from "../scripts/incremental.mjs";

test("hash is stable and input-sensitive", () => {
  const rv = computeRenderVersion({ engineRef: "e1", thumbsEpoch: 1, fontsEpoch: 1 });
  const a = hashChart({ specBytes: "spec", dataBytes: "1,2", renderVersion: rv });
  assert.equal(a, hashChart({ specBytes: "spec", dataBytes: "1,2", renderVersion: rv }));
  assert.notEqual(a, hashChart({ specBytes: "spec!", dataBytes: "1,2", renderVersion: rv }));
  assert.notEqual(a, hashChart({ specBytes: "spec", dataBytes: "1,3", renderVersion: rv }));
});

test("renderVersion bump invalidates the hash", () => {
  const base = { specBytes: "s", dataBytes: "d" };
  const h1 = hashChart({ ...base, renderVersion: computeRenderVersion({ engineRef: "e1", thumbsEpoch: 1, fontsEpoch: 1 }) });
  const h2 = hashChart({ ...base, renderVersion: computeRenderVersion({ engineRef: "e2", thumbsEpoch: 1, fontsEpoch: 1 }) });
  assert.notEqual(h1, h2);
});

test("diffCharts partitions new/changed/unchanged/removed", () => {
  const prior = { renderVersion: "rv1", charts: { a: { hash: "x" }, gone: { hash: "z" } } };
  const cur = { a: "x", b: "y" }; // a unchanged, b new, gone removed
  const d = diffCharts(cur, prior);
  assert.deepEqual(d.toBuild.sort(), ["b"]);
  assert.deepEqual(d.unchanged.sort(), ["a"]);
  assert.deepEqual(d.removed.sort(), ["gone"]);
});

test("renderVersion mismatch forces full rebuild", () => {
  const prior = { renderVersion: "OLD", charts: { a: { hash: "x" } } };
  const d = diffCharts({ a: "x" }, prior);
  assert.deepEqual(d.toBuild, ["a"]);
  assert.deepEqual(d.unchanged, []);
});
```

- [ ] **Step 2: Run test to verify it fails** — `npm test -- test/incremental.test.mjs` → FAIL.

- [ ] **Step 3: Implement**

```js
// scripts/incremental.mjs
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { REPO_ROOT } from "./lib.mjs";

/** Bump if vendored fonts change in a way that alters rendered output. */
export const FONTS_EPOCH = 1;

export function readEngineVersion(repoRoot = REPO_ROOT) {
  try {
    const lock = JSON.parse(readFileSync(join(repoRoot, "package-lock.json"), "utf8"));
    const pkg = lock.packages?.["node_modules/budget-lab-chart-engine"];
    return pkg?.resolved ?? pkg?.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

export function computeRenderVersion({ engineRef, thumbsEpoch, fontsEpoch }) {
  return `engine:${engineRef}|thumbs:${thumbsEpoch}|fonts:${fontsEpoch}`;
}

export function hashChart({ specBytes, dataBytes, renderVersion }) {
  const h = createHash("sha256");
  h.update(renderVersion); h.update("\0");
  h.update(specBytes); h.update("\0");
  h.update(dataBytes ?? "");
  return h.digest("hex");
}

export function readManifest(path) {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; }
}

export function writeManifest(path, manifest) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(manifest, null, 2) + "\n");
}

export function diffCharts(currentHashes, prior) {
  const rvMatch = prior && prior.renderVersion !== undefined;
  const priorCharts = prior?.charts ?? {};
  const toBuild = [], unchanged = [];
  for (const [id, hash] of Object.entries(currentHashes)) {
    const same = rvMatch && priorCharts[id]?.hash === hash;
    (same ? unchanged : toBuild).push(id);
  }
  const removed = Object.keys(priorCharts).filter((id) => !(id in currentHashes));
  return { toBuild, unchanged, removed };
}
```

- [ ] **Step 4: Run test to verify it passes** — PASS.
- [ ] **Step 5: Commit** — `git commit -m "Add incremental hashing + manifest core"`

---

## Task 3: Incremental + parallel render (`scripts/build-all.mjs`)

**Files:**
- Modify: `scripts/build-all.mjs`
- Test: `test/build-all.integration.test.mjs`

**Interfaces:**
- Consumes: `listCharts`, `buildTblChartCmd`, `REPO_ROOT` (lib.mjs); `runPool` (pool.mjs); `readEngineVersion`, `computeRenderVersion`, `hashChart`, `readManifest`, `writeManifest`, `diffCharts` (incremental.mjs); `THUMBS_EPOCH` imported from `thumbs.mjs`? No — keep epochs local. Import `FONTS_EPOCH` from incremental.mjs; read `THUMBS_EPOCH` value via a shared const: define `THUMBS_EPOCH` in `incremental.mjs` too (single source). **Decision:** move both epochs to `incremental.mjs` (`export const THUMBS_EPOCH = 1; export const FONTS_EPOCH = 1;`).
- Produces: `dist/.manifest.json` = `{ renderVersion, charts: { id: { hash } } }`; per-chart `dist/<id>/index.html` (+ `data.csv`) for every chart (rendered or reused).

**Behavior:**
- `GH_PAGES_DIR` env → prior state root (holds `.build/manifest.json` and per-chart `<id>/`). Unset or `--no-incremental` → treat prior as null (full build).
- Compute `renderVersion` and each chart's `hash`. `diffCharts` → `toBuild`, `unchanged`.
- Render `toBuild` charts via `runPool(..., RENDER_CONCURRENCY)` (each worker does the existing spawn + embed-injection + data copy).
- For `unchanged`, copy `${GH_PAGES_DIR}/<id>/index.html` and `data.csv` into `dist/<id>/`. If the reuse source is missing (e.g. cache drift), fall back to rendering that id.
- Write `dist/.manifest.json`. Print a summary line: `build: rendered R, reused U (of N)`.

- [ ] **Step 1: Write the failing integration test**

```js
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
```

- [ ] **Step 2: Run test to verify it fails** — FAIL (no `reused` summary yet).
- [ ] **Step 3: Implement** the incremental + pool logic described in **Behavior** (preserve the existing embed-injection `RESIZER_TAG`/`EMBED_HEAD` and `data.csv` copy inside the render worker).
- [ ] **Step 4: Run test to verify it passes** — PASS. Also run `npm run validate` to confirm nothing regressed.
- [ ] **Step 5: Commit** — `git commit -m "Incremental + parallel render in build-all"`

---

## Task 4: Incremental + parallel thumbnails + cache (`scripts/thumbs.mjs`)

**Files:**
- Modify: `scripts/thumbs.mjs`
- Test: `test/thumbs.unit.test.mjs` (cache-path resolution only; screenshotting is covered by the end-to-end test in Task 8).

**Interfaces:**
- Consumes: `listCharts` (lib.mjs); `runPool` (pool.mjs); manifest reader + hashing (incremental.mjs).
- Produces: `_site/<id>/thumb.png` for every chart; new cache entries at `_site/.build/thumbs/<id>/<hash>.png`. Export a pure helper `thumbCachePath(id, hash): string` (relative, `.build/thumbs/<id>/<hash>.png`) for testing.

**Behavior:**
- Read hashes from `_site/.build/manifest.json` (assembled by Task 5) — or `dist/.manifest.json` fallback.
- For each chart: cache root = `${GH_PAGES_DIR}/.build/thumbs` (prior) and `_site/.build/thumbs` (new).
  - Cache hit (prior or new) at `<id>/<hash>.png` → copy to `_site/<id>/thumb.png` and ensure it exists at `_site/.build/thumbs/<id>/<hash>.png`.
  - Miss → screenshot (existing logic) → write to both `_site/<id>/thumb.png` and `_site/.build/thumbs/<id>/<hash>.png`.
- Screenshot misses run through `runPool(..., THUMB_CONCURRENCY)` with `K` reusable Chromium pages from one browser.
- Summary line: `thumbs: screenshotted S, cache-hit H (of N)`.

- [ ] **Step 1: Write the failing test** for `thumbCachePath`:

```js
// test/thumbs.unit.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { thumbCachePath } from "../scripts/thumbs.mjs";
test("cache path is content-addressed under .build/thumbs", () => {
  assert.equal(thumbCachePath("ai-fiscal/x", "abc"), ".build/thumbs/ai-fiscal/x/abc.png");
});
```

- [ ] **Step 2: Run** — FAIL (not exported). Note: importing `thumbs.mjs` must not launch Chromium at import time — guard the run body behind `if (import.meta.url === pathToFileURL(process.argv[1]).href)` so the module is import-safe.
- [ ] **Step 3: Implement** the cache + pool + `thumbCachePath` export and the import guard.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** — `git commit -m "Incremental + parallel thumbnails with content-addressed cache"`

---

## Task 5: Assemble emits `.build/` (`scripts/assemble-site.mjs`)

**Files:**
- Modify: `scripts/assemble-site.mjs`

**Behavior:** After copying `dist/` → `_site/`, copy `dist/.manifest.json` → `_site/.build/manifest.json`. Carry forward still-live prior cache entries so a `keep_files:false` publish wouldn't lose them: for each `unchanged`/reused chart, copy `${GH_PAGES_DIR}/.build/thumbs/<id>/<hash>.png` → `_site/.build/thumbs/<id>/<hash>.png` when present. (Thumbs step also writes new ones; this guarantees `_site/.build/thumbs` is complete for the current manifest.)

- [ ] **Step 1:** Add the manifest copy + cache carry-forward (guarded on `GH_PAGES_DIR`).
- [ ] **Step 2:** Run `npm run build && npm run catalog && npm run site` locally; assert `_site/.build/manifest.json` exists and lists every chart id.
- [ ] **Step 3: Commit** — `git commit -m "Assemble _site/.build (manifest + live cache)"`

---

## Task 6: Manifest-driven prune (`scripts/prune.mjs`)

**Files:**
- Create: `scripts/prune.mjs`
- Test: `test/prune.test.mjs`

**Interfaces:**
- Produces: `classifyForPrune({ entries: string[], manifestIds: string[], openPrNumbers: number[] }): { deleteChartDirs: string[], deletePreviewDirs: string[], keep: string[] }`. A pure classifier over top-level gh-pages entries; the file also has a thin `main()` that applies deletions to `$GH_PAGES_DIR`.
- **Protected paths (never deleted):** `catalog`, `embed`, `fonts`, `index.html`, `CNAME`, `.nojekyll`, `.build`, and `pr-preview` itself. Under `pr-preview/`, only `pr-<n>` dirs whose `n ∉ openPrNumbers` are deleted.
- A top-level entry is a deletable chart dir only if it is a directory, not protected, and matches an id's collection segment that is absent from `manifestIds`. (Chart ids are 2-segment; prune whole collection dirs only when none of their charts remain in the manifest, and individual `<collection>/<chart>` dirs otherwise.)

- [ ] **Step 1: Write the failing test**

```js
// test/prune.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyForPrune } from "../scripts/prune.mjs";

test("keeps protected paths, prunes orphan chart + closed previews", () => {
  const r = classifyForPrune({
    entries: ["catalog", "embed", "fonts", "index.html", ".nojekyll", ".build",
              "col-a/chart-1", "col-a/chart-2", "col-dead/old", "pr-preview/pr-6", "pr-preview/pr-99"],
    manifestIds: ["col-a/chart-1", "col-a/chart-2"],
    openPrNumbers: [99],
  });
  assert.deepEqual(r.deleteChartDirs.sort(), ["col-dead/old"]);
  assert.deepEqual(r.deletePreviewDirs.sort(), ["pr-preview/pr-6"]);
  for (const p of ["catalog", "embed", "fonts", "index.html", ".nojekyll", ".build",
                   "col-a/chart-1", "col-a/chart-2", "pr-preview/pr-99"]) assert.ok(r.keep.includes(p));
});
```

- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** `classifyForPrune` (pure) + `main()` (reads manifest ids from `$GH_PAGES_DIR/.build/manifest.json`, open PRs from a `--open-prs` CSV arg, walks 2 levels, deletes classified paths, logs a summary). `main()` runs only under the import guard.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** — `git commit -m "Add manifest-driven gh-pages prune"`

---

## Task 7: Wire the workflow (`.github/workflows/ci.yml`)

**Files:**
- Modify: `.github/workflows/ci.yml`

**Behavior (both `preview` and `deploy` build steps):**
1. Add a step (before build) that checks out gh-pages into `.gh-pages`:
   ```yaml
   - name: Fetch prior gh-pages state
     uses: actions/checkout@v5
     with: { ref: gh-pages, path: .gh-pages }
     continue-on-error: true   # first ever run has no gh-pages
   ```
2. Export `GH_PAGES_DIR=${{ github.workspace }}/.gh-pages` for the build/catalog/site/thumbs run.
3. `preview` job: after `thumbs`, add a step that pushes new cache entries + manifest to the **gh-pages root** `.build/` (so a later production build reuses them) using `peaceiris/actions-gh-pages@v4` with `keep_files: true` and `publish_dir: ./_site/.build` → `destination_dir: .build`. This joins the existing `concurrency: gh-pages` group.
4. `deploy` job: after publishing `_site`, add a prune step:
   ```yaml
   - name: Prune orphans
     run: node scripts/prune.mjs --open-prs "$(gh pr list --state open --json number -q '[.[].number]|join(",")')"
     env: { GH_PAGES_DIR: ${{ github.workspace }}/.gh-pages, GH_TOKEN: ${{ secrets.GITHUB_TOKEN }} }
   ```
   then commit/push `.gh-pages` deletions (a small `git -C .gh-pages commit/push`, guarded to no-op when nothing changed).
5. Leave the `validate` job untouched.

- [ ] **Step 1:** Apply the YAML edits above to both jobs.
- [ ] **Step 2:** Lint locally: `python -c "import yaml,sys; yaml.safe_load(open('.github/workflows/ci.yml'))"` (or `npx --yes yaml-lint`) → no errors.
- [ ] **Step 3: Commit** — `git commit -m "Wire incremental state + prune into CI"`

---

## Task 8: Test script, end-to-end check, docs

**Files:**
- Modify: `package.json` (add `"test": "node --test"`)
- Create: `test/e2e.test.mjs`
- Modify: `README.md` (short "Incremental builds" note)

- [ ] **Step 1:** Add `"test": "node --test"` to `package.json` scripts.
- [ ] **Step 2:** Write `test/e2e.test.mjs`: full `build → catalog → site → thumbs` against the real charts into temp dirs; snapshot to a temp `GH_PAGES_DIR`; re-run and assert `build: rendered 0`, `thumbs: screenshotted 0`, and every `_site/<id>/thumb.png` exists. Mutate one `data.csv`, re-run, assert exactly 1 rendered + 1 screenshotted.
- [ ] **Step 3:** Run `npm test` → all pass. Run `npm run all` → completes, `_site/.build/manifest.json` present.
- [ ] **Step 4:** Add the README note (state lives on gh-pages; `GH_PAGES_DIR`; `--no-incremental`; epoch bumps).
- [ ] **Step 5: Commit** — `git commit -m "Add test script, e2e test, incremental-build docs"`

---

## Self-Review

- **Spec coverage:** incrementality (T2,3,4), gh-pages-resident manifest+cache (T2,4,5,7), parallel render (T3) + thumbnails (T4), preview→prod reuse (content-addressed cache T4 + root cache push T7), prune + whitelist (T6,7), phased/independently-committable (each task commits). ✓
- **Placeholder scan:** none. ✓
- **Type consistency:** `renderVersion`, `hashChart`, `diffCharts`, `readManifest`/`writeManifest`, `runPool`, `thumbCachePath`, `classifyForPrune` used with consistent signatures across tasks; epochs single-sourced in `incremental.mjs`. ✓
