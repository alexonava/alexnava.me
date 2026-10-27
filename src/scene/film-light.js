import { Matrix4, Vector2, Vector3, Vector4 } from "three";

// The film's moonlight over the base rig (rendering.js): the moon, a cool white
// in the camera's balance (moon), is the key, many times the night sky's
// light, so its shadows fall deep; the fill (the sky opposite the moon), the
// hemisphere and the ambient are what the sky leaves in them. A candle in the
// lantern (candle: its colour, architecture.js) is the one warm light.
export const FILM_LIGHT = Object.freeze({
  key: 4.1,
  fill: 0.42,
  hemisphere: 0.8,
  ambient: 0.24,
  // Golden hour (2026-10-27): the key is the low sun's warm light (0.62, 0.74, 1 at night),
  // the sky's light a dusk blue over the brown ground's bounce, the air a warm dusk haze.
  moon: Object.freeze([1, 0.76, 0.48]),
  sky: Object.freeze([0.42, 0.48, 0.72]),
  ground: Object.freeze([0.42, 0.3, 0.2]),
  haze: Object.freeze([0.4, 0.34, 0.36]),
  // The ranges keep the night's brightness of key (2.4 of the moon's, 2.2 of this warmer light) and sky light (0.55) in the low sun's
  // colour, so their haze still orders them by distance below the sky (hill-silhouette.js).
  rangeKey: 2.2,
  rangeSky: 0.55,
  candle: Object.freeze([1, 0.58, 0.24]),
});

// The film's tone curve (the owner's 2026-10-19 "the sky is the only artistic
// element. everything else is photoreal"): the lit layers' scene-linear light,
// exposed, white-balanced as a camera balanced warmer than the moon sees it
// (`balance`), as dim as night vision's colour (`saturation`), rolls through a
// toe and a shoulder (x^p/(x^p+k): contrast p, mid k) and is encoded for the
// display (sRGB), on its luminance so warm and cool light keep their hue (only
// near white do its channels roll off on their own, as film's do); the painted
// sky and the star stay as shown (postprocess.js grading). The exposure keeps a
// display level of `anchor` where it was, the brightest lit ground and subjects
// behind the text, so the text's guards hold. The owner's pick of 2026-10-19:
// "Deep" (of Open p 1.15, Film p 1.3 and Deep p 1.5), night photography's
// deep shade under bright moonlit faces.
export const FILM_TONE = Object.freeze({
  contrast: 1.5,
  mid: 0.35,
  anchor: 0.3,
  balance: Object.freeze([0.96, 0.99, 1.04]),
  saturation: 0.85,
});
// The exposure that shows a display level of FILM_TONE.anchor unchanged.
export function filmExposure({ contrast, mid, anchor } = FILM_TONE) {
  const y = ((anchor + 0.055) / 1.055) ** 2.4;
  return ((mid * y) / (1 - y)) ** (1 / contrast) / anchor;
}
// The grading pass's uTone: exposure, contrast, mid, and 1 (the curve on).
export const FILM_TONE_UNIFORM = {
  value: new Vector4(filmExposure(), FILM_TONE.contrast, FILM_TONE.mid, 1),
};
const toneVec = (v) => `vec3(${v.map((c) => c.toFixed(4)).join(",")})`;
export const FILM_TONE_GLSL = `uniform vec4 uTone;
vec3 filmTone(vec3 x){x=max(x*uTone.x*${toneVec(FILM_TONE.balance)},0.);float l=max(dot(x,vec3(.2126,.7152,.0722)),1e-6),t=pow(l,uTone.y);x=mix(vec3(l),x,${FILM_TONE.saturation.toFixed(4)});t/=t+uTone.z;vec3 h=x*(t/l),q=pow(x,vec3(uTone.y));q/=q+uTone.z;return sRGBTransferOETF(vec4(mix(h,q,smoothstep(.6,1.,max(h.r,max(h.g,h.b)))),1.)).rgb;}`;
// Its inverse, channel by channel, for colours given as shown that light the lit
// layers (the night sky as their environment, night-environment.js): the scene
// light the curve shows as them.
export const FILM_UNTONE_GLSL = `vec3 filmUntone(vec3 d){vec3 y=min(mix(pow((max(d,0.)+.055)/1.055,vec3(2.4)),d/12.92,step(d,vec3(.04045))),.995),x=pow(${FILM_TONE.mid.toFixed(4)}*y/(1.-y),vec3(${(1 / FILM_TONE.contrast).toFixed(4)}));return max(mix(vec3(dot(x,vec3(.2126,.7152,.0722))),x,${(1 / FILM_TONE.saturation).toFixed(4)}),0.)/${toneVec(FILM_TONE.balance)}/${filmExposure().toFixed(4)};}`;

// A shot's `light` mood multiplies the film balance (key, fill) and the lantern.
// Its guards set the share of the
// grass's colour read inside its blades (grassInside), the share of the bark's
// glints kept off the name and intro (glintText), the share of the stones'
// lamplight that passes its knee behind the name and intro (stoneText,
// STONE_TEXT) and the share of the lantern's pool on the ground that passes
// its knee behind Contact (poolAbout, mud-ground.js SLATE_LIGHT.poolKnee), all 0
// by default; it follows the shot on screen, so it changes on a cut.
export const SHOT_LIGHT_DEFAULT = Object.freeze({
  key: 1,
  fill: 1,
  lantern: 1,
  grassInside: 0,
  glintText: 0,
  stoneText: 0,
  poolAbout: 0,
  coastStudy: 0,
});
export function shotLight(shot) {
  return { ...SHOT_LIGHT_DEFAULT, ...(shot?.light ?? {}) };
}

// A shot's `look` over the film's grade and sky light, set on the cut (index.js):
// `tone` [exposure (times filmExposure()), contrast, mid] for the grading pass's uTone,
// and `ambient` and `hemisphere`, shares of the film's flat and sky light (rendering.js
// setShotLight()). The default is the night of the owner's Artistic set (2026-10-27, v3):
// brighter and harder than the film's own curve, toward the Graphics concepts' deeper blacks.
// Without a shot (the walk, the orbit) the grade is the film's own.
export const SHOT_LOOK_DEFAULT = Object.freeze({
  tone: Object.freeze([1.3, 1.85, 0.3]),
  ambient: 0.35,
  hemisphere: 0.45,
});
const FILM_TONE_BASE = Object.freeze([filmExposure(), FILM_TONE.contrast, FILM_TONE.mid]);
export function shotLook(shot) {
  if (!shot) return null;
  return { ...SHOT_LOOK_DEFAULT, ...(shot.look ?? {}) };
}
// Sets the grading pass's uTone for a look (null: the film's own curve).
export function applyShotTone(look) {
  const tone = look?.tone,
    value = FILM_TONE_UNIFORM.value;
  if (tone) value.set(FILM_TONE_BASE[0] * tone[0], tone[1], tone[2], value.w);
  else value.set(...FILM_TONE_BASE, value.w);
}

// A shot's own sun (directed-shots.js `sun`): the key turns to come from it and warms
// to its colour on the cut (rendering.js setShotSun()), and the materials that tell the
// key from their other lights read its world direction, toward it, here (mud-ground.js).
// Without a sun it is the moon's (index.js directionalPosition, restated by MOON_LIGHTS).
export const SUN_KEY = Object.freeze({ color: Object.freeze([1, 0.76, 0.48]) });
export const SHOT_KEY = { babelKeyDir: { value: new Vector3(32, 28, 14).normalize() } };

// A mutable lantern share the tree's practical multiplies (architecture.js).
export const LANTERN_MOOD = { value: 1 };
// Only the fault's three studies refine the shore response. The protected
// lantern opening, other tree views and walk keep the established path at zero.
export const COAST_MOOD = { value: 0 };

// A lightning flash on the film ground's sky light and water (lightning.js),
// read by the slate (mud-ground.js) and its puddle mirror (terrain-build.js).
// babelFlash: x the flash's share added to the night sky's light on the
// ground, y to the water's mirror, both easing off behind the name, the intro
// and Contact (the slate's text test); 0 outside a flash, so the ground is then
// exactly as without it.
export const FLASH_GROUND = Object.freeze({
  babelFlash: { value: new Vector4(0, 0, 0, 0) },
});

// A lightning flash's light on every film material (lightning.js writes it):
// an additive term after the lights, never a change to the lights themselves,
// so it eases off behind the text like the rest of the film's guards. Every
// lit film material takes it through flashHook() (the tree and the rocks,
// materialFor() in architecture.js; both lanterns; the growth, litter
// and rushes, estate-ground-detail.js) and the slate through its own shader
// (mud-ground.js, at its shares of the fill and the flat light).
// - babelFlashLight: rgb the light from the flash's side (colour times
//   intensity, as a directional light of that intensity lends it), w the
//   flash's level (0: none, and the term costs one uniform test);
// - babelFlashKey: that light's world direction, toward it;
// - babelFlashSky: rgb the sky's added light on faces turned up (as the
//   hemisphere lends it), w the flat ambient's;
// - babelFlashProj: the camera's projection, babelFlashReach: how far the
//   flash eases back in past the name and intro [x] and Contact [y] (a share of
//   the screen's smaller side), and babelFlashText, babelFlashAbout,
//   babelFlashAspect: the ground's text boxes and the canvas's aspect
//   (lendFlashText()); behind them a material keeps none of the flash.
export const FLASH_UNIFORMS = {
  babelFlashLight: { value: new Vector4(0, 0, 0, 0) },
  babelFlashKey: { value: new Vector3(0, 1, 0) },
  babelFlashSky: { value: new Vector4(0, 0, 0, 0) },
  babelFlashProj: { value: new Matrix4() },
  babelFlashReach: { value: new Vector2(0.25, 0.15) },
  babelFlashText: { value: { x: 2, y: 2, z: -1, w: -1 } },
  babelFlashAbout: { value: { x: 2, y: 2, z: -1, w: -1 } },
  babelFlashAspect: { value: 1 },
};
// The ground's text boxes (mud-ground.js createSlateContacts()) guard the flash.
export function lendFlashText(contacts) {
  if (!contacts) return;
  FLASH_UNIFORMS.babelFlashText = contacts.slateText;
  FLASH_UNIFORMS.babelFlashAbout = contacts.slateAbout;
  FLASH_UNIFORMS.babelFlashAspect = contacts.slateAspect;
}
const FLASH_PARS = `uniform vec4 babelFlashLight, babelFlashSky, babelFlashText, babelFlashAbout;
uniform vec3 babelFlashKey;
uniform vec2 babelFlashReach;
uniform float babelFlashAspect;
uniform mat4 babelFlashProj;
float babelFlashBox(vec4 r, vec2 v, float d){vec2 f=max(max(r.xy-v,v-r.zw),0.)*vec2(babelFlashAspect,1.)/min(babelFlashAspect,1.);return 1.-smoothstep(0.,d,length(f));}
float babelFlashKeep(vec3 viewPosition){vec4 c=babelFlashProj*vec4(viewPosition,1.);vec2 v=c.xy/c.w*.5+.5;
float b=max(babelFlashBox(babelFlashText,v,babelFlashReach.x),babelFlashBox(babelFlashAbout,v,babelFlashReach.y));return (1.-b)*(1.-b);}`;
// The flash's light after the lights, before the ambient occlusion and the
// sum: `sky` scales its sky and flat light (a material's own share of them).
const flashTerm = (sky) => `if (babelFlashLight.w > 0.0) {
  float babelFK = babelFlashKeep(-vViewPosition);
  vec3 babelFL = (viewMatrix*vec4(babelFlashKey, 0.0)).xyz, babelFU = (viewMatrix*vec4(0.0, 1.0, 0.0, 0.0)).xyz;
  reflectedLight.directDiffuse += babelFK*(babelFlashLight.rgb*saturate(dot(normal, babelFL))+(babelFlashSky.rgb*(.5+.5*dot(normal, babelFU))+babelFlashSky.w)*(${sky}))*material.diffuseColor;
}`;
// A lit film material (standard, Lambert) takes the flash: the shared uniforms,
// the text test and the term after its lights, composed with its own
// onBeforeCompile and cache key. `sky` is a GLSL expression for its share of
// the sky's and the flat light.
export function flashHook(material, { sky = "1.0" } = {}) {
  if (material.userData.flash) return material;
  material.userData.flash = true;
  const before = material.onBeforeCompile,
    key = material.customProgramCacheKey;
  material.onBeforeCompile = function (shader, renderer) {
    before?.call(this, shader, renderer);
    Object.assign(shader.uniforms, FLASH_UNIFORMS);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
${FLASH_PARS}`,
      )
      .replace(
        "#include <aomap_fragment>",
        `${flashTerm(sky)}
#include <aomap_fragment>`,
      );
  };
  material.customProgramCacheKey = function () {
    return `${key?.call(this) ?? ""}|flash`;
  };
  return material;
}

// The bark's glints behind the name and intro under a shot's `glintText`
// (architecture.js BARK_TEXT_GLINT): all its direct highlights there (the
// moon's and the lantern's, brightest on the wet roots) pass the ground's
// luminance knee (mud-ground.js slateTextKnee()) by that share, easing out over
// `reach` of the screen's smaller side. Off (0) unless a shot asks for it.
export const GLINT = Object.freeze({ reach: 0.2 });
export const GLINT_MOOD = { value: 0 };

// The stones' lamplight behind the name and intro under a shot's `stoneText`
// (architecture.js ROCK_TEXT_LIGHTS): the point lights' direct light on the
// scattered rocks and the stream's stones (the lantern's, and the crown's
// fill), diffuse and highlight together, passes a luminance knee (`knee`, on
// that light's linear luminance) by that share, easing out over `reach` of the
// screen's smaller side. Off (0) unless a shot asks for it.
export const STONE_TEXT = Object.freeze({ knee: 2, reach: 0.2 });
export const STONE_MOOD = { value: 0 };

// The grass's colour inside its blades under a shot's `grassInside`
// (estate-ground-detail.js grassMaterial). High's film is multisampled, and a
// blade thinner than a pixel can cover a sample but not the pixel's centre,
// where its colour is read past the blade's own edges and overshoots toward a
// pale yellow or grey; the lantern or the moon lights those specks into
// one-pixel sparkles. By that share the colour is read where the blade covers
// the pixel (centroid).
// Off (0) unless a shot asks for it.
export const GRASS_MOOD = { value: 0 };
