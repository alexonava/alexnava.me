import { Box3, BufferAttribute, BufferGeometry, Mesh, ShaderMaterial, Vector3 } from "three";
import { COAST_DETAIL, createCoastDetail } from "./coast-detail.js";

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
// amount, heading] of the surface's slopes (normals only); ripple: noise
// octaves' wavelengths and slope; each fades where it would fall under three
// pixels, its slope turning to roughness (rough: a calm surface's own). body:
// the deep water's colour. sky, f0, knee: the river's mirror (terrain-build.js
// PUDDLE_MIRROR, at half its gain: a whole open sea at the river's would
// outshine the sky it mirrors); horizon: how far its sky is lifted where it is
// read (the open sea's horizon has no ranges to mirror). mask: how far the
// slopes a pixel holds lean toward the eye where it grazes (in their spread).
// glitter: the moon's highlight: its gain, roughness floor and knee. surf:
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
  ripple: Object.freeze([5.5, 0.12, 0.45]),
  rough: 0.05,
  body: Object.freeze([0.004, 0.0075, 0.01]),
  sky: 1.2,
  f0: 0.02,
  knee: 0.5,
  horizon: 0.08,
  mask: 0.8,
  glitter: Object.freeze({ gain: 1, alpha: 0.07, knee: 0.3 }),
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
float seaFoam(vec2 p){return .6*seaNoise(mat2(.8,.6,-.6,.8)*p)+.4*seaNoise(mat2(.28,-.96,.96,.28)*p*2.13+5.2);}`;
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
vec3 seaLight(vec3 n,float flash){return seaDiffuse(n)/SEA_PI+seaEnv(n,1.)*(1.+flash);}`;

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
  const waves = waveTerms(sea.waves)
      .map(
        ({ k, a, d, w, length }, i) =>
          `{float f=smoothstep(1.5,3.,${glsl(length)}/fp),s=${glsl(a * k)}*cos(dot(${glslVec(...d)},P.xz)*${glsl(k)}-seaTime*${glsl(w)}+${glsl(i * 2.3)}+(phaseWarp.x-.5)*1.4*warpFade);g+=(${glslVec(...d)}+phaseWarp.yz*${glsl(1.4 / (31 * k))}*warpFade)*s*f;v+=${glsl((a * k) ** 2 * 0.5)}*(1.-f*f);}`,
      )
      .join("\n"),
    [rl, rs, rk] = sea.ripple,
    { surf, glitter } = sea;
  // Three octaves of turned value noise (wavelengths rl, rl*rk, rl*rk^2), each with slope rs.
  const ripple = [0, 1, 2]
    .map((o) => {
      const l = rl * rk ** o,
        a = (o * 1.1 + 0.4) % (2 * Math.PI),
        m = `mat2(${glsl(Math.cos(a))},${glsl(Math.sin(a))},${glsl(-Math.sin(a))},${glsl(Math.cos(a))})`;
      return `{vec3 n=seaNoiseD(${m}*P.xz/${glsl(l)}+seaTime*${glslVec(0.05 + 0.03 * o, -0.04 + 0.05 * o)});float f=smoothstep(1.5,3.,${glsl(l)}/fp);g+=(n.yz*${m})*f*${glsl(rs / l)};v+=${glsl(rs * rs * 0.15)}*(1.-f*f);}`;
    })
    .join("\n");
  return `#define SEA_PI 3.1415927
uniform float seaTime, seaLace;
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
${sprayGlsl(FALLS)}
${stackOutlineGlsl()}
void main(){
vec3 V=vSeaW-cameraPosition;float L=length(V);V/=max(L,1e-4);
float h=max(cameraPosition.y-vSeaY,.05),t=min(h/max(-V.y,1e-5),1e4);
// The sea's own point along the ray (the level plane), even where the rim has risen.
vec3 P=cameraPosition+V*t;
// The pixel's footprint there: its angle at that distance, stretched along a grazing ray.
float fp=max(t*length(fwidth(V))/max(-V.y,.01),1e-3);
float d=seaCoast(P.xz);
if(d>${glsl(sea.margin)})discard;
float z=-d;
vec2 g=vec2(0.);float v=${glsl(sea.rough * sea.rough)};
// Broad, slow phase variation breaks long ruled crests; its derivative
// keeps the reflected normal consistent, and unresolved waves still fade.
vec3 phaseWarp=seaNoiseD(P.xz/31.+seaTime*vec2(.008,-.006));
float warpFade=smoothstep(1.5,3.,31./fp);
${waves}
${ripple}
// Broad slicks: patches of calmer and rougher water drifting with the wind.
float slick=.5+(seaNoise(P.xz/90.+seaTime*vec2(.004,.003))-.5)*.65*smoothstep(1.5,3.,90./fp)+(seaNoise(P.xz/37.-seaTime*vec2(.006,.002))-.5)*.35*smoothstep(1.5,3.,37./fp);
v*=mix(.45,1.6,smoothstep(.25,.75,slick));
// At a graze the facets facing the eye hide the rest: the slopes the pixel holds tilt toward the eye, mirroring higher sky, more weakly.
float s=sqrt(v);vec2 eh=normalize(-V.xz+1e-6);
vec3 N=normalize(vec3(-g.x+eh.x*${glsl(sea.mask)}*s*(1.-smoothstep(.1,.6,-V.y)),1.,-g.y+eh.y*${glsl(sea.mask)}*s*(1.-smoothstep(.1,.6,-V.y)))),E=-V;
// Near the horizon the surface's slopes blur its mirror (grazing, the slopes along the ray stretch it).
float rough=s+.65*(1.-smoothstep(.02,.3,-V.y));
vec3 R=reflect(V,N);R.y=${glsl(sea.horizon)}+(1.-${glsl(sea.horizon)})*max(R.y,0.);R=normalize(R);
float ne=max(dot(N,E),0.),F=${glsl(sea.f0)}+${glsl(1 - sea.f0)}*pow(1.-ne,5.);
float b=slateBehindText();
vec3 sky=seaEnv(R,clamp(rough*1.8,0.,1.))*${glsl(sea.sky)}*(1.+babelFlash.y*(1.-b));
// Under the cliffs the water mirrors their dark face, not the sky: the true reflected ray,
// sampled a few times out to 50 units, meets the rock (inside the fault by more than the
// face's lean) below the plain's height, along the wall and in the falls' slot too.
// Farther out it clears the cliffs and mirrors the sky. The face, lit as it faces the
// water, keeps a (tiny) non-constant height: a constant zero would leave the env lookup
// inside seaLight() an unreachable division by zero, which D3D warns of (X4008).
if(z>-${glsl(sea.margin)}&&z<60.){vec3 Rt=reflect(V,N);float face=0.;
for(int i=0;i<5;i++){float tt=2.+3.*float(i*i);
face=max(face,smoothstep(1.,3.,seaCoast(P.xz+Rt.xz*tt))*(1.-smoothstep(${glsl(1.25 - sea.level - 1.5)},${glsl(1.25 - sea.level + 1)},Rt.y*tt)));}
sky=mix(sky,${glslVec(...CLIFF.rock[0])}*${glsl(STACKS.wet)}*seaLight(-normalize(vec3(Rt.x+1e-4,Rt.y*1e-4,Rt.z)),babelFlash.x*(1.-b)),face);}
// The water's mirror, through the river's knee (keeping its hue).
vec3 refl=sky*F;float rY=dot(refl,vec3(.2126,.7152,.0722));refl*=${glsl(sea.knee)}*(1.-exp(-rY/${glsl(sea.knee)}))/max(rY,1e-5);
// The moon's glitter: a GGX lobe at the slopes the pixel holds (Smith-masked), through its own knee.
vec3 Hm=normalize(seaKey+E);float nh=max(dot(N,Hm),0.),nl=max(dot(N,seaKey),0.),ag=max(s,${glsl(glitter.alpha)}),a2=ag*ag,dn=nh*nh*(a2-1.)+1.;
float gL=2.*nl/(nl+sqrt(a2+(1.-a2)*nl*nl)+1e-5),vis=1./(2.*(ne+sqrt(a2+(1.-a2)*ne*ne))+1e-5);
vec3 glit=seaKeyColor*(a2/(SEA_PI*dn*dn))*(${glsl(sea.f0)}+${glsl(1 - sea.f0)}*pow(1.-max(dot(E,Hm),0.),5.))*gL*nl*vis*${glsl(glitter.gain)};
float gY=dot(glit,vec3(.2126,.7152,.0722));glit*=${glsl(glitter.knee)}*(1.-exp(-gY/${glsl(glitter.knee)}))/max(gY,1e-5);
// Behind the text the light keeps 70%, then passes the ground's text knee.
refl=slateTextKnee(refl*(1.-.3*b),b);glit=slateTextKnee(glit*(1.-.3*b),b);
vec3 c=${glslVec(...sea.body)}*(1.-F)+refl+glit;
// White water at the cliffs' foot: swells breaking against the rock, broken along it, and a far mean where they fall under pixels.
float sf=0.;
${stacksSurfGlsl()}
if(z<${glsl(surf.reach)}||sf>0.){
float u=fract(z/${glsl(surf.period)}+seaTime*${glsl(surf.speed / surf.period)}+.14*sin(P.x*.13+P.z*.09)),n=seaNoise(P.xz/${glsl(surf.cell)}+seaTime*vec2(.03,-.02));
float burst=smoothstep(${glsl(1 - surf.cover)},${glsl(1 - surf.cover + 0.25)},n)*exp(-u*2.6);
// How thick the white water lies: a narrow lace against the rock (the fault's distance
// runs short in its fractures' corners, so never a solid band there); a
// breaking swell surging in thinner near it, so it breaks into strands, never one
// flat sheet; about the stacks (breathing with the swell) and in the churning heart
// of where the falls land; beyond, it thins into lace.
float k=max(.75*(1.-smoothstep(.3,2.6+fp,z)),.6*burst*(1.-smoothstep(${glsl(surf.reach * 0.15)},${glsl(surf.reach * 0.6)},z)));
k=max(k,sf*(.85+.15*sin(seaTime*1.3+P.x*.2+P.z*.13)));
if(seaFalls.w>0.){
vec2 pool=(P.xz-seaFalls.xy)/seaFalls.z;
// A persistent turbulent core, with broken expanding fans carried seaward.
float pr=length(pool),angle=atan(pool.y,pool.x),fan=sin(pr*10.-seaTime*1.7+1.4*sin(angle*3.));
float core=1.-smoothstep(.06,.3,pr),wash=.45*(1.-smoothstep(.25,.95,pr))*mix(.5,1.,smoothstep(-.4,.8,fan))*(.65+.35*seaFoam(pool*3.+seaTime*.08));
k=max(k,max(core,wash));}
// Thick, it covers the water; thinning, only its lace's strands stay, drifting.
// The balanced tier, and white water under the pixel, take its mean.
// Against the rock it lies solid; elsewhere the swell's patches thin it a little.
k*=.86+.14*smoothstep(.25,.75,n);
vec2 fq=mat2(.8,.6,-.6,.8)*(P.xz/1.6+seaTime*vec2(.12,-.08));
fq+=vec2(.4*sin(fq.y*.6+seaTime*.17),.3*sin(fq.x*.4-seaTime*.12));
float far=clamp(fp*1.2-.6,0.,1.),lace=.65*seaFoam(fq)+.35*seaFoam(fq*2.7+3.1),fw=.18+fp*.6;
float foam=mix(k,smoothstep(1.-k-fw,1.-k+fw,lace),seaLace*(1.-far));
foam=mix(foam,max(${glsl(surf.far)}*(1.-smoothstep(0.,${glsl(surf.reach)},z)),.45*sf),far);
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
    (y +
      1.5 * Math.sin(s / 31 + 0.7) +
      0.45 * Math.sin(s / 9.3 + 1.1) +
      s * 0.02 +
      0.2 * Math.sin(y * 1.9 + s * 0.035)) /
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
float coastBedPhase(float s,float y,float bed){return (y+1.5*sin(s/31.+.7)+.45*sin(s/9.3+1.1)+s*.02+.2*sin(y*1.9+s*.035))/bed;}
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
// albedo, so seen through the mist it never stands paler than the sea.
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
  wet: 0.5,
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
float yb=coastBedPhase(vC.x,vRock.y,${glsl(cliff.bed)});
float bi=floor(yb),bf=fract(yb),bh=seaHash(vec2(bi,.7));
// Long fractures run across several beds, with short splinters between them.
// They interrupt strata instead of making a staggered masonry grid.
float fracture=vC.x/7.3+.24*seaNoise(vec2(vRock.y*.23,2.7))+.12*seaNoise(vec2(vC.x*.29,vRock.y*.4));
float ub=fracture+(seaHash(vec2(floor(vRock.y/5.7),4.4))-.5)*.16;
float ji=floor(ub),jf=fract(ub),hb=seaHash(vec2(bi*1.31,ji)),hc=seaHash(vec2(ji,bi*.73+5.));
float px=max(fwidth(vC.x),fwidth(vRock.y)),detail=(1.-smoothstep(.06,.3,px))*side;
// Joints: some open, some tight; the bedding planes open only here and there.
float joint=min(jf,1.-jf)*7.3*(.6+.8*seaNoise(vec2(vRock.y*1.7,ji))),plane=min(bf,1.-bf)*${glsl(cliff.bed)}*(.6+.8*seaNoise(vec2(vC.x*.9,bi)));
float fu=ub*3.1+hb,fine=(1.-smoothstep(.01,.04+px,min(fract(fu),1.-fract(fu))*7.3/3.1))*smoothstep(.5,.8,seaHash(vec2(floor(fu),bi*2.)))*.5*(1.-smoothstep(.02,.06,px));
float crack=max(fine,max((1.-smoothstep(.02,.11+2.*px,joint))*smoothstep(.15,.55,seaHash(vec2(ji,floor(bi/3.)+1.5))),(1.-smoothstep(.015,.07+2.*px,plane))*smoothstep(.3,.75,seaNoise(vec2(vC.x/5.,bi))))*(1.-smoothstep(.03,.16,px)))*detail;
crack=max(crack,.75*coastFracture(vC.x,vRock.y,vC.y)*side);
vec3 alb=mix(${glslVec(...dark)},${glslVec(...pale)},.2+.45*bh*side+.25*n2.x)*(.8+.4*n3.x)*mix(1.,.85+.3*hb,detail);
// Thinner beds of uneven thickness within the broad ones, each its own tone, so the face never reads as regular stripes.
float yt=(vRock.y+.45*seaNoise(vec2(vC.x/6.,4.1))+.6*seaNoise(vec2(vC.x/23.,1.7))+.25*seaNoise(vec2(vRock.y*.37,9.3)))/${glsl(cliff.beds)};
alb*=mix(1.,.84+.32*seaHash(vec2(floor(yt),3.3)),detail*.85);
// Broad weathering over the face, then the cracks and each bed's shaded underside.
alb*=(.85+.3*seaNoise(vec2(vC.x/8.,vRock.y/5.)))*(1.-.5*crack)*mix(1.,.8+.2*smoothstep(0.,.35,bf),detail);
// Stains washed down the face under its ledges.
alb*=1.-.22*side*smoothstep(.55,.85,seaNoise(vec2(vC.x*1.4,vRock.y*.13)));
// The shelf takes the plain's dust up to the break, so it meets the terrain without a seam; the stacks stand dark with spray.
alb=mix(alb,${glslVec(...cliff.dust)}*(.85+.3*n3.x),top*smoothstep(.2,1.,-vC.z));
alb*=mix(1.,${glsl(STACKS.wet)},step(1.5,vC.y));
vec3 t=normalize(mix(cross(n,vec3(0.,1.,0.)),cross(n,vec3(0.,0.,1.)),top)+1e-4),bt=cross(t,n);
// Each block's own facet, and the bed's lip tipped up to the light, its underside down.
n=normalize(n+(t*(hb-.5)*.4+bt*(hc-.5)*.3+vec3(0.,smoothstep(.72,1.,bf)*.35-smoothstep(.3,0.,bf)*.25,0.))*detail+(t*(n1.y*.5+n2.y*.35+n3.y*.15)+bt*(n1.z*.5+n2.z*.35+n3.z*.15))*.3);
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
  // The detached terrain owns these buffers until the complete shore owner
  // exists. Clearing its record transfers disposal to this owner exactly once.
  if (prepared) prepared.cliff = prepared.stacks = null;
  return {
    mesh,
    material,
    setActive: (active) => detail.setActive(active),
    take: (state) => detail.take(state),
    dispose() {
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
    gloss: Object.freeze({ film: 0.32, gain: 1.9, cool: 0 }),
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
    // The near clifftop burned down under the name (its moonlit crests held it under 5:1).
    ground: Object.freeze({
      ...COAST_LOOK.ground,
      burn: Object.freeze({ amount: 0.4, reach: Object.freeze([0.55, 0.85]) }),
    }),
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
    portrait: Object.freeze({ azimuth: -60, reach: 46, rise: 16, fovMax: 62 }),
    // Short landscape phones hold it still, farther back, higher and a little
    // wider for their short frame.
    landscape: Object.freeze({ move: null, azimuth: -55, reach: 42, rise: 15, fovMax: 48 }),
    azimuth: -44,
    reach: 32,
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
    // The plain under the name burned down, as The broken coast's.
    ground: Object.freeze({
      ...COAST_LOOK.ground,
      burn: Object.freeze({ amount: 0.5, reach: Object.freeze([1.1, 1.8]) }),
    }),
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
// its albedo.
export const FALLS = Object.freeze({
  lift: -0.01,
  run: 3,
  draw: 0.12,
  rows: 22,
  push: 4,
  drag: 0.25,
  spread: 0,
  albedo: 0.5,
  plunge: 2.2,
  spray: Object.freeze([3.1, 0.55, 0.085, 0.42]),
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

// The falls' geometry: across the river (aFall.x, -1 to 1) and along its
// course (aFall.y: 0.8 under the shelf, 0.85 at the brink, 2 at the sea).
// The river meets the fault at a slant, so each of its streams runs on to its
// own brink on the fault: from the shelf's edge, where the river on it ends
// (at the shelf's height there), over the sunken lip, its surface drawing down, then
// off the brink under gravity, pushed out along the flow. The sheet's top so
// follows the lip and the curtain hangs along the cliff, spreading along it
// (never into it), folding into the curtains its streams make as it falls.
export function fallsGeometry(drop, height, falls = FALLS, level = SEA.level) {
  const { lip, heading } = drop,
    across = 15,
    [hx, hz] = heading,
    falling = falls.rows - falls.run,
    // How far along the flow from (x, z) the fault's distance is `d`.
    reach = (x, z, d) => {
      let u = 0;
      for (let n = 0; n < 8; n++) {
        const g =
          (coastDistance(x + hx * (u + 0.01), z + hz * (u + 0.01)) -
            coastDistance(x + hx * (u - 0.01), z + hz * (u - 0.01))) /
          0.02;
        u -= (coastDistance(x + hx * u, z + hz * u) - d) / (g < -0.1 ? g : -0.8);
      }
      return u;
    },
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
      let from = reach(bx, bz, shelfEdge(faultAlong(bx + hx * brink, bz + hz * brink))[0]);
      from = reach(bx, bz, shelfEdge(faultAlong(bx + hx * from, bz + hz * from))[0]);
      const sx = bx + hx * from,
        sz = bz + hz * from,
        top = height(sx, sz) + shelfEdge(faultAlong(sx, sz))[1] + falls.lift,
        edge = top - falls.draw;
      return {
        w,
        start: [bx + hx * from, bz + hz * from],
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
        // The middle carries the most water and shoots out farthest; the
        // thinner edges fall closer to the rock, so the curtain bows outward
        // and has body from any side.
        out =
          falls.push * t * (1 - falls.drag * w * w) +
          hw *
            (0.045 * Math.sin(w * 11 + 0.7) * smooth(0.85, 1.2, v) +
              0.025 * Math.sin(w * 23 + 2.1) * smooth(0.9, 1.5, v)),
        // Along the cliff it spreads from its middle's brink.
        x = middle.brink[0] + (brink[0] - middle.brink[0]) * (1 + falls.spread * k),
        z = middle.brink[1] + (brink[1] - middle.brink[1]) * (1 + falls.spread * k);
      positions.set([x + hx * out, edge - 16.1 * t * t, z + hz * out], i * 3);
      attrs.set([w, v], i * 2);
    });
  const indices = new Uint16Array((rows - 1) * (across - 1) * 6);
  let k = 0;
  for (let r = 0; r < rows - 1; r++)
    for (let c = 0; c < across - 1; c++) {
      const a = r * across + c,
        b = a + 1,
        d = a + across,
        e = d + 1;
      indices.set([a, d, b, b, d, e], k);
      k += 6;
    }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("aFall", new BufferAttribute(attrs, 2));
  geometry.setIndex(new BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  const out = falls.push * middle.fall;
  return {
    geometry,
    plunge: [middle.brink[0] + hx * out, middle.brink[1] + hz * out, lip[2] * falls.plunge],
  };
}

function fallsFragment(falls, lib, run = [1, 41, 1, 0]) {
  return `#define SEA_PI 3.1415927
uniform float seaTime;
uniform vec4 uMist, babelFlash;
uniform mat4 projectionMatrix;
varying vec3 vW, vN;
varying vec4 vSlateClip;
varying vec2 vF;
varying float vSeaY;
${lib.SLATE_TEXT_GUARD}
${lib.MIST_PARS}
${ENV_PARS}
${NOISE_GLSL}
${sprayGlsl(falls)}
${coastGlsl()}
void main(){
// It whitens over the first eighth of its drop (its rows are spaced by time: v 1.25 is about 12% of the height down).
float a=abs(vF.x),v=vF.y,fall=smoothstep(.86,1.1,v),white=smoothstep(.9,1.25,v);
// Its streams: ribbons sliding down with the water, finer ones over them (each
// fading to its mean under the pixel, across and along). They move with its
// travel time to v (slow over the lip, then speeding up; the falling rows are
// spaced by time), so they stretch as it speeds up and never shear as time
// runs on. Their density d keeps the same contrast whichever of them the pixel
// resolves, so from afar the falls still read as streams of white water, never
// one smooth band.
float tau=min(v,.86)/.8+.0706*log(1.+4.25*clamp((v-.86)/.24,0.,1.))+max(v-1.1,0.)/4.2;
float fx=fwidth(vF.x),ft=fwidth(tau);
float a2=1.-smoothstep(.3,1.05,max(fx*21.,ft*16.8)),a3=1.-smoothstep(.32,1.06,max(fx*53.,ft*37.8));
float r1=seaNoise(vec2(vF.x*8.,6.72*tau-3.36*seaTime)),r2=mix(.5,seaNoise(vec2(vF.x*21.+3.,16.8*tau-6.3*seaTime)),a2),r3=mix(.5,seaNoise(vec2(vF.x*53.+7.,37.8*tau-10.92*seaTime)),a3);
float streak=r1*.5+r2*.32+r3*.18,d=smoothstep(.25,.75,.5+(streak-.5)*1.4/sqrt(.25+.1024*a2*a2+.0324*a3*a3));
// Ragged edges; near its foot the sheet tears into ribbons.
float edge=1.-smoothstep(.62,1.,a+.3*(r2-.5)*smoothstep(.86,1.,v)+.3*smoothstep(1.2,2.,v)*(r1-.5));
if(edge<.02||d<.4*smoothstep(1.8,2.,v))discard;
vec3 E=normalize(cameraPosition-vW),n=normalize(vN);
if(dot(n,E)<0.)n=-n;
// Over the lip it is the river itself: its ripples (the river's, in units up
// from the brink, ra, and across, rx) on its mirror, breaking white only at the
// brink. Falling, it whitens into its streams over thinner white water between
// them (never a mirror), and its edges feather into that thinner water.
float ra=max(.85-v,0.)*${glsl(run[1])},rx=vF.x*${glsl(run[0])};
float rush=seaNoise(vec2(rx*1.7,ra*.6+seaTime*2.6))*.6+seaNoise(vec2(rx*4.3,ra*1.5+seaTime*4.))*.4;
vec3 rn=normalize(n+(rush-.5)*.3*(1.-fall)*vec3(${glsl(run[2])},0.,${glsl(run[3])}));
float brink=(1.-smoothstep(0.,.5,ra))*(.2+.3*rush)*(1.-fall);
float foam=mix(max(smoothstep(.5,.9,streak)*.4*smoothstep(.835,.87,v),brink),mix(.2,1.,d),white)*smoothstep(.02,.45,edge);
float b=slateBehindText();
vec3 R=reflect(-E,rn);R.y=max(R.y,.08);
// Its mirror at the river's gain, through its knee.
vec3 water=seaEnv(normalize(R),.25)*(.02+.98*pow(1.-max(dot(rn,E),0.),5.))*${glsl(2 * SEA.sky)};
float wY=dot(water,vec3(.2126,.7152,.0722));water=vec3(.004,.007,.009)+water*${glsl(SEA.knee)}*(1.-exp(-wY/${glsl(SEA.knee)}))/max(wY,1e-5);
// Lit through as well as on: falling white water scatters the light from every side, as the surf does.
vec3 lit=(mix(seaLight(n,babelFlash.x*(1.-b)),seaLight(vec3(0.,1.,0.),babelFlash.x*(1.-b)),white)+seaKeyColor*.25/SEA_PI)*${glsl(falls.albedo)};
// Falling, the water between its streams is thinner white water, never a mirror: only the lip is glassy.
// Over the lip it takes the river's bluer, brighter sheen (the ground's own mirror of the film's sky).
water*=mix(vec3(1.),vec3(1.25,1.25,1.5),1.-fall);
water=mix(water,lit*.22,white);
vec3 c=mix(water,lit,foam*(1.-${glsl(SEA.text)}*b));
${landMist(lib)}
gl_FragColor=vec4(c,${SEA_SHARED.layer});
}`;
}

// The falls for a scene (drop: riverFalls()), lit as the sea is, and dispose().
// Its plunge ([x, z, radius]) is where the sea's white water gathers.
export function createFalls({ lib, clock, rendering, drop, height, falls = FALLS } = {}) {
  const { geometry, plunge } = fallsGeometry(drop, height, falls),
    uniforms = sharedUniforms(lib, clock, plunge, falls),
    // The run over the lip in the river's own units: its half-width, its length
    // per unit of aFall.y (the middle stream's) and the flow's heading.
    p = geometry.attributes.position,
    middle = (p.count / (falls.rows + 1) - 1) / 2,
    brink = falls.run * (p.count / (falls.rows + 1)) + middle,
    run = [
      drop.lip[2],
      Math.hypot(p.getX(brink) - p.getX(middle), p.getZ(brink) - p.getZ(middle)) / 0.05,
      ...drop.heading,
    ];
  const material = new ShaderMaterial({
    name: "EstateFalls",
    uniforms,
    side: 2,
    vertexShader: `attribute vec2 aFall;
varying vec3 vW, vN;
varying vec4 vSlateClip;
varying vec2 vF;
varying float vSeaY;
void main(){
vec4 w=modelMatrix*vec4(position,1.);
vW=w.xyz;vN=normalize(mat3(modelMatrix)*normal);vF=aFall;vSeaY=modelMatrix[3].y+${glsl(SEA.level)};
gl_Position=projectionMatrix*viewMatrix*w;
vSlateClip=gl_Position;
}`,
    fragmentShader: fallsFragment(falls, lib, run),
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
