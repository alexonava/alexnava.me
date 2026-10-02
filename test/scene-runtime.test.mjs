import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import {
  createDeferredQualityStep,
  createPanelHold,
  createPixelRatioWatcher,
  createRefreshEstimator,
  createSceneFrameScheduler,
  createSceneResizeController,
  disposeSceneRuntimeResources,
  hasMeaningfulScalarChange,
  renderDivisor,
} from "../src/scene/runtime.js";
import {
  createSceneSubsystemRegistry,
  normalizeSceneSubsystem,
  runSceneInitialization,
} from "../src/scene/subsystem.js";
import { createSceneRendering } from "../src/scene/rendering.js";

const flush = () => new Promise((resolve) => setImmediate(resolve));

test("a deferred quality step lands on the first tour cut after its programs are prepared", async () => {
  const prepares = [];
  const steps = createDeferredQualityStep({
    prepare: (profile) =>
      new Promise((resolve, reject) => prepares.push({ profile, resolve, reject })),
  });
  const balanced = { tier: "balanced" };
  const high = { tier: "high" };
  assert.equal(steps.pending, false);
  assert.equal(steps.take({ cut: true, running: true, nowMs: 0 }), null);

  steps.queue(balanced, 1000);
  assert.equal(steps.pending, true);
  assert.deepEqual(
    prepares.map(({ profile }) => profile),
    [balanced],
    "linking starts at once",
  );
  assert.equal(
    steps.take({ cut: false, running: true, nowMs: 1100 }),
    null,
    "a running tour waits",
  );
  assert.equal(
    steps.take({ cut: true, running: true, nowMs: 1200 }),
    null,
    "a cut waits for the programs",
  );
  prepares[0].resolve(true);
  await flush();
  assert.equal(steps.take({ cut: false, running: true, nowMs: 1300 }), null);
  assert.equal(steps.take({ cut: true, running: true, nowMs: 1400 }), balanced);
  assert.equal(steps.pending, false);
  assert.equal(steps.take({ cut: true, running: true, nowMs: 1500 }), null, "a step applies once");

  steps.queue(balanced, 2000);
  steps.queue(high, 2100);
  prepares[1].resolve(true);
  await flush();
  assert.equal(
    steps.take({ cut: true, running: true, nowMs: 2200 }),
    null,
    "a newer step replaces it",
  );
  prepares[2].reject(new Error("context lost"));
  await flush();
  assert.equal(
    steps.take({ cut: true, running: true, nowMs: 2300 }),
    high,
    "a failed link still lands",
  );

  steps.queue(balanced, 3000);
  assert.equal(
    steps.take({ cut: false, running: false, nowMs: 3001 }),
    balanced,
    "no tour, no wait",
  );

  steps.queue(high, 4000);
  assert.equal(steps.take({ cut: false, running: true, nowMs: 33999 }), null);
  assert.equal(steps.take({ cut: false, running: true, nowMs: 34000 }), high, "30 s at most");

  const throwing = createDeferredQualityStep({
    prepare() {
      throw new Error("compile failed");
    },
  });
  throwing.queue(balanced, 0);
  assert.equal(throwing.take({ cut: true, running: true, nowMs: 1 }), balanced);
});

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

test("touch frame stride keeps render delta while sampling each rAF interval", () => {
  const frames = createFrameHarness();
  const updates = [];
  const scheduler = createSceneFrameScheduler({
    cancelFrame: frames.cancelFrame,
    frameStride: 2,
    onUpdate(frame) {
      updates.push(frame);
    },
    requestFrame: frames.requestFrame,
  });

  scheduler.start();
  frames.step(0);
  frames.step(16);
  frames.step(32);
  frames.step(48);

  assert.equal(updates.length, 2);
  assert.ok(Math.abs(updates[1].deltaSeconds - 0.032) < 1e-9);
  assert.ok(Math.abs(updates[1].sampleDeltaSeconds - 0.016) < 1e-9);
  scheduler.dispose();
});

test("default scheduler renders every display frame for a 60 Hz-capable path", () => {
  const frames = createFrameHarness();
  const updates = [];
  const scheduler = createSceneFrameScheduler({
    cancelFrame: frames.cancelFrame,
    onUpdate(frame) {
      updates.push(frame);
    },
    requestFrame: frames.requestFrame,
  });

  scheduler.start();
  frames.step(0);
  frames.step(16);
  frames.step(32);
  frames.step(48);

  assert.equal(updates.length, 4);
  assert.ok(Math.abs(updates.at(-1).sampleDeltaSeconds - 0.016) < 1e-9);
  scheduler.dispose();
});

test("target frame rate holds scene rendering near 60 FPS on high-refresh displays", () => {
  const frames = createFrameHarness();
  const updates = [];
  const scheduler = createSceneFrameScheduler({
    cancelFrame: frames.cancelFrame,
    onUpdate(frame) {
      updates.push(frame);
    },
    requestFrame: frames.requestFrame,
    targetFrameRate: 60,
  });

  scheduler.start();
  for (let frame = 0; frame <= 240; frame += 1) {
    frames.step((frame * 1000) / 240);
  }

  assert.ok(updates.length >= 60 && updates.length <= 62);
  assert.ok(Math.abs(updates.at(-1).elapsedSeconds - 1) < 1e-9);
  scheduler.dispose();
});

test("60 FPS target preserves every frame on a 60 Hz display", () => {
  const frames = createFrameHarness();
  let updates = 0;
  const scheduler = createSceneFrameScheduler({
    cancelFrame: frames.cancelFrame,
    onUpdate() {
      updates += 1;
    },
    requestFrame: frames.requestFrame,
    targetFrameRate: 60,
  });

  scheduler.start();
  for (let frame = 0; frame <= 60; frame += 1) {
    frames.step((frame * 1000) / 60);
  }

  assert.equal(updates, 61);
  scheduler.dispose();
});

test("render divisors keep desktops at or above 60 fps and touch screens at or below it", () => {
  const rates = [60, 75, 90, 120, 144, 165, 240];
  assert.deepEqual(
    rates.map((hz) => renderDivisor(hz)),
    [1, 1, 1, 2, 2, 2, 4],
  );
  assert.deepEqual(
    [30, ...rates].map((hz) => renderDivisor(hz, { round: "ceil" })),
    [1, 1, 2, 2, 2, 3, 3, 4],
  );
  assert.equal(renderDivisor(0), 1);
  assert.equal(renderDivisor(Number.NaN, { round: "ceil" }), 1);
});

test("the refresh estimator snaps, adopts on two agreeing estimates and keeps its rate", () => {
  const estimator = createRefreshEstimator();
  const feed = (ms, count) => {
    for (let index = 0; index < count; index += 1) estimator.sample(ms);
    return estimator.hz;
  };
  assert.equal(feed(1000 / 144, 16), 0, "one estimate is only a candidate");
  assert.equal(feed(1000 / 144 + 0.1, 16), 144);
  assert.equal(feed(1, 40), 144, "intervals under 2.5 ms are ignored");
  assert.equal(feed(80, 40), 144, "and so are stalls over 40 ms");
  assert.equal(feed(1000 / 60, 32), 144, "a switch waits for the old intervals to age out");
  assert.equal(feed(1000 / 60, 16), 60);
  assert.equal(feed(1000 / 110, 64), 60, "a rate far from any common one is not adopted");
  estimator.reset();
  assert.equal(estimator.hz, 60, "a reset keeps the adopted rate");
  assert.equal(feed(1000 / 90, 16), 60, "and restarts the samples");
  assert.equal(feed(1000 / 90, 16), 90);
});

// Steps a scheduler through display frames, each timestamp from at(frame).
function runCadence({ round, frames: count, at, skip = () => false }) {
  const frames = createFrameHarness();
  const updates = [];
  const scheduler = createSceneFrameScheduler({
    cancelFrame: frames.cancelFrame,
    displayCadence: { baseRate: 60, round },
    onUpdate(frame) {
      updates.push(frame);
    },
    requestFrame: frames.requestFrame,
  });
  scheduler.start();
  for (let frame = 0; frame <= count; frame += 1) {
    if (!skip(frame)) frames.step(at(frame));
  }
  scheduler.dispose();
  return updates;
}

function lastSecond(updates, end) {
  const inWindow = updates.filter(({ timestamp }) => timestamp >= end - 1000 && timestamp < end);
  const intervals = inWindow
    .slice(1)
    .map((update, index) => update.timestamp - inWindow[index].timestamp);
  return { count: inWindow.length, intervals, updates: inWindow };
}

test("a display cadence renders every nth vsync, evenly, at common refresh rates", () => {
  for (const [hz, round, divisor, perSecond] of [
    [60, "floor", 1, 60],
    [90, "floor", 1, 90],
    [144, "floor", 2, 72],
    [240, "floor", 4, 60],
    [90, "ceil", 2, 45],
    [120, "ceil", 2, 60],
  ]) {
    const vsync = 1000 / hz;
    const updates = runCadence({ round, frames: 2 * hz, at: (frame) => frame * vsync });
    const { count, intervals } = lastSecond(updates, 2000 - vsync / 2);
    const label = `${hz} Hz ${round}`;
    assert.ok(Math.abs(count - perSecond) <= 1, `${label}: ${count} frames`);
    for (const interval of intervals) {
      assert.ok(Math.abs(interval - divisor * vsync) < 1e-6, `${label}: ${interval} ms`);
    }
  }

  // Timestamps a little off the vsync grid keep the cadence.
  const vsync = 1000 / 144;
  const jittered = runCadence({
    round: "floor",
    frames: 288,
    at: (frame) => frame * vsync + (((frame * 7) % 5) - 2) * 0.05,
  });
  const { intervals } = lastSecond(jittered, 2000);
  assert.ok(
    intervals.every((interval) => Math.abs(interval - 2 * vsync) < 0.5),
    "72 fps, even",
  );
});

test("a display cadence starts at the base rate, follows a monitor switch and never bursts", () => {
  const fast = 1000 / 144;
  const start = runCadence({ round: "floor", frames: 288, at: (frame) => frame * fast });
  const early = start.filter(({ timestamp }) => timestamp < 200);
  assert.equal(early.length, 12, "until a rate is adopted it caps at 60 fps");

  const slow = 1000 / 60;
  const quick = 1000 / 240;
  const switched = runCadence({
    round: "floor",
    frames: 120 + 480,
    at: (frame) => (frame <= 120 ? frame * slow : 2000 + (frame - 120) * quick),
  });
  const settled = lastSecond(switched, 3500);
  assert.ok(Math.abs(settled.count - 60) <= 1, "240 Hz is adopted within half a second");
  assert.ok(settled.intervals.every((interval) => Math.abs(interval - 4 * quick) < 1e-6));

  // A late frame re-phases the cadence instead of drawing twice in a row.
  const missed = runCadence({
    round: "floor",
    frames: 288,
    at: (frame) => frame * fast,
    skip: (frame) => frame % 37 === 0 && frame > 60,
  });
  const { intervals } = lastSecond(missed, 2000);
  assert.ok(
    intervals.every((interval) => interval > 2 * fast - 1e-6),
    "no back-to-back renders",
  );
  assert.ok(intervals.some((interval) => interval > 2 * fast + 1e-6));
});

test("on a cadence the governor's sample reads a met cadence as 60 fps and counts late vsyncs", () => {
  const vsync = 1000 / 90;
  const updates = runCadence({ round: "ceil", frames: 180, at: (frame) => frame * vsync });
  const { updates: settled } = lastSecond(updates, 2000);
  assert.ok(settled.length >= 44);
  for (const { deltaSeconds, sampleDeltaSeconds } of settled) {
    assert.ok(Math.abs(deltaSeconds - 2 / 90) < 1e-9, "scene time advances by the render interval");
    assert.ok(Math.abs(sampleDeltaSeconds - 1 / 60) < 1e-9, "a met 45 fps cadence reads as 60 fps");
  }

  // A due render that lands a vsync late reports the lost vsync in full.
  const due = Math.round(settled.at(-10).timestamp / vsync) + 2;
  const late = runCadence({
    round: "ceil",
    frames: 180,
    at: (frame) => frame * vsync,
    skip: (frame) => frame === due,
  });
  const after = late.find(({ timestamp }) => timestamp > due * vsync);
  assert.ok(Math.abs(after.timestamp - (due + 1) * vsync) < 1e-6);
  assert.ok(Math.abs(after.sampleDeltaSeconds - (1 / 60 + 1 / 90)) < 1e-9);

  // A 120 Hz phone that keeps missing its 60 fps cadence by a vsync (40 fps)
  // reads as pressure, as 25 ms frames would on a 60 Hz screen.
  const fast = 1000 / 120;
  const strained = runCadence({
    round: "ceil",
    frames: 160,
    at: (frame) => (frame <= 120 ? frame * fast : 1000 + (frame - 120) * 25),
  });
  const slow = strained.filter(({ timestamp }) => timestamp > 1100);
  assert.ok(slow.length >= 30);
  assert.ok(slow.every(({ sampleDeltaSeconds }) => Math.abs(sampleDeltaSeconds - 0.025) < 1e-9));

  // Faster than 60 fps (144 Hz renders 72), a met cadence also reads as 60 fps
  // and a late render reports its real interval, as on a 60 Hz screen.
  const quick = 1000 / 144;
  const run144 = (skip) =>
    runCadence({ round: "floor", frames: 288, at: (frame) => frame * quick, skip });
  const { updates: met } = lastSecond(
    run144(() => false),
    2000,
  );
  assert.ok(met.length >= 70);
  assert.ok(met.every(({ sampleDeltaSeconds }) => Math.abs(sampleDeltaSeconds - 1 / 60) < 1e-9));
  const missed = Math.round(met.at(-10).timestamp / quick) + 2;
  const late144 = run144((frame) => frame === missed).find(
    ({ timestamp }) => timestamp > missed * quick,
  );
  assert.ok(Math.abs(late144.timestamp - (missed + 1) * quick) < 1e-6);
  assert.ok(Math.abs(late144.sampleDeltaSeconds - 3 / 144) < 1e-9, "one late vsync, not 1/60 more");
});

test("reduced motion freezes scene time and renders only dirty frames", () => {
  const frames = createFrameHarness();
  const updates = [];
  const scheduler = createSceneFrameScheduler({
    cancelFrame: frames.cancelFrame,
    onUpdate(frame) {
      updates.push(frame);
    },
    reducedMotion: true,
    requestFrame: frames.requestFrame,
  });

  scheduler.start();
  frames.step(0);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].elapsedSeconds, 0);
  assert.equal(frames.pending, 0, "static mode does not retain a frame loop");

  scheduler.invalidate();
  scheduler.invalidate();
  assert.equal(frames.pending, 1, "multiple invalidations coalesce");
  frames.step(1000);
  assert.equal(updates.length, 2);
  assert.equal(updates[1].elapsedSeconds, 0);

  scheduler.setReducedMotion(false);
  frames.step(1016);
  frames.step(1032);
  assert.ok(updates.at(-1).elapsedSeconds > 0, "live toggle resumes scene time");
  scheduler.dispose();
});

test("named holds stop rendering and scheduling until the last one is released", () => {
  const frames = createFrameHarness();
  const updates = [];
  const scheduler = createSceneFrameScheduler({
    cancelFrame: frames.cancelFrame,
    onUpdate(frame) {
      updates.push(frame);
    },
    requestFrame: frames.requestFrame,
  });

  scheduler.start();
  frames.step(0);
  frames.step(16);
  assert.equal(updates.length, 2);

  assert.equal(scheduler.setHold("panel", true), true);
  assert.equal(frames.pending, 0, "a hold cancels the queued frame");
  scheduler.setHold("visitor", true);
  scheduler.invalidate();
  scheduler.resume();
  scheduler.setReducedMotion(true);
  scheduler.setReducedMotion(false);
  assert.equal(frames.pending, 0, "held scheduler ignores invalidation and resume");
  assert.deepEqual(
    { held: scheduler.getState().held, scheduled: scheduler.getState().scheduled },
    { held: true, scheduled: false },
  );

  assert.equal(scheduler.setHold("panel", false), true);
  assert.equal(frames.pending, 0, "another reason still holds");
  assert.equal(scheduler.setHold("visitor", false), false);
  assert.equal(frames.pending, 1, "releasing the last hold resumes");
  const elapsedBefore = updates.at(-1).elapsedSeconds;
  frames.step(60_000);
  assert.equal(updates.length, 3);
  assert.equal(updates.at(-1).deltaSeconds, 0, "no giant delta after a long hold");
  assert.equal(updates.at(-1).elapsedSeconds, elapsedBefore);
  frames.step(60_016);
  assert.ok(Math.abs(updates.at(-1).deltaSeconds - 0.016) < 1e-9);
  scheduler.dispose();
});

test("a hold set before start keeps the scheduler idle until released", () => {
  const frames = createFrameHarness();
  let updates = 0;
  const scheduler = createSceneFrameScheduler({
    cancelFrame: frames.cancelFrame,
    onUpdate() {
      updates += 1;
    },
    requestFrame: frames.requestFrame,
  });

  scheduler.setHold("panel", true);
  scheduler.start();
  assert.equal(frames.pending, 0);
  scheduler.setHold("panel", false);
  frames.step(0);
  assert.equal(updates, 1);
  scheduler.dispose();
});

test("still mode renders only invalidated frames and returns to animation", () => {
  const frames = createFrameHarness();
  const updates = [];
  const scheduler = createSceneFrameScheduler({
    cancelFrame: frames.cancelFrame,
    onUpdate(frame) {
      updates.push(frame);
    },
    requestFrame: frames.requestFrame,
    targetFrameRate: 60,
  });

  scheduler.start();
  frames.step(0);
  scheduler.setStill(true);
  frames.step(16);
  assert.equal(updates.length, 1, "the already queued frame does not render");
  assert.equal(frames.pending, 0, "still mode drops the continuous loop");

  scheduler.invalidate();
  scheduler.invalidate();
  assert.equal(frames.pending, 1);
  frames.step(5000);
  assert.equal(updates.length, 2);
  assert.equal(updates[1].deltaSeconds, 0);
  assert.equal(updates[1].elapsedSeconds, 0);
  assert.equal(updates[1].reducedMotion, false, "still mode is not a motion preference");
  assert.equal(frames.pending, 0);

  scheduler.setStill(false);
  frames.step(5016);
  frames.step(5032);
  assert.equal(updates.length, 4);
  assert.equal(updates[2].deltaSeconds, 0, "leaving still mode does not carry the idle gap");
  assert.ok(Math.abs(updates[3].elapsedSeconds - 0.016) < 1e-9);
  assert.equal(frames.pending, 1, "animation continues");
  scheduler.dispose();
});

test("still mode composes with reduced motion", () => {
  const frames = createFrameHarness();
  let updates = 0;
  const scheduler = createSceneFrameScheduler({
    cancelFrame: frames.cancelFrame,
    onUpdate() {
      updates += 1;
    },
    reducedMotion: true,
    requestFrame: frames.requestFrame,
  });

  scheduler.start();
  frames.step(0);
  scheduler.setStill(true);
  scheduler.setStill(false);
  assert.equal(frames.pending, 0, "reduced motion stays static either way");
  assert.equal(updates, 1);
  assert.equal("forceAnimation" in scheduler.getState(), false);
  scheduler.invalidate();
  frames.step(16);
  assert.equal(updates, 2, "an invalidated still frame draws once");
  assert.equal(frames.pending, 0);
  scheduler.dispose();
});

function createTimers() {
  let nextId = 1;
  const timers = new Map();
  return {
    clearTimer(id) {
      timers.delete(id);
    },
    get delays() {
      return [...timers.values()].map(({ delay }) => delay);
    },
    fire() {
      const entries = [...timers.values()];
      timers.clear();
      entries.forEach(({ callback }) => callback());
    },
    setTimer(callback, delay) {
      const id = nextId++;
      timers.set(id, { callback, delay });
      return id;
    },
  };
}

function createPanelHarness() {
  const frames = createFrameHarness();
  const timers = createTimers();
  const state = { open: false, releases: 0, rendered: 0 };
  const scheduler = createSceneFrameScheduler({
    cancelFrame: frames.cancelFrame,
    onUpdate() {
      state.rendered += 1;
      hold.frameRendered();
    },
    requestFrame: frames.requestFrame,
  });
  const hold = createPanelHold({
    clearTimer: timers.clearTimer,
    delayMs: 450,
    isOpen: () => state.open,
    onRelease: () => (state.releases += 1),
    scheduler,
    setTimer: timers.setTimer,
  });
  scheduler.start();
  frames.step(0);
  return { frames, hold, scheduler, state, timers };
}

test("a dialog holds rendering once its overlay fades in and releases with the last dialog", () => {
  const { frames, hold, scheduler, state, timers } = createPanelHarness();

  hold.sync();
  assert.deepEqual(timers.delays, [], "no dialog, no hold");
  state.open = true;
  hold.sync();
  hold.sync();
  assert.deepEqual(timers.delays, [450], "repeated mutations keep one pending hold");
  frames.step(16);
  assert.equal(state.rendered, 2, "the scene keeps drawing while the overlay fades in");
  timers.fire();
  assert.equal(hold.held, true);
  assert.equal(scheduler.getState().held, true);
  assert.equal(frames.pending, 0, "nothing is scheduled behind the dialog");

  state.open = false;
  hold.sync();
  assert.equal(hold.held, false);
  assert.equal(state.releases, 1);
  assert.equal(frames.pending, 1, "closing the last dialog resumes the scene");

  state.open = true;
  hold.sync();
  state.open = false;
  hold.sync();
  assert.deepEqual(timers.delays, [], "a dialog closed during the fade cancels its hold");
  assert.equal(state.releases, 1, "no hold was taken, so none is released");

  state.open = true;
  hold.sync();
  hold.dispose();
  assert.deepEqual(timers.delays, [], "disposal clears a pending hold");
  scheduler.dispose();
});

test("a resize behind a held dialog draws one frame and holds again", () => {
  const { frames, hold, scheduler, state, timers } = createPanelHarness();
  state.open = true;
  hold.sync();
  timers.fire();
  const rendered = state.rendered;

  hold.redraw();
  assert.equal(hold.held, false);
  assert.equal(frames.pending, 1, "the cleared canvas is redrawn");
  assert.deepEqual(timers.delays, [], "without another overlay delay");
  frames.step(100);
  assert.equal(state.rendered, rendered + 1);
  assert.equal(hold.held, true, "the first drawn frame restores the hold");
  assert.equal(frames.pending, 0, "no animation continues behind the dialog");
  hold.redraw();
  hold.redraw();
  frames.step(200);
  assert.equal(state.rendered, rendered + 2);
  assert.equal(frames.pending, 0);

  hold.redraw();
  state.open = false;
  hold.sync();
  assert.equal(state.releases, 1, "closing during the redraw still releases the hold");
  frames.step(300);
  assert.equal(hold.held, false, "a closed dialog is not held again");
  assert.equal(frames.pending, 1);

  hold.redraw();
  assert.equal(hold.held, false, "an unheld scene needs no redraw release");
  scheduler.dispose();
});

test("resize controller coalesces bursts and skips unchanged viewport sizes", () => {
  const frames = createFrameHarness();
  const applied = [];
  let size = { width: 800, height: 600, pixelRatio: 1 };
  const resize = createSceneResizeController({
    cancelFrame: frames.cancelFrame,
    onResize(next) {
      applied.push(next);
    },
    readSize() {
      return size;
    },
    requestFrame: frames.requestFrame,
  });

  assert.equal(resize.update({ force: true }), true);
  resize.resize();
  resize.resize();
  assert.equal(frames.pending, 1);
  frames.step(0);
  assert.equal(applied.length, 1, "same-size resize is a no-op");

  size = { width: 900, height: 600, pixelRatio: 1 };
  resize.resize();
  resize.resize();
  frames.step(16);
  assert.equal(applied.length, 2);
  assert.deepEqual(applied[1], size);

  size = { width: 900, height: 600, pixelRatio: 2 };
  resize.resize();
  frames.step(32);
  assert.equal(applied.length, 3, "DPR-only changes reapply renderer sizing");
  assert.deepEqual(applied[2], size);
  resize.dispose();
});

// A matchMedia stand-in: each query keeps its change listeners and can fire them.
function createMediaHarness() {
  const queries = [];
  return {
    queries,
    matchMedia(media) {
      const listeners = new Set();
      const query = {
        media,
        get listeners() {
          return listeners.size;
        },
        addEventListener(type, listener) {
          assert.equal(type, "change");
          listeners.add(listener);
        },
        removeEventListener(type, listener) {
          if (type === "change") listeners.delete(listener);
        },
        fire() {
          for (const listener of [...listeners]) listener({ matches: false, media });
        },
      };
      queries.push(query);
      return query;
    },
  };
}

test("the pixel-ratio watcher re-arms on each change and stops after dispose", () => {
  const media = createMediaHarness();
  const changes = [];
  let ratio = 1;
  const watcher = createPixelRatioWatcher({
    getRatio: () => ratio,
    matchMedia: media.matchMedia,
    onChange: () => changes.push(ratio),
  });
  assert.equal(watcher.watching, true);
  assert.deepEqual(
    media.queries.map((query) => query.media),
    ["(resolution: 1dppx)"],
  );

  ratio = 2;
  media.queries[0].fire();
  assert.deepEqual(changes, [2]);
  assert.equal(media.queries[0].listeners, 0, "a spent query lets go");
  assert.equal(media.queries[1].media, "(resolution: 2dppx)");
  assert.equal(media.queries[1].listeners, 1, "it re-arms on the new ratio");

  ratio = 1.25;
  media.queries[1].fire();
  assert.deepEqual(changes, [2, 1.25]);
  assert.equal(media.queries[2].media, "(resolution: 1.25dppx)");

  assert.equal(watcher.dispose(), true);
  assert.equal(watcher.dispose(), false);
  assert.equal(watcher.watching, false);
  assert.equal(media.queries[2].listeners, 0);
  media.queries[2].fire();
  assert.deepEqual(changes, [2, 1.25], "nothing reports after dispose");
  assert.equal(media.queries.length, 3, "nothing re-arms after dispose");
});

test("a pixel-ratio change alone reapplies the renderer size through the resize controller", () => {
  const frames = createFrameHarness();
  const media = createMediaHarness();
  const applied = [];
  let size = { width: 1600, height: 900, pixelRatio: 1 };
  const resize = createSceneResizeController({
    cancelFrame: frames.cancelFrame,
    onResize: (next) => applied.push(next),
    readSize: () => size,
    requestFrame: frames.requestFrame,
  });
  const watcher = createPixelRatioWatcher({
    getRatio: () => size.pixelRatio,
    matchMedia: media.matchMedia,
    onChange: () => resize.resize(),
  });
  resize.update({ force: true });
  size = { ...size, pixelRatio: 2 };
  media.queries.at(-1).fire();
  frames.step(16);
  assert.deepEqual(applied, [
    { width: 1600, height: 900, pixelRatio: 1 },
    { width: 1600, height: 900, pixelRatio: 2 },
  ]);
  watcher.dispose();
  resize.dispose();
});

test("the pixel-ratio watcher idles without a usable matchMedia", () => {
  const onChange = () => assert.fail("no change can be reported");
  for (const matchMedia of [
    null,
    () => {
      throw new Error("unsupported query");
    },
    () => null,
    // Pre-2020 Safari: a MediaQueryList with only addListener.
    () => ({ addListener() {}, removeListener() {} }),
  ]) {
    const watcher = createPixelRatioWatcher({ getRatio: () => 2, matchMedia, onChange });
    assert.equal(watcher.watching, false);
    assert.equal(watcher.dispose(), true);
  }
  assert.throws(() => createPixelRatioWatcher({ matchMedia: null }), TypeError);
});

test("stable scalar values do not request redundant buffer uploads", () => {
  assert.equal(hasMeaningfulScalarChange(undefined, 1), true);
  assert.equal(hasMeaningfulScalarChange(1, 1), false);
  assert.equal(hasMeaningfulScalarChange(1, 1.00001), false);
  assert.equal(hasMeaningfulScalarChange(1, 1.01), true);
});

test("runtime resource disposal deduplicates scene assets and leaves render-target textures owned", () => {
  const calls = {
    canvasRemoved: 0,
    contextLost: 0,
    geometry: 0,
    material: 0,
    pipeline: 0,
    renderer: 0,
    renderTarget: 0,
    renderTargetTexture: 0,
    sceneCleared: 0,
    texture: 0,
  };
  const texture = { isTexture: true, dispose: () => (calls.texture += 1) };
  const renderTargetTexture = {
    isTexture: true,
    dispose: () => (calls.renderTargetTexture += 1),
  };
  const geometry = { dispose: () => (calls.geometry += 1) };
  const material = {
    map: texture,
    envMap: renderTargetTexture,
    uniforms: { uMap: { value: texture } },
    dispose: () => (calls.material += 1),
  };
  const renderTarget = {
    isWebGLRenderTarget: true,
    texture: renderTargetTexture,
    dispose: () => (calls.renderTarget += 1),
  };
  const objects = [{ geometry, material }, { geometry, material }, { renderTarget }];
  const scene = {
    background: texture,
    clear() {
      calls.sceneCleared += 1;
    },
    traverse(visitor) {
      objects.forEach(visitor);
    },
  };
  const canvasParent = {
    removeChild() {
      calls.canvasRemoved += 1;
    },
  };
  const renderer = {
    dispose() {
      calls.renderer += 1;
    },
    domElement: { parentNode: canvasParent },
    forceContextLoss() {
      calls.contextLost += 1;
    },
  };
  const postprocessPipeline = {
    dispose() {
      calls.pipeline += 1;
    },
  };

  const disposed = disposeSceneRuntimeResources({
    postprocessPipeline,
    renderer,
    renderTargets: [renderTarget],
    scene,
  });

  assert.deepEqual(disposed, {
    geometries: 1,
    materials: 1,
    renderTargets: 1,
    textures: 1,
  });
  assert.equal(calls.geometry, 1);
  assert.equal(calls.material, 1);
  assert.equal(calls.texture, 1);
  assert.equal(calls.renderTarget, 1);
  assert.equal(calls.renderTargetTexture, 0, "render target owns its texture disposal");
  assert.equal(calls.pipeline, 1);
  assert.equal(calls.renderer, 1);
  assert.equal(calls.contextLost, 1);
  assert.equal(calls.canvasRemoved, 1);
  assert.equal(calls.sceneCleared, 1);
});

test("scene subsystem normalization supplies bound no-op lifecycle hooks", () => {
  const source = {
    name: "bound",
    update() {
      return this.name;
    },
  };
  const subsystem = normalizeSceneSubsystem(source);

  assert.equal(subsystem.update(), "bound");
  assert.equal(subsystem.resize(), undefined);
  assert.equal(subsystem.applyQuality(), undefined);
  assert.equal(subsystem.dispose(), undefined);
});

test("scene subsystem registry invokes in order and disposes once in reverse order", () => {
  const calls = [];
  const registry = createSceneSubsystemRegistry([
    {
      update() {
        calls.push("update-a");
      },
      resize() {
        calls.push("resize-a");
      },
      applyQuality() {
        calls.push("quality-a");
      },
      dispose() {
        calls.push("dispose-a");
      },
    },
    {
      update() {
        calls.push("update-b");
      },
      resize() {
        calls.push("resize-b");
      },
      applyQuality() {
        calls.push("quality-b");
      },
      dispose() {
        calls.push("dispose-b");
      },
    },
  ]);

  registry.update();
  registry.resize();
  registry.applyQuality();
  assert.deepEqual(calls, [
    "update-a",
    "update-b",
    "resize-a",
    "resize-b",
    "quality-a",
    "quality-b",
  ]);

  assert.equal(registry.dispose(), true);
  assert.equal(registry.dispose(), false);
  assert.deepEqual(calls.slice(-2), ["dispose-b", "dispose-a"]);
  assert.equal(registry.update(), false);
  assert.throws(() => registry.register({}), /after disposal/);
});

test("scene subsystem registry honors deterministic lifecycle order without changing reverse disposal", () => {
  const calls = [];
  const registry = createSceneSubsystemRegistry();
  registry.register({
    lifecycleOrder: 100,
    update() {
      calls.push("render");
    },
    dispose() {
      calls.push("dispose-render");
    },
  });
  registry.register({
    lifecycleOrder: 10,
    update() {
      calls.push("environment");
    },
    dispose() {
      calls.push("dispose-environment");
    },
  });
  registry.register({
    lifecycleOrder: 30,
    update() {
      calls.push("atmosphere");
    },
    dispose() {
      calls.push("dispose-atmosphere");
    },
  });

  registry.update();
  assert.deepEqual(calls, ["environment", "atmosphere", "render"]);
  registry.dispose();
  assert.deepEqual(calls.slice(-3), [
    "dispose-atmosphere",
    "dispose-environment",
    "dispose-render",
  ]);
});

test("failed scene initialization disposes registered systems and rethrows the original error", () => {
  const calls = [];
  const original = new Error("construction failed");
  const registry = createSceneSubsystemRegistry([
    {
      dispose() {
        calls.push("dispose");
      },
    },
  ]);

  assert.throws(
    () =>
      runSceneInitialization(registry, () => {
        throw original;
      }),
    (error) => error === original,
  );
  assert.deepEqual(calls, ["dispose"]);
  assert.equal(registry.disposed, true);
});

function createProfile() {
  return {
    lighting: {
      ambientIntensity: 0.22,
      directionalIntensity: 2.9,
      extraDirectional: true,
      fillIntensity: 0.31,
      fogFar: 150,
      fogNear: 62,
      hemisphereIntensity: 0.71,
    },
    shadows: {
      enabled: true,
      mapSize: 1024,
    },
  };
}

test("scene rendering owns quality, sizing, rendering, and disposal lifecycle", () => {
  const calls = [];
  let contextLost = false;
  let rendererOptions = null;
  let rendererRatio = 1;
  let composerRatio = 1;
  const renderer = {
    capabilities: { getMaxAnisotropy: () => 8 },
    domElement: {},
    outputColorSpace: null,
    shadowMap: {},
    getContext: () => ({ isContextLost: () => contextLost }),
    getPixelRatio: () => rendererRatio,
    setClearColor: (...args) => calls.push(["clear", ...args]),
    setPixelRatio: (value) => {
      rendererRatio = value;
      calls.push(["pixelRatio", value]);
    },
    setSize: (...args) => calls.push(["rendererSize", ...args]),
  };
  const composer = {
    addPass: () => calls.push(["passAdded"]),
    render: () => {
      if (contextLost) throw new TypeError("Shader log is null before contextlost dispatch");
      calls.push(["render"]);
    },
    setPixelRatio: (value) => {
      composerRatio = value;
      calls.push(["composerPixelRatio", value]);
    },
    setSize: (...args) => calls.push(["composerSize", ...args]),
  };
  const pipeline = {
    composer,
    resize: (...args) => calls.push(["postprocessSize", ...args]),
    setQualityProfile: (profile) => calls.push(["quality", profile]),
  };
  let disposedOptions = null;
  const profile = createProfile();
  const rendering = createSceneRendering({
    container: {
      appendChild(node) {
        assert.equal(node, renderer.domElement);
      },
    },
    createPipeline: () => pipeline,
    createRenderer: (options) => {
      rendererOptions = options;
      return renderer;
    },
    disposeResources(options) {
      disposedOptions = options;
      return { geometries: 1 };
    },
    height: 600,
    lighting: {
      ambientColor: 0xffffff,
      ambientIntensity: 0.22,
      directionalColor: 0xffffff,
      directionalIntensity: 2.9,
      directionalPosition: { x: 21, y: 29, z: 23 },
      fogColor: 0x222222,
      fogFar: 150,
      fogNear: 62,
      hemisphereGroundColor: 0x111111,
      hemisphereIntensity: 0.71,
      hemisphereSkyColor: 0x888888,
    },
    profile,
    threeExports: {},
    width: 800,
    world: {
      CAMERA_FAR: 210,
      CAMERA_FOV: 48,
      CAMERA_NEAR: 0.5,
      FILL_LIGHT_POSITION: [-20, 14, -18],
      SHADOW_CAMERA_FAR: 120,
      SHADOW_CAMERA_HALF_EXTENT: 34,
      SHADOW_CAMERA_NEAR: 0.5,
    },
  });

  assert.equal(rendering.lights.fill.visible, true);
  assert.equal(rendering.lights.fill.intensity, 0.58);
  assert.equal(rendererOptions.antialias, false, "only the composer targets multisample");
  rendering.applyQuality(profile, { pixelRatio: 1.5 });
  assert.equal(rendererRatio, 1.5);
  assert.equal(composerRatio, rendererRatio, "composer targets follow the canvas pixel ratio");
  assert.equal(
    calls.some((entry) => entry[0] === "postprocessSize"),
    false,
    "the ink contour's CSS-pixel texels ignore the pixel ratio",
  );
  assert.equal(rendering.lights.fill.intensity, 0.31);
  rendering.setGroundedLighting(true);
  assert.equal(rendering.lights.sun.color.getHex(), 0xd9e2f2);
  assert.equal(rendering.lights.sun.intensity, 2.9 * 0.8);
  assert.equal(rendering.lights.fill.intensity, 0.31 * 1.5);
  rendering.applyQuality(profile);
  assert.equal(rendering.lights.sun.intensity, 2.9 * 0.8);
  assert.equal(rendering.lights.fill.intensity, 0.31 * 1.5);
  rendering.applyQuality({
    ...profile,
    lighting: { ...profile.lighting, directionalIntensity: 2, fillIntensity: 0.2 },
  });
  assert.equal(rendering.lights.sun.intensity, 1.6);
  assert.equal(rendering.lights.fill.intensity, 0.2 * 1.5);
  rendering.setGroundedLighting(false);
  assert.equal(rendering.lights.sun.intensity, 2);
  assert.equal(rendering.lights.fill.intensity, 0.2);
  rendering.applyQuality(profile);
  assert.equal(rendering.lights.sun.color.getHex(), 0xffffff);
  assert.equal(rendering.lights.sun.intensity, 2.9);
  assert.equal(rendering.lights.fill.intensity, 0.31);
  const beforePosition = rendering.lights.sun.position.clone(),
    beforeTarget = rendering.lights.sun.target.position.clone();
  const direction = beforePosition.clone().sub(beforeTarget);
  rendering.setFilmTreatment(true);
  rendering.focusFilmShadow(new beforeTarget.constructor(55, 8, 36), 12);
  assert.ok(
    rendering.lights.sun.position
      .clone()
      .sub(rendering.lights.sun.target.position)
      .distanceTo(direction) < 1e-6,
  );
  assert.equal(rendering.lights.sun.shadow.camera.left, -32);
  rendering.applyQuality(profile);
  assert.equal(rendering.lights.fill.intensity, 0.31 * 1.66);
  rendering.setFilmTreatment(false);
  assert.deepEqual(rendering.lights.sun.position.toArray(), beforePosition.toArray());
  assert.deepEqual(rendering.lights.sun.target.position.toArray(), beforeTarget.toArray());
  assert.equal(rendering.lights.sun.shadow.camera.left, -34);

  rendering.applyQuality({
    ...profile,
    lighting: {
      ...profile.lighting,
      extraDirectional: false,
      fillIntensity: 0,
    },
  });
  assert.equal(rendering.lights.fill.visible, false);
  assert.equal(rendering.lights.fill.intensity, 0);
  rendering.resize({ cameraFov: 52, height: 400, width: 900 });
  rendering.update();
  const renderedBeforeLoss = calls.filter(([name]) => name === "render").length;
  // Deliberately dispatch no DOM event: the native context can be lost before
  // either Three or the scene scheduler receives its queued notification.
  contextLost = true;
  assert.equal(rendering.update(), false);
  assert.equal(rendering.update({ render: false }), true);
  assert.equal(calls.filter(([name]) => name === "render").length, renderedBeforeLoss);
  contextLost = false;
  assert.equal(rendering.update(), true);
  assert.equal(calls.filter(([name]) => name === "render").length, renderedBeforeLoss + 1);
  const renderTarget = { id: "reflection" };
  rendering.trackRenderTarget(renderTarget);

  assert.equal(rendering.camera.fov, 52);
  assert.equal(rendering.camera.aspect, 2.25);
  assert.deepEqual(
    calls.find((entry) => entry[0] === "pixelRatio"),
    ["pixelRatio", 1.5],
  );
  assert.equal(composerRatio, 1.5, "applyQuality without a ratio keeps the composer's");
  assert.deepEqual(
    calls.findLast((entry) => entry[0] === "composerSize"),
    ["composerSize", 900, 400],
  );
  assert.deepEqual(
    calls.findLast((entry) => entry[0] === "postprocessSize"),
    ["postprocessSize", 900, 400],
    "grading texels are CSS pixels",
  );
  assert.equal(
    calls.some((entry) => entry[0] === "passAdded"),
    false,
    "rendering adds no pass of its own",
  );
  assert.ok(calls.some((entry) => entry[0] === "render"));
  assert.deepEqual(rendering.dispose(), { geometries: 1 });
  assert.equal(rendering.dispose(), false);
  assert.equal(rendering.update(), false);
  assert.deepEqual(disposedOptions.renderTargets, [renderTarget]);
});

test("static shadows redraw the sun map only after reported changes", () => {
  const listeners = {};
  const renderer = {
    capabilities: { getMaxAnisotropy: () => 8 },
    domElement: {
      addEventListener: (name, handler) => (listeners[name] = handler),
      removeEventListener: (name) => delete listeners[name],
    },
    shadowMap: {},
    setClearColor() {},
    setPixelRatio() {},
    setSize() {},
  };
  const pipeline = {
    composer: { addPass() {}, render() {}, setPixelRatio() {}, setSize() {} },
    setQualityProfile() {},
  };
  const profile = createProfile();
  const rendering = createSceneRendering({
    container: { appendChild() {} },
    createPipeline: () => pipeline,
    createRenderer: () => renderer,
    disposeResources: () => ({}),
    height: 600,
    lighting: {
      ambientColor: 0xffffff,
      ambientIntensity: 0.22,
      directionalColor: 0xffffff,
      directionalIntensity: 2.9,
      directionalPosition: { x: 21, y: 29, z: 23 },
      fogColor: 0x222222,
      fogFar: 150,
      fogNear: 62,
      hemisphereGroundColor: 0x111111,
      hemisphereIntensity: 0.71,
      hemisphereSkyColor: 0x888888,
    },
    profile,
    threeExports: {},
    width: 800,
    world: {
      CAMERA_FAR: 210,
      CAMERA_FOV: 48,
      CAMERA_NEAR: 0.5,
      FILL_LIGHT_POSITION: [-20, 14, -18],
      SHADOW_CAMERA_FAR: 120,
      SHADOW_CAMERA_HALF_EXTENT: 34,
      SHADOW_CAMERA_NEAR: 0.5,
    },
  });
  const shadow = rendering.lights.sun.shadow;
  // Three clears needsUpdate after drawing the map; model that consumption.
  const redraws = (change) => {
    shadow.needsUpdate = false;
    change();
    return shadow.needsUpdate;
  };

  assert.equal(shadow.autoUpdate, true, "per-frame shadows by default");
  rendering.setStaticShadows(true);
  assert.equal(shadow.autoUpdate, false);
  assert.equal(shadow.needsUpdate, true, "the first static frame draws the map");

  assert.equal(
    redraws(() => rendering.applyQuality(profile)),
    true,
  );
  assert.equal(
    redraws(() => rendering.resize({ height: 400, width: 900 })),
    true,
  );
  assert.equal(
    redraws(() => rendering.setFilmTreatment(true)),
    true,
  );
  const focus = rendering.lights.sun.target.position.clone().set(55, 8, 36);
  assert.equal(
    redraws(() => rendering.focusFilmShadow(focus, 12)),
    true,
  );
  assert.equal(
    redraws(() => rendering.focusFilmShadow(focus.clone(), 12)),
    false,
    "an unchanged shot focus keeps the drawn map",
  );
  assert.equal(
    redraws(() => rendering.focusFilmShadow(focus.clone().setX(0), 12)),
    true,
  );
  assert.equal(
    redraws(() => rendering.setGroundedLighting(true)),
    true,
  );
  assert.equal(
    redraws(() => rendering.invalidateShadows()),
    true,
  );
  assert.equal(
    redraws(() => listeners.webglcontextrestored?.({})),
    true,
  );
  assert.equal(
    redraws(() => rendering.update()),
    false,
    "an ordinary frame keeps the map",
  );

  rendering.setStaticShadows(false);
  assert.equal(shadow.autoUpdate, true, "per-frame redraws can be restored");
  rendering.dispose();
  assert.equal(rendering.setStaticShadows(true), false);
  assert.equal(shadow.autoUpdate, true);
});

test("a lost context ends a tour crossfade before the scene hears of it", () => {
  const listeners = {};
  const calls = [];
  const rendering = createSceneRendering({
    container: { appendChild() {} },
    createPipeline: () => ({
      cancelTransition: () => calls.push("cancel"),
      invalidatePrograms: () => calls.push("invalidate"),
      composer: { addPass() {}, render() {}, setPixelRatio() {}, setSize() {} },
      setQualityProfile() {},
    }),
    createRenderer: () => ({
      domElement: {
        addEventListener: (name, handler) => (listeners[name] = handler),
        removeEventListener: (name) => delete listeners[name],
      },
      shadowMap: {},
      setClearColor() {},
    }),
    disposeResources: () => ({}),
    height: 600,
    lighting: {
      ambientColor: 0xffffff,
      ambientIntensity: 0.22,
      directionalColor: 0xffffff,
      directionalIntensity: 2.9,
      directionalPosition: { x: 21, y: 29, z: 23 },
      fogColor: 0x222222,
      fogFar: 150,
      fogNear: 62,
      hemisphereGroundColor: 0x111111,
      hemisphereIntensity: 0.71,
      hemisphereSkyColor: 0x888888,
    },
    onContextLost: () => calls.push("lost"),
    profile: createProfile(),
    threeExports: {},
    width: 800,
    world: {
      CAMERA_FAR: 210,
      CAMERA_FOV: 48,
      CAMERA_NEAR: 0.5,
      FILL_LIGHT_POSITION: [-20, 14, -18],
      SHADOW_CAMERA_FAR: 120,
      SHADOW_CAMERA_HALF_EXTENT: 34,
      SHADOW_CAMERA_NEAR: 0.5,
    },
  });

  listeners.webglcontextlost({ preventDefault: () => calls.push("prevented") });
  assert.deepEqual(calls, ["prevented", "cancel", "invalidate", "lost"]);
  rendering.dispose();
  assert.equal(listeners.webglcontextlost, undefined);
});
