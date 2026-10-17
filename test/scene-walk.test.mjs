// The walk (src/scene/walk.js) and its key (walk-key.js): the visitor's
// first-person camera on the ground and up the lookout's ladder. Its geometry
// and motion are pure functions, the lookout's measures are held to both
// delivered models, and its phases run against the real tour and cinematic
// camera, with a stand-in page.
import assert from "node:assert/strict";
import test from "node:test";
import { getEventListeners } from "node:events";
import vm from "node:vm";
import {
  BoxGeometry,
  DoubleSide,
  Fog,
  Group,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Raycaster,
  Vector3,
} from "three";
import { glbAsset, modelBytes } from "./support/glb.mjs";
import { createCompleteTowerArchitecture } from "../src/scene/architecture.js";
import { createCinematicCamera } from "../src/scene/cinematic.js";
import { createCameraTour, TOUR_IDLE } from "../src/scene/camera-tour.js";
import { ESTATE, estateLantern } from "../src/scene/estate-layout.js";
import { isWalkKey, walkAllowed } from "../src/scene/walk-key.js";
import { source } from "./support/code.mjs";
import {
  LOOKOUT,
  WALK,
  boundStep,
  convexHull,
  createWalk,
  deckStep,
  focusCell,
  integrate,
  ladderLine,
  land,
  look,
  pushOutCircles,
  pushOutHull,
  settle,
  spawn,
  towerFootprint,
  towerFrame,
  vaultTo,
  walkFov,
  wish,
} from "../src/scene/walk.js";

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const area = (hull) =>
  hull.reduce((sum, [ax, az], i) => {
    const [bx, bz] = hull[(i + 1) % hull.length];
    return sum + (ax * bz - bx * az) / 2;
  }, 0);
// Signed distance from a convex hull's outline: inside, the nearest edge's
// (negative); outside, the true distance to the outline, corners included.
const outside = (hull, x, z) => {
  let side = -Infinity,
    near = Infinity;
  hull.forEach(([ax, az], i) => {
    const [bx, bz] = hull[(i + 1) % hull.length],
      ex = bx - ax,
      ez = bz - az,
      length = Math.hypot(ex, ez),
      t = Math.min(1, Math.max(0, ((x - ax) * ex + (z - az) * ez) / (length * length)));
    side = Math.max(side, ((x - ax) * ez - (z - az) * ex) / length);
    near = Math.min(near, Math.hypot(x - ax - ex * t, z - az - ez * t));
  });
  return side <= 0 ? side : near;
};
// A key event; its fields (target too, a getter on Event) as own properties.
const key = (type, code, extra = {}) => {
  const event = new Event(type, { cancelable: true });
  for (const [name, value] of Object.entries({ code, key: "", ...extra }))
    Object.defineProperty(event, name, { value, configurable: true });
  return event;
};
const towers = new Map();
function towerRoot(tier) {
  if (!towers.has(tier))
    towers.set(
      tier,
      createCompleteTowerArchitecture({
        asset: glbAsset(modelBytes("tower", tier)),
        groundY: 1.36,
        footingOffset: -0.22,
      }).root,
    );
  return towers.get(tier);
}

test("the walk's key is ` or ~ wherever a layout types them, never a chord, a repeat or typing", () => {
  assert.ok(isWalkKey(key("keydown", "Backquote", { key: "`" })));
  assert.ok(isWalkKey(key("keydown", "Backquote", { key: "~", shiftKey: true })));
  // A dead key on the Backquote's place (German ^), and AltGr layouts (French AltGr+7).
  assert.ok(isWalkKey(key("keydown", "Backquote", { key: "Dead" })));
  assert.ok(
    isWalkKey(
      key("keydown", "Digit7", {
        key: "`",
        ctrlKey: true,
        altKey: true,
        getModifierState: (name) => name === "AltGraph",
      }),
    ),
  );
  for (const [label, event] of [
    ["Ctrl", key("keydown", "Backquote", { key: "`", ctrlKey: true })],
    ["Cmd", key("keydown", "Backquote", { key: "`", metaKey: true })],
    ["Alt", key("keydown", "Backquote", { key: "`", altKey: true })],
    ["repeat", key("keydown", "Backquote", { key: "`", repeat: true })],
    ["composing", key("keydown", "Backquote", { key: "`", isComposing: true })],
    ["input", key("keydown", "Backquote", { key: "`", target: { tagName: "INPUT" } })],
    ["textarea", key("keydown", "Backquote", { key: "`", target: { tagName: "TEXTAREA" } })],
    ["editable", key("keydown", "Backquote", { key: "`", target: { isContentEditable: true } })],
    ["another key", key("keydown", "KeyW", { key: "w" })],
  ])
    assert.equal(isWalkKey(event), false, label);
  const handled = key("keydown", "Backquote", { key: "`" });
  handled.preventDefault();
  assert.equal(isWalkKey(handled), false, "already handled");
});

test("the walk starts only over the revealed film scene on a desktop, outside every hold", () => {
  const ready = {
    shown: true,
    failed: false,
    ground: true,
    reducedMotion: false,
    paused: false,
    finePointer: true,
    forcedColors: false,
  };
  assert.equal(walkAllowed(ready), true);
  for (const [field, value] of [
    ["shown", false],
    ["failed", true],
    ["ground", false],
    ["reducedMotion", true],
    ["paused", true],
    ["finePointer", false],
    ["forcedColors", true],
  ])
    assert.equal(walkAllowed({ ...ready, [field]: value }), false, field);
  assert.equal(walkAllowed(), false);
});

test("the walk's lens shows 80 degrees across, held between 44 and 60 degrees tall", () => {
  close(walkFov(16 / 9), 50.53, 0.01);
  assert.equal(walkFov(21 / 9), WALK.fov.min, "ultrawide never goes fisheye");
  assert.equal(walkFov(4 / 3), WALK.fov.max);
  assert.equal(walkFov(0.5), WALK.fov.max, "a tall window keeps its top");
  assert.ok(walkFov(1.7) > walkFov(1.9));
});

test("the mouse turns right and looks down, within the pitch limit", () => {
  const view = { yaw: 0, pitch: 0 };
  look(view, 100, 0, WALK.look, WALK.pitch);
  assert.ok(view.yaw < 0, "right turns right (yaw falls)");
  look(view, 0, 100, WALK.look, WALK.pitch);
  close(view.pitch, -0.22);
  look(view, 0, 1e6, WALK.look, WALK.pitch);
  assert.equal(view.pitch, -WALK.pitch);
  look(view, 0, -1e7, WALK.look, WALK.pitch);
  assert.equal(view.pitch, WALK.pitch);
});

test("the keys ask for a walk, a jog, a slower back and side step, a diagonal no faster", () => {
  const ask = (intent, yaw = 0) => wish({ forward: 0, strafe: 0, jog: false, ...intent }, yaw);
  const forward = ask({ forward: 1 });
  close(forward.x, 0);
  close(forward.z, -WALK.speed.walk, 1e-9);
  close(ask({ forward: 1, jog: true }).z, -WALK.speed.jog, 1e-9);
  close(ask({ forward: -1 }).z, WALK.speed.back, 1e-9);
  close(ask({ strafe: 1 }).x, WALK.speed.strafe, 1e-9);
  const diagonal = ask({ forward: 1, strafe: 1 });
  close(Math.hypot(diagonal.x, diagonal.z), WALK.speed.walk, 1e-9);
  // Turned a quarter left (yaw +90 degrees), forward is world -x.
  const turned = ask({ forward: 1 }, Math.PI / 2);
  close(turned.x, -WALK.speed.walk, 1e-9);
  close(turned.z, 0, 1e-9);
  const still = ask({});
  assert.deepEqual([still.x + 0, still.z + 0], [0, 0]);
});

test("the walker eases to its pace and to a stop, jumps about 2.25, lands, and follows the ground down a step", () => {
  const body = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, grounded: true };
  const pace = { x: 0, z: -WALK.speed.walk };
  integrate(body, pace, false, 0.125);
  close(body.vz, -WALK.speed.walk / 2, 1e-9);
  integrate(body, pace, false, 0.125);
  close(body.vz, -WALK.speed.walk, 1e-9);
  integrate(body, { x: 0, z: 0 }, false, WALK.speed.walk / WALK.brake);
  close(body.vz, 0, 1e-9);
  // The jump: up at 12 against 32, back down onto the ground.
  let top = 0;
  integrate(body, { x: 0, z: 0 }, true, 1 / 60);
  assert.equal(body.grounded, false);
  for (let i = 0; i < 120 && !body.grounded; i++) {
    integrate(body, { x: 0, z: 0 }, false, 1 / 60);
    land(body, 0);
    top = Math.max(top, body.y);
  }
  assert.ok(top > 2.1 && top < 2.3, `apex ${top}`);
  assert.equal(body.grounded, true);
  assert.equal(body.y, 0);
  assert.equal(body.vy, 0);
  // Down a 0.5 step it follows the ground; past stepDown it falls.
  land(body, -0.5);
  assert.deepEqual([body.y, body.grounded], [-0.5, true]);
  land(body, -0.5 - WALK.stepDown - 0.1);
  assert.deepEqual([body.y, body.grounded], [-0.5, false]);
  // Up a rise it stands on the ground at once.
  body.grounded = true;
  land(body, 0.3);
  assert.deepEqual([body.y, body.grounded], [0.3, true]);
});

test("solids push the walker out to its body's radius and let it slide along them", () => {
  const circles = [
    { x: 0, z: 0, r: 2 },
    { x: 6, z: 0, r: 1 },
  ];
  const [x, z] = pushOutCircles(0.5, 0, circles, WALK.body);
  close(Math.hypot(x, z), 2 + WALK.body);
  assert.deepEqual(pushOutCircles(10, 10, circles, WALK.body), [10, 10], "clear: untouched");
  for (const [px, pz] of [
    [1.9, 0.1],
    [5.5, 0.2],
  ]) {
    const [sx, sz] = settle(px, pz, { circles, hull: [] });
    for (const circle of circles)
      assert.ok(Math.hypot(sx - circle.x, sz - circle.z) >= circle.r + WALK.body - 1e-9);
  }
  // A square's hull, counter-clockwise, interior points dropped.
  const square = convexHull([
    [-2, -2],
    [2, -2],
    [2, 2],
    [-2, 2],
    [0, 0],
    [1, -1],
  ]);
  assert.equal(square.length, 4);
  close(area(square), 16);
  for (const [px, pz] of [
    [0, 0],
    [1.9, 0.3],
    [2.3, 0],
    [2.3, 2.3],
  ]) {
    const [qx, qz] = pushOutHull(px, pz, square, WALK.body);
    assert.ok(outside(square, qx, qz) >= WALK.body - 1e-9, `${px},${pz}`);
  }
  assert.deepEqual(pushOutHull(5, 5, square, WALK.body), [5, 5]);
  // Walking along a wall into it at a slant, the walker slides along it.
  let wx = -5,
    wz = 3.2;
  for (let i = 0; i < 60; i++) {
    [wx, wz] = pushOutHull(wx + 0.2, wz - 0.05, square, WALK.body);
    assert.ok(outside(square, wx, wz) >= WALK.body - 1e-9);
  }
  assert.ok(wx > 5, `slid past the square to ${wx}`);
});

test("the bound fades outward steps between 76 and 86 and never lets the walker past 86", () => {
  const { soft, hard } = WALK.bound;
  let x = 70,
    z = 0;
  for (let i = 0; i < 2000; i++) {
    [x, z] = boundStep(x, z, x + 0.15, z, WALK);
    assert.ok(Math.hypot(x, z) <= hard + 1e-9);
  }
  assert.ok(x > soft + 5, `pressed toward the edge: ${x}`);
  // Inward and sideways motion is untouched.
  assert.deepEqual(boundStep(80, 0, 79, 0), [79, 0]);
  const [tx, tz] = boundStep(80, 0, 80, 1);
  close(Math.hypot(tx, tz), Math.hypot(80, 1), 0.06);
  assert.deepEqual(boundStep(10, 0, 11, 0), [11, 0], "inside soft: free");
});

test("the moon's shadow follows a snapped point ahead, changing only on a cell", () => {
  const cell = (x, z, yaw = 0) => ({ ...focusCell(x, z, yaw) });
  const a = cell(0.5, 0.5);
  assert.deepEqual(a, { x: 0, z: -18 }, "16 ahead, snapped to 6");
  assert.deepEqual(cell(1.2, -0.4), a, "a step within the cell keeps it");
  assert.notDeepEqual(cell(3.5, 0.5), a, "crossing a cell moves it");
  for (const { x, z } of [cell(13.7, -9.2, 1), cell(-40, 22, -2)]) {
    assert.equal(Math.abs(x % WALK.shadow.cell), 0);
    assert.equal(Math.abs(z % WALK.shadow.cell), 0);
  }
});

test("the tower's base is solid: a hull of its posts, ladder feet and low braces on both tiers", () => {
  for (const tier of ["high", "balanced"]) {
    const hull = towerFootprint(towerRoot(tier));
    assert.ok(Math.abs(area(hull) - 228) < 10, `${tier} area ${area(hull)}`);
    const reach = Math.max(...hull.map(([x, z]) => Math.hypot(x, z)));
    assert.ok(reach > 9 && reach <= 10.6, `${tier} reach ${reach}`);
    // The four posts (at about 9 on the axes) and the centre are inside.
    for (const [x, z] of [
      [8.1, -0.5],
      [-8.9, -0.45],
      [-0.6, -8.9],
      [-0.3, 8.2],
      [0, 0],
    ])
      assert.ok(outside(hull, x, z) < 0, `${tier} ${x},${z}`);
    assert.ok(outside(hull, 11, 0) > 0);
  }
  assert.deepEqual(towerFootprint(null), []);
});

test("the walk starts under the shot's camera, clear of solids and inside the bound, facing the subject", () => {
  const solids = { circles: [{ x: 0, z: 0, r: 3 }], hull: [] };
  const start = spawn({ position: new Vector3(1, 9, 0), target: new Vector3(-20, 5, 0) }, solids);
  assert.ok(Math.hypot(start.x, start.z) >= 3 + WALK.body - 1e-9, "pushed out of the solid");
  const ahead = wish({ forward: 1, strafe: 0 }, start.yaw);
  assert.ok(ahead.x < 0 && Math.abs(ahead.z) < 1e-9, "faces the subject");
  const far = spawn({ position: new Vector3(120, 9, 50), target: new Vector3(0, 0, 0) }, solids);
  close(Math.hypot(far.x, far.z), WALK.bound.soft, 1e-9);
});

// A stand-in page for the walk's phases: a body's classes, a window and a
// document that dispatch events, and a canvas that takes the pointer lock.
function page({ lock = true } = {}) {
  const classes = new Set(),
    win = new EventTarget(),
    doc = new EventTarget(),
    canvas = new EventTarget();
  let clock = 0,
    blurred = 0,
    exits = 0;
  const forcedColorListeners = new Set();
  const forcedColors = {
    matches: false,
    addEventListener(type, listener) {
      if (type === "change") forcedColorListeners.add(listener);
    },
    removeEventListener(type, listener) {
      if (type === "change") forcedColorListeners.delete(listener);
    },
    setMatches(matches) {
      this.matches = matches;
      for (const listener of [...forcedColorListeners]) listener({ matches });
    },
    get listenerCount() {
      return forcedColorListeners.size;
    },
  };
  win.matchMedia = (query) =>
    query === "(forced-colors: active)" ? forcedColors : { matches: true };
  Object.assign(doc, {
    hidden: false,
    pointerLockElement: null,
    activeElement: { blur: () => blurred++ },
    exitPointerLock() {
      exits++;
      doc.pointerLockElement = null;
      doc.dispatchEvent(new Event("pointerlockchange"));
    },
  });
  canvas.requestPointerLock = () => {
    if (!lock) return Promise.reject(new Error("refused"));
    doc.pointerLockElement = canvas;
    doc.dispatchEvent(new Event("pointerlockchange"));
    return Promise.resolve();
  };
  return {
    body: {
      classList: {
        add: (...names) => names.forEach((name) => classes.add(name)),
        remove: (name) => classes.delete(name),
        contains: (name) => classes.has(name),
      },
    },
    classes,
    win,
    doc,
    canvas,
    forcedColors,
    now: () => clock,
    tick: (ms) => (clock += ms),
    get blurred() {
      return blurred;
    },
    get exits() {
      return exits;
    },
  };
}

function walkRig({ lock = true, tower = null, target = new Vector3(0, 10, 0) } = {}) {
  const site = page({ lock }),
    camera = new PerspectiveCamera(40, 1, 0.1, 450),
    fog = new Fog(0x2d3242, 30, 120),
    shot = { position: new Vector3(40, 8, 30), target };
  let texts = 0;
  const options = {
    camera,
    canvas: site.canvas,
    page: site.body,
    win: site.win,
    doc: site.doc,
    ground: (x, z) => 1 + 0.02 * x + 0.5 * Math.sin(z / 9),
    tower: () => tower,
    anchors: {
      trunk: { x: ESTATE.tree.x + ESTATE.tree.trunk[0], z: ESTATE.tree.z + ESTATE.tree.trunk[1] },
      lantern: estateLantern(),
    },
    rocks: () => [
      { x: 30, z: 20, half: 1.5, height: 2 },
      { x: 31, z: 22, half: 0.2, height: 0.25, pebble: true },
    ],
    view: () => shot,
    fog,
    fogRange: () => [66, 154],
    dissolve: 1,
    onText: () => texts++,
    now: site.now,
  };
  const walk = createWalk(options);
  return {
    walk,
    options,
    site,
    camera,
    fog,
    shot,
    get texts() {
      return texts;
    },
  };
}

// Steps a rig from enter() to the walk's first frames: arming, capture, cut.
function walkIn(rig, start = 0) {
  assert.equal(rig.walk.enter(), true);
  let t = start;
  for (let i = 0; i < 60 && !rig.walk.drives; i++, t += 1 / 60) rig.walk.step(t, TOUR_IDLE);
  assert.equal(rig.walk.drives, true);
  return t;
}

// Runs the actual index.js walk/media wiring and teardown around the real walk
// owner. The scene's other owners need only their disposal hooks in this race.
function wireSceneWalk(rig) {
  const forcedColors = rig.site.forcedColors;
  const noop = () => {};
  const owner = { dispose: noop };
  const context = {
    window: rig.site.win,
    document: rig.site.doc,
    scene: {},
    walk: rig.walk,
    // An existing controller has already loaded its optional module.
    walkLoad: Promise.resolve(),
    renderer: { domElement: rig.site.canvas },
    rendering: { disposeResult: {} },
    isWalkKey,
    walkAllowed,
    canvasShown: true,
    cinematic: { ready: true },
    runtimeDisposed: false,
    webglContextAvailable: true,
    sceneFailed: false,
    sceneReadyMarked: true,
    filmActive: true,
    walkGround: () => 0,
    reducedMotion: false,
    visitorHold: { ...owner, paused: false },
    qualityState: { touchPrimary: false },
    container: { classList: { remove: noop } },
    onFontsLoaded: noop,
    onWindowResize: noop,
    onWindowScroll: noop,
    onDocumentVisibilityChange: noop,
    onReducedMotionChange: noop,
    reducedMotionMQ: new EventTarget(),
    sceneIntersectionObserver: null,
    pixelRatioWatcher: owner,
    footerLinksObserver: null,
    containerResizeObserver: null,
    resizeController: owner,
    frameScheduler: owner,
    subsystemRegistry: { disposed: false, dispose: () => rig.walk.dispose() },
  };
  const index = source("src/scene/index.js");
  const start = index.indexOf("const finePointer =");
  const end = index.indexOf('warmShaders("scene");', start);
  assert.ok(start > 0 && end > start, "locate real scene walk wiring and teardown");
  vm.runInNewContext(index.slice(start, end), context);
  return { context, forcedColors, dispose: () => context.scene.disposeHomeSceneRuntime() };
}

test("forced colors immediately restores the page and mouse during walk arming or walking", async () => {
  for (const phase of ["arming", "walking"]) {
    const rig = walkRig();
    const integration = wireSceneWalk(rig);
    if (phase === "arming") rig.walk.enter();
    else walkIn(rig);
    await rig.site.canvas.requestPointerLock();
    assert.equal(integration.forcedColors.listenerCount, 1);
    assert.equal(rig.walk.active, true);
    assert.equal(rig.site.classes.has("scene-walk-hidden"), true);
    const exits = rig.site.exits;

    // No animation frame follows this event: forced-colors CSS hides the canvas.
    integration.forcedColors.setMatches(true);
    assert.equal(rig.walk.active, false, phase);
    assert.equal(rig.walk.drives, false);
    assert.equal(rig.walk.holdsTour, false);
    assert.equal(rig.walk.textHidden, false);
    assert.equal(rig.site.classes.size, 0, "the hero and Contact are visible immediately");
    assert.equal(rig.site.doc.pointerLockElement, null);
    assert.equal(rig.site.exits, exits + 1, "release the scene's mouse capture exactly once");
    const tab = key("keydown", "Tab");
    const movement = key("keydown", "KeyW");
    rig.site.win.dispatchEvent(tab);
    rig.site.win.dispatchEvent(movement);
    assert.equal(tab.defaultPrevented, false, "native focus navigation is available again");
    assert.equal(movement.defaultPrevented, false, "walk input has detached");
    rig.site.win.dispatchEvent(key("keydown", "Backquote"));
    await Promise.resolve();
    assert.equal(rig.walk.active, false, "the existing shortcut stays blocked under forced colors");

    integration.forcedColors.setMatches(false);
    assert.equal(rig.walk.active, false, "clearing the preference does not restart the walk");
    rig.site.win.dispatchEvent(key("keydown", "Backquote"));
    await Promise.resolve();
    assert.equal(rig.walk.active, true, "the existing shortcut can start it after recovery");
    integration.forcedColors.setMatches(true);
    assert.equal(rig.site.classes.size, 0);
    integration.dispose();
  }
});

test("a pending optional walk releases mouse capture on arrival if forced colors became active", async () => {
  const rig = walkRig();
  const integration = wireSceneWalk(rig);
  rig.walk.dispose();
  integration.context.walk = null;
  let arrive;
  integration.context.walkLoad = new Promise((resolve) => {
    arrive = resolve;
  });
  rig.site.win.dispatchEvent(key("keydown", "Backquote"));
  assert.equal(rig.site.doc.pointerLockElement, rig.site.canvas);
  assert.equal(
    integration.forcedColors.listenerCount,
    0,
    "no walk owner exists before its module arrives",
  );
  integration.forcedColors.setMatches(true);
  arrive();
  await Promise.resolve();
  assert.equal(rig.site.doc.pointerLockElement, null, "the existing arrival gate releases capture");
  assert.equal(rig.walk.active, false);
  assert.equal(rig.site.classes.size, 0);
  integration.dispose();
});

test("forced colors releases a late asynchronous pointer grant after arming cancellation or while idle", async () => {
  for (const phase of ["arming", "idle"]) {
    const rig = walkRig();
    let grant;
    rig.site.canvas.requestPointerLock = () =>
      new Promise((resolve) => {
        grant = () => {
          rig.site.doc.pointerLockElement = rig.site.canvas;
          rig.site.doc.dispatchEvent(new Event("pointerlockchange"));
          resolve();
        };
      });
    if (phase === "arming") rig.walk.enter();
    const requested = rig.site.canvas.requestPointerLock();
    assert.equal(
      rig.site.doc.pointerLockElement,
      null,
      "the asynchronous request has not granted yet",
    );
    rig.site.forcedColors.setMatches(true);
    assert.equal(rig.walk.active, false);
    assert.equal(rig.site.classes.size, 0);
    const exits = rig.site.exits;

    // No scene frame runs, and this native event has no MediaQueryList.matches.
    grant();
    await requested;
    assert.equal(rig.site.doc.pointerLockElement, null, phase);
    assert.equal(rig.site.exits, exits + 1, "the late capture is released exactly once");
    assert.equal(rig.walk.active, false);
    assert.equal(rig.walk.textHidden, false);
    assert.equal(rig.site.classes.size, 0, "the late event cannot hide the restored page");
    rig.walk.dispose();
  }
});

test("the walk removes its forced-colors listener when the scene is torn down", async () => {
  const rig = walkRig();
  const integration = wireSceneWalk(rig);
  assert.equal(integration.forcedColors.listenerCount, 1);
  assert.equal(getEventListeners(rig.site.doc, "pointerlockchange").length, 1);
  integration.dispose();
  assert.equal(integration.forcedColors.listenerCount, 0);
  assert.equal(getEventListeners(rig.site.doc, "pointerlockchange").length, 0);
  integration.forcedColors.setMatches(false);
  await rig.site.canvas.requestPointerLock();
  const exits = rig.site.exits;
  integration.forcedColors.setMatches(true);
  assert.equal(rig.site.exits, exits, "the disposed scene no longer reacts to media changes");
  rig.site.doc.exitPointerLock();
});

test("into the walk: the page fades, the tour's dissolve settles, its frame is kept, and the visitor stands under the shot", () => {
  const rig = walkRig(),
    { walk, site, camera, fog } = rig;
  camera.projectionMatrix.elements[8] = 0.3;
  assert.equal(walk.active, false);
  assert.equal(walk.step(0, TOUR_IDLE), TOUR_IDLE, "idle: the tour's transition");
  assert.equal(walk.transition, null);
  assert.equal(walk.enter(), true);
  assert.equal(walk.enter(), false, "once");
  assert.ok(site.classes.has("scene-walking") && site.classes.has("scene-walk-hidden"));
  assert.equal(site.blurred, 1, "focus leaves the hidden page");
  // Arming: the page fades for 0.42 s and the tour runs on.
  const dissolving = { capture: false, cut: false, progress: 0.4, zoom: 0.01 };
  assert.equal(walk.step(0, TOUR_IDLE), TOUR_IDLE);
  assert.equal(walk.step(0.5, dissolving), dissolving, "a tour dissolve finishes first");
  assert.equal(walk.step(0.52, TOUR_IDLE), TOUR_IDLE, "settled for one frame");
  assert.equal(walk.holdsTour, false);
  // Capture: the tour's camera draws the kept frame, and the tour holds from now.
  const capture = walk.step(0.54, TOUR_IDLE);
  assert.deepEqual({ ...capture }, { capture: true, cut: false, progress: 1, zoom: 0 });
  assert.equal(walk.holdsTour, true);
  assert.equal(walk.drives, false);
  assert.equal(walk.transition, capture);
  // The cut: the visitor drives, the text guards rest, the fog is the profile's.
  assert.deepEqual(
    { ...walk.step(0.56, TOUR_IDLE) },
    {
      capture: false,
      cut: true,
      progress: 0,
      zoom: 0,
    },
  );
  assert.equal(walk.drives, true);
  assert.equal(walk.textHidden, true);
  assert.equal(rig.texts, 1);
  assert.deepEqual([fog.near, fog.far], [66, 154]);
  assert.equal(camera.rotation.order, "YXZ");
  assert.equal(walk.bars, 1);
  walk.update(1 / 60, 1600, 900);
  const { x, y, z } = walk.state;
  close(x, 40, 1e-9);
  close(z, 30, 1e-9);
  close(y, 1 + 0.8 + 0.5 * Math.sin(30 / 9), 1e-9);
  close(camera.position.y, y + WALK.eye, 1e-9);
  assert.equal(camera.projectionMatrix.elements[8], 0, "the shot's lens shift is gone");
  assert.equal(camera.projectionMatrix.elements[9], 0);
  close(camera.fov, walkFov(16 / 9));
  close(camera.aspect, 16 / 9);
  // Facing the subject: the camera's forward points at the target's side.
  const forward = new Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  assert.ok(forward.x < 0 && forward.z < 0);
  // The dissolve runs from the kept frame; the bars ease out with it.
  const mid = walk.step(1.06, TOUR_IDLE);
  assert.deepEqual([mid.capture, mid.cut, mid.zoom], [false, false, 0]);
  close(mid.progress, 0.5);
  close(walk.bars, 0.5);
  walk.step(1.7, TOUR_IDLE);
  assert.equal(walk.bars, 0);
  assert.equal(walk.transition.progress, 1);
  assert.equal(walk.transition.cut, false, "nothing lands mid-walk");
  walk.dispose();
});

test("out of the walk: its frame is kept, the shot returns and dissolves in, then the tour and the page", async () => {
  const rig = walkRig(),
    { walk, site, camera } = rig;
  let t = walkIn(rig);
  // A leave asked mid-dissolve waits for it to settle (a capture mid-blend is ignored).
  walk.exit();
  assert.equal(walk.step((t += 0.1), TOUR_IDLE).capture, false);
  t += 1;
  const kept = walk.step(t, TOUR_IDLE);
  assert.deepEqual({ ...kept }, { capture: true, cut: false, progress: 1, zoom: 0 });
  assert.equal(walk.drives, true, "the walk's own frame is kept");
  const back = walk.step((t += 1 / 60), TOUR_IDLE);
  assert.deepEqual({ ...back }, { capture: false, cut: true, progress: 0, zoom: 0 });
  assert.equal(walk.drives, false, "the tour's camera takes this frame");
  assert.equal(walk.textHidden, false, "the guards return before the text");
  assert.equal(rig.texts, 2);
  assert.equal(camera.rotation.order, "XYZ");
  assert.equal(walk.holdsTour, true, "the tour holds through the dissolve back");
  assert.equal(walk.bars, 0);
  walk.step((t += 0.5), TOUR_IDLE);
  close(walk.bars, 0.5, 0.02);
  assert.ok(site.classes.has("scene-walk-hidden"), "the page waits for the dissolve");
  const resumed = { capture: false, cut: false, progress: 1, zoom: 0 };
  assert.equal(walk.step((t += 0.6), resumed), resumed, "the tour's transition again");
  assert.equal(walk.holdsTour, false);
  assert.equal(walk.active, false);
  assert.equal(walk.bars, 1);
  assert.equal(walk.transition, null);
  assert.equal(site.classes.has("scene-walk-hidden"), false, "the page fades back");
  assert.ok(site.classes.has("scene-walking"));
  await new Promise((resolve) => setTimeout(resolve, WALK.uiFade * 1000 + 40));
  assert.equal(site.classes.has("scene-walking"), false);
  walk.dispose();
});

test("an immediate exit (a pause, reduced motion, a lost context) cuts back at once", () => {
  for (const reason of ["exit", "lost"]) {
    const rig = walkRig(),
      { walk, site } = rig;
    walkIn(rig);
    site.canvas.requestPointerLock();
    if (reason === "exit") assert.equal(walk.exit({ immediate: true }), true);
    else site.canvas.dispatchEvent(new Event("webglcontextlost"));
    assert.equal(walk.active, false, reason);
    assert.equal(walk.drives, false);
    assert.equal(walk.holdsTour, false);
    assert.equal(walk.textHidden, false);
    assert.equal(walk.transition, null);
    assert.equal(site.classes.size, 0, "both classes go at once");
    assert.equal(site.doc.pointerLockElement, null, "the mouse is freed");
    assert.equal(walk.step(9, TOUR_IDLE), TOUR_IDLE, "a hard cut: the tour's settled frame");
    assert.equal(walk.exit({ immediate: true }), false);
    walk.dispose();
  }
  // Leaving before the cut only fades the page back.
  const rig = walkRig();
  rig.walk.enter();
  rig.walk.step(0, TOUR_IDLE);
  assert.equal(rig.walk.exit(), true);
  assert.equal(rig.walk.active, false);
  assert.equal(rig.walk.holdsTour, false);
  assert.equal(rig.site.classes.has("scene-walk-hidden"), false);
  assert.equal(rig.texts, 0);
  rig.walk.dispose();
});

test("the keys walk and turn the visitor, the captured mouse looks, and Esc twice leaves", () => {
  const rig = walkRig(),
    { walk, site } = rig;
  let t = walkIn(rig);
  site.canvas.requestPointerLock();
  walk.update(1 / 60, 1600, 900);
  const from = walk.state;
  const down = key("keydown", "KeyW");
  site.win.dispatchEvent(down);
  assert.equal(down.defaultPrevented, true, "the page never scrolls under a walk");
  for (let i = 0; i < 60; i++) walk.update(1 / 60, 1600, 900);
  const moved = walk.state;
  const ahead = wish({ forward: 1, strafe: 0 }, from.yaw);
  const travelled = (moved.x - from.x) * ahead.x + (moved.z - from.z) * ahead.z;
  assert.ok(travelled / WALK.speed.walk > 3, `walked forward ${travelled}`);
  site.win.dispatchEvent(key("keyup", "KeyW"));
  // The arrows turn; the captured mouse looks.
  site.win.dispatchEvent(key("keydown", "ArrowLeft"));
  walk.update(0.1, 1600, 900);
  close(walk.state.yaw, moved.yaw + WALK.turn * 0.1, 1e-9);
  site.win.dispatchEvent(key("keyup", "ArrowLeft"));
  site.win.dispatchEvent(Object.assign(new Event("mousemove"), { movementX: 0, movementY: 50 }));
  walk.update(1 / 60, 1600, 900);
  close(walk.state.pitch, moved.pitch - 50 * WALK.look, 1e-9);
  // Space jumps once per press.
  site.win.dispatchEvent(key("keydown", "Space"));
  walk.update(1 / 60, 1600, 900);
  assert.equal(walk.state.grounded, false);
  site.win.dispatchEvent(key("keyup", "Space"));
  for (let i = 0; i < 90; i++) walk.update(1 / 60, 1600, 900);
  assert.equal(walk.state.grounded, true);
  // A blur clears held keys.
  site.win.dispatchEvent(key("keydown", "KeyW"));
  site.win.dispatchEvent(new Event("blur"));
  const still = walk.state;
  for (let i = 0; i < 30; i++) walk.update(1 / 60, 1600, 900);
  close(walk.state.x, still.x, 0.3);
  // Esc frees the mouse (the browser's own); the same press, seen late, is not a second.
  site.doc.exitPointerLock();
  site.tick(50);
  site.win.dispatchEvent(key("keydown", "Escape"));
  t += 2;
  assert.equal(walk.step(t, TOUR_IDLE).capture, false, "still walking");
  site.tick(500);
  site.win.dispatchEvent(key("keydown", "Escape"));
  assert.equal(walk.step((t += 1 / 60), TOUR_IDLE).capture, true, "the second Esc leaves");
  walk.dispose();
});

test("the Esc that frees the mouse never leaves, even when it arrives before the lock's change event", () => {
  const rig = walkRig(),
    { walk, site } = rig;
  site.canvas.requestPointerLock();
  let t = walkIn(rig);
  // The browser drops the lock, delivers the Esc, and only then its pointerlockchange.
  site.doc.pointerLockElement = null;
  site.tick(1000);
  site.win.dispatchEvent(key("keydown", "Escape"));
  assert.equal(walk.step((t += 2), TOUR_IDLE).capture, false, "still walking");
  site.doc.dispatchEvent(new Event("pointerlockchange"));
  site.tick(500);
  site.win.dispatchEvent(key("keydown", "Escape"));
  assert.equal(walk.step((t += 1 / 60), TOUR_IDLE).capture, true, "the second Esc leaves");
  walk.dispose();
});

test("slow frames move in small steps: no solid is crossed and slopes keep the feet down", () => {
  const lantern = estateLantern();
  for (const [label, ground] of [
    ["flat", () => 1],
    ["downhill", (x) => 1 - 0.6 * x],
  ]) {
    const rig = walkRig(),
      { walk, site, shot } = rig;
    rig.shot.position.set(lantern.x - 8, 6, lantern.z);
    shot.target.set(lantern.x + 20, 6, lantern.z);
    // A 10 fps frame jogging at 13.5 would step 1.35 at once, past the lantern's centre.
    const slow = createWalk({ ...rig.options, ground });
    slow.enter();
    let t = 0;
    for (let i = 0; i < 60 && !slow.drives; i++, t += 1 / 60) slow.step(t, TOUR_IDLE);
    site.win.dispatchEvent(key("keydown", "ShiftLeft"));
    site.win.dispatchEvent(key("keydown", "KeyW"));
    let airborne = 0;
    for (let i = 0; i < 40; i++) {
      slow.update(0.1, 1600, 900);
      const { x, z, grounded } = slow.state;
      if (label === "flat")
        assert.ok(Math.hypot(x - lantern.x, z - lantern.z) >= WALK.lantern + WALK.body - 1e-6);
      if (!grounded) airborne++;
    }
    if (label === "flat") assert.ok(slow.state.x < lantern.x, "held in front of the lantern");
    else assert.equal(airborne, 0, "down a 0.6 slope at 10 fps the feet stay on the ground");
    slow.dispose();
    walk.dispose();
  }
});

test("without a captured mouse a held button drags the view", () => {
  const rig = walkRig({ lock: false }),
    { walk, site } = rig;
  walkIn(rig);
  walk.update(1 / 60, 1600, 900);
  const yaw = walk.state.yaw;
  site.win.dispatchEvent(Object.assign(new Event("mousemove"), { movementX: 40, movementY: 0 }));
  walk.update(1 / 60, 1600, 900);
  assert.equal(walk.state.yaw, yaw, "a free mouse alone does nothing");
  const press = Object.assign(new Event("mousedown", { cancelable: true }), { button: 0 });
  site.win.dispatchEvent(press);
  assert.equal(press.defaultPrevented, true);
  site.win.dispatchEvent(Object.assign(new Event("mousemove"), { movementX: 40, movementY: 0 }));
  walk.update(1 / 60, 1600, 900);
  close(walk.state.yaw, yaw - 40 * WALK.drag, 1e-9);
  site.win.dispatchEvent(new Event("mouseup"));
  site.win.dispatchEvent(Object.assign(new Event("mousemove"), { movementX: 40, movementY: 0 }));
  walk.update(1 / 60, 1600, 900);
  close(walk.state.yaw, yaw - 40 * WALK.drag, 1e-9);
  // Never captured, so one Esc leaves.
  site.win.dispatchEvent(key("keydown", "Escape"));
  assert.equal(walk.step(99, TOUR_IDLE).capture, true);
  walk.dispose();
});

test("walking into the tower, the trunk, a rock or the edge, the walker never enters them", () => {
  const tower = towerRoot("high"),
    hull = towerFootprint(tower);
  const rig = walkRig({ tower }),
    { walk, site, shot } = rig;
  const trunk = {
    x: ESTATE.tree.x + ESTATE.tree.trunk[0],
    z: ESTATE.tree.z + ESTATE.tree.trunk[1],
  };
  for (const [from, aim] of [
    [new Vector3(-25, 6, 1), new Vector3(0, 6, 0)],
    [new Vector3(trunk.x - 15, 6, trunk.z + 0.5), new Vector3(trunk.x, 6, trunk.z)],
    [new Vector3(22, 6, 14), new Vector3(30, 6, 20)],
    [new Vector3(70, 6, 5), new Vector3(200, 6, 14)],
  ]) {
    shot.position.copy(from);
    shot.target.copy(aim);
    walkIn(rig, 0);
    site.win.dispatchEvent(key("keydown", "ShiftLeft"));
    site.win.dispatchEvent(key("keydown", "KeyW"));
    for (let i = 0; i < 600; i++) {
      walk.update(1 / 60, 1600, 900);
      const { x, z } = walk.state;
      assert.ok(outside(hull, x, z) >= WALK.body - 1e-6, `inside the tower at ${x},${z}`);
      assert.ok(Math.hypot(x - trunk.x, z - trunk.z) >= WALK.tree + WALK.body - 1e-6);
      assert.ok(Math.hypot(x - 30, z - 20) >= 1.5 + WALK.body - 1e-6, "the rock");
      assert.ok(Math.hypot(x, z) <= WALK.bound.hard + 1e-9);
    }
    site.win.dispatchEvent(key("keyup", "KeyW"));
    site.win.dispatchEvent(key("keyup", "ShiftLeft"));
    assert.equal(walk.state.circles, 3, "trunk, lantern and the one rock (never the pebble)");
    assert.ok(walk.state.hull >= 3);
    walk.exit({ immediate: true });
  }
  walk.dispose();
});

test("the walk holds the real tour on its shot and hands it back without a time jump", () => {
  const camera = new PerspectiveCamera(),
    tower = new Group(),
    tree = new Group(),
    material = new MeshBasicMaterial();
  for (const [root, width] of [
    [tower, 10],
    [tree, 3],
  ]) {
    const mesh = new Mesh(new BoxGeometry(width, 20, width), material);
    mesh.position.y = 10;
    root.add(mesh);
  }
  tree.position.set(ESTATE.tree.x, 0, ESTATE.tree.z);
  const cinematic = createCinematicCamera({
    camera,
    selected: "tower",
    angle: 0,
    getSafeArea: () => ({ left: 450, top: 32, width: 940, height: 720 }),
  });
  for (const [kind, root] of [
    ["tower", tower],
    ["tree", tree],
  ]) {
    cinematic.setSubject(kind, root);
    cinematic.setStatus({ kind, status: "ready" });
  }
  const tour = createCameraTour({ camera: cinematic, interval: 5 });
  const site = page();
  const walk = createWalk({
    camera,
    canvas: site.canvas,
    page: site.body,
    win: site.win,
    doc: site.doc,
    ground: () => 0,
    view: () => ({ position: camera.position, target: cinematic.target }),
    now: site.now,
  });
  // One frame as index.js runs it.
  const frame = (time) => {
    const phase = tour.update({ elapsedSeconds: time, held: walk.holdsTour });
    const transition = walk.step(time, tour.transition);
    const applied =
      !walk.drives &&
      cinematic.apply({ width: 1440, height: 900, elapsedSeconds: time, tourPhase: phase });
    if (walk.drives) walk.update(1 / 60, 1440, 900);
    return { phase, transition, applied, shot: cinematic.shot?.name };
  };
  let t = 0;
  for (; t < 2; t += 1 / 60) frame(t);
  walk.enter();
  let before = null;
  while (!walk.holdsTour) before = frame((t += 1 / 60));
  const held = frame((t += 1 / 60));
  assert.equal(held.applied, false, "the walk drives from the cut");
  for (let i = 0; i < 600; i++) {
    const during = frame((t += 1 / 60));
    assert.equal(during.phase, held.phase, "the tour's hold does not run");
  }
  walk.exit();
  let back = null;
  while (walk.drives) frame((t += 1 / 60));
  back = frame(t);
  assert.equal(back.shot, before.shot, "the same shot returns");
  close(back.phase, before.phase, 1e-9);
  assert.equal(back.applied, true);
  // From the end of the dissolve back the tour runs on (its first free frame
  // counts no held time), toward its next cut.
  while (walk.holdsTour) frame((t += 1 / 60));
  close(frame((t += 1 / 60)).phase, back.phase, 1e-9);
  const next = frame((t += 0.5));
  close(next.phase, back.phase + 0.5 / 5, 1e-9);
  walk.dispose();
});

test("disposing a walk frees the mouse and its listeners, and it never starts again", () => {
  const rig = walkRig(),
    { walk, site } = rig;
  walkIn(rig);
  site.canvas.requestPointerLock();
  const exits = site.exits;
  assert.equal(walk.dispose(), true);
  assert.equal(site.exits, exits + 1, "the mouse is freed");
  assert.equal(walk.drives, false);
  assert.equal(site.classes.size, 0);
  const down = key("keydown", "KeyW");
  site.win.dispatchEvent(down);
  assert.equal(down.defaultPrevented, false, "its keys are no longer heard");
  assert.equal(walk.enter(), false);
  assert.equal(walk.dispose(), false);
});

// The lookout's model as a probe: its first hit along a ray from a point in
// its own frame (u, h, v) heading (du, dh, dv), in lookout units, or Infinity.
function probe(tier) {
  const root = towerRoot(tier),
    frame = towerFrame(root),
    mesh = root.children[0],
    solid = new Mesh(mesh.geometry, new MeshBasicMaterial({ side: DoubleSide })),
    caster = new Raycaster();
  solid.matrixWorld.copy(mesh.matrixWorld);
  return {
    frame,
    hit(u, h, v, du, dh, dv, far = 40) {
      const from = frame.world(u, h, v),
        way = frame.outward(du, dv);
      caster.set(new Vector3(from.x, from.y, from.z), new Vector3(way.x, dh, way.z).normalize());
      caster.far = far * frame.scale;
      const first = caster.intersectObject(solid, false)[0];
      return first ? first.distance / frame.scale : Infinity;
    },
  };
}
const steps = (from, to, step) =>
  Array.from({ length: Math.floor((to - from) / step + 1e-9) + 1 }, (_, i) => from + i * step);

test("the lookout's gallery, railing, cabin, roof and ladder are where both models have them", () => {
  const { deck, cabin, ladder } = LOOKOUT,
    body = WALK.deckBody,
    walls = steps(deck.floor + 0.15, deck.floor + 3.45, 0.1);
  for (const tier of ["high", "balanced"]) {
    const { hit } = probe(tier);
    // The floor under the gallery's walks, the lane and the cabin.
    for (const [u, v] of [
      [4.5, -3],
      [-4.5, 0],
      [0, -5.5],
      [4.7, 4.5],
      [-4.7, -5.5],
      [0, 0],
      [0, 4.5],
      [0.7, 4.9],
    ])
      close(deck.floor + 4 - hit(u, deck.floor + 4, v, 0, -1, 0), deck.floor, 0.07);
    // The railing's inner faces: never inside the walks, at most 0.3 beyond.
    const inner = (ray) => Math.min(...walls.map(ray));
    for (const v of [-5.5, -3, 0, 3, 4.6]) {
      const right = 3.5 + inner((h) => hit(3.5, h, v, 1, 0, 0, 3)),
        left = -3.5 - inner((h) => hit(-3.5, h, v, -1, 0, 0, 3));
      assert.ok(right >= deck.x - 0.03 && right <= deck.x + 0.3, `${tier} +x ${right} at ${v}`);
      assert.ok(left <= -deck.x + 0.03 && left >= -deck.x - 0.3, `${tier} -x ${left} at ${v}`);
    }
    for (const u of [-4.7, -3.5, 3.5, 4.7]) {
      const back = -5 - inner((h) => hit(u, h, -5, 0, 0, -1, 3)),
        front = 4.2 + inner((h) => hit(u, h, 4.2, 0, 0, 1, 3));
      assert.ok(
        back <= deck.back + 0.03 && back >= deck.back - 0.3,
        `${tier} back ${back} at ${u}`,
      );
      assert.ok(front >= deck.front - 0.03 && front <= deck.front + 0.3, `${tier} front ${front}`);
    }
    // The gap over the ladder stays open across the lane and a body either
    // side, out past the ladder's line.
    const end = ladderLine(deck.floor, WALK.body);
    for (const u of [-deck.gap + 0.05, 0, deck.gap - 0.05])
      for (const h of steps(deck.floor + 0.15, deck.floor + 1.55, 0.1))
        assert.equal(hit(u, h, 4, 0, 0, 1, end + 1 - 4), Infinity, `${tier} gap ${u},${h}`);
    // The cabin's walls and end posts, and the walks past its ends.
    for (const v of [-4, -2, 0, 2, 3]) {
      for (const s of [1, -1]) {
        const into = inner((h) => hit(0, h, v, s, 0, 0, 4)),
          out = 4.6 - inner((h) => hit(4.6 * s, h, v, -s, 0, 0, 4));
        assert.ok(into >= cabin.inner - 0.03 && into <= cabin.inner + 0.2, `${tier} in ${into}`);
        assert.ok(out <= cabin.outer + 0.03, `${tier} wall ${out} at ${v}`);
      }
    }
    for (const v of [cabin.back + 0.05, cabin.front - 0.05])
      assert.ok(
        4.6 - inner((h) => hit(4.6, h, v, -1, 0, 0, 4)) <= cabin.post + 0.03,
        `${tier} post`,
      );
    for (const v of [
      (cabin.front + deck.front) / 2,
      (cabin.back + deck.back) / 2,
      cabin.back - body - 0.02,
      cabin.front + body + 0.02,
    ])
      for (const h of walls) assert.equal(hit(-4.7, h, v, 1, 0, 0, 9.4), Infinity, `${tier} ${v}`);
    // The roof: half a unit or more above the eye anywhere on the walks.
    for (const u of steps(-4.75, 4.75, 0.25))
      for (const v of steps(-5.6, 4.6, 0.25))
        if (Math.abs(u) < cabin.inner - 0.1 || Math.abs(u) > cabin.post + 0.1)
          assert.ok(
            hit(u, deck.floor + 0.3, v, 0, 1, 0, 12) + 0.3 >= WALK.eye + 0.5,
            `${tier} roof at ${u},${v}`,
          );
    // The ladder's rails along their line, foot to deck.
    for (const h of steps(1.5, 28.5, 1.5))
      for (const u of [-0.85, 0.85])
        close(12 - hit(u, h, 12, 0, 0, -1, 12), ladder.face - ladder.lean * h, 0.15);
    // The climber's eye keeps 0.5 or more off the model in every direction.
    for (const h of steps(0, deck.floor, 0.5)) {
      const v = ladderLine(h, WALK.body),
        eye = h + WALK.eye;
      for (const [du, dh, dv] of [
        [1, 0, 0],
        [-1, 0, 0],
        [0, 0, 1],
        [0, 0, -1],
        [0, 1, 0],
        [0.7, 0, -0.7],
        [-0.7, 0, -0.7],
      ])
        assert.ok(hit(0, eye, v, du, dh, dv, 2) >= 0.5, `${tier} eye at ${h} toward ${du},${dv}`);
    }
  }
});

test("a drop off the lookout falls clear of it: a vault over each side, or letting go of the ladder", () => {
  const { deck } = LOOKOUT,
    g = WALK.gravity,
    { push, lift } = WALK.vault;
  // The fall from (u, h, v) out along (nu, nv): rays back toward the lookout
  // from the body's centre at its feet, its middle and its eye.
  const fall = ({ hit }, u, h, v, nu, nv, rise, label) => {
    for (let t = 0; h + rise * t - (g / 2) * t * t > 0; t += 0.05) {
      const y = h + rise * t - (g / 2) * t * t,
        pu = u + nu * push * t,
        pv = v + nv * push * t;
      for (const up of [0.3, WALK.eye / 2, WALK.eye])
        for (const [du, dv] of [
          [-nu, -nv],
          [-nu - nv * 0.6, -nv + nu * 0.6],
          [-nu + nv * 0.6, -nv - nu * 0.6],
        ])
          assert.ok(
            hit(pu, y + up, pv, du, 0, dv, 3) >= WALK.body * 0.9,
            `${label} at t ${t.toFixed(2)}`,
          );
    }
  };
  for (const tier of ["high", "balanced"]) {
    const model = probe(tier),
      hull = towerFootprint(towerRoot(tier)),
      body = WALK.deckBody;
    // From each side's walk, facing out.
    for (const [u, v, fu, fv] of [
      [deck.x - body, 0, 1, 0],
      [-deck.x + body, -3, -1, 0],
      [3.5, deck.back + body, 0, -1],
      [-3.8, deck.front - body, 0, 1],
      [0, ladderLine(deck.floor, WALK.body), 0, 1],
    ]) {
      const to = vaultTo(u, v, fu, fv, body, WALK.body);
      assert.ok(to, `${tier} vault from ${u},${v}`);
      fall(model, to.u, deck.floor, to.v, to.nu, to.nv, lift, `${tier} vault ${u},${v}`);
      // It lands well outside the base's hull.
      const t = (lift + Math.sqrt(lift * lift + 2 * g * deck.floor)) / g,
        landing = model.frame.world(to.u + to.nu * push * t, 0, to.v + to.nv * push * t);
      assert.ok(outside(hull, landing.x, landing.z) >= WALK.body + 2, `${tier} lands ${u},${v}`);
    }
    // Letting go anywhere up the ladder.
    for (const h of [1, 3, 6, 10, 15, 21, 27, deck.floor]) {
      fall(model, 0, h, ladderLine(h, WALK.body), 0, 1, 0, `${tier} let go at ${h}`);
      const t = Math.sqrt((2 * h) / g),
        landing = model.frame.world(0, 0, ladderLine(h, WALK.body) + push * t);
      assert.ok(outside(hull, landing.x, landing.z) >= WALK.body - 0.6, `${tier} let go ${h}`);
    }
  }
});

test("the gallery holds the walker inside its railing and clear of the cabin, out only by the ladder's lane", () => {
  const { deck, cabin } = LOOKOUT,
    body = WALK.deckBody,
    end = ladderLine(deck.floor, WALK.body),
    lane = deck.gap - body,
    inBox = (u, v, u0, u1, v0, v1) =>
      u > u0 - body + 1e-9 && u < u1 + body - 1e-9 && v > v0 - body + 1e-9 && v < v1 + body - 1e-9;
  let seed = 7;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let walker = 0; walker < 40; walker++) {
    let u = 4 * random(),
      v = -5.4;
    [u, v] = deckStep(u, v, u, v, body, end);
    let heading = Math.PI * random();
    for (let i = 0; i < 600; i++) {
      if (i % 40 === 0) heading = Math.PI * random();
      const [nu, nv] = deckStep(
        u,
        v,
        u + 0.2 * Math.sin(heading),
        v + 0.2 * Math.cos(heading),
        body,
        end,
      );
      assert.ok(Math.abs(nu) <= deck.x - body + 1e-9, `the side railing at ${nu}`);
      assert.ok(nv >= deck.back + body - 1e-9 && nv <= end + 1e-9, `the ends at ${nv}`);
      if (nv > deck.front - body + 1e-9) assert.ok(Math.abs(nu) <= lane + 1e-9, `the gap at ${nu}`);
      for (const s of [1, -1]) {
        const [a, b] = s > 0 ? [cabin.inner, cabin.outer] : [-cabin.outer, -cabin.inner];
        assert.ok(!inBox(nu, nv, a, b, cabin.back, cabin.front), `the wall at ${nu},${nv}`);
      }
      [u, v] = [nu, nv];
    }
  }
  // Round the cabin's ends: the walks past its front and back stay open.
  assert.deepEqual(deckStep(3.9, 4.4, 3.4, 4.4, body, end), [3.4, 4.4]);
  assert.deepEqual(deckStep(-3.9, -5.5, -3.4, -5.5, body, end), [-3.4, -5.5]);
  // Into the lane from the gallery, never through the railing beside it.
  assert.deepEqual(deckStep(0, 4.6, 0, 4.9, body, end), [0, 4.9]);
  const [beside, held] = deckStep(2, 4.6, 2, 4.9, body, end);
  assert.equal(beside, 2);
  close(held, deck.front - body, 1e-9);
  assert.deepEqual(deckStep(0, 6, 2, 7, body, end), [lane, end]);
  // A vault needs the railing within reach and the view facing out.
  assert.equal(vaultTo(0, 0, 1, 0, body, WALK.body), null);
  assert.equal(vaultTo(deck.x - body, 0, -1, 0, body, WALK.body), null);
  assert.equal(vaultTo(deck.x - body, 0, 0, 1, body, WALK.body), null);
  assert.ok(vaultTo(deck.x - body - 0.2, 0, 0.8, 0.6, body, WALK.body));
});

// A rig over the real lookout, its shot in front of the ladder; turn() faces
// the walker along a direction in the lookout's frame (the captured mouse),
// hold() keeps keys down until a check passes.
function lookoutRig() {
  const tower = towerRoot("high"),
    frame = towerFrame(tower),
    rig = walkRig({ tower }),
    { site, shot, walk } = rig;
  const from = frame.world(0, 8, 16),
    aim = frame.world(0, 20, 0);
  shot.position.set(from.x, from.y, from.z);
  shot.target.set(aim.x, aim.y, aim.z);
  const local = () => frame.local(walk.state.x, walk.state.y, walk.state.z);
  return {
    ...rig,
    frame,
    local,
    hull: towerFootprint(tower),
    turn(u, v) {
      const way = frame.outward(u, v),
        yaw = Math.atan2(-way.x, -way.z);
      let turn = yaw - walk.state.yaw;
      turn = Math.atan2(Math.sin(turn), Math.cos(turn));
      site.win.dispatchEvent(
        Object.assign(new Event("mousemove"), { movementX: -turn / WALK.look, movementY: 0 }),
      );
      walk.update(1 / 60, 1600, 900);
    },
    hold(codes, until, seconds = 20, each = () => {}) {
      for (const code of codes) site.win.dispatchEvent(key("keydown", code));
      let frames = 0;
      for (; frames < seconds * 60 && !until(); frames++) {
        walk.update(1 / 60, 1600, 900);
        each();
      }
      for (const code of codes) site.win.dispatchEvent(key("keyup", code));
      assert.ok(until(), `${codes} for ${seconds} s`);
      return frames / 60;
    },
  };
}

test("into the ladder climbs it to the gallery, through the cabin, and away from it comes back down", () => {
  const rig = lookoutRig(),
    { walk, site, local, hull } = rig,
    { deck } = LOOKOUT;
  walkIn(rig);
  site.canvas.requestPointerLock();
  const states = [];
  const track = () => {
    const at = local();
    if (states.at(-1) !== walk.state.on) states.push(walk.state.on);
    if (walk.state.on === "ladder") {
      assert.ok(Math.abs(at.u) <= 0.6, `on the ladder's line across, ${at.u}`);
      assert.ok(at.v >= ladderLine(at.h, WALK.body) - 0.05, `never into the ladder, ${at.v}`);
    }
    if (walk.state.on === "ground")
      assert.ok(outside(hull, walk.state.x, walk.state.z) >= WALK.body - 1e-6);
    if (walk.state.on === "deck")
      assert.ok(at.v <= ladderLine(deck.floor, WALK.body) + 1e-6, `past the gap's lane, ${at.v}`);
  };
  // Up: on the ground into the ladder, then up it in about six seconds.
  let climbing = 0;
  rig.hold(
    ["KeyW"],
    () => walk.state.on === "deck",
    12,
    () => {
      track();
      if (walk.state.on === "ladder") climbing += 1 / 60;
    },
  );
  track();
  assert.deepEqual(states, ["ground", "ladder", "deck"]);
  assert.ok(climbing > 5 && climbing < 7.5, `climbed in ${climbing} s`);
  close(local().h, deck.floor, 1e-6);
  // Still into it: through the gap into the open cabin, where Space (no
  // railing within reach) does nothing, and on to the back railing.
  rig.hold(["KeyW"], () => local().v <= 0, 6, track);
  rig.hold(["Space"], () => true);
  for (let i = 0; i < 30; i++) walk.update(1 / 60, 1600, 900);
  assert.equal(walk.state.on, "deck");
  close(local().h, deck.floor, 1e-6);
  rig.hold(["KeyW"], () => local().v <= deck.back + WALK.deckBody + 1e-6, 6, track);
  assert.equal(walk.state.on, "deck");
  assert.ok(Math.abs(local().u) < LOOKOUT.cabin.inner - WALK.deckBody, "through the cabin");
  close(rig.camera.position.y, walk.state.y + WALK.eye, 1e-6);
  // Back out the gap and down: S heads away from the ladder.
  rig.hold(["KeyS"], () => walk.state.on === "ground" && local().v > 11, 14, track);
  assert.deepEqual(states, ["ground", "ladder", "deck", "ladder", "ground"]);
  assert.ok(walk.state.grounded);
  walk.dispose();
});

test("Space at the railing facing out vaults it, and the drop lands on the ground with a dip", () => {
  const rig = lookoutRig(),
    { walk, site, local, hull } = rig,
    { deck } = LOOKOUT;
  walkIn(rig);
  site.canvas.requestPointerLock();
  rig.hold(["KeyW"], () => walk.state.on === "deck", 12);
  // Into the walk past the cabin's front, then along it to the side railing.
  rig.hold(["KeyW"], () => local().v <= 4.9, 3);
  for (let i = 0; i < 30; i++) walk.update(1 / 60, 1600, 900);
  const front = local().v;
  assert.ok(
    front > LOOKOUT.cabin.front + WALK.deckBody && front < deck.front - WALK.deckBody,
    `${front}`,
  );
  rig.turn(1, 0);
  rig.hold(["KeyW"], () => local().u >= deck.x - WALK.deckBody - 1e-6, 3);
  // Over and down, with no push from the base's hull on the way.
  const seen = [];
  let dipped = false;
  rig.hold(
    ["Space"],
    () => walk.state.on === "ground",
    4,
    () => {
      if (seen.at(-1) !== walk.state.on) seen.push(walk.state.on);
      if (walk.state.on === "drop")
        assert.ok(local().u >= LOOKOUT.rail.x + WALK.body, `clear of the railing at ${local().u}`);
      if (rig.camera.position.y < walk.state.y + WALK.eye - 0.2) dipped = true;
    },
  );
  assert.deepEqual(seen, ["vault", "drop", "ground"]);
  assert.ok(dipped, "the landing dips the eye");
  assert.ok(outside(hull, walk.state.x, walk.state.z) >= WALK.body + 2, "far off the base");
  close(walk.state.y, rig.options.ground(walk.state.x, walk.state.z), 1e-6);
  for (let i = 0; i < 30; i++) walk.update(1 / 60, 1600, 900);
  close(rig.camera.position.y, walk.state.y + WALK.eye, 1e-6);
  walk.dispose();
});

test("Space on the ladder lets go: the walker drops back off it to the ground", () => {
  const rig = lookoutRig(),
    { walk, site, local, hull } = rig;
  walkIn(rig);
  site.canvas.requestPointerLock();
  rig.hold(["KeyW"], () => walk.state.on === "ladder" && local().h > 12, 8);
  rig.hold(
    ["Space"],
    () => walk.state.on === "ground",
    3,
    () => {
      if (local().h < WALK.band)
        assert.ok(outside(hull, walk.state.x, walk.state.z) >= WALK.body - 1e-6);
    },
  );
  assert.ok(local().v > ladderLine(0, WALK.body) + 1, "pushed out from the ladder");
  walk.dispose();
});

test("leaving from the gallery cuts back to the tour, and the next walk starts on the ground", () => {
  const rig = lookoutRig(),
    { walk, site, local } = rig;
  walkIn(rig);
  site.canvas.requestPointerLock();
  rig.hold(["KeyW"], () => walk.state.on === "deck", 12);
  assert.equal(walk.exit({ immediate: true }), true);
  assert.equal(walk.drives, false);
  walkIn(rig);
  assert.equal(walk.state.on, "ground");
  assert.ok(local().h < 2);
  walk.dispose();
});
