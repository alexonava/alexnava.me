import assert from "node:assert/strict";
import test from "node:test";
import { Group, PerspectiveCamera, Vector3 } from "three";
import {
  createSolarBody,
  createCelestialClock,
  makeLoopGeometry,
  SOLAR_RADIUS,
  SOLAR_QUALITY,
} from "../src/scene/solar-body.js";
import { createStarfield, makeStarGeometry, STAR_COUNTS } from "../src/scene/starfield.js";

test("solar clock freezes for reduced motion and resumes without a time jump", () => {
  const clock = createCelestialClock();
  assert.equal(clock.tick(3), 0);
  assert.equal(clock.tick(4), 1);
  assert.equal(clock.tick(6, true), 1);
  assert.equal(clock.tick(16, true), 1);
  assert.equal(clock.tick(20, false), 1);
  assert.equal(clock.tick(21), 2);
  assert.equal(clock.tick(19), 2);
  assert.equal(clock.tick(NaN), 2);
});
test("solar loops have two rooted feet and bounded heights with deterministic geometry", () => {
  const a = makeLoopGeometry(),
    b = makeLoopGeometry(),
    p = a.attributes.position;
  assert.deepEqual(p.array, b.attributes.position.array);
  for (let loop = 0; loop < SOLAR_QUALITY.high.loops; loop++) {
    for (const vertex of [loop * 114, loop * 114 + 112]) {
      const length = new Vector3().fromBufferAttribute(p, vertex).length();
      assert.ok(Math.abs(length - SOLAR_RADIUS) < 1e-5);
    }
  }
  for (let i = 0; i < p.count; i++) {
    const length = new Vector3().fromBufferAttribute(p, i).length();
    assert.ok(length >= SOLAR_RADIUS - 1e-5 && length < SOLAR_RADIUS * 1.34);
  }
  a.dispose();
  b.dispose();
});
test("solar tiers, pixel ratio, motion, and resource ownership survive repeated transitions", () => {
  const parent = new Group(),
    camera = new PerspectiveCamera();
  camera.position.set(0, 2, 20);
  camera.lookAt(0, 0, 0);
  const controller = createSolarBody({
    parent,
    camera,
    position: new Vector3(-85, 55, -29),
    profile: { tier: "high" },
  });
  const objects = [];
  controller.root.traverse((o) => {
    if (o.isMesh) objects.push(o);
  });
  const loops = objects.find((o) => o.name === "solar-prominences"),
    surface = objects.find((o) => o.name === "solar-photosphere");
  assert.equal(objects.length, 3);
  assert.equal(loops.material.forceSinglePass, true);
  assert.deepEqual(controller.root.position.toArray(), [-85, 55, -29]);
  assert.equal(surface.geometry.parameters.radius, SOLAR_RADIUS);
  assert.equal(surface.material.depthWrite, true);
  assert.ok(objects.every((o) => o.material.depthTest && !o.castShadow));
  controller.resize({ width: 1000, height: 600 });
  for (const tier of ["low", "high", "balanced", "low", "high"]) {
    controller.applyQuality({ tier }, { pixelRatio: 1.5 });
    assert.equal(loops.geometry.drawRange.count, SOLAR_QUALITY[tier].loops * 56 * 6);
    assert.equal(loops.visible, tier !== "low");
    // Prominence width stays in CSS pixels, as reviewed at DPR 1.
    assert.deepEqual(loops.material.uniforms.uResolution.value.toArray(), [1000, 600]);
  }
  controller.update({ elapsedSeconds: 0 });
  controller.update({ elapsedSeconds: 4 });
  const rotation = surface.parent.rotation.y;
  controller.update({ elapsedSeconds: 8, reducedMotion: true });
  assert.equal(surface.parent.rotation.y, rotation);
  const resources = objects.flatMap((o) => [o.geometry, o.material]),
    counts = resources.map(() => 0);
  resources.forEach((r, i) => r.addEventListener("dispose", () => counts[i]++));
  assert.equal(controller.dispose(), true);
  assert.equal(controller.dispose(), false);
  assert.equal(parent.children.length, 0);
  assert.ok(counts.every((n) => n === 1));
  assert.equal(controller.applyQuality({ tier: "high" }), false);
  assert.equal(controller.update({ elapsedSeconds: 20 }), false);
});
test("seeded stars preserve positions between tiers and remain distant while camera moves", () => {
  const a = makeStarGeometry(),
    b = makeStarGeometry(),
    c = makeStarGeometry(3);
  assert.deepEqual(a.attributes.position.array, b.attributes.position.array);
  assert.notDeepEqual(a.attributes.position.array, c.attributes.position.array);
  let faint = 0;
  for (let i = 0; i < a.attributes.aSize.count; i++) if (a.attributes.aSize.getX(i) < 1.8) faint++;
  assert.ok(faint > STAR_COUNTS.high * 0.75);
  const parent = new Group(),
    camera = new PerspectiveCamera();
  parent.position.y = -7;
  const controller = createStarfield({ parent, camera, profile: { tier: "high" } });
  camera.position.set(9, 15, 20);
  parent.updateMatrixWorld(true);
  controller.update({ elapsedSeconds: 0 });
  assert.ok(controller.root.getWorldPosition(new Vector3()).distanceTo(camera.position) < 1e-8);
  const positions = controller.root.geometry.attributes.position.array;
  controller.applyQuality({ tier: "low" }, { pixelRatio: 2 });
  assert.equal(controller.root.geometry.drawRange.count, STAR_COUNTS.low);
  assert.equal(controller.root.material.uniforms.uPixelRatio.value, 2);
  controller.applyQuality({ tier: "balanced" });
  assert.equal(controller.root.geometry.attributes.position.array, positions);
  assert.equal(controller.root.geometry.drawRange.count, STAR_COUNTS.balanced);
  assert.equal(controller.root.material.depthTest, true);
  assert.equal(controller.root.material.depthWrite, false);
  let disposed = 0;
  controller.root.material.addEventListener("dispose", () => disposed++);
  controller.dispose();
  controller.dispose();
  assert.equal(disposed, 1);
  assert.equal(parent.children.length, 0);
  [a, b, c].forEach((g) => g.dispose());
});

test("solar prominence loops run along the meridian, so side-limb loops rise as arches", () => {
  const geometry = makeLoopGeometry(),
    position = geometry.attributes.position,
    perLoop = (56 + 1) * 2;
  for (let loop = 0; loop < SOLAR_QUALITY.high.loops; loop++) {
    // The loop's feet: its first and last centreline samples on the photosphere.
    const a = new Vector3().fromBufferAttribute(position, loop * perLoop),
      b = new Vector3().fromBufferAttribute(position, loop * perLoop + perLoop - 2);
    const chord = b.clone().sub(a).normalize(),
      eastWest = new Vector3(0, 1, 0).cross(a.clone().add(b).normalize()).normalize();
    // East-west loops lie in the view ray's plane at the side limbs and read
    // as flat radial handles.
    assert.ok(Math.abs(chord.dot(eastWest)) < 0.1, `loop ${loop} runs east-west`);
  }
  geometry.dispose();
});
