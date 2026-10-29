import {
  AdditiveBlending,
  CustomBlending,
  Group,
  HalfFloatType,
  Mesh,
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
import { FILM_TONE, FILM_TONE_GLSL, FILM_TONE_UNIFORM, filmExposure } from "./film-light.js";
import { SOLAR_AUREOLE_GLSL, SOLAR_LOOK } from "./solar-body.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { FullScreenQuad } from "three/examples/jsm/postprocessing/Pass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { CopyShader } from "three/examples/jsm/shaders/CopyShader.js";
import { compilePrograms } from "./shader-programs.js";

const PASS_VERTEX_SHADER = `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// The motion-picture film look (the owner's ask of 2026-10-14, "lean in slightly further to
// go for a motion picture film look"), in film only; each part switches off with its `on`.
// - `halation`: the warm glow film stock bleeds about bright lights (the star, the
//   lantern's flame): the bloom's own light (its composite, already drawn on high; no pass
//   of its own) added again in `color` times `strength`, only as far as that light is
//   warm: its red's lead over its blue, as a share of its red, eases in across `warm`, so
//   cool moon glints and moonlit bark keep their colour (the review of 2026-10-14). None
//   where bloom is off (balanced).
// - `print`: a print film's toe, the blacks lifted `lift` toward `tint` (cool, milky)
//   below `toe` graded luma, and the grade's split tone a little stronger in film
//   (`cool` shadows, `warm` highlights).
// - `grain`: `strength` at mid-grey, weighted toward the midtones (`floor` of it in the
//   deep shade and the highlights), in cells `cell` CSS px across, each channel `chroma`
//   apart; at 24 frames a second and held with the scene.
// - `weave`: the frame drifts up to `amount` CSS px on a slow wander, stepped at 24 frames
//   a second, as film running through a gate; the bars, the text band and the page's
//   text stay put, and it holds whenever the grain does.
export const FILM_LOOK = Object.freeze({
  halation: Object.freeze({
    on: 1,
    strength: 0.8,
    color: Object.freeze([1, 0.32, 0.12]),
    warm: Object.freeze([0.1, 0.35]),
  }),
  print: Object.freeze({
    on: 1,
    lift: 0.022,
    toe: 0.12,
    tint: Object.freeze([0.8, 0.92, 1.2]),
    cool: 0.2,
    warm: 0.15,
  }),
  grain: Object.freeze({ on: 1, strength: 0.03, floor: 0.25, cell: 1.5, chroma: 0.35 }),
  weave: Object.freeze({ on: 1, amount: 0.35 }),
});

// The live cloud plate keeps continuous shade and soft edges. The baseline's ink
// remains available outside film; the film sky takes none of its contour treatment.
export const SKY_INK = Object.freeze({
  mix: 0,
  vary: 0.5,
  scale: 9,
});

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
    // The film look (FILM_LOOK): the bloom's composite and its halation tint (0: none),
    // the print toe (lift, toe) and its tint, and the ink's brush weight (vary, scale).
    tHalation: { value: null },
    uHalation: { value: new Vector3() },
    uPrint: { value: new Vector2(0, 0.12) },
    uPrintTint: { value: new Vector3(1, 1, 1) },
    uInkVary: { value: new Vector2(0, 9) },
  },
  vertexShader: PASS_VERTEX_SHADER,
  fragmentShader: /* glsl */ `
uniform sampler2D tDiffuse;
uniform sampler2D tHalation;
uniform vec3 uHalation;
uniform vec2 uPrint;
uniform vec3 uPrintTint;
uniform vec2 uInkVary;
uniform float uCelMix;
uniform float uInkMix;
uniform float uContrast;
uniform float uHighlightWarmMix;
uniform float uShadowCoolMix;
uniform vec2 uTexelSize;
uniform float uLayerRelief;
varying vec2 vUv;
${FILM_TONE_GLSL}

float inkHash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
float inkNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(inkHash(i), inkHash(i + vec2(1.0, 0.0)), f.x), mix(inkHash(i + vec2(0.0, 1.0)), inkHash(i + vec2(1.0, 1.0)), f.x), f.y);
}

vec3 saturateColor(vec3 color, float amount) {
  float luma = dot(color, vec3(0.299, 0.587, 0.114));
  return mix(vec3(luma), color, amount);
}

void main() {
  vec4 texel = texture2D(tDiffuse, vUv);
  float scene = uLayerRelief * uTone.w * smoothstep(0.17, 0.25, texel.a);
  vec3 color = mix(texel.rgb, filmTone(texel.rgb), scene);
  float luma = dot(color, vec3(0.299, 0.587, 0.114));

  color = (color - 0.5) * uContrast + 0.5;

  vec3 shadowLift = vec3(0.045, 0.055, 0.09);
  vec3 coolShadow = color * vec3(0.88, 0.94, 1.09);
  vec3 warmMidtone = color * vec3(1.025, 1.012, 0.965);
  vec3 parchmentHighlight = color * vec3(1.055, 1.025, 0.94);

  float shadowMix = 1.0 - smoothstep(0.08, 0.32, luma);
  float midMix = smoothstep(0.22, 0.46, luma) * (1.0 - smoothstep(0.62, 0.82, luma));
  float highlightMix = smoothstep(0.72, 0.97, luma);

  color = mix(color, max(coolShadow, shadowLift * (1.0 - scene)), uShadowCoolMix * shadowMix);
  color = mix(color, warmMidtone, 0.3 * midMix);
  color = mix(color, parchmentHighlight, uHighlightWarmMix * highlightMix);

  float gradedLuma = max(0.02, dot(color, vec3(0.299, 0.587, 0.114)));
  float tonalBand = floor(gradedLuma * 5.0 + 0.5) / 5.0;
  vec3 celColor = color * (tonalBand / gradedLuma);
  float groundLayer = uLayerRelief * (1.0 - smoothstep(0.04, 0.12, abs(texel.a - 0.6667)));
  float starLayer = uLayerRelief * smoothstep(0.0005, 0.006, texel.a) * (1.0 - smoothstep(0.22, 0.28, texel.a));
  float skyLayer = 1.0 - smoothstep(0.0, 0.3, texel.a);
  float celWeight = mix(1.0, skyLayer, uLayerRelief);
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
  float skyInk = mix(1.0, (1.0 - smoothstep(0.0, 0.006, texel.a)) * (1.0 - step(0.006, nearest)), uLayerRelief);
  float inkWeight = 1.0 + uInkVary.x * (2.0 * inkNoise(vUv * vec2(uTexelSize.y / uTexelSize.x, 1.0) * uInkVary.y) - 1.0);
  color = mix(color, vec3(0.035, 0.055, 0.095), clamp(inkContour * uInkMix * skyInk * inkWeight, 0.0, 1.0));
  }
  vec3 halo = texture2D(tHalation, vUv).rgb;
  color += halo * uHalation * smoothstep(${FILM_LOOK.halation.warm[0].toFixed(3)}, ${FILM_LOOK.halation.warm[1].toFixed(3)}, (halo.r - halo.b) / max(halo.r, 1e-4));
  color += uPrintTint * uPrint.x * (1.0 - smoothstep(0.0, uPrint.y, dot(color, vec3(0.299, 0.587, 0.114))));
  vec3 over = max(color - 0.75, 0.0);
  color = mix(color, min(color, 0.75) + 0.25 * (1.0 - exp(-over / 0.25)), uLayerRelief * (1.0 - scene));

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

// The dissolve as a wash of paint: within its layer's window each pixel takes its turn
// from a soft field of long patches laid along a brush's direction (`angle` degrees;
// `stretch`: the patches' frequency [along, across] the screen's height, a finer
// `detail` share at `fine` times it), with a slight `sweep` across the frame, so the
// incoming shot bleeds in through brush-like strokes rather than evenly; a pixel
// turns over `edge` of the window, softly. Every turn ends by the window's end, so the
// sky still settles within its layer's window. Only bare sky in both frames takes
// these strokes; mountains, ground and subjects dissolve evenly. `on`: 0 dissolves
// every layer evenly.
export const DISSOLVE_BRUSH = Object.freeze({
  on: 1,
  angle: -12,
  stretch: Object.freeze([2.5, 12]),
  detail: 0.35,
  fine: 2.6,
  sweep: 0.25,
  edge: 0.4,
});

// The dissolve's mask, softened (the review of 2026-10-14: each cut first showed the
// incoming subject as a hard-edged cut-out of the outgoing frame): each frame's layer
// code is averaged over a disc `radius` of the frame's height across (`taps` taps about
// the cross's maximum at its centre), so a silhouette turns over that width rather than
// at one pixel. The incoming subject washes in on one long weight, from the sky's start to
// the end (`wash` [from, full], its share of the disc's taps): twigs and the gaps between
// them, a lattice's braces and the sky among them come in together and softly, never as a
// stencil of the outgoing frame or shards of it (the re-checks of 2026-10-15). `foot` [full,
// gone] (the star's disc radii, from the lens's source): where its frame shows sky, the
// outgoing star (disc and glow) fades whole over `fade` of the progress into that frame's
// own sky about it (`ring` radii out, along its ray), and the place then dissolves as sky,
// a little after; nothing of the incoming shot shows early through it. The incoming star
// turns as one when the outgoing frame's nearest layer over its disc turns. `on`: 0 keeps the hard mask.
export const DISSOLVE_SOFT = Object.freeze({
  on: 1,
  radius: 0.03,
  taps: 12,
  wash: Object.freeze([0.15, 0.6]),
  foot: Object.freeze([2, 3]),
  ring: 3.3,
  fade: 0.15,
});

// The shallow focus softens ground nearer the lens than its focus by at most
// this many radii of its blur, unless the shot's lens sets its own (`near`).
export const LENS_NEAR = 1.5;

// The text's knee (golden hour, 2026-10-27): behind the name and intro, out to `reach` of the
// screen's smaller side, the finished frame's light (linear luminance) passes `knee` softly
// toward `cap`, so no sunlit sky, cloud, ground or water behind them reads brighter than the
// light text keeps 5:1 over (#f7f1ea, about 0.89: 0.138 at most). Darker frames pass unchanged.
export const TEXT_KNEE = Object.freeze({ knee: 0.12, cap: 0.138, reach: 0.14 });
// The lens (the owner's pick of the Eye breakdown, 2026-10-09), all of it in the
// final pass, in film only; each part switches off with its `on`.
export const LENS_FX = Object.freeze({
  // Heat shimmer: the frame's UV drifts on flowing noise in a plume above the
  // lantern's flame in the shots that look at it (`flameShots`; `plume` world
  // units tall, `width` wide at the flame). `amount` is the drift (world units),
  // `scale` the noise's frequency (per unit), `rise` its upward flow a second and
  // `boil` its churn; `octaves` per tier. (The star has none: a clipped disc shows none.)
  heat: Object.freeze({
    on: 1,
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
  // apart across the star's edge: a film lens (the owner's ask of
  // 2026-10-13, "more lens artifacts"), stronger about the star.
  aberration: Object.freeze({ on: 1, edge: 1.2, star: 1 }),
  // The star through the lens (the owner's pick of 2026-10-25, "As a camera sees it", with the
  // ghosts of "the lens flare that's in C", the brightest of the three tried, at twice their
  // strength, "make the lens glare a bit stronger", and no rays: "just a tight ball of
  // brightness"), only while the star is in frame: the aureole's far part, past where the star
  // draws it (solar-body.js SOLAR_LOOK, from its `near` on), over the clouds' cel step; and
  // ghosts along the line from the star through the frame's centre, shaped as the aperture (six
  // blades turned `angle` radians) and a little brighter at the rim: [t along it (1 at the
  // centre), radius in frame heights, r, g, b, strength]. Its light adds as light does to film,
  // never past white.
  flare: Object.freeze({
    on: 1,
    angle: 0.3,
    ghosts: Object.freeze([
      Object.freeze([0.4, 0.03, 1, 0.72, 0.42, 0.14]),
      Object.freeze([0.8, 0.05, 0.5, 0.85, 1, 0.08]),
      Object.freeze([1.45, 0.022, 0.7, 1, 0.7, 0.12]),
      Object.freeze([2.2, 0.09, 0.85, 0.55, 1, 0.06]),
    ]),
  }),
  // None of it reaches the text: it eases out over `text[0]` of the screen's
  // smaller side about the name and intro, and `text[1]` about Contact.
  text: Object.freeze([0.1, 0.05]),
  // Nor do the heat and the fringes reach The watch's reference banks (STYLE.md, Sky) on
  // desktop landscape frames: the frame's share [x0, y0, x1, y1] from its top-left corner, kept
  // whole, with the lens easing in over `keepSoft` frame heights beyond it. The flare's light
  // crosses them (the owner's call of 2026-10-25, "Ghosts on desktops too"). Looking up toward
  // the star from the east, The watch sees them across the lower middle of the frame, behind
  // the name (0.09-0.76 of the width, from 0.37 of the height down, at 1440x800
  // to 2560x1080); the star stands to their right.
  keep: Object.freeze({ "The watch": Object.freeze([0.08, 0.36, 0.78, 1]) }),
  keepSoft: 0.03,
  // A kept rect ends this many of the star's radii short of it (lensKeepRect()), so the star
  // beside it keeps its whole fringe.
  keepStar: 3,
});

const lensNumber = (value) => (Number.isInteger(value) ? value.toFixed(1) : String(value));
const lensVec3 = (values) => `vec3(${values.map(lensNumber).join(", ")})`;
const LENS_FLAME = LENS_FX.heat.flame,
  LENS_FLARE = LENS_FX.flare;
// The aperture's turn: its blades' (the ghosts' shape).
const lensTurn = (x, y) =>
  `vec2(${lensNumber(Math.cos(LENS_FLARE.angle))} * ${x} + ${lensNumber(Math.sin(LENS_FLARE.angle))} * ${y}, ${lensNumber(Math.cos(LENS_FLARE.angle))} * ${y} - ${lensNumber(Math.sin(LENS_FLARE.angle))} * ${x})`;
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
// The heat's drift at v in UV: a plume above the flame flowing up.
vec2 lensHeat(vec2 v, vec4 flame) {
  vec2 aspect = lensAspect(), o = vec2(0.0);
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
// the fringe, from the frame's centre and across the star's edge.
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
vec4 lensView(sampler2D map, vec2 uv, vec2 v, float blur, float nearCap, vec3 ground, vec4 star, vec4 flame, vec4 keep, float guard) {
  // No early return: the focus's taps stay in uniform control flow.
  float open = (1.0 - guard) * (1.0 - lensKeep(keep, v, 0.0));
  vec2 q = uv;
  if (uLens.x > 0.0 && open > 0.0) q += lensHeat(v, flame) * (uLens.x * open);
  vec4 texel = lensBlur(map, q, blur, nearCap, ground);
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
${
  LENS_FLARE.on
    ? `${SOLAR_AUREOLE_GLSL}
// The star through the lens at v (LENS_FX.flare), easing in over the frame's edge with it: the
// aureole past the star's own and the ghosts.
vec3 lensFlare(vec2 v, vec4 star) {
  vec2 aspect = lensAspect();
  float inside = min(min(star.x, 1.0 - star.x) * aspect.x, min(star.y - uBars, 1.0 - uBars - star.y));
  float shown = star.w * smoothstep(-star.z, 2.0 * star.z, inside);
  if (shown <= 0.0) return vec3(0.0);
  float r = length((v - star.xy) * aspect) / star.z, h = max(r - 1.0, 0.0);
  vec3 c = solarAureole(h) * smoothstep(${lensNumber(SOLAR_LOOK.near[0])}, ${lensNumber(SOLAR_LOOK.near[1])}, r);
  // The ghosts: the aperture's shape, a little brighter at its rim.
${LENS_FLARE.ghosts.length ? "  vec2 g, e;\n" : ""}${LENS_FLARE.ghosts
        .map(
          ([
            t,
            size,
            red,
            green,
            blue,
            strength,
          ]) => `  g = star.xy + (0.5 - star.xy) * ${lensNumber(t)};
  e = (v - g) * aspect / ${lensNumber(size)};
  e = ${lensTurn("e.x", "e.y")};
  e.x = max(abs(e.x), max(abs(0.5 * e.x + 0.866 * e.y), abs(0.5 * e.x - 0.866 * e.y)));
  c += ${lensVec3([red, green, blue])} * (${lensNumber(strength)} * (1.0 - smoothstep(0.75, 1.0, e.x)) * (0.55 + 0.45 * smoothstep(0.35, 0.95, e.x)));`,
        )
        .join("\n")}
  return c * shown;
}
`
    : ""
}`;

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
    // How far the ground nearer the lens than the focus softens, at most, in
    // radii (the shot's lens.near, LENS_NEAR without one), live and kept.
    uBlurNear: { value: LENS_NEAR },
    uBlurNearPrev: { value: LENS_NEAR },
    // The focus over the plain's depth, affine in UV (setLens()), live and kept.
    uGround: { value: new Vector3() },
    uGroundPrev: { value: new Vector3() },
    uBars: { value: 0 },
    uGrainTime: { value: 0 },
    // The gate weave (FILM_LOOK.weave): the frame's offset in UV.
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
  fragmentShader: /* glsl */ `
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
uniform float uBlurNear;
uniform float uBlurNearPrev;
uniform vec3 uGround;
uniform vec3 uGroundPrev;
uniform float uBars;
uniform float uGrainTime;
varying vec2 vUv;

// The lens's shallow focus: the sky and the ranges (film depth layers below
// the ground's) soften over a disc of radius CSS px; the ground as a thin lens
// sees it, by how far it lies from the focus along this pixel's ray (ground:
// the focus's distance over the plain's depth there, affine in uv), at most
// nearCap radii nearer the lens (the shot's lens.near); the subject never. Only taps from the same layer
// or a farther one count, so the subject never bleeds into the sky.
// Composer and kept-frame textures have no mipmaps. Explicit level zero keeps
// their filtering unchanged and permits the per-pixel sharp-subject shortcut
// without implicit derivatives inside divergent control flow (ANGLE/D3D11).
vec4 lensSample(sampler2D map, vec2 uv) {
#ifdef LENS_LOD0
  return texture2DLodEXT(map, uv, 0.0);
#else
  return texture2D(map, uv);
#endif
}
vec4 lensBlur(sampler2D map, vec2 uv, float radius, float nearCap, vec3 ground) {
  vec4 centre = lensSample(map, uv);
  if (radius <= 0.0) return centre;
  if (centre.a > 0.5) {
    float depth = max(dot(ground, vec3(uv, 1.0)), 0.0);
    radius *= (depth > 1.0 ? min(depth - 1.0, nearCap) : 1.0 - depth) * step(centre.a, 0.8);
    // The subject (and ground at the focus) is sharp: every tap would read the centre.
#ifdef LENS_LOD0
    if (radius <= 0.0) return centre;
#endif
  }
  vec3 sum = centre.rgb;
  float weight = 1.0;
  for (int i = 1; i < 13; i++) {
    float r = sqrt(float(i) / 12.0) * radius, a = float(i) * 2.39996;
    vec4 tap = lensSample(map, uv + vec2(cos(a), sin(a)) * r * uCssTexel);
    float w = step(tap.a, centre.a + 0.1);
    sum += tap.rgb * w;
    weight += w;
  }
  // The subject stays sharp, its anti-aliased edges too: the nearest layer
  // over a 1px cross decides.
  float near = max(max(centre.a, lensSample(map, uv + vec2(uCssTexel.x, 0.0)).a), max(lensSample(map, uv - vec2(uCssTexel.x, 0.0)).a, max(lensSample(map, uv + vec2(0.0, uCssTexel.y)).a, lensSample(map, uv - vec2(0.0, uCssTexel.y)).a)));
  return vec4(mix(sum / weight, centre.rgb, step(0.8, near)), centre.a);
}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

${
  DISSOLVE_BRUSH.on
    ? `float brushNoise(vec2 x) {
  vec2 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float brushTurn(vec2 uv) {
  float aspect = uCodeTexel.y / uCodeTexel.x, c = cos(${lensNumber((DISSOLVE_BRUSH.angle * Math.PI) / 180)}), s = sin(${lensNumber((DISSOLVE_BRUSH.angle * Math.PI) / 180)});
  vec2 p = vec2(uv.x * aspect, uv.y), q = vec2(c * p.x + s * p.y, c * p.y - s * p.x);
  vec2 k = vec2(${lensNumber(DISSOLVE_BRUSH.stretch[0])}, ${lensNumber(DISSOLVE_BRUSH.stretch[1])});
  float wash = mix(brushNoise(q * k), brushNoise(q * k * ${lensNumber(DISSOLVE_BRUSH.fine)} + 17.0), ${lensNumber(DISSOLVE_BRUSH.detail)});
  return clamp((1.0 - ${lensNumber(DISSOLVE_BRUSH.sweep)}) * smoothstep(0.2, 0.8, wash) + ${lensNumber(DISSOLVE_BRUSH.sweep)} * clamp(p.x / aspect, 0.0, 1.0), 0.0, 1.0);
}
`
    : ""
}
float layerCode(sampler2D map, vec2 uv) {
  vec2 x = vec2(uCodeTexel.x, 0.0), y = vec2(0.0, uCodeTexel.y);
  return max(max(texture2D(map, uv).a, max(texture2D(map, uv - x).a, texture2D(map, uv + x).a)),
    max(texture2D(map, uv - y).a, texture2D(map, uv + y).a));
}
${
  DISSOLVE_SOFT.on
    ? `float softCode(sampler2D map, vec2 uv, float own, out float subject) {
  float aspect = uCodeTexel.y / uCodeTexel.x, sum = own;
  subject = step(0.9, own);
  for (int i = 1; i <= ${DISSOLVE_SOFT.taps}; i++) {
    float r = sqrt(float(i) / ${lensNumber(DISSOLVE_SOFT.taps)}) * ${lensNumber(DISSOLVE_SOFT.radius)}, a = float(i) * 2.39996;
    float code = texture2D(map, uv + vec2(cos(a) / aspect, sin(a)) * r).a;
    sum += code;
    subject += step(0.9, code);
  }
  subject /= ${lensNumber(DISSOLVE_SOFT.taps + 1)};
  return sum / ${lensNumber(DISSOLVE_SOFT.taps + 1)};
}
`
    : ""
}${LENS_GLSL}${
    DISSOLVE_SOFT.foot
      ? `
// A star's one turn: the other frame's nearest layer over the disc (its centre c and four
// points a radius r out, in that frame's UV) decides when it turns, over the layer's window.
float starTurn(sampler2D other, vec2 c, float r, vec2 aspect) {
  vec2 dx = vec2(r / aspect.x, 0.0), dy = vec2(0.0, r);
  float code = max(texture2D(other, c).a, max(max(texture2D(other, c + dx).a, texture2D(other, c - dx).a), max(texture2D(other, c + dy).a, texture2D(other, c - dy).a)));
  float start = 3.0 * uStagger.x * clamp(code, 0.0, 1.0);
  return smoothstep(start, start + uStagger.y, uProgress);
}
// The outgoing frame's own sky about its star (centre c, radius r, in its UV), for the
// place at uv: eight taps on a ring (DISSOLVE_SOFT.ring radii out), each weighted by how near it lies
// to the place's own ray from the centre (evenly at the centre), and only those that read
// sky (no star, subject or edge of the frame); none, and the place keeps its own colour.
vec3 starSky(vec2 uv, vec2 c, float r, vec2 aspect, vec3 own) {
  vec2 d = (uv - c) * aspect;
  float l = length(d), even = 1.0 - smoothstep(0.0, 1.5 * r, l);
  vec2 ray = l > 1e-5 ? d / l : vec2(1.0, 0.0);
  vec3 sum = vec3(0.0);
  float weight = 0.0;
  for (int i = 0; i < 8; i++) {
    float a = float(i) * 0.785398;
    vec2 dir = vec2(cos(a), sin(a)), p = c + dir * r * ${lensNumber(DISSOLVE_SOFT.ring)} / aspect;
    vec4 tap = texture2D(tPrev, p);
    float along = dot(dir, ray), near = mix(exp(4.0 * (along - 1.0)), 1.0, even);
    float k = near * (1.0 - smoothstep(0.02, 0.05, tap.a)) * step(0.0, p.x) * step(p.x, 1.0) * step(0.0, p.y) * step(p.y, 1.0);
    sum += tap.rgb * k;
    weight += k;
  }
  return weight > 1e-4 ? sum / weight : own;
}
`
      : ""
  }
void main() {
  float guard = uLayered > 0.5 ? max(lensBehind(slateText, vUv, ${lensNumber(LENS_FX.text[0])}), lensBehind(slateAbout, vUv, ${lensNumber(LENS_FX.text[1])})) : 0.0;
  vec4 texel = uLayered > 0.5 ? lensView(tDiffuse, vUv, vUv, uBlur, uBlurNear, uGround, uStar, uFlame, uKeep, guard) : texture2D(tDiffuse, vUv);
  // The kept frame pushes in about its origin: here it shows its own pixel prevUv,
  // so its lens (heat, fringes and kept rect) is placed in its own UV and
  // stays on its own star and flame.
  vec2 prevUv = uPrevOrigin + (vUv - uPrevOrigin) * uPrevScale;
  float protection = uTextProtection, w = 1.0, turnPrev = 1.0, turnNow = 1.0;
  if (uProgress < 1.0) {
    float start = 0.0, span = 1.0, subPrev = 0.0, subNow = 0.0;
    if (uLayered > 0.5) {
      // The outgoing frame never holds a place past its own layer: the sky beside a subject
      // turns as sky (no rim of old cloud along it), and the subject leaves from its edges in.
      float nearPrev = layerCode(tPrev, prevUv), nearNow = layerCode(tDiffuse, vUv);
      float codePrev = ${DISSOLVE_SOFT.on ? "min(softCode(tPrev, prevUv, nearPrev, subPrev), nearPrev)" : "nearPrev"}, codeNow = ${DISSOLVE_SOFT.on ? "softCode(tDiffuse, vUv, nearNow, subNow)" : "nearNow"};
      start = 3.0 * uStagger.x * clamp(max(codePrev, codeNow), 0.0, 1.0);
      span = uStagger.y;${
        DISSOLVE_BRUSH.on
          ? /* glsl */ `
      // The sky's wash; a nearer layer in either frame keeps an even dissolve.
      float brush = 1.0 - smoothstep(0.0, 0.006, max(nearPrev, nearNow));
      start += span * (1.0 - ${lensNumber(DISSOLVE_BRUSH.edge)}) * brushTurn(vUv) * brush;
      span *= mix(1.0, ${lensNumber(DISSOLVE_BRUSH.edge)}, brush);`
          : ""
      }
    }
    w = smoothstep(start, start + span, uProgress);
    vec4 prevTexel = uLayered > 0.5 ? lensView(tPrev, prevUv, prevUv, uBlurPrev, uBlurNearPrev, uGroundPrev, uStarPrev, uFlamePrev, uKeepPrev, guard) : texture2D(tPrev, prevUv);${
      DISSOLVE_SOFT.on
        ? /* glsl */ `
    // The incoming subject washes in on one long weight, its gaps with it (DISSOLVE_SOFT.wash).
    if (uLayered > 0.5) w = mix(w, smoothstep(0.0, 1.0, uProgress), smoothstep(${lensNumber(DISSOLVE_SOFT.wash[0])}, ${lensNumber(DISSOLVE_SOFT.wash[1])}, subNow));`
        : ""
    }${
      DISSOLVE_SOFT.foot
        ? `
    if (uLayered > 0.5) {
      // Each frame's star (DISSOLVE_SOFT.foot), where that frame shows sky, fades whole. The
      // outgoing one fades into its own frame's sky about it (starSky), and the place then turns
      // as sky, DISSOLVE_SOFT.fade later; the incoming one comes when the outgoing frame's nearest layer over
      // its disc turns (starTurn), so it never shows through that layer early.
      vec2 aspect = lensAspect();
      if (uStarPrev.w > 0.0) {
        float foot = (1.0 - smoothstep(${lensNumber(DISSOLVE_SOFT.foot[0])}, ${lensNumber(DISSOLVE_SOFT.foot[1])}, length((prevUv - uStarPrev.xy) * aspect) / uStarPrev.z)) * (1.0 - smoothstep(0.25, 0.3, texture2D(tPrev, prevUv).a));
        turnPrev = smoothstep(0.0, ${lensNumber(DISSOLVE_SOFT.fade)}, uProgress);
        if (foot > 0.0) {
          prevTexel.rgb = mix(prevTexel.rgb, starSky(prevUv, uStarPrev.xy, uStarPrev.z, aspect, prevTexel.rgb), foot * turnPrev);
          float late = min(start + ${lensNumber(DISSOLVE_SOFT.fade)}, 1.0 - span);
          w = mix(w, min(w, smoothstep(late, late + span, uProgress)), foot);
        }
      }
      if (uStar.w > 0.0) {
        float foot = (1.0 - smoothstep(${lensNumber(DISSOLVE_SOFT.foot[0])}, ${lensNumber(DISSOLVE_SOFT.foot[1])}, length((vUv - uStar.xy) * aspect) / uStar.z)) * (1.0 - smoothstep(0.25, 0.3, texture2D(tDiffuse, vUv).a));
        turnNow = starTurn(tPrev, uPrevOrigin + (uStar.xy - uPrevOrigin) * uPrevScale, uStar.z * uPrevScale, aspect);
        w = mix(w, turnNow, foot);
      }
    }`
        : ""
    }
    texel = mix(prevTexel, texel, w);
    protection = mix(uTextProtectionFrom, uTextProtection, w);
  }
  vec3 color = texel.rgb;${
    LENS_FLARE.on
      ? `
  // The star through the lens, going with each frame's own star's turn (starTurn), off the text.
  if (uLayered > 0.5 && uLens.z > 0.0) {
    vec3 flare = lensFlare(vUv, uStar);
    if (uProgress < 1.0) flare = lensFlare(prevUv, uStarPrev) * (1.0 - turnPrev) + flare * turnNow;
    color = 1.0 - (1.0 - color) * exp(-flare * (1.0 - guard));
  }`
      : ""
  }

  if (uVignetteEnabled == 1) {
    float dist = distance(vUv, vec2(0.5));
    float vignette = smoothstep(0.42, 1.0, dist);
    color *= 1.0 - uVignetteStrength * vignette;
  }

  if (uGrainEnabled == 1) {
    if (uLayered > 0.5) {
      // Film grain (FILM_LOOK.grain): fine cells, each channel a little apart, strongest in the midtones.
      vec2 g = floor(vUv / (uCssTexel * ${lensNumber(FILM_LOOK.grain.cell)})) + floor(fract(uGrainTime * vec2(0.618034, 0.414214)) * 97.0);
      vec3 grain = vec3(hash(g) - 0.5) + ${lensNumber(FILM_LOOK.grain.chroma)} * (vec3(hash(g + 17.0), hash(g + 31.0), hash(g + 47.0)) - 0.5);
      float gl = clamp(dot(color, vec3(0.299, 0.587, 0.114)), 0.0, 1.0);
      color += grain * uGrainStrength * mix(${lensNumber(FILM_LOOK.grain.floor)}, 1.0, 4.0 * gl * (1.0 - gl));
    } else {
      float grain = hash(floor(vUv * vec2(1280.0, 720.0)) + floor(fract(uGrainTime * vec2(0.618034, 0.414214)) * 97.0)) - 0.5;
      color += grain * uGrainStrength;
    }
  }

  if (uLayered > 0.5) {
    // The text's knee (TEXT_KNEE), on the frame as shown.
    float behind = lensBehind(slateText, vUv, ${lensNumber(TEXT_KNEE.reach)});
    if (behind > 0.0) {
      float L = dot(pow(max(color, 0.0), vec3(2.2)), vec3(.2126, .7152, .0722));
      float k = ${lensNumber(TEXT_KNEE.knee)}, span = ${lensNumber(TEXT_KNEE.cap - TEXT_KNEE.knee)};
      float T = L < k ? L : k + span * (1.0 - exp(-(L - k) / span));
      color *= mix(1.0, pow(T / max(L, 1e-5), 1.0 / 2.2), behind);
    }
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

// The rect the lens keeps whole this frame (frame shares from the top-left corner), or null:
// a shot's LENS_FX.keep, its right edge ended short of the star (a lensSource()) by
// LENS_FX.keepStar of its radii when the star stands to the rect's right.
export function lensKeepRect(keep, star, aspect, out = [0, 0, 0, 0]) {
  if (!keep) return null;
  out[0] = keep[0];
  out[1] = keep[1];
  out[2] = keep[2];
  out[3] = keep[3];
  if (star?.[3] > 0 && star[0] > keep[0])
    out[2] = Math.max(keep[0], Math.min(keep[2], star[0] - (LENS_FX.keepStar * star[2]) / aspect));
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

// The scene light the tone curve shows at .9 (EOTF .787), over .9.
const BLOOM_LIT =
  ((FILM_TONE.mid * 0.787) / 0.213) ** (1 / FILM_TONE.contrast) / filmExposure() / 0.9;

export function createPostprocessPipeline(renderer, scene, camera, qualityProfile, options = {}) {
  const composer = new EffectComposer(renderer);
  const renderPass = new SceneRenderPass(scene, camera);
  const size = getSize(renderer);
  const bloomPass = new UnrealBloomPass(size, 0.18, 0.45, 0.9);
  // Bloom finds the bright lights: the lit layers' (codes from .2) scene light
  // against its threshold as the tone curve shows it (BLOOM_LIT: the scene light
  // shown at .9, over .9), so moonlit ground never glows; the painted sky's as shown.
  bloomPass.materialHighPassFilter.fragmentShader =
    bloomPass.materialHighPassFilter.fragmentShader.replace(
      "float v = dot( texel.xyz, luma );",
      `float v = dot( texel.xyz, luma ) / mix( 1.0, ${BLOOM_LIT.toFixed(3)}, smoothstep( 0.17, 0.25, texel.a ) );`,
    );
  const gradingPass = new ShaderPass(GRADING_SHADER);
  // ShaderPass clones its uniforms: the tone curve's is the shared one.
  gradingPass.uniforms.uTone = FILM_TONE_UNIFORM;
  const vignetteGrainPass = new ShaderPass(VIGNETTE_GRAIN_SHADER);
  // WebGL2 has explicit LOD; WebGL1 requests its optional equivalent. Without
  // that extension lensSample keeps the original full-loop sampling path.
  vignetteGrainPass.material.extensions.shaderTextureLOD = true;
  if (
    renderer.capabilities?.isWebGL2 === true ||
    renderer.extensions?.has?.("EXT_shader_texture_lod") === true
  )
    vignetteGrainPass.material.defines.LENS_LOD0 = 1;
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

  // Halation reads the bloom's composite, which it draws anyway on high (no pass of its own).
  gradingPass.uniforms.tHalation.value = bloomPass.renderTargetsHorizontal[0].texture;

  composer.addPass(renderPass);
  composer.addPass(bloomPass);
  composer.addPass(gradingPass);
  composer.addPass(vignetteGrainPass);

  let reducedTransparency = Boolean(transparencyQuery?.matches);
  let film = false;
  // The gate weave in CSS px, [right, up] (setFilmTime, weaveOffset()).
  const weave = [0, 0];

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
    disposed = false,
    compilePromise = null,
    compileGeneration = 0,
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
          grainStrength: FILM_LOOK.grain.on ? FILM_LOOK.grain.strength : 0.008,
          highlightWarmMix: FILM_LOOK.print.on ? FILM_LOOK.print.warm : 0.12,
          shadowCoolMix: FILM_LOOK.print.on ? FILM_LOOK.print.cool : 0.16,
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
    gradingPass.uniforms.uCelMix.value = film ? 0 : (settings.celMix ?? 0.24);
    gradingPass.uniforms.uInkMix.value = film ? SKY_INK.mix : 0.14;
    gradingPass.uniforms.uInkVary.value.set(film ? SKY_INK.vary : 0, SKY_INK.scale);
    // The film look: halation only where the bloom draws.
    const halation =
      film && bloomEnabled && FILM_LOOK.halation.on ? FILM_LOOK.halation.strength : 0;
    gradingPass.uniforms.uHalation.value.set(...FILM_LOOK.halation.color).multiplyScalar(halation);
    gradingPass.uniforms.uPrint.value.set(
      film && FILM_LOOK.print.on ? FILM_LOOK.print.lift : 0,
      FILM_LOOK.print.toe,
    );
    gradingPass.uniforms.uPrintTint.value.set(...FILM_LOOK.print.tint);
    if (!film) weave[0] = weave[1] = 0;
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
    // The colour fringe only on the high tier: phones and laptops keep grain and the
    // vignette alone (the owner's pick of 2026-10-28, "Grain only"), its two taps saved.
    finalUniforms.uLens.value.set(
      film && LENS_FX.heat.on ? 1 : 0,
      film && LENS_FX.aberration.on && profile.tier === "high" ? 1 : 0,
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
      if (disposed) return;
      disposed = true;
      compileGeneration += 1;
      compilePromise = Promise.resolve(false);
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
    invalidatePrograms({ contextLost = false } = {}) {
      if (disposed) return;
      compileGeneration += 1;
      compilePromise = null;
      if (contextLost)
        for (const target of new Set([
          composer.renderTarget1,
          composer.renderTarget2,
          prevTarget,
          renderPass.sampledTarget,
          bloomPass.renderTargetBright,
          ...bloomPass.renderTargetsHorizontal,
          ...bloomPass.renderTargetsVertical,
        ]))
          target?.dispose();
    },
    // Prepare every compositor program, including the high tier's bloom and
    // scene-copy variants, without drawing or waiting on a first-use link.
    // Grading also draws to the canvas when it is the last enabled pass.
    // Keep each target's captured program keys through its bounded link poll.
    compile() {
      if (compilePromise) return compilePromise;
      const generation = compileGeneration;
      const valid = () => generation === compileGeneration;
      if (typeof renderer.compile !== "function") return Promise.resolve(false);
      const geometry = gradingPass.fsQuad._mesh.geometry;
      const group = (materials) => {
        const objects = new Group();
        for (const material of materials) objects.add(new Mesh(geometry, material));
        return objects;
      };
      const offscreen = group([
        renderPass.copyQuad.material,
        bloomPass.materialHighPassFilter,
        ...bloomPass.separableBlurMaterials,
        bloomPass.compositeMaterial,
        bloomPass.blendMaterial,
        gradingPass.material,
      ]);
      const screen = group([gradingPass.material, vignetteGrainPass.material]);
      const prepareTarget = (objects, target) => {
        const previous = renderer.getRenderTarget?.() ?? null;
        try {
          renderer.setRenderTarget(target);
          return compilePrograms(renderer, objects, camera, null, valid);
        } finally {
          renderer.setRenderTarget(previous);
        }
      };
      // These light-free fullscreen materials have no transient scene keys.
      // Yield before their compilation so scene uploads and material capture
      // retain their synchronous flags without sharing one long setup task.
      compilePromise = new Promise((resolve) => setTimeout(resolve, 0))
        .then(() => valid() && prepareTarget(offscreen, composer.readBuffer))
        .then((ready) => {
          if (!ready || !valid()) return false;
          return prepareTarget(screen, null);
        })
        .catch(() => false)
        .then((ready) => {
          // A link still running past its poll is asked about again, never remembered
          // as failed: the opening retries its warm-up (scene/index.js). A failed one
          // stays coalesced until context recovery.
          const linking = renderer.info?.programs?.some(
            (program) => program?.isReady?.() === false,
          );
          if (!ready && linking && valid()) compilePromise = null;
          return ready;
        });
      return compilePromise;
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
          finalUniforms.uBlurNearPrev.value = finalUniforms.uBlurNear.value;
          finalUniforms.uGroundPrev.value.copy(finalUniforms.uGround.value);
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
    // The shot's lens: background blur in CSS px, set with the shot (on a cut), and
    // its focus on the camera's subject at `focus`: the plain (a level plane at
    // `ground`) lies out of focus by its depth along each ray, whose inverse is
    // affine in the frame's UV (uGround: that times the focus's distance).
    setLens(lens = null, camera = null, focus = null, ground = 0) {
      const blur = film ? (lens?.blur ?? 0) : 0,
        g = finalUniforms.uGround.value.set(0, 0, 0);
      finalUniforms.uBlur.value = blur;
      finalUniforms.uBlurNear.value = lens?.near ?? LENS_NEAR;
      if (blur && camera && focus) {
        const m = camera.matrixWorld.elements,
          p = camera.projectionMatrix.elements,
          f =
            ((focus.x - m[12]) * m[8] + (focus.y - m[13]) * m[9] + (focus.z - m[14]) * m[10]) /
            (m[13] - ground),
          a = m[1] / p[0],
          b = m[5] / p[5];
        g.set(2 * a * f, 2 * b * f, ((p[8] - 1) * a + (p[9] - 1) * b - m[9]) * f);
      }
    },
    // Widescreen bars as a share of the height at each edge.
    setBars(share = 0) {
      finalUniforms.uBars.value = Math.max(0, share);
    },
    // The grain's frame, 24 a second; held while the scene holds still.
    setFilmTime(seconds = 0) {
      finalUniforms.uGrainTime.value = Math.floor(seconds * 24) % 997;
      // The gate's slow wander (FILM_LOOK.weave), stepped at 24 frames a second, in CSS px
      // (x right, y up); the scene moves its lens by it (weaveOffset()).
      const frame = Math.floor(seconds * 24) / 24,
        reach = film && FILM_LOOK.weave.on ? FILM_LOOK.weave.amount : 0;
      weave[0] = (Math.sin(frame * 2.1) * 0.6 + Math.sin(frame * 5.3 + 1.7) * 0.4) * reach;
      weave[1] = (Math.sin(frame * 1.7 + 0.5) * 0.6 + Math.sin(frame * 4.1 + 2.3) * 0.4) * reach;
      // The heat flows on the same clock, smoothly, wrapping each hour.
      finalUniforms.uLensTime.value = seconds % 3600;
    },
    // The gate weave this frame in CSS px, [right, up]: [0, 0] out of film. The scene
    // offsets its camera's projection by it, so the whole frame and its lens move a fraction
    // of a pixel as rendered, and no pass resamples the finished frame (which would soften
    // and sharpen fine twigs in step with the wander).
    weaveOffset() {
      return weave;
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
