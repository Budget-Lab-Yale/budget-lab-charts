/**
 * build-all.mjs — render every chart to dist/<id>/index.html and copy data.csv.
 *
 * Output: dist/<collection>/<chart>/index.html
 *         dist/<collection>/<chart>/data.csv
 * (<id> = <collection.slug>/<chart-folder-name>; dateless and tree-independent.)
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, copyFileSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// iframe-resizer child script — injected into every rendered page so the chart auto-reports its
// height when embedded via embed/v1/embed.js. Chart ids are 2 segments (<collection>/<chart>), so
// the page sits 2 levels deep and ../../embed/v1/ resolves to the Pages-root embed dir. The script
// self-detects iframe context; on the standalone/gallery view it is a no-op.
const RESIZER_TAG = '<script src="../../embed/v1/iframeResizer.contentWindow.min.js"></script>';

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

const charts = await listCharts();

if (charts.length === 0) {
  console.error("No charts found under charts/");
  process.exit(1);
}

// Clean dist/ first so renamed/removed charts don't leave stale outputs behind
// (the site deploy assembles from dist/, so stale dirs would otherwise be published).
rmSync(join(REPO_ROOT, "dist"), { recursive: true, force: true });

console.log(`Building ${charts.length} chart(s)...\n`);

let allPassed = true;

for (const { dir, specPath, id, chartSlug, collection } of charts) {
  const outDir = join(REPO_ROOT, "dist", id);
  const outFile = join(outDir, "index.html");

  mkdirSync(outDir, { recursive: true });

  // The figure-number eyebrow lives in the collection file (article.yaml / tracker.yaml), keyed
  // by chart-folder slug — an article property, not the chart spec. Pass it at render time.
  const eyebrow = collection.figures?.[chartSlug];
  const renderArgs = ["render", specPath, "-o", outFile];
  if (eyebrow) renderArgs.push("--eyebrow", eyebrow);

  const { executable, args, options } = buildTblChartCmd(renderArgs);
  const result = spawnSync(executable, args, {
    ...options,
    stdio: "pipe",
    encoding: "utf-8",
  });

  const passed = result.status === 0;
  const icon = passed ? "BUILT" : "FAIL";
  console.log(`[${icon}] ${id} -> dist/${id}/index.html`);

  if (result.stdout?.trim()) {
    console.log(result.stdout.trimEnd());
  }
  if (result.stderr?.trim()) {
    console.error(result.stderr.trimEnd());
  }

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
    const srcData = join(dir, "data.csv");
    const dstData = join(outDir, "data.csv");
    try {
      copyFileSync(srcData, dstData);
    } catch {
      // data.csv is optional for some chart types
    }
  } else {
    allPassed = false;
  }
}

console.log();
if (allPassed) {
  console.log(`All ${charts.length} chart(s) built successfully.`);
} else {
  console.error("One or more charts failed to build.");
  process.exit(1);
}
