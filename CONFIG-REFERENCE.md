# Config reference

Authoritative list of fields you can set in this repo's config files. Defaults are applied
implicitly — **only declare what differs**.

Two config files exist:

- **`chart.yaml`** — one per figure. This is the engine's `ChartSpec`; it is validated against a
  strict JSON schema (`additionalProperties: false` at every level), so a typo like `xAxisTpye`
  or `serires_order` **fails the build** instead of being silently ignored. The contract lives in
  the engine's `src/spec/types.ts` / `src/spec/schema.ts` — this page mirrors it.
- **`article.yaml` / `tracker.yaml`** — one per collection. This repo's own metadata (title, slug,
  date, figure-number map); checked by `scripts/validate-all.mjs`, not the engine.

`npm run validate` runs both stages (structure/identity, then `tbl-chart validate` per chart).
Run it before opening a PR.

---

## Files

```
charts/
  articles/<year>/<month>/<collection-slug>/
    article.yaml                # one-off collection metadata
    <chart-folder>/
      chart.yaml                # ChartSpec (this page)
      data.csv                  # long-format data
  trackers/<collection-slug>/
    tracker.yaml                # living-collection metadata
    <chart-folder>/
      chart.yaml
      data.csv
```

A figure's durable id is **`<collection-slug>/<chart-folder-name>`** — no date, no tree. The chart
segment is the **folder name** (there is no `slug` field in `chart.yaml`); the collection slug is
declared in the collection file. Set both once and don't rename them.

---

## `chart.yaml`

### Required

| field | type | notes |
|---|---|---|
| `chartType` | enum | `line` \| `bar` \| `stacked`. |
| `title` | string | Card title above the chart. Rendered verbatim. |
| `xAxisType` | enum | `numeric` \| `temporal` \| `quarterly` \| `categorical`. Determines how the x column is parsed (see [CSV format](#csv-format)). |
| `data` | string \| object | Usually just `data.csv` (see [Data](#data)). |

> There is **no `eyebrow`** field — the figure number is a property of the article, set in the
> collection file's `figures:` map. There is **no `slug`** — identity is the folder name.

### Column mapping

`columns:` maps your CSV column names onto the engine's roles. The whole block is optional; absent,
it defaults to `x: time`, `value: value`, `series: series`.

| field | type | notes |
|---|---|---|
| `columns.x` | string | Column holding the x value. Default `"time"`. |
| `columns.value` | string | Column holding the numeric y value. Default `"value"`. |
| `columns.series` | string | Column identifying series. **Omit for a single-series chart.** Default `"series"` if present. |
| `columns.facet` | string | Column whose distinct values split small-multiples panes. |

### Text

| field | type | notes |
|---|---|---|
| `subtitle` | string | Below the title (often the units). |
| `source` | string | Source line below the chart. |
| `note` | string | Note line below the chart, above the source. |
| `x_axis_title` | string | Caption below the x-axis. |
| `y_axis_title` | string | Short caption above the y-axis (left-aligned, horizontal). |

### Axes

| field | type | notes |
|---|---|---|
| `xAxisPolicy.anchorAtZero` | boolean | Numeric x-axis only: extend the visible domain to include 0. |
| `xAxisPolicy.markers` | array | Vertical reference lines. Each `{x, label?, style?, color?, strokeWidth?}`; `x` required; `style` is `dashed` \| `solid`. |
| `yAxisPolicy.min` | number | Hard floor for the y-axis. |
| `yAxisPolicy.max` | number | Hard ceiling for the y-axis. |
| `yAxisPolicy.includeZero` | boolean | When `true` (and no hard min/max), always extend the y-domain to 0. |
| `yAxisPolicy.tickCount` | integer | Approximate target number of y-ticks. Default 5. |
| `yAxisPolicy.autoWiden.step` | number | When data exceeds `max`, round the ceiling up to the next multiple of `step`. |

### Series

The series **column** is set via `columns.series`. These options reference the series **keys**
(the values in that column).

| field | type | notes |
|---|---|---|
| `series_order` | array | Render order. **Also an inclusion filter** — when set, only listed series render. |
| `series_colors` | object | `{ <seriesKey>: color }`. Overrides palette assignment. `color` is a named color or raw `"#hex"` (see [Colors](#colors)). |
| `series_styles` | object | `{ <seriesKey>: { dashed: true } }`. `dashed` is currently the only flag. |
| `series_labels` | object | `{ <seriesKey>: "Display name" }`. Lets the CSV use short keys while the legend/tooltip show full names. All other refs keep using the short key. |

### Confidence bands

| field | type | notes |
|---|---|---|
| `confidence_bands` | array | Each `{series, lower, upper}`. `series` is the data key the band wraps; `lower`/`upper` are CSV column names. Renders as a tinted area behind the line. |

### Line options

| field | type | notes |
|---|---|---|
| `points` | boolean | Draw a marker dot at each data point. Default false. |

### Bar / stacked-bar options

| field | type | notes |
|---|---|---|
| `orientation` | enum | `vertical` (default; value axis is Y) \| `horizontal`. |
| `valueLabels.show` | boolean | Show in-bar value labels. |
| `valueLabels.signed` | boolean | Force a leading `+`/`−` on value labels. |
| `barStack.netDisplay` | enum | Net (sum) callout on stacked bars: `auto` (default — dot if any value is negative, else text) \| `text` \| `dot` \| `none`. |
| `barStack.mono.base` | color | Monochrome stack: render all segments as shades of one base hue (a categorical hue key or alias; see [Colors](#colors)). |
| `barStack.netLabelColor` | enum | `white` \| `black`. |
| `barStack.normalize` | boolean | Normalize each bar to 100% (0–1 scale). |
| `highlightSeries` | array | Series keys to emphasize (dims all others). |
| `legendPosition` | enum | `top` \| `right`. Default `top`, except a diverging stacked chart or one with ≥5 series defaults to `right`. An explicit value always wins. |

### Small multiples

Set `columns.facet` to the pane-splitting column, then tune the grid here.

| field | type | notes |
|---|---|---|
| `small_multiples.columns` | integer | Grid column **count** (distinct from the `columns` role map). Default derived (≈ ceil(√n), capped). |
| `small_multiples.mode` | enum | `shared` (one y-scale, y-labels in the left column only — default) \| `per-pane` (each pane its own y-scale/units). |
| `small_multiples.pane_order` | array | Pane render order + inclusion filter (like `series_order` for series). |
| `small_multiples.pane_titles` | object | `{ <facetValue>: "Display title" }`. Falls back to the raw facet value. |
| `small_multiples.coordinated_cursor` | boolean | Hovering one pane echoes a secondary cursor on every pane at the same x. Default true. |

### Data

`data` is usually the bare filename. The object forms support a local file or a remote source.

| form | notes |
|---|---|
| `data: data.csv` | String — sugar for `{ file: "data.csv" }`. The common case. |
| `data: { file: "..." }` | Explicit local file, relative to the chart folder. |
| `data: { url: "...", format: "csv"\|"json", map?: {...} }` | Remote source. For JSON, `map` renames source fields onto the tidy shape: `{ timeField, seriesField, valueField }`. |

### Catalog

| field | type | notes |
|---|---|---|
| `tags` | array | Free-form facet tags, recorded in `catalog/index.json`. |

---

## Colors

Anywhere a color is accepted (`series_colors`, `xAxisPolicy.markers[].color`, `barStack.mono.base`),
the value is either a **named color** or a raw `"#hex"`. Named colors:

- **Categorical hues:** `blue`, `amber`, `violet`, `green`, `red`, `rose`, `russet` — and a
  `-light` variant of each (e.g. `blue-light`).
- **Aliases:** `purple`→violet, `pink`→rose, `yellow`→amber, `brown`→russet (each with `-light`).
- **Neutrals:** `black`, `grey` (`gray`), `navy`.

Unrecognized names pass through unchanged, so a raw `"#1A1A2E"` works too. `barStack.mono.base`
accepts only the 7 categorical hues (or an alias) — it pulls that hue's tonal scale.

---

## `article.yaml` (one-off collection)

```yaml
title: "Article title"
slug: "collection-slug"      # durable; lowercase/ASCII/hyphenated; unique repo-wide
date: "YYYY-MM-DD"           # publication date — a real property of a one-off
url: "https://..."           # leave empty until published
figures:                     # optional: figure-number eyebrows
  chart-folder-slug: "Figure 1"
```

| field | required | notes |
|---|---|---|
| `title` | yes | Collection / article title. |
| `slug` | yes | First segment of every chart id under it. Lowercase/ASCII/hyphenated, unique repo-wide. Never a date. |
| `date` | recommended | Publication date. |
| `url` | optional | Canonical article URL. |
| `figures` | optional | Map of **chart-folder slug → eyebrow label** (see [Figure numbers](#figure-numbers)). |

## `tracker.yaml` (living collection)

```yaml
title: "Tracker title"
slug: "collection-slug"
url: "https://..."
created: "YYYY-MM-DD"        # optional: immutable first-publication date
cadence: "monthly"           # optional human note; not part of identity
figures:
  chart-folder-slug: "Figure 1"
```

| field | required | notes |
|---|---|---|
| `title` | yes | Tracker title. |
| `slug` | yes | Same rules as above. |
| `url` | optional | Canonical tracker URL. |
| `created` | optional | Immutable first-publication date (trackers are dateless in identity; versioned in place via git). |
| `cadence` | optional | Human note (e.g. `"monthly"`); not part of identity. |
| `figures` | optional | Same as above. |

### Figure numbers

A figure number ("Figure 1", "Appendix Figure 2") is a property of the **article a chart is
embedded in**, not the chart — so it is **not** a `chart.yaml` field. The collection file's
optional `figures:` map keys each chart-folder slug to a label. `build-all` passes the matching
label to the engine (`--eyebrow`); the embed can suppress it at view time with `?eyebrow=off`.
A chart omitted from the map renders with no eyebrow. Validation fails if a `figures` key matches
no chart folder in the collection.

---

## CSV format

Long format. Columns are named freely and mapped via `chart.yaml`'s `columns:` block; absent that
block, the engine expects `time`, `series`, `value`.

| role | content |
|---|---|
| x (`time`) | x-value. Must parse per `xAxisType`: integer for `numeric`, `YYYY-MM-DD` for `temporal`, `YYYYQ#` for `quarterly`, any string for `categorical`. |
| series | Series identifier; each distinct value is a separate line/segment. Omit the column entirely for a single-series chart. |
| value | Numeric y-value. May be empty for missing observations. |

Optional columns:

| column | when required |
|---|---|
| confidence bounds | Required if `confidence_bands` references their column names. |
| facet column | Required if `columns.facet` is set; each distinct value becomes a pane. |

Validation parses every row and fails on malformed x-values, non-numeric values, missing required
columns, or referenced keys (series, facet, band column) that don't appear in the data.

---

## Minimal examples

**Single-series line:**

```yaml
chartType: line
title: "Median hours worked"
xAxisType: temporal
data: data.csv
# columns omitted → time / value, no series
```

**Multi-series line with custom colors and small multiples:**

```yaml
chartType: line
title: "Childcare time by activity"
subtitle: "Hours per day"
xAxisType: categorical
columns:
  x: age_bin
  value: mean_hours
  series: cohort
  facet: sex_label
series_order: [Gen X, Millennial]
series_colors:
  Gen X: blue
  Millennial: amber
small_multiples:
  columns: 2
  mode: shared
source: "Source: American Time Use Survey."
data: data.csv
```
