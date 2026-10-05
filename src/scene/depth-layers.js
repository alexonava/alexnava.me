// Film depth layers for the tour's staggered dissolve (postprocess.js): evenly
// spaced codes in the scene target's alpha, so the final pass decodes layer =
// 3 * code. Unstamped opaque surfaces keep 1: the subject.
export const DEPTH_LAYER = Object.freeze({ sky: "0.0", mountains: "0.3333", ground: "0.6667" });

// The star's mask over the sky: each of its parts adds STAR_LAYER times its
// own coverage to the code (constant-alpha blending), so the star and its glow
// read 0.02-0.2, still sky to the dissolve, and the grade leaves them out of
// the cloud banks' cel step (postprocess.js).
export const STAR_LAYER = 0.05;
// Its parts' blending: their colour as before (additive, or over, for the
// disc), their alpha adding the mask. three constants: CustomBlending 5,
// OneFactor 201, SrcAlphaFactor 204, OneMinusSrcAlphaFactor 205,
// ConstantAlphaFactor 213.
export function starBlending(over = false) {
  return {
    blending: 5,
    blendSrc: 204,
    blendDst: over ? 205 : 201,
    blendSrcAlpha: 213,
    blendDstAlpha: 201,
    blendAlpha: STAR_LAYER,
  };
}

// Composes with a material's existing onBeforeCompile and program cache key.
export function stampDepthLayer(material, layer) {
  const before = material.onBeforeCompile,
    key = material.customProgramCacheKey;
  material.onBeforeCompile = function (shader, renderer) {
    before?.call(this, shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <dithering_fragment>",
      `#include <dithering_fragment>\ngl_FragColor.a = ${layer};`,
    );
  };
  material.customProgramCacheKey = function () {
    return `${key?.call(this) ?? ""}|depth-layer-${layer}`;
  };
  return material;
}
