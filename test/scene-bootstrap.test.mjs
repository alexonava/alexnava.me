// How src/scene/index.js wires the scene's systems together. The systems
// themselves are tested on their own; these checks read the bootstrap's
// source, flattened so they hold however Prettier wraps it.
import assert from "node:assert/strict";
import test from "node:test";
import { flat, source } from "./support/code.mjs";
import { createDeferredQualityStep } from "../src/scene/runtime.js";

const index = flat(source("src/scene/index.js"));
// The text between two anchors of the flattened bootstrap.
const between = (from, to) => index.slice(index.indexOf(from), to ? index.indexOf(to) : undefined);

test("the actual quality dispatch keeps a paused visible shot intact until its cut", async () => {
  const argument = index.match(/const adaptiveProfile = adaptiveSteps\.take\((\{[^]*?\})\);/)[1];
  const dispatch = new Function(
    "canvasShown",
    "site",
    "liveView",
    "transition",
    "nowMs",
    `return (${argument});`,
  );
  const profile = { tier: "balanced", dprCap: 0.85 };
  const step = createDeferredQualityStep({ prepare: () => true });
  step.queue(profile, 0);
  await Promise.resolve();
  const args = (visible, closed, cut) =>
    dispatch(visible, { sceneDoors: { closed } }, { running: false }, { cut }, 60000);
  assert.equal(
    step.take(args(true, false, false)),
    null,
    "a pause cannot bypass the cut even after the old timeout",
  );
  assert.equal(step.take(args(true, false, true)), profile);
  for (const [visible, closed] of [
    [false, false],
    [true, true],
  ]) {
    step.queue(profile, 0);
    await Promise.resolve();
    assert.equal(
      step.take(args(visible, closed, false)),
      profile,
      "concealed preparation still accepts resolution relief",
    );
  }
});

test("a watch or tree that cannot commit fails to the title card once the camera knows; the lantern is optional", () => {
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

test("models and maps keep the startup tier, and quality samples only completed presentation or revealed frames", () => {
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
  assert.match(
    index,
    /const revealed = \(canvasShown \|\| openingGate\.state\.stage === "presentation"\) && cinematic\.ready;/,
  );
  assert.match(
    index,
    /revealed && !reducedMotion && !shaderWarmup\.pending && !adaptiveSteps\.pending \? qualityState\.sampleRevealed\?\.\(/,
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
    /const adaptiveProfile = adaptiveSteps\.take\(\{ cut: transition\.cut, running: canvasShown && !site\.sceneDoors\?\.closed, nowMs \}\); if \(adaptiveProfile\) applyActiveQualityProfile\(adaptiveProfile, "adaptive"\);/,
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
    ["visitor hold release", "onRelease:"],
  ]) {
    const start = index.indexOf(anchor);
    assert.ok(start >= 0, label);
    assert.ok(index.slice(start, start + 320).includes("qualityState.holdSampling()"), label);
  }
});

test("each frame runs the tour, the quality step, the capture skip, the crossfade, the camera and the draw in order", () => {
  const frame = index.slice(index.indexOf("function updateSceneFrame("));
  assert.match(frame, /const \{ width, height \} = viewport;/);
  const anchors = [
    "const { width, height } = viewport;",
    "qualityState.sampleRevealed?.(",
    "cameraTour?.update(",
    "const tourTransition = cameraTour?.transition ?? TOUR_IDLE;",
    "const transition = walk ? walk.step(elapsedTime, tourTransition) : tourTransition;",
    "adaptiveSteps.take(",
    "applyActiveQualityProfile(adaptiveProfile",
    "lanternMount.take({ revealed: canvasShown, running: liveView.running, cut: transition.cut })",
    "qualityState.skipSamples?.(3)",
    "rendering.postprocessPipeline.setTransition?.(transition);",
    "cinematic.apply(",
    "walk.update(deltaSeconds, width, height);",
    "subsystemRegistry.update(",
    "if (canvasShown || (presentingOpening && !shaderWarmup.pending)) {",
    "visitorHold?.frameRendered();",
  ];
  const order = anchors.map((anchor) => frame.indexOf(anchor));
  anchors.forEach((anchor, i) => assert.ok(order[i] >= 0, `${anchor} is wired`));
  assert.deepEqual(
    order,
    [...order].sort((a, b) => a - b),
  );
});

test("only a visitor pause holds rendering, and a resize draws one frame behind it", () => {
  assert.doesNotMatch(index, /data-panel-open|createPanelHold|panelHold/);
  assert.match(
    index,
    /function applySceneSize\([^]*?visitorHold\?\.redraw\(\); frameScheduler\?\.invalidate\(\);/,
  );
  assert.match(
    between("function disposeHomeSceneRuntime"),
    /visitorHold\.dispose\(\);[^]*?frameScheduler\.dispose\(\);/,
  );
});

test("the visitor pause stops the tour and holds rendering; content changes still draw one frame", () => {
  assert.match(
    index,
    /scene\.setVisitorPaused = \(paused\) => \{ const next = Boolean\(paused\); scene\.visitorPausedPreference = next; if \(next\) walk\?\.exit\(\{ immediate: true \}\); cameraTour\?\.setPaused\(next\); return visitorHold\.set\(next\); \};/,
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

test("the first frame and reveal wait for the complete opening and linked shaders", () => {
  assert.match(
    index,
    /const shaderWarmup = createShaderWarmup\(\{ compile\(\) \{[^]*?rendering\.compileShaders\(2000, atmosphereSystem\.root\);[^]*?finally \{ environmentRoot\.visible = visible; \}/,
  );
  assert.match(
    index,
    /openingGate\.state\.stage === "presentation"[^]*?const drawn = rendering\.update\(\);[^]*?openingPresentation\.sample\(timestamp, sceneNow\(\) - renderStart\)[^]*?settleOpening\("presentation"\);[^]*?if \(!firstFrameDrawn && drawn !== false\) \{ firstFrameDrawn = true; measureScene\("first-frame", frameStart\);/,
  );
  // Hidden preparation starts only once the cooperative fit has been applied.
  assert.match(index, /preparing: !canvasShown && cinematicApplied,/);
  assert.match(
    index,
    /if \(!canvasShown && cinematicApplied && cinematic\.frame && cinematic\.current === opening\.view && !sceneFailed\) \{ settleOpening\("subjects"\);/,
  );
  assert.match(
    index,
    /if \(openingPrepared && !openingShaderStarted && !shaderWarmup\.pending\) \{[^]*?openingShaderStarted = true; const generation = openingGeneration; warmShaders\("opening"\)/,
  );
  assert.match(
    index,
    /const sceneShown = !sceneFailed && cinematic\.ready && \(canvasShown \|\| \(openingGate\.ready && !shaderWarmup\.pending\)\);/,
  );
  assert.match(index, /warmShaders\("scene"\); observeOpening\(\); frameScheduler\.start\(\);/);
  // The watch's commit links the film's programs before the reveal. A committed
  // tree replaces nothing visible, so it stays hidden until its programs link.
  assert.match(index, /measureScene\("assembly:watch", assemblyStart\); warmShaders\("watch"\);/);
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
    /container\?\.classList\.toggle\("is-ready", sceneShown\);[^]*?frameScheduler\?\.setStill\(!sceneShown && !presentingOpening,?\);/,
  );
  assert.match(
    index,
    /if \(sceneShown && !canvasShown\) \{ markScene\("reveal"\); revealTime = elapsedTime; cameraTour\?\.reset\(\); stopOpeningPreparation\(\); rockScatter\.setRevealed\(\); atmosphereSystem\.setRevealed\(opening\.view === "watch"\); groundTextures\.update\?\.\(\{ revealed: true \}\); openingBackgroundStarted = true;[^]*?deferredWarmups\.clear\(\); \}/,
  );
});

test("renders keep an even display cadence near 60 Hz: desktops at or above it, touch screens at or below", () => {
  assert.match(
    index,
    /createSceneFrameScheduler\(\{ displayCadence: \{ baseRate: 60, round: qualityState\.touchPrimary \? "ceil" : "floor" \},[^]*?targetFrameRate: 60 \}\);/,
  );
});

test("the phone text band shades only a name stacked above the subject", () => {
  assert.match(
    index,
    /filmScene\.finishFrame\(camera, lookTarget, walking \? walk\.frame : cinematic\.frame, !walking && width < 900 && isStackedLayout\(width, height\) && cinematic\.shot\?\.arc === 2, \(cinematicArea\?\.top \|\| 200\) \/ height\);/,
  );
});

test("the authored scene's shadow map redraws only on reported changes", () => {
  assert.match(index, /rendering\.setStaticShadows\(true\);/);
  assert.match(
    index,
    /rendering\.invalidateShadows\(\); invalidateContent\(\); resolve\(ready\); \}\)\);/,
  );
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
    /const surface = filmGroundSurface\(\{ film: filmActive, surface: GROUND_SURFACE_MATERIAL \}\);[^]*?configureGroundShading\(material, filmActive, \{\s*detail: detailMap,\s*grit: gritMap,\s*relief: reliefMap,\s*contacts: groundContacts,?\s*\}\);[^]*?material\.roughness = surface\.roughness; material\.metalness = surface\.metalness; material\.color\.setHex\(surface\.color\);/,
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
  for (const name of ["init", "first-frame", "assembly:watch", "assembly:tree"])
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
  const preparation = flat(source("src/scene/preparation-tasks.js"));
  const request = between("function prepareTourShot(", "const cameraTour =");
  // The lazy helper owns the bounded preparation queue, and failed optional
  // imports are handled. A disposed scene retires its queued request.
  assert.match(request, /loadPreparationTasks\(\)\s*\.then\(/);
  assert.match(
    request,
    /queueTourShot\(cinematic, subject, angle, \(\) => runtimeDisposed \? null : \[viewport\.width, viewport\.height, cameraTour\?\.transition \?\? TOUR_IDLE\]\)/,
  );
  assert.match(request, /\.catch\(\(\) => \{\}\);/);
  // Idle work retains its timer fallback on browsers without requestIdleCallback.
  assert.match(
    preparation,
    /host\.requestIdleCallback \? host\.requestIdleCallback\(task, \{ timeout: 1500 \}\) : host\.setTimeout\(task, 50\);/,
  );
  // One chain at a time, on the latest request; a slot that lands on a
  // hidden page, capture or crossfade waits for the next one.
  assert.match(
    preparation,
    /let job = tourPreparations\.get\(camera\); if \(job\) \{ job\.shot = \[subject, angle\]; job\.frame = frame; return; \}/,
  );
  assert.match(
    preparation,
    /const current = job\.frame\(\); if \(!current\) \{ tourPreparations\.delete\(camera\); return; \}/,
  );
  assert.match(
    preparation,
    /host\.document\?\.hidden \|\| transition\.capture \|\| transition\.progress < 1 \|\| camera\.prepare\(\.\.\.job\.shot, width, height, createCameraPreparation\) === "pending"\) idle\(step\); else tourPreparations\.delete\(camera\);/,
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

test("the film terrain is film-scene.js's lazy chunk with explicit hidden preparation", () => {
  // It builds in short slices and lands only where it cannot show mid-shot,
  // so the film takes the tour, not the scene's warm-up.
  assert.match(index, /createFilmScene\(\{[^}]*tour: liveView,/);
  assert.doesNotMatch(index, /createFilmScene\(\{[^}]*warm[:,]/);
  assert.equal(index.match(/import\("\.\/terrain-build\.js"\)/g), null);
});

test("the walk holds the tour, drives the camera between its cuts, and lands content only on them", () => {
  // Content that lands only unseen takes the walk's cuts as the tour's while it holds.
  assert.match(
    index,
    /const liveView = \{ get running\(\) \{ return walk\?\.holdsTour === true \|\| cameraTour\?\.running === true; \}, get transition\(\) \{ return walk\?\.transition \?\? cameraTour\?\.transition \?\? TOUR_IDLE; \} \};/,
  );
  assert.match(index, /createHillSilhouette\(\{[^}]*tour: liveView,/);
  assert.match(index, /held: walk\?\.holdsTour === true \}\)/);
  assert.match(
    index,
    /rockScatter\.take\(\{ cut: transition\.cut, running: liveView\.running, nowMs \}\)/,
  );
  // No shot is on screen while it drives: the shot-keyed pins elsewhere hold.
  assert.match(index, /const shotOnScreen = \(\) => \(walk\?\.drives \? null : cinematic\.shot\);/);
  assert.match(index, /shot: \(\) => shotOnScreen\(\)\?\.name \?\? null,/);
  assert.match(index, /shot: shotOnScreen,/);
  assert.match(index, /const cinematicApplied = !walking && cinematic\.apply\(\{/);
  assert.match(
    index,
    /if \(walking\) walk\.update\(deltaSeconds, width, height\); else if \(!cinematicApplied\) \{/,
  );
  assert.match(
    index,
    /if \(cinematicApplied\) lookTarget\.copy\(cinematic\.target\); else if \(walking\) lookTarget\.copy\(walk\.focus\);/,
  );
  // The text guards rest while the page is hidden.
  assert.match(index, /for \(const selector of walk\?\.textHidden \? \[\] : selectors\)/);
  // The key: one listener, a lazy walk.js, the mouse captured inside the press.
  assert.match(index, /import \{ isWalkKey, walkAllowed \} from "\.\/walk-key\.js";/);
  assert.equal(index.match(/import\("\.\/walk\.js"\)/g)?.length, 1);
  assert.match(index, /window\.addEventListener\("keydown", onWalkKey\);/);
  assert.match(
    between("function disposeHomeSceneRuntime"),
    /window\.removeEventListener\("keydown", onWalkKey\);/,
  );
  const key = between("const onWalkKey", 'window.addEventListener("keydown", onWalkKey);');
  assert.ok(key.indexOf("requestPointerLock") < key.indexOf('import("./walk.js")'));
  assert.match(
    key,
    /if \(walk\?\.active\) \{ event\.preventDefault\(\); walk\.exit\(\); return; \}/,
  );
  assert.match(index, /subsystemRegistry\.register\(\{ dispose: \(\) => walk\.dispose\(\) \}\);/);
  // A visitor pause (above) or reduced motion ends it at once.
  assert.match(
    index,
    /reducedMotion = Boolean\(event\?\.matches\); if \(reducedMotion\) walk\?\.exit\(\{ immediate: true \}\);/,
  );
});

test("the film's environment, the ground's text guard and the flame's bloom are wired from the bootstrap", () => {
  // The environment is captured from the sky shell's own film sky.
  assert.match(
    index,
    /atmosphereSystem\.setSkyMaterial\(skyShell\.material\); rendering\.setEnvironmentSky\(skyShell\.material, skyConfig\.shellOpacity\);/,
  );
  // The ground's water eases off behind the name and intro and behind the
  // footer's labels (Contact, and the email and LinkedIn while they show),
  // measured on the canvas on resize, on font loads, every 30th frame and on
  // the first frame after a scroll or after the links show or hide.
  assert.match(index, /box\(groundContacts\.slateText\.value, \[".hero h1", ".hero-intro"\]\);/);
  assert.match(
    index,
    /box\(groundContacts\.slateAbout\.value, \[".site-footer .site-footer__label"\]\);/,
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
    /if \(\+\+groundTextFrames % 30 === 1 \|\| groundTextStale\) \{ groundTextStale = false; measureGroundText\(\); \}/,
  );
  // The hero scrolls over the fixed canvas: the scroll handler only flags the
  // guard (measuring there would flush layout on every scroll event).
  const onScroll = index.match(/const onWindowScroll = \(\) => \{[^}]*\};/)?.[0] ?? "";
  assert.match(onScroll, /groundTextStale = true; frameScheduler\?\.invalidate\(\);/);
  assert.doesNotMatch(onScroll, /measureGroundText|getBoundingClientRect/);
  // So does Contact showing or hiding its links: a ResizeObserver on them.
  assert.match(
    index,
    /new ResizeObserver\(\(\) => \{ groundTextStale = true; frameScheduler\?\.invalidate\(\); \}\)/,
  );
  assert.match(
    index,
    /for \(const links of document\.querySelectorAll\(".site-footer__links"\)\) footerLinksObserver\?\.observe\(links\);/,
  );
  assert.match(
    between("function disposeHomeSceneRuntime"),
    /footerLinksObserver\?\.disconnect\(\);/,
  );
  // Beside the footer the bark's lantern highlights pass the same guard, on the ground's uniforms.
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
