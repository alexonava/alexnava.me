import assert from "node:assert/strict";
import test from "node:test";
import { sceneGround } from "./support/ground.mjs";
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
  letterboxShare,
  LETTERBOX,
  PUSH_IN,
} from "../src/scene/cinematic.js";
import {
  DIRECTED_SHOTS,
  fitPoses,
  measureShot,
  MOVE_PHASES,
  resolveDirectedShot,
  shotPose,
} from "../src/scene/directed-shots.js";
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
  // Too wide for bars (2560x1080 is 2.37:1), a desktop keeps its 32px edges.
  assert.equal(letterboxShare(2560, 1080), 0);
  // Short landscapes, up to 500px tall, keep their own variants and no bars.
  for (const [width, height] of [
    [1000, 437],
    [1100, 480],
    [1147, 500],
  ])
    assert.equal(letterboxShare(width, height), 0, `${width}x${height}`);
  assert.deepEqual(cinematicSafeArea(2560, 1080, { right: 840, bottom: 900 }, { top: 998 }), {
    left: 876,
    top: 32,
    width: 1660,
    height: 938,
  });
  // A 16:9 desktop is cut to 2.39:1: the subject keeps 16px inside each bar.
  const bar = ((900 - 1600 / 2.39) / 2 / 900) * 900;
  near(letterboxShare(1600, 900) * 900, bar);
  const desktop = cinematicSafeArea(1600, 900, { right: 527, bottom: 720 }, { top: 818 });
  assert.equal(desktop.left, 563);
  assert.equal(desktop.width, 1013);
  near(desktop.top, bar + 16);
  near(desktop.top + desktop.height, 900 - bar - 16);
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

// The live scene's level plain and terraces.
const ground = sceneGround;

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
    before = f.projected(390, 844),
    // The watch zooms through its hold (a dolly zoom): the lens at phase 0.3.
    fov = shotPose(shot, 0.3).fov;
  assert.ok(shot.move?.zoom, "a move that changes the lens");
  assert.equal(f.camera.fov, fov);

  // The address bar shows: same width, 80px shorter, same hero.
  f.apply(390, 764);
  assert.equal(f.controller.frame, locked, "the fit is kept");
  const after = f.projected(390, 764);
  assert.ok(Math.abs(after.y - before.y) < 0.5, `target row ${before.y} -> ${after.y}`);
  assert.ok(Math.abs(after.scale - before.scale) < 0.5, `scale ${before.scale} -> ${after.scale}`);
  const tan = Math.tan((fov * Math.PI) / 360);
  assert.ok(Math.abs(f.camera.fov - (360 / Math.PI) * Math.atan((tan * 764) / 844)) < 1e-9);
  f.apply(390, 844);
  assert.equal(f.controller.frame, locked);
  assert.equal(f.camera.fov, fov, "an unchanged view keeps the exact shot fov");

  // The next cut, even to the same shot, fits the current viewport afresh.
  f.apply(390, 764);
  assert.equal(f.controller.setPreviewShot("tower", 0), true);
  f.apply(390, 764);
  const fresh = terrainSetup(390, 764);
  fresh.apply(390, 764);
  assert.notEqual(f.controller.frame, locked);
  assert.deepEqual(f.controller.frame, fresh.controller.frame);
  assert.equal(f.camera.fov, fov);
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
    // A refit shows the move's own lens (without a tour, the breath's phase 0
    // on its first frame), never one scaled to a kept fit.
    const refit =
      f.controller.frame !== locked &&
      f.camera.fov === shotPose(f.controller.shot, tourPhase === null ? 0 : (tourPhase ?? 0.3)).fov;
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

test("all directed framing regions fit desktop and phone through both movement extremes and every move's phases", () => {
  // Without a tour a shot breathes over 48 seconds: phase 0, 0.5, 0.5 and 1.
  const breath = (t) => 0.5 - 0.5 * Math.cos((t * Math.PI * 2) / 48);
  for (const [w, h] of [
    [1440, 900],
    [2560, 1080],
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
        const label = `${shot.name} ${w}x${h}`;
        // The camera height and lens follow the pose: fixed for a drift, raised
        // by a move's crane and set by its zoom.
        const check = (phase) => {
          const pose = shotPose(shot, phase);
          camera.updateMatrixWorld();
          close(camera.position.y, -6 + 34 * shot.height + pose.crane * measured.height);
          close(camera.fov, pose.fov);
          if (!shot.move) assert.equal(camera.fov, shot.fov, label);
          for (let i = 0; i < measured.points.length; i += 3) {
            const v = new Vector3(...measured.points.slice(i, i + 3)).project(camera),
              x = ((v.x + 1) * w) / 2,
              y = ((1 - v.y) * h) / 2;
            assert.ok(
              x >= area.left &&
                x <= area.left + area.width &&
                y >= area.top &&
                y <= area.top + area.height,
              `${label} region escaped safe area at phase ${phase}`,
            );
          }
        };
        let frame;
        for (const t of [0, 12, 36, 48]) {
          assert.equal(controller.apply({ width: w, height: h, elapsedSeconds: t }), true);
          if (frame)
            assert.equal(controller.frame, frame, "framing is cached between animation frames");
          frame = controller.frame;
          check(shot.move ? breath(t) : 0);
        }
        // A tour carries a move through each of its sampled phases.
        if (shot.move)
          for (const tourPhase of MOVE_PHASES) {
            controller.apply({ width: w, height: h, elapsedSeconds: 50, tourPhase });
            assert.equal(controller.frame, frame, "a tour keeps the fit");
            check(tourPhase);
          }
        // Reduced motion holds one pose: the drift's centre, or a move's middle.
        controller.apply({
          width: w,
          height: h,
          elapsedSeconds: 0,
          tourPhase: shot.move ? 0.5 : null,
        });
        const held = camera.position.clone();
        for (const t of [17, 31]) {
          controller.apply({ width: w, height: h, elapsedSeconds: t, reducedMotion: true });
          close(camera.position.distanceTo(held), 0);
          check(0.5);
        }
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

function tourSetup(interval = 5, { props = false } = {}) {
  const camera = new PerspectiveCamera(),
    tower = new Group(),
    tree = new Group();
  const material = new MeshBasicMaterial(),
    geometry = new BoxGeometry(10, 20, 10);
  for (const root of [tower, tree]) {
    // With props, a slim trunk whose surface meets the detail shots' focal
    // slabs, and a lantern for Lantern study, inside the trunk's bounds.
    const mesh = new Mesh(props && root === tree ? new BoxGeometry(3, 20, 3) : geometry, material);
    mesh.position.y = 10;
    root.add(mesh);
  }
  if (props) {
    const post = new Mesh(new BoxGeometry(0.8, 2.5, 0.8), material);
    post.name = "tree-lantern";
    post.position.set(1, 1.25, 1);
    tree.add(post);
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
  const roots = { tower, tree };
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
  return { camera, controller, tour, render, roots };
}

// Gallery detail keeps the old constant drift: it has no move.
const DRIFT_SHOT = 3;

test("a shot without a move dollies in slowly within its fitted margin and holds still with reduced motion", () => {
  const f = tourSetup(5);
  assert.equal(f.controller.setPreviewShot("tower", DRIFT_SHOT), true);
  const phase0 = f.render(0);
  assert.equal(phase0, 0);
  assert.equal(f.controller.shot.name, "Gallery detail");
  assert.equal(f.controller.shot.move, undefined);
  // The ground distance: the drift never changes the camera's height.
  const reach = () =>
    Math.hypot(
      f.camera.position.x - f.controller.target.x,
      f.camera.position.z - f.controller.target.z,
    );
  const start = reach(),
    height = f.camera.position.y;
  f.render(4.99);
  const end = reach();
  assert.ok(end < start * (1 - PUSH_IN * 0.9) && end > start * (1 - PUSH_IN * 1.01));
  assert.equal(f.camera.position.y, height);
  f.render(2.5, { reducedMotion: true });
  closeTo(reach(), start, 1e-6);
  f.tour.dispose();
  f.controller.dispose();
});

test("shots without a move drift at a constant rate between unchanged start, middle and end poses", () => {
  const f = tourSetup(5);
  assert.equal(f.controller.setPreviewShot("tower", DRIFT_SHOT), true);
  const pose = (tourPhase) => {
    f.controller.apply({ width: 1440, height: 900, elapsedSeconds: 0, tourPhase });
    const x = f.camera.position.x - f.controller.target.x,
      z = f.camera.position.z - f.controller.target.z;
    return { yaw: (Math.atan2(z, x) * 180) / Math.PI, distance: Math.hypot(x, z) };
  };
  const start = pose(0);
  const { shot, frame } = f.controller;
  assert.equal(shot.move, undefined);
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
  // The same drift is shotPose's pose for a shot without a move.
  for (const phase of [0, 0.3, 1]) {
    const expected = shotPose(shot, phase);
    closeTo(expected.yaw, (phase - 0.5) * shot.arc, 1e-12);
    closeTo(expected.scale, 1 - PUSH_IN * phase, 1e-12);
    assert.equal(expected.fov, shot.fov);
    assert.equal(expected.crane + expected.truck, 0);
  }
  f.tour.dispose();
  f.controller.dispose();
});

test("a move carries the camera along shotPose's path through a tour hold, and holds its middle with reduced motion", () => {
  const f = tourSetup(5, { props: true });
  const right = new Vector3(),
    along = new Vector3(),
    forward = new Vector3(),
    offset = new Vector3();
  let moves = 0;
  for (const [subject, shots] of Object.entries(DIRECTED_SHOTS))
    for (const angle of shots.keys()) {
      assert.equal(f.controller.setPreviewShot(subject, angle), true);
      f.controller.apply({ width: 1440, height: 900, elapsedSeconds: 0, tourPhase: 0 });
      const { shot, frame } = f.controller;
      if (!shot.move) continue;
      moves++;
      const measured = measureShot(f.roots[subject], shot);
      // Where the camera stands for a phase: its reach along the shot's yaw,
      // slid sideways with its aim by the truck, raised by the crane.
      const pose = (flags) => {
        f.controller.apply({ width: 1440, height: 900, elapsedSeconds: 0, ...flags });
        f.camera.updateMatrixWorld();
        offset.copy(f.camera.position).sub(f.controller.target);
        return {
          y: f.camera.position.y,
          fov: f.camera.fov,
          position: f.camera.position.clone(),
          forward: f.camera.getWorldDirection(forward).clone(),
        };
      };
      for (const phase of [...MOVE_PHASES, 0.01, 0.99]) {
        const expected = shotPose(shot, phase),
          got = pose({ tourPhase: phase }),
          yaw = ((shot.azimuth + expected.yaw) * Math.PI) / 180,
          reach = frame.distance * expected.scale;
        along.set(Math.cos(yaw), 0, Math.sin(yaw));
        right.set(-Math.sin(yaw), 0, Math.cos(yaw));
        const label = `${shot.name} at ${phase}`;
        closeTo(offset.dot(along), reach, 1e-6);
        closeTo(offset.dot(right), expected.truck * reach, 1e-6);
        closeTo(got.y, frame.cameraY + expected.crane * measured.height, 1e-6);
        closeTo(got.fov, expected.fov, 1e-9);
        // The camera looks back along its yaw: a truck slides its aim with it.
        if (!shot.tilt) {
          const aim = f.controller.target.clone().addScaledVector(right, expected.truck * reach);
          closeTo(got.forward.angleTo(aim.sub(got.position).normalize()), 0, 1e-6);
        }
        assert.ok(Number.isFinite(got.y), label);
      }
      // Reduced motion holds the middle pose, with or without a tour.
      const middle = pose({ tourPhase: 0.5 });
      for (const tourPhase of [0, 1, null]) {
        const held = pose({ tourPhase, reducedMotion: true, elapsedSeconds: 7 });
        closeTo(held.position.distanceTo(middle.position), 0, 1e-6);
        closeTo(held.fov, middle.fov, 1e-9);
      }
    }
  assert.ok(moves >= 7, "every tour shot moves on a desktop");
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
  // Driven by the tour: the cut opens at tilt[0]. A 1440x900 desktop is cut to
  // 2.39:1, and its letterbox variant tilts from -4 to -1 (the base shot -5 to 0).
  assert.equal(f.render(0), 0);
  assert.equal(f.controller.shot.name, "Watch and tree");
  assert.deepEqual(DIRECTED_SHOTS.tower[4].tilt, [-5, 0]);
  assert.equal(f.controller.shot, resolveDirectedShot(DIRECTED_SHOTS.tower[4], 1440, 900));
  assert.deepEqual(f.controller.shot.tilt, [-4, -1]);
  const [from, to] = f.controller.shot.tilt,
    half = (from + to) / 2;
  closeTo(pose().pitch, from, 1e-6);
  assert.equal(f.render(2.5), 0.5);
  closeTo(pose().pitch, half, 1e-6);

  const start = at({ tourPhase: 0 }),
    middle = at({ tourPhase: 0.5 }),
    end = at({ tourPhase: 1 });
  closeTo(start.pitch, from, 1e-6);
  closeTo(middle.pitch, half, 1e-6);
  closeTo(end.pitch, to, 1e-6);
  assert.ok(start.forward.y < end.forward.y, "the cut looks lower than the next cut");
  // At the next cut the lens sits `to` degrees off its aim.
  closeTo(end.forward.angleTo(end.look), (Math.abs(to) * Math.PI) / 180, 1e-6);

  // Reduced motion holds the midpoint, with or without a tour phase.
  for (const tourPhase of [0, 1, null])
    closeTo(at({ tourPhase, reducedMotion: true }).pitch, half, 1e-6);
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

// Every resolved form of the shots with a move: base, letterbox, portrait,
// squat, landscape and compact variants.
function movingShots() {
  const shots = new Set();
  for (const base of [...DIRECTED_SHOTS.tower, ...DIRECTED_SHOTS.tree])
    for (const [w, h] of [
      [1440, 900],
      [2560, 1080],
      [1440, 501],
      [390, 844],
      [1080, 1920],
      [700, 480],
      [932, 430],
      [568, 320],
    ]) {
      const shot = resolveDirectedShot(base, w, h);
      if (shot.move) shots.add(shot);
    }
  return [...shots];
}

test("a move eases in and out yet keeps (1 - ease) of its mean speed at each cut", () => {
  const shots = movingShots();
  assert.ok(shots.length >= 10);
  for (const shot of shots) {
    const ease = shot.move.ease ?? 0;
    assert.ok(ease >= 0 && ease < 1, `${shot.name}: the camera never stops`);
    // The travelled share of the path, read back from the pose's yaw.
    const travelled = (phase) => shotPose(shot, phase).yaw / shot.arc + 0.5;
    near(travelled(0), 0);
    near(travelled(0.5), 0.5);
    near(travelled(1), 1);
    const step = 1e-4,
      speed = (phase) => (travelled(phase + step) - travelled(phase)) / step;
    // The mean speed is 1 (the whole path over the whole hold).
    for (const phase of [0, 1 - step]) {
      assert.ok(speed(phase) >= (1 - ease) * (1 - 1e-3), `${shot.name} at ${phase}`);
      assert.ok(speed(phase) > 0);
    }
    assert.ok(speed(0.5 - step / 2) > 1, `${shot.name}: faster mid-hold than on average`);
    let previous = -Infinity;
    for (let k = 0; k <= 100; k++) {
      const value = travelled(k / 100);
      assert.ok(value > previous, `${shot.name}: forward only`);
      previous = value;
    }
  }
});

test("a move's truck, crane, dolly and zoom run from their first value at the cut to the second at the next", () => {
  for (const shot of movingShots()) {
    const { move } = shot,
      start = shotPose(shot, 0),
      end = shotPose(shot, 1),
      dollyZoom = (fov) =>
        move.dollyZoom && move.zoom
          ? Math.tan((move.zoom[0] * Math.PI) / 360) / Math.tan((fov * Math.PI) / 360)
          : 1;
    near(start.yaw, -shot.arc / 2);
    near(end.yaw, shot.arc / 2);
    near(start.truck, move.truck?.[0] ?? 0);
    near(end.truck, move.truck?.[1] ?? 0);
    near(start.crane, move.crane?.[0] ?? 0);
    near(end.crane, move.crane?.[1] ?? 0);
    near(start.fov, move.zoom?.[0] ?? shot.fov);
    near(end.fov, move.zoom?.[1] ?? shot.fov);
    near(start.scale, (move.dolly?.[0] ?? 1) * dollyZoom(start.fov));
    near(end.scale, (move.dolly?.[1] ?? 1) * dollyZoom(end.fov));
    // The fit holds the move's sampled phases.
    const poses = fitPoses(shot);
    assert.equal(poses.length, MOVE_PHASES.length);
    poses.forEach((pose, i) => assert.deepEqual(pose, shotPose(shot, MOVE_PHASES[i])));
  }
  assert.deepEqual(MOVE_PHASES, [0, 0.25, 0.5, 0.75, 1]);
  assert.ok(Object.isFrozen(MOVE_PHASES));
  // The spec'd moves: Portrait trucks left to right and cranes up while pushing in.
  const portrait = DIRECTED_SHOTS.tree[0];
  near(shotPose(portrait, 0).truck, -0.07);
  near(shotPose(portrait, 1).truck, 0.07);
  near(shotPose(portrait, 1).crane, 0.13);
  near(shotPose(portrait, 1).scale, 0.92);
  // Threshold starts below its fitted height and rises above it.
  near(shotPose(DIRECTED_SHOTS.tower[1], 0).crane, -0.18);
  near(shotPose(DIRECTED_SHOTS.tower[1], 1).crane, 0.1);
  // Root and lantern pulls back.
  const root = DIRECTED_SHOTS.tree[3];
  assert.ok(shotPose(root, 1).scale > shotPose(root, 0).scale);
  // A drift's fit holds the arc's extremes either way at the fitted distance.
  const drift = DIRECTED_SHOTS.tower[DRIFT_SHOT];
  assert.deepEqual(
    fitPoses(drift).map((pose) => pose.yaw),
    [-drift.arc, 0, drift.arc],
  );
  assert.ok(fitPoses(drift).every((pose) => pose.scale === 1 && pose.fov === drift.fov));
});

test("The watch's dolly zoom keeps the lookout's size while the ranges behind it swell", () => {
  const f = setup("tower", 1440, 900);
  f.apply(0, { tourPhase: 0 });
  const shot = f.controller.shot;
  assert.equal(shot.name, "The watch");
  assert.equal(shot.move.dollyZoom, true);
  assert.ok(shot.move.zoom[1] < shot.move.zoom[0], "it narrows the lens as it pulls back");
  const row = (point) => ((1 - point.clone().project(f.camera).y) * 900) / 2;
  // Pixels per world unit of height at the target, and at a point 200 units
  // behind it along the view.
  const scales = (tourPhase) => {
    f.apply(0, { tourPhase });
    f.camera.updateMatrixWorld(true);
    const target = f.controller.target,
      back = target
        .clone()
        .sub(f.camera.position)
        .setY(0)
        .normalize()
        .multiplyScalar(200)
        .add(target);
    const up = new Vector3(0, 1, 0);
    return {
      subject: row(target) - row(target.clone().add(up)),
      far: row(back) - row(back.clone().add(up)),
    };
  };
  const first = scales(0);
  for (const phase of MOVE_PHASES) {
    const { subject, far } = scales(phase);
    assert.ok(Math.abs(subject / first.subject - 1) < 0.02, `subject at ${phase}: ${subject}`);
    if (phase > 0) assert.ok(far > first.far, `the background swells by ${phase}`);
  }
  const last = scales(1);
  assert.ok(last.far / first.far > 1.1, "the background swells by over a tenth");
  // And the camera really travels: it pulls back as the lens narrows.
  f.apply(0, { tourPhase: 0 });
  const start = f.camera.position.distanceTo(f.controller.target);
  f.apply(0, { tourPhase: 1 });
  assert.ok(f.camera.position.distanceTo(f.controller.target) > start * 1.15);
  // The fog clears from the move's nearest pose, wherever the camera is now.
  const nearest = Math.min(...fitPoses(shot).map((pose) => pose.scale));
  near(f.fog.near, Math.max(62, f.controller.frame.distance * nearest * 0.88));
  assert.ok(f.fog.near < f.controller.frame.distance * shotPose(shot, 1).scale);
  f.controller.dispose();
});

test("widescreen bars cut desktops to 2.39:1, never phones, portrait, narrow or ultrawide screens", () => {
  assert.ok(Object.isFrozen(LETTERBOX));
  assert.deepEqual(LETTERBOX, { ratio: 2.39, minWidth: 1000 });
  for (const [width, height] of [
    // Phones, both ways round.
    [390, 844],
    [844, 390],
    [932, 430],
    [568, 320],
    // Portrait screens and tablets.
    [1080, 1920],
    [768, 1024],
    [1024, 1366],
    // Narrow landscape windows.
    [999, 700],
    [800, 600],
    // Ultrawide: 2560x1080 and 3440x1440 are within 2% of 2.39:1.
    [2560, 1080],
    [3440, 1440],
    [1000, 435],
  ])
    assert.equal(letterboxShare(width, height), 0, `${width}x${height}`);
  for (const [width, height] of [
    [1440, 900],
    [1920, 1080],
    [1280, 800],
    [1024, 768],
  ]) {
    const share = letterboxShare(width, height);
    near(share, (height - width / 2.39) / (2 * height));
    assert.ok(share > 0.02, `${width}x${height}`);
    // What is left between the bars is 2.39:1.
    near(width / (height * (1 - 2 * share)), 2.39);
  }
  near(letterboxShare(1440, 900), (900 - 1440 / 2.39) / 1800);

  // The safe area keeps 16px inside each bar on desktops (32px edges without).
  const bar = letterboxShare(1440, 900) * 900,
    area = cinematicSafeArea(1440, 900, { right: 420, bottom: 220 }, { top: 900 - 40 });
  near(area.top, bar + 16);
  near(area.top + area.height, 900 - bar - 16);
  const open = cinematicSafeArea(1440, 501, { right: 420, bottom: 220 }, { top: 501 });
  assert.equal(open.top, 32);
  assert.equal(open.top + open.height, 501 - 32);
  // Phones and stacked layouts keep their own edges.
  const phone = cinematicSafeArea(390, 844, { right: 299, bottom: 177 }, { top: 738 });
  assert.equal(phone.top, 201);

  // The bars pick each shot's letterbox variant, built once; shots without one
  // keep their base form.
  for (const base of [...DIRECTED_SHOTS.tower, ...DIRECTED_SHOTS.tree]) {
    const boxed = resolveDirectedShot(base, 1440, 900);
    if (base.letterbox) {
      assert.notEqual(boxed, base);
      assert.deepEqual({ ...boxed }, { ...base, ...base.letterbox });
      assert.equal(resolveDirectedShot(base, 1920, 1080), boxed, `${base.name}: built once`);
    } else assert.equal(boxed, base, base.name);
    // Without bars the base shot shows on a wide desktop.
    assert.equal(resolveDirectedShot(base, 2560, 1080), base);
  }
  assert.deepEqual(
    [...DIRECTED_SHOTS.tower, ...DIRECTED_SHOTS.tree].filter((s) => s.letterbox).map((s) => s.name),
    ["The watch", "Watch and tree", "Close-up"],
  );
  // A letterboxed window is never short, so the bars' variant never displaces a
  // landscape phone's.
  for (const [width, height] of [
    [1440, 900],
    [1024, 768],
  ])
    assert.ok(height > 500 && letterboxShare(width, height) > 0);
});
