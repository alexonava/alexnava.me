import { Vector3, Vector4 } from "three";

// The film's moonlight balance over the base rig (rendering.js): a strong cool
// key over a dimmer fill, sky and ambient, so lit faces read about four times
// their shadow side.
export const FILM_LIGHT = Object.freeze({ key: 1.12, fill: 1.15, hemisphere: 0.88, ambient: 0.72 });

// A shot's `light` mood multiplies the film balance (key, fill), the lantern and
// the rim; it follows the shot on screen, so it changes on a cut.
export const SHOT_LIGHT_DEFAULT = Object.freeze({ key: 1, fill: 1, lantern: 1, rim: 1 });
export function shotLight(shot) {
  return { ...SHOT_LIGHT_DEFAULT, ...(shot?.light ?? {}) };
}

// The moon rim on the lookout and the tree (architecture.js): a cool Fresnel
// edge, strongest where the moon is behind the subject from the lens.
// light: rgb strength and, in w, the share it keeps facing the moon; key: the
// moon's direction in view space, kept current per frame.
export const RIM = Object.freeze({ color: Object.freeze([0.19, 0.24, 0.36]), floor: 0.2 });
export const RIM_UNIFORMS = Object.freeze({
  babelRimLight: { value: new Vector4(0, 0, 0, RIM.floor) },
  babelKeyView: { value: new Vector3(0, 0, 1) },
});
export function setRim(strength = 0) {
  const v = RIM_UNIFORMS.babelRimLight.value;
  v.set(RIM.color[0] * strength, RIM.color[1] * strength, RIM.color[2] * strength, RIM.floor);
}

// A mutable lantern share the tree's practical multiplies (architecture.js).
export const LANTERN_MOOD = { value: 1 };
