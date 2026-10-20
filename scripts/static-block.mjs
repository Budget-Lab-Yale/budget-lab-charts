// Plain-HTML fallback for every published chart page (dist/<collection>/<chart>/index.html).
//
// Fetchers that do not run JavaScript (crawlers, curl, LLM fetch tools, Mozilla Readability) see an
// empty <div id="chart"> on a chart page. This module builds a <section id="tbl-static"> holding the
// title, subtitle, note, source, links and the data as a table, and injects it right after that div.
//
// Readers with JS never see it: STATIC_HEAD adds class `tbl-js` to <html> from a head script, and a
// stylesheet rule hides the section under that class. We deliberately do NOT use `hidden`,
// `aria-hidden` or an inline `display:none`, because Readability discards elements marked those
// ways, which would defeat the point.
//
// The hide rule lives in its own head markers rather than in the engine's render step because pages
// reused from gh-pages are never re-rendered: a render-only head injection would never reach them.
// Both the head and body pieces are stripped and reinserted on every build, so injection is
// idempotent and a stale block is always replaced.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { parseInlineLinks, isAllowedHref } from "budget-lab-chart-engine/spec";

export const MAX_TABLE_ROWS = 200;

export const STATIC_HEAD =
  '<!-- tbl-static-head:start --><style>html.tbl-js #tbl-static{display:none}</style><script>document.documentElement.classList.add("tbl-js")</script><!-- tbl-static-head:end -->';

const HEAD_RE = /<!-- tbl-static-head:start -->[\s\S]*?<!-- tbl-static-head:end -->/g;
const BODY_RE = /<!-- tbl-static:start -->[\s\S]*?<!-- tbl-static:end -->/g;
const ANCHOR_RE = /<div id="chart"[^>]*><\/div>/g;

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(s) {
  if (s == null) return "";
  return String(s).replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

/** Escaped HTML for note/source text, with `[text](url)` links per the engine's own rule. */
export function richTextHtml(s) {
  if (s == null) return "";
  return parseInlineLinks(String(s))
    .map((run) =>
      run.href ? `<a href="${escapeHtml(run.href)}">${escapeHtml(run.text)}</a>` : escapeHtml(run.text),
    )
    .join("");
}

/** RFC 4180 rows as string[][], in file column order (the engine's parseCsv returns objects, whose
 *  integer-like keys such as "2024" JS would reorder to the front). */
export function parseCsvRows(text) {
  let s = text == null ? "" : String(text);
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);

  const rows = [];
  let row = [];
  let field = "";
  let quoted = false; // current row contains a quoted field (so [""] is real, not a blank line)
  let inQuotes = false;
  let fieldStart = true; // like the engine, a quote only opens a field; mid-field it is literal

  const endRow = () => {
    row.push(field);
    rows.push({ cells: row, quoted });
    row = [];
    field = "";
    quoted = false;
    fieldStart = true;
  };

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"' && fieldStart) {
      inQuotes = true;
      quoted = true;
      fieldStart = false;
    } else if (c === ",") {
      row.push(field);
      field = "";
      fieldStart = true;
    } else if (c === "\r") {
      if (s[i + 1] === "\n") i++;
      endRow();
    } else if (c === "\n") {
      endRow();
    } else {
      field += c;
      fieldStart = false;
    }
  }
  endRow();

  // Blank lines are skipped and headers trimmed, as the engine's parseCsv does, so the table shows
  // the rows the chart was drawn from.
  const out = rows.filter((r) => r.quoted || r.cells.length > 1 || r.cells[0] !== "").map((r) => r.cells);
  if (out.length) out[0] = out[0].map((h) => h.trim());
  return out;
}

const present = (v) => v != null && String(v).trim() !== "";

export function buildStaticBlock({ title, subtitle, note, source, eyebrow, collectionTitle, collectionUrl, csvText } = {}) {
  const parts = [];

  if (present(title)) {
    const heading = present(eyebrow) ? `${eyebrow} — ${title}` : String(title);
    parts.push(`<h1>${escapeHtml(heading)}</h1>`);
  }
  if (present(subtitle)) parts.push(`<p>${escapeHtml(subtitle)}</p>`);
  if (present(note)) parts.push(`<p>Note: ${richTextHtml(note)}</p>`);
  if (present(source)) parts.push(`<p>Source: ${richTextHtml(source)}</p>`);

  const hasCsv = csvText != null;
  const clauses = [];
  if (present(collectionTitle)) {
    clauses.push(
      present(collectionUrl) && isAllowedHref(String(collectionUrl))
        ? `From <a href="${escapeHtml(collectionUrl)}">${escapeHtml(collectionTitle)}</a>.`
        : `From ${escapeHtml(collectionTitle)}.`,
    );
  }
  if (hasCsv) clauses.push('<a href="data.csv">Download the data (CSV)</a>');
  if (clauses.length) parts.push(`<p>${clauses.join(" ")}</p>`);

  if (hasCsv) {
    const rows = parseCsvRows(csvText);
    const dataRows = rows.length - 1;
    if (dataRows >= 1 && dataRows <= MAX_TABLE_ROWS) {
      const head = rows[0].map((h) => `<th>${escapeHtml(h)}</th>`).join("");
      const body = rows
        .slice(1)
        .map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(c)}</td>`).join("")}</tr>`)
        .join("");
      parts.push(`<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`);
    }
  }

  return `<!-- tbl-static:start --><section id="tbl-static">${parts.join("")}</section><!-- tbl-static:end -->`;
}

/** Build the block for one entry of listCharts() (scripts/lib.mjs). */
export function staticBlockForChart(chart) {
  const { dir, specPath, chartSlug, collection = {} } = chart;
  const spec = parse(readFileSync(specPath, "utf8")) ?? {};
  const csvPath = join(dir, "data.csv");
  const csvText = existsSync(csvPath) ? readFileSync(csvPath, "utf8") : null;
  return buildStaticBlock({
    title: spec.title,
    subtitle: spec.subtitle,
    // Charts have `note`; tables have `notes`, a string or an array the engine joins into one note.
    note: spec.note ?? (Array.isArray(spec.notes) ? spec.notes.join(" ") : spec.notes),
    source: spec.source,
    eyebrow: collection?.figures?.[chartSlug],
    collectionTitle: collection?.title,
    collectionUrl: collection?.url,
    csvText,
  });
}

/** Strip any previous static head/body pieces, then insert STATIC_HEAD before </head> and `block`
 *  right after the single #chart div. Index slicing, not replacement strings, so `$` in the block is
 *  inserted literally. */
export function injectStaticBlock(html, block) {
  let out = String(html).replace(HEAD_RE, () => "").replace(BODY_RE, () => "");

  const anchors = [...out.matchAll(ANCHOR_RE)];
  if (anchors.length !== 1) {
    throw new Error("static-block: expected exactly one #chart anchor, found " + anchors.length);
  }
  const headAt = out.indexOf("</head>");
  if (headAt === -1) throw new Error("static-block: no </head> found");

  const anchorEnd = anchors[0].index + anchors[0][0].length;
  // </head> precedes the body anchor on any real page; insert the later one first so the earlier
  // index stays valid either way.
  const inserts = [
    [headAt, STATIC_HEAD],
    [anchorEnd, block],
  ].sort((a, b) => b[0] - a[0]);
  for (const [at, text] of inserts) out = out.slice(0, at) + text + out.slice(at);
  return out;
}
