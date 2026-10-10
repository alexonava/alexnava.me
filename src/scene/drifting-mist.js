// Drifting ground mist (storm-fx, reference E): low banks of mist that drift slowly over
// the plain and between the subjects, thicker toward the ranges' feet and in the
// hollows, thinning toward the lens, so the tower's and the tree's feet and the far
// plain stand in moving air. No pass, mesh or texture: every film material that stands
// in it (the ground, the tower, the tree, the rocks, the growth and litter, the lantern,
// the ranges) takes the same term after its fog, an optical depth gathered along its
// own view ray below the mist's ceiling in a few steps through two octaves of drifting
// 3D value noise (a sine-free hash, so every GPU draws the same banks).
//
// MIST_DRIFT (the defaults are the recommended look):
// - `on`: 0 emits none of it;
// - `density`: optical depth per world unit at the plain, where the banks are whole;
// - `ceiling`: [near the estate, at the ranges' feet]: the height above the plain
//   (its datum, mistFrame.x) where the mist ends, exactly, rising between `rise`
//   [from, to] units from the estate's middle (`centre`); the density also grows
//   `far`-fold toward the ranges. `veil`: the most the mist ever covers, so the ranges'
//   feet and the far plain always show through it. It falls off as the square of the height below the
//   ceiling, so the hollows (the tree's knoll, the plain below the tower's base) hold
//   more of it. Every camera stands above the far ceiling in the wide shots, so
//   nothing above eye level, the sky and the reference banks included, ever takes it;
// - `cells`: [the banks' size in units along the wind, across it and in height]: long
//   banks lying along the wind; `banks`: the noise levels where a bank starts and is
//   whole, so there are gaps of clear air, never a flat wall; `fine`: the second
//   octave's share (high only);
// - `wind`: [units per second, heading in degrees]: the drift, along a slowly turning
//   bounded circle (`turn`, radians per second) so the noise's lattice stays small
//   however long the page stays open; `boil`: the banks' slow change in place (noise
//   cells per second along the noise's height, swinging smoothly back over `boilSwing`
//   cells, so it stays bounded and never jumps);
// - `near`: [none within, whole by] units of view distance: it thins toward the lens,
//   so no veil lies over a close subject;
// - `color`: the mist's own light (linear), lighter toward its top (`top`); `side`:
//   [contrast, reach in units]: on high, each bank is lighter on its side toward the
//   moon key and darker away from it, by the noise's own change over `reach` units
//   toward the moon (one more octave per step); `moon`: [gain, forward scattering
//   g]: brighter toward the moon key; `star`: [gain, g, reach]: the star's warm light caught
//   in the mist it shines through toward the lens (the reference's smoke lit by the
//   eye), falling off past `reach` units from it;
// - `steps`: the march's steps [high, balanced]; `octaves`: [high, balanced];
// - `text`: behind the name and intro (and About), the mist's light eases by this
//   share, out over `textReach` [name and intro, About] of the screen's smaller side,
//   so the text keeps its contrast (its veil over darker ground is kept);
// - `ranges`: [units, view slope]: the ranges ride on the camera (hill-silhouette.js),
//   so their mist is gathered along their view ray out to [0] units, or to the plain
//   where their body below eye level meets it, and only up to [1] of view slope above
//   eye level: it lies about their feet and never pales their bodies above the sky
//   behind them, from however low a lens;
// - `shots`: a shot's own share of the density (1 when unlisted), set on the cut.
// Its clock runs with drawn frames and holds for reduced motion, a visitor pause and
// an open panel, as the grass's wind does.
export const MIST_DRIFT = Object.freeze({
  on: 1,
  density: 0.08,
  ceiling: Object.freeze([5, 7]),
  rise: Object.freeze([50, 190]),
  centre: Object.freeze([27, 18]),
  far: 1.5,
  veil: 0.6,
  cells: Object.freeze([64, 26, 7]),
  banks: Object.freeze([0.48, 0.72]),
  fine: 0.35,
  wind: Object.freeze([1.4, 240]),
  turn: 0.00012,
  boil: 0.02,
  boilSwing: 60,
  near: Object.freeze([7, 32]),
  color: Object.freeze([0.24, 0.25, 0.3]),
  top: 1.3,
  side: Object.freeze([2.2, 6]),
  moon: Object.freeze([0.2, 0.35]),
  star: Object.freeze([0.25, 0.55, 140]),
  steps: Object.freeze([4, 2]),
  octaves: Object.freeze([2, 1]),
  text: 0,
  textReach: Object.freeze([0.4, 0.15]),
  ranges: Object.freeze([800, 0.012]),
  shots: Object.freeze({}),
});

const M = MIST_DRIFT;
const g = (value) => (Number.isInteger(value) ? value.toFixed(1) : String(+value.toFixed(6)));
const vec3 = ([x, y, z]) => `vec3(${g(x)},${g(y)},${g(z)})`;
export const mistOn = Boolean(M.on);
const windHeading = (M.wind[1] * Math.PI) / 180;
const WIND_AXIS = `vec2(${g(Math.cos(windHeading))},${g(Math.sin(windHeading))})`,
  WIND_ACROSS = `vec2(${g(-Math.sin(windHeading))},${g(Math.cos(windHeading))})`,
  MOON_STEP = "mistM";

// The shared uniforms: lent to every material the mist reaches, never copied (plain
// objects, which three's uniform clone keeps by reference).
// mistDrift: the drift's offset (x, z, units), its boil (y of the noise) and the
// shot's density share (w; 0 draws nothing). mistFrame: the plain's datum (world y),
// the march's steps and octaves. mistMoon: the moon key's direction (xyz). mistStar:
// the star's world position (xyz). mistText, mistAbout, mistAspect: the ground's text
// boxes and the canvas's aspect (lendMistText()).
export const MIST_UNIFORMS = {
  mistDrift: { value: { x: 0, y: 0, z: 0, w: 0 } },
  mistFrame: { value: { x: -6.25, y: M.steps[0], z: M.octaves[0], w: 0 } },
  mistMoon: { value: { x: 0.71, y: 0.62, z: 0.31, w: 0 } },
  mistStar: { value: { x: -72.25, y: 50, z: -11.9, w: 0 } },
  mistText: { value: { x: 2, y: 2, z: -1, w: -1 } },
  mistAbout: { value: { x: 2, y: 2, z: -1, w: -1 } },
  mistAspect: { value: 1 },
};

// The ground's text boxes (mud-ground.js createSlateContacts()) guard the mist's light.
export function lendMistText(contacts) {
  if (!contacts) return;
  MIST_UNIFORMS.mistText = contacts.slateText;
  MIST_UNIFORMS.mistAbout = contacts.slateAbout;
  MIST_UNIFORMS.mistAspect = contacts.slateAspect;
}

// The moon key's direction and the star's position, world space.
export function setMistLights(moon, star) {
  const m = MIST_UNIFORMS.mistMoon.value,
    s = MIST_UNIFORMS.mistStar.value,
    length = Math.hypot(moon[0], moon[1], moon[2]) || 1;
  m.x = moon[0] / length;
  m.y = moon[1] / length;
  m.z = moon[2] / length;
  [s.x, s.y, s.z] = star;
}

// The march per tier: high and balanced; none below.
export function setMistTier(tier) {
  const f = MIST_UNIFORMS.mistFrame.value,
    k = tier === "balanced" ? 1 : 0;
  f.y = tier === "low" ? 0 : M.steps[k];
  f.z = M.octaves[k];
}

// A shot's share (MIST_DRIFT.shots, 1 unlisted) while the film is on, 0 without.
export function setMistShot(shotName, film = true) {
  MIST_UNIFORMS.mistDrift.value.w = film && mistOn ? (M.shots[shotName] ?? 1) : 0;
}

// The drift clock, in seconds of drawn, unpaused frames, and the plain's datum.
let clock = 0;
const [speed, heading] = M.wind;
export function advanceMist({ deltaSeconds = 0, reducedMotion = false, motionPaused = false } = {}) {
  if (!reducedMotion && !motionPaused && Number.isFinite(deltaSeconds))
    clock += Math.max(0, Math.min(0.1, deltaSeconds));
  mistDriftAt(clock, MIST_UNIFORMS.mistDrift.value);
  return clock;
}
// The drift at time t: along a circle of radius speed / turn whose heading turns
// slowly (a whole turn in about 14 hours), so its offset never grows past its diameter;
// the boil swings smoothly within boilSwing cells (back and forth every 5 hours or so).
export function mistDriftAt(t, out = { x: 0, y: 0, z: 0, w: 0 }) {
  const a = t * M.turn,
    r = speed / M.turn,
    h = (heading * Math.PI) / 180;
  const along = r * Math.sin(a),
    side = r * (1 - Math.cos(a));
  out.x = -(Math.cos(h) * along - Math.sin(h) * side);
  out.y = -(Math.sin(h) * along + Math.cos(h) * side);
  out.z = M.boilSwing * Math.sin((t * M.boil) / M.boilSwing);
  return out;
}
export function setMistDatum(y) {
  MIST_UNIFORMS.mistFrame.value.x = y;
}

// The mist's functions, declared once beside a material's fog: mistOver(c, world)
// returns c seen through the mist between the lens and that world point.
export const MIST_PARS = mistOn
  ? `uniform vec4 mistDrift,mistFrame,mistMoon,mistStar,mistText,mistAbout;
uniform float mistAspect;
float mistHash(vec3 p){p=fract(p*.1031);p+=dot(p,p.zyx+31.32);return fract((p.x+p.y)*p.z);}
float mistNoise(vec3 x){vec3 i=floor(x),f=fract(x);f=f*f*(3.-2.*f);
return mix(mix(mix(mistHash(i),mistHash(i+vec3(1.,0.,0.)),f.x),mix(mistHash(i+vec3(0.,1.,0.)),mistHash(i+vec3(1.,1.,0.)),f.x),f.y),
mix(mix(mistHash(i+vec3(0.,0.,1.)),mistHash(i+vec3(1.,0.,1.)),f.x),mix(mistHash(i+vec3(0.,1.,1.)),mistHash(i+vec3(1.,1.,1.)),f.x),f.y),f.z);}
float mistBox(vec4 r,vec2 v,float d){vec2 f=max(max(r.xy-v,v-r.zw),0.)*vec2(mistAspect,1.)/min(mistAspect,1.);return 1.-smoothstep(0.,d,length(f));}
vec3 mistOver(vec3 c,vec3 world){
if(mistDrift.w<=0.||mistFrame.y<.5)return c;
vec3 v=world-cameraPosition;float L=length(v);vec3 dir=v/max(L,1e-4);
float hC=cameraPosition.y-mistFrame.x,hP=world.y-mistFrame.x,top=${g(M.ceiling[1])};
float t0=${g(M.near[0])},t1=L;
if(hC>=top){if(hP>=top)return c;t0=max(t0,L*(hC-top)/(hC-hP));}
else if(hP>top)t1=L*(top-hC)/(hP-hC);
if(t1<=t0)return c;
float dt=(t1-t0)/mistFrame.y,tau=0.,keep=1.;vec3 glow=vec3(0.);
float moonPhase=${g(1 - M.moon[1] ** 2)}/pow(1.+${g(M.moon[1] ** 2)}-${g(2 * M.moon[1])}*dot(dir,mistMoon.xyz),1.5);
vec3 ${MOON_STEP}=vec3(dot(mistMoon.xz,${WIND_AXIS})/${g(M.cells[0])},mistMoon.y/${g(M.cells[2])},dot(mistMoon.xz,${WIND_ACROSS})/${g(M.cells[1])})*${g(M.side[1])};
for(int i=0;i<4;i++){if(float(i)>=mistFrame.y)break;
float t=t0+(float(i)+.5)*dt;vec3 p=cameraPosition+dir*t;
float far=smoothstep(${g(M.rise[0])},${g(M.rise[1])},length(p.xz-vec2(${g(M.centre[0])},${g(M.centre[1])})));
float cl=mix(${g(M.ceiling[0])},top,far),h=max(p.y-mistFrame.x,0.)/cl;
float prof=1.-h;prof=prof>0.?prof*prof:0.;
if(prof<=0.)continue;
vec2 w=p.xz+mistDrift.xy;
vec3 q=vec3(dot(w,${WIND_AXIS})/${g(M.cells[0])},p.y/${g(M.cells[2])}+mistDrift.z,dot(w,${WIND_ACROSS})/${g(M.cells[1])});
float n=mistNoise(q),side=1.;
if(mistFrame.z>1.5){side=clamp(1.+${g(M.side[0])}*(n-mistNoise(q+${MOON_STEP})),.35,1.6);
n=mix(n,mistNoise(q*2.31+vec3(5.2,1.3,7.7)),${g(M.fine)});}
float rho=${g(M.density)}*mistDrift.w*mix(1.,${g(M.far)},far)*prof*smoothstep(${g(M.banks[0])},${g(M.banks[1])},n)*smoothstep(${g(M.near[0])},${g(M.near[1])},t);
float a=rho*dt;
vec3 s=normalize(p-mistStar.xyz);float sd=length(p-mistStar.xyz)/${g(M.star[2])};
float starPhase=${g(1 - M.star[1] ** 2)}/pow(1.+${g(M.star[1] ** 2)}+${g(2 * M.star[1])}*dot(s,dir),1.5);
vec3 lit=${vec3(M.color)}*mix(1.,${g(M.top)},h)*side+${vec3([0.62, 0.74, 1])}*${g(M.moon[0])}*moonPhase*(.35+.65*h)
+${vec3([1, 0.62, 0.34])}*${g(M.star[0])}*starPhase/(1.+sd*sd);
glow+=keep*(1.-exp(-a))*lit;keep*=exp(-a);tau+=a;}
if(tau<=0.)return c;${
      M.text > 0
        ? `
vec4 clip=projectionMatrix*viewMatrix*vec4(world,1.);vec2 uv=clip.xy/clip.w*.5+.5;
glow*=1.-${g(M.text)}*max(mistBox(mistText,uv,${g(M.textReach[0])}),mistBox(mistAbout,uv,${g(M.textReach[1])}));`
        : ""
    }
return mix(c,c*keep+glow,${g(M.veil)});}
`
  : "";

// The ranges ride on the camera (hill-silhouette.js): their mist is gathered along
// their view ray `dir` out to MIST_DRIFT.ranges, or to the plain where it meets it,
// added as a change, so where there is none the colour stays exactly as it was.
export const MIST_RANGES = mistOn
  ? `{vec3 md=normalize(vL);if(md.y<${g(M.ranges[1])}){float mD=${g(M.ranges[0])};if(md.y<0.)mD=min(mD,max(cameraPosition.y-mistFrame.x,0.)/-md.y);
c+=(mistOver(c,cameraPosition+md*mD)-c)*(1.-smoothstep(0.,${g(M.ranges[1])},md.y));}}
`
  : "";

// The fragment's world point for a built-in material (its view position).
const MIST_WORLD = "cameraPosition+(vec4(-vViewPosition,0.)*viewMatrix).xyz";

// A built-in lit material (standard, Lambert) takes the mist after its fog: the shared
// uniforms and functions, composed with its own onBeforeCompile and cache key.
export function mistHook(material) {
  if (!mistOn || material.userData.mist) return material;
  material.userData.mist = true;
  const before = material.onBeforeCompile,
    key = material.customProgramCacheKey;
  material.onBeforeCompile = function (shader, renderer) {
    before?.call(this, shader, renderer);
    Object.assign(shader.uniforms, MIST_UNIFORMS);
    shader.fragmentShader = mistFragment(shader.fragmentShader);
  };
  material.customProgramCacheKey = function () {
    return `${key?.call(this) ?? ""}|mist`;
  };
  return material;
}

// The same for a fragment shader with `#include <fog_fragment>` and vViewPosition.
export function mistFragment(fragmentShader, world = MIST_WORLD) {
  if (!mistOn) return fragmentShader;
  const pars = (fragmentShader.includes("uniform mat4 projectionMatrix") ? "" : "uniform mat4 projectionMatrix;\n") + MIST_PARS;
  return fragmentShader
    .replace("#include <fog_pars_fragment>", `#include <fog_pars_fragment>\n${pars}`)
    .replace(
      "#include <fog_fragment>",
      `#include <fog_fragment>\n#ifdef USE_FOG\ngl_FragColor.rgb=mistOver(gl_FragColor.rgb,${world});\n#endif`,
    );
}
