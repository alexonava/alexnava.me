import {
  AdditiveBlending,
  CustomBlending,
  HalfFloatType,
  NoBlending,
  OneFactor,
  ShaderMaterial,
  SrcAlphaFactor,
  UniformsUtils,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderTarget,
  ZeroFactor,
} from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { FullScreenQuad } from "three/examples/jsm/postprocessing/Pass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { CopyShader } from "three/examples/jsm/shaders/CopyShader.js";

const PASS_VERTEX_SHADER = `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const GRADING_SHADER = {
  name: "BabelGradingShader",
  uniforms: {
    tDiffuse: { value: null },
    uCelMix: { value: 0.24 },
    uInkMix: { value: 0.14 },
    uContrast: { value: 1.1 },
    uHighlightWarmMix: { value: 0.2 },
    uShadowCoolMix: { value: 0.34 },
    uTexelSize: { value: new Vector2(1, 1) },
    uLayerRelief: { value: 0 },
  },
  vertexShader: PASS_VERTEX_SHADER,
  fragmentShader: `
uniform sampler2D tDiffuse;
uniform float uCelMix;
uniform float uInkMix;
uniform float uContrast;
uniform float uHighlightWarmMix;
uniform float uShadowCoolMix;
uniform vec2 uTexelSize;
uniform float uLayerRelief;
varying vec2 vUv;

vec3 saturateColor(vec3 color, float amount) {
  float luma = dot(color, vec3(0.299, 0.587, 0.114));
  return mix(vec3(luma), color, amount);
}

void main() {
  vec4 texel = texture2D(tDiffuse, vUv);
  vec3 color = texel.rgb;
  float luma = dot(color, vec3(0.299, 0.587, 0.114));

  color = (color - 0.5) * uContrast + 0.5;

  vec3 shadowLift = vec3(0.045, 0.055, 0.09);
  vec3 coolShadow = color * vec3(0.88, 0.94, 1.09);
  vec3 warmMidtone = color * vec3(1.025, 1.012, 0.965);
  vec3 parchmentHighlight = color * vec3(1.055, 1.025, 0.94);

  float shadowMix = 1.0 - smoothstep(0.08, 0.32, luma);
  float midMix = smoothstep(0.22, 0.46, luma) * (1.0 - smoothstep(0.62, 0.82, luma));
  float highlightMix = smoothstep(0.72, 0.97, luma);

  color = mix(color, max(coolShadow, shadowLift), uShadowCoolMix * shadowMix);
  color = mix(color, warmMidtone, 0.3 * midMix);
  color = mix(color, parchmentHighlight, uHighlightWarmMix * highlightMix);

  float gradedLuma = max(0.02, dot(color, vec3(0.299, 0.587, 0.114)));
  float tonalBand = floor(gradedLuma * 5.0 + 0.5) / 5.0;
  vec3 celColor = color * (tonalBand / gradedLuma);
  // The ground (depth code 2/3) takes no band: its soil, cracks and water stay
  // continuous, close up and far.
  float groundLayer = uLayerRelief * (1.0 - smoothstep(0.04, 0.12, abs(texel.a - 0.6667)));
  // The star and its glow, and the light shafts' air over the sky
  // (depth-layers.js STAR_LAYER and SHAFT_LAYER over the sky's 0), stay
  // continuous: the cloud banks' steps never ring them.
  float starLayer = uLayerRelief * smoothstep(0.0005, 0.006, texel.a) * (1.0 - smoothstep(0.22, 0.28, texel.a));
  // In film the step's bands and the ink are the sky's alone (the owner's direction
  // of 2026-10-09: the clouds are the artistic part, everything else realistic).
  // Off the sky only its deepest band stays, where it never stepped: below graded
  // luma .1 it pulls the colour toward black, easing out from .05, so the subjects'
  // deep shade and the ranges' fogged feet keep their tone. skyLayer eases over a
  // subject's or a crest's partly covered edge (their codes blend toward 0 there),
  // so no unbanded fringe rings them against the banded clouds.
  float skyLayer = 1.0 - smoothstep(0.0, 0.3, texel.a);
  float celWeight = mix(1.0, mix(1.0 - smoothstep(0.05, 0.1, gradedLuma), 1.0, skyLayer), uLayerRelief);
  color = mix(color, celColor, uCelMix * celWeight * (1.0 - groundLayer) * (1.0 - starLayer));
  color = saturateColor(color, 1.04);

  if (uInkMix > 0.0) {
  vec3 Y = vec3(0.299, 0.587, 0.114);
  vec4 e1 = texture2D(tDiffuse, vUv + vec2(uTexelSize.x, 0.0)), e2 = texture2D(tDiffuse, vUv - vec2(uTexelSize.x, 0.0));
  vec4 e3 = texture2D(tDiffuse, vUv + vec2(0.0, uTexelSize.y)), e4 = texture2D(tDiffuse, vUv - vec2(0.0, uTexelSize.y));
  float horizontalEdge = abs(dot(e1.rgb, Y) - dot(e2.rgb, Y));
  float verticalEdge = abs(dot(e3.rgb, Y) - dot(e4.rgb, Y));
  float inkContour = smoothstep(0.2, 0.48, max(horizontalEdge, verticalEdge));
  float nearest = max(max(e1.a, e2.a), max(e3.a, e4.a));
  // In film only where the pixel and its four neighbours are all bare sky: the
  // clouds' own edges, never an outline on a subject, a crest, the ground or a shaft.
  float skyInk = mix(1.0, (1.0 - smoothstep(0.0, 0.006, texel.a)) * (1.0 - step(0.006, nearest)), uLayerRelief);
  color = mix(color, vec3(0.035, 0.055, 0.095), inkContour * uInkMix * skyInk);
  }
  // A soft shoulder: highlights past the knee roll off toward white, not clip.
  vec3 over = max(color - 0.75, 0.0);
  color = mix(color, min(color, 0.75) + 0.25 * (1.0 - exp(-over / 0.25)), uLayerRelief);

  gl_FragColor = vec4(clamp(color, 0.0, 1.0), texel.a);
}
`,
};

// The tour's depth-staggered dissolve. In film every surface writes its depth
// layer (depth-layers.js) into the scene target's alpha, which bloom, grading
// and the kept frame preserve. Each pixel waits for the later of its outgoing
// and incoming layers, start = 3 * step * code, then dissolves over `window`
// of the progress: sky, mountains, ground, subject. 3 * step + window = 1, so
// the subject settles as the transition ends. A layer's code is the maximum over
// a 5-tap cross, so anti-aliased edges travel with the nearer layer. Every
// weight stays in 0..1, a mix of two frames, so no frame can go black.
export const LAYER_STAGGER = Object.freeze({ step: 0.2, window: 0.4 });

// The lens (the owner's pick of the Eye breakdown, 2026-10-09), all of it in the
// final pass, in film only; each part switches off with its `on`.
export const LENS_FX = Object.freeze({
  // Heat shimmer: the frame's UV drifts on flowing noise in a ring about the star
  // (`ring`: from, full, fading, gone, in star radii) and in a plume above the
  // lantern's flame in the shots that look at it (`flameShots`; `plume` world
  // units tall, `width` wide at the flame). `amount` is the drift (star radii;
  // world units at the flame), `scale` the noise's frequency (per radius; per
  // unit), `rise` its outward or upward flow a second and `boil` its churn;
  // `octaves` per tier.
  heat: Object.freeze({
    on: 1,
    star: Object.freeze({
      amount: 0.028,
      ring: Object.freeze([0.92, 1.2, 1.9, 3]),
      scale: 2.6,
      rise: 0.45,
      boil: 0.5,
    }),
    flame: Object.freeze({
      amount: 0.012,
      plume: 1.9,
      width: 0.16,
      scale: 7,
      rise: 0.9,
      boil: 0.8,
    }),
    flameShots: Object.freeze(["Lantern study", "Root and lantern"]),
    octaves: Object.freeze({ high: 2, balanced: 1 }),
  }),
  // Chromatic aberration: red read outward and blue inward, growing with the
  // square of the distance from the frame's centre to `edge` CSS px apart at a
  // 1600x900 frame's corners (scaled with the frame's diagonal), and `star` px
  // apart across the star's fire edge.
  aberration: Object.freeze({ on: 1, edge: 1.2, star: 0.6 }),
  // Flare, only while the star is in frame: a soft shine about it (`shine` at
  // the limb, falling off over `shineReach` radii, `shineDisc` of it over the
  // disc) in `color`, and ghosts along the line from the star through the
  // frame's centre: [t along it (1 at the centre), radius in frame heights,
  // r, g, b, strength].
  flare: Object.freeze({
    on: 1,
    shine: 0.1,
    shineReach: 1.3,
    shineDisc: 0.25,
    color: Object.freeze([1, 0.6, 0.3]),
    ghosts: Object.freeze([
      Object.freeze([0.32, 0.011, 1, 0.68, 0.38, 0.06]),
      Object.freeze([0.62, 0.02, 0.36, 0.62, 0.56, 0.04]),
      Object.freeze([1.2, 0.034, 0.5, 0.46, 0.8, 0.04]),
    ]),
  }),
  // None of it reaches the text: it eases out over `text[0]` of the screen's
  // smaller side about the name and intro, and `text[1]` about About.
  text: Object.freeze([0.1, 0.05]),
  // Nor The watch's reference banks (STYLE.md, Sky) on desktop landscape frames: the
  // frame's share [x0, y0, x1, y1] from its top-left corner, kept whole, with
  // the lens easing in over `keepSoft` frame heights beyond it.
  keep: Object.freeze({ "The watch": Object.freeze([0, 0, 0.6875, 0.4889]) }),
  keepSoft: 0.03,
});

const lensNumber = (value) => (Number.isInteger(value) ? value.toFixed(1) : String(value));
const lensVec3 = (values) => `vec3(${values.map(lensNumber).join(", ")})`;
const LENS_HEAT = LENS_FX.heat,
  LENS_STAR = LENS_HEAT.star,
  LENS_FLAME = LENS_HEAT.flame,
  LENS_FLARE = LENS_FX.flare;
const LENS_GLSL = `
uniform vec4 uStar;
uniform vec4 uStarPrev;
uniform vec4 uFlame;
uniform vec4 uFlamePrev;
uniform vec4 uKeep;
uniform vec4 uKeepPrev;
uniform vec4 uLens;
uniform float uLensTime;
uniform vec4 slateText;
uniform vec4 slateAbout;
uniform float slateAspect;

float lensHash(vec3 p) {
  p = fract(p * .1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}
float lensNoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(lensHash(i), lensHash(i + vec3(1.0, 0.0, 0.0)), f.x),
                 mix(lensHash(i + vec3(0.0, 1.0, 0.0)), lensHash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
             mix(mix(lensHash(i + vec3(0.0, 0.0, 1.0)), lensHash(i + vec3(1.0, 0.0, 1.0)), f.x),
                 mix(lensHash(i + vec3(0.0, 1.0, 1.0)), lensHash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);
}
// The frame in frame heights: (its aspect, 1).
vec2 lensAspect() {
  return vec2(uCssTexel.y / uCssTexel.x, 1.0);
}
// 1 behind a text box (canvas UV, y up), easing to 0 over d of the smaller side.
float lensBehind(vec4 r, vec2 v, float d) {
  vec2 f = max(max(r.xy - v, v - r.zw), 0.0) * vec2(slateAspect, 1.0) / min(slateAspect, 1.0);
  return 1.0 - smoothstep(0.0, d, length(f));
}
// 1 inside the kept rect and out to grow frame heights, easing to 0 beyond.
float lensKeep(vec4 r, vec2 v, float grow) {
  float d = length(max(max(r.xy - v, v - r.zw), 0.0) * lensAspect());
  return 1.0 - smoothstep(grow, grow + ${lensNumber(LENS_FX.keepSoft)}, d);
}
// Two drifts of flowing noise, about -1..1; a second octave on high.
vec2 lensFlow(vec3 q) {
  vec2 o = vec2(lensNoise(q), lensNoise(q + vec3(17.3, 9.1, 3.7))) - 0.5;
  if (uLens.w > 1.5)
    o += 0.5 * (vec2(lensNoise(q * 2.3 + 5.1), lensNoise(q * 2.3 + vec3(1.7, 31.4, 8.2))) - 0.5);
  return o * 2.0;
}
// The heat's drift at v in UV: a ring about the star flowing outward, a plume
// above the flame flowing up.
vec2 lensHeat(vec2 v, vec4 star, vec4 flame) {
  vec2 aspect = lensAspect(), o = vec2(0.0);
  if (star.w > 0.0) {
    vec2 d = (v - star.xy) * aspect / star.z;
    float r = length(d);
    float m = smoothstep(${lensNumber(LENS_STAR.ring[0])}, ${lensNumber(LENS_STAR.ring[1])}, r) * (1.0 - smoothstep(${lensNumber(LENS_STAR.ring[2])}, ${lensNumber(LENS_STAR.ring[3])}, r));
    if (m > 0.001)
      o += m * ${lensNumber(LENS_STAR.amount)} * star.z * lensFlow(vec3(d / r * 3.0 + uLensTime * ${lensNumber(LENS_STAR.boil * 0.3)}, (r - uLensTime * ${lensNumber(LENS_STAR.rise)}) * ${lensNumber(LENS_STAR.scale)}));
  }
  if (flame.w > 0.0) {
    vec2 d = (v - flame.xy) * aspect / flame.z;
    float width = ${lensNumber(LENS_FLAME.width)} + 0.22 * max(d.y, 0.0);
    float m = flame.w * exp(-d.x * d.x / (width * width)) * smoothstep(-0.12, 0.2, d.y) * (1.0 - smoothstep(${lensNumber(LENS_FLAME.plume * 0.45)}, ${lensNumber(LENS_FLAME.plume)}, d.y));
    if (m > 0.001)
      o += m * ${lensNumber(LENS_FLAME.amount)} * flame.z * lensFlow(vec3(d.x * ${lensNumber(LENS_FLAME.scale)}, (d.y - uLensTime * ${lensNumber(LENS_FLAME.rise)}) * ${lensNumber(LENS_FLAME.scale)}, uLensTime * ${lensNumber(LENS_FLAME.boil)}));
  }
  return o / aspect;
}
// The aberration's shift at v in UV (red reads it outward, blue inward): half
// the fringe, from the frame's centre and across the star's fire edge.
vec2 lensFringe(vec2 v, vec4 star) {
  vec2 aspect = lensAspect(), c = (v - 0.5) * aspect;
  float corner = 0.25 * (aspect.x * aspect.x + 1.0);
  float frame = length(1.0 / uCssTexel) / 1835.76;
  vec2 px = c * (${lensNumber(LENS_FX.aberration.edge * 0.5)} * frame * length(c) / corner);
  if (star.w > 0.0) {
    vec2 d = (v - star.xy) * aspect / star.z;
    float r = length(d);
    px += d / max(r, 1e-4) * (${lensNumber(LENS_FX.aberration.star * 0.5)} * star.w * smoothstep(0.95, 1.25, r) * (1.0 - smoothstep(1.7, 2.6, r)));
  }
  return px * uCssTexel;
}
// The scene through the lens at uv (screen position v): the heat's drift, the
// shot's focus, then the aberration's fringes, all eased off behind the text
// and the kept banks.
vec4 lensView(sampler2D map, vec2 uv, vec2 v, float blur, vec4 star, vec4 flame, vec4 keep, float guard) {
  // No early return: the focus's taps stay in uniform control flow.
  float open = (1.0 - guard) * (1.0 - lensKeep(keep, v, 0.0));
  vec2 q = uv;
  if (uLens.x > 0.0 && open > 0.0) q += lensHeat(v, star, flame) * (uLens.x * open);
  vec4 texel = lensBlur(map, q, blur);
  if (uLens.y > 0.0) {
    vec2 s = lensFringe(v, star) * (uLens.y * open);
    vec4 centre = blur > 0.0 ? texture2D(map, q) : texel;
    // Blurred sky and ranges keep their focus: only sharp layers fringe there.
    float sharp = blur > 0.0 ? step(0.5, centre.a) : 1.0;
    texel.r += (texture2D(map, q + s).r - centre.r) * sharp;
    texel.b += (texture2D(map, q - s).b - centre.b) * sharp;
  }
  return texel;
}
// The flare at v while the star is in frame: its shine and the ghosts.
vec3 lensFlare(vec2 v, vec4 star, vec4 keep) {
  if (star.w <= 0.0) return vec3(0.0);
  vec2 aspect = lensAspect();
  float inside = min(min(star.x, 1.0 - star.x) * aspect.x, min(star.y - uBars, 1.0 - uBars - star.y));
  float shown = star.w * smoothstep(-star.z, 2.0 * star.z, inside);
  if (shown <= 0.0) return vec3(0.0);
  float r = length((v - star.xy) * aspect) / star.z;
  vec3 c = ${lensVec3(LENS_FLARE.color)} * (${lensNumber(LENS_FLARE.shine)} * exp(-max(r - 1.0, 0.0) / ${lensNumber(LENS_FLARE.shineReach)}) * mix(${lensNumber(LENS_FLARE.shineDisc)}, 1.0, smoothstep(0.7, 1.0, r)));
  vec2 g;
  float e;
${LENS_FLARE.ghosts
  .map(
    ([t, size, red, green, blue, strength]) => `  g = star.xy + (0.5 - star.xy) * ${lensNumber(t)};
  e = length((v - g) * aspect) / ${lensNumber(size)};
  c += ${lensVec3([red, green, blue])} * (${lensNumber(strength)} * (1.0 - smoothstep(0.78, 1.0, e)) * (0.55 + 0.45 * smoothstep(0.45, 0.95, e)) * (1.0 - lensKeep(keep, g, ${lensNumber(size)})));`,
  )
  .join("\n")}
  return c * shown * (1.0 - lensKeep(keep, v, 0.0));
}
`;

const VIGNETTE_GRAIN_SHADER = {
  name: "BabelVignetteGrainShader",
  uniforms: {
    tDiffuse: { value: null },
    uVignetteEnabled: { value: 1 },
    uVignetteStrength: { value: 0.12 },
    uGrainEnabled: { value: 1 },
    uGrainStrength: { value: 0.018 },
    uTextProtection: { value: 0 },
    uTextProtectionFrom: { value: 0 },
    uTextBottom: { value: 0.25 },
    tPrev: { value: null },
    uProgress: { value: 1 },
    uLayered: { value: 0 },
    uStagger: { value: new Vector2(LAYER_STAGGER.step, LAYER_STAGGER.window) },
    uCodeTexel: { value: new Vector2(1, 1) },
    uPrevScale: { value: 1 },
    uPrevOrigin: { value: new Vector2(0.5, 0.5) },
    uCssTexel: { value: new Vector2(1, 1) },
    uBlur: { value: 0 },
    uBlurPrev: { value: 0 },
    uBars: { value: 0 },
    uGrainTime: { value: 0 },
    // The lens (LENS_FX): its sources on screen, as (x, y) in UV, a size in frame
    // heights (the star's radius; a world unit at the flame) and whether it is on,
    // and the kept rect, for the live frame and the kept one.
    uStar: { value: new Vector4(0, 0, 0, 0) },
    uStarPrev: { value: new Vector4(0, 0, 0, 0) },
    uFlame: { value: new Vector4(0, 0, 0, 0) },
    uFlamePrev: { value: new Vector4(0, 0, 0, 0) },
    uKeep: { value: new Vector4(2, 2, -1, -1) },
    uKeepPrev: { value: new Vector4(2, 2, -1, -1) },
    // Heat, aberration and flare on (1) or off, and the heat's octaves.
    uLens: { value: new Vector4(0, 0, 0, 1) },
    uLensTime: { value: 0 },
    // The text boxes the lens keeps off (index.js lends the ground's).
    slateText: { value: { x: 2, y: 2, z: -1, w: -1 } },
    slateAbout: { value: { x: 2, y: 2, z: -1, w: -1 } },
    slateAspect: { value: 1 },
  },
  vertexShader: PASS_VERTEX_SHADER,
  fragmentShader: `
uniform sampler2D tDiffuse;
uniform int uVignetteEnabled;
uniform float uVignetteStrength;
uniform int uGrainEnabled;
uniform float uGrainStrength;
uniform float uTextProtection;
uniform float uTextProtectionFrom;
uniform float uTextBottom;
uniform sampler2D tPrev;
uniform float uProgress;
uniform float uLayered;
uniform vec2 uStagger;
uniform vec2 uCodeTexel;
uniform float uPrevScale;
uniform vec2 uPrevOrigin;
uniform vec2 uCssTexel;
uniform float uBlur;
uniform float uBlurPrev;
uniform float uBars;
uniform float uGrainTime;
varying vec2 vUv;

// The lens's shallow focus: the sky and the ranges (film depth layers below
// the ground's) soften over a disc of radius CSS px. Only taps from the same
// layer or a farther one count, so the subject never bleeds into the sky.
vec4 lensBlur(sampler2D map, vec2 uv, float radius) {
  vec4 centre = texture2D(map, uv);
  if (radius <= 0.0) return centre;
  vec3 sum = centre.rgb;
  float weight = 1.0;
  for (int i = 1; i < 13; i++) {
    float r = sqrt(float(i) / 12.0) * radius, a = float(i) * 2.39996;
    vec4 tap = texture2D(map, uv + vec2(cos(a), sin(a)) * r * uCssTexel);
    float w = step(tap.a, centre.a + 0.1);
    sum += tap.rgb * w;
    weight += w;
  }
  // The ground and the subject stay sharp, their anti-aliased edges too: the
  // nearest layer over a 1px cross decides.
  float near = max(max(centre.a, texture2D(map, uv + vec2(uCssTexel.x, 0.0)).a), max(texture2D(map, uv - vec2(uCssTexel.x, 0.0)).a, max(texture2D(map, uv + vec2(0.0, uCssTexel.y)).a, texture2D(map, uv - vec2(0.0, uCssTexel.y)).a)));
  return vec4(mix(sum / weight, centre.rgb, step(0.5, near)), centre.a);
}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float layerCode(sampler2D map, vec2 uv) {
  vec2 x = vec2(uCodeTexel.x, 0.0), y = vec2(0.0, uCodeTexel.y);
  return max(max(texture2D(map, uv).a, max(texture2D(map, uv - x).a, texture2D(map, uv + x).a)),
    max(texture2D(map, uv - y).a, texture2D(map, uv + y).a));
}
${LENS_GLSL}
void main() {
  float guard = uLayered > 0.5 ? max(lensBehind(slateText, vUv, ${lensNumber(LENS_FX.text[0])}), lensBehind(slateAbout, vUv, ${lensNumber(LENS_FX.text[1])})) : 0.0;
  vec4 texel = uLayered > 0.5 ? lensView(tDiffuse, vUv, vUv, uBlur, uStar, uFlame, uKeep, guard) : texture2D(tDiffuse, vUv);
  // The kept frame pushes in about its origin: here it shows its own pixel prevUv,
  // so its lens (heat, fringes, kept rect and flare) is placed in its own UV and
  // stays on its own star and flame.
  vec2 prevUv = uPrevOrigin + (vUv - uPrevOrigin) * uPrevScale;
  float protection = uTextProtection, w = 1.0;
  if (uProgress < 1.0) {
    float start = 0.0, span = 1.0;
    if (uLayered > 0.5) {
      start = 3.0 * uStagger.x * clamp(max(layerCode(tPrev, prevUv), layerCode(tDiffuse, vUv)), 0.0, 1.0);
      span = uStagger.y;
    }
    w = smoothstep(start, start + span, uProgress);
    texel = mix(uLayered > 0.5 ? lensView(tPrev, prevUv, prevUv, uBlurPrev, uStarPrev, uFlamePrev, uKeepPrev, guard) : texture2D(tPrev, prevUv), texel, w);
    protection = mix(uTextProtectionFrom, uTextProtection, w);
  }
  vec3 color = texel.rgb;
  // The star's flare, dissolving with each frame's own.
  if (uLayered > 0.5 && uLens.z > 0.0) {
    vec3 flare = lensFlare(vUv, uStar, uKeep);
    if (uProgress < 1.0) flare = mix(lensFlare(prevUv, uStarPrev, uKeepPrev), flare, w);
    color += flare * (uLens.z * (1.0 - guard));
  }

  if (uVignetteEnabled == 1) {
    float dist = distance(vUv, vec2(0.5));
    float vignette = smoothstep(0.42, 1.0, dist);
    color *= 1.0 - uVignetteStrength * vignette;
  }

  if (uGrainEnabled == 1) {
    float grain = hash(floor(vUv * vec2(1280.0, 720.0)) + floor(fract(uGrainTime * vec2(0.618034, 0.414214)) * 97.0)) - 0.5;
    color += grain * uGrainStrength;
  }

  float textShade = smoothstep(1.0 - uTextBottom - .12, 1.0 - uTextBottom + .10, vUv.y);
  color *= 1.0 - .28 * protection * textShade;
  // Widescreen bars: uBars of the height at the top and the bottom.
  color = mix(color, vec3(.012, .014, .022), step(min(vUv.y, 1.0 - vUv.y), uBars));
  gl_FragColor = vec4(clamp(color, 0.0, 1.0), uLayered > 0.5 ? 1.0 : texel.a);
}
`,
};

// A source as the lens sees it, into out: its centre in the frame's UV (y up),
// radius world units as frame heights, and 1 while it lies in front of the lens.
const lensPoint = new Vector3();
export function lensSource(camera, position, radius = 1, out = [0, 0, 0, 0]) {
  lensPoint.copy(position).applyMatrix4(camera.matrixWorldInverse);
  const depth = -lensPoint.z;
  if (!(depth > 0)) {
    out[0] = out[1] = out[2] = out[3] = 0;
    return out;
  }
  lensPoint.applyMatrix4(camera.projectionMatrix);
  out[0] = (lensPoint.x + 1) / 2;
  out[1] = (lensPoint.y + 1) / 2;
  out[2] = (radius * camera.projectionMatrix.elements[5]) / depth / 2;
  out[3] = 1;
  return out;
}

function getSize(renderer) {
  if (renderer && typeof renderer.getSize === "function") {
    return renderer.getSize(new Vector2());
  }
  return new Vector2(1, 1);
}

// The composer's scene pass. With samples it draws into its own multisampled
// target, which Three resolves once per frame, and copies the result into the
// read buffer. Bloom and grading then draw their full-screen quads into
// single-sample buffers and pay no resolve of their own. Without samples, or as
// the final pass, it is a plain RenderPass.
class SceneRenderPass extends RenderPass {
  constructor(scene, camera) {
    super(scene, camera);
    this.samples = 0;
    this.sampledTarget = null;
    this.width = 1;
    this.height = 1;
    this.copyQuad = new FullScreenQuad(
      new ShaderMaterial({
        name: "BabelSceneCopy",
        uniforms: UniformsUtils.clone(CopyShader.uniforms),
        vertexShader: CopyShader.vertexShader,
        fragmentShader: CopyShader.fragmentShader,
        blending: NoBlending,
        depthTest: false,
        depthWrite: false,
      }),
    );
  }

  // Returns whether the count changed; a change replaces the target.
  setSamples(samples) {
    if (samples === this.samples) return false;
    this.samples = samples;
    this.sampledTarget?.dispose();
    this.sampledTarget =
      samples > 0
        ? new WebGLRenderTarget(this.width, this.height, { type: HalfFloatType, samples })
        : null;
    return true;
  }

  // Device pixels, from the composer.
  setSize(width, height) {
    this.width = width;
    this.height = height;
    this.sampledTarget?.setSize(width, height);
  }

  render(renderer, writeBuffer, readBuffer, deltaTime, maskActive) {
    const target = this.renderToScreen ? null : this.sampledTarget;
    if (!target) {
      super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
      return;
    }
    super.render(renderer, writeBuffer, target, deltaTime, maskActive);
    this.copyQuad.material.uniforms.tDiffuse.value = target.texture;
    renderer.setRenderTarget(readBuffer);
    this.copyQuad.render(renderer);
  }

  dispose() {
    this.sampledTarget?.dispose();
    this.sampledTarget = null;
    this.copyQuad.material.dispose();
    this.copyQuad.dispose();
  }
}

export function createPostprocessPipeline(renderer, scene, camera, qualityProfile, options = {}) {
  const composer = new EffectComposer(renderer);
  const renderPass = new SceneRenderPass(scene, camera);
  const size = getSize(renderer);
  const bloomPass = new UnrealBloomPass(size, 0.18, 0.45, 0.9);
  const gradingPass = new ShaderPass(GRADING_SHADER);
  const vignetteGrainPass = new ShaderPass(VIGNETTE_GRAIN_SHADER);
  // Bloom adds light, not depth: in film its composite keeps the layer codes.
  Object.assign(bloomPass.blendMaterial, {
    blendSrc: SrcAlphaFactor,
    blendDst: OneFactor,
    blendSrcAlpha: ZeroFactor,
    blendDstAlpha: OneFactor,
  });
  const matchMedia = options.matchMedia || globalThis.window?.matchMedia?.bind(globalThis.window);
  const onInvalidate = typeof options.onInvalidate === "function" ? options.onInvalidate : () => {};
  const transparencyQuery = matchMedia?.("(prefers-reduced-transparency: reduce)");

  // The composer sizes passes in device pixels. Bloom keeps the CSS-pixel
  // resolution it is tuned for: its blur radius is counted in its own texels.
  const setBloomSize = bloomPass.setSize.bind(bloomPass);
  bloomPass.setSize = (width, height) => {
    const ratio = renderer.getPixelRatio?.() || 1;
    setBloomSize(width / ratio, height / ratio);
  };

  composer.addPass(renderPass);
  composer.addPass(bloomPass);
  composer.addPass(gradingPass);
  composer.addPass(vignetteGrainPass);

  let reducedTransparency = Boolean(transparencyQuery?.matches);
  let film = false;

  // Tour crossfade: IDLE → ARMED (a capture is due) → CAPTURED (grading drew
  // the outgoing frame into prevTarget) → BLENDING (the cut) → IDLE.
  const IDLE = 0,
    ARMED = 1,
    CAPTURED = 2,
    BLENDING = 3;
  const finalUniforms = vignetteGrainPass.uniforms;
  const toUv = (offset) => Math.min(1, Math.max(0, (1 - offset) / 2));
  let phase = IDLE,
    capturing = false,
    compiled = false,
    prevTarget = null,
    protectionFrom = 0,
    protectionTarget = 0,
    cssWidth = 0,
    cssHeight = 0;

  // The capture adds no draw: on the capture frame grading writes straight
  // into the kept target and the final pass reads it from there, so the
  // composer's ping-pong is untouched. The kept frame pushes in about the
  // outgoing camera's off-axis principal point, the shot's anchor in the safe area.
  const renderGrading = gradingPass.render.bind(gradingPass);
  gradingPass.render = (passRenderer, writeBuffer, readBuffer, deltaTime, maskActive) => {
    capturing = phase === ARMED && !gradingPass.renderToScreen;
    if (capturing) {
      const { width, height } = writeBuffer;
      if (!prevTarget) {
        prevTarget = new WebGLRenderTarget(width, height, { depthBuffer: false });
        finalUniforms.tPrev.value = prevTarget.texture;
      } else if (prevTarget.width !== width || prevTarget.height !== height) {
        prevTarget.setSize(width, height);
      }
      const elements = camera?.projectionMatrix?.elements;
      finalUniforms.uPrevOrigin.value.set(
        elements ? toUv(elements[8]) : 0.5,
        elements ? toUv(elements[9]) : 0.5,
      );
      finalUniforms.uCodeTexel.value.set(1 / width, 1 / height);
      // The kept frame keeps its lens: the outgoing star, flame and kept rect.
      finalUniforms.uStarPrev.value.copy(finalUniforms.uStar.value);
      finalUniforms.uFlamePrev.value.copy(finalUniforms.uFlame.value);
      finalUniforms.uKeepPrev.value.copy(finalUniforms.uKeep.value);
      protectionFrom = finalUniforms.uTextProtection.value;
      phase = CAPTURED;
    }
    renderGrading(
      passRenderer,
      capturing ? prevTarget : writeBuffer,
      readBuffer,
      deltaTime,
      maskActive,
    );
  };
  const renderFinal = vignetteGrainPass.render.bind(vignetteGrainPass);
  vignetteGrainPass.render = (passRenderer, writeBuffer, readBuffer, deltaTime, maskActive) => {
    renderFinal(
      passRenderer,
      writeBuffer,
      capturing ? prevTarget : readBuffer,
      deltaTime,
      maskActive,
    );
    capturing = false;
  };

  // The phone text band follows each pixel's dissolve instead of switching at
  // the cut: the final pass mixes from the kept frame's band to the live one.
  function syncProtection() {
    finalUniforms.uTextProtection.value = film ? protectionTarget : 0;
    finalUniforms.uTextProtectionFrom.value = film ? protectionFrom : 0;
  }

  // A CSS resize or a lost context ends a crossfade on its incoming shot.
  function cancelTransition() {
    if (phase === IDLE) return;
    phase = IDLE;
    finalUniforms.uProgress.value = 1;
    syncProtection();
    applyProfile(currentProfile);
  }

  function applyProfile(profile = {}) {
    const baseline = profile.postprocessSettings || {};
    const settings = film
      ? {
          ...baseline,
          bloomStrength: 0.2,
          contrast: 1.06,
          grainStrength: 0.008,
          highlightWarmMix: 0.12,
          shadowCoolMix: 0.16,
          vignetteStrength: 0.12,
        }
      : baseline;
    const gradingEnabled = profile.postprocessGrading !== false;
    const bloomEnabled = profile.postprocessBloom === true;
    const vignetteEnabled = profile.postprocessVignette === true && !reducedTransparency;
    const grainEnabled = profile.postprocessGrain === true;

    bloomPass.enabled = bloomEnabled;
    bloomPass.strength = settings.bloomStrength ?? 0.18;
    bloomPass.blendMaterial.blending = film ? CustomBlending : AdditiveBlending;
    gradingPass.enabled = gradingEnabled;
    gradingPass.uniforms.uCelMix.value = settings.celMix ?? 0.24;
    gradingPass.uniforms.uInkMix.value = 0.14;
    gradingPass.uniforms.uContrast.value = settings.contrast ?? 1.06;
    gradingPass.uniforms.uHighlightWarmMix.value = settings.highlightWarmMix ?? 0.14;
    gradingPass.uniforms.uShadowCoolMix.value = settings.shadowCoolMix ?? 0.25;
    gradingPass.uniforms.uLayerRelief.value = film ? 1 : 0;
    // In film the final pass always draws: it staggers the dissolve and writes
    // opaque alpha, so layer codes never reach the transparent canvas.
    vignetteGrainPass.enabled = film || vignetteEnabled || grainEnabled || phase !== IDLE;
    finalUniforms.uLayered.value = film ? 1 : 0;
    vignetteGrainPass.uniforms.uVignetteEnabled.value = vignetteEnabled ? 1 : 0;
    vignetteGrainPass.uniforms.uVignetteStrength.value = settings.vignetteStrength ?? 0.08;
    vignetteGrainPass.uniforms.uGrainEnabled.value = grainEnabled ? 1 : 0;
    vignetteGrainPass.uniforms.uGrainStrength.value = settings.grainStrength ?? 0.022;
    finalUniforms.uLens.value.set(
      film && LENS_FX.heat.on ? 1 : 0,
      film && LENS_FX.aberration.on ? 1 : 0,
      film && LENS_FX.flare.on ? 1 : 0,
      LENS_FX.heat.octaves[profile.tier] ?? LENS_FX.heat.octaves.high,
    );
  }

  function onTransparencyChange(event) {
    const nextReducedTransparency = Boolean(event?.matches);
    if (nextReducedTransparency === reducedTransparency) return;
    reducedTransparency = nextReducedTransparency;
    applyProfile(currentProfile);
    onInvalidate();
  }

  // The scene draws off-screen, so the renderer's own antialias would reach
  // only the final quad. High multisamples the scene pass's target instead;
  // half-float multisample storage needs WebGL2 with EXT_color_buffer_float.
  function applySamples(profile) {
    const capabilities = renderer.capabilities;
    const supported =
      capabilities?.isWebGL2 === true && renderer.extensions?.has?.("EXT_color_buffer_float");
    const requested = supported ? Math.max(0, Math.floor(profile.postprocessSamples) || 0) : 0;
    const samples = Math.min(requested, capabilities?.maxSamples ?? requested);
    if (!renderPass.setSamples(samples)) return;
    // With its own target the scene leaves only full-screen passes in the
    // ping-pong targets, which need no depth. Three allocates GPU storage on
    // first use; disposal forces a rebuild.
    for (const target of [composer.renderTarget1, composer.renderTarget2]) {
      target.depthBuffer = samples === 0;
      target.dispose();
    }
  }

  let currentProfile = qualityProfile || {};
  applyProfile(currentProfile);
  applySamples(currentProfile);

  // width and height are CSS pixels. The composer's targets follow device
  // pixels, but the ink contour keeps sampling one CSS pixel apart, the offset
  // it is tuned for. The kept frame is sampled by UV, so only a CSS size
  // change, not a pixel ratio or quality step, ends a crossfade.
  function resize(width, height) {
    if (width !== cssWidth || height !== cssHeight) cancelTransition();
    cssWidth = width;
    cssHeight = height;
    gradingPass.uniforms.uTexelSize.value.set(1 / Math.max(1, width), 1 / Math.max(1, height));
    finalUniforms.uCssTexel.value.set(1 / Math.max(1, width), 1 / Math.max(1, height));
  }

  resize(size.width, size.height);

  transparencyQuery?.addEventListener?.("change", onTransparencyChange);

  return {
    composer,
    passes: {
      bloom: bloomPass,
      grading: gradingPass,
      render: renderPass,
      vignetteGrain: vignetteGrainPass,
    },
    dispose() {
      transparencyQuery?.removeEventListener?.("change", onTransparencyChange);
      for (const pass of composer.passes) {
        if (typeof pass.dispose === "function") pass.dispose();
      }
      if (typeof composer.dispose === "function") composer.dispose();
      prevTarget?.dispose();
      prevTarget = null;
    },
    // A lost context takes its programs with it: the next warm-up links the
    // crossfade's programs again instead of the first dissolve after recovery.
    invalidatePrograms() {
      compiled = false;
    },
    // Links the crossfade's programs once, from the shader warm-up. Keys
    // differ by output colour space, so grading compiles against an off-screen
    // target and the final pass against the canvas, as a low-tier cut draws them.
    compile() {
      if (compiled || typeof renderer.compile !== "function") return;
      compiled = true;
      const previous = renderer.getRenderTarget?.() ?? null;
      try {
        renderer.setRenderTarget(composer.readBuffer);
        renderer.compile(gradingPass.fsQuad._mesh, camera);
        renderer.setRenderTarget(null);
        renderer.compile(vignetteGrainPass.fsQuad._mesh, camera);
      } catch {
        compiled = false;
      } finally {
        renderer.setRenderTarget(previous);
      }
    },
    cancelTransition,
    setFilmTreatment(active) {
      film = Boolean(active);
      if (!film) protectionTarget = 0;
      syncProtection();
      applyProfile(currentProfile);
    },
    // Takes the tour's { capture, cut, progress, zoom } once per frame, before
    // the draw. The capture frame keeps grading's output; from the cut the
    // final pass mixes it out along a smoothstep, staggered by depth layer in
    // film. A capture that never drew, or any settled frame, leaves a hard cut;
    // a capture mid-blend is ignored.
    setTransition(transition = null) {
      const value = transition?.progress;
      const progress = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 1));
      const zoom = Math.min(0.02, Math.max(0, Number(transition?.zoom) || 0));
      const wasIdle = phase === IDLE;
      if (transition?.capture === true) {
        // The kept frame dissolves with the outgoing shot's focus.
        if (phase !== BLENDING) {
          phase = ARMED;
          finalUniforms.uBlurPrev.value = finalUniforms.uBlur.value;
        }
      } else if (progress >= 1 || phase === ARMED) {
        phase = IDLE;
      } else if (phase === CAPTURED) {
        phase = BLENDING;
      }
      finalUniforms.uProgress.value = phase === BLENDING ? progress : 1;
      finalUniforms.uPrevScale.value = 1 / (1 + zoom * progress);
      syncProtection();
      if (wasIdle !== (phase === IDLE)) applyProfile(currentProfile);
    },
    // The shot's lens: background blur in CSS px, set with the shot (on a cut).
    setLens(lens = null) {
      const blur = lens?.blur ?? 0;
      finalUniforms.uBlur.value = film ? blur : 0;
    },
    // Widescreen bars as a share of the height at each edge.
    setBars(share = 0) {
      finalUniforms.uBars.value = Math.max(0, share);
    },
    // The grain's frame, 24 a second; held while the scene holds still.
    setFilmTime(seconds = 0) {
      finalUniforms.uGrainTime.value = Math.floor(seconds * 24) % 997;
      // The heat flows on the same clock, smoothly, wrapping each hour.
      finalUniforms.uLensTime.value = seconds % 3600;
    },
    // The lens's sources this frame (lensSource()): the star and the flame as
    // [x, y, size, on], or null for none, and the rect it keeps whole as the
    // frame's [x0, y0, x1, y1] from its top-left corner (LENS_FX.keep), or null.
    setLensSources({ star = null, flame = null, keep = null } = {}) {
      const source = (uniform, value) =>
        value
          ? uniform.value.set(value[0], value[1], value[2], value[3])
          : uniform.value.set(0, 0, 0, 0);
      source(finalUniforms.uStar, star);
      source(finalUniforms.uFlame, flame);
      if (keep) finalUniforms.uKeep.value.set(keep[0], 1 - keep[3], keep[2], 1 - keep[1]);
      else finalUniforms.uKeep.value.set(2, 2, -1, -1);
    },
    // Lends the text boxes (mud-ground.js createSlateContacts()) the lens keeps off.
    setTextGuard(contacts = {}) {
      for (const name of ["slateText", "slateAbout", "slateAspect"])
        if (contacts[name]) finalUniforms[name] = contacts[name];
    },
    setTextProtection(active, bottom = 0.25) {
      protectionTarget = film && active ? 1 : 0;
      syncProtection();
      vignetteGrainPass.uniforms.uTextBottom.value = bottom;
    },
    setQualityProfile(profile = {}) {
      currentProfile = profile;
      applyProfile(currentProfile);
      applySamples(currentProfile);
    },
    resize,
  };
}
