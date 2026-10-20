// The walk (docs/SCENE-MODES.md): on a desktop, ` or ~ over the live scene
// drops the visitor onto the estate's ground in first person, and the same key
// (or Esc twice: the first frees the mouse) hands the camera back to the tour's
// shot. A lazy chunk fetched on the first press; it imports nothing, so
// index.js passes the camera, the ground's height, the solids and the page.
//
// Units are the scene's (a doorway is 6.6). eye: the eye's height over the
// feet. speed: walking, jogging (Shift doubles every direction), backing and
// side-stepping, per second; accel and brake ease toward them, and off the
// ground only `air` of that control remains. jump and gravity give an apex of
// about 2.25. turn: the arrow keys' turn in radians a second; look: radians
// per pixel of captured mouse movement, drag the same while the mouse is free.
// pitch: the look's limit up and down. fov: horizontal degrees, held as a
// vertical fov within [min, max]. body: the walker's radius against solids;
// stepDown: how far the feet follow the ground down before they leave it;
// rise: how fast the eye climbs a step. bound: outward motion fades out
// between soft and hard (from the watch's terrace, inside the sky's dome of 130), and
// toward the sea between shore[0] and shore[1] from the cliffs' lip (the
// fault's distance, which index.js lends). shadow: the moon's shadow follows
// a point `ahead` of the walker snapped to `cell`, over `radius` (rendering.js
// focusFilmShadow()), so its map redraws only on a cell change. tree: the
// trunk with its root flare; lantern: the lantern's post; solid: rocks this tall or taller block
// the way (pebbles never). uiFade: the page's fade out and back (styles.css).
// unlockGrace: an Esc this soon after the mouse is freed is the same press.
// substep: the longest motion step; a slower frame takes several.
// landing: a landing dips the eye by up to `dip`, for impacts from `from`
// over `span` a second, and it recovers at `recover`.
export const WALK = Object.freeze({
  eye: 5.3,
  speed: Object.freeze({ walk: 6.75, jog: 13.5, back: 4.8, strafe: 5.7 }),
  accel: 27,
  brake: 36,
  air: 0.15,
  jump: 12,
  gravity: 32,
  turn: 1.9,
  look: 0.0022,
  drag: 0.0045,
  pitch: 1.4,
  fov: Object.freeze({ horizontal: 80, min: 44, max: 60 }),
  body: 0.7,
  stepDown: 0.6,
  rise: 14,
  bound: Object.freeze({ soft: 104, hard: 114, shore: Object.freeze([6, 1.2]) }),
  shadow: Object.freeze({ ahead: 16, cell: 6, radius: 40 }),
  tree: 3.4,
  lantern: 0.6,
  solid: 0.5,
  uiFade: 0.42,
  unlockGrace: 0.15,
  substep: 1 / 60,
  landing: Object.freeze({ dip: 0.6, from: 14, span: 30, recover: 2 }),
});

// The vertical fov (degrees) that shows `horizontal` degrees across this
// aspect, within [min, max]: about 50 at 16:9, never fisheye on ultrawide.
export function walkFov(aspect, c = WALK) {
  const half = (c.fov.horizontal * Math.PI) / 360,
    vertical = (360 / Math.PI) * Math.atan(Math.tan(half) / Math.max(1e-6, aspect));
  return Math.min(c.fov.max, Math.max(c.fov.min, vertical));
}

// Turns the view by a mouse movement: right turns right, down looks down,
// the pitch within ±limit. Mutates and returns view.
export function look(view, dx, dy, k, limit) {
  view.yaw -= dx * k;
  view.pitch = Math.min(limit, Math.max(-limit, view.pitch - dy * k));
  return view;
}

// The velocity the keys ask for in world x/z: forward along the view's yaw
// (Three's cameras look down -z), strafe to its right; a diagonal is no faster
// than its faster key.
export function wish(intent, yaw, c = WALK, out = { x: 0, z: 0 }) {
  const jog = intent.jog ? c.speed.jog / c.speed.walk : 1;
  let forward = (intent.forward > 0 ? c.speed.walk : c.speed.back) * intent.forward * jog,
    right = c.speed.strafe * intent.strafe * jog;
  const length = Math.hypot(forward, right),
    cap = Math.max(Math.abs(forward), Math.abs(right));
  if (length > cap) {
    forward *= cap / length;
    right *= cap / length;
  }
  const sin = Math.sin(yaw),
    cos = Math.cos(yaw);
  out.x = -sin * forward + cos * right;
  out.z = -cos * forward - sin * right;
  return out;
}

// One step of the walker: x/z ease toward the wished velocity (accel, or brake
// with no key held; only `air` of it off the ground), a jump leaves the ground
// and gravity pulls while airborne. Mutates and returns body.
export function integrate(body, want, jump, dt, c = WALK) {
  const control = body.grounded ? 1 : c.air,
    rate = (want.x || want.z ? c.accel : c.brake) * control * dt,
    dx = want.x - body.vx,
    dz = want.z - body.vz,
    gap = Math.hypot(dx, dz);
  if (gap <= rate) {
    body.vx = want.x;
    body.vz = want.z;
  } else {
    body.vx += (dx / gap) * rate;
    body.vz += (dz / gap) * rate;
  }
  if (jump && body.grounded) {
    body.vy = c.jump;
    body.grounded = false;
  }
  if (!body.grounded) body.vy -= c.gravity * dt;
  body.x += body.vx * dt;
  body.y += body.vy * dt;
  body.z += body.vz * dt;
  return body;
}

// The feet on the ground: a falling or level body lands on it, and a grounded
// one follows it down a slope or step of up to stepDown; past that it falls.
export function land(body, ground, c = WALK) {
  if (body.vy <= 0 && (body.y <= ground || (body.grounded && body.y - ground <= c.stepDown))) {
    body.y = ground;
    body.vy = 0;
    body.grounded = true;
  } else body.grounded = false;
  return body;
}

// Pushes the point out of each circle ({x, z, r}) grown by the body's radius.
export function pushOutCircles(x, z, circles, body, out = [0, 0]) {
  for (const circle of circles) {
    const reach = circle.r + body,
      dx = x - circle.x,
      dz = z - circle.z,
      d = Math.hypot(dx, dz);
    if (d >= reach) continue;
    if (d < 1e-9) x = circle.x + reach;
    else {
      x = circle.x + (dx / d) * reach;
      z = circle.z + (dz / d) * reach;
    }
  }
  out[0] = x;
  out[1] = z;
  return out;
}

// Clear of every solid: three passes over the circles.
export function settle(x, z, solids, c = WALK, out = [0, 0]) {
  out[0] = x;
  out[1] = z;
  for (let pass = 0; pass < 3; pass++) pushOutCircles(out[0], out[1], solids.circles, c.body, out);
  return out;
}

// The unit direction inland at x/z: up the fault's distance `shore`.
function inland(shore, x, z, out = [0, 0]) {
  const e = 0.05,
    gx = shore(x + e, z) - shore(x - e, z),
    gz = shore(x, z + e) - shore(x, z - e),
    l = Math.hypot(gx, gz) || 1;
  out[0] = gx / l;
  out[1] = gz / l;
  return out;
}

// Limits outward motion near the edge: between bound.soft and bound.hard (from
// the watch's terrace), and toward the sea between bound.shore[0] and [1] from the cliffs'
// lip (shore: the fault's distance at x/z, positive inland), the outward part of
// a step fades out, and no step ends beyond hard or nearer the lip than
// shore[1]. Inward and sideways motion are untouched.
export function boundStep(px, pz, x, z, c = WALK, out = [0, 0], shore = null) {
  const { soft, hard } = c.bound,
    [ease, lip] = c.bound.shore,
    r = Math.hypot(x, z),
    d = shore?.(x, z) ?? Infinity;
  out[0] = x;
  out[1] = z;
  // How far into each fade the step ends (0 at its start, 1 at the edge).
  const ring = (r - soft) / (hard - soft),
    cliff = (ease - d) / (ease - lip);
  if (ring <= 0 && cliff <= 0) return out;
  let nx, nz;
  if (cliff > ring) [nx, nz] = inland(shore, x, z).map((v) => -v);
  else [nx, nz] = [x / r, z / r];
  const outward = (x - px) * nx + (z - pz) * nz;
  if (outward > 0) {
    const t = Math.min(1, Math.max(ring, cliff)),
      cut = outward * t * t;
    out[0] -= nx * cut;
    out[1] -= nz * cut;
  }
  const reach = Math.hypot(out[0], out[1]);
  if (reach > hard) {
    out[0] *= hard / reach;
    out[1] *= hard / reach;
  }
  // Back from the lip along the fault's slope (its distance is about one a unit).
  for (let i = 0, gap; shore && i < 3 && (gap = lip - shore(out[0], out[1])) > 0; i++) {
    const [ix, iz] = inland(shore, out[0], out[1]);
    out[0] += ix * gap;
    out[1] += iz * gap;
  }
  return out;
}

// The moon's shadow focus: a point `ahead` of the walker, snapped to `cell`.
export function focusCell(x, z, yaw, c = WALK, out = { x: 0, z: 0 }) {
  const { ahead, cell } = c.shadow;
  out.x = Math.round((x - Math.sin(yaw) * ahead) / cell) * cell;
  out.z = Math.round((z - Math.cos(yaw) * ahead) / cell) * cell;
  return out;
}

// Where the walk starts: under the shot's camera, inside the bound (where its
// fades begin) and clear of every solid, facing the shot's subject.
export function spawn(view, solids, c = WALK, shore = null) {
  let x = view.position.x,
    z = view.position.z;
  const r = Math.hypot(x, z),
    ease = c.bound.shore[0];
  if (r > c.bound.soft) {
    x *= c.bound.soft / r;
    z *= c.bound.soft / r;
  }
  for (let i = 0, gap; shore && i < 3 && (gap = ease - shore(x, z)) > 0; i++) {
    const [ix, iz] = inland(shore, x, z);
    x += ix * gap;
    z += iz * gap;
  }
  [x, z] = settle(x, z, solids, c);
  const target = view.target ?? { x: 0, z: 0 };
  return { x, z, yaw: Math.atan2(-(target.x - x), -(target.z - z)) };
}

// The visitor's keys and mouse, read once a frame (read()). W/S or the up and
// down arrows walk, A/D step aside, the left and right arrows turn, Shift
// jogs and Space jumps; while the mouse is captured its movement looks around,
// and while it is free a held button drags the view (a click asks to capture
// it again). Esc frees the mouse; a second Esc while it is free leaves (onLeave).
// Keys clear when the window or the page hides; a lost GL context leaves at once.
export function createDesktopInput({
  canvas,
  win = globalThis,
  doc = globalThis.document,
  onLeave = () => {},
  onLost = () => {},
  now = () => win.performance?.now?.() ?? Date.now(),
}) {
  const MOVES = new Set([
    "KeyW",
    "KeyA",
    "KeyS",
    "KeyD",
    "ArrowUp",
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
    "ShiftLeft",
    "ShiftRight",
    "Space",
  ]);
  const keys = new Set();
  let dx = 0,
    dy = 0,
    dragging = false,
    jump = false,
    attached = false,
    unlockedAt = -Infinity,
    // The capture as its change events last reported it: the Esc that frees the
    // mouse may reach the page before its pointerlockchange, and is not a second.
    captured = false;
  const locked = () => Boolean(canvas) && doc?.pointerLockElement === canvas;
  const held = (...codes) => (codes.some((code) => keys.has(code)) ? 1 : 0);
  function capture() {
    try {
      canvas?.requestPointerLock?.()?.catch?.(() => {});
    } catch {
      // Refused (no gesture, a cooldown): the held button drags instead.
    }
  }
  function clear() {
    keys.clear();
    dx = dy = 0;
    dragging = jump = false;
  }
  const listeners = [
    [
      win,
      "keydown",
      (event) => {
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        if (event.code === "Escape") {
          if (!captured && now() - unlockedAt > WALK.unlockGrace * 1000) onLeave();
          return;
        }
        if (!MOVES.has(event.code)) return;
        event.preventDefault();
        if (event.code === "Space" && !event.repeat) jump = true;
        keys.add(event.code);
      },
    ],
    [win, "keyup", (event) => keys.delete(event.code)],
    [
      win,
      "mousemove",
      (event) => {
        if (!locked() && !dragging) return;
        dx += event.movementX || 0;
        dy += event.movementY || 0;
      },
    ],
    [
      win,
      "mousedown",
      (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        if (locked()) return;
        dragging = true;
        capture();
      },
    ],
    [win, "mouseup", () => (dragging = false)],
    [win, "blur", clear],
    [doc, "visibilitychange", () => doc.hidden && clear()],
    [
      doc,
      "pointerlockchange",
      () => {
        dragging = false;
        captured = locked();
        if (!captured) unlockedAt = now();
      },
    ],
    [canvas, "webglcontextlost", () => onLost()],
  ];
  return {
    get locked() {
      return locked();
    },
    attach() {
      if (attached) return;
      attached = true;
      clear();
      // The press that started the walk may have captured the mouse already.
      captured = locked();
      for (const [target, type, handler] of listeners) target?.addEventListener?.(type, handler);
    },
    detach() {
      if (!attached) return;
      attached = false;
      for (const [target, type, handler] of listeners) target?.removeEventListener?.(type, handler);
      clear();
      if (locked()) doc.exitPointerLock?.();
    },
    // The frame's intent; the mouse's movement and a jump are taken once.
    read(out) {
      out.forward = held("KeyW", "ArrowUp") - held("KeyS", "ArrowDown");
      out.strafe = held("KeyD") - held("KeyA");
      out.turn = held("ArrowLeft") - held("ArrowRight");
      out.jog = held("ShiftLeft", "ShiftRight") === 1;
      out.jump = jump;
      out.dx = dx;
      out.dy = dy;
      out.locked = locked();
      jump = false;
      dx = dy = 0;
      return out;
    },
  };
}

// The walk over the live scene. Its phases: idle; arming (the page fades out,
// the tour runs on until its dissolve has settled); capture (the tour's frame
// is kept, the tour holds); walking (from the cut the visitor drives the
// camera, under the film's dissolve from the kept frame); leaving (the walk's
// frame is kept); returning (from the cut the tour's frozen shot is back,
// dissolving in); then idle, the tour resumes and the page fades back.
//
// index.js calls step() each frame before the camera (it returns the frame's
// transition for the post-process pipeline) and update() while `drives`; the
// content landers and the governor take `transition` as the tour's while the
// walk holds the tour (`holdsTour`). camera: the scene's camera; canvas: its
// element (the mouse is captured on it); page: document.body, which takes
// scene-walking (the fade) and scene-walk-hidden (styles.css); ground(x, z):
// the ground's world height; shore(x, z): the fault's distance there, positive
// inland (none: no cliffs to keep back from); anchors: the trunk and the
// lantern in world x/z; rocks(): the committed rocks ({x, z, half,
// height, pebble}); view(): the shot's camera position and subject target;
// fog and fogRange(): the scene's fog and its profile's [near, far]; dissolve:
// seconds; onText(): re-measures the text guards once `textHidden` changes;
// now(): the clock the second Esc is timed by, in ms (the page's by default).
export function createWalk({
  camera,
  canvas,
  page,
  win = globalThis,
  doc = globalThis.document,
  ground,
  shore = null,
  anchors = {},
  rocks = () => [],
  view,
  fog = null,
  fogRange = () => null,
  dissolve = 1,
  onText = () => {},
  now,
  c = WALK,
}) {
  const transition = { capture: false, cut: false, progress: 1, zoom: 0 };
  const walker = {
      x: 0,
      y: 0,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      grounded: true,
    },
    sight = { yaw: 0, pitch: 0, eye: 0 },
    intent = { forward: 0, strafe: 0, turn: 0, jog: false, jump: false, dx: 0, dy: 0 },
    want = { x: 0, z: 0 },
    point = [0, 0],
    cell = { x: 0, z: 0 },
    focus = { x: 0, y: 0, z: 0 },
    frame = { radius: c.shadow.radius },
    solids = { circles: [] };
  let dip = 0;
  let phase = "idle",
    holdsTour = false,
    drives = false,
    textHidden = false,
    leave = false,
    armedAt = null,
    settledFrames = 0,
    cutAt = 0,
    inProgress = 1,
    outProgress = 1,
    order = null,
    rockList = null,
    fadeTimer = null,
    disposed = false;
  const input = createDesktopInput({
    canvas,
    win,
    doc,
    onLeave: () => exit(),
    onLost: () => exit({ immediate: true }),
    ...(now ? { now } : {}),
  });
  const forcedColors = win.matchMedia?.("(forced-colors: active)");
  const onForcedColorsChange = () => {
    if (!forcedColors?.matches) return;
    // The hidden canvas stops drawing: restore the page without a dissolve.
    exit({ immediate: true });
    // Arming may already have captured the mouse before input attaches.
    if (doc?.pointerLockElement === canvas) doc.exitPointerLock();
  };
  forcedColors?.addEventListener?.("change", onForcedColorsChange);
  // A capture requested earlier may be granted after the media change exited.
  doc?.addEventListener?.("pointerlockchange", onForcedColorsChange);
  const set = (capture, cut, progress) =>
    Object.assign(transition, { capture, cut, progress, zoom: 0 });
  function applyFog() {
    const range = fogRange();
    if (fog && range) [fog.near, fog.far] = range;
  }
  // The trunk, the lantern and the rocks (which change once they commit).
  function refreshSolids() {
    const list = rocks() ?? [];
    if (list !== rockList || solids.circles.length === 0) {
      rockList = list;
      solids.circles = [
        anchors.trunk && { x: anchors.trunk.x, z: anchors.trunk.z, r: c.tree },
        anchors.lantern && { x: anchors.lantern.x, z: anchors.lantern.z, r: c.lantern },
        ...list
          .filter((rock) => !rock.pebble && rock.height >= c.solid)
          .map((rock) => ({ x: rock.x, z: rock.z, r: rock.half })),
      ].filter(Boolean);
    }
  }
  function setText(hidden) {
    if (textHidden === hidden) return;
    textHidden = hidden;
    onText();
  }
  // A step on the ground or in the air: the solids, the bound, then the ground.
  function stepGround(dt, jump) {
    const fromX = walker.x,
      fromZ = walker.z,
      impact = -walker.vy,
      wasGrounded = walker.grounded;
    integrate(walker, want, jump, dt, c);
    settle(walker.x, walker.z, solids, c, point);
    boundStep(fromX, fromZ, point[0], point[1], c, point, shore);
    [walker.x, walker.z] = point;
    land(walker, ground(walker.x, walker.z), c);
    if (!walker.grounded || wasGrounded) return;
    const { dip: most, from, span } = c.landing;
    dip = Math.max(dip, most * Math.min(1, Math.max(0, (impact - from) / span)));
  }
  // The cut into the walk: on the ground under the shot's camera, facing its subject.
  function begin() {
    refreshSolids();
    const shot = view(),
      start = spawn(shot, solids, c, shore);
    Object.assign(walker, {
      x: start.x,
      z: start.z,
      vx: 0,
      vy: 0,
      vz: 0,
      grounded: true,
    });
    dip = 0;
    walker.y = ground(walker.x, walker.z);
    sight.eye = walker.y + c.eye;
    sight.yaw = start.yaw;
    const target = shot.target ?? { x: 0, y: sight.eye, z: 0 };
    sight.pitch = Math.min(
      0.35,
      Math.max(
        -0.25,
        Math.atan2(target.y - sight.eye, Math.hypot(target.x - walker.x, target.z - walker.z)),
      ),
    );
    order = camera.rotation.order;
    camera.rotation.order = "YXZ";
    drives = true;
    setText(true);
    applyFog();
    input.attach();
  }
  // The cut back: the tour's camera takes over this frame (cinematic.js
  // restores its fov, lens shift and fog), the text guards return first.
  function end() {
    if (!drives) return;
    drives = false;
    input.detach();
    if (order) camera.rotation.order = order;
    order = null;
    setText(false);
  }
  function release() {
    holdsTour = false;
    phase = "idle";
    leave = false;
    page?.classList?.remove("scene-walk-hidden");
    clearTimeout(fadeTimer);
    fadeTimer = setTimeout(() => page?.classList?.remove("scene-walking"), c.uiFade * 1000);
  }
  function exit({ immediate = false } = {}) {
    if (phase === "idle") return false;
    if (immediate || phase === "arming" || phase === "capture") {
      end();
      release();
      if (immediate) {
        clearTimeout(fadeTimer);
        page?.classList?.remove("scene-walking");
      }
      return true;
    }
    if (phase === "walking") leave = true;
    return true;
  }
  return {
    get active() {
      return phase !== "idle";
    },
    get holdsTour() {
      return holdsTour;
    },
    get drives() {
      return drives;
    },
    get textHidden() {
      return textHidden;
    },
    // The walk's transition while it holds the tour; null otherwise.
    get transition() {
      return holdsTour ? transition : null;
    },
    // The film's bars as a share of the shot's: they ease out under the dissolve
    // into the walk and back in under the one out of it.
    get bars() {
      if (phase === "walking") return 1 - inProgress;
      if (phase === "leaving") return 0;
      if (phase === "returning") return outProgress;
      return 1;
    },
    get focus() {
      return focus;
    },
    get frame() {
      return frame;
    },
    get state() {
      return {
        phase,
        x: walker.x,
        y: walker.y,
        z: walker.z,
        yaw: sight.yaw,
        pitch: sight.pitch,
        grounded: walker.grounded,
        locked: input.locked,
        circles: solids.circles.length,
      };
    },
    // The frame's transition, before the camera: the tour's until the walk holds it.
    step(elapsed, tourTransition) {
      switch (phase) {
        case "arming": {
          armedAt ??= elapsed;
          settledFrames =
            !tourTransition.capture && tourTransition.progress >= 1 ? settledFrames + 1 : 0;
          // The pipeline's own dissolve has settled a full frame and the page has faded.
          if (elapsed - armedAt < c.uiFade || settledFrames < 2) return tourTransition;
          phase = "capture";
          holdsTour = true;
          return set(true, false, 1);
        }
        case "capture":
          begin();
          phase = "walking";
          cutAt = elapsed;
          inProgress = 0;
          return set(false, true, 0);
        case "walking":
          inProgress = Math.min(1, (elapsed - cutAt) / dissolve);
          if (leave && inProgress >= 1) {
            phase = "leaving";
            return set(true, false, 1);
          }
          return set(false, false, inProgress);
        case "leaving":
          end();
          phase = "returning";
          cutAt = elapsed;
          outProgress = 0;
          return set(false, true, 0);
        case "returning":
          outProgress = Math.min(1, (elapsed - cutAt) / dissolve);
          if (outProgress < 1) return set(false, false, outProgress);
          release();
          return tourTransition;
        default:
          return tourTransition;
      }
    },
    // Moves the walker and its camera, while it drives.
    update(deltaSeconds, width, height) {
      if (!drives) return;
      const dt = Math.min(0.1, Math.max(0, deltaSeconds));
      input.read(intent);
      look(sight, intent.dx, intent.dy, intent.locked ? c.look : c.drag, c.pitch);
      sight.yaw += intent.turn * c.turn * dt;
      refreshSolids();
      wish(intent, sight.yaw, c, want);
      // In steps of at most `substep` seconds (a jog's 0.225 units), so a slow
      // frame never carries the walker past a small solid's centre or off a slope.
      const steps = Math.max(1, Math.ceil(dt / c.substep - 1e-9));
      for (let i = 0; i < steps; i++) stepGround(dt / steps, intent.jump && i === 0);
      // The eye climbs a step smoothly and drops at once, a landing's dip too.
      dip = Math.max(0, dip - c.landing.recover * dt);
      const eye = walker.y + c.eye - dip;
      sight.eye =
        eye < sight.eye || eye - sight.eye > c.eye ? eye : Math.min(eye, sight.eye + c.rise * dt);
      camera.position.set(walker.x, sight.eye, walker.z);
      camera.rotation.set(sight.pitch, sight.yaw, 0);
      camera.aspect = width / Math.max(1, height);
      camera.fov = walkFov(camera.aspect, c);
      camera.updateProjectionMatrix();
      applyFog();
      focusCell(walker.x, walker.z, sight.yaw, c, cell);
      focus.x = cell.x;
      focus.z = cell.z;
      focus.y = ground(cell.x, cell.z);
    },
    enter() {
      if (disposed || phase !== "idle") return false;
      clearTimeout(fadeTimer);
      page?.classList?.add("scene-walking", "scene-walk-hidden");
      doc?.activeElement?.blur?.();
      phase = "arming";
      armedAt = null;
      settledFrames = 0;
      leave = false;
      return true;
    },
    exit,
    dispose() {
      if (disposed) return false;
      exit({ immediate: true });
      disposed = true;
      forcedColors?.removeEventListener?.("change", onForcedColorsChange);
      doc?.removeEventListener?.("pointerlockchange", onForcedColorsChange);
      clearTimeout(fadeTimer);
      return true;
    },
  };
}
