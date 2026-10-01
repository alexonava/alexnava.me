import {
  AdditiveBlending,
  CustomBlending,
  Group,
  NormalBlending,
  OneFactor,
  OneMinusSrcAlphaFactor,
  SrcAlphaFactor,
  ZeroFactor,
} from "three";
import { celestialTier } from "./solar-body.js";

export function createSceneAtmosphere({ onInvalidate, parent, profile }) {
  const root = new Group();
  parent.add(root);

  let skyMaterial = null;
  let cloudsEnabled = true;
  let disposed = false;
  let skyTier = celestialTier(profile);
  let film = false;

  function applySkyQuality() {
    const layers = skyMaterial?.uniforms.uNebulaLayers;
    if (layers) layers.value = film && skyTier !== "low" ? (skyTier === "balanced" ? 2 : 3) : 0;
  }

  // In film the stars and sun blend their colour as before but keep the alpha
  // the opaque sky wrote, its depth layer (depth-layers.js), so they dissolve
  // with the sky. film-scene.js makes the sky opaque first, so it is skipped.
  const overlayBlending = new Map();
  function applyOverlayBlending() {
    if (!film) {
      overlayBlending.forEach((original, material) => Object.assign(material, original));
      overlayBlending.clear();
      return;
    }
    root.traverse((object) => {
      for (const material of [object.material].flat()) {
        if (!material?.transparent || overlayBlending.has(material)) continue;
        const { blending, blendSrc, blendDst, blendSrcAlpha, blendDstAlpha } = material;
        if (blending !== NormalBlending && blending !== AdditiveBlending) continue;
        const original = { blending, blendSrc, blendDst, blendSrcAlpha, blendDstAlpha };
        overlayBlending.set(material, original);
        Object.assign(material, {
          blending: CustomBlending,
          blendSrc: SrcAlphaFactor,
          blendDst: blending === AdditiveBlending ? OneFactor : OneMinusSrcAlphaFactor,
          blendSrcAlpha: ZeroFactor,
          blendDstAlpha: OneFactor,
        });
      }
    });
  }

  return {
    lifecycleOrder: 30,
    root,
    applyQuality(nextProfile = {}) {
      if (disposed) return false;
      skyTier = celestialTier(nextProfile);
      applySkyQuality();
      return true;
    },
    dispose() {
      if (disposed) return false;
      disposed = true;
      root.visible = false;
      if (skyMaterial?.uniforms.uNebulaLayers) skyMaterial.uniforms.uNebulaLayers.value = 0;
      skyMaterial = null;
      return true;
    },
    setSkyMaterial(material) {
      if (disposed) return false;
      if (skyMaterial !== material && skyMaterial?.uniforms.uNebulaLayers) {
        skyMaterial.uniforms.uNebulaLayers.value = 0;
      }
      skyMaterial = material;
      if (skyMaterial?.uniforms.uClouds) skyMaterial.uniforms.uClouds.value = cloudsEnabled ? 1 : 0;
      applySkyQuality();
      return true;
    },
    setClouds(on) {
      if (disposed) return false;
      cloudsEnabled = Boolean(on);
      if (skyMaterial?.uniforms.uClouds) skyMaterial.uniforms.uClouds.value = cloudsEnabled ? 1 : 0;
      onInvalidate?.();
      return cloudsEnabled;
    },
    setFilmTreatment(active) {
      if (disposed) return false;
      film = Boolean(active);
      applySkyQuality();
      applyOverlayBlending();
      return true;
    },
    toggleClouds() {
      return this.setClouds(!cloudsEnabled);
    },
    update({ elapsedSeconds = 0, reducedMotion = false } = {}) {
      if (disposed) return false;
      if (!reducedMotion && skyMaterial?.uniforms.uTime)
        skyMaterial.uniforms.uTime.value = elapsedSeconds;
      return true;
    },
  };
}
