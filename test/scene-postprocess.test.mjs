import assert from "node:assert/strict";
import test from "node:test";
import {
  AdditiveBlending,
  CustomBlending,
  OneFactor,
  PerspectiveCamera,
  SrcAlphaFactor,
  UnsignedByteType,
  Vector3,
  ZeroFactor,
} from "three";
import { DEPTH_LAYER, STAR_LAYER } from "../src/scene/depth-layers.js";
import {
  createPostprocessPipeline,
  LAYER_STAGGER,
  LENS_FX,
  lensSource,
} from "../src/scene/postprocess.js";
import { compactShaderSource } from "../tools/shader-compact.mjs";

function createRendererMock() {
  return {
    autoClearColor: true,
    autoClearDepth: true,
    autoClearStencil: true,
    clear() {},
    getPixelRatio() {
      return 1;
    },
    getRenderTarget() {
      return null;
    },
    getSize(target) {
      target.width = 800;
      target.height = 600;
      return target;
    },
    setRenderTarget() {},
  };
}

function createMatchMedia(matches = false) {
  let changeHandler = null;
  const query = {
    matches,
    addEventListener(type, handler) {
      if (type === "change") changeHandler = handler;
    },
    removeEventListener(type, handler) {
      if (type === "change" && changeHandler === handler) changeHandler = null;
    },
  };
  const matchMedia = () => query;
  matchMedia.dispatch = (nextMatches) => {
    query.matches = nextMatches;
    changeHandler?.({ matches: nextMatches });
  };
  return matchMedia;
}

function createPipeline(
  profile,
  {
    reducedTransparency = false,
    matchMedia = createMatchMedia(reducedTransparency),
    onInvalidate,
  } = {},
) {
  return createPostprocessPipeline(createRendererMock(), {}, {}, profile, {
    matchMedia,
    onInvalidate,
  });
}

test("postprocess pipeline creates render, bloom, grading, and vignette-grain passes", () => {
  const pipeline = createPipeline({
    postprocessGrading: true,
    postprocessBloom: true,
    postprocessVignette: true,
    postprocessGrain: true,
  });

  assert.equal(pipeline.composer.passes.length, 4);
  assert.equal(pipeline.composer.passes[0], pipeline.passes.render);
  assert.equal(pipeline.composer.passes[1], pipeline.passes.bloom);
  assert.equal(pipeline.composer.passes[2], pipeline.passes.grading);
  assert.equal(pipeline.composer.passes[3], pipeline.passes.vignetteGrain);
  assert.equal(pipeline.passes.bloom.strength, 0.18);
  assert.equal(pipeline.passes.bloom.radius, 0.45);
  assert.equal(pipeline.passes.bloom.threshold, 0.9);
  assert.equal(pipeline.passes.grading.uniforms.uHighlightWarmMix.value, 0.14);
  assert.equal(pipeline.passes.grading.uniforms.uShadowCoolMix.value, 0.25);
  assert.equal(pipeline.passes.grading.uniforms.uContrast.value, 1.06);
  assert.equal(pipeline.passes.grading.uniforms.uCelMix.value, 0.24);
  assert.deepEqual(pipeline.passes.grading.uniforms.uTexelSize.value.toArray(), [1 / 800, 1 / 600]);
  assert.equal(pipeline.passes.vignetteGrain.uniforms.uVignetteStrength.value, 0.08);
  assert.equal(pipeline.passes.vignetteGrain.uniforms.uGrainStrength.value, 0.022);

  pipeline.dispose();
});

test("high tier enables bloom, grading, vignette, and grain", () => {
  const pipeline = createPipeline({
    postprocessGrading: true,
    postprocessBloom: true,
    postprocessVignette: true,
    postprocessGrain: true,
  });

  assert.equal(pipeline.passes.bloom.enabled, true);
  assert.equal(pipeline.passes.grading.enabled, true);
  assert.equal(pipeline.passes.vignetteGrain.enabled, true);
  assert.equal(pipeline.passes.vignetteGrain.uniforms.uVignetteEnabled.value, 1);
  assert.equal(pipeline.passes.vignetteGrain.uniforms.uGrainEnabled.value, 1);

  pipeline.dispose();
});

test("balanced tier disables bloom while keeping grading, vignette, and grain", () => {
  const pipeline = createPipeline({
    postprocessGrading: true,
    postprocessBloom: false,
    postprocessVignette: true,
    postprocessGrain: true,
  });

  assert.equal(pipeline.passes.bloom.enabled, false);
  assert.equal(pipeline.passes.grading.enabled, true);
  assert.equal(pipeline.passes.vignetteGrain.enabled, true);
  assert.equal(pipeline.passes.vignetteGrain.uniforms.uVignetteEnabled.value, 1);
  assert.equal(pipeline.passes.vignetteGrain.uniforms.uGrainEnabled.value, 1);

  pipeline.dispose();
});

test("a grading-only profile keeps only grading enabled", () => {
  const pipeline = createPipeline({
    postprocessGrading: true,
    postprocessBloom: false,
    postprocessVignette: false,
    postprocessGrain: false,
  });

  assert.equal(pipeline.passes.bloom.enabled, false);
  assert.equal(pipeline.passes.grading.enabled, true);
  assert.equal(pipeline.passes.vignetteGrain.enabled, false);
  assert.equal(pipeline.passes.vignetteGrain.uniforms.uVignetteEnabled.value, 0);
  assert.equal(pipeline.passes.vignetteGrain.uniforms.uGrainEnabled.value, 0);

  pipeline.dispose();
});

test("reduced transparency disables vignette but leaves static grain enabled", () => {
  const pipeline = createPipeline(
    {
      postprocessGrading: true,
      postprocessBloom: false,
      postprocessVignette: true,
      postprocessGrain: true,
    },
    { reducedTransparency: true },
  );

  assert.equal(pipeline.passes.vignetteGrain.enabled, true);
  assert.equal(pipeline.passes.vignetteGrain.uniforms.uVignetteEnabled.value, 0);
  assert.equal(pipeline.passes.vignetteGrain.uniforms.uGrainEnabled.value, 1);

  pipeline.dispose();
});

test("live reduced-transparency changes invalidate a dirty-render scene", () => {
  const matchMedia = createMatchMedia(false);
  let invalidations = 0;
  const pipeline = createPipeline(
    {
      postprocessGrading: true,
      postprocessBloom: false,
      postprocessVignette: true,
      postprocessGrain: false,
    },
    {
      matchMedia,
      onInvalidate() {
        invalidations += 1;
      },
    },
  );

  matchMedia.dispatch(true);
  assert.equal(pipeline.passes.vignetteGrain.enabled, false);
  assert.equal(invalidations, 1);

  matchMedia.dispatch(false);
  assert.equal(pipeline.passes.vignetteGrain.enabled, true);
  assert.equal(invalidations, 2);
  pipeline.dispose();
});

test("setQualityProfile updates adaptive pass enablement without rebuilding the composer", () => {
  const pipeline = createPipeline({
    postprocessGrading: true,
    postprocessBloom: true,
    postprocessVignette: true,
    postprocessGrain: true,
  });

  pipeline.setQualityProfile({
    postprocessGrading: true,
    postprocessBloom: false,
    postprocessVignette: false,
    postprocessGrain: false,
    postprocessSettings: {
      bloomStrength: 0,
      celMix: 0.2,
      contrast: 1.05,
      grainStrength: 0,
      highlightWarmMix: 0.14,
      shadowCoolMix: 0.22,
      vignetteStrength: 0,
    },
  });

  assert.equal(pipeline.passes.bloom.enabled, false);
  assert.equal(pipeline.passes.grading.enabled, true);
  assert.equal(pipeline.passes.vignetteGrain.enabled, false);
  assert.equal(pipeline.passes.bloom.strength, 0);
  assert.equal(pipeline.passes.grading.uniforms.uCelMix.value, 0.2);
  assert.equal(pipeline.passes.grading.uniforms.uContrast.value, 1.05);
  assert.equal(pipeline.passes.grading.uniforms.uHighlightWarmMix.value, 0.14);
  assert.equal(pipeline.passes.grading.uniforms.uShadowCoolMix.value, 0.22);
  assert.equal(pipeline.passes.vignetteGrain.uniforms.uVignetteStrength.value, 0);
  assert.equal(pipeline.passes.vignetteGrain.uniforms.uGrainStrength.value, 0);

  pipeline.dispose();
});

test("resize updates texel sampling for the selective ink contour", () => {
  const pipeline = createPipeline({ postprocessGrading: true });
  pipeline.resize(1600, 900);
  assert.deepEqual(pipeline.passes.grading.uniforms.uTexelSize.value.toArray(), [
    1 / 1600,
    1 / 900,
  ]);
  pipeline.dispose();
});

function createWebGL2Renderer({ isWebGL2 = true, maxSamples = 8, colorBufferFloat = true } = {}) {
  return {
    ...createRendererMock(),
    capabilities: { isWebGL2, maxSamples },
    extensions: { has: (name) => colorBufferFloat && name === "EXT_color_buffer_float" },
  };
}

test("only the scene pass multisamples on the high tier, and a change rebuilds its target", () => {
  const high = { postprocessGrading: true, postprocessSamples: 4 };
  const balanced = { postprocessGrading: true, postprocessSamples: 0 };
  let ratio = 1;
  const renderer = { ...createWebGL2Renderer(), getPixelRatio: () => ratio };
  const pipeline = createPostprocessPipeline(renderer, {}, {}, high, {
    matchMedia: createMatchMedia(),
  });
  const render = pipeline.passes.render;
  const pingPong = [pipeline.composer.renderTarget1, pipeline.composer.renderTarget2];
  const pingPongState = () => pingPong.map((target) => [target.samples, target.depthBuffer]);

  const sampled = render.sampledTarget;
  assert.equal(sampled.samples, 4);
  assert.deepEqual([sampled.width, sampled.height], [800, 600]);
  assert.equal(sampled.depthBuffer, true, "the scene keeps its depth test");
  assert.deepEqual(
    pingPongState(),
    [
      [0, false],
      [0, false],
    ],
    "full-screen passes pay no resolve and need no depth",
  );
  ratio = 1.5;
  pipeline.composer.setPixelRatio(ratio);
  assert.deepEqual(
    [sampled.width, sampled.height],
    [1200, 900],
    "the target follows device pixels",
  );

  const pingPongDisposals = pingPong.map(() => 0);
  pingPong.forEach((target, index) =>
    target.addEventListener("dispose", () => (pingPongDisposals[index] += 1)),
  );
  let sampledDisposals = 0;
  sampled.addEventListener("dispose", () => (sampledDisposals += 1));
  pipeline.setQualityProfile(balanced);
  assert.equal(render.sampledTarget, null);
  assert.equal(sampledDisposals, 1);
  assert.deepEqual(
    pingPongState(),
    [
      [0, true],
      [0, true],
    ],
    "the scene draws straight into them",
  );
  assert.deepEqual(pingPongDisposals, [1, 1]);
  pipeline.setQualityProfile(balanced);
  assert.deepEqual(pingPongDisposals, [1, 1], "an unchanged count keeps the targets");
  pipeline.setQualityProfile(high);
  assert.equal(render.sampledTarget.samples, 4);
  assert.deepEqual([render.sampledTarget.width, render.sampledTarget.height], [1200, 900]);
  assert.deepEqual(pingPongState(), [
    [0, false],
    [0, false],
  ]);
  pipeline.dispose();

  for (const [limitedRenderer, expected] of [
    [createWebGL2Renderer({ isWebGL2: false, maxSamples: 0 }), 0],
    [createWebGL2Renderer({ colorBufferFloat: false }), 0],
    [createWebGL2Renderer({ maxSamples: 2 }), 2],
    [createRendererMock(), 0],
  ]) {
    const limited = createPostprocessPipeline(limitedRenderer, {}, {}, high, {
      matchMedia: createMatchMedia(),
    });
    assert.equal(limited.passes.render.sampledTarget?.samples ?? 0, expected);
    assert.equal(limited.composer.renderTarget1.samples, 0);
    assert.equal(limited.composer.renderTarget2.samples, 0);
    limited.dispose();
  }
});

test("a multisampled scene resolves once and is copied into the read buffer", () => {
  const draws = [];
  let target = null;
  const renderer = {
    ...createWebGL2Renderer(),
    autoClear: true,
    clear() {
      draws.push(["clear", target]);
    },
    setRenderTarget(next) {
      target = next;
    },
    render(object) {
      draws.push([object.isMesh ? "copy" : "scene", target]);
    },
  };
  const scene = { isScene: true };
  const pipeline = createPostprocessPipeline(
    renderer,
    scene,
    {},
    { postprocessGrading: true, postprocessSamples: 4 },
    { matchMedia: createMatchMedia() },
  );
  const render = pipeline.passes.render;
  const { readBuffer, writeBuffer } = pipeline.composer;

  render.render(renderer, writeBuffer, readBuffer);
  assert.deepEqual(draws, [
    ["clear", render.sampledTarget],
    ["scene", render.sampledTarget],
    ["copy", readBuffer],
  ]);
  assert.equal(render.copyQuad.material.uniforms.tDiffuse.value, render.sampledTarget.texture);
  assert.equal(render.needsSwap, false, "later passes read the copy from the read buffer");

  draws.length = 0;
  render.renderToScreen = true;
  render.render(renderer, writeBuffer, readBuffer);
  assert.deepEqual(
    draws,
    [
      ["clear", null],
      ["scene", null],
    ],
    "a final scene pass draws directly",
  );

  draws.length = 0;
  render.renderToScreen = false;
  pipeline.setQualityProfile({ postprocessGrading: true, postprocessSamples: 0 });
  render.render(renderer, writeBuffer, readBuffer);
  assert.deepEqual(
    draws,
    [
      ["clear", readBuffer],
      ["scene", readBuffer],
    ],
    "no samples, no copy",
  );
  pipeline.dispose();
});

test("bloom keeps its CSS-pixel resolution while the composer follows device pixels", () => {
  let ratio = 1;
  const renderer = { ...createRendererMock(), getPixelRatio: () => ratio };
  const pipeline = createPostprocessPipeline(
    renderer,
    {},
    {},
    { postprocessBloom: true },
    {
      matchMedia: createMatchMedia(),
    },
  );
  const bloom = pipeline.passes.bloom;
  assert.equal(bloom.renderTargetBright.width, 400);

  ratio = 1.5;
  pipeline.composer.setPixelRatio(ratio);
  pipeline.resize(800, 600);
  assert.equal(pipeline.composer.renderTarget1.width, 1200);
  assert.equal(pipeline.composer.renderTarget1.height, 900);
  assert.equal(bloom.renderTargetBright.width, 400, "the glow keeps its reviewed spread");
  assert.equal(bloom.renderTargetBright.height, 300);
  assert.deepEqual(
    pipeline.passes.grading.uniforms.uTexelSize.value.toArray(),
    [1 / 800, 1 / 600],
    "the ink contour samples one CSS pixel apart",
  );
  pipeline.dispose();
});

test("dispose releases pipeline resources without throwing", () => {
  const pipeline = createPipeline({
    postprocessGrading: true,
    postprocessBloom: true,
    postprocessVignette: true,
    postprocessGrain: true,
  });

  assert.doesNotThrow(() => pipeline.dispose());
});

test("film grading survives quality changes and restores the current profile without adding passes", () => {
  const profile = {
    postprocessBloom: true,
    postprocessGrading: true,
    postprocessVignette: true,
    postprocessGrain: true,
  };
  const pipeline = createPipeline(profile),
    g = pipeline.passes.grading.uniforms,
    v = pipeline.passes.vignetteGrain.uniforms;
  pipeline.setFilmTreatment(true);
  pipeline.setTextProtection(true, 0.3);
  assert.equal(pipeline.composer.passes.length, 4);
  // The owner restored the cel banding and ink contour on the default film look.
  assert.equal(g.uCelMix.value, 0.24);
  assert.equal(g.uInkMix.value, 0.14);
  // A firmer film contrast over the soft highlight shoulder.
  assert.equal(g.uContrast.value, 1.06);
  assert.equal(g.uHighlightWarmMix.value, 0.12);
  assert.equal(g.uShadowCoolMix.value, 0.16);
  assert.equal(pipeline.passes.bloom.strength, 0.2);
  assert.equal(v.uGrainStrength.value, 0.008);
  assert.equal(v.uVignetteStrength.value, 0.12);
  pipeline.setQualityProfile({ ...profile, postprocessBloom: false });
  assert.equal(pipeline.passes.bloom.enabled, false);
  assert.equal(g.uCelMix.value, 0.24);
  assert.equal(v.uTextProtection.value, 1);
  // The mountains' moonlit relief is exempt from the cel step and ink in film only.
  assert.equal(g.uLayerRelief.value, 1);
  pipeline.setFilmTreatment(false);
  assert.equal(g.uCelMix.value, 0.24);
  assert.equal(g.uInkMix.value, 0.14);
  assert.equal(g.uLayerRelief.value, 0);
  assert.equal(v.uTextProtection.value, 0);
  pipeline.dispose();
});

test("in film the grade's cel step and ink are the sky's alone; everything else shades continuously", () => {
  const pipeline = createPipeline({ postprocessGrading: true });
  const shader = pipeline.passes.grading.material.fragmentShader,
    g = pipeline.passes.grading.uniforms;
  assert.equal(g.uLayerRelief.value, 0, "outside film the grade is unchanged");
  pipeline.setFilmTreatment(true);
  assert.equal(g.uLayerRelief.value, 1);
  // The ground and the star and shafts' marks (depth-layers.js STAR_LAYER and
  // SHAFT_LAYER, 0.0005-0.28 over the sky's 0) take no band.
  assert.match(
    shader,
    /float starLayer = uLayerRelief \* smoothstep\(0\.0005, 0\.006, texel\.a\) \* \(1\.0 - smoothstep\(0\.22, 0\.28, texel\.a\)\);/,
  );
  // In film the bands are the sky's alone (the clouds are the artistic part):
  // off the sky only the deepest band stays, below graded luma .1, where it never
  // stepped (a smooth pull toward black that keeps the deep shade's tone),
  // easing over partly covered edges, whose codes blend toward the sky's 0.
  assert.match(shader, /float skyLayer = 1\.0 - smoothstep\(0\.0, 0\.3, texel\.a\);/);
  assert.match(
    shader,
    /float celWeight = mix\(1\.0, mix\(1\.0 - smoothstep\(0\.05, 0\.1, gradedLuma\), 1\.0, skyLayer\), uLayerRelief\);/,
  );
  assert.match(
    shader,
    /color = mix\(color, celColor, uCelMix \* celWeight \* \(1\.0 - groundLayer\) \* \(1\.0 - starLayer\)\);/,
  );
  // That deepest band is flat: below .1 the band rounds to 0, so no step shows.
  for (const luma of [0.02, 0.05, 0.08, 0.099]) assert.equal(Math.floor(luma * 5 + 0.5), 0);
  assert.doesNotMatch(shader, /uSubjectCel|float relief|skySide/);
  // The star's mask, STAR_LAYER from each of its four parts, stays inside the
  // exemption's plateau.
  assert.ok(4 * STAR_LAYER <= 0.22);
  // A soft highlight shoulder from 0.75 rolls off toward white before the clamp.
  assert.match(
    shader,
    /vec3 over = max\(color - 0\.75, 0\.0\);\s*color = mix\(color, min\(color, 0\.75\) \+ 0\.25 \* \(1\.0 - exp\(-over \/ 0\.25\)\), uLayerRelief\);\s*gl_FragColor = vec4\(clamp\(color, 0\.0, 1\.0\), texel\.a\);/,
  );
  // The post ink, in film, only where the pixel and its four neighbours are all
  // sky (the clouds' own edges): no outline on the subjects, mountains or ground.
  assert.equal((shader.match(/texture2D\(tDiffuse, vUv [+-] vec2\(/g) || []).length, 4);
  assert.match(
    shader,
    /float skyInk = mix\(1\.0, \(1\.0 - smoothstep\(0\.0, 0\.006, texel\.a\)\) \* \(1\.0 - step\(0\.006, nearest\)\), uLayerRelief\);/,
  );
  assert.match(shader, /inkContour \* uInkMix \* skyInk\);/);
  // With uLayerRelief 0 every film factor is 1: the grade of every other view is unchanged.
  pipeline.dispose();
});

// Records each draw as [scene or material name, render target].
function createRecordingRenderer(draws) {
  let target = null;
  return {
    ...createRendererMock(),
    autoClear: true,
    getRenderTarget: () => target,
    setRenderTarget(next) {
      target = next;
    },
    render(object) {
      draws.push([object.isMesh ? object.material.name : "scene", target]);
    },
    compile(object) {
      draws.push(["compile", object.material.name, target]);
    },
  };
}

function createRecordedPipeline(profile, camera = {}) {
  const draws = [];
  const renderer = createRecordingRenderer(draws);
  const pipeline = createPostprocessPipeline(renderer, { isScene: true }, camera, profile, {
    matchMedia: createMatchMedia(),
  });
  const frame = () => {
    draws.length = 0;
    pipeline.composer.render(0);
    return draws.slice();
  };
  const capture = () => {
    pipeline.setTransition({ capture: true, cut: false, progress: 1, zoom: 0.01 });
    return frame();
  };
  return { capture, draws, frame, pipeline };
}

// Grading alone: no bloom, vignette or grain, so the final pass draws only for
// a crossfade or the film.
const GRADING_ONLY = { postprocessGrading: true };

test("a tour capture keeps grading's output with no added draw, and the cut mixes it out", () => {
  const elements = new Array(16).fill(0);
  elements[8] = -0.2;
  elements[9] = 0.1;
  const { capture, frame, pipeline } = createRecordedPipeline(
    { postprocessGrading: true, postprocessVignette: true },
    { projectionMatrix: { elements } },
  );
  const final = pipeline.passes.vignetteGrain.uniforms;
  const { readBuffer, writeBuffer } = pipeline.composer;
  const normal = frame();
  assert.deepEqual(normal, [
    ["scene", readBuffer],
    ["BabelGradingShader", writeBuffer],
    ["BabelVignetteGrainShader", null],
  ]);

  const captured = capture();
  const kept = captured[1][1];
  assert.deepEqual(
    captured,
    [
      ["scene", readBuffer],
      ["BabelGradingShader", kept],
      ["BabelVignetteGrainShader", null],
    ],
    "grading draws straight into the kept target: the draw count is unchanged",
  );
  assert.ok(![readBuffer, writeBuffer].includes(kept));
  assert.equal(final.tDiffuse.value, kept.texture, "the final pass reads the kept frame");
  assert.equal(final.tPrev.value, kept.texture);
  assert.equal(final.uProgress.value, 1, "the capture frame shows the outgoing shot alone");
  assert.deepEqual(
    final.uCodeTexel.value.toArray(),
    [1 / kept.width, 1 / kept.height],
    "one texel of the frame",
  );
  assert.equal(kept.texture.type, UnsignedByteType);
  assert.equal(kept.depthBuffer, false);
  assert.deepEqual([kept.width, kept.height], [readBuffer.width, readBuffer.height]);
  assert.deepEqual(final.uPrevOrigin.value.toArray(), [0.6, 0.45], "the off-axis centre, in UV");
  assert.equal(pipeline.composer.readBuffer, readBuffer, "the ping-pong is untouched");
  assert.equal(pipeline.composer.writeBuffer, writeBuffer);

  pipeline.setTransition({ capture: false, cut: true, progress: 0.5, zoom: 0.01 });
  assert.deepEqual(frame(), normal, "the cut draws as an ordinary frame");
  assert.equal(final.tDiffuse.value, writeBuffer.texture);
  assert.equal(final.tPrev.value, kept.texture);
  assert.equal(final.uProgress.value, 0.5);
  assert.equal(final.uPrevScale.value, 1 / 1.005, "the kept frame keeps pushing in");
  pipeline.setTransition({ progress: 0.25, zoom: 0.01 });
  assert.equal(final.uProgress.value, 0.25, "linear: the final pass eases it");

  pipeline.setQualityProfile(GRADING_ONLY);
  assert.equal(pipeline.passes.vignetteGrain.enabled, true, "a quality step keeps the blend");
  pipeline.composer.setPixelRatio(1.5);
  pipeline.setTransition({ progress: 0.5, zoom: 0.01 });
  assert.equal(final.uProgress.value, 0.5, "so does a pixel-ratio change");
  pipeline.setTransition({ capture: false, cut: false, progress: 1, zoom: 0 });
  assert.equal(final.uProgress.value, 1);
  assert.equal(
    pipeline.passes.vignetteGrain.enabled,
    false,
    "grading alone drops the final pass again",
  );
  pipeline.dispose();
});

test("grading alone adds the final pass only for a crossfade; a capture that never drew cuts hard", () => {
  const { capture, frame, pipeline } = createRecordedPipeline(GRADING_ONLY);
  const pass = pipeline.passes.vignetteGrain;
  assert.equal(pass.enabled, false);
  assert.deepEqual(frame().at(-1), ["BabelGradingShader", null], "grading draws to the canvas");

  pipeline.setTransition({ capture: true, cut: false, progress: 1, zoom: 0.01 });
  assert.equal(pass.enabled, true, "grading draws off-screen for the capture");
  pipeline.setTransition({ capture: false, cut: true, progress: 0.1, zoom: 0.01 });
  assert.equal(pass.uniforms.uProgress.value, 1, "nothing was kept, so the cut is hard");
  assert.equal(pass.enabled, false);
  pipeline.setTransition({ progress: 0.2, zoom: 0.01 });
  assert.equal(pass.uniforms.uProgress.value, 1);

  const captured = capture();
  assert.deepEqual(
    captured.map(([name, target]) => [name, target === null]),
    [
      ["scene", false],
      ["BabelGradingShader", false],
      ["BabelVignetteGrainShader", true],
    ],
  );
  const kept = captured[1][1];
  assert.deepEqual(pass.uniforms.uPrevOrigin.value.toArray(), [0.5, 0.5], "no projection: centre");
  pipeline.setTransition({ progress: 0.25, zoom: 0.01 });
  assert.equal(pass.uniforms.uProgress.value, 0.25);
  const blending = capture();
  assert.notEqual(blending[1][1], kept, "a capture mid-blend is ignored");
  pipeline.dispose();
});

test("a CSS resize or a lost context ends a crossfade; the same size keeps it", () => {
  const { capture, pipeline } = createRecordedPipeline(GRADING_ONLY);
  const pass = pipeline.passes.vignetteGrain;
  const startBlend = () => {
    capture();
    pipeline.setTransition({ capture: false, cut: true, progress: 0.25, zoom: 0.01 });
    assert.equal(pass.uniforms.uProgress.value, 0.25);
  };

  startBlend();
  pipeline.resize(800, 600);
  assert.equal(pass.uniforms.uProgress.value, 0.25, "the same CSS size keeps the blend");
  pipeline.resize(800, 520);
  assert.equal(pass.uniforms.uProgress.value, 1, "the kept frame no longer matches the canvas");
  assert.equal(pass.enabled, false);
  pipeline.setTransition({ progress: 0.5, zoom: 0.01 });
  assert.equal(pass.uniforms.uProgress.value, 1, "an ended blend is not resumed");

  startBlend();
  pipeline.cancelTransition();
  assert.equal(pass.uniforms.uProgress.value, 1);
  assert.equal(pass.enabled, false);
  pipeline.cancelTransition();
  pipeline.dispose();
});

test("the phone text band follows each pixel's dissolve instead of switching at the cut", () => {
  const { capture, pipeline } = createRecordedPipeline(GRADING_ONLY);
  const v = pipeline.passes.vignetteGrain.uniforms;
  pipeline.setFilmTreatment(true);
  pipeline.setTextProtection(true, 0.3);
  assert.equal(v.uTextProtection.value, 1);
  capture();
  pipeline.setTransition({ capture: false, cut: true, progress: 0.25, zoom: 0.01 });
  pipeline.setTextProtection(false, 0.3);
  // The final pass mixes the kept frame's band into the live one by each pixel's weight.
  assert.equal(v.uTextProtectionFrom.value, 1);
  assert.equal(v.uTextProtection.value, 0);
  assert.equal(pipeline.passes.vignetteGrain.enabled, true);
  pipeline.setTransition({ progress: 1 });
  assert.equal(v.uProgress.value, 1);
  assert.equal(v.uTextProtection.value, 0);
  assert.equal(pipeline.passes.vignetteGrain.enabled, true, "film keeps the final pass");
  pipeline.setTextProtection(true, 0.3);
  assert.equal(v.uTextProtection.value, 1, "outside a crossfade the band switches at once");
  pipeline.setFilmTreatment(false);
  assert.equal(v.uTextProtection.value, 0);
  assert.equal(v.uTextProtectionFrom.value, 0);
  assert.equal(pipeline.passes.vignetteGrain.enabled, false);
  pipeline.dispose();
});

test("compile links the crossfade programs once for their real targets; dispose frees the frame", () => {
  const { capture, draws, pipeline } = createRecordedPipeline(GRADING_ONLY);
  const renderer = pipeline.composer.renderer;
  const previous = { isWebGLRenderTarget: true };
  renderer.setRenderTarget(previous);
  pipeline.compile();
  pipeline.compile();
  assert.deepEqual(draws, [
    ["compile", "BabelGradingShader", pipeline.composer.readBuffer],
    ["compile", "BabelVignetteGrainShader", null],
  ]);
  assert.equal(renderer.getRenderTarget(), previous, "the previous target is restored");
  renderer.setRenderTarget(null);
  // A lost context drops the programs: the next warm-up links them again.
  pipeline.invalidatePrograms();
  pipeline.compile();
  assert.equal(draws.filter(([kind]) => kind === "compile").length, 4);

  const kept = capture()[1][1];
  let disposals = 0;
  kept.addEventListener("dispose", () => (disposals += 1));
  pipeline.dispose();
  assert.equal(disposals, 1);

  const bare = createPipeline(GRADING_ONLY);
  assert.doesNotThrow(() => bare.compile(), "a renderer without compile() skips it");
  bare.dispose();
});

test("film always draws the final pass, staggered and opaque; outside film it is the plain crossfade", () => {
  const { capture, frame, pipeline } = createRecordedPipeline(GRADING_ONLY);
  const pass = pipeline.passes.vignetteGrain;
  assert.equal(pass.enabled, false);
  assert.equal(pass.uniforms.uLayered.value, 0);
  pipeline.setFilmTreatment(true);
  assert.equal(pass.enabled, true, "layer codes never reach the transparent canvas");
  assert.equal(pass.uniforms.uLayered.value, 1);
  assert.deepEqual(frame().at(-1), ["BabelVignetteGrainShader", null]);
  pipeline.setQualityProfile({ ...GRADING_ONLY });
  assert.equal(pass.enabled, true);
  capture();
  pipeline.setTransition({ capture: false, cut: true, progress: 0.5, zoom: 0.01 });
  pipeline.setTransition({ progress: 1 });
  assert.equal(pass.enabled, true, "and after a dissolve");
  pipeline.setFilmTreatment(false);
  assert.equal(pass.enabled, false, "grading alone out of film drops it again");
  assert.equal(pass.uniforms.uLayered.value, 0);
  assert.deepEqual(pass.uniforms.uStagger.value.toArray(), [
    LAYER_STAGGER.step,
    LAYER_STAGGER.window,
  ]);
  assert.ok(Object.isFrozen(LAYER_STAGGER));
  // The final pass writes opaque alpha only in film; elsewhere it passes alpha through.
  assert.match(
    pass.material.fragmentShader,
    /gl_FragColor = vec4\(clamp\(color, 0\.0, 1\.0\), uLayered > 0\.5 \? 1\.0 : texel\.a\);/,
  );
  // No grey layer-code view: the final pass has no debug uniform.
  assert.equal("showLayers" in pipeline, false);
  assert.equal(pass.uniforms.uLayerView, undefined);
  pipeline.dispose();
});

test("bloom adds light but keeps the layer codes in film", () => {
  const pipeline = createPipeline({ postprocessGrading: true, postprocessBloom: true });
  const blend = pipeline.passes.bloom.blendMaterial;
  assert.equal(blend.blending, AdditiveBlending);
  pipeline.setFilmTreatment(true);
  assert.equal(blend.blending, CustomBlending);
  assert.deepEqual(
    [blend.blendSrc, blend.blendDst, blend.blendSrcAlpha, blend.blendDstAlpha],
    [SrcAlphaFactor, OneFactor, ZeroFactor, OneFactor],
    "the same additive colour, and the target's alpha untouched",
  );
  pipeline.setQualityProfile({ postprocessGrading: true, postprocessBloom: false });
  assert.equal(blend.blending, CustomBlending);
  pipeline.setFilmTreatment(false);
  assert.equal(blend.blending, AdditiveBlending);
  pipeline.dispose();
});

// JS restatement of the final pass's per-pixel weight, checked against its source below.
const glslSmoothstep = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
function layerWeight(progress, prevCode, liveCode, layered = true) {
  if (!layered) return glslSmoothstep(0, 1, progress);
  const start = 3 * LAYER_STAGGER.step * Math.min(1, Math.max(0, Math.max(prevCode, liveCode)));
  return glslSmoothstep(start, start + LAYER_STAGGER.window, progress);
}

test("the dissolve stages sky, mountains, ground and subject over the transition, never below either frame", () => {
  const codes = [DEPTH_LAYER.sky, DEPTH_LAYER.mountains, DEPTH_LAYER.ground, "1.0"].map(Number);
  codes.forEach((code, layer) =>
    assert.ok(Math.abs(3 * code - layer) < 1e-3, "evenly spaced codes"),
  );
  assert.ok(
    Math.abs(3 * LAYER_STAGGER.step + LAYER_STAGGER.window - 1) < 1e-12,
    "the subject settles at the end",
  );
  // Halfway points at 0.2, 0.4, 0.6 and 0.8 of the dissolve (1 s in the tour).
  codes.forEach((code, layer) => {
    const start = 3 * LAYER_STAGGER.step * code;
    assert.ok(Math.abs(start + LAYER_STAGGER.window / 2 - 0.2 * (layer + 1)) < 1e-3);
    assert.ok(Math.abs(layerWeight(0.2 * (layer + 1), code, code) - 0.5) < 1e-3);
    assert.equal(layerWeight(start, code, code), 0);
    assert.equal(layerWeight(start + LAYER_STAGGER.window, code, code), 1);
  });
  for (let progress = 0; progress <= 1.0001; progress += 0.01) {
    const weights = codes.map((code) => layerWeight(progress, code, code));
    for (let i = 1; i < weights.length; i++)
      assert.ok(weights[i - 1] >= weights[i], "farther layers lead");
    for (const prev of codes)
      for (const live of codes) {
        const w = layerWeight(progress, prev, live);
        assert.ok(w >= 0 && w <= 1, "a mix of the two frames, never black");
        assert.equal(
          w,
          layerWeight(progress, Math.max(prev, live), Math.max(prev, live)),
          "the later layer wins",
        );
      }
    assert.equal(
      layerWeight(progress, 0, 1, false),
      glslSmoothstep(0, 1, progress),
      "outside film: the old crossfade",
    );
  }
  assert.equal(layerWeight(1, 1, 1), 1);
  assert.equal(layerWeight(0, 0, 0), 0);
});

test("the final pass decodes each frame's layer from a 5-tap cross and mixes by it", () => {
  const pipeline = createPipeline(GRADING_ONLY);
  const shader = pipeline.passes.vignetteGrain.material.fragmentShader;
  const start = shader.indexOf("float layerCode(");
  const layerCode = shader.slice(start, shader.indexOf("\n}\n", start) + 2);
  assert.equal((layerCode.match(/texture2D\(map, /g) || []).length, 5);
  assert.match(layerCode, /texture2D\(map, uv\)\.a/);
  for (const tap of ["uv - x", "uv + x", "uv - y", "uv + y"])
    assert.ok(layerCode.includes(`texture2D(map, ${tap}).a`), tap);
  assert.match(layerCode, /vec2 x = vec2\(uCodeTexel\.x, 0\.0\), y = vec2\(0\.0, uCodeTexel\.y\);/);
  assert.match(
    shader,
    /start = 3\.0 \* uStagger\.x \* clamp\(max\(layerCode\(tPrev, prevUv\), layerCode\(tDiffuse, vUv\)\), 0\.0, 1\.0\);\s*span = uStagger\.y;/,
  );
  // In film the kept frame dissolves through the outgoing shot's lens: its focus,
  // and its heat, fringes and kept rect (LENS_FX).
  assert.match(
    shader,
    /w = smoothstep\(start, start \+ span, uProgress\);\s*texel = mix\(uLayered > 0\.5 \? lensView\(tPrev, prevUv, prevUv, uBlurPrev, uStarPrev, uFlamePrev, uKeepPrev, guard\) : texture2D\(tPrev, prevUv\), texel, w\);\s*protection = mix\(uTextProtectionFrom, uTextProtection, w\);/,
  );
  assert.match(
    shader,
    /vec4 texel = uLayered > 0\.5 \? lensView\(tDiffuse, vUv, vUv, uBlur, uStar, uFlame, uKeep, guard\) : texture2D\(tDiffuse, vUv\);/,
  );
  assert.match(
    shader,
    /float start = 0\.0, span = 1\.0;\s*if \(uLayered > 0\.5\)/,
    "unlayered: smoothstep(0, 1, progress)",
  );
  assert.match(shader, /if \(uProgress < 1\.0\)/);
  assert.doesNotMatch(shader, /uBlend/, "no old uniform");
  // Its comments never ship: the build's GLSL compaction strips them.
  const shipped = compactShaderSource("const s = `" + shader + "`;");
  assert.doesNotMatch(shipped, /\/\//, "no comments in the shipped GLSL");
  assert.match(shipped, /vec4 lensBlur\(/);
  assert.match(shipped, /vec4 lensView\(/);
  pipeline.dispose();
});

test("the lens's heat, fringes and flare live in the final pass, in film, off the text and the kept banks", () => {
  const { capture, frame, pipeline } = createRecordedPipeline({
    tier: "high",
    postprocessGrading: true,
  });
  const final = pipeline.passes.vignetteGrain.uniforms;
  // No new pass: the scene, bloom, grading and the final pass.
  assert.equal(pipeline.composer.passes.length, 4);
  assert.ok(
    Object.isFrozen(LENS_FX) && Object.isFrozen(LENS_FX.heat) && Object.isFrozen(LENS_FX.flare),
  );
  for (const part of ["heat", "aberration", "flare"]) assert.ok("on" in LENS_FX[part], part);
  // Outside film it is off; in film each part follows its switch, and the heat's
  // octaves follow the tier.
  assert.deepEqual(final.uLens.value.toArray().slice(0, 3), [0, 0, 0]);
  pipeline.setFilmTreatment(true);
  assert.deepEqual(final.uLens.value.toArray(), [
    LENS_FX.heat.on ? 1 : 0,
    LENS_FX.aberration.on ? 1 : 0,
    LENS_FX.flare.on ? 1 : 0,
    LENS_FX.heat.octaves.high,
  ]);
  pipeline.setQualityProfile({ tier: "balanced", postprocessGrading: true });
  assert.equal(final.uLens.value.w, LENS_FX.heat.octaves.balanced);
  assert.ok(LENS_FX.heat.octaves.balanced < LENS_FX.heat.octaves.high, "phones pay less");

  // Sources: [x, y, size, on] or none; the kept rect turns from the frame's
  // top-left shares to UV with y up, and none is an empty box.
  pipeline.setLensSources({ star: [0.8, 0.7, 0.04, 1], flame: null, keep: [0, 0, 0.6875, 0.4889] });
  assert.deepEqual(final.uStar.value.toArray(), [0.8, 0.7, 0.04, 1]);
  assert.deepEqual(final.uFlame.value.toArray(), [0, 0, 0, 0]);
  const keep = final.uKeep.value.toArray();
  assert.deepEqual([keep[0], keep[2], keep[3]], [0, 0.6875, 1]);
  assert.ok(Math.abs(keep[1] - (1 - 0.4889)) < 1e-9);
  // The capture keeps the outgoing lens for the kept frame.
  capture();
  assert.deepEqual(final.uStarPrev.value.toArray(), [0.8, 0.7, 0.04, 1]);
  assert.deepEqual(final.uKeepPrev.value.toArray(), keep);
  pipeline.setLensSources({ flame: [0.6, 0.3, 0.1, 1] });
  pipeline.setTransition({ capture: false, cut: true, progress: 0.4, zoom: 0.01 });
  frame();
  assert.deepEqual(final.uStar.value.toArray(), [0, 0, 0, 0]);
  assert.deepEqual(final.uKeep.value.toArray(), [2, 2, -1, -1]);
  assert.deepEqual(final.uStarPrev.value.toArray(), [0.8, 0.7, 0.04, 1], "the dissolve keeps it");
  assert.deepEqual(final.uFlame.value.toArray(), [0.6, 0.3, 0.1, 1]);
  assert.deepEqual(final.uFlamePrev.value.toArray(), [0, 0, 0, 0]);

  // The heat flows on the film's clock, which holds with the scene.
  pipeline.setFilmTime(12.5);
  assert.equal(final.uLensTime.value, 12.5);
  pipeline.setFilmTime(3600 + 2);
  assert.equal(final.uLensTime.value, 2);

  // The text boxes are the ground's own objects, lent once.
  const contacts = {
    slateText: { value: { x: 0.1, y: 0.2, z: 0.4, w: 0.6 } },
    slateAbout: { value: { x: 0, y: 0, z: 0.1, w: 0.05 } },
    slateAspect: { value: 16 / 9 },
  };
  pipeline.setTextGuard(contacts);
  for (const name of ["slateText", "slateAbout", "slateAspect"])
    assert.equal(final[name], contacts[name], name);

  const shader = pipeline.passes.vignetteGrain.material.fragmentShader;
  // Behind the text and inside the kept rect the lens is open 0: no drift, no fringe, no flare.
  assert.match(shader, /float open = \(1\.0 - guard\) \* \(1\.0 - lensKeep\(keep, v, 0\.0\)\);/);
  assert.match(
    shader,
    /if \(uLens\.x > 0\.0 && open > 0\.0\) q \+= lensHeat\(v, star, flame\) \* \(uLens\.x \* open\);/,
  );
  assert.match(shader, /vec2 s = lensFringe\(v, star\) \* \(uLens\.y \* open\);/);
  assert.match(shader, /color \+= flare \* \(uLens\.z \* \(1\.0 - guard\)\);/);
  assert.match(shader, /return c \* shown \* \(1\.0 - lensKeep\(keep, v, 0\.0\)\);/);
  // The focus's taps never sit behind a per-pixel branch: no early return in lensView.
  const view = shader.slice(shader.indexOf("vec4 lensView("), shader.indexOf("vec3 lensFlare("));
  assert.equal((view.match(/return /g) || []).length, 1);
  // The flare dissolves with each frame's own, and only while the star is in frame.
  assert.match(
    shader,
    /if \(uProgress < 1\.0\) flare = mix\(lensFlare\(prevUv, uStarPrev, uKeepPrev\), flare, w\);/,
  );
  assert.match(shader, /float shown = star\.w \* smoothstep\(-star\.z, 2\.0 \* star\.z, inside\);/);
  // One block per ghost, each dropped whole near the kept rect.
  assert.equal(
    (shader.match(/\* \(1\.0 - lensKeep\(keep, g, /g) || []).length,
    LENS_FX.flare.ghosts.length,
  );
  // The flare is added before the vignette, the text shade and the bars.
  assert.ok(shader.indexOf("color += flare") < shader.indexOf("if (uVignetteEnabled == 1)"));
  // The text guard reaches LENS_FX.text of the smaller side.
  assert.ok(shader.includes(`lensBehind(slateText, vUv, ${LENS_FX.text[0]})`));
  pipeline.dispose();
});

test("the kept frame's lens stays on its own star and flame as the frame pushes in", () => {
  // An off-axis outgoing shot: the kept frame pushes in about its principal point.
  const elements = new Array(16).fill(0);
  elements[8] = -0.2;
  elements[9] = 0.1;
  const { capture, pipeline } = createRecordedPipeline(GRADING_ONLY, {
    projectionMatrix: { elements },
  });
  const final = pipeline.passes.vignetteGrain.uniforms;
  pipeline.setFilmTreatment(true);
  pipeline.resize(1600, 900);
  const star = [0.83, 0.79, 0.04, 1];
  pipeline.setLensSources({ star, keep: [0, 0, 0.6875, 0.4889] });
  capture();
  pipeline.setLensSources({});
  pipeline.setTransition({ capture: false, cut: true, progress: 0.8, zoom: 0.02 });
  const shader = pipeline.passes.vignetteGrain.material.fragmentShader;
  // The pixel at vUv shows the kept frame's own pixel prevUv; its heat, fringes,
  // kept rect and flare are all evaluated there, with the outgoing sources.
  assert.match(shader, /vec2 prevUv = uPrevOrigin \+ \(vUv - uPrevOrigin\) \* uPrevScale;/);
  assert.ok(shader.indexOf("vec2 prevUv =") < shader.indexOf("lensView(tPrev, prevUv, prevUv,"));
  assert.ok(shader.indexOf("vec2 prevUv =") < shader.indexOf("lensFlare(prevUv, uStarPrev,"));
  assert.doesNotMatch(shader, /lensView\(tPrev, prevUv, vUv,|lensFlare\(vUv, uStarPrev/);
  // So where the kept star shows on screen (pushed out from the origin by
  // 1 / uPrevScale), its lens is centred on it exactly.
  const origin = final.uPrevOrigin.value.toArray(),
    scale = final.uPrevScale.value,
    shown = [0, 1].map((i) => origin[i] + (star[i] - origin[i]) / scale),
    prevUv = shown.map((v, i) => origin[i] + (v - origin[i]) * scale);
  assert.ok(scale < 1, "the kept frame is pushing in");
  assert.ok(Math.hypot(prevUv[0] - star[0], prevUv[1] - star[1]) < 1e-12);
  // Read in the screen's UV instead, the lens would sit several pixels off it.
  const off = Math.hypot((shown[0] - star[0]) * 1600, (shown[1] - star[1]) * 900);
  assert.ok(off > 5, `${off.toFixed(1)} px`);
  pipeline.dispose();
});

test("the lens sees a source at its screen centre, its radius in frame heights, and none behind it", () => {
  const camera = new PerspectiveCamera(30, 16 / 9, 0.1, 1000);
  camera.position.set(0, 0, 0);
  camera.lookAt(0, 0, -1);
  camera.updateMatrixWorld(true);
  const ahead = lensSource(camera, new Vector3(0, 0, -50), 2);
  assert.ok(Math.abs(ahead[0] - 0.5) < 1e-9 && Math.abs(ahead[1] - 0.5) < 1e-9);
  assert.ok(Math.abs(ahead[2] - (2 * camera.projectionMatrix.elements[5]) / 50 / 2) < 1e-12);
  assert.equal(ahead[3], 1);
  // Up and right of centre reads up and right in UV (y up).
  const corner = lensSource(camera, new Vector3(5, 5, -50), 1);
  assert.ok(corner[0] > 0.5 && corner[1] > 0.5);
  const out = [9, 9, 9, 9];
  assert.equal(lensSource(camera, new Vector3(0, 0, 50), 2, out), out);
  assert.deepEqual(out, [0, 0, 0, 0]);
});

test("the shot's lens blurs only in film, the bars cut the frame and the grain steps at 24 a second", () => {
  const { capture, frame, pipeline } = createRecordedPipeline({
    postprocessGrading: true,
    postprocessVignette: true,
    postprocessGrain: true,
  });
  const final = pipeline.passes.vignetteGrain.uniforms;
  for (const name of ["uBlur", "uBlurPrev", "uBars", "uGrainTime"])
    assert.equal(final[name].value, 0, name + " starts at 0");
  // Lens blur radii are CSS pixels: one texel of the CSS viewport.
  assert.deepEqual(final.uCssTexel.value.toArray(), [1 / 800, 1 / 600]);
  pipeline.resize(1600, 900);
  assert.deepEqual(final.uCssTexel.value.toArray(), [1 / 1600, 1 / 900]);

  // Outside film a lens never blurs.
  pipeline.setLens({ blur: 8 });
  assert.equal(final.uBlur.value, 0);
  pipeline.setFilmTreatment(true);
  pipeline.setLens({ blur: 8 });
  assert.equal(final.uBlur.value, 8);
  pipeline.setLens({});
  assert.equal(final.uBlur.value, 0, "a lens without blur is sharp");
  pipeline.setLens({ blur: 10 });
  pipeline.setLens(null);
  assert.equal(final.uBlur.value, 0, "no lens is sharp");

  // No per-shot grade: in film the subjects take no cel step at all.
  assert.equal(pipeline.setGrade, undefined);
  assert.equal(pipeline.passes.grading.uniforms.uSubjectCel, undefined);

  // The capture keeps the outgoing shot's focus for the kept frame; the next
  // shot's lens then changes only the live frame.
  pipeline.setLens({ blur: 5 });
  frame();
  assert.equal(final.uBlurPrev.value, 0, "an ordinary frame leaves the kept focus");
  capture();
  assert.equal(final.uBlurPrev.value, 5);
  pipeline.setLens({ blur: 10 });
  pipeline.setTransition({ capture: false, cut: true, progress: 0.4, zoom: 0.01 });
  assert.equal(final.uBlur.value, 10);
  assert.equal(final.uBlurPrev.value, 5, "the dissolve keeps the outgoing focus");

  // Bars: a share of the height at each edge, never negative.
  pipeline.setBars(0.165);
  assert.equal(final.uBars.value, 0.165);
  pipeline.setBars(-0.1);
  assert.equal(final.uBars.value, 0);
  pipeline.setBars();
  assert.equal(final.uBars.value, 0);

  // Grain frames: 24 a second, wrapping at 997 so the hash input stays small.
  pipeline.setFilmTime(0);
  assert.equal(final.uGrainTime.value, 0);
  pipeline.setFilmTime(1.02);
  assert.equal(final.uGrainTime.value, 24);
  pipeline.setFilmTime(1.04);
  assert.equal(final.uGrainTime.value, 24, "held within a frame");
  pipeline.setFilmTime(1.05);
  assert.equal(final.uGrainTime.value, 25);
  pipeline.setFilmTime(997 / 24 + 0.01);
  assert.equal(final.uGrainTime.value, 0);
  pipeline.setFilmTime(100);
  assert.equal(final.uGrainTime.value, 2400 % 997);

  const shader = pipeline.passes.vignetteGrain.material.fragmentShader;
  assert.match(
    shader,
    /hash\(floor\(vUv \* vec2\(1280\.0, 720\.0\)\) \+ floor\(fract\(uGrainTime \* vec2\(0\.618034, 0\.414214\)\) \* 97\.0\)\)/,
  );
  assert.match(
    shader,
    /color = mix\(color, vec3\(\.012, \.014, \.022\), step\(min\(vUv\.y, 1\.0 - vUv\.y\), uBars\)\);/,
  );
  // The bars come after the text shade, so nothing draws over them.
  const shade = shader.indexOf("protection * textShade;");
  assert.ok(shade > 0 && shader.indexOf("uBars));") > shade);
  // The blur skips the ground and the subject (layer codes 0.5 and up) and
  // takes no tap from a nearer layer.
  assert.match(shader, /float w = step\(tap\.a, centre\.a \+ 0\.1\);/);
  // The subject's anti-aliased edge stays sharp: the nearest layer over a 1px
  // cross decides, not the edge pixel's own blended code.
  assert.match(
    shader,
    /float near = max\(max\(centre\.a, texture2D\(map, uv \+ vec2\(uCssTexel\.x, 0\.0\)\)\.a\)/,
  );
  assert.match(shader, /mix\(sum \/ weight, centre\.rgb, step\(0\.5, near\)\)/);
  pipeline.dispose();
});
