import {
  BufferAttribute,
  BufferGeometry,
  CustomBlending,
  DoubleSide,
  MaxEquation,
  Mesh,
  ShaderMaterial,
  Vector2,
  Vector3,
} from "three";
import { STAR_LAYER } from "./depth-layers.js";
import { CLOUD_RESHAPE, FLASH_REFERENCE } from "./estate-sky.js";
import { FLASH_GROUND, RIM_UNIFORMS } from "./film-light.js";

// Rare, soft lightning in the film's night storm (the owner's pick of the storm
// effects, 2026-10-09): flashes that light the cloud banks from inside, now and
// then a thin, cold bolt far off behind the ranges, and a cold flash of light on
// the subjects and the wet ground from the flash's side. No light, pass or
// texture is added: the sky shell draws the banks' glow (estate-sky.js
// FLASH_GLSL), one small mesh the bolt, and the flash rides the lights already
// there (rendering.js setFlash(): the cool fill swings toward it, the sky and
// ambient lift), the moon rim (film-light.js RIM_UNIFORMS, re-aimed at the
// flash for its length) and the ground's sky light and water (FLASH_GROUND).
//
// Timing is the lightning's own clock, the drawn frames' time while the scene
// animates (frozen under reduced motion, a visitor pause or an open dialog, as
// the flame's), and a seeded schedule on it, so every capture of a phase is the
// same. Events start `first` seconds in and then every `interval` seconds; each
// is 1 to 3 `pulses` (a rise over `attack`, then an exponential fall over
// `decay`), `gap` apart, the later ones `echo` of the first. WCAG 2.3.1: never
// more than `perSecond` (3) flashes in any second (each event's pulses are
// capped there and events keep a second apart) and no full-frame white: the
// glow stays in the banks about one point, under the grade's shoulder.
//
// Where: most events are faint, far in-cloud flickers (`strength`, skewed low by
// `skew`) low over the ranges (`altitude`, degrees), at a random point across the
// frame (`frame`, a share of its width) or, `side` of the time, `sideAngle`
// degrees beyond its sides, lighting the subjects from there. A flash never centres over The watch's
// reference banks (CLOUD_RESHAPE's wedge, whose protection also zeroes the glow
// there) or within `textClear` of the clouds' text guard; a bolt keeps wholly
// clear of both.
// - `sky`: the banks' glow: `radius` on the cloud plane (by strength), `gain` in
//   the banks, `core` more in its hot centre (a third of the radius), `clear` on
//   the clear sky, `thin` the share the banks' thin edges lose, `color`, `jitter` (degrees each pulse's centre wanders) and `about`,
//   the reach (a share of the screen's smaller side) it eases off about About.
// - `bolt`: a branching channel drawn procedurally (where `draw`), `chance` of
//   the events, at least `strength`; from `top` (degrees) to `bottom`, below the ranges' crest,
//   leaning up to `lean`, jagged by `rough` over `detail` halvings, with
//   `branches`; a `core` and `halo` in CSS px (`glow` the halo's share),
//   `brightness`, `color`; it grows down over `leader` seconds, each stroke falls
//   over `decay` and the channel keeps `afterglow` of the flash.
// - `relight`: what a whole flash adds: `fill` (in `color`) to the cool fill's
//   intensity, `hemisphere` and `ambient` shares, `rim` times `rimColor` to the
//   moon rim, `sky` and `water` shares to the ground's sky light and water mirror.
// - `tiers`: per-tier overrides (balanced draws no bolt and a plain glow), and
//   `shots`: per-shot ones, by shot name (DIRECTED_SHOTS), over the tier's.
// - `forceAt`: a debug override for captures, empty in use: scene seconds (or
//   { at, u, v, bolt, strength, pulses, shot, tall }) at which an event's first
//   pulse peaks; u, v place it on the canvas (0-1, v up; `tall`'s on a canvas
//   taller than wide), `shot` only in that shot.
export const LIGHTNING = Object.freeze({
  enabled: true,
  seed: 277,
  first: 8,
  interval: Object.freeze([10, 30]),
  pulses: Object.freeze([1, 3]),
  gap: Object.freeze([0.08, 0.2]),
  attack: 0.025,
  decay: Object.freeze([0.06, 0.14]),
  echo: Object.freeze([0.45, 0.85]),
  perSecond: 3,
  strength: Object.freeze([0.3, 1]),
  skew: 2,
  altitude: Object.freeze([3, 12]),
  frame: Object.freeze([0.12, 0.88]),
  side: 0.25,
  sideAngle: Object.freeze([20, 80]),
  textClear: 0.3,
  sky: Object.freeze({
    radius: Object.freeze([0.28, 0.6]),
    gain: 0.55,
    core: 1.2,
    clear: 0.25,
    thin: 0.5,
    color: Object.freeze([0.74, 0.83, 1]),
    jitter: 2.5,
    about: 0.2,
  }),
  bolt: Object.freeze({
    draw: true,
    chance: 0.2,
    strength: 0.85,
    top: Object.freeze([10, 16]),
    bottom: -1.5,
    lean: 3,
    rough: 0.3,
    detail: 5,
    branches: Object.freeze([2, 4]),
    core: 1.1,
    halo: 7,
    glow: 0.3,
    brightness: 1.6,
    color: Object.freeze([0.85, 0.91, 1]),
    leader: 0.04,
    decay: 0.05,
    afterglow: 0.15,
  }),
  relight: Object.freeze({
    color: Object.freeze([0.74, 0.83, 1]),
    fill: 1.3,
    hemisphere: 0.15,
    ambient: 0.1,
    rim: 0.8,
    rimColor: Object.freeze([0.5, 0.66, 1]),
    sky: 0.35,
    water: 0.6,
  }),
  tiers: Object.freeze({
    balanced: Object.freeze({
      bolt: Object.freeze({ draw: false, chance: 0 }),
      sky: Object.freeze({ thin: 0 }),
    }),
  }),
  shots: Object.freeze({}),
  forceAt: Object.freeze([]),
});

// The most segments one bolt draws: its channel (2^detail) and its branches.
const BOLT_SEGMENTS = 192;
// The clouds' text guard's reach (estate-sky.js CLOUD_RESHAPE.text[1]).
const CLOUD_TEXT_REACH = CLOUD_RESHAPE.text[1];
// How far after its last peak an event lasts, in that pulse's decays.
const TAIL = 6;
const DEG = Math.PI / 180;
const lerp = ([a, b], t) => a + (b - a) * t;
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smoothstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

// A config with a tier's overrides merged in (objects merge, arrays replace).
export function lightningTier(config = LIGHTNING, tier = "high") {
  const plain = (v) => v && typeof v === "object" && !Array.isArray(v);
  const merge = (a, p) => {
    const out = { ...a };
    for (const key of Object.keys(p))
      out[key] = plain(a?.[key]) && plain(p[key]) ? merge(a[key], p[key]) : p[key];
    return out;
  };
  const over = config.tiers?.[tier];
  return over ? merge(config, over) : config;
}

// A stable hash of three integers to [0, 1), the same on every engine.
export function lightningRandom(seed, k, slot) {
  let h = Math.imul((seed | 0) ^ 0x9e3779b9, 0x85ebca6b);
  h ^= Math.imul((k | 0) + 0x632be5ab, 0xc2b2ae35);
  h ^= Math.imul((slot | 0) + 0x27d4eb2f, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

// One pulse's light dt seconds from its peak: a quadratic rise over `attack`,
// an exponential fall over `decay`, exactly 0 past TAIL decays.
export function lightningPulse(dt, attack, decay) {
  if (dt < -attack) return 0;
  if (dt <= 0) {
    const x = 1 + dt / attack;
    return x * x;
  }
  return dt > TAIL * decay ? 0 : Math.exp(-dt / decay);
}

// An event: its pulses' peaks (seconds), their light and decay, its strength
// and whether it draws a bolt. `forced` (a forceAt entry) pins its first peak.
function makeEvent(config, k, start, forced = null) {
  const r = (slot) => lightningRandom(config.seed, k, slot);
  const bolt = forced?.bolt ?? r(4) < config.bolt.chance;
  const count = Math.max(
    1,
    Math.min(
      config.perSecond,
      Math.round(
        forced?.pulses ??
          config.pulses[0] + Math.floor(r(2) * (config.pulses[1] - config.pulses[0] + 1)),
      ),
    ),
  );
  const leader = bolt ? config.bolt.leader : 0;
  const first = forced ? forced.at : start + config.attack + leader;
  const peaks = [];
  for (let i = 0, t = first; i < count; i++) {
    if (i) t += lerp(config.gap, r(10 + i));
    peaks.push({
      t,
      amp: i ? lerp(config.echo, r(20 + i)) : 1,
      decay: lerp(config.decay, r(30 + i)),
      jitter: [r(40 + i) - 0.5, r(50 + i) - 0.5],
    });
  }
  let strength = forced?.strength ?? lerp(config.strength, r(3) ** config.skew);
  if (bolt) strength = Math.max(strength, config.bolt.strength);
  return {
    k,
    start: first - config.attack - leader,
    end: Math.max(...peaks.map((p) => p.t + TAIL * p.decay)),
    peaks,
    strength,
    bolt,
    forced: forced ?? null,
  };
}

// The seeded schedule. at(t, shot) is the event lit at t in that shot (or
// null); forced events (config.forceAt, each in its own shot or any) come
// first and keep a second clear of each other where both can show, and random
// ones keep 2 s clear of them and a second clear of each other, so no second
// ever holds more than perSecond pulses.
export function createLightningSchedule(config = LIGHTNING) {
  const forced = [];
  [...(config.forceAt ?? [])]
    .map((entry) => (typeof entry === "number" ? { at: entry } : { ...entry }))
    .filter((entry) => Number.isFinite(entry.at))
    .sort((a, b) => a.at - b.at)
    .forEach((entry, i) => {
      const event = makeEvent(config, -1 - i, 0, entry);
      const apart = (other) =>
        event.start >= other.end + 1 ||
        (entry.shot && other.forced.shot && entry.shot !== other.forced.shot);
      if (forced.every(apart)) forced.push(event);
    });
  const events = [];
  let next = config.first,
    k = 0,
    cursor = 0,
    last = -Infinity;
  function extend(until) {
    while (next <= until) {
      const event = makeEvent(config, k, next);
      const prior = events.at(-1);
      if (
        (!prior || event.start >= prior.end + 1) &&
        !forced.some((f) => event.start < f.end + 2 && event.end > f.start - 2)
      )
        events.push(event);
      next += Math.max(1, lerp(config.interval, lightningRandom(config.seed, k, 1)));
      k++;
    }
  }
  return {
    forced,
    at(t, shot = null) {
      for (const event of forced)
        if (t >= event.start && t < event.end && (!event.forced.shot || event.forced.shot === shot))
          return event;
      if (t < last) cursor = 0;
      last = t;
      extend(t + 1);
      while (cursor < events.length && events[cursor].end <= t) cursor++;
      const event = events[cursor];
      return event && t >= event.start ? event : null;
    },
    // Every event starting before t (for tests and the debug state).
    until(t) {
      extend(t);
      return [...forced, ...events]
        .filter((event) => event.start < t)
        .sort((a, b) => a.start - b.start);
    },
  };
}

// An event's flash at t, 0-1 before its strength: the brightest pulse there.
export function lightningLevel(event, t, attack = LIGHTNING.attack) {
  let level = 0;
  for (const p of event.peaks)
    level = Math.max(level, p.amp * lightningPulse(t - p.t, attack, p.decay));
  return level;
}

// How much of a flash a sky direction (from the world origin, as the shell reads
// it) keeps: 0 over The watch's reference banks (estate-sky.js FLASH_REFERENCE,
// its crop's azimuths from its radius out), 1 clear of them; the glow is scaled by it.
export function referenceKeep(direction) {
  const lift = Math.max(direction.y, 0) + 0.24;
  const bx = (direction.x / lift) * 1.1,
    by = (direction.z / lift) * 1.1;
  const bl = Math.max(Math.hypot(bx, by), 0.001);
  let az = Math.atan2(by, bx + 1e-6) / DEG;
  if (az < 0) az += 360;
  const [w0, w1, w2, w3] = FLASH_REFERENCE.wedge,
    [r0, r1] = FLASH_REFERENCE.radius;
  return 1 - smoothstep(w0, w1, az) * (1 - smoothstep(w2, w3, az)) * smoothstep(r0, r1, bl);
}

// A view direction from azimuth (atan2(z, x)) and altitude, in degrees.
export function skyDirection(az, alt, out = new Vector3()) {
  return out.set(
    Math.cos(alt * DEG) * Math.cos(az * DEG),
    Math.sin(alt * DEG),
    Math.cos(alt * DEG) * Math.sin(az * DEG),
  );
}

// A seeded sequence in [0, 1).
function sequence(seed) {
  let s = Math.floor(seed * 4294967296) >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A jagged line from a to b ([az, alt] degrees), halved `detail` times, each
// midpoint pushed sideways by up to `rough` of its span.
function jagged(a, b, detail, rough, next) {
  let points = [a, b];
  for (let level = 0; level < detail; level++) {
    const out = [points[0]];
    for (let i = 0; i < points.length - 1; i++) {
      const [px, py] = points[i],
        [qx, qy] = points[i + 1];
      const dx = qx - px,
        dy = qy - py,
        span = Math.hypot(dx, dy) || 1e-6,
        push = (next() - 0.5) * 2 * rough * span;
      out.push(
        [(px + qx) / 2 - (dy / span) * push, (py + qy) / 2 + (dx / span) * push],
        points[i + 1],
      );
    }
    points = out;
  }
  return points;
}

// A bolt from [az, top] down to `bottom`: its segments as { a, b } [az, alt]
// pairs with their arrival (0 at the top, 1 at the foot of the channel) and
// glow at each end, and a width share. Seeded, so an event always draws the
// same bolt.
export function boltPath(config, seed, az, top, flip = 1) {
  const bolt = config.bolt;
  const next = sequence(seed);
  const foot = [az + flip * (next() - 0.35) * 2 * bolt.lean, bolt.bottom];
  const main = jagged([az, top], foot, bolt.detail, bolt.rough, next);
  const lengths = [0];
  for (let i = 1; i < main.length; i++)
    lengths.push(
      lengths[i - 1] + Math.hypot(main[i][0] - main[i - 1][0], main[i][1] - main[i - 1][1]),
    );
  const total = lengths.at(-1) || 1;
  const segments = [];
  const fade = (s) => 0.55 + 0.45 * smoothstep(0, 0.08, s);
  for (let i = 0; i < main.length - 1; i++) {
    const sa = lengths[i] / total,
      sb = lengths[i + 1] / total;
    segments.push({ a: main[i], b: main[i + 1], sa, sb, ga: fade(sa), gb: fade(sb), width: 1 });
  }
  const count = Math.round(lerp(bolt.branches, next()));
  for (let j = 0; j < count && segments.length < BOLT_SEGMENTS - 16; j++) {
    const at = Math.floor(lerp([0.12, 0.62], next()) * (main.length - 1));
    const from = main[at],
      side = next() < 0.5 ? -1 : 1,
      reach = total * lerp([0.15, 0.36], next());
    const to = [
      from[0] + side * reach * lerp([0.3, 0.7], next()),
      from[1] - reach * lerp([0.7, 1], next()),
    ];
    const arm = jagged(from, to, Math.max(1, bolt.detail - 2), bolt.rough * 1.2, next);
    let run = 0;
    const armLength = Math.hypot(to[0] - from[0], to[1] - from[1]) || 1;
    for (let i = 0; i < arm.length - 1; i++) {
      const step = Math.hypot(arm[i + 1][0] - arm[i][0], arm[i + 1][1] - arm[i][1]);
      const fa = run / armLength,
        fb = (run + step) / armLength;
      segments.push({
        a: arm[i],
        b: arm[i + 1],
        sa: lengths[at] / total + run / total,
        sb: lengths[at] / total + (run + step) / total,
        ga: 0.55 * (1 - Math.min(1, fa)) ** 0.8,
        gb: 0.55 * (1 - Math.min(1, fb)) ** 0.8,
        width: 0.55,
      });
      run += step;
    }
  }
  return segments;
}

// The bolt: segments as quads widened on screen to a fixed pixel width, drawn
// at the far plane (behind the ranges, which cover its foot, and everything
// else), blended by max so its joints never double, marking the star's layer in
// alpha (depth-layers.js) so the grade's cel step and ink leave it whole.
function createBolt() {
  const vertices = BOLT_SEGMENTS * 4;
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(vertices * 3), 3));
  geometry.setAttribute("aOther", new BufferAttribute(new Float32Array(vertices * 3), 3));
  geometry.setAttribute("aInfo", new BufferAttribute(new Float32Array(vertices * 4), 4));
  geometry.setAttribute("aGlow", new BufferAttribute(new Float32Array(vertices), 1));
  const index = new Uint16Array(BOLT_SEGMENTS * 6);
  for (let i = 0; i < BOLT_SEGMENTS; i++)
    index.set([4 * i, 4 * i + 1, 4 * i + 2, 4 * i + 2, 4 * i + 1, 4 * i + 3], 6 * i);
  geometry.setIndex(new BufferAttribute(index, 1));
  geometry.setDrawRange(0, 0);
  const material = new ShaderMaterial({
    name: "LightningBolt",
    transparent: true,
    depthTest: true,
    depthWrite: false,
    fog: false,
    side: DoubleSide,
    blending: CustomBlending,
    blendEquation: MaxEquation,
    blendEquationAlpha: MaxEquation,
    uniforms: {
      uViewport: { value: new Vector2(800, 450) },
      uLevel: { value: 0 },
      uGrow: { value: 0 },
      uCore: { value: 1 },
      uHalo: { value: 6 },
      uGlow: { value: 0.3 },
      uColor: { value: new Vector3(0.85, 0.91, 1) },
    },
    vertexShader: `
attribute vec3 aOther;
attribute vec4 aInfo;
attribute float aGlow;
uniform vec2 uViewport;
uniform float uHalo;
varying float vAcross, vGlow, vArrive, vWidth;
void main(){
vec4 a=projectionMatrix*viewMatrix*vec4(cameraPosition+position*100.,1.);
vec4 o=projectionMatrix*viewMatrix*vec4(cameraPosition+aOther*100.,1.);
float end=aInfo.y>.5?1.:-1.;
vec2 d=(o.xy/o.w-a.xy/a.w)*uViewport*-end;
d/=max(length(d),1e-4);
float w=uHalo*aInfo.w;
a.xy+=(vec2(-d.y,d.x)*aInfo.x+d*end*.35)*w/uViewport*a.w;
a.z=a.w*.99999;
gl_Position=a;
vAcross=aInfo.x; vGlow=aGlow; vArrive=aInfo.z; vWidth=aInfo.w;
}`,
    fragmentShader: `
uniform float uLevel, uGrow, uCore, uHalo, uGlow;
uniform vec3 uColor;
varying float vAcross, vGlow, vArrive, vWidth;
void main(){
float px=abs(vAcross)*uHalo*vWidth, core=uCore*vWidth;
float c=(exp(-px*px/(core*core))+uGlow*exp(-px*px/(uHalo*uHalo*vWidth*vWidth*.16)))*vGlow*uLevel*step(vArrive,uGrow);
gl_FragColor=vec4(uColor*c,min(c,1.)*${STAR_LAYER});
}`,
  });
  const mesh = new Mesh(geometry, material);
  mesh.name = "lightning-bolt";
  mesh.frustumCulled = false;
  // After the stars (-0.75), before the film mountains (-0.5), which cover it.
  mesh.renderOrder = -0.6;
  // Shown, drawing nothing, until the first frame: so the scene's first shader
  // warm-up (index.js) links its program and the first bolt never stalls.
  return mesh;
}

function writeBolt(mesh, segments) {
  const { attributes } = mesh.geometry;
  const position = attributes.position.array,
    other = attributes.aOther.array,
    info = attributes.aInfo.array,
    glow = attributes.aGlow.array;
  const a = new Vector3(),
    b = new Vector3();
  const count = Math.min(BOLT_SEGMENTS, segments.length);
  for (let i = 0; i < count; i++) {
    const s = segments[i];
    skyDirection(s.a[0], s.a[1], a);
    skyDirection(s.b[0], s.b[1], b);
    for (let v = 0; v < 4; v++) {
      const at = v < 2,
        n = 4 * i + v;
      (at ? a : b).toArray(position, 3 * n);
      (at ? b : a).toArray(other, 3 * n);
      info.set([v % 2 ? 1 : -1, at ? 0 : 1, at ? s.sa : s.sb, s.width], 4 * n);
      glow[n] = at ? s.ga : s.gb;
    }
  }
  for (const attribute of Object.values(attributes)) attribute.needsUpdate = true;
  mesh.geometry.setDrawRange(0, count * 6);
}

// The lightning subsystem. `sky` is the shell's uniforms (uFlash, uFlashGlow,
// uFlashTone), `rendering` takes the flash on its lights (setFlash), `textGuard`
// is the ground's text boxes (createSlateContacts()), `film()` whether the film
// is on and `shot()` the shot on screen. `config` defaults to LIGHTNING.
export function createLightning({
  parent,
  camera,
  rendering,
  sky,
  textGuard = null,
  film = () => true,
  shot = () => null,
  profile = {},
  config = LIGHTNING,
  skyRadius = 130,
}) {
  let tier = profile.tier === "balanced" ? "balanced" : "high",
    settings = lightningTier(config, tier),
    schedule = createLightningSchedule(settings);
  // The tier's settings with a shot's own (config.shots) over them.
  const perShot = new Map();
  function settingsFor(name) {
    const over = name ? config.shots?.[name] : null;
    if (!over) return settings;
    if (!perShot.has(name))
      perShot.set(name, lightningTier({ ...settings, tiers: { shot: over } }, "shot"));
    return perShot.get(name);
  }
  const bolt = parent ? createBolt() : null;
  if (bolt) parent.add(bolt);
  let time = 0,
    disposed = false,
    lit = false,
    pixelRatio = 1,
    size = [800, 450];
  const placed = new WeakMap();
  const eye = new Vector3(),
    ray = new Vector3(),
    point = new Vector3(),
    shell = new Vector3(),
    view = new Vector3();
  const state = { time: 0, level: 0, event: null };

  // Where the camera's ray `r` meets the sky shell, as the shell's direction.
  function shellDirection(r, out) {
    const along = eye.dot(r);
    const reach = -along + Math.sqrt(Math.max(along * along - eye.lengthSq() + skyRadius ** 2, 0));
    return out.copy(r).multiplyScalar(reach).add(eye).normalize();
  }
  function screenOf(r) {
    point.copy(r).multiplyScalar(100).add(eye).project(camera);
    return [(point.x + 1) / 2, (point.y + 1) / 2];
  }
  function viewAzimuth(u, v = 0.5) {
    ray
      .set(u * 2 - 1, v * 2 - 1, 0.5)
      .unproject(camera)
      .sub(eye)
      .normalize();
    return [Math.atan2(ray.z, ray.x) / DEG, Math.asin(Math.max(-1, Math.min(1, ray.y))) / DEG];
  }
  // 1 behind the name and intro (or About), easing to 0 over the clouds' reach.
  function textNear(u, v) {
    if (!textGuard) return 0;
    const aspect = textGuard.slateAspect?.value ?? 1;
    const near = (box, reach) => {
      if (!box || box.x > box.z) return 0;
      const fx = Math.max(box.x - u, u - box.z, 0) * (aspect / Math.min(aspect, 1)),
        fy = Math.max(box.y - v, v - box.w, 0) / Math.min(aspect, 1);
      return 1 - smoothstep(0, reach, Math.hypot(fx, fy));
    };
    return Math.max(
      near(textGuard.slateText?.value, CLOUD_TEXT_REACH),
      near(textGuard.slateAbout?.value, settings.sky.about),
    );
  }
  // Whether a view ray keeps `centre` of a flash and the sky `spread` degrees
  // of azimuth either side keeps any (referenceKeep()): clear of the crop.
  function clearOfReference(az, alt, spread, centre) {
    const keep = (offset) =>
      referenceKeep(shellDirection(skyDirection(az + offset, alt, view), shell));
    return keep(0) >= centre && keep(-spread) > 0 && keep(spread) > 0;
  }
  // Places an event when it first lights, from the camera then: its centre (a
  // view azimuth and altitude) and, for a bolt, its segments. Null when no
  // place in the sky suits it.
  function place(event) {
    const settings = settingsFor(shot());
    const r = (slot) => lightningRandom(settings.seed, event.k, slot);
    const force =
      event.forced && size[0] < size[1] && event.forced.tall ? event.forced.tall : event.forced;
    const strength01 = clamp01(
      (event.strength - settings.strength[0]) / (settings.strength[1] - settings.strength[0] || 1),
    );
    const radius = lerp(settings.sky.radius, strength01);
    const spread = Math.min(40, (radius / 2.5) * 57);
    let centre = null;
    if (force && Number.isFinite(force.u) && Number.isFinite(force.v)) {
      const [az, alt] = viewAzimuth(force.u, force.v);
      centre = [az, Math.max(1, alt)];
    } else
      for (let attempt = 0; attempt < 8 && !centre; attempt++) {
        const slot = 60 + 7 * attempt;
        const beyond = !event.bolt && r(slot) < settings.side;
        let [az] = viewAzimuth(lerp(settings.frame, r(slot + 1)));
        if (beyond) {
          const edge = r(slot + 1) < 0.5 ? 0 : 1;
          az = viewAzimuth(edge)[0] + (edge ? 1 : -1) * lerp(settings.sideAngle, r(slot + 2));
        }
        const alt = lerp(event.bolt ? settings.bolt.top : settings.altitude, r(slot + 3));
        if (!clearOfReference(az, alt, spread / 2, 0.98)) continue;
        const [su, sv] = screenOf(skyDirection(az, alt, view));
        if (textNear(clamp01(su), clamp01(sv)) > settings.textClear) continue;
        centre = [az, alt];
      }
    if (!centre) return null;
    let segments = null;
    if (event.bolt && bolt && settings.bolt.draw) {
      for (const flip of [1, -1]) {
        const top = Math.max(centre[1], lerp(settings.bolt.top, r(91)));
        const path = boltPath(settings, r(90), centre[0], top, flip);
        const clear = path.every(({ a, b }) =>
          [a, b].every(([az, alt]) => {
            if (!clearOfReference(az, alt, 6, 1e-6)) return false;
            const [su, sv] = screenOf(skyDirection(az, alt, view));
            return textNear(su, sv) < 0.05;
          }),
        );
        if (clear) {
          segments = path;
          break;
        }
      }
    }
    return { centre, radius, segments, shot: shot() };
  }

  function clear() {
    if (!lit) return;
    lit = false;
    sky.uFlash.value.w = 0;
    FLASH_GROUND.babelFlash.value.x = 0;
    FLASH_GROUND.babelFlash.value.y = 0;
    rendering?.setFlash?.(null);
  }

  const controller = {
    lifecycleOrder: 35,
    get state() {
      return state;
    },
    applyQuality(next = {}, { pixelRatio: ratio } = {}) {
      if (disposed) return false;
      if (Number.isFinite(ratio)) pixelRatio = ratio;
      const nextTier = next.tier === "balanced" ? "balanced" : "high";
      if (nextTier !== tier) {
        tier = nextTier;
        settings = lightningTier(config, tier);
        schedule = createLightningSchedule(settings);
        perShot.clear();
      }
      return true;
    },
    resize({ width, height, pixelRatio: ratio } = {}) {
      if (disposed) return false;
      if (Number.isFinite(ratio)) pixelRatio = ratio;
      if (width > 0 && height > 0) size = [width, height];
      return true;
    },
    update({ deltaSeconds = 0, reducedMotion = false, motionPaused = false } = {}) {
      if (disposed) return false;
      if (!reducedMotion && !motionPaused && Number.isFinite(deltaSeconds))
        time += Math.max(0, Math.min(0.1, deltaSeconds));
      state.time = time;
      const event = settings.enabled && !reducedMotion && film() ? schedule.at(time, shot()) : null;
      if (bolt) bolt.visible = false;
      if (!event) {
        state.level = 0;
        state.event = null;
        clear();
        return true;
      }
      camera.getWorldPosition(eye);
      if (!placed.has(event)) placed.set(event, place(event));
      const where = placed.get(event);
      // A cut ends the flash: its place belonged to the shot before.
      if (!where || where.shot !== shot()) {
        state.level = 0;
        clear();
        return true;
      }
      const local = settingsFor(where.shot);
      const level = event.strength * lightningLevel(event, time, local.attack);
      state.level = level;
      state.event = {
        k: event.k,
        start: event.start,
        bolt: Boolean(where.segments),
        azimuth: where.centre[0],
        altitude: where.centre[1],
      };
      if (level <= 0) {
        clear();
        return true;
      }
      lit = true;
      // Each pulse's centre wanders a little: the brightest pulses lead.
      let weight = 0,
        da = 0,
        dh = 0;
      for (const p of event.peaks) {
        const w = p.amp * lightningPulse(time - p.t, local.attack, p.decay);
        weight += w;
        da += w * p.jitter[0];
        dh += w * p.jitter[1];
      }
      const jitter = weight > 0 ? (2 * local.sky.jitter) / weight : 0;
      const centre = skyDirection(
        where.centre[0] + da * jitter,
        Math.max(1, where.centre[1] + 0.4 * dh * jitter),
        view,
      );
      const direction = shellDirection(centre, shell);
      const { sky: glow, relight } = local;
      sky.uFlash.value.set(direction.x, direction.y, direction.z, level);
      sky.uFlashGlow.value.set(where.radius, glow.gain, glow.clear, glow.thin);
      sky.uFlashTone.value.set(...glow.color, glow.about);
      sky.uFlashCore.value = glow.core;
      // The fill turns toward a flash off the lens's axis, so it lights the
      // subjects' near side from there; one in view, behind them, leaves the
      // fill where it is (the faces we see keep it) and backlights them through
      // the rim instead.
      camera.getWorldDirection(point);
      const facing =
        (point.x * centre.x + point.z * centre.z) /
        Math.max(1e-6, Math.hypot(point.x, point.z) * Math.hypot(centre.x, centre.z));
      rendering?.setFlash?.({
        fill: level * relight.fill,
        aim: 1 - smoothstep(0.2, 0.8, facing),
        direction: [direction.x, direction.y, direction.z],
        color: relight.color,
        hemisphere: level * relight.hemisphere,
        ambient: level * relight.ambient,
      });
      FLASH_GROUND.babelFlash.value.x = level * relight.sky;
      FLASH_GROUND.babelFlash.value.y = level * relight.water;
      // The moon rim takes the flash's cold light and turns toward it by the
      // flash's share; on the bark that share comes off behind the text (the
      // rim's text guard, BARK_RIM_TEXT, at (moon x the mood's + flash) / both),
      // so there the bark keeps exactly its moon rim.
      const rim = RIM_UNIFORMS.babelRimLight.value,
        added = level * relight.rim,
        [cr, cg, cb] = relight.rimColor;
      const moon = Math.max(1e-6, 0.2126 * rim.x + 0.7152 * rim.y + 0.0722 * rim.z),
        flash = added * (0.2126 * cr + 0.7152 * cg + 0.0722 * cb);
      rim.x += cr * added;
      rim.y += cg * added;
      rim.z += cb * added;
      const share = flash / (moon + flash);
      RIM_UNIFORMS.babelRimText.value = RIM_UNIFORMS.babelRimText.value * (1 - share) + share;
      camera.updateMatrixWorld();
      RIM_UNIFORMS.babelKeyView.value
        .lerp(view.copy(direction).transformDirection(camera.matrixWorldInverse), share)
        .normalize();
      if (bolt) {
        const b = local.bolt;
        bolt.visible = Boolean(where.segments);
        if (where.segments && bolt.userData.event !== event) {
          writeBolt(bolt, where.segments);
          bolt.userData.event = event;
        }
        if (bolt.visible) {
          const u = bolt.material.uniforms;
          let strokes = 0;
          for (const p of event.peaks)
            strokes = Math.max(
              strokes,
              p.amp * lightningPulse(time - p.t, local.attack * 0.5, b.decay),
            );
          u.uLevel.value = event.strength * b.brightness * Math.max(strokes, b.afterglow * level);
          u.uGrow.value = (time - (event.peaks[0].t - b.leader)) / Math.max(1e-3, b.leader);
          u.uCore.value = b.core * pixelRatio;
          u.uHalo.value = b.halo * pixelRatio;
          u.uGlow.value = b.glow;
          u.uColor.value.set(...b.color);
          u.uViewport.value.set((size[0] * pixelRatio) / 2, (size[1] * pixelRatio) / 2);
        }
      }
      return true;
    },
    dispose() {
      if (disposed) return false;
      clear();
      disposed = true;
      if (bolt) {
        bolt.removeFromParent();
        bolt.geometry.dispose();
        bolt.material.dispose();
      }
      return true;
    },
  };
  return controller;
}
