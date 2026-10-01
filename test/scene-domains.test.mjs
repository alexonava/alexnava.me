import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Group } from "three";
import { createSceneAtmosphere } from "../src/scene/atmosphere.js";
import { createSceneEnvironment } from "../src/scene/environment.js";
import { createSceneTower } from "../src/scene/tower.js";

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

test("tower owns its composition scale", () => {
  const parent = new Group();
  const tower = createSceneTower({ parent });
  tower.resize({ composition: { towerScale: 0.92 } });
  assert.equal(tower.root.scale.x, 0.92);
  assert.equal(tower.dispose(), true);
  assert.equal(tower.dispose(), false);
  assert.equal(tower.root.visible, false);
  assert.equal(tower.resize({ composition: { towerScale: 1 } }), false);
  assert.equal(parent.children.includes(tower.root), true);
});

test("atmosphere owns the sky clock, cloud controls and its disposal", () => {
  const parent = new Group();
  const calls = [];
  const atmosphere = createSceneAtmosphere({
    onInvalidate() {
      calls.push("invalidate");
    },
    parent,
    profile: highProfile,
  });
  const sky = {
    uniforms: { uClouds: { value: 1 }, uTime: { value: 0 }, uNebulaLayers: { value: 0 } },
  };
  atmosphere.setSkyMaterial(sky);

  atmosphere.update({ elapsedSeconds: 10 });
  assert.equal(sky.uniforms.uTime.value, 10);
  atmosphere.update({ elapsedSeconds: 20, reducedMotion: true });
  assert.equal(sky.uniforms.uTime.value, 10, "reduced motion holds the sky");

  assert.equal(atmosphere.setClouds(false), false);
  assert.equal(sky.uniforms.uClouds.value, 0);
  assert.equal(atmosphere.toggleClouds(), true);
  assert.equal(sky.uniforms.uClouds.value, 1);
  assert.deepEqual(calls, ["invalidate", "invalidate"]);

  atmosphere.dispose();
  assert.equal(atmosphere.root.visible, false);
  assert.equal(parent.children.includes(atmosphere.root), true);
  assert.equal(atmosphere.update({ elapsedSeconds: 30 }), false);
});

test("scene bootstrap wires real domain systems and no longer owns their lifecycle loops", async () => {
  const source = await readFile(new URL("../src/scene/index.js", import.meta.url), "utf8");

  for (const factory of ["createSceneEnvironment", "createSceneTower", "createSceneAtmosphere"]) {
    assert.match(source, new RegExp(`${factory}\\(`));
  }
  assert.match(source, /subsystemRegistry\.register\(environmentSystem\);/);
  assert.match(source, /subsystemRegistry\.register\(towerSystem\);/);
  assert.match(source, /subsystemRegistry\.register\(atmosphereSystem\);/);
  assert.doesNotMatch(source, /function updateDecorativeVisibility\(/);
  assert.doesNotMatch(source, /const decorativeSystems = \[\]/);
  assert.doesNotMatch(source, /arr19\.forEach\(/);
  assert.doesNotMatch(source, /arr24\.forEach\(/);
  assert.doesNotMatch(source, /arr26\.forEach\(/);
  assert.doesNotMatch(source, /touchFrameStride/);
});
