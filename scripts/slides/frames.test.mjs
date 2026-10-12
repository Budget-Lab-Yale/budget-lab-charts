import { test } from "node:test";
import assert from "node:assert/strict";
import { FRAMES, getFrame } from "./frames.mjs";

test("px aspect matches every placement aspect within 0.5%", () => {
  for (const [name, f] of Object.entries(FRAMES)) {
    const px = f.width / f.height;
    for (const p of f.place) {
      const pa = p.width / p.height;
      assert.ok(Math.abs(px - pa) / pa < 0.005, `${name}: ${px} vs ${pa}`);
    }
  }
});

test("getFrame throws naming the valid frames", () => {
  assert.throws(() => getFrame("nope"), (e) =>
    ["below-title", "full", "half"].every((n) => e.message.includes(n)));
  assert.equal(getFrame("full").layout, "Blank");
});
