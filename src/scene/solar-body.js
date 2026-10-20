import {
  Group,
  Mesh,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  SphereGeometry,
  Vector2,
} from "three";
import { starBlending } from "./depth-layers.js";

// The disc's radius in world units.
export const SOLAR_RADIUS = (6.5 * 1.15 * 0.81) / 2;
// The sky's tiers (atmosphere.js and starfield.js read the profile's through this).
const CELESTIAL_TIERS = Object.freeze(["high", "balanced", "low"]);
// The star, painted (the owner's pick of 2026-10-20, "more artistic sort of like the sky", A
// Brushed): the disc is laid in with a brush in the sky's own manner, a pale `core` warming to
// `mid` and `rim` in soft bands (`bands`: the core's and the mid's outer radii, and their
// softness), their edges wandering by `wobble` radii, bristles lighter and darker by `streak`
// along the stroke (`dir`, the sky's brush direction on screen; `along` and `across` per
// radius). The glow carries on from the limb's colour with no line where they meet (`glow`:
// strength, falloff per radius, reach; `tail`: a faint wash bleeding further, strength and
// falloff), `inner` warming to `outer` as it goes, and is brushwork too: `texture` of it is
// bristle in straight strokes, its edge irregular, never a circle. No photographic surface,
// flames, loops or lens streak. Its light breathes by up to `breath` on irregular noise
// (`breathRate` per second) and leans by up to `lean` toward a slowly wandering side
// (`leanRate`), on the celestial clock, so reduced motion holds it still. The glow's plane is
// `plane` radii across. The star mask (depth-layers.js STAR_LAYER) is held whole over the
// glow, out past its reach, and feathered over `hold.feather` radii beyond (`hold.cover`: the
// coverage that marks it whole), so the clouds' cel step never bands its tail.
export const SOLAR_LOOK = Object.freeze({
  core: Object.freeze([1, 0.96, 0.84]),
  mid: Object.freeze([1, 0.86, 0.58]),
  rim: Object.freeze([1, 0.76, 0.44]),
  bands: Object.freeze([0.45, 0.85, 0.14]),
  wobble: 0.06,
  streak: 0.1,
  dir: Object.freeze([0.848, -0.53]),
  along: 1.4,
  across: 9,
  glow: Object.freeze([0.85, 2.4, 2.5]),
  tail: Object.freeze([0.16, 0.9]),
  inner: Object.freeze([1, 0.78, 0.44]),
  outer: Object.freeze([1, 0.58, 0.26]),
  texture: 0.6,
  breath: 0.1,
  breathRate: 0.5,
  lean: 0.25,
  leanRate: 0.03,
  hold: Object.freeze({ feather: 0.45, cover: 0.18 }),
  plane: 7,
});
// The glow's furthest reach in world units (framing.test keeps it clear of the text and of
// The watch's crests).
export const SOLAR_GLOW_RADIUS = SOLAR_RADIUS * SOLAR_LOOK.glow[2];
export function celestialTier(profile = {}) {
  return CELESTIAL_TIERS.includes(profile.tier) ? profile.tier : "high";
}
// Smooth 1D value noise, 0..1, from a seeded lattice: irregular, never periodic.
function wander(x, seed) {
  const i = Math.floor(x),
    f = x - i,
    u = f * f * (3 - 2 * f),
    h = (n) => {
      const v = Math.sin((n + seed * 17.13) * 127.1) * 43758.5453;
      return v - Math.floor(v);
    };
  return h(i) + (h(i + 1) - h(i)) * u;
}
// The star's unrest at celestial time `time`: its light's factor (1 +- breath)
// and the glow's lean, a vector up to `lean` long that slowly turns.
export function solarUnrest(time = 0, look = SOLAR_LOOK) {
  const b =
      0.65 * wander(time * look.breathRate, 1) + 0.35 * wander(time * look.breathRate * 2.3, 2),
    angle = Math.PI * 4 * wander(time * look.leanRate, 3),
    reach = look.lean * (0.5 + 0.5 * wander(time * look.leanRate * 1.7, 4));
  return {
    breath: 1 + look.breath * (2 * b - 1),
    lean: [Math.cos(angle) * reach, Math.sin(angle) * reach],
  };
}
const glsl = (value) => (Number.isInteger(value) ? value.toFixed(1) : String(value));
const vec3 = (values) => `vec3(${values.map(glsl).join(",")})`;
export function createCelestialClock() {
  let previous = null,
    time = 0,
    held = false;
  return {
    tick(elapsed = 0, reduced = false) {
      const now = Number.isFinite(elapsed) ? elapsed : (previous ?? 0);
      if (previous !== null && !reduced && !held) time += Math.max(0, now - previous);
      previous = now;
      held = reduced;
      return time;
    },
  };
}
export function seededRandom(seed = 23917) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const NOISE = `
float hash31(vec3 p) {
  p = fract(p * .1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}
float noise3(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f*f*(3.0-2.0*f);
  return mix(mix(mix(hash31(i),hash31(i+vec3(1,0,0)),f.x),
                 mix(hash31(i+vec3(0,1,0)),hash31(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hash31(i+vec3(0,0,1)),hash31(i+vec3(1,0,1)),f.x),
                 mix(hash31(i+vec3(0,1,1)),hash31(i+vec3(1,1,1)),f.x),f.y),f.z);
}
`;
const L = SOLAR_LOOK;
// A point v on screen (radii from the star's centre) in the brush's frame: along, across.
const brush = (v) =>
  `vec2(dot(${v},vec2(${glsl(L.dir[0])},${glsl(L.dir[1])})),dot(${v},vec2(${glsl(-L.dir[1])},${glsl(L.dir[0])})))`;
const DISC_VERTEX = `
varying vec3 vViewNormal;
void main() {
  vViewNormal = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
}
`;
// The disc on screen: d its point in radii from the centre (the view normal's xy), banded
// warm from the core out, the bands' edges wobbling, bristles along the stroke.
const DISC_FRAGMENT = `
uniform float uTime;
uniform float uBreath;
varying vec3 vViewNormal;
${NOISE}
void main() {
  vec2 d=normalize(vViewNormal).xy;
  float r=length(d), t=uTime*.01;
  float rr=r+${glsl(L.wobble)}*(2.0*noise3(vec3(d*2.3,t))-1.0)*(.4+.6*r);
  vec3 color=mix(${vec3(L.core)},${vec3(L.mid)},smoothstep(${glsl(L.bands[0] - L.bands[2])},${glsl(L.bands[0] + L.bands[2])},rr));
  color=mix(color,${vec3(L.rim)},smoothstep(${glsl(L.bands[1] - L.bands[2])},${glsl(L.bands[1] + L.bands[2])},rr));
  float bristle=noise3(vec3(${brush("d")}*vec2(${glsl(L.along)},${glsl(L.across)}),3.1+t));
  color*=(1.0+${glsl(L.streak)}*(2.0*bristle-1.0))*mix(1.0,uBreath,.5);
  gl_FragColor=vec4(color,1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
const GLOW_VERTEX = `
varying vec2 vUv;
void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}
`;
// The glow: brushed light that carries on from the limb's colour and falls off quickly, then a
// faint tail bleeding into the sky, its edge irregular. It runs on under the disc, which hides
// it there, so no seam opens at the limb.
const GLOW_FRAGMENT = `
uniform float uTime;
uniform float uBreath;
uniform vec2 uLean;
varying vec2 vUv;
${NOISE}
void main() {
  vec2 p=(vUv-.5)*${glsl(L.plane)};
  float r=length(p), t=uTime*.01, h=max(0.0,r-1.0);
  vec2 n=p/max(r,1e-4);
  float bristle=noise3(vec3(${brush("p")}*vec2(${glsl(L.along * 0.8)},${glsl(L.across * 0.6)}),t));
  float reach=${glsl(L.glow[2])}*(.78+.22*noise3(vec3(n*1.6,5.3+t)));
  float g=(${glsl(L.glow[0])}*exp(-h*${glsl(L.glow[1])})*mix(1.0,.35+1.3*bristle,${glsl(L.texture)})+${glsl(L.tail[0])}*exp(-h*${glsl(L.tail[1])})*mix(1.0,.6+.8*bristle,${glsl(L.texture)}))*(1.0-smoothstep(reach-1.1,reach,r))*(1.0+dot(n,uLean));
  vec3 color=mix(${vec3(L.outer)},${vec3(L.inner)},exp(-h*3.0))*g*uBreath;
  float alpha=g*(1.0-smoothstep(${glsl(L.plane / 2 - 0.6)},${glsl(L.plane / 2)},r));
  // The mask alone (its light is added with factor one): whole over the glow, past its reach.
  float hold=${glsl(L.hold.cover)}*(1.0-smoothstep(${glsl(L.glow[2])},${glsl(L.glow[2] + L.hold.feather)},r));
  gl_FragColor=vec4(color,min(max(alpha,hold),1.0));
  #include <colorspace_fragment>
}
`;

export function createSolarBody({ parent, camera, position, profile = {} }) {
  const root = new Group(),
    clock = createCelestialClock(),
    parentQuaternion = new Quaternion();
  root.name = "solar-body";
  root.position.copy(position);
  parent.add(root);
  const uTime = { value: 0 },
    uBreath = { value: 1 },
    uLean = { value: new Vector2() };
  // The glow goes down first, under the disc, so the disc's smoothed edge lays over it.
  const glowMaterial = new ShaderMaterial({
    name: "SolarGlow",
    uniforms: { uTime, uBreath, uLean },
    vertexShader: GLOW_VERTEX,
    fragmentShader: GLOW_FRAGMENT,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    fog: false,
    ...starBlending(),
  });
  const glow = new Mesh(
    new PlaneGeometry(SOLAR_RADIUS * SOLAR_LOOK.plane, SOLAR_RADIUS * SOLAR_LOOK.plane),
    glowMaterial,
  );
  glow.name = "solar-glow";
  glow.renderOrder = 99;
  root.add(glow);
  const discMaterial = new ShaderMaterial({
    name: "SolarDisc",
    uniforms: { uTime, uBreath },
    vertexShader: DISC_VERTEX,
    fragmentShader: DISC_FRAGMENT,
    transparent: true,
    ...starBlending(true),
    depthWrite: true,
    depthTest: true,
    fog: false,
  });
  const disc = new Mesh(new SphereGeometry(SOLAR_RADIUS, 48, 32), discMaterial);
  disc.name = "solar-disc";
  disc.renderOrder = 100;
  root.add(disc);
  let disposed = false,
    tier = celestialTier(profile);
  const controller = {
    lifecycleOrder: 31,
    root,
    get tier() {
      return tier;
    },
    applyQuality(next = {}) {
      if (disposed) return false;
      tier = celestialTier(next);
      return true;
    },
    update({ elapsedSeconds = 0, reducedMotion = false, motionPaused = false } = {}) {
      if (disposed) return false;
      // A visitor pause holds the star's breath with the rest of the sky.
      uTime.value = clock.tick(elapsedSeconds, reducedMotion || motionPaused);
      const unrest = solarUnrest(uTime.value);
      uBreath.value = unrest.breath;
      uLean.value.set(...unrest.lean);
      if (camera) {
        camera.getWorldQuaternion(glow.quaternion);
        root.getWorldQuaternion(parentQuaternion).invert();
        glow.quaternion.premultiply(parentQuaternion);
      }
      return true;
    },
    dispose() {
      if (disposed) return false;
      disposed = true;
      root.removeFromParent();
      for (const object of [disc, glow]) {
        object.geometry.dispose();
        object.material.dispose();
      }
      root.clear();
      return true;
    },
  };
  controller.applyQuality(profile);
  return controller;
}
