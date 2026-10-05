import assert from "node:assert/strict";
import test from "node:test";
import {
  BoxGeometry,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Fog,
  Group,
  MeshStandardMaterial,
  Vector3,
} from "three";
import {
  chooseCinematicView,
  chooseCinematicAngle,
  cinematicSafeArea,
  createCinematicCamera,
  isStackedLayout,
  layoutRect,
  PUSH_IN,
} from "../src/scene/cinematic.js";
import { DIRECTED_SHOTS, measureShot, resolveDirectedShot } from "../src/scene/directed-shots.js";
import { createCameraTour } from "../src/scene/camera-tour.js";

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
  for (const query of [
    "",
    "?quality=high",
    "?view=unknown",
    "?angle=3",
    "?view=orbit",
    "?architecture=classic",
    "?setting=previous",
  ])
    assert.equal(chooseCinematicView(query, unexpectedRandom), "tower");
  for (const view of ["tower", "tree"])
    assert.equal(chooseCinematicView(`?view=${view}`, unexpectedRandom), view);
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
  // The tower has five angles (Watch and tree is ?angle=5), the tree four.
  const counts = { tower: 5, tree: 4 };
  for (const [view, count] of Object.entries(counts)) {
    assert.equal(DIRECTED_SHOTS[view].length, count);
    for (let angle = 1; angle <= count; angle++)
      assert.equal(
        chooseCinematicAngle(`?view=${view}&angle=${angle}`, view, unexpectedRandom),
        angle - 1,
      );
  }
  for (const [view, count] of Object.entries(counts))
    for (const query of [
      "",
      `?view=${view}`,
      "?angle=0",
      `?angle=${count + 1}`,
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
  // A landscape phone under 600px wide keeps its name top-left beside the subject.
  // Its hero box (measured after the fonts load) is wider than the intro's
  // glyphs; the 0.48w cap binds, still clear of the box.
  const small = cinematicSafeArea(568, 320, { right: 253, bottom: 138 }, { top: 246 });
  assert.equal(small.top, 32);
  assert.equal(small.left, 568 * 0.48);
  assert.ok(small.left >= 253 + 16);
  assert.ok(small.top + small.height <= 246 - 28);
  assert.ok(small.height >= 180);
});

test("the stacked layout follows the page's hero breakpoints", () => {
  // styles.css tops the hero on portrait screens up to 1024px wide and landscape
  // ones up to 760px wide or 500px tall; the landscape ones up to 500px tall or
  // from 600px wide frame the subject beside it. Elsewhere it sits bottom-left.
  for (const [width, height] of [
    [390, 844],
    [450, 800],
    [375, 667],
    [768, 1024],
    [1024, 1366],
    [599, 520],
    [450, 450],
    [800, 800],
  ])
    assert.equal(isStackedLayout(width, height), true, `${width}x${height}`);
  for (const [width, height] of [
    [844, 390],
    [667, 375],
    [568, 320],
    [599, 500],
    [1024, 768],
    [1440, 900],
    [1600, 900],
    [2560, 1080],
    [1080, 1920],
    [1025, 1366],
    [1200, 1200],
  ])
    assert.equal(isStackedLayout(width, height), false, `${width}x${height}`);
  // Only narrow short landscapes, portrait monitors and mid-sized squares
  // changed from the former rule (under 600px wide or taller than wide).
  for (let width = 300; width <= 2600; width += 23)
    for (let height = 280; height <= 2600; height += 29)
      for (const [w, h] of [
        [width, height],
        [width, width],
      ]) {
        const former = w < 600 || h > w;
        const moved =
          (h < w && w < 600 && h <= 500) ||
          (h > w && w > 1024) ||
          (h === w && w >= 600 && w <= 1024);
        assert.equal(isStackedLayout(w, h), moved ? !former : former, `${w}x${h}`);
      }
});

test("a portrait monitor frames the subject above its bottom-left name, across the width", () => {
  const hero = { left: 16, right: 283, top: 1496, bottom: 1726 },
    nav = { top: 1838 };
  assert.deepEqual(cinematicSafeArea(1080, 1920, hero, nav), {
    left: 20,
    top: 32,
    width: 1036,
    height: 1440,
  });
  // The bottom bar still bounds it when the hero is missing.
  assert.equal(cinematicSafeArea(1080, 1920, undefined, nav).height, 1810 - 32);
  // Reference layouts keep their areas.
  assert.deepEqual(cinematicSafeArea(390, 844, { right: 299, bottom: 177 }, { top: 738 }), {
    left: 20,
    top: 201,
    width: 346,
    height: 509,
  });
  assert.deepEqual(cinematicSafeArea(1600, 900, { right: 527, bottom: 720 }, { top: 818 }), {
    left: 563,
    top: 32,
    width: 1013,
    height: 758,
  });
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
  assert.deepEqual(rect, {
    left: 16,
    top: 72,
    right: 374,
    bottom: 232,
    width: 358,
    height: 160,
    x: 16,
    y: 72,
  });
  assert.equal(layoutRect(null), undefined);
  // Matches the untransformed, unscrolled viewport rect the safe area expects.
  const nav = { top: 734 };
  assert.deepEqual(
    cinematicSafeArea(390, 844, rect, nav),
    cinematicSafeArea(390, 844, { right: 374, bottom: 232 }, nav),
  );
  assert.deepEqual(
    cinematicSafeArea(1440, 900, rect, nav),
    cinematicSafeArea(1440, 900, { right: 374, bottom: 232 }, nav),
  );
});

const ground = (x, z) =>
  1.8 * Math.sin(0.055 * x) +
  1.35 * Math.cos(0.052 * z) +
  0.9 * Math.sin(0.031 * (x + z)) +
  0.55 * Math.cos(0.018 * (x - z)) -
  6.8;

// A tower and tree on the test terrain, with the fit's heavy steps counted:
// measuring computes bounding boxes and the clearance loop samples the ground.
function terrainSetup(width, height) {
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
      cinematicSafeArea(w, h, isStackedLayout(w, h) ? hero : { right: w * 0.33, bottom: 220 }, {
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
  const f = terrainSetup(1440, 900);
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
  const f = terrainSetup(390, 844);
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
  const f = terrainSetup(390, 844);
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
  const fresh = terrainSetup(390, 764);
  fresh.apply(390, 764);
  assert.notEqual(f.controller.frame, locked);
  assert.deepEqual(f.controller.frame, fresh.controller.frame);
  assert.equal(f.camera.fov, shot.fov);
  fresh.dispose();
  f.dispose();
});

test("large height changes, rotation, a moved hero and still framing refit at once", () => {
  const refits = (resize) => {
    const f = terrainSetup(390, 844);
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
  const lantern = terrainSetup(390, 844);
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

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-5, `${a} != ${b}`);

test("directed framing clips actual geometry and includes the entire lantern", () => {
  const root = new Group();
  const trunk = new Mesh(new BoxGeometry(5, 20, 5), new MeshStandardMaterial());
  trunk.name = "meshy-tree";
  trunk.position.y = 10;
  const lantern = new Mesh(new BoxGeometry(1, 4, 1), new MeshStandardMaterial());
  lantern.name = "tree-lantern";
  lantern.position.set(7, 2, 0);
  root.add(trunk, lantern);
  const measured = measureShot(root, DIRECTED_SHOTS.tree[1]);
  close(measured.region.min.y, 0);
  close(measured.region.max.y, 4);
  close(measured.region.max.x, 7.5);
  close(measured.cameraY, 4 * DIRECTED_SHOTS.tree[1].height);
  close(measured.region.min.x, 6.5);
});

test("all directed framing regions fit desktop and phone through both movement extremes with fixed camera height", () => {
  for (const [w, h] of [
    [1440, 900],
    [390, 844],
    [844, 390],
  ])
    for (const subject of ["tower", "tree"])
      for (const angle of DIRECTED_SHOTS[subject].keys()) {
        const camera = new PerspectiveCamera(45, w / h, 0.1, 1000),
          root = new Group();
        const mesh = new Mesh(
          new BoxGeometry(subject === "tree" ? 4 : 14, 34, subject === "tree" ? 4 : 12),
          new MeshStandardMaterial(),
        );
        mesh.position.y = 17;
        root.add(mesh);
        root.position.set(3, -6, 4);
        const area = cinematicSafeArea(w, h, { right: 420, bottom: 220 }, { top: h - 105 });
        const controller = createCinematicCamera({
          camera,
          selected: subject,
          angle,
          getSafeArea: () => area,
        });
        controller.setSubject("tower", root);
        controller.setStatus({ kind: "tower", status: "ready" });
        controller.setSubject("tree", root);
        controller.setStatus({ kind: "tree", status: "ready" });
        const shot = resolveDirectedShot(DIRECTED_SHOTS[subject][angle], w, h);
        const measured = measureShot(root, shot);
        let frame;
        for (const t of [0, 12, 36, 48]) {
          assert.equal(controller.apply({ width: w, height: h, elapsedSeconds: t }), true);
          if (frame)
            assert.equal(controller.frame, frame, "framing is cached between animation frames");
          frame = controller.frame;
          camera.updateMatrixWorld();
          close(camera.position.y, -6 + 34 * shot.height);
          assert.equal(camera.fov, shot.fov);
          for (let i = 0; i < measured.points.length; i += 3) {
            const v = new Vector3(...measured.points.slice(i, i + 3)).project(camera),
              x = ((v.x + 1) * w) / 2,
              y = ((1 - v.y) * h) / 2;
            assert.ok(
              x >= area.left &&
                x <= area.left + area.width &&
                y >= area.top &&
                y <= area.top + area.height,
              `${shot.name} region escaped safe area`,
            );
          }
        }
        const center = camera.position.clone();
        controller.apply({ width: w, height: h, elapsedSeconds: 17, reducedMotion: true });
        close(camera.position.distanceTo(center), 0);
        controller.apply({ width: w + 5, height: h, elapsedSeconds: 18 });
        assert.notEqual(frame, controller.frame, "resize invalidates cached fit");
        controller.dispose();
        root.traverse((o) => {
          o.geometry?.dispose();
          o.material?.dispose();
        });
      }
});

test("low shots retain terrain clearance throughout the bounded camera arc", () => {
  const camera = new PerspectiveCamera(),
    root = new Group();
  const tree = new Mesh(new BoxGeometry(5, 20, 5), new MeshStandardMaterial());
  tree.position.y = 10;
  root.add(tree);
  const ground = (x, z) => 4 + 0.02 * x + 0.025 * z;
  const c = createCinematicCamera({
    camera,
    selected: "tree",
    angle: 2,
    getGroundY: ground,
    getSafeArea: () => ({ left: 480, top: 30, width: 920, height: 670 }),
  });
  for (const kind of ["tower", "tree"]) {
    c.setSubject(kind, root);
    c.setStatus({ kind, status: "ready" });
  }
  for (const time of [0, 12, 36, 48]) {
    c.apply({ width: 1440, height: 900, elapsedSeconds: time });
    assert.ok(camera.position.y - ground(camera.position.x, camera.position.z) >= 0.795);
  }
  c.dispose();
  tree.geometry.dispose();
  tree.material.dispose();
});

test("a foreground ridge cannot hide the roots in a low tree composition", () => {
  const ground = (x, z) =>
    1.8 * Math.sin(0.055 * x) +
    1.35 * Math.cos(0.052 * z) +
    0.9 * Math.sin(0.031 * (x + z)) +
    0.55 * Math.cos(0.018 * (x - z)) -
    6.8;
  const camera = new PerspectiveCamera(),
    root = new Group();
  const tree = new Mesh(new BoxGeometry(12, 19.8, 12), new MeshStandardMaterial());
  tree.name = "meshy-tree";
  tree.position.y = 9.9;
  root.position.set(55.1, ground(55.1, 36.1), 36.1);
  root.add(tree);
  const controller = createCinematicCamera({
    camera,
    selected: "tree",
    angle: 1,
    getGroundY: ground,
    getSafeArea: () => ({ left: 20, top: 220, width: 346, height: 460 }),
  });
  for (const kind of ["tower", "tree"]) {
    controller.setSubject(kind, root);
    controller.setStatus({ kind, status: "ready" });
  }
  let elevation;
  for (const time of [0, 12, 36, 48]) {
    controller.apply({ width: 390, height: 844, elapsedSeconds: time });
    elevation ??= camera.position.y;
    close(camera.position.y, elevation);
    for (let k = 1; k < 24; k++) {
      const t = k / 24,
        point = camera.position.clone().lerp(root.position, t);
      const lineY = camera.position.y * (1 - t) + (root.position.y + 0.18) * t;
      assert.ok(lineY >= ground(point.x, point.z) + 0.07);
    }
  }
  assert.ok(elevation >= root.position.y + 19.8 * DIRECTED_SHOTS.tree[1].height - 1e-6);
  controller.dispose();
  tree.geometry.dispose();
  tree.material.dispose();
});

const closeTo = (a, b, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

function tourSetup(interval = 5) {
  const camera = new PerspectiveCamera(),
    tower = new Group(),
    tree = new Group();
  const material = new MeshBasicMaterial(),
    geometry = new BoxGeometry(10, 20, 10);
  for (const root of [tower, tree]) {
    const mesh = new Mesh(geometry, material);
    mesh.position.y = 10;
    root.add(mesh);
  }
  tree.position.set(55.1, 0, 36.1);
  const controller = createCinematicCamera({
    camera,
    selected: "tower",
    angle: 0,
    getSafeArea: () => ({ left: 450, top: 32, width: 940, height: 720 }),
  });
  for (const [kind, root] of [
    ["tower", tower],
    ["tree", tree],
  ]) {
    controller.setSubject(kind, root);
    controller.setStatus({ kind, status: "ready" });
  }
  const tour = createCameraTour({ camera: controller, interval });
  const render = (time, flags = {}) => {
    const phase = tour.update({ elapsedSeconds: time, ...flags });
    controller.apply({
      width: 1440,
      height: 900,
      elapsedSeconds: time,
      tourPhase: phase,
      ...flags,
    });
    return phase;
  };
  return { camera, controller, tour, render };
}

test("each shot dollies in slowly within its fitted margin and holds still with reduced motion", () => {
  const f = tourSetup(5);
  const phase0 = f.render(0);
  assert.equal(phase0, 0);
  const start = f.camera.position.distanceTo(f.controller.target);
  f.render(4.99);
  const end = f.camera.position.distanceTo(f.controller.target);
  assert.ok(end < start * (1 - PUSH_IN * 0.9) && end > start * (1 - PUSH_IN * 1.01));
  f.render(2.5, { reducedMotion: true });
  closeTo(f.camera.position.distanceTo(f.controller.target), start, 1e-6);
  f.tour.dispose();
  f.controller.dispose();
});

test("tour shots drift at a constant rate between unchanged start, middle and end poses", () => {
  const f = tourSetup(5);
  const pose = (tourPhase) => {
    f.controller.apply({ width: 1440, height: 900, elapsedSeconds: 0, tourPhase });
    const x = f.camera.position.x - f.controller.target.x,
      z = f.camera.position.z - f.controller.target.z;
    return { yaw: (Math.atan2(z, x) * 180) / Math.PI, distance: Math.hypot(x, z) };
  };
  const start = pose(0);
  const { shot, frame } = f.controller;
  const middle = pose(0.5),
    end = pose(1);
  closeTo(start.yaw, shot.azimuth - shot.arc / 2, 1e-6);
  closeTo(middle.yaw, shot.azimuth, 1e-6);
  closeTo(end.yaw, shot.azimuth + shot.arc / 2, 1e-6);
  closeTo(start.distance, frame.distance, 1e-6);
  closeTo(middle.distance, frame.distance * (1 - PUSH_IN / 2), 1e-6);
  closeTo(end.distance, frame.distance * (1 - PUSH_IN), 1e-6);
  // The pan and the dolly-in move as fast by the cuts as mid-shot.
  const rate = (from, to) => {
    const a = pose(from),
      b = pose(to);
    return [(b.yaw - a.yaw) / (to - from), (b.distance - a.distance) / (to - from)];
  };
  const [midYaw, midPush] = rate(0.495, 0.505);
  closeTo(midYaw, shot.arc, 1e-6);
  closeTo(midPush, -PUSH_IN * frame.distance, 1e-6);
  for (const [from, to] of [
    [0, 0.01],
    [0.99, 1],
  ]) {
    const [yaw, push] = rate(from, to);
    closeTo(yaw, midYaw, 1e-6);
    closeTo(push, midPush, 1e-6);
  }
  f.tour.dispose();
  f.controller.dispose();
});

test("a shot's tilt pitches the camera from its cut to the next, and holds the midpoint with reduced motion", () => {
  const f = tourSetup(5);
  const forward = new Vector3(),
    look = new Vector3();
  const elevation = (v) => (Math.asin(v.y) * 180) / Math.PI;
  // The pose after a frame: the forward vector, the direction straight at the
  // target, and the pitch between them in degrees (positive is up).
  const pose = () => {
    f.camera.getWorldDirection(forward);
    look.copy(f.controller.target).sub(f.camera.position).normalize();
    return {
      forward: forward.clone(),
      look: look.clone(),
      pitch: elevation(forward) - elevation(look),
    };
  };
  const at = (flags) => {
    f.controller.apply({ width: 1440, height: 900, elapsedSeconds: 0, ...flags });
    return pose();
  };
  // A shot without a tilt looks straight at its target.
  const watch = at({ tourPhase: 0 });
  assert.equal(f.controller.shot.name, "The watch");
  assert.equal(f.controller.shot.tilt, undefined);
  closeTo(watch.forward.angleTo(watch.look), 0, 1e-6);

  assert.equal(f.controller.setPreviewShot("tower", 4), true);
  // Driven by the tour: the cut opens at tilt[0].
  assert.equal(f.render(0), 0);
  assert.equal(f.controller.shot.name, "Watch and tree");
  assert.deepEqual(f.controller.shot.tilt, [-5, 0]);
  closeTo(pose().pitch, -5, 1e-6);
  assert.equal(f.render(2.5), 0.5);
  closeTo(pose().pitch, -2.5, 1e-6);

  const start = at({ tourPhase: 0 }),
    middle = at({ tourPhase: 0.5 }),
    end = at({ tourPhase: 1 });
  closeTo(start.pitch, -5, 1e-6);
  closeTo(middle.pitch, -2.5, 1e-6);
  closeTo(end.pitch, 0, 1e-6);
  assert.ok(start.forward.y < end.forward.y, "the cut looks lower than the next cut");
  closeTo(end.forward.angleTo(end.look), 0, 1e-6);

  // Reduced motion holds the midpoint, with or without a tour phase.
  for (const tourPhase of [0, 1, null])
    closeTo(at({ tourPhase, reducedMotion: true }).pitch, -2.5, 1e-6);
  f.tour.dispose();
  f.controller.dispose();
});

test("the nine directed shots keep their names and distinct viewpoints", () => {
  const all = [...DIRECTED_SHOTS.tower, ...DIRECTED_SHOTS.tree];
  assert.deepEqual(
    all.map((s) => s.name),
    [
      "The watch",
      "Threshold",
      "Masonry study",
      "Gallery detail",
      "Watch and tree",
      "Portrait",
      "Lantern study",
      "Close-up",
      "Root and lantern",
    ],
  );
  const keys = new Set(all.map((s) => `${s.azimuth}/${s.height}/${s.region.join()}`));
  assert.equal(keys.size, 9);
  for (const shot of all) {
    assert.ok(shot.height >= 0.1 && shot.height <= 0.7);
    assert.ok(shot.fov >= 30 && shot.fov <= 46);
  }
});
