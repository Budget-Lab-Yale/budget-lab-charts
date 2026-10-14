import { existsSync, lstatSync, readlinkSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { REPO_ROOT } from "../lib.mjs";

const norm = (p) => (process.platform === "win32" ? p.toLowerCase() : p);
// Where a path that may not exist yet really lands: its deepest existing ancestor through realpath,
// plus the rest. A dangling symlink or junction on the way does not "exist", but a write through it
// creates its target, so it is followed to that target rather than read as a plain missing name.
function realish(p, depth = 0) {
  if (depth > 40) throw new Error(`Refusing ${p}: too many levels of symbolic links.`);
  const full = resolve(p);
  let probe = full;
  while (!existsSync(probe)) {
    let link = false;
    try { link = lstatSync(probe).isSymbolicLink(); } catch { /* missing: keep walking up */ }
    if (link) {
      const target = resolve(realish(dirname(probe), depth + 1), readlinkSync(probe));
      return realish(join(target, relative(probe, full)), depth + 1);
    }
    const up = dirname(probe); if (up === probe) break; probe = up;
  }
  return join(realpathSync.native(probe), relative(probe, full));
}
export function assertOutsideArchive(p, repoRoot = REPO_ROOT) {
  const rel = relative(norm(realish(join(repoRoot, "charts"))), norm(realish(p)));
  if (rel === "" || (rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel))) {
    throw new Error(`Refusing ${p}: it is inside the published archive (charts/). Slide charts live beside the deck, in "Slide charts\\".`);
  }
}
export const slideChartsDir = (deckPath) => join(dirname(resolve(deckPath)), "Slide charts");
