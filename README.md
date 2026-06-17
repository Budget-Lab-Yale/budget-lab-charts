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

```
charts/<year>/<month>/<article-slug>/
  article.yaml                  # article-level metadata (title, date, engineVersion, slug)
  <chart-slug>/
    chart.yaml                  # ChartSpec for the engine
    data.csv                    # tidy long-format data (columns: time, series, value)
    baseline.png                # visual lock (Git LFS); regenerate with --update
```

Generated outputs (not committed except catalog):

```
dist/<year>/<month>/<article>/<chart>/
  index.html                    # self-contained interactive chart
  data.csv                      # copy of the chart's data

catalog/
  index.json                    # array of chart metadata; committed
```

---

## Pipeline scripts

| Command | What it does |
|---|---|
| `npm run validate` | Run `tbl-chart validate` on every `chart.yaml`; exit 1 if any fail. |
| `npm run build` | Render every chart to `dist/<id>/index.html`; copy `data.csv`. |
| `npm run snapshot` | Compare each chart's render against its `baseline.png`; exit 1 on mismatch. |
| `npm run snapshot -- --update` | Regenerate all baselines in-place (write new `baseline.png` files). |
| `npm run catalog` | Write `catalog/index.json` from all `chart.yaml` + `article.yaml` files. |

Run them in order: validate first (catches spec errors before spending time on rendering),
then build, then snapshot, then catalog.

---

## Adding a chart

1. Create a folder under the appropriate article: `charts/<year>/<month>/<article>/<chart>/`
2. Write a `chart.yaml` (see `ChartSpec` in the engine's `src/spec/types.ts`; or copy an
   existing example and adjust).
3. Place a `data.csv` alongside it with columns `time`, `series`, `value` (tidy long format).
4. Run `npm run validate` to check the spec.
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

## Adding an article

Create `charts/<year>/<month>/<article>/article.yaml`:

```yaml
title: "Article title"
date: "YYYY-MM-DD"
url: "https://..."       # leave empty until published
engineVersion: "0.1.1"  # should match the pinned engine version
slug: "article-slug"
```

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

## Hosting

Deploy target is TBD at launch. A placeholder step is present but commented out in
`.github/workflows/ci.yml`. The `dist/` folder produced by `npm run build` contains
self-contained HTML files ready to serve from any static host.

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
