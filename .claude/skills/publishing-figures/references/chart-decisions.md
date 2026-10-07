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
| Dated events — milestones, enactment and effective dates, phase-ins | `timeline` (see [Timelines](#timelines)) |
| One part-to-whole composition, many categories of very different sizes (no time or second dimension) | `treemap` (see [Treemaps](#treemaps)) |

**Recognise a timeline from the data, not only from a request.** A file whose rows are *events*
rather than measurements — a date column plus a text column naming what happened, no numeric value
column, often an end date (or `ongoing`) and a category — is a timeline; recommend it. A measured
series with a few events to mark is still a `line` chart with `annotations.xAxis` lines: the events
annotate the data rather than being the data.

Hard constraints the engine enforces:

- `scatter` requires `xAxisType: numeric`; `dotplot` requires `xAxisType: categorical`.
- **`bar` and `stacked` require `xAxisType: categorical`** (v1.12.0+). A continuous axis silently
  dropped rows or drew an empty frame, so the engine now refuses it outright.
- `waterfall` requires `categorical` and vertical.
- `columns.section` (grouped category axis) works on **horizontal** `bar`, `stacked` (v1.16.0+) and
  `dumbbell` charts, never on a vertical chart. See [Sections](#sections-horizontal-charts).
- On a horizontal `bar`, `stacked` or `dumbbell` chart, `columns.facet` makes **no panes** (v1.16.0+):
  each facet value is drawn as a group of one chart, exactly as `columns.section` draws a section.
  For grouped rows on these charts write `columns.section`; setting both `columns.facet` and
  `columns.section` is a validation error.
- `timeline` requires `xAxisType: temporal`, and accepts only a short field list (ENGINE-CONFIG-SPEC.md
  § Timeline options, "Accepted fields") — no `annotations`, `overlays`, `valueLabels` and so on.
- `treemap` requires `xAxisType: categorical`, has no axes, and likewise accepts only a short field
  list (ENGINE-CONFIG-SPEC.md § Treemap options, "Accepted fields").

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

## Timelines

Data shape: [data-reshaping.md § Timeline data](data-reshaping.md#timeline-data). Fields:
ENGINE-CONFIG-SPEC.md § Timeline options. Decide these silently from the data and list them in the
design summary — the defaults are right for most timelines, so none is an interview question unless
the data leaves it genuinely open:

| Choice | Default | Change it when |
|---|---|---|
| `orientation` | `horizontal` — it switches to vertical by itself on a narrow screen | Many events or long descriptions: `vertical` reads as a list and downloads as a portrait PNG. |
| `timeline.spacing` | `proportional` (distance = elapsed time) | Only the order matters, or dates cluster so tightly that gaps would crowd: `even`. |
| `timeline.lanes` | off — one track, categories by colour | Categories are parallel tracks the reader compares (policy vs. cohort). Two lanes on a vertical render draw side by side; three or more share one track. This one is worth asking when there are 2–3 categories. |
| `projected_field` | none | Some events are planned or projected: a flag column draws them hollow (points) or dashed (spans). |
| `timeline.axis` | off — every event carries its own date | Proportional spacing where readers need to gauge gaps. Not allowed with `even`. |
| `timeline.date_format` | derived (`%Y`, `%b %Y` or `%b %-d, %Y` from the dates) | Rarely; for one-off labels (`FY2030`, `Spring 2027`) use a `date_label` column instead. |

Colours follow the same rules as every chart — omit `series_colors`. `tbl-chart validate` warns above
20 events (suggest splitting, or `vertical`) and when a horizontal layout overflows `max_rows` at the
export width; both are warnings, not errors, but raise them with the user.

## Treemaps

A treemap shows **one** composition as nested tiles whose area is proportional to value. Recommend it
when there are many parts of very different sizes (budget categories, revenue sources) and a stacked
bar would be crowded. It is the wrong choice when the reader must compare exact values (a sorted
horizontal `bar` reads more precisely), when the composition changes over time (`area` or
`stacked`), or when there are only two or three parts.

Data shape: [data-reshaping.md § Treemap data](data-reshaping.md#treemap-data). Fields:
ENGINE-CONFIG-SPEC.md § Treemap options. Key choices, decided from the data and listed in the design
summary:

| Choice | Default | Change it when |
|---|---|---|
| Groups (`columns.series`) | none — every tile blue | The parts fall into a few named families (Mandatory / Discretionary). One level only; two or more groups draw a legend. |
| `treemap.label_value` | `share` (percent of the total) | Readers need the amounts: `value`, formatted by `value_format`. `none` shows names only. |
| `value_format` | thousands grouped, 0 decimals | Units: `{prefix: "$", suffix: " billion"}`. `value_prefix` / `value_suffix` are errors on a treemap. |
| `treemap.shading` | `size` — tiles shaded by size rank within their group | `none` when every tile in a group should be one flat colour. |
| `treemap.tooltip` / `treemap.tooltip_note` | none | Extra hover rows from other CSV columns, or a free-text note per tile. |

Colours follow the same rules as every chart: omit `series_colors` and groups take the ramp in turn.
The tile shades are computed from the group colour by the engine and are not palette tokens; that is
expected and not a palette violation. `series_order` on a treemap does **not** filter, and does not
set layout order (groups are placed largest total first) — it sets which group gets which hue, and
breaks ties between groups with equal totals. `tbl-chart validate` warns on more than 30 tiles, on
more than seven groups without `series_colors`, on zero-value rows, and when more than half the tiles
would be unlabelled in the PNG; raise these with the user.

## Sections (horizontal charts)

`columns.section` groups a horizontal `bar`, `stacked` or `dumbbell` chart's categories under bold
headers (`section_order`, `section_labels`). From v1.16.0:

- **Horizontal stacked bars take sections**, not only bars and dumbbells. Each category is still one
  stack, with its own net marker and segment labels.
- **A category label may repeat across sections.** A row is identified by section + category, so
  "Top 1%" under both "Ranked by income" and "Ranked by wealth" draws two rows. `x_order` and
  `x_labels` entries apply to the label in every section that has it, as does a `category_colors`
  entry on a single-series `bar` (the only sectioned chart that honours `category_colors`; stacks
  and dumbbells colour by series). Each
  section + category + series may carry only one value.
- **`tooltip_section: true`** puts the section in the hover card's header (`Corporate · Before
  response`). Use it when labels repeat across sections, so the card says which row it is. It acts
  where the chart hovers with a card (a dumbbell, or a stack with `barStack.hover: tooltip` or a net
  dot); a plain horizontal `bar` hovers with value pills and ignores it. A validation error on a
  chart without sections.
- A facet column on these charts draws the same groups (ordered and titled by
  `small_multiples.pane_order` / `pane_titles`, not `section_order` / `section_labels`). Prefer
  `columns.section` in new specs.

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

**Horizontal charts swap the axes.** On a horizontal `bar`, `stacked` or `dumbbell` chart the value
axis runs along x, so a value-axis reference line is an `annotations.xAxis` entry with a numeric `x`
(still quoted: `x: "0"`). `annotations.yAxis` (and legacy `yAxisPolicy.markers`) is a validation
error there.

Dates in `x`, `start`, `end` follow the same strict grammar as the data (ENGINE-CONFIG-SPEC.md §
Dates): a real calendar day `YYYY-MM-DD` or a bare `YYYY` on a temporal axis, `YYYYQ1`–`YYYYQ4` on a
quarterly one.

## Series options (one-liners; details in ENGINE-CONFIG-SPEC.md § Series)

- `series_order` — sets order **and filters**: a series omitted from the list is dropped from
  the chart. List all of them or none, each once: a repeated entry (here or in `shape_order`) is
  a validation error. On a treemap it does not filter and only breaks ties in the layout (see [Treemaps](#treemaps)).
- `series_labels` — display names; keep raw CSV keys and rename here rather than editing data.
- `series_styles: {key: {dashed: true}}` — projections/counterfactuals; for actual forecast
  rows prefer `projected_field` (a data column flagging projected observations).
- `confidence_bands: [{series, lower, upper}]` — lower/upper are CSV column names.
- `small_multiples` — requires `columns.facet`; then `columns`, `pane_order`, `pane_titles`. A
  horizontal `bar`, `stacked` or `dumbbell` makes no panes and draws facets as groups instead (see
  [Sections](#sections-horizontal-charts)).

## Tables (`table.yaml`)

Data is tidy, **one CSV row per cell**. Required: `title`, `data`, `stub` (row nesting),
`header` (column nesting), `value`. Number formats via `format:` rules (`number`/`percent`/
`currency`, `decimals`). Math in any table text uses MathJax `\(...\)` — put it in a
**single-quoted** YAML string (`'\(\Delta\)'`); linear subset only, no `\frac`/`\sqrt`.
Read ENGINE-CONFIG-SPEC.md § table.yaml before writing one.
