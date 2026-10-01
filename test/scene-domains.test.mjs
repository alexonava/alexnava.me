import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Group } from "three";
import { createSceneEnvironment } from "../src/scene/environment.js";

const highProfile = {
  isLow: false,
  lighting: {
    practicalIntensityScale: 1,
  },
  tier: "high",
};

test("environment owns composition and its disposal", () => {
  const parent = new Group();
  const environment = createSceneEnvironment({
    groundHeight: (x, z) => x + z,
    parent,
    profile: highProfile,
  });
  environment.resize({ composition: { sceneOffsetY: -6 } });
  assert.equal(environment.root.position.y, -6);
  assert.equal(environment.applyQuality({ isLow: true }), true);
  assert.equal(environment.dispose(), true);
  assert.equal(environment.dispose(), false);
  assert.equal(environment.root.visible, false);
  assert.equal(environment.applyQuality(highProfile), false);
  assert.equal(parent.children.includes(environment.root), true);
});

test("scene bootstrap wires real domain systems and no longer owns their lifecycle loops", async () => {
  const source = await readFile(new URL("../src/scene/index.js", import.meta.url), "utf8");

  for (const factory of ["createSceneEnvironment", "createSceneAtmosphere"]) {
    assert.match(source, new RegExp(`${factory}\\(`));
  }
  assert.match(source, /subsystemRegistry\.register\(environmentSystem\);/);
  assert.match(source, /subsystemRegistry\.register\(atmosphereSystem\);/);
  assert.doesNotMatch(source, /function updateDecorativeVisibility\(/);
  assert.doesNotMatch(source, /const decorativeSystems = \[\]/);
  assert.doesNotMatch(source, /arr19\.forEach\(/);
  assert.doesNotMatch(source, /arr24\.forEach\(/);
  assert.doesNotMatch(source, /arr26\.forEach\(/);
  assert.doesNotMatch(source, /touchFrameStride/);
});
