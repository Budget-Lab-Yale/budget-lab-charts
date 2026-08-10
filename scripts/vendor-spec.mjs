/**
 * vendor-spec.mjs — copy the pinned engine's figure-config spec into the repo.
 *
 * Writing a figure must never require opening the engine repo: an author who goes looking for the
 * field list there can easily conclude that adding a chart involves editing the engine, which it
 * never does. So the engine's CONFIG-SPEC.md is vendored here verbatim, under a banner saying which
 * engine version it came from and that it is not editable.
 *
 * Drift is what makes a vendored copy dangerous, and this repo already had it: CONFIG-REFERENCE.md
 * documented the schema by hand and went eight repins without an update, ending up 45 fields behind.
 * `npm run validate` therefore fails when this file doesn't match the installed engine, so a repin
 * that forgets to re-vendor cannot merge.
 *
 * Usage: npm run vendor-spec   (after changing the engine pin)
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { REPO_ROOT } from "./lib.mjs";
import { readEngineSemver } from "./incremental.mjs";

export const VENDORED_SPEC_PATH = join(REPO_ROOT, "ENGINE-CONFIG-SPEC.md");
const ENGINE_SPEC_PATH = join(
  REPO_ROOT,
  "node_modules",
  "budget-lab-chart-engine",
  "CONFIG-SPEC.md",
);

/** Read the pinned engine's spec. Throws with a fixable message when the engine isn't installed. */
export function readEngineSpec() {
  try {
    return readFileSync(ENGINE_SPEC_PATH, "utf8");
  } catch (err) {
    throw new Error(
      `cannot read the engine's CONFIG-SPEC.md at ${ENGINE_SPEC_PATH}\n` +
        `Run \`npm ci\` first.\n(${err.message})`,
    );
  }
}

/** The exact contents ENGINE-CONFIG-SPEC.md should have for a given engine version. */
export function buildVendoredSpec({ specText, version }) {
  const banner = [
    "<!-- AUTO-VENDORED FILE — DO NOT EDIT ----------------------------------------",
    "",
    `  Verbatim copy of CONFIG-SPEC.md from budget-lab-chart-engine v${version}, the`,
    "  engine version pinned in package.json.",
    "",
    "  It lives here so that writing a figure never requires opening the engine repo.",
    "  Editing this file is never the right move: figure fields are the engine's to",
    "  define. To change what the engine accepts, repin the engine, then run",
    "  `npm run vendor-spec` and commit the result.",
    "",
    "  `npm run validate` fails when this file drifts from the pinned engine.",
    "",
    "  For this repo's OWN config — article.yaml, tracker.yaml, figure numbering, id",
    "  rules — see CONFIG-REFERENCE.md.",
    "",
    "--------------------------------------------------------------------------- -->",
    "",
  ].join("\n");
  return `${banner}${specText}`;
}

/** Normalize line endings so a CRLF checkout doesn't read as drift. */
export function normalizeEol(text) {
  return text.replace(/\r\n/g, "\n");
}

function main() {
  const version = readEngineSemver();
  const expected = buildVendoredSpec({ specText: readEngineSpec(), version });
  writeFileSync(VENDORED_SPEC_PATH, expected, "utf8");
  console.log(
    `Vendored the engine's figure-config spec for v${version} to ENGINE-CONFIG-SPEC.md ` +
      `(${expected.split("\n").length} lines).`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
