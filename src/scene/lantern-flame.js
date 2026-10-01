// Loaded only while preparing the supplied lantern. Keep first-party imports
// out of this lazy chunk so the entry's module evaluation order stays intact.
import { Vector3 } from "three";

const frozen = (...values) => Object.freeze(values);

// The flame, in local lantern units (LANTERN_AUTHORING_HEIGHT 2.48). The supplied
// globe is a closed teardrop, y .455-1.14 inside r .33 of the wick axis; the
// burner cup ends at .45. A small hurricane-lantern flame stands .30 tall (44%
// of the globe) on the wick top, widest ±.047 about a third of the way up; the
// draught scales its height by lanternDraught()[1] and its light by [0].
// Exported so anything that must match it (the puddle mirror's reflected flame)
// can be tied to these numbers in tests; lazy chunks cannot import each other.
export const FLAME = Object.freeze({
  axis: frozen(0, -0.01), // wick axis, local (x, z)
  base: 0.49, // wick top: the flame's foot
  height: 0.3, // at rest; the draught scales it within about [.78, 1.03]
  top: 0.79, // base + height
  halfWidth: 0.047,
  center: 0.595, // base + .35 height: the bright band, origin of the cage near field
  globe: Object.freeze({ bottom: 0.452, top: 1.142, radius: 0.335 }),
  // Linear radiance before the draught glow and the fire gain.
  color: Object.freeze({
    blue: frozen(0.07, 0.16, 0.62),
    core: frozen(1.35, 1.12, 0.62),
    body: frozen(1.12, 0.8, 0.25),
    tip: frozen(1, 0.24, 0.035),
  }),
  gain: 1.6,
});
// Light held in the clear glass: halo around the flame, faint fill, warm rim,
// a soft glare (a quarter less under bloom), and transmission.
const GLASS = {
  halo: 0.05,
  fill: 0.015,
  rim: 0.6,
  glare: 0.05,
  transmission: 0.92,
  roughness: 0.1,
};
// A globe triangle has every corner in y (.44, 1.175) within r .335 of the axis (the rim ring
// shares the cup's .443-.447 vertices) and its centroid in y (.452, 1.142): exactly the 266
// emission-mask triangles of the supplied GLB plus two slivers under the finial.
const SHELL = { low: 0.44, high: 1.175 };
// Where the practical light is absent the near field matches nothing.
const NO_LIGHT = 1e4;

const n = (value) => {
  const text = (+value).toFixed(4).replace(/0+$/, "");
  return text.endsWith(".") ? text + "0" : text;
};
const vec = (values) => values.map(n).join(", ");

// Calm breath plus one draught per 7.5 s cell at a hashed moment, strength and
// heading. Pure in t, so a frozen clock freezes it; neutral [1, 1, 0, 0] at 0.
// [glow, height, leanX, leanZ]: glow scales the flame, the glass light and the
// practical light (within [.89, 1.07]); height scales the flame; lean is the
// tip offset in local units along x and z.
export function lanternDraught(t, out = [1, 1, 0, 0]) {
  const hash = (k) => {
    const s = Math.sin(k * 127.1 + 311.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const breath = 0.5 * Math.sin(t * 6.7) + 0.3 * Math.sin(t * 10.3) + 0.2 * Math.sin(t * 16.9);
  const cell = Math.floor(t / 7.5),
    start = 1.2 + 4.2 * hash(cell),
    length = 1.5 + 0.9 * hash(cell + 17.3);
  const k = (t - cell * 7.5 - start) / length;
  const gust = k > 0 && k < 1 ? (0.65 + 0.35 * hash(cell + 3.1)) * Math.sin(Math.PI * k) ** 2 : 0;
  const flutter = 0.6 * Math.sin(t * 21.7) + 0.4 * Math.sin(t * 34.3);
  const heading = 6.2832 * hash(cell + 9.7),
    lean = 0.036 * gust * (1 + 0.35 * flutter);
  out[0] = 1 + 0.062 * breath * (1 - 0.6 * gust) - 0.065 * gust + 0.022 * gust * flutter;
  out[1] = 1 + 0.035 * breath - 0.13 * gust + 0.07 * gust * flutter;
  out[2] = lean * Math.cos(heading);
  out[3] = lean * Math.sin(heading);
  return out;
}

const FLAME_GLSL = `
uniform float lanternTime;
uniform vec3 lanternEye;
uniform vec4 lanternFlicker;
uniform float lanternBloom;
uniform vec3 lanternLight;
varying vec3 vLanternPoint;
#define LANTERN_AXIS vec2(${vec(FLAME.axis)})
#define FLAME_BASE ${n(FLAME.base)}
#define FLAME_H ${n(FLAME.height)}
#define FLAME_W ${n(FLAME.halfWidth)}
float lanternNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3. - 2. * f);
  vec4 n = fract(sin(vec4(dot(i, vec2(127.1, 311.7)),
    dot(i + vec2(1., 0.), vec2(127.1, 311.7)),
    dot(i + vec2(0., 1.), vec2(127.1, 311.7)),
    dot(i + vec2(1.), vec2(127.1, 311.7)))) * 43758.5453);
  return mix(mix(n.x, n.y, f.x), mix(n.z, n.w, f.x), f.y);
}
// The globe's shell: between the burner cup and the finial, inside its radius.
// Taking it over the emission mask removes the mask's UV-island seams.
float lanternBulb(vec3 p) {
  return smoothstep(${n(FLAME.globe.bottom)}, ${n(FLAME.globe.bottom + 0.01)}, p.y) * (1. - smoothstep(${n(FLAME.globe.top - 0.014)}, ${n(FLAME.globe.top)}, p.y))
    * (1. - smoothstep(${n(FLAME.globe.radius - 0.02)}, ${n(FLAME.globe.radius)}, length(p.xz - LANTERN_AXIS)));
}
vec3 lanternFire(vec3 surface) {
  // Flame-plane coordinates: the vertical plane through the wick, facing the eye.
  vec2 axisEye = lanternEye.xz - LANTERN_AXIS;
  vec2 facing = normalize(axisEye + vec2(.00001)), side = vec2(-facing.y, facing.x);
  vec3 ray = normalize(surface - lanternEye);
  vec3 hit = lanternEye + ray * (-dot(axisEye, facing) / min(-.001, dot(ray.xz, facing)));
  vec2 q = vec2(dot(hit.xz - LANTERN_AXIS, side), hit.y);
  float t = lanternTime, h = FLAME_H * lanternFlicker.y;
  float v = (q.y - FLAME_BASE) / h, rise = clamp(v, 0., 1.);
  // Draught lean, a slow wander and a tip flutter all grow up the flame.
  float lean = dot(lanternFlicker.zw, side) + .010 * (lanternNoise(vec2(v * 2.2 - t * 3.3, t * .41)) - .5)
    + .004 * sin(t * 1.7);
  float x = q.x - lean * rise * rise;
  float s = clamp((v + .08) / 1.08, 0., 1.);
  float width = FLAME_W * 1.45 * sin(3.14159 * pow(s, .74)) * (1. - .22 * s)
    * (1. + .22 * smoothstep(.45, 1., v) * (lanternNoise(vec2(v * 4. - t * 5.2, 7.1)) - .5));
  float r = abs(x) / max(.0001, width);
  float body = (1. - smoothstep(.3, 1., r)) * step(-.08, v) * step(v, 1.);
  // Luminous soot starts above the blue cup; a darker vapour cone sits over the wick.
  float lit = smoothstep(.05, .2, v);
  float cone = (1. - smoothstep(.2, .7, r / max(.001, 1. - v / .34))) * smoothstep(-.04, .02, v) * (1. - smoothstep(.2, .36, v));
  float core = (1. - smoothstep(0., .6, r)) * smoothstep(.14, .34, v) * (1. - smoothstep(.44, .74, v));
  vec3 hue = mix(vec3(${vec(FLAME.color.body)}), vec3(${vec(FLAME.color.tip)}), smoothstep(.45, .88, v));
  hue = mix(hue, vec3(${vec(FLAME.color.core)}), core);
  // Where the flame narrows below ~2 px its light fades instead of aliasing into a 1 px needle.
  vec3 fire = hue * body * lit * (.5 + .5 * smoothstep(.1, .38, v)) * (1. - .5 * cone) * (1. - .6 * smoothstep(.62, 1., v)) * smoothstep(.002, .016, width)
    + vec3(.03, .06, .16) * cone * body;
  // Blue cup: the flame's lower outline, brightest toward its rim.
  float cup = (1. - smoothstep(.72, 1.05, r)) * smoothstep(-.08, -.05, v) * (1. - smoothstep(0., .16, v)) * step(-.08, v);
  fire += vec3(${vec(FLAME.color.blue)}) * cup * (.35 + .65 * smoothstep(.2, .85, r)) * (1. - lit);
  // Charred wick with a small ember at its tip.
  float wick = (1. - smoothstep(.012, .016, abs(q.x))) * smoothstep(.452, .457, q.y)
    * (1. - smoothstep(FLAME_BASE - .002, FLAME_BASE + .002, q.y));
  float ember = (1. - smoothstep(.004, .011, abs(q.x))) * smoothstep(FLAME_BASE - .009, FLAME_BASE - .002, q.y)
    * (1. - smoothstep(FLAME_BASE - .001, FLAME_BASE + .003, q.y));
  fire = fire * (1. - .9 * wick) + vec3(.55, .16, .025) * ember;
  // Warm light held in the glass: a halo hugging the flame and a faint fill...
  vec2 g = vec2(q.x / .075, (q.y - FLAME_BASE - .40 * h) / (.62 * h));
  vec3 glass = vec3(1., .48, .14) * (${n(GLASS.halo)} * exp(-1.6 * dot(g, g)) + ${n(GLASS.fill)});
  // ...and a soft glare, a quarter less where a bloom pass runs: at this flame's size
  // the bloom adds almost nothing, so the globe must read on its own on every tier.
  vec2 b = vec2(q.x / .11, (q.y - FLAME_BASE - .45 * h) / (.8 * h));
  glass += vec3(1., .62, .28) * ${n(GLASS.glare)} * exp(-dot(b, b)) * (1. - .25 * lanternBloom);
  return (fire * ${n(FLAME.gain)} + glass) * lanternFlicker.x;
}
// Warm Fresnel rim of the lit globe (a little stronger without bloom) plus a faint cool sky sheen.
vec3 lanternRim(float facing, float y) {
  float grazing = 1. - clamp(facing, 0., 1.), rim = grazing * grazing * (.4 + .6 * grazing);
  return vec3(.55, .24, .06) * ${n(GLASS.rim)} * mix(1.6, 1.5, lanternBloom) * rim * (.35 + .65 * exp(-pow2((y - .62) / .26))) * lanternFlicker.x
    + vec3(.03, .045, .07) * rim * grazing * grazing;
}
`;

// The glass pass owns the globe outright: a mask of 1 and opaque alpha, which
// the see-through blend below needs to keep the subject's depth-layer code.
const EMISSION = (glass) => `#include <emissivemap_fragment>
#ifdef USE_EMISSIVEMAP
float lanternMask = emissiveColor.r;
lanternMask = max(smoothstep(.08, .4, lanternMask), lanternBulb(vLanternPoint));${glass ? "\nlanternMask = 1.;\ndiffuseColor.a = 1.;" : ""}
// Clear glass: no diffuse, smooth dielectric, geometric normal (crisp glints).
diffuseColor.rgb *= 1. - lanternMask;
roughnessFactor = mix(roughnessFactor, ${n(GLASS.roughness)}, lanternMask);
metalnessFactor = mix(metalnessFactor, 0., lanternMask);
#ifndef FLAT_SHADED
normal = normalize(mix(normal, normalize(vNormal) * faceDirection, lanternMask));
#endif
if (lanternMask > .001) {
  totalEmissiveRadiance = lanternFire(vLanternPoint) * lanternMask;
  totalEmissiveRadiance += lanternRim(dot(normal, normalize(vViewPosition)), vLanternPoint.y) * lanternMask;
}
#endif`;

// Near field: the practical light sits a hand's width from the cage, so its
// falloff there is steep. Its own contribution is rescaled by distance from
// the flame: frames at flame height keep it, the cap and the foot dim. The
// light is recognised by position: lanternLight is its world position, taken
// to view space by the same viewMatrix Three applies for pointLights[], so the
// match needs no prop-scale distance (the slack only absorbs float
// precision) and the draught factor carries through.
const NEAR_FIELD = `#include <lights_fragment_end>
#if defined( USE_EMISSIVEMAP ) && NUM_POINT_LIGHTS > 0
{
  vec3 lanternLightView = (viewMatrix * vec4(lanternLight, 1.)).xyz;
  float lanternMatch = .02 + .004 * length(lanternLightView);
  vec3 lanternOffset = vLanternPoint - vec3(${n(FLAME.axis[0])}, ${n(FLAME.center)}, ${n(FLAME.axis[1])});
  float lanternNearGain = clamp(.2164 / (dot(lanternOffset, lanternOffset) + .04), .4, 1.25) - 1.;
  ReflectedLight lanternNear = ReflectedLight(vec3(0.), vec3(0.), vec3(0.), vec3(0.));
  PointLight lanternPoint;
  IncidentLight lanternDirect;
  #pragma unroll_loop_start
  for ( int i = 0; i < NUM_POINT_LIGHTS; i ++ ) {
    lanternPoint = pointLights[ i ];
    if ( distance( lanternPoint.position, lanternLightView ) < lanternMatch ) {
      getPointLightInfo( lanternPoint, geometryPosition, lanternDirect );
      RE_Direct( lanternDirect, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, lanternNear );
    }
  }
  #pragma unroll_loop_end
  reflectedLight.directDiffuse += lanternNearGain * (1. - lanternMask) * lanternNear.directDiffuse;
  reflectedLight.directSpecular += lanternNearGain * (1. - lanternMask) * lanternNear.directSpecular;
}
#endif`;

// Glass pass: emission added over 92% transmission, alpha kept at 1 (subject
// layer code). Literal three constants keep this chunk from growing the
// shared three exports: CustomBlending 5, AddEquation 100, ZeroFactor 200,
// OneFactor 201, OneMinusConstantAlphaFactor 214, FrontSide 0 (DoubleSide
// would show the flame twice, through the back wall).
const GLASS_BLEND = {
  side: 0,
  transparent: true,
  depthWrite: true,
  blending: 5,
  blendEquation: 100,
  blendSrc: 201,
  blendDst: 214,
  blendAlpha: +(1 - GLASS.transmission).toFixed(4),
  blendEquationAlpha: 100,
  blendSrcAlpha: 201,
  blendDstAlpha: 200,
};

/** Own only shader hooks on the assembly's material clones, one glass clone per
 * hooked material, and the globe's draw group. The index is reordered in place
 * and restored on dispose; geometry, images, PBR maps and source assets keep
 * their owners. A scene whose lantern never loads keeps the tree's built-in
 * stand-in and never loads this chunk; a failed load keeps the supplied static
 * glow. */
export function createLanternFlame({ root, camera }) {
  const time = { value: 0 },
    eye = { value: new Vector3(0, 1, 6) },
    flicker = { value: [1, 1, 0, 0] };
  const bloom = { value: 1 },
    lamp = { value: new Vector3(0, NO_LIGHT, 0) },
    probe = new Vector3();
  const center = new Vector3();
  const records = new Map(),
    glasses = new Map(),
    globes = [];
  let disposed = false,
    renderer = null;
  // The puddle mirror (terrain-build.js, another lazy chunk) reads the draught
  // here, on the root beside the practical light, to draw the reflected flame
  // at the same height and lean.
  root.userData.lanternFlicker = flicker;
  const hook = (before, glass) =>
    function (shader, context) {
      before.call(this, shader, context);
      renderer = context || renderer;
      Object.assign(shader.uniforms, {
        lanternTime: time,
        lanternEye: eye,
        lanternFlicker: flicker,
        lanternBloom: bloom,
        lanternLight: lamp,
      });
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vLanternPoint;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvLanternPoint = position;");
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\n" + FLAME_GLSL)
        .replace("#include <emissivemap_fragment>", EMISSION(glass));
      // Glass pixels carry mask 1, where the near field adds nothing.
      if (!glass)
        shader.fragmentShader = shader.fragmentShader.replace(
          "#include <lights_fragment_end>",
          NEAR_FIELD,
        );
    };
  function glassFor(material) {
    let glass = glasses.get(material);
    if (!glass) {
      const { before, key } = records.get(material);
      glass = Object.assign(material.clone(), GLASS_BLEND);
      glass.name = `${material.name || "lantern"} glass`;
      glass.onBeforeCompile = hook(before, true);
      glass.customProgramCacheKey = function () {
        return key.call(this) + "|lantern-flame-v3|lantern-glass";
      };
      glasses.set(material, glass);
    }
    return glass;
  }
  // Globe triangles (see SHELL and FLAME.globe) move to the end of the index
  // as draw group 1, rendered by the glass clone so the cage shows through.
  function splitGlobe(mesh, material) {
    const geometry = mesh.geometry,
      index = geometry?.index,
      position = geometry?.attributes.position;
    if (
      !index ||
      !position ||
      geometry.groups.length ||
      geometry.drawRange.start > 0 ||
      geometry.drawRange.count < index.count ||
      globes.some((globe) => globe.geometry === geometry)
    )
      return;
    const {
      axis: [ax, az],
      globe: { bottom, top, radius },
    } = FLAME;
    const inside = (i) => {
      const y = position.getY(i);
      return (
        y > SHELL.low &&
        y < SHELL.high &&
        Math.hypot(position.getX(i) - ax, position.getZ(i) - az) < radius
      );
    };
    const original = index.array.slice(),
      keep = [],
      shell = [];
    for (let k = 0; k + 2 < original.length; k += 3) {
      const a = original[k],
        b = original[k + 1],
        c = original[k + 2];
      const y = (position.getY(a) + position.getY(b) + position.getY(c)) / 3;
      (inside(a) && inside(b) && inside(c) && y > bottom && y < top ? shell : keep).push(a, b, c);
    }
    if (!shell.length) return;
    const glass = glassFor(material),
      materials = [material, glass];
    index.array.set(keep.concat(shell));
    index.needsUpdate = true;
    geometry.addGroup(0, keep.length, 0);
    geometry.addGroup(keep.length, shell.length, 1);
    mesh.material = materials;
    globes.push({ mesh, geometry, index, material, materials, original });
  }
  // The mount parents the practical light beside this root: the point light
  // there nearest the flame feeds lanternLight (world). Detached, none matches.
  function locateLight() {
    const parent = root.parent;
    let best = Infinity;
    lamp.value.set(0, NO_LIGHT, 0);
    if (!parent) return;
    root.localToWorld(center.set(FLAME.axis[0], FLAME.center, FLAME.axis[1]));
    for (const child of parent.children) {
      if (!child.isPointLight) continue;
      const distance = child.getWorldPosition(probe).distanceToSquared(center);
      if (distance < best) {
        best = distance;
        lamp.value.copy(probe);
      }
    }
  }
  const dispose = () => {
    if (disposed) return false;
    disposed = true;
    // Borrowed state first: the index order, the groups and the mesh's own
    // material, then the shader hooks; only the glass clones are freed.
    globes.forEach(({ mesh, geometry, index, material, materials, original }) => {
      if (geometry.index === index) {
        index.array.set(original);
        index.needsUpdate = true;
      }
      geometry.clearGroups();
      if (mesh.material === materials) mesh.material = material;
    });
    globes.length = 0;
    if (root.userData.lanternFlicker === flicker) delete root.userData.lanternFlicker;
    records.forEach(({ before, key }, material) => {
      material.onBeforeCompile = before;
      material.customProgramCacheKey = key;
      material.needsUpdate = true;
    });
    records.clear();
    glasses.forEach((glass) => glass.dispose());
    glasses.clear();
    renderer = null;
    return true;
  };
  try {
    root.traverse((mesh) => {
      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of list) {
        if (!material?.isMeshStandardMaterial || !material.emissiveMap || records.has(material))
          continue;
        const before = material.onBeforeCompile,
          key = material.customProgramCacheKey;
        records.set(material, { before, key });
        material.onBeforeCompile = hook(before, false);
        material.customProgramCacheKey = function () {
          return key.call(this) + "|lantern-flame-v3";
        };
        material.needsUpdate = true;
      }
      if (!Array.isArray(mesh.material) && records.has(mesh.material))
        splitGlobe(mesh, mesh.material);
    });
  } catch (error) {
    dispose();
    throw error;
  }
  return {
    get time() {
      return time.value;
    },
    // `bloom` names whether a bloom pass runs this frame. Without it, the
    // renderer's shadow map stands in: quality.js gives shadows and bloom to
    // the same tiers (high), and neither to balanced or low.
    update({
      deltaSeconds = 0,
      reducedMotion = false,
      motionPaused = false,
      bloom: bloomPass,
    } = {}) {
      if (disposed) return 1;
      if (!reducedMotion && !motionPaused && Number.isFinite(deltaSeconds))
        time.value += Math.max(0, Math.min(0.1, deltaSeconds));
      root.updateWorldMatrix(true, false);
      if (camera) root.worldToLocal(camera.getWorldPosition(eye.value));
      bloom.value = (
        typeof bloomPass === "boolean" ? bloomPass : (renderer?.shadowMap?.enabled ?? true)
      )
        ? 1
        : 0;
      locateLight();
      // One draught drives the flame shape, the glass light and (through the
      // returned glow) the practical light, which the tree clamps to [.88, 1.12].
      return lanternDraught(time.value, flicker.value)[0];
    },
    dispose,
  };
}
