// Copy an archived figure's spec (and local data file) from origin/main into a working folder.
// Read-only against git: fetch + rev-parse + show. Never writes under charts/.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { REPO_ROOT } from "../lib.mjs";
import { assertOutsideArchive } from "./paths.mjs";

const git = (args, opts = {}) =>
  execFileSync("git", ["-C", REPO_ROOT, ...args], { encoding: "buffer", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"], ...opts });
const gitText = (args) => git(args).toString("utf-8");

function exists(rev) {
  try { git(["cat-file", "-e", rev]); return true; } catch { return false; }
}

export function resolveRef(input) {
  const ref = input.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "").replace(/^charts\//, "");
  if (exists(`origin/main:charts/${ref}/chart.yaml`)) return { ref, kind: "chart" };
  if (exists(`origin/main:charts/${ref}/table.yaml`)) return { ref, kind: "table" };
  const files = gitText(["ls-tree", "-r", "-z", "--name-only", "origin/main", "charts"]).split("\0");
  const hits = [];
  for (const f of files) {
    const m = f.match(/^charts\/(.+)\/(chart|table)\.yaml$/);
    if (m && (`/${m[1]}`).endsWith(`/${ref}`)) hits.push({ ref: m[1], kind: m[2] });
  }
  if (hits.length === 0) throw new Error(`No figure matches "${input}" on origin/main.`);
  if (hits.length > 1) throw new Error(`"${input}" is ambiguous; matches:\n  ${hits.map((h) => h.ref).join("\n  ")}`);
  return hits[0];
}

// A string or { file } names a local file; a URL string or any other object is left for loadData.
export function localDataFile(data) {
  const name = typeof data === "string" ? data
    : (data && typeof data === "object" && typeof data.file === "string" ? data.file : null);
  if (name === null || /^[a-z][a-z0-9+.-]*:\/\//i.test(name)) return null;
  if (name === "" || name === "." || name === ".." || /[\\/]/.test(name)) {
    throw new Error(`Unsupported data path "${name}": only a bare filename in the figure's folder is allowed.`);
  }
  return name;
}

// Validate the spec's data reference and read every blob before creating the folder or writing anything.
// source.json is written fresh, not merged (writeSource merges): a fetch into a folder that held a
// capture or an earlier render must not inherit its url/selections or alt_text/frame. The folder's
// earlier <name>.png/.svg were rendered from what this replaces, so they are removed.
export function writeFigure(to, specText, readData, source, repoRoot = REPO_ROOT) {
  const spec = parse(specText.toString("utf-8"));
  const dataName = localDataFile(spec?.data);
  const targets = [["chart.yaml", specText]];
  if (dataName) targets.push([dataName, readData(dataName)]);
  targets.push(["source.json", JSON.stringify(source, null, 2) + "\n"]);
  const dir = resolve(to);
  const renders = ["png", "svg"].map((ext) => `${basename(dir)}.${ext}`);
  for (const name of [...targets.map(([n]) => n), ...renders]) assertOutsideArchive(join(dir, name), repoRoot);
  const removed = renders.filter((name) => existsSync(join(dir, name)));
  for (const name of removed) rmSync(join(dir, name), { force: true });
  mkdirSync(dir, { recursive: true });
  for (const [name, bytes] of targets) writeFileSync(join(dir, name), bytes);
  return { dir, removed };
}

export function fetchArchived(input, to, repoRoot = REPO_ROOT) {
  assertOutsideArchive(to, repoRoot);
  git(["fetch", "origin", "main", "--quiet"]);
  const commit = gitText(["rev-parse", "origin/main"]).trim();
  const { ref, kind } = resolveRef(input);
  if (kind === "table") throw new Error(`${ref} is a table figure; tables are not supported as slide charts.`);
  const specText = git(["show", `origin/main:charts/${ref}/chart.yaml`]);
  const { dir, removed } = writeFigure(to, specText, (name) => git(["show", `origin/main:charts/${ref}/${name}`]), { origin: "archived", ref, commit }, repoRoot);
  return { dir, ref, commit, removed };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const i = args.indexOf("--to");
  const to = i >= 0 ? args[i + 1] : undefined;
  const input = args.find((a, j) => j !== i && j !== i + 1);
  if (!input || !to) { console.error("Usage: node scripts/slides/fetch-archived.mjs <slug>/<figure> (or <collection-path>/<figure>) --to <working folder>"); process.exit(2); }
  try {
    const r = fetchArchived(input, to);
    if (r.removed.length) console.error(`Removed the earlier ${r.removed.join(" and ")} (rendered from what this fetch replaced); re-render with render-slide.mjs.`);
    console.log(`Fetched ${r.ref} @ ${r.commit.slice(0, 7)} -> ${r.dir}`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
