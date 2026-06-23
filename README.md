# budget-lab-charts

The Budget Lab chart archive. This repo holds chart specs, data, and visual baselines for
published figures. It pins a specific version of
[budget-lab-chart-engine](https://github.com/Budget-Lab-Yale/budget-lab-chart-engine)
and runs a build/validate/snapshot/catalog pipeline over that content.

The engine is **the tool**; this repo is **the content**.

---

## What this repo does

- Stores one `chart.yaml` + `data.csv` per figure, in a dated folder hierarchy.
- Locks each chart's visual appearance as a `baseline.png` (tracked via Git LFS).
- Runs a four-step pipeline: validate → build → snapshot → catalog.
- Generates `catalog/index.json` for downstream consumers (embeds, site templates).
- Deploys to a hosting target TBD at launch (see CI for placeholder).

---

## Repo layout

Figures fall into two classes, split by top-level tree:

- **One-off** article figures — the publication date is a real property, so they file by date.
- **Living** figures (trackers) — periodically updated in place, so they are **dateless**.

```
charts/
  articles/<year>/<month>/<collection-slug>/
    article.yaml                # one-off collection metadata (title, slug, date, url, engineVersion)
    <chart-folder>/
      chart.yaml                # ChartSpec for the engine
      data.csv                  # tidy long-format data (columns: time, series, value)
      baseline.png              # visual lock (Git LFS); regenerate with --update

  trackers/<collection-slug>/
    tracker.yaml                # living collection metadata (title, slug, url, engineVersion, created, cadence)
    <chart-folder>/
      chart.yaml
      data.csv
      baseline.png
```

`<year>/<month>` exists only under `articles/`. `trackers/` is dateless.

Generated outputs (not committed except catalog):

```
dist/<collection-slug>/<chart-folder>/
  index.html                    # self-contained interactive chart
  data.csv                      # copy of the chart's data

catalog/
  index.json                    # array of chart metadata; committed
```

## Identity

Each figure's durable id — the thing the catalog and downstream embeds reference — is

```
<collection-slug>/<chart-folder-name>
```

e.g. `ai-labor-market/augmented-occupations`. It carries **no date and no tree**, so it survives the moves that happen over a figure's life: promoting a one-off to a tracker, reorganizing folders, or re-dating. The rules:

- **`collection-slug`** is declared in `article.yaml`/`tracker.yaml` and names a durable *product* (a report series or tracker) — never a mutable editorial topic, never a date. Unique repo-wide.
- **The chart segment is the chart's folder name** (not a field in `chart.yaml`, which the engine's strict schema would reject). Set it once; don't rename it. Unique within its collection (the filesystem guarantees this).
- **To rename a figure for display, edit `title`/`eyebrow`** — never the slug or folder name.

`npm run validate` enforces these (collection-file matches its tree, slug/folder-name format, repo-wide slug uniqueness) before running the engine's spec validation.

---

## Pipeline scripts

| Command | What it does |
|---|---|
| `npm run validate` | Structural/identity checks, then `tbl-chart validate` on every `chart.yaml`; exit 1 if any fail. |
| `npm run build` | Render every chart to `dist/<id>/index.html`; copy `data.csv`. |
| `npm run snapshot` | Compare each chart's render against its `baseline.png`; exit 1 on mismatch. |
| `npm run snapshot -- --update` | Regenerate all baselines in-place (write new `baseline.png` files). |
| `npm run catalog` | Write `catalog/index.json` from all `chart.yaml` + collection files. |

Run them in order: validate first (catches spec errors before spending time on rendering),
then build, then snapshot, then catalog.

---

## Adding a chart

1. Create a folder under the collection. The **folder name is the chart's id segment** —
   choose it once (lowercase/ASCII/hyphenated) and don't rename it later.
   - one-off: `charts/articles/<year>/<month>/<collection>/<chart>/`
   - tracker: `charts/trackers/<collection>/<chart>/`
2. Write a `chart.yaml` (see `ChartSpec` in the engine's `src/spec/types.ts`; or copy an
   existing example and adjust). The chart's identity lives in the folder name and the
   collection slug — there is **no `slug` field** in `chart.yaml`.
3. Place a `data.csv` alongside it with columns `time`, `series`, `value` (tidy long format).
4. Run `npm run validate` to check structure + spec.
5. Run `npm run snapshot -- --update` to generate the baseline.
6. Run `npm run build` and `npm run catalog` to update outputs.
7. Commit everything (spec, data, baseline via LFS, updated catalog).

### chart.yaml required fields

```yaml
chartType: line          # "line" is the only type in v0.1.x
title: "..."
xAxisType: temporal      # temporal | numeric | quarterly
data: data.csv
```

Optional fields: `eyebrow`, `subtitle`, `source`, `note`, `series_order`, `series_colors`,
`series_styles`, `series_labels`, `yAxisPolicy`, `xAxisPolicy`, `confidence_bands`, `tags`.

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
engineVersion: "0.1.1"   # should match the pinned engine version
```

**Tracker** — `charts/trackers/<collection>/tracker.yaml`:

```yaml
title: "Tracker title"
slug: "collection-slug"
url: "https://..."
engineVersion: "0.1.1"
created: "YYYY-MM-DD"    # optional: immutable first-publication date
cadence: "monthly"       # optional human note; not part of identity
```

---

## Updating a tracker

Trackers are versioned **in place** — git history is the vintage archive; there are no dated
snapshot folders.

1. Replace `data.csv` with the new data at the same path.
2. `npm run validate`, then `npm run snapshot -- --update` to refresh the baseline.
3. `npm run build` and `npm run catalog`.
4. Commit. The figure's id and embed URL are unchanged; prior values remain recoverable from git.

---

## Pinned engine version

The engine is pinned as a git-tag dependency in `package.json`:

```json
"budget-lab-chart-engine": "github:Budget-Lab-Yale/budget-lab-chart-engine#v0.1.1"
```

To bump:

1. Update the tag in `package.json` (e.g. `#v0.2.0`).
2. Run `npm install` to pull the new version and update `package-lock.json`.
3. Run `npm run validate` to confirm existing specs still pass.
4. Run `npm run snapshot -- --update` to regenerate baselines (a version bump may change
   rendering; new baselines are the expected outcome).
5. Commit `package.json`, `package-lock.json`, and the updated `baseline.png` files.

---

## Git LFS

Baseline PNGs and any `.frozen.csv` files are stored in Git LFS. The `.gitattributes`
file configures this automatically. LFS must be installed locally:

```sh
git lfs install
```

After cloning, LFS objects are pulled automatically if LFS is installed.

### Baseline portability caveat

Baselines are platform-specific. Font rendering and anti-aliasing differ between operating
systems (and even between OS versions), so a baseline generated on macOS will not match a
render on Ubuntu CI, and vice versa.

The current baselines were generated on a Windows development machine and prove that the
snapshot pipeline works. Before the snapshot gate is authoritative in CI, baselines must be
regenerated in the canonical launch environment (the same OS/Docker image CI uses). To do
this:

1. Run the CI snapshot job or spin up a matching environment.
2. Run `npm run snapshot -- --update`.
3. Commit the new `baseline.png` files via LFS and push.

After that one-time re-seed, the snapshot gate will catch unintended visual regressions.

---

## Continuous integration

`.github/workflows/ci.yml` runs validate → build → catalog on every push/PR (deterministic,
cross-platform), plus an **advisory** snapshot job (platform-specific baselines; see caveat
above).

**Required secret — `ENGINE_REPO_TOKEN`.** The engine is a *private* cross-repo git
dependency, and the default Actions token cannot clone it, so `npm ci` fails with git exit
128 until you add a token:

1. Create a token with read access to `Budget-Lab-Yale/budget-lab-chart-engine` — either a
   classic PAT with the `repo` scope, or a fine-grained token scoped to that repo (Contents:
   read).
2. Add it as a repository secret named `ENGINE_REPO_TOKEN`
   (`gh secret set ENGINE_REPO_TOKEN --repo Budget-Lab-Yale/budget-lab-charts`).

The workflow rewrites `github.com` git URLs to use this token before `npm ci`. (Alternatively,
making the engine repo public removes the need for the secret.)

---

## Site & hosting

The published site is served from **GitHub Pages**. Its front door is the landing page in
`site/index.html`: a static index that fetches `catalog/index.json` at runtime and lets
people search and filter the archive (free-text, by type/collection/tag, sortable) and open
each figure's live page. Trackers are featured at the top as "living" collections; one-off
figures appear as dated cards. Cards use each chart's `baseline.png` as a thumbnail.

`npm run site` assembles the publishable tree into `_site/` (gitignored):

```
_site/
  index.html                       # landing page (from site/)
  catalog/index.json               # the figure catalog
  <collection>/<chart>/index.html  # each chart's live page (from dist/)
  <collection>/<chart>/data.csv
  <collection>/<chart>/baseline.png  # thumbnail
```

Run it after `build` + `catalog`. Preview locally by serving `_site/` over HTTP (the page
fetches the catalog, so `file://` won't work):

```sh
npm run build && npm run catalog && npm run site
python -m http.server -d _site      # or: npx http-server _site
```

The `deploy` job in `.github/workflows/ci.yml` runs this on `main` and publishes to Pages.
**Prerequisite:** repo Settings → Pages → Source = "GitHub Actions". Like the rest of the
workflow, it's manual-dispatch only until the engine repo is public.

---

## Development

```sh
git clone <this-repo>
git lfs pull         # fetch baseline PNGs
npm install          # installs engine + Playwright dev deps
npx playwright install chromium   # for snapshot support

npm run validate
npm run build
npm run snapshot
npm run catalog
```
