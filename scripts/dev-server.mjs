/**
 * dev-server.mjs — local live-preview dev server for budget-lab-charts.
 *
 * Lists every chart, renders any one on demand via `tbl-chart render` (identical to
 * build-all), previews it as it appears embedded, and auto-reloads on file save.
 * No engine changes; no new npm dependencies.
 */

import { createServer } from "node:http";
import { readFileSync, watch } from "node:fs";
import { readFile, unlink } from "node:fs/promises";
import { spawnSync, spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve, dirname, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { parse as parseYaml } from "yaml";
import { listCharts, REPO_ROOT, buildTblChartCmd } from "./lib.mjs";

function readTitle(specPath) {
  try {
    const spec = parseYaml(readFileSync(specPath, "utf8"));
    return spec && typeof spec.title === "string" ? spec.title : null;
  } catch {
    return null;
  }
}

// Internal chart objects carry specPath (server-side only); the /api/charts response strips it.
async function buildChartList(chartsRoot) {
  const charts = await listCharts(chartsRoot);
  return charts.map((c) => ({
    id: c.id,
    title: readTitle(c.specPath) ?? c.id,
    kind: c.kind,
    collectionSlug: c.id.split("/")[0],
    chartSlug: c.chartSlug,
    eyebrowLabel: c.collection?.figures?.[c.chartSlug] ?? null,
    specPath: c.specPath,
  }));
}

function publicChart({ specPath, ...pub }) {
  return pub;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}

// Map a changed file path to the id of the chart whose folder contains it (longest-match wins).
export function mapPathToChartId(changedPath, charts) {
  const abs = resolve(changedPath);
  let best = null;
  let bestLen = -1;
  for (const c of charts) {
    const dir = resolve(dirname(c.specPath));
    if ((abs === dir || abs.startsWith(dir + sep)) && dir.length > bestLen) {
      best = c;
      bestLen = dir.length;
    }
  }
  return best ? best.id : null;
}

// Embed-injection snippet — DUPLICATED from build-all.mjs (kept in sync intentionally; build-all
// is not refactored). The child script src is absolute here because the dev server controls the URL.
const RESIZER_TAG =
  '<script src="/embed/v1/iframeResizer.contentWindow.min.js"></script>' +
  '<script>(function(){if(window.self===window.top)return;' +
  'function fit(){try{if(window.parentIFrame&&window.parentIFrame.size)window.parentIFrame.size();}catch(e){}}' +
  'var t;function soon(){clearTimeout(t);t=setTimeout(fit,60);}' +
  'if(window.ResizeObserver){try{new ResizeObserver(soon).observe(document.body);}catch(e){}}' +
  'window.addEventListener("load",function(){setTimeout(fit,200);setTimeout(fit,800);});' +
  'if(document.fonts&&document.fonts.ready){document.fonts.ready.then(function(){setTimeout(fit,50);});}})();</script>';

const EMBED_HEAD =
  '<style>html.tbl-embedded body{margin:0 !important}' +
  'html.tbl-embedded #chart{margin:0 !important;max-width:none !important;padding:0 !important}</style>' +
  '<script>try{if(window.self!==window.top)document.documentElement.classList.add("tbl-embedded")}' +
  'catch(e){document.documentElement.classList.add("tbl-embedded")}</script>';

function injectEmbedAssets(html) {
  if (html.includes("iframeResizer.contentWindow")) return html;
  return html
    .replace("</head>", `${EMBED_HEAD}\n</head>`)
    .replace("</body>", `${RESIZER_TAG}\n</body>`);
}

function errorPage(id, message) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<style>body{font-family:system-ui,sans-serif;margin:24px;color:#1a1a2e}
h1{font-size:16px;color:#b91c1c;margin:0 0 8px}
.id{font-family:monospace;color:#666;font-size:12px;margin-bottom:12px}
pre{white-space:pre-wrap;background:#f3f4f6;padding:12px;border-radius:6px;font-size:13px;line-height:1.5;overflow:auto}</style>
</head><body><h1>Render failed</h1><div class="id">${escapeHtml(id)}</div><pre>${escapeHtml(message)}</pre></body></html>`;
}

async function renderChartHtml(chart, { eyebrow }) {
  const tmpFile = join(tmpdir(), `tbl-preview-${process.pid}-${Date.now()}.html`);
  const cliArgs = ["render", chart.specPath, "-o", tmpFile];
  if (eyebrow && chart.eyebrowLabel) cliArgs.push("--eyebrow", chart.eyebrowLabel);

  const { executable, args, options } = buildTblChartCmd(cliArgs);
  const result = spawnSync(executable, args, { ...options, encoding: "utf-8" });

  if (result.status !== 0) {
    const msg =
      [result.stdout, result.stderr].filter((s) => s && s.trim()).join("\n").trim() ||
      `tbl-chart render exited with code ${result.status}`;
    return { ok: false, html: errorPage(chart.id, msg) };
  }

  let html;
  try {
    html = await readFile(tmpFile, "utf8");
  } catch (err) {
    return { ok: false, html: errorPage(chart.id, `could not read rendered output: ${err.message}`) };
  } finally {
    unlink(tmpFile).catch(() => {});
  }
  return { ok: true, html: injectEmbedAssets(html) };
}

const EMBED_TYPES = {
  ".js": "text/javascript; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

async function serveEmbedAsset(repoRoot, pathname, res) {
  const embedDir = join(repoRoot, "embed", "v1");
  const rel = decodeURIComponent(pathname.slice("/embed/v1/".length));
  const abs = resolve(embedDir, rel);
  if (abs !== embedDir && !abs.startsWith(embedDir + sep)) {
    res.writeHead(403, { "content-type": "text/plain" });
    res.end("403 Forbidden");
    return;
  }
  try {
    const buf = await readFile(abs);
    const ext = abs.slice(abs.lastIndexOf("."));
    res.writeHead(200, { "content-type": EMBED_TYPES[ext] ?? "application/octet-stream" });
    res.end(buf);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("404 Not Found");
  }
}

const APP_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Live chart preview — budget-lab-charts</title>
<style>
*,*::before,*::after{box-sizing:border-box}
html,body{margin:0;height:100%}
body{font-family:system-ui,-apple-system,'Segoe UI',Arial,sans-serif;color:#1a1a2e;display:flex;height:100vh}
#sidebar{width:300px;flex:0 0 300px;border-right:1px solid #e2e5ea;display:flex;flex-direction:column;background:#fafbfc}
#sidebar h1{font-size:14px;font-weight:800;margin:0;padding:14px 16px;background:#1a1a2e;color:#fff}
#search{margin:10px;padding:7px 9px;border:1px solid #d6dae0;border-radius:6px;font-size:13px}
#picker{overflow:auto;flex:1;padding:6px}
.folder{margin-bottom:1px}
.folder-hd{display:flex;align-items:center;gap:6px;width:100%;border:0;background:none;cursor:pointer;padding:6px 8px;border-radius:6px;font:inherit;color:#1a1a2e;text-align:left;font-weight:700;font-size:13px}
.folder-hd:hover{background:#eef1f5}
.caret{display:inline-block;transition:transform .12s;color:#8a8f99;font-size:10px;width:10px;text-align:center}
.folder.collapsed .caret{transform:rotate(-90deg)}
.folder.collapsed .folder-body{display:none}
.folder-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.folder-body{padding-left:16px}
.chart-link{display:block;padding:6px 10px;border-radius:6px;text-decoration:none;color:#1a1a2e}
.chart-link:hover{background:#eef1f5}
.chart-link.active{background:#d9eaff}
.chart-link .t{display:block;font-size:13px;font-weight:600;line-height:1.3;font-family:ui-monospace,monospace}
.chart-link .s{display:block;font-size:11px;color:#8a8f99;line-height:1.35;margin-top:1px}
.chart-link .fig{color:#0072b2;font-weight:600}
.none{color:#8a8f99;padding:12px 10px;font-size:13px}
main{flex:1;display:flex;flex-direction:column;min-width:0}
#controls{display:flex;align-items:center;gap:18px;padding:10px 16px;border-bottom:1px solid #e2e5ea;font-size:13px;flex-wrap:wrap}
#controls .group{display:flex;align-items:center;gap:6px}
#controls button[data-w]{border:1px solid #d6dae0;background:#fff;border-radius:5px;padding:3px 8px;font-size:12px;cursor:pointer}
#controls button[data-w].active{background:#1a1a2e;color:#fff;border-color:#1a1a2e}
#wcustom{width:64px;padding:3px 6px;border:1px solid #d6dae0;border-radius:5px;font-size:12px}
#status{margin-left:auto;color:#8a8f99;font-size:12px}
#stage{flex:1;overflow:auto;background:#f4f5f7;padding:24px;display:flex;justify-content:center;align-items:flex-start}
#frame-wrap{width:620px;max-width:100%;background:#fff;box-shadow:0 1px 6px rgba(0,0,0,.08);display:none}
#preview{width:100%;border:0;display:block}
#empty{color:#8a8f99;margin-top:40px}
</style></head>
<body>
<aside id="sidebar">
  <h1>Charts</h1>
  <input id="search" placeholder="Filter charts…" autocomplete="off">
  <div id="picker"></div>
</aside>
<main>
  <div id="controls">
    <span class="group">Width:
      <button data-w="320">320</button>
      <button data-w="620" class="active">620</button>
      <button data-w="740">740</button>
      <button data-w="100%">Full</button>
      <input id="wcustom" type="number" min="200" placeholder="px">
    </span>
    <label class="group"><input type="checkbox" id="eyebrow" checked> Eyebrow</label>
    <span id="status">connecting…</span>
  </div>
  <div id="stage">
    <div id="frame-wrap"><iframe id="preview" title="chart preview"></iframe></div>
    <p id="empty">Select a chart to preview.</p>
  </div>
</main>
<script src="/embed/v1/iframeResizer.min.js"></script>
<script>
const state = { id: null, width: "620", eyebrow: true, collapsed: new Set() };
const $ = (s) => document.querySelector(s);
let charts = [];
function esc(s){return String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));}
function previewUrl(id){
  const path = id.split("/").map(encodeURIComponent).join("/");
  return "/preview/"+path+"?eyebrow="+(state.eyebrow?"on":"off")+"&_="+Date.now();
}
function applyWidth(){ $("#frame-wrap").style.width = state.width === "100%" ? "100%" : state.width+"px"; }
function navigate(){ if(state.id) $("#preview").src = previewUrl(state.id); }
function setActive(id){
  state.id = id;
  $("#empty").style.display = "none";
  $("#frame-wrap").style.display = "block";
  navigate();
  document.querySelectorAll(".chart-link").forEach(a => a.classList.toggle("active", a.dataset.id === id));
}
$("#preview").addEventListener("load", () => {
  if(!state.id) return;
  try{ if(window.iFrameResize) window.iFrameResize({checkOrigin:false,log:false}, "#preview"); }catch(e){}
  $("#status").textContent = "rendered " + new Date().toLocaleTimeString();
});
function renderPicker(){
  const q = $("#search").value.toLowerCase();
  const groups = {};
  for(const c of charts){
    if(q && !(c.id.toLowerCase().includes(q) || (c.title||"").toLowerCase().includes(q))) continue;
    (groups[c.collectionSlug] ||= []).push(c);
  }
  const html = Object.keys(groups).sort().map(g => {
    const collapsed = !q && state.collapsed.has(g);
    const items = groups[g].map(c =>
      '<a class="chart-link'+(c.id===state.id?' active':'')+'" data-id="'+esc(c.id)+'" href="#">'+
      '<span class="t">'+esc(c.chartSlug)+'</span>'+
      '<span class="s">'+(c.eyebrowLabel?'<span class="fig">'+esc(c.eyebrowLabel)+'</span> ':'')+esc(c.title)+'</span></a>').join("");
    return '<div class="folder'+(collapsed?' collapsed':'')+'" data-collection="'+esc(g)+'">'+
      '<button class="folder-hd" type="button"><span class="caret">▾</span>'+
      '<span class="folder-name">'+esc(g)+'</span></button>'+
      '<div class="folder-body">'+items+'</div></div>';
  }).join("");
  $("#picker").innerHTML = html || '<p class="none">No charts found.</p>';
}
async function loadCharts(){
  try{ charts = await (await fetch("/api/charts")).json(); renderPicker(); }
  catch(e){ $("#status").textContent = "failed to load chart list"; }
}
$("#picker").addEventListener("click", (e) => {
  const hd = e.target.closest(".folder-hd");
  if(hd){
    const folder = hd.closest(".folder");
    const g = folder.dataset.collection;
    if(state.collapsed.has(g)) state.collapsed.delete(g); else state.collapsed.add(g);
    folder.classList.toggle("collapsed");
    return;
  }
  const a = e.target.closest(".chart-link"); if(!a) return;
  e.preventDefault(); setActive(a.dataset.id);
});
$("#search").addEventListener("input", renderPicker);
$("#controls").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-w]"); if(!b) return;
  state.width = b.dataset.w;
  document.querySelectorAll("#controls button[data-w]").forEach(x => x.classList.toggle("active", x===b));
  $("#wcustom").value = "";
  applyWidth();
});
$("#wcustom").addEventListener("change", (e) => {
  if(!e.target.value) return;
  state.width = e.target.value;
  document.querySelectorAll("#controls button[data-w]").forEach(x => x.classList.remove("active"));
  applyWidth();
});
$("#eyebrow").addEventListener("change", (e) => { state.eyebrow = e.target.checked; navigate(); });
const es = new EventSource("/events");
es.addEventListener("open", () => { if(!state.id) $("#status").textContent = "ready"; });
es.onmessage = (ev) => {
  let m; try{ m = JSON.parse(ev.data); }catch{ return; }
  if(m.type === "reload" && m.id === state.id) navigate();
  else if(m.type === "charts") loadCharts();
};
es.onerror = () => { $("#status").textContent = "disconnected — is the dev server running?"; };
applyWidth();
loadCharts();
</script>
</body></html>`;

export async function createDevServer({ repoRoot = REPO_ROOT, chartsRoot = join(repoRoot, "charts") } = {}) {
  let charts = await buildChartList(chartsRoot);

  const sseClients = new Set();
  function broadcast(event) {
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    for (const res of sseClients) res.write(payload);
  }

  let debounceTimer = null;
  const watcher = watch(chartsRoot, { recursive: true }, (_event, filename) => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      const changed = filename ? resolve(chartsRoot, filename.toString()) : null;
      const before = new Set(charts.map((c) => c.id));
      charts = await buildChartList(chartsRoot);
      const after = new Set(charts.map((c) => c.id));
      const structural = before.size !== after.size || [...after].some((id) => !before.has(id));
      if (structural) broadcast({ type: "charts" });
      const id = changed ? mapPathToChartId(changed, charts) : null;
      if (id) broadcast({ type: "reload", id });
    }, 150);
  });

  const server = createServer(async (req, res) => {
    try {
      const u = new URL(req.url, "http://localhost");
      const pathname = u.pathname;

      if (pathname === "/") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(APP_HTML);
        return;
      }

      if (pathname === "/api/charts") {
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(charts.map(publicChart)));
        return;
      }

      if (pathname === "/events") {
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });
        res.write(": connected\n\n");
        sseClients.add(res);
        req.on("close", () => sseClients.delete(res));
        return;
      }

      if (pathname.startsWith("/preview/")) {
        const id = decodeURIComponent(pathname.slice("/preview/".length));
        const chart = charts.find((c) => c.id === id);
        if (!chart) {
          res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
          res.end(errorPage(id, "No chart with this id. It may have been renamed or removed."));
          return;
        }
        const eyebrow = u.searchParams.get("eyebrow") !== "off";
        const { html } = await renderChartHtml(chart, { eyebrow });
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(html);
        return;
      }

      if (pathname.startsWith("/embed/v1/")) {
        await serveEmbedAsset(repoRoot, pathname, res);
        return;
      }

      res.writeHead(404, { "content-type": "text/plain" });
      res.end("404 Not Found");
    } catch (err) {
      if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain" });
      res.end(`Internal error: ${err.message}`);
    }
  });

  return {
    server,
    get charts() {
      return charts;
    },
    broadcast,
    close() {
      clearTimeout(debounceTimer);
      watcher.close();
      for (const res of sseClients) res.end();
      server.close();
    },
  };
}

export function parseArgs(argv) {
  let port = 5173;
  let open = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--port") port = Number(argv[++i]);
    else if (argv[i] === "--open") open = true;
  }
  return { port, open };
}

export function listenWithRetry(server, startPort, attempts = 20) {
  return (async () => {
    for (let p = startPort; p < startPort + attempts; p++) {
      try {
        await new Promise((res, rej) => {
          const onErr = (e) => {
            server.removeListener("listening", onOk);
            rej(e);
          };
          const onOk = () => {
            server.removeListener("error", onErr);
            res();
          };
          server.once("error", onErr);
          server.once("listening", onOk);
          server.listen(p);
        });
        return p;
      } catch (e) {
        if (e.code !== "EADDRINUSE") throw e;
      }
    }
    throw new Error(`No free port found in ${startPort}..${startPort + attempts}`);
  })();
}

function openBrowser(url) {
  try {
    if (process.platform === "win32") spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
    else if (process.platform === "darwin") spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    else spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
  } catch {
    // non-fatal — the URL is printed to the console regardless
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const { port, open } = parseArgs(process.argv.slice(2));
  const dev = await createDevServer();
  const actual = await listenWithRetry(dev.server, port);
  const url = `http://localhost:${actual}/`;
  console.log(`Live chart preview running at ${url}`);
  console.log("Watching charts/ — edit a chart.yaml or data.csv and the preview reloads.");
  if (open) openBrowser(url);
}
