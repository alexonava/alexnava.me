import assert from "node:assert/strict";
import test from "node:test";
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, PerspectiveCamera } from "three";
import { createCinematicCamera, PUSH_IN } from "../src/scene/cinematic.js";
import * as tourModule from "../src/scene/camera-tour.js";
import { DIRECTED_SHOTS } from "../src/scene/directed-shots.js";
import { createPostprocessPipeline } from "../src/scene/postprocess.js";

const {
  createCameraTour,
  DEFAULT_TOUR_INTERVAL,
  readTourInterval,
  TOUR_HOLD_FALLBACK,
  TOUR_IDLE,
  TOUR_ORDER,
  TOUR_PER_SHOT,
  TOUR_TRANSITION,
} = tourModule;

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

function setup(interval = 5, { prepare } = {}) {
  const camera = new PerspectiveCamera(),
    tower = new Group(),
    tree = new Group();
  const material = new MeshBasicMaterial(),
    geometries = [new BoxGeometry(10, 20, 10), new BoxGeometry(3, 20, 3)];
  for (const root of [tower, tree]) {
    const mesh = new Mesh(geometries[root === tower ? 0 : 1], material);
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
  const tour = createCameraTour({ camera: controller, interval, prepare });
  return {
    camera,
    controller,
    tour,
    render(time, flags = {}) {
      const phase = tour.update({ elapsedSeconds: time, ...flags });
      controller.apply({
        width: 1440,
        height: 900,
        elapsedSeconds: time,
        tourPhase: phase,
        ...flags,
      });
      return phase;
    },
    // Renders 20 fps frames through `to`, calling `frame(time)` after each.
    run(from, to, frame = () => {}) {
      for (let k = Math.round(from * 20) + 1; k <= Math.round(to * 20); k++) {
        this.render(k / 20);
        frame(k / 20);
      }
    },
    get name() {
      return controller.shot.name;
    },
    get transition() {
      return { ...tour.transition };
    },
    dispose() {
      tour.dispose();
      controller.dispose();
      geometries.forEach((geometry) => geometry.dispose());
      material.dispose();
    },
  };
}

const idle = (f) => assert.deepEqual(f.transition, { ...TOUR_IDLE });

const allShots = Object.values(DIRECTED_SHOTS).flat();
const tourShots = TOUR_ORDER.map((name) => allShots.find((shot) => shot.name === name));

const tourHolds = tourShots.map((shot) => shot.hold),
  tourNames = tourShots.map((shot) => shot.name);

test("tour defaults to per-shot holds even when a link chooses its opening composition", () => {
  assert.equal(TOUR_PER_SHOT, "shot");
  assert.equal(DEFAULT_TOUR_INTERVAL, TOUR_PER_SHOT);
  for (const query of ["", "?quality=high", "?view=tower", "?angle=1", "?view=tree&angle=6"])
    assert.equal(readTourInterval(query), "shot");
  for (const query of ["?tour=0", "?tour=1", "?tour=nan", "?tour=100"])
    assert.equal(readTourInterval(query), 0);
  assert.equal(readTourInterval("?tour=3"), 3);
  assert.equal(readTourInterval("?tour=5"), 5);
  assert.equal(readTourInterval("?tour=20"), 20);
  assert.equal(readTourInterval("?view=tower&tour=5"), 5);
  const f = setup();
  const tour = createCameraTour({ camera: f.controller });
  assert.equal(tour.state.interval, "shot");
  assert.equal(tour.state.dwell, 9);
  assert.equal(createCameraTour({ camera: f.controller, interval: 7 }).state.interval, "shot");
  assert.ok(Object.isFrozen(TOUR_IDLE) && Object.isFrozen(TOUR_TRANSITION));
  assert.equal(tour.transition, tour.transition, "one reused transition object");
  f.dispose();
});

test("the seven tour views skip Masonry study and Gallery detail and wrap with small drift and cached repeat framing", () => {
  for (const interval of [3, 5]) {
    const f = setup(interval);
    f.render(0);
    idle(f);
    const firstFit = f.controller.frame,
      firstPosition = f.camera.position.clone();
    f.render(interval * 0.5);
    assert.ok(f.camera.position.distanceTo(firstPosition) > 0.1);
    assert.equal(f.camera.position.y, firstPosition.y);
    const names = [f.name];
    assert.equal(f.tour.state.total, 7);
    assert.equal(f.tour.state.index, 1);
    let captured = null;
    f.run(interval * 0.5, interval * 7 + 0.5, () => {
      const { capture, cut } = f.transition;
      if (cut) {
        assert.ok(captured, "a capture frame precedes every cut");
        assert.notEqual(f.name, captured, "the cut changes the shot");
        names.push(f.name);
        assert.equal(f.tour.state.index, ((names.length - 1) % 7) + 1);
      }
      captured = capture ? f.name : null;
    });
    assert.deepEqual(names, [
      "The watch",
      "Portrait",
      "Threshold",
      "Lantern study",
      "Watch and tree",
      "Close-up",
      "Root and lantern",
      "The watch",
    ]);
    assert.equal(f.controller.frame, firstFit);
    f.dispose();
  }
});

test("each tour shot holds for its own time, capture to capture, with no wildcard", () => {
  assert.deepEqual(tourHolds, [9, 9, 7, 6, 7, 6, 6]);
  assert.equal(
    tourHolds.reduce((sum, hold) => sum + hold, 0),
    50,
  );
  assert.equal(DIRECTED_SHOTS.tower[2].hold, undefined, "Masonry study uses the fallback");
  assert.equal(TOUR_HOLD_FALLBACK, 7);
  assert.equal(TOUR_TRANSITION.dissolve, 1);
  assert.equal(tourModule.TOUR_DWELL, undefined);
  assert.equal(tourModule.TOUR_FADE, undefined);
  const f = setup(TOUR_PER_SHOT);
  const random = Math.random;
  Math.random = () => {
    throw new Error("the tour must not use RNG");
  };
  try {
    f.render(0);
    const captures = [],
      dwells = [];
    f.run(0, 50 * 2 + 1, (time) => {
      if (f.transition.capture) captures.push([time, f.name]);
      if (f.transition.cut) dwells.push(f.tour.state.dwell);
    });
    assert.equal(captures.length, 14);
    let previous = 0;
    captures.forEach(([time, name], i) => {
      const hold = tourHolds[i % 7];
      assert.equal(name, tourNames[i % 7]);
      assert.ok(Math.abs(time - previous - hold) <= 0.06, `${name} held ${time - previous}s`);
      previous = time;
    });
    assert.deepEqual(dwells.slice(0, 7), [...tourHolds.slice(1), tourHolds[0]]);
  } finally {
    Math.random = random;
    f.dispose();
  }
});

test("a capture frame keeps the outgoing shot, then the cut dissolves in from the capture time", () => {
  const f = setup(TOUR_PER_SHOT);
  f.render(0);
  idle(f);
  assert.equal(f.tour.running, true);
  close(f.render(8.9), 8.9 / 9);
  idle(f);
  assert.equal(f.render(9), 1, "the outgoing shot sits at its final pose");
  assert.equal(f.name, "The watch");
  const { zoom, ...capture } = f.transition;
  assert.deepEqual(capture, { capture: true, cut: false, progress: 1 });
  // The watch's dolly-zoom keeps its subject's size at the cut, so the kept
  // frame takes only the minimum push.
  close(zoom, TOUR_TRANSITION.minZoom);
  close(f.render(9.016), 0.016 / 9, 1e-6);
  assert.equal(f.name, "Portrait");
  const cut = f.transition;
  assert.equal(cut.cut, true);
  assert.equal(cut.capture, false);
  close(cut.progress, 0.016, 1e-6);
  close(cut.zoom, TOUR_TRANSITION.minZoom);
  f.render(9.5);
  close(f.transition.progress, 0.5, 1e-6);
  assert.equal(f.transition.cut, false);
  f.render(9.95);
  assert.ok(f.transition.progress > 0.9 && f.transition.progress < 1);
  f.render(10.05);
  idle(f);
  f.render(17.99);
  idle(f);
  f.render(18.01);
  assert.equal(f.transition.capture, true, "Portrait holds 9 seconds from its capture");
  assert.equal(f.name, "Portrait");
  f.dispose();

  // tour=3 dissolves over 30% of its hold; The watch's dolly-zoom still keeps
  // its subject's size, so its kept frame takes the minimum push.
  const quick = setup(3);
  quick.render(0);
  quick.render(3);
  assert.equal(quick.transition.capture, true);
  close(quick.transition.zoom, TOUR_TRANSITION.minZoom);
  quick.render(3.45);
  assert.equal(quick.name, "Portrait");
  close(quick.transition.progress, 0.5, 1e-6);
  quick.render(3.95);
  idle(quick);
  quick.dispose();
});

test("pause, panels and reduced motion hold the tour without catch-up cuts", () => {
  for (const flag of ["panelOpen", "reducedMotion"]) {
    const f = setup();
    f.render(0);
    f.render(2);
    f.render(3, { [flag]: true });
    assert.equal(f.tour.running, false);
    idle(f);
    f.render(50, { [flag]: true });
    f.render(51);
    assert.equal(f.controller.selected, "tower");
    assert.equal(f.controller.angle, 0);
    f.render(54);
    assert.equal(f.transition.capture, true);
    assert.equal(f.name, "The watch", "the capture frame still shows the outgoing shot");
    f.render(54.05);
    assert.equal(f.name, "Portrait");
    f.dispose();
  }
  // A hold that lands mid-dissolve shows the incoming shot clear, and the
  // interrupted dissolve is not replayed once released.
  for (const flag of ["panelOpen"]) {
    const f = setup();
    f.render(0);
    f.render(5);
    assert.equal(f.transition.capture, true);
    f.render(5.1);
    assert.equal(f.name, "Portrait");
    assert.equal(f.transition.cut, true);
    f.render(5.5);
    close(f.transition.progress, 0.5, 1e-6);
    f.render(5.7, { [flag]: true });
    idle(f);
    f.render(40, { [flag]: true });
    idle(f);
    f.render(41);
    idle(f);
    f.render(41.5);
    idle(f);
    assert.equal(f.name, "Portrait");
    f.render(45.3);
    idle(f);
    f.render(45.5);
    assert.equal(f.transition.capture, true, "the held time is not counted");
    f.dispose();
  }
  const f = setup();
  f.render(0);
  f.render(2);
  f.tour.toggle();
  f.render(10);
  const held = f.camera.position.clone();
  f.render(30);
  assert.deepEqual(f.camera.position.toArray(), held.toArray());
  f.tour.next();
  f.render(31);
  assert.equal(f.name, "Portrait");
  idle(f);
  f.tour.toggle();
  f.render(32);
  f.render(37);
  assert.equal(f.transition.capture, true);
  f.render(37.05);
  assert.equal(f.name, "Threshold");
  f.dispose();
});

test("setPaused drops an interrupted dissolve, and a pause on the capture frame captures again on resume", () => {
  const f = setup();
  f.render(0);
  assert.equal(f.render(5), 1);
  assert.equal(f.transition.capture, true);
  f.tour.setPaused(true);
  f.tour.setPaused(true);
  assert.equal(f.tour.state.paused, true);
  assert.equal(f.tour.running, false);
  idle(f);
  assert.equal(f.render(5.05), 1, "the paused frame keeps the outgoing shot's final pose");
  f.render(90);
  idle(f);
  assert.equal(f.name, "The watch");
  f.tour.toggle();
  assert.equal(f.tour.state.paused, false, "toggle shares the pause state");
  f.render(91);
  assert.equal(f.transition.capture, true, "the first resumed frame captures again");
  assert.equal(f.name, "The watch", "the paused time is not counted");
  f.render(91.05);
  assert.equal(f.name, "Portrait", "the cut then completes");
  assert.equal(f.transition.cut, true);
  f.render(91.5);
  close(f.transition.progress, 0.5, 1e-6);

  // A pause mid-dissolve shows the incoming shot clear and keeps the rest of
  // the hold; the dissolve does not replay on resume.
  f.tour.setPaused(true);
  idle(f);
  f.render(120);
  f.tour.setPaused(false);
  f.render(121);
  idle(f);
  f.render(121.1);
  idle(f);
  f.render(125.3);
  assert.equal(f.name, "Portrait");
  idle(f);
  f.render(125.55);
  assert.equal(f.transition.capture, true);
  f.render(125.6);
  assert.equal(f.name, "Threshold");
  f.tour.dispose();
  f.tour.setPaused(true);
  assert.equal(f.tour.state.paused, false, "disposal blocks later pauses");
  assert.equal(f.tour.running, false);
  idle(f);
  f.dispose();
});

test("setInterval switches between fixed cadences and per-shot holds as a hard reset", () => {
  const f = setup(5);
  assert.equal(f.tour.state.dwell, 5);
  f.render(0);
  f.render(5);
  f.render(5.1);
  assert.equal(f.transition.cut, true);
  f.tour.setInterval(TOUR_PER_SHOT);
  assert.equal(f.tour.state.interval, "shot");
  assert.equal(f.tour.state.dwell, 9, "Portrait's own hold");
  idle(f);
  f.render(5.2);
  idle(f);
  f.tour.setInterval(20);
  assert.equal(f.tour.state.dwell, 20);
  f.tour.setInterval(7);
  assert.equal(f.tour.state.interval, 20);
  f.tour.setInterval(5);
  assert.equal(f.tour.state.dwell, 5);
  f.tour.next();
  f.tour.setInterval(TOUR_PER_SHOT);
  assert.equal(f.tour.state.dwell, 7, "Threshold's own hold");
  f.tour.next();
  assert.equal(f.tour.state.dwell, 6, "Lantern study's own hold");
  f.dispose();
});

test("the upcoming shot is prepared once per shot, after its dissolve and never while paused", () => {
  const calls = [];
  const f = setup(TOUR_PER_SHOT, { prepare: (...view) => calls.push(view) });
  let seen = 0,
    first = null;
  f.render(0);
  const watch = (time) => {
    if (calls.length === seen) return;
    assert.equal(calls.length, seen + 1, "one call per frame at most");
    idle(f);
    first ??= time;
    seen = calls.length;
  };
  f.run(0, 9.1, watch);
  assert.deepEqual(calls, [["tree", 0]]);
  assert.ok(first >= 2 && first <= 2.06, `prepared at ${first}`);
  assert.equal(f.name, "Portrait");
  f.run(9.1, 10.9, watch);
  assert.equal(calls.length, 1, "nothing is prepared during a dissolve");
  f.run(10.9, 11.15, watch);
  assert.deepEqual(calls[1], ["tower", 1], "the tour order, not the array's, follows Portrait");
  f.tour.prepareNext();
  assert.deepEqual(calls[2], ["tower", 1], "prepareNext re-issues the upcoming shot");
  seen = calls.length;

  // A resize mid-dissolve is re-issued once, after the dissolve.
  f.run(11.15, 18.15, watch);
  assert.equal(f.name, "Threshold");
  assert.ok(f.transition.progress < 1);
  f.tour.prepareNext();
  assert.equal(calls.length, 3);
  f.run(18.15, 21, watch);
  assert.deepEqual(calls.slice(3), [["tree", 1]]);

  // A paused tour prepares nothing; resuming prepares when due.
  f.run(21, 25.2, watch);
  assert.equal(f.name, "Lantern study");
  f.run(25.2, 26, watch);
  f.tour.setPaused(true);
  f.tour.prepareNext();
  f.run(26, 49, watch);
  assert.equal(calls.length, 4);
  f.tour.setPaused(false);
  f.run(49, 51, watch);
  assert.deepEqual(calls.slice(4), [["tower", 4]]);
  f.dispose();

  // Without the tree, Threshold is followed by Watch and tree, and Watch and
  // tree by The watch; a URL's Gallery detail is followed by The watch.
  assert.equal(DIRECTED_SHOTS.tower[2].tour, false);
  assert.equal(DIRECTED_SHOTS.tower[3].tour, false);
  for (const [angle, upcoming] of [
    [1, ["tower", 4]],
    [4, ["tower", 0]],
    [3, ["tower", 0]],
  ]) {
    const fallback = [];
    const g = setup(TOUR_PER_SHOT, { prepare: (...view) => fallback.push(view) });
    g.controller.setSubject("tree", null);
    g.controller.setStatus({ kind: "tree", status: "fallback" });
    assert.equal(g.controller.setPreviewShot("tower", angle), true);
    g.render(0);
    g.run(0, 3);
    assert.deepEqual(fallback, [upcoming]);
    g.dispose();
  }
});

test("unavailable subjects are skipped, loading holds, and disposal blocks later changes", () => {
  const f = setup();
  f.controller.setSubject("tree", null);
  f.controller.setStatus({ kind: "tree", status: "fallback" });
  for (const t of [0, 5, 5.05, 10.05, 10.1, 15.1, 15.15]) f.render(t);
  assert.equal(f.name, "The watch");
  f.controller.setStatus({ kind: "tower", status: "loading" });
  f.render(16);
  assert.equal(f.tour.running, false);
  f.render(50);
  f.controller.setStatus({ kind: "tower", status: "ready" });
  f.render(51);
  assert.equal(f.name, "The watch");
  f.tour.dispose();
  f.tour.next();
  f.tour.prepareNext();
  f.render(99);
  assert.equal(f.name, "The watch");
  f.dispose();
});

test("a URL's Masonry study or Gallery detail is followed by The watch without renumbering angles", () => {
  for (const [angle, name, dwell] of [
    [2, "Masonry study", TOUR_HOLD_FALLBACK],
    [3, "Gallery detail", 7],
  ]) {
    const f = setup(TOUR_PER_SHOT);
    assert.equal(f.controller.setPreviewShot("tower", angle), true);
    f.render(0);
    assert.equal(f.name, name);
    assert.equal(f.tour.state.index, null);
    assert.equal(f.tour.state.dwell, dwell);
    f.render(6.9);
    idle(f);
    f.render(7);
    assert.equal(f.transition.capture, true);
    f.render(7.05);
    assert.equal(f.name, "The watch");
    assert.equal(f.controller.angle, 0);
    assert.equal(f.tour.state.index, 1);
    f.dispose();
  }
  // Watch and tree joined after Gallery detail, so the retained URLs keep
  // their angles: Gallery detail is still angle 4 (index 3), Watch and tree 5.
  assert.deepEqual(
    DIRECTED_SHOTS.tower.map((shot) => shot.name),
    ["The watch", "Threshold", "Masonry study", "Gallery detail", "Watch and tree"],
  );
  const f = setup(TOUR_PER_SHOT);
  assert.equal(f.controller.setPreviewShot("tower", 4), true);
  f.render(0);
  assert.equal(f.name, "Watch and tree");
  assert.equal(f.tour.state.index, 5);
  f.tour.next();
  f.render(1);
  assert.equal(f.name, "Close-up");
  assert.equal(f.tour.state.index, 6);
  idle(f);
  f.dispose();
});

test("the tour order alternates subjects, opens on The watch and keeps Lantern study from Root and lantern", () => {
  assert.ok(Object.isFrozen(TOUR_ORDER));
  assert.equal(TOUR_ORDER[0], "The watch");
  assert.equal(new Set(TOUR_ORDER).size, TOUR_ORDER.length);
  const subjects = new Map(
    Object.entries(DIRECTED_SHOTS).flatMap(([subject, shots]) =>
      shots.map((shot) => [shot.name, { subject, shot }]),
    ),
  );
  for (const name of TOUR_ORDER) {
    assert.ok(subjects.has(name), `${name} is a directed shot`);
    assert.notEqual(subjects.get(name).shot.tour, false, `${name} is a tour shot`);
  }
  for (const [name, { shot }] of subjects)
    assert.equal(TOUR_ORDER.includes(name), shot.tour !== false, `${name} membership`);
  const pairs = TOUR_ORDER.map((name, i) => [name, TOUR_ORDER[(i + 1) % TOUR_ORDER.length]]);
  const together = pairs.filter(([a, b]) => subjects.get(a).subject === subjects.get(b).subject);
  assert.deepEqual(together, [["Close-up", "Root and lantern"]]);
  assert.equal(subjects.get("Close-up").subject, "tree");
  for (const [a, b] of pairs)
    assert.notDeepEqual([a, b].sort(), ["Lantern study", "Root and lantern"]);
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

// Grading alone, so the final pass draws only for a crossfade.
const GRADING_ONLY = {
  postprocessGrading: true,
  postprocessVignette: false,
  postprocessGrain: false,
};

const rendererMock = () => ({
  autoClear: true,
  autoClearColor: true,
  autoClearDepth: true,
  autoClearStencil: true,
  clear() {},
  getPixelRatio: () => 1,
  getRenderTarget: () => null,
  getSize(target) {
    target.width = 800;
    target.height = 600;
    return target;
  },
  render() {},
  setRenderTarget() {},
});

test("tour shots open without black and dissolve the kept outgoing frame into each cut", () => {
  const f = tourSetup(5);
  const pipeline = createPostprocessPipeline(
    rendererMock(),
    { isScene: true },
    f.camera,
    GRADING_ONLY,
    {
      matchMedia: () => ({ matches: false }),
    },
  );
  const pass = pipeline.passes.vignetteGrain;
  // Mirrors index.js: the tour, then the pipeline, then the camera and the draw.
  const frame = (time, flags = {}) => {
    const phase = f.tour.update({ elapsedSeconds: time, ...flags });
    pipeline.setTransition(f.tour.transition);
    f.controller.apply({
      width: 1440,
      height: 900,
      elapsedSeconds: time,
      tourPhase: phase,
      ...flags,
    });
    pipeline.composer.render(0);
  };
  frame(0);
  assert.deepEqual({ ...f.tour.transition }, { ...TOUR_IDLE }, "the opening shot shows at once");
  assert.equal(pass.enabled, false);
  assert.equal(pass.uniforms.uProgress.value, 1);
  assert.equal(pass.uniforms.uLayered.value, 0, "outside film the dissolve is not staggered");
  frame(4.95);
  assert.equal(pass.enabled, false);

  frame(5);
  assert.equal(f.tour.transition.capture, true);
  assert.equal(f.controller.shot.name, "The watch", "the capture keeps the outgoing shot");
  assert.equal(pass.enabled, true, "grading alone adds the final pass for the crossfade");
  assert.equal(pass.uniforms.uProgress.value, 1);
  assert.ok(pass.uniforms.tPrev.value, "grading's output is kept");
  // The kept frame pushes in about the safe-area centre, in UV from the bottom.
  closeTo(pass.uniforms.uPrevOrigin.value.x, (450 + 940 / 2) / 1440, 1e-6);
  closeTo(pass.uniforms.uPrevOrigin.value.y, 1 - (32 + 720 / 2) / 900, 1e-6);
  pipeline.setQualityProfile(GRADING_ONLY);
  assert.equal(pass.enabled, true, "a quality step keeps the crossfade");

  frame(5.05);
  const { cut, progress, zoom } = f.tour.transition;
  assert.equal(f.controller.shot.name, "Portrait");
  assert.equal(cut, true);
  closeTo(progress, 0.05, 1e-6);
  // Linear here; the final pass eases it, per depth layer in film.
  closeTo(pass.uniforms.uProgress.value, progress, 1e-9);
  closeTo(pass.uniforms.uPrevScale.value, 1 / (1 + zoom * progress), 1e-9);
  assert.equal(pass.uniforms.uLayered.value, 0);
  frame(5.5);
  closeTo(pass.uniforms.uProgress.value, 0.5, 1e-6);
  frame(6.1);
  assert.deepEqual({ ...f.tour.transition }, { ...TOUR_IDLE });
  assert.equal(pass.uniforms.uProgress.value, 1);
  assert.equal(pass.enabled, false, "grading alone drops the final pass after the dissolve");

  // A pause mid-dissolve settles on the incoming shot; resuming does not replay it.
  frame(10);
  assert.equal(f.tour.transition.capture, true);
  frame(10.3);
  assert.equal(f.controller.shot.name, "Threshold");
  assert.ok(pass.uniforms.uProgress.value < 1);
  f.tour.toggle();
  frame(10.4);
  assert.equal(pass.uniforms.uProgress.value, 1);
  assert.equal(pass.enabled, false);
  f.tour.toggle();
  frame(10.5);
  assert.equal(pass.uniforms.uProgress.value, 1);
  frame(10.6, { reducedMotion: true });
  assert.deepEqual({ ...f.tour.transition }, { ...TOUR_IDLE });
  assert.equal("uFade" in pass.uniforms, false, "no dip to black remains");
  f.tour.dispose();
  assert.deepEqual({ ...f.tour.transition }, { ...TOUR_IDLE });
  pipeline.dispose();
  f.controller.dispose();
});
