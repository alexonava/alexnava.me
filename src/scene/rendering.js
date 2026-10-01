import {
  AmbientLight,
  ColorManagement,
  DirectionalLight,
  Fog,
  HemisphereLight,
  NoToneMapping,
  PCFSoftShadowMap,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
} from "three";
import { createPostprocessPipeline } from "./postprocess.js";
import { disposeSceneRuntimeResources } from "./runtime.js";

// Bounds a warm-up whose materials were disposed mid-poll (compileAsync then
// never settles); past it the next draw links whatever remains, as before.
const SHADER_WARMUP_TIMEOUT_MS = 2000;

// Polls KHR_parallel_shader_compile without blocking: true once every program
// has linked, false after timeoutMs.
function whenLinked(programs, timeoutMs = SHADER_WARMUP_TIMEOUT_MS) {
  return new Promise((resolve) => {
    let waited = 0;
    (function poll() {
      if (programs.every((program) => program.isReady())) resolve(true);
      else if ((waited += 10) > timeoutMs) resolve(false);
      else setTimeout(poll, 10);
    })();
  });
}

export function createSceneRendering({
  container,
  height,
  lighting,
  onContextLost,
  onContextRestored,
  onInvalidate,
  profile,
  width,
  world,
  createPipeline = createPostprocessPipeline,
  createRenderer = (options) => new WebGLRenderer(options),
  disposeResources = disposeSceneRuntimeResources,
}) {
  if (ColorManagement) ColorManagement.enabled = false;

  const homeScene = new Scene();
  homeScene.fog = new Fog(lighting.fogColor, lighting.fogNear, lighting.fogFar);

  const camera = new PerspectiveCamera(
    world.CAMERA_FOV,
    width / height,
    world.CAMERA_NEAR,
    world.CAMERA_FAR,
  );
  // The scene renders into the composer's targets, so default-framebuffer MSAA
  // would only smooth the final quad; the pipeline multisamples on high. The
  // ambient scene does not need a discrete GPU.
  const renderer = createRenderer({
    alpha: true,
    antialias: false,
    powerPreference: "default",
  });
  renderer.setClearColor(0, 0);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = NoToneMapping;
  renderer._useLegacyLights = true;
  renderer.shadowMap.type = PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  const postprocessPipeline = createPipeline(renderer, homeScene, camera, profile, {
    onInvalidate,
  });
  const composer = postprocessPipeline.composer;

  const handleContextLost = (event) => {
    event?.preventDefault?.();
    // The kept crossfade frame and the linked programs go with the context.
    postprocessPipeline.cancelTransition?.();
    postprocessPipeline.invalidatePrograms?.();
    onContextLost?.(event);
  };
  const handleContextRestored = (event) => {
    // A restored context has an empty shadow map, even when its casters are static.
    sunLight.shadow.needsUpdate = true;
    onContextRestored?.(event);
  };
  renderer.domElement?.addEventListener?.("webglcontextlost", handleContextLost);
  renderer.domElement?.addEventListener?.("webglcontextrestored", handleContextRestored);

  const ambientLight = new AmbientLight(lighting.ambientColor, lighting.ambientIntensity);
  const hemisphereLight = new HemisphereLight(
    lighting.hemisphereSkyColor,
    lighting.hemisphereGroundColor,
    lighting.hemisphereIntensity,
  );
  const sunLight = new DirectionalLight(lighting.directionalColor, lighting.directionalIntensity);
  const fillLight = new DirectionalLight(
    lighting.fillColor ?? 0x596b9c,
    lighting.fillIntensity ?? 0.58,
  );
  sunLight.position.set(
    lighting.directionalPosition.x,
    lighting.directionalPosition.y,
    lighting.directionalPosition.z,
  );
  sunLight.shadow.camera.left = -world.SHADOW_CAMERA_HALF_EXTENT;
  sunLight.shadow.camera.right = world.SHADOW_CAMERA_HALF_EXTENT;
  sunLight.shadow.camera.top = world.SHADOW_CAMERA_HALF_EXTENT;
  sunLight.shadow.camera.bottom = -world.SHADOW_CAMERA_HALF_EXTENT;
  sunLight.shadow.camera.near = world.SHADOW_CAMERA_NEAR;
  sunLight.shadow.camera.far = world.SHADOW_CAMERA_FAR;
  sunLight.shadow.bias = -0.00045;
  sunLight.shadow.normalBias = 0.028;
  sunLight.shadow.radius = 2.6;
  fillLight.position.set(...(lighting.fillPosition ?? world.FILL_LIGHT_POSITION));
  homeScene.add(ambientLight, hemisphereLight, sunLight, fillLight, sunLight.target);

  let groundedLighting = false,
    filmLighting = false;
  const originalSunPosition = sunLight.position.clone(),
    originalSunTarget = sunLight.target.position.clone();
  const sunOffset = originalSunPosition.clone().sub(originalSunTarget);
  const originalShadow = {
    left: sunLight.shadow.camera.left,
    right: sunLight.shadow.camera.right,
    top: sunLight.shadow.camera.top,
    bottom: sunLight.shadow.camera.bottom,
  };
  let shadowKey = "";
  const baselineKeyColor = sunLight.color.clone();
  const baselineGroundColor = hemisphereLight.groundColor.clone();
  const baselineShadowRadius = sunLight.shadow.radius;
  const baselineShadowBias = sunLight.shadow.bias,
    baselineNormalBias = sunLight.shadow.normalBias;
  let baselineKeyIntensity = sunLight.intensity;
  let baselineFillIntensity = fillLight.intensity;
  let baselineHemisphereIntensity = hemisphereLight.intensity;
  let baselineAmbientIntensity = ambientLight.intensity;
  // Film: the supplied maps already carry daylight, so the key drops and cools
  // while fill, sky and ambient rise to open eaves, brackets and shadow ground.
  function applyLightingTreatment() {
    sunLight.color.copy(baselineKeyColor);
    if (groundedLighting) sunLight.color.setHex(0xd9e2f2);
    if (filmLighting) sunLight.color.setHex(0xd9def0);
    sunLight.intensity =
      baselineKeyIntensity * (groundedLighting ? 0.8 : 1) * (filmLighting ? 0.64 : 1);
    fillLight.intensity =
      baselineFillIntensity * (groundedLighting ? 1.5 : 1) * (filmLighting ? 1.66 : 1);
    hemisphereLight.intensity = baselineHemisphereIntensity * (filmLighting ? 1.25 : 1);
    hemisphereLight.groundColor.copy(baselineGroundColor);
    if (filmLighting) hemisphereLight.groundColor.setHex(0x37404a);
    ambientLight.intensity = baselineAmbientIntensity;
    // Softer still than the earlier film pass: close, low shots showed the
    // tree canopy's cast shadow as a hard-edged dark pool on the ground.
    sunLight.shadow.radius = filmLighting ? 6.5 : baselineShadowRadius;
    // Lit, relief-mapped earth shows acne bands at grazing moonlight; bias more.
    sunLight.shadow.bias = filmLighting ? -0.0016 : baselineShadowBias;
    sunLight.shadow.normalBias = filmLighting ? 0.09 : baselineNormalBias;
  }

  const renderTargets = new Set();
  let disposed = false;
  let disposeResult = null;

  // Uploads every visible map before a shot first shows its subject, so a
  // cut never uploads mid-crossfade; uploaded maps only rebind.
  function uploadTextures() {
    if (typeof renderer.initTexture !== "function") return;
    const materials = new Set();
    const upload = (value) => {
      const image = value?.isTexture && !value.isRenderTargetTexture ? value.image : null;
      if (image && image.complete !== false) {
        renderer.initTexture(value);
      }
    };
    homeScene.traverseVisible((object) => {
      for (const material of [object.material].flat()) {
        if (!material || materials.has(material)) continue;
        materials.add(material);
        Object.values(material).forEach(upload);
        Object.values(material.uniforms ?? {}).forEach((uniform) => upload(uniform?.value));
      }
    });
  }

  const rendering = {
    camera,
    composer,
    get disposeResult() {
      return disposeResult;
    },
    homeScene,
    lifecycleOrder: 100,
    lights: {
      ambient: ambientLight,
      fill: fillLight,
      hemisphere: hemisphereLight,
      sun: sunLight,
    },
    postprocessPipeline,
    renderer,
    setFilmTreatment(active) {
      if (disposed) return false;
      filmLighting = Boolean(active);
      applyLightingTreatment();
      sunLight.shadow.needsUpdate = true;
      postprocessPipeline.setFilmTreatment?.(filmLighting);
      if (!filmLighting) {
        sunLight.position.copy(originalSunPosition);
        sunLight.target.position.copy(originalSunTarget);
        Object.assign(sunLight.shadow.camera, originalShadow);
        sunLight.shadow.camera.updateProjectionMatrix();
        shadowKey = "";
      }
      return true;
    },
    focusFilmShadow(target, radius) {
      if (disposed || !filmLighting) return;
      // The floor used to track the shot's own tight subject radius (e.g. ~12
      // for a close detail shot), but a shadow camera that small doesn't
      // cover the visible ground in a wide, low, grazing-angle frame — the
      // area outside its frustum defaults to lit/unlit at the frustum edge's
      // clamped depth-texture value, rendering as a hard-edged dark wedge
      // across the ground with no relation to any real occluder. A wide
      // floor costs some shadow resolution on the near subject (already
      // heavily softened by the film shadow radius) but removes that cutoff.
      const extent = Math.max(32, Math.min(48, radius + 8));
      const key = [...target.toArray(), extent].join(",");
      if (key === shadowKey) return;
      shadowKey = key;
      sunLight.target.position.copy(target);
      sunLight.position.copy(target).add(sunOffset);
      sunLight.target.updateMatrixWorld();
      const shadow = sunLight.shadow.camera;
      shadow.left = shadow.bottom = -extent;
      shadow.right = shadow.top = extent;
      shadow.updateProjectionMatrix();
      sunLight.shadow.needsUpdate = true;
    },
    setGroundedLighting(active) {
      if (disposed) return false;
      groundedLighting = Boolean(active);
      applyLightingTreatment();
      sunLight.shadow.needsUpdate = true;
      return true;
    },
    // Static shadows redraw the sun's map only when a caster, the light or its
    // focus changes; animated scenes keep Three's per-frame redraw.
    setStaticShadows(active) {
      if (disposed) return false;
      sunLight.shadow.autoUpdate = !active;
      sunLight.shadow.needsUpdate = true;
      return true;
    },
    invalidateShadows() {
      if (!disposed) sunLight.shadow.needsUpdate = true;
    },
    // Links every scene program before its first draw. Program keys differ for
    // an off-screen target (its color space and tone mapping), where the scene
    // pass draws, so compile() runs against a composer target;
    // compileAsync then polls KHR_parallel_shader_compile instead of blocking a
    // frame. Without that extension the draw would link anyway (and Three warns
    // per call), so it is skipped; the crossfade's own programs and the visible
    // maps are prepared either way. Always settles: true once linked, false if
    // skipped, rejected or still pending after timeoutMs.
    compileShaders(timeoutMs = SHADER_WARMUP_TIMEOUT_MS) {
      if (disposed || renderer.getContext?.()?.isContextLost?.()) return Promise.resolve(false);
      postprocessPipeline.compile?.();
      uploadTextures();
      if (typeof renderer.compileAsync !== "function") return Promise.resolve(false);
      if (renderer.extensions?.has?.("KHR_parallel_shader_compile") !== true)
        return Promise.resolve(false);
      const previousTarget = renderer.getRenderTarget?.() ?? null;
      let pending;
      try {
        renderer.setRenderTarget?.(composer.readBuffer ?? null);
        pending = renderer.compileAsync(homeScene, camera);
      } catch {
        return Promise.resolve(false);
      } finally {
        renderer.setRenderTarget?.(previousTarget);
      }
      return new Promise((resolve) => {
        const timer = setTimeout(() => resolve(false), timeoutMs);
        Promise.resolve(pending)
          .then(
            () => true,
            () => false,
          )
          .then((ready) => {
            clearTimeout(timer);
            resolve(ready);
          });
      });
    },
    // Where shaders compile in parallel, links the programs a quality step
    // will draw with before it applies, so the step lands without a compile;
    // otherwise they link on the cut frame. Of what applyQuality() changes,
    // only the shadow flags and the fill light enter program keys; they are
    // set for the synchronous compile and restored before any draw. Resolves
    // true at once when the step keeps them, else as compileShaders() does.
    prepareQuality(nextProfile) {
      const shadows = Boolean(nextProfile?.shadows?.enabled);
      const fill = Boolean(nextProfile?.lighting?.extraDirectional);
      const { shadowMap } = renderer;
      const previous = [shadowMap.enabled, sunLight.castShadow, fillLight.visible];
      const unchanged =
        Boolean(shadowMap.enabled) === shadows &&
        sunLight.castShadow === shadows &&
        fillLight.visible === fill;
      if (disposed || unchanged) return Promise.resolve(true);
      shadowMap.enabled = sunLight.castShadow = shadows;
      fillLight.visible = fill;
      const programs = new Set();
      let compiled;
      try {
        compiled = rendering.compileShaders();
      } finally {
        [shadowMap.enabled, sunLight.castShadow, fillLight.visible] = previous;
        // compile() left every material on the step's program. Lit ones return
        // on their next draw; a version bump returns the rest from the program
        // cache, so none draws mid-shot with a program that is still linking.
        homeScene.traverse((object) => {
          for (const material of [object.material].flat()) {
            if (!material) continue;
            const program = renderer.properties?.get(material)?.currentProgram;
            if (program?.isReady) programs.add(program);
            material.needsUpdate = true;
          }
        });
      }
      // compileAsync polls the programs the next draw restores; poll the step's.
      return compiled.then((ready) => ready && whenLinked([...programs]));
    },
    applyQuality(nextProfile, { pixelRatio } = {}) {
      if (disposed) return false;
      homeScene.fog.near = nextProfile.lighting.fogNear;
      homeScene.fog.far = nextProfile.lighting.fogFar;
      baselineAmbientIntensity = nextProfile.lighting.ambientIntensity;
      baselineHemisphereIntensity = nextProfile.lighting.hemisphereIntensity;
      baselineKeyIntensity = nextProfile.lighting.directionalIntensity;
      if (Number.isFinite(nextProfile.lighting.fillIntensity)) {
        baselineFillIntensity = nextProfile.lighting.fillIntensity;
      }
      applyLightingTreatment();
      fillLight.visible = Boolean(nextProfile.lighting.extraDirectional);
      renderer.shadowMap.enabled = Boolean(nextProfile.shadows.enabled);
      sunLight.castShadow = Boolean(nextProfile.shadows.enabled);
      if (nextProfile.shadows.enabled && nextProfile.shadows.mapSize > 0) {
        sunLight.shadow.mapSize.width = nextProfile.shadows.mapSize;
        sunLight.shadow.mapSize.height = nextProfile.shadows.mapSize;
        sunLight.shadow.needsUpdate = true;
      }
      if (Number.isFinite(pixelRatio)) {
        renderer.setPixelRatio(pixelRatio);
        // EffectComposer captured the renderer's construction-time ratio of 1;
        // its targets and passes now follow the canvas in device pixels.
        composer.setPixelRatio?.(pixelRatio);
      }
      postprocessPipeline.setQualityProfile(nextProfile);
      return true;
    },
    dispose() {
      if (disposed) return false;
      disposed = true;
      renderer.domElement?.removeEventListener?.("webglcontextlost", handleContextLost);
      renderer.domElement?.removeEventListener?.("webglcontextrestored", handleContextRestored);
      disposeResult = disposeResources({
        postprocessPipeline,
        renderer,
        renderTargets: [...renderTargets],
        scene: homeScene,
      });
      renderTargets.clear();
      return disposeResult;
    },
    resize({ cameraFov, height: nextHeight, width: nextWidth }) {
      if (disposed) return false;
      if (Number.isFinite(cameraFov)) camera.fov = cameraFov;
      camera.aspect = nextWidth / nextHeight;
      camera.updateProjectionMatrix();
      // The canvas keeps its CSS size (100% of the full-bleed scene container);
      // only the drawing buffer follows the measured size.
      renderer.setSize(nextWidth, nextHeight, false);
      composer.setSize(nextWidth, nextHeight);
      // Grading samples its ink contour in CSS pixels.
      postprocessPipeline.resize?.(nextWidth, nextHeight);
      // Composition offsets and tower scale move shadow casters.
      sunLight.shadow.needsUpdate = true;
      return true;
    },
    trackRenderTarget(renderTarget) {
      if (!disposed && renderTarget) renderTargets.add(renderTarget);
      return renderTarget;
    },
    update({ render = true } = {}) {
      if (disposed) return false;
      // Physical loss precedes the queued contextlost event. Do not enter
      // Three's shader/uniform setup while its event-driven flag is still stale.
      if (render && renderer.getContext?.()?.isContextLost?.()) return false;
      if (render) composer.render();
      return true;
    },
  };

  return rendering;
}
