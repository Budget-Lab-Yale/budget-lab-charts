import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MAX_TABLE_ROWS,
  STATIC_HEAD,
  escapeHtml,
  richTextHtml,
  parseCsvRows,
  buildStaticBlock,
  staticBlockForChart,
  injectStaticBlock,
} from "../scripts/static-block.mjs";

const count = (hay, needle) => hay.split(needle).length - 1;
const tbody = (html) => {
  const m = html.match(/<tbody>([\s\S]*?)<\/tbody>/);
  return m ? m[1] : "";
};

test("constants", () => {
  assert.equal(MAX_TABLE_ROWS, 200);
  assert.equal(
    STATIC_HEAD,
    '<!-- tbl-static-head:start --><style>html.tbl-js #tbl-static{display:none}</style><script>document.documentElement.classList.add("tbl-js")</script><!-- tbl-static-head:end -->',
  );
});

test("escapeHtml escapes & < > \" ' and maps null/undefined to empty", () => {
  assert.equal(escapeHtml(`a&b<c>d"e'f`), "a&amp;b&lt;c&gt;d&quot;e&#39;f");
  assert.equal(escapeHtml(null), "");
  assert.equal(escapeHtml(undefined), "");
});

test("escapes every field", () => {
  const b = buildStaticBlock({
    title: 'A <b> & "c"',
    subtitle: "sub <i>",
    collectionTitle: "Coll & <x>",
    collectionUrl: "https://x.org/a?b=1&c=2",
    csvText: null,
  });
  assert.ok(b.includes('<h1>A &lt;b&gt; &amp; &quot;c&quot;</h1>'), b);
  assert.ok(b.includes("<p>sub &lt;i&gt;</p>"), b);
  assert.ok(b.includes('From <a href="https://x.org/a?b=1&amp;c=2">Coll &amp; &lt;x&gt;</a>.'), b);
  assert.ok(!b.includes("<b>"));
  assert.ok(!b.includes("<i>"));
});

test("block is wrapped in markers with no newlines", () => {
  const b = buildStaticBlock({ title: "T", subtitle: "S", csvText: "a,b\n1,2\n" });
  assert.ok(b.startsWith('<!-- tbl-static:start --><section id="tbl-static">'), b);
  assert.ok(b.endsWith("</section><!-- tbl-static:end -->"), b);
  assert.ok(!b.includes("\n"));
});

test("links only allowed schemes", () => {
  const s = buildStaticBlock({ title: "T", source: "See [BLS](https://www.bls.gov/ces/)" });
  assert.ok(s.includes('<p>Source: See <a href="https://www.bls.gov/ces/">BLS</a></p>'), s);

  const n = buildStaticBlock({ title: "T", note: "[x](javascript:alert(1))" });
  assert.ok(n.includes("<p>Note: [x](javascript:alert(1))</p>"), n);
  assert.ok(!n.includes("<a"), n);

  assert.equal(richTextHtml("[m](mailto:a@b.org)"), '<a href="mailto:a@b.org">m</a>');
  assert.equal(richTextHtml("[r](/relative)"), "[r](/relative)");
  assert.equal(richTextHtml("[a<b](https://x.org/)"), '<a href="https://x.org/">a&lt;b</a>');
  assert.equal(richTextHtml("plain & <x>"), "plain &amp; &lt;x&gt;");
});

test("joins eyebrow with an em dash", () => {
  assert.ok(buildStaticBlock({ title: "T", eyebrow: "Figure 1" }).includes("<h1>Figure 1 — T</h1>"));
  assert.ok(buildStaticBlock({ title: "T" }).includes("<h1>T</h1>"));
  assert.ok(buildStaticBlock({ title: "T", eyebrow: "  " }).includes("<h1>T</h1>"));
});

test("omits empty lines", () => {
  for (const b of [
    buildStaticBlock({ title: "T", subtitle: "", note: "", source: "" }),
    buildStaticBlock({ title: "T" }),
    buildStaticBlock({ title: "T", subtitle: null, note: undefined, source: "   " }),
  ]) {
    assert.ok(!b.includes("<p></p>"), b);
    assert.ok(!b.includes("Note:"), b);
    assert.ok(!b.includes("Source:"), b);
    assert.ok(!b.includes("<p>"), b);
  }
});

test("from-line: URL set gives an anchored title", () => {
  const b = buildStaticBlock({ title: "T", collectionTitle: "Title", collectionUrl: "https://x.org/a", csvText: "a\n1\n" });
  assert.ok(
    b.includes('<p>From <a href="https://x.org/a">Title</a>. <a href="data.csv">Download the data (CSV)</a></p>'),
    b,
  );
});

test("from-line: empty URL gives plain-text title", () => {
  const b = buildStaticBlock({ title: "T", collectionTitle: "Title", collectionUrl: "", csvText: null });
  assert.ok(b.includes("<p>From Title.</p>"), b);
  assert.ok(!b.includes("<a"), b);
});

test("from-line: null csvText gives no data link and no table", () => {
  const b = buildStaticBlock({ title: "T", collectionTitle: "Title", collectionUrl: "https://x.org/a", csvText: null });
  assert.ok(!b.includes("data.csv"), b);
  assert.ok(!b.includes("<table"), b);
});

test("from-line: no collectionTitle and no CSV gives no from line", () => {
  const b = buildStaticBlock({ title: "T", collectionUrl: "https://x.org/a", csvText: null });
  assert.ok(!b.includes("From"), b);
  assert.ok(!b.includes("<p>"), b);
});

test("from-line: CSV without collection gives just the data link", () => {
  const b = buildStaticBlock({ title: "T", csvText: "a\n1\n" });
  assert.ok(b.includes('<p><a href="data.csv">Download the data (CSV)</a></p>'), b);
});

test("row limit", () => {
  const csv = (n) => "x,y\n" + Array.from({ length: n }, (_, i) => `${i},${i * 2}`).join("\n") + "\n";
  const at = buildStaticBlock({ title: "T", csvText: csv(200) });
  assert.ok(at.includes("<table"), "200 rows should render a table");
  assert.equal(count(tbody(at), "<tr>"), 200);

  const over = buildStaticBlock({ title: "T", csvText: csv(201) });
  assert.ok(!over.includes("<table"));
  assert.ok(over.includes('<a href="data.csv">Download the data (CSV)</a>'));
});

test("table needs a header and at least one data row", () => {
  assert.ok(!buildStaticBlock({ title: "T", csvText: "a,b\n" }).includes("<table"));
  assert.ok(!buildStaticBlock({ title: "T", csvText: "" }).includes("<table"));
});

test("table cells are escaped and raw", () => {
  const b = buildStaticBlock({ title: "T", csvText: "h<1>,h2\n1234.5000,<b>\n" });
  assert.ok(
    b.includes("<table><thead><tr><th>h&lt;1&gt;</th><th>h2</th></tr></thead><tbody><tr><td>1234.5000</td><td>&lt;b&gt;</td></tr></tbody></table>"),
    b,
  );
});

test("parseCsvRows: BOM, quotes, embedded comma/newline, CRLF", () => {
  const text = "﻿\"a,b\",2024,c\r\n\"x\"\"y\",\"1\n2\",3\r\n";
  assert.deepEqual(parseCsvRows(text), [["a,b", "2024", "c"], ["x\"y", "1\n2", "3"]]);
  const b = buildStaticBlock({ title: "T", csvText: text });
  assert.ok(b.includes("<thead><tr><th>a,b</th><th>2024</th><th>c</th></tr></thead>"), b);
});

test("parseCsvRows: LF, CR, no trailing newline, untrimmed cells, empty cells", () => {
  assert.deepEqual(parseCsvRows("a,b\n1,2"), [["a", "b"], ["1", "2"]]);
  assert.deepEqual(parseCsvRows("a,b\r1,2\r"), [["a", "b"], ["1", "2"]]);
  assert.deepEqual(parseCsvRows(" a , b \n,\n"), [[" a ", " b "], ["", ""]]);
  assert.deepEqual(parseCsvRows(""), []);
});

const PAGE = '<html><head><title>t</title></head><body><div id="chart" style="x"></div><script>1</script></body></html>';

test("inject is idempotent", () => {
  const b = buildStaticBlock({ title: "T", csvText: "a\n1\n" });
  const once = injectStaticBlock(PAGE, b);
  const twice = injectStaticBlock(once, b);
  assert.equal(twice, once);
  for (const m of ["<!-- tbl-static-head:start -->", "<!-- tbl-static-head:end -->", "<!-- tbl-static:start -->", "<!-- tbl-static:end -->"]) {
    assert.equal(count(once, m), 1, m);
  }
  assert.ok(once.includes('<div id="chart" style="x"></div>' + b + "<script>1"), once);
  assert.ok(once.includes(STATIC_HEAD + "</head>"), once);
});

test("inject replaces a stale block", () => {
  const b1 = buildStaticBlock({ title: "First" });
  const b2 = buildStaticBlock({ title: "Second" });
  const out = injectStaticBlock(injectStaticBlock(PAGE, b1), b2);
  assert.ok(out.includes("Second"));
  assert.ok(!out.includes("First"));
  assert.equal(count(out, "<!-- tbl-static:start -->"), 1);
});

test("inject strips blocks that span newlines", () => {
  const stale = PAGE.replace("</head>", "<!-- tbl-static-head:start -->\nold\n<!-- tbl-static-head:end --></head>")
    .replace("</div>", "</div>\n<!-- tbl-static:start -->\nold\n<!-- tbl-static:end -->\n");
  const out = injectStaticBlock(stale, buildStaticBlock({ title: "New" }));
  assert.ok(!out.includes("old"), out);
});

test("inject throws without exactly one anchor", () => {
  const b = buildStaticBlock({ title: "T" });
  assert.throws(
    () => injectStaticBlock("<html><head></head><body></body></html>", b),
    /expected exactly one #chart anchor, found 0/,
  );
  const two = PAGE.replace("<script>", '<div id="chart"></div><script>');
  assert.throws(() => injectStaticBlock(two, b), /expected exactly one #chart anchor, found 2/);
});

test("inject throws without </head>", () => {
  const b = buildStaticBlock({ title: "T" });
  assert.throws(() => injectStaticBlock('<body><div id="chart"></div></body>', b));
});

test("$ safety", () => {
  const b = buildStaticBlock({ title: "$& $1 $$ $`" });
  const out = injectStaticBlock(PAGE, b);
  assert.ok(out.includes("<h1>$&amp; $1 $$ $`</h1>"), out);
});

test("staticBlockForChart reads spec and CSV", () => {
  const dir = mkdtempSync(join(tmpdir(), "static-block-"));
  try {
    writeFileSync(
      join(dir, "chart.yaml"),
      'title: "Wages rose"\nnote: "Data from [BLS](https://www.bls.gov/ces/)."\n',
    );
    writeFileSync(join(dir, "data.csv"), "year,value\n2024,1\n2025,2\n");
    const b = staticBlockForChart({
      dir,
      specPath: join(dir, "chart.yaml"),
      chartSlug: "fig",
      collection: { title: "Art", url: "https://x.org/a", figures: { fig: "Figure 2" } },
    });
    assert.ok(b.includes("<h1>Figure 2 — Wages rose</h1>"), b);
    assert.ok(b.includes('<a href="https://www.bls.gov/ces/">BLS</a>'), b);
    assert.ok(b.includes('From <a href="https://x.org/a">Art</a>.'), b);
    assert.ok(b.includes("<table>"), b);
    assert.ok(b.includes("<th>year</th><th>value</th>"), b);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("staticBlockForChart with a table.yaml and no data.csv", () => {
  const dir = mkdtempSync(join(tmpdir(), "static-block-"));
  try {
    writeFileSync(join(dir, "table.yaml"), "title: Tbl\n");
    const b = staticBlockForChart({ dir, specPath: join(dir, "table.yaml"), chartSlug: "t", collection: {} });
    assert.ok(b.includes("<h1>Tbl</h1>"), b);
    assert.ok(!b.includes("data.csv"));
    assert.ok(!b.includes("<table"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("collection url with a disallowed scheme is not linked", () => {
  const html = buildStaticBlock({ title: "T", collectionTitle: "Art", collectionUrl: "javascript:alert(1)" });
  assert.ok(!html.includes("javascript:"), html);
  assert.ok(html.includes("<p>From Art.</p>"), html);
});
