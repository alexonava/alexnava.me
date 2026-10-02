// How src/scene/index.js wires the scene's systems together. The systems
// themselves are tested on their own; these checks read the bootstrap's
// source, flattened so they hold however Prettier wraps it.
import assert from "node:assert/strict";
import test from "node:test";
import { flat, source } from "./support/code.mjs";

const index = flat(source("src/scene/index.js"));
// The text between two anchors of the flattened bootstrap.
const between = (from, to) => index.slice(index.indexOf(from), to ? index.indexOf(to) : undefined);

test("a missing tower or tree fails to the title card once the camera knows; the lantern is optional", () => {
  const onStatus = between("onStatus(status) {", "subsystemRegistry.register(architectureAssets);");
  assert.ok(onStatus.indexOf("cinematic.setStatus(status);") < onStatus.indexOf("failToTitle("));
  assert.match(
    onStatus,
    /status\.kind !== "lantern" && \(status\.status === "fallback" \|\| \(status\.status === "procedural" && sceneReadyMarked\)\)\) \{ failToTitle\(/,
  );
  // The scene stops at once; the runtime is disposed once warm-ups settle.
  assert.match(
    index,
    /function failToTitle\(stage, error\) \{ if \(sceneFailed\) return; stopFailedScene\(stage, error\);[^]*?\(function disposeWhenIdle\(\) \{ if \(shaderWarmup\.pending\) window\.setTimeout\(disposeWhenIdle, 50\); else scene\.disposeHomeSceneRuntime\?\.\(\);/,
  );
  // A scene never shown hides its host, retiring the loading line; a shown
  // canvas fades out to the title card.
  assert.match(
    between("function stopFailedScene", "function failToTitle"),
    /sceneFailed = true; container\.classList\?\.remove\("is-ready"\); if \(!canvasShown\) container\.hidden = true;/,
  );
  assert.ok(
    index.indexOf("let canvasShown = false;") <
      index.indexOf("createArchitectureAssetController({"),
  );
  assert.match(index, /webglContextAvailable && !sceneFailed;/);
  // The lantern loads beside the models and warms its programs only when it commits.
  assert.match(
    index,
    /includeLantern: true, onLanternReady: \(asset\) => lanternMount\.stage\(asset\)/,
  );
  assert.match(index, /if \(committed\) warmShaders\("lantern"\);/);
});

test("the light shafts load once, on WebGL2 only, and a late import registers nothing", () => {
  assert.match(index, /const \{ camera, homeScene, renderer \} = rendering;/);
  assert.match(
    index,
    /if \(renderer\.capabilities\.isWebGL2\) \{ import\("\.\/light-shafts\.js"\)\.then\(\(\{ lightShafts \}\) => subsystemRegistry\.disposed \|\| subsystemRegistry\.register\(lightShafts\(rendering, cinematic, cameraTour, filmScene, environmentRoot, invalidateContent\)\), \(\) => \{\}\); \}/,
  );
  assert.equal(index.match(/import\("\.\/light-shafts\.js"\)/g).length, 1);
});

test("models and maps keep the startup tier, and quality is sampled only after the reveal", () => {
  assert.match(index, /const assetTier = qualityState\.initialTier;/);
  assert.match(index, /architectureAssets\.setQuality\(state\.profile, true, \{ assetTier \}\);/);
  assert.match(
    index,
    /subsystemRegistry\.applyQuality\(state\.profile, \{ pixelRatio, assetTier \}\);/,
  );
  assert.match(
    flat(source("src/scene/textures.js")),
    /applyQuality\(profile, context\) \{ filmMaps\.applyQuality\(profile, context\); \}/,
  );
  assert.match(index, /const revealed = sceneReadyMarked && cinematic\.ready;/);
  assert.match(
    index,
    /revealed && !reducedMotion && !adaptiveSteps\.pending \? qualityState\.sampleRevealed\?\.\(/,
  );
  // A step links its programs when sampled and lands on a tour cut, where the
  // crossfade's kept frame hides it; the one-off transition frames go unsampled.
  assert.match(
    index,
    /const adaptiveSteps = createDeferredQualityStep\(\{ prepare: \(profile\) => rendering\.prepareQuality\(profile\) \}\);/,
  );
  assert.match(index, /if \(sampledProfile\) adaptiveSteps\.queue\(sampledProfile, nowMs\);/);
  assert.match(
    index,
    /const adaptiveProfile = adaptiveSteps\.take\(\{ cut: transition\.cut, running: cameraTour\?\.running === true, nowMs \}\); if \(adaptiveProfile\) applyActiveQualityProfile\(adaptiveProfile, "adaptive"\);/,
  );
  assert.match(index, /if \(transition\.capture\) qualityState\.skipSamples\?\.\(3\);/);
});

test("each event that brings uploads or compiles restarts the sampling hold", () => {
  for (const [label, anchor] of [
    ["intersection resume", "if (sceneVisible) {"],
    ["context restore", "onContextRestored() {"],
    ["ground readiness", "onDetailStatus(status) {"],
    ["model readiness", "onStatus(status) {"],
    ["resize", "function applySceneSize("],
    ["document resume", "const onDocumentVisibilityChange = () => {"],
    ["dialog release", "onRelease:"],
  ]) {
    const start = index.indexOf(anchor);
    assert.ok(start >= 0, label);
    assert.ok(index.slice(start, start + 160).includes("qualityState.holdSampling()"), label);
  }
});

test("each frame runs the tour, the quality step, the capture skip, the crossfade, the camera and the draw in order", () => {
  const frame = index.slice(index.indexOf("function updateSceneFrame("));
  const order = [
    "qualityState.sampleRevealed?.(",
    "cameraTour?.update(",
    "const transition = cameraTour?.transition ?? TOUR_IDLE;",
    "adaptiveSteps.take(",
    "applyActiveQualityProfile(adaptiveProfile",
    "lanternMount.take({ revealed: canvasShown, running: cameraTour?.running === true, cut: transition.cut })",
    "qualityState.skipSamples?.(3)",
    "rendering.postprocessPipeline.setTransition?.(transition);",
    "cinematic.apply(",
    "subsystemRegistry.update(",
    "rendering.update();",
    "panelHold?.frameRendered(); visitorHold?.frameRendered();",
  ].map((anchor) => frame.indexOf(anchor));
  assert.ok(
    order.every((at) => at >= 0),
    "each frame step is wired",
  );
  assert.deepEqual(
    order,
    [...order].sort((a, b) => a - b),
  );
});

test("an open dialog holds rendering 450 ms after it opens, and a resize draws one frame behind it", () => {
  assert.match(
    index,
    /panelHold = createPanelHold\(\{ delayMs: 450, isOpen: \(\) => document\.body\.hasAttribute\("data-panel-open"\), onRelease: \(\) => qualityState\.holdSampling\(\), scheduler: frameScheduler \}\);/,
  );
  assert.match(index, /attributeFilter: \["data-panel-open"\]/);
  assert.match(
    index,
    /function applySceneSize\([^]*?panelHold\?\.redraw\(\); visitorHold\?\.redraw\(\); frameScheduler\?\.invalidate\(\);/,
  );
  assert.match(
    between("function disposeHomeSceneRuntime"),
    /panelObserver\?\.disconnect\(\); panelHold\.dispose\(\); visitorHold\.dispose\(\);[^]*?frameScheduler\.dispose\(\);/,
  );
});

test("the visitor pause stops the tour and holds rendering; content changes still draw one frame", () => {
  assert.match(
    index,
    /scene\.setVisitorPaused = \(paused\) => \{ const next = Boolean\(paused\); scene\.visitorPausedPreference = next; cameraTour\?\.setPaused\(next\); return visitorHold\.set\(next\); \};/,
  );
  assert.match(index, /scene\.isVisitorPaused = \(\) => visitorHold\.paused;/);
  assert.match(index, /scene\.setVisitorPaused\(scene\.visitorPausedPreference === true\);/);
  assert.match(index, /if \(sceneShown\) visitorHold\?\.reveal\(\);/);
  assert.match(index, /onContextRestored\(\) \{[^}]*?visitorHold\?\.redraw\(\);/);
  assert.match(
    index,
    /function invalidateContent\(\) \{ visitorHold\?\.redraw\(\); frameScheduler\?\.invalidate\(\); \}/,
  );
  assert.doesNotMatch(
    between("const onWindowScroll", 'window.addEventListener("resize"'),
    /invalidateContent|redraw/,
  );
  assert.match(
    between("function disposeHomeSceneRuntime"),
    /scene\.setVisitorPaused = \(\) => false; scene\.isVisitorPaused = \(\) => false;/,
  );
});

test("the reveal waits for the shader warm-up, and nothing draws while one links before it", () => {
  assert.match(
    index,
    /const shaderWarmup = createShaderWarmup\(\{ compile: \(\) => rendering\.compileShaders\(\) \}\);/,
  );
  assert.match(index, /if \(canvasShown \|\| !shaderWarmup\.pending\) \{ rendering\.update\(\);/);
  assert.match(
    index,
    /const sceneShown = !sceneFailed && cinematic\.ready && \(canvasShown \|\| !shaderWarmup\.pending\);/,
  );
  assert.match(index, /warmShaders\("scene"\); frameScheduler\.start\(\);/);
  // A committed model replaces nothing visible, so it stays hidden until its programs link.
  assert.match(index, /warmShaders\("tower", replacement\.root\);/);
  assert.match(index, /warmShaders\("tree", replacement\.root\);/);
  // A ground program that changes before the reveal links through compileAsync.
  assert.equal(
    (index.match(/contacts: groundContacts \}\); warmGround\?\.\(\);/g) || []).length,
    1,
  );
  assert.match(index, /warmGround = \(\) => canvasShown \|\| warmShaders\("ground"\);/);
});

test("the hidden canvas idles until the reveal, which marks it and lets the rocks load", () => {
  assert.match(
    index,
    /container\?\.classList\.toggle\("is-ready", sceneShown\);[^]*?frameScheduler\?\.setStill\(!sceneShown\);/,
  );
  assert.match(
    index,
    /if \(sceneShown && !canvasShown\) \{ markScene\("reveal"\); rockScatter\.setRevealed\(\); \}/,
  );
});

test("renders keep an even display cadence near 60 Hz: desktops at or above it, touch screens at or below", () => {
  assert.match(
    index,
    /createSceneFrameScheduler\(\{ displayCadence: \{ baseRate: 60, round: qualityState\.touchPrimary \? "ceil" : "floor" \},[^]*?targetFrameRate: 60 \}\);/,
  );
});

test("the authored scene's shadow map redraws only on reported changes", () => {
  assert.match(index, /rendering\.setStaticShadows\(true\);/);
  assert.match(index, /rendering\.invalidateShadows\(\); invalidateContent\(\); \}\);/);
});

test("the drawing buffer follows the full-bleed container while the canvas keeps its CSS size", () => {
  const rendering = flat(source("src/scene/rendering.js"));
  assert.match(rendering, /renderer\.setSize\(nextWidth, nextHeight, false\);/);
  assert.doesNotMatch(rendering, /renderer\.setSize\([^)]*\b(?:height|Height)\)/);
  assert.match(index, /readSize\(\) \{ const rect = container\?\.getBoundingClientRect\?\.\(\);/);
  assert.match(index, /new ResizeObserver\(\(\) => resizeController\.resize\(\)\)/);
  assert.match(index, /containerResizeObserver\?\.observe\(container\);/);
  assert.match(index, /containerResizeObserver\?\.disconnect\(\); resizeController\.dispose\(\);/);
  // A pixel-ratio change alone, as on a move between displays, resizes too.
  assert.match(
    index,
    /const pixelRatioWatcher = createPixelRatioWatcher\(\{ onChange: \(\) => resizeController\.resize\(\) \}\);/,
  );
  assert.match(between("function disposeHomeSceneRuntime"), /pixelRatioWatcher\.dispose\(\);/);
});

test("the ground shading has one call site, which takes the tint and shading from the film", () => {
  assert.equal((index.match(/configureGroundShading\(/g) || []).length, 1);
  assert.match(
    index,
    /const surface = filmGroundSurface\(\{ film: filmActive, surface: GROUND_SURFACE_MATERIAL \}\);[^]*?configureGroundShading\(material, filmActive, \{ detail: detailMap, contacts: groundContacts \}\);[^]*?material\.roughness = surface\.roughness; material\.metalness = surface\.metalness; material\.color\.setHex\(surface\.color\);/,
  );
});

test("main.js gates the scene on preferences and capabilities, with no user-agent, Lighthouse or viewport escape hatch", () => {
  const main = source("src/main.js");
  assert.doesNotMatch(main, /userAgent|Lighthouse|Chrome-Lighthouse/i);
  assert.doesNotMatch(main, /shortSide|longSide|phoneViewport/);
});

test("the scene declines the low tier before it builds a renderer", () => {
  const declines = index.indexOf('if (qualityState.initialTier === "low") return false;');
  assert.ok(declines > 0 && declines < index.indexOf("createSceneRendering({"));
});

test("rendering registers before initialization, and quality reaches every system through the registry", () => {
  const created = index.indexOf("const rendering = createSceneRendering({"),
    registered = index.indexOf("subsystemRegistry.register(rendering);"),
    initialized = index.indexOf("runSceneInitialization(subsystemRegistry");
  assert.ok(created >= 0 && registered > created && initialized > registered);
  assert.equal(index.match(/subsystemRegistry\.register\(rendering\);/g)?.length, 1);
  assert.doesNotMatch(index, /rendering\.applyQuality\(/);
  for (const system of ["environmentSystem", "atmosphereSystem"])
    assert.match(index, new RegExp(`subsystemRegistry\\.register\\(${system}\\);`));
});

test("the scene entry marks its evaluation first, and the bootstrap reuses the probe's limits", () => {
  const entry = source("src/scene-entry.js");
  assert.match(
    entry,
    /^import \{ markSceneEvaluated \} from "\.\/scene\/perf-marks\.js";\r?\nimport "\.\/shared\/webgl-probe\.js";/m,
  );
  assert.match(entry, /import "\.\/scene\/index\.js";\s*markSceneEvaluated\(\);\s*$/);
  assert.match(
    index,
    /caps: scene\.qualityCapsFromProbe\?\.\(site\.shared\?\.getWebGLCapabilities\?\.\(\)\) \?\? null/,
  );
  for (const name of ["init", "first-frame", "assembly:tower", "assembly:tree"])
    assert.ok(index.includes(`measureScene("${name}"`), name);
  assert.match(index, /measureScene\(`shaders:\$\{label\}`, start\);/);
  for (const path of [
    "src/shared/webgl-probe.js",
    "src/scene/quality.js",
    "src/scene/rendering.js",
  ])
    assert.doesNotMatch(source(path), /high-performance/, path);
});

test("the tour fits its next shot in idle slices and refits after a resize, a font load or a model change", () => {
  // Each idle slice measures or fits once; Safari falls back to a timer.
  assert.match(
    index,
    /typeof window\.requestIdleCallback === "function" \? \(task\) => window\.requestIdleCallback\(task, \{ timeout: 1500 \}\) : \(task\) => window\.setTimeout\(task, 50\);/,
  );
  // One chain at a time, on the latest request; a slot that lands on a
  // capture or its crossfade waits for the next one.
  assert.match(
    index,
    /const idle = !tourShot; tourShot = \[subject, angle\]; if \(idle\) whenIdle\(function step\(\) \{ if \(runtimeDisposed\) return; const \{ capture, progress \} = cameraTour\?\.transition \?\? TOUR_IDLE; if \(capture \|\| progress < 1 \|\| cinematic\.prepare\(\.\.\.tourShot, viewport\.width, viewport\.height\) === "pending"\) whenIdle\(step\); else tourShot = null;/,
  );
  assert.match(index, /createCameraTour\(\{[^}]*prepare: prepareTourShot \}\)/);
  assert.match(
    index,
    /function applySceneSize\([^]*?frameScheduler\?\.invalidate\(\); cameraTour\?\.prepareNext\(\); \}/,
  );
  assert.match(
    index,
    /const onFontsLoaded = \(\) => \{ cinematicArea = measureCinematicArea\([^)]*\); cameraTour\?\.prepareNext\(\);/,
  );
  assert.match(index, /cinematic\.setStatus\(status\); cameraTour\?\.prepareNext\(\);/);
  assert.match(
    index,
    /cinematic\.setSubject\("tree", tree\?\.root \?\? null\); cameraTour\?\.prepareNext\(\);/,
  );
});

test("the film terrain is film-scene.js's lazy chunk and never holds the reveal", () => {
  // It builds in short slices and lands only where it cannot show mid-shot,
  // so the film takes the tour, not the scene's warm-up.
  assert.match(index, /createFilmScene\(\{[^}]*tour: cameraTour,/);
  assert.doesNotMatch(index, /createFilmScene\(\{[^}]*warm[:,]/);
  assert.equal(index.match(/import\("\.\/terrain-build\.js"\)/g), null);
});

test("the film's environment, the ground's text guard and the flame's bloom are wired from the bootstrap", () => {
  // The environment is captured from the sky shell's own film sky.
  assert.match(
    index,
    /atmosphereSystem\.setSkyMaterial\(skyShell\.material\); rendering\.setEnvironmentSky\(skyShell\.material, skyConfig\.shellOpacity\);/,
  );
  // The ground's water eases off behind the name and intro and behind About,
  // measured on the canvas on resize, on font loads, every 30th frame and on
  // the first frame after a scroll.
  assert.match(index, /box\(groundContacts\.slateText\.value, \[".hero h1", ".hero-intro"\]\);/);
  assert.match(
    index,
    /box\(groundContacts\.slateAbout\.value, \[".site-footer__about .about-link__label"\]\);/,
  );
  assert.match(
    index,
    /cinematicArea = measureCinematicArea\(width, height\); measureGroundText\(\);/,
  );
  assert.match(
    index,
    /cameraTour\?\.prepareNext\(\); measureGroundText\(\); invalidateContent\(\);/,
  );
  assert.match(
    index,
    /if \(\+\+groundTextFrames % 30 === 1 \|\| groundTextScrolled\) \{ groundTextScrolled = false; measureGroundText\(\); \}/,
  );
  // The hero scrolls over the fixed canvas: the scroll handler only flags the
  // guard (measuring there would flush layout on every scroll event).
  const onScroll = index.match(/const onWindowScroll = \(\) => \{[^}]*\};/)?.[0] ?? "";
  assert.match(onScroll, /groundTextScrolled = true; frameScheduler\?\.invalidate\(\);/);
  assert.doesNotMatch(onScroll, /measureGroundText|getBoundingClientRect/);
  // Beside About the bark's lantern highlights pass the same guard, on the ground's uniforms.
  assert.match(
    index,
    /createTreeArchitecture\(\{ asset, groundHeight, anisotropy: chooseAnisotropy\(6\), anchor: \[ESTATE\.tree\.x, ESTATE\.tree\.z\], textGuard: groundContacts \}\);/,
  );
  // The lantern flame's glare follows the bloom pass, not the shadow map
  // (balanced draws shadows without bloom).
  assert.match(index, /bloom: rendering\.postprocessPipeline\.passes\?\.bloom\?\.enabled === true/);
  // sceneDebug reports the capture.
  assert.match(
    index,
    /qualityDebug\.environment = \{ status, ms: Math\.round\(ms \* 10\) \/ 10 \};/,
  );
});
