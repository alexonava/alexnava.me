import {
  AdditiveBlending,
  CustomBlending,
  HalfFloatType,
  NoBlending,
  OneFactor,
  ShaderMaterial,
  SrcAlphaFactor,
  UniformsUtils,
  Vector2,
  WebGLRenderTarget,
  ZeroFactor,
} from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { FullScreenQuad } from "three/examples/jsm/postprocessing/Pass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { CopyShader } from "three/examples/jsm/shaders/CopyShader.js";

const PASS_VERTEX_SHADER = `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const GRADING_SHADER = {
  name: "BabelGradingShader",
  uniforms: {
    tDiffuse: { value: null },
    uCelMix: { value: 0.24 },
    uInkMix: { value: 0.14 },
    uContrast: { value: 1.1 },
    uHighlightWarmMix: { value: 0.2 },
    uShadowCoolMix: { value: 0.34 },
    uTexelSize: { value: new Vector2(1, 1) },
    uLayerRelief: { value: 0 },
  },
  vertexShader: PASS_VERTEX_SHADER,
  fragmentShader: `
uniform sampler2D tDiffuse;
uniform float uCelMix;
uniform float uInkMix;
uniform float uContrast;
uniform float uHighlightWarmMix;
uniform float uShadowCoolMix;
uniform vec2 uTexelSize;
uniform float uLayerRelief;
varying vec2 vUv;

vec3 saturateColor(vec3 color, float amount) {
  float luma = dot(color, vec3(0.299, 0.587, 0.114));
  return mix(vec3(luma), color, amount);
}

void main() {
  vec4 texel = texture2D(tDiffuse, vUv);
  vec3 color = texel.rgb;
  float luma = dot(color, vec3(0.299, 0.587, 0.114));

  color = (color - 0.5) * uContrast + 0.5;

  vec3 shadowLift = vec3(0.045, 0.055, 0.09);
  vec3 coolShadow = color * vec3(0.88, 0.94, 1.09);
  vec3 warmMidtone = color * vec3(1.025, 1.012, 0.965);
  vec3 parchmentHighlight = color * vec3(1.055, 1.025, 0.94);

  float shadowMix = 1.0 - smoothstep(0.08, 0.32, luma);
  float midMix = smoothstep(0.22, 0.46, luma) * (1.0 - smoothstep(0.62, 0.82, luma));
  float highlightMix = smoothstep(0.72, 0.97, luma);

  color = mix(color, max(coolShadow, shadowLift), uShadowCoolMix * shadowMix);
  color = mix(color, warmMidtone, 0.3 * midMix);
  color = mix(color, parchmentHighlight, uHighlightWarmMix * highlightMix);

  float gradedLuma = max(0.02, dot(color, vec3(0.299, 0.587, 0.114)));
  // Film (uLayerRelief 1): the mountains (depth code 1/3) keep their moonlit relief.
  // The cel step fades off them, returning below luma .1 so the fogged feet match
  // the ground's crush, and the post ink skips them and the sky beside them, where
  // each crest draws its own hairline (hill-silhouette.js).
  float relief = uLayerRelief * (1.0 - smoothstep(0.04, 0.12, abs(texel.a - 0.3333)));
  float tonalBand = floor(gradedLuma * 5.0 + 0.5) / 5.0;
  vec3 celColor = color * (tonalBand / gradedLuma);
  color = mix(color, celColor, uCelMix * (1.0 - relief * smoothstep(0.05, 0.1, gradedLuma)));
  color = saturateColor(color, 1.04);

  if (uInkMix > 0.0) {
  vec3 Y = vec3(0.299, 0.587, 0.114);
  vec4 e1 = texture2D(tDiffuse, vUv + vec2(uTexelSize.x, 0.0)), e2 = texture2D(tDiffuse, vUv - vec2(uTexelSize.x, 0.0));
  vec4 e3 = texture2D(tDiffuse, vUv + vec2(0.0, uTexelSize.y)), e4 = texture2D(tDiffuse, vUv - vec2(0.0, uTexelSize.y));
  float horizontalEdge = abs(dot(e1.rgb, Y) - dot(e2.rgb, Y));
  float verticalEdge = abs(dot(e3.rgb, Y) - dot(e4.rgb, Y));
  float inkContour = smoothstep(0.2, 0.48, max(horizontalEdge, verticalEdge));
  float nearest = max(max(e1.a, e2.a), max(e3.a, e4.a));
  float skySide = uLayerRelief * step(texel.a, 0.02) * step(0.2, nearest) * step(nearest, 0.5);
  color = mix(color, vec3(0.035, 0.055, 0.095), inkContour * uInkMix * (1.0 - max(relief, skySide)));
  }

  gl_FragColor = vec4(clamp(color, 0.0, 1.0), texel.a);
}
`,
};

// The tour's depth-staggered dissolve. In film every surface writes its depth
// layer (depth-layers.js) into the scene target's alpha, which bloom, grading
// and the kept frame preserve. Each pixel waits for the later of its outgoing
// and incoming layers, start = 3 * step * code, then dissolves over `window`
// of the progress: sky, mountains, ground, subject. 3 * step + window = 1, so
// the subject settles as the transition ends. A layer's code is the maximum over
// a 5-tap cross, so anti-aliased edges travel with the nearer layer. Every
// weight stays in 0..1, a mix of two frames, so no frame can go black.
export const LAYER_STAGGER = Object.freeze({ step: 0.2, window: 0.4 });

const VIGNETTE_GRAIN_SHADER = {
  name: "BabelVignetteGrainShader",
  uniforms: {
    tDiffuse: { value: null },
    uVignetteEnabled: { value: 1 },
    uVignetteStrength: { value: 0.12 },
    uGrainEnabled: { value: 1 },
    uGrainStrength: { value: 0.018 },
    uTextProtection: { value: 0 },
    uTextProtectionFrom: { value: 0 },
    uTextBottom: { value: 0.25 },
    tPrev: { value: null },
    uProgress: { value: 1 },
    uLayered: { value: 0 },
    uStagger: { value: new Vector2(LAYER_STAGGER.step, LAYER_STAGGER.window) },
    uCodeTexel: { value: new Vector2(1, 1) },
    uPrevScale: { value: 1 },
    uPrevOrigin: { value: new Vector2(0.5, 0.5) },
  },
  vertexShader: PASS_VERTEX_SHADER,
  fragmentShader: `
uniform sampler2D tDiffuse;
uniform int uVignetteEnabled;
uniform float uVignetteStrength;
uniform int uGrainEnabled;
uniform float uGrainStrength;
uniform float uTextProtection;
uniform float uTextProtectionFrom;
uniform float uTextBottom;
uniform sampler2D tPrev;
uniform float uProgress;
uniform float uLayered;
uniform vec2 uStagger;
uniform vec2 uCodeTexel;
uniform float uPrevScale;
uniform vec2 uPrevOrigin;
varying vec2 vUv;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float layerCode(sampler2D map, vec2 uv) {
  vec2 x = vec2(uCodeTexel.x, 0.0), y = vec2(0.0, uCodeTexel.y);
  return max(max(texture2D(map, uv).a, max(texture2D(map, uv - x).a, texture2D(map, uv + x).a)),
    max(texture2D(map, uv - y).a, texture2D(map, uv + y).a));
}

void main() {
  vec4 texel = texture2D(tDiffuse, vUv);
  float protection = uTextProtection, w = 1.0;
  if (uProgress < 1.0) {
    vec2 prevUv = uPrevOrigin + (vUv - uPrevOrigin) * uPrevScale;
    float start = 0.0, span = 1.0;
    if (uLayered > 0.5) {
      start = 3.0 * uStagger.x * clamp(max(layerCode(tPrev, prevUv), layerCode(tDiffuse, vUv)), 0.0, 1.0);
      span = uStagger.y;
    }
    w = smoothstep(start, start + span, uProgress);
    texel = mix(texture2D(tPrev, prevUv), texel, w);
    protection = mix(uTextProtectionFrom, uTextProtection, w);
  }
  vec3 color = texel.rgb;

  if (uVignetteEnabled == 1) {
    float dist = distance(vUv, vec2(0.5));
    float vignette = smoothstep(0.42, 1.0, dist);
    color *= 1.0 - uVignetteStrength * vignette;
  }

  if (uGrainEnabled == 1) {
    float grain = hash(floor(vUv * vec2(1280.0, 720.0))) - 0.5;
    color += grain * uGrainStrength;
  }

  float textShade = smoothstep(1.0 - uTextBottom - .12, 1.0 - uTextBottom + .10, vUv.y);
  color *= 1.0 - .28 * protection * textShade;
  gl_FragColor = vec4(clamp(color, 0.0, 1.0), uLayered > 0.5 ? 1.0 : texel.a);
}
`,
};

function getSize(renderer) {
  if (renderer && typeof renderer.getSize === "function") {
    return renderer.getSize(new Vector2());
  }
  return new Vector2(1, 1);
}

// The composer's scene pass. With samples it draws into its own multisampled
// target, which Three resolves once per frame, and copies the result into the
// read buffer. Bloom and grading then draw their full-screen quads into
// single-sample buffers and pay no resolve of their own. Without samples, or as
// the final pass, it is a plain RenderPass.
class SceneRenderPass extends RenderPass {
  constructor(scene, camera) {
    super(scene, camera);
    this.samples = 0;
    this.sampledTarget = null;
    this.width = 1;
    this.height = 1;
    this.copyQuad = new FullScreenQuad(
      new ShaderMaterial({
        name: "BabelSceneCopy",
        uniforms: UniformsUtils.clone(CopyShader.uniforms),
        vertexShader: CopyShader.vertexShader,
        fragmentShader: CopyShader.fragmentShader,
        blending: NoBlending,
        depthTest: false,
        depthWrite: false,
      }),
    );
  }

  // Returns whether the count changed; a change replaces the target.
  setSamples(samples) {
    if (samples === this.samples) return false;
    this.samples = samples;
    this.sampledTarget?.dispose();
    this.sampledTarget =
      samples > 0
        ? new WebGLRenderTarget(this.width, this.height, { type: HalfFloatType, samples })
        : null;
    return true;
  }

  // Device pixels, from the composer.
  setSize(width, height) {
    this.width = width;
    this.height = height;
    this.sampledTarget?.setSize(width, height);
  }

  render(renderer, writeBuffer, readBuffer, deltaTime, maskActive) {
    const target = this.renderToScreen ? null : this.sampledTarget;
    if (!target) {
      super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
      return;
    }
    super.render(renderer, writeBuffer, target, deltaTime, maskActive);
    this.copyQuad.material.uniforms.tDiffuse.value = target.texture;
    renderer.setRenderTarget(readBuffer);
    this.copyQuad.render(renderer);
  }

  dispose() {
    this.sampledTarget?.dispose();
    this.sampledTarget = null;
    this.copyQuad.material.dispose();
    this.copyQuad.dispose();
  }
}

export function createPostprocessPipeline(renderer, scene, camera, qualityProfile, options = {}) {
  const composer = new EffectComposer(renderer);
  const renderPass = new SceneRenderPass(scene, camera);
  const size = getSize(renderer);
  const bloomPass = new UnrealBloomPass(size, 0.18, 0.45, 0.9);
  const gradingPass = new ShaderPass(GRADING_SHADER);
  const vignetteGrainPass = new ShaderPass(VIGNETTE_GRAIN_SHADER);
  // Bloom adds light, not depth: in film its composite keeps the layer codes.
  Object.assign(bloomPass.blendMaterial, {
    blendSrc: SrcAlphaFactor,
    blendDst: OneFactor,
    blendSrcAlpha: ZeroFactor,
    blendDstAlpha: OneFactor,
  });
  const matchMedia = options.matchMedia || globalThis.window?.matchMedia?.bind(globalThis.window);
  const onInvalidate = typeof options.onInvalidate === "function" ? options.onInvalidate : () => {};
  const transparencyQuery = matchMedia?.("(prefers-reduced-transparency: reduce)");

  // The composer sizes passes in device pixels. Bloom keeps the CSS-pixel
  // resolution it is tuned for: its blur radius is counted in its own texels.
  const setBloomSize = bloomPass.setSize.bind(bloomPass);
  bloomPass.setSize = (width, height) => {
    const ratio = renderer.getPixelRatio?.() || 1;
    setBloomSize(width / ratio, height / ratio);
  };

  composer.addPass(renderPass);
  composer.addPass(bloomPass);
  composer.addPass(gradingPass);
  composer.addPass(vignetteGrainPass);

  let reducedTransparency = Boolean(transparencyQuery?.matches);
  let film = false;

  // Tour crossfade: IDLE → ARMED (a capture is due) → CAPTURED (grading drew
  // the outgoing frame into prevTarget) → BLENDING (the cut) → IDLE.
  const IDLE = 0,
    ARMED = 1,
    CAPTURED = 2,
    BLENDING = 3;
  const finalUniforms = vignetteGrainPass.uniforms;
  const toUv = (offset) => Math.min(1, Math.max(0, (1 - offset) / 2));
  let phase = IDLE,
    capturing = false,
    compiled = false,
    prevTarget = null,
    protectionFrom = 0,
    protectionTarget = 0,
    cssWidth = 0,
    cssHeight = 0;

  // The capture adds no draw: on the capture frame grading writes straight
  // into the kept target and the final pass reads it from there, so the
  // composer's ping-pong is untouched. The kept frame pushes in about the
  // outgoing camera's off-axis principal point, the safe-area centre.
  const renderGrading = gradingPass.render.bind(gradingPass);
  gradingPass.render = (passRenderer, writeBuffer, readBuffer, deltaTime, maskActive) => {
    capturing = phase === ARMED && !gradingPass.renderToScreen;
    if (capturing) {
      const { width, height } = writeBuffer;
      if (!prevTarget) {
        prevTarget = new WebGLRenderTarget(width, height, { depthBuffer: false });
        finalUniforms.tPrev.value = prevTarget.texture;
      } else if (prevTarget.width !== width || prevTarget.height !== height) {
        prevTarget.setSize(width, height);
      }
      const elements = camera?.projectionMatrix?.elements;
      finalUniforms.uPrevOrigin.value.set(
        elements ? toUv(elements[8]) : 0.5,
        elements ? toUv(elements[9]) : 0.5,
      );
      finalUniforms.uCodeTexel.value.set(1 / width, 1 / height);
      protectionFrom = finalUniforms.uTextProtection.value;
      phase = CAPTURED;
    }
    renderGrading(
      passRenderer,
      capturing ? prevTarget : writeBuffer,
      readBuffer,
      deltaTime,
      maskActive,
    );
  };
  const renderFinal = vignetteGrainPass.render.bind(vignetteGrainPass);
  vignetteGrainPass.render = (passRenderer, writeBuffer, readBuffer, deltaTime, maskActive) => {
    renderFinal(
      passRenderer,
      writeBuffer,
      capturing ? prevTarget : readBuffer,
      deltaTime,
      maskActive,
    );
    capturing = false;
  };

  // The phone text band follows each pixel's dissolve instead of switching at
  // the cut: the final pass mixes from the kept frame's band to the live one.
  function syncProtection() {
    finalUniforms.uTextProtection.value = film ? protectionTarget : 0;
    finalUniforms.uTextProtectionFrom.value = film ? protectionFrom : 0;
  }

  // A CSS resize or a lost context ends a crossfade on its incoming shot.
  function cancelTransition() {
    if (phase === IDLE) return;
    phase = IDLE;
    finalUniforms.uProgress.value = 1;
    syncProtection();
    applyProfile(currentProfile);
  }

  function applyProfile(profile = {}) {
    const baseline = profile.postprocessSettings || {};
    const settings = film
      ? {
          ...baseline,
          bloomStrength: 0.2,
          contrast: 1.015,
          grainStrength: 0.008,
          highlightWarmMix: 0.12,
          shadowCoolMix: 0.16,
          vignetteStrength: 0.12,
        }
      : baseline;
    const gradingEnabled = profile.postprocessGrading !== false;
    const bloomEnabled = profile.postprocessBloom === true;
    const vignetteEnabled = profile.postprocessVignette === true && !reducedTransparency;
    const grainEnabled = profile.postprocessGrain === true;

    bloomPass.enabled = bloomEnabled;
    bloomPass.strength = settings.bloomStrength ?? 0.18;
    bloomPass.blendMaterial.blending = film ? CustomBlending : AdditiveBlending;
    gradingPass.enabled = gradingEnabled;
    gradingPass.uniforms.uCelMix.value = settings.celMix ?? 0.24;
    gradingPass.uniforms.uInkMix.value = 0.14;
    gradingPass.uniforms.uContrast.value = settings.contrast ?? 1.06;
    gradingPass.uniforms.uHighlightWarmMix.value = settings.highlightWarmMix ?? 0.14;
    gradingPass.uniforms.uShadowCoolMix.value = settings.shadowCoolMix ?? 0.25;
    gradingPass.uniforms.uLayerRelief.value = film ? 1 : 0;
    // In film the final pass always draws: it staggers the dissolve and writes
    // opaque alpha, so layer codes never reach the transparent canvas.
    vignetteGrainPass.enabled = film || vignetteEnabled || grainEnabled || phase !== IDLE;
    finalUniforms.uLayered.value = film ? 1 : 0;
    vignetteGrainPass.uniforms.uVignetteEnabled.value = vignetteEnabled ? 1 : 0;
    vignetteGrainPass.uniforms.uVignetteStrength.value = settings.vignetteStrength ?? 0.08;
    vignetteGrainPass.uniforms.uGrainEnabled.value = grainEnabled ? 1 : 0;
    vignetteGrainPass.uniforms.uGrainStrength.value = settings.grainStrength ?? 0.022;
  }

  function onTransparencyChange(event) {
    const nextReducedTransparency = Boolean(event?.matches);
    if (nextReducedTransparency === reducedTransparency) return;
    reducedTransparency = nextReducedTransparency;
    applyProfile(currentProfile);
    onInvalidate();
  }

  // The scene draws off-screen, so the renderer's own antialias would reach
  // only the final quad. High multisamples the scene pass's target instead;
  // half-float multisample storage needs WebGL2 with EXT_color_buffer_float.
  function applySamples(profile) {
    const capabilities = renderer.capabilities;
    const supported =
      capabilities?.isWebGL2 === true && renderer.extensions?.has?.("EXT_color_buffer_float");
    const requested = supported ? Math.max(0, Math.floor(profile.postprocessSamples) || 0) : 0;
    const samples = Math.min(requested, capabilities?.maxSamples ?? requested);
    if (!renderPass.setSamples(samples)) return;
    // With its own target the scene leaves only full-screen passes in the
    // ping-pong targets, which need no depth. Three allocates GPU storage on
    // first use; disposal forces a rebuild.
    for (const target of [composer.renderTarget1, composer.renderTarget2]) {
      target.depthBuffer = samples === 0;
      target.dispose();
    }
  }

  let currentProfile = qualityProfile || {};
  applyProfile(currentProfile);
  applySamples(currentProfile);

  // width and height are CSS pixels. The composer's targets follow device
  // pixels, but the ink contour keeps sampling one CSS pixel apart, the offset
  // it is tuned for. The kept frame is sampled by UV, so only a CSS size
  // change, not a pixel ratio or quality step, ends a crossfade.
  function resize(width, height) {
    if (width !== cssWidth || height !== cssHeight) cancelTransition();
    cssWidth = width;
    cssHeight = height;
    gradingPass.uniforms.uTexelSize.value.set(1 / Math.max(1, width), 1 / Math.max(1, height));
  }

  resize(size.width, size.height);

  transparencyQuery?.addEventListener?.("change", onTransparencyChange);

  return {
    composer,
    passes: {
      bloom: bloomPass,
      grading: gradingPass,
      render: renderPass,
      vignetteGrain: vignetteGrainPass,
    },
    dispose() {
      transparencyQuery?.removeEventListener?.("change", onTransparencyChange);
      for (const pass of composer.passes) {
        if (typeof pass.dispose === "function") pass.dispose();
      }
      if (typeof composer.dispose === "function") composer.dispose();
      prevTarget?.dispose();
      prevTarget = null;
    },
    // A lost context takes its programs with it: the next warm-up links the
    // crossfade's programs again instead of the first dissolve after recovery.
    invalidatePrograms() {
      compiled = false;
    },
    // Links the crossfade's programs once, from the shader warm-up. Keys
    // differ by output colour space, so grading compiles against an off-screen
    // target and the final pass against the canvas, as a low-tier cut draws them.
    compile() {
      if (compiled || typeof renderer.compile !== "function") return;
      compiled = true;
      const previous = renderer.getRenderTarget?.() ?? null;
      try {
        renderer.setRenderTarget(composer.readBuffer);
        renderer.compile(gradingPass.fsQuad._mesh, camera);
        renderer.setRenderTarget(null);
        renderer.compile(vignetteGrainPass.fsQuad._mesh, camera);
      } catch {
        compiled = false;
      } finally {
        renderer.setRenderTarget(previous);
      }
    },
    cancelTransition,
    setFilmTreatment(active) {
      film = Boolean(active);
      if (!film) protectionTarget = 0;
      syncProtection();
      applyProfile(currentProfile);
    },
    // Takes the tour's { capture, cut, progress, zoom } once per frame, before
    // the draw. The capture frame keeps grading's output; from the cut the
    // final pass mixes it out along a smoothstep, staggered by depth layer in
    // film. A capture that never drew, or any settled frame, leaves a hard cut;
    // a capture mid-blend is ignored.
    setTransition(transition = null) {
      const value = transition?.progress;
      const progress = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 1));
      const zoom = Math.min(0.02, Math.max(0, Number(transition?.zoom) || 0));
      const wasIdle = phase === IDLE;
      if (transition?.capture === true) {
        if (phase !== BLENDING) phase = ARMED;
      } else if (progress >= 1 || phase === ARMED) {
        phase = IDLE;
      } else if (phase === CAPTURED) {
        phase = BLENDING;
      }
      finalUniforms.uProgress.value = phase === BLENDING ? progress : 1;
      finalUniforms.uPrevScale.value = 1 / (1 + zoom * progress);
      syncProtection();
      if (wasIdle !== (phase === IDLE)) applyProfile(currentProfile);
    },
    setTextProtection(active, bottom = 0.25) {
      protectionTarget = film && active ? 1 : 0;
      syncProtection();
      vignetteGrainPass.uniforms.uTextBottom.value = bottom;
    },
    setQualityProfile(profile = {}) {
      currentProfile = profile;
      applyProfile(currentProfile);
      applySamples(currentProfile);
    },
    resize,
  };
}
