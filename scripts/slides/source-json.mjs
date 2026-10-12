import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const file = (dir) => join(dir, "source.json");

export function readSource(dir) {
  const p = file(dir);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf-8"));
}

export function writeSource(dir, patch) {
  const next = { ...(readSource(dir) ?? {}), ...patch };
  writeFileSync(file(dir), JSON.stringify(next, null, 2) + "\n", "utf-8");
  return next;
}
