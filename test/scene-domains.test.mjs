import assert from "node:assert/strict";
import test from "node:test";
import { Group } from "three";
import { createSceneEnvironment } from "../src/scene/environment.js";

const highProfile = {
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
  assert.equal(environment.applyQuality({ tier: "balanced" }), true);
  assert.equal(environment.dispose(), true);
  assert.equal(environment.dispose(), false);
  assert.equal(environment.root.visible, false);
  assert.equal(environment.applyQuality(highProfile), false);
  assert.equal(parent.children.includes(environment.root), true);
});
