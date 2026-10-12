import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { REPO_ROOT, buildTblChartCmd } from "../lib.mjs";

const MIN_ENGINE = "1.17.0";
const ENGINE_FIX = "git pull, then npm ci (the repo must pin v1.17.0+)";

export function compareVersions(a, b) {
  const pa = String(a).replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

const result = (name, ok, fix, detail) => ({ name, ok, ...(ok ? {} : { fix }), ...(detail ? { detail } : {}) });

export function checkNode(version) {
  const ok = parseInt(String(version).replace(/^v/, ""), 10) >= 20;
  return result("Node >= 20", ok, "install Node 20+ from nodejs.org", version);
}
export function checkEngineInstalled(present) {
  return result("budget-lab-chart-engine installed", present, "npm ci");
}
export function checkEngineVersion(version) {
  const ok = !!version && compareVersions(version, MIN_ENGINE) >= 0;
  return result(`Engine version >= ${MIN_ENGINE}`, ok, ENGINE_FIX, version ? `found ${version}` : "version unreadable");
}
// `exposed` is the runtime result of `typeof BudgetLabChart.buildExportSvg === "function"`.
export function checkBundle(exposed, error) {
  return result("Engine bundle exposes buildExportSvg", exposed === true, ENGINE_FIX, error);
}
export function checkChromium(probe) {
  return result("Playwright Chromium launches", !!probe?.ok, "npx playwright install chromium", probe?.error);
}
// `probe.faces` is the statuses of the faces `document.fonts.load("800 22px Figtree")` returned.
// An empty list means no Figtree face matched, which `document.fonts.check()` would call a pass.
export function figtreeLoaded(faces) {
  return Array.isArray(faces) && faces.length > 0 && faces.every((s) => s === "loaded");
}
export function checkFigtree(probe) {
  const ok = !!probe?.ok && figtreeLoaded(probe.faces);
  return result("Figtree loads", ok, "chart CSS failed to load Figtree — rerun npm ci", probe?.error);
}
export function checkPowerPoint(probe) {
  const ok = !!probe && probe.status === 0 && /^\s*True\s*$/i.test(probe.stdout ?? "");
  return result("PowerPoint COM registered", ok, "install desktop PowerPoint (classic)");
}
export function checkPlatform(platform) {
  return result("Platform is Windows", platform === "win32", "slide insertion needs Windows; rendering still works", platform);
}

export function formatResults(results) {
  return results
    .map((r) => {
      const head = `${r.ok ? "OK  " : "FAIL"}  ${r.name}${r.detail ? ` (${r.detail})` : ""}`;
      return r.ok ? head : `${head}\n      fix: ${r.fix}`;
    })
    .join("\n");
}
export const exitCode = (results) => (results.every((r) => r.ok) ? 0 : 1);

// ---- real probes (not used by the unit tests) ----

function readEngineVersion(repoRoot) {
  try {
    return JSON.parse(readFileSync(join(repoRoot, "node_modules", "budget-lab-chart-engine", "package.json"), "utf8")).version;
  } catch {
    return null;
  }
}

function readBundle(repoRoot) {
  const dir = mkdtempSync(join(tmpdir(), "slides-preflight-"));
  try {
    const c = buildTblChartCmd(["assets", "-o", dir, "--json"], repoRoot);
    const r = spawnSync(c.executable, c.args, { ...c.options, encoding: "utf8" });
    if (r.status !== 0) return { error: (r.stderr || r.error?.message || `exit ${r.status}`).trim() };
    const out = JSON.parse(r.stdout);
    return {
      js: readFileSync(join(dir, out.runtime), "utf8"),
      css: readFileSync(join(dir, out.styles), "utf8"),
    };
  } catch (e) {
    return { error: e.message };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const firstLine = (e) => String(e.message).split(/\r?\n/)[0];

async function probeBrowser(js, css) {
  let browser;
  try {
    const { chromium } = await import("playwright");
    browser = await chromium.launch({ args: ["--no-sandbox"] });
  } catch (e) {
    const error = firstLine(e);
    return {
      chromium: { ok: false, error },
      figtree: { ok: false, error: "Chromium unavailable" },
      bundle: { exposed: false, error: "Chromium unavailable" },
    };
  }
  const out = { chromium: { ok: true } };
  try {
    const page = await browser.newPage();
    if (css) {
      await page.setContent(`<style>${css}</style><span style="font:800 22px Figtree">Warm-up 123</span>`);
      try {
        const faces = await page.evaluate(async () => (await document.fonts.load("800 22px Figtree")).map((f) => f.status));
        out.figtree = { ok: true, faces };
      } catch (e) {
        out.figtree = { ok: false, error: firstLine(e) };
      }
    } else {
      out.figtree = { ok: false, error: "chart CSS unavailable" };
    }
    if (js) {
      try {
        await page.addScriptTag({ content: js });
        const exposed = await page.evaluate(
          () => typeof BudgetLabChart !== "undefined" && typeof BudgetLabChart.buildExportSvg === "function",
        );
        out.bundle = { exposed };
      } catch (e) {
        out.bundle = { exposed: false, error: firstLine(e) };
      }
    }
  } catch (e) {
    out.figtree ??= { ok: false, error: firstLine(e) };
  } finally {
    await browser.close();
  }
  return out;
}

function probePowerPoint() {
  if (process.platform !== "win32") return null;
  return spawnSync("powershell", ["-NoProfile", "-Command", "[bool][Type]::GetTypeFromProgID('PowerPoint.Application')"], { encoding: "utf8" });
}

export async function runPreflight(repoRoot = REPO_ROOT) {
  const installed = existsSync(join(repoRoot, "node_modules", "budget-lab-chart-engine"));
  const bundle = installed ? readBundle(repoRoot) : { error: "engine not installed" };
  const browser = await probeBrowser(bundle.js, bundle.css);
  return [
    checkNode(process.version),
    checkEngineInstalled(installed),
    checkEngineVersion(readEngineVersion(repoRoot)),
    checkBundle(browser.bundle?.exposed ?? false, bundle.error ?? browser.bundle?.error),
    checkChromium(browser.chromium),
    checkFigtree(browser.figtree),
    checkPowerPoint(probePowerPoint()),
    checkPlatform(process.platform),
  ];
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const results = await runPreflight();
  console.log(formatResults(results));
  process.exitCode = exitCode(results);
}
