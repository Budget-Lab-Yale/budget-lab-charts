---
name: publishing-figures
description: Use when adding or changing content in this repo — creating a new article collection, creating a new tracker, adding charts/figures/tables to an existing collection, or updating an existing tracker's data in place. Triggers include "add an article", "add a chart/figure/graph/table", "publish these figures", "new tracker", "update the tracker", "put this data on the site".
---

# Publishing figures in budget-lab-charts

This repo is the Budget Lab's published-figures archive: one folder per figure
(`chart.yaml` or `table.yaml` + long-format `data.csv`) under a collection folder, discovered
and built automatically by CI. Folder names and slugs are **permanent public ids** — the
central risk in this workflow is writing identity or data you had to guess at. When in doubt,
ask before writing files.

## Route by task

| Task | Path | Follow |
|---|---|---|
| New article (one-off publication) | `charts/articles/<yyyy>/<mm>/<slug>/` | this file, top to bottom |
| Add figures to an existing collection | existing collection folder | this file; skip Stage 1 |
| New tracker (living, updated on a cadence) | `charts/trackers/<slug>/` | [references/tracker-workflows.md](references/tracker-workflows.md) |
| Update a tracker's data | existing `data.csv`, in place | [references/tracker-workflows.md](references/tracker-workflows.md) |

## Authoritative docs — read before writing YAML

The schema is strict (`additionalProperties: false`): unknown or misspelled fields fail the
build, so never invent fields. Field-by-field reference: **`CONFIG-REFERENCE.md`** at the repo
root — read the sections relevant to your task (`chart.yaml`, `table.yaml`, `article.yaml`,
`tracker.yaml`, CSV format, Colors). Workflow overview: `README.md`. Undecided design choices
(chart type, annotations, colors): [references/chart-decisions.md](references/chart-decisions.md).

## Step 1 — Inspect the data first

Before asking the user anything, read every data file they provided: headers, x-value format,
series count, wide vs long shape, units, anomalies. Questions you ask must carry
data-informed defaults, and questions the data already answers must not be asked.

## Step 2 — Interview before writing

Bunch questions into a few multi-question rounds (use AskUserQuestion where available) rather
than dribbling them one at a time.

**Ask-first gates.** These are the decisions you must put to the user BEFORE creating any file,
because files encode them permanently or silently distort the publication:

1. **Identity** — collection slug and each figure folder name. Propose kebab-case names derived
   from the titles and get a yes. They can never be renamed after merge (they are embed URLs).
2. **Data anomalies** — any cell you would alter, drop, or reinterpret: accounting negatives
   like `(0.5)`, `NA`/blank conventions, outliers that look like data-entry errors, ambiguous
   units, sign conventions. Present the options (keep as negative / treat as missing / user
   supplies correct value) and let the user pick. Never write a silently "fixed" value and
   flag it afterward — by then the file exists and the flag gets lost.
3. **Content metadata you weren't given** — article title, publication date, source line,
   figure numbering. Never write placeholders into real files; a placeholder title in
   `article.yaml` reaches the public catalog if merged unnoticed.

When a question needs free text (a title, a date, a name), make your best proposal the option —
the question UI's built-in "Other" carries custom answers. Never offer a "let me specify" /
"another date" stub option: it returns no value and forces a dead-end follow-up round.

**Interview stages** (skip anything already specified or already answered by the data):

- **Stage 1 — collection**: title; publication date (or cadence, for trackers); confirm the
  proposed slug. `url:` stays `""` until the article is live.
- **Stage 2 — figure list**: confirm the list of figures (title each) and the numbering scheme
  — `"Figure 1"`, `"Appendix Figure 1"`, `"Table 1"` labels live in the collection file's
  `figures:` map, keyed by figure folder name.
- **Stage 3 — per-figure design**: chart type (recommend one from
  [references/chart-decisions.md](references/chart-decisions.md)), colors (default palette
  unless the user wants specific hues), annotations (none is the default), source and note
  text. For several similar figures, ask once whether the choices apply to all.

**Decide silently, then surface in a summary** (do not ask): `<yyyy>/<mm>` path from the date;
`columns:` mapping from CSV headers; `xAxisType` inferred from x values (`YYYY-MM-DD` →
temporal, `YYYYQ#` → quarterly, plain numbers → numeric, otherwise categorical — ask only if
genuinely ambiguous); UTF-8 without BOM, LF line endings. End the interview with a compact
summary of everything decided, then build.

## Step 3 — Prepare the data

The engine takes **long/tidy CSV**: one row per observation, any column names (mapped to roles
in the spec's `columns:` block), values numeric-or-empty. If the input is anything else —
wide, Excel, multiple files, formatted numbers — follow
[references/data-reshaping.md](references/data-reshaping.md).

## Step 4 — Write the files

```
<collection>/
  article.yaml            # or tracker.yaml — title, slug, date, url, figures map
  <figure-folder>/
    chart.yaml            # or table.yaml
    data.csv
```

`charts/articles/2026/06/atus-childcare/` is a good tracked exemplar (richer example set at
`charts/articles/2026/07/ai-fiscal/` if present — but note its annotation syntax is legacy;
write the modern `annotations:` block per CONFIG-REFERENCE.md instead of copying
`xAxisPolicy.markers`/`bands` or `yAxisPolicy.markers`).

## Step 5 — Verify and finish (all four, in order)

1. **`npm run validate`** — must pass with zero errors. Engine errors are pointed; fix and re-run.
2. **`npm run catalog`** — regenerates `catalog/index.json`, which is a **committed** file that
   downstream embeds read. Any content add/retitle/renumber makes it stale; commit the updated
   catalog together with the content. (The README quick-start omits this step — do it anyway.)
3. **Preview** — `npm run dev` serves a live preview at `http://localhost:5173` (auto-reloads on
   save, shows engine errors inline). Tell the user to look at the rendered figure before the
   PR; charts are reviewed visually, there are no image baselines.
4. **Report** — restate every decision made on the user's behalf (data cleaning, inferred
   types, mappings) in your final summary, then follow the PR flow in `README.md` (CI comments
   a live preview URL on every PR; merging publishes).

If validation fails in ways you don't expect, check [references/gotchas.md](references/gotchas.md).
