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

// Density lives on the existing fixed world-space sky shell, never camera-facing
// cards. No extra render pass or image request; the baseline branch is retained.
// Film sky: a lifted blue night with softly lit, world-fixed cloud banks drawn on the
// shell (no cards, passes or images). Cloud value noise uses an inline sine-free hash so
// every GPU draws the same sky; the shared sin() hash drew different layouts on NVIDIA and
// AMD. Noise evaluations per pixel, nebula included: high 12, balanced 9, low 4. Fixed
// weather terms place a bank beside the intro, one beside the sun, a clear lane where the
// roof meets the sky and an open zenith; a soft-knee cap keeps the intro backdrop at or
// under 0.093 luminance (>= 5.4:1) even with fully lit cover. Drift is 0.4-1.3 CSS px/s
// along a bounded circle so lattice coordinates stay small in long sessions. The opaque
// film shell writes the sky's depth layer (0) into alpha for the tour's staggered dissolve.
export function createEstateSkyMaterial(config) {
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
    },
    vertexShader: `
varying vec3 vWorldPosition;
void main() {
vec4 p = modelMatrix * vec4(position, 1.0);
vWorldPosition = p.xyz;
gl_Position = projectionMatrix * viewMatrix * p;
}`,
    fragmentShader: `
uniform vec3 topColor, bottomColor, glowColor, sunDirection, sunColor;
uniform float uTime, uFilm, uClouds, uNebulaLayers;
varying vec3 vWorldPosition;
float hash(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float noise(vec2 p) {
vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),
mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);
}
${CELESTIAL_FIELD_GLSL}
${FILM_SKY_GLSL}
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
float T=uTime;
float lift=max(altitude,0.0)+.24;
vec2 b=direction.xz/lift*1.1;
float bl=max(length(b),.001);
float wa=T*.000436;
vec2 p=b+2.98*(sin(wa)*vec2(.923,.385)+(1.-cos(wa))*vec2(-.385,.923));
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
}
vec2 gapUV=(b-vec2(-1.5,0.0))/vec2(.46,.85);
vec2 bankUV=(b-vec2(-.98,.42))/vec2(.42,.34);
vec2 sunBankUV=(b-vec2(-1.12,-.50))/vec2(.32,.26);
vec2 eaveUV=(b-vec2(-1.64,.76))/vec2(.40,.36);
vec2 thinUV=(b-vec2(-1.07,-.28))/vec2(.30,.30);
float thin=exp(-dot(thinUV,thinUV));
float gapG=exp(-dot(gapUV,gapUV)), eaveG=exp(-dot(eaveUV,eaveUV));
float shape=exp(-dot(bankUV,bankUV))*.24+exp(-dot(sunBankUV,sunBankUV))*.30-gapG*.19
-eaveG*.17-thin*.06-smoothstep(.70,.84,altitude)*.22;
d+=shape; da+=shape;
float horizonFade=uNebulaLayers>1.5?smoothstep(0.,.045,altitude):smoothstep(-.03,.17,altitude);
float w=uNebulaLayers>1.5?.034:mix(.05,.034,smoothstep(.45,.8,altitude));
float cover=smoothstep(.548-w,.548+w,d)*horizonFade*uClouds;
float lit=clamp(.45+(d-da)*4.0,0.0,1.0);
float thick=smoothstep(.52,.8,d);
vec3 cloudCol=mix(vec3(.30,.32,.46),vec3(.62,.60,.72),smoothstep(0.,.55,lit));
cloudCol=mix(cloudCol,vec3(1.05,1.02,1.10),smoothstep(.5,1.,lit)*(.6+.4*thick));
cloudCol+=vec3(.07,.07,.09)*smoothstep(.5,1.,lit)*(1.-thick)*cover;
cloudCol*=(1.0+.4*smoothstep(.55,.85,altitude))*(.86+.26*smoothstep(-.35,.45,direction.z))
*(1.0-.14*thin)*(1.0-.3*max(gapG,eaveG));
vec3 kn=vec3(.64,.62,.66), cap=vec3(.88,.86,.91);
cloudCol=min(cloudCol,kn)+(cap-kn)*(1.-exp(-max(cloudCol-kn,0.)/(cap-kn)));
col+=vec3(.027,.03,.036)*smoothstep(.36,.54,d)*horizonFade*uClouds;
col=mix(col,cloudCol,cover*.94);
}
col+=filmBand(altitude);
}
gl_FragColor=uFilm>.5?vec4(col*${config.shellOpacity},${DEPTH_LAYER.sky}):vec4(col,${config.shellOpacity});
}`,
  });
}
