# Deployment pipeline: incremental builds, parallel rendering, gh-pages-resident cache

**Date:** 2026-07-20
**Repo:** `budget-lab-charts` (scripts + CI only — no engine changes).
**Status:** Design, pending review.

## Problem

Every CI build — both the per-PR **preview** job and the **production deploy** job — runs the
full pipeline from scratch over *all* charts, with no incrementality and no caching:

| Step | Per build | Cost |
|---|---|---|
| `build-all.mjs` | `rm -rf dist/`, then a **serial** loop that `spawnSync`s `tbl-chart render` once per chart | O(N) processes, serial |
| `build-catalog.mjs` | Re-reads every spec, rewrites `catalog/index.json` | O(N), cheap |
| `assemble-site.mjs` | `rm -rf _site/`, recursive copy of `dist/` | O(N) copy |
| `thumbs.mjs` | **Serial** Chromium loop: per chart `goto(networkidle)` → `waitForSelector` → 250 ms → `screenshot` | O(N) screenshots, serial — **dominant** |

At ~20 charts this is ~1 min. Extrapolated to 1000 charts: `thumbs` alone ≈ 20–60 min, `build`
≈ 10–15 min, so a preview or deploy trends toward **30–60+ min**. Because gh-pages writers are
serialized (`concurrency: gh-pages`), a long deploy blocks every queued preview. The `validate`
merge gate stays fast (no rendering), so *merging* isn't blocked — only *publishing*.

Root cause: the pipeline is **O(all charts) every time, most-expensive stage serial, nothing
cached**.

## Goals

1. Make render + thumbnail cost **O(changed charts)**, not O(all).
2. **Parallelize** the render and thumbnail passes.
3. Keep **all build state (thumbnails, manifest, cache) on the `gh-pages` branch**; `main` stays
   content-only — no committed artifacts, no manifest, no cache.
4. **Reuse preview-generated thumbnails on the merge deploy** — a chart screenshotted during a
   PR's preview is not re-screenshotted when that PR merges.
5. **Prune** outputs for removed charts and closed-PR previews so gh-pages stays tidy.

## Non-goals

- No chart-engine changes. The CLI renders one spec per invocation (no batch mode), so render
  parallelism is a **child-process pool**, not an engine feature.
- No build artifacts committed to `main`.
- No change to the `validate` merge gate.

## Key idea: gh-pages is the persistent state store

gh-pages already holds, at its root, every chart's `<id>/index.html`, `<id>/data.csv`, and
`<id>/thumb.png` (persisted by `keep_files: true`). We add two pieces of state **there** (never
on `main`):

- **Build manifest** — `.build/manifest.json` at the gh-pages root:
  ```json
  {
    "renderVersion": "engine@1.5.0+thumbs@3+fonts@1",
    "charts": { "<id>": { "hash": "<sha256>" } }
  }
  ```
- **Content-addressed thumbnail cache** — `.build/thumbs/<id>/<hash>.png` at the gh-pages root.

Both live under a single `.build/` dir so pruning and inspection are simple, and so nothing
about the cache leaks into the published URL space that embeds use.

### The chart hash

```
hash(chart) = sha256( renderVersion + "\0" + spec-bytes + "\0" + data.csv-bytes )
```

- `spec-bytes` = the raw `chart.yaml`/`table.yaml`; `data.csv-bytes` = the raw CSV (empty if
  absent). Raw bytes, not parsed — any meaningful change flips the hash.
- `renderVersion` is a composite salt so that changes to things *other* than the spec still
  invalidate correctly: the pinned engine version (from `package-lock.json`), a manually bumped
  `THUMBS_EPOCH` integer in `thumbs.mjs` (for screenshot-logic changes), and a `FONTS_EPOCH`
  (bumped if vendored fonts change). One salt string, computed once per build.

An engine bump changes `renderVersion` → every hash changes → full rebuild once. Correct and
intended.

## Incremental build algorithm (shared by preview and deploy)

1. **Fetch prior gh-pages state.** A CI step checks out the `gh-pages` branch into `./.gh-pages`
   (`actions/checkout` with `ref: gh-pages`, `path: .gh-pages`, shallow). Scripts read the prior
   `manifest.json`, the cache, and prior per-chart `index.html`/`data.csv` from there. Missing or
   unreadable state degrades gracefully to a full rebuild.
2. **Compute current hashes** for all charts (fast file hashing; `listCharts()` already
   enumerates them).
3. **Diff** against the prior manifest → three sets: `new`, `changed` (hash differs), `unchanged`
   (hash matches).
4. **Render** (`build-all.mjs`): render only `new ∪ changed` into `dist/`, via a **child-process
   pool** (below). For `unchanged`, copy the prior `<id>/index.html` + `data.csv` from
   `.gh-pages`.
5. **Thumbnails** (`thumbs.mjs`): for each chart, resolve by `(id, hash)`:
   - Cache hit at `.build/thumbs/<id>/<hash>.png` → copy into `_site/<id>/thumb.png`.
   - Miss → screenshot via a **Chromium pool** (below), write the PNG both to
     `_site/<id>/thumb.png` and back into the cache.
6. **Assemble** `_site/` from reused unchanged pages + freshly rendered changed pages + resolved
   thumbnails + `catalog/index.json` + landing page + `embed/`.
7. **Write updated state**: new `manifest.json` (current hashes + renderVersion) and any new
   cache entries, into `_site/.build/` so they publish to the gh-pages root alongside the site.
8. **Prune** (production only, step below).

Net effect: with no content change, a build renders 0 charts and screenshots 0 thumbnails
(pure copy + manifest rewrite). Change one chart → exactly one re-render and (if not already
cached) one screenshot.

## Parallelism (in-process pools, single job)

- **Render pool.** Replace the serial `spawnSync` loop with up to `C` concurrent `tbl-chart
  render` child processes drained from a queue. `C = min(os.cpus().length, RENDER_CONCURRENCY
  ?? 4)`.
- **Thumbnail pool.** One `chromium.launch()`, then `K` reusable page contexts each pulling from
  a shared queue of charts needing screenshots. `K = THUMB_CONCURRENCY ?? min(cpus, 4)` (Chromium
  pages are memory-heavy; keep K modest on 2-core CI runners).
- Only charts needing work enter the pools; combined with incrementality, most builds have a
  near-empty queue.

Speedup on GitHub's 2–4-core runners is ~2–4×; the dominant win at scale is incrementality, with
parallelism removing the residual serial cost when many charts *do* change. If full-rebuild
latency (e.g. an engine bump touching all N) ever becomes the pain point, escalate to CI
**job-matrix sharding** — shard charts across runners, upload per-shard `_site` fragments as
artifacts, combine them in a final job, and do a single gh-pages deploy. Documented as a future
step; not built now.

## Preview → production thumbnail reuse

Because the cache is keyed by content hash, a chart's thumbnail has the **same cache key** during
a PR's preview and after that PR merges. The preview job writes new thumbnails into the
**root-level** `.build/thumbs/` cache on gh-pages (not under `pr-preview/`), so:

- PR preview screenshots each changed chart once and populates the cache.
- On merge, the production deploy computes the same hashes, finds cache hits, and regenerates
  **zero** thumbnails (unless content changed between the last preview build and merge — e.g. a
  rebase — in which case the hash differs and it correctly regenerates).

Wrinkle to handle: the preview deploy action (`rossjrw/pr-preview-action`) owns only the
`pr-preview/pr-<n>/` subtree. Writing cache entries to the gh-pages *root* is a separate,
small commit to `gh-pages` (a dedicated step using a plain git push or `peaceiris` with
`keep_files: true` scoped to `.build/`). The existing `concurrency: gh-pages` group serializes
these writes so concurrent previews don't race.

## Pruning (production deploy only)

Driven by the current manifest:

- Delete gh-pages **chart dirs** (`<collection>/<chart>/`) whose id is not in the current
  manifest — fixes the `keep_files` orphan problem (removed/renamed charts).
- Delete `pr-preview/pr-<n>/` dirs for PRs that are closed (the preview action removes the
  merged/closed PR's own dir; this sweeps any stragglers — stale `pr-6`, `pr-32` exist today).
- GC cache: drop `.build/thumbs/<id>/<hash>.png` entries whose `(id, hash)` is not in the current
  manifest (keep only live thumbnails; optionally keep the single most-recent extra per id for
  fast rollback — omit for simplicity initially).

**Safety:** prune operates on an explicit **protected-path whitelist** — never touch
`catalog/`, `embed/`, `fonts/`, `index.html`, `CNAME`, `.nojekyll`, or `pr-preview/` (except
closed-PR cleanup). Prune only removes paths it can positively classify as a stale chart dir or
cache entry; anything unrecognized is left untouched and logged.

## Correctness & edge cases

- **First run / missing manifest** → full rebuild (graceful degrade).
- **Engine or epoch bump** → `renderVersion` changes → all hashes change → full rebuild, once.
- **Concurrent gh-pages writers** → already serialized by the workflow `concurrency` group; note
  the cache-write step joins that group.
- **Determinism** → thumbnails depend on engine + fonts + screenshot logic; all three are folded
  into `renderVersion`, so a cache hit is only reused when the rendering inputs are byte-stable.
- **Local runs** → without gh-pages state, scripts fall back to full build; a `--no-incremental`
  flag forces it. Local `npm run all` behavior is unchanged by default (full build) unless a
  `.gh-pages` dir is present.

## Rollout (independently shippable phases)

1. **Manifest + incremental reuse** (render + thumbnail skip-if-unchanged). Biggest win.
2. **Parallel pools** (render child-process pool, Chromium page pool).
3. **Content-addressed cache + preview→prod reuse.**
4. **Pruning + cache GC.**

## Verification

- **Unit:** hash determinism; `renderVersion` composition; manifest diff (new/changed/unchanged/
  removed); prune classifier respects the whitelist.
- **Integration (local, against a seeded `.gh-pages`):** build twice, no changes → 0 renders,
  0 screenshots; change one chart → 1 render, 1 screenshot; remove one → pruned; bump epoch →
  all rebuild.
- **CI timing:** record wall-clock before/after on current content; add a one-line build summary
  (`rendered X, reused Y, screenshotted Z, cache-hit W, pruned V`) to every run for observability.

## Files touched (all in this repo)

| File | Change |
|---|---|
| `scripts/lib.mjs` | Add: file-hash helper, `renderVersion` builder, manifest read/write, generic bounded worker-pool helper. |
| `scripts/build-all.mjs` | Incremental (render only new/changed; copy unchanged from `.gh-pages`) + child-process render pool. |
| `scripts/thumbs.mjs` | Incremental + Chromium page pool + content-addressed cache read/write; add `THUMBS_EPOCH`. |
| `scripts/assemble-site.mjs` | Assemble from reused + fresh; emit `_site/.build/` (manifest + new cache entries). |
| `scripts/prune.mjs` *(new)* | Manifest-driven prune with protected-path whitelist (production only). |
| `.github/workflows/ci.yml` | Checkout `gh-pages` into `.gh-pages`; cache-write step to gh-pages root on preview; prune step on deploy; keep `validate` unchanged. |

`main` gains only script/workflow code and this doc — no thumbnails, manifest, or cache.
