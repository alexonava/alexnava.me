import { Matrix4, Vector2, Vector3, Vector4 } from "three";

// The film's moonlight balance over the base rig (rendering.js): a strong cool
// key over a dimmer fill, sky and ambient, so lit faces read about four times
// their shadow side.
export const FILM_LIGHT = Object.freeze({ key: 1.12, fill: 1.15, hemisphere: 0.88, ambient: 0.72 });

// A shot's `light` mood multiplies the film balance (key, fill), the lantern and
// the rim, sets how much of the tree's pale wood reads moonlit grey (pale),
// the share of the tree's rim kept off the text (rimText), the share of the
// grass's colour read inside its blades (grassInside) and the share of the
// bark's glints kept off the name and intro (glintText), all 0 by default; it
// follows the shot on screen, so it changes on a cut.
export const SHOT_LIGHT_DEFAULT = Object.freeze({
  key: 1,
  fill: 1,
  lantern: 1,
  rim: 1,
  pale: 0,
  rimText: 0,
  grassInside: 0,
  glintText: 0,
});
export function shotLight(shot) {
  return { ...SHOT_LIGHT_DEFAULT, ...(shot?.light ?? {}) };
}

// The moon rim on the lookout and the tree (architecture.js): a cool Fresnel
// edge, strongest where the moon is behind the subject from the lens.
// light: rgb strength and, in w, the share it keeps facing the moon; key: the
// moon's direction in view space, kept current per frame; textReach: how far
// past the name, the intro and About (a share of the screen's smaller side)
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
// and About (the slate's text test); 0 outside a flash, so the ground is then
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
// - babelFlashRim: rgb the cold rim on the lookout and the tree (a Fresnel
//   edge, as the moon's RIM), strongest with the flash behind them, w the share
//   it keeps facing it; babelFlashView: the flash's direction in view space;
// - babelFlashProj: the camera's projection, babelFlashReach: how far the
//   flash eases back in past the name and intro [x] and About [y] (a share of
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
// sum: `sky` scales its sky and flat light (a material's own share of them),
// `rim` adds the cold rim.
const flashTerm = (rim, sky) => `if (babelFlashLight.w > 0.0) {
  float babelFK = babelFlashKeep(-vViewPosition);
  vec3 babelFL = (viewMatrix*vec4(babelFlashKey, 0.0)).xyz, babelFU = (viewMatrix*vec4(0.0, 1.0, 0.0, 0.0)).xyz;
  reflectedLight.directDiffuse += babelFK*(babelFlashLight.rgb*saturate(dot(normal, babelFL))+(babelFlashSky.rgb*(.5+.5*dot(normal, babelFU))+babelFlashSky.w)*(${sky}))*material.diffuseColor;${
    rim
      ? `
  reflectedLight.directDiffuse += babelFK*babelFlashRim.rgb*pow(1.0-saturate(dot(geometryNormal, geometryViewDir)), 4.0)*mix(babelFlashRim.w, 1.0, saturate(dot(-geometryViewDir, babelFlashView)));`
      : ""
  }
}`;
// A lit film material (standard, Lambert) takes the flash: the shared uniforms,
// the text test and the term after its lights, composed with its own
// onBeforeCompile and cache key. `sky` is a GLSL expression for its share of
// the sky's and the flat light; `rim` adds the cold rim (the lookout, the tree).
export function flashHook(material, { rim = false, sky = "1.0" } = {}) {
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
        `${flashTerm(rim, sky)}
#include <aomap_fragment>`,
      );
  };
  material.customProgramCacheKey = function () {
    return `${key?.call(this) ?? ""}|flash${rim ? "-rim" : ""}`;
  };
  return material;
}

// The tree's pale, bleached wood under a shot's `pale` (architecture.js): up to
// that share of its colour turns cool moonlit grey (tint), easing in over
// `luma` (the map's linear luma), so the bare limbs read silver under the moon
// rather than pink-beige; the darker bark keeps its colour. Off (0) unless a
// shot asks for it.
export const PALE = Object.freeze({
  luma: Object.freeze([0.1, 0.35]),
  tint: Object.freeze([0.92, 0.98, 1.08]),
});
export const PALE_MOOD = { value: 0 };

// The bark's glints behind the name and intro under a shot's `glintText`
// (architecture.js BARK_TEXT_GLINT): all its direct highlights there (the
// moon's and the lantern's, brightest on the wet roots) pass the ground's
// luminance knee (mud-ground.js slateTextKnee()) by that share, easing out over
// `reach` of the screen's smaller side. Off (0) unless a shot asks for it.
export const GLINT = Object.freeze({ reach: 0.2 });
export const GLINT_MOOD = { value: 0 };

// The grass's colour inside its blades under a shot's `grassInside`
// (estate-ground-detail.js grassMaterial). High's film is multisampled, and a
// blade thinner than a pixel can cover a sample but not the pixel's centre,
// where its colour is read past the blade's own edges and overshoots toward a
// pale yellow; the lantern lights those specks into one-pixel sparkles. By
// that share the colour is read where the blade covers the pixel (centroid).
// Off (0) unless a shot asks for it.
export const GRASS_MOOD = { value: 0 };
