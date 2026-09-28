import "./quality.js";
import { createSolarBody } from "./solar-body.js";
import { createStarfield } from "./starfield.js";
import { readTourInterval, createCameraTour, TOUR_IDLE } from "./camera-tour.js";
import { resolveSceneModes } from "./scene-modes.js";
import { createLegacyWorld } from "./legacy-world.js";
import { createDeferredWorld } from "./deferred-world.js";
import { createFilmScene } from "./film-scene.js";
import { chooseCinematicView, chooseCinematicAngle, cinematicSafeArea, createCinematicCamera, createQuietScene, layoutRect } from "./cinematic.js";
import { configureMudShading, createSlateContacts, filmGroundSurface } from "./mud-ground.js";
import { ESTATE } from "./estate-layout.js";
import { createRockScatter, estateContacts } from "./rock-scatter.js";
import { createHillSilhouette } from "./hill-silhouette.js";
import { markScene, measureScene, sceneNow } from "./perf-marks.js";
import { createPropScale } from "./prop-scale.js";
import {
  CanvasTexture,
  CircleGeometry,
  ClampToEdgeWrapping,
  ColorManagement,
  Euler,
  Frustum,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  MirroredRepeatWrapping,
  Raycaster,
  RepeatWrapping,
  Sphere,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
} from "three";
import { createArchitectureAssetController } from "./architecture-assets.js";
import { createLanternMount } from "./lantern.js";
import { createCompleteTowerArchitecture, createTowerArchitecture, createTreeArchitecture } from "./architecture.js";
import { createSceneAtmosphere } from "./atmosphere.js";
import { createSceneEnvironment } from "./environment.js";
import { createEstateSkyMaterial } from "./estate-sky.js";
import { createSceneRendering } from "./rendering.js";
import { createWatchtowerRefinement } from "./watchtower-refinement.js";
import {
  createDeferredQualityStep,
  createPanelHold,
  createSceneFrameScheduler,
  createSceneResizeController,
  createShaderWarmup,
  createVisitorHold,
} from "./runtime.js";
import {
  createSceneSubsystemRegistry,
  runSceneInitialization,
} from "./subsystem.js";
import { createSceneTower } from "./tower.js";
// Narrow compatibility injection for the remaining texture, visibility, and
// developer bridges. Scene domains import their Three.js dependencies directly.
const THREE = {
  CanvasTexture, ClampToEdgeWrapping, MirroredRepeatWrapping, RepeatWrapping,
  SRGBColorSpace, Euler, Raycaster, Frustum, Matrix4, Sphere, Vector3,
};

// r128-parity color / light pipeline. ColorManagement.enabled=true (the r152+
// default) treats material+light hex colors as sRGB and converts to linear
// before shading, which shifts every color in the scene. Disabling it when the
// API is available matches the pre-r152 workflow the scene was designed
// against. The renderer init also sets _useLegacyLights (the internal field
// js reads) to keep light intensities on pre-r155 units — the public
// .useLegacyLights accessor logs a deprecation warning on every get, so we
// bypass it.
ColorManagement.enabled = false;
function setSrgbTexture(texture) {
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

(() => {
  const site = (window.BabelSite = window.BabelSite || {}),
    scene = (site.scene = site.scene || {}),
    {
      clamp01: clamp01,
      groundHeight: groundHeight,
      smoothstep01: smoothstep01,
      supportsWebGL: supportsWebGL,
      GROUND_SURFACE_MATERIAL: GROUND_SURFACE_MATERIAL,
      TOWER_SURFACE_MATERIALS: TOWER_SURFACE_MATERIALS,
      PLANT_PALETTE: plantPalette,
      createGroundTextures: createGroundTextures,
      createMarbleTextures: createMarbleTextures,
      createTowerTextures: createTowerTextures,
      createGroundOverlayTexture: createGroundOverlayTexture,
      WORLD: WORLD,
    } = scene;
  scene.initHomeScene = function () {
    const initStart = sceneNow();
    const container = document.getElementById("home-scene");
    if (!container || !supportsWebGL()) return false;
    // Boot order:
    // 1. Renderer + fixed composition
    // 2. Camera-following atmosphere layers
    // 3. Scroll-driven animation loop
    let frameScheduler = null;
    let runtimeDisposed = false;
    let sceneReadyMarked = false;
    // A failed procedural fallback leaves the static poster and stops rendering.
    let sceneFailed = false;
    // Dialogs hold rendering once their dim overlay has faded in (~440ms).
    let panelHold = null;
    // A visitor's Pause scene holds rendering once the scene is revealed.
    let visitorHold = null;
    // Behind a visitor pause, content changes (models, maps, shaders, fonts)
    // still draw one still frame; scroll and tour cuts do not.
    function invalidateContent() {
      visitorHold?.redraw();
      frameScheduler?.invalidate();
    }
    const quietObjects = [];
    const modes = resolveSceneModes(window.location.search);
    const filmEnabled = modes.film;
    let filmActive = false, filmScene = null;
    const groundRepeats = new WeakMap();
    const quietSetting = modes.quiet;
    // The default film ground is the dark cracked slate; comparisons keep theirs.
    const slateGround = modes.ground === "slate";
    let webglContextAvailable = true;
    const reducedMotionMQ = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reducedMotion = Boolean(reducedMotionMQ.matches);
    // quality.js is an explicit bootstrap dependency; use its single set of
    // profiles instead of maintaining a second, silently divergent fallback.
    const fallbackProfile = scene.getSceneQualityProfile("high");
    const fallbackComposition = scene.getSceneCompositionProfile({
      width: window.innerWidth, height: window.innerHeight,
    });
    const qualityState = scene.createSceneQualityState({
      navigatorInfo: navigator, search: window.location?.search || "",
      viewport: { width: window.innerWidth, height: window.innerHeight },
      // The cached WebGL probe already read these limits; null probes again.
      caps: scene.qualityCapsFromProbe?.(site.shared?.getWebGLCapabilities?.()) ?? null,
    });
    const qualityControls = qualityState.controls || {
      debug: false,
      overrideTier: null,
      requestedTier: "auto",
    };
    const qualityDebug = qualityControls.debug ? (window.BabelSite.sceneDebug = {}) : null;
    // ?sceneDebug=1 only: request the lazily split developer chunk now so its
    // download overlaps initialization; the developer camera attaches below.
    // A failed load is reported here even if initialization stops early.
    const developerTools = qualityControls.debug
      ? import("./developer-tools.js").catch((error) => {
          console.warn("Scene developer tools failed to load.", error);
          return null;
        })
      : null;
    // Downloaded models and terrain maps keep the startup tier. Adaptive steps
    // change only per-frame cost (DPR, shadows, post, counts, leaves).
    const assetTier = qualityState.initialTier || fallbackProfile.tier;
    function updateSceneDebug(extra = {}) {
      if (!qualityDebug) return;
      Object.assign(qualityDebug, {
        caps: qualityState.caps || null,
        initialTier: qualityState.initialTier || fallbackProfile.tier,
        overrideTier: qualityControls.overrideTier,
        requestedTier: qualityControls.requestedTier,
        tier: state.profile.tier,
        ...extra,
      });
    }
    let sceneIntersectionObserver = null;
    let sceneVisible = true;
    if (typeof IntersectionObserver === "function") {
      try {
        sceneIntersectionObserver = new IntersectionObserver(
          (entries) => {
            for (const ent of entries) {
              const nextVisible = ent.isIntersecting;
              if (nextVisible === sceneVisible) continue;
              sceneVisible = nextVisible;
              if (sceneVisible) {
                qualityState.holdSampling();
                frameScheduler?.resume();
              }
            }
          },
          {
            threshold: 0,
          },
        );
        sceneIntersectionObserver.observe(container);
      } catch (_err) {
        sceneIntersectionObserver = null;
        sceneVisible = true;
      }
    }
    const state = {
        lowPower: fallbackProfile.isLow,
        profile: fallbackProfile,
      },
      skyWidthSegments = state.profile.geometry.skyWidthSegments,
      skyHeightSegments = state.profile.geometry.skyHeightSegments,
      circleSegments = state.profile.geometry.circleSegments,
      overlaySegments = state.profile.geometry.overlaySegments,
      upperGlowSpriteCount = 0,
      pointFieldCount = state.profile.geometry.pointFieldCount,
      lightingConfig = {
        fogColor: 0x2d3242,
        fogNear: state.profile.lighting.fogNear,
        fogFar: state.profile.lighting.fogFar,
        ambientColor: 0x9e9aa0,
        ambientIntensity: state.profile.lighting.ambientIntensity,
        hemisphereSkyColor: 0x596d96,
        hemisphereGroundColor: 0x20232f,
        hemisphereIntensity: state.profile.lighting.hemisphereIntensity,
        directionalColor: 0xf0bd78,
        directionalIntensity: state.profile.lighting.directionalIntensity,
        fillColor: 0x7486b5,
        fillIntensity: state.profile.lighting.fillIntensity ?? 0.46,
        directionalPosition: {
          x: 32,
          y: 28,
          z: 14,
        },
      },
      skyConfig = {
        skyTopColor: 0x181d2d,
        skyBottomColor: 0x4f4d55,
        skyGlowColor: 0xc0895d,
        sunDirection: new Vector3(...WORLD.SUN_DIRECTION).normalize(),
        sunColor: 0xdfb882,
        shellOpacity: 0.52,
      };
    const subsystemRegistry = createSceneSubsystemRegistry();
    const rendering = createSceneRendering({
      container,
      height: window.innerHeight,
      lighting: lightingConfig,
      onInvalidate() {
        invalidateContent();
      },
      onContextLost() {
        webglContextAvailable = false;
        sceneReadyMarked = false;
        container.classList?.remove("is-ready");
      },
      onContextRestored() {
        webglContextAvailable = true;
        sceneReadyMarked = false;
        qualityState.holdSampling();
        // The restored canvas is blank; a paused scene draws it once.
        visitorHold?.redraw();
        frameScheduler?.resume();
      },
      profile: state.profile,
      threeExports: THREE,
      width: window.innerWidth,
      world: WORLD,
    });
    subsystemRegistry.register(rendering);
    // sceneDebug only: film depth-layer codes, or dissolve weights mid-transition, as grey.
    if (qualityDebug) qualityDebug.showLayers = (on) => { rendering.postprocessPipeline.showLayers(on); invalidateContent(); };
    return runSceneInitialization(subsystemRegistry, () => {
    const { camera, homeScene, renderer } = rendering;
    scene.cinematicSelection ??= chooseCinematicView(window.location.search);
    scene.cinematicAngle ??= chooseCinematicAngle(window.location.search, scene.cinematicSelection);
    let cinematicArea;
    // The hero uses layout geometry so scroll and its reveal/fade transforms do
    // not reframe the camera; the fixed bottom bar keeps its viewport rect.
    const measureCinematicArea = (width, height) => cinematicSafeArea(width, height,
      layoutRect(document.getElementById("hero-minimal")), document.querySelector(".bottom-bar")?.getBoundingClientRect());
    const cinematic = createCinematicCamera({ camera, fog: homeScene.fog, selected: scene.cinematicSelection, angle: scene.cinematicAngle, film: filmEnabled,
      getSafeArea: (width, height) => cinematicArea || measureCinematicArea(width, height),
      getGroundY: (x, z) => groundHeight(x, z) + groundSurface.getWorldPosition(new Vector3()).y });
    subsystemRegistry.register(cinematic);
    const tourInterval = filmEnabled ? readTourInterval(window.location.search) : 0;
    // The tour fits its next shot ahead of the cut in idle slices, one measure
    // or fit each; the latest request wins. Safari has no requestIdleCallback.
    const whenIdle = typeof window.requestIdleCallback === "function"
      ? (task) => window.requestIdleCallback(task, { timeout: 1500 })
      : (task) => window.setTimeout(task, 50);
    let tourShot = null;
    function prepareTourShot(subject, angle) {
      const idle = !tourShot;
      tourShot = [subject, angle];
      if (idle) whenIdle(function step() {
        if (runtimeDisposed) return;
        // A late slot waits out a capture and its crossfade.
        const { capture, progress } = cameraTour?.transition ?? TOUR_IDLE;
        if (capture || progress < 1 ||
          cinematic.prepare(...tourShot, viewport.width, viewport.height) === "pending") whenIdle(step);
        else tourShot = null;
      });
    }
    const cameraTour = tourInterval ? createCameraTour({ camera: cinematic, interval: tourInterval,
      invalidate: () => frameScheduler?.invalidate(), prepare: prepareTourShot }) : null;
    if (cameraTour) subsystemRegistry.register({ dispose: () => cameraTour.dispose() });
    function chooseAnisotropy(minimum, maximum) {
      const profileRange = state.profile.anisotropy || {
        min: minimum,
        max: maximum,
      };
      const lowPowerAnisotropy = Math.max(minimum, profileRange.min ?? minimum);
      const fullAnisotropy = Math.min(maximum, profileRange.max ?? maximum);
      return Math.max(
        1,
        Math.min(renderer.capabilities.getMaxAnisotropy(), state.lowPower ? lowPowerAnisotropy : fullAnisotropy),
      );
    }
    function createMarbleMaterial(textures = {}) {
      return new MeshStandardMaterial({
        color: 0xffffff,
        map: textures.colorMap || null,
        bumpMap: textures.bumpMap || null,
        bumpScale: 0.05,
        roughness: 0.35,
        metalness: 0.05,
      });
    }
    scene.createMarbleMaterial = createMarbleMaterial;
    const visibilityTracker =
      typeof scene.createSceneVisibilityTracker === "function"
        ? scene.createSceneVisibilityTracker({
            THREE,
            camera: camera,
            getVisibleDistance() {
              return Math.min(camera.far, homeScene.fog?.far ?? camera.far);
            },
          })
        : null;
    // Cached at composition-change time so the per-frame getProfileCount calls
    // (~10/frame across decorative systems) don't pay a try/catch boundary or
    // a property-chain walk just to read this scalar.
    let currentCountScale = 1;
    function refreshCountScaleCache() {
      const candidate = compositionState?.profile?.countScale;
      currentCountScale = typeof candidate === "number" ? candidate : 1;
    }
    function getProfileCount(key, fallback) {
      const value = state.profile.counts?.[key];
      const base = typeof value === "number" ? value : fallback;
      if (typeof base !== "number") return base;
      // Composition profile can trim active counts on small viewports where
      // fog already hides most of the affected particles.
      return Math.max(0, Math.floor(base * currentCountScale));
    }
    function setRecordVisibility(records, active, limit = records.length) {
      for (let index = 0; index < records.length; index += 1) {
        const record = records[index];
        const visible = active && index < limit;
        if (record.mesh) record.mesh.visible = visible;
        if (record.meshes) {
          record.meshes.forEach((mesh) => {
            mesh.visible = visible;
          });
        }
      }
    }
    function setShadowParticipation(target, { cast = false, receive = false } = {}) {
      if (!target || typeof target.traverse !== "function") return;
      target.traverse((node) => {
        if ("castShadow" in node) node.castShadow = cast;
        if ("receiveShadow" in node) node.receiveShadow = receive;
      });
    }
    function applyActiveQualityProfile(profile, reason = "runtime") {
      state.profile = profile || fallbackProfile;
      // Built/loaded content follows the pinned asset tier, so an adaptive
      // step can never switch the scene into its low-power construction.
      state.lowPower = assetTier === "low";
      const effectiveCap =
        typeof qualityState.resolveDprCap === "function"
          ? qualityState.resolveDprCap(state.profile)
          : typeof scene.resolveEffectiveDprCap === "function"
            ? scene.resolveEffectiveDprCap(state.profile, {
                caps: qualityState.caps || {},
                touchPrimary: qualityState.touchPrimary,
                navigatorInfo: qualityState.navigatorInfo || navigator,
              })
            : state.profile.dprCap || 1;
      const pixelRatio = Math.min(window.devicePixelRatio || 1, effectiveCap || 1);
      subsystemRegistry.applyQuality(state.profile, { pixelRatio, assetTier });
      updateSceneDebug({
        assetTier,
        // "low" while a resolution-only step holds the current profile at DPR 1.
        governorTier: qualityState.getTier?.(),
        reason,
        pixelRatio,
      });
    }
    const sceneRoot = new Group();
    homeScene.add(sceneRoot);
    const atmosphereSystem = createSceneAtmosphere({
      onInvalidate() {
        invalidateContent();
      },
      parent: homeScene,
      profile: state.profile,
      qualityDebug,
      visibilityTracker,
    });
    subsystemRegistry.register(atmosphereSystem);
    const registerDecorativeSystem = atmosphereSystem.registerDecorativeSystem;
    scene.setClouds = (on) => atmosphereSystem.setClouds(on);
    scene.toggleClouds = () => atmosphereSystem.toggleClouds();
    applyActiveQualityProfile(
      typeof qualityState.getProfile === "function" ? qualityState.getProfile() : fallbackProfile,
      "initial",
    );
    const skyShell = new Mesh(
      new SphereGeometry(WORLD.SKY_DOME_RADIUS, skyWidthSegments, skyHeightSegments),
      createEstateSkyMaterial(skyConfig),
    );
    ((skyShell.renderOrder = -1),
      (skyShell.material.depthWrite = !1),
      atmosphereSystem.root.add(skyShell));
    atmosphereSystem.setSkyMaterial(skyShell.material);
    const solarBody = createSolarBody({
      parent: atmosphereSystem.root, camera,
      position: new Vector3(...WORLD.SUN_POSITION), profile: state.profile,
    });
    subsystemRegistry.register(solarBody);
    registerDecorativeSystem({
      getCenter(target) { return solarBody.root.getWorldPosition(target); },
      group: solarBody.root, importance: "core", name: "sun", radius: 5.5,
    });
    const starfield = createStarfield({ parent: atmosphereSystem.root, camera, profile: state.profile,
      nebulaLayers: skyShell.material.uniforms.uNebulaLayers });
    subsystemRegistry.register(starfield);
    const environmentSystem = createSceneEnvironment({
      groundHeight,
      parent: sceneRoot,
      profile: state.profile,
    });
    subsystemRegistry.register(environmentSystem);
    let classicTree = null;
    const environmentRoot = environmentSystem.root;
    const circleGeometry = new CircleGeometry(WORLD.GROUND_RADIUS, circleSegments, 0, 2 * Math.PI),
      groundPositions = circleGeometry.attributes.position;
    for (let vertexIndex = 0; vertexIndex < groundPositions.count; vertexIndex += 1) {
      const localX = groundPositions.getX(vertexIndex),
        localY = groundPositions.getY(vertexIndex);
      // CircleGeometry's local +Y becomes world -Z after its -X quarter turn.
      // Sample in world coordinates so fallback assets seat on this surface.
      groundPositions.setZ(vertexIndex, groundHeight(localX, -localY));
    }
    circleGeometry.computeVertexNormals();
    let groundSurface = null;
    let groundOverlay = null;
    let currentGroundMuddy = false;
    let currentGrass = null;
    let currentDetail = null;
    // Set once the shader warm-up exists: a ground program that changes before
    // the reveal links through compileAsync instead of blocking the first draw.
    let warmGround = null;
    // The slate's contact darkening (tree roots, lantern, rocks) and detail map
    // slot: uniforms, so rocks arriving or shadows switching never recompile.
    const groundContacts = createSlateContacts(estateContacts());
    subsystemRegistry.register({
      applyQuality(profile) { groundContacts.slateContactGain.value = profile?.shadows?.enabled ? 0.6 : 1; },
    });
    const groundTextures = createGroundTextures({
        THREE: THREE,
        lowPower: state.lowPower,
        qualityProfile: state.profile,
        chooseAnisotropy: chooseAnisotropy,
        search: window.location?.search || "",
        invalidate() {
          invalidateContent();
        },
        onDetailStatus(status) {
          if (status.status === "ready") qualityState.holdSampling();
          if (qualityDebug) qualityDebug.ground = status;
        },
        onGrassStatus(status) {
          if (status.status === "ready") qualityState.holdSampling();
          if (qualityDebug) qualityDebug.grass = status;
        },
        onGrassChange(grassDetail) {
          currentGrass = grassDetail;
          const material = groundSurface?.material;
          if (!material) return;
          const { slate } = filmGroundSurface({ muddy: currentGroundMuddy, film: filmActive, slate: slateGround, surface: GROUND_SURFACE_MATERIAL });
          configureMudShading(material, currentGroundMuddy, quietSetting, filmActive, currentGrass, { slate, detail: currentDetail, contacts: groundContacts });
          warmGround?.();
          invalidateContent();
        },
        onDetailChange({ colorMap, normalMap, normalScale, bumpMap, roughnessMap = null, detailMap = null, muddy = false, filmTiled = false }) {
          const material = groundSurface?.material;
          if (!material) return;
          currentGroundMuddy = muddy;
          currentDetail = detailMap;
          // The slate tint and shading follow the mode, not the published
          // maps, so the procedural loading and fallback surface is slate too.
          const surface = filmGroundSurface({ muddy, film: filmActive, slate: slateGround, surface: GROUND_SURFACE_MATERIAL });
          if (qualityDebug) qualityDebug.groundTreatment = muddy ? "mud" : surface.slate ? "slate" : "baseline";
          configureMudShading(material, muddy, quietSetting, filmActive, currentGrass, { slate: surface.slate, detail: detailMap, contacts: groundContacts });
          warmGround?.();
          for (const texture of [colorMap, normalMap, roughnessMap, bumpMap].filter(Boolean)) {
            if (!groundRepeats.has(texture)) groundRepeats.set(texture, texture.repeat.clone());
            texture.repeat.copy(groundRepeats.get(texture)).multiplyScalar(filmActive && !filmTiled ? 384 / 176 : 1);
          }
          material.map = colorMap;
          material.roughnessMap = roughnessMap;
          material.roughness = surface.roughness;
          material.metalness = surface.metalness;
          material.color.setHex(surface.color);
          if (groundOverlay) groundOverlay.material.opacity = muddy ? .22 : .92;
          material.bumpMap = bumpMap;
          material.normalMap = normalMap;
          material.normalScale.set(normalScale, normalScale);
          material.needsUpdate = true;
          invalidateContent();
        },
      }),
      groundMesh = new Mesh(
        circleGeometry,
        new MeshStandardMaterial({
          color: GROUND_SURFACE_MATERIAL.color,
          map: groundTextures.colorMap,
          bumpMap: groundTextures.bumpMap,
          bumpScale: state.lowPower
            ? GROUND_SURFACE_MATERIAL.bumpScale.lowPower
            : GROUND_SURFACE_MATERIAL.bumpScale.default,
          roughness: GROUND_SURFACE_MATERIAL.roughness,
          metalness: GROUND_SURFACE_MATERIAL.metalness,
        }),
      );
    ((groundMesh.rotation.x = -Math.PI / 2),
      (groundMesh.receiveShadow = !state.lowPower),
      environmentRoot.add(groundMesh));
    groundSurface = groundMesh;
    subsystemRegistry.register(groundTextures);
    // The film ranges are a lazy chunk (mountain-build.js), requested once the film is
    // on at high or balanced (film comparisons keep their backdrop too); they build in
    // slices and land only while unseen (before the reveal, under its fade, on a cut).
    const hillSilhouette = createHillSilhouette({ groundHeight, skyRadius: WORLD.SKY_DOME_RADIUS,
      shellOpacity: skyConfig.shellOpacity, sunPosition: WORLD.SUN_POSITION,
      rendering, tour: cameraTour, invalidate: invalidateContent,
      onStatus: (status) => { if (qualityDebug) qualityDebug.mountains = status; } });
    hillSilhouette.applyQuality(state.profile);
    environmentRoot.add(hillSilhouette.mesh);
    subsystemRegistry.register(hillSilhouette);
    // The film's scattered rocks: loaded once the film is on and the tree has
    // settled (high and balanced only), seated on the film terrain's root
    // supports, committed on a tour cut below.
    const rockScatter = createRockScatter({
      parent: environmentRoot, groundHeight, terrain: () => filmScene.ready, tier: assetTier, anisotropy: chooseAnisotropy(2, 6),
      enabled: filmEnabled && !modes.legacy && modes.rocks,
      compile: () => rendering.compileShaders(), contacts: groundContacts.slateContacts.value,
      onStatus: (status) => { if (qualityDebug) qualityDebug.rocks = status; },
    });
    subsystemRegistry.register(rockScatter);
    const towerSystem = createSceneTower({
      parent: environmentRoot,
      profile: state.profile,
    });
    subsystemRegistry.register(towerSystem);
    const towerRoot = towerSystem.root;
    // Camera-following cloud layers stay centered on the orbiting view.
    const cloudAnchor = new Group();
    cloudAnchor.position.y = -7.5;
    atmosphereSystem.root.add(cloudAnchor);
    atmosphereSystem.setCloudAnchor(cloudAnchor);
    const towerGroundY = groundHeight(0, 0), collapseYaw = 0.32 * Math.PI;
    const architectureEnabled = modes.architecture;
    const completeTowerEnabled = modes.completeTower;
    const classicTowerMeshes = [], baseMasonryRecords = [];
    const effects = [], plinth = [], rubble = [], legacyRubble = [], stones = [], plants = [], plantRecords = [], torches = [], trim = [];
    const filmEffects = [];
    const legacyWorld = createDeferredWorld(registry => createLegacyWorld({
      THREE, TOWER_SURFACE_MATERIALS, WORLD, atmosphereSystem, chooseAnisotropy,
      circleGeometry, clamp01, cloudAnchor, createGroundOverlayTexture,
      createMarbleMaterial, createMarbleTextures, createTowerTextures,
      environmentSystem, filmEffects, filmEnabled, groundHeight, environmentRoot, towerRoot,
      homeScene, invalidate: invalidateContent, overlaySegments,
      plantPalette, pointFieldCount, groundPositions, qualityDebug, quietObjects,
      quietSetting, registerDecorativeSystem, renderer, rendering, towerGroundY,
      collapseYaw, setShadowParticipation, setSrgbTexture, smoothstep01, state,
      subsystemRegistry: registry, towerSystem, upperGlowSpriteCount,
      architectureEnabled, classicTowerMeshes, baseMasonryRecords,
      getProfileCount, setRecordVisibility, cloudViewFade,
    }));
    subsystemRegistry.register(legacyWorld);
    function bindLegacyWorld(world) {
      classicTree = world.classicTree;
      groundOverlay = world.groundOverlay;
      effects.push(...world.effects);
      plinth.push(...world.plinth);
      rubble.push(...world.rubble, ...world.nearbyStones);
      legacyRubble.push(...world.rubble);
      stones.push(...world.stones);
      plants.push(...world.plants);
      plantRecords.push(...world.plantRecords);
      torches.push(...world.torches);
      trim.push(...world.trim);
    }
    if (modes.legacy || state.lowPower) bindLegacyWorld(legacyWorld.ensure());
    // Authored casters and the sun hold still within a shot, so the shadow map
    // redraws only on reported changes. Legacy clutter animates every frame.
    rendering.setStaticShadows(!legacyWorld.current);
    let treeArchitecture = null;
    let towerVisibility = [];
    let treeVisibility = true;
    const groundedWatchtower = modes.grounded;
    const watchtowerRefinement = createWatchtowerRefinement({
      effects, plinth, rubble,
      setLighting(active) { rendering.setGroundedLighting(active); },
    });
    subsystemRegistry.register(watchtowerRefinement);
    const earthFooting = modes.earthFooting;
    const propScale = createPropScale({ groundRoot: environmentRoot, groundHeight: (x, z) => !earthFooting && Math.hypot(x, z) < 17.2 ? Math.max(groundHeight(x, z), towerGroundY + 1.6) : groundHeight(x, z),
      stones, rubble: legacyRubble, plants, plantRecords, torches, trim,
    });
    subsystemRegistry.register(propScale);
    const quietScene = createQuietScene(quietObjects, enabled => {
      environmentSystem.setClutterEnabled(enabled);
      torches.forEach(record => { record.visibilitySystem.enabled = enabled; });
    });
    subsystemRegistry.register(quietScene);
    let completeReady = false, completeTower = null;
    // The orbital sun stays in the directed scene: it is the one warm celestial
    // anchor in an otherwise cool night, and reads as distance rather than clutter.
    filmScene = createFilmScene({ ground: groundSurface, groundHeight, rendering, atmosphere: atmosphereSystem,
      effects: filmEffects, skyMaterial: skyShell.material, foothills: slateGround, invalidate: invalidateContent, tour: cameraTour,
      onGroundChange(active) { environmentSystem.setFilmTreatment(active); hillSilhouette.setFilmTreatment(active); filmActive = active; towerSystem.setFilmTreatment(active); completeTower?.setFilmTreatment(active); groundTextures.setFilmActive(active); rockScatter.setFilmActive(active); },
    });
    subsystemRegistry.register(filmScene);
    // Light shafts: a lazy chunk for high and balanced film on WebGL2 only
    // (light-shafts.js). A failed import leaves the scene as it is; a late one
    // registers nothing.
    if (filmEnabled && !modes.legacy && assetTier != "low" && renderer.capabilities.isWebGL2) {
      import("./light-shafts.js").then(({ lightShafts }) => subsystemRegistry.disposed ||
        subsystemRegistry.register(lightShafts(rendering, cinematic, cameraTour, filmScene, environmentRoot, invalidateContent)), () => {});
    }
    function getReplacedMeshes() {
      const world = legacyWorld.current;
      return completeTowerEnabled && world
        ? [...classicTowerMeshes, world.base, ...(earthFooting ? world.footing : [])]
        : classicTowerMeshes;
    }
    function ensureLegacyWorld() {
      if (runtimeDisposed || legacyWorld.current) return;
      // Capture original legacy transforms before the active treatments borrow
      // them. Model-ready callbacks remain synchronous throughout this path.
      const active = [watchtowerRefinement.active, propScale.active, quietScene.active, filmScene.active];
      filmScene.setActive(false);
      quietScene.setActive(false);
      propScale.setActive(false);
      watchtowerRefinement.setActive(false);
      const world = legacyWorld.ensure();
      if (!world) return;
      bindLegacyWorld(world);
      rendering.setStaticShadows(false);
      watchtowerRefinement.setActive(active[0]);
      propScale.setActive(active[1]);
      quietScene.setActive(active[2]);
      filmScene.setClouds(world.clouds);
      filmScene.setActive(active[3]);
      treeArchitecture?.setFilmTreatment(filmActive);
      if (completeTower) {
        towerVisibility = getReplacedMeshes().map(mesh => [mesh, mesh.visible]);
        towerVisibility.forEach(([mesh]) => { mesh.visible = false; });
      }
      if (treeArchitecture) {
        treeVisibility = classicTree.visible;
        classicTree.visible = false;
      }
      invalidateContent();
    }
    // A failed fallback cannot be revealed or retried. Leave the static poster
    // rather than a partial scene or a loop waiting on a status.
    function stopFailedScene(stage, error) {
      sceneFailed = true;
      container.classList?.remove("is-ready");
      if (qualityDebug) qualityDebug.failure = { stage, message: String(error?.message || error) };
    }
    // Shader warm-up links new programs through compileAsync instead of a
    // blocking first draw. Until the canvas is first shown nothing draws while
    // one is pending; afterwards a committed model that replaces nothing
    // visible stays hidden until its programs are ready.
    let canvasShown = false;
    const shaderWarmup = createShaderWarmup({ compile: () => rendering.compileShaders() });
    // A detail or grass change before the reveal links the ground's new program.
    warmGround = () => canvasShown || warmShaders("ground");
    function warmShaders(label, subject = null) {
      const start = sceneNow();
      shaderWarmup.warm(subject, (ready) => {
        measureScene(`shaders:${label}`, start);
        if (qualityDebug) (qualityDebug.shaders ||= {})[label] = ready ? "ready" : "unwarmed";
        rendering.invalidateShadows();
        invalidateContent();
      });
    }
    const lanternMount = createLanternMount({
      anisotropy: chooseAnisotropy(2, 6),
      camera,
      onPrepared: invalidateContent,
      onChange({ committed, tree }) {
        if (runtimeDisposed) return;
        // Re-measure both lantern shots from the replacement, even though the
        // tree root's matrix is unchanged. Its normalized foot stays on the
        // existing grounded tree-lantern transform.
        cinematic.setSubject("tree", tree?.root ?? null);
        cameraTour?.prepareNext();
        rendering.invalidateShadows();
        qualityState.holdSampling();
        invalidateContent();
        if (committed) warmShaders("lantern");
        if (qualityDebug) qualityDebug.lanternCommitted = committed;
      },
    });
    subsystemRegistry.register(lanternMount);
    const architectureAssets = createArchitectureAssetController({
      disabled: !architectureEnabled,
      towerModel: completeTowerEnabled ? "complete" : "assembled",
      includeLantern: !modes.legacy,
      onLanternReady: (asset) => lanternMount.stage(asset),
      onTowerReady(assets) {
        const assemblyStart = sceneNow();
        const replacement = completeTowerEnabled
          ? createCompleteTowerArchitecture({
            asset: assets.tower, groundY: towerGroundY, footingOffset: earthFooting ? -0.22 : 1.64, anisotropy: chooseAnisotropy(2, 6),
          })
          : createTowerArchitecture({
            assets, groundY: towerGroundY, collapseYaw: collapseYaw,
            baseRecords: baseMasonryRecords, anisotropy: chooseAnisotropy(2, 6),
          });
        const replacedMeshes = getReplacedMeshes();
        try {
          watchtowerRefinement.setActive(completeTowerEnabled && groundedWatchtower);
          completeReady = completeTowerEnabled;
          quietScene.setActive(completeReady && quietSetting);
          propScale.setActive(completeReady && modes.propScale);
          groundTextures.setMudActive?.(completeReady && modes.mud);
          filmScene.setActive(completeReady && filmEnabled);
          treeArchitecture?.setFilmTreatment(filmActive);
          replacement.setFilmTreatment?.(filmActive);
        } catch (error) { replacement.dispose(); throw error; }
        towerVisibility = replacedMeshes.map((mesh) => [mesh, mesh.visible]);
        completeTower = completeTowerEnabled ? replacement : null;
        towerRoot.add(replacement.root);
        cinematic.setSubject("tower", replacement.root);
        replacedMeshes.forEach((mesh) => { mesh.visible = false; });
        rendering.invalidateShadows();
        invalidateContent();
        measureScene("assembly:tower", assemblyStart);
        warmShaders("tower", towerVisibility.some(([, visible]) => visible) ? null : replacement.root);
        return () => {
          if (completeTower === replacement) completeTower = null;
          replacement.dispose();
        };
      },
      onRestoreTower() {
        cinematic.setSubject("tower", null);
        filmScene.setActive(false);
        treeArchitecture?.setFilmTreatment(false);
        quietScene.setActive(false);
        completeReady = false;
        propScale.setActive(false);
        groundTextures.setMudActive?.(false);
        watchtowerRefinement.setActive(false);
        towerVisibility.forEach(([mesh, visible]) => { mesh.visible = visible; });
        towerVisibility = [];
        rendering.invalidateShadows();
        invalidateContent();
      },
      onTreeReady(asset) {
        const assemblyStart = sceneNow();
        const replacement = createTreeArchitecture({ asset, groundHeight, anisotropy: chooseAnisotropy(2, 6), anchor: earthFooting ? [ESTATE.tree.x, ESTATE.tree.z] : [58, 38] });
        replacement.applyQuality(state.profile);
        environmentRoot.add(replacement.root);
        const replacesVisible = Boolean(classicTree?.visible);
        if (classicTree) {
          treeVisibility = classicTree.visible;
          classicTree.visible = false;
        }
        treeArchitecture = replacement;
        lanternMount.setTree(replacement);
        propScale.setTree(replacement);
        replacement.setFilmTreatment(filmActive);
        cinematic.setSubject("tree", replacement.root);
        rendering.invalidateShadows();
        invalidateContent();
        measureScene("assembly:tree", assemblyStart);
        warmShaders("tree", replacesVisible ? null : replacement.root);
        return () => { replacement.dispose(); treeArchitecture = null; };
      },
      onRestoreTree() {
        lanternMount.setTree(null);
        cinematic.setSubject("tree", null);
        treeArchitecture?.setFilmTreatment(false);
        propScale.setTree(null);
        if (classicTree) classicTree.visible = treeVisibility;
        rendering.invalidateShadows();
        invalidateContent();
      },
      onStatus(status) {
        if (status.status === "ready") qualityState.holdSampling();
        // Record the status first: a throwing fallback must not leave the
        // camera waiting on a load that has already ended.
        cinematic.setStatus(status);
        // A model's arrival or loss clears the camera's fits and can change
        // the tour's next shot.
        cameraTour?.prepareNext();
        // The rocks wait for the tree channel to settle either way.
        if (status.kind === "tree") rockScatter.setTreeStatus(status.status);
        if (!runtimeDisposed && status.kind !== "lantern" && (status.status === "fallback" ||
          (status.status === "procedural" && sceneReadyMarked))) {
          try {
            ensureLegacyWorld();
          } catch (error) {
            stopFailedScene("legacy-world", error);
          }
          // The legacy build cycles the film ground off and on, and without the
          // tower it never arrives: the procedural ground shows meanwhile.
          groundTextures.ensureProcedural?.();
        }
        invalidateContent();
        if (qualityDebug) {
          qualityDebug.architecture ||= { mode: architectureEnabled ? (completeTowerEnabled ? "complete" : "assembled") : "classic" };
          qualityDebug.architecture[status.kind] = status;
          qualityDebug.architecture.propScale = propScale.active ? "doorway" : "baseline";
          qualityDebug.architecture.refinement = watchtowerRefinement.active ? "grounded" : "baseline";
        }
      },
    });
    subsystemRegistry.register(architectureAssets);
    subsystemRegistry.register({
      applyQuality(profile) { treeArchitecture?.applyQuality(profile); },
    });
    filmScene.setClouds(legacyWorld.current?.clouds || []);
    const viewport = {
        scrollTarget: 0,
        scroll: 0,
        width: window.innerWidth,
        height: window.innerHeight,
      },
      compositionState = {
        profile: fallbackComposition,
      },
      visibilityScale = 1.15,
      cloudCameraVector = new Vector3(),
      cloudViewVector = new Vector3(),
      cloudOffsetVector = new Vector3(),
      cloudLookTarget = new Vector3();
    function resolveSceneCompositionProfile() {
      return typeof scene.getSceneCompositionProfile === "function"
        ? scene.getSceneCompositionProfile({
            width: viewport.width,
            height: viewport.height,
          })
        : fallbackComposition;
    }
    function applySceneComposition(profile, reason = "runtime") {
      compositionState.profile = profile || fallbackComposition;
      refreshCountScaleCache();
      updateSceneDebug({
        composition: compositionState.profile.name,
        compositionReason: reason,
      });
    }
    function cloudViewFade(
      point,
      fadeStartDistance,
      fadeDistanceRange,
      sightlineClearance,
      sightlineFadeRange,
      sightlineExtent = 0.92,
      minOpacity = 0.14,
    ) {
      const cameraDistance = cloudCameraVector.copy(point).distanceTo(camera.position),
        distanceFade = clamp01((cameraDistance - fadeStartDistance) / fadeDistanceRange);
      cloudViewVector.copy(cloudLookTarget).sub(camera.position);
      const sightlineLength = cloudViewVector.length();
      if (!(sightlineLength > 1e-3)) return distanceFade;
      (cloudViewVector.multiplyScalar(1 / sightlineLength),
        cloudOffsetVector.copy(point).sub(camera.position));
      const alongSightline = cloudOffsetVector.dot(cloudViewVector);
      if (alongSightline <= 0 || alongSightline >= sightlineLength * sightlineExtent) return distanceFade;
      const sightlineOffset = cloudOffsetVector.addScaledVector(cloudViewVector, -alongSightline).length(),
        sightlineFade = clamp01((sightlineOffset - sightlineClearance) / sightlineFadeRange);
      return Math.max(minOpacity, Math.min(distanceFade, sightlineFade));
    }
    function applySceneSize({ width, height }) {
      qualityState.holdSampling();
      cinematicArea = measureCinematicArea(width, height);
      ((viewport.width = width),
        (viewport.height = height),
        applySceneComposition(resolveSceneCompositionProfile(), "resize"),
        applyActiveQualityProfile(state.profile, "resize"));
      subsystemRegistry.resize({
        cameraFov:
          compositionState.profile.camera?.fov ?? fallbackComposition.camera.fov,
        composition: compositionState.profile,
        height,
        width,
      });
      // Resizing clears the canvas; draw one frame behind an open dialog or
      // a visitor pause.
      panelHold?.redraw();
      visitorHold?.redraw();
      frameScheduler?.invalidate();
      cameraTour?.prepareNext();
    }
    // The scene fills its fixed, full-bleed container. On iPhone Safari that
    // box can outgrow innerHeight (collapsing or translucent toolbars,
    // standalone mode), so the drawing buffer follows the container's own
    // size, and a ResizeObserver catches changes that fire no window resize.
    const resizeController = createSceneResizeController({
      onResize: applySceneSize,
      readSize() {
        const rect = container?.getBoundingClientRect?.();
        const measured = rect && rect.width > 0 && rect.height > 0;
        return {
          height: measured ? Math.round(rect.height) : window.innerHeight,
          pixelRatio: window.devicePixelRatio || 1,
          width: measured ? Math.round(rect.width) : window.innerWidth,
        };
      },
    });
    const containerResizeObserver =
      typeof ResizeObserver === "function" && container ? new ResizeObserver(() => resizeController.resize()) : null;
    containerResizeObserver?.observe(container);
    // viewport.height is refreshed inside applySceneSize (the resize handler)
    // on every resize, so reading it inside the scroll handler avoids a
    // layout-flushing window.innerHeight access per scroll event.
    const onWindowResize = () => resizeController.resize();
    const onFontsLoaded = () => { cinematicArea = measureCinematicArea(viewport.width, viewport.height); cameraTour?.prepareNext(); invalidateContent(); };
    document.fonts?.addEventListener?.("loadingdone", onFontsLoaded);
    const onWindowScroll = () => {
      viewport.scrollTarget = Math.min(window.scrollY / (1.8 * viewport.height), 1.25);
      frameScheduler?.invalidate();
    };
    window.addEventListener("resize", onWindowResize);
    window.addEventListener("scroll", onWindowScroll, {
      passive: !0,
    });
    resizeController.update({ force: true });
    const orbitStartAngle = 0.12 * Math.PI;
    let debugRenderFrameCount = 0;
    let debugRenderWindowStart = null;
    let firstFrameDrawn = false;
    // Governor steps link their programs at once and apply on a tour cut.
    const adaptiveSteps = createDeferredQualityStep({ prepare: (profile) => rendering.prepareQuality(profile) });
    function updateSceneFrame({
      deltaSeconds,
      elapsedSeconds: elapsedTime,
      sampleDeltaSeconds,
      timestamp,
    }) {
      const frameStart = firstFrameDrawn ? 0 : sceneNow();
      // Samples are rAF intervals, not render cost; take them only while the
      // revealed scene animates continuously, outside a post-event hold, and
      // not while a step waits for its cut.
      const revealed = sceneReadyMarked && cinematic.ready;
      const nowMs = 1e3 * elapsedTime;
      const sampledProfile = revealed && !reducedMotion && !adaptiveSteps.pending
        ? qualityState.sampleRevealed?.({ frameMs: 1e3 * sampleDeltaSeconds,
          nowMs, timestamp, profile: state.profile })
        : null;
      if (sampledProfile) adaptiveSteps.queue(sampledProfile, nowMs);
      const tourPhase = cameraTour?.update({ elapsedSeconds: elapsedTime, reducedMotion,
        developer: Boolean(scene.devMode?.active), panelOpen: document.body.hasAttribute("data-panel-open") }) ?? null;
      const transition = cameraTour?.transition ?? TOUR_IDLE;
      // Each step changes the tier or, below balanced, only the pixel ratio. A
      // running tour takes it on a cut, where the crossfade's kept frame hides
      // its one-off work.
      const adaptiveProfile = adaptiveSteps.take({ cut: transition.cut, running: cameraTour?.running === true, nowMs });
      if (adaptiveProfile) applyActiveQualityProfile(adaptiveProfile, "adaptive");
      lanternMount.take({ revealed: canvasShown, running: cameraTour?.running === true, cut: transition.cut });
      // The rocks appear on a cut too, with their ground contacts.
      if (rockScatter.take({ cut: transition.cut, running: cameraTour?.running === true, nowMs })) {
        groundContacts.slateRockContact.value = 1;
        rendering.invalidateShadows();
        qualityState.holdSampling();
        invalidateContent();
      }
      // The capture, cut and first dissolve frames carry one-off work, not load.
      // A frame samples the interval before it, so this frame's sample (above)
      // predates the capture; the next three cover capture, cut and dissolve.
      if (transition.capture) qualityState.skipSamples?.(3);
      rendering.postprocessPipeline.setTransition?.(transition);
      const activeProfile = state.profile,
        cameraProfile = compositionState.profile.camera || fallbackComposition.camera,
        orbitMotionScale = 1;
      viewport.scroll = reducedMotion
        ? viewport.scrollTarget
        : viewport.scroll + 0.025 * (viewport.scrollTarget - viewport.scroll);
      const orbitSpeed = activeProfile.isLow ? 0.055 : 0.06,
        orbitTravel = elapsedTime * (0.95 * orbitSpeed) * orbitMotionScale,
        orbitWobble = 0.09 * Math.sin(3 * orbitTravel) + 0.05 * Math.sin(2 * orbitTravel),
        orbitAngle = orbitStartAngle + orbitTravel - orbitWobble,
        scrolledOrbitBase = cameraProfile.orbitBase - cameraProfile.orbitScrollDelta * viewport.scroll,
        orbitHeight =
          cameraProfile.heightBase +
          cameraProfile.heightScrollDelta * viewport.scroll +
          0.45 * Math.sin(0.28 * elapsedTime) * orbitMotionScale +
          0.6 * Math.sin(0.13 * elapsedTime) * orbitMotionScale,
        lookAtHeight = cameraProfile.lookAtBase + cameraProfile.lookAtScrollDelta * viewport.scroll,
        orbitDistance = cameraProfile.orbitScale * (scrolledOrbitBase - cameraProfile.orbitTrim);
      const cinematicApplied = cinematic.apply({ width: viewport.width, height: viewport.height,
        elapsedSeconds: elapsedTime, reducedMotion, developer: Boolean(scene.devMode?.active), tourPhase, fallbackFov: cameraProfile.fov || 45 });
      if (scene.devMode?.active && typeof scene.devMode.update === "function") scene.devMode.update(camera, deltaSeconds);
      else if (!cinematicApplied) { camera.position.set(Math.cos(orbitAngle) * orbitDistance, orbitHeight, Math.sin(orbitAngle) * orbitDistance); camera.lookAt(0, lookAtHeight, 0); }
      cloudAnchor.position.x = camera.position.x;
      cloudAnchor.position.z = camera.position.z;
      if (cinematicApplied) cloudLookTarget.copy(cinematic.target); else cloudLookTarget.set(0, lookAtHeight, 0);
      subsystemRegistry.update({
          deltaSeconds,
          elapsedSeconds: elapsedTime,
          motionPaused: visitorHold?.paused || document.body.hasAttribute("data-panel-open"),
          reducedMotion,
          render: false,
          visibilityScale: visibilityScale,
        });
      legacyWorld.current?.update({ elapsedTime, quiet: quietScene.active, grounded: watchtowerRefinement.active, visibilityScale });
      watchtowerRefinement.enforceVisibility();
      quietScene.enforce();
      if (filmActive) filmScene.finishFrame(camera, cloudLookTarget, cinematic.frame,
        viewport.width < 900 && cinematic.shot?.arc === 2, (cinematicArea?.top || 200) / viewport.height);
      if (qualityDebug) qualityDebug.cinematic = { tour: cameraTour ? { ...cameraTour.state, transition: { ...transition } } : null, film: filmActive, shot: cinematic.shot?.name, selected: cinematic.selected, angle: cinematic.angle + 1, current: cinematic.current, quiet: quietScene.active };
      // Drawing while a warm-up links would block on it; the hidden canvas waits.
      if (canvasShown || !shaderWarmup.pending) {
        rendering.update();
        if (!firstFrameDrawn) {
          firstFrameDrawn = true;
          measureScene("first-frame", frameStart);
        }
      }
      panelHold?.frameRendered();
      visitorHold?.frameRendered();
      if (qualityDebug) {
        // Linked programs: a first crossfade or quality step should add none.
        qualityDebug.programs = renderer.info?.programs?.length ?? null;
        debugRenderWindowStart ??= timestamp;
        debugRenderFrameCount += 1;
        const debugRenderWindowMs = timestamp - debugRenderWindowStart;
        if (debugRenderWindowMs >= 500) {
          qualityDebug.renderFps = (1e3 * debugRenderFrameCount) / debugRenderWindowMs;
          debugRenderFrameCount = 0;
          debugRenderWindowStart = timestamp;
        }
      }
      if (!sceneReadyMarked) {
        sceneReadyMarked = true;

        architectureAssets.setQuality(state.profile, true, { assetTier });
      }
      const sceneShown = !sceneFailed && (cinematic.ready || Boolean(scene.devMode?.active)) &&
        (canvasShown || !shaderWarmup.pending);
      if (sceneShown && !canvasShown) {
        markScene("reveal");
        // The rocks fetch and link only after the reveal, off its critical path.
        rockScatter.setRevealed();
      }
      canvasShown = sceneShown;
      container?.classList.toggle("is-ready", sceneShown);
      // Until the reveal, the transparent canvas redraws only when invalidated
      // (status, model commit, resize) instead of animating through downloads.
      frameScheduler?.setStill(!sceneShown);
      // A paused visitor keeps the first revealed frame.
      if (sceneShown) visitorHold?.reveal();
    }
    frameScheduler = createSceneFrameScheduler({
      // Renders land evenly on every nth vsync near 60 Hz (144 Hz draws 72
      // fps); touch screens stay at or below 60 to save battery.
      displayCadence: { baseRate: 60, round: qualityState.touchPrimary ? "ceil" : "floor" },
      isRenderable() {
        return !document.hidden && sceneVisible && webglContextAvailable && !sceneFailed;
      },
      onUpdate: updateSceneFrame,
      reducedMotion,
      targetFrameRate: 60,
    });
    const onReducedMotionChange = (event) => {
      reducedMotion = Boolean(event?.matches);
      frameScheduler.setReducedMotion(reducedMotion);
    };
    if (typeof reducedMotionMQ.addEventListener === "function") {
      reducedMotionMQ.addEventListener("change", onReducedMotionChange);
    } else if (typeof reducedMotionMQ.addListener === "function") {
      reducedMotionMQ.addListener(onReducedMotionChange);
    }
    const onDocumentVisibilityChange = () => {
      if (document.hidden) return;
      qualityState.holdSampling();
      frameScheduler.resume();
    };
    document.addEventListener("visibilitychange", onDocumentVisibilityChange);
    // panels.js marks <body data-panel-open> while any dialog is open. The tour
    // already holds; after the dim overlay fades in, the backdrop stops redrawing.
    panelHold = createPanelHold({
      delayMs: 450,
      isOpen: () => document.body.hasAttribute("data-panel-open"),
      onRelease: () => qualityState.holdSampling(),
      scheduler: frameScheduler,
    });
    const panelObserver =
      typeof MutationObserver === "function" ? new MutationObserver(() => panelHold.sync()) : null;
    panelObserver?.observe(document.body, { attributes: true, attributeFilter: ["data-panel-open"] });
    panelHold.sync();
    // The footer's Pause scene control stops the tour, drift and clouds and
    // holds rendering. The UI may leave a stored choice in
    // visitorPausedPreference before this bundle loads.
    visitorHold = createVisitorHold({
      onRelease: () => qualityState.holdSampling(),
      scheduler: frameScheduler,
    });
    scene.setVisitorPaused = (paused) => {
      const next = Boolean(paused);
      scene.visitorPausedPreference = next;
      cameraTour?.setPaused(next);
      return visitorHold.set(next);
    };
    scene.isVisitorPaused = () => visitorHold.paused;
    scene.setVisitorPaused(scene.visitorPausedPreference === true);
    // The developer camera hides all page UI, so only diagnostic sessions
    // (?sceneDebug=1) get its activation key. It and Three's OutlinePass live
    // in a lazily imported chunk that default visitors never request. That
    // request started above, and initHomeScene is synchronous, so attach runs
    // after init returns, once the chunk has arrived (normally by then).
    // dispose() is safe without attach.
    developerTools
      ?.then((tools) => {
        if (!tools || runtimeDisposed || typeof scene.devMode?.attach !== "function") return;
        scene.devMode.attach({
          THREE,
          camera,
          homeScene,
          canvas: renderer.domElement,
          ensureOutlinePass: () => rendering.ensureOutlinePass(tools.createOutlinePass),
          // The developer camera hides the Pause scene control, so it renders
          // through a visitor pause and restores the held frame on exit.
          onActivityChange(active) {
            visitorHold.suspend(active);
            frameScheduler.setForceAnimation(active);
          },
        });
      })
      .catch((error) => console.warn("Scene developer tools failed to attach.", error));
    // A local authoring action only. Its exporter stays in a separate chunk
    // and is fetched only when explicitly called, never during scene startup.
    if (qualityControls.debug && ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname)) {
      let exporting = false;
      scene.exportBlenderSnapshot = async (options = {}) => {
        if (exporting) throw new Error("A Blender snapshot is already being exported.");
        if (runtimeDisposed || !canvasShown || shaderWarmup.pending || scene.devMode?.active)
          throw new Error("Wait for the scene to finish loading and leave the developer camera before exporting.");
        const architecture = qualityDebug?.architecture;
        if (architectureEnabled && ["high", "balanced"].includes(assetTier)) {
          const required = modes.legacy ? ["tower", "tree"] : ["tower", "tree", "lantern"];
          if (required.some((kind) => architecture?.[kind]?.status !== "ready") || (!modes.legacy && !lanternMount.committed))
            throw new Error("The complete architecture and lantern must finish loading before export.");
        }
        if (filmEnabled && !modes.legacy && modes.rocks && ["high", "balanced"].includes(assetTier) && !rockScatter.committed)
          throw new Error("Wait for the scattered rocks to finish loading before export.");
        if ([qualityDebug?.ground, qualityDebug?.grass].some((entry) => entry?.status === "loading"))
          throw new Error("Wait for the ground textures to finish loading before export.");
        exporting = true;
        const wasPaused = scene.isVisitorPaused();
        scene.setVisitorPaused(true);
        try {
          const { exportBlenderSnapshot } = await import("./blender-export.js");
          if (runtimeDisposed) throw new Error("The scene was closed before export.");
          return await exportBlenderSnapshot({
            ...options, scene: homeScene, camera, location: window.location,
            viewport: { width: viewport.width, height: viewport.height },
            metadata: {
              selection: qualityDebug?.cinematic?.current ?? scene.cinematicSelection,
              angle: qualityDebug?.cinematic?.angle ?? scene.cinematicAngle,
              shot: qualityDebug?.cinematic?.shot,
              tier: state.profile.tier, assetTier, architecture,
              rocks: qualityDebug?.rocks, ground: qualityDebug?.ground,
              browserEffects: "Blender approximates film shaders, fog, clouds, wet ground and postprocessing.",
            },
          });
        } finally {
          exporting = false;
          if (!runtimeDisposed) scene.setVisitorPaused(wasPaused);
        }
      };
    }
    scene.disposeHomeSceneRuntime = function disposeHomeSceneRuntime() {
      if (runtimeDisposed) return false;
      runtimeDisposed = true;
      sceneReadyMarked = false;
      container.classList?.remove("is-ready");
      document.fonts?.removeEventListener?.("loadingdone", onFontsLoaded);
      window.removeEventListener("resize", onWindowResize);
      window.removeEventListener("scroll", onWindowScroll);
      document.removeEventListener("visibilitychange", onDocumentVisibilityChange);
      if (typeof reducedMotionMQ.removeEventListener === "function") {
        reducedMotionMQ.removeEventListener("change", onReducedMotionChange);
      } else if (typeof reducedMotionMQ.removeListener === "function") {
        reducedMotionMQ.removeListener(onReducedMotionChange);
      }
      sceneIntersectionObserver?.disconnect();
      sceneIntersectionObserver = null;
      panelObserver?.disconnect();
      panelHold.dispose();
      visitorHold.dispose();
      containerResizeObserver?.disconnect();
      resizeController.dispose();
      frameScheduler.dispose();
      if (scene.devMode && typeof scene.devMode.dispose === "function") {
        scene.devMode.dispose();
      }
      subsystemRegistry.dispose();
      const disposedResources = rendering.disposeResult;
      frameScheduler = null;
      delete scene.exportBlenderSnapshot;
      scene.setClouds = () => false;
      scene.toggleClouds = () => false;
      scene.setVisitorPaused = () => false;
      scene.isVisitorPaused = () => false;
      scene.disposeHomeSceneRuntime = () => false;
      return disposedResources;
    };
    warmShaders("scene");
    frameScheduler.start();
    measureScene("init", initStart);
    return true;
    });
  };
})();
