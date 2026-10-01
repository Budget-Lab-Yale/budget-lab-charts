# Validation gotchas — symptom → fix

The engine's error messages are pointed; read them literally. These are the traps that survive
even careful doc-reading.

## `/annotations/xAxis/0/x: must be string` (also bands start/end, points x)

Annotation **x-coordinates are strings even on a numeric axis** — write `x: "2017"`,
`start: "2008"`. Only `y` (in `annotations.yAxis` and `annotations.points`) is a number.

## `unknown property "..." (check for a typo)`

The schema rejects unknown fields at every level (`additionalProperties: false`). Common
inventions that do not exist in `chart.yaml`/`table.yaml`: `eyebrow` and `slug` (figure numbers
live in the collection file's `figures:` map; identity is the folder name), `date`, and any
misspelling of a real field. Check ENGINE-CONFIG-SPEC.md rather than guessing a fix.

## Legacy annotation syntax in older examples

Some existing charts use `xAxisPolicy.markers` / `xAxisPolicy.bands` / `yAxisPolicy.markers`.
Those are deprecated aliases — even though committed examples contain them, write the modern
`annotations:` block (ENGINE-CONFIG-SPEC.md § Annotations) in new charts.

## `columns.section requires chartType "bar" with orientation "horizontal"`

The section axis works only on plain horizontal **bar** charts — not `stacked`, even horizontal.
For a sectioned stacked distribution, drop `columns.section`/`section_order` and convey the
grouping through `x_order` instead.

## `series_order names series ["X"] not found in the data`

Config keys must match CSV values **byte-for-byte**: en-dash vs hyphen (`High–income` ≠
`High-income`), trailing spaces, curly quotes. Print `JSON.stringify` of the CSV's unique
series values and copy from that. Also remember `series_order` **filters** — a series left out
of the list disappears from the chart.

## `row N: time: expected YYYY-MM-DD, got "..."`

x formats are strict: temporal is exactly `YYYY-MM-DD` (not `YYYY-MM`, not `M/D/YYYY`);
quarterly is exactly `2025Q1` (not `2025-Q1`, not `Q1 2025`). Monthly data → first-of-month
dates.

## `columns.x is "time" but no such column exists`

Either the `columns:` block doesn't match the CSV header, or the header's first cell carries an
invisible UTF-8 BOM. Rewrite the CSV without BOM.

## Timeline errors and warnings

- `row N: columns.end (...) is "..."; expected blank, a date, or "ongoing"` — the end column holds
  prose ("present", "TBD", "2027?"). Ongoing is the literal word `ongoing`; an unknown end is a
  question for the user, not a cell to guess.
- `row N: end ... is before start ...` — usually swapped columns or a typo; ask.
- `row N: columns.x (...): expected YYYY-MM-DD or YYYY` — a month (`2027-06`) or a fiscal/season
  label in the date column. Month → first of the month; `FY2030` → a placement date plus a
  `date_label` (data-reshaping.md § Timeline data).
- `row N: columns.label (...) is blank` — every event needs a headline.
- `... is not supported on chartType "timeline"` — the timeline takes only its accepted-field list;
  `annotations`, `overlays` and value-axis fields have no meaning on it.
- `timeline.axis cannot be used with timeline.spacing "even"` — pick one: even spacing makes the
  gaps meaningless, so ticks would mislead.
- `x_axis_title on a timeline requires timeline.axis: true` — there is no axis without the ticks.
- Warnings (validate still passes): `more than 20 is hard to read — consider splitting it`, and
  `horizontal layout needs more than N label rows per side at the ...px export width` — the PNG
  then grows extra rows. Raise them with the user; `orientation: vertical` usually answers both.

## Table YAML breaks on math

MathJax must sit in **single-quoted** YAML strings: `column_labels: {Change: '\(\Delta\)'}`.
Double quotes make YAML eat the backslashes. Only the linear subset renders — `\frac`, `\sqrt`,
matrices are rejected at validation.

## Structure errors from `npm run validate` stage 1

Slug must match the collection folder name, match `^[a-z0-9]+(?:-[a-z0-9]+)*$`, and be unique
across the whole repo (articles AND trackers). Every key in a `figures:` map must be an actual
figure folder in that collection. An `article.yaml` cannot live under `charts/trackers/` or
vice versa.
