import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  SphereGeometry,
  Vector2,
  Vector3,
} from "three";
import { starBlending } from "./depth-layers.js";

// The released disc: 6.5 sprite width * 1.15 group scale * 0.81 photosphere.
export const SOLAR_RADIUS = (6.5 * 1.15 * 0.81) / 2;
export const SOLAR_QUALITY = Object.freeze({
  high: Object.freeze({ detail: 3, loops: 12 }),
  balanced: Object.freeze({ detail: 2, loops: 6 }),
  low: Object.freeze({ detail: 1, loops: 0 }),
});
// The star's look: a hot, yellow-white core to a deep orange-red limb, kept in
// one band of the grade's cel step so the surface never posterises; a bright
// aura close to the limb (aura x exp(-auraFalloff x radii past it)) over a
// round glow that falls off from the limb (glow x exp(-falloff x radii past
// it)) and fades out over its last `fade` radii before `reach` (the owner's
// note of 2026-10-09: a flat glow with a hard edge read as one of the clouds'
// cel bands); the star mask follows its coverage, so the clouds' steps also
// ease back in along the fade instead of at a ring; both lean `lean` toward a
// slowly wandering side; and a slight unrest: its light breathes by
// up to `breath` on irregular noise (`breathRate` per second), its limb boils
// by `boil` radii and its surface churns at `churn`. The corona plane is
// `plane` radii across. All of it runs on the celestial clock, so reduced
// motion holds it still.
export const SOLAR_LOOK = Object.freeze({
  core: Object.freeze([1, 0.97, 0.62]),
  rim: Object.freeze([1, 0.36, 0.05]),
  halo: Object.freeze({
    aura: 0.4,
    auraFalloff: 6,
    glow: 0.22,
    falloff: 1.3,
    reach: 2.6,
    fade: 0.9,
    lean: 0.25,
  }),
  breath: 0.1,
  breathRate: 0.5,
  leanRate: 0.03,
  boil: 0.04,
  churn: 0.07,
  plane: 7,
});
// The anamorphic streak across the star: SOLAR_RADIUS times length and height.
export const SOLAR_STREAK = Object.freeze({ length: 26, height: 1.4, strength: 0.32 });
// The star's fire, a living corona like the Eye of Sauron's (the owner's pick of
// 2026-10-09): flames stream out from the limb, layered noise in polar
// coordinates advected outward at `rise` radii a second and curling as they rise
// (`curl`). Their body falls off over `length` radii from the limb with a ragged,
// tongued edge, and slow licks (`licks`, on a `lickRate` clock) lengthen it; fine
// strands (`filaments`, the finest layer's angular frequency, `octaves` layers per
// tier, each fading out where it would alias) carry `strands` of its light, and
// strands that run past it break off as wisps (`wisps`) that fade as they climb.
// Amber at the limb to deep red at the tips (`hot`, `mid`, `tip`). `reach` is the
// furthest the fire goes from the centre, fading over its last 0.45 radii
// (SOLAR_GLOW_RADIUS includes it); `wide` lengthens the flames toward the sides
// (the Eye's sideways sweep). The fire fills only the room the corona and the
// lens streak leave under `knee` (luminance, easing in), and starts two pixels
// off the limb, so it never feeds the bloom (threshold 0.9 over the sky's own
// light) and The watch's reference banks stay pixel-identical. `quiet` keeps that
// share of the corona's aura, inner glow and streamers under it (below 1 the
// bloom, and so the banks, change). Its light writes the star mask at `mask` times
// its luminance, so the clouds' cel step never bands its wisps. `on` 0 keeps the
// star as it was.
export const SOLAR_FIRE = Object.freeze({
  on: 1,
  strength: 0.95,
  length: 0.42,
  licks: 1.3,
  lickRate: 0.08,
  reach: 2.2,
  wide: 0,
  rise: 0.2,
  curl: 1,
  filaments: 12,
  octaves: Object.freeze({ high: 3, balanced: 2, low: 1 }),
  wisps: 0.8,
  strands: 0.85,
  quiet: 1,
  knee: 0.6,
  mask: 6,
  hot: Object.freeze([1, 0.8, 0.45]),
  mid: Object.freeze([1, 0.36, 0.06]),
  tip: Object.freeze([0.55, 0.06, 0.02]),
});
// The glow's furthest reach in world units: its round edge, wobbled by the
// boiling limb and shifted by the lean at their most, or the fire's, if it
// reaches further (framing.test keeps it clear of the text and of The watch's
// crests).
export const SOLAR_GLOW_RADIUS =
  SOLAR_RADIUS *
  Math.max(
    SOLAR_LOOK.halo.reach + 4 * SOLAR_LOOK.boil + 0.08 * SOLAR_LOOK.halo.lean,
    SOLAR_FIRE.on ? SOLAR_FIRE.reach : 0,
  );
export function celestialTier(profile = {}) {
  return SOLAR_QUALITY[profile.tier] ? profile.tier : "high";
}
// Smooth 1D value noise, 0..1, from a seeded lattice: irregular, never periodic.
function wander(x, seed) {
  const i = Math.floor(x),
    f = x - i,
    u = f * f * (3 - 2 * f),
    h = (n) => {
      const v = Math.sin((n + seed * 17.13) * 127.1) * 43758.5453;
      return v - Math.floor(v);
    };
  return h(i) + (h(i + 1) - h(i)) * u;
}
// The star's unrest at celestial time `time`: its light's factor (1 +- breath)
// and the halo's lean, a vector up to `lean` long that slowly turns.
export function solarUnrest(time = 0, look = SOLAR_LOOK) {
  const b =
      0.65 * wander(time * look.breathRate, 1) + 0.35 * wander(time * look.breathRate * 2.3, 2),
    angle = Math.PI * 4 * wander(time * look.leanRate, 3),
    reach = look.halo.lean * (0.5 + 0.5 * wander(time * look.leanRate * 1.7, 4));
  return {
    breath: 1 + look.breath * (2 * b - 1),
    lean: [Math.cos(angle) * reach, Math.sin(angle) * reach],
  };
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

const NOISE = `
float hash31(vec3 p) {
  p = fract(p * .1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}
float noise3(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f*f*(3.0-2.0*f);
  return mix(mix(mix(hash31(i),hash31(i+vec3(1,0,0)),f.x),
                 mix(hash31(i+vec3(0,1,0)),hash31(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hash31(i+vec3(0,0,1)),hash31(i+vec3(1,0,1)),f.x),
                 mix(hash31(i+vec3(0,1,1)),hash31(i+vec3(1,1,1)),f.x),f.y),f.z);
}
float cells(vec3 p) {
  vec3 cell = floor(p), f = fract(p);
  float d = 2.0;
  for(int x=-1;x<=1;x++) for(int y=-1;y<=1;y++) for(int z=-1;z<=1;z++) {
    vec3 o=vec3(float(x),float(y),float(z)), c=cell+o;
    vec3 jitter=vec3(hash31(c),hash31(c+17.7),hash31(c+53.2));
    vec3 v=o+.18+.64*jitter-f;
    d=min(d,dot(v,v));
  }
  return sqrt(d);
}
`;
const SURFACE_VERTEX = `
varying vec3 vSurface;
varying vec3 vViewNormal;
varying vec3 vViewPosition;
void main() {
  vSurface = normalize(position);
  vViewNormal = normalize(normalMatrix * normal);
  vec4 p = modelViewMatrix * vec4(position,1.0);
  vViewPosition = p.xyz;
  gl_Position = projectionMatrix * p;
}
`;
const SURFACE_FRAGMENT = `
uniform float uTime;
uniform float uDetail;
uniform float uBreath;
varying vec3 vSurface;
varying vec3 vViewNormal;
varying vec3 vViewPosition;
${NOISE}
void main() {
  vec3 p=normalize(vSurface);
  float t=uTime*${glsl(SOLAR_LOOK.churn)};
  vec3 flow=vec3(noise3(p*3.1+vec3(t,0,0)),
                 noise3(p*3.1+vec3(11,t*.7,0)),
                 noise3(p*3.1+vec3(0,23,t*.5)))-.5;
  vec3 q=p+flow*.09;
  float broad=noise3(q*8.0+vec3(0,t*.18,0));
  float footprint=length(fwidth(q))*18.0;
  // Granules only where a cell spans a few pixels: finer, they would only speckle.
  float resolved=1.0-smoothstep(.25,.6,footprint);
  float granule=.5;
  if(uDetail>1.5 && resolved>.01) {
    float cell=cells(q*18.0);
    granule=mix(.5,1.0-smoothstep(.24,.78,cell),resolved);
  }
  float fine=.5;
  if(uDetail>2.5) fine=mix(.5,noise3(q*95.0),1.0-smoothstep(.04,.12,footprint));
  float network=noise3(q*17.0+vec3(t*.1,0,0));
  float heat=.7+.12*granule+.1*broad+.03*fine;
  // Stable active regions rotate with the sphere, rather than sliding over it.
  float spot=0.0, facula=0.0;
  vec3 s1=normalize(vec3(.64,.24,.72));
  vec3 s2=normalize(vec3(-.24,-.19,.95));
  vec3 s3=normalize(vec3(.35,-.44,-.82));
  float d1=length(p-s1)/.105, d2=length(p-s2)/.064, d3=length(p-s3)/.082;
  float d=min(d1,min(d2,d3));
  float umbra=1.0-smoothstep(.27,.53,d);
  float penumbra=(1.0-smoothstep(.55,1.3,d))*(.62+.38*noise3(p*40.0));
  spot=max(umbra*.5,penumbra*.22);
  facula=exp(-pow((d-1.7)*1.8,2.0))*.12;
  float mu=clamp(dot(normalize(vViewNormal),normalize(-vViewPosition)),0.0,1.0);
  float limb=.39+.61*pow(mu,.63);
  // A hot, yellow-white core to a deep orange-red limb; the light breathes.
  vec3 color=mix(${vec3(SOLAR_LOOK.rim)},${vec3(SOLAR_LOOK.core)},smoothstep(.42,1.0,heat)*(.55+.45*mu));
  color *= (heat*1.5+facula)*limb*(1.0-spot)*uBreath;
  color += vec3(.16,.037,.004)*pow(network,7.0)*.5*(1.0-spot);
  // Compress emission locally: the scene intentionally uses NoToneMapping.
  // Leave a little headroom for the existing bloom and parchment highlight grade.
  color *= .99*(1.0-exp(-color.r*2.6))/max(color.r,.001);
  gl_FragColor=vec4(color,1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
// The fire (SOLAR_FIRE) at p, r radii from the centre; edge is a pixel in radii.
const FIRE = SOLAR_FIRE.on
  ? `
uniform float uFireDetail;
vec3 solarFire(vec2 p, float r, float edge) {
  if(r>${glsl(SOLAR_FIRE.reach)}) return vec3(0.0);
  float h=max(0.0,r-1.0), t=uTime;
  vec2 n=p/max(r,1e-4);
  // The Eye's sideways sweep: flames toward the sides run longer.
  float side=1.0+${glsl(SOLAR_FIRE.wide)}*pow(abs(n.x),3.0);
  // Licks: broad tongues on a slow, irregular clock lengthen the flames.
  float lick=smoothstep(.42,.92,noise3(vec3(n*1.9,t*${glsl(SOLAR_FIRE.lickRate)})));
  float len=${glsl(SOLAR_FIRE.length)}*side*(1.0+${glsl(SOLAR_FIRE.licks)}*lick*lick);
  // The flames curl as they rise: their direction bends more the higher they reach.
  float bend=(noise3(vec3(n*2.7+7.0,h*1.4-t*${glsl(SOLAR_FIRE.rise * 0.6)}))-.5)*${glsl(SOLAR_FIRE.curl)}*h/side;
  vec2 m=vec2(cos(bend)*n.x-sin(bend)*n.y,sin(bend)*n.x+cos(bend)*n.y);
  // Filaments: fine strands streaming outward along the flow, layered; a layer
  // fades out where it would alias.
  float u=h/side-t*${glsl(SOLAR_FIRE.rise)}, f=0.0, w=0.0, amp=1.0, fa=${glsl(SOLAR_FIRE.filaments)}, fr=1.6;
  for(int i=0;i<4;i++){
    if(float(i)>=uFireDetail) break;
    float k=amp*(1.0-smoothstep(.22,.45,fa*edge/r));
    f+=k*noise3(vec3(m*fa,u*fr+float(i)*7.31));
    w+=k; amp*=.6; fa*=2.1; fr*=1.6;
  }
  float strands=smoothstep(.32,.76,w>0.0?f/w:.5);
  // The body: bright at the limb, falling off over the flames' length, its edge
  // ragged with broad tongues of the same flow.
  float ragged=noise3(vec3(m*${glsl(SOLAR_FIRE.filaments * 0.3)},u*1.2+3.7));
  float body=exp(-h/len)*smoothstep(-.1,.5,ragged*1.7+.3-h/len);
  float flame=body*(1.0-${glsl(SOLAR_FIRE.strands)}+${glsl(SOLAR_FIRE.strands)}*strands);
  // Wisps: strands that run past the flames break off and fade as they climb.
  float wv=noise3(vec3(m*${glsl(SOLAR_FIRE.filaments * 0.55)},(h/side-t*${glsl(SOLAR_FIRE.rise * 1.35)})*3.0+19.7));
  float wisp=${glsl(SOLAR_FIRE.wisps)}*smoothstep(.58,.85,wv)*(.4+.6*strands)*smoothstep(.5,1.1,h/len)*(1.0-smoothstep(1.2,2.4,h/len));
  float fire=(flame+wisp*exp(-.5*h/len))*(1.0-smoothstep(${glsl(SOLAR_FIRE.reach - 0.45)},${glsl(SOLAR_FIRE.reach)},r));
  // Amber at the limb to deep red at the tips.
  float temp=body*(.55+.45*strands);
  vec3 col=mix(${vec3(SOLAR_FIRE.tip)},${vec3(SOLAR_FIRE.mid)},smoothstep(.06,.4,temp));
  col=mix(col,${vec3(SOLAR_FIRE.hot)},smoothstep(.4,.9,temp));
  return col*fire*${glsl(SOLAR_FIRE.strength)}*uBreath;
}
`
  : "";
const QUIET = SOLAR_FIRE.on ? `*${glsl(SOLAR_FIRE.quiet)}` : "";
const CORONA_FRAGMENT = `
uniform float uTime;
uniform float uBreath;
uniform vec2 uLean;
varying vec2 vUv;
${NOISE}
${FIRE}
void main() {
  // p in solar radii across a plane SOLAR_LOOK.plane radii wide.
  vec2 p=(vUv-.5)*${glsl(SOLAR_LOOK.plane)};
  float r=length(p), a=atan(p.y,p.x);
  float edge=max(fwidth(r),.003);
  float outside=smoothstep(1.0-edge,1.0+edge,r);
  // The limb boils: the glow's inner edge wanders a little with angle and time.
  float boil=${glsl(SOLAR_LOOK.boil)}*(2.0*noise3(vec3(cos(a)*3.0,sin(a)*3.0,uTime*.35))-1.0);
  float h=max(0.0,r-1.0-boil);
  float weave=noise3(vec3(p*8.0,uTime*.05));
  // Streamers drift and flicker on time noise, never a steady beat.
  float drift=2.0*noise3(vec3(uTime*.06,3.1,0.0));
  float flick=.7+.6*noise3(vec3(cos(a)*2.0,sin(a)*2.0,uTime*.45));
  float rays=.46+.23*sin(a*7.0+.4+drift)+.17*sin(a*13.0-1.4-drift*.7)+.10*sin(a*29.0+weave);
  // A bright aura at the limb over a round amber glow that falls off smoothly, its faint fade
  // wobbling a little and leaning toward a slowly wandering side.
  float lean=1.0+dot(p/max(r,1e-4),uLean);
  float glow=${glsl(SOLAR_LOOK.halo.glow)}*exp(-h*${glsl(SOLAR_LOOK.halo.falloff)})*(1.0-smoothstep(${glsl(SOLAR_LOOK.halo.reach - SOLAR_LOOK.halo.fade)},${glsl(SOLAR_LOOK.halo.reach)},r-boil*4.0-.08*dot(p/max(r,1e-4),uLean)));
  float halo=(${glsl(SOLAR_LOOK.halo.aura)}*exp(-h*${glsl(SOLAR_LOOK.halo.auraFalloff)})${QUIET}+glow)*lean*uBreath;
  float inner=exp(-h*20.0)*.62*uBreath${QUIET};
  float stream=exp(-h*(9.0-rays*5.0))*(.13+.28*pow(max(0.0,rays),3.0))*flick${QUIET};
  float filaments=pow(.5+.5*sin(a*93.0+weave*3.0),9.0)*exp(-h*18.0)*.055${QUIET};
  float alpha=(halo+inner+stream+filaments)*outside*(1.0-smoothstep(${glsl(SOLAR_LOOK.plane / 2 - 0.6)},${glsl(SOLAR_LOOK.plane / 2)},r));
  ${
    SOLAR_FIRE.on
      ? `vec3 corona=mix(vec3(1.0,.46,.1),vec3(1.0,.76,.42),exp(-h*8.0))*alpha, fire=solarFire(p,r,edge)*smoothstep(1.0+edge,1.0+3.0*edge,r);
  // The fire fills only the room under the knee left by the glow and the lens streak
  // over it (SOLAR_STREAK, the same profile), easing in, never past it.
  vec2 q=abs(p)/vec2(${glsl(SOLAR_STREAK.length / 2)},${glsl(SOLAR_STREAK.height / 2)});
  float streak=exp(-q.y*q.y*28.0)*(exp(-q.x*3.2)*.8+exp(-q.x*q.x*40.0)*.6)*(1.0-smoothstep(.85,1.0,q.x))*${glsl(SOLAR_STREAK.strength * (0.2126 + 0.7152 * 0.62 + 0.0722 * 0.32))}*uBreath;
  float room=max(0.0,${glsl(SOLAR_FIRE.knee)}-dot(corona,vec3(.2126,.7152,.0722))-streak), lit=dot(fire,vec3(.2126,.7152,.0722));
  fire*=room*(1.0-exp(-lit/max(room,1e-4)))/max(lit,1e-4);
  gl_FragColor=vec4(corona+fire,min(alpha+dot(fire,vec3(.2126,.7152,.0722))*${glsl(SOLAR_FIRE.mask)},1.0));`
      : `gl_FragColor=vec4(mix(vec3(1.0,.46,.1),vec3(1.0,.76,.42),exp(-h*8.0))*alpha,min(alpha,1.0));`
  }
  #include <colorspace_fragment>
}
`;
const CORONA_VERTEX = `
varying vec2 vUv;
void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}
`;
const LOOP_VERTEX = `
attribute vec3 aTangent;
attribute float aSide;
attribute float aProgress;
attribute float aPhase;
uniform vec2 uResolution;
varying float vSide;
varying float vProgress;
varying float vPhase;
varying float vOver;
void main() {
  vec4 view=modelViewMatrix*vec4(position,1.0);
  // Across the disc a loop is a faint filament, not a bright scratch.
  vec3 c=(modelViewMatrix*vec4(0.0,0.0,0.0,1.0)).xyz, v=normalize(c), d=view.xyz-c;
  vOver=step(dot(d,v),0.0)*(1.0-smoothstep(${glsl(SOLAR_RADIUS * 0.92)},${glsl(SOLAR_RADIUS * 1.02)},length(d-dot(d,v)*v)));
  vec3 tangent=mat3(modelViewMatrix)*aTangent;
  vec2 side=normalize(vec2(-tangent.y,tangent.x)+vec2(.00001));
  gl_Position=projectionMatrix*view;
  gl_Position.xy+=side*aSide*2.2/uResolution*gl_Position.w;
  vSide=aSide; vProgress=aProgress; vPhase=aPhase;
}
`;
const LOOP_FRAGMENT = `
uniform float uTime;
varying float vSide;
varying float vProgress;
varying float vPhase;
varying float vOver;
// Smooth 1D value noise, 0..1.
float wander(float x) {
  float i=floor(x), f=fract(x);
  f=f*f*(3.0-2.0*f);
  return mix(fract(sin(i*127.1)*43758.5453),fract(sin((i+1.0)*127.1)*43758.5453),f);
}
void main() {
  // Each loop flares and fades on its own irregular clock: soft, continuous arcs.
  float envelope=smoothstep(.45,.9,wander(uTime*.07+vPhase*5.3));
  float width=exp(-vSide*vSide*3.4);
  float ends=smoothstep(0.0,.035,vProgress)*(1.0-smoothstep(.965,1.0,vProgress));
  vec3 color=mix(vec3(1.0,.52,.2),vec3(1.0,.16,.02),pow(abs(vSide),.6));
  float cover=width*ends*envelope*.7*(1.0-.8*vOver);
  gl_FragColor=vec4(color*cover,cover);
  #include <colorspace_fragment>
}
`;

export function makeLoopGeometry(radius = SOLAR_RADIUS, seed = 7143) {
  const random = seededRandom(seed),
    positions = [],
    tangents = [],
    sides = [],
    progress = [],
    phases = [],
    indices = [];
  const count = SOLAR_QUALITY.high.loops,
    segments = 56;
  for (let loop = 0; loop < count; loop++) {
    const azimuth = random() * Math.PI * 2,
      latitude = (random() - 0.5) * 1.4;
    const n = new Vector3(
      Math.cos(latitude) * Math.cos(azimuth),
      Math.sin(latitude),
      Math.cos(latitude) * Math.sin(azimuth),
    );
    // Loops run along the meridian: an east-west arch at the side limbs lies
    // in the view ray's plane and projects edge-on as a flat radial "handle",
    // while a meridional one is seen side-on there, rising from the limb.
    const tangent = new Vector3(-Math.sin(azimuth), 0.15 * (random() - 0.5), Math.cos(azimuth))
      .cross(n)
      .normalize();
    const span = 0.16 + random() * 0.26,
      height = 0.1 + random() * 0.23,
      phase = random() * Math.PI * 2;
    const path = (u) =>
      n
        .clone()
        .multiplyScalar(Math.cos((u - 0.5) * span))
        .addScaledVector(tangent, Math.sin((u - 0.5) * span))
        .normalize()
        .multiplyScalar(radius * (1 + height * Math.sin(Math.PI * u)));
    for (let j = 0; j <= segments; j++) {
      const u = j / segments,
        p = path(u),
        d = path(Math.min(1, u + 0.001))
          .sub(path(Math.max(0, u - 0.001)))
          .normalize();
      for (const side of [-1, 1]) {
        positions.push(...p.toArray());
        tangents.push(...d.toArray());
        sides.push(side);
        progress.push(u);
        phases.push(phase);
      }
      if (j < segments) {
        const k = loop * (segments + 1) * 2 + j * 2;
        indices.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
      }
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("aTangent", new Float32BufferAttribute(tangents, 3));
  geometry.setAttribute("aSide", new Float32BufferAttribute(sides, 1));
  geometry.setAttribute("aProgress", new Float32BufferAttribute(progress, 1));
  geometry.setAttribute("aPhase", new Float32BufferAttribute(phases, 1));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  geometry.userData.indicesPerLoop = segments * 6;
  return geometry;
}

export function createSolarBody({ parent, camera, position, profile = {} }) {
  const root = new Group(),
    rotating = new Group(),
    clock = createCelestialClock(),
    parentQuaternion = new Quaternion();
  root.name = "solar-body";
  root.position.copy(position);
  root.add(rotating);
  parent.add(root);
  const uTime = { value: 0 },
    uDetail = { value: 3 },
    uBreath = { value: 1 },
    uLean = { value: new Vector2() },
    uFireDetail = { value: SOLAR_FIRE.octaves.high };
  const surfaceMaterial = new ShaderMaterial({
    name: "SolarPhotosphere",
    uniforms: { uTime, uDetail, uBreath },
    vertexShader: SURFACE_VERTEX,
    fragmentShader: SURFACE_FRAGMENT,
    transparent: true,
    ...starBlending(true),
    depthWrite: true,
    depthTest: true,
    fog: false,
    extensions: { derivatives: true },
  });
  const surface = new Mesh(new SphereGeometry(SOLAR_RADIUS, 48, 32), surfaceMaterial);
  surface.name = "solar-photosphere";
  surface.renderOrder = 100;
  rotating.add(surface);
  const coronaMaterial = new ShaderMaterial({
    name: "SolarCorona",
    uniforms: { uTime, uBreath, uLean, uFireDetail },
    vertexShader: CORONA_VERTEX,
    fragmentShader: CORONA_FRAGMENT,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    fog: false,
    ...starBlending(),
    extensions: { derivatives: true },
  });
  const corona = new Mesh(
    new PlaneGeometry(SOLAR_RADIUS * SOLAR_LOOK.plane, SOLAR_RADIUS * SOLAR_LOOK.plane),
    coronaMaterial,
  );
  corona.name = "solar-corona";
  corona.renderOrder = 102;
  root.add(corona);
  // The lens's anamorphic streak: a thin warm line across the star, breathing
  // with it (SOLAR_STREAK: length and height in radii, strength).
  const streakMaterial = new ShaderMaterial({
    name: "SolarStreak",
    uniforms: { uBreath, uStrength: { value: SOLAR_STREAK.strength } },
    vertexShader: `varying vec2 vUv;
void main(){vUv=uv*2.-1.;vec4 mv=modelViewMatrix*vec4(position,1.);mv.xyz+=normalize(-mv.xyz)*${glsl(SOLAR_RADIUS * 1.1)};gl_Position=projectionMatrix*mv;}`,
    fragmentShader: `uniform float uBreath, uStrength;
varying vec2 vUv;
void main(){
float x=abs(vUv.x), y=abs(vUv.y);
float line=exp(-y*y*28.)*(exp(-x*3.2)*.8+exp(-x*x*40.)*.6)*(1.-smoothstep(.85,1.,x));
gl_FragColor=vec4(vec3(1.,.62,.32)*line*uStrength*uBreath,min(line,1.));
}`,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    fog: false,
    ...starBlending(),
  });
  const streak = new Mesh(
    new PlaneGeometry(SOLAR_RADIUS * SOLAR_STREAK.length, SOLAR_RADIUS * SOLAR_STREAK.height),
    streakMaterial,
  );
  streak.name = "solar-streak";
  streak.renderOrder = 103;
  root.add(streak);
  // Prominences keep a 2.2 CSS-pixel width, tuned at DPR 1. Their offset
  // is in NDC, so the CSS viewport sets it whatever the target's pixel ratio.
  const resolution = new Vector2(1, 1);
  const loopMaterial = new ShaderMaterial({
    name: "SolarProminences",
    uniforms: { uTime, uResolution: { value: resolution } },
    vertexShader: LOOP_VERTEX,
    fragmentShader: LOOP_FRAGMENT,
    side: DoubleSide,
    forceSinglePass: true,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    fog: false,
    ...starBlending(),
  });
  const loops = new Mesh(makeLoopGeometry(), loopMaterial);
  loops.name = "solar-prominences";
  loops.renderOrder = 101;
  rotating.add(loops);
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
      uDetail.value = SOLAR_QUALITY[tier].detail;
      uFireDetail.value = SOLAR_FIRE.octaves[tier] ?? 1;
      loops.geometry.setDrawRange(
        0,
        SOLAR_QUALITY[tier].loops * loops.geometry.userData.indicesPerLoop,
      );
      loops.visible = SOLAR_QUALITY[tier].loops > 0;
      return true;
    },
    resize({ width = 1, height = 1 } = {}) {
      if (disposed) return false;
      resolution.set(Math.max(1, width), Math.max(1, height));
      return true;
    },
    update({ elapsedSeconds = 0, reducedMotion = false, motionPaused = false } = {}) {
      if (disposed) return false;
      // A visitor pause or an open dialog holds the fire with the rest of the star.
      uTime.value = clock.tick(elapsedSeconds, reducedMotion || motionPaused);
      const unrest = solarUnrest(uTime.value);
      uBreath.value = unrest.breath;
      uLean.value.set(...unrest.lean);
      rotating.rotation.set(0.2, uTime.value * 0.011, -0.12);
      if (camera) {
        camera.getWorldQuaternion(corona.quaternion);
        root.getWorldQuaternion(parentQuaternion).invert();
        corona.quaternion.premultiply(parentQuaternion);
        streak.quaternion.copy(corona.quaternion);
      }
      return true;
    },
    dispose() {
      if (disposed) return false;
      disposed = true;
      root.removeFromParent();
      for (const object of [surface, loops, corona, streak]) {
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
