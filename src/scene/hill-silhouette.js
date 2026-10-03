import {
  BufferAttribute,
  BufferGeometry,
  DataTexture,
  DoubleSide,
  FrontSide,
  Group,
  Mesh,
  MeshLambertMaterial,
  NearestFilter,
  NoBlending,
  NoColorSpace,
  RepeatWrapping,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  Vector2,
  Vector3,
} from "three";
import {
  ARCHITECTURE_ASSET_URLS,
  collectResources,
  loadArchitectureAsset,
} from "./architecture-assets.js";
import { DEPTH_LAYER } from "./depth-layers.js";
import { FILM_SKY_GLSL } from "./estate-sky.js";

// South Downs elevation traverse, 48 samples (SRTM-derived public-domain
// data). Reused at different phases for fixed, continuous ridges.
export const HILL_PROFILE = Object.freeze([
  0.091, 0.081, 0.081, 0.09, 0.092, 0.098, 0.12, 0.151, 0.219, 0.246, 0.269, 0.281, 0.311, 0.413,
  0.567, 0.72, 0.839, 0.927, 0.858, 0.716, 0.621, 0.529, 0.415, 0.338, 0.326, 0.249, 0.199, 0.183,
  0.166, 0.141, 0.129, 0.107, 0.08, 0.057, 0.038, 0.021, 0.02, 0.029, 0.046, 0.068, 0.091, 0.1,
  0.111, 0.123, 0.134, 0.125, 0.115, 0.104,
]);
export const HILL = Object.freeze({
  innerRadius: 135,
  outerRadius: 210,
  amplitude: 22,
  radialSegments: 144,
  ringSegments: 3,
  color: 0x262b39,
});

// Moonlit snow on the film ranges (the shader below; the ranges themselves are
// built by the lazy mountain-build.js). Each massif (aTerrain.w: its smoothed
// height) above `line` degrees carries a cap `depth` x (massif - line) deep, at
// most `max`, whose level snowline is jittered by noise (a share of the cap,
// at least `jitterMin` degrees) and drops a further `tongue` x cap down the
// gullies. Lit snow is `lit` x the sky's luma and shadowed snow `shade` x, both
// seen through the range's air.
export const SNOW = Object.freeze({
  line: 2.9,
  depth: 0.6,
  max: 3.6,
  jitter: 0.3,
  jitterMin: 0.25,
  tongue: 0.5,
  lit: 3.8,
  shade: 1.25,
});
// The Meshy massifs' snow (MASSIFS): the rings' rule, deeper, with each copy's
// own snowline `line` (mountain-build.js RANGE_PLACEMENTS snow), so the
// massifs carry real caps, the lower ones too; lit and shade are lower, as the
// massifs' air is thinner than the far rings', so lit snow still reads about
// 2.2 times the sky behind it. Snow lies smoother than the rock under it: it
// holds on the relief `hold` mip levels down, takes its soft light from
// `soft` levels down and its crisp terminator from `edge` levels down, so the
// source's small bumps never punch round holes in it and its flutes never
// stripe it; `rib` x the source's fine whiteness (the mask less its blur)
// carves the bare ribs down the fall line.
export const MASSIF_SNOW = Object.freeze({
  ...SNOW,
  depth: 0.7,
  max: 3.4,
  lit: 2.7,
  shade: 1,
  hold: 2,
  soft: 3,
  edge: 5,
  rib: 2.5,
});
// JS mirror of the shader's snowline: whether snow can reach `elevation`
// degrees on a massif `massif` degrees high, with the jitter and gully tongue
// at their most generous (`snow`: SNOW for the rings, MASSIF_SNOW for the
// massifs). 1 inside that reach, 0 beyond it.
export function snowReach(elevation, massif, snow = SNOW) {
  const { line, depth, max, jitter, jitterMin, tongue } = snow,
    cap = Math.min(max, Math.max(0, (massif - line) * depth));
  return cap > 0.001 && elevation > massif - cap * (1 + tongue) - Math.max(cap * jitter, jitterMin)
    ? 1
    : 0;
}
// The ranges' air and rock, near to far: each range's aerial transmittance
// (summits see through thinner air: it rises toward its square root from 0.5
// to 6 degrees by `thin`), rock albedo, and the path light it hazes toward,
// the clear film sky plus `lift` of the clouds' average lift. The rock is lit
// by the moon key (`moon` on a face turned full to it) plus a blue sky
// ambient (`ambient` on an upward face), in units of the sky's luma, and
// never exceeds `rockMax` x the sky behind it. The feet fade to the shared
// slate over the lowest `footHazeHeight` units above the ground.
export const MOUNTAIN_AIR = Object.freeze({
  transmittance: Object.freeze([0.86, 0.72, 0.58, 0.44, 0.3]),
  albedo: Object.freeze([0.55, 0.75, 0.9, 1, 1.12]),
  thin: 0.5,
  lift: 0.3,
  moon: 0.78,
  ambient: 0.055,
  rockMax: 0.95,
  footHazeHeight: 3,
  renderOrder: -0.5,
});
const smooth01 = (a, b, x) => {
  const u = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return u * u * (3 - 2 * u);
};
// JS mirror of the shader's bare rock body (tests): its luma as a share of the
// sky's behind it, before snow, mist, rim and ink. lit: the face's moonlight,
// 0 (shadow) to 1 (turned full to the moon); up: the normal's y; clear: the
// share of the sky's luma that is clear sky rather than cloud lift.
export function mountainBody(range, lit, { up = 0.6, elevation = 1, clear = 0.75 } = {}) {
  const { transmittance, albedo, thin, lift, moon, ambient, rockMax } = MOUNTAIN_AIR,
    t = transmittance[range],
    seen = t + (Math.sqrt(t) - t) * thin * smooth01(0.5, 6, elevation),
    air = clear + lift * (1 - clear),
    rock = (moon * lit + ambient * (0.6 + 0.4 * up)) * albedo[range];
  return Math.min(rockMax, air + (rock - air) * seen);
}
// The mountain feet reach the far plain's air (HORIZON_AIR) over this distance.
// Ground uses a later distance fade and an independent fade before its edge.
export const HORIZON_HAZE = Object.freeze({ near: 150, far: 190 });
// Linear-light slate: the distant terrain's dark tone, which the puddles'
// mirror takes for its horizon (terrain-build.js) and HORIZON_AIR lifts for the
// far plain. The post chain writes it about 12/255 on screen. It is tuned
// against balanced, the phone default, whose lit slate is darker than high's:
// it stays near 57% of the lit ground on high and 67-80% on balanced; near luma
// .08 it would match the balanced slate at the frame edges.
export const TERRAIN_HORIZON = "vec3(.062,.065,.073)";
// The far plain's air. Below eye level, past the terrain's edge, the frame
// shows the ranges' lower bodies, which read as the plain itself; the bare
// slate there (11/255) would lie darker than both the mountain feet and the lit
// ground, a near-black band. So that body eases, within about a degree below
// eye level, to the slate lifted by `horizon` at eye level, rising to `edge`
// where the terrain's edge (TERRAIN_EDGE) meets the view: dark air that starts
// from the range's own dark foot at eye level and lightens below it, to about
// 18-22/255 on screen, still darker than the lit ground (about 33/255). The
// slate's far edge darkens toward `ground` x the slate but
// never lightens: the grade (postprocess.js) keeps the ground's cel step at
// luma .1 (x0.76 below, lifted above), and this gain stays above it, so the
// plain's edge never drops into the step.
export const HORIZON_AIR = Object.freeze({ horizon: 1.65, edge: 1.9, ground: 1.75 });
// The film terrain's half-width (filmic-earth.js EARTH, 384 units wide about the
// world origin); a test holds them equal.
export const TERRAIN_EDGE = 192;

function sampleProfile(angle) {
  const n = HILL_PROFILE.length,
    t = ((((angle / (Math.PI * 2)) % 1) + 1) % 1) * n;
  const i = Math.floor(t),
    f = t - i;
  return HILL_PROFILE[i % n] * (1 - f) + HILL_PROFILE[(i + 1) % n] * f;
}

export function createHillGeometry({
  groundHeight,
  innerRadius = HILL.innerRadius,
  outerRadius = HILL.outerRadius,
  amplitude = HILL.amplitude,
  radialSegments = HILL.radialSegments,
  ringSegments = HILL.ringSegments,
}) {
  const cols = radialSegments + 1,
    rows = ringSegments + 1;
  const positions = new Float32Array(cols * rows * 3);
  let cursor = 0;
  for (let ring = 0; ring < rows; ring++) {
    const rt = ring / ringSegments,
      radius = innerRadius + (outerRadius - innerRadius) * rt,
      blend = rt * rt * (3 - 2 * rt);
    for (let seg = 0; seg <= radialSegments; seg++) {
      const angle = (seg / radialSegments) * Math.PI * 2;
      const x = Math.cos(angle) * radius,
        z = Math.sin(angle) * radius;
      const base = groundHeight(x, z);
      positions[cursor] = x;
      positions[cursor + 1] = base + (amplitude * sampleProfile(angle) - base) * blend;
      positions[cursor + 2] = z;
      cursor += 3;
    }
  }
  const indices = [];
  for (let ring = 0; ring < ringSegments; ring++)
    for (let seg = 0; seg < radialSegments; seg++) {
      const a = ring * cols + seg,
        b = a + cols,
        c = a + 1,
        d = b + 1;
      indices.push(a, b, c, b, d, c);
    }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

const glslFloat = (value) => (Number.isInteger(value) ? value.toFixed(1) : String(value));
// A per-range constant as GLSL: the range index (vT.y, or the GLSL `at`) selects
// its value.
const perRange = (values, at = "vT.y") =>
  values
    .slice(1)
    .reduce(
      (glsl, value, i) => `mix(${glsl},${glslFloat(value)},step(${i + 0.5},${at}))`,
      glslFloat(values[0]),
    );

// GLSL both film mountain materials share, the procedural ranges (EstateMountains) and the
// Meshy massifs (EstateMeshyRanges); each reads vL (the camera-relative position), vT.y (the
// range) and, from the first, the names it declares. The sky behind the pixel: the view ray
// cast onto the real sky shell (uSky: radius squared, shell opacity) gives the film sky there
// (s0), with the cloud banks' average lift (s) and the path light the rock hazes toward (air).
const SKY_BEHIND_GLSL = `vec3 d=normalize(vL), o=cameraPosition, W=vec3(.2126,.7152,.0722), K=vec3(.715,.625,.313);
float b=dot(o,d), t=-b+sqrt(max(b*b-dot(o,o)+uSky.x,0.)), a=(o.y+d.y*t)*inversesqrt(uSky.x);
vec3 s0=(filmSky(a)+filmBand(a))*uSky.y, lift=vec3(.24,.24,.3)*smoothstep(-.03,.17,a)*uSky.y, s=s0+lift, air=s0+${glslFloat(MOUNTAIN_AIR.lift)}*lift;`;
// The rock body from the face's moonlight (lit), its upward share (n.y) and occlusion (ao), seen
// through the air of range `at` (MOUNTAIN_AIR) and never lighter than the sky behind it.
const rockBodyGLSL = (at) => {
  const { transmittance, albedo, thin, moon, ambient, rockMax } = MOUNTAIN_AIR;
  return `float T=${perRange(transmittance, at)}, alb=${perRange(albedo, at)};
// Lit neutral grey to blue shadow, in units of the sky's luma.
vec3 c=(vec3(.9705,.9999,1.0881)*${glslFloat(moon)}*lit+vec3(.8117,.9991,1.5611)*${glslFloat(ambient)}*(.6+.4*n.y))*ao*alb*sL;
float Th=mix(T,sqrt(T),${glslFloat(thin)}*smoothstep(.5,6.,el));
c=mix(air,c,Th);
c*=min(1.,${glslFloat(rockMax)}*sL/max(dot(c,W),1e-4));`;
};
// The orb's faint warm glow and the crest rims about sky level (px: pixels below the crest;
// slim: a thin strip's share, 0 on the massifs).
const GLOW_RIM_GLSL = `// A faint warm glow toward the orb; the rims about sky level.
vec2 v=d.xz/max(length(d.xz),1e-4), toSun=normalize(uSun.xz-o.xz);
c*=1.+vec3(.06,.02,-.04)*pow(max(dot(v,toSun),0.),10.);
float cr=1.-smoothstep(.8,3.5,px);
c+=cr*(1.-.8*slim)*(vec3(.55,.62,.8)*.12*max(dot(v,normalize(vec2(32,14))),0.)
+vec3(.1,.07,.04)*pow(max(dot(v,toSun),0.),60.));`;
// The far plain's air (HORIZON_AIR) and the hazed feet (HORIZON_HAZE), on the fog's distances.
const FAR_PLAIN_GLSL = `#ifdef USE_FOG
// The far plain's air (HORIZON_AIR): from eye level to where the view meets the
// terrain's edge (the ray's horizontal reach to its square, at the camera's height
// above the datum, vH-vL.y). The body below eye level eases to it within .02 of slope,
// and the feet haze to it.
vec2 hz=vL.xz/r, ah=max(abs(hz),1e-4), eq=(${glslFloat(TERRAIN_EDGE)}-hz/ah*o.xz)/ah;
vec3 pa=${TERRAIN_HORIZON}*mix(${glslFloat(HORIZON_AIR.horizon)},${glslFloat(HORIZON_AIR.edge)},clamp(vL.y/r*min(eq.x,eq.y)/(vL.y-vH),0.,1.));
float fh=max(smoothstep(fogNear,fogFar,vD),smoothstep(${HORIZON_HAZE.near}.,${HORIZON_HAZE.far}.,vD));
c=mix(c,pa,fh*(1.-smoothstep(-.02,0.,vL.y/r)));
c=mix(c,pa,fh*(1.-smoothstep(0.,${glslFloat(MOUNTAIN_AIR.footHazeHeight)},vH)*smoothstep(-.05,-.008,vL.y/r)));
#endif`;
// Each crest's own ~1.4 px ink line (px: pixels below the crest; k: a quarter of the range).
const CREST_INK_GLSL = "c=mix(c,vec3(.012,.016,.03),(1.-smoothstep(.4,1.4,px))*(.7-.3*k));";

// Film mountains: vertices ride on the camera (world = cameraPosition + position), as
// the starfield does, so every shot and viewport gets a known backdrop. The ranges
// (mountain-build.js) carry per vertex aTerrain (degrees below the column's crest,
// range, a coarse vertex shade, massif height) and aForm (the
// face's turn along the ring, its lean to the viewer, convex/concave fold, and the
// nearer ranges' skyline in degrees).
// Each pixel is lit by the moon key: faces turn toward or away from it (a crisp,
// anti-aliased terminator blended with Lambert, lit neutral grey to blue shadow),
// broken by spurs, gullies and strata from polar noise whose cells stay at least
// 6 px wide; gullies and spurs slant down each flank along its fall line. The rock
// is seen through the range's air (MOUNTAIN_AIR) toward the path light and never
// lighter than the sky behind it, found by casting the ray onto the real sky shell
// (uSky: radius squared, shell opacity) plus the cloud banks' average lift. Valley
// mist rises from each nearer crest; on thin low strips it fades smoothly over most
// of the strip and the rim and lean hold still, so stacked ranges read as layers
// rather than echoing stripes. Snow (SNOW) is set against the sky: a
// level, noisy snowline per massif with tongues down the gullies, bare ribs and
// steep faces, and blue in shadow; its edge is anti-aliased across its own screen
// gradient, so steep tongue sides stay smooth. A faint warm glow leans toward the
// orb, a soft cool rim about sky level faces the key and a faint warm one the orb,
// and each crest draws its own ~1.4 px ink line: the post ink cannot find dark
// ridges on a dark sky, and the grade exempts this layer from its ink and cel step
// (postprocess.js uLayerRelief). Below eye level the body eases into the far
// plain's air (HORIZON_AIR, the lifted TERRAIN_HORIZON slate), and feet near the
// floor or below the horizon haze to it over the ground's horizon distances
// (HORIZON_HAZE), which hides where the ranges meet the plane. Transparent with no
// blending so it draws after the stars and covers them, writing its depth layer
// (depth-layers.js) exactly. Noise hashes reach about 1100 cells: highp.
function mountainMaterial({ skyRadius, shellOpacity, sunPosition }) {
  return new ShaderMaterial({
    name: "EstateMountains",
    transparent: true,
    blending: NoBlending,
    depthTest: true,
    depthWrite: true,
    side: FrontSide,
    fog: true,
    extensions: { derivatives: true },
    uniforms: UniformsUtils.merge([
      UniformsLib.fog,
      {
        uSky: { value: new Vector2(skyRadius ** 2, shellOpacity) },
        uSun: { value: new Vector3(...sunPosition) },
      },
    ]),
    // Compress backdrop depth so it cannot cut through world-space foothills.
    vertexShader: `
attribute vec4 aTerrain, aForm;
varying vec4 vT, vF;
varying vec3 vL;
varying float vD, vH;
void main() {
vT=aTerrain; vF=aForm; vL=position;
vec4 w=vec4(cameraPosition+position,1.0), m=viewMatrix*w;
vH=w.y-modelMatrix[3].y; vD=-m.z;
gl_Position=projectionMatrix*m;
gl_Position.z=mix(gl_Position.z,gl_Position.w,.8);
}`,
    fragmentShader: `
uniform vec2 uSky;
uniform vec3 uSun, fogColor;
uniform float fogNear, fogFar;
varying vec4 vT, vF;
varying vec3 vL;
varying float vD, vH;
${FILM_SKY_GLSL}
float mh(vec2 p){vec3 q=fract(p.xyx*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
// Value noise periodic in x over P cells around the ring; .y is its x slope.
vec2 pn(vec2 p,float P){vec2 i=floor(p),f=fract(p),u=f*f*(3.-2.*f);float i0=mod(i.x,P),i1=mod(i.x+1.,P);
float a=mh(vec2(i0,i.y)),b=mh(vec2(i1,i.y)),c=mh(vec2(i0,i.y+1.)),d=mh(vec2(i1,i.y+1.));
return vec2(mix(mix(a,b,u.x),mix(c,d,u.x),u.y),6.*f.x*(1.-f.x)*mix(b-a,d-c,u.y));}
void main() {
${SKY_BEHIND_GLSL}
float sL=max(dot(s,W),1e-4), far=step(.5,vT.y), k=vT.y*.25, px=vT.x/max(fwidth(vT.x),1e-5), r=length(vL.xz);
float el=degrees(atan(vL.y,r)), az=degrees(atan(vL.z,vL.x)), ppd=1./max(fwidth(el),1e-4);
vec2 h=vL.xz/r;
vec3 X=vec3(-h.y,0.,h.x), I=vec3(-h.x,0.,-h.y);
// How far this range rises above the nearer skyline here: a low strip only a
// degree or so tall keeps a nearly even body, so stacked strips never echo.
float crest=el+vT.x, rise=crest-vF.w, slim=far*(1.-smoothstep(.6,2.2,rise));
// Rock detail fades below the horizon (the fogged feet) and in the crest band (evenly on
// thin strips).
float det=smoothstep(-.6,.5,el)*mix(smoothstep(.1,.9,vT.x),.45,slim)*mix(.35,1.,far);
// Fall lines: gullies and spurs slant down each flank (aForm.x) by the depth below the
// smooth massif (aTerrain.w), not the toothed crest, so they bend smoothly across columns.
// Gullies (gw) leave thin strips and the near range's low crests: one gully cell spans such a
// strip top to bottom, so they would hang under its crest as a comb of vertical streaks.
float gw=(1.-slim)*mix(smoothstep(1.,3.,crest),1.,far), below=mix(vT.x,max(vT.w-el,0.),far), w=az+.6*(pn(vec2(az*.5,el*.5),180.).x-.5)-.35*clamp(vF.x,-2.,2.)*below;
// Gullies: ridged polar noise down the fall line, fine near the crest and merging into
// broad ones lower down; every cell stays >= 6 px (the fine octave fades on phones).
// The fine octave, the strata and the snowline's noise run only where they show (no
// derivative inside these branches, so they stay real branches on every backend).
vec2 g1=pn(vec2(w*1.3,el*.4),468.), g2=vec2(.5,0.);
float f2=smoothstep(6.,10.,ppd/3.1)*(1.-smoothstep(.4,2.4,vT.x));
if(f2>0.)g2=pn(vec2(w*3.1,el*1.1+7.),1116.);
// Creases turn the face through an anti-aliased sign (about a pixel wide), so the
// rock and the snow that follows them keep smooth edges.
float gs=mix(2.*g1.x-1.,2.*g2.x-1.,f2), gG=mix(g1.y,g2.y*2.4,f2)*clamp(gs/max(fwidth(gs),1e-4),-1.,1.)*.65*gw, gully=abs(gs);
// Spurs: broad facets (~2 degree cells) that open up below the summits, turned
// alternately toward and away from the moon.
vec2 g0=pn(vec2(w*.45,el*.22+11.),162.);
float q=2.*g0.x-1., gP=clamp(q/max(fwidth(q),1e-4),-1.,1.)*g0.y*.72, gS=gP*smoothstep(.3,2.5,vT.x)*det, gd=gG*det+gS;
// The snow reads the same relief faded in by the smooth massif depth instead, so its
// edges never copy the crest's teeth down the flank.
float dS=smoothstep(-.6,.5,el)*smoothstep(.1,.9,below), sS=gP*smoothstep(.3,2.5,below)*dS, steep=abs(vF.x+gG*dS+sS);
float st=smoothstep(6.,10.,ppd/2.2)*det;
if(st>0.)st*=pn(vec2(az*.3,el*2.2+.8*g1.x),108.).x-.5;
// Moonlit form: the face turns along the ring (aForm.x), leans to the viewer (y), folds (z).
// A thin strip keeps one lean and little fold from its crest down, so no terminator
// or fold contour runs parallel to the crest below it.
float lean=mix(vF.y,1.3-.33*k,slim), fold=vF.z*(1.-.7*slim);
vec3 n=normalize(X*(vF.x+gd)+I*lean*(1.+.25*fold)+vec3(0.,1.,0.));
// Faceted moonlight: Lambert blended with a crisp, anti-aliased terminator, so faces read as planes.
float nl=dot(n,K), te=max(.05,1.5*fwidth(nl)), crisp=smoothstep(.3-te,.3+te,nl);
float lit=mix(max(nl+.05,0.)/1.05,crisp*(.55+.45*nl),.5);
float ao=(1.-.18*max(-fold,0.))*(1.-.24*gully*gully*det*gw)*(1.+.18*st);
${rockBodyGLSL("vT.y")}
// Valley mist rising from each nearer crest (aForm.w): at most .9 degrees and never
// more than 60% of what shows above it. On a thin strip it fades smoothly over its
// lower two thirds instead, dark under its crest to misted at its foot, so the
// layers part without a second band echoing the crest.
float mist=(1.-smoothstep(0.,min(.9,mix(.6,.65,slim)*max(rise,.05)),el-vF.w))*far*mix(.7,.65,slim);
c=mix(c,mix(air,s,.9),mist);
// Snow: a level, noisy snowline per massif (aTerrain.w), long tongues down the gullies,
// bare rock on ribs and steep faces, blue in shadow.
float rib1=1.-abs(2.*g1.x-1.), ribT=0., line=0.;
float cap=clamp((vT.w-${glslFloat(SNOW.line)})*${glslFloat(SNOW.depth)},0.,${glslFloat(SNOW.max)});
if(cap>0.){ribT=1.-abs(2.*pn(vec2(w*1.6,el*.12+5.),576.).x-1.);
line=vT.w-cap+max(cap*${glslFloat(SNOW.jitter)},${glslFloat(SNOW.jitterMin)})*(1.2*pn(vec2(w*.6,el*.6+3.),216.).x+.8*mix(.5,pn(vec2(w*2.5,el*2.+9.),900.).x,smoothstep(6.,10.,ppd/2.5))-1.)
-cap*${glslFloat(SNOW.tongue)}*smoothstep(.5,1.,1.-rib1)+.6*smoothstep(.6,1.,rib1)*smoothstep(1.2,4.,steep);}
// Rock ribs push up through the lower snowfield as fingers that taper higher up, fading
// out where they would be narrower than about two pixels instead of aliasing.
float rt=mix(1.01,.9-.08*smoothstep(.8,3.2,steep),smoothstep(line+.35*cap,line,el)), rw=max(fwidth(ribT),1e-4);
// Anti-aliased across the snowline's own screen gradient: smooth on steep tongue sides too.
float se=el-line, sw=max(fwidth(se),.5/ppd);
if(cap>0.){float snow=step(.001,cap)*smoothstep(0.,1.6*sw,se)*(1.-.85*smoothstep(3.2,5.,steep))*(1.-.9*smoothstep(rt-rw,rt+rw,ribT)*smoothstep(.2,.8,below)*smoothstep(1.5,3.,1.9*(1.-rt)*ppd));
// Snow lies smoother than the rock under it: planar faces (big form and spurs, no gully relief).
float ns=dot(normalize(X*(vF.x+.35*sS)+I*lean*(1.+.25*fold)+vec3(0.,1.,0.)),K);
float sk=mix(smoothstep(-.3,1.,ns),smoothstep(.3-te,.3+te,ns),.5);
vec3 sn=mix(vec3(.8485,1.0027,1.4193)*${glslFloat(SNOW.shade)},vec3(.9691,1.0014,1.0768)*${glslFloat(SNOW.lit)},sk)*sL*(1.-.1*gully*det)*(1.+.12*(2.*st+.6*(g2.x-.5)*f2));
sn=mix(air,sn,mix(1.,T,.55));
c=mix(c,sn,snow*(1.-mist));}
${GLOW_RIM_GLSL}
${FAR_PLAIN_GLSL}
${CREST_INK_GLSL}
gl_FragColor=vec4(c,${DEPTH_LAYER.mountains});
}`,
  });
}

// The Meshy massifs (mountain-build.js RANGE_PLACEMENTS): the owner's three
// models, one mesh each with every copy of it, drawn before the backdrop rings
// (renderOrder) in front of them. Their GLBs load at the startup tier when the
// ranges are requested; their nearer layers' skyline texture follows
// mountain-build.js RANGE_SKY (a test holds them equal).
export const MASSIFS = Object.freeze({
  roles: Object.freeze(["mountain-ridge", "mountain-spine", "mountain-summit"]),
  renderOrder: -0.6,
  // Milliseconds the ranges wait for the massifs' GLBs before the five rings land instead.
  deadline: 12000,
  sky: Object.freeze({ texture: 4096, floor: -10, span: 40 }),
  // Layer n sees through range n + air's air (MOUNTAIN_AIR): big massifs far off,
  // hazier than the procedural rings at their layer's distance.
  air: 1,
});

// The Meshy massifs' shading: the ranges' moonlit style on the models' own
// relief. The object-space normal map (the GLB's normalTexture) is turned into
// the world by each copy's placement (aInst: the turn's cos and sin, mirror,
// squash); the mask (baseColorTexture: R the source's whiteness, G its ambient
// occlusion) shades crevices and lays the snow. The rock, its air, the rims,
// the far plain and the ink are the ranges' own (the shared GLSL above), with
// aTerrain = (degrees below the copy's own crest, layer, snowline: 0 on a bare
// copy, massif height).
// Valley mist rises from the nearer layers' skyline (uNearer: layer 0's and
// layers 0-1's, MASSIFS.sky). Snow (MASSIF_SNOW) keeps the ranges' level snowline per
// massif, jittered by smooth noise and drawn down gullies (the source's white or
// its occlusion) by up to `tongue` x the cap, never past snowReach(); above it the
// snow holds on all but near-vertical rock (of the smoothed relief) and the
// source's dark ribs, and is lit by a smoother relief still. Only copies with
// `snow` carry it.
function massifMaterial({ skyRadius, shellOpacity, sunPosition, normalMap, maskMap, nearerMap }) {
  const { texture: bins, floor, span } = MASSIFS.sky;
  const material = new ShaderMaterial({
    name: "EstateMeshyRanges",
    transparent: true,
    blending: NoBlending,
    depthTest: true,
    depthWrite: true,
    side: FrontSide,
    fog: true,
    extensions: { derivatives: true },
    uniforms: UniformsUtils.merge([
      UniformsLib.fog,
      {
        uSky: { value: new Vector2(skyRadius ** 2, shellOpacity) },
        uSun: { value: new Vector3(...sunPosition) },
      },
    ]),
    vertexShader: `
attribute vec4 aTerrain, aInst;
varying vec4 vT, vI;
varying vec3 vL;
varying vec2 vU;
varying float vD, vH;
void main() {
vT=aTerrain; vI=aInst; vU=uv; vL=position;
vec4 w=vec4(cameraPosition+position,1.0), m=viewMatrix*w;
vH=w.y-modelMatrix[3].y; vD=-m.z;
gl_Position=projectionMatrix*m;
gl_Position.z=mix(gl_Position.z,gl_Position.w,.8);
}`,
    fragmentShader: `
uniform vec2 uSky;
uniform vec3 uSun, fogColor;
uniform float fogNear, fogFar;
uniform sampler2D uNormal, uMask, uNearer;
varying vec4 vT, vI;
varying vec3 vL;
varying vec2 vU;
varying float vD, vH;
${FILM_SKY_GLSL}
// Smooth value noise, 0..1 (the snowline's jitter).
float vn(vec2 p){vec2 i=floor(p),f=fract(p),u=f*f*(3.-2.*f);
vec4 h=fract(sin(vec4(dot(i,vec2(127.1,311.7)),dot(i+vec2(1,0),vec2(127.1,311.7)),dot(i+vec2(0,1),vec2(127.1,311.7)),dot(i+1.,vec2(127.1,311.7))))*43758.5453);
return mix(mix(h.x,h.y,u.x),mix(h.z,h.w,u.x),u.y);}
// The relief b mip levels down, turned by the copy's placement: mirror x, undo
// the squash, turn about the vertical.
vec3 relief(float b){vec3 m=texture2D(uNormal,vU,b).xyz*2.-1.;
m.x*=vI.z; m.y/=vI.w;
return normalize(vec3(m.x*vI.x-m.z*vI.y,m.y,m.x*vI.y+m.z*vI.x));}
// The nearer layers' skyline at azimuth az (degrees): .x layer 0's, .y layers 0-1's.
vec2 nearer(float az){float x=fract(az/360.)*${glslFloat(bins)}-.5, i=floor(x), f=x-i;
vec4 p=texture2D(uNearer,vec2((mod(i,${glslFloat(bins)})+.5)/${glslFloat(bins)},.5)), q=texture2D(uNearer,vec2((mod(i+1.,${glslFloat(bins)})+.5)/${glslFloat(bins)},.5));
return mix((p.xz*65280.+p.yw*255.)/65535.,(q.xz*65280.+q.yw*255.)/65535.,f)*${glslFloat(span)}+${glslFloat(floor)};}
void main() {
${SKY_BEHIND_GLSL}
float sL=max(dot(s,W),1e-4), far=step(.5,vT.y), k=vT.y*.25, px=vT.x/max(fwidth(vT.x),1e-5), r=length(vL.xz), slim=0.;
float el=degrees(atan(vL.y,r)), az=degrees(atan(vL.z,vL.x)), ppd=1./max(fwidth(el),1e-4);
vec3 n=relief(0.);
vec2 mk=texture2D(uMask,vU).rg;
// Faceted moonlight, as the ranges': Lambert blended with a crisp, anti-aliased terminator.
float nl=dot(n,K), te=max(.05,1.5*fwidth(nl)), crisp=smoothstep(.3-te,.3+te,nl);
float lit=mix(max(nl+.05,0.)/1.05,crisp*(.55+.45*nl),.5), ao=mix(1.,mk.y,.6);
${rockBodyGLSL(`(vT.y+${glslFloat(MASSIFS.air)})`)}
// Valley mist rising from the nearer layers' skyline: at most .9 degrees, 70% at its foot.
vec2 nr=nearer(az);
float under=mix(nr.x,nr.y,step(1.5,vT.y)), rise=el+vT.x-under;
float mist=(1.-smoothstep(0.,min(.9,.6*max(rise,.05)),el-under))*far*.7;
c=mix(c,mix(air,s,.9),mist);
float cap=clamp((vT.w-vT.z)*${glslFloat(MASSIF_SNOW.depth)},0.,${glslFloat(MASSIF_SNOW.max)}), wv=smoothstep(.45,.85,mk.x);
// The tongues follow the mask a few mip levels down, so they never step with its texels.
// The snowline, its edge and the hold are derived outside the branch below.
vec2 mb=texture2D(uMask,vU,2.5).rg;
float gully=max(smoothstep(.45,.85,mb.x),smoothstep(.95,.75,mb.y));
float line=vT.w-cap*(1.+${glslFloat(MASSIF_SNOW.tongue)}*gully)-max(cap*${glslFloat(MASSIF_SNOW.jitter)},${glslFloat(MASSIF_SNOW.jitterMin)})*vn(vec2(az*1.7,el*.8));
float se=el-line, sw=max(fwidth(se),.5/ppd);
// Snow lies smoother than the rock under it. Above the line it holds where the smoothed
// relief is not near-vertical, a little steeper where the source is white, and off the
// source's fine dark ribs, which run down the fall line; with a crisp, anti-aliased edge
// to the bare rock. Its light comes from smoother relief still, so the source's flutes
// never stripe it.
vec3 nh=relief(${glslFloat(MASSIF_SNOW.hold)}), ns=relief(${glslFloat(MASSIF_SNOW.soft)}), ne=relief(${glslFloat(MASSIF_SNOW.edge)});
float rib=mk.x-texture2D(uMask,vU,3.).r;
float hold=nh.y+.3*(wv-.5)+${glslFloat(MASSIF_SNOW.rib)}*rib, hw=max(1.5*fwidth(hold),.04);
float ke=dot(ne,K), tk=max(.05,1.5*fwidth(ke));
if(vT.z>.5&&cap>0.){float snow=smoothstep(0.,1.6*sw,se)*clamp((hold+.04)/hw+.5,0.,1.);
float sk=mix(smoothstep(-.3,1.,dot(ns,K)),smoothstep(.3-tk,.3+tk,ke),.5);
vec3 sn=mix(vec3(.8485,1.0027,1.4193)*${glslFloat(MASSIF_SNOW.shade)},vec3(.9691,1.0014,1.0768)*${glslFloat(MASSIF_SNOW.lit)},sk)*sL;
sn=mix(air,sn,mix(1.,T,.55));
c=mix(c,sn,snow*(1.-mist));}
${GLOW_RIM_GLSL}
${FAR_PLAIN_GLSL}
// The crest's ink, as the rings', fading out below eye level, where the far plain's air
// has taken the rock; none on a sliver lying wholly on the crest (vT.x 0 at every corner).
c=mix(c,vec3(.012,.016,.03),(1.-smoothstep(.4,1.4,px))*(.7-.3*k)*smoothstep(-.6,.15,el)*step(1e-6,fwidth(vT.x)));
gl_FragColor=vec4(c,${DEPTH_LAYER.mountains});
}`,
  });
  // After the merge, which would clone the textures.
  Object.assign(material.uniforms, {
    uNormal: { value: normalMap },
    uMask: { value: maskMap },
    uNearer: { value: nearerMap },
  });
  return material;
}

// Film shows nothing behind the scene until the ranges land: an empty stand-in
// with the ranges' attributes, which draws nothing.
function emptyRanges() {
  const geometry = new BufferGeometry();
  for (const [name, size] of [
    ["position", 3],
    ["aTerrain", 4],
    ["aForm", 4],
  ])
    geometry.setAttribute(name, new BufferAttribute(new Float32Array(0), size));
  return geometry;
}

// The baseline keeps the South Downs ring; film swaps in the camera-centred ranges.
// Their geometry is the lazy mountain-build.js chunk, requested only when the film
// treatment is on at a visible quality (never on low): it builds in short slices and
// lands at once where the change cannot show mid-shot (before the reveal, on a tour
// cut, or while the tour is not running), otherwise fading in over the sky (0.45 s
// under the canvas's fade-in, 1.8 s mid-shot; mountain-build.js entrance()). Until
// then, or if the chunk fails, the film shows the empty stand-in.
// At a model tier (tier: high or balanced, the startup tier) the request also loads
// the Meshy massifs' GLBs (MASSIFS.roles, at low fetch priority, beside the chunk),
// and the build is the massifs with RANGE_BACKDROP's two rings behind them; if a GLB
// fails, the five rings land instead and the status reads "fallback".
// ready: the request's promise (null until requested), settled once the ranges
// land or the request fails. onStatus reports "loading", "ready" or "fallback".
export function createHillSilhouette({
  groundHeight,
  skyRadius = 130,
  shellOpacity = 1,
  sunPosition = [0, 0, -1],
  rendering = null,
  tour = null,
  tier = null,
  invalidate = () => {},
  onStatus = () => {},
  load = () => import("./mountain-build.js"),
  loadAsset = loadArchitectureAsset,
  urls = ARCHITECTURE_ASSET_URLS,
  ...overrides
} = {}) {
  const geometry = createHillGeometry({ groundHeight, ...overrides });
  const material = new MeshLambertMaterial({ color: HILL.color, side: DoubleSide });
  const mesh = new Mesh(geometry, material);
  mesh.name = "hill-silhouette";
  mesh.castShadow = mesh.receiveShadow = false;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  // The massifs ride under the ranges' mesh, so the low tier hides them with it.
  const massifRoot = new Group();
  massifRoot.name = "film-massifs";
  massifRoot.visible = false;
  mesh.add(massifRoot);
  let disposed = false,
    active = false,
    low = false,
    ranges = null,
    standIn = null,
    pending = null,
    mountainShading = null,
    massifs = null,
    abort = null,
    failed = false;
  // The massifs' GLBs, their meshes and materials. Their maps stay for the
  // meshes; the rest of each parsed asset (its geometry once the build has read
  // it, its standard material) is freed by release(). Resolves to null if any
  // GLB fails, having freed the others.
  function loadMassifs() {
    if (!["high", "balanced"].includes(tier)) return Promise.resolve(null);
    abort = new AbortController();
    const { signal } = abort;
    let late = false,
      timer = null;
    // A stalled request must not hold the ranges back: past the deadline the
    // requests abort and the five rings land.
    const deadline = new Promise((resolve) => {
      timer = setTimeout(() => {
        late = true;
        abort.abort();
        resolve();
      }, MASSIFS.deadline);
    });
    const settled = Promise.allSettled(
      MASSIFS.roles.map((role) =>
        loadAsset(urls[tier]?.[role], { signal, tier, role, priority: "low" }),
      ),
    ).finally(() => clearTimeout(timer));
    return Promise.race([settled, deadline.then(() => settled)]).then((results) => {
      const assets = results.map((result) => (result.status === "fulfilled" ? result.value : null)),
        parts = assets.map((asset) => {
          let found = null;
          asset?.scene?.traverse?.((object) => {
            if (object.isMesh && !found) found = object;
          });
          return found;
        }),
        resources = assets.filter(Boolean).map((asset) => collectResources(asset));
      const free = (keep = new Set()) =>
        resources.forEach((asset) =>
          Object.entries(asset).forEach(([kind, set]) =>
            set.forEach((resource) => {
              if (keep.has(resource)) return;
              if (kind === "bitmaps") resource.close();
              else resource.dispose?.();
            }),
          ),
        );
      const usable = parts.every(
        (part) =>
          part?.geometry?.attributes?.position &&
          part.geometry.attributes.uv &&
          part.geometry.index &&
          part.material?.normalMap &&
          part.material.map &&
          part.userData?.height > 0,
      );
      if (disposed || failed || late || !usable) {
        free();
        return null;
      }
      const nearer = new DataTexture(
        new Uint8Array(MASSIFS.sky.texture * 4),
        MASSIFS.sky.texture,
        1,
      );
      nearer.magFilter = nearer.minFilter = NearestFilter;
      nearer.wrapS = RepeatWrapping;
      const maps = new Set(),
        meshes = {},
        models = {};
      MASSIFS.roles.forEach((role, i) => {
        const part = parts[i],
          { normalMap, map } = part.material;
        // The mask is data, not colour.
        map.colorSpace = NoColorSpace;
        map.needsUpdate = true;
        maps.add(normalMap).add(map);
        for (const texture of [normalMap, map]) {
          const image = texture.source?.data ?? texture.image;
          if (typeof image?.close === "function") maps.add(image);
        }
        const massif = new Mesh(
          new BufferGeometry(),
          massifMaterial({
            skyRadius,
            shellOpacity,
            sunPosition,
            normalMap,
            maskMap: map,
            nearerMap: nearer,
          }),
        );
        massif.name = `film-massifs-${role}`;
        massif.frustumCulled = false;
        massif.renderOrder = MASSIFS.renderOrder;
        massif.castShadow = massif.receiveShadow = false;
        massifRoot.add(massif);
        meshes[role] = massif;
        models[role] = {
          position: part.geometry.attributes.position,
          uv: part.geometry.attributes.uv,
          index: part.geometry.index,
          height: part.userData.height,
        };
      });
      massifs = { meshes, nearer, maps };
      return { models, meshes, texels: nearer.image.data, release: () => free(maps) };
    });
  }
  function freeMassifs() {
    if (!massifs) return;
    massifRoot.clear();
    Object.values(massifs.meshes).forEach((massif) => {
      massif.geometry.dispose();
      massif.material.dispose();
    });
    massifs.nearer.dispose();
    // Textures before the bitmaps they read.
    const maps = [...massifs.maps];
    maps.filter((item) => item.isTexture).forEach((texture) => texture.dispose());
    maps.filter((item) => !item.isTexture).forEach((bitmap) => bitmap.close());
    massifs = null;
  }
  function request() {
    if (pending || disposed || low || !active) return;
    onStatus("loading");
    const wanted = ["high", "balanced"].includes(tier);
    let loaded = null;
    const models = loadMassifs();
    pending = Promise.all([load(), models])
      .then(([{ buildMountains }, models]) => {
        loaded = models;
        return buildMountains({
          rendering,
          tour,
          cancelled: () => disposed,
          mesh,
          models: models?.models ?? null,
          massifs: models?.meshes ?? null,
          texels: models?.texels ?? null,
        });
      })
      .then((built) => {
        // The parsed GLBs' geometries and materials were read by the build.
        loaded?.release();
        if (!built) return;
        // A build finished after disposal is freed, never kept.
        if (disposed) return built.dispose();
        ranges = built;
        if (active) mesh.geometry = ranges;
        standIn?.dispose();
        standIn = null;
        if (massifs) {
          massifs.nearer.needsUpdate = true;
          massifRoot.visible = active;
        }
        onStatus(wanted && !massifs ? "fallback" : "ready");
        invalidate();
      })
      .catch(() => {
        // The chunk failed: the massifs, loaded or still loading, are freed too.
        failed = true;
        abort?.abort();
        loaded?.release();
        freeMassifs();
        models.then((late) => {
          late?.release();
          freeMassifs();
        });
        onStatus("fallback"); // Keep the empty stand-in.
      });
  }
  return {
    mesh,
    lifecycleOrder: 24,
    get ready() {
      return pending;
    },
    setFilmTreatment(next) {
      if (disposed) return false;
      active = Boolean(next);
      if (active) mountainShading ||= mountainMaterial({ skyRadius, shellOpacity, sunPosition });
      mesh.geometry = active ? ranges || (standIn ||= emptyRanges()) : geometry;
      mesh.material = active ? mountainShading : material;
      // The ranges surround the camera, so their world bounds never apply.
      mesh.frustumCulled = !active;
      mesh.renderOrder = active ? MOUNTAIN_AIR.renderOrder : 0;
      massifRoot.visible = active && Boolean(massifs && ranges);
      request();
      return true;
    },
    applyQuality(profile) {
      if (disposed) return false;
      low = profile?.tier === "low";
      mesh.visible = !low;
      request();
      return true;
    },
    dispose() {
      if (disposed) return false;
      disposed = true;
      abort?.abort();
      mesh.removeFromParent();
      geometry.dispose();
      material.dispose();
      ranges?.dispose();
      standIn?.dispose();
      mountainShading?.dispose();
      freeMassifs();
      return true;
    },
  };
}
