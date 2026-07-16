# Tracker workflows

A tracker is a **living** collection: same figure ids and embed URLs forever, data refreshed on
a cadence. Git history is the vintage archive — there are no dated copies.

## Creating a tracker

Layout: `charts/trackers/<slug>/` — **dateless** (no `<yyyy>/<mm>` in the path), with
`tracker.yaml` instead of `article.yaml`:

```yaml
title: "Federal Deficit Tracker"
slug: "federal-deficit-tracker"     # must equal the folder name; unique repo-wide
url: ""                              # canonical page, once live
created: "2026-07-15"                # first-publication date — set once, never change
cadence: "monthly"                   # human note: how often it updates
figures:
  <figure-folder>: "Figure 1"
```

There is no `date:` field in tracker.yaml. `created` and `cadence` are optional in the schema
— ask the user for both anyway (see SKILL.md ask-first gates); they are cheap to set now and
awkward to reconstruct later. Figure folders work exactly as in articles. Full reference:
CONFIG-REFERENCE.md § tracker.yaml.

When the data comes from a recurring external source, name the raw-snapshot convention:
frozen copies use the `*.frozen.csv` suffix (tracked via Git LFS per `.gitattributes`).

## Updating a tracker's data (the routine case)

The update is a **data-only, in-place** change:

1. Locate the tracker (`charts/trackers/<slug>/<figure>/data.csv`) and read the existing CSV —
   match its column names, x format, units, and sign convention exactly.
2. Edit that `data.csv` in place: append new periods; for revised periods, **replace** the
   existing row (never leave duplicate (x, series) pairs). Ask the user when a revision
   conflicts with what "revised" plausibly means (sign flip, order-of-magnitude change).
3. Touch nothing else: no folder renames, no changes to `created`, `slug`, or figure folder
   names — embeds on external sites reference the durable id `<slug>/<figure-folder>`.
   `chart.yaml` changes only if the user explicitly wants a design change.
4. Verify per SKILL.md Step 5: `npm run validate`, then `npm run catalog` (a data-only update
   usually leaves the catalog unchanged, but retitles/renumbers don't), preview with
   `npm run dev`, and summarize what changed (periods added, values revised).
