import assert from "node:assert/strict";
import test from "node:test";
import {
  BoxGeometry,
  Fog,
  Group,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Vector3,
} from "three";
import { cinematicSafeArea, createCinematicCamera } from "../src/scene/cinematic.js";

const ground = (x, z) =>
  1.8 * Math.sin(0.055 * x) +
  1.35 * Math.cos(0.052 * z) +
  0.9 * Math.sin(0.031 * (x + z)) +
  0.55 * Math.cos(0.018 * (x - z)) -
  6.8;

// A tower and tree on the test terrain, with the fit's heavy steps counted:
// measuring computes bounding boxes and the clearance loop samples the ground.
function setup(width, height) {
  const camera = new PerspectiveCamera(38, width / height, 0.1, 450),
    fog = new Fog(0, 62, 150),
    material = new MeshStandardMaterial(),
    counts = { boxes: 0, ground: 0 },
    hero = { right: 340, bottom: 253 },
    meshes = [];
  const subject = (size, name, x, z) => {
    const root = new Group(),
      geometry = new BoxGeometry(...size),
      mesh = new Mesh(geometry, material);
    const compute = geometry.computeBoundingBox;
    geometry.computeBoundingBox = function () {
      counts.boxes += 1;
      return compute.call(this);
    };
    mesh.name = name;
    mesh.position.y = size[1] / 2;
    root.position.set(x, ground(x, z), z);
    root.add(mesh);
    meshes.push(mesh);
    return root;
  };
  const tower = subject([14, 34, 12], "tower", 0, 0),
    tree = subject([4, 20, 4], "meshy-tree", 55.1, 36.1);
  const controller = createCinematicCamera({
    camera,
    fog,
    selected: "tower",
    angle: 0,
    getSafeArea: (w, h) =>
      cinematicSafeArea(w, h, w < 600 || h > w ? hero : { right: w * 0.33, bottom: 220 }, {
        top: h - 110,
      }),
    getGroundY(x, z) {
      counts.ground += 1;
      return ground(x, z);
    },
  });
  for (const [kind, root] of [
    ["tower", tower],
    ["tree", tree],
  ]) {
    controller.setSubject(kind, root);
    controller.setStatus({ kind, status: "ready" });
  }
  return {
    camera,
    controller,
    counts,
    fog,
    hero,
    apply: (w, h, tourPhase = 0.3) =>
      controller.apply({ width: w, height: h, elapsedSeconds: 1, tourPhase }),
    // Pixel row of the target and pixels per world unit of height there.
    projected(w, h) {
      camera.updateMatrixWorld(true);
      const row = (point) => ((1 - point.clone().project(camera).y) * h) / 2;
      const target = controller.target;
      const above = target.clone().add(new Vector3(0, 1, 0));
      return { y: row(target), scale: row(target) - row(above) };
    },
    dispose() {
      controller.dispose();
      meshes.forEach((mesh) => mesh.geometry.dispose());
      material.dispose();
    },
  };
}

test("prepare measures, then fits, a shot ahead of its cut without touching the camera", () => {
  const f = setup(1440, 900);
  assert.equal(f.apply(1440, 900), true);
  const pose = [
    f.camera.position.toArray(),
    f.camera.fov,
    [...f.camera.projectionMatrix.elements],
    f.fog.near,
    f.fog.far,
  ];
  const frame = f.controller.frame,
    counts = { ...f.counts };
  assert.equal(f.controller.prepare("tower", 1, 1440, 900), "pending");
  assert.ok(f.counts.boxes > counts.boxes, "the first step measures");
  assert.equal(f.counts.ground, counts.ground, "and does not fit yet");
  assert.equal(f.controller.prepare("tower", 1, 1440, 900), "ready");
  assert.ok(f.counts.ground > counts.ground, "the second step fits");
  const prepared = { ...f.counts };
  assert.equal(f.controller.prepare("tower", 1, 1440, 900), "ready");
  assert.deepEqual(f.counts, prepared, "a prepared shot is cached");
  assert.deepEqual(
    [
      f.camera.position.toArray(),
      f.camera.fov,
      [...f.camera.projectionMatrix.elements],
      f.fog.near,
      f.fog.far,
    ],
    pose,
  );
  assert.equal(f.controller.frame, frame, "the fit in use is untouched");
  assert.equal(f.controller.shot.name, "The watch");

  assert.equal(f.controller.setPreviewShot("tower", 1), true);
  assert.equal(f.apply(1440, 900, 0.01), true);
  assert.equal(f.controller.shot.name, "Threshold");
  assert.deepEqual(f.counts, prepared, "the cut does no measuring or fitting");
  f.dispose();
});

test("prepare reports unavailable subjects, invalid angles and disposed controllers", () => {
  const f = setup(390, 844);
  f.controller.setStatus({ kind: "tree", status: "loading" });
  assert.equal(f.controller.prepare("tree", 0, 390, 844), "unavailable");
  assert.equal(f.controller.prepare("tower", 9, 390, 844), "unavailable");
  assert.equal(f.controller.prepare("orbit", 0, 390, 844), "unavailable");
  assert.equal(f.controller.prepare("tower", 3, 390, 844), "pending");
  f.controller.dispose();
  assert.equal(f.controller.prepare("tower", 3, 390, 844), "unavailable");
  f.dispose();
});

test("an address-bar resize keeps a tour shot's fit as a top-anchored crop until the next cut", () => {
  const f = setup(390, 844);
  f.apply(390, 844);
  const locked = f.controller.frame,
    shot = f.controller.shot,
    before = f.projected(390, 844);
  assert.equal(f.camera.fov, shot.fov);

  // The address bar shows: same width, 80px shorter, same hero.
  f.apply(390, 764);
  assert.equal(f.controller.frame, locked, "the fit is kept");
  const after = f.projected(390, 764);
  assert.ok(Math.abs(after.y - before.y) < 0.5, `target row ${before.y} -> ${after.y}`);
  assert.ok(Math.abs(after.scale - before.scale) < 0.5, `scale ${before.scale} -> ${after.scale}`);
  const tan = Math.tan((shot.fov * Math.PI) / 360);
  assert.ok(Math.abs(f.camera.fov - (360 / Math.PI) * Math.atan((tan * 764) / 844)) < 1e-9);
  f.apply(390, 844);
  assert.equal(f.controller.frame, locked);
  assert.equal(f.camera.fov, shot.fov, "an unchanged view keeps the exact shot fov");

  // The next cut, even to the same shot, fits the current viewport afresh.
  f.apply(390, 764);
  assert.equal(f.controller.setPreviewShot("tower", 0), true);
  f.apply(390, 764);
  const fresh = setup(390, 764);
  fresh.apply(390, 764);
  assert.notEqual(f.controller.frame, locked);
  assert.deepEqual(f.controller.frame, fresh.controller.frame);
  assert.equal(f.camera.fov, shot.fov);
  fresh.dispose();
  f.dispose();
});

test("large height changes, rotation, a moved hero and still framing refit at once", () => {
  const refits = (resize) => {
    const f = setup(390, 844);
    f.apply(390, 844);
    const locked = f.controller.frame;
    const [w, h, tourPhase] = resize(f);
    f.apply(w, h, tourPhase);
    const refit = f.controller.frame !== locked && f.camera.fov === f.controller.shot.fov;
    f.dispose();
    return refit;
  };
  for (const [label, resize, expected] of [
    ["a small height change during a tour", () => [390, 764], false],
    ["a height change over 20%", () => [390, 600], true],
    ["a height change that would push the subject off the canvas", () => [390, 692], true],
    ["a rotation", () => [844, 390], true],
    ["a width change", () => [392, 844], true],
    ["a font load that moves the hero", (f) => ((f.hero.bottom = 300), [390, 844]), true],
    ["a height change without a tour", () => [390, 764, null], true],
  ])
    assert.equal(refits(resize), expected, label);

  // A loosely framed shot stays on the canvas, so the 20% share alone decides.
  const lantern = setup(390, 844);
  assert.equal(lantern.controller.setPreviewShot("tree", 1), true);
  lantern.apply(390, 844);
  const kept = lantern.controller.frame;
  assert.equal(lantern.controller.shot.name, "Lantern study");
  lantern.apply(390, 676);
  assert.equal(lantern.controller.frame, kept, "a 19.9% drop keeps the fit");
  lantern.apply(390, 844);
  lantern.apply(390, 666);
  assert.notEqual(lantern.controller.frame, kept, "a 21% drop refits");
  lantern.dispose();
});
