import { BackSide, Color, ShaderMaterial } from "three";
import { CELESTIAL_FIELD_GLSL } from "./celestial-field.js";
import { DEPTH_LAYER } from "./depth-layers.js";

// The film gradient and horizon band by shell altitude, shared with the mountains,
// which haze toward the sky behind them (hill-silhouette.js).
export const FILM_SKY_GLSL = `
vec3 filmSky(float a) {
vec3 c=mix(vec3(.30,.36,.49),vec3(.11,.14,.21),smoothstep(-.02,.28,a));
return mix(c,vec3(.045,.065,.13),smoothstep(.24,.9,a));
}
vec3 filmBand(float a) { return vec3(.03,.036,.048)*exp(-pow((a-.03)*6.0,2.0)); }`;

// The reference banks: The watch's upper left at 1600x900 (the frame's 1100x440 top-left
// crop), broad, swirling, layered and moonlit, where the authored bank (bankUV) lifts the
// density over the cover threshold. On the cloud plane `b` that crop spans azimuths
// (atan(b.y,b.x)) of 122-174 degrees from radius 1.13 out, through the shot's whole drift.
// `wedge` (degrees) protects azimuths fully between its middle two values, easing out to
// its first and last; `radius` eases that protection in from the zenith. Beyond them the
// sky takes the reshaping, which never reaches the crop, through two weights, both 0 over
// it: `open`, for the density, also leaves the clear lane over the roof (gapG) alone;
// `bend`, for the noise's coordinates, eases in over the wider azimuths and radius it
// names instead, so the coordinates never bend fast enough to shear or fold the noise.
// - `horizon`: past radius [0] the noise's radius grows by only [1] per unit, so banks
//   near the horizon keep about the reference's size and layering instead of shrinking to
//   small ovals; `scale` then enlarges the open sky's noise evenly, every way alike, to
//   the reference's breadth;
// - `banks`: the half-frequency octave decides, broadly, bank or clear sky: across its
//   values [2]-[3] the density goes from [0] (clear, so no stray peak becomes an island)
//   to [1] (a bank, layered by the finer octaves within it), and `lanes` lets the next
//   octave cut darker lanes through the banks (+-[lanes]/2), never into the clear;
// - `swirl`: the same octave turns the noise a further `swirl` along a half turn of its
//   own value, gently enough never to fold it;
// - `text`: behind the name and intro (the ground's text boxes, mud-ground.js), easing
//   out over [1] of the screen's smaller side, the banks there thin to 1 - [0] of their
//   opacity (the stars dim by the same cover), keeping their shapes, so the sky about the
//   name stays open without cutting banks into fragments.
// The uCloudReshape uniform scales both weights: 1 for the sky and the stars, 0 for the
// environment's one capture (night-environment.js), so the ground's and the bark's
// approved sky light and reflections keep the authored clouds' brightness.
export const CLOUD_RESHAPE = Object.freeze({
  wedge: Object.freeze([111, 119, 176, 180]),
  radius: Object.freeze([0.85, 1.12]),
  bend: Object.freeze([99, 196, 0.6]),
  horizon: Object.freeze([1.5, 0.6]),
  scale: 0.85,
  banks: Object.freeze([-0.22, 0.2, 0.4, 0.6]),
  lanes: 0.1,
  swirl: 0.25,
  text: Object.freeze([0.85, 0.3]),
});

const glslFloat = (value) => (Number.isInteger(value) ? value.toFixed(1) : String(value));
const { wedge, radius, bend, horizon, scale, banks, lanes, swirl, text } = CLOUD_RESHAPE;
// The soft knee's own offset at the zenith, so the noise radius starts at 0 there.
const horizonZero = (Math.sqrt(horizon[0] ** 2 + 0.04) - horizon[0]).toFixed(6);

// The film's cloud field on the sky shell, as GLSL statements, shared with the stars,
// which dim behind the banks (starfield.js). They expect `vec3 direction` (the shell
// point's direction from the world origin), `float altitude` (its y), `float cloudText`
// (1 behind the name and intro, easing to 0; CLOUD_TEXT_GLSL) and the uNebulaLayers,
// uClouds and uCloudReshape uniforms in scope, and leave the bank density `d` (`da`
// offset toward the sun), the weather terms, the reshaping's weights `open` and `bend`
// and `cover`, the bank's opacity before the sky's .94 mix. `time` names the drift clock uniform.
export function cloudFieldGLSL(time = "uTime") {
  return `float T=${time};
float lift=max(altitude,0.0)+.24;
vec2 b=direction.xz/lift*1.1;
float bl=max(length(b),.001);
vec2 gapUV=(b-vec2(-1.5,0.0))/vec2(.46,.85);
float gapG=exp(-dot(gapUV,gapUV));
float cloudAz=degrees(atan(b.y,b.x+1e-6));
cloudAz+=cloudAz<0.?360.:0.;
float open=(1.-smoothstep(${glslFloat(wedge[0])},${glslFloat(wedge[1])},cloudAz)*(1.-smoothstep(${glslFloat(wedge[2])},${glslFloat(wedge[3])},cloudAz))*smoothstep(${glslFloat(radius[0])},${glslFloat(radius[1])},bl))*(1.-gapG);
open*=uCloudReshape;
float bend=(1.-smoothstep(${glslFloat(bend[0])},${glslFloat(wedge[1])},cloudAz)*(1.-smoothstep(${glslFloat(wedge[2])},${glslFloat(bend[1])},cloudAz))*smoothstep(${glslFloat(bend[2])},${glslFloat(radius[1])},bl))*uCloudReshape;
float cloudOut=bl-${glslFloat(horizon[0])};
float cloudR=bl-${glslFloat(1 - horizon[1])}*.5*(cloudOut+sqrt(cloudOut*cloudOut+.04)-${horizonZero});
vec2 bn=b*mix(1.,cloudR/bl*${glslFloat(scale)},bend);
float wa=T*.000436;
vec2 p=bn+2.98*(sin(wa)*vec2(.923,.385)+(1.-cos(wa))*vec2(-.385,.923));
vec2 q=p+vec2(5.7,0.9);
vec2 sunB=vec2(-1.17,-.20);
vec2 toSun=(sunB-b)*inversesqrt(dot(sunB-b,sunB-b)+.09);
vec2 L=toSun-b*inversesqrt(dot(b,b)+.01)*.7;
L*=inversesqrt(dot(L,L)+.2);
vec2 qa=q;
vec2 NP[9]; float NV[9];
NP[0]=q*.5+vec2(7.3,1.9);
int nc=uNebulaLayers>2.5?9:(uNebulaLayers>1.5?7:5);
for(int k=0;k<9;k++){
if(k>=nc) break;
if(k==1){
qa=q+L*clamp(bl*.1,.1,.2);
NP[1]=q; NP[2]=q*2.07+vec2(4.3,1.7); NP[3]=qa; NP[4]=qa*2.07+vec2(4.3,1.7);
NP[5]=q*4.3-vec2(2.9,6.1); NP[6]=qa*4.3-vec2(2.9,6.1);
NP[7]=p*9.1+vec2(1.3,.7); NP[8]=p*16.0-vec2(.2,.4);
}
if(k==0 && uNebulaLayers<1.5) continue;
vec2 x=NP[k], xi=floor(x), xf=fract(x); xf=xf*xf*(3.-2.*xf);
vec4 cx=xi.x+vec4(0.,1.,0.,1.), cy=xi.y+vec4(0.,0.,1.,1.);
vec4 h1=fract(cx*.1031), h2=fract(cy*.1031), h3=h1;
vec4 hd=h1*(h2+33.33)+h2*(h3+33.33)+h3*(h1+33.33);
vec4 hv=fract((h1+h2+2.*hd)*(h3+hd));
NV[k]=mix(mix(hv.x,hv.y,xf.x),mix(hv.z,hv.w,xf.x),xf.y);
if(k==0){
vec2 wm=(b-vec2(-1.1,.3))/1.1;
vec2 wo=vec2(.8,-.5)*(NV[0]-.5)*.8*(1.-exp(-dot(wm,wm)));
float turn=3.1416*NV[0];
wo+=bend*${glslFloat(swirl)}*vec2(cos(turn),sin(turn));
q+=wo; p+=wo;
}
}
float n0=NV[1], n1=NV[2], a0=NV[3], a1=NV[4];
float d=n0*.62+n1*.38, da=a0*.62+a1*.38;
if(uNebulaLayers>1.5){
float c2=NV[5]*2.-1., e2=NV[6]*2.-1.;
float g2=sqrt(c2*c2+.04)+.1, h2=sqrt(e2*e2+.04)+.1;
float fine=.5;
if(uNebulaLayers>2.5) fine=NV[7]*.65+NV[8]*.35;
d=n0*.5+n1*.27+g2*.16+fine*.07;
da=a0*.5+a1*.27+h2*.16+fine*.07;
float bank=open*mix(${glslFloat(banks[0])},${glslFloat(banks[1])}+${glslFloat(lanes)}*(NV[2]-.5),smoothstep(${glslFloat(banks[2])},${glslFloat(banks[3])},NV[0]));
d+=bank; da+=bank;
}
vec2 bankUV=(b-vec2(-.98,.42))/vec2(.42,.34);
vec2 sunBankUV=(b-vec2(-1.12,-.50))/vec2(.32,.26);
vec2 eaveUV=(b-vec2(-1.64,.76))/vec2(.40,.36);
vec2 thinUV=(b-vec2(-1.07,-.28))/vec2(.30,.30);
float thin=exp(-dot(thinUV,thinUV));
float eaveG=exp(-dot(eaveUV,eaveUV));
float shape=exp(-dot(bankUV,bankUV))*.24+exp(-dot(sunBankUV,sunBankUV))*.30-gapG*.19
-eaveG*.17-thin*.06-smoothstep(.70,.84,altitude)*.22;
d+=shape; da+=shape;
float horizonFade=uNebulaLayers>1.5?smoothstep(0.,.045,altitude):smoothstep(-.03,.17,altitude);
float w=uNebulaLayers>1.5?.034:mix(.05,.034,smoothstep(.45,.8,altitude));
float cover=smoothstep(.548-w,.548+w,d)*horizonFade*uClouds;
float cloudClear=1.-${glslFloat(text[0])}*cloudText*open;
cover*=cloudClear;`;
}

// The cloud field's text guard, `cloudText`: 1 behind the name and intro (slateText,
// the ground's box in the canvas's UV, y up, which index.js measures; mud-ground.js)
// easing to 0 over CLOUD_RESHAPE.text[1] of the screen's smaller side (slateAspect, the
// canvas's), for a clip-space position. It expects those two uniforms in scope.
export const CLOUD_TEXT_GLSL = `float cloudTextAt(vec4 clip){vec2 v=clip.xy/clip.w*.5+.5;
vec2 f=max(max(slateText.xy-v,v-slateText.zw),0.)*vec2(slateAspect,1.)/min(slateAspect,1.);
return 1.-smoothstep(0.,${glslFloat(text[1])},length(f));}`;
// A box beyond the canvas: nothing is behind the text.
const noText = () => ({ x: 2, y: 2, z: -1, w: -1 });

// Density lives on the fixed world-space sky shell, never camera-facing cards:
// no extra render pass or image request. Outside film the shell keeps its
// baseline branch.
// Film sky: a lifted blue night with softly lit, world-fixed cloud banks drawn on the
// shell (no cards, passes or images). Cloud value noise uses an inline sine-free hash so
// every GPU draws the same sky; the shared sin() hash drew different layouts on NVIDIA and
// AMD. Noise evaluations per pixel, nebula included: high 12, balanced 9, low 4. Fixed
// weather terms place a bank beside the intro, one beside the sun, a clear lane where the
// roof meets the sky and an open zenith, and the open sky beyond the first takes the same
// broad, swirling banks (CLOUD_RESHAPE); a soft-knee cap keeps the intro backdrop at or
// under 0.093 luminance (>= 5.4:1) even with fully lit cover. Drift is 0.4-1.3 CSS px/s
// along a bounded circle so lattice coordinates stay small in long sessions. The opaque
// film shell writes the sky's depth layer (0) into alpha for the tour's staggered dissolve.
// textGuard: the ground's createSlateContacts() uniforms, whose slateText and
// slateAspect objects the clouds' text guard borrows (and lends on to the stars);
// without it nothing is behind the text.
export function createEstateSkyMaterial(config, textGuard = null) {
  return new ShaderMaterial({
    side: BackSide,
    transparent: true,
    depthWrite: false,
    uniforms: {
      topColor: { value: new Color(config.skyTopColor) },
      bottomColor: { value: new Color(config.skyBottomColor) },
      glowColor: { value: new Color(config.skyGlowColor) },
      sunDirection: { value: config.sunDirection },
      sunColor: { value: new Color(config.sunColor) },
      uTime: { value: 0 },
      uFilm: { value: 0 },
      uClouds: { value: 1 },
      uNebulaLayers: { value: 0 },
      uCloudReshape: { value: 1 },
      slateText: textGuard?.slateText ?? { value: noText() },
      slateAspect: textGuard?.slateAspect ?? { value: 1 },
    },
    vertexShader: `
varying vec3 vWorldPosition;
varying vec4 vCloudClip;
void main() {
vec4 p = modelMatrix * vec4(position, 1.0);
vWorldPosition = p.xyz;
gl_Position = projectionMatrix * viewMatrix * p;
vCloudClip = gl_Position;
}`,
    fragmentShader: `
uniform vec3 topColor, bottomColor, glowColor, sunDirection, sunColor;
uniform float uTime, uFilm, uClouds, uNebulaLayers, uCloudReshape;
uniform vec4 slateText;
uniform float slateAspect;
varying vec3 vWorldPosition;
varying vec4 vCloudClip;
float hash(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float noise(vec2 p) {
vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),
mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);
}
${CELESTIAL_FIELD_GLSL}
${FILM_SKY_GLSL}
${CLOUD_TEXT_GLSL}
vec3 nebula(vec3 direction) {
vec2 p=celestialPlane(direction);
float envelope=celestialEnvelope(direction,p);
if(envelope<.002) return vec3(0.0);
float density=noise(p*vec2(5.4,10.8)+3.7)*.64+noise(p*vec2(11.3,22.6)-9.1)*.36;
if(uNebulaLayers>2.5) density=mix(density,noise(p*vec2(23.1,39.0)+17.3),.17);
float emission=envelope*smoothstep(.24,.78,density);
float dust=celestialDust(p,envelope);
float core=exp(-dot((p-vec2(.17,-.04))*vec2(5.0,9.0),
(p-vec2(.17,-.04))*vec2(5.0,9.0)));
vec3 color=mix(vec3(.1584,.1008,.2688),vec3(.2472,.1656,.1536),core*.48);
return color*emission*exp(-dust*2.5);
}
void main() {
vec3 direction=normalize(vWorldPosition);
float h=normalize(vWorldPosition+vec3(0,40,0)).y;
vec3 col=mix(bottomColor,topColor,smoothstep(-.2,.7,h));
float glow=smoothstep(.02,.7,1.0-distance(direction.xz,vec2(0)));
col+=glowColor*glow*.031;
float sunDot=max(0.0,dot(direction,sunDirection));
col+=sunColor*(pow(sunDot,8.0)*.225+pow(sunDot,32.0)*.152);
if (uFilm>.5) {
float altitude=direction.y;
col=filmSky(altitude);
if(uNebulaLayers>0.5) col+=nebula(normalize(vWorldPosition-cameraPosition));
if(uClouds>0.001){
float cloudText=cloudTextAt(vCloudClip);
${cloudFieldGLSL("uTime")}
float lit=clamp(.45+(d-da)*4.0,0.0,1.0);
float thick=smoothstep(.52,.8,d);
vec3 cloudCol=mix(vec3(.30,.32,.46),vec3(.62,.60,.72),smoothstep(0.,.55,lit));
cloudCol=mix(cloudCol,vec3(1.05,1.02,1.10),smoothstep(.5,1.,lit)*(.6+.4*thick));
cloudCol+=vec3(.07,.07,.09)*smoothstep(.5,1.,lit)*(1.-thick)*cover;
cloudCol*=(1.0+.4*smoothstep(.55,.85,altitude))*(.86+.26*smoothstep(-.35,.45,direction.z))
*(1.0-.14*thin)*(1.0-.3*max(gapG,eaveG));
vec3 kn=vec3(.64,.62,.66), cap=vec3(.88,.86,.91);
cloudCol=min(cloudCol,kn)+(cap-kn)*(1.-exp(-max(cloudCol-kn,0.)/(cap-kn)));
col+=vec3(.027,.03,.036)*smoothstep(.36,.54,d)*horizonFade*uClouds*cloudClear;
col=mix(col,cloudCol,cover*.94);
}
col+=filmBand(altitude);
}
gl_FragColor=uFilm>.5?vec4(col*${config.shellOpacity},${DEPTH_LAYER.sky}):vec4(col,${config.shellOpacity});
}`,
  });
}
