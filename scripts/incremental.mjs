// scripts/incremental.mjs
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { REPO_ROOT } from "./lib.mjs";

/** Bump if thumbnail rendering changes in a way that alters output. */
export const THUMBS_EPOCH = 1;
/** Bump if vendored fonts change in a way that alters rendered output. */
export const FONTS_EPOCH = 1;

export function readEngineVersion(repoRoot = REPO_ROOT) {
  try {
    const lock = JSON.parse(readFileSync(join(repoRoot, "package-lock.json"), "utf8"));
    const pkg = lock.packages?.["node_modules/budget-lab-chart-engine"];
    return pkg?.resolved ?? pkg?.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

export function computeRenderVersion({ engineRef, thumbsEpoch, fontsEpoch }) {
  return `engine:${engineRef}|thumbs:${thumbsEpoch}|fonts:${fontsEpoch}`;
}

export function hashChart({ specBytes, dataBytes, renderVersion }) {
  const h = createHash("sha256");
  h.update(renderVersion); h.update("\0");
  h.update(specBytes); h.update("\0");
  h.update(dataBytes ?? "");
  return h.digest("hex");
}

export function readManifest(path) {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; }
}

export function writeManifest(path, manifest) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(manifest, null, 2) + "\n");
}

export function diffCharts(currentHashes, prior, currentRenderVersion) {
  const rvMatch = Boolean(prior)
    && prior.renderVersion !== undefined
    && (currentRenderVersion === undefined || prior.renderVersion === currentRenderVersion);
  const priorCharts = prior?.charts ?? {};
  const toBuild = [], unchanged = [];
  for (const [id, hash] of Object.entries(currentHashes)) {
    const same = rvMatch && priorCharts[id]?.hash === hash;
    (same ? unchanged : toBuild).push(id);
  }
  const removed = Object.keys(priorCharts).filter((id) => !(id in currentHashes));
  return { toBuild, unchanged, removed };
}
