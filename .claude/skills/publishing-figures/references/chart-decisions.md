# Figure design decisions

Use this when the user hasn't specified a chart type, colors, or annotations, or when you need
to recommend one. Full field reference: `ENGINE-CONFIG-SPEC.md` (repo root) — this file only
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
- **`bar` and `stacked` require `xAxisType: categorical`** (v1.12.0+). A continuous axis silently
  dropped rows or drew an empty frame, so the engine now refuses it outright.
- `waterfall` requires `categorical` and vertical.
- `columns.section` (grouped category axis) works only on **horizontal** bar charts.
- Horizontal `stacked` cannot combine with `small_multiples`.

## Inferring `xAxisType` from the x column

`YYYY-MM-DD` → `temporal` · **a bare `YYYY` annual series → `temporal`** (v1.14.0+) ·
`YYYYQ#` (e.g. `2025Q1`) → `quarterly` · other plain numbers (ages, percentiles, dollar amounts)
→ `numeric` · anything else → `categorical`. Monthly data: convert to first-of-month
`YYYY-MM-DD` and use `temporal`. Ask the user only when genuinely ambiguous (e.g. integer bins that
could be ordered categories).

**A year is not a plain number here.** From v1.14.0 a `numeric` axis groups thousands, so a year
column left on `numeric` labels its ticks `1,950  1,960  …`. Put an annual series on `temporal`
instead: `parseDate` reads a bare `YYYY` as local 1 January and the axis renders a year-cadence span
as a bare `%Y`, so **the data needs no change** — only `xAxisType`. Band and marker bounds written
as `"1953"` parse the same way. (The two `ai-fiscal` history charts were migrated for exactly this
reason when the engine was repinned to v1.14.0.)

**The chart type overrides this.** The rules above read the x *column*; the constraints above read the
chart *type*, and the type wins. A `bar` or `stacked` chart of values by year is `categorical` with the
years as category labels — **not** `numeric`, even though the column is plain numbers. Following the
column rule there is a load-time validation error, not a bad-looking chart.

## Titles

House style is a takeaway sentence, not a variable description — compare
"Capital and corporate revenue increases offset labor revenue losses in most scenarios" with
"Revenue by income type". Titles come from the user: when asking, mention the house style, but
do not draft titles for them unless they ask for help. Units belong in `subtitle` (e.g.
"Percent of GDP, fiscal years"), not in the data.

## Colors

**The default is to specify no colors at all.** Omit `series_colors` and the engine applies the
house categorical ramp in declaration order. That is what makes figures across different
publications look like they belong to the same organization, so it is the recommendation, not
merely the fallback — a spec that sets `series_colors` is opting out of a shared system and needs a
reason that names a semantic, not a preference.

**Do not ask the user what colors they want.** State the default as part of the design summary. Ask
only when a series has a semantic that the ramp cannot express (below).

### The palette is three separate things — do not treat it as one menu

The Style-Guide's `colors.json` gives each group a distinct job, and the grouping *is* the house
style:

| Group | Tokens | Use for |
|---|---|---|
| **Categorical ramp** (positions 1-7, applied in order) | `blue`, `amber`, `violet`, `green`, `red`, `rose`, `russet` | Series. **The only tokens eligible for `series_colors` / `category_colors`.** Each has a `-light` variant and a full tonal tier set (`blue-500`). Aliases: `purple`→violet, `pink`→rose, `yellow`→amber, `brown`→russet. |
| **Role colors** | `grey`, `black` | Chrome, not data. `grey` is annotations and reference lines; `black` is a baseline/total/threshold line. **Never a series color.** |
| **Brand** | `navy`, `sky` | Organizational identity — logo, chrome. **Not data, and never a series color.** `navy` is not in the categorical ramp and has no ramp position. |

The ramp order is meaningful: position 1 (`blue`) is the lead series, position 2 (`amber`) the
second, and so on. Naming colors ad hoc overrides that ordering, which is why the default is to
leave it alone.

Note that CONFIG-SPEC.md lists `black`, `grey`, `navy`, `sky` together under "Neutrals and brand."
That is a statement of what the engine *accepts*, not of what a figure *should* use. The engine
resolves all of them; only the ramp belongs in `series_colors`.

### When an override is legitimate

A closed list. If the request is not one of these, it is a preference — offer the default instead.

- **A semantic the ramp cannot express**: `red` for deficits, costs, or losses.
- **Continuity within a publication**: holding one series' color fixed across the figures of one
  article or tracker, where the ramp would otherwise assign it differently per figure.
- **Continuity with an earlier figure** the reader has already learned to read.
- **Pairing with an annotation or overlay** that refers to a specific series.

### If the user specifies colors anyway

**Ask them to confirm, explicitly, before writing it.** They are overriding the preferred default,
and most people asking for a color do not know a shared ramp exists. Say what the default would do,
say what their choice changes, and ask whether to proceed. For example:

> Omitting colors would give these three series blue, amber, and violet — the house ramp, matching
> every other Budget Lab figure. You've asked for green and navy. Navy is a brand color rather than
> a series color, so it isn't in the ramp at all. Do you want to override the default here?

Honor a clear yes and move on — do not ask twice, and do not re-litigate it later in the session.
Record nothing special in the spec; the confirmation is a conversation, not a comment.

Two further rules that hold regardless:

- **Never a raw `"#hex"`.** Every color in this archive is a palette token, so published figures
  stay on-brand; a hardcoded hex breaks that even when it looks right in one figure. The engine
  accepts hex — that is not a licence to use it here. Map a requested color to the nearest token.
  Write a hex only if the user insists after being told why, never reach for one yourself, and
  never leave a hex the engine assigned when a token is available.
- **Never a role or brand token in `series_colors`** (`grey`, `black`, `navy`, `sky`). If a user
  asks for one, say what it is for and offer the nearest ramp hue — `navy` → `blue`, and note that
  the two are close enough that the difference reads as inconsistency rather than intent.

## Annotations — offer these when the story needs them

All four kinds live under one `annotations:` block (see ENGINE-CONFIG-SPEC.md § Annotations):

| Kind | Use for | Shape |
|---|---|---|
| `bands` | recessions, policy windows, shaded periods | `{start, end, label?}` |
| `xAxis` | event lines ("TCJA enacted") | `{x, label?}` |
| `yAxis` | zero lines, targets, historical averages | `{y, label?, style?}` |
| `points` | calling out one observation | `{x, label, series? or y?, connector?}` |

**Coordinate types**: `x`, `start`, `end` are **strings** — quote them even on a numeric axis
(`x: "2017"`, not `x: 2017`), or validation fails with `must be string`. `y` is a **number**.
A zero line reads best as `{y: 0, style: solid}` with no label.

## Series options (one-liners; details in ENGINE-CONFIG-SPEC.md § Series)

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
Read ENGINE-CONFIG-SPEC.md § table.yaml before writing one.
