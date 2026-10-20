import { Box3, BufferAttribute, BufferGeometry, Mesh, ShaderMaterial, Vector3 } from "three";
import {
  COAST_ALBEDO,
  COAST_DETAIL,
  createCoastAlbedo,
  createCoastDetail,
} from "./coast-detail.js";

// The sea beyond the fault. Only terrain-build.js imports this module, so it
// ships in the terrain's lazy chunk and lands with the film terrain
// (settleRoots()). Its optional data-map owner is lazy too; what it shares
// with the entry is restated here (test/ocean.test.mjs holds it equal) or lent in
// (createSea()'s and createCliff()'s `lib`).
//
// The owner's pick of 2026-10-17: "as if the earth violently broke open giving
// way to endless ocean". North-east of the estate the land ends at a fault, a
// broken line of tall cliffs above an open sea that runs to the horizon (the
// ranges that stood there sink into it, hill-silhouette.js SEA_SINK). The fault
// is one analytic signed distance, positive inland and about one unit per unit
// across it (coastDistance(), and seaCoast() in GLSL, written from the same
// terms): the terrain falls away past it (coastLand()), the cliff follows it
// (createCliff(), with the stacks off it), the sea's surf breaks at its foot
// (createSea()) and the river pours over it (riverFalls(), createFalls()).

const glsl = (value) => (Number.isInteger(value) ? value.toFixed(1) : String(+value.toFixed(5)));
const glslVec = (...values) => `vec${values.length}(${values.map(glsl).join(",")})`;
const RAD = Math.PI / 180;

// The fault: the sea lies past `offset` units out along `bearing` (atan2(z, x),
// degrees, as the estate's own), the line broken into headlands and bays by
// `waves` [wavelength along it, amount, phase] and torn by `breaks`
// [wavelength, depth, phase]: fractures that cut sharp V-shaped bays inland
// between headlands (|sin| cusps).
export const COAST = Object.freeze({
  bearing: 60,
  offset: 120,
  waves: Object.freeze([
    Object.freeze([131, 9, 0.6]),
    Object.freeze([59, 4.5, 2.1]),
    Object.freeze([26, 2.2, 0.9]),
    Object.freeze([10.5, 1, 1.7]),
  ]),
  breaks: Object.freeze([Object.freeze([97, 11, 1.3]), Object.freeze([41, 5, 0.2])]),
});
const [NX, NZ] = [Math.cos(COAST.bearing * RAD), Math.sin(COAST.bearing * RAD)];
const [TX, TZ] = [-NZ, NX];
// How sharply a fracture's slope turns through its cusp (its smooth sign's width, squared).
const CUSP = 0.01;
// The line's offset and its slope along the shore at s (the along-shore coordinate).
function wobble(s) {
  let w = 0,
    dw = 0;
  for (const [length, amount, phase] of COAST.waves) {
    const k = (2 * Math.PI) / length;
    w += amount * Math.sin(k * s + phase);
    dw += amount * k * Math.cos(k * s + phase);
  }
  // A fracture: the line pulled inland most at each cusp (the bay's apex). Its
  // slope turns through the cusp over a few units (a smooth sign, CUSP), so the
  // distance's normalisation, and the distance off the line, never jump there.
  for (const [length, depth, phase] of COAST.breaks) {
    const k = Math.PI / length,
      v = Math.sin(k * s + phase);
    w += depth * (Math.abs(v) - 0.637);
    dw += (depth * k * Math.cos(k * s + phase) * v) / Math.sqrt(v * v + CUSP);
  }
  return [w, dw];
}

// The signed distance from the fault at world x/z: positive inland, negative
// out at sea, about one unit per unit near it.
export function coastDistance(x, z) {
  const [w, dw] = wobble(x * TX + z * TZ);
  return (COAST.offset - (x * NX + z * NZ) + w) / Math.sqrt(1 + dw * dw);
}
// The same in GLSL: float seaCoast(vec2 p).
export function coastGlsl() {
  // Six decimals: the far ends of the line, 250 units along, keep their phase.
  const glsl = (value) => (Number.isInteger(value) ? value.toFixed(1) : String(+value.toFixed(6))),
    glslVec = (...values) => `vec${values.length}(${values.map(glsl).join(",")})`;
  let w = "0.",
    dw = "0.";
  for (const [length, amount, phase] of COAST.waves) {
    const k = (2 * Math.PI) / length;
    w += `+${glsl(amount)}*sin(${glsl(k)}*s+${glsl(phase)})`;
    dw += `+${glsl(amount * k)}*cos(${glsl(k)}*s+${glsl(phase)})`;
  }
  const breaks = COAST.breaks.map(
    ([length, , phase], i) => `v${i}=sin(${glsl(Math.PI / length)}*s+${glsl(phase)})`,
  );
  COAST.breaks.forEach(([length, depth, phase], i) => {
    const k = Math.PI / length;
    w += `+${glsl(depth)}*(abs(v${i})-.637)`;
    dw += `+${glsl(depth * k)}*cos(${glsl(k)}*s+${glsl(phase)})*v${i}*inversesqrt(v${i}*v${i}+${glsl(CUSP)})`;
  });
  return `float seaCoast(vec2 p){float s=dot(p,${glslVec(TX, TZ)}),${breaks.join(",")},w=${w},dw=${dw};return (${glsl(COAST.offset)}-dot(p,${glslVec(NX, NZ)})+w)/sqrt(1.+dw*dw);}`;
}
// The fault as a plane for the ranges (hill-silhouette.js SEA_SINK): the
// sea's direction and its mean offset.
export const coastPlane = () => [NX, NZ, COAST.offset];

// The land at the fault. Inland of `drop` the plain is as it was; past it the
// ground falls straight to `deep` (under the sea, out of sight behind the
// cliff). The cliff's rock shelf covers the plain's last `shelf` units, at
// least the drop and a coarse cell's diagonal (terrain-build.js: 3 units), so
// no triangle across the grid's step shows. Foothills fade out over `hills`
// inland of the shelf.
export const SHORE = Object.freeze({ drop: 3.5, deep: -24, hills: 30, shelf: 8 });
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
// The land's height at distance d from the fault, given its height h inland.
export const coastLand = (d, h) => (d >= SHORE.drop ? h : SHORE.deep);
// How much of the foothills stands at distance d from the fault.
export const landFactor = (d) => smooth(SHORE.shelf, SHORE.shelf + SHORE.hills, d);

// The sea. level: its height in the estate's frame (the plain stands at 1.25,
// so the cliffs rise about 13 above it). radius: the disc's rim about the lens
// (in front of the ranges' rows, whose depth is pushed to the back, out to
// about 348; the camera's far plane is 450); rings and segments: its mesh,
// spaced geometrically from `first`. swell: [wavelength, amount, heading
// (degrees)] of the long waves that heave the mesh. waves: [wavelength,
// amount, heading] of the surface's slopes (normals only); ripple: the fine
// ripples (smooth flow noise, seaFlowD): `octaves` of them from `length` down by
// `ratio` each (`balanced` of them on that tier), the first's slope `slope`, each
// finer one's falling by ratio^fall, so a fine ripple is never steeper than a
// coarse one; they drift about the wind (`drift`, units a second at `length`),
// turn in place (`turn`, finer faster) and ride the coarser ones' slopes
// (`ride`). Each fades where it would fall under three pixels, its slope
// turning to roughness (rough: a calm surface's own); the far water's
// roughness is theirs together. mirror: how far the ripples' spread softens
// the cliffs' image in the water. body: the deep water's albedo (the share of
// the light it takes that it scatters back up); turbid: the clouded water's by
// the rock, out to turbidReach. sky, f0, knee: the river's mirror (terrain-build.js
// PUDDLE_MIRROR, at half its gain: a whole open sea at the river's would
// outshine the sky it mirrors); horizon: how far its sky is lifted where it is
// read (the open sea's horizon has no ranges to mirror). mask: how far the
// slopes a pixel holds lean toward the eye where it grazes (in their spread).
// glitter: the moon's highlight: its gain, roughness floor and knee, and how
// far it widens where the surface's normal turns within a pixel (aa, at most
// aaMax of variance), so the ripples glint as fine sparkle, never flat tiles. surf:
// the white water at the cliffs' foot: how far out it reaches, its swells'
// spacing and speed shoreward, how much of the foot breaks at once (`cover`,
// in `cell`-unit patches), its albedo (moonlit white water) and its far
// mean. rim: past `from` of the radius the rim rises so any eye sees the sea
// out to `slope` below eye level (the open horizon). mist: how much of a
// shot's low mist (RANGE_MIST, laid on the plain and the ranges' feet) lies on
// the open sea far below them; mistPast: how far past the fault's mean line
// the drifting mist still gathers along a ray (to its headlands' tips; it lies
// on the land). margin: how far inland the sea still draws. text: how much of
// the foam keeps behind the text (as the stream's).
export const SEA = Object.freeze({
  level: -12,
  radius: 330,
  rings: 64,
  segments: 160,
  first: 1.5,
  swell: Object.freeze([Object.freeze([64, 0.3, 230]), Object.freeze([41, 0.18, 205])]),
  waves: Object.freeze([
    Object.freeze([23, 0.11, 228]),
    Object.freeze([13, 0.055, 252]),
    Object.freeze([7.5, 0.03, 160]),
  ]),
  ripple: Object.freeze({
    length: 3.2,
    ratio: 0.5,
    octaves: 5,
    balanced: 3,
    slope: 0.041,
    fall: 0.1,
    drift: 0.12,
    turn: 0.5,
    ride: 0.25,
  }),
  mirror: 0.5,
  rough: 0.05,
  body: Object.freeze([0.008, 0.012, 0.014]),
  turbid: Object.freeze([0.03, 0.045, 0.042]),
  turbidReach: Object.freeze([2, 16]),
  sky: 1.2,
  f0: 0.02,
  knee: 0.5,
  horizon: 0.08,
  mask: 0.8,
  glitter: Object.freeze({ gain: 0.75, alpha: 0.1, knee: 0.3, aa: 0.25, aaMax: 0.18 }),
  surf: Object.freeze({
    reach: 9,
    period: 9,
    speed: 3.6,
    cover: 0.55,
    cell: 14,
    albedo: 0.5,
    far: 0.45,
  }),
  rim: Object.freeze({ from: 0.55, slope: 0.0025 }),
  mist: 0.3,
  mistPast: 12,
  margin: 2,
  text: 0.9,
});

// Restated from the entry (ocean.test.mjs holds them equal): depth-layers.js
// DEPTH_LAYER.ground, and hill-silhouette.js HORIZON_AIR.edge over .ground less
// 1 (the far plain's air the walk's view from up high lifts the slate's far
// edge to).
export const SEA_SHARED = Object.freeze({ layer: "0.6667", edgeLift: 0.0857 });

// The lens-riding disc: a centre and `rings` rings of `segments` points.
export function seaGeometry(sea = SEA) {
  const { rings, segments, first, radius } = sea,
    q = (radius / first) ** (1 / (rings - 1));
  const positions = new Float32Array((1 + rings * segments) * 3);
  for (let ring = 0; ring < rings; ring++) {
    const r = first * q ** ring;
    for (let s = 0; s < segments; s++) {
      const a = (s / segments) * 2 * Math.PI,
        i = 1 + ring * segments + s;
      positions[i * 3] = r * Math.cos(a);
      positions[i * 3 + 2] = r * Math.sin(a);
    }
  }
  const indices = new Uint16Array((segments + (rings - 1) * segments * 2) * 3);
  let k = 0;
  for (let s = 0; s < segments; s++) {
    indices[k++] = 0;
    indices[k++] = 1 + ((s + 1) % segments);
    indices[k++] = 1 + s;
  }
  for (let ring = 0; ring < rings - 1; ring++)
    for (let s = 0; s < segments; s++) {
      const a = 1 + ring * segments + s,
        b = 1 + ring * segments + ((s + 1) % segments),
        c = a + segments,
        d = b + segments;
      indices[k++] = a;
      indices[k++] = b;
      indices[k++] = c;
      indices[k++] = b;
      indices[k++] = d;
      indices[k++] = c;
    }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setIndex(new BufferAttribute(indices, 1));
  return geometry;
}

// Waves as GLSL terms: unit heading, wavenumber and deep-water frequency (at
// the estate's scale, about 3.28 units a metre: g 32.2).
const waveTerms = (list) =>
  list.map(([length, amount, heading]) => ({
    k: (2 * Math.PI) / length,
    a: amount,
    d: [Math.cos(heading * RAD), Math.sin(heading * RAD)],
    w: Math.sqrt((32.2 * 2 * Math.PI) / length),
    length,
  }));

// Shared GLSL: the hash and value noise with derivatives; the environment
// (seaEnv(), its CubeUV radiance, or a plain night where there is none) and
// seaLight(), the scene's own lights as uniforms (lighting()).
const NOISE_GLSL = `float seaHash(vec2 p){vec3 q=fract(p.xyx*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
vec3 seaNoiseD(vec2 p){vec2 i=floor(p),f=fract(p),u=f*f*(3.-2.*f),du=6.*f*(1.-f);float a=seaHash(i),b=seaHash(i+vec2(1,0)),c=seaHash(i+vec2(0,1)),d=seaHash(i+1.),k=a-b-c+d;return vec3(a+(b-a)*u.x+(c-a)*u.y+k*u.x*u.y,du*(vec2(b-a,c-a)+k*u.yx));}
float seaNoise(vec2 p){return seaNoiseD(p).x;}
// White water's grain: two turned octaves, so up close it never shows the noise's square cells.
float seaFoam(vec2 p){return .6*seaNoise(mat2(.8,.6,-.6,.8)*p)+.4*seaNoise(mat2(.28,-.96,.96,.28)*p*2.13+5.2);}
// Cells (x: the distance between the nearest two centres' borders), their rows
// repeating every n (so the cells close round a circle with no seam).
float seaCells(vec2 p,float n){vec2 i=floor(p),f=fract(p);float d1=8.,d2=8.;for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){vec2 o=vec2(x,y),k=vec2(i.x+o.x,mod(i.y+o.y,n)),e=o+vec2(seaHash(k),seaHash(k+19.7))-f;float d=dot(e,e);if(d<d1){d2=d1;d1=d;}else d2=min(d2,d);}return sqrt(d2)-sqrt(d1);}`;
// Smooth 2D simplex noise with its gradient (x: value, yz: d/dp), named `name`
// over the hash `hash`: its lattice gradients turn by `a` radians, each corner
// at its own rate (flow noise), so its pattern evolves in place rather than
// sliding; unlike the value noise it has no lattice-aligned flat lines or
// creases, which a mirror shows as square tiles.
export const flowNoiseGlsl = (name, hash) => `vec3 ${name}(vec2 p,float a){
vec2 i=floor(p+dot(p,vec2(.3660254))),x0=p-i+dot(i,vec2(.2113249)),o=x0.x>x0.y?vec2(1.,0.):vec2(0.,1.),x1=x0-o+.2113249,x2=x0-.5773503;
vec3 h=vec3(${hash}(i),${hash}(i+o),${hash}(i+1.)),r=h*6.2831853+a*(h-.5)*4.;
vec2 g0=vec2(cos(r.x),sin(r.x)),g1=vec2(cos(r.y),sin(r.y)),g2=vec2(cos(r.z),sin(r.z));
vec3 t=max(.5-vec3(dot(x0,x0),dot(x1,x1),dot(x2,x2)),0.),t2=t*t,t4=t2*t2,gx=vec3(dot(g0,x0),dot(g1,x1),dot(g2,x2)),m=-8.*t2*t*gx;
return 70.*vec3(dot(t4,gx),m.x*x0+m.y*x1+m.z*x2+t4.x*g0+t4.y*g1+t4.z*g2);}`;
// The flow noise's RMS gradient per lattice unit (coast-water.test.mjs measures it).
export const FLOW_RMS = 2.571;
// The fine ripples' octaves (SEA.ripple): wavelength, turn (radians), slope,
// drift (lattice units a second) and turning rate.
export function rippleOctaves(ripple = SEA.ripple, swell = SEA.swell) {
  const wind = swell[0][2] * RAD;
  return [...Array(ripple.octaves).keys()].map((o) => {
    const l = ripple.length * ripple.ratio ** o,
      a = 0.4 + 2.39996 * o,
      heading = wind + (o % 2 ? -1 : 1) * (25 + 8 * o) * RAD,
      speed = (ripple.drift * Math.sqrt(l / ripple.length)) / l,
      d = [Math.cos(heading), Math.sin(heading)];
    return {
      l,
      a,
      slope: ripple.slope * ripple.ratio ** (o * ripple.fall),
      drift: [
        (Math.cos(a) * d[0] + Math.sin(a) * d[1]) * speed,
        (-Math.sin(a) * d[0] + Math.cos(a) * d[1]) * speed,
      ],
      turn: ripple.turn * Math.sqrt(ripple.length / l),
    };
  });
}
// The falls' spray: a soft cloud about their plunge (seaPlume: x, z, size, on),
// its centre spray[0] over the sea (y0), standing a little taller than wide;
// seaSpray() is the share of the light it veils along the ray from the eye to
// p (a Gaussian's integral, its erf through a logistic), billowing where the
// ray passes closest to its heart and breathing slowly.
const sprayGlsl = (falls) => `uniform vec4 seaPlume;
float sprayErf(float x){return 1.-2./(exp(2.4*clamp(x,-8.,8.))+1.);}
float seaSpray(vec3 p,float y0){
if(seaPlume.w<=0.)return 0.;
vec3 k=vec3(1.,.8,1.),O=(cameraPosition-vec3(seaPlume.x,y0+${glsl(falls.spray[0])},seaPlume.y))*k,D=(p-cameraPosition)*k;
float L=length(D);D/=max(L,1e-4);
float t0=-dot(O,D),s=seaPlume.z,e=exp(-(dot(O,O)-t0*t0)/(s*s));
vec3 m=cameraPosition+(p-cameraPosition)*clamp(t0/max(L,1e-4),0.,1.);
float bill=.35+1.3*seaFoam(vec2(m.x+m.z,m.y*1.6)/(.45*s)+seaTime*vec2(.15,-.5));
return 1.-exp(-${glsl(falls.spray[2])}*e*bill*.886*s*(sprayErf((L-t0)/s)+sprayErf(t0/s))*(.8+.2*sin(seaTime*.9)));
}`;
// The spray over c at p (b: behind the text), lit as white water is.
const sprayOver = (falls, p, y0) =>
  `c=mix(c,${glsl(falls.spray[3])}*seaLight(vec3(0.,1.,0.),babelFlash.x*(1.-b)),seaSpray(${p},${y0})*(1.-${glsl(SEA.text)}*b));`;
const ENV_PARS = `#include <envmap_common_pars_fragment>
#include <cube_uv_reflection_fragment>
vec3 seaEnv(vec3 d,float r){
#ifdef USE_ENVMAP
return textureCubeUV(envMap,d,r).rgb*envMapIntensity;
#else
return mix(vec3(.062,.065,.073),vec3(.07,.085,.13),smoothstep(0.,.5,d.y));
#endif
}
uniform vec3 seaKey,seaKeyColor,seaFill,seaFillColor,seaAmbient,seaHemiSky,seaHemiGround;
vec3 seaDiffuse(vec3 n){return seaKeyColor*max(dot(n,seaKey),0.)+seaFillColor*max(dot(n,seaFill),0.)+seaAmbient+mix(seaHemiGround,seaHemiSky,.5*n.y+.5);}
// The shore's subdued diffuse response: raw scene light intensities over pi,
// without the legacy-light pi boost used by the standard materials. The
// environment remains separate, lifted by a flash.
vec3 seaLight(vec3 n,float flash){return seaDiffuse(n)/SEA_PI+seaEnv(n,1.)*(1.+flash);}
// The moon's highlight off a surface of normal N seen from E: a GGX lobe of
// roughness ag (Smith-masked) with Schlick's Fresnel from f0.
vec3 seaGGX(vec3 N,vec3 E,float ag,float f0){vec3 H=normalize(seaKey+E);float nh=max(dot(N,H),0.),nl=max(dot(N,seaKey),0.),ne=max(dot(N,E),0.),a2=ag*ag,dn=nh*nh*(a2-1.)+1.;
return seaKeyColor*(a2/(SEA_PI*dn*dn))*(f0+(1.-f0)*pow(1.-max(dot(E,H),0.),5.))*2.*nl/(nl+sqrt(a2+(1.-a2)*nl*nl)+1e-5)*nl/(2.*(ne+sqrt(a2+(1.-a2)*ne*ne))+1e-5);}
// The share of light a cloud of droplets scatters through angle cos c (Henyey-Greenstein, g forward).
float seaHG(float c,float g){float d=1.+g*g-2.*g*c;return (1.-g*g)/(4.*SEA_PI*d*sqrt(d));}`;

function seaVertex(sea) {
  const swell = waveTerms(sea.swell)
    .map(
      ({ k, a, d, w }, i) =>
        `sw+=${glsl(a)}*sin(dot(${glslVec(...d)},p)*${glsl(k)}-seaTime*${glsl(w)}+${glsl(i * 1.7)});`,
    )
    .join("");
  return `uniform float seaTime;
varying vec3 vSeaW;
varying vec4 vSlateClip;
varying float vSeaY;
void main(){
float y0=modelMatrix[3].y+${glsl(sea.level)},r=length(position.xz),sw=0.;
vec2 p=cameraPosition.xz+position.xz;
${swell}
vec3 w=vec3(p.x,y0+sw,p.y);
// The far rim rises so every eye sees the open sea out to rim.slope below eye level.
w.y+=smoothstep(${glsl(sea.rim.from * sea.radius)},${glsl(sea.radius)},r)*max(cameraPosition.y-y0-r*${glsl(sea.rim.slope)},0.);
vSeaW=w;vSeaY=y0;
gl_Position=projectionMatrix*viewMatrix*vec4(w,1.);
vSlateClip=gl_Position;
}`;
}

function seaFragment(sea, lib) {
  const swell = waveTerms(sea.swell)
      .map(
        ({ k, a, d, w, length }, i) =>
          `{float f=smoothstep(1.5,3.,${glsl(length)}/fp);g+=${glslVec(...d)}*${glsl(a * k)}*cos(dot(${glslVec(...d)},P.xz)*${glsl(k)}-seaTime*${glsl(w)}+${glsl(i * 1.7)})*f;v+=${glsl((a * k) ** 2 * 0.5)}*(1.-f*f);}`,
      )
      .join("\n"),
    waves = waveTerms(sea.waves)
      .map(
        ({ k, a, d, w, length }, i) =>
          `{float f=smoothstep(1.5,3.,${glsl(length)}/fp),s=${glsl(a * k)}*cos(dot(${glslVec(...d)},P.xz)*${glsl(k)}-seaTime*${glsl(w)}+${glsl(i * 2.3)}+(phaseWarp.x-.5)*1.4*warpFade);g+=(${glslVec(...d)}+phaseWarp.yz*${glsl(1.4 / (31 * k))}*warpFade)*s*f;v+=${glsl((a * k) ** 2 * 0.5)}*(1.-f*f);}`,
      )
      .join("\n"),
    { surf, glitter } = sea,
    octaves = rippleOctaves(sea.ripple, sea.swell),
    spread = Math.sqrt(octaves.reduce((sum, { slope }) => sum + slope * slope, 0));
  // The fine ripples: each turned by the golden angle, drifting and turning in
  // place, riding the coarser ones' slopes; the balanced tier's finest stay
  // roughness (seaFine 0).
  const ripple = octaves
    .map(({ l, a, slope, drift, turn }, o) => {
      const m = `mat2(${glsl(Math.cos(a))},${glsl(Math.sin(a))},${glsl(-Math.sin(a))},${glsl(Math.cos(a))})`,
        body = `{float f=smoothstep(1.5,3.,${glsl(l)}/fp);vec3 n=seaFlowD(${m}*(P.xz+gr*${glsl(sea.ripple.ride * l)})/${glsl(l)}+seaTime*${glslVec(...drift)},seaTime*${glsl(turn)});vec2 go=(n.yz*${m})*${glsl(slope / FLOW_RMS)}*sa;g+=go*f;gr+=go*${glsl(1 / spread)};v+=${glsl(slope * slope)}*(1.-f*f);}`;
      return o < sea.ripple.balanced
        ? body
        : `if(seaFine>.5)${body}else v+=${glsl(slope * slope)};`;
    })
    .join("\n");
  return `#define SEA_PI 3.1415927
uniform float seaTime, seaLace, seaFine;
uniform vec4 uMist, babelFlash, seaFalls;
uniform mat4 projectionMatrix;
varying vec3 vSeaW;
varying vec4 vSlateClip;
varying float vSeaY;
${lib.SLATE_TEXT_GUARD}
${lib.MIST_PARS}
${ENV_PARS}
${coastGlsl()}
${NOISE_GLSL}
${flowNoiseGlsl("seaFlowD", "seaHash")}
${sprayGlsl(FALLS)}
${stackOutlineGlsl()}
void main(){
vec3 V=vSeaW-cameraPosition;float L=length(V);V/=max(L,1e-4);
float h=max(cameraPosition.y-vSeaY,.05),t=min(h/max(-V.y,1e-5),1e4);
// At the shore the foam and mirror belong to the displaced surface being drawn.
// Only the raised far rim returns to the level plane's projection along the ray.
float rim=smoothstep(${glsl(sea.rim.from * sea.radius)},${glsl(sea.radius)},length(vSeaW.xz-cameraPosition.xz));
vec3 P=mix(vSeaW,cameraPosition+V*t,rim);
// Its pixel footprint follows the same surface, stretched along a grazing ray.
float fp=max(mix(L,t,rim)*length(fwidth(V))/max(-V.y,.01),1e-3);
float d=seaCoast(P.xz);
if(d>${glsl(sea.margin)})discard;
float z=-d;
vec2 g=vec2(0.);float v=${glsl(sea.rough * sea.rough)};
// Broad, slow phase variation breaks long ruled crests; its derivative
// keeps the reflected normal consistent, and unresolved waves still fade.
vec3 phaseWarp=seaNoiseD(P.xz/31.+seaTime*vec2(.008,-.006));
float warpFade=smoothstep(1.5,3.,31./fp);
// The displaced mesh's broad swell and the mirror share the same phase and slope.
${swell}
${waves}
// The swell's and waves' slope alone: the cliffs' image in the water follows it.
vec2 gw=g,gr=vec2(0.);
// Broad slicks (turned, so never patches along the axes): calmer and rougher
// water drifting with the wind, calming or roughening the fine ripples too.
float slick=.5+(seaNoise(mat2(.8,.6,-.6,.8)*P.xz/90.+seaTime*vec2(.004,.003))-.5)*.65*smoothstep(1.5,3.,90./fp)+(seaNoise(mat2(.28,-.96,.96,.28)*P.xz/37.-seaTime*vec2(.006,.002))-.5)*.35*smoothstep(1.5,3.,37./fp);
float sv=mix(.45,1.6,smoothstep(.25,.75,slick)),sa=sqrt(sv);
${ripple}
v*=sv;
// Impact roughens only the plunge, leaving the open sea's calm swell intact.
if(seaFalls.w>0.){vec2 pool=(P.xz-seaFalls.xy)/max(seaFalls.z,1e-4);float impact=1.-smoothstep(.15,.95,length(pool));
if(impact>0.){vec3 churn=seaFlowD(pool*4.+seaTime*vec2(.13,-.09),seaTime*.45);float resolve=smoothstep(1.5,3.,seaFalls.z/(4.*fp));
g+=churn.yz*${glsl(0.09 / FLOW_RMS)}*impact*resolve;v+=.006*impact+${glsl(0.09 ** 2)}*impact*impact*(1.-resolve*resolve);}}
// At a graze the facets facing the eye hide the rest: the slopes the pixel holds tilt toward the eye, mirroring higher sky, more weakly.
float s=sqrt(v);vec2 eh=normalize(-V.xz+1e-6);
vec3 N=normalize(vec3(-g.x+eh.x*${glsl(sea.mask)}*s*(1.-smoothstep(.1,.6,-V.y)),1.,-g.y+eh.y*${glsl(sea.mask)}*s*(1.-smoothstep(.1,.6,-V.y)))),E=-V;
// Where the normal turns within the pixel its slopes spread (multisampling never
// filters shading): the mirror and the moon's lobe widen, so fine ripples
// sparkle rather than tile or crawl.
vec3 dN=fwidth(N);float sg=sqrt(v+min(${glsl(glitter.aa)}*dot(dN,dN),${glsl(glitter.aaMax)}));
// Near the horizon the surface's slopes blur its mirror (grazing, the slopes along the ray stretch it).
float rough=sg+.65*(1.-smoothstep(.02,.3,-V.y));
vec3 R=reflect(V,N);R.y=${glsl(sea.horizon)}+(1.-${glsl(sea.horizon)})*max(R.y,0.);R=normalize(R);
float ne=max(dot(N,E),0.),F=${glsl(sea.f0)}+${glsl(1 - sea.f0)}*pow(1.-ne,5.);
float b=slateBehindText();
vec3 sky=seaEnv(R,clamp(rough*1.8,0.,1.))*${glsl(sea.sky)}*(1.+babelFlash.y*(1.-b));
// Under the cliffs the water mirrors their dark face, not the sky: the true reflected ray,
// sampled a few times out to 50 units, meets the rock (inside the fault by more than the
// face's lean) below the plain's height, along the wall and in the falls' slot too.
// Farther out it clears the cliffs and mirrors the sky. The ray follows the swell's
// slope, its edges softened by the fine ripples' spread along it (never a patchwork
// of rock and sky from one ripple to the next). The face, lit as it faces the
// water, keeps a (tiny) non-constant height: a constant zero would leave the env lookup
// inside seaLight() an unreachable division by zero, which D3D warns of (X4008).
if(z>-${glsl(sea.margin)}&&z<60.){vec3 Rt=reflect(V,normalize(vec3(-gw.x,1.,-gw.y)));float face=0.,sr=${glsl(spread)}*sa+s;
for(int i=0;i<5;i++){float tt=2.+3.*float(i*i),w=${glsl(sea.mirror)}*sr*tt;
face=max(face,smoothstep(1.-w,3.+w,seaCoast(P.xz+Rt.xz*tt))*(1.-smoothstep(${glsl(1.25 - sea.level - 1.5)}-w,${glsl(1.25 - sea.level + 1)}+w,Rt.y*tt)));}
sky=mix(sky,${glslVec(...CLIFF.rock[0])}*${glsl(STACKS.wet)}*seaLight(-normalize(vec3(Rt.x+1e-4,Rt.y*1e-4,Rt.z)),babelFlash.x*(1.-b)),face);}
// The water's mirror, through the river's knee (keeping its hue).
vec3 refl=sky*F;float rY=dot(refl,vec3(.2126,.7152,.0722));refl*=${glsl(sea.knee)}*(1.-exp(-rY/${glsl(sea.knee)}))/max(rY,1e-5);
// The moon's glitter: a GGX lobe at the slopes the pixel holds (Smith-masked), through its own knee.
vec3 glit=seaGGX(N,E,max(sg,${glsl(glitter.alpha)}),${glsl(sea.f0)})*${glsl(glitter.gain)};
float gY=dot(glit,vec3(.2126,.7152,.0722));glit*=${glsl(glitter.knee)}*(1.-exp(-gY/${glsl(glitter.knee)}))/max(gY,1e-5);
// Behind the text the light keeps 70%, then passes the ground's text knee.
refl=slateTextKnee(refl*(1.-.3*b),b);glit=slateTextKnee(glit*(1.-.3*b),b);
// The water's own body: what of the moon's and the sky's light it scatters back
// up (body: deep water's albedo), clouded by the surf's sand and bubbles near the
// rock (turbid, fading out over turbidReach units), in drifting plumes.
vec3 c=mix(${glslVec(...sea.body)},${glslVec(...sea.turbid)},(1.-smoothstep(${glsl(sea.turbidReach[0])},${glsl(sea.turbidReach[1])},z))*(.55+.45*seaNoise(P.xz/7.+seaTime*vec2(.05,-.03))))*seaLight(vec3(0.,1.,0.),babelFlash.x*(1.-b))*(1.-F)+refl+glit;
// White water at the cliffs' foot: swells breaking against the rock, broken along it, and a far mean where they fall under pixels.
float sf=0.;
${stacksSurfGlsl()}
if(z<${glsl(surf.reach)}||sf>0.||(seaFalls.w>0.&&length(P.xz-seaFalls.xy)<.95*seaFalls.z)){
float u=fract(z/${glsl(surf.period)}+seaTime*${glsl(surf.speed / surf.period)}+.14*sin(P.x*.13+P.z*.09)),n=seaNoise(P.xz/${glsl(surf.cell)}+seaTime*vec2(.03,-.02));
float burst=smoothstep(${glsl(1 - surf.cover)},${glsl(1 - surf.cover + 0.25)},n)*exp(-u*2.6);
// How thick the white water lies: a narrow lace against the rock (the fault's distance
// runs short in its fractures' corners, so never a solid band there); a
// breaking swell surging in thinner near it, so it breaks into strands, never one
// flat sheet; about the stacks (breathing with the swell) and in the churning heart
// of where the falls land; beyond, it thins into lace.
float k=max(.75*(1.-smoothstep(.3,2.6+fp,z)),.6*burst*(1.-smoothstep(${glsl(surf.reach * 0.15)},${glsl(surf.reach * 0.6)},z))),shore=1.;
if(seaFalls.w>0.){
vec2 pool=(P.xz-seaFalls.xy)/seaFalls.z;
// A persistent turbulent core, with broken expanding fans carried seaward.
// Boils well up where it lands and spread outward (cells in log-polar space:
// they grow as they go), foam gathering along their borders (FALLS.boil).
float pr=length(pool),angle=atan(pool.y,pool.x),cell=seaCells(vec2(log(pr+.08)*${glsl(FALLS.boil[1])}-seaTime*${glsl(FALLS.boil[2])}+.35*seaNoise(pool*3.1-seaTime*.04),angle*${glsl(FALLS.boil[0] / (2 * Math.PI))}+.4*seaNoise(pool*2.+seaTime*.05)),${glsl(FALLS.boil[0])}),bw=.25+.35*seaFoam(pool*4.+seaTime*.1);
float core=1.-smoothstep(.06,.3,pr),wash=.45*(1.-smoothstep(.25,.95,pr))*mix(.35,1.,(1.-smoothstep(0.,bw,cell))*smoothstep(.15,.6,seaFoam(pool*7.-seaTime*.07)))*(.65+.35*seaFoam(pool*3.+seaTime*.08));
// The falling current clears the shore's steady blanket. Its broken fans,
// rather than a uniform contact band, carry foam across the exposed water.
shore=1.-.8*(1.-smoothstep(.25,.95,pr));
k=max(k*shore,max(core,wash));}
k=max(k,sf*(.85+.15*sin(seaTime*1.3+P.x*.2+P.z*.13)));
// Thick, it covers the water; thinning, only its lace's strands stay, drifting.
// The balanced tier, and white water under the pixel, take its mean.
// Against the rock it lies solid; elsewhere the swell's patches thin it a little.
k*=.86+.14*smoothstep(.25,.75,n);
vec2 fq=mat2(.8,.6,-.6,.8)*(P.xz/1.6+seaTime*vec2(.12,-.08));
fq+=vec2(.4*sin(fq.y*.6+seaTime*.17),.3*sin(fq.x*.4-seaTime*.12));
float far=clamp(fp*1.2-.6,0.,1.),lace=.65*seaFoam(fq)+.35*seaFoam(fq*2.7+3.1),fw=.18+fp*.6;
float foam=mix(k,smoothstep(1.-k-fw,1.-k+fw,lace)*smoothstep(0.,.02,k),seaLace*(1.-far));
foam=mix(foam,max(${glsl(surf.far)}*(1.-smoothstep(0.,${glsl(surf.reach)},z))*shore,.45*sf),far);
foam*=1.-${glsl(sea.text)}*b;
vec3 lit=seaLight(vec3(0.,1.,0.),babelFlash.x*(1.-b));
c=mix(c,${glsl(surf.albedo)}*lit,clamp(foam,0.,1.));}
${sprayOver(FALLS, "P", "vSeaY")}
if(uMist.w>0.)c=mix(c,uMist.rgb,uMist.w*${glsl(sea.mist)}*smoothstep(55.,190.,t));
${
  lib.MIST_PARS
    ? `// The drifting mist lies on the land: it gathers along the ray only until the ray leaves it (the fault's mean line, past its headlands)
// or sinks below the plain's level (mistFrame.x): under the cliffs lies the sea's own air, not the plain's densest.
float vn=dot(V.xz,${glslVec(NX, NZ)}),tc=vn>1e-4?max(${glsl(COAST.offset + sea.mistPast)}-dot(cameraPosition.xz,${glslVec(NX, NZ)}),0.)/vn:1e4;
float td=V.y<-1e-4?max(cameraPosition.y-mistFrame.x,0.)/-V.y:1e4;
c=mistOver(c,cameraPosition+V*min(min(t,800.),min(tc,td)));`
    : ""
}
gl_FragColor=vec4(c,${SEA_SHARED.layer});
}`;
}

// The scene's raw light colors/intensities and environment, read per draw.
// seaLight() applies the shore's own diffuse normalization; do not add r160's
// legacy-light pi boost, which would brighten the tuned cliffs and white water.
function lighting(rendering, material, uniforms) {
  const key = new Vector3(),
    target = new Vector3(),
    tone = (out, light, color = light.color) =>
      out.set(color.r, color.g, color.b).multiplyScalar(light.intensity);
  material.envMap = uniforms.envMap.value = rendering?.homeScene?.environment ?? null;
  return () => {
    const env = rendering?.homeScene?.environment ?? null;
    if (material.envMap !== env) {
      material.envMap = env;
      uniforms.envMap.value = env;
      material.needsUpdate = true;
    }
    const { sun, fill, ambient, hemisphere } = rendering?.lights ?? {};
    for (const [light, direction, color] of [
      [sun, uniforms.seaKey, uniforms.seaKeyColor],
      [fill, uniforms.seaFill, uniforms.seaFillColor],
    ]) {
      if (!light) continue;
      key
        .setFromMatrixPosition(light.matrixWorld)
        .sub(target.setFromMatrixPosition(light.target.matrixWorld));
      if (key.lengthSq() > 0) direction.value.copy(key.normalize());
      tone(color.value, light);
    }
    if (ambient) tone(uniforms.seaAmbient.value, ambient);
    if (hemisphere) {
      tone(uniforms.seaHemiSky.value, hemisphere);
      tone(uniforms.seaHemiGround.value, hemisphere, hemisphere.groundColor);
    }
    uniforms.seaLace.value = rendering?.tier === "balanced" ? 0 : 1;
    if (uniforms.seaFine) uniforms.seaFine.value = rendering?.tier === "balanced" ? 0 : 1;
  };
}
// The uniforms the sea, the cliffs and the falls each take: the sea's clock,
// the scene's lights and environment (lighting()), the shot's mist, a
// lightning flash and the text boxes (lent by the entry through MIST_UNIFORMS,
// which index.js points at the ground's).
function sharedUniforms(lib, clock, plunge = null, falls = FALLS) {
  const mist = lib.MIST_UNIFORMS ?? {};
  return {
    ...mist,
    // Where the falls' spray rises (x, z, size, on), if they fall.
    seaPlume: {
      value: {
        x: plunge?.[0] ?? 0,
        y: plunge?.[1] ?? 0,
        z: (plunge?.[2] ?? 1) * falls.spray[1],
        w: plunge ? 1 : 0,
      },
    },
    seaTime: clock.uniform,
    seaLace: { value: 1 },
    seaFine: { value: 1 },
    seaKey: { value: new Vector3(0.71, 0.62, 0.31) },
    seaKeyColor: { value: new Vector3(1, 1, 1) },
    seaFill: { value: new Vector3(0, 1, 0) },
    seaFillColor: { value: new Vector3() },
    seaAmbient: { value: new Vector3() },
    seaHemiSky: { value: new Vector3() },
    seaHemiGround: { value: new Vector3() },
    envMap: { value: null },
    envMapIntensity: { value: 1 },
    flipEnvMap: { value: -1 },
    uMist: lib.RANGE_MIST,
    babelFlash: lib.FLASH_GROUND.babelFlash,
    slateText: mist.mistText,
    slateAbout: mist.mistAbout,
    slateAspect: mist.mistAspect,
  };
}

// The sea for a scene: its mesh, kept on the lens's light and environment
// each draw (and its clock ticking), and dispose(). lib lends the entry's
// shared GLSL and uniforms: SLATE_TEXT_GUARD, MIST_PARS and MIST_UNIFORMS (with
// the text boxes), FLASH_GROUND and RANGE_MIST. clock: a drip clock
// (terrain-build.js dripClock()) on the sea's own time.
export function createSea({ lib, clock, rendering, sea = SEA, plunge = null } = {}) {
  const uniforms = sharedUniforms(lib, clock, plunge);
  // Where the falls land (x, z, radius), if they do.
  uniforms.seaFalls = {
    value: { x: plunge?.[0] ?? 0, y: plunge?.[1] ?? 0, z: plunge?.[2] ?? 1, w: plunge ? 1 : 0 },
  };
  const material = new ShaderMaterial({
    name: "EstateSea",
    uniforms,
    vertexShader: seaVertex(sea),
    fragmentShader: seaFragment(sea, lib),
    extensions: { derivatives: true },
  });
  const update = lighting(rendering, material, uniforms);
  const mesh = new Mesh(seaGeometry(sea), material);
  mesh.name = "estate-sea";
  mesh.frustumCulled = false;
  mesh.castShadow = mesh.receiveShadow = false;
  mesh.renderOrder = 0.5;
  mesh.onBeforeRender = () => {
    clock.tick(performance.now());
    update();
  };
  return {
    mesh,
    material,
    dispose() {
      mesh.removeFromParent();
      mesh.geometry.dispose();
      material.dispose();
    },
  };
}

// The cliffs: a shelf over the plain's last `shelf` units (it hides the
// terrain's step, SHORE.drop), a broken lip, then the face falling
// from the plain to `foot` below the sea, leaning out `lean` over its height
// and broken by ledges and recesses `jag` deep (noise `cell` units along the
// fault and `band` tall). bed: the face's beds' thickness, each standing out or
// back by up to `ledge`, so ledges and overhangs break it; crag: its fine
// broken relief ([along, tall, depth]); beds: the thinner beds its rock shows,
// jointed into blocks. step: its columns' spacing along the fault; rows: the
// face's. lip: the broken edge's teeth (their least and most height over
// the shelf). rock: its albedo's dark and pale (strata) tones; dust: the
// plain's dusty tone the shelf's top takes up to the break, so it meets the
// terrain with no rim; wet: the band above the sea the spray keeps dark.
export const CLIFF = Object.freeze({
  step: 0.8,
  shelfRows: 6,
  rows: 30,
  foot: -16,
  lean: 2.6,
  jag: 2.4,
  cell: 7,
  band: 2.6,
  bed: 2.2,
  ledge: 0.8,
  crag: Object.freeze([2.3, 0.9, 0.55]),
  beds: 1.1,
  lip: Object.freeze([0.04, 0.48]),
  sink: 0.35,
  rock: Object.freeze([Object.freeze([0.1, 0.09, 0.088]), Object.freeze([0.24, 0.215, 0.205])]),
  dust: Object.freeze([0.3, 0.25, 0.25]),
  wet: 3.5,
  buttressColumns: 24,
  buttressRows: 12,
  rubble: 18,
});
// Ribs of the broken plateau left jutting from the face (the owner's call of
// 2026-10-17: sharp ribs below the clifftop, never rounded masses above it):
// along-shore centre, half-width, drop (how far, in thirds, their crest falls
// under the plain toward their broken ends) and their seaward reach. The
// falls keep their open slot.
export const COAST_BUTTRESSES = Object.freeze(
  [
    [-88, 14, 5.6, 3.8],
    [1, 13, 7.5, 4.6],
    [42, 16, 4.8, 4],
  ].map(Object.freeze),
);
const hash = (x, y) => {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
};
function noise2(x, y) {
  const ix = Math.floor(x),
    iy = Math.floor(y),
    fx = x - ix,
    fy = y - iy,
    ux = fx * fx * (3 - 2 * fx),
    uy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy),
    b = hash(ix + 1, iy),
    c = hash(ix, iy + 1),
    d = hash(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
const fbm = (x, y) =>
  0.55 * noise2(x, y) +
  0.3 * noise2(x * 2.07 + 5.1, y * 2.07 + 1.3) +
  0.15 * noise2(x * 4.3 + 9.7, y * 4.3 + 3.9);

// A point on the fault at along-shore s.
function faultPoint(s) {
  const [w] = wobble(s);
  return [TX * s + NX * (COAST.offset + w), TZ * s + NZ * (COAST.offset + w)];
}
// The fault's seaward normal at s, from its points `reach` either side, so it
// turns smoothly through a fracture's cusp.
function faultNormal(s, reach = 2.5) {
  const [ax, az] = faultPoint(s - reach),
    [bx, bz] = faultPoint(s + reach),
    l = Math.hypot(bx - ax, bz - az) || 1;
  return [(bz - az) / l, -(bx - ax) / l];
}
// The fault's along-shore coordinate at a world point.
export const faultAlong = (x, z) => x * TX + z * TZ;
// Analytic bedding and joint fields are shared with the rock shader. Unlike
// noise hashes their CPU/GPU phases agree, including through layout lifts.
export function coastBedPhase(s, y, bed = CLIFF.bed) {
  return (
    (y * (1 + 0.13 * Math.sin(s / 47 + 0.4)) +
      1.1 * Math.sin(y * 0.29 + s * 0.017) +
      1.5 * Math.sin(s / 31 + 0.7) +
      0.45 * Math.sin(s / 9.3 + 1.1) +
      s * 0.02 +
      0.15 * Math.sin(y * 0.91 + s * 0.035)) /
    bed
  );
}
export function coastFracture(s, y, v) {
  const joint = Math.floor(s / 13),
    seam = (joint + 0.5 + 0.16 * Math.sin(joint * 1.7 + 4)) * 13 + 0.35 * Math.sin(y * 0.7 + joint),
    width = 0.6 + 0.35 * (0.5 + 0.5 * Math.sin(joint * 2.1 + 2)),
    end = 0.45 + 0.25 * (0.5 + 0.5 * Math.sin(joint * 0.9 + 7));
  return (
    (1 - smooth(0, width, Math.abs(s - seam))) * smooth(0.03, 0.15, v) * (1 - smooth(end, 0.9, v))
  );
}
export const coastRockGlsl = () => `
float coastBedPhase(float s,float y,float bed){return (y*(1.+.13*sin(s/47.+.4))+1.1*sin(y*.29+s*.017)+1.5*sin(s/31.+.7)+.45*sin(s/9.3+1.1)+s*.02+.15*sin(y*.91+s*.035))/bed;}
float coastFracture(float s,float y,float v){float j=floor(s/13.),seam=(j+.5+.16*sin(j*1.7+4.))*13.+.35*sin(y*.7+j),width=.6+.35*(.5+.5*sin(j*2.1+2.)),end=.45+.25*(.5+.5*sin(j*.9+7.));return (1.-smoothstep(0.,width,abs(s-seam)))*smoothstep(.03,.15,v)*(1.-smoothstep(end,.9,v));}
`;

// The cliff's geometry, given the land's height at x/z (the terrain's sampler):
// rows across the fault from the shelf's inner edge to the face's foot, every
// `step` along it, within the terrain's square `half` (with a margin). notch:
// the slot the falls have cut (fallsNotch()): there the face stands
// straighter and set back, and under the river's run to the falls' brink the
// lip sinks `sink` beneath the water.
export function cliffGeometry(height, cliff = CLIFF, half = 190, notch = null) {
  return finishGeometry(cliffGeometrySteps(height, cliff, half, notch));
}
function finishGeometry(steps) {
  for (;;) {
    const next = steps.next();
    if (next.done) return next.value;
  }
}
function* cliffGeometrySteps(height, cliff = CLIFF, half = 190, notch = null) {
  // The fault's along-shore span inside the square.
  const span = [];
  for (let column = 0; column * cliff.step <= half * 3; column++) {
    const s = -half * 1.5 + column * cliff.step;
    const [w] = wobble(s),
      x = TX * s + NX * (COAST.offset + w),
      z = TZ * s + NZ * (COAST.offset + w);
    if (Math.abs(x) <= half && Math.abs(z) <= half) span.push(s);
  }
  const shelfRows = cliff.shelfRows,
    lipRows = 2,
    cols = span.length,
    rows = shelfRows + lipRows + cliff.rows;
  const positions = new Float32Array(cols * rows * 3),
    attrs = new Float32Array(cols * rows * 3),
    uvs = new Float32Array(cols * rows * 2),
    roots = new Float32Array(cols * rows * 4);
  for (let i = 0; i < span.length; i++) {
    const s = span[i];
    const [ox, oz] = faultNormal(s),
      [px, pz] = faultPoint(s),
      slot = notch ? 1 - smooth(notch[1], notch[1] + 3, Math.abs(s - notch[0])) : 0;
    // Across the fault: the shelf from inland to the edge, the lip, then the face.
    const at = (off, y, row, v) => {
      const k = (i * rows + row) * 3;
      positions[k] = px + ox * off;
      positions[k + 1] = y;
      positions[k + 2] = pz + oz * off;
      attrs.set([s, v, off], (i * rows + row) * 3);
      uvs.set([positions[k] / 384 + 0.5, 0.5 - positions[k + 2] / 384], (i * rows + row) * 2);
      roots[(i * rows + row) * 4 + 3] = 1;
    };
    const ground = (off) => height(px + ox * off, pz + oz * off);
    const inner = -SHORE.shelf - 1.2 * fbm(s / 9, 0.3);
    for (let r = 0; r < shelfRows; r++) {
      const off = inner * (1 - r / shelfRows);
      at(off, ground(off) + 0.04 + 0.12 * (r / shelfRows) * fbm(s / 3, r), r, 0);
    }
    // The broken edge: low teeth along it (ridged noise) and a crisp, ragged break.
    const tooth = 1 - Math.abs(2 * fbm(s / 3.4, 7.1) - 1),
      top =
        ground(-1) +
        (cliff.lip[0] + (cliff.lip[1] - cliff.lip[0]) * tooth) * (1 - slot) +
        0.05 * slot,
      bevel = 0.25 + 0.35 * fbm(s / 1.1, 2),
      // Under the river's run to the falls' brink the lip sinks beneath the
      // water; beside it the rock stays, the banks its edges tuck under.
      under = (off) => {
        if (!notch || notch.length < 7) return 0;
        const [, , lx, lz, hx, hz, half] = notch,
          across = Math.abs((px + ox * off - lx) * -hz + (pz + oz * off - lz) * hx) / half;
        return cliff.sink * (1 - smooth(0.75, 0.95, across));
      };
    at(-0.9, top - under(-0.9), shelfRows, 0);
    at(bevel, top - 0.35 - 0.5 * fbm(s / 2.3, 4.2) - under(bevel), shelfRows + 1, 0.02);
    // A bed's step out (or back), varying along the fault.
    const bedOut = (b) =>
      (hash(b, 3.3) - 0.5) *
      2 *
      cliff.ledge *
      (0.4 + 0.6 * fbm(s / 11, b * 0.37)) *
      smooth(0.28, 0.58, noise2(s / 15, b * 0.7));
    for (let r = 0; r < cliff.rows; r++) {
      const v = (r + 1) / cliff.rows,
        y = top - 0.6 + (cliff.foot - top + 0.6) * v ** 0.9,
        jag = cliff.jag * (fbm(s / cliff.cell, y / cliff.band) - 0.5) * 2,
        // The beds dip gently along the fault; each meets the next over its top fifth.
        dip = coastBedPhase(s, y, cliff.bed),
        bed = Math.floor(dip),
        ledge = bedOut(bed) + (bedOut(bed + 1) - bedOut(bed)) * smooth(0.8, 1, dip - bed),
        crag = cliff.crag[2] * (fbm(s / cliff.crag[0], y / cliff.crag[1]) - 0.5) * 2,
        fissure = coastFracture(s, y, v);
      at(
        0.2 +
          cliff.lean * v * (1 - 0.8 * slot) +
          (jag + ledge + crag - fissure * 0.8) * (0.35 + 0.65 * Math.min(1, v * 3)) * (1 - slot) -
          1.2 * slot * Math.min(1, v * 4),
        y,
        shelfRows + lipRows + r,
        v,
      );
    }
    if (i % 8 === 7) yield;
  }
  const indices = new Uint32Array((cols - 1) * (rows - 1) * 6);
  const shelfCount = (cols - 1) * shelfRows * 6;
  let topIndex = 0,
    faceIndex = shelfCount;
  for (let i = 0; i < cols - 1; i++) {
    for (let r = 0; r < rows - 1; r++) {
      const a = i * rows + r,
        b = a + 1,
        c = a + rows,
        d = c + 1;
      const k = r < shelfRows ? topIndex : faceIndex;
      indices.set([a, c, b, b, c, d], k);
      if (r < shelfRows) topIndex += 6;
      else faceIndex += 6;
    }
    if (i % 8 === 7) yield;
  }
  // Added rock stays wholly seaward of the walk's body. Projection along N
  // keeps the fault coordinate unchanged, so this bound is exact at cusps too.
  const extra = [],
    marks = [],
    extraUv = [],
    extraIndices = [],
    parts = [];
  const vertex = (x, y, z, v) => {
    const s = faultAlong(x, z),
      [, slope] = wobble(s),
      push = Math.max(0, coastDistance(x, z) - 0.28) * Math.sqrt(1 + slope * slope),
      px = Math.fround(x + NX * push),
      pz = Math.fround(z + NZ * push),
      index = cols * rows + extra.length / 3;
    extra.push(px, y, pz);
    marks.push(s, v, Math.max(0.1, -coastDistance(px, pz)));
    extraUv.push(px / 384 + 0.5, 0.5 - pz / 384);
    return index;
  };
  const open = (s, reach = 0) => !notch || Math.abs(s - notch[0]) >= notch[1] + 3 + reach;
  for (const [centre, width, rise, out] of COAST_BUTTRESSES) {
    if (
      !cliff.buttressColumns ||
      !cliff.buttressRows ||
      !open(centre, width + out + 2.5) ||
      !span.length ||
      centre - width < span[0] ||
      centre + width > span.at(-1)
    )
      continue;
    const first = cols * rows + extra.length / 3,
      sections = [],
      columns = cliff.buttressColumns,
      levels = cliff.buttressRows;
    for (let column = 0; column <= columns; column++) {
      const t = column / columns,
        s = centre + (t * 2 - 1) * width,
        [px, pz] = faultPoint(s),
        [ox, oz] = faultNormal(s),
        // Steep, ragged ends: the rib breaks off, it never rounds over.
        envelope =
          smooth(0, 0.09, t) * (1 - smooth(0.91, 1, t)) * (0.78 + 0.22 * fbm(s / 1.7, 3.1)),
        ground = height(px, pz),
        split = (1 - smooth(0.5, 1.4, Math.abs(s - centre + 3))) * envelope,
        // The crest stays below the clifftop (`rise` at most), jagged along the rib
        // and dropping toward its broken ends.
        crest =
          ground -
          0.5 -
          rise * 0.32 * (1 - envelope) -
          1.1 * fbm(s / 2.1, 8.3) -
          0.5 * Math.abs(2 * fbm(s / 0.9, 2.7) - 1) -
          split * 1.1,
        section = [],
        at = (off, y, v) => section.push(vertex(px + ox * off, y, pz + oz * off, v));
      // A broken crown under the lip, its seaward edge stepping down: solid rock
      // jutting from the face, not a thin fin, nor a mass over the plain.
      at(0.6, crest - 0.3, 0);
      at(0.9, crest - 0.05, 0);
      at(1.4 + envelope * 0.5, crest - 0.2 * envelope - 0.35 * fbm(s / 1.3, 5.7), 0);
      at(1.5 + envelope * (out + 0.8), crest - 0.55 * envelope - 0.5 * fbm(s / 1.1, 6.2), 0);
      for (let r = 1; r <= levels; r++) {
        const v = r / levels,
          y = crest + (cliff.foot - crest) * v,
          bed = coastBedPhase(s, y, cliff.bed),
          b = Math.floor(bed),
          fullness = (n) => (hash(n, centre) - 0.5) * 0.7 * smooth(0.25, 0.65, noise2(s / 9, n)),
          ledge = fullness(b) + (fullness(b + 1) - fullness(b)) * smooth(0.75, 1, bed - b),
          fissure =
            (1 - smooth(0.5, 1.4, Math.abs(s - centre + 3 + 0.3 * Math.sin(y)))) *
            (1 - smooth(0.4, 0.85, v));
        at(
          1.5 +
            envelope *
              (out +
                0.8 +
                1.4 * Math.sin((v * Math.PI) / 2) +
                ledge -
                fissure * 0.8 +
                0.35 * (fbm(s / 3, y / 2) - 0.5)),
          y,
          v,
        );
      }
      at(0.6, cliff.foot, 1);
      sections.push(section);
      if (column % 8 === 7) yield;
    }
    const n = sections[0].length;
    for (let c = 0; c < columns; c++)
      for (let r = 0; r < n; r++) {
        const next = (r + 1) % n,
          a = sections[c][r],
          b = sections[c][next],
          d = sections[c + 1][r],
          e = sections[c + 1][next];
        extraIndices.push(a, d, b, b, d, e);
      }
    // End caps close the attached fragments, including their submerged backs.
    for (const c of [0, columns])
      for (let r = 1; r < n - 1; r++) {
        const face = [sections[c][0], sections[c][r], sections[c][r + 1]];
        extraIndices.push(...(c === 0 ? face : face.reverse()));
      }
    parts.push({
      kind: "buttress",
      along: centre,
      first,
      count: cols * rows + extra.length / 3 - first,
      columns,
      rows: n,
    });
  }
  // A few detached fragments seat the face in its wash, not a repeated apron.
  for (let k = 0; k < cliff.rubble; k++) {
    const s = -119 + k * 13.1 + 3 * hash(k, 8),
      size = 0.45 + hash(k, 5) * 1.05;
    if (!open(s, size * 2) || !span.length || s < span[0] || s > span.at(-1)) continue;
    const [px, pz] = faultPoint(s),
      [ox, oz] = faultNormal(s),
      out = 4 + 3 * hash(k, 2),
      first = cols * rows + extra.length / 3,
      rings = [],
      sides = 7;
    if (!open(faultAlong(px + ox * out, pz + oz * out), size * 2)) continue;
    for (let r = 0; r < 3; r++) {
      const v = r / 2,
        ring = [];
      for (let j = 0; j < sides; j++) {
        const a = (j / sides) * Math.PI * 2,
          radius =
            size * (r === 1 ? 1 : 0.55) * (0.8 + 0.3 * noise2(k * 3 + Math.cos(a), Math.sin(a))),
          x = px + ox * out + Math.cos(a) * radius * 1.4,
          z = pz + oz * out + Math.sin(a) * radius;
        ring.push(
          vertex(x, SEA.level - size + v * size * 2 + 0.12 * size * Math.sin(a * 2 + k), z, 0.85),
        );
      }
      rings.push(ring);
    }
    for (let r = 0; r < 2; r++)
      for (let j = 0; j < sides; j++) {
        const next = (j + 1) % sides,
          a = rings[r][j],
          b = rings[r][next],
          c = rings[r + 1][j],
          d = rings[r + 1][next];
        extraIndices.push(a, c, b, b, c, d);
      }
    for (const r of [0, 2])
      for (let j = 1; j < sides - 1; j++) {
        const face = [rings[r][0], rings[r][j], rings[r][j + 1]];
        extraIndices.push(...(r === 2 ? face.reverse() : face));
      }
    parts.push({ kind: "rubble", along: s, first, count: sides * 3 });
    if (k % 4 === 3) yield;
  }
  yield;
  const join = (base, added) => {
    const result = new Float32Array(base.length + added.length);
    result.set(base);
    result.set(added, base.length);
    return result;
  };
  const extraRoots = new Float32Array((extra.length / 3) * 4);
  for (let i = 3; i < extraRoots.length; i += 4) extraRoots[i] = 1;
  const allIndices = new Uint32Array(indices.length + extraIndices.length);
  allIndices.set(indices);
  allIndices.set(extraIndices, indices.length);
  const geometry = new BufferGeometry();
  let finished = false;
  try {
    geometry.setAttribute("position", new BufferAttribute(join(positions, extra), 3));
    geometry.setAttribute("aCliff", new BufferAttribute(join(attrs, marks), 3));
    // The shelf shares the ground's complete material and UV phase. Neutral
    // root attributes leave the estate's root treatment away from the fault.
    geometry.setAttribute("uv", new BufferAttribute(join(uvs, extraUv), 2));
    geometry.setAttribute("slateRoot", new BufferAttribute(join(roots, extraRoots), 4));
    geometry.setAttribute(
      "slateShade",
      new BufferAttribute(new Float32Array(cols * rows * 2 + (extra.length / 3) * 2), 2),
    );
    geometry.setAttribute(
      "slatePool",
      new BufferAttribute(new Float32Array(cols * rows + extra.length / 3), 1),
    );
    geometry.setIndex(new BufferAttribute(allIndices, 1));
    geometry.addGroup(0, shelfCount, 0);
    geometry.addGroup(shelfCount, allIndices.length - shelfCount, 1);
    geometry.userData.coastGeometry = { columns: cols, rows, baseVertices: cols * rows, parts };
    yield;
    geometry.computeVertexNormals();
    finished = true;
    return geometry;
  } finally {
    if (!finished) geometry.dispose();
  }
}

// What the break left standing off the cliffs: sea stacks (remnants of the
// plateau, their caps at about its height) and tilted slabs (blocks that fell
// and rose on one edge), all dark with spray. Each: [along the fault (s), out
// (seaward of it), height (along its axis above the sea), half-thickness,
// stretch (its length over its thickness; past 2 a slab), lean (degrees), turn
// (degrees: the lean's heading off the fault's seaward normal)]. base: how far
// under the sea each stands from; sides, rings: the faceted prism each is; bed:
// its beds' thickness, each a little fuller or leaner than the next;
// surf: how far its white water reaches; wet: its rock's share of the cliffs'
// albedo, so seen through the mist it never stands paler than the sea; weed,
// weedTone: the weedy band the tides keep about its foot (its top over the
// sea, its tint).
export const STACKS = Object.freeze({
  list: Object.freeze(
    [
      [-105, 38, 9, 6, 1.2, 4, 30],
      [-72.8, 26, 13.4, 4.2, 1.25, 3, -20],
      [-54, 48, 17, 3, 2.6, 30, 15],
      [-0.5, 32, 12.6, 3.8, 1.35, 5, 40],
      [18, 50, 19, 3.2, 2.4, 24, -35],
    ].map((stack) => Object.freeze(stack)),
  ),
  base: 6,
  sides: 24,
  rings: 36,
  bed: 1.8,
  surf: 3.5,
  wet: 0.6,
  weed: 3,
  weedTone: Object.freeze([0.55, 0.6, 0.42]),
});
const COAST_GEOMETRY = Object.freeze({
  high: Object.freeze({ cliff: CLIFF, stacks: STACKS, maxTriangles: 45000 }),
  balanced: Object.freeze({
    cliff: Object.freeze({
      ...CLIFF,
      step: 1.2,
      rows: 20,
      buttressColumns: 16,
      buttressRows: 8,
      rubble: 12,
    }),
    stacks: Object.freeze({ ...STACKS, sides: 16, rings: 24 }),
    maxTriangles: 25000,
  }),
});
// Both tiers sample the same fields; density changes never redraw the geology.
export const coastGeometrySettings = (tier = "high") =>
  COAST_GEOMETRY[tier] ?? COAST_GEOMETRY.balanced;

// The film's existing slice scheduler prepares this exact pair while detached.
// Closing the iterator frees completed or partly packed geometry; a successful
// return transfers both buffers to the coastal owner, with no later rebuild.
export function* coastGeometrySteps(height, tier = "high", drop = null) {
  const settings = coastGeometrySettings(tier),
    notch = fallsNotch(drop);
  let cliff,
    stacks,
    finished = false;
  try {
    cliff = yield* cliffGeometrySteps(height, settings.cliff, 190, notch);
    yield;
    stacks = yield* stackGeometrySteps(settings.stacks);
    finished = true;
    return { cliff, stacks };
  } finally {
    if (!finished) {
      cliff?.dispose();
      stacks?.dispose();
    }
  }
}

// A stack's frame: its waterline centre c (x/z) and axes U (its length,
// level), Y (up its lean) and W (its thickness, tipped with it), and how far
// its waterline section stretches along the lean's heading h.
function stackFrame([s, out, , , , lean, turn]) {
  const [nx, nz] = faultNormal(s),
    [px, pz] = faultPoint(s),
    t = turn * RAD,
    a = lean * RAD,
    h = [nx * Math.cos(t) - nz * Math.sin(t), nx * Math.sin(t) + nz * Math.cos(t)];
  return {
    c: [px + nx * out, pz + nz * out],
    h,
    tilt: 1 / Math.cos(a),
    U: [-h[1], 0, h[0]],
    Y: [h[0] * Math.sin(a), Math.cos(a), h[1] * Math.sin(a)],
    W: [h[0] * Math.cos(a), -Math.sin(a), h[1] * Math.cos(a)],
  };
}
// The same broad, non-elliptical section seats the visible rock and its wash.
// Fine fractures remain geometry only, well inside the surf's feathered edge.
export function stackOutline(k, angle, v) {
  return (
    0.94 +
    0.11 * Math.sin(3 * angle + 1.7 * k + 1.2 * v) +
    0.07 * Math.cos(5 * angle - 0.9 * k + 2.1 * v) +
    0.05 * Math.sin(angle + 0.7 * k + 0.6 * v)
  );
}
export const stackOutlineGlsl = () => `
float stackOutline(float k,float angle,float v){return .94+.11*sin(3.*angle+1.7*k+1.2*v)+.07*cos(5.*angle-.9*k+2.1*v)+.05*sin(angle+.7*k+.6*v);}
`;
export function stackWaterlineProfile(stacks, k) {
  const stack = stacks.list[k],
    [, , height, half, stretch] = stack,
    v = stacks.base / (height + stacks.base),
    du = (fbm(k * 5.3, v * 3.1) - 0.5) * half * stretch * 0.35,
    dw = (fbm(k * 6.1 + 2, v * 3.1) - 0.5) * half * 0.35,
    frame = stackFrame(stack);
  return {
    v,
    du,
    dw,
    taper: stretch > 2 ? 1 : 1 - 0.28 * v * v,
    center: [
      frame.c[0] + frame.U[0] * du + frame.h[0] * dw * frame.tilt,
      frame.c[1] + frame.U[2] * du + frame.h[1] * dw * frame.tilt,
    ],
  };
}

// The stacks' fractured geometry (shallow joins smooth, deep creases sharp), with the cliff's
// attributes: around each (for its grain), a stack's mark (2: past the face's
// 0 to 1, so it takes STACKS.wet), and across (1: none of the shelf's dust).
export function stackGeometry(stacks = STACKS, level = SEA.level) {
  return finishGeometry(stackGeometrySteps(stacks, level));
}
function* stackGeometrySteps(stacks = STACKS, level = SEA.level) {
  const positions = [],
    attrs = [],
    normals = [],
    crease = Math.cos(Math.PI / 6),
    edgeA = new Vector3(),
    edgeB = new Vector3(),
    average = new Vector3();
  for (let k = 0; k < stacks.list.length; k++) {
    const stack = stacks.list[k];
    const [, , height, half, stretch] = stack,
      { c, U, Y, W } = stackFrame(stack),
      { base, sides, rings } = stacks,
      slab = stretch > 2;
    const point = (lu, ly, lw) => [
      c[0] + U[0] * lu + Y[0] * ly + W[0] * lw,
      level + U[1] * lu + Y[1] * ly + W[1] * lw,
      c[1] + U[2] * lu + Y[2] * ly + W[2] * lw,
    ];
    // Ring r's points: a ragged section (broad lumps and fine fractures, so the
    // outline never reads as a polygon, even veiled in mist), its middle
    // wandering, ledged now and then, a stack tapering up. Broad ledges follow
    // height, independent of tessellation, and end unevenly around the rock.
    const ring = (r) => {
      const v = r / rings,
        ly = -base + (height + base) * v,
        taper = slab ? 1 : 1 - 0.28 * v * v,
        ledge = smooth(0.42, 0.7, fbm(k * 3.1, v * 3)),
        // Its beds, by height: each a little fuller or leaner, meeting over its top fifth.
        du = (fbm(k * 5.3, v * 3.1) - 0.5) * half * stretch * 0.35,
        dw = (fbm(k * 6.1 + 2, v * 3.1) - 0.5) * half * 0.35;
      const points = [...Array(sides).keys()].map((j) => {
        const a = (j / sides) * 2 * Math.PI,
          ca = Math.cos(a),
          sa = Math.sin(a),
          bedAt = (ly + 9 * k + 0.35 * sa) / stacks.bed,
          bi = Math.floor(bedAt),
          full = (b) =>
            1 +
            0.16 *
              (hash(k * 17 + b, 8.1) - 0.5) *
              smooth(0.2, 0.65, noise2(k * 3 + ca, b * 0.7 + sa)),
          bed = full(bi) + (full(bi + 1) - full(bi)) * smooth(0.8, 1, bedAt - bi),
          cover = smooth(
            0.3,
            0.7,
            noise2(k * 7.2 + Math.cos(a) * 1.3, Math.sin(a) * 1.3 + v * 1.1),
          ),
          rad =
            (stackOutline(k, a, v) +
              0.12 * (fbm(k * 13 + ca * 1.8, v * 4.1 + sa * 1.8) - 0.5) +
              0.06 * (noise2(k * 31 + ca * 3.1, v * 9.3 + sa * 3.1) - 0.5)) *
            taper *
            bed *
            (1 - 0.12 * ledge * cover),
          // The top ring is broken: its points stand at ragged heights.
          crown =
            smooth(0.78, 1, v) *
            ((fbm(k * 7 + ca * 1.3, 5.1 + sa * 1.3) - 0.5) * (slab ? 5 : 3.4) +
              (k === 3 ? 1.8 * Math.cos(2 * (a - 0.4)) - 1.1 : 0));
        return {
          p: point(
            du + Math.cos(a) * half * stretch * rad,
            ly + crown,
            dw + Math.sin(a) * half * rad,
          ),
          arc: k * 50 + a * half * (1 + stretch),
        };
      });
      // The last column closes on the first point, its grain carried on round
      // (no seam); it shades as that point.
      points.forEach((point) => (point.key = point));
      return [
        ...points,
        { p: points[0].p, arc: k * 50 + 2 * Math.PI * half * (1 + stretch), key: points[0] },
      ];
    };
    const faces = [],
      adjoining = new Map();
    const face = (a, b, d) => {
      edgeA.fromArray(b.p).sub(edgeB.fromArray(a.p));
      edgeB.fromArray(d.p).sub(average.fromArray(a.p));
      const points = [a, b, d],
        normal = edgeA.cross(edgeB).normalize().clone();
      faces.push({ points, normal });
      points.forEach((vertex) => {
        const { p, arc } = vertex;
        positions.push(...p);
        attrs.push(arc, 2, 1);
        const key = vertex.key ?? vertex;
        if (!adjoining.has(key)) adjoining.set(key, []);
        adjoining.get(key).push(normal);
      });
    };
    let below = ring(0);
    for (let r = 1; r <= rings; r++) {
      const above = ring(r);
      for (let j = 0; j < sides; j++) {
        face(below[j], below[j + 1], above[j]);
        face(below[j + 1], above[j + 1], above[j]);
      }
      below = above;
      if (r % 2 === 0) yield;
    }
    // The cap: broken, a little domed.
    // Its peak follows the top ring's wandering middle. Separate vertices
    // keep the cap's broken rim sharp even where a side join is shallow.
    const rim = below.slice(0, sides),
      mid = [0, 1, 2].map((i) => rim.reduce((sum, { p }) => sum + p[i], 0) / sides),
      top = {
        p: [mid[0], mid[1] + (k === 3 ? -2.1 : 0.4 * fbm(k, 9.1)) * Y[1], mid[2]],
        arc: k * 50,
      },
      cap = rim.map(({ p, arc }) => ({ p, arc }));
    cap.push({ p: cap[0].p, arc: below[sides].arc, key: cap[0] });
    for (let j = 0; j < sides; j++) face(cap[j], cap[j + 1], top);
    yield;
    for (let i = 0; i < faces.length; i++) {
      const { points, normal } = faces[i];
      for (const vertex of points) {
        average.set(0, 0, 0);
        for (const other of adjoining.get(vertex.key ?? vertex))
          if (normal.dot(other) >= crease) average.add(other);
        average.normalize();
        normals.push(average.x, average.y, average.z);
      }
      if (i % 96 === 95) yield;
    }
  }
  yield;
  const geometry = new BufferGeometry();
  let finished = false;
  try {
    geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
    geometry.setAttribute("aCliff", new BufferAttribute(new Float32Array(attrs), 3));
    geometry.setAttribute("normal", new BufferAttribute(new Float32Array(normals), 3));
    yield;
    finished = true;
    return geometry;
  } finally {
    if (!finished) geometry.dispose();
  }
}

// The white water about each stack's waterline (its section there: stretched
// along the lean's heading), reaching furthest on the side the swell comes
// from, as GLSL adding to `sf` at the sea's point P.
export function stacksSurfGlsl(stacks = STACKS, sea = SEA) {
  // The swell breaks on each stack's seaward side, white water hugging its
  // waterline all round, and in its lee only thin strands trail away (a third
  // of the thickness, so only the lace's strands show).
  const heading = sea.swell[0][2] * RAD,
    seaward = [-Math.cos(heading), -Math.sin(heading)];
  return stacks.list
    .map((stack, k) => {
      const [, , , half, stretch] = stack,
        { h, tilt } = stackFrame(stack),
        profile = stackWaterlineProfile(stacks, k);
      return `{vec2 q=P.xz-${glslVec(...profile.center)},p=vec2(dot(q,${glslVec(-h[1], h[0])})/${glsl(half * stretch * profile.taper)},dot(q,${glslVec(...h)})/${glsl(half * tilt * profile.taper)});float angle=atan(p.y,p.x),e=(length(p)-stackOutline(${glsl(k)},angle,${glsl(profile.v)}))*${glsl(half)};
float facing=.5+.5*dot(normalize(q+1e-4),${glslVec(...seaward)}),breaks=.6+.4*sin(seaTime*1.1-angle*2.+${glsl(k * 1.7)}),body=(1.-smoothstep(.05,.65+.9*facing,e))*(.6+.4*breaks),splash=(1.-smoothstep(0.,${glsl(stacks.surf)}*(.35+.9*facing),e))*facing*(.55+.45*breaks),tail=(1.-smoothstep(.25,${glsl(stacks.surf)}*(.4+1.1*(1.-facing)),e))*smoothstep(.2,.85,breaks)*.32*(1.-facing);
sf=max(sf,max(body,max(splash,tail)));}`;
    })
    .join("\n");
}

// The falls' spray, then the low mist and the drifting mist, at a point vW of the
// cliffs, their stacks or the falls, as the sea takes them: out past the fault
// only SEA.mist of a shot's low mist, and the drifting mist gathered only while
// the ray is over the land and above the plain's level. Needs seaCoast()
// (coastGlsl()) and the mist's uniforms.
const landMist = (lib, sea = SEA) =>
  `${sprayOver(FALLS, "vW", "vSeaY")}
{vec3 mv=vW-cameraPosition;float ml=length(mv);vec3 md=mv/max(ml,1e-4);
if(uMist.w>0.)c=mix(c,uMist.rgb,uMist.w*mix(1.,${glsl(sea.mist)},smoothstep(4.,16.,-seaCoast(vW.xz)))*smoothstep(55.,190.,ml));
${
  lib.MIST_PARS
    ? `float vn=dot(md.xz,${glslVec(NX, NZ)}),tc=vn>1e-4?max(${glsl(COAST.offset + sea.mistPast)}-dot(cameraPosition.xz,${glslVec(NX, NZ)}),0.)/vn:1e4;
float td=md.y<-1e-4?max(cameraPosition.y-mistFrame.x,0.)/-md.y:1e4;
c=mistOver(c,cameraPosition+md*min(ml,min(tc,td)));`
    : ""
}}`;

function cliffFragment(cliff, lib) {
  const [dark, pale] = cliff.rock;
  return `#define SEA_PI 3.1415927
uniform float seaTime;
uniform vec4 uMist, babelFlash, cliffRiver;
uniform vec2 cliffFlow;
uniform sampler2D coastDetail;
uniform float coastDetailOn;
uniform sampler2D coastAlbedo;
uniform float coastAlbedoOn;
uniform mat4 projectionMatrix;
varying vec3 vW, vN, vRock;
varying vec4 vSlateClip;
varying vec3 vC;
varying float vSeaY;
${lib.SLATE_TEXT_GUARD}
${lib.MIST_PARS}
${ENV_PARS}
${NOISE_GLSL}
${sprayGlsl(FALLS)}
${coastGlsl()}
${coastRockGlsl()}
void main(){
vec3 n=normalize(vN);
// The rock: beds of uneven thickness dipping along the fault, each jointed into
// blocks (their own tone and facet, dark cracks between them, a lip catching the
// light over a shadowed underside), fractures and grain over all and across the
// top. Detail finer than the pixel fades to its mean.
float top=smoothstep(.55,.85,n.y),side=1.-top;
vec2 q=mix(vec2(vC.x/3.,vRock.y/1.3),vRock.xz/2.2,top);
vec3 n1=seaNoiseD(q),n2=seaNoiseD(q*3.1+7.),n3=seaNoiseD(q*9.7+3.);
float px=max(fwidth(vC.x),fwidth(vRock.y)),f1=1.-smoothstep(.35,1.1,px/1.3),f2=1.-smoothstep(.35,1.1,px*3.1/1.3),f3=1.-smoothstep(.35,1.1,px*9.7/1.3);
n1=vec3(mix(.5,n1.x,f1),n1.yz*f1);n2=vec3(mix(.5,n2.x,f2),n2.yz*f2);n3=vec3(mix(.5,n3.x,f3),n3.yz*f3);
float yb=coastBedPhase(vC.x,vRock.y,${glsl(cliff.bed)});
float bi=floor(yb),bf=fract(yb);
// Long fractures run across several beds, with short splinters between them.
// They interrupt strata instead of making a staggered masonry grid.
float fracture=vC.x/7.3+.24*seaNoise(vec2(vRock.y*.23,2.7))+.12*seaNoise(vec2(vC.x*.29,vRock.y*.4));
float ub=fracture+(seaHash(vec2(floor(vRock.y/5.7),4.4))-.5)*.16;
float ji=floor(ub),jf=fract(ub),hb=seaHash(vec2(bi*1.31,ji)),hc=seaHash(vec2(ji,bi*.73+5.));
float detail=(1.-smoothstep(.06,.3,px))*side,exposed=smoothstep(.25,.75,seaNoise(vec2(vC.x/11.,vRock.y/3.7)));
// Joints: some open, some tight; the bedding planes open only here and there.
float joint=min(jf,1.-jf)*7.3*(.6+.8*seaNoise(vec2(vRock.y*1.7,ji))),plane=min(bf,1.-bf)*${glsl(cliff.bed)}*(.6+.8*seaNoise(vec2(vC.x*.9,bi)));
float fu=ub*3.1+hb,fine=(1.-smoothstep(.01,.04+px,min(fract(fu),1.-fract(fu))*7.3/3.1))*smoothstep(.5,.8,seaHash(vec2(floor(fu),bi*2.)))*.5*(1.-smoothstep(.02,.06,px));
float crack=max(fine,max((1.-smoothstep(.02,.11+2.*px,joint))*smoothstep(.15,.55,seaHash(vec2(ji,floor(bi/3.)+1.5))),(1.-smoothstep(.015,.07+2.*px,plane))*exposed*smoothstep(.3,.75,seaNoise(vec2(vC.x/5.,bi))))*(1.-smoothstep(.03,.16,px)))*detail;
crack=max(crack,.75*coastFracture(vC.x,vRock.y,vC.y)*side);
vec3 alb=mix(${glslVec(...dark)},${glslVec(...pale)},.5+.16*(hb-.5)*detail+.16*(n2.x-.5))*(.94+.12*n3.x);
// The scan is already linear from sRGB storage. Normalize its measured mean
// to the same stone reflectance as the shelf, preserving local colour and
// mineral variation without multiplying the night stone into black.
if(coastAlbedoOn>.5){vec3 scan=mix(texture2D(coastAlbedo,vec2(vC.x,vRock.y)/${glsl(COAST_ALBEDO.tile)}).rgb,texture2D(coastAlbedo,vRock.xz/${glsl(COAST_ALBEDO.tile)}).rgb,top);
vec3 relative=clamp(scan/${glslVec(...COAST_ALBEDO.mean)},vec3(.5),vec3(1.8));alb=mix(alb,${glslVec(...dark.map((value, i) => (value + pale[i]) * 0.5))}*mix(vec3(1.),relative,.6),.9);}
// Thinner beds of uneven thickness within the broad ones, each its own tone, so the face never reads as regular stripes.
float yt=(vRock.y+.45*seaNoise(vec2(vC.x/6.,4.1))+.6*seaNoise(vec2(vC.x/23.,1.7))+.25*seaNoise(vec2(vRock.y*.37,9.3)))/${glsl(cliff.beds)};
alb*=1.+.08*(seaHash(vec2(floor(yt),floor(vC.x/9.)))-.5)*detail*exposed;
// Broad weathering over the face, then the cracks and each bed's shaded underside.
alb*=(.94+.12*seaNoise(vec2(vC.x/8.,vRock.y/5.)))*(1.-.5*crack)*mix(1.,.94+.06*smoothstep(0.,.35,bf),detail*exposed);
// Stains washed down the face under its ledges.
alb*=1.-.22*side*smoothstep(.55,.85,seaNoise(vec2(vC.x*1.4,vRock.y*.13)));
// The shelf takes the plain's dust up to the break, so it meets the terrain without a seam; the stacks stand dark with spray.
alb=mix(alb,${glslVec(...cliff.dust)}*(.85+.3*n3.x),top*smoothstep(.2,1.,-vC.z));
// The stacks stand in the swell: a weedy band the tides keep up to STACKS.weed
// over the sea, their own rock above it, darker than the cliffs' (wet).
float stack=step(1.5,vC.y),hs=vW.y-vSeaY+.7*seaNoise(vec2(vC.x*.6,vRock.y*.2+3.3));
alb*=mix(1.,${glsl(STACKS.wet)},stack)*mix(vec3(1.),mix(${glslVec(...STACKS.weedTone)},vec3(1.),smoothstep(${glsl(STACKS.weed - 0.5)},${glsl(STACKS.weed + 0.5)},hs)),stack);
vec3 t=normalize(mix(cross(n,vec3(0.,1.,0.)),cross(n,vec3(0.,0.,1.)),top)+1e-4),bt=cross(t,n);
// Each block's own facet, and the bed's lip tipped up to the light, its underside down.
n=normalize(n+(t*(hb-.5)*.24+bt*(hc-.5)*.2+vec3(0.,smoothstep(.72,1.,bf)*.16-(1.-smoothstep(0.,.3,bf))*.12,0.)*exposed)*detail+(t*(n1.y*.5+n2.y*.35+n3.y*.15)+bt*(n1.z*.5+n2.z*.35+n3.z*.15))*.24);
// A single small, mipmapped scan adds pitting and worn stone, in the rock's
// existing basis. The data map never changes the established stone colours.
float rockRough=.8;
if(coastDetailOn>.5){
// On the face and on the tops each its own projection, blended by the slope, so it never stretches.
vec3 scan=mix(texture2D(coastDetail,vec2(vC.x,vRock.y)/${glsl(COAST_DETAIL.tile)}).rgb,texture2D(coastDetail,vRock.xz/${glsl(COAST_DETAIL.tile)}).rgb,top);vec2 xy=scan.rg*2.-1.;
float relief=(1.-smoothstep(.06,.24,px))*.48;
n=normalize(n*sqrt(max(.15,1.-dot(xy,xy)*relief*relief))+(t*xy.x+bt*xy.y)*relief);
rockRough=scan.b;}
// Spray darkens and wets the foot.
float wet=1.-smoothstep(vSeaY,vSeaY+${glsl(cliff.wet)},vW.y);
alb*=1.-.45*wet;
float b=slateBehindText();
vec3 light=seaLight(n,babelFlash.x*(1.-b));
vec3 c=alb*light;
// A wet foot's dull sheen of the sky.
vec3 E=normalize(cameraPosition-vW),R=reflect(-E,n);R.y=max(R.y,.1);
c+=wet*seaEnv(normalize(R),.25+.4*rockRough)*(.09+.04*(1.-rockRough))*pow(1.-max(dot(n,E),0.),3.);
// The moon's sheen: broad on the dry rock, tighter and brighter where it is wet.
c+=seaGGX(n,E,mix(.6,.18,wet),.04)*mix(.2,1.,wet)*(1.-.8*b);
// The river's last run over the shelf to the lip (riverFalls(): lip xz, half-width; flow), dark fast
// water whitening at the lip, across the whole shelf (inland of it the terrain paints the river).
if(cliffRiver.w>0.&&vC.y<.03){
vec2 rd=vW.xz-cliffRiver.xy;float ra=-dot(rd,cliffFlow),rx=abs(rd.x*cliffFlow.y-rd.y*cliffFlow.x);
float river=1.-smoothstep(cliffRiver.w-.6,cliffRiver.w+.2,rx+.35*(seaNoise(vec2(ra*.9,3.1))-.5));
if(river>0.){
float rush=seaNoise(vec2(rx*1.7,ra*.6+seaTime*2.6))*.6+seaNoise(vec2(rx*4.3,ra*1.5+seaTime*4.))*.4;
vec3 rn=normalize(vec3(cliffFlow.x*(rush-.5)*.3,1.,cliffFlow.y*(rush-.5)*.3)),RR=reflect(-E,rn);RR.y=max(RR.y,.08);
// At the river's own mirror gain (twice the open sea's), through its knee.
vec3 water=seaEnv(normalize(RR),.25)*(.02+.98*pow(1.-max(dot(rn,E),0.),5.))*${glsl(2 * SEA.sky)};float wY=dot(water,vec3(.2126,.7152,.0722));water=vec3(.004,.007,.009)+water*${glsl(SEA.knee)}*(1.-exp(-wY/${glsl(SEA.knee)}))/max(wY,1e-5);
float white=(1.-smoothstep(0.,2.2,ra))*(.45+.55*rush)+smoothstep(.62,.92,rush)*.2;
water=mix(water,${glsl(FALLS.albedo)}*seaLight(vec3(0.,1.,0.),babelFlash.x*(1.-b)),clamp(white,0.,1.)*(1.-${glsl(SEA.text)}*b));
c=mix(c*(1.-.45*smoothstep(-.3,.3,river)),water,smoothstep(.35,.65,river));}}
${landMist(lib)}
gl_FragColor=vec4(c,${SEA_SHARED.layer});
}`;
}

// The cliffs for a scene, beside the sea: their mesh (in the estate's frame,
// under the ground's parent), lit as the sea is lit, and dispose(). height:
// the land's height at x/z in that frame; drop: where the river falls
// (riverFalls()), whose slot the cliffs leave and whose last run their shelf
// paints; plunge: where it lands (its spray veils them).
export function createCliff({
  lib,
  clock,
  rendering,
  height,
  groundMaterial = null,
  cliff: suppliedCliff = null,
  prepared = null,
  drop = null,
  plunge = null,
} = {}) {
  const settings = coastGeometrySettings(
      prepared?.tier ?? rendering?.assetTier ?? rendering?.tier ?? "high",
    ),
    cliff = suppliedCliff ?? settings.cliff,
    uniforms = sharedUniforms(lib, clock, plunge),
    notch = fallsNotch(drop);
  uniforms.coastDetail = { value: null };
  uniforms.coastDetailOn = { value: 0 };
  uniforms.coastAlbedo = { value: null };
  uniforms.coastAlbedoOn = { value: 0 };
  uniforms.cliffRiver = {
    // The borrowed ground already draws the river up to the lip. Painting it
    // again on the rock bevel makes the notch read as folded flat panels.
    value: {
      x: drop?.lip[0] ?? 0,
      y: drop?.lip[1] ?? 0,
      z: 0,
      w: groundMaterial ? 0 : (drop?.lip[2] ?? 0),
    },
  };
  uniforms.cliffFlow = { value: { x: drop?.heading[0] ?? 1, y: drop?.heading[1] ?? 0 } };
  const material = new ShaderMaterial({
    name: "EstateCliff",
    uniforms,
    vertexShader: `attribute vec3 aCliff;
varying vec3 vW, vN, vRock;
varying vec4 vSlateClip;
varying vec3 vC;
varying float vSeaY;
void main(){
vec4 w=modelMatrix*vec4(position,1.);
vW=w.xyz;vRock=position;vN=normalize(mat3(modelMatrix)*normal);vC=aCliff;vSeaY=modelMatrix[3].y+${glsl(SEA.level)};
gl_Position=projectionMatrix*viewMatrix*w;
vSlateClip=gl_Position;
}`,
    fragmentShader: cliffFragment(cliff, lib),
    extensions: { derivatives: true },
  });
  const update = lighting(rendering, material, uniforms);
  const geometry = prepared?.cliff ?? cliffGeometry(height, cliff, 190, notch);
  if (groundMaterial && !geometry.getAttribute("slateRiverSurface"))
    geometry.setAttribute(
      "slateRiverSurface",
      new BufferAttribute(new Float32Array(geometry.attributes.position.count * 2), 2),
    );
  if (!groundMaterial) geometry.clearGroups();
  const mesh = new Mesh(geometry, groundMaterial ? [groundMaterial, material] : material),
    stacks = new Mesh(prepared?.stacks ?? stackGeometry(settings.stacks), material);
  mesh.name = "estate-cliff";
  stacks.name = "estate-stacks";
  stacks.castShadow = stacks.receiveShadow = false;
  mesh.add(stacks);
  mesh.castShadow = mesh.receiveShadow = false;
  mesh.onBeforeRender = stacks.onBeforeRender = update;
  const detail = createCoastDetail({
    tier: rendering?.assetTier ?? rendering?.tier ?? "high",
    apply(texture) {
      uniforms.coastDetail.value = texture;
      uniforms.coastDetailOn.value = 1;
    },
    reset() {
      uniforms.coastDetailOn.value = 0;
      uniforms.coastDetail.value = null;
    },
  });
  const albedo = createCoastAlbedo({
    tier: rendering?.assetTier ?? rendering?.tier ?? "high",
    apply(texture) {
      uniforms.coastAlbedo.value = texture;
      uniforms.coastAlbedoOn.value = 1;
      const ground = groundMaterial?.userData.coastAlbedoUniforms;
      if (ground) {
        ground.coastAlbedo.value = texture;
        ground.coastAlbedoOn.value = 1;
      }
    },
    reset() {
      const texture = uniforms.coastAlbedo.value;
      uniforms.coastAlbedoOn.value = 0;
      uniforms.coastAlbedo.value = null;
      const ground = groundMaterial?.userData.coastAlbedoUniforms;
      if (ground && ground.coastAlbedo.value === texture) {
        ground.coastAlbedoOn.value = 0;
        ground.coastAlbedo.value = null;
      }
    },
  });
  // The detached terrain owns these buffers until the complete shore owner
  // exists. Clearing its record transfers disposal to this owner exactly once.
  if (prepared) prepared.cliff = prepared.stacks = null;
  return {
    mesh,
    material,
    setActive(active) {
      detail.setActive(active);
      albedo.setActive(active);
    },
    take(state) {
      detail.take(state);
      albedo.take(state);
    },
    dispose() {
      albedo.dispose();
      detail.dispose();
      mesh.removeFromParent();
      mesh.geometry.dispose();
      stacks.geometry.dispose();
      material.dispose();
    },
  };
}

// The slate's edit list (terrain-build.js shadeSlateGround(), all or nothing,
// on its compacted-tolerant anchors): the fault's distance, and the walk's view
// from up high (hill-silhouette.js HIGH_VIEW, slateHigh: 0 on every shot):
// seen from the lookout's gallery, the land's far edge fades, lighter or
// darker, into the far plain's air from fade[0] to fade[1] units out, but only
// far inland of the fault (the cliffs keep their edge).
export function slateShoreEdits(fade = [80, 188]) {
  return [
    ["fragmentShader", "|#define STANDARD", `uniform float slateHigh;\n${coastGlsl()}\n`],
    [
      "fragmentShader",
      "|gl_FragColor.rgb = mix(gl_FragColor.rgb, earthAir, earthHorizon);",
      `earthAir *= 1.0+slateHigh*${glsl(SEA_SHARED.edgeLift)};
earthHorizon = max(earthHorizon, slateHigh*smoothstep(${glsl(fade[0])}, ${glsl(fade[1])}, length(vMudWorld.xz))*smoothstep(30.0, 70.0, seaCoast(vMudWorld.xz)));
`,
    ],
  ];
}

// The fault's own shots (the owner's picks of 2026-10-17, A, B and D of the
// ocean sheet): they join the tree's list, and with it the tour (camera-tour.js
// TOUR_ORDER), when the sea lands, and leave with it (terrain-build.js). Each
// looks at its aim (x, y, z in the estate's frame: the plain stands at 1.25,
// the sea at SEA.level) from `reach` units out on bearing `azimuth` (degrees,
// from the aim, as a directed shot's), `rise` high: its framing is its own,
// not a subject's fit (coastShot()). The film's shadow keeps to the land about
// `shadow` (x, z), never out over the sea. The rest is a directed shot's
// (directed-shots.js): a slow move each, the tree shots' moonlit mood and a
// light mist.
const COAST_LOOK = Object.freeze({
  region: Object.freeze([0.5, 1]),
  arc: 0,
  hold: 7,
  // Landscape phones hold it still, as every shot: no room about the name for a move.
  landscape: Object.freeze({ move: null }),
  light: Object.freeze({ key: 1, fill: 0.6, rim: 1.3, lantern: 1.2 }),
  ground: Object.freeze({
    mist: Object.freeze({ color: Object.freeze([0.27, 0.26, 0.29]), amount: 0.35 }),
    gloss: Object.freeze({ film: 0.32, gain: 1, cool: 0 }),
  }),
});
const BROKEN_COAST_VIEW = Object.freeze({
  aim: Object.freeze([140, -8.75, 115]),
  azimuth: -137.1,
  reach: 95.5,
  fov: 40,
});
export const COAST_SHOTS = Object.freeze([
  // High on the cliffs' edge, down the bay and out past the stacks to the
  // horizon, pushing in.
  Object.freeze({
    ...COAST_LOOK,
    name: "The broken coast",
    after: "Portrait",
    ...BROKEN_COAST_VIEW,
    // On upright phones a wider bearing holds the offshore pillar and tilted
    // slab apart across open water, from beyond the tree (farther back it
    // stands in the frame); the lens is as narrow as both allow, 76 degrees
    // (82 before: too wide). Wider canvases keep the wide view.
    portrait: Object.freeze({
      aim: Object.freeze([120.3, -8.75, 115]),
      azimuth: -127.8,
      reach: 82.2,
      fov: 76,
    }),
    tablet: BROKEN_COAST_VIEW,
    tall: BROKEN_COAST_VIEW,
    squat: BROKEN_COAST_VIEW,
    rise: 8.25,
    shadow: Object.freeze([80, 62]),
    move: Object.freeze({ dolly: Object.freeze([1.05, 0.95]), ease: 0.6 }),
  }),
  // Across the bay to the falls on the cliff wall, easing in toward them (from
  // within the sky's shell: the falls stand about 115 from the lookout, so the
  // camera looks across the bay's head, never from out at sea).
  Object.freeze({
    ...COAST_LOOK,
    name: "The falls",
    after: "Threshold",
    frameFalls: true,
    aim: Object.freeze([80.5, -8, 82.3]),
    // Upright screens stand farther back, round toward the land and higher, so
    // they look over the near rim into the bay, and may open the lens further
    // (their frame is narrow), so the falls never shrink into a thread.
    portrait: Object.freeze({ azimuth: -55, reach: 44, rise: 24, fovMax: 62 }),
    // Short landscape phones hold it still, farther back, higher and a little
    // wider for their short frame.
    landscape: Object.freeze({ move: null, azimuth: -55, reach: 42, rise: 15, fovMax: 48 }),
    azimuth: -44,
    reach: 33,
    rise: 10.25,
    shadow: Object.freeze([76, 74]),
    fov: 34,
    // Its lens opens to fit the falls, their pool and spray, but no further.
    fovMax: 48,
    move: Object.freeze({ dolly: Object.freeze([1.04, 0.95]), ease: 0.5 }),
  }),
  // Down the fault's broken V from above, its stacks in their surf across the
  // top, craning down toward them; the tree stands behind the lens.
  Object.freeze({
    ...COAST_LOOK,
    name: "Over the fault",
    after: "Root and lantern",
    aim: Object.freeze([90, -8.75, 90]),
    azimuth: -125,
    reach: 45,
    rise: 23.25,
    shadow: Object.freeze([72, 74]),
    fov: 58,
    move: Object.freeze({
      dolly: Object.freeze([1.06, 0.94]),
      crane: Object.freeze([0.3, 0]),
      ease: 0.6,
    }),
  }),
]);

// A coast shot for the cinematic camera (cinematic.js): its own measure and
// fit stand in for a subject's, setting its aim and camera in the estate's
// frame (`frame`, whose world matrix places it); a move's crane is in tens of
// units. The fit's `shadow` is where the film's shadow centres (film-scene.js).
// How far the falls' framing holds their spray: its heart, 1.2 of its
// Gaussian scales; past it the cloud thins into a haze that may run past the
// frame's edge, as a real cloud does.
export const SPRAY_FIT = 1.2;
export function coastShot(shot, frame, falls = null) {
  const at = (x, y, z) => new Vector3(x, y, z).applyMatrix4(frame.matrixWorld);
  // Fit the delivered sheet and visible plunge/spray envelope, not a stand-in
  // point. The camera keeps its established shore-side path; its lens fits the
  // whole move once per viewport, so it never breathes to follow the bounds.
  const detail = [];
  if (shot.frameFalls && falls) {
    const p = falls.mesh.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) detail.push([p.getX(i), p.getY(i), p.getZ(i)]);
    const [x, z, radius] = falls.plunge,
      spray = radius * FALLS.spray[1] * SPRAY_FIT,
      centre = SEA.level + FALLS.spray[0],
      high = centre + spray / 0.8;
    // The plunge's fans end inside 1.15 radii. The spray is an
    // ellipsoid, not its mostly empty box: beyond 2.25 Gaussian scales even
    // its maximum integrated opacity is below 1%. The sea hides its bottom.
    for (let turn = 0; turn < 32; turn++) {
      const angle = (turn * Math.PI) / 16,
        co = Math.cos(angle),
        si = Math.sin(angle);
      detail.push([x + co * radius * 1.15, SEA.level, z + si * radius * 1.15]);
      for (let row = 0; row <= 12; row++) {
        const y = SEA.level + ((high - SEA.level) * row) / 12,
          v = ((y - centre) * 0.8) / spray,
          rim = spray * Math.sqrt(Math.max(0, 1 - v * v));
        detail.push([x + co * rim, y, z + si * rim]);
      }
    }
  }
  return {
    ...shot,
    // The cinematic variant cache keys by variant identity. A shared template
    // must not reuse another shot's or another estate's bound measurement.
    landscape: { ...shot.landscape },
    portrait: shot.portrait && { ...shot.portrait },
    tablet: shot.tablet && { ...shot.tablet },
    tall: shot.tall && { ...shot.tall },
    squat: shot.squat && { ...shot.squat },
    measure(root, view) {
      frame.updateWorldMatrix(true, false);
      const target = at(...view.aim),
        points = detail.length ? detail.map((point) => at(...point)) : [target];
      return {
        points: new Float32Array(points.flatMap((point) => point.toArray())),
        target,
        cameraY: at(view.aim[0], view.rise, view.aim[2]).y,
        footing: target.y,
        groundAnchor: target.clone(),
        height: 10,
        region: new Box3().setFromPoints(points),
        radius: 40,
      };
    },
    fit(measured, view, area, width, height) {
      const fitted = {
        distance: view.reach,
        radius: 40,
        region: measured.region,
        area,
        shadow: at(view.shadow[0], 1.25, view.shadow[1]),
      };
      if (!detail.length || !area) return fitted;
      const point = new Vector3(),
        eye = new Vector3(),
        forward = new Vector3(),
        right = new Vector3(),
        up = new Vector3(),
        delta = new Vector3(),
        yaw = view.azimuth * RAD,
        dolly = view.move?.dolly ?? [1, 0.955];
      let slope = Math.tan((view.fov * RAD) / 2);
      for (let step = 0; step <= 8; step++) {
        const reach = view.reach * (dolly[0] + ((dolly[1] - dolly[0]) * step) / 8);
        eye.set(
          measured.target.x + Math.cos(yaw) * reach,
          measured.cameraY,
          measured.target.z + Math.sin(yaw) * reach,
        );
        forward.subVectors(measured.target, eye).normalize();
        right.crossVectors(forward, up.set(0, 1, 0)).normalize();
        up.crossVectors(right, forward);
        for (let i = 0; i < measured.points.length; i += 3) {
          delta.subVectors(point.fromArray(measured.points, i), eye);
          const depth = Math.max(0.001, delta.dot(forward));
          slope = Math.max(
            slope,
            (Math.abs(delta.dot(right)) * height) / (depth * area.width * 0.86),
            (Math.abs(delta.dot(up)) * height) / (depth * area.height * 0.86),
          );
        }
      }
      // Never wider than its fovMax (8 degrees past its lens unless set): wider, the
      // falls shrink into a thread and the frame's edges stretch.
      fitted.fov = Math.min(view.fovMax ?? view.fov + 8, (2 * Math.atan(slope)) / RAD);
      return fitted;
    },
  };
}

// The river's falls: where the river (reversed, it runs to the fault) meets
// the cliffs it pours over the lip into the sea. Its water starts on the
// cliffs' shelf's last row (about 1.4 inland, carrying the ground's own river),
// `lift` above the shelf there; run: the rows it runs over the sunken lip to
// its brink on the fault, its surface drawing down by `draw`; rows: all of
// its rows; push: its speed off the brink; drag: how much slower its thinner
// edges leave it; spread: how much longer along the cliff it falls; albedo:
// the white water's; plunge: the radius of the white water where it lands, as
// a share of its width. spray: the cloud it raises there: its centre's height
// over the sea, its size (a share of the plunge's radius), its density and
// its albedo. boil: the boils where it lands: how many round, their size
// outward (in the log of the radius) and how fast they spread. scatter: falling
// white water lit through, as a cloud of droplets is: its forward lean (g) and
// how much of the moon it carries toward an eye looking into the light.
export const FALLS = Object.freeze({
  lift: -0.01,
  run: 3,
  draw: 0.12,
  rows: 22,
  push: 6.4,
  depth: 1.64,
  drag: 0.25,
  spread: 0,
  albedo: 0.7,
  plunge: 2.2,
  spray: Object.freeze([2.6, 0.7, 0.16, 0.42]),
  boil: Object.freeze([9, 2, 0.25]),
  scatter: Object.freeze([0.55, 1.4]),
});

// Where the river (its sampled line, [x, z, along, half-width], from its
// end at the fault inland) leaves the land: the lip ([x, z, half-width]), the
// flow's heading there and the fault's along-shore coordinate; null if it
// never crosses.
export function riverFalls(line) {
  let lip = -1;
  for (let i = 0; i < line.length - 1; i++)
    if (
      coastDistance(line[i][0], line[i][1]) < 0 &&
      coastDistance(line[i + 1][0], line[i + 1][1]) >= 0
    ) {
      lip = i + 1;
      break;
    }
  if (lip < 0) return null;
  // The lip on the fault itself, between the last inland sample and the first out at sea.
  const [ax, az] = line[lip],
    [bx, bz] = line[lip - 1],
    da = coastDistance(ax, az),
    db = coastDistance(bx, bz),
    t = da / (da - db),
    end = [ax + (bx - ax) * t, az + (bz - az) * t, line[lip][3]];
  const l = Math.hypot(bx - ax, bz - az) || 1;
  return {
    lip: end,
    heading: [(bx - ax) / l, (bz - az) / l],
    along: faultAlong(end[0], end[1]),
  };
}

// The slot the falls cut in the cliffs (null without them): its along-shore
// centre and half-width, then the river's run to the brink (the lip, the flow's
// heading and its half-width) that the lip sinks under.
export const fallsNotch = (drop) =>
  drop
    ? [drop.along, drop.lip[2] + 1.5, drop.lip[0], drop.lip[1], ...drop.heading, drop.lip[2]]
    : null;

// How far along the heading [hx, hz] from (x, z) the fault's distance is `d`.
export function alongToFault(x, z, [hx, hz], d) {
  let u = 0;
  for (let n = 0; n < 8; n++) {
    const g =
      (coastDistance(x + hx * (u + 0.01), z + hz * (u + 0.01)) -
        coastDistance(x + hx * (u - 0.01), z + hz * (u - 0.01))) /
      0.02;
    u -= (coastDistance(x + hx * u, z + hz * u) - d) / (g < -0.1 ? g : -0.8);
  }
  return u;
}

// The rapids (the owner's ask of 2026-10-18: "rushing water pouring off"):
// over its last `reach` units the river quickens from `from` (its own current,
// terrain-build.js RIVER.flow) to `to` units a second at the falls' brink, its
// speed growing exponentially, so its patterns, laid out by their travel time
// to the brink, stretch as it speeds up and never shear; its weight eases out
// over `ease` (shares of reach) and toward its banks. streak: streaks drawn
// out along the flow (per unit across, per second of travel) and their tilt
// along and across. waves: standing waves held in place (their spacing and
// tilt; the distances above the brink they rise over and fade over), crossing
// in a diamond off the banks. lace: its white water's cells (per unit across,
// per second of travel); white: its churn far up and at the brink; banks: more
// along them; crests: more on the waves' crests. rough: the mirror's blur at
// the brink; albedo: its froth, lit like the soil (as the stream's); run: the
// falls' run's froth light, so it meets the shelf's; brink: how far above each
// stream's brink it breaks white and how white; tongue: how much later its
// smooth middle breaks; text: how much of it thins behind the text.
export const RAPIDS = Object.freeze({
  reach: 14,
  from: 3.2,
  to: 6.4,
  ease: Object.freeze([0.3, 1]),
  streak: Object.freeze([1.2, 0.5, 0.05, 0.09]),
  waves: Object.freeze([1.7, 0.06, 1.5, 3.5, 7, 10]),
  lace: Object.freeze([3.5, 0.35]),
  white: Object.freeze([0.04, 0.75]),
  banks: 0.35,
  crests: 0.35,
  rough: 0.7,
  albedo: 0.34,
  run: 0.62,
  brink: Object.freeze([1.2, 0.9]),
  tongue: 0.5,
  text: 0.9,
});
// The rapids' speed's length scale (its speed grows by e over it).
const rapidsScale = (rapids) => rapids.reach / Math.log(rapids.to / rapids.from);
export const rapidsSpeed = (ra, rapids = RAPIDS) =>
  rapids.to * Math.exp(-Math.min(Math.max(ra, 0), rapids.reach) / rapidsScale(rapids));
// The travel time to the brink from `ra` units above it, and the rapids' weight
// there, `radius` river radii from its middle (as rapidsGlsl()'s).
export const rapidsTravel = (ra, rapids = RAPIDS) => {
  const L = rapidsScale(rapids);
  return (
    (L / rapids.to) * (Math.exp(Math.min(ra, rapids.reach) / L) - 1) +
    Math.max(ra - rapids.reach, 0) / rapids.from
  );
};
export const rapidsWeight = (ra, radius, rapids = RAPIDS) =>
  (1 - smooth(rapids.reach * rapids.ease[0], rapids.reach * rapids.ease[1], ra)) *
  (1 - smooth(1, 1.2, radius));
// The rapids' frame at the falls (drop: riverFalls()): the lip, the flow's
// heading, across it (perp: the sign of the river's own across), and each
// stream's brink on the fault, its distance up from the lip along the flow as
// a quadratic in the distance across (least squares over the falls' streams).
export function rapidsFrame(drop) {
  const { lip, heading } = drop,
    [hx, hz] = heading,
    perp = [hz, -hx],
    points = [...Array(15).keys()].map((c) => {
      const w = (c / 14) * 2 - 1,
        bx = lip[0] - hz * lip[2] * w,
        bz = lip[1] + hx * lip[2] * w,
        b = alongToFault(bx, bz, heading, 0),
        dx = bx + hx * b - lip[0],
        dz = bz + hz * b - lip[1];
      return [dx * perp[0] + dz * perp[1], -(dx * hx + dz * hz)];
    });
  // Normal equations for u = b0 + b1 q + b2 q^2.
  const S = (p) => points.reduce((sum, [q]) => sum + q ** p, 0),
    T = (p) => points.reduce((sum, [q, u]) => sum + u * q ** p, 0),
    A = [
      [S(0), S(1), S(2)],
      [S(1), S(2), S(3)],
      [S(2), S(3), S(4)],
    ],
    y = [T(0), T(1), T(2)],
    det = (m) =>
      m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
      m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
      m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]),
    D = det(A),
    brink = [0, 1, 2].map(
      (k) => det(A.map((row, i) => row.map((v, j) => (j === k ? y[i] : v)))) / D,
    );
  return Object.freeze({ lip: [lip[0], lip[1]], head: [hx, hz], perp, half: lip[2], brink });
}
// The rapids as GLSL for a program, its names prefixed `p` (frame:
// rapidsFrame()): p+"UQ"(xz), the distance up from the lip along the flow and
// across it; p+"RA"(uq), the distance above that stream's brink; p+"W"(ra, r),
// the weight; and p+"Rapids"(q, ra, r, t, fp): the surface's slope along +ra
// and across +q, its white water and its mirror's blur, r river radii from its
// middle at time t, fp units a pixel. Both the ground and the falls' run take
// the same copy, so their patterns meet at the shelf's edge.
export function rapidsGlsl(p, frame, rapids = RAPIDS) {
  const L = rapidsScale(rapids),
    R = rapids.reach,
    [SA, ST, TA, TQ] = rapids.streak,
    [SP, WT, W2, W3, W4, W5] = rapids.waves,
    K = (2 * Math.PI) / SP,
    [LA, LT] = rapids.lace,
    [b0, b1, b2] = frame.brink;
  return `float ${p}H(vec2 q){vec3 r=fract(q.xyx*.1031);r+=dot(r,r.yzx+33.33);return fract((r.x+r.y)*r.z);}
${flowNoiseGlsl(`${p}F`, `${p}H`)}
vec2 ${p}UQ(vec2 xz){vec2 d=xz-${glslVec(...frame.lip)};return vec2(-dot(d,${glslVec(...frame.head)}),dot(d,${glslVec(...frame.perp)}));}
float ${p}RA(vec2 uq){return max(uq.x-(${glsl(b0)}+${glsl(b1)}*uq.y+${glsl(b2)}*uq.y*uq.y),0.);}
float ${p}W(float ra,float r){return (1.-smoothstep(${glsl(R * rapids.ease[0])},${glsl(R * rapids.ease[1])},ra))*(1.-smoothstep(1.,1.2,r));}
vec4 ${p}Rapids(float q,float ra,float r,float t,float fp){
float w=${p}W(ra,r),k=1.-min(ra/${glsl(R)},1.),e=min(ra,${glsl(R)}),sp=${glsl(rapids.to)}*exp(-e/${glsl(L)});
float T=${glsl(L / rapids.to)}*(exp(e/${glsl(L)})-1.)+max(ra-${glsl(R)},0.)/${glsl(rapids.from)}+t;
// Streaks drawn out along the flow, evolving as they go.
vec3 s=${p}F(vec2(q*${glsl(SA)},T*${glsl(ST)}),t*.5);
vec2 g=vec2(s.z*min(${glsl(ST)}/sp,2.)*${glsl(TA)},s.y*${glsl(SA * TQ)})*${glsl(1 / FLOW_RMS)}*smoothstep(1.5,3.,min(${glsl(1 / SA)},sp/${glsl(ST)})/fp);
// Standing waves held in place where it quickens, and a crossing pair off the banks (a diamond).
vec3 waveBend=${p}F(vec2(q*.3,7.1+ra*.11),0.);
vec2 phaseGrad=vec2(${glsl(K)}+1.4*.11*waveBend.z,1.4*.3*waveBend.y);
float ph=ra*${glsl(K)}+1.4*waveBend.x,a=smoothstep(${glsl(W2)},${glsl(W3)},ra)*(1.-smoothstep(${glsl(W4)},${glsl(W5)},ra))*(.8+.2*sin(t*1.3+q))*smoothstep(1.5,3.,min(${glsl(SP)},6.28319/max(length(phaseGrad),1e-4))/fp);
float banks=smoothstep(.6,.95,r),c2=(ra*.92+q*.39)*${glsl(K)}+2.,c3=(ra*.92-q*.39)*${glsl(K)}+.7;
g+=${glsl(WT)}*a*vec2(cos(ph)+.22*banks*(cos(c2)+cos(c3)),.16*banks*(cos(c2)-cos(c3)));
// The wandering standing crest and its reflected normal are one height
// field. Its compressed local wavelength also sets the footprint filter.
g+=${glsl(WT)}*a*cos(ph)*(phaseGrad/${glsl(K)}-vec2(1.,0.));
// Its churn: thickening toward the brink, along the banks and on the waves' crests.
float churn=mix(${glsl(rapids.white[0])},${glsl(rapids.white[1])},k*k)+${glsl(rapids.banks)}*smoothstep(.5,.95,r)+${glsl(rapids.crests)}*a*smoothstep(.5,1.,sin(ph));
// The lace: the borders of cells drifting with the current, thicker where it churns;
// where its cells fall under a few pixels it gives way to its mean.
vec2 lc=vec2(q*${glsl(LA)},T*${glsl(LT)});lc+=.35*${p}F(lc*.45+3.,0.).yz*${glsl(1 / FLOW_RMS)};
vec2 li=floor(lc),lf=fract(lc);float f1=8.,f2=8.;
for(int j=-1;j<=1;j++)for(int i=-1;i<=1;i++){vec2 c=vec2(float(i),float(j)),o=c+vec2(${p}H(li+c),${p}H(li+c+17.3))*.8+.1-lf;float d=dot(o,o);if(d<f1){f2=f1;f1=d;}else if(d<f2)f2=d;}
float cell=min(${glsl(1 / LA)},sp/${glsl(LT)})/fp,lace=(1.-smoothstep(0.,mix(.08,.3,clamp(churn,0.,1.))+1./max(cell,.5),sqrt(f2)-sqrt(f1)))*smoothstep(.15,.6,churn+.3*${p}F(lc*.4+41.,0.).x);
// White streaks drawn out along the flow where it churns, whiter toward the brink.
float streakFoam=mix(.22,smoothstep(.05,.7,s.x),smoothstep(1.5,3.,min(${glsl(1 / SA)},sp/${glsl(ST)})/fp));
float foam=max(mix(lace,.3*churn,clamp(1.5-cell*.25,0.,1.)),streakFoam*smoothstep(.15,.6,churn)*mix(.55,1.,k));
return vec4(g*w,clamp(foam*w,0.,1.),w*(k*${glsl(rapids.rough)}+min(length(g)*4.,.3)));}`;
}

// The upper river's continuous handoff to the cliff shelf, including the
// falls' small surface offset. The cap and the falls borrow this one datum;
// the channel bed remains independent below it.
export function riverShelfLift(x, z, falls = FALLS) {
  const s = faultAlong(x, z),
    last = CLIFF.shelfRows - 1,
    head = (SHORE.shelf + 1.2 * fbm(s / 9, 0.3)) / CLIFF.shelfRows;
  return (
    (0.04 + 0.12 * (last / CLIFF.shelfRows) * fbm(s / 3, last) + falls.lift) *
    (1 - smooth(head, SHORE.shelf, coastDistance(x, z)))
  );
}

// The cap's last cross-section is the falls' first, on the actual irregular
// shelf edge. Both owners use these points rather than nearby cutoff lines.
export function riverRunStart(drop, w) {
  const { lip, heading } = drop,
    [hx, hz] = heading,
    bx = lip[0] - hz * lip[2] * w,
    bz = lip[1] + hx * lip[2] * w,
    brink = alongToFault(bx, bz, heading, 0),
    shelf = (u) =>
      (SHORE.shelf + 1.2 * fbm(faultAlong(bx + hx * u, bz + hz * u) / 9, 0.3)) / CLIFF.shelfRows;
  let from = alongToFault(bx, bz, heading, shelf(brink));
  from = alongToFault(bx, bz, heading, shelf(from));
  return [bx + hx * from, bz + hz * from];
}

// The falls' geometry: across the river (aFall.x, -1 to 1) and along its
// course (aFall.y: 0.8 under the shelf, 0.85 at the brink, 2 at the sea).
// The river meets the fault at a slant, so each of its streams runs on to its
// own brink on the fault: from the shelf's edge, where the river on it ends
// (at the shelf's height there), over the sunken lip, its surface drawing down, then
// off the brink under gravity, pushed out along the flow. This guide carries
// a closed water body: an uneven front and back joined by rounded lateral
// currents, closed under the river at its head and below the sea at its toe.
export function fallsGeometry(drop, height, falls = FALLS, level = SEA.level) {
  const { lip, heading } = drop,
    across = 15,
    [hx, hz] = heading,
    falling = falls.rows - falls.run,
    reach = (x, z, d) => alongToFault(x, z, heading, d),
    // The shelf's last row (cliffGeometry()) at along-shore s: its distance
    // inland of the fault and its height over the land.
    last = CLIFF.shelfRows - 1,
    shelfEdge = (s) => [
      (SHORE.shelf + 1.2 * fbm(s / 9, 0.3)) / CLIFF.shelfRows,
      0.04 + 0.12 * (last / CLIFF.shelfRows) * fbm(s / 3, last),
    ],
    streams = [...Array(across).keys()].map((c) => {
      const w = (c / (across - 1)) * 2 - 1,
        bx = lip[0] - hz * lip[2] * w,
        bz = lip[1] + hx * lip[2] * w,
        brink = reach(bx, bz, 0);
      const [sx, sz] = riverRunStart(drop, w),
        top =
          height.water?.(sx, sz) ?? height(sx, sz) + shelfEdge(faultAlong(sx, sz))[1] + falls.lift,
        edge = top - falls.draw;
      return {
        w,
        start: [sx, sz],
        brink: [bx + hx * brink, bz + hz * brink],
        top,
        edge,
        fall: Math.sqrt((2 * (edge - level + 1)) / 32.2),
      };
    }),
    middle = streams[(across - 1) / 2],
    rows = falls.rows + 1,
    positions = new Float32Array(rows * across * 3),
    attrs = new Float32Array(rows * across * 2);
  for (let r = 0; r < rows; r++)
    streams.forEach(({ w, start, brink, top, edge, fall }, c) => {
      const i = r * across + c;
      if (r <= falls.run) {
        // Over the lip: from under the shelf to the brink, drawing down.
        const a = r / falls.run;
        positions.set(
          [
            start[0] + (brink[0] - start[0]) * a,
            top - (top - edge) * a * a,
            start[1] + (brink[1] - start[1]) * a,
          ],
          i * 3,
        );
        attrs.set([w, 0.8 + 0.05 * a], i * 2);
        return;
      }
      const k = (r - falls.run) / falling,
        t = k * fall,
        v = 0.85 + 1.15 * k,
        hw = lip[2] * (1 + falls.spread * k),
        folding = smooth(1.2, 1.65, v),
        // The middle carries the most water and shoots out farthest; the
        // thinner edges fall closer to the rock, so the curtain bows outward
        // and has body from any side.
        out =
          falls.push * t * (1 - falls.drag * w * w) +
          hw *
            (0.045 *
              (Math.sin(w * 11 + 0.7) * (1 - folding) +
                (Math.sin(w * 11 + 0.9 * Math.sin(w * 4) + k * 3.2) - Math.sin(k * 3.2)) *
                  folding) *
              smooth(0.85, 1.2, v) +
              0.025 *
                (Math.sin(w * 23 + 2.1) * (1 - folding) +
                  (Math.sin(w * 23 + 1.1 * Math.sin(w * 5 + k * 4.7)) -
                    Math.sin(1.1 * Math.sin(k * 4.7))) *
                    folding) *
                smooth(0.9, 1.5, v)),
        // Along the cliff it spreads from its middle's brink.
        x = middle.brink[0] + (brink[0] - middle.brink[0]) * (1 + falls.spread * k),
        z = middle.brink[1] + (brink[1] - middle.brink[1]) * (1 + falls.spread * k);
      positions.set([x + hx * out, edge - 16.1 * t * t, z + hz * out], i * 3);
      attrs.set([w, v], i * 2);
    });
  // Around each course station: the outer face, the rounded right side,
  // the inner face in reverse, and the rounded left side. The lip's surface
  // stays on the river; its depth turns outward as it leaves the brink, then
  // the guide is its inner face, retaining the known clearance from the rock.
  const ring = across * 2 + 4,
    count = rows * ring,
    body = new Float32Array((count + ring) * 3),
    course = new Float32Array((count + ring) * 3),
    depths = new Float32Array(across),
    sides = [0, 1 / 3, 2 / 3, 1];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < across; c++) {
      const i = r * across + c,
        w = attrs[i * 2],
        v = attrs[i * 2 + 1],
        t = Math.max(0, (v - 0.85) / 1.15) * streams[c].fall,
        velocity = Math.hypot(falls.push, 32.2 * t),
        aeration = 1 + 0.25 * smooth(0.95, 1.8, v);
      depths[c] =
        ((falls.depth * falls.push) / velocity) *
        aeration *
        (0.78 + 0.22 * (1 - w * w)) *
        (1 + 0.07 * Math.sin(w * 7.3 + r * 0.43));
    }
    const put = (slot, c, depth) => {
      const source = r * across + c,
        i = r * ring + slot,
        w = attrs[source * 2],
        v = attrs[source * 2 + 1],
        front = smooth(0.85, 1.05, v),
        out = depths[c] * front * (1 - depth),
        down = depths[c] * (1 - front) * depth,
        bulge = 0.08 * Math.sin(depth * Math.PI) * Math.sign(w);
      body.set(
        [
          positions[source * 3] + hx * out - hz * bulge,
          positions[source * 3 + 1] - down,
          positions[source * 3 + 2] + hz * out + hx * bulge,
        ],
        i * 3,
      );
      course.set([w, v, depth], i * 3);
    };
    for (let c = 0; c < across; c++) put(c, c, sides[0]);
    put(across, across - 1, sides[1]);
    put(across + 1, across - 1, sides[2]);
    for (let c = 0; c < across; c++) put(across + 2 + c, across - 1 - c, sides[3]);
    put(ring - 2, 0, sides[2]);
    put(ring - 1, 0, sides[1]);
  }
  const indices = new Uint16Array(((rows - 1) * ring * 2 + ((across - 1) * 2 + 4) * 2) * 3);
  let k = 0;
  for (let r = 0; r < rows - 1; r++)
    for (let c = 0; c < ring; c++) {
      const a = r * ring + c,
        b = r * ring + ((c + 1) % ring),
        d = a + ring,
        e = b + ring;
      indices.set([a, b, d, b, e, d], k);
      k += 6;
    }
  // The submerged upstream closure has its own normal. Sharing it with the
  // water's first row would tilt the upper surface into a false raised bar.
  body.set(body.subarray(0, ring * 3), count * 3);
  course.set(course.subarray(0, ring * 3), count * 3);
  for (const r of [0, rows - 1]) {
    // Paired front/back strips follow the concave folded profile. A fan from
    // its centroid would cross folds and reverse some submerged toe faces.
    const cap = (a, b, c) => {
      const at = r ? r * ring : count;
      indices.set(r ? [at + a, at + b, at + c] : [at + a, at + c, at + b], k);
      k += 3;
    };
    for (let c = 0; c < across - 1; c++) {
      const back = across + 2 + across - 1 - c;
      cap(c, c + 1, back);
      cap(c + 1, back - 1, back);
    }
    cap(across - 1, across, across + 1);
    cap(across - 1, across + 1, across + 2);
    cap(ring - 3, ring - 2, ring - 1);
    cap(ring - 3, ring - 1, 0);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(body, 3));
  geometry.setAttribute("aFall", new BufferAttribute(course, 3));
  geometry.setIndex(new BufferAttribute(indices, 1));
  geometry.userData.falls = { across, ring, rows };
  geometry.computeVertexNormals();
  const out = falls.push * middle.fall;
  return {
    geometry,
    plunge: [middle.brink[0] + hx * out, middle.brink[1] + hz * out, lip[2] * falls.plunge],
  };
}

function fallsFragment(falls, lib, run = [1, 41, 1, 0], frame = null, rapids = RAPIDS) {
  const [hx, hz] = frame?.head ?? [1, 0];
  return `#define SEA_PI 3.1415927
uniform float seaTime, fallsFlow;
uniform vec4 uMist, babelFlash;
uniform mat4 projectionMatrix;
varying vec3 vW, vN;
varying vec4 vSlateClip;
varying vec3 vF;
varying float vSeaY;
${lib.SLATE_TEXT_GUARD}
${lib.MIST_PARS}
${ENV_PARS}
${NOISE_GLSL}
${sprayGlsl(falls)}
${coastGlsl()}
${flowNoiseGlsl("fallsSheet", "seaHash")}
${frame ? rapidsGlsl("fallsRp", frame, rapids) : ""}
void main(){
// It whitens over the first eighth of its drop (its rows are spaced by time: v 1.25 is about 12% of the height down).
float a=abs(vF.x),v=vF.y,fall=smoothstep(.86,1.1,v),white=smoothstep(.9,1.25,v),q=vF.x+.18*vF.z;
// Its streams: ribbons sliding down with the water, finer ones over them (each
// fading to its mean under the pixel, across and along). They move with its
// travel time to v (slow over the lip, then speeding up; the falling rows are
// spaced by time), so they stretch as it speeds up and never shear as time
// runs on. Their density d keeps the same contrast whichever of them the pixel
// resolves, so from afar the falls still read as streams of white water, never
// one smooth band.
float tau=min(v,.86)/.8+.0706*log(1.+4.25*clamp((v-.86)/.24,0.,1.))+max(v-1.1,0.)/4.2;
float fx=fwidth(q),ft=fwidth(tau);
float a1=1.-smoothstep(.3,1.05,max(fx*6.,ft*4.5)),a2=1.-smoothstep(.3,1.05,max(fx*16.,ft*5.)),a3=1.-smoothstep(.32,1.06,max(fx*40.,ft*10.));
// Broad channels wander and merge; finer aerated folds ride them. Their
// coordinates follow travel time, so neither the lip nor the falling sheet
// slides at a constant world speed or resets its clock at a cut.
vec3 bend=fallsSheet(vec2(q*2.3+.7,tau*.5-seaTime*.3),seaTime*.13);
float r1=mix(.5,.5+.5*fallsSheet(vec2(q*6.+bend.x*.9,4.5*(tau-.6*seaTime)),seaTime*.35).x,a1),r2=mix(.5,.5+.5*fallsSheet(vec2(q*16.+bend.x*1.7+3.,5.*(tau-.6*seaTime)),seaTime*.53).x,a2),r3=mix(.5,.5+.5*fallsSheet(vec2(q*40.+bend.x*2.4+7.,10.*(tau-.6*seaTime)),seaTime*.71).x,a3);
float streak=r1*.45+r2*.35+r3*.2,d=smoothstep(.22,.78,.5+(streak-.5)*1.4/max(.3,sqrt(.2025*a1*a1+.1225*a2*a2+.04*a3*a3)));
// The closed skin defines the silhouette. The same current turns around its
// real lateral faces; froth may thin, but never discards a wall of the body.
float side=4.*vF.z*(1.-vF.z),edge=max(side,1.-smoothstep(.62-fx,1.+fx,a+.3*(r2-.5)*smoothstep(.86,1.,v)+.4*smoothstep(1.2,2.,v)*(r1-.5)));
// Where it runs over the lip, in the rapids' frame (the shelf's, ocean.js rapidsFrame()).
${frame ? "vec2 rpU=fallsRpUQ(vW.xz);float rpA=fallsRpRA(rpU),rpFP=max(length(fwidth(vW.xz)),1e-4);" : ""}
vec3 E=normalize(cameraPosition-vW),n=normalize(vN);
// Over the lip it is the river's rapids (RAPIDS: the shelf's own, on the ground's
// clock, so they meet at its edge): their streaks, standing waves and white
// water, breaking white at each stream's own brink (raV units up from it), its
// smooth middle (the tongue) last and its sides first. Falling, it whitens into
// its streams over thinner white water between them (never a mirror), and its
// edges feather into that thinner water.
float raV=max(.85-v,0.)*${glsl(run[1])};
${
  frame
    ? `vec4 rp=fallsRpRapids(rpU.y,rpA,a,fallsFlow,rpFP)*(1.-fall);
vec3 rn=normalize(n-vec3((${glsl(-hx)})*rp.x+(${glsl(hz)})*rp.y,0.,(${glsl(-hz)})*rp.x-(${glsl(hx)})*rp.y));`
    : "vec4 rp=vec4(0.);vec3 rn=n;"
}
float tongue=1.-smoothstep(.15,.45,a),crest=(1.-smoothstep(0.,${glsl(rapids.brink[0])}*(1.-${glsl(rapids.tongue)}*tongue),raV))*(1.-fall);
float runFoam=max(rp.z,${glsl(rapids.brink[1])}*crest*(.7+.3*rp.z));
// Adjacent streams aerate at slightly different depths, keeping the head
// joined while white water gathers gradually into broader current clusters.
white=smoothstep(.92+.045*bend.x-.04*smoothstep(.2,.5,a),1.26+.065*bend.x,v);
float foam=mix(max(smoothstep(.5,.9,streak)*.4*smoothstep(.835,.87,v),runFoam),mix(.08,.98,d),white)*mix(1.,smoothstep(.02,.45,edge),fall);
// Near the plunge, broken pockets of aerated water interrupt long ribbons
// without widening the sheet or adding another particle/effect pass.
// Packets of denser white water fall through the streams, each at its own pace.
foam*=mix(1.,.7+.6*smoothstep(.25,.75,.5+.5*fallsSheet(vec2(q*2.6+5.,1.3*(tau-.75*seaTime)),seaTime*.2).x),white*a1);
float impact=smoothstep(1.5,2.,v)*(.5+.5*bend.x);
foam=mix(foam,max(foam,.4+.5*r2),impact*.45);
// Fine streams thin unevenly into the existing impact cloud. Lower coverage
// changes optical thickness, not geometry or an opaque grey overlay.
float toe=1.-smoothstep(vSeaY+.15,vSeaY+1.8,vW.y);
foam*=1.-toe*.45*(1.-smoothstep(.2,.7,r2));
float b=slateBehindText();
vec3 R=reflect(-E,rn);R.y=max(R.y,.08);
// Its mirror at the river's gain, through its knee, blurred where the rapids are steep.
vec3 water=seaEnv(normalize(R),.25+.5*rp.w)*(.02+.98*pow(1.-max(dot(rn,E),0.),5.))*${glsl(2 * SEA.sky)};
float wY=dot(water,vec3(.2126,.7152,.0722));water=vec3(.004,.007,.009)+water*${glsl(SEA.knee)}*(1.-exp(-wY/${glsl(SEA.knee)}))/max(wY,1e-5);
// Lit through as well as on: falling white water scatters the light from every side, as the surf does.
// Falling, it is a cloud of droplets: lit through, it glows toward an eye looking into the moon (FALLS.scatter).
vec3 lit=(mix(seaLight(n,babelFlash.x*(1.-b)),seaLight(vec3(0.,1.,0.),babelFlash.x*(1.-b)),white)+seaKeyColor*(.25/SEA_PI+${glsl(falls.scatter[1])}*seaHG(dot(-seaKey,E),${glsl(falls.scatter[0])})*white))*${glsl(falls.albedo)};
// Falling, the water between its streams is thinner white water, never a mirror: only the lip is glassy.
// Over the lip it takes the river's bluer, brighter sheen (the ground's own mirror of the film's sky),
// and its froth the shelf's soil-lit froth's light, up from the crest (RAPIDS.run).
water*=mix(vec3(1.),vec3(1.25,1.25,1.5),1.-fall);
// Glassy over the lip, it catches the moon.
water+=seaGGX(rn,E,.07+.3*rp.w,.02)*(1.-white)*(1.-.8*b);
lit*=mix(1.,${glsl(rapids.run)},smoothstep(.3,1.6,raV)*(1.-fall));
water=mix(water,lit*.12,white);
vec3 c=mix(water,lit,foam*(1.-${glsl(SEA.text)}*b));
${landMist(lib)}
gl_FragColor=vec4(c,${SEA_SHARED.layer});
}`;
}

// The falls for a scene (drop: riverFalls()), lit as the sea is, and dispose().
// Its plunge ([x, z, radius]) is where the sea's white water gathers.
export function createFalls({
  lib,
  clock,
  rendering,
  drop,
  height,
  falls = FALLS,
  flow = null,
} = {}) {
  const { geometry, plunge } = fallsGeometry(drop, height, falls),
    uniforms = sharedUniforms(lib, clock, plunge, falls),
    frame = rapidsFrame(drop),
    // The run over the lip in the river's own units: its half-width, its length
    // per unit of aFall.y (the middle stream's) and the flow's heading.
    p = geometry.attributes.position,
    { across, ring } = geometry.userData.falls,
    middle = (across - 1) / 2,
    brink = falls.run * ring + middle,
    run = [
      drop.lip[2],
      Math.hypot(p.getX(brink) - p.getX(middle), p.getZ(brink) - p.getZ(middle)) / 0.05,
      ...drop.heading,
    ];
  // The run over the lip keeps the ground's clock (terrain-build.js passes it), so its rapids meet the shelf's.
  uniforms.fallsFlow = flow ?? clock.uniform;
  const material = new ShaderMaterial({
    name: "EstateFalls",
    uniforms,
    side: 0,
    vertexShader: `attribute vec3 aFall;
varying vec3 vW, vN;
varying vec4 vSlateClip;
varying vec3 vF;
varying float vSeaY;
void main(){
vec4 w=modelMatrix*vec4(position,1.);
vW=w.xyz;vN=normalize(mat3(modelMatrix)*normal);vF=aFall;vSeaY=modelMatrix[3].y+${glsl(SEA.level)};
gl_Position=projectionMatrix*viewMatrix*w;
vSlateClip=gl_Position;
}`,
    fragmentShader: fallsFragment(falls, lib, run, frame),
    extensions: { derivatives: true },
  });
  const update = lighting(rendering, material, uniforms);
  const mesh = new Mesh(geometry, material);
  mesh.name = "estate-falls";
  mesh.castShadow = mesh.receiveShadow = false;
  mesh.renderOrder = 0.6;
  mesh.onBeforeRender = update;
  return {
    mesh,
    material,
    plunge,
    dispose() {
      mesh.removeFromParent();
      mesh.geometry.dispose();
      material.dispose();
    },
  };
}
