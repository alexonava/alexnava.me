import { Group, Mesh, PlaneGeometry, Quaternion, ShaderMaterial, SphereGeometry } from "three";
import { starBlending } from "./depth-layers.js";

// The disc's radius in world units.
export const SOLAR_RADIUS = (6.5 * 1.15 * 0.81) / 2;
// The sky's tiers (atmosphere.js and starfield.js read the profile's through this).
const CELESTIAL_TIERS = Object.freeze(["high", "balanced", "low"]);
// The star as a camera sees it (the owner's pick of 2026-10-25, "As a camera sees it", its glow
// "bright … just … tight", the tighter of two; its lens flare is postprocess.js LENS_FX.flare):
// the night is exposed for the moon and the clouds, so the star lies far past the exposure and
// its clipped light spreads a little past the limb before it falls away. Its disc is `exposure`
// times the night's white in `color` (its light), darkened toward the limb by channel (`limb`:
// the share each loses at the limb, I = 1 - u(1 - mu)), so the limb is dimmer and redder; its
// edge softens over `soft` radii either side of the limb (the air's seeing and a slight
// defocus), never a hard painted edge, and it has no texture, as a clipped disc shows none. The
// lens spreads it in a steep wing (`wing`: at the limb, and its scale in radii, falling as the
// cube), and about it the air's forward scatter, the aureole, is `aureole[0]` at the limb and
// falls as the inverse square of the distance from the limb (`aureole[1]` radii its scale), both
// shading from `inner` near the disc to `outer`; the aureole eases out over the second half of
// its `reach` (radii). All of it clips softly, channel by channel, at `white`, the camera's
// white as the grade shows it warm, so the clipped core is flat and white-hot and only its limb
// and the light falling off it show their warmth. The star draws the wing and the aureole out to
// `near` (easing out between the two radii), where the lens (LENS_FX.flare) carries the aureole
// on past the clouds' cel step. The star mask (depth-layers.js STAR_LAYER) is held whole over the
// near part out past its end (`hold.reach` radii) and feathered over `hold.feather` radii beyond
// (`hold.cover`: the coverage that marks it whole), so the clouds' cel step never bands it. It
// neither breathes nor leans. The glow's plane is `plane` radii across.
export const SOLAR_LOOK = Object.freeze({
  exposure: 10,
  color: Object.freeze([1, 0.86, 0.62]),
  limb: Object.freeze([0.45, 0.6, 0.8]),
  soft: 0.12,
  wing: Object.freeze([6, 0.2]),
  aureole: Object.freeze([0.6, 0.6]),
  inner: Object.freeze([1, 0.88, 0.7]),
  outer: Object.freeze([1, 0.6, 0.3]),
  white: Object.freeze([1.7, 1.5, 1.12]),
  near: Object.freeze([1.5, 2.4]),
  reach: 2.5,
  hold: Object.freeze({ reach: 2.5, feather: 0.45, cover: 0.18 }),
  plane: 7,
});
// The aureole's furthest reach in world units (framing.test keeps it clear of the text and of
// The watch's crests).
export const SOLAR_GLOW_RADIUS = SOLAR_RADIUS * SOLAR_LOOK.reach;
export function celestialTier(profile = {}) {
  return CELESTIAL_TIERS.includes(profile.tier) ? profile.tier : "high";
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

const L = SOLAR_LOOK;
// The aureole at h radii past the limb (SOLAR_LOOK.aureole, gone by its reach), shared with the
// lens.
export const SOLAR_AUREOLE_GLSL = `
vec3 solarAureole(float h){
  float k=1.0+h/${glsl(L.aureole[1])};
  return mix(${vec3(L.outer)},${vec3(L.inner)},1.0/k)*${glsl(L.aureole[0])}/(k*k)*(1.0-smoothstep(${glsl(L.reach / 2 - 1)},${glsl(L.reach - 1)},h));
}`;
// The star's light r radii from its centre on screen: the disc, limb-darkened and softened at
// its edge, and the lens's wing and the near aureole about it, coming in over the limb, all
// clipped softly at the camera's white. The disc and the glow both draw it, so they meet
// seamlessly wherever the disc's silhouette falls.
const LIGHT = `${SOLAR_AUREOLE_GLSL}
vec3 solarLight(float r){
  float mu=sqrt(max(1.0-r*r,0.0)), h=max(r-1.0,0.0), w=1.0+h/${glsl(L.wing[1])};
  vec3 halo=(solarAureole(h)+mix(${vec3(L.outer)},${vec3(L.inner)},1.0/w)*${glsl(L.wing[0])}/(w*w*w))*smoothstep(${glsl(1 - 3 * L.soft)},1.0,r)*(1.0-smoothstep(${glsl(L.near[0])},${glsl(L.near[1])},r));
  vec3 light=${glsl(L.exposure)}*${vec3(L.color)}*(1.0-${vec3(L.limb)}*(1.0-mu))*(1.0-smoothstep(${glsl(-L.soft)},${glsl(L.soft)},r-1.0))+halo, q=light/${vec3(L.white)};
  q*=q;
  return light*inversesqrt(sqrt(1.0+q*q));
}`;
// The disc's point in radii on screen: its offset from the centre in the plane through the
// centre facing the lens, where the glow measures its own.
const DISC_VERTEX = `
varying vec3 vView;
varying vec3 vCentre;
void main() {
  vec4 p = modelViewMatrix * vec4(position,1.0);
  vView = p.xyz;
  vCentre = (modelViewMatrix * vec4(0.0,0.0,0.0,1.0)).xyz;
  gl_Position = projectionMatrix * p;
}
`;
const DISC_FRAGMENT = `
varying vec3 vView;
varying vec3 vCentre;
${LIGHT}
void main() {
  float r=length(vView.xy*(vCentre.z/vView.z)-vCentre.xy)/${glsl(SOLAR_RADIUS)};
  gl_FragColor=vec4(solarLight(r),1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
const GLOW_VERTEX = `
varying vec2 vUv;
void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}
`;
// The glow: the disc's softened edge and the near aureole past the limb. It runs on under the
// disc, which lays the same light over it.
const GLOW_FRAGMENT = `
varying vec2 vUv;
${LIGHT}
void main() {
  float r=length((vUv-.5)*${glsl(L.plane)});
  vec3 color=solarLight(r);
  float alpha=min(dot(color,vec3(.2126,.7152,.0722)),1.0)*(1.0-smoothstep(${glsl(L.plane / 2 - 0.6)},${glsl(L.plane / 2)},r));
  // The mask alone (its light is added with factor one): whole over the near aureole, past its end.
  float hold=${glsl(L.hold.cover)}*(1.0-smoothstep(${glsl(L.hold.reach)},${glsl(L.hold.reach + L.hold.feather)},r));
  gl_FragColor=vec4(color,min(max(alpha,hold),1.0));
  #include <colorspace_fragment>
}
`;

export function createSolarBody({ parent, camera, position, profile = {} }) {
  const root = new Group(),
    parentQuaternion = new Quaternion();
  root.name = "solar-body";
  root.position.copy(position);
  parent.add(root);
  // The glow goes down first, under the disc.
  const glowMaterial = new ShaderMaterial({
    name: "SolarGlow",
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
    update() {
      if (disposed) return false;
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
