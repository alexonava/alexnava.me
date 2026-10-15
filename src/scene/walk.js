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
// between soft and hard (from the tower), inside the exact film terrain (88)
// and the sky's dome (130). shadow: the moon's shadow follows a point `ahead`
// of the walker snapped to `cell`, over `radius` (rendering.js
// focusFilmShadow()), so its map redraws only on a cell change. band: the
// tower's solid base, its vertices within this of its lowest (posts, ladder
// feet and the low braces, all below the eye). tree: the trunk with its root
// flare; lantern: the lantern's post; solid: rocks this tall or taller block
// the way (pebbles never). uiFade: the page's fade out and back (styles.css).
// unlockGrace: an Esc this soon after the mouse is freed is the same press.
export const WALK = Object.freeze({
  eye: 5.3,
  speed: Object.freeze({ walk: 4.5, jog: 9, back: 3.2, strafe: 3.8 }),
  accel: 18,
  brake: 24,
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
  bound: Object.freeze({ soft: 76, hard: 86 }),
  shadow: Object.freeze({ ahead: 16, cell: 6, radius: 40 }),
  band: 5.7,
  tree: 3.4,
  lantern: 0.6,
  solid: 0.5,
  uiFade: 0.42,
  unlockGrace: 0.15,
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

// The convex hull of [x, z] points, counter-clockwise (monotone chain).
export function convexHull(points) {
  const sorted = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (sorted.length < 3) return sorted;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const chain = (list) => {
    const out = [];
    for (const p of list) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  return chain(sorted).concat(chain(sorted.slice().reverse()));
}

// Pushes the point out of a counter-clockwise convex hull grown by the body's
// radius: from inside along the nearest edge's normal, from outside away from
// the outline's nearest point.
export function pushOutHull(x, z, hull, body, out = [0, 0]) {
  out[0] = x;
  out[1] = z;
  if (!hull || hull.length < 3) return out;
  let inside = true,
    best = -Infinity,
    nx = 0,
    nz = 0,
    near = Infinity,
    qx = 0,
    qz = 0;
  for (let i = 0; i < hull.length; i++) {
    const [ax, az] = hull[i],
      [bx, bz] = hull[(i + 1) % hull.length],
      ex = bx - ax,
      ez = bz - az,
      length = Math.hypot(ex, ez) || 1,
      ox = ez / length,
      oz = -ex / length,
      side = (x - ax) * ox + (z - az) * oz;
    if (side > 0) inside = false;
    if (side > best) {
      best = side;
      nx = ox;
      nz = oz;
    }
    const t = Math.min(1, Math.max(0, ((x - ax) * ex + (z - az) * ez) / (length * length))),
      px = ax + ex * t,
      pz = az + ez * t,
      d = Math.hypot(x - px, z - pz);
    if (d < near) {
      near = d;
      qx = px;
      qz = pz;
    }
  }
  if (inside) {
    out[0] = x + nx * (body - best);
    out[1] = z + nz * (body - best);
  } else if (near < body && near > 1e-9) {
    out[0] = qx + ((x - qx) / near) * body;
    out[1] = qz + ((z - qz) / near) * body;
  }
  return out;
}

// Clear of every solid: three passes over the circles, then the hull.
export function settle(x, z, solids, c = WALK, out = [0, 0]) {
  out[0] = x;
  out[1] = z;
  for (let pass = 0; pass < 3; pass++) {
    pushOutCircles(out[0], out[1], solids.circles, c.body, out);
    pushOutHull(out[0], out[1], solids.hull, c.body, out);
  }
  return out;
}

// Limits outward motion near the edge: between bound.soft and bound.hard (from
// the tower) the outward part of a step fades out, and no step ends beyond
// hard. Inward and sideways motion are untouched.
export function boundStep(px, pz, x, z, c = WALK, out = [0, 0]) {
  const { soft, hard } = c.bound,
    r = Math.hypot(x, z);
  out[0] = x;
  out[1] = z;
  if (r <= soft) return out;
  const nx = x / r,
    nz = z / r,
    outward = (x - px) * nx + (z - pz) * nz;
  if (outward > 0) {
    const t = Math.min(1, (r - soft) / (hard - soft)),
      cut = outward * t * t;
    out[0] -= nx * cut;
    out[1] -= nz * cut;
  }
  const reach = Math.hypot(out[0], out[1]);
  if (reach > hard) {
    out[0] *= hard / reach;
    out[1] *= hard / reach;
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

// Where the walk starts: under the shot's camera, inside the bound and clear
// of every solid, facing the shot's subject.
export function spawn(view, solids, c = WALK) {
  let x = view.position.x,
    z = view.position.z;
  const r = Math.hypot(x, z);
  if (r > c.bound.soft) {
    x *= c.bound.soft / r;
    z *= c.bound.soft / r;
  }
  [x, z] = settle(x, z, solids, c);
  const target = view.target ?? { x: 0, z: 0 };
  return { x, z, yaw: Math.atan2(-(target.x - x), -(target.z - z)) };
}

// The tower's solid base in world x/z: the convex hull of its vertices within
// `band` of its lowest (the posts, the ladder's feet and the low braces).
export function towerFootprint(root, band = WALK.band) {
  if (!root?.traverse) return [];
  root.updateWorldMatrix?.(true, true);
  const xs = [],
    ys = [],
    zs = [];
  let low = Infinity;
  root.traverse((object) => {
    const position = object.isMesh ? object.geometry?.attributes?.position : null;
    if (!position) return;
    const m = object.matrixWorld.elements;
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i),
        y = position.getY(i),
        z = position.getZ(i),
        wy = m[1] * x + m[5] * y + m[9] * z + m[13];
      xs.push(m[0] * x + m[4] * y + m[8] * z + m[12]);
      ys.push(wy);
      zs.push(m[2] * x + m[6] * y + m[10] * z + m[14]);
      if (wy < low) low = wy;
    }
  });
  const points = [];
  for (let i = 0; i < ys.length; i++) if (ys[i] <= low + band) points.push([xs[i], zs[i]]);
  return convexHull(points);
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
    unlockedAt = -Infinity;
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
          if (!locked() && now() - unlockedAt > WALK.unlockGrace * 1000) onLeave();
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
        if (!locked()) unlockedAt = now();
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
// the ground's world height; tower(): the tower's root; anchors: the trunk
// and the lantern in world x/z; rocks(): the committed rocks ({x, z, half,
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
  tower = () => null,
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
  const walker = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, grounded: true },
    sight = { yaw: 0, pitch: 0, eye: 0 },
    intent = { forward: 0, strafe: 0, turn: 0, jog: false, jump: false, dx: 0, dy: 0 },
    want = { x: 0, z: 0 },
    point = [0, 0],
    cell = { x: 0, z: 0 },
    focus = { x: 0, y: 0, z: 0 },
    frame = { radius: c.shadow.radius },
    solids = { circles: [], hull: [] };
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
    towerRoot = null,
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
  const set = (capture, cut, progress) =>
    Object.assign(transition, { capture, cut, progress, zoom: 0 });
  function applyFog() {
    const range = fogRange();
    if (fog && range) [fog.near, fog.far] = range;
  }
  // The solids follow the models: the tower's hull once per root, the rocks
  // once they commit.
  function refreshSolids() {
    const root = tower();
    if (root !== towerRoot) {
      towerRoot = root;
      solids.hull = towerFootprint(root, c.band);
    }
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
  // The cut into the walk: on the ground under the shot's camera, facing its subject.
  function begin() {
    refreshSolids();
    const shot = view(),
      start = spawn(shot, solids, c);
    Object.assign(walker, { x: start.x, z: start.z, vx: 0, vy: 0, vz: 0, grounded: true });
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
        hull: solids.hull.length,
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
      const fromX = walker.x,
        fromZ = walker.z;
      integrate(walker, wish(intent, sight.yaw, c, want), intent.jump, dt, c);
      settle(walker.x, walker.z, solids, c, point);
      boundStep(fromX, fromZ, point[0], point[1], c, point);
      [walker.x, walker.z] = point;
      land(walker, ground(walker.x, walker.z), c);
      // The eye climbs a step smoothly and drops at once.
      const eye = walker.y + c.eye;
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
      clearTimeout(fadeTimer);
      return true;
    },
  };
}
