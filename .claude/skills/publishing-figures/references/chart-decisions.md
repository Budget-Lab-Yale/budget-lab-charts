# Figure design decisions

Use this when the user hasn't specified a chart type, colors, or annotations, or when you need
to recommend one. Full field reference: `CONFIG-REFERENCE.md` (repo root) — this file only
helps choose; it is not the schema.

## Choosing `chartType`

| Data shape | Recommend |
|---|---|
| Values over time, few series | `line` |
| Parts of a whole over time | `area` (stacked automatically) |
| Values by category, 1–4 series | `bar` (grouped when multi-series) |
| Parts of a whole by category | `stacked` |
| Two numeric variables per observation | `scatter` |
| Point estimates across categories (e.g. by decile, by group) | `dotplot` |

Hard constraints the engine enforces:

- `scatter` requires `xAxisType: numeric`; `dotplot` requires `xAxisType: categorical`.
- `columns.section` (grouped category axis) works only on **horizontal** bar charts.
- Horizontal `stacked` cannot combine with `small_multiples`.

## Inferring `xAxisType` from the x column

`YYYY-MM-DD` → `temporal` · `YYYYQ#` (e.g. `2025Q1`) → `quarterly` · plain numbers (years,
ages, percentiles) → `numeric` · anything else → `categorical`. Monthly data: convert to
first-of-month `YYYY-MM-DD` and use `temporal`. Ask the user only when genuinely ambiguous
(e.g. integer bins that could be ordered categories).

## Titles

House style is a takeaway sentence, not a variable description — compare
"Capital and corporate revenue increases offset labor revenue losses in most scenarios" with
"Revenue by income type". Titles come from the user: when asking, mention the house style, but
do not draft titles for them unless they ask for help. Units belong in `subtitle` (e.g.
"Percent of GDP, fiscal years"), not in the data.

## Colors

**Always use palette names — never a raw `"#hex"`.** Every color in this archive is a palette
token so published figures stay on-brand and consistent with each other; a hardcoded hex breaks
that even when it looks right in one figure. The engine accepts hex, but that is not a licence to
use it here.

Default: omit `series_colors` entirely — the engine assigns the house palette in series order.
When you need control, use the named hues: `blue`, `amber`, `violet`, `green`, `red`, `rose`,
`russet` (each with a `-light` variant; aliases `purple`→violet, `pink`→rose, `yellow`→amber,
`brown`→russet; neutrals `black`, `grey`, `navy`). Semantic conventions worth offering: red for
deficits/costs, blue as the lead series.

If the user asks for a particular color, map it to the nearest palette name rather than writing
its hex. If they ask for a color with no palette equivalent, **push back**: explain that figures
use the fixed house palette for cross-publication consistency, and offer the closest token. Write
a raw hex only if the user explicitly insists after that pushback — never reach for one yourself,
and never leave a color the engine assigned as hex when a palette name is available.

## Annotations — offer these when the story needs them

All four kinds live under one `annotations:` block (see CONFIG-REFERENCE.md § Annotations):

| Kind | Use for | Shape |
|---|---|---|
| `bands` | recessions, policy windows, shaded periods | `{start, end, label?}` |
| `xAxis` | event lines ("TCJA enacted") | `{x, label?}` |
| `yAxis` | zero lines, targets, historical averages | `{y, label?, style?}` |
| `points` | calling out one observation | `{x, label, series? or y?, connector?}` |

**Coordinate types**: `x`, `start`, `end` are **strings** — quote them even on a numeric axis
(`x: "2017"`, not `x: 2017`), or validation fails with `must be string`. `y` is a **number**.
A zero line reads best as `{y: 0, style: solid}` with no label.

## Series options (one-liners; details in CONFIG-REFERENCE.md § Series)

- `series_order` — sets order **and filters**: a series omitted from the list is dropped from
  the chart. List all of them or none.
- `series_labels` — display names; keep raw CSV keys and rename here rather than editing data.
- `series_styles: {key: {dashed: true}}` — projections/counterfactuals; for actual forecast
  rows prefer `projected_field` (a data column flagging projected observations).
- `confidence_bands: [{series, lower, upper}]` — lower/upper are CSV column names.
- `small_multiples` — requires `columns.facet`; then `columns`, `pane_order`, `pane_titles`.

## Tables (`table.yaml`)

Data is tidy, **one CSV row per cell**. Required: `title`, `data`, `stub` (row nesting),
`header` (column nesting), `value`. Number formats via `format:` rules (`number`/`percent`/
`currency`, `decimals`). Math in any table text uses MathJax `\(...\)` — put it in a
**single-quoted** YAML string (`'\(\Delta\)'`); linear subset only, no `\frac`/`\sqrt`.
Read CONFIG-REFERENCE.md § table.yaml before writing one.
