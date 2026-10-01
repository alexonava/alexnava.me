import assert from "node:assert/strict";
import test from "node:test";
import {
  BoxGeometry,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Vector3,
  Fog,
} from "three";
import {
  chooseCinematicView,
  chooseCinematicAngle,
  cinematicSafeArea,
  createCinematicCamera,
  layoutRect,
} from "../src/scene/cinematic.js";
import { DIRECTED_SHOTS } from "../src/scene/directed-shots.js";
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
function setup(selected = "tower", width = 1440, height = 900, angle = 0) {
  const camera = new PerspectiveCamera(45, width / height, 0.1, 1000),
    fog = new Fog(0, 62, 150);
  const root = new Mesh(new BoxGeometry(20, 34, 20), new MeshBasicMaterial());
  root.position.y = 17;
  const area = cinematicSafeArea(width, height, { right: 450, bottom: 200 }, { top: height - 110 });
  const controller = createCinematicCamera({
    camera,
    fog,
    selected,
    angle,
    getSafeArea: () => area,
  });
  controller.setSubject("tower", root);
  controller.setStatus({ kind: "tower", status: "ready" });
  return {
    controller,
    camera,
    root,
    fog,
    area,
    apply: (time = 0, extra = {}) =>
      controller.apply({ width, height, elapsedSeconds: time, ...extra }),
  };
}
test("every ordinary visit opens The watch while explicit subject URLs remain valid", () => {
  const unexpectedRandom = () => {
    throw new Error("opening composition must not use RNG");
  };
  for (const query of ["", "?quality=high", "?view=unknown", "?angle=3", "?view=orbit", "?architecture=classic", "?setting=previous"])
    assert.equal(chooseCinematicView(query, unexpectedRandom), "tower");
  for (const view of ["tower", "tree"])
    assert.equal(chooseCinematicView(`?view=${view}`, unexpectedRandom), view);
});

test("camera fits all subject corners inside phone and desktop safe areas throughout the arc", () => {
  for (const [w, h] of [
    [390, 844],
    [1440, 900],
    [844, 390],
  ]) {
    const f = setup("tower", w, h);
    f.apply();
    for (const t of [0, 12, 36, 48]) {
      f.apply(t);
      f.camera.updateMatrixWorld();
      for (const x of [-10, 10])
        for (const y of [0, 34])
          for (const z of [-10, 10]) {
            const v = new Vector3(x, y, z).project(f.camera),
              px = ((v.x + 1) * w) / 2,
              py = ((1 - v.y) * h) / 2;
            assert.ok(px >= f.area.left && px <= f.area.left + f.area.width, `x ${px}`);
            assert.ok(py >= f.area.top && py <= f.area.top + f.area.height, `y ${py}`);
          }
      assert.equal(f.camera.fov, 38);
    }
  }
});
test("motion starts centered and remains fixed distance/elevation with exact four degree extremes", () => {
  const f = setup();
  f.apply(2);
  const center = f.camera.position.clone();
  const yaw = () => Math.atan2(f.camera.position.z, f.camera.position.x);
  const base = yaw(),
    distance = f.camera.position.distanceTo(f.controller.target);
  f.apply(14);
  near(yaw() - base, (4 * Math.PI) / 180);
  near(f.camera.position.y, center.y);
  near(f.camera.position.distanceTo(f.controller.target), distance);
  f.apply(38);
  near(yaw() - base, (-4 * Math.PI) / 180);
  f.apply(100, { reducedMotion: true });
  near(f.camera.position.distanceTo(center), 0);
  assert.equal(f.controller.selected, "tower");
});
test("tree waits, fails over to tower, preserves selection across loading and restores fallback", () => {
  const f = setup("tree");
  assert.equal(f.controller.ready, false);
  assert.equal(f.apply(), false);
  f.controller.setStatus({ kind: "tree", status: "fallback" });
  assert.equal(f.controller.current, "tower");
  f.apply();
  const tree = new Mesh(new BoxGeometry(15, 19.8, 15), new MeshBasicMaterial());
  tree.position.set(55.1, 10, 36.1);
  f.controller.setSubject("tree", tree);
  f.controller.setStatus({ kind: "tree", status: "ready" });
  f.apply();
  near(f.controller.target.x, 55.1);
  f.controller.setSubject("tree", null);
  f.controller.setStatus({ kind: "tree", status: "loading" });
  assert.equal(f.controller.ready, false);
  f.controller.setStatus({ kind: "tower", status: "procedural" });
  assert.equal(f.controller.current, "orbit");
  assert.equal(f.apply(), false);
  assert.equal(f.camera.fov, 45);
  assert.equal(f.fog.near, 62);
});
test("repeated disposal is safe", () => {
  const f = setup();
  f.apply();
  assert.equal(f.controller.dispose(), true);
  assert.equal(f.controller.dispose(), false);
  assert.equal(f.apply(), false);
});
test("valid angle overrides remain reproducible and missing or invalid angles select the first shot", () => {
  const unexpectedRandom = () => {
    throw new Error("opening angle must not use RNG");
  };
  for (const view of ["tower", "tree"])
    for (const angle of [1, 2, 3, 4])
      assert.equal(
        chooseCinematicAngle(`?view=${view}&angle=${angle}`, view, unexpectedRandom),
        angle - 1,
      );
  for (const view of ["tower", "tree"])
    for (const query of [
      "",
      `?view=${view}`,
      "?angle=0",
      "?angle=5",
      "?angle=2.5",
      "?angle=invalid",
    ])
      assert.equal(chooseCinematicAngle(query, view, unexpectedRandom), 0);
});

test("short landscape uses a side-by-side safe area instead of backing out below the hero", () => {
  const area = cinematicSafeArea(844, 390, { right: 330, bottom: 220 }, { top: 285 });
  assert.ok(area.left >= 330);
  assert.equal(area.top, 32);
  assert.ok(area.top + area.height < 285);
  assert.ok(area.height >= 200);
});

test("hero layout rect ignores scroll and transforms so the safe area cannot drift", () => {
  const body = { offsetLeft: 0, offsetTop: 0, offsetParent: null };
  const section = { offsetLeft: 16, offsetTop: 0, offsetParent: body };
  const hero = {
    offsetLeft: 0,
    offsetTop: 72,
    offsetWidth: 358,
    offsetHeight: 160,
    offsetParent: section,
    getBoundingClientRect() {
      throw new Error("scrolled/transformed viewport rect must not be read");
    },
  };
  const rect = layoutRect(hero);
  assert.deepEqual(rect, { left: 16, top: 72, right: 374, bottom: 232, width: 358, height: 160, x: 16, y: 72 });
  assert.equal(layoutRect(null), undefined);
  // Matches the untransformed, unscrolled viewport rect the safe area expects.
  const nav = { top: 734 };
  assert.deepEqual(cinematicSafeArea(390, 844, rect, nav), cinematicSafeArea(390, 844, { right: 374, bottom: 232 }, nav));
  assert.deepEqual(cinematicSafeArea(1440, 900, rect, nav), cinematicSafeArea(1440, 900, { right: 374, bottom: 232 }, nav));
});

test("all angle variants retain safe portrait framing at both arc limits", () => {
  for (const subject of ["tower", "tree"])
    for (const angle of DIRECTED_SHOTS[subject].keys()) {
      const f = setup(subject, 390, 844, angle);
      if (subject === "tree") {
        f.controller.setSubject("tree", f.root);
        f.controller.setStatus({ kind: "tree", status: "ready" });
      }
      f.apply(0);
      for (const time of [0, 12, 36]) {
        f.apply(time);
        f.camera.updateMatrixWorld();
        for (const x of [-10, 10])
          for (const y of [0, 34])
            for (const z of [-10, 10]) {
              const v = new Vector3(x, y, z).project(f.camera),
                px = ((v.x + 1) * 390) / 2,
                py = ((1 - v.y) * 844) / 2;
              assert.ok(px >= f.area.left && px <= f.area.left + f.area.width);
              assert.ok(py >= f.area.top && py <= f.area.top + f.area.height);
            }
      }
    }
});
