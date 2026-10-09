import "./quality.js";
import { createSolarBody } from "./solar-body.js";
import { createStarfield } from "./starfield.js";
import { readTourInterval, createCameraTour, TOUR_IDLE } from "./camera-tour.js";
import { createFilmScene } from "./film-scene.js";
import {
  chooseCinematicView,
  chooseCinematicAngle,
  cinematicSafeArea,
  letterboxShare,
  createCinematicCamera,
  isStackedLayout,
  layoutRect,
} from "./cinematic.js";
import {
  GLINT_MOOD,
  LANTERN_MOOD,
  PALE_MOOD,
  RIM_UNIFORMS,
  setRim,
  shotLight,
} from "./film-light.js";
import {
  configureGroundShading,
  createSlateContacts,
  filmGroundSurface,
  slateCalmFor,
} from "./mud-ground.js";
import { ESTATE } from "./estate-layout.js";
import { createRockScatter, estateContacts } from "./rock-scatter.js";
import { createHillSilhouette } from "./hill-silhouette.js";
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
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
} from "three";
import { createArchitectureAssetController } from "./architecture-assets.js";
import { createLanternMount } from "./lantern.js";
import { createCompleteTowerArchitecture, createTreeArchitecture } from "./architecture.js";
import { createSceneAtmosphere } from "./atmosphere.js";
import { createSceneEnvironment } from "./environment.js";
import { createEstateSkyMaterial } from "./estate-sky.js";
import { createSceneRendering } from "./rendering.js";
import {
  createDeferredQualityStep,
  createPanelHold,
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
    // Dialogs hold rendering once their dim overlay has faded in (~440ms).
    let panelHold = null;
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
    let webglContextAvailable = true;
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
      width: window.innerWidth,
      world: WORLD,
    });
    subsystemRegistry.register(rendering);
    return runSceneInitialization(subsystemRegistry, () => {
      const { camera, homeScene, renderer } = rendering;
      scene.cinematicSelection ??= chooseCinematicView(window.location.search);
      scene.cinematicAngle ??= chooseCinematicAngle(
        window.location.search,
        scene.cinematicSelection,
      );
      let cinematicArea;
      // The hero uses layout geometry so scroll and its reveal/fade transforms do
      // not reframe the camera; the fixed bottom bar keeps its viewport rect.
      const measureCinematicArea = (width, height) =>
        cinematicSafeArea(
          width,
          height,
          layoutRect(document.getElementById("hero-minimal")),
          document.querySelector(".bottom-bar")?.getBoundingClientRect(),
        );
      const cinematic = createCinematicCamera({
        camera,
        fog: homeScene.fog,
        selected: scene.cinematicSelection,
        angle: scene.cinematicAngle,
        getSafeArea: (width, height) => cinematicArea || measureCinematicArea(width, height),
        getGroundY: (x, z) => groundHeight(x, z) + groundSurface.getWorldPosition(new Vector3()).y,
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
      atmosphereSystem.root.add(skyShell);
      atmosphereSystem.setSkyMaterial(skyShell.material);
      // The film's environment is captured from this shell's film sky.
      rendering.setEnvironmentSky(skyShell.material, skyConfig.shellOpacity);
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
      const environmentSystem = createSceneEnvironment({
        groundHeight,
        parent: sceneRoot,
        profile: state.profile,
      });
      subsystemRegistry.register(environmentSystem);
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
      // The name and intro, and About, on the canvas, in its UV (y up), where
      // the ground's water eases off (mud-ground.js SLATE_WATER.text), as the
      // light shafts' air does, and beside About the bark's lantern highlights
      // pass the same knee (the tree takes these uniforms); the sky's reshaped
      // banks ease out behind the name and intro too (estate-sky.js); measured
      // on resize, on font loads and every 30th frame.
      function measureGroundText() {
        const canvas = renderer.domElement?.getBoundingClientRect?.();
        const box = (text, selectors) => {
          let x0 = Infinity,
            y0 = Infinity,
            x1 = -Infinity,
            y1 = -Infinity;
          for (const selector of selectors)
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
        box(groundContacts.slateAbout.value, [".site-footer__about .about-link__label"]);
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
      // on at high or balanced with the Meshy massifs' GLBs at the startup tier; they
      // build in slices and land only while unseen (before the reveal, under its fade,
      // on a cut).
      const hillSilhouette = createHillSilhouette({
        groundHeight,
        skyRadius: WORLD.SKY_DOME_RADIUS,
        shellOpacity: skyConfig.shellOpacity,
        sunPosition: WORLD.SUN_POSITION,
        rendering,
        tour: cameraTour,
        tier: assetTier,
        invalidate: invalidateContent,
        onStatus: (status) => {
          if (qualityDebug) qualityDebug.mountains = status;
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
        onStatus: (status) => {
          if (qualityDebug) qualityDebug.rocks = status;
        },
      });
      subsystemRegistry.register(rockScatter);
      // The authored tower hangs under its own group in the environment.
      const towerRoot = new Group();
      environmentRoot.add(towerRoot);
      const towerGroundY = groundHeight(0, 0);
      // Authored casters and the sun hold still within a shot, so the shadow map
      // redraws only on reported changes.
      rendering.setStaticShadows(true);
      let treeArchitecture = null;
      // The authored tower's grounded lighting, on while the tower is shown.
      let groundedLighting = false;
      function setGroundedLighting(active) {
        if (groundedLighting === active) return;
        groundedLighting = active;
        rendering.setGroundedLighting(active);
      }
      subsystemRegistry.register({ dispose: () => setGroundedLighting(false) });
      const propScale = createPropScale({ groundRoot: environmentRoot, groundHeight });
      subsystemRegistry.register(propScale);
      let completeTower = null;
      // The orbital sun stays in the directed scene: it is the one warm celestial
      // anchor in an otherwise cool night, and reads as distance rather than clutter.
      filmScene = createFilmScene({
        ground: groundSurface,
        groundHeight,
        rendering,
        atmosphere: atmosphereSystem,
        skyMaterial: skyShell.material,
        invalidate: invalidateContent,
        tour: cameraTour,
        onGroundChange(active) {
          environmentSystem.setFilmTreatment(active);
          hillSilhouette.setFilmTreatment(active);
          filmActive = active;
          completeTower?.setFilmTreatment(active);
          groundTextures.setFilmActive(active);
          rockScatter.setFilmActive(active);
        },
      });
      subsystemRegistry.register(filmScene);
      // Light shafts: a lazy chunk for high and balanced film on WebGL2 only
      // (light-shafts.js). A failed import leaves the scene as it is; a late one
      // registers nothing.
      if (renderer.capabilities.isWebGL2) {
        import("./light-shafts.js").then(
          ({ lightShafts }) =>
            subsystemRegistry.disposed ||
            subsystemRegistry.register(
              lightShafts(
                rendering,
                cinematic,
                cameraTour,
                filmScene,
                environmentRoot,
                invalidateContent,
              ),
            ),
          () => {},
        );
      }
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
      // An authored tower or tree that cannot load shows the title card: the
      // scene stops at once and its runtime is disposed on a later tick, outside
      // the asset controller's callback.
      function failToTitle(stage, error) {
        if (sceneFailed) return;
        stopFailedScene(stage, error);
        // Three's compileAsync keeps polling its materials' programs, so dispose
        // only once in-flight warm-ups settle (each is bounded at 2 s).
        (function disposeWhenIdle() {
          if (shaderWarmup.pending) window.setTimeout(disposeWhenIdle, 50);
          else scene.disposeHomeSceneRuntime?.();
        })();
      }
      // Shader warm-up links new programs through compileAsync instead of a
      // blocking first draw. Until the canvas is first shown nothing draws while
      // one is pending; afterwards a committed model that replaces nothing
      // visible stays hidden until its programs are ready.
      let canvasShown = false;
      const shaderWarmup = createShaderWarmup({ compile: () => rendering.compileShaders() });
      // A detail change before the reveal links the ground's new program.
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
        includeLantern: true,
        onLanternReady: (asset) => lanternMount.stage(asset),
        onTowerReady(assets) {
          const assemblyStart = sceneNow();
          // The earth footing (-0.22) sets the lookout's posts into the terrace.
          const replacement = createCompleteTowerArchitecture({
            asset: assets.tower,
            groundY: towerGroundY,
            footingOffset: -0.22,
            anisotropy: chooseAnisotropy(6),
          });
          try {
            setGroundedLighting(true);
            propScale.setActive(true);
            filmScene.setActive(true);
            treeArchitecture?.setFilmTreatment(filmActive);
            replacement.setFilmTreatment?.(filmActive);
          } catch (error) {
            replacement.dispose();
            throw error;
          }
          completeTower = replacement;
          towerRoot.add(replacement.root);
          cinematic.setSubject("tower", replacement.root);
          rendering.invalidateShadows();
          invalidateContent();
          measureScene("assembly:tower", assemblyStart);
          warmShaders("tower", replacement.root);
          return () => {
            if (completeTower === replacement) completeTower = null;
            replacement.dispose();
          };
        },
        onRestoreTower() {
          cinematic.setSubject("tower", null);
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
          // Without its authored tower or tree the scene has nothing to show:
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
      };
      document.fonts?.addEventListener?.("loadingdone", onFontsLoaded);
      const onWindowScroll = () => {
        viewport.scrollTarget = Math.min(window.scrollY / (1.8 * viewport.height), 1.25);
        // The hero scrolls over the fixed canvas: the next frame re-measures
        // the ground's text guard (measuring here would flush layout per event).
        groundTextScrolled = true;
        frameScheduler?.invalidate();
      };
      window.addEventListener("resize", onWindowResize);
      window.addEventListener("scroll", onWindowScroll, { passive: true });
      resizeController.update({ force: true });
      let debugRenderFrameCount = 0,
        groundTextFrames = 0,
        groundTextScrolled = false;
      let debugRenderWindowStart = null;
      let firstFrameDrawn = false;
      // Governor steps link their programs at once and apply on a tour cut.
      const adaptiveSteps = createDeferredQualityStep({
        prepare: (profile) => rendering.prepareQuality(profile),
      });
      function updateSceneFrame({
        deltaSeconds,
        elapsedSeconds: elapsedTime,
        sampleDeltaSeconds,
        timestamp,
      }) {
        const frameStart = firstFrameDrawn ? 0 : sceneNow();
        if (++groundTextFrames % 30 === 1 || groundTextScrolled) {
          groundTextScrolled = false;
          measureGroundText();
        }
        // Samples are rAF intervals, not render cost; take them only while the
        // revealed scene animates continuously, outside a post-event hold, and
        // not while a step waits for its cut.
        const revealed = sceneReadyMarked && cinematic.ready;
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
        const tourPhase =
          cameraTour?.update({
            elapsedSeconds: elapsedTime,
            reducedMotion,
            panelOpen: document.body.hasAttribute("data-panel-open"),
          }) ?? null;
        const transition = cameraTour?.transition ?? TOUR_IDLE;
        // Each step changes the tier or, below balanced, only the pixel ratio. A
        // running tour takes it on a cut, where the crossfade's kept frame hides
        // its one-off work.
        const adaptiveProfile = adaptiveSteps.take({
          cut: transition.cut,
          running: cameraTour?.running === true,
          nowMs,
        });
        if (adaptiveProfile) applyActiveQualityProfile(adaptiveProfile, "adaptive");
        lanternMount.take({
          revealed: canvasShown,
          running: cameraTour?.running === true,
          cut: transition.cut,
        });
        // The rocks appear on a cut too, with their ground contacts.
        if (
          rockScatter.take({ cut: transition.cut, running: cameraTour?.running === true, nowMs })
        ) {
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
        const cinematicApplied = cinematic.apply({
          width: viewport.width,
          height: viewport.height,
          elapsedSeconds: elapsedTime,
          reducedMotion,
          tourPhase,
          fallbackFov: cameraProfile.fov,
        });
        if (!cinematicApplied) {
          camera.position.set(
            Math.cos(orbitAngle) * orbitDistance,
            orbitHeight,
            Math.sin(orbitAngle) * orbitDistance,
          );
          camera.lookAt(0, lookAtHeight, 0);
        }
        if (cinematicApplied) lookTarget.copy(cinematic.target);
        else lookTarget.set(0, lookAtHeight, 0);
        // The shot's light mood, and the rim's moon direction from this lens.
        {
          const mood = shotLight(filmActive && cinematicApplied ? cinematic.shot : null);
          rendering.setShotLight?.(mood);
          if (LANTERN_MOOD.value !== mood.lantern) {
            LANTERN_MOOD.value = mood.lantern;
            treeArchitecture?.refreshLantern?.();
          }
          setRim(filmActive ? mood.rim : 0, filmActive ? mood.rimText : 0);
          PALE_MOOD.value = filmActive ? mood.pale : 0;
          GLINT_MOOD.value = filmActive ? mood.glintText : 0;
          camera.updateMatrixWorld();
          RIM_UNIFORMS.babelKeyView.value
            .set(...WORLD.SUN_DIRECTION)
            .transformDirection(camera.matrixWorldInverse);
        }
        // The shot's lens and the film's bars and grain follow the shot on screen.
        const post = rendering.postprocessPipeline;
        post.setLens?.(cinematicApplied ? cinematic.shot?.lens : null);
        post.setBars?.(
          filmActive && cinematicApplied ? letterboxShare(viewport.width, viewport.height) : 0,
        );
        if (
          !reducedMotion &&
          !visitorHold?.paused &&
          !document.body.hasAttribute("data-panel-open")
        )
          post.setFilmTime?.(elapsedTime);
        // The shot's ground calm follows the shot on screen, so it changes on a cut.
        slateCalmFor(
          groundContacts,
          cinematicApplied ? cinematic.shot : null,
          cinematic.frame?.distance,
          cinematic.target,
        );
        subsystemRegistry.update({
          deltaSeconds,
          elapsedSeconds: elapsedTime,
          motionPaused: visitorHold?.paused || document.body.hasAttribute("data-panel-open"),
          reducedMotion,
          render: false,
          visibilityScale,
          bloom: rendering.postprocessPipeline.passes?.bloom?.enabled === true,
        });
        // The phone band shades the frame's top behind a name stacked above
        // the subject; beside it (landscape phones) it would dim the subject.
        if (filmActive)
          filmScene.finishFrame(
            camera,
            lookTarget,
            cinematic.frame,
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
          !sceneFailed && cinematic.ready && (canvasShown || !shaderWarmup.pending);
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
      reducedMotionMQ.addEventListener("change", onReducedMotionChange);
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
        typeof MutationObserver === "function"
          ? new MutationObserver(() => panelHold.sync())
          : null;
      panelObserver?.observe(document.body, {
        attributes: true,
        attributeFilter: ["data-panel-open"],
      });
      panelHold.sync();
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
        cameraTour?.setPaused(next);
        return visitorHold.set(next);
      };
      scene.isVisitorPaused = () => visitorHold.paused;
      scene.setVisitorPaused(scene.visitorPausedPreference === true);
      scene.disposeHomeSceneRuntime = function disposeHomeSceneRuntime() {
        if (runtimeDisposed) return false;
        runtimeDisposed = true;
        sceneReadyMarked = false;
        container.classList?.remove("is-ready");
        document.fonts?.removeEventListener?.("loadingdone", onFontsLoaded);
        window.removeEventListener("resize", onWindowResize);
        window.removeEventListener("scroll", onWindowScroll);
        document.removeEventListener("visibilitychange", onDocumentVisibilityChange);
        reducedMotionMQ.removeEventListener("change", onReducedMotionChange);
        sceneIntersectionObserver?.disconnect();
        sceneIntersectionObserver = null;
        panelObserver?.disconnect();
        panelHold.dispose();
        visitorHold.dispose();
        pixelRatioWatcher.dispose();
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
      frameScheduler.start();
      measureScene("init", initStart);
      return true;
    });
  };
})();
