import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DIRECTED_SHOTS, resolveDirectedShot } from "../src/scene/directed-shots.js";
import { COAST_SHOTS } from "../src/scene/ocean.js";

// Independently captured from the owner's selected before version. Lighting,
// surface response and optical softness can evolve without changing its cameras.
const approved = JSON.parse(
  readFileSync(new URL("./support/preferred-framing-approved.json", import.meta.url), "utf8"),
);
function framingOnly(value) {
  if (Array.isArray(value)) return value.map(framingOnly);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !["light", "ground", "lens", "look", "sun", "growth"].includes(key))
      .map(([key, item]) => [key, framingOnly(item)]),
  );
}

test("all eight cameras retain the selected before framing and every viewport variant", () => {
  assert.equal(approved.source, "046ba230f9cdc273a76210a1272eb8e8417d2296");
  const shots = [...DIRECTED_SHOTS.watch, ...DIRECTED_SHOTS.tree, ...COAST_SHOTS];
  assert.equal(shots.length, 8);
  assert.deepEqual(framingOnly(shots), approved.shots);
  for (const [index, shot] of shots.entries()) {
    for (const [width, height] of [
      [1920, 1080],
      [2560, 1080],
      [1440, 900],
      [1080, 1920],
      [820, 1180],
      [390, 844],
      [844, 390],
      [700, 480],
      [568, 320],
    ]) {
      assert.deepEqual(
        resolveDirectedShot(framingOnly(shot), width, height),
        resolveDirectedShot(approved.shots[index], width, height),
        `${shot.name} ${width}x${height}`,
      );
    }
  }
});
