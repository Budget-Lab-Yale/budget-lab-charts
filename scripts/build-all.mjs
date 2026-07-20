/**
 * build-all.mjs — render every chart to dist/<id>/index.html and copy data.csv.
 *
 * Output: dist/<collection>/<chart>/index.html
 *         dist/<collection>/<chart>/data.csv
 *         dist/.manifest.json  ({ renderVersion, charts: { <id>: { hash } } })
 * (<id> = <collection.slug>/<chart-folder-name>; dateless and tree-independent.)
 *
 * Incremental: when GH_PAGES_DIR is set (and --no-incremental is not passed), the prior manifest
 * at ${GH_PAGES_DIR}/.build/manifest.json is diffed against the current chart hashes. Unchanged
 * charts are copied from the gh-pages checkout; new/changed charts are rendered. Rendering runs
 * through a bounded child-process pool (RENDER_CONCURRENCY).
 */

import { spawn } from "node:child_process";
import { mkdirSync, copyFileSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";

// iframe-resizer child script — injected into every rendered page so the chart auto-reports its
// height when embedded via embed/v1/embed.js. Chart ids are 2 segments (<collection>/<chart>), so
// the page sits 2 levels deep and ../../embed/v1/ resolves to the Pages-root embed dir. The script
// self-detects iframe context; on the standalone/gallery view it is a no-op.
// Resizer child script + a re-measure hook. iframe-resizer v4 tracks height via a MutationObserver
// + window resize, which can miss late reflows (chart re-render, font swap, host layout settling),
// leaving the iframe taller than the settled content (trailing whitespace). A ResizeObserver on
// <body> + a couple of post-load nudges force iframe-resizer to re-measure the true height. Gated
// to embedded context (window.self !== window.top); no-op on the standalone/gallery view.
const RESIZER_TAG =
  '<script src="../../embed/v1/iframeResizer.contentWindow.min.js"></script>' +
  '<script>(function(){if(window.self===window.top)return;' +
  'function fit(){try{if(window.parentIFrame&&window.parentIFrame.size)window.parentIFrame.size();}catch(e){}}' +
  'var t;function soon(){clearTimeout(t);t=setTimeout(fit,60);}' +
  'if(window.ResizeObserver){try{new ResizeObserver(soon).observe(document.body);}catch(e){}}' +
  'window.addEventListener("load",function(){setTimeout(fit,200);setTimeout(fit,800);});' +
  'if(document.fonts&&document.fonts.ready){document.fonts.ready.then(function(){setTimeout(fit,50);});}})();</script>';

// When embedded (in an iframe), make the chart fill the iframe: strip the standalone page's
// centering margin / max-width so it renders edge-to-edge and its height measures correctly. The
// standalone `#chart { margin: 32px auto }` collapses out of body.offsetHeight, which makes
// iframe-resizer size the frame ~32px short (clipping the footer) and the max-width leaves side
// whitespace. Gated on html.tbl-embedded (set only inside an iframe), so the standalone/gallery
// view is unchanged. Injected into <head> so it applies before the chart mounts (no reflow flash).
const EMBED_HEAD =
  '<style>html.tbl-embedded body{margin:0 !important}' +
  'html.tbl-embedded #chart{margin:0 !important;max-width:none !important;padding:0 !important}</style>' +
  '<script>try{if(window.self!==window.top)document.documentElement.classList.add("tbl-embedded")}' +
  'catch(e){document.documentElement.classList.add("tbl-embedded")}</script>';

import { listCharts, buildTblChartCmd, REPO_ROOT } from "./lib.mjs";
import { runPool } from "./pool.mjs";
import {
  THUMBS_EPOCH,
  FONTS_EPOCH,
  readEngineVersion,
  computeRenderVersion,
  hashChart,
  readManifest,
  writeManifest,
  diffCharts,
} from "./incremental.mjs";

const charts = await listCharts();

if (charts.length === 0) {
  console.error("No charts found under charts/");
  process.exit(1);
}

const chartById = new Map(charts.map((c) => [c.id, c]));

// --- Incremental setup -----------------------------------------------------
const noIncremental = process.argv.includes("--no-incremental");
const ghPagesDir = process.env.GH_PAGES_DIR;
const usePrior = Boolean(ghPagesDir) && !noIncremental;

const renderVersion = computeRenderVersion({
  engineRef: readEngineVersion(),
  thumbsEpoch: THUMBS_EPOCH,
  fontsEpoch: FONTS_EPOCH,
});

// Hash every chart from its raw spec + data.csv bytes.
const currentHashes = {};
for (const { id, specPath, dir, chartSlug, collection } of charts) {
  let specBytes;
  try {
    specBytes = readFileSync(specPath);
  } catch {
    specBytes = Buffer.alloc(0);
  }
  let dataBytes;
  try {
    dataBytes = readFileSync(join(dir, "data.csv"));
  } catch {
    dataBytes = Buffer.alloc(0);
  }
  // Fold in the figure-number eyebrow (article.yaml, keyed by chart slug). It's passed at render
  // time but lives outside chart.yaml/data.csv, so renumbering must invalidate the cached page.
  const eyebrow = collection.figures?.[chartSlug];
  currentHashes[id] = hashChart({ specBytes, dataBytes, renderVersion, extra: String(eyebrow ?? "") });
}

const prior = usePrior ? readManifest(join(ghPagesDir, ".build", "manifest.json")) : null;
const { toBuild, unchanged } = diffCharts(currentHashes, prior, renderVersion);

// Partition unchanged charts into reusable (source present in gh-pages) vs. fallback-render.
const toRender = new Set(toBuild);
const toReuse = [];
for (const id of unchanged) {
  const srcHtml = join(ghPagesDir, id, "index.html");
  if (existsSync(srcHtml)) {
    toReuse.push(id);
  } else {
    // Cache drift: manifest says unchanged but the built page is gone — render it.
    toRender.add(id);
  }
}
const renderIds = charts.map((c) => c.id).filter((id) => toRender.has(id));

// Clean dist/ first so renamed/removed charts don't leave stale outputs behind
// (the site deploy assembles from dist/, so stale dirs would otherwise be published).
rmSync(join(REPO_ROOT, "dist"), { recursive: true, force: true });

console.log(
  `Building ${charts.length} chart(s): ${renderIds.length} to render, ${toReuse.length} to reuse...\n`,
);

let allPassed = true;

// --- Render worker (preserves the previous serial-loop behavior) -----------
function renderChart(id) {
  const { dir, specPath, chartSlug, collection } = chartById.get(id);
  const outDir = join(REPO_ROOT, "dist", id);
  const outFile = join(outDir, "index.html");

  mkdirSync(outDir, { recursive: true });

  // The figure-number eyebrow lives in the collection file (article.yaml / tracker.yaml), keyed
  // by chart-folder slug — an article property, not the chart spec. Pass it at render time.
  const eyebrow = collection.figures?.[chartSlug];
  const renderArgs = ["render", specPath, "-o", outFile];
  if (eyebrow) renderArgs.push("--eyebrow", eyebrow);

  const { executable, args, options } = buildTblChartCmd(renderArgs);

  return new Promise((resolve) => {
    const child = spawn(executable, args, { ...options, stdio: "pipe" });
    let stdout = "";
    let stderr = "";
    let settled = false;
    child.stdout?.on("data", (d) => { stdout += d; });
    child.stderr?.on("data", (d) => { stderr += d; });
    child.on("error", (err) => {
      stderr += String(err?.stack || err);
      finish(1);
    });
    child.on("close", (code) => finish(code ?? 1));

    function finish(status) {
      if (settled) return;
      settled = true;
      const passed = status === 0;
      const icon = passed ? "BUILT" : "FAIL";
      console.log(`[${icon}] ${id} -> dist/${id}/index.html`);
      if (stdout.trim()) console.log(stdout.trimEnd());
      if (stderr.trim()) console.error(stderr.trimEnd());

      if (passed) {
        // Make the page embed-ready: inject the iframe-resizer child script before </body>.
        try {
          const html = readFileSync(outFile, "utf8");
          if (!html.includes("iframeResizer.contentWindow")) {
            writeFileSync(
              outFile,
              html.replace("</head>", `${EMBED_HEAD}\n</head>`).replace("</body>", `${RESIZER_TAG}\n</body>`),
            );
          }
        } catch {
          // non-fatal: page still renders, just won't auto-resize when embedded
        }

        // Copy data.csv alongside the HTML
        try {
          copyFileSync(join(dir, "data.csv"), join(outDir, "data.csv"));
        } catch {
          // data.csv is optional for some chart types
        }
      } else {
        allPassed = false;
      }
      resolve(passed);
    }
  });
}

// --- Reuse: copy prior outputs from the gh-pages checkout -------------------
function reuseChart(id) {
  const outDir = join(REPO_ROOT, "dist", id);
  mkdirSync(outDir, { recursive: true });
  copyFileSync(join(ghPagesDir, id, "index.html"), join(outDir, "index.html"));
  const srcData = join(ghPagesDir, id, "data.csv");
  if (existsSync(srcData)) copyFileSync(srcData, join(outDir, "data.csv"));
  console.log(`[REUSE] ${id} -> dist/${id}/index.html`);
}

const RENDER_CONCURRENCY = Number(process.env.RENDER_CONCURRENCY) || Math.min(os.cpus().length, 4);

await runPool(renderIds, RENDER_CONCURRENCY, (id) => renderChart(id));
for (const id of toReuse) reuseChart(id);

// Write the manifest describing the full current set of charts.
writeManifest(join(REPO_ROOT, "dist", ".manifest.json"), {
  renderVersion,
  charts: Object.fromEntries(charts.map((c) => [c.id, { hash: currentHashes[c.id] }])),
});

console.log();
console.log(`build: rendered ${renderIds.length}, reused ${toReuse.length} (of ${charts.length})`);

if (!allPassed) {
  console.error("One or more charts failed to build.");
  process.exit(1);
}
