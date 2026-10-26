import {
  AmbientLight,
  BackSide,
  ColorManagement,
  DirectionalLight,
  Fog,
  FrontSide,
  Group,
  HemisphereLight,
  Mesh,
  MeshDepthMaterial,
  NoToneMapping,
  PCFSoftShadowMap,
  PerspectiveCamera,
  RGBADepthPacking,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
} from "three";
import { createNightEnvironment } from "./night-environment.js";
import { FILM_LIGHT } from "./film-light.js";
import { createPostprocessPipeline } from "./postprocess.js";
import { disposeSceneRuntimeResources } from "./runtime.js";
import { compilePrograms, linkedPrograms } from "./shader-programs.js";
import { loadPreparationTasks } from "./cinematic.js";

export function createSceneRendering({
  container,
  debugShaders = false,
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
  // r160 enables synchronous shader diagnostic queries by default. Keep them
  // for explicit scene debugging; normal visits do not flush the GPU queue to
  // read successful program/shader logs on every program's first use.
  if (renderer.debug) renderer.debug.checkShaderErrors = debugShaders;
  renderer.setClearColor(0, 0);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = NoToneMapping;
  renderer._useLegacyLights = true;
  // PCF soft filters a fixed bilinear 3x3 texel footprint: in r160 it ignores
  // shadow.radius (only PCFShadowMap and VSM read it), so the shadow map's texel
  // size alone sets how soft an edge falls.
  renderer.shadowMap.type = PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  const postprocessPipeline = createPipeline(renderer, homeScene, camera, profile, {
    onInvalidate,
  });
  const composer = postprocessPipeline.composer;

  const handleContextLost = (event) => {
    event?.preventDefault?.();
    compileGeneration += 1;
    // The kept crossfade frame and the linked programs go with the context.
    postprocessPipeline.cancelTransition?.();
    postprocessPipeline.invalidatePrograms?.();
    onContextLost?.(event);
  };
  const handleContextRestored = (event) => {
    // A restored context has an empty shadow map, even when its casters are static,
    // and an empty environment target: the sky is drawn into it again, also with
    // the film off, so the film's next start finds it whole.
    sunLight.shadow.needsUpdate = true;
    const restored = environment.restore();
    if (filmLighting) homeScene.environment = restored;
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
  fillLight.position.set(...(lighting.fillPosition ?? world.FILL_LIGHT_POSITION));
  homeScene.add(ambientLight, hemisphereLight, sunLight, fillLight, sunLight.target);
  // The film's night sky as the scene's environment (night-environment.js),
  // captured once, from the sky shell's own shader, when the film starts.
  const environment = createNightEnvironment(renderer, {
    keyDirection: [
      lighting.directionalPosition.x,
      lighting.directionalPosition.y,
      lighting.directionalPosition.z,
    ],
  });

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
  const baselineShadowBias = sunLight.shadow.bias,
    baselineNormalBias = sunLight.shadow.normalBias;
  let baselineKeyIntensity = sunLight.intensity;
  let baselineFillIntensity = fillLight.intensity;
  let baselineHemisphereIntensity = hemisphereLight.intensity;
  let baselineAmbientIntensity = ambientLight.intensity;
  // Film: the supplied maps already carry daylight, so the key drops and cools
  // while fill, sky and ambient rise to open eaves, brackets and shadow ground.
  let shotMood = { key: 1, fill: 1 };
  function applyLightingTreatment() {
    sunLight.color.copy(baselineKeyColor);
    if (groundedLighting) sunLight.color.setHex(0xd9e2f2);
    if (filmLighting) sunLight.color.setRGB(...FILM_LIGHT.moon);
    const film = filmLighting ? FILM_LIGHT : null;
    sunLight.intensity =
      baselineKeyIntensity * (groundedLighting ? 0.8 : 1) * (film ? film.key * shotMood.key : 1);
    fillLight.intensity =
      baselineFillIntensity * (groundedLighting ? 1.5 : 1) * (film ? film.fill * shotMood.fill : 1);
    hemisphereLight.intensity = baselineHemisphereIntensity * (film ? film.hemisphere : 1);
    hemisphereLight.groundColor.copy(baselineGroundColor);
    if (filmLighting) hemisphereLight.groundColor.setHex(0x37404a);
    ambientLight.intensity = baselineAmbientIntensity * (film ? film.ambient : 1);
    // Lit, relief-mapped earth shows acne bands at grazing moonlight; bias more.
    sunLight.shadow.bias = filmLighting ? -0.0016 : baselineShadowBias;
    sunLight.shadow.normalBias = filmLighting ? 0.09 : baselineNormalBias;
  }

  const renderTargets = new Set();
  const depthMaterials = new WeakMap();
  const ownedDepthMaterials = new Set();
  let disposed = false,
    compileGeneration = 0;
  let disposeResult = null;

  // Three's color compile does not prepare the separate shadow-depth programs.
  // Borrow only the caster geometry; these probes never draw or enter the live
  // graph. Keep the depth materials until disposal so their program leases hold
  // the warmed variants for WebGLShadowMap's first use.
  function prepareShadowPrograms(valid, timeoutMs) {
    if (!renderer.shadowMap.enabled || !sunLight.castShadow) return Promise.resolve(true);
    const probes = new Group();
    homeScene.traverseVisible((object) => {
      if (!object.castShadow || !object.isMesh) return;
      for (const source of [object.material].flat()) {
        if (!source || source.visible === false) continue;
        let material = object.customDepthMaterial;
        if (!material) {
          material = depthMaterials.get(source);
          if (!material) {
            material = new MeshDepthMaterial({ depthPacking: RGBADepthPacking });
            depthMaterials.set(source, material);
            ownedDepthMaterials.add(material);
          }
          material.side =
            source.shadowSide ??
            (source.side === FrontSide
              ? BackSide
              : source.side === BackSide
                ? FrontSide
                : source.side);
          for (const key of [
            "map",
            "alphaMap",
            "alphaTest",
            "wireframe",
            "displacementMap",
            "displacementScale",
            "displacementBias",
            "clipShadows",
            "clippingPlanes",
            "clipIntersection",
          ])
            material[key] = source[key];
        }
        const probe = new Mesh(object.geometry, material);
        for (const key of ["isInstancedMesh", "instanceMatrix", "instanceColor", "isSkinnedMesh"])
          probe[key] = object[key];
        probes.add(probe);
      }
    });
    return compilePrograms(renderer, probes, sunLight.shadow.camera, homeScene, valid, timeoutMs);
  }

  const rendering = {
    camera,
    compilePrograms,
    programsLinked() {
      const generation = compileGeneration;
      return linkedPrograms(
        renderer,
        renderer.info.programs,
        () => !disposed && generation === compileGeneration,
      );
    },
    composer,
    get disposeResult() {
      return disposeResult;
    },
    homeScene,
    lifecycleOrder: 100,
    // The quality tier last applied (applyQuality), null before.
    tier: null,
    environment,
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
      // Every standard material takes the film sky as its environment; without
      // the film (or a sky) none does.
      homeScene.environment = filmLighting ? environment.capture() : null;
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
    // The sky shell whose film sky the environment captures (index.js).
    setEnvironmentSky(material, shellOpacity) {
      if (!disposed) environment.setSky(material, shellOpacity);
    },
    focusFilmShadow(target, radius) {
      if (disposed || !filmLighting) return;
      // The extent never drops to the shot's own tight subject radius (about
      // 12 for a close detail shot): a shadow camera that small doesn't cover
      // the visible ground in a wide, low, grazing-angle frame, and the area
      // outside its frustum takes the frustum edge's clamped depth-texture
      // value, a hard-edged dark wedge across the ground with no relation to
      // any real occluder. The wide floor costs some shadow resolution on the
      // near subject, whose larger texels also soften the PCF edge.
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
    // The shot's mood over the film balance (film-light.js); intensities only,
    // so a cut never recompiles or redraws the shadow map.
    setShotLight(mood = null) {
      const key = mood?.key ?? 1,
        fill = mood?.fill ?? 1;
      if (disposed || (key === shotMood.key && fill === shotMood.fill)) return false;
      shotMood = { key, fill };
      applyLightingTreatment();
      return true;
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
    // captured programs then poll KHR_parallel_shader_compile instead of blocking a
    // frame. Without that extension the draw would link anyway (and Three warns
    // per call), so it is skipped; the crossfade's own programs and the visible
    // maps are prepared either way. Always settles: true once linked, false if
    // skipped, rejected or still pending after timeoutMs.
    compileShaders(timeoutMs = 2000) {
      if (disposed || renderer.getContext?.()?.isContextLost?.()) return Promise.resolve(false);
      const postprocessReady = postprocessPipeline.compile?.();
      // Snapshot textures and their retirement while transient warm-up flags are current.
      let generation = compileGeneration;
      const retire = () => {
        generation = -1;
      };
      const textures = new Set();
      const capture = (value) => {
        const image = value?.isTexture && !value.isRenderTargetTexture ? value.image : null;
        if (image && image.complete !== false) {
          textures.add(value);
          value.addEventListener("dispose", retire);
        }
      };
      homeScene.traverseVisible((object) => {
        for (const material of [object.material].flat()) {
          if (!material) continue;
          Object.values(material).forEach(capture);
          Object.values(material.uniforms ?? {}).forEach((uniform) => capture(uniform?.value));
        }
      });
      const valid = () => !disposed && generation === compileGeneration;
      let pending = false,
        shadows;
      if (
        typeof renderer.compile === "function" &&
        renderer.extensions?.has?.("KHR_parallel_shader_compile") === true
      ) {
        const previousTarget = renderer.getRenderTarget?.() ?? null;
        try {
          renderer.setRenderTarget?.(composer.readBuffer ?? null);
          pending = compilePrograms(renderer, homeScene, camera, null, valid, timeoutMs);
          shadows = prepareShadowPrograms(valid, timeoutMs);
        } catch {
          pending = false;
        } finally {
          renderer.setRenderTarget?.(previousTarget);
        }
      }
      const deadline = Date.now() + timeoutMs;
      const programs = Promise.all([pending, postprocessReady, shadows]).catch(() => [false]);
      const uploads = loadPreparationTasks().then(({ finishUploads }) =>
        finishUploads(renderer, textures, valid, deadline, programs),
      );
      return new Promise((resolve) => {
        const finish = (ready) => {
          for (const texture of textures) texture.removeEventListener("dispose", retire);
          textures.clear();
          clearTimeout(timer);
          resolve(ready);
        };
        const timer = setTimeout(finish, timeoutMs, false);
        uploads.then(finish, () => finish(false));
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
            material.needsUpdate = true;
          }
        });
      }
      return compiled;
    },
    applyQuality(nextProfile, { pixelRatio } = {}) {
      if (disposed) return false;
      rendering.tier = nextProfile.tier ?? null;
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
        // Three keeps a drawn map at its first size: a step between tiers'
        // sizes frees it, and the next shadow draw allocates one at the new size.
        if (sunLight.shadow.map && sunLight.shadow.map.width !== nextProfile.shadows.mapSize) {
          sunLight.shadow.map.dispose();
          sunLight.shadow.map = null;
        }
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
      homeScene.environment = null;
      environment.dispose();
      ownedDepthMaterials.forEach((material) => material.dispose());
      ownedDepthMaterials.clear();
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
      // Composition offsets move shadow casters.
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
