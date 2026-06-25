import { test } from "node:test";
import assert from "node:assert/strict";
import { createDevServer, mapPathToChartId, parseArgs } from "./dev-server.mjs";

async function boot() {
  const dev = await createDevServer();
  await new Promise((r) => dev.server.listen(0, r));
  const port = dev.server.address().port;
  return { port, close: () => dev.close() };
}

test("GET /api/charts lists charts with titles", async () => {
  const { port, close } = await boot();
  try {
    const res = await fetch(`http://localhost:${port}/api/charts`);
    assert.equal(res.status, 200);
    const list = await res.json();
    assert.ok(Array.isArray(list));
    const known = list.find((c) => c.id === "atus-childcare/childcare-by-activity");
    assert.ok(known, "expected known chart id in catalog");
    assert.equal(typeof known.title, "string");
    assert.equal(known.collectionSlug, "atus-childcare");
    assert.ok(!("specPath" in known), "specPath must not leak to the client");
  } finally {
    close();
  }
});

test("GET /preview/<known-good> renders an embeddable chart page", async () => {
  const { port, close } = await boot();
  try {
    const res = await fetch(`http://localhost:${port}/preview/atus-childcare/childcare-by-activity`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /id="chart"/, "rendered page should contain the chart mount node");
    assert.match(html, /iframeResizer\.contentWindow/, "embed resizer child script should be injected");
  } finally {
    close();
  }
});

test("GET /preview/<unknown> returns the styled error page", async () => {
  const { port, close } = await boot();
  try {
    const res = await fetch(`http://localhost:${port}/preview/no-such/chart`);
    assert.equal(res.status, 404);
    const html = await res.text();
    assert.match(html, /Render failed|No chart with this id/);
  } finally {
    close();
  }
});

test("GET /embed/v1/<asset> serves the resizer script", async () => {
  const { port, close } = await boot();
  try {
    const res = await fetch(`http://localhost:${port}/embed/v1/iframeResizer.min.js`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") || "", /javascript/);
    assert.ok((await res.text()).length > 0);
  } finally {
    close();
  }
});

test("GET /embed/v1 rejects path traversal", async () => {
  const { port, close } = await boot();
  try {
    const res = await fetch(`http://localhost:${port}/embed/v1/..%2f..%2fpackage.json`);
    assert.ok(res.status === 403 || res.status === 404);
  } finally {
    close();
  }
});

test("mapPathToChartId maps a data file to its chart and rejects outsiders", () => {
  const charts = [{ id: "col/foo", specPath: "/r/charts/articles/2026/06/col/foo/chart.yaml" }];
  assert.equal(mapPathToChartId("/r/charts/articles/2026/06/col/foo/data.csv", charts), "col/foo");
  assert.equal(mapPathToChartId("/r/charts/articles/2026/06/col/foo/chart.yaml", charts), "col/foo");
  assert.equal(mapPathToChartId("/r/charts/articles/2026/06/other/x.csv", charts), null);
});

test("GET / serves the app shell", async () => {
  const { port, close } = await boot();
  try {
    const res = await fetch(`http://localhost:${port}/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") || "", /text\/html/);
    const html = await res.text();
    assert.match(html, /id="picker"/);
    assert.match(html, /new EventSource\("\/events"\)/);
    assert.match(html, /iframeResizer\.min\.js/);
  } finally {
    close();
  }
});

test("parseArgs reads --port and --open", () => {
  assert.deepEqual(parseArgs([]), { port: 5173, open: false });
  assert.deepEqual(parseArgs(["--port", "6000"]), { port: 6000, open: false });
  assert.deepEqual(parseArgs(["--open"]), { port: 5173, open: true });
  assert.deepEqual(parseArgs(["--port", "6000", "--open"]), { port: 6000, open: true });
});
