// Cinematic light shafts. A lazily imported chunk (scene.light-shafts.HASH.js):
// index.js requests it only for high and balanced film scenes on WebGL2, never
// for low, WebGL1 (its shaders take derivatives and its back map has two
// channels) or the static title card, and keeps no other
// code for it.
// Keep first-party imports out of this chunk: everything it needs arrives as
// arguments, and its Three.js imports reuse the shared chunk.
//
// The treatment by shot: warm star shafts only in The watch, where the star
// is in frame behind the cabin; cool moonbeams along the real moon key light
// on the other shots; nothing in the two lantern shots. The rays are visible:
// warm ray streaks through the cabin and lattice, slim moon shafts through the
// crown and past the cabin, larger broken-moonlight patches on bark and
// timber, and no light on the sky.
//
// Technique: once per subject and light, the CPU rasterises the subject's own
// triangles into a small light-space map in idle slices (no pass, no download):
// R = first hit along the light, G = the light's window, B = the light the
// subject lets through (its transmittance, inside its closed silhouette: its
// gaps filled, its outline kept), A = the front of that closed silhouette; a
// second, two-channel map holds its back (that closed silhouette's, and the
// subject's own). The air is lit only past that front, by the light the
// subject lets through there: a lit volume shaped by the closed silhouette and
// its transmittance. B is read at a softer mip level the further past the
// front (and at the step's own footprint, as the march has few steps), so a
// ray's edge softens toward the eye; the visible streaks are therefore a
// stylised screen-space ray pattern laid on that volume (shaftRay), with only
// part of their structure from the gaps (tie, on the crown). The view ray is marched through the
// light's box in two places, with the same function: a box mesh drawn by its
// back faces with the depth test on covers everything behind the subject (its
// far face is hidden behind any opaque surface), and the subject's own
// material marches from the eye to its surface. Behind the box's far face the
// ray meets either near ground (it leaves the box low and descending) or the
// sky, the mountains or far land; there the air keeps only the light up to a
// little past the closed silhouette's back (so the sky seen through a gap
// keeps it), a soft falloff at its silhouette, so no ray washes the sky or
// steps a far cel band. The star's box air shows only along view rays through
// the tower (hull) and is weighted by the depth layer behind it (layer), so
// none of it lands on the sky or the plain beside the tower. The march keeps to the lit core (a cylinder about the
// light's axis that holds its whole window), starts at a blue-noise offset per
// pixel (within the middle half of a step; none over the sky, where the
// grade's cel band would turn faint grain into dots), and is averaged over
// each 2 x 2 pixel quad where depth allows. The rays streak by angle about the
// light's place on screen, as crepuscular rays do. Additive colour only (for
// the star, times the destination alpha): the scene target's alpha, the film
// depth layer (depth-layers.js), is untouched.
// The subject's material also takes the light where it lands (the "gobo"),
// under a soft shoulder that keeps lit timber from reading as a spotlight.
import { BufferAttribute, BufferGeometry, DataTexture, Mesh, ShaderMaterial, Vector3 } from "three";

// Three constants, written as values so this chunk adds no shared export.
const BACK_SIDE = 1,
  CUSTOM_BLENDING = 5,
  ZERO = 200,
  ONE = 201,
  DST_ALPHA = 206,
  REPEAT = 1000,
  CLAMP = 1001,
  NEAREST = 1003,
  LINEAR = 1006,
  LINEAR_MIPMAP_LINEAR = 1008,
  RG_FORMAT = 1030;

// Treatments by directed shot name (directed-shots.js). The watch frames the
// star behind the cabin; the lantern shots stay lit by the lantern alone.
export const SHAFT_SHOTS = Object.freeze({
  star: Object.freeze(["The watch"]),
  off: Object.freeze(["Lantern study", "Root and lantern"]),
});
export function shaftTreatment(shotName) {
  if (!shotName || SHAFT_SHOTS.off.includes(shotName)) return null;
  return SHAFT_SHOTS.star.includes(shotName) ? "star" : "moon";
}

// Tuned against desktop high and phone balanced captures: the grade's 0.24
// cel band and ink contour amplify soft light, so the air stays in rays.
// gain: in-scattering in the air; over: its share in front of the subject
// (the subject's own march, at sub of the box's steps); steps: the box's march
// length on high (with shadows) and balanced; phase: forward scattering
// (Henyey-Greenstein g); front: the softness (units) of the closed
// silhouette's front, where the air starts to take light; penumbra: how fast a
// ray's edge softens past it (mip levels by log2(1 + penumbra * distance)),
// up to maxLod; reach: [distance past the front where a ray starts to fade,
// fade length]; sky: [distance past the closed silhouette's back where the
// light over the sky, the mountains and far land starts to fade, fade length]
// (a soft falloff at the silhouette: the sky seen through a gap keeps it); ground: [distance, fade] from where the view ray leaves the
// box to the ground it meets, within which the box's far side reads as near
// ground and the rays show in full; ceil: the soft cap on the air's light
// (a ray seen end on never blooms into a hot wedge); edge: the box's own
// fade at its faces (a share of its size); fade: [rise above the terrain,
// fall below the box top]; mist: the height over which the air thins (0:
// even); drift: the window's and the streaks' slow sway, [amplitude in map
// units on each axis, period in seconds], bounded so the look holds however
// long the page stays open; rays: the streaks by angle about the light's
// place on screen, [contrast, period in the subject's screen height, noise
// levels where a streak starts and is full (sparse for slim shafts)]; jitter:
// how far (in streaks) their spacing wanders, so no two read as even bars;
// sparse: the streaks on balanced (phones), [contrast, noise levels, gain
// scale]: fewer, with darker gaps and a little more light each, so a small
// tower keeps distinct rays, not a warm veil (null: as on high);
// rise: the distance (units) past the front over which each streak fades in,
// varied per streak, so none starts bluntly at the closed silhouette's edge
// (0: at once); tie: the share of the light read at a sharper level of the
// map, so the subject's own gaps shape part of the streaks; hull: the box's
// air only along view rays that pass through the subject, [weight over near
// ground, weight over the sky, the mountains and far land, 1 to test the
// subject's own outline rather than its closed silhouette, the map level
// its edge is read at (a softer edge the higher)] (0: everywhere);
// layer: the box's air weighted by the film depth layer behind it (the
// scene target's alpha: sky 0, mountains 1/3, ground 2/3), times this, so
// none lands on the sky (0: unweighted); peak: 1 to take the soft cap at
// the streaks' peak, so the dark between streaks keeps its share and a bright
// lattice never becomes a veil (the star), 0 to cap the streaked air as it
// is, which keeps sparse slim shafts broad and full (the moon).
// Per subject: aim: the light's aim as a share of the subject's height (the
// star); ext: the map's half-width about the subject; gap: the break in the
// cloud the air takes light through, [height share, radii, core]; lit: how far
// from the gap the light on surfaces reaches; fall: the star window's fall
// toward the lattice's foot; res: the map's size; close: the radius (texels)
// over which the silhouette's gaps are closed, and erode: how far inside the
// outline the closed silhouette's edge lies (no rim of lit air outside it;
// below zero, a ring just outside it); inner: how far (texels) inside that
// edge the hull test's back gives way from the subject's own to the closed
// silhouette's (0: never), so a lattice's far members cut no stepped notches
// into the air seen through it while its edge (the ladder, a leg) keeps the
// air off the plain beside it; core: the lit cylinder's radius over
// the window's; air: the subject's own gain, over, reach, sky, jitter, rise,
// tie and hull. breaks: the broken cloud patches of the light on surfaces [frequency,
// threshold, width, floor]. gobo: the light landing on the subject (wrap: diffuse wrap,
// rim: backlit edge catch, faded on twigs, bias: surface self-shadow offset,
// clip: [shoulder, headroom] of the soft clip on the surface's direct light,
// shadow: false where the subject's own light map shades it rather than the
// key light's shadow map); a subject's own gobo overrides the treatment's.
export const SHAFTS = Object.freeze({
  // Warm crepuscular rays from the visible star through the cabin's openings
  // and the lattice's gaps toward the eye, only where the eye looks through
  // the tower (hull), so none lies over the open sky or the plain beside it.
  star: Object.freeze({
    color: [1, 0.66, 0.4],
    gain: 0.036,
    over: 1,
    phase: 0.35,
    front: 1,
    penumbra: 0.2,
    maxLod: 2.5,
    reach: [20, 14],
    sky: [0, 3],
    ground: [18, 30],
    ceil: 0.35,
    edge: [0.02, 0.02, 0.02],
    fade: [2, 1],
    mist: 0,
    steps: [12, 6],
    sub: 0.5,
    drift: [0.01, 130],
    rays: [0.85, 0.036, 0.2, 0.8],
    sparse: [0.95, 0.3, 0.8, 1.5],
    jitter: 0,
    rise: 0,
    tie: 0,
    hull: [1, 1, 0, 0],
    layer: 1.5,
    peak: 1,
    tower: Object.freeze({
      aim: 0.45,
      ext: 26,
      res: 192,
      sharp: 1,
      close: 8,
      erode: 2,
      inner: 4,
      core: 1.4,
      fall: [-0.55, 0.3],
    }),
    gobo: Object.freeze({
      color: [1, 0.62, 0.34],
      gain: 1.2,
      wrap: 0.3,
      rim: 3,
      bias: 1.2,
      clip: [0.5, 0.12],
    }),
  }),
  // Cool moonbeams through a break in the cloud, parallel to the moon's real
  // cast shadows: slim shafts through the gaps of the crown or past the
  // cabin, and broken moonlight in large patches on the bark and timber.
  moon: Object.freeze({
    color: [0.62, 0.74, 1],
    gain: 0.07,
    over: 1,
    phase: 0,
    front: 1,
    penumbra: 0.15,
    maxLod: 2.5,
    reach: [14, 10],
    sky: [2, 6],
    ground: [15, 30],
    ceil: 0.3,
    edge: [0.02, 0.02, 0.02],
    fade: [3, 1],
    mist: 0,
    steps: [9, 6],
    sub: 0.3,
    drift: [0.006, 100],
    rays: [0.9, 0.04, 0.62, 0.84],
    jitter: 0,
    sparse: null,
    rise: 0,
    tie: 0,
    hull: [0, 0, 0, 0],
    layer: 0,
    peak: 0,
    // The cabin is solid to the moon: its shafts graze past it, in a ring
    // just outside its closed outline (erode < 0). No march of its own in
    // front of the timber (over 0): over the whole tower in Threshold it
    // costs more than the faint streaks it adds, so the box's shafts carry it.
    // Over the sky its air is weighted down where the eye's ray misses the
    // cabin's own outline, so no cloud band above the roof steps a cel band.
    tower: Object.freeze({
      gap: [0.7, 12, 12, 0.35],
      lit: [0.5, 1.2, 0.2],
      ext: 22,
      res: 160,
      sharp: 1,
      close: 6,
      erode: -6,
      core: 1.2,
      air: Object.freeze({
        gain: 0.1,
        over: 0,
        sky: [4, 8],
        reach: [22, 12],
        hull: [0, 0.4, 1, 0],
      }),
    }),
    // Slim shafts through the crown that fade in past its front, take part
    // of their structure from its own gaps and, over the sky, keep to the
    // view rays through the crown (a soft edge), so none starts in open sky.
    tree: Object.freeze({
      gap: [0.62, 14, 12, 0.3],
      ext: 24,
      res: 192,
      sharp: 1,
      close: 10,
      erode: -3,
      core: 1.2,
      air: Object.freeze({
        gain: 0.06,
        sky: [2, 6],
        jitter: 0.35,
        rise: 8,
        tie: 0.8,
        hull: [0, 1, 0, 3],
      }),
      // Broken cloud light across the bark: large, soft breaks with darker
      // gaps, wrapping round the limbs toward the eye (the crown's own light
      // map shades them, not the key light's shadow), so the moss and limbs
      // take moonlight in patches without glowing.
      breaks: [0.16, 0.45, 0.18, 0.12],
      gobo: Object.freeze({
        gain: 2.6,
        wrap: 1.4,
        rim: 2,
        bias: 3,
        clip: [0.3, 0.12],
        shadow: false,
      }),
    }),
    breaks: [0.14, 0.45, 0.16, 0.12],
    gobo: Object.freeze({
      color: [0.8, 0.88, 1],
      gain: 1.8,
      wrap: 0.5,
      rim: 1.5,
      bias: 1.2,
      clip: [0.42, 0.12],
    }),
  }),
});

// The window's sway at time t (seconds): a slow Lissajous figure, never more
// than amplitude from rest on either axis, so the light's window never slides
// off its subject.
export function shaftDrift(time, [amplitude, period], out = { x: 0, y: 0 }) {
  const w = (2 * Math.PI) / period;
  out.x = amplitude * Math.sin(w * time);
  out.y = amplitude * 0.6 * Math.sin(w * 0.73 * time);
  return out;
}

// Light-space lookup and the march, shared by the box and the subjects. Every
// texture read names its level (textureLod), so no gradient is taken inside
// the march and its uniform-gated branches stay real branches (ANGLE on
// Direct3D otherwise flattens them and runs the march for every pixel of a
// hooked subject, lit or not). shaftUv: p's map coordinates and its depth
// along the light. shaftLit: the light reaching air at p: lit only past the
// closed silhouette's front (fading in over rise), by the light the subject
// lets through there (read at the step's own footprint or softer, and in part
// (tie) two levels sharper, so its gaps show), fading past the reach; over
// the sky (ground < 1) kept only up to a falloff past the silhouette's back.
// shaftHull: whether the view ray passes through the subject at all, tested
// at four points across its own depths (inside its closed silhouette, or its
// outline, and between that texel's front and back). shaftMarch keeps to the
// lit core and to the depths where lit air can be (from the nearest front to
// a reach past the farthest, or, over the sky, only as far as its falloff
// there, so the few steps fall where light can show and leave no stray dots),
// weights the air over the sky, the mountains and far land (ground < 1) by
// its closeness to the subject, streaks it by angle about the light's place
// on screen (shaftRay: a stylised screen-space pattern, its spacing jittered
// on the crown),
// caps it softly (shaftCeil), for the star at the streaks' peak (the dark
// between streaks keeps its share, so a bright ray never becomes a veil), and scales it down
// behind the name and intro (shaftText, the text's box on screen, fading out
// round it over a fifth of the screen's smaller side, so neither the rays nor
// the haze stop at a straight edge): by 90%, or fully where the phone's text
// protection is on. shaftQuad
// averages the air over its 2 x 2 pixel quad (derivatives, taken outside any
// branch), skipping a neighbour across a depth step, so the blue-noise start
// leaves less stipple.
const SHAFT_GLSL = `
#if __VERSION__>=300
#define shaftTex(s,p,l) textureLod(s,p,l)
#else
#define shaftTex(s,p,l) texture2D(s,p)
#endif
uniform sampler2D shaftMap;uniform sampler2D shaftBack;uniform sampler2D shaftNoise;uniform vec3 shaftOrigin;uniform vec3 shaftU;uniform vec3 shaftV;uniform vec3 shaftA;uniform vec4 shaftSpan;
uniform float shaftPoint;uniform vec2 shaftDrift;uniform vec3 shaftShift;uniform mat4 shaftToBox;uniform vec3 shaftColor;uniform float shaftGain;
uniform float shaftPhase;uniform float shaftSteps;uniform vec3 shaftEdge;uniform vec4 shaftFade;uniform float shaftMist;uniform vec4 shaftAir;
uniform vec4 shaftCore;uniform vec4 shaftReach;uniform vec2 shaftGround;uniform vec4 shaftText;uniform float shaftTextProtection;uniform float shaftRes;uniform vec4 shaftSource;uniform vec4 shaftStreak;uniform float shaftCeil;uniform vec3 shaftDepths;
uniform vec4 shaftShape;uniform vec2 shaftHullMode;uniform float shaftJitter;uniform float shaftPeak;
vec3 shaftUv(vec3 p){
vec3 q=p-shaftOrigin;float z=dot(q,shaftA);vec2 l=vec2(dot(q,shaftU),dot(q,shaftV));
if(shaftPoint>.5)l/=z;
return vec3(l*shaftSpan.xy+.5,z);
}
float shaftDepth(float c){return c>.995?1e5:shaftSpan.z+c*shaftSpan.w;}
float shaftLit(vec3 p,float lod,float soft,float ground,float rise){
vec3 u=shaftUv(p);
if(u.x<0.||u.y<0.||u.x>1.||u.y>1.)return 0.;
float past=u.z-shaftDepth(shaftTex(shaftMap,u.xy,0.).a);
if(past<-soft)return 0.;
float l=max(lod,min(log2(1.+max(past,0.)*shaftAir.y),shaftAir.z)),b=shaftTex(shaftMap,u.xy,l).b;
if(shaftShape.w>0.)b=mix(b,shaftTex(shaftMap,u.xy,max(l-2.,0.)).b,shaftShape.w);
float t=b*smoothstep(-soft,soft+rise,past)*(1.-smoothstep(shaftReach.x,shaftReach.x+shaftReach.y,past));
if(ground<1.)t*=max(ground,1.-smoothstep(shaftReach.z,shaftReach.z+shaftReach.w,u.z-shaftDepth(shaftTex(shaftBack,u.xy,0.).r)));
return t;
}
float shaftBehindText(vec2 v){vec2 f=max(max(shaftText.xy-v,v-shaftText.zw),0.)*vec2(shaftSource.z,1.)/min(shaftSource.z,1.);return 1.-smoothstep(0.,.2,length(f));}
float shaftHash(float i,float p){return fract(sin(mod(i,p)*78.233+p*.37)*43758.5453);}
float shaftRay(vec2 v,out float r){
vec2 d=(v-shaftSource.xy)*vec2(shaftSource.z,1.);
float x=shaftStreak.x,a=(atan(d.y,d.x)/6.2831853+.5)*x+shaftDrift.x*shaftStreak.w,q=a*.25,qi=floor(q),qf=fract(q);
a+=shaftJitter*(2.*mix(shaftHash(qi,.25*x),shaftHash(qi+1.,.25*x),qf*qf*(3.-2.*qf))-1.);
float i=floor(a),f=fract(a),b=a*2.,k=floor(b),h=fract(b);
r=shaftHash(i,.5*x);
float n=.65*mix(shaftHash(i,x),shaftHash(i+1.,x),f*f*(3.-2.*f))+.35*mix(shaftHash(k,2.*x),shaftHash(k+1.,2.*x),h*h*(3.-2.*h));
return 1.+shaftSource.w*smoothstep(0.,.08,length(d))*(2.*smoothstep(shaftStreak.y,shaftStreak.z,n)-1.);
}
float shaftHull(vec3 ro,vec3 rd,float far){
float z0=dot(ro-shaftOrigin,shaftA),dz=dot(rd,shaftA);
if(abs(dz)<1e-4)return 1.;
float ta=clamp((shaftDepths.x-z0)/dz,0.,far),tb=clamp((shaftDepths.z-z0)/dz,0.,far),h=0.;
for(int k=0;k<4;k++){
vec3 u=shaftUv(ro+rd*mix(ta,tb,(float(k)+.5)*.25));
if(u.x<0.||u.y<0.||u.x>1.||u.y>1.)continue;
vec4 m=shaftTex(shaftMap,u.xy,0.);float c=mix(m.a,m.r,shaftHullMode.x),e=c;
if(shaftHullMode.y>0.)e=mix(shaftTex(shaftMap,u.xy,shaftHullMode.y).a,c,shaftHullMode.x);
h=max(h,(1.-smoothstep(.85,.99,e))*smoothstep(-.25,0.,u.z-(c<.85?shaftDepth(c):-1e5))*(1.-smoothstep(0.,.25,u.z-shaftDepth(shaftTex(shaftBack,u.xy,0.).g))));
}
return h;
}
vec3 shaftMarch(vec3 ro,vec3 rd,float far,vec2 v,float n,float ground,float hull){
if(hull<=0.)return vec3(0.);
vec3 o=(shaftToBox*vec4(ro,1.)).xyz,d=(shaftToBox*vec4(rd,0.)).xyz;
vec3 ta=(vec3(-.5)-o)/d,tb=(vec3(.5)-o)/d,tn=min(ta,tb),tx=max(ta,tb);
float t0=max(max(max(tn.x,tn.y),tn.z),0.),t1=min(min(min(tx.x,tx.y),tx.z),far);
vec3 c=ro-shaftCore.xyz,cp=c-shaftA*dot(c,shaftA),dp=rd-shaftA*dot(rd,shaftA);
float qa=max(dot(dp,dp),1e-6),qb=dot(cp,dp),qd=qb*qb-qa*(dot(cp,cp)-shaftCore.w*shaftCore.w);
if(qd<=0.)return vec3(0.);
qd=sqrt(qd);t0=max(t0,(-qb-qd)/qa);t1=min(t1,(-qb+qd)/qa);
float z0=dot(ro-shaftOrigin,shaftA),dz=dot(rd,shaftA),zb=mix(shaftDepths.z+shaftReach.z+shaftReach.w,shaftDepths.y+shaftReach.x+shaftReach.y,ground);
if(abs(dz)>1e-4){float za=(shaftDepths.x-z0)/dz;zb=(zb-z0)/dz;t0=max(t0,min(za,zb));t1=min(t1,max(za,zb));}
else if(z0<shaftDepths.x||z0>zb)return vec3(0.);
if(t1<=t0)return vec3(0.);
float dt=(t1-t0)/n,j=.5+ground*(.5*shaftTex(shaftNoise,gl_FragCoord.xy/32.,0.).r-.25);
float lod=log2(max(length(shaftUv(ro+rd*t1).xy-shaftUv(ro+rd*t0).xy)*shaftRes/n,1.))+1.,soft=max(shaftAir.x,.6*dt*abs(dot(rd,shaftA)));
vec3 l=shaftPoint>.5?normalize(ro+rd*(.5*(t0+t1))-shaftOrigin):shaftA;
float g=shaftPhase*shaftPhase,acc=0.,s=.5,r=0.;
if(shaftShape.x>0.)r=shaftRay(v,s);
float rise=shaftShape.x*(.5+s);
for(int i=0;i<16;i++){
if(float(i)>=n)break;
float t=t0+(float(i)+j)*dt;vec3 p=ro+rd*t,b=o+d*t+.5;
vec3 e=smoothstep(vec3(0.),shaftEdge,b)*smoothstep(vec3(0.),shaftEdge,1.-b);
acc+=shaftLit(p,lod,soft,ground,rise)*e.x*e.y*e.z*
smoothstep(shaftFade.x,shaftFade.x+shaftFade.y,p.y)*smoothstep(0.,shaftFade.w,shaftFade.z-p.y)*exp(-max(p.y-shaftFade.x,0.)*shaftMist)*smoothstep(3.,13.,t);
}
if(acc<=0.)return vec3(0.);
if(r==0.)r=shaftRay(v,s);
float w=mix(r,1.+shaftSource.w,shaftPeak),a=shaftGain*w*pow((1.+g)/(1.+g+2.*shaftPhase*dot(rd,l)),1.5)*acc*dt;
return shaftColor*(a/(1.+a/shaftCeil)*mix(1.,r/w,shaftPeak)*hull*(1.-shaftBehindText(v)*mix(.9,1.,shaftTextProtection)));
}
vec3 shaftQuad(vec3 c,float z){
vec2 h=fract(gl_FragCoord.xy*.5),s=(step(h,vec2(.5))*2.-1.)*sign(vec2(dFdx(h.x),dFdy(h.y)));
vec3 cx=dFdx(c),cy=dFdy(c);
vec2 k=step(abs(vec2(dFdx(z),dFdy(z))),vec2(.04*z));
return c+(k.x*s.x*cx+k.y*s.y*cy)/3.;
}`;
const VERTEX = `varying vec3 vWorld;varying vec4 vClip;
void main(){vec4 w=modelMatrix*vec4(position,1.);vWorld=w.xyz;vClip=projectionMatrix*viewMatrix*w;gl_Position=vClip;}`;
// Samples fade in above the terrain under the box and out toward its top, so
// a beam neither cuts a line across distant ground nor lights the sky. A view
// ray that leaves the box low and descending meets near ground (ground 1);
// one that leaves it rising, or high above far land, meets the sky, the
// mountains or far ground (ground 0), where only the light close to the
// subject stays. Where the treatment asks (hull), the air shows only along
// view rays through the subject, so none lies beside it; the star's is also
// weighted by the depth layer behind it (layer, through the blend), so none
// lands on the sky. An unlit pixel is discarded (after its quad's average),
// so the box costs no blending where it adds nothing.
const VOLUME = `${SHAFT_GLSL}
uniform float shaftLayer;varying vec3 vWorld;varying vec4 vClip;
void main(){
float far=length(vWorld-cameraPosition);vec3 ro=cameraPosition-shaftShift,rd=(vWorld-cameraPosition)/far;
float ground=rd.y<0.?1.-smoothstep(shaftGround.x,shaftGround.x+shaftGround.y,max(ro.y+rd.y*far-shaftFade.x,0.)/-rd.y):0.;
float w=mix(shaftShape.z,shaftShape.y,ground),k=w>0.?mix(1.,shaftHull(ro,rd,far),w):1.;
vec3 s=max(shaftQuad(shaftMarch(ro,rd,far,vClip.xy/vClip.w*.5+.5,shaftSteps,ground,k),far),0.);
if(s.r+s.g+s.b<=0.)discard;
gl_FragColor=vec4(s*shaftLayer,0.);
}`;
// Added to the subject's lighting: the treatment's light, gated by the map (its
// window and the subject's own occlusion) and, for the moon on high, by the
// key light's real shadow map (four taps at a named level, so the branch
// stays real). Wrapped diffuse and a rim catch let it land on the edges of
// backlit bark and timber; where the surface turns faster than a pixel (a
// twig) the rim fades out and the wrapped light to 40%, so thin geometry takes
// no isolated glints and a crown no frost. A soft shoulder
// then keeps the surface's direct light under clip.x + clip.y, so lit planks
// never read as a spotlight.
const GOBO_LIGHT = `
#ifdef FLAT_SHADED
float shaftThin=1.;
#else
float shaftThin=1.-smoothstep(.25,.7,length(fwidth(vNormal)));
#endif
if(shaftGoboGain>0.){
vec3 gp=vShaftWorld-shaftShift,gu=shaftUv(gp);float gk=0.;
if(gu.x>=0.&&gu.y>=0.&&gu.x<=1.&&gu.y<=1.){vec4 gm=shaftTex(shaftMap,gu.xy,0.);
float gpast=gu.z-shaftDepth(gm.r)-shaftSurface.y;
gk=shaftGoboGain*mix(1.,shaftTex(shaftMap,gu.xy,min(log2(1.+max(gpast,0.)*shaftAir.y),shaftAir.z)).b,smoothstep(-shaftSurface.x,shaftSurface.x,gpast))*shaftTex(shaftMap,gu.xy+shaftDrift,0.).g;}
#if defined(USE_SHADOWMAP)&&SHAFT_SHADOW>=0&&NUM_DIR_LIGHT_SHADOWS>SHAFT_SHADOW
if(gk>.001&&shaftGoboShadow>.5&&receiveShadow){
vec4 sc=vDirectionalShadowCoord[SHAFT_SHADOW];sc.xyz/=sc.w;sc.z+=directionalLightShadows[SHAFT_SHADOW].shadowBias;
if(sc.x>=0.&&sc.x<=1.&&sc.y>=0.&&sc.y<=1.&&sc.z<=1.){vec2 st=.75/directionalLightShadows[SHAFT_SHADOW].shadowMapSize;
gk*=.25*(step(sc.z,unpackRGBAToDepth(shaftTex(directionalShadowMap[SHAFT_SHADOW],sc.xy-st,0.)))+step(sc.z,unpackRGBAToDepth(shaftTex(directionalShadowMap[SHAFT_SHADOW],sc.xy+st,0.)))+
step(sc.z,unpackRGBAToDepth(shaftTex(directionalShadowMap[SHAFT_SHADOW],sc.xy+vec2(st.x,-st.y),0.)))+step(sc.z,unpackRGBAToDepth(shaftTex(directionalShadowMap[SHAFT_SHADOW],sc.xy+vec2(-st.x,st.y),0.))));}}
#endif
gk*=1.-shaftBehindText(vShaftClip.xy/vShaftClip.w*.5+.5)*mix(.85,1.,shaftTextProtection);
if(gk>.001){
vec3 gl=normalize((viewMatrix*vec4(shaftPoint>.5?shaftOrigin-gp:-shaftA,0.)).xyz);
float gn=dot(geometryNormal,gl);
vec3 ga=(max((gn+shaftGoboWrap.x)/(1.+shaftGoboWrap.x),0.)*(.4+.6*shaftThin)+shaftGoboWrap.y*shaftThin*pow(1.-abs(dot(geometryNormal,geometryViewDir)),3.)*smoothstep(-.1,.5,gn))*gk*shaftGoboColor*BRDF_Lambert(material.diffuseColor);
float gd=dot(reflectedLight.directDiffuse,vec3(.2126,.7152,.0722)),ge=dot(ga,vec3(.2126,.7152,.0722)),gt=gd+ge;
gt=gt<shaftGoboClip.x?gt:shaftGoboClip.x+shaftGoboClip.y*(1.-exp((shaftGoboClip.x-gt)/shaftGoboClip.y));
reflectedLight.directDiffuse+=ga*(max(gt-gd,0.)/max(ge,1e-6));
}}`;
// The air between the eye and the subject's surface, after fog like the box;
// the subject itself is the backdrop, so all of its light shows.
const GOBO_AIR = `
float shaftFar=length(vShaftWorld-cameraPosition);vec3 shaftSeen=vec3(0.);
if(shaftGain>0.)shaftSeen=shaftMarch(cameraPosition-shaftShift,(vShaftWorld-cameraPosition)/shaftFar,shaftFar,vShaftClip.xy/vShaftClip.w*.5+.5,ceil(shaftSteps*shaftAir.w),1.,1.);
gl_FragColor.rgb+=max(shaftQuad(shaftSeen,shaftFar),0.);`;

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
// Seeded value noise, three octaves, for the light windows.
function noise2(seed) {
  const h = (x, y) => {
    const s = Math.sin(x * 127.1 + y * 311.7 + seed * 17.3) * 43758.5453;
    return s - Math.floor(s);
  };
  const n = (x, y) => {
    const i = Math.floor(x),
      j = Math.floor(y),
      u = x - i,
      v = y - j;
    const fx = u * u * (3 - 2 * u),
      fy = v * v * (3 - 2 * v);
    const a = h(i, j),
      b = h(i + 1, j),
      c = h(i, j + 1),
      d = h(i + 1, j + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
  return (x, y) =>
    0.55 * n(x, y) + 0.3 * n(x * 2.07 + 11, y * 2.03 + 7) + 0.15 * n(x * 4.1 + 3, y * 3.9 + 19);
}
export function lightBasis(a) {
  const u = new Vector3()
    .crossVectors(a, Math.abs(a.y) > 0.95 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0))
    .normalize();
  return { u, v: new Vector3().crossVectors(u, a).normalize() };
}

// Blue noise by void and cluster (Ulichney 1993) on a small torus, as a rank
// per texel: each pixel's march starts at an offset as unlike its neighbours'
// as possible, so the few steps leave fine even grain rather than a lattice or
// clumps. A generator, sliced like the maps; the same seed gives the same tile.
export function* blueNoise(size = 32, sigma = 1.5, seed = 7) {
  const N = size * size,
    lut = new Float32Array(N),
    energy = new Float32Array(N),
    on = new Uint8Array(N),
    rank = new Uint16Array(N);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const dx = Math.min(x, size - x),
        dy = Math.min(y, size - y);
      lut[y * size + x] = Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
    }
  const toggle = (i, sign) => {
    on[i] = sign > 0 ? 1 : 0;
    const ix = i % size,
      iy = (i - ix) / size;
    for (let y = 0; y < size; y++) {
      const row = ((y - iy + size) % size) * size;
      for (let x = 0; x < size; x++)
        energy[y * size + x] += sign * lut[row + ((x - ix + size) % size)];
    }
  };
  // The tightest cluster (a set texel with the most energy) or the largest void.
  const extreme = (set) => {
    let best = -1,
      value = set ? -Infinity : Infinity;
    for (let i = 0; i < N; i++) {
      if (on[i] !== set || (set ? energy[i] <= value : energy[i] >= value)) continue;
      value = energy[i];
      best = i;
    }
    return best;
  };
  let state = seed;
  const random = () => (state = (state * 16807) % 2147483647) / 2147483647;
  let ones = 0;
  while (ones < N / 10) {
    const i = Math.floor(random() * N);
    if (on[i]) continue;
    toggle(i, 1);
    ones++;
  }
  // Relax the seed pattern until its tightest cluster is its largest void.
  for (let guard = 0; guard < N; guard++) {
    if (guard % 16 === 0) yield;
    const cluster = extreme(1);
    toggle(cluster, -1);
    const hole = extreme(0);
    toggle(hole, 1);
    if (hole === cluster) break;
  }
  const seedOn = on.slice(),
    seedEnergy = energy.slice();
  for (let r = ones - 1; r >= 0; r--) {
    if (r % 32 === 0) yield;
    const i = extreme(1);
    toggle(i, -1);
    rank[i] = r;
  }
  on.set(seedOn);
  energy.set(seedEnergy);
  for (let r = ones; r < N; r++) {
    if (r % 32 === 0) yield;
    const i = extreme(0);
    toggle(i, 1);
    rank[i] = r;
  }
  const data = new Uint8Array(N * 4);
  for (let i = 0; i < N; i++) {
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = Math.floor(((rank[i] + 0.5) / N) * 256);
    data[i * 4 + 3] = 255;
  }
  const texture = new DataTexture(data, size, size);
  texture.minFilter = texture.magFilter = NEAREST;
  texture.wrapS = texture.wrapT = REPEAT;
  texture.needsUpdate = true;
  return texture;
}

// Separable triangle blur, or a min or max filter (depth, closing), yielding
// by the work done (rows times the filter width).
function* blur(src, res, radius, mode = "blur") {
  let from = src;
  const min = mode === "min",
    max = mode === "max",
    rows = Math.max(1, Math.floor(8192 / (res * (2 * radius + 1))));
  for (const across of [true, false]) {
    const to = new Float32Array(res * res);
    for (let y = 0; y < res; y++) {
      if (y % rows === 0) yield;
      for (let x = 0; x < res; x++) {
        let sum = min ? Infinity : max ? -Infinity : 0,
          weight = 0;
        for (let k = -radius; k <= radius; k++) {
          const xx = across ? Math.min(res - 1, Math.max(0, x + k)) : x,
            yy = across ? y : Math.min(res - 1, Math.max(0, y + k)),
            value = from[yy * res + xx];
          if (min) sum = Math.min(sum, value);
          else if (max) sum = Math.max(sum, value);
          else {
            const w = 1 - Math.abs(k) / (radius + 1);
            sum += value * w;
            weight += w;
          }
        }
        to[y * res + x] = min || max ? sum : sum / weight;
      }
    }
    from = to;
  }
  return from;
}

// Rasterises triangles (root-frame positions, optionally indexed) into an
// RGBA8 light-space map with mip levels. A generator: it yields by the work
// done (vertices, triangles, texels touched), so no slice runs long even on a
// throttled phone CPU. point: a point source (the star; the map holds angles
// from it) or null for a directional light (the moon; an orthographic map
// about origin). R: the first hit (a min filter over sharp texels); G: the
// window (mask); B: the light let through (1 - coverage, lightly blurred),
// inside the closed silhouette, split into beams where given; A: that
// silhouette's front (its first hit, a min filter over close texels). A
// second, two-channel map (backTexture) holds the closed silhouette's back
// (R: its last hit, a max filter over close texels) and the subject's own
// back (G: its last hit, a max filter over sharp texels, none in its gaps;
// more than inner texels inside the closed silhouette's edge, blended toward
// the closed back), which the hull test reads so no view ray beside the subject counts as
// passing through it. Outside the silhouette the front has no depth; the
// closed back carries its edge's value four texels out, then has none.
// The silhouette is closed over close texels (gaps narrower than twice that fill: a dilation,
// then an erosion by close + erode, so its edge lies inside the outline) and
// feathered by a texel; without close it is the whole map.
export function* rasterizeLightMap({
  positions,
  index = null,
  point = null,
  origin,
  a,
  half,
  res,
  t0,
  t1,
  mask,
  beams = null,
  sharp = 1,
  close = 0,
  erode = 1,
  inner = 0,
}) {
  const { u, v } = lightBasis(a),
    N = res * res,
    count = positions.length / 3;
  const depth = new Float32Array(N).fill(Infinity),
    last = new Float32Array(N).fill(-Infinity),
    frac = new Float32Array(N);
  const X = new Float32Array(count),
    Y = new Float32Array(count),
    Z = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    if (i % 1500 === 0) yield;
    const dx = positions[i * 3] - origin.x,
      dy = positions[i * 3 + 1] - origin.y,
      dz = positions[i * 3 + 2] - origin.z;
    const z = dx * a.x + dy * a.y + dz * a.z,
      s = point ? 1 / z : 1;
    X[i] = (((dx * u.x + dy * u.y + dz * u.z) * s) / half + 1) * 0.5 * res;
    Y[i] = (((dx * v.x + dy * v.y + dz * v.z) * s) / half + 1) * 0.5 * res;
    Z[i] = z;
  }
  const n = index ? index.length : count;
  let work = 0;
  for (let k = 0; k + 2 < n; k += 3) {
    if (k % 600 === 0 || work > 3000) {
      work = 0;
      yield;
    }
    const i0 = index ? index[k] : k,
      i1 = index ? index[k + 1] : k + 1,
      i2 = index ? index[k + 2] : k + 2;
    const x0 = X[i0],
      y0 = Y[i0],
      x1 = X[i1],
      y1 = Y[i1],
      x2 = X[i2],
      y2 = Y[i2];
    const ax = Math.max(0, Math.floor(Math.min(x0, x1, x2))),
      bx = Math.min(res - 1, Math.floor(Math.max(x0, x1, x2)));
    const ay = Math.max(0, Math.floor(Math.min(y0, y1, y2))),
      by = Math.min(res - 1, Math.floor(Math.max(y0, y1, y2)));
    if (ax > bx || ay > by) continue;
    if (bx - ax <= 1 && by - ay <= 1) {
      // A sub-texel triangle adds fractional coverage by its area; a closed
      // surface projects twice (front and back), which the 0.5 below undoes.
      const c =
        Math.min(res - 1, Math.max(0, Math.floor((y0 + y1 + y2) / 3))) * res +
        Math.min(res - 1, Math.max(0, Math.floor((x0 + x1 + x2) / 3)));
      frac[c] += Math.abs((x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0)) * 0.5;
      depth[c] = Math.min(depth[c], Z[i0], Z[i1], Z[i2]);
      last[c] = Math.max(last[c], Z[i0], Z[i1], Z[i2]);
      continue;
    }
    const den = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
    if (Math.abs(den) < 1e-12) continue;
    work += (bx - ax + 1) * (by - ay + 1);
    for (let y = ay; y <= by; y++) {
      for (let x = ax; x <= bx; x++) {
        const px = x + 0.5,
          py = y + 0.5;
        const b0 = ((y1 - y2) * (px - x2) + (x2 - x1) * (py - y2)) / den,
          b1 = ((y2 - y0) * (px - x2) + (x0 - x2) * (py - y2)) / den;
        if (b0 < -0.02 || b1 < -0.02 || b0 + b1 > 1.02) continue;
        const c = y * res + x;
        const z = b0 * Z[i0] + b1 * Z[i1] + (1 - b0 - b1) * Z[i2];
        depth[c] = Math.min(depth[c], z);
        last[c] = Math.max(last[c], z);
        frac[c] = 1e3;
      }
    }
  }
  const cover = frac.map((f) => Math.min(1, f * 0.5));
  const lightly = yield* blur(cover, res, sharp);
  const hit = yield* blur(depth, res, Math.max(1, sharp), "min");
  let envelope = null,
    front = hit,
    back = yield* blur(last, res, Math.max(1, sharp), "max");
  const tight = back;
  if (close > 0) {
    // Thin twigs cover a texel in part: any real coverage counts.
    const solid = cover.map((value) => smooth(0.04, 0.3, value));
    const grown = yield* blur(solid, res, close, "max");
    envelope = yield* blur(yield* blur(grown, res, close + erode, "min"), res, 1);
    front = yield* blur(depth, res, close, "min");
    back = yield* blur(last, res, close, "max");
  }
  const inside =
    envelope && inner > 0 ? yield* blur(yield* blur(envelope, res, inner, "min"), res, 2) : null;
  const data = new Uint8Array(N * 4),
    backs = new Uint8Array(N * 2);
  const encode = (z) =>
    z === Infinity ? 255 : Math.max(0, Math.min(254, Math.round(((z - t0) / (t1 - t0)) * 254)));
  let near = Infinity,
    far = -Infinity,
    deepest = -Infinity;
  for (let c = 0; c < N; c++) {
    if (c % 128 === 0) yield;
    const x = c % res,
      y = (c - x) / res;
    // No front or back outside the closed silhouette: the softer levels of B,
    // read further from the subject, cannot carry light past its outline.
    const outside = envelope && envelope[c] < 0.5;
    data[c * 4] = encode(hit[c]);
    backs[c * 2] = outside || back[c] === -Infinity ? 255 : encode(back[c]);
    const own = outside || tight[c] === -Infinity ? 255 : encode(tight[c]);
    backs[c * 2 + 1] =
      inside && backs[c * 2] < 255 ? Math.round(own + (backs[c * 2] - own) * inside[c]) : own;
    const X = (((x + 0.5) / res) * 2 - 1) * half,
      Y = (((y + 0.5) / res) * 2 - 1) * half;
    data[c * 4 + 1] = Math.round(255 * Math.max(0, Math.min(1, mask(X, Y))));
    data[c * 4 + 2] = Math.round(
      255 *
        (1 - lightly[c]) *
        (envelope ? envelope[c] : 1) *
        (beams ? Math.max(0, Math.min(1, beams(X, Y))) : 1),
    );
    data[c * 4 + 3] = outside ? 255 : encode(front[c]);
    if (data[c * 4 + 3] < 255 && data[c * 4 + 2] > 0) {
      near = Math.min(near, front[c]);
      far = Math.max(far, front[c]);
      deepest = Math.max(deepest, back[c]);
    }
  }
  // The closed silhouette's valid backs spread four texels outward into the
  // texels without one, each taking its nearest valid neighbours' nearest
  // back, so the linearly filtered back map never blends toward "no depth" at
  // the silhouette's edge (which drew one-texel rings of light over the open
  // sky). The front (A) still marks the outside: no air there takes light.
  let spread = backs;
  for (let pass = 0; pass < 4; pass++) {
    const next = spread.slice();
    for (let c = 0; c < N; c++) {
      if (c % 4096 === 0) yield;
      if (spread[c * 2] < 255) continue;
      const x = c % res,
        at = (k) => spread[k * 2];
      next[c * 2] = Math.min(
        x > 0 ? at(c - 1) : 255,
        x < res - 1 ? at(c + 1) : 255,
        c >= res ? at(c - res) : 255,
        c < N - res ? at(c + res) : 255,
      );
    }
    spread = next;
  }
  const texture = new DataTexture(data, res, res);
  texture.magFilter = LINEAR;
  texture.minFilter = LINEAR_MIPMAP_LINEAR;
  texture.generateMipmaps = true;
  texture.wrapS = texture.wrapT = CLAMP;
  texture.needsUpdate = true;
  const backTexture = new DataTexture(spread, res, res, RG_FORMAT);
  backTexture.magFilter = backTexture.minFilter = LINEAR;
  backTexture.wrapS = backTexture.wrapT = CLAMP;
  backTexture.needsUpdate = true;
  // depths: the nearest and farthest fronts and the deepest back where light
  // comes through (the air's own range starts at the nearest front and ends a
  // reach past the farthest, or, over the sky, a falloff past the deepest back).
  return {
    texture,
    backTexture,
    u,
    v,
    depths: near <= far ? [near, far, Math.max(far, deepest)] : [0, 0, 0],
    coverage: cover.reduce((sum, value) => sum + value, 0) / N,
  };
}

function boxGeometry() {
  const geometry = new BufferGeometry(),
    p = [],
    ix = [];
  for (let i = 0; i < 8; i++) p.push(i & 1 ? 0.5 : -0.5, i & 2 ? 0.5 : -0.5, i & 4 ? 0.5 : -0.5);
  for (const [a, b, c, d] of [
    [0, 2, 3, 1],
    [4, 5, 7, 6],
    [0, 1, 5, 4],
    [2, 6, 7, 3],
    [0, 4, 6, 2],
    [1, 3, 7, 5],
  ])
    ix.push(a, b, c, a, c, d);
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(p), 3));
  geometry.setIndex(ix);
  geometry.computeBoundingSphere();
  return geometry;
}

// Composes with the subject material's existing hooks (film grade) and
// restores them. shadow: the moon's slot among shadow-casting directional
// lights, found by reference (-1 without one); it only selects its shadow map.
export function goboHook(material, uniforms, shadow) {
  const before = material.onBeforeCompile,
    key = material.customProgramCacheKey;
  const hooked = function (shader, renderer) {
    before?.call(this, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec3 vShaftWorld;varying vec4 vShaftClip;",
      )
      .replace(
        "#include <project_vertex>",
        "#include <project_vertex>\nvShaftWorld=(modelMatrix*vec4(transformed,1.)).xyz;vShaftClip=gl_Position;",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>\n#define SHAFT_SHADOW ${shadow}\nvarying vec3 vShaftWorld;varying vec4 vShaftClip;uniform float shaftGoboGain;uniform vec3 shaftGoboColor;uniform vec2 shaftGoboWrap;uniform vec2 shaftGoboClip;uniform float shaftGoboShadow;uniform vec3 shaftSurface;${SHAFT_GLSL}`,
      )
      .replace(
        "#include <lights_fragment_begin>",
        `#include <lights_fragment_begin>\n${GOBO_LIGHT}`,
      )
      .replace("#include <fog_fragment>", `#include <fog_fragment>\n${GOBO_AIR}`);
  };
  const cacheKey = function () {
    return `${key?.call(this) ?? ""}|light-shafts-${shadow}`;
  };
  return {
    install(target = material) {
      target.onBeforeCompile = hooked;
      target.customProgramCacheKey = cacheKey;
      target.needsUpdate = true;
    },
    restore() {
      material.onBeforeCompile = before;
      material.customProgramCacheKey = key;
      material.needsUpdate = true;
    },
  };
}

const SUBJECTS = [
  ["tower", "complete-meshy-tower"],
  ["tree", "meshy-tree"],
];
// A light that lands mid-hold fades in over this long rather than popping.
const RAMP_MS = 1000;

// The subsystem index.js registers: lightShafts(rendering, cinematic,
// cameraTour, filmScene, environmentRoot, invalidateContent). It finds the
// subjects, the moon and the shot on screen through them and checks them each
// frame, so a film or quality change that removes or replaces a
// subject or its material disposes that subject's light (restoring its own
// program first) and rebuilds it. Everything lives in the environment root's
// frame, which a composition change moves as a whole (shaftShift).
export function lightShafts(rendering, cinematic, tour, film, root, invalidate = () => {}) {
  const scene = rendering.homeScene,
    camera = rendering.camera,
    moonLight = rendering.lights?.sun;
  const finalPass = rendering.postprocessPipeline?.passes?.vignetteGrain?.uniforms ?? {};
  const config = SHAFTS;
  const idle =
    typeof window.requestIdleCallback === "function"
      ? (task) => window.requestIdleCallback(task, { timeout: 120 })
      : (task) => window.setTimeout(task, 16);
  // One uniform object each, shared by every box and subject program. The
  // march length follows the treatment on screen and the quality tier (the
  // rendering's, or where none is named, high draws shadows).
  const isHigh = (tier, shadows) => (tier ? tier === "high" : Boolean(shadows));
  let high = isHigh(rendering.tier, rendering.renderer?.shadowMap?.enabled);
  const shared = {
    shaftShift: { value: new Vector3() },
    shaftDrift: { value: { x: 0, y: 0 } },
    shaftSteps: { value: 10 },
    shaftNoise: { value: null },
    shaftText: { value: { x: 2, y: 2, z: -1, w: -1 } },
    shaftSource: { value: { x: 0.5, y: 0.5, z: 1, w: 0 } },
    shaftStreak: { value: { x: 48, y: 0, z: 1, w: 0 } },
    shaftJitter: { value: 0 },
    shaftTextProtection: finalPass.uTextProtection ?? { value: 0 },
  };
  const box = boxGeometry(),
    maps = new Map();
  const parts = {}; // subject -> { mesh, material, sets, hook, uniforms, probe, installed, ready, linked, done }
  const eye = new Vector3(),
    source = new Vector3();
  let lit = []; // [part, set] pairs of the treatment on screen
  let disposed = false,
    running = null,
    shown = "",
    time = 0,
    frames = 0,
    filmWas = null,
    level = 1,
    blend = 1,
    rampFrom = 0,
    revealedAt = null,
    revealFade = 0;
  // A subject mesh by name under the root, found again when the film changes
  // or a known one leaves the root or changes material, every 30th frame (one
  // replaced in place), and on every frame drawn while it is missing (one that
  // arrives late).
  const subjectMesh = (name) => {
    let found = null;
    root.traverse((object) => {
      if (!found && object.isMesh && object.name === name) found = object;
    });
    return found;
  };
  const underRoot = (object) => {
    for (let each = object; each; each = each.parent) if (each === root) return true;
    return false;
  };
  // The moon's slot among shadow-casting directional lights, found by
  // reference when a subject links: Three sorts casters first, in scene
  // order. Its shadow map is sampled only while it casts (high).
  function shadowIndex() {
    let index = -1,
      count = 0;
    scene.traverseVisible((object) => {
      if (index >= 0 || !object.isDirectionalLight) return;
      if (object === moonLight) index = count;
      else if (object.castShadow) count++;
    });
    return index;
  }
  // Subject triangles in the root's frame (the composition offset moves the root).
  function* localPositions(mesh) {
    mesh.updateWorldMatrix(true, false);
    const matrix = root.matrixWorld.clone().invert().multiply(mesh.matrixWorld),
      source = mesh.geometry.attributes.position,
      out = new Float32Array(source.count * 3),
      p = new Vector3();
    for (let i = 0; i < source.count; i++) {
      if (i % 2000 === 0) yield;
      p.fromBufferAttribute(source, i)
        .applyMatrix4(matrix)
        .toArray(out, i * 3);
    }
    return out;
  }
  function* bounds(positions) {
    const min = new Vector3(Infinity, Infinity, Infinity),
      max = min.clone().negate(),
      p = new Vector3();
    for (let i = 0; i < positions.length; i += 3) {
      if (i % 6000 === 0) yield;
      p.fromArray(positions, i);
      min.min(p);
      max.max(p);
    }
    return {
      min,
      max,
      center: min.clone().add(max).multiplyScalar(0.5),
      size: max.clone().sub(min),
    };
  }
  // The terrain under a box: the film terrain's own height (its root supports
  // included), or the analytic ground without it.
  function terrainTop(height, min, max, heading) {
    let top = -Infinity;
    for (let i = 0; i <= 10; i++)
      for (let j = 0; j <= 10; j++) {
        const x = min.x + ((max.x - min.x) * i) / 10,
          z = min.z + ((max.z - min.z) * j) / 10;
        top = Math.max(top, height(x * heading.x - z * heading.z, x * heading.z + z * heading.x));
      }
    return top;
  }

  function* buildSet(kind, subject, mesh, height) {
    // A subject's own air (gain, over, reach, sky) overrides the treatment's.
    const cfg = config[kind][subject],
      T = { ...config[kind], ...cfg.air };
    const positions = yield* localPositions(mesh),
      b = yield* bounds(positions);
    const index = mesh.geometry.index?.array ?? null;
    const star = kind === "star";
    const nz = noise2(subject.length * 7 + (star ? 3 : 21));
    const radius = b.size.length() * 0.5,
      reach = T.reach[0] + T.reach[1];
    let look,
      core,
      mask,
      key,
      beams = null;
    if (star) {
      // The world star, in the root's frame; its map is a perspective from it,
      // aimed into the tower so it holds the cabin and the whole lattice.
      const sun = window.BabelSite?.scene?.WORLD?.SUN_POSITION ?? [-72.25, 50, -11.9];
      const origin = new Vector3(...sun).sub(new Vector3().setFromMatrixPosition(root.matrixWorld));
      const aim = b.center.clone();
      aim.y = b.min.y + b.size.y * cfg.aim;
      const a = aim.clone().sub(origin).normalize(),
        dist = aim.distanceTo(origin),
        half = cfg.ext / dist;
      core = [aim, cfg.ext * cfg.core];
      look = { origin, a, half, t0: dist - radius - 1, t1: dist + radius + 1, point: origin };
      // A soft round window over the whole tower, gently uneven, that reaches
      // zero well inside the map, so no edge of it can show; fullest through
      // the cabin and the upper lattice (the map's y is up), softer toward the
      // lattice's foot.
      const [fall, floor] = cfg.fall;
      mask = (x, y) =>
        (1 - smooth(0.78, 0.97, Math.hypot(x, y) / half)) *
        (0.72 + 0.28 * nz((x / half) * 2.5 + 3, (y / half) * 2.5 + 1)) *
        (floor + (1 - floor) * smooth(fall, fall + 0.65, y / half));
      beams = mask;
      key = `${mesh.geometry.uuid}|star|${origin.toArray().map((x) => x.toFixed(1))}|${[cfg.aim, cfg.ext, cfg.res, cfg.sharp, cfg.close, cfg.erode, cfg.inner, cfg.fall]}`;
    } else {
      const a = new Vector3().subVectors(moonLight.target.position, moonLight.position).normalize();
      const { u, v } = lightBasis(a),
        [h, rx, ry, gapCore] = cfg.gap;
      const at = new Vector3(b.center.x, b.min.y + b.size.y * h, b.center.z).sub(b.center),
        gx = at.dot(u),
        gy = at.dot(v);
      const [bf, bt, bw, bfloor] = cfg.breaks ?? T.breaks;
      // Every texel the air takes light through lies inside the gap's ellipse
      // (its edge noise included), so the lit core holds it.
      core = [
        b.center.clone().addScaledVector(u, gx).addScaledVector(v, gy),
        Math.max(rx, ry) * cfg.core,
      ];
      look = { origin: b.center, a, half: cfg.ext, t0: -radius - 1, t1: radius + 1, point: null };
      // Broken cloud light over the whole subject, in large soft patches (the
      // window: the light on the bark and timber, reaching zero inside the
      // map), and a break in the cloud where the air takes it: the light let
      // through, which the surfaces behind the front also take.
      // lit: [inner, outer, floor] keeps the surfaces' light to the gap's
      // neighbourhood (the cabin, not the whole lattice), from full inside
      // inner to floor beyond outer (gap units).
      const [inner, outer, lowest] = cfg.lit ?? [0, 1, 1];
      mask = (X, Y) =>
        (1 - smooth(0.8, 0.97, Math.hypot(X, Y) / cfg.ext)) *
        (bfloor + (1 - bfloor) * smooth(bt - bw, bt + bw, nz(X * bf + 31, Y * bf + 17))) *
        (lowest +
          (1 - lowest) * (1 - smooth(inner, outer, Math.hypot((X - gx) / rx, (Y - gy) / ry))));
      beams = (X, Y) =>
        1 -
        smooth(
          gapCore,
          1,
          Math.hypot((X - gx) / rx, (Y - gy) / ry) + 0.3 * (nz(X * 0.3 + 5, Y * 0.3) - 0.5),
        );
      key = `${mesh.geometry.uuid}|moon|${a.toArray().map((x) => x.toFixed(3))}|${[cfg.gap, cfg.lit, cfg.ext, cfg.res, cfg.sharp, cfg.close, cfg.erode, bf, bt, bw, bfloor]}`;
    }
    const map =
      maps.get(key) ??
      (yield* rasterizeLightMap({
        positions,
        index,
        point: look.point,
        origin: look.origin,
        a: look.a,
        half: look.half,
        res: cfg.res,
        t0: look.t0,
        t1: look.t1,
        sharp: cfg.sharp,
        close: cfg.close,
        erode: cfg.erode,
        inner: cfg.inner,
        mask,
        beams,
      }));
    maps.set(key, map);
    // The box turns about the vertical to follow the light, keeping its floor
    // level: the subject and where its light runs on past it, as far as the
    // reach or the subject's foot. lo/hi are its extents along (heading, up,
    // across). The air is lit only past the subject's front, so nothing
    // up-light of the subject needs a box.
    const heading = new Vector3(look.a.x, 0, look.a.z).normalize();
    const lo = new Vector3(Infinity, Infinity, Infinity),
      hi = lo.clone().negate();
    const include = (p) => {
      const q = new Vector3(
        p.x * heading.x + p.z * heading.z,
        p.y,
        p.z * heading.x - p.x * heading.z,
      );
      lo.min(q);
      hi.max(q);
    };
    for (let i = 0; i < 8; i++) {
      const c = new Vector3(
        i & 1 ? b.max.x : b.min.x,
        i & 2 ? b.max.y : b.min.y,
        i & 4 ? b.max.z : b.min.z,
      );
      const dir = star ? c.clone().sub(look.origin).normalize() : look.a;
      include(c);
      include(
        c
          .clone()
          .addScaledVector(dir, dir.y < 0 ? Math.min(reach, (c.y - b.min.y) / -dir.y) : reach),
      );
    }
    lo.subScalar(1);
    hi.addScalar(1);
    // The far face must never sit under the terrain: hidden, it would cut the beam.
    const floor = terrainTop(height, lo, hi, heading) + 0.05;
    lo.y = Math.max(lo.y, floor);
    hi.y = b.max.y + 1;
    if (hi.y - lo.y < 2) return null;
    const volume = new Mesh(box, null),
      mid = lo.clone().add(hi).multiplyScalar(0.5);
    volume.name = `light-shafts-${kind}-${subject}`;
    volume.position.set(
      mid.x * heading.x - mid.z * heading.z,
      mid.y,
      mid.x * heading.z + mid.z * heading.x,
    );
    volume.rotation.y = Math.atan2(-heading.z, heading.x);
    volume.scale.copy(hi).sub(lo);
    volume.updateMatrix();
    volume.renderOrder = 20;
    volume.visible = false;
    // The per-treatment uniform values; the box and the subject hold their own objects.
    const values = {
      shaftMap: map.texture,
      shaftBack: map.backTexture,
      shaftOrigin: look.origin,
      shaftU: map.u,
      shaftV: map.v,
      shaftA: look.a,
      shaftSpan: {
        x: 0.5 / look.half,
        y: 0.5 / look.half,
        z: look.t0,
        w: ((look.t1 - look.t0) * 255) / 254,
      },
      shaftRes: cfg.res,
      shaftPoint: star ? 1 : 0,
      shaftToBox: volume.matrix.clone().invert(),
      shaftColor: new Vector3(...T.color),
      shaftGain: T.gain,
      shaftPhase: T.phase,
      shaftEdge: new Vector3(...T.edge),
      shaftFade: { x: floor, y: T.fade[0], z: hi.y, w: T.fade[1] },
      shaftMist: T.mist ? 1 / T.mist : 0,
      shaftAir: { x: T.front, y: T.penumbra, z: T.maxLod, w: T.sub },
      shaftCore: { x: core[0].x, y: core[0].y, z: core[0].z, w: core[1] },
      shaftReach: { x: T.reach[0], y: T.reach[1], z: T.sky[0], w: T.sky[1] },
      shaftGround: { x: T.ground[0], y: T.ground[1] },
      shaftCeil: T.ceil,
      shaftDepths: new Vector3(
        map.depths[0] - T.front - 2,
        map.depths[1] + T.front,
        map.depths[2] + T.front,
      ),
      shaftSurface: new Vector3(1, { ...T.gobo, ...cfg.gobo }.bias, 0),
      shaftShape: { x: T.rise, y: T.hull[0], z: T.hull[1], w: T.tie },
      shaftHullMode: { x: T.hull[2], y: T.hull[3] ?? 0 },
      shaftPeak: T.peak,
      shaftLayer: T.layer || 1,
    };
    volume.material = new ShaderMaterial({
      name: "LightShafts",
      vertexShader: VERTEX,
      fragmentShader: VOLUME,
      uniforms: {
        ...Object.fromEntries(Object.entries(values).map(([name, value]) => [name, { value }])),
        ...shared,
      },
      side: BACK_SIDE,
      transparent: true,
      depthWrite: false,
      // dst.rgb += src.rgb (times dst.a, the film depth layer, where the
      // treatment keeps its air off the sky); dst.a itself is untouched.
      blending: CUSTOM_BLENDING,
      blendSrc: T.layer ? DST_ALPHA : ONE,
      blendDst: ONE,
      blendSrcAlpha: ZERO,
      blendDstAlpha: ONE,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -4,
    });
    const gobo = { ...T.gobo, ...cfg.gobo };
    return {
      key: `${subject}-${kind}`,
      kind,
      subject,
      volume,
      values,
      lo,
      hi,
      gobo,
      gain: T.gain,
      over: T.over,
      jitter: T.jitter || 0,
      center: b.center,
      height: b.size.y,
      coverage: map.coverage,
    };
  }

  // Removes one subject's light, restoring its own program first (it stays in
  // the material's cache), and the treatment on screen if it was that one. A
  // link still in flight keeps its materials until it settles: Three's
  // compileAsync polls them.
  function clear(part) {
    if (part.installed) part.hook.restore();
    part.installed = false;
    const materials = part.probe ? [part.probe.material] : [];
    for (const set of part.sets.splice(0)) {
      set.volume.removeFromParent();
      materials.push(set.volume.material);
    }
    const free = () => materials.forEach((material) => material.dispose());
    if (part.linking) part.linking.then(free);
    else free();
    part.ready = false;
    lit = lit.filter(([each]) => each !== part);
    if (shown.startsWith(`${part.subject}-`)) {
      shown = "";
      invalidate();
    }
  }
  function teardown(subject) {
    if (!parts[subject]) return;
    clear(parts[subject]);
    delete parts[subject];
  }

  // One subject at a time, the tower first and its star first, so The
  // watch's light can land while the canvas fades in: its maps in idle
  // slices, then its programs link on a detached stand-in, so a visible
  // subject never draws with a program that is still compiling. A later
  // treatment reuses them. The blue-noise tile comes before any of it.
  let noiseJob = null;
  const flatNoise = () => {
    const texture = new DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
    texture.needsUpdate = true;
    return texture;
  };
  function pump() {
    if (disposed || running) return;
    if (!shared.shaftNoise.value && !noiseJob)
      noiseJob = { subject: "noise", sets: [], job: blueNoise() };
    const part = !shared.shaftNoise.value
      ? noiseJob
      : ["tower", "tree"].map((subject) => parts[subject]).find((each) => each && !each.done);
    if (!part) return;
    running = part;
    const noise = part === noiseJob,
      job = noise ? part.job : buildPart(part);
    let resolved;
    const step = (deadline) => {
      if (disposed || (!noise && parts[part.subject] !== part)) {
        running = null;
        pump();
        return;
      }
      // The film terrain's own build has the time first (terrain-build.js):
      // it can land only under the fade-in or on a cut, while this light can
      // fade in mid-hold.
      const terrain = rendering.terrainSlicing;
      if (terrain) {
        terrain.then(() => idle(step));
        return;
      }
      // A slice whose idle wait timed out takes less: nothing else is idle.
      const begun = performance.now(),
        until =
          begun + (!deadline ? 5 : deadline.didTimeout ? 2 : Math.min(5, deadline.timeRemaining()));
      let wait = null,
        finished = false;
      try {
        for (;;) {
          const { done, value } = job.next(resolved);
          resolved = undefined;
          if (done) {
            finished = true;
            if (noise) shared.shaftNoise.value = value;
            else part.done = true;
            break;
          }
          if (value?.then) {
            wait = value;
            break;
          }
          if (performance.now() >= until) break;
        }
      } catch (error) {
        // Keep the failed subject as it was, without retrying it every frame;
        // without the noise tile, every march starts mid-step.
        finished = true;
        if (noise) shared.shaftNoise.value = flatNoise();
        else {
          clear(part);
          part.done = part.failed = true;
        }
      }
      if (wait)
        wait.then(
          (result) => {
            resolved = result;
            idle(step);
          },
          () => idle(step),
        );
      else if (!finished) idle(step);
      else {
        running = null;
        pump();
      }
    };
    idle(step);
  }
  function* buildPart(part) {
    const analytic = window.BabelSite?.scene?.groundHeight || (() => 0);
    for (const kind of part.subject === "tower" ? ["star", "moon"] : ["moon"]) {
      // The star box lies over the tower's flat terrace, where the analytic
      // ground is exact; the moon boxes wait for the terrain's root supports.
      const height = kind === "star" ? analytic : (yield Promise.resolve(film.ready)) || analytic;
      const set = yield* buildSet(kind, part.subject, part.mesh, height);
      if (!set) continue;
      part.sets.push(set);
      root.add(set.volume);
      if (!part.hook) {
        // New programs link once the canvas shows, so they never compete with
        // the reveal's own warm-up; linking starts a slice of its own.
        yield whenRevealed();
        yield link(part, set);
      }
      if (!part.relinking) part.ready = true;
      invalidate();
    }
  }
  function link(part, set) {
    const mesh = part.mesh;
    // The subject's own uniform objects: show() copies a treatment's values in.
    part.uniforms = {
      ...Object.fromEntries(Object.entries(set.values).map(([name, value]) => [name, { value }])),
      ...shared,
      shaftGoboGain: { value: 0 },
      shaftGoboColor: { value: new Vector3() },
      shaftGoboWrap: { value: { x: 0, y: 0 } },
      shaftGoboClip: { value: { x: 1, y: 1 } },
      shaftGoboShadow: { value: 0 },
    };
    part.uniforms.shaftGain.value = 0;
    part.hook = goboHook(mesh.material, part.uniforms, shadowIndex());
    // A detached stand-in with the hooked program key links it off the draw
    // and keeps the program until teardown.
    part.probe = new Mesh(mesh.geometry, mesh.material.clone());
    part.hook.install(part.probe.material);
    part.lights = lightKey();
    return linkPrograms(part, [part.probe, set.volume]).then((linked) => {
      part.linked = linked;
    });
  }
  // Program keys count the scene's lights and whether shadows draw. Until a
  // subject first commits, its programs are linked again when those change
  // (the tree brings two lights): checked every 30th frame and before any
  // commit, so the commit never compiles. After it, the scene's own warm-ups
  // (rendering.compileShaders(), rendering.prepareQuality()) include them.
  function lightKey() {
    const counts = {};
    scene.traverseVisible((object) => {
      if (object.isLight)
        counts[object.type + (object.castShadow ? "+" : "")] =
          (counts[object.type + (object.castShadow ? "+" : "")] ?? 0) + 1;
    });
    return `${Object.entries(counts).sort().join(";")}|${Boolean(rendering.renderer?.shadowMap?.enabled)}`;
  }
  function relink() {
    let key = null;
    for (const part of Object.values(parts)) {
      if (!part.hook || part.installed || part.relinking || !part.ready) continue;
      key ??= lightKey();
      if (key === part.lights) continue;
      part.ready = false;
      part.relinking = true;
      part.lights = key;
      linkPrograms(part, [part.probe, ...part.sets.map((set) => set.volume)]).then((linked) => {
        part.relinking = false;
        if (parts[part.subject] !== part) return;
        part.linked = linked;
        part.ready = true;
        invalidate();
      });
    }
  }
  // Links just these objects' programs with the scene's lights and fog, like
  // rendering.compileShaders() (against a composer target, whose program keys
  // the scene pass uses, and only where programs link in parallel), without
  // preparing every other material again. Resolves true once they are linked,
  // false without parallel linking or after 2 s; part.linking settles only
  // when Three stops polling them.
  function linkPrograms(part, objects) {
    const renderer = rendering.renderer;
    if (
      typeof renderer?.compileAsync !== "function" ||
      renderer.extensions?.has?.("KHR_parallel_shader_compile") !== true ||
      renderer.getContext?.()?.isContextLost?.()
    )
      return Promise.resolve(false);
    const previous = renderer.getRenderTarget?.() ?? null;
    let pending;
    try {
      renderer.setRenderTarget?.(rendering.composer?.readBuffer ?? null);
      pending = Promise.all(
        objects.map((object) => renderer.compileAsync(object, camera, scene)),
      ).then(
        () => true,
        () => false,
      );
    } catch {
      return Promise.resolve(false);
    } finally {
      renderer.setRenderTarget?.(previous);
    }
    part.linking = Promise.all([part.linking, pending]);
    return Promise.race([
      pending,
      new Promise((resolve) => window.setTimeout(() => resolve(false), 2000)),
    ]);
  }

  // The treatment the shot on screen calls for, and whether the eye sits in
  // its box: then its light would fill the lens, so only the gobo stays.
  function wanted() {
    const kind = shaftTreatment(cinematic.shot?.name),
      part = parts[cinematic.current];
    const set = kind && part?.ready ? part.sets.find((s) => s.kind === kind) : null;
    if (!set) return "";
    // In box units, with a unit of margin.
    eye.copy(camera.position).sub(shared.shaftShift.value).applyMatrix4(set.values.shaftToBox);
    const sx = set.hi.x - set.lo.x,
      sy = set.hi.y - set.lo.y,
      sz = set.hi.z - set.lo.z;
    const inside =
      Math.abs(eye.x) < 0.5 + 1 / sx &&
      Math.abs(eye.y) < 0.5 + 1 / sy &&
      Math.abs(eye.z) < 0.5 + 1 / sz;
    return inside ? `${set.key}:inside` : set.key;
  }
  // Shows a treatment: fully (from = 1), or fading in from nothing over RAMP_MS.
  function show(state, from = 1) {
    shown = state;
    level = from;
    rampFrom = performance.now();
    lit = [];
    const [key] = state.split(":");
    for (const part of Object.values(parts)) {
      const set = part.sets.find((s) => s.key === key);
      for (const each of part.sets)
        each.volume.visible = each === set && !state.endsWith(":inside");
      if (!part.hook) continue;
      if (set) lit.push([part, set]);
      // A subject switches to its hooked program at its first commit, so
      // where programs cannot link in parallel the compile lands on a cut.
      if (set && !part.installed) {
        part.hook.install();
        part.installed = true;
      }
      if (!set) continue;
      const { uniforms } = part;
      for (const [name, value] of Object.entries(set.values)) uniforms[name].value = value;
      uniforms.shaftGoboWrap.value = { x: set.gobo.wrap, y: set.gobo.rim };
      uniforms.shaftGoboClip.value = { x: set.gobo.clip[0], y: set.gobo.clip[1] };
      uniforms.shaftGoboShadow.value = set.kind === "moon" && set.gobo.shadow !== false ? 1 : 0;
      goboColor(set, uniforms.shaftGoboColor.value);
    }
    if (lit.length) rays(lit[0][1], true);
    gains();
  }
  // The rays on screen radiate from the light's own place in the frame (the
  // star, or the moon's vanishing point), as crepuscular rays do: the air
  // light is streaked by angle about it (shaftRay), so the rays through the
  // gaps read as rays even where the eye looks along them.
  // The streaks' count about the source is set when a treatment shows, for
  // an even spacing (period, in the subject's own height on screen) where the
  // subject stands, so a phone's smaller tower keeps as many rays as the
  // desktop's; it is held through the shot's push-in so the pattern never jumps.
  const onScreen = (point) => point.add(shared.shaftShift.value).project(camera);
  function rays(set, fresh = false) {
    const T = config[set.kind],
      period = T.rays[1],
      jitter = set.jitter;
    const [contrast, e0, e1] = !high && T.sparse ? T.sparse : [T.rays[0], T.rays[2], T.rays[3]],
      value = shared.shaftSource.value;
    camera.updateMatrixWorld();
    if (set.kind === "star") onScreen(source.copy(set.values.shaftOrigin));
    else source.copy(camera.position).addScaledVector(set.values.shaftA, -1e4).project(camera);
    Object.assign(value, {
      x: source.x * 0.5 + 0.5,
      y: source.y * 0.5 + 0.5,
      z: camera.aspect || 1,
      w: contrast,
    });
    if (fresh) {
      const c = onScreen(eye.copy(set.center)),
        cx = (c.x * 0.5 + 0.5 - value.x) * value.z,
        cy = c.y * 0.5 + 0.5 - value.y;
      const top = onScreen(eye.copy(set.center).setY(set.center.y + set.height * 0.5)).y,
        bottom = onScreen(eye.copy(set.center).setY(set.center.y - set.height * 0.5)).y;
      const tall = Math.min(1, Math.max(0.1, Math.abs(top - bottom) * 0.5));
      // The sway moves the streaks by at most half of one about the source.
      // With jitter, their spacing wanders over groups of four, so the count
      // is a multiple of four (no seam where the angle wraps).
      const count = (2 * Math.PI * Math.hypot(cx, cy)) / (period * tall),
        group = jitter ? 4 : 1;
      Object.assign(shared.shaftStreak.value, {
        x: Math.min(4096, Math.max(8, Math.round(count / group) * group)),
        y: e0,
        z: e1,
        w: 0.5 / config[set.kind].drift[0],
      });
      shared.shaftJitter.value = jitter;
    } else if (shared.shaftStreak.value.y !== e0 || shared.shaftStreak.value.z !== e1) {
      // A quality step keeps the count (no jump mid-shot) and takes the tier's streaks.
      Object.assign(shared.shaftStreak.value, { y: e0, z: e1 });
    }
  }
  // The name and intro's box on the canvas (0-1, y up), which the march
  // feathers: the air scales down behind the text wherever the layout puts it.
  function measureText() {
    const doc = window.document,
      canvas = rendering.renderer?.domElement?.getBoundingClientRect?.(),
      text = shared.shaftText.value;
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    for (const selector of [".hero h1", ".hero-intro"]) {
      const r = doc?.querySelector?.(selector)?.getBoundingClientRect?.();
      if (!r?.width || !r.height) continue;
      x0 = Math.min(x0, r.left);
      x1 = Math.max(x1, r.right);
      y0 = Math.min(y0, r.top);
      y1 = Math.max(y1, r.bottom);
    }
    if (!canvas?.width || !canvas.height || x0 > x1)
      return Object.assign(text, { x: 2, y: 2, z: -1, w: -1 });
    return Object.assign(text, {
      x: (x0 - canvas.left) / canvas.width,
      z: (x1 - canvas.left) / canvas.width,
      y: 1 - (y1 - canvas.top) / canvas.height,
      w: 1 - (y0 - canvas.top) / canvas.height,
    });
  }
  // The gains and march length of the treatment on screen at the current fade
  // level and dissolve.
  function gains() {
    const inside = shown.endsWith(":inside");
    shared.shaftSteps.value = config[shown.includes("-star") ? "star" : "moon"].steps[high ? 0 : 1];
    for (const part of Object.values(parts)) {
      if (!part.uniforms) continue;
      part.uniforms.shaftGoboGain.value = 0;
      part.uniforms.shaftGain.value = 0;
    }
    for (const [part, set] of lit) {
      // Sparser streaks on balanced carry a little more light each.
      const air = set.gain * ((!high && config[set.kind].sparse?.[3]) || 1);
      set.volume.material.uniforms.shaftGain.value = air * level * blend;
      part.uniforms.shaftGoboGain.value = set.gobo.gain * level * blend;
      part.uniforms.shaftGain.value = inside ? 0 : air * set.over * level * blend;
    }
  }
  function whenRevealed() {
    return new Promise((resolve) => {
      (function check() {
        if (disposed || rendering.renderer?.domElement?.parentNode?.classList?.contains("is-ready"))
          resolve();
        else window.setTimeout(check, 50);
      })();
    });
  }
  function hidden() {
    const container = rendering.renderer?.domElement?.parentNode;
    if (!container?.classList?.contains("is-ready")) return true;
    if (revealedAt === null) {
      // The reveal's own User Timing mark (perf-marks.js), or now.
      revealedAt =
        performance.getEntriesByName?.("babel:reveal", "mark").at(-1)?.startTime ??
        performance.now();
      const duration = window.getComputedStyle?.(container)?.transitionDuration ?? "0s";
      revealFade = parseFloat(duration) * (/ms/.test(duration) ? 1 : 1000) || 0;
    }
    return performance.now() - revealedAt < revealFade;
  }
  // The star is no scene light: its catch takes the treatment's own colour.
  // The moon's follows the key light's colour and strength (legacy light
  // units, as Three scales them).
  function goboColor(set, target) {
    const tint = set.gobo.color,
      scale = set.kind === "moon" && moonLight ? moonLight.intensity * Math.PI : 0;
    return scale
      ? target.set(
          moonLight.color.r * scale * tint[0],
          moonLight.color.g * scale * tint[1],
          moonLight.color.b * scale * tint[2],
        )
      : target.set(...tint);
  }
  const subsystem = {
    lifecycleOrder: 30,
    // Read-only inspection for tests: the build status, the treatment shown,
    // its fade and dissolve levels, and the subjects found. Nothing in the page
    // reads it.
    get state() {
      if (disposed) return undefined;
      const list = Object.values(parts);
      const status = !list.length
        ? "waiting"
        : list.every((part) => part.done)
          ? list.some((part) => part.failed)
            ? "fallback"
            : "ready"
          : "building";
      return {
        status,
        shown,
        level,
        blend,
        parts: list.map(({ subject, ready, linked }) => ({ subject, ready, linked })),
      };
    },
    update({ deltaSeconds = 0, reducedMotion = false, motionPaused = false } = {}) {
      if (disposed) return;
      frames++;
      // Reduced motion and pauses hold the light still.
      if (!reducedMotion && !motionPaused) time += Math.min(0.1, Math.max(0, deltaSeconds));
      // A film or quality change that removes or replaces a
      // subject or its material disposes that subject's light and rebuilds it.
      // A tier step keeps it: the hooked programs carry both shadow states,
      // and rendering.prepareQuality() links a step's variant before it lands.
      // A subject not found yet is looked for on every frame drawn: a still
      // frame (reduced motion) draws only a few, and its tree arrives late.
      const active = Boolean(film.active && moonLight);
      for (const [subject, name] of SUBJECTS) {
        const part = parts[subject];
        if (
          active === filmWas &&
          part &&
          frames % 30 !== 0 &&
          underRoot(part.mesh) &&
          part.mesh.material === part.material
        )
          continue;
        if (active === filmWas && !part && !active) continue;
        const mesh = active ? subjectMesh(name) : null;
        if (part && mesh === part.mesh && mesh.material === part.material) continue;
        teardown(subject);
        if (mesh)
          parts[subject] = { subject, mesh, material: mesh.material, sets: [], done: false };
      }
      filmWas = active;
      pump();
      if (frames % 30 === 0) relink();
      // Nothing more to do on a shot without a treatment (the lantern shots).
      if (
        !shown &&
        (!shaftTreatment(cinematic.shot?.name) || (!parts.tower?.ready && !parts.tree?.ready))
      )
        return;
      if (frames % 30 === 1 || shared.shaftText.value.x === 2) measureText();
      root.updateWorldMatrix(true, false);
      shared.shaftShift.value.setFromMatrixPosition(root.matrixWorld);
      shaftDrift(
        time,
        config[shown.includes("-star") ? "star" : "moon"].drift,
        shared.shaftDrift.value,
      );
      // The moon's catch follows the key light as the film's lighting moves it.
      for (const [part, set] of lit) goboColor(set, part.uniforms.shaftGoboColor.value);
      if (lit.length) rays(lit[0][1]);
      if (level < 1) {
        level = Math.min(1, (performance.now() - rampFrom) / RAMP_MS);
        gains();
        invalidate();
      }
      // A dissolve into the shot shows its subject last (postprocess.js, the
      // subject layer's stagger), so its light follows the subject layer and
      // the warm window never floats in before the tower.
      const stagger = finalPass.uStagger?.value,
        progress = tour?.running ? tour.transition.progress : 1;
      const settle =
        progress < 1 && stagger ? smooth(3 * stagger.x, 3 * stagger.x + stagger.y, progress) : 1;
      if (settle !== blend) {
        blend = settle;
        gains();
        invalidate();
      }
      const want = wanted();
      if (want === shown) return;
      const part = want && parts[cinematic.current];
      // A treatment changes on a tour cut, under the dissolve's kept frame,
      // before the reveal or during the canvas's fade-in over the title card
      // (styles.css), or on a still frame when the tour is not running. Mid
      // hold, only a light arriving late in its own shot (the star, on a fast
      // reveal) fades in, and only once its programs are linked, so nothing
      // compiles on screen.
      const unseen = !tour?.running || tour.transition.cut || hidden();
      if (!unseen && (shown || !want || !part?.linked)) return;
      // Programs linked before the scene's lights changed (a quality step on
      // this cut) link again first; the previous shot's light leaves with the
      // cut, and the new one fades in mid-hold once they are linked.
      if (part && !part.installed && part.lights !== lightKey()) {
        if (unseen && shown) {
          show("");
          invalidate();
        }
        return relink();
      }
      show(want, unseen ? 1 : 0);
      invalidate();
    },
    applyQuality(profile) {
      // The march length follows the tier being applied.
      high = isHigh(profile?.tier, profile?.shadows?.enabled);
      gains();
      if (lit.length) rays(lit[0][1]);
      invalidate();
    },
    dispose() {
      if (disposed) return false;
      disposed = true;
      for (const [subject] of SUBJECTS) teardown(subject);
      box.dispose();
      maps.forEach(({ texture, backTexture }) => {
        texture.dispose();
        backTexture.dispose();
      });
      maps.clear();
      shared.shaftNoise.value?.dispose();
      return true;
    },
  };
  return subsystem;
}
