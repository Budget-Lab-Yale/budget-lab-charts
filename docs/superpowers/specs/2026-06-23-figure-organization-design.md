# Figure Organization & Durable Identity — Design

- **Date:** 2026-06-23
- **Status:** Approved (design); implementation plan to follow
- **Repo:** `budget-lab-charts`

## Problem

The repo currently files every figure by article publication date:

```
charts/<year>/<month>/<article-slug>/<chart-slug>/
```

and the catalog `id` — the permanent address that embeds and site templates reference — *is* that path (e.g. `2026/06/ai-labor-market/augmented-occupations`). That works for one-off article figures, where the publication date is a true property of the figure.

It breaks for **living figures**: trackers that are republished on a cadence (e.g. a monthly labor-market tracker). For these, the original publication date is not a meaningful property — it is misleading, it buries the figure under whatever month it first appeared, and baking it into the permanent id means the figure's address advertises a date that no longer reflects its content.

This is not hypothetical: the first content shape the repo took on is a *tracker*, yet it sits under a dated folder by first-publication date.

## Goals

1. A figure's **durable identifier never has to change** when the figure is reorganized, moved between trees, or updated with new data.
2. The date stays **out of the identity of living figures**, and stays **in the identity of one-off figures** (where it is genuine).
3. Identity, location, and version are **three separate concerns**, not one string.
4. Uniqueness is guaranteed **without a central database or registry** — this is a file-based, Git-backed corpus by design.
5. Identifiers are **human-readable** so the catalog, folder tree, and PR diffs are legible to a small team.

## Non-goals (deferred — YAGNI)

- **On-disk dated snapshots** of living figures. Git history is the vintage archive; we do not write a dated folder per refresh. Revisit only if a citation/reproducibility need proves it.
- **A redirect map** (old-id → new-id). The identity model below is designed so the common moves don't change ids; a redirect map is only needed for the rare cross-collection move and can be added when one actually occurs.
- **An append-only id registry** for hard immutability enforcement. `validate` + git history cover this until churn proves otherwise.
- **Opaque/random ids.** Rejected — see rationale. They presume a central uniqueness authority we have chosen not to build.

## Model: two classes of figure

Every figure belongs to exactly one of two classes, distinguished by which top-level tree it lives in:

| Class | Tree | Date is… | Updated by… |
|---|---|---|---|
| **One-off** | `articles/` | a true property (publication date) | not updated; a new figure supersedes it |
| **Living** | `trackers/` | not part of identity | re-publishing in place on a cadence |

A figure can be **promoted** from one-off to living (publish once in an article, then decide to keep updating it). The identity model is designed so promotion does **not** change the figure's id.

## On-disk structure

```
charts/
  articles/<year>/<month>/<collection-slug>/
    article.yaml                 # collection metadata (one-off)
    <chart-slug>/
      chart.yaml
      data.csv
      baseline.png               # Git LFS

  trackers/<collection-slug>/
    tracker.yaml                 # collection metadata (living)
    <chart-slug>/
      chart.yaml
      data.csv
      baseline.png               # Git LFS
```

`<year>/<month>` exists **only** under `articles/`, and only to give one-offs a natural browse-by-publication view. It is not part of any id. `trackers/` is dateless.

## Identity

A figure's durable id is a **namespaced semantic slug**:

```
<collection-slug>/<chart-slug>
```

e.g. `ai-labor-market/augmented-occupations`.

### How the id is formed

The id is composed from a **declared collection slug** and the **chart's folder name**:

- the collection's `slug`, declared once in `article.yaml` / `tracker.yaml` (this field already exists), and
- the chart's folder name (the leaf directory containing `chart.yaml`).

`catalog` composes `id = "<collection.slug>/<chart-folder-name>"`.

**Why the chart segment is the folder name, not a `chart.yaml` field.** The engine's spec schema (`schema.ts`) is **strict** — `additionalProperties: false` at every level — so an unknown `slug` key in `chart.yaml` would *fail* `tbl-chart validate`. Adding `slug` to the engine schema would couple a reusable, separately-versioned tool to this repo's identity policy (rejected: Q3 — engine stays agnostic). So `chart.yaml` is left untouched and the chart's identity segment is its folder name.

This still meets the durability goal because the **declared collection slug is the abstraction layer**: it is independent of the collection's *location* (`<year>/<month>`, `articles/` vs `trackers/`, any nesting), so the moves we actually expect — one-off→living promotion, reorganization, re-dating — change the collection's location but **not** its slug, and therefore not any id. The only residual path-coupling is the chart's leaf folder name; the convention is **set it once and don't rename it** (rename via `title` for display). This is exactly the discipline every file-based publisher already relies on.

### Rules

1. **`collection-slug` is a durable, owned grouping** — a product, report series, or tracker — and carries **neither the date nor the tree**. `ai-labor-market` is the same slug whether the figure lives under `articles/2026/06/` today or moves to `trackers/` later. This is the load-bearing discipline: do not name a collection after a mutable editorial topic you might recategorize.
2. **The chart's folder name is unique within its collection** — enforced by the filesystem (a directory can't hold two entries of the same name), so chart-segment uniqueness is free.
3. **Global uniqueness falls out automatically**: collection slugs unique repo-wide + chart folder names unique within a collection ⇒ `<collection>/<chart>` unique repo-wide. This maps exactly onto "a filename must be unique within its directory" — enforced by the filesystem, no registry needed.
4. **Ids are set once and immutable.** To rename a figure for clarity, edit its **`title`/`eyebrow`** (display fields that already exist) — never its collection slug or chart folder name.
5. **Slug/folder-name format:** lowercase, ASCII, hyphen-separated, no dates, no `articles:`/`trackers:` prefix (prefixing the tree into the id would re-introduce the brittleness this design removes).

### The one case the id changes

A figure that moves between *collections* changes id (its collection segment changes) — which is acceptable, because moving a figure to a different *product* is genuinely a change of identity, not a relocation of the same one.

## Versioning

Living figures are **overwritten in place** at their stable path on each refresh:

- `data.csv` is replaced with the new data.
- `baseline.png` is regenerated (`npm run snapshot -- --update`).
- Git history is the vintage record — every prior version is recoverable by commit.

This matches the universal de facto practice among file-based publishers (OWID "live" charts, Datawrapper republish, and every data-journalism Git repo surveyed): one stable slug, update in place, git is the version history. No per-refresh dated folders (see non-goals).

## Metadata schema

### `article.yaml` (one-off collection)

```yaml
title: "Article title"
slug: "collection-slug"        # immutable; the namespace segment of every chart id
date: "YYYY-MM-DD"             # publication date — a true property of a one-off
url: "https://..."             # empty until published
engineVersion: "0.1.1"
```

### `tracker.yaml` (living collection) — new file type

```yaml
title: "Tracker title"
slug: "collection-slug"        # immutable; the namespace segment of every chart id
url: "https://..."
engineVersion: "0.1.1"
created: "YYYY-MM-DD"          # optional: immutable first-publication date (allowed — it never changes)
cadence: "monthly"            # optional human note; not part of identity
```

A tracker has **no mutable date field** in its identity. "Last updated" is derivable from git; it is not an identity property and is not required in the file.

### `chart.yaml` (both classes) — unchanged

`chart.yaml` gets **no new fields**. The engine's spec schema is strict (`additionalProperties: false`), so the chart's identity segment cannot live here without coupling the engine to the repo's id scheme. The chart segment of the id is the chart's **folder name**.

## Catalog schema

`catalog/index.json` entries change from path-derived to slug-composed identity, and gain a class discriminator:

```jsonc
{
  "id": "ai-labor-market/augmented-occupations",   // <collection.slug>/<chart-folder-name> — no date, no tree
  "kind": "tracker",                                 // "oneoff" | "tracker" (derived from the tree)
  "collection": "ai-labor-market",                   // collection.slug
  "collectionTitle": "AI Labor Market Tracker",      // collection.title
  "title": "...",
  "eyebrow": "Figure 1",
  "date": "",                                        // publication date for oneoff; "" for tracker
  "created": "2026-06-17",                            // tracker created date if present; else ""
  "path": "charts/trackers/ai-labor-market/augmented-occupations/chart.yaml",
  "dataPath": "charts/trackers/ai-labor-market/augmented-occupations/data.csv",
  "engineVersion": "0.1.1",
  "tags": []
}
```

`path`/`dataPath` remain the on-disk location (which *may* change); `id` is the stable address (which does not). Consumers key on `id`.

## Tooling changes

These are the changes needed to realize the design; the implementation plan will detail and sequence them.

1. **`scripts/lib.mjs` — `listCharts()`**
   - Walk both `charts/articles/**` and `charts/trackers/**`.
   - Determine `kind` from the top-level tree segment (`articles/` → `oneoff`, `trackers/` → `tracker`).
   - Locate the collection file (the chart's parent dir holds `article.yaml` or `tracker.yaml`), parse it, and compose `id = "<collection.slug>/<chart-folder-name>"`.
   - Return `{ dir, specPath, id, kind, chartSlug, collectionDir, collection }` (the parsed collection object).
2. **`scripts/build-catalog.mjs`**
   - Use the composed `id`; emit the new fields (`kind`, `collection`, `collectionTitle`, `date` for one-offs / `created` for trackers).
3. **`scripts/validate-all.mjs`** — add a structural pre-check (runs before the engine spec validation, fails fast):
   - collection file matches its tree (`article.yaml` only under `articles/`, `tracker.yaml` only under `trackers/`, and not the wrong one) — the **`kind` guard**;
   - every collection file has a `slug` matching `^[a-z0-9]+(-[a-z0-9]+)*$`;
   - every chart folder name matches the same pattern;
   - collection slugs are unique repo-wide (chart folder names are unique within a collection by the filesystem);
   - therefore composed ids are unique repo-wide. Exit 1 on any violation.
4. **`README.md`** — replace the "Repo layout", "Adding a chart", and "Adding an article" sections with the two-tree structure, the `tracker.yaml` file type, the id rules, and the overwrite-in-place versioning convention.

## Seed content note

The current `charts/2026/06/ai-labor-market/**` content is **placeholder/example data** that mirrors a figure living in a separate interactive repo. It will be scrubbed before launch and is **not** a migration concern — its specific treatment does not matter. It is useful only as a worked example of the scheme (a tracker would become `trackers/ai-labor-market/…` with ids `ai-labor-market/<chart>`).

## Rationale — what comparable organizations do

The design follows the convergent practice of comparable publishers; the full comparison is summarized here as the basis for the decisions.

**Decouple identity from date, location, and version (everyone).** FRED series (`UNRATE`), OWID slugs (`/grapher/life-expectancy`), Datawrapper ids, BLS/Census mnemonics are all dateless permanent handles; the date is a property of the data or edition. Recurring products get a stable, *undated* landing page (FRED release `rid=50`, CBO `recurring-publication/{id}`, Pew fact-sheets) decoupled from dated editions.

**Flat global ids presume a central database; namespacing makes uniqueness local (the decisive architectural point).** OWID slugs are flat and enforced by an application-layer DB check — which has *failed* in production (duplicate published slugs). FRED and Datawrapper likewise depend on a central registry/generator to mint unique ids. Notably, OWID runs a *hierarchical filesystem path* for its file-based ETL half and reserves flat slugs for its DB-backed half — the same split this repo sits on. The largest-scale statistical agencies (BLS, Census) chose *structured/namespaced* ids precisely so uniqueness is a property of string construction, not a lookup.

**File-based peers all do what this design formalizes.** The Pudding, FiveThirtyEight, ProPublica, FT, NYT, Reuters, BBC keep figures in Git repos where the **folder path is the id, it's a human-readable slug, and uniqueness is "unique within its parent" — enforced by the filesystem, no DB.** This design writes that convention down as an explicit composed id so it survives folder moves. Closest direct precedents for the two-segment shape: **Reuters Graphics** (`rootSlug`/`wildSlug`, file-based, no DB) and the formal engineering canon (Google AIP-122 `collection-id/resource-id`, Kubernetes namespaces, npm scopes).

**One caveat the literature flags:** the risk is the *meaning* of the namespace segment, not the hierarchy — keep `collection-slug` a durable owned grouping, not a mutable editorial topic (Berners-Lee, "Cool URIs don't change"). Captured as rule 1 above.

## Decisions log

| # | Decision | Alternatives rejected | Why |
|---|---|---|---|
| 1 | Two top-level trees (`articles/` dated, `trackers/` dateless) | Single flat namespace; keep dated tree + add `trackers/` only | Keeps the publication-date browse view for one-offs while giving living figures a dateless home |
| 2 | Overwrite living figures in place; git is the vintage archive | On-disk dated snapshots | Matches universal file-based practice; no clutter; git already versions |
| 3 | Namespaced semantic id `<collection>/<chart>`, composed from declared slugs, decoupled from path | Path-as-id; flat global slug; opaque random id | Uniqueness is local/filesystem-natural (no DB); human-readable; survives the moves we expect |
| 4 | `collection-slug` carries no date and no tree | Encoding tree (`tracker:`) or date in id | Lets a figure be promoted one-off→living without changing its id |
| 5 | Display name lives in `title`/`eyebrow`; slug/folder-name is set-once | Renaming the slug for clarity | Separates the machine handle from the human label |
| 6 | Keep the `charts/` wrapper (`charts/articles/`, `charts/trackers/`) | Hoist to top-level `articles/`+`trackers/` | Minimizes disruption to the existing tree and tooling root |
| 7 | `kind` derived from the tree; `validate` asserts collection-file↔tree match | Explicit `kind:` field in the collection file; file-as-truth | A third copy of the same fact is just another drift surface; the validated filename↔tree check gives the misfiling protection without it (Hugo/Jekyll model: type derived from location) |
| 8 | Engine stays agnostic; chart identity = folder name, `chart.yaml` untouched | Add `slug` to the engine's strict schema | Keeps the reusable, separately-versioned engine decoupled from this repo's identity policy; verified the engine schema is strict so an unknown field would otherwise fail validation |

## Resolved (was: open questions)

1. **Tree naming** → keep the `charts/` wrapper (decision 6).
2. **`kind` source of truth** → derived from the tree, guarded by a `validate` check that the collection filename matches its tree (decision 7).
3. **Engine awareness** → engine stays agnostic; identity lives in the collection slug + chart folder name, not in `chart.yaml` (decision 8). **Verified:** `node_modules/budget-lab-chart-engine/src/spec/schema.ts` sets `additionalProperties: false`, so an unknown `slug` key in `chart.yaml` would fail `tbl-chart validate` — confirming the field must stay out of the spec.
