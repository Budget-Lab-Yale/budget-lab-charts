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

## `columns.section requires a horizontal "bar", "stacked" or "dumbbell" chart`

Sections exist only on horizontal charts. Since v1.16.0 a horizontal `stacked` chart takes them too,
so a sectioned stacked distribution no longer needs the old `x_order` workaround. A vertical chart
cannot have sections; set `orientation: horizontal` or drop `columns.section`.

## Section and facet errors

- `category "A" in section "S1" has more than one "x" value — rows are identified by section +
  category, ...` — two CSV rows for the same section + category + series. A label repeated across
  *different* sections is fine (two rows); within one section it is a duplicate to resolve with the
  user, not to sum or drop.
- `columns.facet and columns.section are both set: on a horizontal chart columns.facet draws its
  values as groups, ...` — keep one, normally `columns.section`.
- `section_order applies to columns.section; with columns.facet the groups are ordered and titled by
  ...` (also `section_labels`) — on a faceted horizontal chart use `small_multiples.pane_order` /
  `pane_titles`, or switch the facet column to `columns.section`.
- `tooltip_section needs columns.section — ...` — the field only means something on a sectioned
  chart.

## `annotations.yAxis draws nothing on a horizontal "bar" chart: its value axis runs along x, ...`

On a horizontal `bar`, `stacked` or `dumbbell` chart a value-axis line is an `annotations.xAxis`
entry with `x` set to the value (`x: "0.13"`). Same for legacy `yAxisPolicy.markers`.

## `/series_order: "X" appears more than once`

Since v1.16.0 a value listed twice in `series_order` or `shape_order` is a validation error. Remove
the repeat.

## `series_order names series ["X"] not found in the data`

Config keys must match CSV values **byte-for-byte**: en-dash vs hyphen (`High–income` ≠
`High-income`), trailing spaces, curly quotes. Print `JSON.stringify` of the CSV's unique
series values and copy from that. Also remember `series_order` **filters** — a series left out
of the list disappears from the chart.

## `row N: time: expected YYYY-MM-DD or YYYY, got "..."` / `row N: time: invalid date "..."`

x formats are strict: temporal is exactly `YYYY-MM-DD` or a bare `YYYY` (not `YYYY-MM`, not
`M/D/YYYY`, not `2024-1-1`); quarterly is exactly `2025Q1` (not `2025-Q1`, not `Q1 2025`, not
`2025q1`). Monthly data → first-of-month dates. `invalid date` means the shape is right but the day
does not exist (`2023-02-29`, `2024-02-30`): a source error to raise with the user, not to round.
The same grammar applies to annotation, shading and rug dates in the spec.

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

## Treemap errors and warnings

- `row N: columns.value ("...") must be a number ≥ 0, got "..."` — a negative, blank or text value.
  A treemap cannot draw a negative part; ask the user (data-reshaping.md § Treemap data).
- `row N: duplicate tile "A" in group "g" (also row M)` — the same name twice in one group (or twice
  anywhere, with no groups). Usually a missed aggregation or a missing group column; ask.
- `... is not supported on chartType "treemap"` — the treemap takes only its accepted-field list.
  The common slip is `value_prefix` / `value_suffix`: use `value_format: {prefix, suffix}`.
- `chartType "treemap" requires xAxisType "categorical"`.
- Warnings (validate still passes): zero-value rows, more than 30 tiles, more than seven groups with
  no `series_colors`, and more than half the tiles unlabelled at the export width. Raise them with
  the user; fewer, larger tiles (aggregate a long tail into "Other") usually answers the last two.

## Table YAML breaks on math

MathJax must sit in **single-quoted** YAML strings: `column_labels: {Change: '\(\Delta\)'}`.
Double quotes make YAML eat the backslashes. Only the linear subset renders — `\frac`, `\sqrt`,
matrices are rejected at validation.

## Structure errors from `npm run validate` stage 1

Slug must match the collection folder name, match `^[a-z0-9]+(?:-[a-z0-9]+)*$`, and be unique
across the whole repo (articles AND trackers). Every key in a `figures:` map must be an actual
figure folder in that collection. An `article.yaml` cannot live under `charts/trackers/` or
vice versa.
