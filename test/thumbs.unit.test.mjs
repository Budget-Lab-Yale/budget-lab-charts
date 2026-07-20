import { test } from "node:test";
import assert from "node:assert/strict";
import { thumbCachePath } from "../scripts/thumbs.mjs";

test("cache path is content-addressed under .build/thumbs", () => {
  assert.equal(thumbCachePath("ai-fiscal/x", "abc"), ".build/thumbs/ai-fiscal/x/abc.png");
});
