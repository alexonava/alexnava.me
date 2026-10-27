import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DIRECTED_SHOTS, resolveDirectedShot } from "../src/scene/directed-shots.js";

// The owner's accepted opener is a fixed benchmark while the other seven
// compositions change. This fixture is the preset the owner locked on 2026-10-27 (the
// Artistic set's light, the wetter ground and the wider phone frame over a9820518's),
// including the shared ground profile and every viewport override, rather than a new fit.
const approved = JSON.parse(
  readFileSync(new URL("./support/lantern-study-approved.json", import.meta.url), "utf8"),
);

test("the lantern-led tour preserves the complete approved Lantern study preset", () => {
  const shot = DIRECTED_SHOTS.tree[1];
  assert.deepEqual(shot, approved);
  for (const [width, height] of [
    [1920, 1080],
    [2560, 1080],
    [390, 844],
    [844, 390],
    [820, 1180],
    [1080, 1920],
    [700, 480],
    [568, 320],
  ]) {
    const expected =
      height > width || width / height < 1.55
        ? { ...approved, ...approved.portrait }
        : height <= 500
          ? { ...approved, ...approved.landscape }
          : approved;
    assert.deepEqual(resolveDirectedShot(shot, width, height), expected, `${width}x${height}`);
  }
});
