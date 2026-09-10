/**
 * palette-lint.test.mjs — tests for the house-palette gate.
 *
 * The organising principle: this lint runs in CI over every published figure, so a FALSE POSITIVE
 * breaks main for work that is already correct. The first test is therefore not a unit test but a
 * corpus test over the real archive, and the acceptance table is deliberately larger than the
 * rejection table.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { listCharts } from "./lib.mjs";
import {
  buildPalette,
  classifyColor,
  lintPaletteUse,
  PALETTE_EXCEPTIONS,
  SERIES_COLOR_FIELDS,
} from "./palette-lint.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const palette = buildPalette(REPO_ROOT);
const lint = (spec, rel = "charts/x/y/chart.yaml", exceptions = []) =>
  lintPaletteUse(spec, rel, palette, exceptions);

// ---------------------------------------------------------------------------
// 1. THE CORPUS TEST — the one that matters. Nothing in the real archive may error.
// ---------------------------------------------------------------------------

test("the entire real archive produces zero palette ERRORS", async () => {
  const charts = await listCharts();
  assert.ok(charts.length > 0, "expected to find charts");
  const errors = [];
  let specsLinted = 0;
  for (const { specPath } of charts) {
    const rel = relative(REPO_ROOT, specPath).split(sep).join("/");
    const spec = parseYaml(readFileSync(specPath, "utf-8"));
    specsLinted++;
    errors.push(...lintPaletteUse(spec, rel, palette).errors);
  }
  assert.equal(
    errors.length,
    0,
    `the lint must not fail any existing figure. Got:\n${errors.join("\n")}`,
  );
  // Non-vacuity: prove we actually walked the archive rather than an empty list.
  assert.ok(specsLinted >= 40, `expected to lint the whole archive, saw ${specsLinted}`);
});

test("the walk is filesystem-based, so it covers untracked figures too", async () => {
  // listCharts uses readdir, not git, so a LOCAL run lints work-in-progress figures under
  // charts/trackers/ that are untracked. CI checks out tracked files only and therefore covers
  // strictly less — intended, but it means this assertion must be conditional: asserting the
  // trackers are present unconditionally would fail in CI, where they legitimately are not.
  const trackersDir = join(REPO_ROOT, "charts", "trackers");
  if (!existsSync(trackersDir)) return; // fresh clone / CI checkout: nothing untracked to see

  const onDisk = readdirSync(trackersDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
  if (onDisk.length === 0) return;

  const ids = (await listCharts()).map((c) => c.id);
  for (const slug of onDisk) {
    assert.ok(
      ids.some((id) => id.startsWith(`${slug}/`)),
      `charts/trackers/${slug} exists on disk but the walk missed it`,
    );
  }
});

// ---------------------------------------------------------------------------
// 2. ACCEPTANCE — every legitimate spelling must pass silently
// ---------------------------------------------------------------------------

const ACCEPTED = [
  // the seven ramp hues, in position order
  "blue", "amber", "violet", "green", "red", "rose", "russet",
  // the four documented aliases
  "purple", "pink", "yellow", "brown",
  // -light variants: first-class Style-Guide vocabulary, and what the engine itself assigns
  // to series 8-14
  "blue-light", "amber-light", "violet-light", "green-light", "red-light", "rose-light",
  "russet-light", "purple-light", "pink-light",
  // tonal tiers — "two steps apart on one ramp is the Style-Guide way to relate two series"
  "blue-50", "blue-200", "blue-500", "blue-700", "green-200", "russet-300",
  // aliases carry the full tier set too (purple-600 === violet-600)
  "purple-600", "yellow-100", "brown-400",
];

for (const value of ACCEPTED) {
  test(`accepts "${value}" as a series color`, () => {
    const { errors, warnings } = lint({ series_colors: { A: value } });
    assert.deepEqual(errors, [], `"${value}" must not error`);
    assert.deepEqual(warnings, [], `"${value}" must not warn`);
  });
}

test("accepts an absent series_colors, and a spec with no colors at all", () => {
  assert.deepEqual(lint({ chartType: "line" }).errors, []);
  assert.deepEqual(lint({ chartType: "line" }).warnings, []);
  assert.deepEqual(lint({}).errors, []);
});

test("accepts the documented empty-key single-series idiom", () => {
  // A chart with no `columns.series` has one implicit series keyed "". The value is still governed;
  // the empty KEY must not crash or be mistaken for a missing field.
  const { errors, warnings } = lint({ series_colors: { "": "blue" } });
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
  const bad = lint({ series_colors: { "": "navy" } });
  assert.equal(bad.errors.length, 1);
  assert.match(bad.errors[0], /series_colors\[""\]/);
});

test("ignores non-string and empty values — ajv and colorRefError own those", () => {
  for (const v of [null, undefined, 42, true, {}, [], "", "   "]) {
    const { errors, warnings } = lint({ series_colors: { A: v } });
    assert.deepEqual(errors, [], `value ${JSON.stringify(v)} must not error here`);
    assert.deepEqual(warnings, [], `value ${JSON.stringify(v)} must not warn here`);
  }
});

test("category_colors may legitimately repeat one hue across many categories", () => {
  // eta-effect colours six categories all `amber` — repetition is the point of category
  // highlighting, so there is no uniqueness rule.
  const spec = {
    category_colors: { Apparel: "amber", Leather: "amber", Rubber: "amber", Food: "amber" },
  };
  assert.deepEqual(lint(spec).errors, []);
  assert.deepEqual(lint(spec).warnings, []);
});

test("two series sharing one hue is allowed", () => {
  // gdp-growth-history gives both series `blue`, distinguished by series_styles dashing.
  const spec = { series_order: ["Actual", "CBO Projection"], series_colors: { Actual: "blue", "CBO Projection": "blue" } };
  assert.deepEqual(lint(spec).errors, []);
});

test("does not touch annotation, shading, overlay or marker colors", () => {
  // These legitimately carry grey/black and #BBBBBB (annotation_dim, which has no palette name at
  // all). Policing them would fail published figures.
  const spec = {
    annotations: {
      xAxis: [{ x: "0", color: "grey" }, { x: "1", color: "#BBBBBB" }],
      yAxis: [{ y: 0, color: "#B8302C" }],
      bands: [{ start: "a", end: "b", color: "grey" }],
      points: [{ x: "0", label: "p", color: "#6D6D6D" }],
    },
    shading: [{ color: "grey" }, { color: "amber" }],
    overlays: [{ color: "blue" }, { color: "grey" }],
    rug: { tracks: [{ color: "black" }] },
    yAxisPolicy: { markers: [{ y: 1, color: "gray" }] },
    connector: { color: "navy" },
    waterfall: { colors: { total: "navy" }, connectorColor: "grey" },
    barStack: { mono: { base: "blue" } },
  };
  assert.deepEqual(lint(spec).errors, []);
  assert.deepEqual(lint(spec).warnings, []);
});

test("does not mistake color_legend_title for a color field", () => {
  // Its value is a legend heading ("AI speed"). A /colou?r/ key regex would fail two real figures.
  const spec = { color_legend_title: "AI speed" };
  assert.deepEqual(lint(spec).errors, []);
  assert.deepEqual(lint(spec).warnings, []);
});

// ---------------------------------------------------------------------------
// 3. REJECTION — the values the gate exists to stop
// ---------------------------------------------------------------------------

test("rejects navy on a series, naming what navy is for", () => {
  const { errors } = lint({ series_colors: { Recent: "navy" } });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /navy/);
  assert.match(errors[0], /brand color/);
  assert.match(errors[0], /not a series color/);
});

for (const [value, phrase] of [
  ["sky", /brand accent/],
  ["grey", /muted neutral/],
  ["gray", /muted neutral/],
  ["black", /baseline\/total\/threshold/],
]) {
  test(`rejects "${value}" on a series`, () => {
    const { errors } = lint({ series_colors: { A: value } });
    assert.equal(errors.length, 1, `"${value}" must produce exactly one error`);
    assert.match(errors[0], phrase);
  });
}

test("rejects an off-palette hex", () => {
  const { errors } = lint({ series_colors: { A: "#123456" } });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /not a house palette color/);
});

test("rejects navy written as its hex", () => {
  const { errors } = lint({ series_colors: { A: "#101F5B" } });
  assert.equal(errors.length, 1, "navy-as-hex must not sneak past the name check");
});

for (const value of ["steelblue", "rgb(0, 114, 178)", "transparent", "currentColor", "var(--x)"]) {
  test(`rejects the CSS form "${value}"`, () => {
    const { errors } = lint({ series_colors: { A: value } });
    assert.equal(errors.length, 1, `"${value}" must error`);
  });
}

test("rejects an invalid tier that the engine would also reject", () => {
  // blue-800 and blue-450 do not exist; color-ref.ts names them as the typos it catches.
  for (const v of ["blue-800", "blue-450", "sky-300"]) {
    assert.equal(lint({ series_colors: { A: v } }).errors.length, 1, `${v} must error`);
  }
});

test("rejects an off-ramp bar_color and category_colors value", () => {
  assert.equal(lint({ bar_color: "navy" }).errors.length, 1);
  assert.match(lint({ bar_color: "navy" }).errors[0], /^charts\/x\/y\/chart\.yaml: bar_color is/);
  assert.equal(lint({ category_colors: { "2020": "black" } }).errors.length, 1);
});

test("reports every offending value, not just the first", () => {
  const { errors } = lint({ series_colors: { A: "navy", B: "sky", C: "blue", D: "#123456" } });
  assert.equal(errors.length, 3);
});

// ---------------------------------------------------------------------------
// 4. ON-PALETTE HEX → warning, never an error
// ---------------------------------------------------------------------------

test("an on-palette hex warns and suggests the token, and does NOT error", () => {
  const { errors, warnings } = lint({ series_colors: { A: "#0072B2" } });
  assert.deepEqual(errors, [], "an on-palette hex must never fail the build");
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /raw hex/);
  assert.match(warnings[0], /`blue`/);
});

test("a tonal-tier hex warns with its tier token", () => {
  const { errors, warnings } = lint({ series_colors: { A: "#FF8C7B" } }); // red-100
  assert.deepEqual(errors, []);
  assert.match(warnings[0], /red-100/);
});

test("hex case and 3-digit shorthand do not change the verdict", () => {
  assert.deepEqual(lint({ series_colors: { A: "#0072b2" } }).errors, []);
  assert.equal(lint({ series_colors: { A: "#0072b2" } }).warnings.length, 1);
  // #007 expands to #000077, which is off-palette — must error, not crash.
  assert.equal(lint({ series_colors: { A: "#007" } }).errors.length, 1);
});

// ---------------------------------------------------------------------------
// 5. REDUNDANT-RESTATEMENT WARNING — scoped hard, must stay silent when unsure
// ---------------------------------------------------------------------------

test("warns when series_colors exactly restates the default ramp order", () => {
  const spec = {
    series_order: ["A", "B", "C"],
    series_colors: { A: "blue", B: "amber", C: "violet" },
  };
  const { errors, warnings } = lint(spec);
  assert.deepEqual(errors, []);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /restates the default ramp order/);
});

test("does NOT warn on a partial prefix match", () => {
  // etr-vintages sets positions 1-2 to the default and 3 deliberately off it. That is a choice.
  const spec = {
    series_order: ["A", "B", "C"],
    series_colors: { A: "blue", B: "amber", C: "rose" },
  };
  assert.deepEqual(lint(spec).warnings, []);
});

test("stays silent without series_order — slot order would come from the CSV", () => {
  assert.deepEqual(lint({ series_colors: { A: "blue", B: "amber" } }).warnings, []);
});

test("stays silent on small multiples, mono stacks, and >7 series", () => {
  const base = { series_order: ["A", "B"], series_colors: { A: "blue", B: "amber" } };
  assert.deepEqual(lint({ ...base, small_multiples: { column: "x" } }).warnings, []);
  assert.deepEqual(lint({ ...base, barStack: { mono: { base: "blue" } } }).warnings, []);

  const eight = ["A", "B", "C", "D", "E", "F", "G", "H"];
  const ramp = ["blue", "amber", "violet", "green", "red", "rose", "russet", "blue-light"];
  const spec = {
    series_order: eight,
    series_colors: Object.fromEntries(eight.map((s, i) => [s, ramp[i]])),
  };
  assert.deepEqual(lint(spec).warnings, [], "beyond position 7 the engine moves to -light tiers");
});

test("stays silent when a series_order entry has no color, or counts differ", () => {
  assert.deepEqual(
    lint({ series_order: ["A", "B"], series_colors: { A: "blue" } }).warnings,
    [],
  );
  assert.deepEqual(
    lint({ series_order: ["A"], series_colors: { A: "blue", B: "amber" } }).warnings,
    [],
  );
});

// ---------------------------------------------------------------------------
// 6. THE EXCEPTION MECHANISM
// ---------------------------------------------------------------------------

test("an allowlisted value passes; the same value unlisted fails", () => {
  const spec = { series_colors: { Recent: "navy" } };
  const rel = "charts/trackers/t/f/chart.yaml";
  assert.equal(lintPaletteUse(spec, rel, palette, []).errors.length, 1);

  const allowed = [
    { spec: rel, field: "series_colors", key: "Recent", value: "navy", reason: "test" },
  ];
  assert.deepEqual(lintPaletteUse(spec, rel, palette, allowed).errors, []);
});

test("an exception is scoped to its exact spec, field, key and value", () => {
  const rel = "charts/trackers/t/f/chart.yaml";
  const allowed = [
    { spec: rel, field: "series_colors", key: "Recent", value: "navy", reason: "test" },
  ];
  // different key
  assert.equal(
    lintPaletteUse({ series_colors: { Other: "navy" } }, rel, palette, allowed).errors.length,
    1,
  );
  // different spec
  assert.equal(
    lintPaletteUse({ series_colors: { Recent: "navy" } }, "charts/a/b/chart.yaml", palette, allowed).errors.length,
    1,
  );
  // different value
  assert.equal(
    lintPaletteUse({ series_colors: { Recent: "sky" } }, rel, palette, allowed).errors.length,
    1,
  );
});

test("the shipped exception list is empty — the archive is fully on-ramp", () => {
  assert.deepEqual(PALETTE_EXCEPTIONS, []);
});

// ---------------------------------------------------------------------------
// 7. REGRESSION — the real case that motivated this
// ---------------------------------------------------------------------------

test("flags the deficit tracker's original green/navy series_colors", () => {
  // The config as it arrived from the modeller's staging directory. `green` is on-ramp; `navy` is
  // not, and nothing in the engine or the skill's prose stopped it reaching a figure.
  const spec = {
    series_order: ["pre_2004", "post_2004", "recent"],
    series_colors: { pre_2004: "green", post_2004: "navy", recent: "violet" },
  };
  const { errors } = lint(spec, "charts/trackers/deficit-management-scorecard/scorecard-scatter/chart.yaml");
  assert.equal(errors.length, 1, "exactly the navy value should fail");
  assert.match(errors[0], /post_2004/);
  assert.match(errors[0], /navy/);
});

// ---------------------------------------------------------------------------
// 7b. FINDINGS FROM CODE REVIEW — each of these was a real hole
// ---------------------------------------------------------------------------

test("the validate-all call shape works: 3 args, default exceptions, hex path included", () => {
  // The unit tests all went through a helper that passed an explicit exceptions array, so none of
  // them exercised the shape validate-all.mjs actually uses. A signature drift there threw inside
  // the hex branch, and the outer catch turned it into a build failure instead of a warning.
  const { errors, warnings } = lintPaletteUse(
    { series_colors: { A: "#0072B2" } },
    "charts/a/b/chart.yaml",
    palette,
  );
  assert.deepEqual(errors, []);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /`blue`/);
});

test("a padded token name is NOT treated as on-ramp", () => {
  // The engine's palette lookup is exact and untrimmed, but isCssColor trims — so " blue " misses
  // the house table and paints CSS blue #0000FF. Trimming before the name check would call that
  // on-ramp and hide a genuinely off-palette render.
  for (const v of [" blue ", "blue ", " blue", "	amber"]) {
    const { errors } = lint({ series_colors: { A: v } });
    assert.equal(errors.length, 1, `${JSON.stringify(v)} must not pass as a ramp name`);
  }
  assert.deepEqual(lint({ series_colors: { A: "blue" } }).errors, []);
});

test("a fully opaque alpha compares equal to its token; a translucent one does not", () => {
  const opaque8 = lint({ series_colors: { A: "#0072B2FF" } });
  assert.deepEqual(opaque8.errors, [], "#RRGGBBFF is the token with opaque alpha");
  assert.equal(opaque8.warnings.length, 1);

  const opaque4 = lint({ series_colors: { A: "#07bf" } }); // #0077bbff -> not a token, still off-ramp
  assert.equal(opaque4.errors.length, 1);

  const translucent = lint({ series_colors: { A: "#0072B280" } });
  assert.equal(translucent.errors.length, 1, "a translucent blue is not the blue token");
});

test("a mono stack makes series_colors inert, so an off-ramp value warns instead of failing", () => {
  // stacked.ts builds every segment fill from the mono hue's tonal scale and the mono tier wins
  // downstream, so series_colors paints nothing. Dead config is worth saying; it must not block a
  // merge.
  const spec = { barStack: { mono: { base: "blue" } }, series_colors: { A: "navy" } };
  const { errors, warnings } = lint(spec);
  assert.deepEqual(errors, [], "an inert field must not fail the merge gate");
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /colours nothing/);
  // Without the mono stack the same value is a hard error.
  assert.equal(lint({ series_colors: { A: "navy" } }).errors.length, 1);
});

test("a title-selector silences the redundant-ramp warning", () => {
  // The active option's colour is passed as the single-series accent and replaces the series map,
  // so "the engine assigns exactly this" would be untrue.
  const spec = {
    series_order: ["A"],
    series_colors: { A: "blue" },
    title_selectors: { speed: { options: [{ id: "x", color: "amber" }] } },
  };
  assert.deepEqual(lint(spec).warnings, []);
  // ...but it still warns without one.
  assert.equal(lint({ series_order: ["A"], series_colors: { A: "blue" } }).warnings.length, 1);
});

// ---------------------------------------------------------------------------
// 8. THE PALETTE MODEL ITSELF
// ---------------------------------------------------------------------------

test("the ramp is derived from the pinned engine, in position order", () => {
  assert.deepEqual(palette.hueNames, ["blue", "amber", "violet", "green", "red", "rose", "russet"]);
  // 7 hues x (bare + light + 8 tiers) + 4 aliases x the same = 110 names; 7 bases + 56 tiers = 63 hexes.
  assert.equal(palette.rampNames.size, 110);
  assert.equal(palette.rampHexes.size, 63);
});

test("brand and role tokens are known, so errors can say what they are for", () => {
  for (const n of ["navy", "sky", "grey", "gray", "black"]) {
    assert.ok(palette.offRampNames.has(n), `${n} must be classified`);
    assert.ok(palette.offRampNames.get(n).what, `${n} must carry a role description`);
  }
});

test("classifyColor separates the five outcomes", () => {
  assert.equal(classifyColor("blue", palette).kind, "ramp-name");
  assert.equal(classifyColor("#0072B2", palette).kind, "ramp-hex");
  assert.equal(classifyColor("navy", palette).kind, "off-ramp-name");
  assert.equal(classifyColor("#123456", palette).kind, "off-ramp-hex");
  assert.equal(classifyColor("steelblue", palette).kind, "unresolvable");
  assert.equal(classifyColor(7, palette).kind, "skip");
});

test("the governed field list is exactly the three data-series fields", () => {
  assert.deepEqual(SERIES_COLOR_FIELDS, ["series_colors", "category_colors", "bar_color"]);
});
