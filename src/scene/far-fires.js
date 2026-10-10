import {
  Box3,
  BufferGeometry,
  CustomBlending,
  Float32BufferAttribute,
  Matrix4,
  OneFactor,
  Points,
  ShaderMaterial,
  SrcAlphaFactor,
  Vector3,
  Vector4,
  ZeroFactor,
} from "three";
import { RANGE_MIST, RANGE_MIST_SHAPE, TERRAIN_EDGE } from "./hill-silhouette.js";
import { TERRAIN_BASE } from "./mud-ground.js";
import { seededRandom } from "./solar-body.js";

// Distant firelights (the owner's storm-fx brief, 2026-10-09, frame F): tiny
// warm fires far out on the plain and at the ranges' feet, campfires, torches
// and a settlement's glow, so the empty night has scale and something lives
// out there. Each is a hot point a device pixel or two across with a small
// soft halo, 2000-2500 K, breathing on the scene clock and now and then
// guttering, dimmed and reddened by the air with distance, and hidden by the
// terrain, the rocks, the tower and the tree: one depth-tested Points draw in
// the scene, added light that keeps the film's depth layer, no light and no
// texture (STYLE.md: no new lights).
//
// clusters: [azimuth (degrees, atan2(z, x) about the world origin), distance
// (units from the origin), spread (units), fires, power, and optionally rise:
// the ground climbing outward across the cluster, units per unit, as a
// valley's far side toward the range]. Each cluster's fires scatter from the
// seed (`seed`) about its point, at least `gap` radians apart as seen from
// the estate (depth along the view counting a little, as it does on screen),
// so no two fires' light piles up into one pixel, and stand `lift` above the
// ground there: the film terrain's plain and foothills inside its edge
// (TERRAIN_EDGE), the far plain's level (TERRAIN_BASE) beyond it.
// glow: the cluster (index, -1 for none) whose warm light lifts into the low
// haze above it: a soft ellipse `width` times the cluster's spread across,
// `aspect` as tall, `lift` spreads above the ground, at `gain`.
// size (device px): the core's Gaussian sigma from the weakest to the
// strongest fire, the halo's radius (CSS px), the pool's half width, half
// height and drop below the core.
// light: the core's, halo's and pool's gains, and the most the core and halo
// together reach (luma: under the bloom's threshold with the plain's air
// beneath them).
// colour: the fires' temperatures (K), the tint a guttering fire sinks
// toward, and the hot tint and share of a core.
// flicker: the slow breath and the faster flutter (shares of the light), how
// deep a gutter dips, and a rate scale.
// haze: the air's reach (units: light falls to 1/e), its reddening
// (extinction per channel), how much the halo scatters with distance, how
// deeply a shot's low mist (hill-silhouette.js RANGE_MIST) veils a fire, the
// ranges' ground line (`feet`, a view slope: the ranges ride on the lens, so
// past the terrain's edge a fire's reach eases toward where the plain meets
// them and it never stands on a range's flank) and the draw distance (a fire
// farther off draws that far along its own ray, so the depth test still hides
// it behind every nearer surface while the ranges, drawn at the back of the
// depth range, never cover it; its air is reckoned on its true distance).
// guard: the fires go out behind the name and intro (`text`) and About
// (`about`), over shares of the screen's smaller side as the ground's text
// guard measures them, and about the subjects (`subject`: pad and feather,
// the tower's and tree's silhouettes taken as `bands` boxes up their height).
// balanced: the share of fires kept (each cluster's first ones), the pool's
// gain and the halo's scale.
// shots: per shot, a canvas UV rect (x0, y0, x1, y1, y up) the fires keep out
// of: The watch's reference clouds (STYLE.md, the 1100x440 top-left crop at
// 1600x900).
export const FAR_FIRES = Object.freeze({
  enabled: true,
  seed: 5113,
  lift: 0.5,
  gap: 0.005,
  clusters: Object.freeze([
    // The watch: between the name and the lookout, and right of it.
    Object.freeze([156, 560, 16, 4, 0.9]),
    Object.freeze([162, 1500, 40, 6, 1]),
    Object.freeze([152, 980, 22, 2, 0.75]),
    Object.freeze([184, 900, 26, 5, 0.95]),
    Object.freeze([189, 360, 9, 2, 0.8]),
    Object.freeze([157, 300, 8, 2, 0.8]),
    // Portrait: the plain left and right of the trunk.
    Object.freeze([92, 950, 24, 4, 0.9]),
    Object.freeze([117, 1600, 45, 6, 1]),
    Object.freeze([108, 620, 14, 3, 0.85]),
    // Watch and tree: on the far foothills' crests, either side of the lookout.
    Object.freeze([232, 151, 6, 3, 0.8]),
    Object.freeze([266, 153, 5, 2, 0.75]),
    // Root and lantern: past the roots, right of the trunk.
    Object.freeze([66, 1300, 34, 4, 0.9]),
  ]),
  glow: Object.freeze({ cluster: -1, gain: 0.05, width: 1.2, aspect: 0.34, lift: 0.2 }),
  size: Object.freeze({
    core: Object.freeze([0.55, 1.05]),
    halo: 7,
    pool: Object.freeze([3.2, 0.8, 1.4]),
  }),
  light: Object.freeze({ core: 2.6, halo: 0.4, pool: 0.1, peak: 0.45 }),
  colour: Object.freeze({
    kelvin: Object.freeze([2000, 2500]),
    gutter: Object.freeze([1, 0.72, 0.5]),
    hot: Object.freeze([1, 0.8, 0.5]),
    core: 0.35,
  }),
  flicker: Object.freeze({ breath: 0.16, flutter: 0.06, gutter: 0.55, rate: 1 }),
  haze: Object.freeze({
    reach: 2200,
    redden: Object.freeze([0.8, 1, 1.45]),
    scatter: 0.5,
    mist: 0.6,
    feet: -RANGE_MIST_SHAPE.floor,
    draw: 320,
  }),
  guard: Object.freeze({
    text: 0.06,
    about: 0.04,
    subject: Object.freeze([0.012, 0.02]),
    bands: 8,
  }),
  balanced: Object.freeze({ share: 0.5, pool: 0, halo: 0.8 }),
  shots: Object.freeze({
    "The watch": Object.freeze({ clear: Object.freeze([0, 0.47, 0.72, 1]) }),
  }),
});

// The film terrain's foothills (terrain-build.js RIDGES and foothillHeight,
// a lazy chunk this module may not import; a test holds them equal): the
// ground a fire inside the terrain's edge stands on.
const RIDGES = Object.freeze([
  Object.freeze([120, 26, 3.2]),
  Object.freeze([139, 22, 5.2]),
  Object.freeze([156, 22, 7.4]),
]);
export function farFireGround(x, z) {
  const r = Math.hypot(x, z);
  if (r >= TERRAIN_EDGE || r < 88 || r >= 184) return TERRAIN_BASE;
  const a = Math.atan2(z, x);
  let height = 0;
  for (const [radius, width, lift] of RIDGES) {
    const d = Math.abs(r - radius - 5 * Math.sin(a * 3)) / width;
    height += Math.max(0, 1 - d * d) ** 2 * lift * (0.72 + 0.28 * Math.sin(a * 7 + radius));
  }
  return TERRAIN_BASE + height * (0.15 + 0.85 * Math.max(0, -Math.cos(a - 0.6)));
}

// A blackbody's colour at `kelvin` (1000-6600 K), linear sRGB with red 1: Tanner
// Helland's fit to the Planckian locus in display sRGB, decoded.
export function kelvinColor(kelvin) {
  const t = kelvin / 100,
    clamp = (v) => Math.min(255, Math.max(0, v)) / 255,
    linear = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const g = clamp(99.4708025861 * Math.log(t) - 161.1195681661),
    b = t <= 19 ? 0 : clamp(138.5177312231 * Math.log(t - 10) - 305.0447927307);
  return [1, linear(g), linear(b)];
}

// The fires, deterministic from FAR_FIRES: { x, y, z, power, temperature, seed,
// kind (0 a fire, 1 the glow), rank, cluster }, ordered so the balanced tier's
// share keeps each cluster's first fires (and the glow, first of all).
export function farFireLayout(config = FAR_FIRES) {
  const random = seededRandom(config.seed),
    fires = [];
  config.clusters.forEach(([azimuth, distance, spread, count, power, rise = 0], cluster) => {
    const a = (azimuth * Math.PI) / 180,
      cx = Math.cos(a) * distance,
      cz = Math.sin(a) * distance,
      placed = [],
      // Apart across the view (t) and, foreshortened, along it (r): the
      // plain's depth shows on screen as the lens's height over the distance,
      // and a rising valley side adds its own.
      apart = (dx, dz) =>
        Math.hypot(
          -Math.sin(a) * dx + Math.cos(a) * dz,
          (0.03 + rise) * (Math.cos(a) * dx + Math.sin(a) * dz),
        ) >
        config.gap * distance;
    for (let i = 0; i < count; i++) {
      let x = cx,
        z = cz;
      // The first fire near the cluster's heart, the rest about it.
      for (let attempt = 0; attempt < 16; attempt++) {
        const r = spread * Math.sqrt(random()) * (i ? 1 : 0.3),
          t = random() * Math.PI * 2;
        x = cx + Math.cos(t) * r;
        z = cz + Math.sin(t) * r;
        if (placed.every(([px, pz]) => apart(px - x, pz - z))) break;
      }
      placed.push([x, z]);
      fires.push({
        x,
        y:
          farFireGround(x, z) +
          config.lift +
          rise * Math.max(0, Math.hypot(x, z) - distance + spread),
        z,
        // The first fire at the cluster's power, the rest mostly smaller (0.35-1).
        power: power * (i ? 0.35 + 0.65 * random() ** 1.5 : 1),
        temperature: random(),
        seed: random(),
        kind: 0,
        rank: i / count + cluster * 1e-4,
        cluster,
      });
    }
  });
  const glow = config.glow,
    host = config.clusters[glow?.cluster ?? -1];
  if (host && glow.gain > 0) {
    const members = fires.filter((fire) => fire.cluster === glow.cluster),
      x = members.reduce((sum, fire) => sum + fire.x, 0) / members.length,
      z = members.reduce((sum, fire) => sum + fire.z, 0) / members.length;
    fires.push({
      x,
      y: farFireGround(x, z) + glow.lift * host[2],
      z,
      power: host[2] * glow.width,
      temperature: 0.4,
      seed: 0.37,
      kind: 1,
      rank: -1,
      cluster: glow.cluster,
    });
  }
  return fires.sort((a, b) => a.rank - b.rank);
}

const glsl = (value) => (Number.isInteger(value) ? value.toFixed(1) : String(value));
const vec3 = (values) => `vec3(${values.map(glsl).join(",")})`;
// Subject guard rects: the bands of the tower's and the tree's silhouettes.
const SUBJECT_RECTS = 2 * FAR_FIRES.guard.bands;

function farFireMaterial(config, uniforms) {
  const { size, colour, haze } = config,
    [cool, warm] = colour.kelvin.map(kelvinColor);
  return new ShaderMaterial({
    name: "FarFires",
    uniforms,
    vertexShader: `attribute vec4 aFire;
uniform float uTime, uPixelRatio, uHeight, uHalo, uPool;
uniform vec4 uMist, slateText, slateAbout, uClear, uSubjects[${SUBJECT_RECTS}];
uniform float slateAspect;
varying vec3 vCore, vHalo;
varying vec4 vShape;
float fh(float n){n=fract(n*.1031);n*=n+33.33;n*=n+n;return fract(n);}
float fn(float x){float i=floor(x),f=fract(x);return mix(fh(i),fh(i+1.),f*f*(3.-2.*f));}
// 1 inside the canvas UV rect r, easing to 0 over d (shares of the smaller side) past pad.
float near(vec4 r,vec2 v,float pad,float d){vec2 f=max(max(r.xy-v,v-r.zw),0.)*vec2(slateAspect,1.)/min(slateAspect,1.);return 1.-smoothstep(pad,pad+d,length(f));}
void main(){
vec3 w=(modelMatrix*vec4(position,1.)).xyz, d=w-cameraPosition;
float D=length(d), Dh=max(length(d.xz),1e-3);
// The ranges ride on the lens with their ground line a fixed view slope below eye
// level (haze.feet), so the far plain ends there, at a reach that grows with the
// lens's height (F): past the terrain's edge along its view (E) a fire's reach eases
// toward F, so it never stands on a range's flank; on the terrain it stays put.
vec2 hz=d.xz/Dh, ah=max(abs(hz),1e-4), eq=(${glsl(TERRAIN_EDGE)}-sign(hz)*cameraPosition.xz)/ah;
float E=max(min(eq.x,eq.y),0.), F=max(max(-d.y,.05)/${glsl(haze.feet)},E+1.);
vec3 e=d;
if(Dh>E)e.xz*=(E+(F-E)*(1.-exp((E-Dh)/(F-E))))/Dh;
// Past the draw distance a fire draws along its own ray: still behind every nearer
// surface and in front of the ranges.
vec4 clip=projectionMatrix*viewMatrix*vec4(cameraPosition+e*min(1.,${glsl(haze.draw)}/length(e)),1.);
gl_Position=clip;
vec2 v=clip.xy/clip.w*.5+.5;
// Out behind the text, the subjects and a shot's kept-clear rect.
float keep=step(0.,clip.w)*(1.-near(slateText,v,0.,${glsl(config.guard.text)}))*(1.-near(slateAbout,v,0.,${glsl(config.guard.about)}))*(1.-near(uClear,v,0.,.01));
for(int i=0;i<${SUBJECT_RECTS};i++)keep*=1.-near(uSubjects[i],v,${glsl(config.guard.subject[0])},${glsl(config.guard.subject[1])});
float s=aFire.z*61.7, t=uTime*${glsl(config.flicker.rate)};
// Breath, flutter and the odd gutter on the scene clock: smooth noise, never a strobe.
float breath=2.*fn(t*(.45+.35*aFire.z)+s)-1., flutter=2.*fn(t*(1.7+.9*fract(s*.37))+s*3.1)-1.;
float gutter=smoothstep(.7,.93,fn(t*.11+s*5.3));
float f=max(0.,(1.+${glsl(config.flicker.breath)}*breath+${glsl(config.flicker.flutter)}*flutter)*(1.-${glsl(config.flicker.gutter)}*gutter));
vec3 col=mix(${vec3(cool)},${vec3(warm)},aFire.y);
col*=mix(${vec3(colour.gutter)},vec3(1.),smoothstep(.35,1.,f));
// The air: dimmer and redder with distance, and a shot's low mist on the plain.
float slope=e.y/max(length(e.xz),1e-3), mist=uMist.w*max(1.-smoothstep(${glsl(RANGE_MIST_SHAPE.floor)},${glsl(RANGE_MIST_SHAPE.top)},slope),smoothstep(55.,190.,D));
vec3 T=exp(-D/${glsl(haze.reach)}*${vec3(haze.redden)})*(1.-${glsl(haze.mist)}*mist);
vec3 scatter=mix(T,sqrt(T),${glsl(haze.scatter)});
float glow=aFire.w;
if(glow>.5){
// The settlement's light in the haze above it: its width on screen from its spread.
float px=aFire.x*projectionMatrix[1][1]*uHeight/max(D,1.);
vShape=vec4(0.,0.,clamp(px,6.,256.),1.);
vCore=vec3(0.);
vHalo=col*scatter*${glsl(config.glow.gain)}*(1.+.25*breath)*keep;
}else{
float sigma=mix(${glsl(size.core[0])},${glsl(size.core[1])},clamp(aFire.x,0.,1.)), halo=${glsl(size.halo)}*uPixelRatio*uHalo;
vShape=vec4(sigma,halo,2.*ceil(max(halo,${glsl(size.pool[0])}+1.))+1.,0.);
vCore=mix(col,${vec3(colour.hot)},${glsl(colour.core)})*T*aFire.x*${glsl(config.light.core)}*keep;
vHalo=col*scatter*aFire.x*${glsl(config.light.halo)}*keep;
// The core and halo together, at the flicker's crest, stay under the bloom's
// threshold over the dark plain, so the halo is the fire's only glow on every
// tier and nothing blooms elsewhere; the brightest fires still breathe.
float peak=dot(vCore+vHalo,vec3(.2126,.7152,.0722))*${glsl(+(1 + config.flicker.breath + config.flicker.flutter).toFixed(4))};
float cap=min(1.,${glsl(config.light.peak)}/max(peak,1e-4))*f;
vCore*=cap;
vHalo*=cap;
}
gl_PointSize=vShape.z;
if(keep<.002)gl_Position=vec4(2.,2.,2.,1.);
}`,
    fragmentShader: `uniform float uPool;
varying vec3 vCore, vHalo;
varying vec4 vShape;
void main(){
vec2 q=(gl_PointCoord-.5)*vShape.z;
if(vShape.w>.5){
vec2 e=q/(.5*vShape.z*vec2(1.,${glsl(config.glow.aspect)}));
float g=exp(-2.5*dot(e,e))*(1.-smoothstep(.75,1.,length(e)));
gl_FragColor=vec4(vHalo*g,1.);
return;
}
float r2=dot(q,q), r=sqrt(r2);
float core=exp(-.5*r2/(vShape.x*vShape.x));
float halo=exp(-3.*r/vShape.y)*(1.-smoothstep(.6*vShape.y,vShape.y,r));
// A faint warm pool on the ground beneath it (y down in the sprite).
vec2 p=(q-vec2(0.,${glsl(size.pool[2])}))/vec2(${glsl(size.pool[0])},${glsl(size.pool[1])});
float pool=uPool*exp(-dot(p,p)*1.5);
gl_FragColor=vec4(vCore*(core+pool)+vHalo*halo,1.);
}`,
    // Added light that keeps the film's depth layer in alpha (architecture.js streak).
    blending: CustomBlending,
    blendSrc: SrcAlphaFactor,
    blendDst: OneFactor,
    blendSrcAlpha: ZeroFactor,
    blendDstAlpha: OneFactor,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    fog: false,
  });
}

export function farFireGeometry(fires) {
  const positions = [],
    data = [];
  for (const fire of fires) {
    positions.push(fire.x, fire.y, fire.z);
    data.push(fire.power, fire.temperature, fire.seed, fire.kind);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("aFire", new Float32BufferAttribute(data, 4));
  return geometry;
}

// How many of the fires a tier draws (they are ordered by rank).
export function farFireCount(fires, tier, config = FAR_FIRES) {
  return tier === "balanced" ? Math.ceil(fires.length * config.balanced.share) : fires.length;
}

const EMPTY = Object.freeze({ x: 2, y: 2, z: -1, w: -1 });
// The silhouette of a subject as `bands` world boxes up its height, from every
// third vertex of its meshes; kept with the root's inverse world matrix then,
// so a moved root (a new composition's scene offset) carries them.
function subjectBands(root, bands) {
  root.updateWorldMatrix(true, true);
  const whole = new Box3().setFromObject(root);
  if (whole.isEmpty()) return null;
  const boxes = Array.from({ length: bands }, () => new Box3()),
    point = new Vector3(),
    low = whole.min.y,
    height = Math.max(whole.max.y - low, 1e-3);
  root.traverse((mesh) => {
    const position = mesh.isMesh && mesh.visible ? mesh.geometry?.attributes?.position : null;
    if (!position) return;
    for (let i = 0; i < position.count; i += 3) {
      point.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
      const band = Math.min(bands - 1, Math.floor(((point.y - low) / height) * bands));
      boxes[Math.max(0, band)].expandByPoint(point);
    }
  });
  // A band no vertex reached (a coarse mesh) takes its nearest band's footprint.
  boxes.forEach((box, band) => {
    if (!box.isEmpty()) return;
    const nearest = boxes
      .map((other, at) => [Math.abs(at - band), other])
      .filter(([, other]) => !other.isEmpty())
      .sort((a, b) => a[0] - b[0])[0]?.[1];
    if (!nearest) return;
    box.copy(nearest);
    box.min.y = low + (band / bands) * height;
    box.max.y = low + ((band + 1) / bands) * height;
  });
  return { root, boxes, inverse: root.matrixWorld.clone().invert() };
}

// The film's distant firelights (FAR_FIRES), a subsystem under the ground's
// root, shown with the film. camera: the scene camera; subjects: () => the
// tower's and the tree's roots (or null); shot: () => the current directed
// shot; textGuard: the slate's contacts (index.js createSlateContacts()),
// whose text boxes and aspect the fires borrow and never free.
export function createFarFires({
  parent,
  camera = null,
  subjects = () => [],
  shot = () => null,
  textGuard = {},
  profile = {},
  config = FAR_FIRES,
}) {
  const fires = farFireLayout(config),
    subjectRects = Array.from({ length: SUBJECT_RECTS }, () => new Vector4(2, 2, -1, -1));
  const uniforms = {
    uTime: { value: 0 },
    uPixelRatio: { value: 1 },
    uHeight: { value: 900 },
    uHalo: { value: 1 },
    uPool: { value: config.light.pool },
    uMist: RANGE_MIST,
    uClear: { value: new Vector4(2, 2, -1, -1) },
    uSubjects: { value: subjectRects },
    slateText: textGuard.slateText ?? { value: { ...EMPTY } },
    slateAbout: textGuard.slateAbout ?? { value: { ...EMPTY } },
    slateAspect: textGuard.slateAspect ?? { value: 1 },
  };
  const material = farFireMaterial(config, uniforms),
    points = new Points(farFireGeometry(fires), material);
  points.name = "far-fires";
  points.frustumCulled = false;
  // After the ranges (-0.5), with the other added light.
  points.renderOrder = 4;
  points.visible = false;
  parent.add(points);
  const bands = new Map(),
    corner = new Vector3(),
    carry = new Matrix4();
  let disposed = false,
    film = false,
    tier = profile.tier ?? "high",
    cssHeight = 900;
  function applyTier() {
    const balanced = tier === "balanced";
    points.geometry.setDrawRange(0, farFireCount(fires, tier, config));
    uniforms.uPool.value = balanced ? config.balanced.pool : config.light.pool;
    uniforms.uHalo.value = balanced ? config.balanced.halo : 1;
  }
  // Each subject band's box on the canvas, in its UV (y up): its corners in
  // front of the lens and, where an edge crosses the near plane, the crossing
  // (a box wholly behind the lens covers nothing).
  const view = Array.from({ length: 8 }, () => new Vector3());
  function extend(rect, point) {
    corner.copy(point).applyMatrix4(camera.projectionMatrix);
    const x = corner.x * 0.5 + 0.5,
      y = corner.y * 0.5 + 0.5;
    rect.set(Math.min(rect.x, x), Math.min(rect.y, y), Math.max(rect.z, x), Math.max(rect.w, y));
  }
  function projectBox(box, rect) {
    rect.set(2, 2, -1, -1);
    if (box.isEmpty()) return;
    const plane = -camera.near;
    for (let k = 0; k < 8; k++)
      view[k]
        .set(
          k & 1 ? box.max.x : box.min.x,
          k & 2 ? box.max.y : box.min.y,
          k & 4 ? box.max.z : box.min.z,
        )
        .applyMatrix4(carry)
        .applyMatrix4(camera.matrixWorldInverse);
    for (let k = 0; k < 8; k++) {
      const a = view[k];
      if (a.z <= plane) extend(rect, a);
      for (const bit of [1, 2, 4]) {
        if (k & bit) continue;
        const b = view[k | bit];
        if (a.z <= plane === b.z <= plane) continue;
        extend(rect, corner.lerpVectors(a, b, (plane - a.z) / (b.z - a.z)));
      }
    }
  }
  function projectSubjects() {
    let slot = 0;
    for (const root of subjects() ?? []) {
      if (!root || slot >= SUBJECT_RECTS) continue;
      let entry = bands.get(root);
      if (entry === undefined) bands.set(root, (entry = subjectBands(root, config.guard.bands)));
      if (!entry) continue;
      carry.multiplyMatrices(root.matrixWorld, entry.inverse);
      for (const box of entry.boxes)
        if (slot < SUBJECT_RECTS) projectBox(box, subjectRects[slot++]);
    }
    for (; slot < SUBJECT_RECTS; slot++) subjectRects[slot].set(2, 2, -1, -1);
  }
  const controller = {
    lifecycleOrder: 32,
    root: points,
    fires,
    uniforms,
    get visible() {
      return points.visible;
    },
    setFilmActive(active) {
      if (disposed) return false;
      film = Boolean(active);
      points.visible = film && config.enabled && fires.length > 0;
      return true;
    },
    applyQuality(next = {}, { pixelRatio = uniforms.uPixelRatio.value } = {}) {
      if (disposed) return false;
      tier = next.tier ?? tier;
      uniforms.uPixelRatio.value = Math.max(0.5, pixelRatio);
      uniforms.uHeight.value = cssHeight * uniforms.uPixelRatio.value;
      applyTier();
      return true;
    },
    resize({ height = cssHeight } = {}) {
      if (disposed) return false;
      cssHeight = Math.max(1, height);
      uniforms.uHeight.value = cssHeight * uniforms.uPixelRatio.value;
      return true;
    },
    // The fires breathe on the scene clock: held by a visitor pause, an open
    // dialog and reduced motion, as the lantern's flame is.
    update({ deltaSeconds = 0, reducedMotion = false, motionPaused = false } = {}) {
      if (disposed || !points.visible) return false;
      if (!reducedMotion && !motionPaused && Number.isFinite(deltaSeconds))
        uniforms.uTime.value += Math.max(0, Math.min(0.1, deltaSeconds));
      const clear = config.shots?.[shot()?.name]?.clear;
      if (clear) uniforms.uClear.value.set(...clear);
      else uniforms.uClear.value.set(2, 2, -1, -1);
      if (camera) projectSubjects();
      return true;
    },
    dispose() {
      if (disposed) return false;
      disposed = true;
      points.removeFromParent();
      points.geometry.dispose();
      material.dispose();
      bands.clear();
      return true;
    },
  };
  controller.applyQuality(profile);
  return controller;
}
