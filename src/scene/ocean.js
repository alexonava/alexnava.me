import { BufferAttribute, BufferGeometry, Mesh, ShaderMaterial, Vector3 } from "three";

// The sea beyond the fault. Only terrain-build.js imports this module, so it
// ships in the terrain's lazy chunk and lands with the film terrain
// (settleRoots()): it imports nothing first-party, and what it shares with the
// entry is restated here (test/ocean.test.mjs holds it equal) or lent in
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
float u=fract(z/${glsl(surf.period)}+seaTime*${glsl(surf.speed / surf.period)}),n=seaNoise(P.xz/${glsl(surf.cell)}+seaTime*vec2(.03,-.02));
float burst=smoothstep(${glsl(1 - surf.cover)},${glsl(1 - surf.cover + 0.25)},n)*exp(-u*2.6);
float foot=(1.-smoothstep(3.5,6.5+fp,z))*(.6+.4*seaFoam(P.xz/2.2+seaTime*vec2(.35,-.2)));
float foam=max(foot,burst*(1.-smoothstep(${glsl(surf.reach * 0.3)},${glsl(surf.reach)},z)));
// Where the falls land: a churning patch, whitest at its heart.
if(seaFalls.w>0.){float fd=length(P.xz-seaFalls.xy)/seaFalls.z;foam=max(foam,(1.-smoothstep(.25,1.,fd))*(.55+.45*seaFoam(P.xz/1.6+seaTime*vec2(.5,-.4))));}
foam*=mix(.55,1.,seaLace*smoothstep(.25,.75,seaFoam(P.xz*1.7+seaTime*vec2(.12,-.08))));
foam=mix(foam,${glsl(surf.far)}*(1.-smoothstep(0.,${glsl(surf.reach)},z)),clamp(fp*1.2-.6,0.,1.));
// About the stacks: swells breaking on them, their far mean where they fall under pixels.
foam=max(foam,sf*mix((.6+.4*seaFoam(P.xz/1.7+seaTime*vec2(.4,-.3)))*(.8+.2*sin(seaTime*1.3+P.x*.2+P.z*.13)),.45,clamp(fp*1.2-.6,0.,1.)));
foam*=1.-${glsl(sea.text)}*b;
vec3 lit=seaLight(vec3(0.,1.,0.),babelFlash.x*(1.-b));
c=mix(c,${glsl(surf.albedo)}*lit,clamp(foam,0.,1.));}
if(uMist.w>0.)c=mix(c,uMist.rgb,uMist.w*${glsl(sea.mist)}*smoothstep(55.,190.,t));
${
  lib.MIST_PARS
    ? `// The drifting mist lies on the land: it gathers along the ray only until the ray leaves it (the fault's mean line, past its headlands).
float vn=dot(V.xz,${glslVec(NX, NZ)}),tc=vn>1e-4?max(${glsl(COAST.offset + sea.mistPast)}-dot(cameraPosition.xz,${glslVec(NX, NZ)}),0.)/vn:1e4;
c=mistOver(c,cameraPosition+V*min(min(t,800.),tc));`
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
function sharedUniforms(lib, clock) {
  const mist = lib.MIST_UNIFORMS ?? {};
  return {
    ...mist,
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
  const uniforms = sharedUniforms(lib, clock);
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
// fault and `band` tall). step: its columns' spacing along the fault; rows:
// the face's. lip: the broken edge's teeth (their least and most height over
// the shelf). rock: its albedo's dark and pale (strata) tones; dust: the
// plain's dusty tone the shelf's top takes up to the break, so it meets the
// terrain with no rim; wet: the band above the sea the spray keeps dark.
export const CLIFF = Object.freeze({
  step: 0.8,
  shelfRows: 6,
  rows: 16,
  foot: -16,
  lean: 2.6,
  jag: 2.4,
  cell: 7,
  band: 2.6,
  lip: Object.freeze([0.04, 0.48]),
  rock: Object.freeze([Object.freeze([0.1, 0.09, 0.088]), Object.freeze([0.24, 0.215, 0.205])]),
  dust: Object.freeze([0.3, 0.25, 0.25]),
  wet: 3.5,
});
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

// The cliff's geometry, given the land's height at x/z (the terrain's sampler):
// rows across the fault from the shelf's inner edge to the face's foot, every
// `step` along it, within the terrain's square `half` (with a margin). notch:
// [along-shore s, half-width] of the slot the falls have cut: there the lip
// lowers to the shelf and the face stands straighter and set back.
export function cliffGeometry(height, cliff = CLIFF, half = 190, notch = null) {
  // The fault's along-shore span inside the square.
  const span = [];
  for (let s = -half * 1.5; s <= half * 1.5; s += cliff.step) {
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
  span.forEach((s, i) => {
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
        0.05 * slot;
    at(-0.9, top, shelfRows, 0);
    at(0.25 + 0.35 * fbm(s / 1.1, 2), top - 0.35 - 0.5 * fbm(s / 2.3, 4.2), shelfRows + 1, 0.02);
    for (let r = 0; r < cliff.rows; r++) {
      const v = (r + 1) / cliff.rows,
        y = top - 0.6 + (cliff.foot - top + 0.6) * v ** 0.9,
        jag = cliff.jag * (fbm(s / cliff.cell, y / cliff.band) - 0.5) * 2;
      at(
        0.2 +
          cliff.lean * v * (1 - 0.8 * slot) +
          jag * (0.35 + 0.65 * Math.min(1, v * 3)) * (1 - 0.85 * slot) -
          1.2 * slot * Math.min(1, v * 4),
        y,
        shelfRows + lipRows + r,
        v,
      );
    }
  });
  const indices = new Uint32Array((cols - 1) * (rows - 1) * 6);
  const shelfCount = (cols - 1) * shelfRows * 6;
  let topIndex = 0,
    faceIndex = shelfCount;
  for (let i = 0; i < cols - 1; i++)
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
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("aCliff", new BufferAttribute(attrs, 3));
  // The shelf shares the ground's complete material and UV phase. Neutral
  // root attributes leave the estate's root treatment away from the fault.
  geometry.setAttribute("uv", new BufferAttribute(uvs, 2));
  geometry.setAttribute("slateRoot", new BufferAttribute(roots, 4));
  geometry.setAttribute("slateShade", new BufferAttribute(new Float32Array(cols * rows * 2), 2));
  geometry.setAttribute("slatePool", new BufferAttribute(new Float32Array(cols * rows), 1));
  geometry.setIndex(new BufferAttribute(indices, 1));
  geometry.addGroup(0, shelfCount, 0);
  geometry.addGroup(shelfCount, indices.length - shelfCount, 1);
  geometry.computeVertexNormals();
  return geometry;
}

// What the break left standing off the cliffs: sea stacks (remnants of the
// plateau, their caps at about its height) and tilted slabs (blocks that fell
// and rose on one edge), all dark with spray. Each: [along the fault (s), out
// (seaward of it), height (along its axis above the sea), half-thickness,
// stretch (its length over its thickness; past 2 a slab), lean (degrees), turn
// (degrees: the lean's heading off the fault's seaward normal)]. base: how far
// under the sea each stands from; sides, rings: the faceted prism each is;
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
  sides: 16,
  rings: 20,
  surf: 3.5,
  wet: 0.5,
});

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

// The stacks' fractured geometry (shallow joins smooth, deep creases sharp), with the cliff's
// attributes: around each (for its grain), a stack's mark (2: past the face's
// 0 to 1, so it takes STACKS.wet), and across (1: none of the shelf's dust).
export function stackGeometry(stacks = STACKS, level = SEA.level) {
  const positions = [],
    attrs = [],
    normals = [],
    crease = Math.cos(Math.PI / 6),
    edgeA = new Vector3(),
    edgeB = new Vector3(),
    average = new Vector3();
  stacks.list.forEach((stack, k) => {
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
        du = (fbm(k * 5.3, v * 3.1) - 0.5) * half * stretch * 0.35,
        dw = (fbm(k * 6.1 + 2, v * 3.1) - 0.5) * half * 0.35;
      return [...Array(sides).keys()].map((j) => {
        const a = (j / sides) * 2 * Math.PI,
          cover = smooth(
            0.3,
            0.7,
            noise2(k * 7.2 + Math.cos(a) * 1.3, Math.sin(a) * 1.3 + v * 1.1),
          ),
          rad =
            (0.72 +
              0.5 * fbm(k * 13 + j * 0.9, v * 4.1) +
              0.32 * (noise2(k * 31 + j * 2.7, v * 9.3) - 0.5)) *
            taper *
            (1 - 0.12 * ledge * cover),
          // The top ring is broken: its points stand at ragged heights.
          crown = r === rings ? (fbm(k * 7 + j * 1.3, 5.1) - 0.5) * (slab ? 5 : 3.4) : 0;
        return {
          p: point(
            du + Math.cos(a) * half * stretch * rad,
            ly + crown,
            dw + Math.sin(a) * half * rad,
          ),
          arc: k * 50 + a * half * (1 + stretch),
        };
      });
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
        if (!adjoining.has(vertex)) adjoining.set(vertex, []);
        adjoining.get(vertex).push(normal);
      });
    };
    let below = ring(0);
    for (let r = 1; r <= rings; r++) {
      const above = ring(r);
      for (let j = 0; j < sides; j++) {
        const n = (j + 1) % sides;
        face(below[j], below[n], above[j]);
        face(below[n], above[n], above[j]);
      }
      below = above;
    }
    // The cap: broken, a little domed.
    // Its peak follows the top ring's wandering middle. Separate vertices
    // keep the cap's broken rim sharp even where a side join is shallow.
    const mid = [0, 1, 2].map((i) => below.reduce((sum, { p }) => sum + p[i], 0) / sides),
      top = { p: [mid[0], mid[1] + 0.4 * fbm(k, 9.1) * Y[1], mid[2]], arc: k * 50 },
      cap = below.map(({ p, arc }) => ({ p, arc }));
    for (let j = 0; j < sides; j++) face(cap[j], cap[(j + 1) % sides], top);
    for (const { points, normal } of faces)
      for (const vertex of points) {
        average.set(0, 0, 0);
        for (const other of adjoining.get(vertex))
          if (normal.dot(other) >= crease) average.add(other);
        average.normalize();
        normals.push(average.x, average.y, average.z);
      }
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute("aCliff", new BufferAttribute(new Float32Array(attrs), 3));
  geometry.setAttribute("normal", new BufferAttribute(new Float32Array(normals), 3));
  return geometry;
}

// The white water about each stack's waterline (its section there: stretched
// along the lean's heading), as GLSL adding to `sf` at the sea's point P.
export function stacksSurfGlsl(stacks = STACKS) {
  return stacks.list
    .map((stack) => {
      const [, , , half, stretch] = stack,
        { c, h, tilt } = stackFrame(stack);
      return `{vec2 q=P.xz-${glslVec(...c)};float e=length(vec2(dot(q,${glslVec(-h[1], h[0])})/${glsl(half * stretch)},dot(q,${glslVec(...h)})/${glsl(half * tilt)}));sf=max(sf,1.-smoothstep(0.,${glsl(stacks.surf)},(e-1.)*${glsl(half)}));}`;
    })
    .join("\n");
}

// The low mist and the drifting mist at a point vW of the cliffs, their stacks
// or the falls, as the sea takes them: out past the fault only SEA.mist of a
// shot's low mist, and the drifting mist gathered only while the ray is over
// the land. Needs seaCoast() (coastGlsl()) and the mist's uniforms.
const landMist = (lib, sea = SEA) =>
  `{vec3 mv=vW-cameraPosition;float ml=length(mv);vec3 md=mv/max(ml,1e-4);
if(uMist.w>0.)c=mix(c,uMist.rgb,uMist.w*mix(1.,${glsl(sea.mist)},smoothstep(4.,16.,-seaCoast(vW.xz)))*smoothstep(55.,190.,ml));
${
  lib.MIST_PARS
    ? `float vn=dot(md.xz,${glslVec(NX, NZ)}),tc=vn>1e-4?max(${glsl(COAST.offset + sea.mistPast)}-dot(cameraPosition.xz,${glslVec(NX, NZ)}),0.)/vn:1e4;
c=mistOver(c,cameraPosition+md*min(ml,tc));`
    : ""
}}`;

function cliffFragment(cliff, lib) {
  const [dark, pale] = cliff.rock;
  return `#define SEA_PI 3.1415927
uniform float seaTime;
uniform vec4 uMist, babelFlash, cliffRiver;
uniform vec2 cliffFlow;
uniform mat4 projectionMatrix;
varying vec3 vW, vN;
varying vec4 vSlateClip;
varying vec3 vC;
varying float vSeaY;
${lib.SLATE_TEXT_GUARD}
${lib.MIST_PARS}
${ENV_PARS}
${NOISE_GLSL}
${coastGlsl()}
void main(){
vec3 n=normalize(vN);
// The rock: strata banding down the face, fractures and grain across the top, its slopes tilting the light.
float top=smoothstep(.55,.85,n.y);
vec2 q=mix(vec2(vC.x/3.,vW.y/1.3),vW.xz/2.2,top);
vec3 n1=seaNoiseD(q),n2=seaNoiseD(q*3.1+7.),n3=seaNoiseD(q*9.7+3.);
float strata=smoothstep(.3,.7,.5+.5*sin(vW.y*2.3+n1.x*4.))*(1.-top);
vec3 alb=mix(${glslVec(...dark)},${glslVec(...pale)},strata*.6+n2.x*.4)*(.8+.4*n3.x);
// The shelf takes the plain's dust up to the break, so it meets the terrain without a seam; the stacks stand dark with spray.
alb=mix(alb,${glslVec(...cliff.dust)}*(.85+.3*n3.x),top*smoothstep(.2,1.,-vC.z));
alb*=mix(1.,${glsl(STACKS.wet)},step(1.5,vC.y));
vec3 t=normalize(mix(cross(n,vec3(0.,1.,0.)),cross(n,vec3(0.,0.,1.)),top)+1e-4),bt=cross(t,n);
n=normalize(n+(t*(n1.y*.5+n2.y*.35+n3.y*.15)+bt*(n1.z*.5+n2.z*.35+n3.z*.15))*.45);
// Spray darkens and wets the foot.
float wet=1.-smoothstep(vSeaY,vSeaY+${glsl(cliff.wet)},vW.y);
alb*=1.-.45*wet;
float b=slateBehindText();
vec3 light=seaLight(n,babelFlash.x*(1.-b));
vec3 c=alb*light;
// A wet foot's dull sheen of the sky.
vec3 E=normalize(cameraPosition-vW),R=reflect(-E,n);R.y=max(R.y,.1);
c+=wet*seaEnv(normalize(R),.45)*.12*pow(1.-max(dot(n,E),0.),3.);
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
// paints.
export function createCliff({
  lib,
  clock,
  rendering,
  height,
  groundMaterial = null,
  cliff = CLIFF,
  drop = null,
} = {}) {
  const uniforms = sharedUniforms(lib, clock),
    notch = drop ? [drop.along, drop.lip[2] + 1.5] : null;
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
varying vec3 vW, vN;
varying vec4 vSlateClip;
varying vec3 vC;
varying float vSeaY;
void main(){
vec4 w=modelMatrix*vec4(position,1.);
vW=w.xyz;vN=normalize(mat3(modelMatrix)*normal);vC=aCliff;vSeaY=modelMatrix[3].y+${glsl(SEA.level)};
gl_Position=projectionMatrix*viewMatrix*w;
vSlateClip=gl_Position;
}`,
    fragmentShader: cliffFragment(cliff, lib),
    extensions: { derivatives: true },
  });
  const update = lighting(rendering, material, uniforms);
  const geometry = cliffGeometry(height, cliff, 190, notch);
  if (!groundMaterial) geometry.clearGroups();
  const mesh = new Mesh(geometry, groundMaterial ? [groundMaterial, material] : material),
    stacks = new Mesh(stackGeometry(), material);
  mesh.name = "estate-cliff";
  stacks.name = "estate-stacks";
  stacks.castShadow = stacks.receiveShadow = false;
  mesh.add(stacks);
  mesh.castShadow = mesh.receiveShadow = false;
  mesh.onBeforeRender = stacks.onBeforeRender = update;
  return {
    mesh,
    material,
    dispose() {
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

// The river's falls: where the river (reversed, it runs to the fault) meets
// the cliffs it pours over the lip into the sea. head: how far inland of the
// fault the falling sheet leaves the cliffs' shelf (whose last row, 0.9
// inland, carries the ground's own river), lift: above the shelf there; rows: the falling sheet's; push: its speed off the lip;
// spread: how much wider it falls; albedo: the white water's; plunge: the
// radius of the white water where it lands, as a share of its width.
export const FALLS = Object.freeze({
  head: 0.95,
  lift: 0.2,
  rows: 22,
  push: 4,
  spread: 0.5,
  albedo: 0.5,
  plunge: 2.2,
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

// The falls' geometry: across the river (aFall.x, -1 to 1) and along its
// course (aFall.y: from 0.85 where it leaves the shelf to 2 at the sea): the
// sheet leaves the shelf's last row (height: the land's height at x/z) and
// falls under gravity, pushed out along the flow, clear of the rock's lip.
export function fallsGeometry(drop, height, falls = FALLS, level = SEA.level) {
  const { lip, heading } = drop,
    across = 9,
    [hx, hz] = heading,
    head = [lip[0] - hx * falls.head, lip[1] - hz * falls.head],
    top = height(...head) + falls.lift,
    rows = [{ x: head[0], z: head[1], y: top, hw: lip[2], v: 0.85 }],
    fall = Math.sqrt((2 * (top - level + 1)) / 32.2);
  for (let k = 1; k <= falls.rows; k++) {
    const t = (k / falls.rows) * fall,
      out = falls.push * t;
    rows.push({
      x: head[0] + hx * out,
      z: head[1] + hz * out,
      y: top - 16.1 * t * t,
      hw: lip[2] * (1 + falls.spread * (k / falls.rows)),
      v: 0.85 + 1.15 * (k / falls.rows),
    });
  }
  const positions = new Float32Array(rows.length * across * 3),
    attrs = new Float32Array(rows.length * across * 2);
  rows.forEach(({ x, z, y, hw, v }, r) =>
    [...Array(across).keys()].forEach((c) => {
      const w = (c / (across - 1)) * 2 - 1,
        i = r * across + c;
      positions.set([x - hz * hw * w, y, z + hx * hw * w], i * 3);
      attrs.set([w, v], i * 2);
    }),
  );
  const indices = new Uint16Array((rows.length - 1) * (across - 1) * 6);
  let k = 0;
  for (let r = 0; r < rows.length - 1; r++)
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
  return {
    geometry,
    plunge: [rows[rows.length - 1].x, rows[rows.length - 1].z, lip[2] * falls.plunge],
  };
}

function fallsFragment(falls, lib) {
  return `#define SEA_PI 3.1415927
uniform float seaTime;
uniform vec4 uMist, babelFlash;
uniform mat4 projectionMatrix;
varying vec3 vW, vN;
varying vec4 vSlateClip;
varying vec2 vF;
${lib.SLATE_TEXT_GUARD}
${lib.MIST_PARS}
${ENV_PARS}
${NOISE_GLSL}
${coastGlsl()}
void main(){
float a=abs(vF.x),v=vF.y;
// Ragged edges.
float edge=1.-smoothstep(.72,1.,a+.25*(seaNoise(vec2(v*6.,vF.x*3.)-seaTime*vec2(2.,0.))-.5));
if(edge<.02)discard;
vec3 E=normalize(cameraPosition-vW),n=normalize(vN);
if(dot(n,E)<0.)n=-n;
// Leaving the lip it is dark, fast water mirroring the sky; falling, it whitens into streaks.
float white=smoothstep(.85,1.25,v);
float streak=seaNoise(vec2(vF.x*7.,v*2.5-seaTime*(1.2+2.2*white)))*.6+seaNoise(vec2(vF.x*19.,v*6.-seaTime*(2.+4.*white)))*.4;
float foam=mix(smoothstep(.55,.95,streak)*.35,.55+.45*streak,white)*edge;
float b=slateBehindText();
vec3 R=reflect(-E,n);R.y=max(R.y,.08);
vec3 water=vec3(.005,.008,.01)+seaEnv(normalize(R),.3)*.35;
// Lit through as well as on: a falling sheet is never quite dark.
vec3 lit=(seaLight(n,babelFlash.x*(1.-b))+seaKeyColor*.25/SEA_PI)*${glsl(falls.albedo)};
vec3 c=mix(water,lit,foam*(1.-${glsl(SEA.text)}*b));
${landMist(lib)}
gl_FragColor=vec4(c,${SEA_SHARED.layer});
}`;
}

// The falls for a scene (drop: riverFalls()), lit as the sea is, and dispose().
// Its plunge ([x, z, radius]) is where the sea's white water gathers.
export function createFalls({ lib, clock, rendering, drop, height, falls = FALLS } = {}) {
  const uniforms = sharedUniforms(lib, clock);
  const { geometry, plunge } = fallsGeometry(drop, height, falls);
  const material = new ShaderMaterial({
    name: "EstateFalls",
    uniforms,
    side: 2,
    vertexShader: `attribute vec2 aFall;
varying vec3 vW, vN;
varying vec4 vSlateClip;
varying vec2 vF;
void main(){
vec4 w=modelMatrix*vec4(position,1.);
vW=w.xyz;vN=normalize(mat3(modelMatrix)*normal);vF=aFall;
gl_Position=projectionMatrix*viewMatrix*w;
vSlateClip=gl_Position;
}`,
    fragmentShader: fallsFragment(falls, lib),
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
