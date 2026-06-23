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

The id is **composed from two declared `slug` fields**, not derived from the folder path:

- the collection's `slug`, declared once in `article.yaml` / `tracker.yaml`, and
- the chart's `slug`, declared in each `chart.yaml`.

`catalog` composes `id = "<collection.slug>/<chart.slug>"`. Because both segments are *declared values*, not folder names, renaming or moving a folder does not change the id. (Folders should still be named to match their slugs by convention, for legibility — but the slug is the source of truth.)

### Rules

1. **`collection-slug` is a durable, owned grouping** — a product, report series, or tracker — and carries **neither the date nor the tree**. `ai-labor-market` is the same slug whether the figure lives under `articles/2026/06/` today or moves to `trackers/` later. This is the load-bearing discipline: do not name a collection after a mutable editorial topic you might recategorize.
2. **`chart-slug` is unique within its collection** — you control one folder, so this is trivial to guarantee by hand.
3. **Global uniqueness falls out automatically**: collection slugs unique repo-wide + chart slugs unique within a collection ⇒ `<collection>/<chart>` unique repo-wide. This maps exactly onto "a filename must be unique within its directory" — enforced by the filesystem, no registry needed.
4. **Ids are set once and immutable.** To rename a figure for clarity, edit its **`title`/`eyebrow`** (display fields that already exist) — never its slug.
5. **Slug format:** lowercase, ASCII, hyphen-separated, no dates, no `articles:`/`trackers:` prefix (prefixing the tree into the id would re-introduce the brittleness this design removes).

### Why composition rather than a single explicit `id:` per chart

Composing from two declared slugs keeps a single source of truth, avoids repeating the collection string in every `chart.yaml`, and makes the uniqueness check decompose naturally into the two local checks above. A figure that moves between collections is the one case where the id changes — which is acceptable, because moving a figure to a different *product* is genuinely a change of identity.

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

### `chart.yaml` (both classes) — one added field

```yaml
slug: "chart-slug"            # NEW — immutable, unique within the collection; chart segment of the id
chartType: line
title: "..."
xAxisType: temporal
data: data.csv
# ...existing optional fields unchanged
```

The only schema change to existing chart specs is the added `slug` field. (Today the chart slug is implicit in the folder name; this makes it explicit so the id survives folder moves.)

## Catalog schema

`catalog/index.json` entries change from path-derived to slug-composed identity, and gain a class discriminator:

```jsonc
{
  "id": "ai-labor-market/augmented-occupations",   // <collection.slug>/<chart.slug> — no date, no tree
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
   - Stop deriving `id` from the path. Return the chart's declared `slug` and locate the collection metadata file (`article.yaml` under `articles/`, `tracker.yaml` under `trackers/`), returning its `slug`/`title` and the `kind` (from the tree).
2. **`scripts/build-catalog.mjs`**
   - Compose `id = "<collection.slug>/<chart.slug>"`.
   - Emit the new fields (`kind`, `collection`, `collectionTitle`, `created`).
3. **`scripts/validate-all.mjs` (or a new `validate-ids` step)** — add structural checks beyond the engine's spec validation:
   - every `chart.yaml` has a `slug`; every collection file has a `slug`;
   - all slugs match `^[a-z0-9]+(-[a-z0-9]+)*$` (lowercase/ASCII/hyphen, no dates encoded);
   - collection slugs are unique repo-wide;
   - chart slugs are unique within their collection;
   - therefore composed ids are unique repo-wide. Exit 1 on any violation.
4. **`README.md`** — replace the "Repo layout", "Adding a chart", and "Adding an article" sections with the two-tree structure, the `tracker.yaml` file type, the `slug`/id rules, and the overwrite-in-place versioning convention.

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
| 5 | Display name lives in `title`/`eyebrow`; slug is set-once | Renaming the slug for clarity | Separates the machine handle from the human label |

## Open questions for review

1. **Tree naming:** `charts/articles/` + `charts/trackers/`, or hoist to top-level `articles/` + `trackers/` (dropping the `charts/` wrapper)? Spec assumes the former to minimize disruption.
2. **`kind` source of truth:** derive purely from the tree (proposed), or also assert it in the collection file as a guard?
3. **Engine awareness:** does `tbl-chart validate` need to know about the `slug` field, or is the slug purely repo-metadata that the engine ignores? Spec assumes the latter (engine unchanged; slug validated by our scripts).
