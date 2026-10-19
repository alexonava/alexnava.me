import { Matrix4, Vector2, Vector3, Vector4 } from "three";

// The film's moonlight balance over the base rig (rendering.js): a strong cool
// key over a dimmer fill, sky and ambient, so lit faces read about four times
// their shadow side.
export const FILM_LIGHT = Object.freeze({ key: 1.12, fill: 1.15, hemisphere: 0.88, ambient: 0.72 });

// A shot's `light` mood multiplies the film balance (key, fill) and the lantern.
// Legacy rim, pale and rimText keys remain accepted without changing materials.
// Active guards set the share of the
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
  rim: 1,
  pale: 0,
  rimText: 0,
  grassInside: 0,
  glintText: 0,
  stoneText: 0,
  poolAbout: 0,
});
export function shotLight(shot) {
  return { ...SHOT_LIGHT_DEFAULT, ...(shot?.light ?? {}) };
}

// Legacy shot-mood state retained for callers. Materials no longer add a
// Fresnel diffuse outline: the moon key and their PBR response light their edges.
// light: rgb strength and, in w, the share it keeps facing the moon; key: the
// moon's direction in view space, kept current per frame; textReach: how far
// past the name, the intro and Contact (a share of the screen's smaller side)
// the tree's rim eases back in where a shot takes it off the text (its mood's
// rimText, the uniform babelRimText; only the bark has the text's boxes, so
// the lookout's rim is whole).
export const RIM = Object.freeze({
  color: Object.freeze([0.19, 0.24, 0.36]),
  floor: 0.2,
  textReach: 0.2,
});
export const RIM_UNIFORMS = Object.freeze({
  babelRimLight: { value: new Vector4(0, 0, 0, RIM.floor) },
  babelKeyView: { value: new Vector3(0, 0, 1) },
  babelRimText: { value: 0 },
});
export function setRim(strength = 0, text = 0) {
  const v = RIM_UNIFORMS.babelRimLight.value;
  v.set(RIM.color[0] * strength, RIM.color[1] * strength, RIM.color[2] * strength, RIM.floor);
  RIM_UNIFORMS.babelRimText.value = text;
}

// A mutable lantern share the tree's practical multiplies (architecture.js).
export const LANTERN_MOOD = { value: 1 };

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
// lit film material takes it through flashHook() (the lookout, the tree and the
// rocks, materialFor() in architecture.js; both lanterns; the growth, litter
// and rushes, estate-ground-detail.js) and the slate through its own shader
// (mud-ground.js, at its shares of the fill and the flat light).
// - babelFlashLight: rgb the light from the flash's side (colour times
//   intensity, as a directional light of that intensity lends it), w the
//   flash's level (0: none, and the term costs one uniform test);
// - babelFlashKey: that light's world direction, toward it;
// - babelFlashSky: rgb the sky's added light on faces turned up (as the
//   hemisphere lends it), w the flat ambient's;
// - babelFlashRim and babelFlashView: legacy shared state, no longer read by
//   the physical material's flash shader;
// - babelFlashProj: the camera's projection, babelFlashReach: how far the
//   flash eases back in past the name and intro [x] and Contact [y] (a share of
//   the screen's smaller side), and babelFlashText, babelFlashAbout,
//   babelFlashAspect: the ground's text boxes and the canvas's aspect
//   (lendFlashText()); behind them a material keeps none of the flash.
export const FLASH_UNIFORMS = {
  babelFlashLight: { value: new Vector4(0, 0, 0, 0) },
  babelFlashKey: { value: new Vector3(0, 1, 0) },
  babelFlashSky: { value: new Vector4(0, 0, 0, 0) },
  babelFlashRim: { value: new Vector4(0, 0, 0, RIM.floor) },
  babelFlashView: { value: new Vector3(0, 0, 1) },
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
const FLASH_PARS = `uniform vec4 babelFlashLight, babelFlashSky, babelFlashRim, babelFlashText, babelFlashAbout;
uniform vec3 babelFlashKey, babelFlashView;
uniform vec2 babelFlashReach;
uniform float babelFlashAspect;
uniform mat4 babelFlashProj;
float babelFlashBox(vec4 r, vec2 v, float d){vec2 f=max(max(r.xy-v,v-r.zw),0.)*vec2(babelFlashAspect,1.)/min(babelFlashAspect,1.);return 1.-smoothstep(0.,d,length(f));}
float babelFlashKeep(vec3 viewPosition){vec4 c=babelFlashProj*vec4(viewPosition,1.);vec2 v=c.xy/c.w*.5+.5;
float b=max(babelFlashBox(babelFlashText,v,babelFlashReach.x),babelFlashBox(babelFlashAbout,v,babelFlashReach.y));return (1.-b)*(1.-b);}`;
// The flash's light after the lights, before the ambient occlusion and the
// sum: `sky` scales its sky and flat light (a material's own share of them).
// No view-dependent diffuse rim is added to physical materials.
const flashTerm = (sky) => `if (babelFlashLight.w > 0.0) {
  float babelFK = babelFlashKeep(-vViewPosition);
  vec3 babelFL = (viewMatrix*vec4(babelFlashKey, 0.0)).xyz, babelFU = (viewMatrix*vec4(0.0, 1.0, 0.0, 0.0)).xyz;
  reflectedLight.directDiffuse += babelFK*(babelFlashLight.rgb*saturate(dot(normal, babelFL))+(babelFlashSky.rgb*(.5+.5*dot(normal, babelFU))+babelFlashSky.w)*(${sky}))*material.diffuseColor;
}`;
// A lit film material (standard, Lambert) takes the flash: the shared uniforms,
// the text test and the term after its lights, composed with its own
// onBeforeCompile and cache key. `sky` is a GLSL expression for its share of
// the sky's and the flat light. The former `rim` option is harmlessly ignored.
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

// Legacy shot-mood exports retained for callers; physical bark keeps one
// albedo across shots instead of consuming PALE_MOOD in its material shader.
export const PALE = Object.freeze({
  luma: Object.freeze([0.04, 0.22]),
  tint: Object.freeze([0.88, 0.96, 1.12]),
});
export const PALE_MOOD = { value: 0 };

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
