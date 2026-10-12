import { existsSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { REPO_ROOT } from "../lib.mjs";

const norm = (p) => (process.platform === "win32" ? p.toLowerCase() : p);
function realish(p) {
  let probe = resolve(p);
  while (!existsSync(probe)) { const up = dirname(probe); if (up === probe) break; probe = up; }
  return join(realpathSync.native(probe), relative(probe, resolve(p)));
}
export function assertOutsideArchive(p, repoRoot = REPO_ROOT) {
  const rel = relative(norm(realish(join(repoRoot, "charts"))), norm(realish(p)));
  if (rel === "" || (rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel))) {
    throw new Error(`Refusing ${p}: it is inside the published archive (charts/). Slide charts live beside the deck, in "Slide charts\\".`);
  }
}
export const slideChartsDir = (deckPath) => join(dirname(resolve(deckPath)), "Slide charts");
