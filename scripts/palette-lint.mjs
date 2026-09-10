/**
 * palette-lint.mjs — house-style gate on colors used for DATA SERIES.
 *
 * WHAT THIS ADDS OVER THE ENGINE. The engine's `colorRefError` checks that a color *resolves*: it
 * accepts every palette name, every tonal tier, raw hex, `rgb()`, and 147 CSS keywords, because its
 * job is to stop a mark rendering blank. It says nothing about house style. So `navy` — a BRAND
 * token, not a series color — validates cleanly today, and did in fact reach a new figure. This
 * module is the missing half: is the color one the house palette offers *for a series*.
 *
 * WHY IT READS THE PALETTE INSTEAD OF LISTING IT. The ramp is derived at run time from the pinned
 * engine's own `style-guide/palette/colors.json` — the file `src/theme/tokens.ts` is generated from,
 * so it is canonical rather than a copy. A hardcoded list here would be a second source of truth
 * that silently goes stale the next time the palette gains a hue, which is the exact failure this
 * repo already had with CONFIG-REFERENCE.md (45 fields behind over eight repins).
 *
 * SCOPE IS DELIBERATELY NARROW: `series_colors`, `category_colors`, `bar_color`. Nothing else.
 *   - Annotation and chrome fields (`annotations.*`, `shading`, `rug.tracks`, `overlays`,
 *     `connector`) legitimately carry `grey`, `black`, and `#BBBBBB` — the structural
 *     "annotation_dim" neutral, which has NO palette name at all, so a hex is the only way to spell
 *     it. Policing those fields would manufacture false positives on published figures.
 *   - `waterfall.colors.*` is data, but the engine's own default for `total` is `navy`
 *     (waterfall.ts DEFAULT_TOTAL). Failing a spec for writing down the engine's default would be
 *     absurd, and no archive spec sets it, so it stays out until house style rules on waterfalls.
 *   - `barStack.mono.base` needs no help: `monoBaseError` already restricts it to the 7 hue
 *     families plus the 4 aliases, which IS ramp membership.
 *   - Fields are matched by an explicit allow-list, never by a `/colou?r/` key regex —
 *     `color_legend_title` holds a legend heading ("AI speed") and a regex would fail two
 *     published figures on it.
 *
 * TWO EXCLUSIONS THAT WERE ARGUED FOR AND DECLINED, so they are not re-litigated:
 *   - `title_selectors.*.options[].color` DOES re-colour a data mark: on a single-series chart the
 *     active option is passed as the accent and overrides the line. It is still excluded, because
 *     the ramp-order concept is meaningless for a selector and a neutral trigger label is a
 *     defensible design; no archive spec uses the field. If one ever does, this is the first place
 *     to revisit. (The redundant-ramp warning below does stay silent when a selector is present,
 *     since the accent means the engine would NOT assign the ramp colours.)
 *   - Narrowing `bar_color`/`category_colors` to the chart types that actually paint them was
 *     argued for on the grounds that a grouped bar ignores both. Declined: the applicability rule
 *     is documented WRONG — ENGINE-CONFIG-SPEC calls `category_colors` single-series-bar-only, yet
 *     `waterfall.ts` honours it and a published waterfall relies on it, and `validate.ts` has no
 *     chart-type gate at all. Inferring "inert" from the doc would itself be a false-positive
 *     source, and an off-palette value in a governed field is worth surfacing even when it happens
 *     to paint nothing. PALETTE_EXCEPTIONS covers a genuine case.
 */

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

/** The three fields that color a data mark and that house style governs. */
export const SERIES_COLOR_FIELDS = ["series_colors", "category_colors", "bar_color"];

/**
 * Documented exceptions. An off-ramp series color fails until it is listed HERE with a reason, so
 * every exception is a reviewed decision that shows up in a diff rather than a silent override.
 * Empty today: the archive is fully on-ramp.
 *
 * Shape: { spec, field, key, value, reason }
 *   spec  — repo-relative posix path of the spec file
 *   field — one of SERIES_COLOR_FIELDS
 *   key   — the series/category name, or null for the scalar `bar_color`
 *   value — the exact value being allowed
 */
export const PALETTE_EXCEPTIONS = [];

/**
 * Problems with the exception LIST itself, checked once per run rather than per spec.
 * A malformed entry does not silently fail to apply — it is reported, because a contributor who
 * added it believes a colour is allowed.
 */
export function exceptionListErrors(exceptions = PALETTE_EXCEPTIONS) {
  const out = [];
  for (const [i, e] of exceptions.entries()) {
    if (!exceptionIsWellFormed(e)) {
      out.push(
        `PALETTE_EXCEPTIONS[${i}] is not a usable exception: it needs \`spec\`, \`field\` (one of ` +
          `${SERIES_COLOR_FIELDS.join("/")}), \`value\`, and a \`reason\` of at least 10 characters. ` +
          `An exception with no stated reason is the thing this mechanism exists to prevent.`,
      );
    }
  }
  return out;
}

/** Locate the pinned engine's canonical palette file. */
function paletteJsonPath(repoRoot) {
  const require = createRequire(import.meta.url);
  try {
    return require.resolve("budget-lab-chart-engine/style-guide/palette/colors.json", {
      paths: [repoRoot],
    });
  } catch {
    // `exports` maps can hide subpaths; fall back to the physical location.
    return `${repoRoot}/node_modules/budget-lab-chart-engine/style-guide/palette/colors.json`;
  }
}

/**
 * Build the palette model from colors.json.
 *
 * `-light` is NOT a fixed tier — blue-light is tier 200, amber-light is 50, russet-light is 300 —
 * so it cannot be computed from the tier index. It does not need to be: every hue's light value was
 * verified to be one of that hue's own tiers, so `bases ∪ all tiers` already contains every
 * on-ramp hex, and the `<hue>-light` NAME is accepted by name without needing its hex.
 */
export function buildPalette(repoRoot) {
  const json = JSON.parse(readFileSync(paletteJsonPath(repoRoot), "utf-8"));

  // `categorical` keys are `cat<N>_<hue>`; `position` is the ramp slot.
  const hues = Object.entries(json.categorical)
    .filter(([k, v]) => !k.startsWith("_") && v && typeof v === "object" && v.position)
    .map(([k, v]) => ({ hue: k.replace(/^cat\d+_/, ""), hex: v.hex.toLowerCase(), position: v.position }))
    .sort((a, b) => a.position - b.position);

  const aliases = Object.fromEntries(
    Object.entries(json._naming_aliases ?? {}).filter(([k]) => !k.startsWith("_")),
  );

  const rampNames = new Set();
  const rampHexes = new Set();
  const hueNames = hues.map((h) => h.hue);

  for (const { hue, hex } of hues) {
    rampHexes.add(hex);
    const tiers = json.scales?.[hue] ?? {};
    for (const [tier, tierHex] of Object.entries(tiers)) {
      if (tier.startsWith("_")) continue;
      rampHexes.add(String(tierHex).toLowerCase());
    }
    // Every spelling of this hue: bare, -light, and each tier — for the hue and each of its aliases.
    const spellings = [hue, ...Object.entries(aliases).filter(([, v]) => v === hue).map(([k]) => k)];
    for (const s of spellings) {
      rampNames.add(s);
      rampNames.add(`${s}-light`);
      for (const tier of Object.keys(tiers)) {
        if (!tier.startsWith("_")) rampNames.add(`${s}-${tier}`);
      }
    }
  }

  // Named tokens that RESOLVE but are not series colors. Kept explicit so the error can say what
  // each one is actually for, rather than "not in the ramp".
  const offRampNames = new Map([
    ["navy", { hex: json.brand?.navy?.hex?.toLowerCase(), what: "a brand color (headings, UI accents)" }],
    ["sky", { hex: json.brand?.sky?.hex?.toLowerCase(), what: "a brand accent used in the logo" }],
    ["grey", { hex: json.structural?.text_muted?.hex?.toLowerCase?.() ?? json.structural?.text_muted, what: "the muted neutral, for annotations and chrome" }],
    ["gray", { hex: json.structural?.text_muted?.hex?.toLowerCase?.() ?? json.structural?.text_muted, what: "the muted neutral, for annotations and chrome" }],
    ["black", { hex: json.structural?.mark_black?.hex?.toLowerCase?.() ?? json.structural?.mark_black, what: "the baseline/total/threshold mark color" }],
  ]);

  // hex -> every ramp spelling that resolves to it, so a hex warning can name the token without
  // re-reading the palette file on each hit.
  const hexToNames = new Map();
  const addName = (hex, name) => {
    const k = String(hex).toLowerCase();
    if (!hexToNames.has(k)) hexToNames.set(k, []);
    hexToNames.get(k).push(name);
  };
  for (const { hue, hex } of hues) {
    addName(hex, hue);
    for (const [tier, tierHex] of Object.entries(json.scales?.[hue] ?? {})) {
      if (!tier.startsWith("_")) addName(tierHex, `${hue}-${tier}`);
    }
  }

  return { rampNames, rampHexes, offRampNames, hueNames, rampOrder: hueNames, hexToNames };
}

const HEX_RE = /^#[0-9a-f]{3,8}$/i;

/**
 * Reduce a hex to the #rrggbb form the palette is written in, so shorthand and a fully opaque alpha
 * compare equal to their token. A TRANSLUCENT alpha is left alone: `#0072b280` is genuinely not the
 * blue token, and collapsing it would call it on-ramp.
 */
function normalizeHex(v) {
  const s = v.toLowerCase();
  const expand3 = (h) => `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}`;
  if (/^#[0-9a-f]{3}$/.test(s)) return expand3(s);
  if (/^#[0-9a-f]{4}$/.test(s)) return s[4] === "f" ? expand3(s) : s;
  if (/^#[0-9a-f]{8}$/.test(s)) return s.slice(7, 9) === "ff" ? s.slice(0, 7) : s;
  return s;
}

/**
 * Classify one color value.
 *
 * `non-string` and `empty` are deliberately NOT our business: ajv rejects the former and
 * `colorRefError` already rejects the latter with a better message. Reporting them here would
 * double up on an error the author is already being shown.
 */
export function classifyColor(value, palette) {
  if (typeof value !== "string") return { kind: "skip" };
  if (value.trim() === "") return { kind: "skip" };

  // Name lookup is EXACT and untrimmed, mirroring the engine's `value in TBL_COLORS`. This matters:
  // " blue " misses that table, and `isCssColor` (which DOES trim) then accepts it as the CSS
  // keyword, so the series paints CSS blue #0000FF rather than the house blue #0072B2. Trimming
  // here would classify it on-ramp and hide a genuinely off-palette render.
  if (palette.rampNames.has(value)) return { kind: "ramp-name" };

  const off = palette.offRampNames.get(value);
  if (off) return { kind: "off-ramp-name", what: off.what };

  // Hex comparison is safe to normalise — the engine trims before its own hex test.
  const raw = value.trim();
  if (HEX_RE.test(raw)) {
    const hex = normalizeHex(raw);
    if (palette.rampHexes.has(hex)) return { kind: "ramp-hex", hex };
    return { kind: "off-ramp-hex", hex };
  }

  // A CSS keyword or function: resolves for the engine, but it is off-palette by construction.
  return { kind: "unresolvable" };
}

/** Every (field, key, value) triple a spec sets among the governed fields. */
function seriesColorEntries(spec) {
  const out = [];
  for (const field of SERIES_COLOR_FIELDS) {
    const v = spec?.[field];
    if (v == null) continue;
    if (field === "bar_color") {
      out.push({ field, key: null, value: v });
    } else if (typeof v === "object" && !Array.isArray(v)) {
      // NB the key may legitimately be the empty string: a chart with no `columns.series` has one
      // implicit series keyed "", and `series_colors: {"": color}` is a documented idiom.
      for (const [key, value] of Object.entries(v)) out.push({ field, key, value });
    }
  }
  return out;
}

/** An exception must be well-formed AND carry a real reason — the reason is the whole point of the
 *  mechanism, so an entry without one is not a documented exception and does not apply. */
export function exceptionIsWellFormed(e) {
  return (
    e != null &&
    typeof e.spec === "string" && e.spec !== "" &&
    SERIES_COLOR_FIELDS.includes(e.field) &&
    typeof e.value === "string" && e.value !== "" &&
    typeof e.reason === "string" && e.reason.trim().length >= 10
  );
}

function isExcepted(exceptions, specRel, field, key, value) {
  return exceptions.some(
    (e) =>
      exceptionIsWellFormed(e) &&
      e.spec === specRel &&
      e.field === field &&
      (e.key ?? null) === (key ?? null) &&
      e.value === value,
  );
}

/**
 * Lint one spec.
 *
 * @returns {{errors: string[], warnings: string[]}}
 */
export function lintPaletteUse(spec, specRel, palette, exceptions = PALETTE_EXCEPTIONS) {
  const errors = [];
  const warnings = [];
  if (!spec || typeof spec !== "object") return { errors, warnings };

  const at = (field, key) => (key === null ? field : `${field}[${JSON.stringify(key)}]`);

  // A mono stack builds every segment fill from one hue's tonal scale (`stacked.ts` monoScale) and
  // the mono tier wins over the series map downstream, so `series_colors` paints nothing at all
  // there. An off-ramp value is still worth saying out loud — it is dead config — but failing the
  // merge gate over a field that colours no mark would be a false positive.
  // Gated on chartType, not just the presence of the block: `barStack.mono.base` is read ONLY by
  // engine/marks/stacked.ts, and `monoBaseError` is not chart-type gated, so a line or bar spec can
  // carry a `barStack.mono` block that paints nothing while `series_colors` still renders normally.
  // Treating that as inert would let any chart bypass this gate by adding three lines of dead
  // config. Narrow is the safe direction: if a chart type ever does honour mono, it errors here
  // rather than being waved through.
  const inert = spec.barStack?.mono != null && spec.chartType === "stacked";
  const sink = inert ? warnings : errors;
  const inertNote = inert
    ? " (barStack.mono paints every segment from one hue's tonal scale, so this field colours" +
      " nothing — remove it rather than recolour it)"
    : "";

  for (const { field, key, value } of seriesColorEntries(spec)) {
    if (isExcepted(exceptions, specRel, field, key, value)) continue;
    const c = classifyColor(value, palette);

    if (c.kind === "off-ramp-name") {
      sink.push(
        `${specRel}: ${at(field, key)} is "${value}" — ${c.what}, not a series color. ` +
          `Series take the categorical ramp (${palette.hueNames.join(", ")}), each with a -light ` +
          `variant and tonal tiers. Omit the field to take the ramp in order, or pick a ramp hue.` +
          inertNote,
      );
    } else if (c.kind === "off-ramp-hex") {
      sink.push(
        `${specRel}: ${at(field, key)} is "${value}", which is not a house palette color. ` +
          `Use a ramp token (${palette.hueNames.join(", ")}, or a -light/tier variant), or omit the ` +
          `field to take the ramp in order.` + inertNote,
      );
    } else if (c.kind === "unresolvable") {
      sink.push(
        `${specRel}: ${at(field, key)} is "${value}" — a CSS color rather than a house palette ` +
          `token. Use a ramp token (${palette.hueNames.join(", ")}) or omit the field.` + inertNote,
      );
    } else if (c.kind === "ramp-hex") {
      const names = palette.hexToNames.get(c.hex) ?? [];
      warnings.push(
        `${specRel}: ${at(field, key)} is the raw hex "${value}"` +
          (names.length ? ` — write it as \`${names[0]}\`` : "") +
          `. The hex is on-palette, so the figure renders correctly, but a token survives a palette ` +
          `revision and a hex does not.`,
      );
    }
  }

  warnings.push(...redundantRampWarning(spec, specRel, palette));
  return { errors, warnings };
}

/**
 * Warn when `series_colors` merely writes out the default ramp order — the author gained nothing and
 * gave up the ability to inherit a palette revision.
 *
 * Scoped hard, because getting this wrong means failing a legitimate spec. It stays SILENT unless
 * every one of these holds:
 *   - `series_order` is present (without it the slot order comes from first appearance in the CSV,
 *     which this lint does not read);
 *   - no `small_multiples` (a faceted chart takes its slots from the figure-level series list, not
 *     the pane's);
 *   - no `barStack.mono` (a mono stack paints from one hue's tonal scale and ignores
 *     `series_colors` entirely, so a warning would be about a field that paints nothing);
 *   - at most 7 series, all colored by a bare ramp hue name — beyond position 7 the engine moves to
 *     the `-light` tier of each hue and the comparison stops being a simple name match;
 *   - every `series_order` entry has a `series_colors` entry, and each equals its ramp position.
 * A partial-prefix match does NOT warn: `etr-vintages` sets positions 1 and 2 to the default and
 * position 3 deliberately off it, which is a real choice, not a redundant restatement.
 */
function redundantRampWarning(spec, specRel, palette) {
  const colors = spec.series_colors;
  const order = spec.series_order;
  if (!colors || typeof colors !== "object" || Array.isArray(colors)) return [];
  if (!Array.isArray(order) || order.length === 0) return [];
  if (spec.small_multiples) return [];
  if (spec.barStack?.mono) return [];
  // A title-selector option's colour is passed as the single-series accent and overrides the series
  // map, so "the engine assigns exactly this" would be false.
  if (spec.title_selectors) return [];
  if (order.length > palette.rampOrder.length) return [];

  const keys = Object.keys(colors);
  if (keys.length !== order.length) return [];
  for (const [i, series] of order.entries()) {
    if (!Object.prototype.hasOwnProperty.call(colors, series)) return [];
    if (colors[series] !== palette.rampOrder[i]) return [];
  }
  return [
    `${specRel}: series_colors restates the default ramp order ` +
      `(${order.map((s, i) => `${s} = ${palette.rampOrder[i]}`).join(", ")}). ` +
      `Omit series_colors — the engine assigns exactly this.`,
  ];
}
