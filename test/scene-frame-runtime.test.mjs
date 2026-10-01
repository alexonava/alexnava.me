import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createPanelHold,
  createRefreshEstimator,
  createSceneFrameScheduler,
  createSceneResizeController,
  disposeSceneRuntimeResources,
  hasMeaningfulScalarChange,
  renderDivisor,
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
  assert.deepEqual(rates.map((hz) => renderDivisor(hz)), [1, 1, 1, 2, 2, 2, 4]);
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
  assert.ok(intervals.every((interval) => Math.abs(interval - 2 * vsync) < 0.5), "72 fps, even");
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
  assert.ok(intervals.every((interval) => interval > 2 * fast - 1e-6), "no back-to-back renders");
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
  const { updates: met } = lastSecond(run144(() => false), 2000);
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
  assert.equal("setForceAnimation" in scheduler, false, "nothing forces animation");
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

test("scene bootstrap idles before reveal, holds behind dialogs and fails to the title card", async () => {
  const source = await readFile(new URL("../src/scene/index.js", import.meta.url), "utf8");

  // The frame that sees readiness reveals the canvas and resumes animation.
  assert.match(source, /const sceneShown = !sceneFailed && cinematic\.ready &&/);
  assert.match(source, /container\?\.classList\.toggle\("is-ready", sceneShown\);\s*[^]*?frameScheduler\?\.setStill\(!sceneShown\);/);
  // The dialog hold's behaviour is tested above; index.js only wires it.
  assert.match(
    source,
    /panelHold = createPanelHold\(\{\s*delayMs: 450,\s*isOpen: \(\) => document\.body\.hasAttribute\("data-panel-open"\),/,
  );
  assert.match(source, /attributeFilter: \["data-panel-open"\]/);
  assert.match(source, /function applySceneSize\([^]*?panelHold\?\.redraw\(\);/);
  assert.match(source, /rendering\.update\(\);[^]*?panelHold\?\.frameRendered\(\);/);
  // Renders keep an even vsync cadence: desktops at or above 60 fps, touch
  // screens at or below it; the 60 fps cap holds until a rate is adopted.
  assert.match(
    source,
    /createSceneFrameScheduler\(\{\s*(?:\/\/[^\n]*\n[ \t]*)*displayCadence: \{ baseRate: 60, round: qualityState\.touchPrimary \? "ceil" : "floor" \},[^]*?targetFrameRate: 60,\s*\}\);/,
  );
  const dispose = source.slice(source.indexOf("function disposeHomeSceneRuntime"));
  assert.match(dispose, /panelObserver\?\.disconnect\(\);\s*panelHold\.dispose\(\);/);

  // A missing tower or tree fails to the title card: the camera learns the
  // status first, the scene stops at once and the runtime is disposed on a
  // later tick.
  const onStatus = source.slice(
    source.indexOf("onStatus(status) {"),
    source.indexOf("subsystemRegistry.register(architectureAssets);"),
  );
  assert.ok(onStatus.indexOf("cinematic.setStatus(status);") < onStatus.indexOf("failToTitle("));
  assert.match(onStatus, /status\.kind !== "lantern" && \(status\.status === "fallback" \|\|\s*\(status\.status === "procedural" && sceneReadyMarked\)\)\) \{\s*failToTitle\(/);
  assert.match(
    source,
    /function failToTitle\(stage, error\) \{\s*if \(sceneFailed\) return;\s*stopFailedScene\(stage, error\);[\s\S]*?\(function disposeWhenIdle\(\) \{[\s\S]*?if \(shaderWarmup\.pending\) window\.setTimeout\(disposeWhenIdle, 50\);\s*else scene\.disposeHomeSceneRuntime\?\.\(\);/,
  );
  assert.doesNotMatch(source, /failToPoster/);
  // A scene never shown also hides its host, which retires the loading line
  // (ui/scene-loader.js); a shown canvas fades out to the title card instead.
  const stop = source.slice(source.indexOf("function stopFailedScene"), source.indexOf("function failToTitle"));
  assert.match(
    stop,
    /sceneFailed = true;\s*container\.classList\?\.remove\("is-ready"\);\s*if \(!canvasShown\) container\.hidden = true;/,
  );
  // canvasShown is declared before any status can reach stopFailedScene.
  assert.ok(source.indexOf("let canvasShown = false;") < source.indexOf("createArchitectureAssetController({"));
  assert.doesNotMatch(source, /ensureLegacyWorld|legacyWorld|ensureProcedural/);
  assert.match(source, /webglContextAvailable && !sceneFailed;/);

  // The authored scene's shadows are static: the map redraws only on reported changes.
  assert.match(source, /rendering\.setStaticShadows\(true\);/);
});
