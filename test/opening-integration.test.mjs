// Run the bootstrap's actual opening/reveal blocks with deterministic async
// owners. This catches wiring races without a browser, WebGL or copied gate.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createCameraTour } from "../src/scene/camera-tour.js";
import { DIRECTED_SHOTS } from "../src/scene/directed-shots.js";
import { createOpeningPreparation } from "../src/scene/opening-preparation.js";

const source = readFileSync(new URL("../src/scene/index.js", import.meta.url), "utf8");
function between(from, to, start = 0) {
  const first = source.indexOf(from, start),
    last = source.indexOf(to, first);
  assert.ok(first >= 0 && last > first, `bootstrap anchors: ${from}`);
  return source.slice(first, last);
}
function callback(name) {
  const start = source.indexOf(`${name}() {`);
  assert.ok(start >= 0, name);
  let depth = 1,
    cursor = source.indexOf("{", start) + 1;
  const from = cursor;
  for (; depth && cursor < source.length; cursor++) {
    if (source[cursor] === "{") depth++;
    if (source[cursor] === "}") depth--;
  }
  assert.equal(depth, 0);
  return source.slice(from, cursor - 1);
}
const bridge = between(
  "const createOpeningPreparation = site.shared?.createOpeningPreparation;",
  "const initStart =",
);
const setup = between("let canvasShown = false;", "const shaderWarmup =");
const begin = between('warmShaders("scene");', "frameScheduler.start();").replace(
  'warmShaders("scene");',
  "",
);
const readinessStart = source.search(/if\s*\(\s*!canvasShown\s*&&\s*cinematic\.current/);
assert.ok(readinessStart >= 0);
const readiness = source.slice(
  readinessStart,
  source.indexOf("// Drawing while a warm-up", readinessStart),
);
const reveal = between("const sceneShown =", "// Until the reveal, the transparent canvas");
const tour = between("const tourPhase =", "const tourTransition =");
const apply =
  between("cinematic.apply({", "});", source.indexOf("function updateSceneFrame")) + "});";
const deferred = () => {
  let resolve;
  const promise = new Promise((yes) => (resolve = yes));
  return { promise, resolve };
};
const flush = async () => {
  for (let n = 0; n < 10; n++) await Promise.resolve();
};

function harness({
  parallel = true,
  linked = true,
  remainingBudget,
  initialProgress = 0,
  setupSeconds = 0,
  earlyFrame = false,
} = {}) {
  const cohorts = [],
    warms = [],
    failures = [],
    marks = [],
    poses = [],
    snapshots = [],
    maps = deferred(),
    rocks = deferred(),
    timers = new Map();
  let nextTimer = 1,
    draws = 0,
    invalidations = 0,
    redraws = 0,
    budgetTakes = 0;
  const cinematic = {
    current: "tree",
    angle: 1,
    ready: true,
    frame: {},
    get shot() {
      return DIRECTED_SHOTS[this.current][this.angle];
    },
    isAvailable: () => true,
    setPreviewShot(subject, angle) {
      this.current = subject;
      this.angle = angle;
      return true;
    },
    apply(pose) {
      poses.push({ ...pose });
      return true;
    },
  };
  const cameraTour = createCameraTour({ camera: cinematic });
  const env = {
    setupSeconds,
    earlyFrame,
    scene:
      remainingBudget === undefined
        ? {}
        : {
            takeOpeningBudget() {
              budgetTakes++;
              return remainingBudget;
            },
          },
    opening: { view: "tree", angle: 1 },
    site: {
      shared: { createOpeningPreparation },
      sceneLoader: {
        state: { progress: initialProgress },
        preparation: (state) => snapshots.push(state),
      },
    },
    qualityDebug: {},
    runtimeDisposed: false,
    sceneFailed: false,
    webglContextAvailable: true,
    retireOpening: () => {},
    sceneVisible: true,
    document: { hidden: false },
    window: {
      setTimeout(task) {
        const id = nextTimer++;
        timers.set(id, task);
        return id;
      },
    },
    clearTimeout: (id) => timers.delete(id),
    sceneNow: () => env.elapsedTime * 1000,
    failToTitle(stage, reason) {
      env.sceneFailed = true;
      failures.push({ stage, reason });
    },
    qualityState: { holdSampling() {} },
    visitorHold: {
      redraw() {
        redraws++;
      },
    },
    frameScheduler: { resume() {} },
    cinematic,
    cameraTour,
    camera: {},
    viewport: { width: 1920, height: 1080 },
    state: { profile: { tier: "high" } },
    elapsedTime: 0,
    reducedMotion: false,
    walk: null,
    cameraProfile: { fov: 45 },
    filmScene: {
      openingState: {},
      prepareOpening(frame) {
        const next = deferred();
        cohorts.push({ ...next, frame });
        return next.promise;
      },
    },
    groundTextures: { prepareOpening: () => maps.promise, update() {} },
    rockScatter: { committed: true, prepareOpening: () => rocks.promise, setRevealed() {} },
    groundContacts: { slateRockContact: { value: 0 } },
    lanternMount: { committed: true },
    shaderWarmup: { pending: 0 },
    renderer: { extensions: { has: () => parallel } },
    rendering: {
      openingPreparing: true,
      programsLinked: () => linked,
      update() {
        draws++;
      },
    },
    invalidateContent() {
      invalidations++;
    },
    markScene: (name) => marks.push(name),
    container: { classList: { toggle() {}, remove() {} } },
    warmShaders() {
      const next = deferred();
      warms.push(next);
      env.shaderWarmup.pending++;
      return next.promise.then((ready) => {
        env.shaderWarmup.pending--;
        return ready;
      });
    },
  };
  const owner = Function(
    "env",
    `with(env) {
    ${bridge}
    ${setup}
    Object.assign(architectureStatus, { watch: "ready", tree: "ready", lantern: "ready" });
    if (earlyFrame) { elapsedTime = setupSeconds / 2; ${readiness} }
    elapsedTime = setupSeconds;
    ${begin}
    return {
      step() { ${tour} ${apply} ${readiness} ${reveal} },
      lose() { ${callback("onContextLost")} },
      restore() { ${callback("onContextRestored")} },
      observe() { observeOpening(); },
      dispose() { runtimeDisposed = true; stopOpeningPreparation(); },
      get state() { return { canvasShown, openingPrepared, openingShaderStarted,
        generation: openingGeneration, gate: openingGate.state, revealTime }; },
    };
  }`,
  )(env);
  return {
    env,
    owner,
    cohorts,
    warms,
    maps,
    rocks,
    failures,
    marks,
    poses,
    snapshots,
    get budgetTakes() {
      return budgetTakes;
    },
    get draws() {
      return draws;
    },
    get invalidations() {
      return invalidations;
    },
    get redraws() {
      return redraws;
    },
    async prepare(index = 0) {
      maps.resolve(true);
      rocks.resolve(true);
      cohorts[index].resolve(true);
      await flush();
    },
    async warm(index = 0, ready = true) {
      warms[index].resolve(ready);
      await flush();
    },
  };
}

test("the scene requires the UI's actual shared opening factory before initialization", () => {
  const resolve = Function("site", `${bridge} return createOpeningPreparation;`);
  assert.equal(resolve({ shared: { createOpeningPreparation } }), createOpeningPreparation);
  for (const site of [{}, { shared: {} }, { shared: { createOpeningPreparation: false } }])
    assert.equal(resolve(site), false, "a missing bridge declines before any renderer is built");
  assert.ok(source.indexOf(bridge) < source.indexOf("if (!container || !supportsWebGL())"));
});

test("the actual bootstrap consumes the remaining entry budget once, including an expired zero", () => {
  for (const remainingBudget of [7000, 0]) {
    const h = harness({ remainingBudget });
    try {
      assert.equal(h.budgetTakes, 1);
      if (remainingBudget) {
        h.env.elapsedTime = (remainingBudget - 1) / 1000;
        h.owner.observe();
        assert.deepEqual(h.failures, []);
        h.env.elapsedTime = remainingBudget / 1000;
        h.owner.observe();
      } else h.owner.observe();
      assert.deepEqual(h.failures, [{ stage: "opening", reason: "deadline" }]);
      assert.equal(h.budgetTakes, 1, "observations cannot restart the shared opening budget");
      assert.equal(h.owner.state.canvasShown, false);
    } finally {
      h.owner.dispose();
    }
  }
});

test("unchanged download progress cannot forgive idle synchronous setup after budget handoff", () => {
  const h = harness({ remainingBudget: 30000, initialProgress: 0.8 });
  try {
    h.env.elapsedTime = 15;
    h.owner.observe();
    assert.deepEqual(h.failures, [{ stage: "opening", reason: "stalled" }]);
  } finally {
    h.owner.dispose();
  }
});

test("the actual bootstrap keeps phase zero hidden and starts the complete first hold at reveal", async () => {
  const h = harness();
  h.owner.step();
  h.env.elapsedTime = 12;
  h.owner.step();
  assert.equal(h.owner.state.canvasShown, false);
  assert.ok(h.poses.every((pose) => pose.tourPhase === 0));
  assert.ok(
    h.poses.every((pose) => pose.elapsedSeconds === 0),
    "hidden fitting cannot seed a non-tour breathing clock before reveal",
  );
  assert.ok(
    h.poses.every((pose) => pose.elapsedSeconds === 0),
    "legacy still-shot motion also starts at reveal",
  );
  await h.prepare();
  h.owner.step();
  assert.equal(h.warms.length, 1);
  assert.equal(h.owner.state.canvasShown, false);
  await h.warm();
  h.owner.step();
  assert.equal(h.owner.state.canvasShown, true);
  assert.equal(h.owner.state.revealTime, 12);
  assert.deepEqual(h.marks, ["reveal"]);
  h.env.elapsedTime = 12.1;
  h.owner.step();
  assert.equal(h.poses.at(-1).tourPhase, 0, "cold preparation consumed none of the hold");
  assert.ok(Math.abs(h.poses.at(-1).elapsedSeconds - 0.1) < 1e-10);
  h.env.elapsedTime = 15.1;
  h.owner.step();
  assert.ok(Math.abs(h.poses.at(-1).tourPhase - 0.5) < 1e-10);
  h.owner.dispose();
});

test("a hidden refit retires the old warm-up and cannot reveal before its latest cohort", async () => {
  const h = harness();
  h.owner.step();
  await h.prepare();
  h.owner.step();
  h.env.viewport = { width: 390, height: 844 };
  h.env.cinematic.frame = {};
  h.owner.step();
  assert.equal(h.cohorts.length, 2);
  await h.warm(0);
  h.owner.step();
  assert.equal(h.owner.state.canvasShown, false);
  assert.equal(h.warms.length, 1);
  await h.prepare(1);
  h.owner.step();
  assert.equal(h.warms.length, 2);
  await h.warm(1);
  h.owner.step();
  assert.equal(h.owner.state.canvasShown, true);
  assert.equal(h.cohorts[1].frame.viewport.width, 390);
  assert.ok(h.poses.every((pose) => pose.tourPhase === 0));
  h.owner.dispose();
});

test("disposal makes late preparation completions unable to start a warm-up or reveal", async () => {
  const h = harness();
  h.owner.step();
  h.owner.dispose();
  const before = h.invalidations;
  await h.prepare();
  assert.equal(h.invalidations, before);
  assert.equal(h.warms.length, 0);
  assert.deepEqual(h.marks, []);
  assert.deepEqual(h.failures, []);
});

test("loss during final compilation retires its result and restoration prepares current programs", async () => {
  const h = harness();
  h.owner.step();
  await h.prepare();
  h.owner.step();
  h.owner.lose();
  await h.warm(0, false);
  assert.deepEqual(h.failures, [], "context loss is recoverable, not an asset failure");
  assert.equal(h.owner.state.canvasShown, false);
  h.owner.restore();
  h.owner.step();
  assert.equal(h.redraws, 1);
  assert.equal(h.cohorts.length, 2);
  await h.prepare(1);
  h.owner.step();
  assert.equal(h.warms.length, 2);
  await h.warm(1);
  h.owner.step();
  assert.equal(h.owner.state.canvasShown, true);
  assert.deepEqual(h.failures, []);
  h.owner.dispose();
});

test("a completed but failed required shader cohort keeps the title card instead of revealing", async () => {
  const h = harness();
  h.owner.step();
  await h.prepare();
  h.owner.step();
  await h.warm(0, false);
  h.owner.step();
  assert.deepEqual(h.failures, [{ stage: "shaders", reason: "programs-unavailable" }]);
  assert.equal(h.owner.state.canvasShown, false);
  assert.deepEqual(h.marks, []);
  h.owner.dispose();
});

test("without parallel compilation a failed hidden-draw link keeps the title card", async () => {
  const h = harness({ parallel: false, linked: false });
  h.owner.step();
  await h.prepare();
  h.owner.step();
  await h.warm(0, false);
  h.owner.step();
  assert.equal(h.draws, 1, "the existing hidden draw prepares the serial backend");
  assert.deepEqual(h.failures, [{ stage: "shaders", reason: "programs-unavailable" }]);
  assert.equal(h.owner.state.canvasShown, false);
  assert.deepEqual(h.marks, []);
  h.owner.dispose();
});

test("without parallel compilation the final fallback draws hidden before the reveal", async () => {
  const h = harness({ parallel: false });
  h.owner.step();
  await h.prepare();
  h.owner.step();
  await h.warm(0, false);
  assert.equal(h.owner.state.canvasShown, false);
  assert.equal(h.draws, 1);
  h.owner.step();
  assert.equal(h.owner.state.canvasShown, true);
  assert.deepEqual(h.failures, []);
  h.owner.dispose();
});

test("a ready but unrevealed opening records hidden time before a refit reopens its gate", async () => {
  const h = harness();
  h.owner.observe();
  h.owner.step();
  h.env.elapsedTime = 1;
  h.owner.observe();
  await h.prepare();
  h.owner.step();
  await h.warm();
  assert.equal(h.owner.state.gate.status, "ready");
  h.env.elapsedTime = 1.1;
  h.env.document.hidden = true;
  h.owner.observe();
  h.env.elapsedTime = 601.1;
  h.env.document.hidden = false;
  h.owner.observe();
  h.env.viewport = { width: 390, height: 844 };
  h.env.cinematic.frame = {};
  h.owner.step();
  h.env.elapsedTime = 601.2;
  h.owner.observe();
  assert.deepEqual(h.failures, [], "suspended ready time cannot consume a reopened deadline");
  assert.equal(h.owner.state.gate.status, "preparing");
  assert.ok(h.owner.state.gate.elapsed < 1500);
  h.owner.dispose();
});

test("successful final shader callbacks cannot settle after either opening deadline", async (t) => {
  for (const parallel of [true, false]) {
    for (const [remainingBudget, at, reason] of [
      [7000, 7.1, "deadline"],
      [30000, 15.1, "stalled"],
    ]) {
      await t.test(String(parallel) + ":" + reason, async () => {
        const h = harness({ parallel, remainingBudget });
        try {
          h.owner.step();
          await h.prepare();
          h.owner.step();
          h.env.elapsedTime = at - 0.2;
          h.owner.observe();
          assert.deepEqual(h.failures, []);
          h.env.elapsedTime = at;
          h.env.rendering.openingProgress = 1;
          await h.warm(0, parallel);
          assert.deepEqual(h.failures, [{ stage: "opening", reason }]);
          assert.equal(h.owner.state.gate.status, "failed");
          h.owner.step();
          assert.equal(h.owner.state.canvasShown, false);
          assert.deepEqual(h.marks, []);
        } finally {
          h.owner.dispose();
        }
      });
    }
  }
});

test("late asset and frame settlements cannot forgive an expired idle deadline", async (t) => {
  for (const last of ["subjects", "lantern", "materials", "rocks", "terrain"]) {
    await t.test(last, async () => {
      const h = harness();
      try {
        if (last === "lantern") h.env.lanternMount.committed = false;
        if (last !== "subjects") h.owner.step();
        if (last === "terrain") {
          h.maps.resolve(true);
          h.rocks.resolve(true);
          await flush();
        }
        h.env.elapsedTime = 14.9;
        h.owner.observe();
        assert.deepEqual(h.failures, []);
        h.env.elapsedTime = 15.1;
        h.env.rendering.openingProgress = 1;
        if (last === "subjects" || last === "lantern") {
          h.env.lanternMount.committed = true;
          h.owner.step();
        } else {
          if (last === "materials") h.maps.resolve(true);
          if (last === "rocks") h.rocks.resolve(true);
          if (last === "terrain") h.cohorts[0].resolve(true);
          await flush();
        }
        assert.deepEqual(h.failures, [{ stage: "opening", reason: "stalled" }]);
        assert.equal(h.owner.state.canvasShown, false);
        assert.deepEqual(h.marks, []);
      } finally {
        h.owner.dispose();
      }
    });
  }
});

test("final shader settlement while hidden excludes the suspended interval on both backends", async (t) => {
  for (const parallel of [true, false]) {
    await t.test(String(parallel), async () => {
      const h = harness({ parallel });
      try {
        h.owner.step();
        await h.prepare();
        h.owner.step();
        h.env.elapsedTime = 14.9;
        h.env.document.hidden = true;
        h.owner.observe();
        h.env.elapsedTime = 614.9;
        await h.warm(0, parallel);
        assert.equal(h.owner.state.gate.status, "ready");
        assert.equal(h.owner.state.gate.elapsed, 14900);
        assert.equal(h.owner.state.canvasShown, false);
        h.env.document.hidden = false;
        h.owner.observe();
        h.owner.step();
        assert.equal(h.owner.state.canvasShown, true);
        assert.deepEqual(h.failures, []);
      } finally {
        h.owner.dispose();
      }
    });
  }
});

test("slow synchronous setup preserves early stage time and the captured handoff boundary", async (t) => {
  for (const [setupSeconds, remainingBudget, finish, reason] of [
    [16, 30000, 16.1, null],
    [6.8, 7000, 6.99, null],
    [6.8, 7000, 7.1, "deadline"],
  ]) {
    await t.test(String(setupSeconds) + ":" + String(finish), async () => {
      const h = harness({ setupSeconds, remainingBudget, initialProgress: 0.8, earlyFrame: true });
      try {
        assert.deepEqual(h.failures, []);
        assert.equal(h.owner.state.gate.elapsed, setupSeconds * 1000);
        assert.equal(h.owner.state.gate.idle, setupSeconds * 500);
        await h.prepare();
        h.owner.step();
        h.env.elapsedTime = finish;
        await h.warm();
        h.owner.step();
        assert.deepEqual(h.failures, reason ? [{ stage: "opening", reason }] : []);
        assert.equal(h.owner.state.canvasShown, !reason);
        assert.equal(h.owner.state.gate.elapsed, finish * 1000);
      } finally {
        h.owner.dispose();
      }
    });
  }
});

test("synchronous setup cannot forgive expired idle time with newly reported progress", () => {
  const h = harness({ setupSeconds: 15.1, initialProgress: 0.8 });
  try {
    assert.deepEqual(h.failures, [{ stage: "opening", reason: "stalled" }]);
    assert.equal(h.owner.state.canvasShown, false);
  } finally {
    h.owner.dispose();
  }
});
