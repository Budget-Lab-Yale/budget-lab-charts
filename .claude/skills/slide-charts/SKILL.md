---
name: slide-charts
description: Use when putting a Budget Lab chart onto a PowerPoint slide or into a presentation deck — "make a slide of figure X", "add this chart to the deck", "put the State of Tariffs GDP figure in the Russell Sage deck", "chart for a presentation". Renders TBL-branded slide-sized PNG/SVG from a published figure, new data, or an interactive tool, and inserts it into a TBL 16:9 deck. NOT for publishing figures to the website or the charts archive — that is publishing-figures.
---

# Slide charts

Slide-sized, TBL-branded charts from the same engine as the website, inserted into a TBL 16:9
deck. Nothing here touches the published archive: working files live **beside the deck**, in
`<deck folder>\Slide charts\<name>\`, and every script refuses paths under `charts/`. Never run
git writes for this work.

## 0. Preflight
`npm run slides:preflight`. Fix anything it reports before going further. Claude Code must be
open in the budget-lab-charts repo for this skill to load.

## 1. Ask, in one batch
- The deck (`.pptx` path). It must be 16:9; the script refuses 4:3.
- Where the chart goes: after slide N (new slide), or onto existing slide N.
- The frame:
  - `below-title`: the standard chart slide, under the navy title bar.
  - `full`: the whole slide, no title bar.
  - `half`: two charts side by side under one title.
- The source (step 2).
- **The slide title, in the user's own words. Never draft or suggest one.** `full` has no title.
- Whether to keep the source line (default: dropped, as in the PLC and Russell Sage decks).

## 2. Get the figure into a working folder
Name the folder after the figure in kebab-case: `<deck folder>\Slide charts\<name>\`.
- **Published figure:** `node scripts/slides/fetch-archived.mjs <slug>/<figure> --to "<folder>"`
  (matched against the published archive; if it reports more than one match, pass the longer
  collection path it lists).
- **Interactive tool** (State of Tariffs, AI labor tracker): set the tool's state in the browser,
  copy the URL, then run `node scripts/slides/capture-interactive.mjs "<url>"` to list the
  figures, and rerun it with `--pick <name> --to "<folder>"`. Taxes at the Top and the deficit
  calculator don't keep their state in the URL, so only their default view can be captured. Say so.
- **New data:** run a short intake: chart type (line, area, bar, stacked, scatter, dotplot,
  small-multiples), title, subtitle with units, series order, colors. Colors come from the
  categorical ramp only (`blue amber violet green red rose russet`; never `navy`/`sky`/`grey`/`black`
  as series colors). Write `chart.yaml` and `data.csv` in the working folder. The schema is
  `ENGINE-CONFIG-SPEC.md`, which is strict, so never invent a field.

## 3. Render and look
`node scripts/slides/render-slide.mjs "<folder>" --frame <frame> [--keep-source]`. Open the PNG and
check it: overlapping labels, labels sitting on bars, cramped panes, a title that wraps badly. Fix
issues in `chart.yaml` and re-render. If it reports that the chart is taller than the frame, take
its suggestion. Don't work around it.

## 4. Insert
`powershell -NoProfile -File scripts/slides/insert-slide.ps1 -Deck "<deck>" -Frame <frame> -Image "<folder>\<name>.png" [-Image2 …] -Title "<user's title>" (-After N | -Onto N [-Replace]) [-Layout "<layout name>"]`.
`-Image2` is for `half` only; omit `-Title` for `full`. `-Replace` is required when slide N already has pictures. `-Layout` is only needed if the deck's
layout name differs from the frame's default; the script lists the available names when it fails.
It backs up the deck to `Slide charts\_backups\` first and works on the deck even if it's open in
PowerPoint. Open the QA PNG it prints and compare it with a neighbouring chart slide.

## 5. Report
The slide number(s), the working folder, the backup path, and anything not carried over (the source
line, interactive states that couldn't be captured). Quote the title the user gave; don't restate
the chart.

## Not this skill
- Publishing a figure to the website or the archive: `publishing-figures`.
- Tables on slides: not supported. Say so.
