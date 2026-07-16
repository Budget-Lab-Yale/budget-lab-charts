# budget-lab-charts

The Budget Lab chart archive. This repo holds chart specs and data for published figures. It
pins a specific version of
[budget-lab-chart-engine](https://github.com/Budget-Lab-Yale/budget-lab-chart-engine)
and runs a validate → build → catalog → site pipeline over that content, with a live preview
deployed for every pull request.

The engine is **the tool**; this repo is **the content**.

---

## Quick start: creating figures for a publication

An article is a folder holding one `article.yaml` (the article's metadata) plus one sub-folder
per figure, each containing a `chart.yaml` (the chart spec) and a `data.csv` (the data). You commit
that folder tree and open a PR; CI validates it and renders a live preview of every figure. The
chart engine runs in CI, so you don't install or invoke it directly.

This section covers creating a new article from scratch. To add a single figure to an existing
article, or to update a tracker, see [Adding a chart](#adding-a-chart) and
[Updating a tracker](#updating-a-tracker) below.

**One-time setup**

```sh
git clone https://github.com/Budget-Lab-Yale/budget-lab-charts.git
cd budget-lab-charts
npm install            # only needed for the optional local preview in step 6
```

**Steps**

1. **Branch off `main`.**
   ```sh
   git checkout main && git pull
   git checkout -b add-<article-slug>
   ```

2. **Choose the article's slug.** You create it now, and it becomes the permanent first segment of
   every chart id in the article. Requirements: lowercase, ASCII, hyphenated; it should clearly identify the
   durable product; and it must be
   **unique across the entire repo**. List the slugs already in use to confirm yours is free:
   ```sh
   grep -rh '^slug:' charts/
   ```

3. **Create the article folder** under `charts/articles/<year>/<month>/<slug>/`, using the
   publication month and the slug from step 2:
   ```
   charts/articles/2026/07/my-article/
   ```

4. **Write `article.yaml`** in that folder — the article's metadata plus the figure-number label
   for each chart:
   ```yaml
   title: "How potential AI futures would play out in the current tax system"
   slug: "ai-fiscal"                   # must match the folder name
   date: "2026-07-01"                  # publication date
   url: ""                             # leave empty until published
   figures:                            # chart-folder name → figure label
     revenue-headline: "Figure 1"
     revenue-by-income-type: "Figure 2"
   ```
   Field-by-field detail is in [CONFIG-REFERENCE.md](CONFIG-REFERENCE.md); the tracker variant is
   in [Adding a collection](#adding-a-collection) below.

5. **Create one folder per figure** inside the article folder, and add its two files. Each folder
   name is that chart's permanent id segment — lowercase, hyphenated, and the same names referenced
   in the `figures:` map above.

   `data.csv` — long format. Column headers and category values can be the raw/short names from
   your export; you map and rename them for display in `chart.yaml`:
   ```
   speed,labor,rev
   Slow,comp,4.73
   Slow,prop,8.17
   Slow,exp,11.63
   ```

   `chart.yaml` — map the CSV columns onto the chart's roles and rename the series for display:
   ```yaml
   chartType: bar               # line | area | bar | stacked | scatter | dotplot
   title: "Tax revenue is higher when AI adoption is faster and when inequality rises"
   subtitle: "Change in federal revenue, FY 2030, billions USD"
   source: "The Budget Lab AI-Revenue Microsimulation Model."
   xAxisType: categorical       # temporal | numeric | quarterly | categorical
   columns:                     # map each CSV column onto a chart role
     x: speed
     value: rev
     series: labor              # optional — omit for a single-series chart
   series_order: [comp, prop, exp]   # order + filter, keyed by the raw CSV values
   series_labels:               # rename the raw series keys for the legend and tooltip
     comp: "Compressive"
     prop: "Proportional"
     exp: "Expansive"
   data: data.csv
   ```
   `chartType`, `title`, `xAxisType`, and `data` are required; everything else is optional. For the
   full list of fields, chart types, and CSV formatting, see
   [CONFIG-REFERENCE.md](CONFIG-REFERENCE.md). Existing articles under `charts/articles/` are good
   working examples to copy from.

6. **Preview locally (optional)** to refine the design before pushing:
   ```sh
   npm run dev          # live preview at http://localhost:5173
   ```
   Select a chart in the sidebar and edit its `chart.yaml`/`data.csv`; the preview reloads on save.
   If you skip this, the PR preview in step 8 serves the same purpose.

7. **Commit and open a PR.**
   ```sh
   git add charts/
   git commit -m "Add my-article charts"
   git push -u origin add-<article-slug>
   ```
   Then open the PR on GitHub (or `gh pr create`).

8. **Review the PR preview.** CI validates the files and, once the `validate` check passes, comments
   a live preview URL for the full gallery. The preview may take some time to load, just wait. **Do not skip this step.** Check each figure there. A failing `validate` check
   reports the cause — commonly a `chart.yaml` typo, a column name that doesn't match the CSV, or a
   slug/folder-name mismatch. Fix and push again.

9. **Merge.** After the figures are approved, merge the PR. The article's charts publish to the live
   gallery automatically.

Two constraints:

- The `slug` in `article.yaml` must match the article folder name, and every chart-folder name in
  the `figures:` map must match a real chart folder.
- Folder names are permanent ids. To change a chart's displayed name, edit `title`; to change a
  figure number, edit the `figures:` map. Do not rename the folders.

The sections below are the full reference — config fields, id rules, single-chart and tracker
workflows, embedding, and CI.

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
    article.yaml                # one-off collection metadata (title, slug, date, url, figures)
    <chart-folder>/
      chart.yaml                # ChartSpec for the engine
      data.csv                  # long-format data; any column names (mapped via chart.yaml `columns:`)

  trackers/<collection-slug>/
    tracker.yaml                # living collection metadata (title, slug, url, created, cadence, figures)
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

Adding a single figure to a collection that already exists is the quick start minus the collection
setup: create a `<chart>/` folder under the collection, add `data.csv` + `chart.yaml`, and — for a
numbered figure — add the folder name to the collection's `figures:` map. Open a PR; CI validates
and previews. The folder name is the chart's permanent id segment (lowercase/ASCII/hyphenated); set
it once and don't rename it.

- one-off: `charts/articles/<year>/<month>/<collection>/<chart>/`
- tracker: `charts/trackers/<collection>/<chart>/`

`chart.yaml` has **no `slug`** and **no `eyebrow`** — identity is the folder, and the figure number
lives in the collection's `figures:` map. The `columns:` block defaults to `x: time` / `value: value`
if omitted; `series` and `facet` are optional (`facet` defines small-multiples panes).

### chart.yaml fields

Required: `chartType`, `title`, `xAxisType`, `data`. Common optional: `columns`, `subtitle`,
`source`, `note`, `x_axis_title`, `y_axis_title`, `series_order`, `series_colors`,
`series_styles`, `series_labels`, `points`, `small_multiples`, `confidence_bands`, `tags`. See
**[CONFIG-REFERENCE.md](CONFIG-REFERENCE.md)** for the full field-by-field reference (chart.yaml,
table.yaml, collection files, and the CSV format).

---

## Adding a collection

A collection is one article (one-off) or one tracker (living). Its `slug` is the first segment
of every chart id under it — durable, unique repo-wide, never a date. The quick start walks through
the one-off article case; the two collection-file schemas are below.

**One-off** — `charts/articles/<year>/<month>/<collection>/article.yaml`:

```yaml
title: "Article title"
slug: "collection-slug"
date: "YYYY-MM-DD"       # publication date — a real property of a one-off
url: "https://..."       # leave empty until published
figures:                 # optional: figure-number eyebrows (see below)
  chart-folder-slug: "Figure 1"
```

**Tracker** — `charts/trackers/<collection>/tracker.yaml`:

```yaml
title: "Tracker title"
slug: "collection-slug"
url: "https://..."
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
"budget-lab-chart-engine": "git+https://github.com/Budget-Lab-Yale/budget-lab-chart-engine.git#v1.1.0"
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

## Embedding

Publications embed a chart with **one `<script>` tag** — only `chart` is required. The loader
(`embed/v1/embed.js`) injects a responsive iframe and auto-sizes it to the chart's content height via
[iframe-resizer](https://github.com/davidjbradshaw/iframe-resizer) v4 (MIT, vendored in `embed/v1/`)
— so the height tracks the content as the embed column reflows (no fixed height, no inner scroll).

```html
<script src="https://charts.budgetlab.yale.edu/embed/v1/embed.js"
        chart="atus-childcare/childcare-by-activity"></script>
```

`chart` is the chart's durable id (`<collection-slug>/<chart-folder>`). Optional `data-*`:

| Attribute | Default | Purpose |
|---|---|---|
| `chart` | _(required)_ | Which chart to load. |
| `data-title` | _(auto)_ | Iframe `title` for accessibility. **Omit it** — the loader derives it from the catalog (`eyebrow — title`); set this only to override. |
| `data-eyebrow` | _(on)_ | The figure-number eyebrow shows by default; set `"off"` to hide it (appends `?eyebrow=off`). |
| `data-height` | `100` | Initial px height before iframe-resizer measures (set to the natural height to avoid a brief flash). |
| `data-log` | _(off)_ | Any value enables iframe-resizer verbose logging. |
| `data-strip-host-classes` | `paragraph-embed-code` | Comma-separated host-wrapper classes whose width-proportional height should be overridden. |

**No-JS fallback (optional).** A `<script>` can't run when JavaScript is disabled, so a fallback
link can't be auto-injected. For accessibility-strict hosts, add a static `<noscript>` next to the
script:

```html
<noscript><a href="https://charts.budgetlab.yale.edu/atus-childcare/childcare-by-activity/">Open the chart</a></noscript>
```

**How it's wired:** each rendered chart page includes the iframe-resizer *child* script (injected by
`build-all`, before `</body>`), so it reports its height to the loader; the accessible title is read
from `/catalog/index.json`. `embed/v1/` is a frozen contract — breaking loader changes ship as
`embed/v2/`.

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

### Live preview (dialing in chart design)

To preview any chart and have it auto-reload as you edit:

```sh
npm run dev            # serves at http://localhost:5173 (use --port to override, --open to launch a browser)
```

Pick a chart from the sidebar; edit its `chart.yaml` or `data.csv` in your editor and save — the
preview reloads automatically. The preview frame mimics an embed (adjustable width, eyebrow toggle).
Charts that fail to render (e.g. ones needing a newer engine than the pinned one) still appear in the
list and show the engine's error inline.
