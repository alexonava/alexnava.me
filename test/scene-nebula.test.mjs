import assert from "node:assert/strict";
import test from "node:test";
import { Group, PerspectiveCamera, Vector3 } from "three";
import { createSceneAtmosphere } from "../src/scene/atmosphere.js";
import { createEstateSkyMaterial } from "../src/scene/estate-sky.js";
import { createStarfield, makeStarGeometry, STAR_COUNTS } from "../src/scene/starfield.js";
import { celestialClusterDirection, NEBULA_FRAME } from "../src/scene/celestial-field.js";

function skyMaterial() {
  return createEstateSkyMaterial({
    skyTopColor: 0x181d2d,
    skyBottomColor: 0x4f4d55,
    skyGlowColor: 0xc0895d,
    sunDirection: new Vector3(32, 28, 14).normalize(),
    sunColor: 0xdfb882,
    shellOpacity: 0.52,
  });
}

test("nebula quality and film state reach late-bound sky and stars", () => {
  const parent = new Group();
  const atmosphere = createSceneAtmosphere({ parent, profile: { tier: "high" } });
  atmosphere.applyQuality({ tier: "balanced" });
  atmosphere.setFilmTreatment(true);
  const sky = skyMaterial();
  assert.equal(sky.uniforms.uNebulaLayers.value, 0);
  atmosphere.setSkyMaterial(sky);
  const stars = createStarfield({
    parent,
    profile: { tier: "balanced" },
    nebulaLayers: sky.uniforms.uNebulaLayers,
  });
  const starUniform = stars.root.material.uniforms.uNebulaLayers;
  assert.equal(starUniform, sky.uniforms.uNebulaLayers);
  assert.equal(starUniform.value, 2);
  assert.equal(sky.uniforms.uClouds.value, 1, "the clouds stay on");
  for (const [tier, layers] of [
    ["low", 0],
    ["high", 3],
    ["balanced", 2],
    ["high", 3],
  ]) {
    atmosphere.applyQuality({ tier });
    stars.applyQuality({ tier });
    assert.equal(starUniform.value, layers);
    assert.equal(stars.root.geometry.drawRange.count, STAR_COUNTS[tier]);
    assert.equal(stars.root.material.uniforms.uCelestialTier.value, tier === "low" ? 0 : 1);
  }
  assert.equal(starUniform.value, 3);
  atmosphere.setFilmTreatment(false);
  assert.equal(starUniform.value, 0, "asset fallback and legacy treatment restore the old sky");
  atmosphere.setFilmTreatment(true);
  assert.equal(starUniform.value, 3);
  stars.dispose();
  assert.equal(starUniform.value, 3, "stars borrow rather than own the sky uniform");
  atmosphere.dispose();
  assert.equal(starUniform.value, 0);
  sky.dispose();
});

test("sky replacement and teardown clear borrowed celestial state without disposing the material", () => {
  const atmosphere = createSceneAtmosphere({ parent: new Group(), profile: { tier: "high" } });
  const first = skyMaterial(),
    second = skyMaterial();
  let freed = 0;
  first.addEventListener("dispose", () => freed++);
  second.addEventListener("dispose", () => freed++);
  atmosphere.setFilmTreatment(true);
  atmosphere.setSkyMaterial(first);
  assert.equal(first.uniforms.uNebulaLayers.value, 3);
  atmosphere.setSkyMaterial(second);
  assert.equal(first.uniforms.uNebulaLayers.value, 0);
  assert.equal(second.uniforms.uNebulaLayers.value, 3);
  atmosphere.setSkyMaterial(null);
  assert.equal(second.uniforms.uNebulaLayers.value, 0);
  atmosphere.setSkyMaterial(second);
  assert.equal(atmosphere.dispose(), true);
  assert.equal(atmosphere.dispose(), false);
  assert.equal(atmosphere.applyQuality({ tier: "balanced" }), false);
  assert.equal(atmosphere.setFilmTreatment(true), false);
  assert.equal(atmosphere.setSkyMaterial(first), false);
  assert.equal(second.uniforms.uNebulaLayers.value, 0);
  assert.equal(freed, 0);
  first.dispose();
  second.dispose();
  assert.equal(freed, 2);
});

test("cluster occupies existing distant star slots and leaves the low-quality sky intact", () => {
  const a = makeStarGeometry(),
    b = makeStarGeometry();
  const base = a.attributes.position,
    clustered = a.attributes.aCelestialPosition;
  assert.equal(base.count, STAR_COUNTS.high);
  assert.equal(clustered.count, base.count);
  assert.deepEqual(clustered.array, b.attributes.aCelestialPosition.array);
  let changed = 0,
    balancedChanged = 0;
  const center = celestialClusterDirection(0.17, -0.04);
  for (let i = 0; i < base.count; i++) {
    const original = new Vector3().fromBufferAttribute(base, i);
    const next = new Vector3().fromBufferAttribute(clustered, i);
    assert.ok(Math.abs(next.length() - 180) < 1e-4);
    if (original.distanceTo(next) > 1e-4) {
      changed++;
      if (i < STAR_COUNTS.balanced) balancedChanged++;
      assert.ok(i >= STAR_COUNTS.low, "low tier retains every original star position");
      assert.ok(
        next.normalize().angleTo(center) < 0.13,
        "cluster remains a loose, bounded sky patch",
      );
    }
  }
  assert.ok(balancedChanged >= 20 && balancedChanged < 40);
  assert.ok(changed > balancedChanged && changed < 70);
  const n = new Vector3(...NEBULA_FRAME.center),
    x = new Vector3(...NEBULA_FRAME.horizontal),
    y = new Vector3(...NEBULA_FRAME.vertical);
  assert.ok(Math.abs(n.dot(x)) < 1e-12 && Math.abs(n.dot(y)) < 1e-12 && Math.abs(x.dot(y)) < 1e-12);
  a.dispose();
  b.dispose();
});

test("celestial stars stay fixed in direction through camera translation, reduced motion and quality changes", () => {
  const parent = new Group(),
    camera = new PerspectiveCamera();
  const layers = { value: 3 };
  const stars = createStarfield({
    parent,
    camera,
    profile: { tier: "high" },
    nebulaLayers: layers,
  });
  const geometry = stars.root.geometry;
  const positions = geometry.attributes.aCelestialPosition.array.slice();
  const localStar = new Vector3().fromBufferAttribute(geometry.attributes.aCelestialPosition, 1222);
  let initialDirection;
  for (const position of [
    [8, 12, 35],
    [-14, 7, -20],
  ]) {
    camera.position.set(...position);
    camera.updateMatrixWorld(true);
    stars.update({ elapsedSeconds: 1 });
    parent.updateMatrixWorld(true);
    const ray = stars.root.localToWorld(localStar.clone()).sub(camera.position).normalize();
    if (initialDirection) assert.ok(ray.distanceTo(initialDirection) < 1e-12);
    initialDirection = ray;
  }
  stars.update({ elapsedSeconds: 2 });
  const time = stars.root.material.uniforms.uTime.value;
  stars.update({ elapsedSeconds: 8, reducedMotion: true });
  stars.applyQuality({ tier: "low" });
  assert.equal(stars.root.material.uniforms.uCelestialTier.value, 0);
  stars.applyQuality({ tier: "balanced" });
  assert.equal(stars.root.material.uniforms.uTime.value, time);
  assert.equal(stars.root.geometry, geometry);
  assert.deepEqual(geometry.attributes.aCelestialPosition.array, positions);
  assert.equal(parent.children.length, 1, "celestial treatment adds no mesh or draw object");
  let freed = 0;
  geometry.addEventListener("dispose", () => freed++);
  stars.dispose();
  stars.dispose();
  assert.equal(freed, 1);
  assert.equal(parent.children.length, 0);
  assert.equal(layers.value, 3);
});
