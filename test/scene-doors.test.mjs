import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { flat, mediaBlock, rule } from "./support/css.mjs";
import { EASE, OPENING, TEAR } from "../src/doors/paper-doors.js";

// The opening's doors (src/ui/scene-doors.js) run in a fake DOM with controllable time,
// timers, animation frames, visibility and the paper drawing's script.
const source = await readFile(new URL("../src/ui/scene-doors.js", import.meta.url), "utf8");
const styles = flat(await readFile(new URL("../styles.css", import.meta.url), "utf8"));
const DOORS_URL = "/scripts/doors.0123abcd.js";

class FakeClassList {
  #names = new Set();
  constructor(onChange) {
    this.onChange = onChange;
  }
  contains(name) {
    return this.#names.has(name);
  }
  add(...names) {
    names.forEach((name) => this.#names.add(name));
    this.onChange();
  }
  remove(...names) {
    names.forEach((name) => this.#names.delete(name));
    this.onChange();
  }
  toggle(name, force) {
    const on = force ?? !this.#names.has(name);
    if (on) this.#names.add(name);
    else this.#names.delete(name);
    this.onChange();
    return on;
  }
  get value() {
    return [...this.#names].sort().join(" ");
  }
}

function createHarness({
  startedAt = 120,
  display = "block",
  doorsUrl = DOORS_URL,
  withDoors = true,
  moreContrast = false,
} = {}) {
  let now = startedAt;
  const timers = new Map();
  let nextTimer = 1;
  const frames = [];
  const listeners = new Map();
  const scripts = [];
  const log = [];

  const glow = () => ({ style: { transform: "", opacity: "" } });
  const glows = [glow(), glow()];
  const properties = new Map();
  // The stylesheet's own opening, as the Web Animations API shows it on a half: its
  // clock, or none where the browser cannot tell.
  let animationClock = null;
  const leaf = {
    getAnimations: () => (animationClock === null ? [] : [{ currentTime: animationClock }]),
  };
  const doors = {
    hidden: false,
    clientWidth: 1440,
    clientHeight: 900,
    style: { setProperty: (name, value) => properties.set(name, value) },
    querySelector: (selector) => (selector === ".scene-doors__leaf" ? leaf : null),
    querySelectorAll: (selector) => (selector === ".scene-doors__glow" ? glows : []),
    addEventListener(type, handler) {
      listeners.set(`doors:${type}`, handler);
    },
    removeEventListener(type) {
      listeners.delete(`doors:${type}`);
    },
  };
  doors.classList = new FakeClassList(() => log.push(`class ${doors.classList.value}`));

  const document = {
    hidden: false,
    getElementById: (id) => (id === "scene-doors" && withDoors ? doors : null),
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    removeEventListener(type) {
      listeners.delete(type);
    },
    createElement(tag) {
      const element = { tag, async: false };
      return element;
    },
    head: { appendChild: (script) => scripts.push(script) },
  };

  function schedule(callback, ms, every) {
    const id = nextTimer++;
    timers.set(id, { at: now + ms, callback, every });
    return id;
  }
  const window = {
    BabelSite: {},
    performance: { now: () => now },
    getComputedStyle: () => ({ display }),
    matchMedia: (query) => ({ matches: query === "(prefers-contrast: more)" && moreContrast }),
    location: { href: "https://alexnava.me/" },
    devicePixelRatio: 2,
    requestAnimationFrame(callback) {
      frames.push(callback);
      return frames.length;
    },
    setTimeout: (callback, ms) => schedule(callback, ms, 0),
    setInterval: (callback, ms) => schedule(callback, ms, ms),
    clearTimeout: (id) => timers.delete(id),
    clearInterval: (id) => timers.delete(id),
  };
  const context = { window, document, URL };
  if (doorsUrl !== null) context.__BABEL_DOORS_URL__ = doorsUrl;
  vm.runInNewContext(source, context, { filename: "src/ui/scene-doors.js" });

  function advance(ms) {
    const end = now + ms;
    for (;;) {
      const due = [...timers]
        .filter(([, timer]) => timer.at <= end)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      const [id, timer] = due;
      now = timer.at;
      if (timer.every) timer.at += timer.every;
      else timers.delete(id);
      timer.callback();
    }
    now = end;
  }

  return {
    doors,
    glows,
    properties,
    scripts,
    log,
    site: window.BabelSite,
    sceneDoors: window.BabelSite.sceneDoors,
    get classes() {
      return doors.classList.value;
    },
    get timerCount() {
      return timers.size;
    },
    advance,
    // Runs the pending animation frames `count` times, `step` ms apart.
    frames(count, step = 16) {
      for (let i = 0; i < count; i++) {
        now += step;
        frames.splice(0).forEach((callback) => callback(now));
        advance(0);
      }
    },
    setHidden(hidden) {
      document.hidden = hidden;
      listeners.get("visibilitychange")?.();
    },
    setClock(ms) {
      animationClock = ms;
    },
    fire(type) {
      listeners.get(type)?.();
    },
  };
}

// A drawing like src/doors-entry.js hands the doors: it records what it was asked.
function fakeDrawing() {
  const calls = [];
  let parted;
  return {
    calls,
    drawing: {
      light: (lit) => calls.push(["light", lit.warm]),
      open: () => {
        calls.push(["open"]);
        return new Promise((resolve) => (parted = resolve));
      },
      dispose: () => calls.push(["dispose"]),
    },
    part: () => parted?.(),
  };
}

test("the doors hold as soon as the script runs, before the stylesheet's own opening", () => {
  const h = createHarness();
  assert.equal(h.sceneDoors.state, "held");
  assert.match(h.classes, /\bis-held\b/);
  assert.doesNotMatch(h.classes, /\bis-open\b/);
});

test("a script that runs after the stylesheet began opening leaves it to finish", () => {
  const h = createHarness({ startedAt: 3900 });
  assert.equal(h.sceneDoors.state, "failsafe");
  assert.doesNotMatch(h.classes, /\bis-held\b/);
  h.sceneDoors.open("revealed");
  assert.doesNotMatch(h.classes, /\bis-open\b/);
  h.advance(2300);
  assert.equal(h.doors.hidden, true);
});

test("without doors (reduced motion, forced colours) nothing is held or opened", () => {
  const h = createHarness({ display: "none" });
  assert.equal(h.sceneDoors.state, "absent");
  h.sceneDoors.open("static");
  h.sceneDoors.light({ progress: 0.5 });
  assert.equal(h.classes, "");
  assert.equal(h.timerCount, 0);
});

test("a static path opens the doors at once and they leave the page", () => {
  const h = createHarness();
  h.sceneDoors.open("static");
  assert.match(h.classes, /\bis-open\b/);
  assert.equal(h.sceneDoors.state, "open");
  h.advance(2299);
  assert.equal(h.doors.hidden, false);
  h.advance(1);
  assert.equal(h.doors.hidden, true);
  assert.equal(h.sceneDoors.state, "gone");
  assert.equal(h.timerCount, 0, "the cap's interval is released");
});

test("at the reveal the doors wait out the canvas's fade and then even frames", () => {
  const h = createHarness();
  h.sceneDoors.open("revealed");
  assert.doesNotMatch(h.classes, /\bis-open\b/);
  h.advance(480);
  // A long frame (the scene's work) restarts the wait.
  h.frames(8, 16);
  h.frames(1, 300);
  h.frames(10, 16);
  assert.doesNotMatch(h.classes, /\bis-open\b/);
  h.frames(4, 16);
  assert.match(h.classes, /\bis-open\b/);
});

test("the reveal's wait for even frames ends at its limit", () => {
  const h = createHarness();
  h.sceneDoors.open("revealed");
  h.advance(480);
  // Frames that never settle: every other one is long. 900ms after the fade, the doors
  // part anyway.
  for (let i = 0; i < 8; i++) {
    h.frames(1, 16);
    h.frames(1, 90);
  }
  assert.doesNotMatch(h.classes, /\bis-open\b/);
  for (let i = 0; i < 2; i++) {
    h.frames(1, 16);
    h.frames(1, 90);
  }
  assert.match(h.classes, /\bis-open\b/);
});

test("without frames (a hidden tab) the reveal's doors still part on the timers", () => {
  const h = createHarness();
  h.sceneDoors.open("revealed");
  h.advance(480 + 900 + 399);
  assert.doesNotMatch(h.classes, /\bis-open\b/);
  h.advance(1);
  assert.match(h.classes, /\bis-open\b/);
});

test("the cap opens held doors after 10s of visible time; hidden time pauses it", () => {
  const h = createHarness();
  h.advance(4000);
  h.setHidden(true);
  assert.match(h.classes, /\bis-paused\b/);
  h.advance(30000);
  assert.doesNotMatch(h.classes, /\bis-open\b/);
  h.setHidden(false);
  assert.doesNotMatch(h.classes, /\bis-paused\b/);
  h.advance(5750);
  assert.doesNotMatch(h.classes, /\bis-open\b/);
  h.advance(500);
  assert.match(h.classes, /\bis-open\b/);
});

test("the cap reads the stylesheet's own clock, so it always comes before the backstop", () => {
  const h = createHarness();
  // The page was hidden for most of the load: the script's own count would be far
  // behind, but the stylesheet's clock (paused while hidden) says 9.8s of visible time.
  h.setClock(9800);
  h.advance(250);
  assert.doesNotMatch(h.classes, /\bis-open\b/);
  h.setClock(10050);
  h.advance(250);
  assert.match(h.classes, /\bis-open\b/);
});

test("a backstop already under way finishes as it is, and the drawing gives way to it", () => {
  const h = createHarness();
  h.sceneDoors.upgrade({ tier: "high" });
  let options;
  h.site.paperDoors = { start: (doors, given) => (options = given) };
  h.scripts[0].onload();
  const fake = fakeDrawing();
  options.drawn(fake.drawing);
  h.advance(600);
  assert.match(h.classes, /\bis-drawn-only\b/);
  // The script was held up past the stylesheet's backstop (11s on its clock).
  h.setClock(11400);
  h.sceneDoors.open("static");
  assert.doesNotMatch(h.classes, /\bis-open\b/, "no second opening over the first");
  assert.doesNotMatch(h.classes, /\bis-drawn\b/, "the stylesheet's halves show");
  assert.deepEqual(fake.calls.at(-1), ["dispose"]);
  h.advance(2300);
  assert.equal(h.doors.hidden, true);
});

test("light() places the stylesheet's glow and lights the seam while the doors are held", () => {
  const h = createHarness();
  h.sceneDoors.light({ star: { x: 1188, y: 498, radius: 26.5 }, warm: 0.25, progress: 0.62 });
  assert.equal(h.properties.get("--doors-light"), "0.62");
  assert.equal(h.glows[0].style.opacity, "0.25");
  assert.match(h.glows[0].style.transform, /^translate\(1188px, 498px\) scale\([\d.]+\)$/);
  h.sceneDoors.light({ star: null, warm: 0.9, progress: 0.7 });
  assert.equal(h.glows[1].style.opacity, "0", "no star, no glow");
  h.sceneDoors.open("static");
  h.sceneDoors.light({ star: null, warm: 0, progress: 0.99 });
  assert.equal(h.properties.get("--doors-light"), "0.7", "open doors take no light");
});

test("the live path loads the paper doors' script and hands the doors to the drawing", async () => {
  const h = createHarness();
  h.sceneDoors.upgrade({ tier: "high" });
  assert.equal(h.scripts.length, 1);
  assert.equal(h.scripts[0].src, DOORS_URL);
  assert.equal(h.sceneDoors.drawing, "loading");
  h.sceneDoors.upgrade({ tier: "high" });
  assert.equal(h.scripts.length, 1, "one drawing per page");
  let started;
  h.site.paperDoors = { start: (doors, options) => (started = { doors, options }) };
  h.scripts[0].onload();
  assert.equal(started.doors, h.doors);
  assert.equal(started.options.tier, "high");
  const fake = fakeDrawing();
  h.sceneDoors.light({ star: { x: 10, y: 10, radius: 4 }, warm: 0.5, progress: 0.5 });
  started.options.drawn(fake.drawing);
  assert.equal(h.sceneDoors.drawing, "drawn");
  assert.match(h.classes, /\bis-drawn\b/);
  assert.deepEqual(fake.calls.at(-1), ["light", 0.5], "the drawing starts from the latest light");
  h.advance(600);
  assert.match(h.classes, /\bis-drawn-only\b/);
  h.sceneDoors.light({ star: { x: 10, y: 10, radius: 4 }, warm: 0.8, progress: 0.9 });
  assert.deepEqual(fake.calls.at(-1), ["light", 0.8]);
  h.sceneDoors.open("static");
  assert.deepEqual(fake.calls.at(-1), ["open"]);
  h.advance(2300);
  assert.equal(h.doors.hidden, true);
  assert.deepEqual(fake.calls.at(-1), ["dispose"], "the drawing goes with the doors");
});

test("a failed drawing gives the doors back to the stylesheet", () => {
  const h = createHarness();
  h.sceneDoors.upgrade({ tier: "balanced" });
  let options;
  h.site.paperDoors = { start: (doors, given) => (options = given) };
  h.scripts[0].onload();
  const fake = fakeDrawing();
  options.drawn(fake.drawing);
  h.advance(600);
  options.failed(fake.drawing, "context lost");
  assert.doesNotMatch(h.classes, /\bis-drawn\b/);
  assert.doesNotMatch(h.classes, /\bis-drawn-only\b/);
  assert.equal(h.sceneDoors.drawing, "context lost");
  assert.deepEqual(fake.calls.at(-1), ["dispose"]);
  assert.equal(h.sceneDoors.state, "held", "the stylesheet's doors stay closed until the reveal");
});

test("a drawing that arrives after the doors opened is let go at once", () => {
  const h = createHarness();
  h.sceneDoors.upgrade({ tier: "balanced" });
  let options;
  h.site.paperDoors = { start: (doors, given) => (options = given) };
  h.scripts[0].onload();
  h.sceneDoors.open("static");
  const fake = fakeDrawing();
  options.drawn(fake.drawing);
  assert.deepEqual(fake.calls, [["dispose"]]);
  assert.doesNotMatch(h.classes, /\bis-drawn\b/);
});

test("a script that fails to load or start leaves the stylesheet's doors", () => {
  const failing = createHarness();
  failing.sceneDoors.upgrade({ tier: "high" });
  failing.scripts[0].onerror();
  assert.equal(failing.sceneDoors.drawing, "the drawing's script failed");
  const broken = createHarness();
  broken.sceneDoors.upgrade({ tier: "high" });
  broken.scripts[0].onload();
  assert.equal(broken.sceneDoors.drawing, "the drawing did not start");
  assert.doesNotMatch(broken.classes, /\bis-drawn\b/);
});

test("a drawing that throws is dropped without reaching the loading line", () => {
  const h = createHarness();
  h.sceneDoors.upgrade({ tier: "high" });
  let options;
  h.site.paperDoors = { start: (doors, given) => (options = given) };
  h.scripts[0].onload();
  const calls = [];
  options.drawn({
    light: () => {
      throw new Error("lost");
    },
    open: () => Promise.resolve(),
    dispose: () => calls.push("dispose"),
  });
  assert.doesNotThrow(() => h.sceneDoors.light({ progress: 0.4 }));
  assert.deepEqual(calls, ["dispose"]);
  assert.doesNotMatch(h.classes, /\bis-drawn\b/);
});

test("increased contrast keeps the stylesheet's plain paper and loads no drawing", () => {
  const h = createHarness({ moreContrast: true });
  h.sceneDoors.upgrade({ tier: "high" });
  assert.equal(h.scripts.length, 0);
  assert.equal(h.sceneDoors.drawing, "none");
  assert.equal(h.sceneDoors.state, "held", "the doors themselves still stand and part");
});

test("without a built doors script the stylesheet's doors stand alone", () => {
  const h = createHarness({ doorsUrl: "" });
  h.sceneDoors.upgrade({ tier: "high" });
  assert.equal(h.scripts.length, 0);
  assert.equal(h.sceneDoors.drawing, "none");
});

// The tear's points in a half's clip-path: px from the window's centre and % down it.
function tearPoints(body) {
  const clip = body.match(/clip-path: polygon\((.*)\)/)?.[1] ?? "";
  return [...clip.matchAll(/(?:calc\(50% ([+-]) ([\d.]+)px\)|50%) ([\d.]+)%/g)].map(
    ([, sign, px, y]) => ({ x: sign ? (sign === "-" ? -1 : 1) * Number(px) : 0, y: Number(y) }),
  );
}

test("the stylesheet's tear is cut from the drawing's 81 points, the halves overlapping", () => {
  const left = tearPoints(rule(styles, ".scene-doors__leaf--left .scene-doors__paper"));
  const right = tearPoints(rule(styles, ".scene-doors__leaf--right .scene-doors__paper"));
  assert.equal(TEAR.length, 81);
  assert.equal(left.length, 81);
  assert.equal(right.length, 81);
  TEAR.forEach((offset, i) => {
    assert.ok(Math.abs(left[i].x - (offset + 0.3)) < 0.06, `left point ${i}: ${left[i].x}`);
    assert.ok(Math.abs(right[i].x - (offset - 0.3)) < 0.06, `right point ${i}: ${right[i].x}`);
    assert.ok(Math.abs(left[i].y - (i / 80) * 100) < 0.006, `point ${i} height`);
    assert.equal(right[i].y, left[i].y);
  });
});

test("the stylesheet's failsafe, backstop and opening agree with the script and the drawing", () => {
  const constant = (name) => Number(source.match(new RegExp(`const ${name} = (\\d+)`))?.[1]);
  // Unheld, the stylesheet opens the doors 4s in; the script holds them only before that.
  assert.match(
    rule(styles, ".scene-doors__leaf--left"),
    /animation: scene-doors-left var\(--doors-duration\) var\(--doors-ease\) 4000ms both/,
  );
  assert.match(
    rule(styles, ".scene-doors__leaf--right"),
    /animation: scene-doors-right var\(--doors-duration\) var\(--doors-ease\) 4000ms both/,
  );
  assert.match(source, /const FAILSAFE_MS = 4000 - 150;/);
  // Held, the stylesheet's backstop comes after the script's own cap, as the script knows.
  const backstop = Number(
    rule(styles, ".scene-doors.is-held .scene-doors__leaf").match(/animation-delay: (\d+)ms/)?.[1],
  );
  assert.equal(backstop, constant("BACKSTOP_MS"));
  assert.ok(backstop > constant("CAP_MS"), `${backstop}ms backstop`);
  // The stylesheet and the drawing open on one timing, travel and turn, and the doors
  // leave the page only after it.
  const doors = rule(styles, ".scene-doors");
  assert.match(doors, new RegExp(`--doors-duration: ${OPENING.duration}ms;`));
  assert.match(doors, new RegExp(`--doors-ease: cubic-bezier\\(${EASE.join(", ")}\\);`));
  const travel = Math.round(OPENING.travel * 100);
  for (const name of ["scene-doors-left", "scene-doors-part-left"]) {
    assert.ok(
      styles.includes(
        `@keyframes ${name} { to { transform: translateX(-${travel}%) rotate(-${OPENING.turn}deg); } }`,
      ),
      name,
    );
  }
  assert.ok(
    styles.includes(
      `@keyframes scene-doors-stay-left { to { transform: rotate(${OPENING.turn}deg) translateX(${travel}%); } }`,
    ),
  );
  assert.ok(constant("LEAVE_MS") > OPENING.duration);
  // No doors without motion or in system colours.
  assert.match(
    mediaBlock(styles, "(prefers-reduced-motion: reduce), (forced-colors: active)"),
    /\.scene-doors \{ display: none; \}/,
  );
});
