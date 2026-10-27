// The opening's doors drawn as real paper (WebGL2), over the stylesheet's paper
// (ui/scene-doors.js), which stays the doors at the first paint, on static paths and
// whenever this fails. It draws in a worker where the browser can hand the doors' canvas
// to one (src/doors-entry.js), and knows nothing of the page: its canvas, size, pixel
// ratio and animation frames are given.
//
// One sheet of washi torn down the middle (the owner's picks of 2026-10-25, torn, and of
// 2026-10-26, "Washi", when he asked for the paper to be less of a stained map or document
// and "more artistic and playful because it will open to such amazing graphics"), its halves
// grids in CSS px under a camera that frames their plane at 1:1. The paper is lit as paper:
// a warm lamp above the sheet's top and a dim moonlight across the tooth of a scanned sheet
// (images/paper, CC0 ambientCG Paper006: its height for the relief and the sheet's
// thickness, its colour for the specks). It is kozo washi in its own px: a thin, even
// mulberry sheet clouded at a few px, long fibres laid through it, curving and crossing,
// from wisps to strands and here and there gathered into soft bundles, and flecks of bark;
// the fibres read a shade whiter in the lamp. The scene's star stands behind it and its
// light comes through: an inverse-square falloff on the sheet and a wider glow scattered
// inside it, thinned where the fibres lie thick, so they stand out dark against it, and
// warmed through the paper's colour, with the film's red-orange halation about its heart;
// in a lantern opening the lantern's light, which flickers as a candle does. The tear is
// the stylesheet's tear, with a paler, thinner lip and a fringe of long, loose fibres
// pulled from it; the left half's lip lies a little proud and shades the right half's edge.
// Opening, each half is drawn aside on the stylesheet's timing, turning outward about its
// bottom corner: it lifts, its free edge bends and settles with the pull (damped springs
// on the half's acceleration), its edges and fibres blur with the motion, and the focus
// pulls past the paper to the scene.

// The tear's offsets from the window's centre, CSS px, top to bottom: the stylesheet's
// polygons are cut from the same 81 points (test/scene-doors.test.mjs holds them to it).
export const TEAR = [
  -16.4, -14.3, -13.5, -11.6, -13.4, -16, -15.3, -13.5, -12.7, -13.9, -15.2, -18.1, -19.6, -17.1,
  -18.4, -18.3, -17.5, -18.2, -15.8, -14.7, -15.3, -12.9, -13.4, -12.8, -9.8, -9.8, -10.9, -11.1,
  -13.2, -8.9, -8.6, -7.7, -9.8, -9.8, -10.6, -10, -9.1, -4.8, -5.8, -3.3, -1.7, 1.7, 3, 3.5, 3.6,
  5.8, 7.6, 13, 15.2, 15.9, 16.9, 16.6, 14.7, 14.8, 13.9, 13.3, 13.7, 14.4, 13, 14.3, 12.8, 11.8,
  9.5, 6.5, 4.4, 5.8, 4.1, 3.7, 8.2, 8.8, 6.2, 5.2, 5, 6, 5.6, 4.8, 5.3, 2.8, 3.9, 5.3, 7.3,
];

// The scan's tile, CSS px.
const TILE = 768;
// The sheet, in linear colour: its washi's albedo and the paler core its torn lip shows; a
// dim moonlight from the upper left and the night's ambient; the lamp (its colour, its
// place as fractions of the window's width and height and its height above the sheet as a
// fraction of the window's height, and its gain); the night behind the sheet; the star's
// clipped warm white and its strength, or in a lantern opening the lantern glass's deeper amber (the
// owner's pick of 2026-10-26, "Lantern glass") and its; the sheet's transmittance, its
// relief and long waves (px); how far its light falls away toward the window's edges, 0 to
// 1; and the exposure.
const PAPER = Object.freeze({
  albedo: [0.6, 0.56, 0.47],
  core: [0.78, 0.74, 0.66],
  moon: [0.14, 0.16, 0.22],
  moonDir: [-0.42, -0.62, 0.66],
  ambient: [0.03, 0.03, 0.04],
  lamp: [1, 0.8, 0.56],
  lampAt: [0.5, 0.16, 0.46, 0.48],
  sky: [0.01, 0.01, 0.016],
  star: [1, 0.88, 0.66],
  starGain: 7,
  lantern: [1, 0.5, 0.2],
  lanternGain: 4.5,
  thin: 0.5,
  relief: 0.5,
  cockle: 6,
  edge: 0.2,
  exposure: 0.85,
});
// A lantern's light flickers as the scene's candle does: redrawn this many times a second
// while it is lit behind the closed doors, few enough to leave the scene's preparation its
// pace (24 cost the lantern opening about 4% of its time to the reveal), enough for a
// flicker no quicker than candle() (below).
const FLICKER_FPS = 15;
// The opening, on the stylesheet's timing (styles.css .scene-doors): its length, how far
// each half travels (window widths), its outward turn (degrees), its lift toward the camera
// (px), the bend's gain on its acceleration, and how far the focus pulls past the paper
// (px). The stylesheet's cubic-bezier(0.65, 0, 0.35, 1).
export const OPENING = Object.freeze({
  duration: 1900,
  travel: 0.58,
  turn: 2.5,
  lift: 54,
  bend: 0.02,
  focus: 5,
});
export const EASE = Object.freeze([0.65, 0, 0.35, 1]);
const GRID = [28, 36];
const PAD = 72;

const glsl = (v) => `vec3(${v.map((n) => n.toFixed(4)).join(", ")})`;
const moonDir = PAPER.moonDir.map((v) => v / Math.hypot(...PAPER.moonDir));

const VERTEX = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec2 aGrid;
uniform vec2 uView;
uniform float uCamZ;
uniform vec4 uSpan;
uniform float uSide;
uniform vec3 uMove;
uniform vec2 uPivot;
uniform vec2 uBend;
out vec2 vPaper;
out vec3 vWorld;
out vec3 vNormal;

// A sheet is never flat: a few long, low waves, with their slope for the light.
float cockle(vec2 p, out vec2 g) {
  vec3 a = vec3(1.0 / 173.0, 1.0 / 241.0, 1.0 / 317.0);
  float s1 = sin(p.x * a.x + 1.3), c1 = cos(p.x * a.x + 1.3);
  float s2 = sin(p.y * a.y + 0.7), c2 = cos(p.y * a.y + 0.7);
  float s3 = sin((p.x + p.y) * a.z + 2.1), c3 = cos((p.x + p.y) * a.z + 2.1);
  float s4 = sin((p.x * 0.6 - p.y) * a.x + 4.0), c4 = cos((p.x * 0.6 - p.y) * a.x + 4.0);
  g = vec2(c1 * a.x * s2 * 1.6 + c3 * a.z * 1.1 + c4 * a.x * 0.6 * 0.7,
           s1 * c2 * a.y * 1.6 + c3 * a.z * 1.1 - c4 * a.x * 0.7) * ${PAPER.cockle.toFixed(1)};
  return (s1 * s2 * 1.6 + s3 * 1.1 + s4 * 0.7) * ${PAPER.cockle.toFixed(1)};
}

void main() {
  vec2 p = vec2(mix(uSpan.x, uSpan.y, aGrid.x), mix(uSpan.z, uSpan.w, aGrid.y));
  float half_ = uView.x * 0.5;
  // 0 at the held, outer edge; 1 at the free edge on the tear.
  float u = clamp(uSide < 0.0 ? p.x / half_ : (uView.x - p.x) / half_, 0.0, 1.3);
  float du = (uSide < 0.0 ? 1.0 : -1.0) / half_;
  float yc = p.y / uView.y - 0.5;
  vec2 g;
  float z = cockle(p, g);
  z += uBend.x * u * u + uBend.y * yc * u * u;
  g.x += (uBend.x + uBend.y * yc) * 2.0 * u * du;
  g.y += uBend.y * u * u / uView.y;
  vec3 n = normalize(vec3(-g, 1.0));
  // The turn about the pivot, then the slide and the lift.
  float ct = cos(uMove.z), st = sin(uMove.z);
  vec2 q = p - uPivot;
  vec3 w = vec3(uPivot + vec2(ct * q.x - st * q.y, st * q.x + ct * q.y), z);
  w.x += uMove.x;
  w.z += uMove.y;
  n.xy = vec2(ct * n.x - st * n.y, st * n.x + ct * n.y);
  vPaper = p;
  vWorld = w;
  vNormal = n;
  float d = uCamZ - w.z;
  vec2 ndc = vec2((w.x - half_) / half_, -(w.y - uView.y * 0.5) / (uView.y * 0.5)) * (uCamZ / d);
  gl_Position = vec4(ndc * d, 0.0, d);
}
`;

const FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
in vec2 vPaper;
in vec3 vWorld;
in vec3 vNormal;
uniform vec2 uView;
uniform float uCamZ;
uniform sampler2D uHeight;
uniform sampler2D uDetail;
uniform float uSide;
uniform float uTear[81];
uniform vec4 uStar;
uniform vec3 uStarLight;
uniform vec2 uHalo;
uniform float uGap;
uniform float uVel;
uniform float uDefocus;
uniform float uSeed;
out vec4 outColor;

const vec3 ALBEDO = ${glsl(PAPER.albedo)};
const vec3 CORE = ${glsl(PAPER.core)};
const vec3 MOON = ${glsl(PAPER.moon)};
const vec3 MOON_DIR = ${glsl(moonDir)};
const vec3 AMBIENT = ${glsl(PAPER.ambient)};
const vec3 SKY = ${glsl(PAPER.sky)};

float hash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 s = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), s.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), s.x), s.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * vnoise(p);
    p = mat2(1.6, 1.2, -1.2, 1.6) * p + 17.0;
    a *= 0.5;
  }
  return v / 0.9375;
}
vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}
vec3 encode(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

void main() {
  vec2 p = vPaper;
  // The tear: the stylesheet's points, with a fine jag of its own.
  float fy = clamp(p.y / uView.y, 0.0, 1.0) * 80.0;
  int i = int(min(floor(fy), 79.0));
  float edge = uView.x * 0.5 + mix(uTear[i], uTear[i + 1], fy - float(i))
    + (vnoise(vec2(p.y * 0.29, 7.0)) - 0.5) * 1.8 + (vnoise(vec2(p.y * 1.37, 3.0)) - 0.5) * 0.8;
  // Inside distance from the half's torn edge, px; the halves overlap by 1px. Edges soften
  // with the motion and with the focus pulling past the paper to the scene.
  float di = (uSide < 0.0 ? edge - p.x : p.x - edge) + 0.5;
  float aa = max(max(fwidth(di) * 0.75, abs(uVel) * 0.5), uDefocus);
  float body = smoothstep(-aa, aa, di);
  // Long, loose fibres pulled from the torn washi out to 12px past the edge, wisps across
  // it, gone in the motion and the defocus.
  float fringe = 0.0;
  if (di < 0.0) {
    float out_ = -di;
    float fib = vnoise(vec2(p.x * 0.16, p.y * 1.9)) * 0.6 + vnoise(vec2(p.x * 0.4, p.y * 4.3)) * 0.4;
    fringe = smoothstep(0.62, 0.8, fib - out_ * 0.022) * (1.0 - smoothstep(0.0, 12.0, out_));
    fringe *= 1.0 - smoothstep(0.0, 6.0, abs(uVel) + uDefocus);
  }
  float alpha = max(body, fringe * 0.7);
  if (alpha < 0.003) discard;

  // The lip: within a wandering width of the edge the sheet is thinner and paler. The
  // right half's edge lies in the left's shade while the halves meet.
  float lipWidth = 1.2 + 3.0 * vnoise(vec2(p.y * 0.06, 11.0));
  float lip = max(1.0 - smoothstep(0.0, lipWidth, max(di, 0.0)), step(di, 0.0) * fringe);
  // The thin sheet casts a soft shade.
  float crease = (uSide > 0.0 ? 1.0 - smoothstep(0.0, 7.0, di) : 0.0) * 0.2 * (1.0 - uGap);

  vec2 uv = p / ${TILE.toFixed(1)};
  vec2 gx = dFdx(uv) + vec2((abs(uVel) + uDefocus) / ${TILE.toFixed(1)}, 0.0);
  vec2 gy = dFdy(uv) + vec2(0.0, uDefocus / ${TILE.toFixed(1)});
  float texel = 1.0 / ${TILE.toFixed(1)};
  float h = textureGrad(uHeight, uv, gx, gy).r;
  float hx = textureGrad(uHeight, uv + vec2(texel, 0.0), gx, gy).r
    - textureGrad(uHeight, uv - vec2(texel, 0.0), gx, gy).r;
  float hy = textureGrad(uHeight, uv + vec2(0.0, texel), gx, gy).r
    - textureGrad(uHeight, uv - vec2(0.0, texel), gx, gy).r;
  float speck = textureGrad(uDetail, uv, gx, gy).r;
  vec3 n = normalize(vNormal + vec3(-hx, -hy, 0.0) * ${PAPER.relief.toFixed(2)});

  // Formation: a thin, even mulberry sheet clouded at a few px, with long kozo fibres laid
  // through it, curving and crossing, of every width from a wisp to a strand, here and there
  // gathered into soft bundles. Fibres and bundles are thickness: a shade whiter in the lamp,
  // and dark against the light behind. They soften as the focus pulls past the paper.
  float soft = smoothstep(0.0, 6.0, uDefocus);
  float cloud = mix(fbm(p / 26.0 + 2.0) * 0.6 + fbm(p / 75.0 + 8.0) * 0.4, 0.5, soft);
  float fibre = 0.0;
  for (int k = 0; k < 4; k++) {
    float fk = float(k);
    vec2 pw = p + 70.0 * (vec2(fbm(p / 340.0 + fk * 3.1), fbm(p / 340.0 + fk * 5.7)) - 0.5);
    float ang = 0.35 + 1.13 * fk + 0.5 * (vnoise(pw / 420.0 + fk) - 0.5);
    vec2 dir = vec2(cos(ang), sin(ang));
    vec2 q = vec2(dot(pw, dir), dot(pw, vec2(-dir.y, dir.x)));
    float width = mix(1.4, 4.2, vnoise(pw / 230.0 + fk * 7.0)) + uDefocus;
    // Each fibre's edge is antialiased by the noise's own change across the pixel.
    float strand = vnoise(vec2(q.x / 260.0, q.y / width) + fk * 17.0);
    float wisp = vnoise(vec2(q.x / 150.0, q.y / (1.6 + uDefocus)) + fk * 29.0);
    float as = fwidth(strand), aw = fwidth(wisp);
    fibre += smoothstep(0.83 - as, 0.93 + as, strand) * 0.95
      + smoothstep(0.89 - aw, 0.96 + aw, wisp) * 0.4 * (1.0 - soft);
  }
  fibre = min(fibre, 1.6);
  float bundle = smoothstep(0.5, 0.82, fbm(p / 150.0 + 6.0));
  float thick = (0.92 + 0.6 * fibre + 0.3 * bundle + 0.36 * (cloud - 0.5) + 0.35 * (h - 0.5))
    * (1.0 - 0.6 * lip);
  vec3 albedo = ALBEDO
    * (1.0 + 0.14 * fibre + 0.06 * bundle + 0.08 * (cloud - 0.5) + 0.15 * (speck - 0.5));
  // Chiri: flecks of bark caught in the sheet, from specks to slivers, dark and pale.
  vec2 bc = floor(p / 110.0);
  if (hash(bc + 9.1) > 0.8) {
    vec2 bp = (bc + vec2(hash(bc + 1.3), hash(bc + 2.9))) * 110.0;
    float ba = hash(bc + 4.4) * 6.283;
    vec2 bd = p - bp + 4.0 * (vec2(vnoise(p / 4.0), vnoise(p / 4.0 + 3.0)) - 0.5);
    bd = vec2(dot(bd, vec2(cos(ba), sin(ba))), dot(bd, vec2(-sin(ba), cos(ba))));
    float size = hash(bc + 7.0);
    vec2 axes = vec2(1.5 + 9.0 * size * size, 0.8 + 1.4 * hash(bc + 8.0));
    float bark = 1.0 - smoothstep(0.55, 1.25, length(bd / axes));
    vec3 tone = mix(vec3(0.5, 0.4, 0.3), vec3(0.82, 0.74, 0.6), step(0.7, hash(bc + 6.0)));
    albedo *= mix(vec3(1.0), tone, bark);
    thick += 0.8 * bark;
  }
  // The lamp's pool falls away toward the window's edges.
  float edgeDist = min(min(p.x, uView.x - p.x), min(p.y, uView.y - p.y));
  float worn = edgeDist + (fbm(p / 48.0 + 21.0) - 0.5) * 110.0;
  albedo *= 1.0 - ${PAPER.edge.toFixed(2)} * 0.7 * (1.0 - smoothstep(0.0, 240.0, worn));
  albedo = mix(albedo, CORE, lip * 0.75);

  vec3 view = normalize(vec3(uView * 0.5, uCamZ) - vWorld);
  vec3 color = albedo * (MOON * max(dot(n, MOON_DIR), 0.0) + AMBIENT * (0.55 + 0.45 * n.z));
  color += MOON * 0.03 * pow(max(dot(n, normalize(MOON_DIR + view)), 0.0), 16.0) * (1.0 - lip);
  // The lamp: a warm pool from above the sheet's top.
  vec3 lampAt = vec3(uView.x * ${PAPER.lampAt[0].toFixed(3)}, uView.y * ${PAPER.lampAt[1].toFixed(3)}, uView.y * ${PAPER.lampAt[2].toFixed(3)});
  vec3 l = lampAt - vWorld;
  float dl = length(l) / uView.y;
  vec3 ln = normalize(l);
  float fall = ${PAPER.lampAt[3].toFixed(3)} / (dl * dl + 0.05);
  color += albedo * ${glsl(PAPER.lamp)} * max(dot(n, ln), 0.0) * fall;
  color += ${glsl(PAPER.lamp)} * 0.045 * pow(max(dot(n, normalize(ln + view)), 0.0), 14.0) * fall * (1.0 - lip);
  color *= 1.0 - crease;

  // Through the sheet: the night, the star, and at the opening the scene beyond the gap.
  float through = ${PAPER.thin.toFixed(2)} * exp(-2.6 * (thick - 1.0));
  vec3 tint = sqrt(ALBEDO / max(max(ALBEDO.r, ALBEDO.g), ALBEDO.b));
  vec3 back = SKY;
  if (uStar.w > 0.0) {
    vec3 s = vec3(uStar.xy, -uStar.z) - vWorld;
    float falloff = pow(uStar.z / length(s), 3.0);
    float scatter = exp(-length(s.xy) / uHalo.x) * 0.1;
    back += uStarLight * (falloff + scatter);
    // The film's halation about the bright heart, red-orange and wide, as the scene's.
    color += uStarLight * ${PAPER.thin.toFixed(2)} * 0.07 * exp(-length(s.xy) / uHalo.y)
      * vec3(1.0, 0.32, 0.12);
  }
  back += uGap * lip * vec3(0.55, 0.56, 0.75);
  color += back * through * tint;

  color = encode(aces(color * ${PAPER.exposure.toFixed(2)}));
  // Film grain, as the scene's film carries, and a dither against banding.
  float grain = hash(gl_FragCoord.xy + uSeed) - 0.5;
  color += grain * (1.6 / 255.0 + 0.028 * color * (1.0 - color));
  outColor = vec4(color * alpha, alpha);
}
`;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`paper doors shader: ${log}`);
  }
  return shader;
}

function program(gl) {
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error(`paper doors program: ${gl.getProgramInfoLog(prog)}`);
  }
  return prog;
}

async function texture(gl, url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`paper doors texture ${url}: ${response.status}`);
  const bitmap = await createImageBitmap(await response.blob());
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
  bitmap.close?.();
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  const aniso = gl.getExtension("EXT_texture_filter_anisotropic");
  if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, 8);
  return tex;
}

// A candle's flicker at `t` seconds, about 1 and never past 1 ± 0.22: a slow sway in two
// beats and a quicker unrest of smooth noise, as a flame breathes in still air. The paper's
// lamp and the tone curve take most of it, so through the sheet it reads as a gentle
// breath of the glow.
export function candle(t) {
  const hash = (k) => {
    const v = Math.sin(k * 127.1 + 311.7) * 43758.5453;
    return v - Math.floor(v);
  };
  const noise = (x) => {
    const i = Math.floor(x),
      f = x - i,
      s = f * f * (3 - 2 * f);
    return 2 * (hash(i) + (hash(i + 1) - hash(i)) * s) - 1;
  };
  return (
    1 +
    0.075 * Math.sin(2 * Math.PI * 0.33 * t + 1.1) +
    0.065 * Math.sin(2 * Math.PI * 0.87 * t + 2.3) +
    0.055 * noise(t * 3.1) +
    0.025 * noise(t * 6.7 + 40)
  );
}

// cubic-bezier(x1, y1, x2, y2) at time x, solved for its parameter by Newton steps.
export function bezier([x1, y1, x2, y2], x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const at = (a, b, t) => 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3;
  const slope = (a, b, t) => 3 * a * (1 - t) ** 2 + 6 * (b - a) * t * (1 - t) + 3 * (1 - b) * t * t;
  let t = x;
  for (let i = 0; i < 8; i++) {
    const d = slope(x1, x2, t);
    if (Math.abs(d) < 1e-6) break;
    t -= (at(x1, x2, t) - x) / d;
    t = Math.min(1, Math.max(0, t));
  }
  return at(y1, y2, t);
}

// A damped spring toward a target, stepped in real time: a half's bend and twist.
function spring(frequency, damping) {
  const omega = 2 * Math.PI * frequency;
  let value = 0;
  let speed = 0;
  return {
    step(target, dt) {
      for (let left = dt; left > 0; left -= 1 / 240) {
        const h = Math.min(left, 1 / 240);
        speed += (-omega * omega * (value - target) - 2 * damping * omega * speed) * h;
        value += speed * h;
      }
      return value;
    },
    get value() {
      return value;
    },
  };
}

// Draws the doors on `canvas` (a page canvas, or an OffscreenCanvas in a worker): `size`
// in CSS px, `ratio` device px per CSS px, `frame` and `cancel` the context's animation
// frames. Resolves once the first frame is drawn, or null without WebGL2.
export async function createPaperDoors(
  canvas,
  { urls, size = [1, 1], ratio = 1, frame, cancel, onLost },
) {
  const gl = canvas.getContext("webgl2", {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    preserveDrawingBuffer: false,
  });
  if (!gl) return null;
  const prog = program(gl);
  const [height, detail] = await Promise.all([texture(gl, urls.height), texture(gl, urls.detail)]);

  const uniforms = {};
  const count = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < count; i++) {
    const name = gl.getActiveUniform(prog, i).name.replace(/\[0\]$/, "");
    uniforms[name] = gl.getUniformLocation(prog, name);
  }
  // One grid serves both halves.
  const [cols, rows] = GRID;
  const vertices = new Float32Array((cols + 1) * (rows + 1) * 2);
  for (let y = 0, k = 0; y <= rows; y++) {
    for (let x = 0; x <= cols; x++) {
      vertices[k++] = x / cols;
      vertices[k++] = y / rows;
    }
  }
  const indices = new Uint16Array(cols * rows * 6);
  for (let y = 0, k = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const a = y * (cols + 1) + x;
      indices.set([a, a + 1, a + cols + 1, a + 1, a + cols + 2, a + cols + 1], k);
      k += 6;
    }
  }
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

  gl.useProgram(prog);
  gl.uniform1i(uniforms.uHeight, 0);
  gl.uniform1i(uniforms.uDetail, 1);
  gl.uniform1fv(uniforms.uTear, TEAR);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

  let view = [1, 1];
  let scale = 1;
  let star = null;
  let warm = 0;
  let pending = 0;
  let opening = null;
  let lost = false;
  let disposed = false;
  let seed = 0;
  const halves = [
    { side: -1, bend: spring(1.9, 0.38), twist: spring(2.7, 0.3), x: 0, v: 0, lift: 0, turn: 0 },
    { side: 1, bend: spring(2.05, 0.36), twist: spring(2.9, 0.32), x: 0, v: 0, lift: 0, turn: 0 },
  ];

  function resize(next, nextRatio = scale) {
    view = [Math.max(1, next[0]), Math.max(1, next[1])];
    scale = nextRatio;
    canvas.width = Math.round(view[0] * scale);
    canvas.height = Math.round(view[1] * scale);
  }

  function draw() {
    pending = 0;
    if (lost || disposed) return;
    const [width, tall] = view;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(uniforms.uView, width, tall);
    gl.uniform1f(uniforms.uCamZ, tall / 2 / Math.tan((24 * Math.PI) / 360));
    // The grain holds still while the doors wait and runs with the film as they open.
    if (opening) seed = (seed + 37.17) % 1000;
    gl.uniform1f(uniforms.uSeed, seed);
    gl.uniform1f(uniforms.uDefocus, opening ? opening.defocus : 0);
    gl.uniform1f(uniforms.uGap, opening ? opening.gap : 0);
    if (star && warm > 0) {
      // The light's distance behind the sheet follows the star's size, within the frame's
      // measure; the glow scattered in the sheet and the film's halation follow the frame.
      const frameSize = Math.sqrt(width * tall);
      const depth = Math.min(Math.max(2.2 * star.radius, 0.035 * frameSize), 0.06 * frameSize);
      gl.uniform4f(uniforms.uStar, star.x, star.y, depth, 1);
      const flame = star.kind === "lantern" ? candle(performance.now() / 1000) : 1;
      gl.uniform2f(
        uniforms.uHalo,
        Math.min(1.3 * depth, 0.06 * frameSize) * (0.6 + 0.4 * flame),
        0.11 * frameSize,
      );
      // Ember to star: deep and dim at first, warm white and full at the reveal; a lantern's to its
      // glass's amber, flickering as a candle does.
      const lantern = star.kind === "lantern",
        tint = lantern ? PAPER.lantern : PAPER.star,
        heat = warm * warm * (lantern ? PAPER.lanternGain * flame : PAPER.starGain);
      gl.uniform3f(
        uniforms.uStarLight,
        tint[0] * heat,
        tint[1] * heat * (0.55 + 0.45 * warm),
        tint[2] * heat * (0.35 + 0.65 * warm),
      );
    } else {
      gl.uniform4f(uniforms.uStar, 0, 0, 1, 0);
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, height);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, detail);
    gl.bindVertexArray(vao);
    // Each half reaches 40px past the centre, over the tear's whole wander.
    const reach = 40;
    for (const half of halves) {
      const left = half.side < 0;
      gl.uniform1f(uniforms.uSide, half.side);
      gl.uniform4f(
        uniforms.uSpan,
        left ? -PAD : width / 2 - reach,
        left ? width / 2 + reach : width + PAD,
        -PAD,
        tall + PAD,
      );
      gl.uniform3f(uniforms.uMove, half.x, half.lift, half.turn);
      gl.uniform2f(uniforms.uPivot, left ? 0 : width, tall);
      gl.uniform2f(uniforms.uBend, half.bend.value, half.twist.value);
      gl.uniform1f(uniforms.uVel, half.v);
      gl.drawElements(gl.TRIANGLES, indices.length, gl.UNSIGNED_SHORT, 0);
    }
  }

  // While a lantern's light is lit behind the closed doors the sheet redraws FLICKER_FPS
  // times a second for its flicker; the opening draws every frame of its own.
  let flickering = 0;
  let flickered = 0;
  const flickers = () => !opening && !lost && !disposed && star?.kind === "lantern" && warm > 0;
  function flicker(now) {
    flickering = 0;
    if (!flickers()) return;
    if (now - flickered >= 1000 / FLICKER_FPS - 1) {
      flickered = now;
      draw();
    }
    flickering = frame(flicker);
  }

  function schedule() {
    if (!pending && !opening && !lost && !disposed) pending = frame(draw);
    if (!flickering && flickers()) flickering = frame(flicker);
  }

  const onLostContext = (event) => {
    event.preventDefault?.();
    lost = true;
    onLost?.();
  };
  canvas.addEventListener?.("webglcontextlost", onLostContext);
  resize(size, ratio);
  draw();
  if (gl.getError() !== gl.NO_ERROR) throw new Error("paper doors: the first frame failed");

  return {
    // The star's (or a lantern opening's flame's) place and warmth from the loading line
    // (ui/scene-doors.js light()).
    light(next) {
      const valid =
        next?.star && [next.star.x, next.star.y, next.star.radius].every(Number.isFinite);
      star = valid
        ? { x: next.star.x, y: next.star.y, radius: next.star.radius, kind: next.star.kind }
        : null;
      warm = valid ? Math.min(1, Math.max(0, Number(next.warm) || 0)) : 0;
      schedule();
    },
    resize(next, nextRatio) {
      resize(next, nextRatio);
      schedule();
    },
    // Draws the halves aside; resolves once they are off the window.
    open() {
      if (opening) return opening.done;
      if (pending) cancel(pending);
      if (flickering) cancel(flickering);
      pending = flickering = 0;
      const start = performance.now();
      const turn = (OPENING.turn * Math.PI) / 180;
      let last = start;
      let lastX = 0;
      let lastV = 0;
      opening = { gap: 0, defocus: 0 };
      opening.done = new Promise((resolve) => {
        const tick = (now) => {
          if (lost || disposed) return resolve();
          const dt = Math.min(0.05, Math.max(1e-3, (now - last) / 1000));
          last = now;
          const t = Math.max(0, (now - start) / OPENING.duration);
          const eased = bezier(EASE, t);
          const x = eased * OPENING.travel * view[0];
          const v = (x - lastX) / dt;
          const acc = (v - lastV) / dt;
          lastX = x;
          lastV = v;
          opening.gap = Math.min(1, eased * 3);
          // The focus pulls from the paper to the scene as the doors part.
          opening.defocus = OPENING.focus * (eased * eased * (3 - 2 * eased));
          for (const half of halves) {
            half.x = half.side * x;
            half.v = half.side * v * dt;
            half.lift = OPENING.lift * Math.sin(Math.PI * Math.min(1, eased * 1.4));
            half.turn = half.side * turn * eased;
            // The free edge trails the pull and lifts; the twist answers it a beat later.
            half.bend.step(Math.min(80, OPENING.bend * Math.abs(acc)) * Math.sign(acc || 1), dt);
            half.twist.step(half.bend.value * 0.45 * half.side, dt);
          }
          draw();
          if (t < 1) pending = frame(tick);
          else resolve();
        };
        pending = frame(tick);
      });
      return opening.done;
    },
    dispose() {
      disposed = true;
      if (pending) cancel(pending);
      if (flickering) cancel(flickering);
      canvas.removeEventListener?.("webglcontextlost", onLostContext);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
