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
// substep: the longest motion step; a slower frame takes several.
// climb: up and down the lookout's ladder per second (jog with Shift); grab:
// how near its line the feet take hold; ease: how fast they settle onto it.
// deckBody: the walker's radius on the gallery, slimmer than on the ground so
// the narrow walks round the cabin's ends stay open (the eye keeps this off
// every face). vault: over the railing from within `reach` of it, facing out
// (`facing`, the cosine), stepping `clear` beyond its outer face at `push` a
// second, then dropping with that push and a `lift`; a let-go from the ladder
// drops the same way. landing: a landing dips the eye by up to `dip`, for
// impacts from `from` over `span` a second, and it recovers at `recover`.
// high: the eye's height over the ground below it across which the view from up
// high (hill-silhouette.js HIGH_VIEW) eases in.
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
  bound: Object.freeze({ soft: 76, hard: 86 }),
  shadow: Object.freeze({ ahead: 16, cell: 6, radius: 40 }),
  band: 5.7,
  tree: 3.4,
  lantern: 0.6,
  solid: 0.5,
  uiFade: 0.42,
  unlockGrace: 0.15,
  substep: 1 / 60,
  climb: Object.freeze({ speed: 5, jog: 8, grab: 1.2, ease: 10 }),
  deckBody: 0.45,
  vault: Object.freeze({ reach: 0.3, facing: 0.3, clear: 0.1, push: 5, lift: 2 }),
  landing: Object.freeze({ dip: 0.6, from: 14, span: 30, recover: 2 }),
  high: Object.freeze([8, 20]),
});

// The lookout in its own frame (architecture.js createCompleteTowerArchitecture):
// x across, y up from its posts' feet, z out through the ladder on its +Z
// access side; both delivered tiers measure the same (test/scene-walk.test.mjs).
// ladder: its rails' front face, z = face - lean * y, within half of x 0; it
// ends at the gallery. deck: the gallery's floor and the railing's inner faces
// (x either side, the back and the front), open over the ladder within gap.
// rail: the railing's and the deck's outer faces. cabin: its two side walls,
// x from inner to outer and z from back to front, their end posts out to
// post for `ends` at either end; it is open front and back, its roof above
// the eye.
export const LOOKOUT = Object.freeze({
  ladder: Object.freeze({ face: 8.97, lean: 0.1037, half: 1 }),
  deck: Object.freeze({ floor: 29.95, x: 5.25, back: -6.07, front: 5.12, gap: 1.2 }),
  rail: Object.freeze({ x: 6.46, back: -6.95, front: 5.84 }),
  cabin: Object.freeze({ inner: 2.45, outer: 2.96, post: 3.43, back: -4.9, front: 3.7, ends: 0.6 }),
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
// with no key held; only `air` of it off the ground, none in a drop off the
// lookout), a jump leaves the ground and gravity pulls while airborne.
// Mutates and returns body.
export function integrate(body, want, jump, dt, c = WALK) {
  const control = body.grounded ? 1 : body.drop ? 0 : c.air,
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

// Clear of every solid: three passes over the circles, then the hull, which
// stands only up to solids.top (feet at y above it pass over).
export function settle(x, z, solids, c = WALK, out = [0, 0], y = -Infinity) {
  const hull = y > solids.top ? null : solids.hull;
  out[0] = x;
  out[1] = z;
  for (let pass = 0; pass < 3; pass++) {
    pushOutCircles(out[0], out[1], solids.circles, c.body, out);
    pushOutHull(out[0], out[1], hull, c.body, out);
  }
  return out;
}

// The lookout's frame from its root's world matrix (a turn about y, a lift and
// a uniform scale): local() takes world x/y/z to its x (u), y (h) and z (v),
// world() takes them back; inward() and outward() turn a direction between
// world x/z and its u/v.
export function towerFrame(root) {
  if (!root?.matrixWorld) return null;
  root.updateWorldMatrix?.(true, false);
  const e = root.matrixWorld.elements,
    [a, b, c, d, tx, ty, tz] = [e[0], e[2], e[8], e[10], e[12], e[13], e[14]],
    scale = Math.hypot(a, b) || 1;
  return {
    scale,
    local(x, y, z, out = { u: 0, h: 0, v: 0 }) {
      const dx = x - tx,
        dz = z - tz;
      out.u = (a * dx + b * dz) / (scale * scale);
      out.v = (c * dx + d * dz) / (scale * scale);
      out.h = (y - ty) / scale;
      return out;
    },
    world(u, h, v, out = { x: 0, y: 0, z: 0 }) {
      out.x = a * u + c * v + tx;
      out.y = ty + h * scale;
      out.z = b * u + d * v + tz;
      return out;
    },
    inward(x, z, out = { u: 0, v: 0 }) {
      out.u = (a * x + b * z) / scale;
      out.v = (c * x + d * z) / scale;
      return out;
    },
    outward(u, v, out = { x: 0, z: 0 }) {
      out.x = (a * u + c * v) / scale;
      out.z = (b * u + d * v) / scale;
      return out;
    },
  };
}

// The climber's feet at height h (lookout units): a body off the ladder's face.
export function ladderLine(h, body, look = LOOKOUT) {
  return look.ladder.face + body - look.ladder.lean * h;
}

// Pushes the point out of the box [u0, u1] x [v0, v1] grown by r, across the
// side it went least deep past.
function pushOutBox(out, u0, u1, v0, v1, r) {
  const [u, v] = out,
    a = u - (u0 - r),
    b = u1 + r - u,
    c = v - (v0 - r),
    d = v1 + r - v,
    least = Math.min(a, b, c, d);
  if (least <= 0) return;
  if (least === a) out[0] = u0 - r;
  else if (least === b) out[0] = u1 + r;
  else if (least === c) out[1] = v0 - r;
  else out[1] = v1 + r;
}

// A step on the gallery from (pu, pv) to (u, v), lookout units: inside the
// railing, out through its gap only along the lane over the ladder (to `end`,
// the ladder's line), and clear of the cabin's walls and their end posts.
export function deckStep(pu, pv, u, v, body, end, look = LOOKOUT, out = [0, 0]) {
  const { deck, cabin } = look,
    side = deck.x - body,
    front = deck.front - body,
    lane = deck.gap - body;
  u = Math.min(side, Math.max(-side, u));
  v = Math.max(deck.back + body, v);
  if (v > front) {
    if (pv > front) {
      u = Math.min(lane, Math.max(-lane, u));
      v = Math.min(v, end);
    } else if (Math.abs(u) <= lane) v = Math.min(v, end);
    else v = front;
  }
  out[0] = u;
  out[1] = v;
  for (const s of [1, -1]) {
    const [u0, u1] = s > 0 ? [cabin.inner, cabin.outer] : [-cabin.outer, -cabin.inner],
      [p0, p1] = s > 0 ? [cabin.inner, cabin.post] : [-cabin.post, -cabin.inner];
    pushOutBox(out, u0, u1, cabin.back, cabin.front, body);
    pushOutBox(out, p0, p1, cabin.back, cabin.back + cabin.ends, body);
    pushOutBox(out, p0, p1, cabin.front - cabin.ends, cabin.front, body);
  }
  return out;
}

// A vault from (u, v) on the gallery facing (fu, fv), lookout units: over the
// nearest side of the railing within reach that the view faces, to `clear`
// beyond its outer face by `fall` (the ground's body); the gap over the ladder
// counts as the front. Its landing point and outward normal, or null.
export function vaultTo(u, v, fu, fv, body, fall, c = WALK, look = LOOKOUT) {
  const { deck, rail } = look,
    beyond = fall + c.vault.clear,
    sides = [
      [1, 0, deck.x - body - u, rail.x + beyond, v],
      [-1, 0, deck.x - body + u, -rail.x - beyond, v],
      [0, -1, v - deck.back - body, u, rail.back - beyond],
      [0, 1, deck.front - body - v, u, Math.max(v, rail.front + beyond)],
    ];
  let best = null;
  for (const [nu, nv, gap, tu, tv] of sides) {
    if (gap > c.vault.reach || fu * nu + fv * nv < c.vault.facing) continue;
    if (!best || gap < best.gap) best = { gap, u: tu, v: tv, nu, nv };
  }
  return best;
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
// The walker is on the ground; on the lookout's ladder (moving into it climbs,
// away from it comes down; Space lets go); on its deck (the gallery round the
// cabin, inside the railing); vaulting the railing; or in a drop off the
// lookout, which lands on the ground.
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
  const walker = {
      x: 0,
      y: 0,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      grounded: true,
      on: "ground",
      drop: false,
    },
    sight = { yaw: 0, pitch: 0, eye: 0 },
    intent = { forward: 0, strafe: 0, turn: 0, jog: false, jump: false, dx: 0, dy: 0 },
    want = { x: 0, z: 0 },
    point = [0, 0],
    cell = { x: 0, z: 0 },
    focus = { x: 0, y: 0, z: 0 },
    frame = { radius: c.shadow.radius },
    solids = { circles: [], hull: [], top: Infinity },
    at = { u: 0, h: 0, v: 0 },
    way = { u: 0, v: 0 },
    spot = { x: 0, y: 0, z: 0 },
    heading = { x: 0, z: 0 };
  // The lookout's frame (null until its model commits) and a vault under way.
  let lookout = null,
    vault = null,
    dip = 0,
    high = 0;
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
  // The solids follow the models: the tower's hull and frame once per root,
  // the rocks once they commit.
  function refreshSolids() {
    const root = tower();
    if (root !== towerRoot) {
      towerRoot = root;
      solids.hull = towerFootprint(root, c.band);
      lookout = towerFrame(root);
      solids.top = lookout ? lookout.world(0, c.band, 0).y : Infinity;
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
  // The walker at a point in the lookout's frame, at rest.
  function place(u, h, v) {
    lookout.world(u, h, v, spot);
    Object.assign(walker, { x: spot.x, y: spot.y, z: spot.z, vx: 0, vy: 0, vz: 0 });
  }
  // Off the lookout at `speed` along its (u, v), rising at `lift`: a drop.
  function drop(u, v, speed, lift) {
    lookout.outward(u, v, heading);
    Object.assign(walker, {
      vx: heading.x * speed,
      vy: lift,
      vz: heading.z * speed,
      grounded: false,
      on: "drop",
      drop: true,
    });
  }
  // How much of the wished motion heads into the ladder (toward the lookout):
  // 1 straight in, -1 straight away, 0 with no key held.
  function intoLadder() {
    lookout.inward(want.x, want.z, way);
    const speed = Math.hypot(way.u, way.v);
    return speed > 1e-9 ? -way.v / speed : 0;
  }
  // On the ground or in a drop: a step as before, the hull only under its
  // top; a grounded walker heading into the ladder's foot takes hold of it.
  function stepGround(dt, jump) {
    if (lookout && walker.on === "ground" && walker.grounded) {
      lookout.local(walker.x, walker.y, walker.z, at);
      const body = c.body / lookout.scale;
      if (
        Math.abs(at.u) < LOOKOUT.ladder.half &&
        at.h < LOOKOUT.deck.floor - 1 &&
        at.v - ladderLine(at.h, body) <= c.climb.grab &&
        intoLadder() > 0.5
      ) {
        walker.on = "ladder";
        return stepLadder(dt, false);
      }
    }
    const fromX = walker.x,
      fromZ = walker.z,
      impact = -walker.vy,
      wasGrounded = walker.grounded;
    integrate(walker, want, jump, dt, c);
    settle(walker.x, walker.z, solids, c, point, walker.y);
    boundStep(fromX, fromZ, point[0], point[1], c, point);
    [walker.x, walker.z] = point;
    land(walker, ground(walker.x, walker.z), c);
    if (!walker.grounded || wasGrounded) return;
    const { dip: most, from, span } = c.landing;
    dip = Math.max(dip, most * Math.min(1, Math.max(0, (impact - from) / span)));
    walker.on = "ground";
    walker.drop = false;
  }
  // On the ladder: up or down its line as the keys head into it or away,
  // easing onto it; off at the top onto the deck, at the foot onto the
  // ground, or pushed off backward with Space.
  function stepLadder(dt, jump) {
    const s = lookout.scale,
      top = LOOKOUT.deck.floor;
    lookout.local(walker.x, walker.y, walker.z, at);
    if (jump) {
      drop(0, 1, c.vault.push, 0);
      return;
    }
    // The feet ease onto the line from where they took hold; on it, they
    // follow it exactly as it leans.
    const rate = intoLadder() * (intent.jog ? c.climb.jog : c.climb.speed);
    const keep = 1 - Math.min(1, c.climb.ease * dt),
      h = Math.min(top, at.h + (rate * dt) / s),
      off = at.v - ladderLine(at.h, c.body / s);
    place(at.u * keep, h, ladderLine(h, c.body / s) + off * keep);
    walker.grounded = true;
    if (h >= top && rate > 0) {
      walker.on = "deck";
      return;
    }
    if (rate < 0 && walker.y <= ground(walker.x, walker.z)) {
      // Off at the foot, where the ground may stand a little over it: clear
      // of the base's hull.
      settle(walker.x, walker.z, solids, c, point);
      [walker.x, walker.z] = point;
      walker.y = ground(walker.x, walker.z);
      walker.on = "ground";
    }
  }
  // On the deck: a walk held inside the railing and clear of the cabin's
  // walls; out along the gap's lane onto the ladder; Space at the railing,
  // facing out, vaults it (nothing else up here: the roof is near).
  function stepDeck(dt, jump) {
    const s = lookout.scale,
      body = c.deckBody / s,
      end = ladderLine(LOOKOUT.deck.floor, c.body / s);
    lookout.local(walker.x, walker.y, walker.z, at);
    if (jump) {
      lookout.inward(-Math.sin(sight.yaw), -Math.cos(sight.yaw), way);
      const to = vaultTo(at.u, at.v, way.u, way.v, body, c.body / s, c);
      if (to) {
        vault = to;
        walker.on = "vault";
        return stepVault(dt);
      }
    }
    const fromU = at.u,
      fromV = at.v;
    integrate(walker, want, false, dt, c);
    lookout.local(walker.x, walker.y, walker.z, at);
    deckStep(fromU, fromV, at.u, at.v, body, end, LOOKOUT, point);
    const { vx, vz } = walker;
    place(point[0], LOOKOUT.deck.floor, point[1]);
    Object.assign(walker, { vx, vz, grounded: true });
    if (point[1] >= end - 1e-9 && point[1] > fromV) walker.on = "ladder";
  }
  // Over the railing at the vault's push, the feet at the deck's height (the
  // eye passes well over the rail and under the eaves), then a drop.
  function stepVault(dt) {
    const s = lookout.scale;
    lookout.local(walker.x, walker.y, walker.z, at);
    const du = vault.u - at.u,
      dv = vault.v - at.v,
      left = Math.hypot(du, dv),
      reach = (c.vault.push * dt) / s;
    if (left > reach) {
      place(at.u + (du / left) * reach, LOOKOUT.deck.floor, at.v + (dv / left) * reach);
      return;
    }
    place(vault.u, LOOKOUT.deck.floor, vault.v);
    drop(vault.nu, vault.nv, c.vault.push, c.vault.lift);
    vault = null;
  }
  function move(dt, jump) {
    if (!lookout && walker.on !== "ground" && walker.on !== "drop") walker.on = "ground";
    if (walker.on === "ladder") stepLadder(dt, jump);
    else if (walker.on === "deck") stepDeck(dt, jump);
    else if (walker.on === "vault") stepVault(dt);
    else stepGround(dt, jump);
  }
  // The cut into the walk: on the ground under the shot's camera, facing its subject.
  function begin() {
    refreshSolids();
    const shot = view(),
      start = spawn(shot, solids, c);
    Object.assign(walker, {
      x: start.x,
      z: start.z,
      vx: 0,
      vy: 0,
      vz: 0,
      grounded: true,
      on: "ground",
      drop: false,
    });
    vault = null;
    dip = 0;
    high = 0;
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
    // How high the eye stands for the view from up high, 0 to 1 (WALK.high).
    get high() {
      return high;
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
        on: walker.on,
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
      wish(intent, sight.yaw, c, want);
      // In steps of at most `substep` seconds (a jog's 0.225 units), so a slow
      // frame never carries the walker past a small solid's centre or off a slope.
      const steps = Math.max(1, Math.ceil(dt / c.substep - 1e-9));
      for (let i = 0; i < steps; i++) move(dt / steps, intent.jump && i === 0);
      // The eye climbs a step smoothly and drops at once, a landing's dip too.
      dip = Math.max(0, dip - c.landing.recover * dt);
      const eye = walker.y + c.eye - dip;
      sight.eye =
        eye < sight.eye || eye - sight.eye > c.eye ? eye : Math.min(eye, sight.eye + c.rise * dt);
      camera.position.set(walker.x, sight.eye, walker.z);
      const above = (sight.eye - ground(walker.x, walker.z) - c.high[0]) / (c.high[1] - c.high[0]),
        rise = Math.min(1, Math.max(0, above));
      high = rise * rise * (3 - 2 * rise);
      camera.rotation.set(sight.pitch, sight.yaw, 0);
      camera.aspect = width / Math.max(1, height);
      camera.fov = walkFov(camera.aspect, c);
      camera.updateProjectionMatrix();
      applyFog();
      focusCell(walker.x, walker.z, sight.yaw, c, cell);
      focus.x = cell.x;
      focus.z = cell.z;
      // Up on the deck the shadow's focus stays at the deck's height.
      focus.y = walker.on === "deck" || walker.on === "vault" ? walker.y : ground(cell.x, cell.z);
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
