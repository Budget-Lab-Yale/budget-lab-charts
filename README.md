# budget-lab-charts

The Budget Lab chart archive. This repo holds chart specs and data for published figures. It
pins a specific version of
[budget-lab-chart-engine](https://github.com/Budget-Lab-Yale/budget-lab-chart-engine)
and runs a validate → build → catalog → site pipeline over that content, with a live preview
deployed for every pull request.

The engine is **the tool**; this repo is **the content**.

---

## What this repo does

- Stores one `chart.yaml` + `data.csv` per figure, in a dated folder hierarchy.
- Validates every chart against the engine's spec/data schema (the merge gate).
- Renders each chart to a self-contained interactive page and assembles a searchable gallery.
- Generates `catalog/index.json` for downstream consumers (embeds, site templates).
- Publishes the gallery to **GitHub Pages**, with a **live per-PR preview URL** for review.

There are **no committed visual baselines** — charts are reviewed by looking at the rendered
HTML on the PR preview, not by pixel-diffing.

---

## Repo layout

Figures fall into two classes, split by top-level tree:

- **One-off** article figures — the publication date is a real property, so they file by date.
- **Living** figures (trackers) — periodically updated in place, so they are **dateless**.

```
charts/
  articles/<year>/<month>/<collection-slug>/
    article.yaml                # one-off collection metadata (title, slug, date, url, engineVersion, figures)
    <chart-folder>/
      chart.yaml                # ChartSpec for the engine
      data.csv                  # long-format data; any column names (mapped via chart.yaml `columns:`)

  trackers/<collection-slug>/
    tracker.yaml                # living collection metadata (title, slug, url, engineVersion, created, cadence, figures)
    <chart-folder>/
      chart.yaml
      data.csv
```

`<year>/<month>` exists only under `articles/`. `trackers/` is dateless.

Generated outputs (not committed except catalog):

```
dist/<collection-slug>/<chart-folder>/
  index.html                    # self-contained interactive chart
  data.csv                      # copy of the chart's data

catalog/index.json              # array of chart metadata; committed
_site/                          # the assembled gallery published to Pages (incl. per-chart thumb.png)
```

## Identity

Each figure's durable id — the thing the catalog and downstream embeds reference — is

```
<collection-slug>/<chart-folder-name>
```

e.g. `ai-labor-market/augmented-occupations`. It carries **no date and no tree**, so it survives the moves that happen over a figure's life: promoting a one-off to a tracker, reorganizing folders, or re-dating. The rules:

- **`collection-slug`** is declared in `article.yaml`/`tracker.yaml` and names a durable *product* (a report series or tracker) — never a mutable editorial topic, never a date. Unique repo-wide.
- **The chart segment is the chart's folder name** (not a field in `chart.yaml`, which the engine's strict schema would reject). Set it once; don't rename it. Unique within its collection (the filesystem guarantees this).
- **To rename a figure for display, edit `title`** — never the slug or folder name. (The figure-number eyebrow lives in the collection's `figures:` map, below.)

`npm run validate` enforces these (collection-file matches its tree, slug/folder-name format, repo-wide slug uniqueness) before running the engine's spec validation.

---

## Pipeline scripts

| Command | What it does |
|---|---|
| `npm run validate` | Structural/identity checks, then `tbl-chart validate` on every `chart.yaml`; exit 1 if any fail. |
| `npm run build` | Render every chart to `dist/<id>/index.html`; copy `data.csv`. |
| `npm run catalog` | Write `catalog/index.json` from all `chart.yaml` + collection files. |
| `npm run site` | Assemble the publishable gallery into `_site/` (landing page + chart pages + catalog). |
| `npm run thumbs` | Headless-screenshot each page into `_site/<id>/thumb.png` (gallery card thumbnails). |
| `npm run all` | All of the above, in order. |

Run order: validate → build → catalog → site → thumbs (`npm run all` does this).

---

## Adding a chart

The authoring step is just **a folder + two files**; CI does the rest.

1. Create a folder under the collection. The **folder name is the chart's id segment** —
   choose it once (lowercase/ASCII/hyphenated) and don't rename it later.
   - one-off: `charts/articles/<year>/<month>/<collection>/<chart>/`
   - tracker: `charts/trackers/<collection>/<chart>/`
2. Add `data.csv` — long format, **any column names**, e.g.:
   ```
   age_bin,cohort,sex_label,mean_hours
   18-21,Gen X,Men,0.5
   ...
   ```
3. Write `chart.yaml` — the `columns:` block maps your CSV columns onto the engine's roles:
   ```yaml
   chartType: line              # line | bar | stacked
   title: "..."
   xAxisType: categorical       # temporal | numeric | quarterly | categorical
   columns:
     x: age_bin                 # default "time" if the columns block is omitted
     value: mean_hours          # default "value"
     series: cohort             # OPTIONAL — omit for a single-series chart
     facet: sex_label           # OPTIONAL — defines small-multiples panes
   data: data.csv
   ```
   There is **no `slug`** and **no `eyebrow`** in `chart.yaml` (identity is the folder; the figure
   number is the article's, below).
4. Open a PR. CI runs `validate`, builds the site, and comments a **preview URL**.
5. Review the chart on that URL; merge when it looks right. Merging publishes it to Pages.

To preview locally before opening the PR: `npm run all`, then serve `_site/` over HTTP
(`npx http-server _site`) — the gallery fetches the catalog, so `file://` won't work.

### chart.yaml fields

Required: `chartType`, `title`, `xAxisType`, `data`. Common optional: `columns`, `subtitle`,
`source`, `note`, `x_axis_title`, `y_axis_title`, `series_order`, `series_colors`,
`series_styles`, `series_labels`, `points`, `small_multiples`, `confidence_bands`, `tags`. See
`ChartSpec` in the engine's `src/spec/types.ts` for the full set.

---

## Adding a collection

A collection is one article (one-off) or one tracker (living). Its `slug` is the first segment
of every chart id under it — durable, unique repo-wide, never a date.

**One-off** — `charts/articles/<year>/<month>/<collection>/article.yaml`:

```yaml
title: "Article title"
slug: "collection-slug"
date: "YYYY-MM-DD"       # publication date — a real property of a one-off
url: "https://..."       # leave empty until published
engineVersion: "1.0.0"   # should match the pinned engine version
figures:                 # optional: figure-number eyebrows (see below)
  chart-folder-slug: "Figure 1"
```

**Tracker** — `charts/trackers/<collection>/tracker.yaml`:

```yaml
title: "Tracker title"
slug: "collection-slug"
url: "https://..."
engineVersion: "1.0.0"
created: "YYYY-MM-DD"    # optional: immutable first-publication date
cadence: "monthly"       # optional human note; not part of identity
figures:                 # optional: figure-number eyebrows (see below)
  chart-folder-slug: "Figure 1"
```

### Figure-number eyebrows

A figure number ("Figure 1", "Appendix Figure 2") is a property of the **article a chart is
embedded in**, not of the chart itself — so it is **not** a `chart.yaml` field (the engine's
schema rejects `eyebrow:`). Instead, the collection file carries an optional `figures:` map from
**chart-folder slug → label**. `build-all` passes the matching label to the engine
(`tbl-chart render --eyebrow "Figure 1"`); `build-catalog` records it. A chart omitted from the
map (or a collection with no `figures:` block) renders with no eyebrow.

The label is baked into the built `index.html` but can be suppressed at view time by appending
`?eyebrow=off` to the embed URL — so one built artifact can be embedded with or without the
figure number.

---

## Updating a tracker

Trackers are versioned **in place** — git history is the vintage archive; there are no dated
snapshot folders.

1. Replace `data.csv` with the new data at the same path.
2. Open a PR; review the refreshed chart on the preview URL.
3. Merge. The figure's id and embed URL are unchanged; prior values remain recoverable from git.

---

## Pinned engine version

The engine is pinned as a git-tag dependency in `package.json`:

```json
"budget-lab-chart-engine": "github:Budget-Lab-Yale/budget-lab-chart-engine#v1.0.0"
```

To bump:

1. Update the tag in `package.json` (e.g. `#v0.2.1`).
2. Run `npm install` to pull the new version and update `package-lock.json`.
3. Run `npm run validate` (and `npm run all` to eyeball the gallery) to confirm specs still build.
4. Commit `package.json` + `package-lock.json`.

---

## Continuous integration & hosting

`.github/workflows/ci.yml` has three jobs:

- **validate** — the merge gate (spec/structure/data). Make it a required status check.
- **preview** — on each PR, builds the site and publishes it to the `gh-pages` branch at
  `pr-preview/pr-<n>/`, then comments the live URL. The directory is removed when the PR closes.
- **deploy** — on merge to `main`, publishes the site to the `gh-pages` branch **root** (the
  production gallery), preserving the `pr-preview/` subtree.

The build (`validate → build → catalog → site → thumbs → _site/`) is **host-agnostic**. Migrating
off GitHub Pages later (e.g. Cloudflare Pages / Netlify, which give per-PR previews natively)
means replacing only the preview/deploy steps — not the build.

**Launch prerequisites** (the workflow is `workflow_dispatch`-only until these hold):

1. Engine repo public (or add a token + git-URL-rewrite step) so `npm ci` can clone the
   cross-repo dependency.
2. Engine pin at a release that builds these charts (≥ `1.0.0`).
3. Repo **Settings → Pages → Source = "Deploy from a branch" → `gh-pages` / root**.
4. Uncomment the `push`/`pull_request` triggers in `ci.yml` and `gh workflow enable CI`.

---

## Git LFS

`*.frozen.csv` files (frozen snapshots of remote data sources) are stored in Git LFS via
`.gitattributes`. Install LFS locally so they resolve:

```sh
git lfs install
```

---

## Development

```sh
git clone <this-repo>
npm install                      # installs the engine + Playwright (for thumbnails)
npx playwright install chromium  # for `npm run thumbs`

npm run all                      # validate → build → catalog → site → thumbs
npx http-server _site            # preview the gallery over HTTP
```
