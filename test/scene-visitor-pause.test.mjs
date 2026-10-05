import assert from "node:assert/strict";
import test from "node:test";
import { createCameraTour, TOUR_IDLE } from "../src/scene/camera-tour.js";
import { DIRECTED_SHOTS } from "../src/scene/directed-shots.js";
import {
  createPanelHold,
  createSceneFrameScheduler,
  createVisitorHold,
} from "../src/scene/runtime.js";

function createFrameHarness() {
  let nextId = 1;
  const callbacks = new Map();
  return {
    cancelFrame(id) {
      callbacks.delete(id);
    },
    get pending() {
      return callbacks.size;
    },
    requestFrame(callback) {
      const id = nextId++;
      callbacks.set(id, callback);
      return id;
    },
    step(timestamp) {
      const entry = callbacks.entries().next().value;
      assert.ok(entry, "expected a queued frame");
      callbacks.delete(entry[0]);
      entry[1](timestamp);
    },
  };
}

function createTimers() {
  let nextId = 1;
  const timers = new Map();
  return {
    clearTimer(id) {
      timers.delete(id);
    },
    fire() {
      const entries = [...timers.values()];
      timers.clear();
      entries.forEach((callback) => callback());
    },
    setTimer(callback) {
      const id = nextId++;
      timers.set(id, callback);
      return id;
    },
  };
}

// The tour needs only the directed camera's selection and readiness.
function createTourCamera(state) {
  return {
    angle: 0,
    current: "tower",
    get ready() {
      return state.ready;
    },
    isAvailable: () => true,
    setPreviewShot(subject, angle) {
      this.current = subject;
      this.angle = angle;
      return true;
    },
  };
}

// Mirrors index.js: each drawn frame updates the tour, reports itself to both
// holds, then shows the canvas and reveals once the camera is ready.
function createSceneHarness({ paused = false, ready = true } = {}) {
  const frames = createFrameHarness();
  const timers = createTimers();
  const state = { open: false, panelReleases: 0, ready, visitorReleases: 0 };
  const drawn = [];
  const camera = createTourCamera(state);
  let panelHold = null;
  let visitorHold = null;
  const scheduler = createSceneFrameScheduler({
    cancelFrame: frames.cancelFrame,
    onUpdate({ deltaSeconds, elapsedSeconds }) {
      tour.update({ elapsedSeconds, panelOpen: state.open });
      drawn.push({
        deltaSeconds,
        elapsedSeconds,
        transition: { ...tour.transition },
        shot: DIRECTED_SHOTS[camera.current][camera.angle].name,
      });
      panelHold.frameRendered();
      visitorHold.frameRendered();
      scheduler.setStill(!state.ready);
      if (state.ready) visitorHold.reveal();
    },
    requestFrame: frames.requestFrame,
  });
  const tour = createCameraTour({
    camera,
    interval: 5,
    invalidate: () => scheduler.invalidate(),
  });
  panelHold = createPanelHold({
    clearTimer: timers.clearTimer,
    isOpen: () => state.open,
    onRelease: () => (state.panelReleases += 1),
    scheduler,
    setTimer: timers.setTimer,
  });
  visitorHold = createVisitorHold({
    onRelease: () => (state.visitorReleases += 1),
    scheduler,
  });
  function setVisitorPaused(next) {
    tour.setPaused(next);
    return visitorHold.set(next);
  }
  function setDialogOpen(open) {
    state.open = open;
    panelHold.sync();
    if (open) timers.fire();
  }
  // Both holds redraw after a resize, as applySceneSize() does.
  function resize() {
    panelHold.redraw();
    visitorHold.redraw();
    scheduler.invalidate();
  }
  setVisitorPaused(paused);
  scheduler.start();
  let time = 0;
  return {
    drawn,
    frames,
    resize,
    scheduler,
    setDialogOpen,
    setVisitorPaused,
    state,
    tour,
    visitorHold,
    // Advances the rAF clock by 100ms per step while frames are queued.
    run(steps) {
      for (let i = 0; i < steps && frames.pending; i += 1) frames.step((time += 100));
    },
    // Runs until the frame just drawn matches `test`.
    runUntil(test) {
      for (let i = 0; i < 200 && frames.pending; i += 1) {
        frames.step((time += 100));
        if (test(drawn.at(-1))) return drawn.at(-1);
      }
      assert.fail("the expected frame never drew");
    },
    skip(ms) {
      time += ms;
    },
  };
}

// A frame with no capture and no dissolve in progress.
const clear = (frame) => assert.deepEqual(frame.transition, { ...TOUR_IDLE });
// Each cut follows exactly one capture frame of the outgoing shot.
function assertHandshakes(drawn) {
  drawn.forEach((frame, i) => {
    const previous = drawn[i - 1];
    if (frame.transition.capture) assert.ok(!previous?.transition.capture, "one capture frame");
    if (!frame.transition.cut) return;
    assert.ok(previous?.transition.capture, "a capture frame precedes the cut");
    assert.notEqual(frame.shot, previous.shot);
    assert.ok(frame.transition.progress > 0 && frame.transition.progress < 1);
  });
}
const dissolving = ({ transition }) => transition.progress > 0.2 && transition.progress < 1;

test("a visitor pause settles a tour dissolve in one frame, then stops rendering", () => {
  const scene = createSceneHarness();
  const blend = scene.runUntil(dissolving);
  assert.equal(blend.shot, "Portrait");
  assertHandshakes(scene.drawn);

  assert.equal(scene.setVisitorPaused(true), true);
  assert.equal(scene.visitorHold.paused, true);
  assert.equal(scene.visitorHold.held, false, "one more frame draws first");
  const count = scene.drawn.length;
  scene.run(100);
  assert.equal(scene.drawn.length, count + 1);
  clear(scene.drawn.at(-1));
  assert.equal(scene.drawn.at(-1).shot, "Portrait", "the incoming shot shows clear");
  assert.equal(scene.visitorHold.held, true);
  assert.equal(scene.scheduler.getState().held, true);
  assert.equal(scene.frames.pending, 0, "drift, clouds and the tour stop drawing");
  scene.scheduler.invalidate();
  scene.scheduler.resume();
  assert.equal(scene.frames.pending, 0, "invalidation does not draw a paused scene");
  scene.scheduler.dispose();
});

test("unpausing resumes the same shot from the clear paused frame without a time jump", () => {
  const scene = createSceneHarness();
  scene.runUntil(dissolving);
  scene.setVisitorPaused(true);
  scene.run(1);
  const paused = scene.drawn.at(-1);
  scene.skip(60_000);

  assert.equal(scene.setVisitorPaused(false), false);
  assert.equal(scene.state.visitorReleases, 1);
  assert.equal(scene.frames.pending, 1);
  scene.run(1);
  const resumed = scene.drawn.at(-1);
  assert.equal(resumed.deltaSeconds, 0, "no giant delta after a long pause");
  assert.equal(resumed.elapsedSeconds, paused.elapsedSeconds);
  assert.equal(resumed.shot, "Portrait");
  clear(resumed);
  scene.run(2);
  // The interrupted dissolve does not replay.
  for (const frame of scene.drawn.slice(-2)) clear(frame);
  const capture = scene.runUntil(({ transition }) => transition.capture);
  assert.equal(capture.shot, "Portrait");
  scene.run(1);
  assert.equal(scene.drawn.at(-1).shot, "Threshold", "the next cut completes");
  assertHandshakes(scene.drawn);
  assert.equal(scene.frames.pending, 1, "animation continues");

  scene.setVisitorPaused(false);
  assert.equal(scene.state.visitorReleases, 1, "an unpaused scene releases nothing");
  scene.scheduler.dispose();
});

test("a pause on the capture frame keeps the outgoing shot, then captures again and cuts", () => {
  const scene = createSceneHarness();
  const capture = scene.runUntil(({ transition }) => transition.capture);
  assert.equal(capture.shot, "The watch");
  scene.setVisitorPaused(true);
  scene.run(10);
  const paused = scene.drawn.at(-1);
  assert.equal(paused.shot, "The watch");
  clear(paused);
  assert.equal(scene.frames.pending, 0);

  scene.setVisitorPaused(false);
  scene.run(1);
  const resumed = scene.drawn.at(-1);
  assert.equal(resumed.shot, "The watch");
  assert.equal(resumed.deltaSeconds, 0);
  assert.equal(resumed.transition.capture, true, "the resumed frame captures again");
  scene.run(1);
  assert.equal(scene.drawn.at(-1).shot, "Portrait");
  assert.equal(scene.drawn.at(-1).transition.cut, true);
  assertHandshakes(scene.drawn.slice(scene.drawn.indexOf(resumed)));
  scene.scheduler.dispose();
});

test("a resize while paused draws exactly one still frame", () => {
  const scene = createSceneHarness();
  scene.run(10);
  scene.setVisitorPaused(true);
  scene.run(1);
  const count = scene.drawn.length;
  const held = scene.drawn.at(-1);

  scene.resize();
  assert.equal(scene.visitorHold.held, false);
  assert.equal(scene.frames.pending, 1, "the cleared canvas is redrawn");
  scene.run(10);
  assert.equal(scene.drawn.length, count + 1);
  const redrawn = scene.drawn.at(-1);
  assert.equal(redrawn.deltaSeconds, 0);
  assert.equal(redrawn.elapsedSeconds, held.elapsedSeconds, "scene time stays frozen");
  clear(redrawn);
  assert.equal(scene.visitorHold.held, true, "the drawn frame restores the hold");
  assert.equal(scene.frames.pending, 0);

  scene.resize();
  scene.resize();
  scene.run(10);
  assert.equal(scene.drawn.length, count + 2, "repeated redraws coalesce");
  assert.equal(scene.frames.pending, 0);
  scene.scheduler.dispose();
});

test("visitor and dialog holds compose in either order", () => {
  const scene = createSceneHarness();
  scene.run(10);
  scene.setVisitorPaused(true);
  scene.run(1);
  const count = scene.drawn.length;

  scene.setDialogOpen(true);
  scene.setDialogOpen(false);
  assert.equal(scene.state.panelReleases, 1);
  assert.equal(scene.frames.pending, 0, "closing a dialog keeps a paused scene held");

  scene.setDialogOpen(true);
  scene.resize();
  assert.equal(scene.frames.pending, 1, "a resize redraws behind both holds");
  scene.run(10);
  assert.equal(scene.drawn.length, count + 1);
  assert.equal(scene.frames.pending, 0, "both holds return after one frame");

  scene.setVisitorPaused(false);
  assert.equal(scene.frames.pending, 0, "unpausing behind a dialog keeps the panel hold");
  scene.setDialogOpen(false);
  assert.equal(scene.frames.pending, 1, "the scene resumes once both are released");
  scene.run(3);
  assert.equal(scene.drawn.length, count + 4);

  // A pause taken behind a held dialog draws its settling frame on close.
  scene.setDialogOpen(true);
  scene.setVisitorPaused(true);
  assert.equal(scene.frames.pending, 0);
  scene.setDialogOpen(false);
  scene.run(10);
  assert.equal(scene.drawn.length, count + 5);
  assert.equal(scene.visitorHold.held, true);
  scene.scheduler.dispose();
});

test("a stored pause keeps the first revealed frame, then holds", () => {
  const scene = createSceneHarness({ paused: true, ready: false });
  scene.run(1);
  assert.equal(scene.visitorHold.paused, true);
  assert.equal(scene.visitorHold.held, false, "the hidden canvas still draws on demand");
  assert.equal(scene.scheduler.getState().still, true);
  scene.resize();
  scene.run(1);
  const count = scene.drawn.length;

  scene.state.ready = true;
  scene.scheduler.invalidate();
  scene.run(10);
  assert.equal(scene.drawn.length, count + 1, "only the revealed frame draws");
  clear(scene.drawn.at(-1));
  assert.equal(scene.visitorHold.held, true);
  assert.equal(scene.frames.pending, 0);

  scene.setVisitorPaused(false);
  scene.run(3);
  assert.equal(scene.drawn.length, count + 4, "unpausing starts the tour");
  // And it opens without black.
  for (const frame of scene.drawn.slice(-3)) clear(frame);
  scene.scheduler.dispose();

  // Without a stored pause the same reveal opens without black and animates.
  const open = createSceneHarness({ ready: false });
  open.run(1);
  open.state.ready = true;
  open.scheduler.invalidate();
  open.run(1);
  clear(open.drawn.at(-1));
  assert.equal(open.visitorHold.held, false);
  assert.equal(open.frames.pending, 1);
  open.scheduler.dispose();
});

test("a disposed visitor hold ignores later pauses, reveals and redraws", () => {
  const frames = createFrameHarness();
  const scheduler = createSceneFrameScheduler({
    cancelFrame: frames.cancelFrame,
    onUpdate() {},
    requestFrame: frames.requestFrame,
  });
  const hold = createVisitorHold({ scheduler });
  scheduler.start();
  hold.dispose();
  assert.equal(hold.set(true), false);
  hold.reveal();
  hold.redraw();
  assert.equal("suspend" in hold, false, "nothing lifts the hold behind the visitor's back");
  assert.equal(hold.held, false);
  assert.equal(scheduler.getState().held, false);
  scheduler.dispose();
});
