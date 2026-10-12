import { readFileSync } from "node:fs";

export const FRAMES = JSON.parse(readFileSync(new URL("./frames.json", import.meta.url), "utf8"));

export function getFrame(name) {
  if (!Object.hasOwn(FRAMES, name)) {
    throw new Error(`Unknown frame "${name}". Valid frames: ${Object.keys(FRAMES).join(", ")}`);
  }
  return FRAMES[name];
}
