import "./quality.js";
import { createSolarBody, SOLAR_RADIUS } from "./solar-body.js";
import { LENS_FX, lensKeepRect, lensSource } from "./postprocess.js";
import { openingStar, watchMeasure } from "./opening-star.js";
import { measureShot } from "./directed-shots.js";
import { createStarfield } from "./starfield.js";
import { readTourInterval, createCameraTour, TOUR_IDLE, TOUR_TRANSITION } from "./camera-tour.js";
import { createFilmScene } from "./film-scene.js";
import { resolveSceneOpening } from "./scene-modes.js";
import {
  cinematicSafeArea,
  letterboxShare,
  createCinematicCamera,
  isStackedLayout,
  layoutRect,
} from "./cinematic.js";
import {
  COAST_MOOD,
  GLINT_MOOD,
  GRASS_MOOD,
  LANTERN_MOOD,
  STONE_MOOD,
  shotLight,
} from "./film-light.js";
import {
  configureGroundShading,
  createSlateContacts,
  filmGroundSurface,
  slateCalmFor,
} from "./mud-ground.js";
import { ESTATE, estateLantern } from "./estate-layout.js";
import { isWalkKey, walkAllowed } from "./walk-key.js";
import { createRockScatter, estateContacts } from "./rock-scatter.js";
import { createHillSilhouette } from "./hill-silhouette.js";
import { createLightning } from "./lightning.js";
import { createFarFires } from "./far-fires.js";
import { markScene, measureScene, sceneNow } from "./perf-marks.js";
import { createPropScale } from "./prop-scale.js";
import {
  CanvasTexture,
  CircleGeometry,
  ColorManagement,
  Group,
  Mesh,
  MeshStandardMaterial,
  MirroredRepeatWrapping,
  Object3D,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
} from "three";
import { createArchitectureAssetController, loadArchitectureAsset } from "./architecture-assets.js";
import { createLanternMount } from "./lantern.js";
import { createTreeArchitecture, prepareArchitecture } from "./architecture.js";
import { createSceneAtmosphere } from "./atmosphere.js";
import { createSceneEnvironment } from "./environment.js";
import {
  advanceMist,
  lendMistText,
  setMistDatum,
  setMistLights,
  setMistShot,
  setMistTier,
} from "./drifting-mist.js";
import {
  CLOUD_VORTEX,
  cloudVortexCenter,
  cloudVortexInSeason,
  cloudVortexPresent,
  createEstateSkyMaterial,
} from "./estate-sky.js";
import { createSceneRendering } from "./rendering.js";
import {
  createDeferredQualityStep,
  createPixelRatioWatcher,
  createSceneFrameScheduler,
  createSceneResizeController,
  createShaderWarmup,
  createVisitorHold,
} from "./runtime.js";
import { createSceneSubsystemRegistry, runSceneInitialization } from "./subsystem.js";
// Narrow compatibility injection for the procedural ground textures. Scene
// domains import their Three.js dependencies directly.
const THREE = {
  CanvasTexture,
  MirroredRepeatWrapping,
  SRGBColorSpace,
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

// The orbit the hidden canvas keeps until a directed shot is ready: its start
// angle and its speed in radians per second, before a 0.95 easing.
const ORBIT_START_ANGLE = 0.12 * Math.PI;
const ORBIT_SPEED = 0.06;

(() => {
  const site = (window.BabelSite = window.BabelSite || {});
  const scene = (site.scene = site.scene || {});
  const { groundHeight, supportsWebGL, GROUND_SURFACE_MATERIAL, createGroundTextures, WORLD } =
    scene;
  scene.initHomeScene = function () {
    const createOpeningPreparation = site.shared?.createOpeningPreparation;
    if (typeof createOpeningPreparation !== "function") return false;
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
    // A failed authored model leaves the static title card and stops rendering.
    let sceneFailed = false;
    // A visitor pause (scene.setVisitorPaused) holds rendering once revealed.
    let visitorHold = null;
    // Behind a visitor pause, content changes (models, maps, shaders, fonts)
    // still draw one still frame; scroll and tour cuts do not.
    function invalidateContent() {
      visitorHold?.redraw();
      frameScheduler?.invalidate();
    }
    let filmActive = false,
      filmScene = null;
    const groundRepeats = new WeakMap();
    let webglContextAvailable = true,
      retireOpening = () => {};
    const reducedMotionMQ = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reducedMotion = Boolean(reducedMotionMQ.matches);
    // The fixed geometry (sky and ground segments) and the renderer's first
    // lighting come from the high profile; applyActiveQualityProfile then
    // applies the startup tier.
    const highProfile = scene.getSceneQualityProfile("high");
    const qualityState = scene.createSceneQualityState({
      navigatorInfo: navigator,
      search: window.location?.search || "",
      viewport: { width: window.innerWidth, height: window.innerHeight },
      // The cached WebGL probe already read these limits; null probes again.
      caps: scene.qualityCapsFromProbe?.(site.shared?.getWebGLCapabilities?.()) ?? null,
    });
    // The low tier keeps the static title card. main.js normally decides this
    // before the scene bundle loads; this covers an unknown probe there.
    if (qualityState.initialTier === "low") return false;
    const qualityControls = qualityState.controls;
    // ?sceneDebug=1: a plain status object for captures and checks
    // (docs/SCENE-MODES.md). It has no controls of its own.
    const qualityDebug = qualityControls.debug ? (window.BabelSite.sceneDebug = {}) : null;
    // Downloaded models and terrain maps keep the startup tier. Adaptive steps
    // change only per-frame cost (DPR, shadows, post).
    const assetTier = qualityState.initialTier;
    function updateSceneDebug(extra = {}) {
      if (!qualityDebug) return;
      Object.assign(qualityDebug, {
        caps: qualityState.caps || null,
        initialTier: qualityState.initialTier,
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
        profile: highProfile,
      },
      skyWidthSegments = state.profile.geometry.skyWidthSegments,
      skyHeightSegments = state.profile.geometry.skyHeightSegments,
      circleSegments = state.profile.geometry.circleSegments,
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
        // The star and the shell's radius place the cloud vortex's eye (estate-sky.js).
        starPosition: WORLD.SUN_POSITION,
        skyRadius: WORLD.SKY_DOME_RADIUS,
      };
    const subsystemRegistry = createSceneSubsystemRegistry();
    const rendering = createSceneRendering({
      container,
      debugShaders: qualityControls.debug,
      height: window.innerHeight,
      lighting: lightingConfig,
      onInvalidate() {
        invalidateContent();
      },
      onContextLost() {
        webglContextAvailable = false;
        retireOpening();
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
      width: window.innerWidth,
      world: WORLD,
    });
    subsystemRegistry.register(rendering);
    return runSceneInitialization(subsystemRegistry, () => {
      const { camera, homeScene, renderer } = rendering;
      const opening = resolveSceneOpening(window.location.search, {
        view: scene.cinematicSelection,
        angle: scene.cinematicAngle,
      });
      scene.cinematicSelection = opening.view;
      scene.cinematicAngle = opening.angle;
      rendering.openingPreparing = opening.view === "tree";
      let cinematicArea;
      // The hero uses layout geometry so scroll and its reveal/fade transforms do
      // not reframe the camera; the fixed bottom bar keeps its viewport rect.
      const cinematicGroundY = (x, z) =>
        groundHeight(x, z) + groundSurface.getWorldPosition(new Vector3()).y;
      const measureCinematicArea = (width, height) =>
        cinematicSafeArea(
          width,
          height,
          layoutRect(document.getElementById("hero-minimal")),
          document.querySelector(".bottom-bar")?.getBoundingClientRect(),
        );
      // The watch's marker (below) is measured by the lookout's stored outline for the
      // startup tier (opening-star.js watchMeasure()); the tree as it stands.
      const measureWatch = watchMeasure(assetTier);
      let watchRoot = null;
      const cinematic = createCinematicCamera({
        camera,
        fog: homeScene.fog,
        selected: scene.cinematicSelection,
        angle: scene.cinematicAngle,
        getSafeArea: (width, height) => cinematicArea || measureCinematicArea(width, height),
        getGroundY: (x, z) => cinematicGroundY(x, z),
        measure: (root, shot) =>
          root === watchRoot ? measureWatch(root, shot) : measureShot(root, shot),
      });
      subsystemRegistry.register(cinematic);
      const tourInterval = readTourInterval(window.location.search);
      // The tour fits its next shot ahead of the cut in idle slices, one measure
      // or fit each; the latest request wins. Safari has no requestIdleCallback.
      const whenIdle =
        typeof window.requestIdleCallback === "function"
          ? (task) => window.requestIdleCallback(task, { timeout: 1500 })
          : (task) => window.setTimeout(task, 50);
      let tourShot = null;
      function prepareTourShot(subject, angle) {
        const idle = !tourShot;
        tourShot = [subject, angle];
        if (idle)
          whenIdle(function step() {
            if (runtimeDisposed) return;
            // A late slot waits out a capture and its crossfade.
            const { capture, progress } = cameraTour?.transition ?? TOUR_IDLE;
            if (
              capture ||
              progress < 1 ||
              cinematic.prepare(...tourShot, viewport.width, viewport.height) === "pending"
            )
              whenIdle(step);
            else tourShot = null;
          });
      }
      const cameraTour = tourInterval
        ? createCameraTour({
            camera: cinematic,
            interval: tourInterval,
            invalidate: () => frameScheduler?.invalidate(),
            prepare: prepareTourShot,
          })
        : null;
      // The walk (walk.js, a lazy chunk fetched on the first ` or ~): the visitor's
      // first-person camera on the ground. While it holds the tour, its own cuts
      // are the tour's for everything that lands only unseen (terrain, banks,
      // mountains, rocks, the lantern, governor steps), and no shot is on screen.
      let walk = null,
        walkLoad = null,
        walkGround = null;
      const liveView = {
        get running() {
          return walk?.holdsTour === true || cameraTour?.running === true;
        },
        get transition() {
          return walk?.transition ?? cameraTour?.transition ?? TOUR_IDLE;
        },
      };
      const shotOnScreen = () => (walk?.drives ? null : cinematic.shot);
      // Seconds until the tour's next capture (Infinity without a running tour), set
      // each frame; the lightning dims a flash to nothing by then (LIGHTNING.cutFade).
      let tourCutIn = Infinity;
      if (cameraTour) subsystemRegistry.register({ dispose: () => cameraTour.dispose() });
      // The current profile's anisotropy, within the caller's maximum and the GPU's.
      function chooseAnisotropy(maximum) {
        const cap = Math.min(maximum, state.profile.anisotropy.max);
        return Math.max(1, Math.min(renderer.capabilities.getMaxAnisotropy(), cap));
      }
      function applyActiveQualityProfile(profile, reason = "runtime") {
        state.profile = profile;
        const pixelRatio = Math.min(
          window.devicePixelRatio || 1,
          qualityState.resolveDprCap(state.profile),
        );
        // Built and loaded content follows the pinned asset tier (context).
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
        parent: homeScene,
        profile: state.profile,
      });
      subsystemRegistry.register(atmosphereSystem);
      applyActiveQualityProfile(qualityState.getProfile(), "initial");
      // Spooky October's storm, the lightning and the maelstrom, comes by the
      // visitor's own calendar month when the scene starts (lightning.js
      // LIGHTNING.months, estate-sky.js CLOUD_VORTEX.months).
      const sceneDate = new Date();
      const vortexSeason = cloudVortexInSeason(sceneDate);
      // The slate's contact darkening (tree roots, lantern, rocks) and detail map
      // slot: uniforms, so rocks arriving or shadows switching never recompile.
      // Its text boxes also guard the sky's cloud banks (and the stars behind them).
      const groundContacts = createSlateContacts(estateContacts());
      const skyShell = new Mesh(
        new SphereGeometry(WORLD.SKY_DOME_RADIUS, skyWidthSegments, skyHeightSegments),
        createEstateSkyMaterial(skyConfig, groundContacts),
      );
      skyShell.renderOrder = -1;
      skyShell.material.depthWrite = false;
      // Until a shot takes it, and always out of season, the maelstrom's reach stays
      // below 0: none of it (estate-sky.js).
      skyShell.material.uniforms.uVortex.value.z = -1;
      atmosphereSystem.root.add(skyShell);
      atmosphereSystem.setSkyMaterial(skyShell.material);
      // The film's environment is captured from this shell's film sky.
      rendering.setEnvironmentSky(skyShell.material, skyConfig.shellOpacity);
      // The lens keeps its heat, fringes and flare off the same text boxes.
      rendering.postprocessPipeline.setTextGuard?.(groundContacts);
      const solarBody = createSolarBody({
        parent: atmosphereSystem.root,
        camera,
        position: new Vector3(...WORLD.SUN_POSITION),
        profile: state.profile,
      });
      subsystemRegistry.register(solarBody);
      // The stars borrow the shell's uniforms, so they hide behind its cloud banks.
      const starfield = createStarfield({
        parent: atmosphereSystem.root,
        camera,
        profile: state.profile,
        sky: skyShell.material.uniforms,
        skyRadius: WORLD.SKY_DOME_RADIUS,
      });
      subsystemRegistry.register(starfield);
      // The film storm's lightning (lightning.js): flashes in the shell's banks,
      // now and then a far bolt beside the stars, and the flash on the lights,
      // on its own clock and only in film. Created before the first warm-up,
      // which links the bolt's program.
      const lightning = createLightning({
        parent: atmosphereSystem.root,
        camera,
        rendering,
        sky: skyShell.material.uniforms,
        textGuard: groundContacts,
        film: () => filmActive,
        shot: () => shotOnScreen()?.name ?? null,
        cutIn: () => tourCutIn,
        profile: state.profile,
        skyRadius: WORLD.SKY_DOME_RADIUS,
        date: sceneDate,
      });
      subsystemRegistry.register(lightning);
      if (qualityDebug) qualityDebug.lightning = lightning.state;
      // The drifting mist (drifting-mist.js): the ground's text boxes are lent for its
      // text guard (MIST_DRIFT.text, off by default: it keeps every text's contrast as
      // it is); the moon key and the star light it; its clock, tier and the shot's
      // share follow the frame (below).
      lendMistText(groundContacts);
      setMistLights(WORLD.SUN_DIRECTION, WORLD.SUN_POSITION);
      subsystemRegistry.register({
        applyQuality(profile) {
          setMistTier(profile?.tier);
        },
        update(frame) {
          advanceMist(frame);
        },
      });
      setMistTier(state.profile?.tier);
      const environmentSystem = createSceneEnvironment({
        groundHeight,
        parent: sceneRoot,
        profile: state.profile,
      });
      subsystemRegistry.register(environmentSystem);
      const filmDetailReady = environmentSystem.prepareFilmDetail().catch(() => null);
      const environmentRoot = environmentSystem.root;
      const circleGeometry = new CircleGeometry(
          WORLD.GROUND_RADIUS,
          circleSegments,
          0,
          2 * Math.PI,
        ),
        groundPositions = circleGeometry.attributes.position;
      for (let vertexIndex = 0; vertexIndex < groundPositions.count; vertexIndex += 1) {
        const localX = groundPositions.getX(vertexIndex),
          localY = groundPositions.getY(vertexIndex);
        // CircleGeometry's local +Y becomes world -Z after its -X quarter turn.
        // Sample in world coordinates so the ground matches groundHeight.
        groundPositions.setZ(vertexIndex, groundHeight(localX, -localY));
      }
      circleGeometry.computeVertexNormals();
      let groundSurface = null;
      // Set once the shader warm-up exists: a ground program that changes before
      // the reveal links through compileAsync instead of blocking the first draw.
      let warmGround = null;
      // The name and intro, and the footer (Contact and, while it shows them,
      // the email and LinkedIn), on the canvas, in its UV (y up), where
      // the ground's water eases off (mud-ground.js SLATE_WATER.text), and
      // beside the footer the bark's lantern highlights pass the same knee (the
      // tree takes these uniforms); the sky's reshaped banks ease out behind the
      // name and intro too (estate-sky.js); measured on resize, on font loads,
      // every 30th frame and when the links show or hide. While the walk hides
      // the page there is no text to guard.
      function measureGroundText() {
        const canvas = renderer.domElement?.getBoundingClientRect?.();
        const box = (text, selectors) => {
          let x0 = Infinity,
            y0 = Infinity,
            x1 = -Infinity,
            y1 = -Infinity;
          for (const selector of walk?.textHidden ? [] : selectors)
            for (const element of document.querySelectorAll(selector)) {
              const r = element.getBoundingClientRect?.();
              if (!r?.width || !r.height) continue;
              x0 = Math.min(x0, r.left);
              x1 = Math.max(x1, r.right);
              y0 = Math.min(y0, r.top);
              y1 = Math.max(y1, r.bottom);
            }
          if (!canvas?.width || !canvas.height || x0 > x1)
            return Object.assign(text, { x: 2, y: 2, z: -1, w: -1 });
          return Object.assign(text, {
            x: (x0 - canvas.left) / canvas.width,
            z: (x1 - canvas.left) / canvas.width,
            y: 1 - (y1 - canvas.top) / canvas.height,
            w: 1 - (y0 - canvas.top) / canvas.height,
          });
        };
        if (canvas?.width && canvas.height)
          groundContacts.slateAspect.value = canvas.width / canvas.height;
        box(groundContacts.slateText.value, [".hero h1", ".hero-intro"]);
        box(groundContacts.slateAbout.value, [".site-footer .site-footer__label"]);
      }
      subsystemRegistry.register({
        applyQuality(profile) {
          groundContacts.slateContactGain.value = profile?.shadows?.enabled ? 0.6 : 1;
        },
      });
      const groundTextures = createGroundTextures({
          THREE,
          qualityProfile: state.profile,
          chooseAnisotropy,
          invalidate() {
            invalidateContent();
          },
          onDetailStatus(status) {
            if (status.status === "ready") qualityState.holdSampling();
            if (qualityDebug) qualityDebug.ground = status;
          },
          onSoilRoughnessChange(texture) {
            groundContacts.slateSoilRoughness.value = texture;
            groundContacts.slateSoilRoughnessOn.value = texture ? 1 : 0;
            invalidateContent();
          },
          onDetailChange({
            colorMap,
            normalMap,
            normalScale,
            bumpMap,
            roughnessMap = null,
            detailMap = null,
            gritMap = null,
            reliefMap = null,
            filmTiled = false,
          }) {
            const material = groundSurface?.material;
            if (!material) return;
            // The slate tint and shading follow the film, not the published
            // maps, so the procedural loading and fallback surface is slate too.
            const surface = filmGroundSurface({
              film: filmActive,
              surface: GROUND_SURFACE_MATERIAL,
            });
            if (qualityDebug) qualityDebug.groundTreatment = filmActive ? "slate" : "baseline";
            configureGroundShading(material, filmActive, {
              detail: detailMap,
              grit: gritMap,
              relief: reliefMap,
              contacts: groundContacts,
            });
            warmGround?.();
            for (const texture of [colorMap, normalMap, roughnessMap, bumpMap].filter(Boolean)) {
              if (!groundRepeats.has(texture)) groundRepeats.set(texture, texture.repeat.clone());
              texture.repeat
                .copy(groundRepeats.get(texture))
                .multiplyScalar(filmActive && !filmTiled ? 384 / 176 : 1);
            }
            material.map = colorMap;
            material.roughnessMap = roughnessMap;
            material.roughness = surface.roughness;
            material.metalness = surface.metalness;
            material.color.setHex(surface.color);
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
            bumpScale: GROUND_SURFACE_MATERIAL.bumpScale,
            roughness: GROUND_SURFACE_MATERIAL.roughness,
            metalness: GROUND_SURFACE_MATERIAL.metalness,
          }),
        );
      groundMesh.rotation.x = -Math.PI / 2;
      groundMesh.receiveShadow = true;
      environmentRoot.add(groundMesh);
      groundSurface = groundMesh;
      subsystemRegistry.register(groundTextures);
      // The film ranges are a lazy chunk (mountain-build.js), requested once the film is
      // on at high or balanced with the massifs' GLBs at the startup tier; they
      // build in slices and land only while unseen (before the reveal, under its fade,
      // on a cut).
      const hillSilhouette = createHillSilhouette({
        groundHeight,
        skyRadius: WORLD.SKY_DOME_RADIUS,
        shellOpacity: skyConfig.shellOpacity,
        sunPosition: WORLD.SUN_POSITION,
        rendering,
        tour: liveView,
        tier: assetTier,
        invalidate: invalidateContent,
        onStatus: (status) => {
          if (qualityDebug) qualityDebug.mountains = status;
          // Models can arrive after every earlier warm-up has finished.
          if (!runtimeDisposed && (status === "ready" || status === "fallback"))
            warmShaders("mountains", hillSilhouette.mesh);
        },
      });
      hillSilhouette.applyQuality(state.profile);
      environmentRoot.add(hillSilhouette.mesh);
      subsystemRegistry.register(hillSilhouette);
      // The film's scattered rocks: loaded once the film is on and the tree has
      // settled (high and balanced only), seated on the film terrain's root
      // supports, committed on a tour cut below.
      const rockScatter = createRockScatter({
        parent: environmentRoot,
        groundHeight,
        terrain: () => filmScene.ready,
        tier: assetTier,
        anisotropy: chooseAnisotropy(6),
        compile: () => rendering.compileShaders(),
        contacts: groundContacts.slateContacts.value,
        textGuard: groundContacts,
        onStatus: (status) => {
          if (qualityDebug) qualityDebug.rocks = status;
        },
      });
      subsystemRegistry.register(rockScatter);
      // The watch's marker: nothing is drawn on the terrace; The watch frames the outline
      // measured from the feet of the lookout's posts, which stood 0.22 into it.
      watchRoot = new Object3D();
      watchRoot.position.set(
        ESTATE.watch.x,
        groundHeight(ESTATE.watch.x, ESTATE.watch.z) - 0.22,
        ESTATE.watch.z,
      );
      environmentRoot.add(watchRoot);
      // Authored casters and the sun hold still within a shot, so the shadow map
      // redraws only on reported changes.
      rendering.setStaticShadows(true);
      let treeArchitecture = null;
      // The film's grounded lighting, on while the watch is committed.
      let groundedLighting = false;
      function setGroundedLighting(active) {
        if (groundedLighting === active) return;
        groundedLighting = active;
        rendering.setGroundedLighting(active);
      }
      subsystemRegistry.register({ dispose: () => setGroundedLighting(false) });
      const propScale = createPropScale({ groundRoot: environmentRoot, groundHeight });
      subsystemRegistry.register(propScale);
      // The film's distant firelights on the far plain (far-fires.js): out
      // behind the text and about the tree's silhouette.
      const farFires = createFarFires({
        parent: environmentRoot,
        camera,
        subjects: () => [treeArchitecture?.root],
        shot: shotOnScreen,
        textGuard: groundContacts,
        profile: state.profile,
      });
      subsystemRegistry.register(farFires);
      // The orbital sun stays in the directed scene: it is the one warm celestial
      // anchor in an otherwise cool night, and reads as distance rather than clutter.
      filmScene = createFilmScene({
        ground: groundSurface,
        groundHeight,
        rendering,
        atmosphere: atmosphereSystem,
        skyMaterial: skyShell.material,
        invalidate: invalidateContent,
        tour: liveView,
        onGroundChange(active) {
          environmentSystem.setFilmTreatment(active);
          hillSilhouette.setFilmTreatment(active);
          filmActive = active;
          groundTextures.setFilmActive(active);
          rockScatter.setFilmActive(active);
          farFires.setFilmActive(active);
          // Retain the film sampler; its shore gates walk entry until it lands.
          if (active)
            filmScene.ready?.then((height) => {
              walkGround = typeof height === "function" ? height : null;
            });
        },
      });
      subsystemRegistry.register(filmScene);
      // A failed scene cannot be revealed or retried. Leave the static title card
      // rather than a partial scene or a loop waiting on a status. A scene never
      // shown also hides its host, which retires the title card's loading line
      // (ui/scene-loader.js); a shown canvas fades out instead.
      function stopFailedScene(stage, error) {
        sceneFailed = true;
        container.classList?.remove("is-ready");
        if (!canvasShown) container.hidden = true;
        if (qualityDebug)
          qualityDebug.failure = { stage, message: String(error?.message || error) };
      }
      // A watch whose stage fails or a tree that cannot load shows the title card:
      // the scene stops at once and its runtime is disposed on a later tick,
      // outside the asset controller's callback.
      function failToTitle(stage, error) {
        if (sceneFailed) return;
        stopFailedScene(stage, error);
        stopOpeningPreparation();
        // Let the bounded in-flight warm-ups settle before runtime disposal.
        (function disposeWhenIdle() {
          if (shaderWarmup.pending) window.setTimeout(disposeWhenIdle, 50);
          else scene.disposeHomeSceneRuntime?.();
        })();
      }
      // Shader warm-up links new programs through bounded parallel polling instead of a
      // blocking first draw. Until the canvas is first shown nothing draws while
      // one is pending; afterwards a committed model that replaces nothing
      // visible stays hidden until its programs are ready.
      let canvasShown = false;
      let openingPrepared = false,
        openingFit = null,
        openingGeneration = 0,
        openingShaderStarted = false,
        openingTimer = null,
        lanternDeadline = null,
        revealTime = 0;
      const architectureStatus = {};
      const openingGate = createOpeningPreparation({
        totalMs: scene.takeOpeningBudget?.() ?? 30000,
        stages:
          opening.view === "tree"
            ? [
                "subjects",
                "lantern",
                "terrain",
                "materials",
                "details",
                "foreground",
                "rocks",
                "shaders",
              ]
            : ["subjects", "shaders"],
        report(snapshot) {
          site.sceneLoader?.preparation?.(snapshot);
          if (qualityDebug) qualityDebug.opening = snapshot;
        },
        fail(reason) {
          failToTitle("opening", reason);
        },
      });
      const openingProgress = () =>
        (site.sceneLoader?.state?.progress ?? 0) + (rendering.openingProgress ?? 0);
      const openingStart = [sceneNow(), !document.hidden && sceneVisible, openingProgress()];
      retireOpening = () => {
        if (canvasShown) return;
        ++openingGeneration;
        openingFit = null;
        openingPrepared = openingShaderStarted = false;
        openingGate.reopen("foreground", "shaders");
      };
      function stopOpeningPreparation() {
        clearTimeout(openingTimer);
        clearTimeout(lanternDeadline);
        openingTimer = lanternDeadline = null;
        openingGate.dispose();
        rendering.openingPreparing = false;
      }
      let openingStarted = false;
      function tickOpening() {
        if (!openingStarted) {
          openingStarted = true;
          openingGate.tick(...openingStart);
        }
        openingGate.tick(sceneNow(), !document.hidden && sceneVisible, openingProgress());
      }
      function settleOpening(stage) {
        tickOpening();
        openingGate.settle(stage);
      }
      function observeOpening() {
        if (runtimeDisposed || sceneFailed || canvasShown) return;
        tickOpening();
        const prepared = filmScene.openingState;
        for (const stage of ["terrain", "details", "foreground"])
          if (prepared?.[stage]) settleOpening(stage);
        if (prepared?.failed) failToTitle("terrain", "unavailable");
        openingTimer = window.setTimeout(observeOpening, 200);
      }
      const shaderWarmup = createShaderWarmup({ compile: () => rendering.compileShaders() });
      // A detail change before the reveal links the ground's new program.
      warmGround = () => canvasShown || warmShaders("ground");
      function warmShaders(label, subject = null) {
        const start = sceneNow();
        return new Promise((resolve) =>
          shaderWarmup.warm(subject, (ready) => {
            measureScene(`shaders:${label}`, start);
            if (qualityDebug) (qualityDebug.shaders ||= {})[label] = ready ? "ready" : "unwarmed";
            // warm() restores visibility; retain a quality change made while linking.
            if (subject === hillSilhouette.mesh) hillSilhouette.applyQuality(state.profile);
            rendering.invalidateShadows();
            invalidateContent();
            resolve(ready);
          }),
        );
      }
      const lanternMount = createLanternMount({
        anisotropy: chooseAnisotropy(6),
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
        async loadAsset(url, options) {
          const asset = await loadArchitectureAsset(url, options);
          if (options.role === "tree") await prepareArchitecture(asset, options);
          // Finish preparation in its own task before the atomic model commit.
          await new Promise((resolve) => window.setTimeout(resolve, 0));
          return asset;
        },
        includeLantern: true,
        onLanternReady: (asset) => lanternMount.stage(asset),
        // The watch waits on the sky's own programs and capture and the film's detail
        // (they link and build while the tree downloads), so its synchronous commit
        // borrows a finished capture rather than blocking to introspect shaders in
        // fromScene(). Its commit switches the film on and gives the camera the watch.
        stage: () => Promise.all([rendering.environment.ready, filmDetailReady]),
        onWatchReady() {
          const assemblyStart = sceneNow();
          setGroundedLighting(true);
          propScale.setActive(true);
          filmScene.setActive(true);
          treeArchitecture?.setFilmTreatment(filmActive);
          cinematic.setSubject("watch", watchRoot);
          rendering.invalidateShadows();
          invalidateContent();
          measureScene("assembly:watch", assemblyStart);
          warmShaders("watch");
        },
        onRestoreWatch() {
          cinematic.setSubject("watch", null);
          filmScene.setActive(false);
          treeArchitecture?.setFilmTreatment(false);
          propScale.setActive(false);
          setGroundedLighting(false);
          rendering.invalidateShadows();
          invalidateContent();
        },
        onTreeReady(asset) {
          const assemblyStart = sceneNow();
          const replacement = createTreeArchitecture({
            asset,
            groundHeight,
            anisotropy: chooseAnisotropy(6),
            anchor: [ESTATE.tree.x, ESTATE.tree.z],
            textGuard: groundContacts,
          });
          replacement.applyQuality(state.profile);
          environmentRoot.add(replacement.root);
          treeArchitecture = replacement;
          lanternMount.setTree(replacement);
          propScale.setTree(replacement);
          replacement.setFilmTreatment(filmActive);
          cinematic.setSubject("tree", replacement.root);
          rendering.invalidateShadows();
          invalidateContent();
          measureScene("assembly:tree", assemblyStart);
          warmShaders("tree", replacement.root);
          return () => {
            replacement.dispose();
            treeArchitecture = null;
          };
        },
        onRestoreTree() {
          lanternMount.setTree(null);
          cinematic.setSubject("tree", null);
          treeArchitecture?.setFilmTreatment(false);
          propScale.setTree(null);
          rendering.invalidateShadows();
          invalidateContent();
        },
        onStatus(status) {
          if (status.status === "ready") qualityState.holdSampling();
          architectureStatus[status.kind] = status.status;
          if (
            !canvasShown &&
            status.kind === "lantern" &&
            status.status === "loading" &&
            !lanternDeadline
          )
            lanternDeadline = window.setTimeout(() => {
              if (!canvasShown && !lanternMount.committed)
                architectureAssets.cancelOptional("lantern");
              invalidateContent();
            }, 8000);
          // Record the status first: the camera must not wait on a load that
          // has already ended.
          cinematic.setStatus(status);
          // A model's arrival or loss clears the camera's fits and can change
          // the tour's next shot.
          cameraTour?.prepareNext();
          // The rocks wait for the tree channel to settle either way.
          if (status.kind === "tree") rockScatter.setTreeStatus(status.status);
          if (qualityDebug) {
            qualityDebug.architecture ||= {};
            qualityDebug.architecture[status.kind] = status;
          }
          // Without the watch or its authored tree the scene has nothing to show:
          // the static title card stays. A missing lantern keeps the scene.
          if (
            !runtimeDisposed &&
            status.kind !== "lantern" &&
            (status.status === "fallback" || (status.status === "procedural" && sceneReadyMarked))
          ) {
            failToTitle(`architecture:${status.kind}`, status.reason || status.status);
          }
          invalidateContent();
        },
      });
      subsystemRegistry.register(architectureAssets);
      subsystemRegistry.register({
        applyQuality(profile) {
          treeArchitecture?.applyQuality(profile);
        },
      });
      const viewport = {
          scrollTarget: 0,
          scroll: 0,
          width: window.innerWidth,
          height: window.innerHeight,
        },
        compositionState = {
          profile: scene.getSceneCompositionProfile({
            width: window.innerWidth,
            height: window.innerHeight,
          }),
        },
        visibilityScale = 1.15,
        lookTarget = new Vector3();
      function applySceneComposition(reason = "runtime") {
        compositionState.profile = scene.getSceneCompositionProfile({
          width: viewport.width,
          height: viewport.height,
        });
        updateSceneDebug({
          composition: compositionState.profile.name,
          compositionReason: reason,
        });
      }
      // The loading line's star (ui/scene-loader.js) waits where the opening shot will show
      // this one, in CSS px from the canvas's top-left: first where the opening fit to the
      // watch's stored outline puts it (opening-star.js), from the scene's start and again on
      // a resize or once the fonts load; then, once the scene's camera has fitted that shot
      // itself, where it does.
      let openingCameraStar = false;
      const openingSun = new Vector3(),
        openingWatch = new Vector3(),
        openingSource = [0, 0, 0, 0];
      function reportLoaderStar(star) {
        const rect = renderer.domElement?.getBoundingClientRect?.();
        site.sceneLoader?.star?.(
          star && rect?.width && rect.height
            ? {
                x: star[0] * rect.width,
                y: (1 - star[1]) * rect.height,
                radius: star[2] * rect.height,
                width: rect.width,
                height: rect.height,
              }
            : null,
        );
      }
      function predictLoaderStar() {
        if (openingCameraStar || canvasShown || !site.sceneLoader?.star) return;
        // The watch's marker under the scene's composition height (environmentRoot),
        // which only lifts or lowers it.
        watchRoot.getWorldPosition(openingWatch);
        reportLoaderStar(
          openingStar({
            width: viewport.width,
            height: viewport.height,
            getSafeArea: (width, height) => cinematicArea || measureCinematicArea(width, height),
            getGroundY: cinematicGroundY,
            sun: solarBody.root.getWorldPosition(openingSun),
            watchY: openingWatch.y,
            tier: assetTier,
            tourPhase: cameraTour ? 0 : null,
            selected: scene.cinematicSelection,
            angle: scene.cinematicAngle,
            out: openingSource,
          }),
        );
      }
      function applySceneSize({ width, height }) {
        qualityState.holdSampling();
        cinematicArea = measureCinematicArea(width, height);
        measureGroundText();
        viewport.width = width;
        viewport.height = height;
        applySceneComposition("resize");
        applyActiveQualityProfile(state.profile, "resize");
        subsystemRegistry.resize({
          cameraFov: compositionState.profile.camera.fov,
          composition: compositionState.profile,
          height,
          width,
        });
        // After the composition has set the scene's height.
        predictLoaderStar();
        // Resizing clears the canvas; draw one frame behind a visitor pause.
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
        typeof ResizeObserver === "function" && container
          ? new ResizeObserver(() => resizeController.resize())
          : null;
      containerResizeObserver?.observe(container);
      // Moving the window to a display of another scale changes the pixel
      // ratio alone, which fires neither of those.
      const pixelRatioWatcher = createPixelRatioWatcher({
        onChange: () => resizeController.resize(),
      });
      // viewport.height is refreshed inside applySceneSize (the resize handler)
      // on every resize, so reading it inside the scroll handler avoids a
      // layout-flushing window.innerHeight access per scroll event.
      const onWindowResize = () => resizeController.resize();
      const onFontsLoaded = () => {
        cinematicArea = measureCinematicArea(viewport.width, viewport.height);
        cameraTour?.prepareNext();
        measureGroundText();
        invalidateContent();
        predictLoaderStar();
      };
      document.fonts?.addEventListener?.("loadingdone", onFontsLoaded);
      const onWindowScroll = () => {
        viewport.scrollTarget = Math.min(window.scrollY / (1.8 * viewport.height), 1.25);
        // The hero scrolls over the fixed canvas: the next frame re-measures
        // the ground's text guard (measuring here would flush layout per event).
        groundTextStale = true;
        frameScheduler?.invalidate();
      };
      window.addEventListener("resize", onWindowResize);
      window.addEventListener("scroll", onWindowScroll, { passive: true });
      resizeController.update({ force: true });
      let vortexShot = null,
        vortexFit = null,
        vortexHere = false;
      const vortexEye = new Vector3();
      let debugRenderFrameCount = 0,
        groundTextFrames = 0,
        groundTextStale = false;
      // Contact shows and hides its links (ui/contact.js): the next frame
      // guards them as it does the label.
      const footerLinksObserver =
        typeof ResizeObserver === "function"
          ? new ResizeObserver(() => {
              groundTextStale = true;
              frameScheduler?.invalidate();
            })
          : null;
      for (const links of document.querySelectorAll(".site-footer__links"))
        footerLinksObserver?.observe(links);
      let debugRenderWindowStart = null;
      let firstFrameDrawn = false;
      // Governor steps link their programs at once and apply on a tour cut.
      const adaptiveSteps = createDeferredQualityStep({
        prepare: (profile) => rendering.prepareQuality(profile),
      });
      // The lens's sources on screen (postprocess.js lensSource()) and its kept rect
      // (lensKeepRect()), reused each frame.
      const lensPoint = new Vector3(),
        lensStar = [0, 0, 0, 0],
        lensFlame = [0, 0, 0, 0],
        lensKeep = [0, 0, 0, 0];
      function updateSceneFrame({
        deltaSeconds,
        elapsedSeconds: elapsedTime,
        sampleDeltaSeconds,
        timestamp,
      }) {
        const frameStart = firstFrameDrawn ? 0 : sceneNow();
        if (++groundTextFrames % 30 === 1 || groundTextStale) {
          groundTextStale = false;
          measureGroundText();
        }
        // Samples are rAF intervals, not render cost; take them only while the
        // revealed scene animates continuously, outside a post-event hold, and
        // not while a step waits for its cut.
        const revealed = canvasShown && cinematic.ready;
        const nowMs = 1000 * elapsedTime;
        const sampledProfile =
          revealed && !reducedMotion && !adaptiveSteps.pending
            ? qualityState.sampleRevealed?.({
                frameMs: 1000 * sampleDeltaSeconds,
                nowMs,
                timestamp,
                profile: state.profile,
              })
            : null;
        if (sampledProfile) adaptiveSteps.queue(sampledProfile, nowMs);
        // The walk holds the tour: its shot and hold stay put.
        const tourPhase =
          cameraTour?.update({
            elapsedSeconds: elapsedTime,
            ready: canvasShown,
            reducedMotion,
            held: walk?.holdsTour === true,
          }) ?? null;
        const tourTransition = cameraTour?.transition ?? TOUR_IDLE;
        const transition = walk ? walk.step(elapsedTime, tourTransition) : tourTransition;
        const walking = walk?.drives === true;
        // Seconds until the tour's next capture, for the lightning (cutFade).
        tourCutIn =
          cameraTour?.running && tourPhase !== null
            ? Math.max(0, (1 - tourPhase) * cameraTour.state.dwell)
            : Infinity;
        // Each step changes the tier or, below balanced, only the pixel ratio. A
        // running tour takes it on a cut, where the crossfade's kept frame hides
        // its one-off work.
        const adaptiveProfile = adaptiveSteps.take({
          cut: transition.cut,
          running: liveView.running,
          nowMs,
        });
        if (adaptiveProfile) applyActiveQualityProfile(adaptiveProfile, "adaptive");
        lanternMount.take({
          revealed: canvasShown,
          running: liveView.running,
          cut: transition.cut,
        });
        // The rocks appear on a cut too, with their ground contacts.
        if (rockScatter.take({ cut: transition.cut, running: liveView.running, nowMs })) {
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
        const cameraProfile = compositionState.profile.camera;
        viewport.scroll = reducedMotion
          ? viewport.scrollTarget
          : viewport.scroll + 0.025 * (viewport.scrollTarget - viewport.scroll);
        // Until a subject is ready the hidden canvas keeps the orbit camera,
        // which the directed shot replaces before the reveal.
        const orbitTravel = elapsedTime * (0.95 * ORBIT_SPEED),
          orbitWobble = 0.09 * Math.sin(3 * orbitTravel) + 0.05 * Math.sin(2 * orbitTravel),
          orbitAngle = ORBIT_START_ANGLE + orbitTravel - orbitWobble,
          scrolledOrbitBase =
            cameraProfile.orbitBase - cameraProfile.orbitScrollDelta * viewport.scroll,
          orbitHeight =
            cameraProfile.heightBase +
            cameraProfile.heightScrollDelta * viewport.scroll +
            0.45 * Math.sin(0.28 * elapsedTime) +
            0.6 * Math.sin(0.13 * elapsedTime),
          lookAtHeight =
            cameraProfile.lookAtBase + cameraProfile.lookAtScrollDelta * viewport.scroll,
          orbitDistance = cameraProfile.orbitScale * (scrolledOrbitBase - cameraProfile.orbitTrim);
        // The walk drives the camera from its cut in to its cut back; the shot's
        // lens, bars, light mood, mist and ground calm then rest at no shot's.
        const cinematicApplied =
          !walking &&
          cinematic.apply({
            width: viewport.width,
            height: viewport.height,
            elapsedSeconds: canvasShown ? Math.max(0, elapsedTime - revealTime) : 0,
            reducedMotion,
            tourPhase: canvasShown ? tourPhase : 0,
            fallbackFov: cameraProfile.fov,
          });
        if (walking) walk.update(deltaSeconds, viewport.width, viewport.height);
        else if (!cinematicApplied) {
          camera.position.set(
            Math.cos(orbitAngle) * orbitDistance,
            orbitHeight,
            Math.sin(orbitAngle) * orbitDistance,
          );
          camera.lookAt(0, lookAtHeight, 0);
        }
        if (cinematicApplied) lookTarget.copy(cinematic.target);
        else if (walking) lookTarget.copy(walk.focus);
        else lookTarget.set(0, lookAtHeight, 0);
        // The cloud vortex's eye sits where this lens sees the star, set on each cut and
        // each refit (a resize; estate-sky.js CLOUD_VORTEX), so it stays about the star.
        if (cinematicApplied && (cinematic.shot !== vortexShot || cinematic.frame !== vortexFit)) {
          // Each shot takes the maelstrom whole or not at all as it opens, by the sky's drift
          // clock (estate-sky.js CLOUD_VORTEX.life): it is never seen forming; a refit keeps it.
          if (cinematic.shot !== vortexShot)
            vortexHere = vortexSeason && cloudVortexPresent(skyShell.material.uniforms.uTime.value);
          vortexShot = cinematic.shot;
          vortexFit = cinematic.frame;
          camera.updateMatrixWorld();
          cloudVortexCenter(
            camera.getWorldPosition(vortexEye),
            WORLD.SUN_POSITION,
            WORLD.SKY_DOME_RADIUS,
            skyShell.material.uniforms.uVortex.value,
          );
          if (!vortexHere) skyShell.material.uniforms.uVortex.value.z = -1;
          skyShell.material.uniforms.uVortex.value.w = CLOUD_VORTEX.guardShots.includes(
            vortexShot?.name,
          )
            ? 1
            : 0;
        }
        // The shot's light mood.
        {
          const mood = shotLight(filmActive && cinematicApplied ? cinematic.shot : null);
          rendering.setShotLight?.(mood);
          if (LANTERN_MOOD.value !== mood.lantern) {
            LANTERN_MOOD.value = mood.lantern;
            treeArchitecture?.refreshLantern?.();
          }
          COAST_MOOD.value = filmActive ? mood.coastStudy : 0;
          GLINT_MOOD.value = filmActive ? mood.glintText : 0;
          GRASS_MOOD.value = filmActive ? mood.grassInside : 0;
          STONE_MOOD.value = filmActive ? mood.stoneText : 0;
          groundContacts.slatePoolAbout.value = filmActive ? mood.poolAbout : 0;
        }
        // The lens below reads this frame's camera.
        camera.updateMatrixWorld();
        // The shot's lens and the film's bars and grain follow the shot on screen;
        // the bars ease out under the dissolve into the walk and back in after it.
        const post = rendering.postprocessPipeline;
        post.setLens?.(
          cinematicApplied ? cinematic.shot?.lens : null,
          camera,
          lookTarget,
          cinematicGroundY(lookTarget.x, lookTarget.z),
        );
        post.setBars?.(
          filmActive && (cinematicApplied || walking)
            ? letterboxShare(viewport.width, viewport.height) * (walk?.bars ?? 1)
            : 0,
        );
        if (!reducedMotion && !visitorHold?.paused) post.setFilmTime?.(elapsedTime);
        // The gate weave (FILM_LOOK.weave) moves the lens, not the finished frame: the
        // shot's lens shift (cinematic.js, rewritten on every applied frame) takes a
        // fraction of a CSS px more, so fine detail never softens and sharpens with the
        // wander, and the lens's sources below follow it.
        {
          const weave = filmActive && (cinematicApplied || walking) ? post.weaveOffset?.() : null;
          if (weave && (weave[0] || weave[1])) {
            const shift = camera.projectionMatrix.elements;
            shift[8] += (2 * weave[0]) / viewport.width;
            shift[9] += (2 * weave[1]) / viewport.height;
            camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
          }
        }
        // The lens follows its sources on screen (LENS_FX): the star, the lantern's
        // flame in the shots that look at it, and the rect it keeps whole (The
        // watch's reference banks on desktop landscape frames). They change with the shot.
        {
          const shot = filmActive && cinematicApplied ? cinematic.shot : null,
            flame = shot && treeArchitecture?.light && LENS_FX.heat.flameShots.includes(shot.name),
            star = shot
              ? lensSource(
                  camera,
                  solarBody.root.getWorldPosition(lensPoint),
                  SOLAR_RADIUS,
                  lensStar,
                )
              : null;
          // Until the reveal the loading line's star waits where this one will be.
          if (star && !canvasShown) {
            openingCameraStar = true;
            reportLoaderStar(star);
          }
          post.setLensSources?.({
            star,
            flame: flame
              ? lensSource(camera, treeArchitecture.light.getWorldPosition(lensPoint), 1, lensFlame)
              : null,
            keep:
              shot && viewport.width >= 1000 && viewport.width > 1.2 * viewport.height
                ? lensKeepRect(
                    LENS_FX.keep[shot.name],
                    star,
                    viewport.width / viewport.height,
                    lensKeep,
                  )
                : null,
          });
        }
        // The mist's share is the shot's on screen, over the plain's datum.
        setMistShot(cinematic.shot?.name, filmActive && cinematicApplied);
        setMistDatum(environmentRoot.position.y + groundHeight(ESTATE.tree.x, ESTATE.tree.z));
        // The shot's ground calm follows the shot on screen, so it changes on a cut.
        slateCalmFor(
          groundContacts,
          cinematicApplied ? cinematic.shot : null,
          cinematic.frame?.distance,
          cinematic.target,
        );
        subsystemRegistry.update({
          camera,
          viewport,
          shot: cinematic.shot?.name,
          cut: transition.cut,
          still: !liveView.running,
          revealed: canvasShown,
          preparing: !canvasShown,
          nextShot: cameraTour?.nextShot?.name,
          profile: state.profile,
          deltaSeconds,
          elapsedSeconds: elapsedTime,
          motionPaused: visitorHold?.paused,
          reducedMotion,
          render: false,
          visibilityScale,
          bloom: rendering.postprocessPipeline.passes?.bloom?.enabled === true,
        });
        // The phone band shades the frame's top behind a name stacked above
        // the subject; beside it (landscape phones) it would dim the subject.
        // The walk's shadow follows its own snapped focus (walk.js WALK.shadow).
        if (filmActive)
          filmScene.finishFrame(
            camera,
            lookTarget,
            walking ? walk.frame : cinematic.frame,
            !walking &&
              viewport.width < 900 &&
              isStackedLayout(viewport.width, viewport.height) &&
              cinematic.shot?.arc === 2,
            (cinematicArea?.top || 200) / viewport.height,
          );
        if (qualityDebug)
          qualityDebug.cinematic = {
            tour: cameraTour ? { ...cameraTour.state, transition: { ...transition } } : null,
            film: filmActive,
            shot: cinematic.shot?.name,
            selected: cinematic.selected,
            angle: cinematic.angle + 1,
            current: cinematic.current,
          };
        if (qualityDebug) qualityDebug.walk = walk?.state ?? null;
        if (!canvasShown && cinematic.current === opening.view && !sceneFailed) {
          settleOpening("subjects");
          const lanternSettled =
            opening.view !== "tree" ||
            lanternMount.committed ||
            architectureStatus.lantern === "fallback";
          if (lanternSettled) settleOpening("lantern");
          const refit = openingFit && openingFit !== cinematic.frame;
          if (lanternSettled && (!openingFit || refit)) {
            openingFit = cinematic.frame;
            const generation = ++openingGeneration;
            openingPrepared = openingShaderStarted = false;
            if (refit) openingGate.reopen("foreground", "shaders");
            if (opening.view === "tree") {
              const frame = {
                camera,
                viewport: { ...viewport },
                shot: cinematic.shot?.name,
                profile: state.profile,
                nextShot: cameraTour?.nextShot?.name,
              };
              const terrain = filmScene.prepareOpening(frame);
              const maps = groundTextures.prepareOpening().then(() => settleOpening("materials"));
              const rocks = rockScatter.prepareOpening().then(() => {
                if (rockScatter.committed) groundContacts.slateRockContact.value = 1;
                settleOpening("rocks");
              });
              Promise.all([terrain, maps, rocks])
                .then(([ready]) => {
                  if (
                    runtimeDisposed ||
                    sceneFailed ||
                    generation !== openingGeneration ||
                    !webglContextAvailable
                  )
                    return;
                  if (!ready) return failToTitle("terrain", "unavailable");
                  for (const stage of ["terrain", "details", "foreground"]) settleOpening(stage);
                  openingPrepared = true;
                  invalidateContent();
                })
                .catch((error) => {
                  if (!runtimeDisposed && !sceneFailed && generation === openingGeneration)
                    failToTitle("opening", error);
                });
            } else openingPrepared = true;
          }
          if (openingPrepared && !openingShaderStarted && !shaderWarmup.pending) {
            openingShaderStarted = true;
            const generation = openingGeneration;
            warmShaders("opening").then((ready) => {
              if (
                runtimeDisposed ||
                sceneFailed ||
                generation !== openingGeneration ||
                !webglContextAvailable
              )
                return;
              if (!ready && renderer.extensions?.has?.("KHR_parallel_shader_compile"))
                return failToTitle("shaders", "programs-unavailable");
              // WebGL1 without parallel linking prepares through a real hidden
              // draw. It uses the same final materials and camera as reveal.
              if (!ready) {
                try {
                  rendering.update();
                  if (!rendering.programsLinked())
                    return failToTitle("shaders", "programs-unavailable");
                } catch (error) {
                  return failToTitle("shaders", error);
                }
              }
              settleOpening("shaders");
              invalidateContent();
            });
          }
        }
        // Drawing while a warm-up links would block on it; the hidden canvas waits.
        if (canvasShown || !shaderWarmup.pending) {
          // Slate may still be loading at the reveal; keep the first visible
          // procedural surface detailed without painting an unused fallback.
          if (!canvasShown && cinematic.ready) groundTextures.ensureProcedural();
          rendering.update();
          if (!firstFrameDrawn) {
            firstFrameDrawn = true;
            measureScene("first-frame", frameStart);
          }
        }
        visitorHold?.frameRendered();
        if (qualityDebug) {
          // Linked programs: a first crossfade or quality step should add none.
          qualityDebug.programs = renderer.info?.programs?.length ?? null;
          const { status, ms } = rendering.environment;
          qualityDebug.environment = { status, ms: Math.round(ms * 10) / 10 };
          debugRenderWindowStart ??= timestamp;
          debugRenderFrameCount += 1;
          const debugRenderWindowMs = timestamp - debugRenderWindowStart;
          if (debugRenderWindowMs >= 500) {
            qualityDebug.renderFps = (1000 * debugRenderFrameCount) / debugRenderWindowMs;
            debugRenderFrameCount = 0;
            debugRenderWindowStart = timestamp;
          }
        }
        if (!sceneReadyMarked) {
          sceneReadyMarked = true;

          architectureAssets.setQuality(state.profile, true, { assetTier });
        }
        const sceneShown =
          !sceneFailed &&
          cinematic.ready &&
          (canvasShown || (openingGate.ready && !shaderWarmup.pending));
        if (sceneShown && !canvasShown) {
          markScene("reveal");
          revealTime = elapsedTime;
          cameraTour?.reset();
          stopOpeningPreparation();
          // Close openings already settled their rocks and material maps. Other
          // openings retain the deferred path; later data publishes at cuts.
          rockScatter.setRevealed();
          // A visitor already holding the scene may receive no following frame.
          // Start optional data here; its decode requests one refinement frame.
          groundTextures.update?.({ revealed: true });
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
        if (reducedMotion) walk?.exit({ immediate: true });
        frameScheduler.setReducedMotion(reducedMotion);
      };
      reducedMotionMQ.addEventListener("change", onReducedMotionChange);
      const onDocumentVisibilityChange = () => {
        if (!canvasShown) tickOpening();
        if (document.hidden) return;
        qualityState.holdSampling();
        frameScheduler.resume();
      };
      document.addEventListener("visibilitychange", onDocumentVisibilityChange);
      // scene.setVisitorPaused() stops the tour and the drift and holds
      // rendering; a visitorPausedPreference set before this bundle loads
      // applies at the start.
      visitorHold = createVisitorHold({
        onRelease: () => qualityState.holdSampling(),
        scheduler: frameScheduler,
      });
      scene.setVisitorPaused = (paused) => {
        const next = Boolean(paused);
        scene.visitorPausedPreference = next;
        if (next) walk?.exit({ immediate: true });
        cameraTour?.setPaused(next);
        return visitorHold.set(next);
      };
      scene.isVisitorPaused = () => visitorHold.paused;
      scene.setVisitorPaused(scene.visitorPausedPreference === true);
      // ` or ~ starts the walk over the revealed scene on a desktop and ends it
      // (walk-key.js). The first press captures the mouse inside its own gesture
      // and fetches walk.js; a refused capture leaves the drag look.
      const finePointer = window.matchMedia?.("(pointer: fine)"),
        forcedColors = window.matchMedia?.("(forced-colors: active)");
      const walkReady = () =>
        walkAllowed({
          shown: canvasShown && cinematic.ready && !runtimeDisposed && webglContextAvailable,
          failed: sceneFailed,
          ground: filmActive && walkGround?.shore?.(0, 0) < Infinity,
          reducedMotion,
          paused: visitorHold.paused,
          finePointer: !qualityState.touchPrimary && finePointer?.matches !== false,
          forcedColors: forcedColors?.matches === true,
        });
      function createSceneWalk({ createWalk }) {
        if (walk || runtimeDisposed || subsystemRegistry.disposed) return;
        walk = createWalk({
          camera,
          canvas: renderer.domElement,
          page: document.body,
          win: window,
          doc: document,
          ground: (x, z) => walkGround(x, z) + environmentRoot.position.y,
          shore: (x, z) => walkGround.shore?.(x, z),
          anchors: {
            trunk: {
              x: ESTATE.tree.x + ESTATE.tree.trunk[0],
              z: ESTATE.tree.z + ESTATE.tree.trunk[1],
            },
            lantern: estateLantern(),
          },
          rocks: () => rockScatter.footprints,
          view: () => ({ position: camera.position, target: cinematic.target }),
          fog: homeScene.fog,
          fogRange: () => [state.profile.lighting.fogNear, state.profile.lighting.fogFar],
          dissolve: TOUR_TRANSITION.dissolve,
          onText: measureGroundText,
        });
        subsystemRegistry.register({ dispose: () => walk.dispose() });
      }
      const onWalkKey = (event) => {
        if (!isWalkKey(event)) return;
        if (walk?.active) {
          event.preventDefault();
          walk.exit();
          return;
        }
        if (!walkReady()) return;
        event.preventDefault();
        try {
          renderer.domElement.requestPointerLock?.()?.catch?.(() => {});
        } catch {
          // Refused: the walk looks by dragging instead.
        }
        walkLoad ||= import("./walk.js").then(createSceneWalk, () => {
          walkLoad = null;
        });
        walkLoad.then(() => {
          if (walk && walkReady()) walk.enter();
          else if (document.pointerLockElement === renderer.domElement) document.exitPointerLock();
        });
      };
      window.addEventListener("keydown", onWalkKey);
      scene.disposeHomeSceneRuntime = function disposeHomeSceneRuntime() {
        if (runtimeDisposed) return false;
        runtimeDisposed = true;
        stopOpeningPreparation();
        sceneReadyMarked = false;
        container.classList?.remove("is-ready");
        document.fonts?.removeEventListener?.("loadingdone", onFontsLoaded);
        window.removeEventListener("resize", onWindowResize);
        window.removeEventListener("scroll", onWindowScroll);
        window.removeEventListener("keydown", onWalkKey);
        document.removeEventListener("visibilitychange", onDocumentVisibilityChange);
        reducedMotionMQ.removeEventListener("change", onReducedMotionChange);
        sceneIntersectionObserver?.disconnect();
        sceneIntersectionObserver = null;
        visitorHold.dispose();
        pixelRatioWatcher.dispose();
        footerLinksObserver?.disconnect();
        containerResizeObserver?.disconnect();
        resizeController.dispose();
        frameScheduler.dispose();
        subsystemRegistry.dispose();
        const disposedResources = rendering.disposeResult;
        frameScheduler = null;
        scene.setVisitorPaused = () => false;
        scene.isVisitorPaused = () => false;
        scene.disposeHomeSceneRuntime = () => false;
        return disposedResources;
      };
      warmShaders("scene");
      observeOpening();
      frameScheduler.start();
      measureScene("init", initStart);
      return true;
    });
  };
})();
