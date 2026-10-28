import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  MirroredRepeatWrapping,
  RepeatWrapping,
  RGBADepthPacking,
  ShaderMaterial,
  SRGBColorSpace,
  Texture,
  WebGLRenderTarget,
} from "three";
import { markSceneEvaluated, measureScene, sceneNow } from "../src/scene/perf-marks.js";
import { createSceneRendering } from "../src/scene/rendering.js";
import { createShaderWarmup } from "../src/scene/runtime.js";
import { compilePrograms, linkedPrograms, shaderWaitBudget } from "../src/scene/shader-programs.js";
import { createHillSilhouette } from "../src/scene/hill-silhouette.js";
import { retireShaderMaterial } from "../src/scene/preparation-tasks.js";
import { createOpeningPreparation } from "../src/scene/opening-preparation.js";

const flush = () => new Promise((resolve) => setImmediate(resolve));
const linkedPoll = () => new Promise((resolve) => setTimeout(resolve, 25));
test("a replaced environment's freed shader programs are never polled or link-queried", async () => {
  let queried = 0;
  const gl = {
    isProgram: () => assert.fail("no synchronous driver identity queries"),
    getProgramParameter() {
      queried++;
      throw new Error("freed program");
    },
  };
  const program = {
    // Three r160's destroy() clears this field after deleting its GL handle.
    program: undefined,
    isReady() {
      queried++;
      throw new Error("freed program");
    },
  };
  const renderer = {
    getContext: () => gl,
    compile: () => new Set([{}]),
    properties: { get: () => ({ programs: new Map([["old", program]]) }) },
  };
  assert.equal(await compilePrograms(renderer, {}, {}, null, () => true), false);
  assert.equal(linkedPrograms(renderer, [program]), false);
  assert.equal(queried, 0);
});

test("shader admission checks asynchronous completion before link status without driver identity queries", async () => {
  let ready = false,
    links = 0;
  const program = { program: {}, isReady: () => ready };
  const gl = {
    LINK_STATUS: 35714,
    isProgram: () => assert.fail("identity checks would synchronize the driver"),
    getProgramParameter(handle, parameter) {
      assert.equal(ready, true, "never force an unfinished link");
      assert.equal(handle, program.program);
      assert.equal(parameter, this.LINK_STATUS);
      links++;
      return true;
    },
  };
  const renderer = {
    getContext: () => gl,
    compile: () => new Set([{}]),
    properties: { get: () => ({ currentProgram: program }) },
  };
  assert.equal(linkedPrograms(renderer, [program]), false);
  const pending = compilePrograms(renderer, {}, {}, null, () => true);
  await linkedPoll();
  assert.equal(links, 0);
  ready = true;
  assert.equal(await pending, true);
  assert.equal(links, 1);
  assert.equal(linkedPrograms(renderer, [program]), true);
});
test("task-based shader batches are submitted before nonblocking readiness checks", async () => {
  let submitted = false;
  const program = {
    program: {},
    isReady: () => {
      assert.equal(submitted, true);
      return true;
    },
  };
  const gl = {
    flush: () => {
      submitted = true;
    },
    getProgramParameter: () => true,
  };
  const renderer = {
    getContext: () => gl,
    compile: () => new Set([{}]),
    properties: { get: () => ({ currentProgram: program }) },
  };
  assert.equal(await compilePrograms(renderer, {}, {}, null, () => true), true);
  assert.equal(submitted, true);
});

test("shader timeouts count visible preparation and never query a hidden program", async () => {
  let now = 0;
  const document = { hidden: false },
    budget = shaderWaitBudget(1000, () => now, document);
  now = 200;
  assert.equal(budget(), 1);
  document.hidden = true;
  assert.equal(budget(), 0);
  now = 10000;
  assert.equal(budget(), 0);
  document.hidden = false;
  assert.equal(budget(), 1);
  now += 799;
  assert.equal(budget(), 1);
  now++;
  assert.equal(budget(), -1);

  const previous = globalThis.document;
  try {
    globalThis.document = { hidden: true };
    let queried = 0;
    const program = {
      program: {},
      isReady: () => {
        queried++;
        return true;
      },
    };
    const renderer = {
      compile: () => new Set([{}]),
      properties: { get: () => ({ currentProgram: program }) },
    };
    const pending = compilePrograms(renderer, {}, {}, null, () => true, 5);
    await linkedPoll();
    assert.equal(queried, 0, "hidden time neither queries nor expires preparation");
    globalThis.document.hidden = false;
    assert.equal(await pending, true);
    assert.ok(queried > 0);
  } finally {
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  }
});

test("the actual terrain release transfers its timed-out probe to driver-safe retirement", async () => {
  const text = await source("scene/terrain-build.js"),
    start = text.indexOf("const release = () => {", text.indexOf("Releasing a probe invalidates")),
    end = text.indexOf("// The sea,", start);
  assert.ok(start > 0 && end > start);
  let finishReadiness,
    ready = false,
    freed = 0;
  const tasks = [],
    material = { dispose: () => freed++ };
  const program = { program: {}, isReady: () => ready };
  const renderer = { properties: { get: () => ({ currentProgram: program }) } };
  let retirement;
  const rendering = {
    retireMaterial: (m) => {
      assert.equal(m, material);
      retirement = retireShaderMaterial(renderer, m, { schedule: (f) => tasks.push(f) });
      return retirement;
    },
  };
  const stale = { material, userData: { settled: new Promise((r) => (finishReadiness = r)) } };
  const run = new Function(
    "probe",
    "rendering",
    `${text.slice(start, end)}release();return () => probe;`,
  );
  const probe = run(stale, rendering);
  assert.equal(probe(), null, "old admission polling immediately loses its generation");
  assert.equal(retirement, undefined, "wait until the old poll has actually stopped");
  finishReadiness(false);
  await flush();
  assert.ok(retirement);
  assert.equal(freed, 0, "false readiness is not GPU completion");
  ready = true;
  tasks.shift()();
  await retirement;
  assert.equal(freed, 1);
});

test("retired probe material survives a readiness timeout until the actual driver link settles", async () => {
  let ready = false,
    freed = 0,
    now = 0,
    reads = 0;
  const tasks = [],
    program = {
      program: {},
      isReady: () => {
        reads++;
        return ready;
      },
    };
  const properties = { get: () => ({ programs: new Map([["ground", program]]) }) };
  const renderer = { properties, getContext: () => ({ isContextLost: () => false }) };
  const material = { dispose: () => freed++ };
  const pending = retireShaderMaterial(renderer, material, {
    now: () => now,
    schedule: (f) => tasks.push(f),
  });
  now = 2500;
  tasks.shift()();
  assert.equal(freed, 0, "the two-second admission timeout cannot delete a still-linking program");
  ready = true;
  tasks.shift()();
  await pending;
  assert.equal(freed, 1);
  assert.ok(reads >= 3);
  assert.equal(tasks.length, 0);
});

test("probe retirement observes hidden time, lost generations, and a genuinely stalled driver", async () => {
  for (const outcome of ["hidden", "context replaced", "stalled"]) {
    const tasks = [],
      document = { hidden: outcome === "hidden" };
    let now = 0,
      freed = 0,
      queried = 0;
    const program = {
      program: {},
      isReady: () => {
        queried++;
        return false;
      },
    };
    const renderer = {
      properties: { get: () => ({ currentProgram: program }) },
      getContext: () => ({ isContextLost: () => false }),
    };
    const pending = retireShaderMaterial(
      renderer,
      { dispose: () => freed++ },
      { now: () => now, document, schedule: (f) => tasks.push(f) },
    );
    if (outcome === "hidden") {
      now = 30000;
      tasks.shift()();
      assert.equal(freed, 0);
      assert.equal(queried, 0);
      document.hidden = false;
      program.program = undefined;
    } else if (outcome === "context replaced") renderer.properties = {};
    else now = 15000;
    const before = queried;
    tasks.shift()();
    await pending;
    assert.equal(freed, 1);
    assert.equal(queried, before);
    assert.equal(tasks.length, 0);
  }
});

const source = (path) => readFile(new URL(`../src/${path}`, import.meta.url), "utf8");
const materialsOf = (objects) => {
  const materials = new Set();
  objects.traverse(({ material }) => {
    for (const value of [material].flat()) if (value) materials.add(value);
  });
  return materials;
};

test("start-up User Timing entries carry the babel: prefix and never throw", () => {
  markSceneEvaluated();
  assert.equal(performance.getEntriesByName("babel:scene-entry", "mark").length, 1);
  assert.equal(performance.getEntriesByName("babel:scene-eval", "measure").length, 1);

  measureScene("unit", sceneNow());
  assert.ok(performance.getEntriesByName("babel:unit", "measure")[0].duration >= 0);

  assert.doesNotThrow(() => measureScene("missing", "babel:no-such-mark"));
  assert.equal(performance.getEntriesByName("babel:missing").length, 0);
});

function probeContext(gl) {
  const contexts = [];
  const window = { BabelSite: {}, WebGL2RenderingContext: function WebGL2RenderingContext() {} };
  const document = {
    createElement: () => ({
      getContext(kind, options) {
        contexts.push({ kind, options });
        return gl;
      },
    }),
  };
  return { contexts, context: { window, document } };
}

test("the WebGL probe records texture limits from its one default-power context", async () => {
  const probeSource = await source("shared/webgl-probe.js");
  const anisotropic = { MAX_TEXTURE_MAX_ANISOTROPY_EXT: "ANI" };
  let released = 0;
  const gl = {
    MAX_TEXTURE_SIZE: "MTS",
    RENDERER: "RENDERER",
    getParameter: (name) => ({ MTS: 8192, ANI: 15.6, RENDERER: "ANGLE (Apple M2)" })[name] ?? null,
    getExtension: (name) =>
      name === "EXT_texture_filter_anisotropic"
        ? anisotropic
        : name === "WEBGL_lose_context"
          ? { loseContext: () => (released += 1) }
          : null,
  };
  const { contexts, context } = probeContext(gl);
  vm.runInNewContext(probeSource, context);
  const shared = context.window.BabelSite.shared;

  const capabilities = shared.getWebGLCapabilities();
  assert.equal(capabilities.available, true);
  assert.equal(capabilities.maxTextureSize, 8192);
  assert.equal(capabilities.maxAnisotropy, 16);
  assert.equal(shared.getWebGLCapabilities(), capabilities, "the result is cached");
  assert.equal(contexts.length, 1);
  assert.equal(contexts[0].kind, "webgl2");
  assert.equal(contexts[0].options.powerPreference, "default");
  assert.equal(released, 1);

  const bare = probeContext({});
  vm.runInNewContext(probeSource, bare.context);
  const unknown = bare.context.window.BabelSite.shared.getWebGLCapabilities();
  assert.equal(unknown.available, true);
  assert.equal(unknown.maxTextureSize, 0, "unreadable limits are reported as unknown");
  assert.equal(unknown.maxAnisotropy, 1);
});

test("scene quality reuses the probe's limits and opens its own context only without them", async () => {
  const contexts = [];
  const window = { BabelSite: {}, location: { search: "" }, innerWidth: 1440, innerHeight: 900 };
  const document = {
    createElement: () => ({
      getContext(kind, options) {
        contexts.push({ kind, options });
        return { getParameter: () => 0, getExtension: () => null };
      },
    }),
  };
  vm.runInNewContext(await source("scene/quality.js"), {
    window,
    document,
    navigator: {},
    URLSearchParams,
    console,
  });
  const scene = window.BabelSite.scene;
  const probe = {
    available: true,
    softwareRenderer: false,
    maxTextureSize: 8192,
    maxAnisotropy: 16,
  };
  const caps = scene.qualityCapsFromProbe(probe);
  assert.equal(caps.maxTextureSize, 8192);
  assert.equal(caps.maxAnisotropy, 16);
  for (const missing of [undefined, { available: false }, { ...probe, maxTextureSize: 0 }]) {
    assert.equal(scene.qualityCapsFromProbe(missing), null);
  }

  const options = {
    navigatorInfo: { deviceMemory: 8, hardwareConcurrency: 8 },
    viewport: { width: 1440, height: 900 },
    touchPrimary: false,
    saveData: false,
  };
  const state = scene.createSceneQualityState({ ...options, caps });
  assert.equal(state.initialTier, "high");
  assert.equal(contexts.length, 0, "probe limits need no second context");

  scene.createSceneQualityState({ ...options, caps: scene.qualityCapsFromProbe(undefined) });
  assert.equal(contexts.length, 1, "unknown limits fall back to the scene's own probe");
  assert.equal(contexts[0].options.powerPreference, "default");
});

function createRendering(rendererOverrides = {}, renderingOverrides = {}) {
  const calls = [];
  let target = "screen";
  let rendererOptions = null;
  const renderer = {
    capabilities: { getMaxAnisotropy: () => 8 },
    debug: {},
    domElement: {},
    extensions: { has: (name) => name === "KHR_parallel_shader_compile" },
    shadowMap: {},
    properties: { get: () => ({ currentProgram: { isReady: () => true } }) },
    getContext: () => ({ isContextLost: () => false }),
    getRenderTarget: () => target,
    setClearColor() {},
    setRenderTarget(next) {
      target = next;
      calls.push(["target", next]);
    },
    compile(scene, camera) {
      calls.push(["compile", target, scene, camera]);
      return materialsOf(scene);
    },
    ...rendererOverrides,
  };
  const composer = { readBuffer: "scene-target", addPass() {}, render() {} };
  const rendering = createSceneRendering({
    container: { appendChild() {} },
    createPipeline: () => ({
      compile: () => calls.push(["post"]),
      composer,
      setQualityProfile() {},
    }),
    createRenderer: (options) => {
      rendererOptions = options;
      return renderer;
    },
    disposeResources: () => ({}),
    height: 600,
    lighting: {
      ambientColor: 0xffffff,
      ambientIntensity: 0.2,
      directionalColor: 0xffffff,
      directionalIntensity: 2,
      directionalPosition: { x: 1, y: 2, z: 3 },
      fogColor: 0,
      fogFar: 150,
      fogNear: 60,
      hemisphereGroundColor: 0,
      hemisphereIntensity: 0.7,
      hemisphereSkyColor: 0,
    },
    profile: {},
    threeExports: {},
    width: 800,
    world: {
      CAMERA_FAR: 210,
      CAMERA_FOV: 48,
      CAMERA_NEAR: 0.5,
      FILL_LIGHT_POSITION: [0, 1, 0],
      SHADOW_CAMERA_FAR: 120,
      SHADOW_CAMERA_HALF_EXTENT: 34,
      SHADOW_CAMERA_NEAR: 0.5,
    },
    ...renderingOverrides,
  });
  return { calls, rendering, rendererOptions, getTarget: () => target };
}

test("shader warm-up compiles against the composer's scene target and always settles", async () => {
  const ready = createRendering();
  assert.equal(ready.rendererOptions.powerPreference, "default");
  assert.equal(ready.rendering.renderer.debug.checkShaderErrors, false);
  const diagnostic = createRendering({}, { debugShaders: true });
  assert.equal(diagnostic.rendering.renderer.debug.checkShaderErrors, true);
  diagnostic.rendering.dispose();
  assert.equal(await ready.rendering.compileShaders(), true);
  assert.deepEqual(ready.calls[0], ["post"], "the crossfade's programs link in the same task");
  const compile = ready.calls.find(([kind]) => kind === "compile");
  assert.equal(compile[1], "scene-target", "program keys follow the scene pass's target");
  assert.equal(compile[2], ready.rendering.homeScene);
  assert.equal(compile[3], ready.rendering.camera);
  assert.equal(ready.getTarget(), "screen", "the previous target is restored");

  const rejected = createRendering({
    compile: () => new Set([{}]),
    properties: {
      get: () => ({
        currentProgram: {
          isReady() {
            throw new Error("lost");
          },
        },
      }),
    },
  });
  assert.equal(await rejected.rendering.compileShaders(), false);

  const throwing = createRendering({
    compile() {
      throw new Error("compile failed");
    },
  });
  assert.equal(await throwing.rendering.compileShaders(), false);
  assert.equal(throwing.getTarget(), "screen");

  let stalledReads = 0;
  const stalled = createRendering({
    compile: () => new Set([{}]),
    properties: {
      get: () => ({
        currentProgram: {
          isReady: () => {
            stalledReads++;
            return false;
          },
        },
      }),
    },
  });
  assert.equal(await stalled.rendering.compileShaders(5), false, "a stalled poll times out");
  await linkedPoll();
  const readsAfterTimeout = stalledReads;
  await linkedPoll();
  assert.equal(stalledReads, readsAfterTimeout, "the underlying poll ends too");

  const unsupported = createRendering({ compile: undefined });
  assert.equal(await unsupported.rendering.compileShaders(), false);

  // Without parallel compilation the draw links anyway, so there is nothing to
  // wait for; the crossfade's programs still link ahead of the first cut.
  const serial = createRendering({ extensions: { has: () => false } });
  assert.equal(await serial.rendering.compileShaders(), false);
  assert.deepEqual(serial.calls, [["post"]]);

  const lost = createRendering({ getContext: () => ({ isContextLost: () => true }) });
  assert.equal(await lost.rendering.compileShaders(), false);
  assert.equal(lost.calls.length, 0);

  const disposed = createRendering();
  disposed.rendering.dispose();
  assert.equal(await disposed.rendering.compileShaders(), false);
  assert.equal(disposed.calls.length, 0);
});

test("an opening scope uploads only its maps and compiles against the scene lights without unrelated depth programs", async () => {
  const uploads = [],
    compiles = [];
  const { rendering } = createRendering({
    initTexture: (texture) => uploads.push(texture.name),
    compile(objects, camera, lightingScene) {
      compiles.push({ objects, camera, lightingScene });
      return materialsOf(objects);
    },
  });
  const sky = new Group();
  const geometry = new BoxGeometry();
  const skyMap = Object.assign(new Texture({}), { name: "sky" });
  const groundMap = Object.assign(new Texture({}), { name: "ground" });
  const skyMaterial = new MeshBasicMaterial({ map: skyMap });
  const groundMaterial = new MeshStandardMaterial({ map: groundMap });
  const ground = new Mesh(geometry, groundMaterial);
  ground.castShadow = true;
  sky.add(new Mesh(geometry, skyMaterial));
  rendering.homeScene.add(sky, ground);
  rendering.renderer.shadowMap.enabled = rendering.lights.sun.castShadow = true;
  assert.equal(await rendering.compileShaders(2000, sky), true);
  assert.deepEqual(uploads, ["sky"], "unrelated physical maps wait for their cohort");
  assert.equal(compiles.length, 1, "unrelated shadow casters are not warmed for the sky");
  assert.equal(compiles[0].objects, sky);
  assert.equal(compiles[0].camera, rendering.camera);
  assert.equal(
    compiles[0].lightingScene,
    rendering.homeScene,
    "scoped materials retain real scene lighting",
  );
  assert.equal(rendering.renderer.shadowMap.enabled, true);
  assert.equal(await rendering.compileShaders(), true);
  assert.ok(uploads.includes("ground"), "the full preparation still uploads the physical set");
  assert.equal(compiles[1].objects, rendering.homeScene);
  rendering.dispose();
  geometry.dispose();
  skyMaterial.dispose();
  groundMaterial.dispose();
  skyMap.dispose();
  groundMap.dispose();
});

test("a tree opening begins its sliced physical preparation alongside the sky, while Watch leaves it deferred", async () => {
  const index = await source("scene/index.js"),
    start = index.indexOf('if (opening.view === "tree") filmScene.setActive(true);'),
    end = index.indexOf("observeOpening();", start);
  assert.ok(start > 0 && end > start);
  const begin = new Function("opening", "filmScene", "warmShaders", index.slice(start, end));
  for (const view of ["tree", "watch"]) {
    const calls = [];
    begin({ view }, { setActive: (active) => calls.push(["terrain", active]) }, (label) =>
      calls.push(["shaders", label]),
    );
    assert.deepEqual(
      calls,
      view === "tree"
        ? [
            ["terrain", true],
            ["shaders", "scene"],
          ]
        : [["shaders", "scene"]],
    );
  }
});

test("the sky-only Watch culls the physical set only until its next shot or the walk", async () => {
  const index = await source("scene/index.js");
  const start = index.indexOf("const showEnvironment =");
  const end = index.indexOf("// The cloud vortex", start);
  assert.ok(start > 0 && end > start);
  const update = new Function(
    "walking",
    "filmActive",
    "cinematic",
    "environmentRoot",
    "rendering",
    index.slice(start, end),
  );
  const environmentRoot = { visible: true };
  let invalidations = 0;
  const rendering = { invalidateShadows: () => invalidations++ };
  const state = (walking, film, shot) =>
    update(walking, film, { current: shot }, environmentRoot, rendering);
  state(false, true, "watch");
  assert.equal(environmentRoot.visible, false);
  state(false, true, "watch");
  assert.equal(invalidations, 1, "a continuing shot never requests redundant shadows");
  state(false, true, "portrait");
  assert.equal(environmentRoot.visible, true);
  assert.equal(invalidations, 2, "the incoming physical shot restores its set and shadows");
  state(false, true, "watch");
  state(true, true, "watch");
  assert.equal(environmentRoot.visible, true, "walking always restores the physical set");
  state(false, true, "watch");
  state(false, false, "watch");
  assert.equal(environmentRoot.visible, true, "non-film views keep the complete environment");
});

test("shader warm-up uploads visible maps; a quality step links its shadow variant", async () => {
  const uploaded = [];
  const compiled = [];
  let rendering = null;
  const setup = createRendering({
    initTexture: (texture) => uploaded.push(texture.name),
    compile(scene) {
      const { fill, sun } = rendering.lights;
      compiled.push([rendering.renderer.shadowMap.enabled, sun.castShadow, fill.visible]);
      return materialsOf(scene);
    },
  });
  rendering = setup.rendering;
  const named = (texture, name) => Object.assign(texture, { name });
  const geometry = new BoxGeometry();
  const shared = new MeshStandardMaterial({
    map: named(new Texture({ complete: true }), "map"),
    emissiveMap: named(new Texture({ complete: false }), "loading"),
    alphaMap: named(new Texture(), "empty"),
    envMap: named(new WebGLRenderTarget(4, 4).texture, "target"),
  });
  const hiddenMap = named(new Texture({}), "hidden");
  const hidden = new Mesh(geometry, new MeshBasicMaterial({ map: hiddenMap }));
  hidden.visible = false;
  const uniforms = { uMap: { value: named(new Texture({}), "uniform") } };
  rendering.homeScene.add(
    new Mesh(geometry, shared),
    new Mesh(geometry, shared),
    new Mesh(geometry, new ShaderMaterial({ uniforms })),
    hidden,
  );

  assert.equal(await rendering.compileShaders(), true);
  assert.deepEqual(uploaded, ["map", "uniform"], "visible, loaded, non-target maps, once each");

  const { fill, sun } = rendering.lights;
  const balanced = { shadows: { enabled: false }, lighting: { extraDirectional: true } };
  const high = { shadows: { enabled: true }, lighting: { extraDirectional: true } };
  assert.equal(await rendering.prepareQuality(balanced), true);
  assert.equal(compiled.length, 1, "a step that keeps program keys links nothing");
  assert.equal(await rendering.prepareQuality(high), true);
  assert.deepEqual(compiled.at(-1), [true, true, true], "the shadowed variant links ahead");
  assert.deepEqual(
    [rendering.renderer.shadowMap.enabled, sun.castShadow, fill.visible],
    [undefined, false, true],
    "and the drawn state is restored",
  );
  rendering.applyQuality({
    shadows: { enabled: true, mapSize: 1024 },
    lighting: {
      ambientIntensity: 0.2,
      directionalIntensity: 2,
      extraDirectional: true,
      fogFar: 150,
      fogNear: 60,
      hemisphereIntensity: 0.7,
    },
  });
  const low = { shadows: { enabled: false }, lighting: { extraDirectional: false } };
  assert.equal(await rendering.prepareQuality(low), true);
  assert.deepEqual(compiled.at(-1), [false, false, false]);
  assert.deepEqual(
    [rendering.renderer.shadowMap.enabled, sun.castShadow, fill.visible],
    [true, true, true],
  );
  rendering.dispose();
  assert.equal(await rendering.prepareQuality(balanced), true);
});

test("shader completion rejects an unsuccessful native link even with diagnostics disabled", async () => {
  for (const linked of [false, true]) {
    const handle = {},
      calls = [],
      program = { program: handle, isReady: () => true },
      gl = {
        LINK_STATUS: 0x8b82,
        getProgramParameter(value, parameter) {
          calls.push([value, parameter]);
          return linked;
        },
      },
      renderer = {
        debug: { checkShaderErrors: false },
        getContext: () => gl,
        compile: () => new Set([{}]),
        properties: { get: () => ({ currentProgram: program }) },
      };
    assert.equal(
      program.diagnostics,
      undefined,
      "production need not populate Three's lazy diagnostics",
    );
    assert.equal(await compilePrograms(renderer, {}, {}, null, () => true), linked);
    assert.deepEqual(
      calls,
      [[handle, gl.LINK_STATUS]],
      "only the ready captured native program is checked",
    );
  }
});

test("a ready program with failed diagnostics or a retired handle cannot pass shader preparation", async () => {
  for (const mode of ["diagnostics", "retired"]) {
    const program = {
        program: mode === "retired" ? undefined : {},
        isReady: () => true,
        ...(mode === "diagnostics" ? { diagnostics: { runnable: false } } : {}),
      },
      renderer = {
        getContext: () => ({
          LINK_STATUS: 0x8b82,
          getProgramParameter() {
            assert.fail("failed or retired programs are never queried");
          },
        }),
        compile: () => new Set([{}]),
        properties: { get: () => ({ currentProgram: program }) },
      };
    assert.equal(await compilePrograms(renderer, {}, {}, null, () => true), false);
  }
});

test("native link validation waits for parallel completion and stops before a lost generation", async () => {
  let ready = false,
    live = true,
    queries = 0;
  const program = { program: {}, isReady: () => ready },
    renderer = {
      getContext: () => ({
        LINK_STATUS: 0x8b82,
        getProgramParameter() {
          queries++;
          assert.equal(ready, true);
          assert.equal(live, true);
          return true;
        },
      }),
      compile: () => new Set([{}]),
      properties: { get: () => ({ currentProgram: program }) },
    };
  const pending = compilePrograms(renderer, {}, {}, null, () => live);
  await linkedPoll();
  assert.equal(queries, 0, "LINK_STATUS never blocks a still-compiling program");
  ready = true;
  assert.equal(await pending, true);
  assert.equal(queries, 1);
  ready = false;
  const retired = compilePrograms(renderer, {}, {}, null, () => live);
  live = false;
  ready = true;
  assert.equal(await retired, false);
  assert.equal(queries, 1, "retired generations never issue another native link query");
});

test("the serial hidden draw validates current native links and cannot query after loss or disposal", () => {
  for (const linked of [false, true]) {
    let lost = false,
      queries = 0;
    const handle = {},
      { rendering } = createRendering({
        info: { programs: [{ program: handle }] },
        getContext: () => ({
          LINK_STATUS: 0x8b82,
          isContextLost: () => lost,
          getProgramParameter(value, parameter) {
            assert.equal(value, handle);
            assert.equal(parameter, 0x8b82);
            queries++;
            return linked;
          },
        }),
      });
    assert.equal(rendering.programsLinked(), linked);
    lost = true;
    assert.equal(rendering.programsLinked(), false);
    assert.equal(queries, 1);
    lost = false;
    rendering.dispose();
    assert.equal(rendering.programsLinked(), false);
    assert.equal(queries, 1);
  }
});

test("link validation rechecks context and generation at each post-ready query", async () => {
  let live = true;
  const program = {
      program: {},
      isReady() {
        live = false;
        return true;
      },
    },
    renderer = {
      getContext: () => ({
        LINK_STATUS: 0x8b82,
        getProgramParameter() {
          assert.fail("completion retired this generation before its native link query");
        },
      }),
      compile: () => new Set([{}]),
      properties: { get: () => ({ currentProgram: program }) },
    };
  assert.equal(await compilePrograms(renderer, {}, {}, null, () => live), false);

  let lost = false,
    queries = 0;
  const { rendering } = createRendering({
    info: { programs: [{ program: {} }, { program: {} }] },
    getContext: () => ({
      LINK_STATUS: 0x8b82,
      isContextLost: () => lost,
      getProgramParameter() {
        queries++;
        lost = true;
        return true;
      },
    }),
  });
  assert.equal(rendering.programsLinked(), false);
  assert.equal(queries, 1, "loss during the first result prevents a query of the next old handle");
  rendering.dispose();
});

test("the first draw waits for compositor and caster depth programs without changing live materials", async () => {
  const compiles = [];
  const programs = new WeakMap();
  let finishDepth, finishPost;
  const { rendering } = createRendering({
    properties: { get: (material) => ({ currentProgram: programs.get(material) }) },
    compile(subject) {
      compiles.push(subject);
      let ready = !subject.isGroup;
      if (subject.isGroup) finishDepth = () => (ready = true);
      const materials = materialsOf(subject);
      for (const material of materials) programs.set(material, { isReady: () => ready });
      return materials;
    },
  });
  rendering.postprocessPipeline.compile = () => new Promise((resolve) => (finishPost = resolve));
  rendering.renderer.shadowMap.enabled = true;
  rendering.lights.sun.castShadow = true;
  const material = new MeshStandardMaterial({ alphaTest: 0.4 });
  const geometry = new BoxGeometry();
  const caster = new Mesh(geometry, material);
  caster.castShadow = true;
  rendering.homeScene.add(caster);
  let result = null;
  const ready = rendering.compileShaders().then((value) => (result = value));
  const depth = compiles.find((subject) => subject.isGroup).children[0];
  assert.equal(depth.geometry, geometry);
  assert.notEqual(depth.material, material);
  assert.equal(depth.material.depthPacking, RGBADepthPacking);
  assert.equal(depth.material.alphaTest, 0.4);
  assert.equal(caster.parent, rendering.homeScene);
  assert.equal(caster.material, material);
  finishDepth();
  await flush();
  assert.equal(result, null, "compositor still linking");
  finishPost(true);
  await ready;
  assert.equal(result, true);
  let disposed = 0;
  depth.material.addEventListener("dispose", () => disposed++);
  rendering.dispose();
  assert.equal(disposed, 1, "the retained warm-up program lease is freed once");
  material.dispose();
  geometry.dispose();
});

test("a quality step returns materials to their drawn programs and waits for its own", async () => {
  // compile() moves every material to the step's variant, which links in the
  // background; a draw with it would block until it has.
  let linking = true;
  const current = new WeakMap();
  const { rendering } = createRendering({
    properties: { get: (material) => ({ currentProgram: current.get(material) }) },
    compile(scene) {
      scene.traverse(({ material }) => {
        if (material) current.set(material, { isReady: () => !linking });
      });
      return materialsOf(scene);
    },
  });
  const geometry = new BoxGeometry();
  const lit = new MeshStandardMaterial();
  const unlit = new ShaderMaterial();
  rendering.homeScene.add(new Mesh(geometry, lit), new Mesh(geometry, unlit));
  const versions = [lit.version, unlit.version];
  const high = { shadows: { enabled: true }, lighting: { extraDirectional: true } };
  let settled = null;
  rendering.prepareQuality(high).then((ready) => (settled = ready));
  assert.ok(unlit.version > versions[1], "an unlit material leaves the linking variant");
  assert.ok(lit.version > versions[0]);
  current.set(lit, { isReady: () => true });
  current.set(unlit, { isReady: () => true });
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(settled, null, "the step waits for its own programs, not the restored ones");
  linking = false;
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(settled, true);
  rendering.dispose();

  // Without parallel compilation nothing links ahead; the cut frame links it.
  const serial = createRendering({ extensions: { has: () => false } });
  assert.equal(await serial.rendering.prepareQuality(high), false);
  assert.deepEqual(serial.calls, [["post"]]);
});

test("shader warm-up snapshots every retained side and geometry variant, once per program", async () => {
  const reads = { front: 0, back: 0, geometry: 0 };
  const ready = { front: true, back: false, geometry: false };
  const programs = Object.fromEntries(
    Object.keys(reads).map((key) => [
      key,
      {
        isReady() {
          reads[key]++;
          return ready[key];
        },
      },
    ]),
  );
  const variants = new Map(Object.entries(programs));
  let lookups = 0;
  const properties = { programs: variants, currentProgram: programs.front };
  const { rendering } = createRendering({
    compile: () => new Set([{}, {}]),
    properties: {
      get() {
        lookups++;
        return properties;
      },
    },
  });
  let settled = null;
  const pending = rendering.compileShaders(200).then((value) => (settled = value));
  assert.deepEqual(reads, { front: 1, back: 1, geometry: 0 }, "shared variants are deduplicated");
  assert.equal(lookups, 2, "capture properties once per material");
  variants.clear();
  properties.currentProgram = { isReady: () => true };
  properties.programs = new Map([["replacement", properties.currentProgram]]);
  await linkedPoll();
  assert.equal(settled, null, "a ready currentProgram cannot hide the pending back side");
  ready.back = true;
  await linkedPoll();
  assert.equal(settled, null, "the other geometry's captured program still links");
  assert.ok(reads.geometry > 0);
  assert.equal(lookups, 2, "polling never rereads mutable material properties");
  ready.geometry = true;
  assert.equal(await pending, true);
  rendering.dispose();
});

test("disposal cancels a material's pending retained variants before any freed query", async () => {
  let freed = false,
    reads = 0;
  const front = { isReady: () => true };
  const back = {
    isReady() {
      reads++;
      assert.equal(freed, false);
      return false;
    },
  };
  const variants = new Map([
    ["front", front],
    ["back", back],
  ]);
  const { rendering } = createRendering({
    compile: () => new Set([{}]),
    properties: { get: () => ({ currentProgram: front, programs: variants }) },
  });
  const pending = rendering.compileShaders(100);
  assert.equal(reads, 1);
  variants.clear();
  rendering.dispose();
  freed = true;
  assert.equal(await pending, false);
  await linkedPoll();
  assert.equal(reads, 1, "no side variant remains polling after disposal");
});

test("pending scene and depth polls retire before disposal or context replacement", async () => {
  for (const interruption of ["dispose", "physical loss", "restored before poll"]) {
    const handlers = new Map();
    let lost = false,
      freed = false,
      linking = true,
      reads = 0;
    const { rendering } = createRendering({
      domElement: {
        addEventListener: (type, listener) => handlers.set(type, listener),
        removeEventListener: (type) => handlers.delete(type),
      },
      getContext: () => ({ isContextLost: () => lost }),
      properties: {
        get: () => ({
          currentProgram: {
            isReady() {
              reads++;
              assert.equal(freed, false, "never query a freed program");
              return !linking;
            },
          },
        }),
      },
      compileAsync() {
        assert.fail("r160's uncancellable poll must not start");
      },
    });
    const geometry = new BoxGeometry();
    const material = new MeshStandardMaterial();
    const caster = new Mesh(geometry, material);
    caster.castShadow = true;
    rendering.homeScene.add(caster);
    rendering.renderer.shadowMap.enabled = rendering.lights.sun.castShadow = true;
    const pending = rendering.compileShaders(100);
    assert.equal(reads, 2, "both color and shadow programs began linking");
    if (interruption === "dispose") rendering.dispose();
    else if (interruption === "physical loss") lost = true;
    else handlers.get("webglcontextlost")({ preventDefault() {} });
    freed = true;
    const before = reads;
    assert.equal(await pending, false, interruption);
    await linkedPoll();
    assert.equal(reads, before, "the old program objects are never polled again");
    if (interruption !== "dispose") {
      lost = freed = linking = false;
      assert.equal(await rendering.compileShaders(), true, "a fresh generation can prepare");
      rendering.dispose();
    }
    geometry.dispose();
    material.dispose();
  }
});

test("shader warm-ups compile in their own task, hide waiting subjects and always settle", async () => {
  const tasks = [];
  const compiles = [];
  const settled = [];
  const mountains = { name: "mountains", visible: true };
  const tree = { name: "tree", visible: true };
  const warmup = createShaderWarmup({
    schedule: (task) => tasks.push(task),
    compile() {
      const call = { shown: [mountains.visible, tree.visible] };
      call.promise = new Promise((resolve, reject) => Object.assign(call, { resolve, reject }));
      compiles.push(call);
      return call.promise;
    },
  });

  warmup.warm(null, (ready) => settled.push(["scene", ready]));
  warmup.warm(mountains, (ready) => settled.push(["mountains", ready]));
  assert.equal(warmup.pending, 2);
  assert.equal(mountains.visible, false, "a subject with nothing visible to replace waits hidden");
  assert.equal(compiles.length, 0, "compiling waits for its own task");

  tasks.shift()();
  warmup.warm(tree, (ready) => settled.push(["tree", ready]));
  tasks.shift()();
  tasks.shift()();
  assert.deepEqual(
    compiles.map(({ shown }) => shown),
    [
      [true, true],
      [true, true],
      [true, true],
    ],
    "every waiting subject is shown for the compile, so its lights count",
  );
  assert.deepEqual(
    [mountains.visible, tree.visible],
    [false, false],
    "and hidden again before a draw",
  );

  compiles[1].resolve(true);
  compiles[0].reject(new Error("context lost"));
  await flush();
  assert.deepEqual(settled, [
    ["mountains", true],
    ["scene", false],
  ]);
  assert.equal(mountains.visible, true, "a ready subject is shown");
  assert.equal(tree.visible, false);
  assert.equal(warmup.pending, 1);
  compiles[2].resolve(false);
  await flush();
  assert.deepEqual(settled.at(-1), ["tree", false]);
  assert.equal(tree.visible, true, "an unwarmed subject still appears and links on draw");
  assert.equal(warmup.pending, 0);

  const throwing = createShaderWarmup({
    schedule: (task) => task(),
    compile() {
      throw new Error("compile failed");
    },
  });
  const subject = { visible: true };
  let result = null;
  throwing.warm(subject, (ready) => (result = ready));
  await flush();
  assert.equal(result, false);
  assert.equal(throwing.pending, 0, "a throwing compile cannot hold the reveal");
  assert.equal(subject.visible, true);
});

async function mountainWarmupHarness(outcome, { shown = true } = {}) {
  const index = await source("scene/index.js");
  // Execute the real integration callbacks with the real hill and warm-up
  // owners; no WebGL context or whole-scene fixture is needed for this race.
  const hill = index.slice(
    index.indexOf("const hillSilhouette = createHillSilhouette("),
    index.indexOf("hillSilhouette.applyQuality(state.profile);"),
  );
  const warmup = index.slice(
    index.indexOf("let openingBackgroundStarted = false;"),
    index.indexOf("const lanternMount = createLanternMount("),
  );
  assert.ok(hill && warmup);
  const tasks = [],
    compiles = [],
    invalidated = [];
  let integration, finish;
  const context = {
    WORLD: { SKY_DOME_RADIUS: 130, SUN_POSITION: [0, 0, -1] },
    assetTier: null,
    canvasShown: shown,
    openingPrepared: true,
    opening: { view: "tree" },
    environmentRoot: { visible: false },
    atmosphereSystem: { root: {} },
    createHillSilhouette: (options) =>
      createHillSilhouette({
        ...options,
        load: () =>
          outcome === "ready"
            ? Promise.resolve({
                buildMountains: () =>
                  new Promise((resolve) => {
                    finish = () => resolve(new BufferGeometry());
                  }),
              })
            : new Promise((_, reject) => {
                finish = () => reject(new Error("offline"));
              }),
      }),
    createShaderWarmup: (options) =>
      createShaderWarmup({ ...options, schedule: (task) => tasks.push(task) }),
    groundHeight: () => 0,
    invalidateContent: () => invalidated.push(integration.hillSilhouette.mesh.visible),
    liveView: null,
    measureScene() {},
    qualityDebug: {},
    rendering: {
      compileShaders(timeout, scope) {
        const compile = { shown: integration.hillSilhouette.mesh.visible, scope };
        compiles.push(compile);
        return new Promise((resolve) => {
          compile.finish = resolve;
        });
      },
      invalidateShadows() {},
    },
    runtimeDisposed: false,
    sceneNow: () => 0,
    skyConfig: { shellOpacity: 0.5 },
    state: { profile: { tier: "balanced" } },
  };
  vm.createContext(context);
  vm.runInContext(
    `${hill}\n${warmup}\nglobalThis.integration = { hillSilhouette, shaderWarmup, warmShaders };`,
    context,
  );
  integration = context.integration;
  return {
    ...integration,
    context,
    tasks,
    compiles,
    invalidated,
    finish: () => finish(),
    releaseBackground() {
      context.canvasShown = true;
      const start = index.indexOf("openingBackgroundStarted = true;");
      const end =
        index.indexOf("deferredWarmups.clear();", start) + "deferredWarmups.clear();".length;
      vm.runInContext(index.slice(start, end), context);
    },
  };
}

test("opening preparation warms the sky first and releases queued subjects only after reveal", async () => {
  const h = await mountainWarmupHarness("ready", { shown: false });
  h.context.openingPrepared = false;
  const subject = { visible: true };
  assert.equal(await h.warmShaders("tree", subject), false);
  assert.equal(await h.warmShaders("ground"), false);
  assert.equal(h.shaderWarmup.pending, 0, "unprepared ground never delays the opening sky");
  assert.equal(h.tasks.length, 0);
  const sky = h.warmShaders("scene");
  h.tasks.shift()();
  assert.equal(h.compiles[0].scope, h.context.atmosphereSystem.root);
  h.compiles[0].finish(true);
  await sky;
  h.releaseBackground();
  assert.equal(h.shaderWarmup.pending, 2);
  for (const task of h.tasks.splice(0)) task();
  assert.ok(
    h.compiles.slice(1).every((x) => x.scope === undefined),
    "later work prepares the complete physical set",
  );
  h.compiles.slice(1).forEach((x) => x.finish(true));
  await flush();
  assert.equal(h.shaderWarmup.pending, 0);
  h.hillSilhouette.dispose();
});

test("a mountain commit after initial warm-ups stays hidden until its own programs settle", async () => {
  for (const outcome of ["ready", "fallback"])
    for (const lowDuringWait of [false, true]) {
      const h = await mountainWarmupHarness(outcome);
      h.warmShaders("scene");
      h.tasks.shift()();
      h.compiles[0].finish(true);
      await flush();
      assert.equal(h.shaderWarmup.pending, 0, "all earlier preparation has already finished");
      h.hillSilhouette.setFilmTreatment(true);
      await flush();
      assert.equal(h.context.qualityDebug.mountains, "loading");
      assert.equal(h.shaderWarmup.pending, 0, "loading alone cannot start an empty warm-up");
      h.finish();
      await h.hillSilhouette.ready;
      assert.equal(h.context.qualityDebug.mountains, outcome);
      assert.equal(
        h.shaderWarmup.pending,
        1,
        "the late committed subject gets its own readiness gate",
      );
      assert.equal(h.hillSilhouette.mesh.visible, false, "no first draw with unlinked materials");
      if (lowDuringWait) {
        h.context.state.profile = { tier: "low" };
        h.hillSilhouette.applyQuality(h.context.state.profile);
      }
      h.tasks.shift()();
      assert.equal(
        h.compiles[1].shown,
        true,
        "the new subject is shown for synchronous compilation",
      );
      assert.equal(h.hillSilhouette.mesh.visible, false, "and hidden again while programs link");
      assert.equal(h.shaderWarmup.pending, 1);
      h.compiles[1].finish(true);
      await flush();
      assert.equal(h.shaderWarmup.pending, 0);
      assert.equal(
        h.hillSilhouette.mesh.visible,
        !lowDuringWait,
        "settling retains the current quality",
      );
      assert.equal(
        h.invalidated.at(-1),
        !lowDuringWait,
        "quality applies before the redraw request",
      );
      assert.equal(h.context.qualityDebug.shaders.mountains, "ready");
      h.hillSilhouette.dispose();
    }
});

test("a late mountain result after teardown cannot start another warm-up", async () => {
  for (const outcome of ["ready", "fallback"]) {
    const h = await mountainWarmupHarness(outcome);
    h.hillSilhouette.setFilmTreatment(true);
    await flush();
    h.context.runtimeDisposed = true;
    h.hillSilhouette.dispose();
    h.finish();
    await h.hillSilhouette.ready;
    assert.equal(h.shaderWarmup.pending, 0);
    assert.equal(h.tasks.length, 0);
    assert.equal(h.compiles.length, 0);
  }
});

function recordingCanvas(draws) {
  const context = {
    fillStyle: "",
    beginPath() {},
    createRadialGradient: () => ({ addColorStop() {} }),
    drawImage() {},
    restore() {},
    save() {},
  };
  for (const name of ["arc", "ellipse", "fill", "fillRect"]) {
    context[name] = () => draws.push(name);
  }
  return { width: 300, height: 150, getContext: (kind) => (kind === "2d" ? context : null) };
}

async function loadGroundTextures() {
  globalThis.window ??= { BabelSite: {} };
  await import("../src/scene/palette.js");
  await import("../src/scene/textures.js");
  return globalThis.window.BabelSite.scene.createGroundTextures;
}

function createGround(
  createGroundTextures,
  { tier = "high", groundSize = 1024, soil = false } = {},
) {
  const draws = [];
  const canvases = [];
  const statuses = [];
  const published = [];
  let invalidations = 0;
  globalThis.document = {
    createElement() {
      const canvas = recordingCanvas(draws);
      canvases.push(canvas);
      return canvas;
    },
  };
  const ground = createGroundTextures({
    THREE: { CanvasTexture, MirroredRepeatWrapping, RepeatWrapping, SRGBColorSpace },
    qualityProfile: { tier, textures: { groundSize }, anisotropy: { min: 1, max: 8 } },
    chooseAnisotropy: () => 4,
    invalidate: () => (invalidations += 1),
    onDetailStatus: (status) => statuses.push(status),
    onDetailChange: (maps) => published.push(maps),
    onSoilRoughnessChange: soil ? () => {} : undefined,
  });
  return {
    draws,
    ground,
    statuses,
    published,
    canvases,
    get invalidations() {
      return invalidations;
    },
    sizes: () => canvases.slice(0, 2).map((canvas) => canvas.width),
  };
}

const nextTask = () => new Promise((resolve) => setTimeout(resolve, 0));

test("the hidden film ground keeps its preview until a visible procedural surface is needed", async () => {
  const createGroundTextures = await loadGroundTextures();
  const film = createGround(createGroundTextures);
  assert.deepEqual(film.sizes(), [4, 4], "initialization fills only a preview");
  assert.equal(film.draws.filter((draw) => draw !== "fillRect").length, 0);
  await nextTask();
  assert.deepEqual(
    film.sizes(),
    [4, 4],
    "a hidden canvas paints no unused fallback in the next task",
  );

  const disposed = [];
  film.ground.colorMap.addEventListener("dispose", () => disposed.push("color"));
  film.ground.bumpMap.addEventListener("dispose", () => disposed.push("bump"));
  const versions = [film.ground.colorMap.version, film.ground.bumpMap.version];
  assert.equal(
    film.ground.ensureProcedural(),
    true,
    "the first visible procedural frame paints first",
  );
  assert.deepEqual(film.sizes(), [1024, 1024]);
  assert.ok(film.draws.includes("arc") && film.draws.includes("ellipse"));
  assert.deepEqual(disposed.sort(), ["bump", "color"], "grown canvases get fresh GPU storage");
  assert.ok(
    film.ground.colorMap.version > versions[0] && film.ground.bumpMap.version > versions[1],
  );
  assert.equal(film.invalidations, 1);
  assert.equal(film.ground.ensureProcedural(), false, "the complete paint is reused");
  film.ground.dispose();

  const full = createGround(createGroundTextures, { tier: "low", groundSize: 512 });
  assert.deepEqual(full.sizes(), [512, 512]);
  assert.equal(full.ground.ensureProcedural(), false);
  full.ground.dispose();
});

function recordingGroundRequests(t) {
  const originalFetch = globalThis.fetch;
  const originalBitmap = globalThis.createImageBitmap;
  const requests = [];
  globalThis.fetch = (url, { signal }) =>
    new Promise((resolve, reject) => {
      requests.push({ url, signal, resolve, reject });
    });
  globalThis.createImageBitmap = async ({ url }) => {
    const size = Number(url.match(/-(\d+)\.webp$/)[1]);
    return { width: size, height: size, close() {} };
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalBitmap === undefined) delete globalThis.createImageBitmap;
    else globalThis.createImageBitmap = originalBitmap;
  });
  return requests;
}

test("a bounded hidden ground preparation keeps a late slate result off the opening hold", async (t) => {
  const createGroundTextures = await loadGroundTextures(),
    requests = recordingGroundRequests(t),
    film = createGround(createGroundTextures);
  try {
    film.ground.setFilmActive(true);
    assert.equal(await film.ground.prepareOpening({ timeoutMs: 10 }), true);
    assert.equal(film.ground.openingState.maps, "fallback");
    const before = film.published.at(-1);
    for (const { url, resolve } of requests) resolve({ ok: true, blob: async () => ({ url }) });
    await flush();
    assert.equal(film.published.at(-1).colorMap, before.colorMap);
    film.ground.update({ revealed: true, still: false });
    assert.equal(
      film.published.at(-1).colorMap,
      before.colorMap,
      "a late decode cannot replace the first hold",
    );
    film.ground.update({ revealed: true, cut: true });
    assert.notEqual(
      film.published.at(-1).colorMap,
      before.colorMap,
      "the next unseen cut may adopt it",
    );
  } finally {
    film.ground.dispose();
  }
});

test("a ground reset retires late staged slate maps before a later cut or still", async (t) => {
  const createGroundTextures = await loadGroundTextures(),
    requests = recordingGroundRequests(t),
    film = createGround(createGroundTextures);
  try {
    film.ground.setFilmActive(true);
    await film.ground.prepareOpening({ timeoutMs: 10 });
    for (const { url, resolve } of requests) resolve({ ok: true, blob: async () => ({ url }) });
    await flush();
    assert.equal(film.statuses.at(-1).status, "ready");
    assert.equal(film.published.at(-1).colorMap, film.ground.colorMap, "late maps remain staged");

    film.ground.applyQuality({ tier: "low" }, { assetTier: "high" });
    assert.equal(film.statuses.at(-1).status, "ready", "adaptive quality retains the startup maps");
    film.ground.applyQuality({ tier: "low" });
    assert.equal(film.statuses.at(-1).status, "procedural", "an actual map reset withdraws slate");
    const count = film.published.length;
    for (const frame of [
      { revealed: true, cut: true },
      { revealed: true, still: true },
    ]) {
      film.ground.update(frame);
      assert.equal(film.published.length, count, "retired staged textures cannot publish again");
      assert.equal(film.published.at(-1).colorMap, film.ground.colorMap);
    }
  } finally {
    film.ground.dispose();
  }
});

test("a known optional soil failure settles opening preparation without waiting its deadline", async (t) => {
  const createGroundTextures = await loadGroundTextures(),
    requests = recordingGroundRequests(t),
    film = createGround(createGroundTextures, { soil: true });
  try {
    film.ground.setFilmActive(true);
    let settled = false;
    const ready = film.ground.prepareOpening().then((result) => {
      settled = true;
      return result;
    });
    await flush();
    assert.equal(requests.length, 6);
    for (const { url, resolve, reject } of requests) {
      if (url.includes("soil-roughness")) reject(new Error("optional map missing"));
      else resolve({ ok: true, blob: async () => ({ url }) });
    }
    await flush();
    assert.equal(settled, true);
    assert.equal(await ready, true);
    assert.deepEqual(film.ground.openingState, { maps: "ready", soil: "fallback" });
  } finally {
    film.ground.dispose();
  }
});

test("known slate failure settles hidden preparation immediately and disposal settles a pending run", async (t) => {
  const createGroundTextures = await loadGroundTextures(),
    requests = recordingGroundRequests(t),
    film = createGround(createGroundTextures);
  try {
    film.ground.setFilmActive(true);
    const opening = film.ground.prepareOpening();
    for (const { reject } of requests) reject(new Error("missing map"));
    assert.equal(await opening, true);
    assert.equal(film.ground.openingState.maps, "fallback");
  } finally {
    film.ground.dispose();
  }
  const pending = createGround(createGroundTextures);
  pending.ground.setFilmActive(true);
  const opening = pending.ground.prepareOpening();
  pending.ground.dispose();
  assert.equal(await opening, true);
});

test("successful slate maps avoid full procedural painting until a real film reset", async (t) => {
  const createGroundTextures = await loadGroundTextures();
  const requests = recordingGroundRequests(t);
  for (const tier of ["high", "balanced"]) {
    requests.length = 0;
    const film = createGround(createGroundTextures, { tier });
    assert.equal(requests.length, 0, "inactive film requests no maps");
    film.ground.setFilmActive(true);
    const size = tier === "high" ? 1024 : 512;
    assert.deepEqual(
      requests.map(({ url }) => url),
      [
        `/images/materials/slate-color-${size}.webp`,
        `/images/materials/slate-normal-${size}.webp`,
        "/images/materials/slate-detail-512.webp",
        `/images/materials/slate-grit-${size}.webp`,
        `/images/materials/slate-relief-${size}.webp`,
      ],
    );
    requests.forEach(({ url, resolve }) => resolve({ ok: true, blob: async () => ({ url }) }));
    await flush();
    assert.equal(film.statuses.at(-1).status, "ready");
    assert.notEqual(film.published.at(-1).colorMap, film.ground.colorMap);
    assert.equal(film.ground.ensureProcedural(), false, "first reveal already has slate");
    await nextTask();
    assert.deepEqual(film.sizes(), [4, 4], "successful slate never grows the unused canvases");
    assert.equal(film.draws.filter((draw) => draw !== "fillRect").length, 0);

    film.ground.setFilmActive(false);
    assert.deepEqual(film.sizes(), [1024, 1024], "a genuine reset prepares the procedural surface");
    assert.equal(film.published.at(-1).colorMap, film.ground.colorMap);
    assert.ok(film.draws.includes("arc") && film.draws.includes("ellipse"));
    assert.equal(film.invalidations, 1);
    film.ground.dispose();
  }
});

test("a real slate failure paints once while disposal cancels late fallback work", async (t) => {
  const createGroundTextures = await loadGroundTextures();
  const requests = recordingGroundRequests(t);
  const failed = createGround(createGroundTextures);
  failed.ground.setFilmActive(true);
  requests.forEach(({ reject }) => reject(new Error("offline")));
  await flush();
  assert.equal(failed.statuses.at(-1).status, "fallback");
  assert.deepEqual(failed.sizes(), [1024, 1024], "fallback paints before exposing its surface");
  assert.ok(failed.draws.includes("arc") && failed.draws.includes("ellipse"));
  assert.equal(failed.invalidations, 1);
  assert.equal(failed.ground.ensureProcedural(), false);
  failed.ground.dispose();

  requests.length = 0;
  const cancelled = createGround(createGroundTextures);
  cancelled.ground.setFilmActive(true);
  cancelled.ground.dispose();
  assert.ok(requests.every(({ signal }) => signal.aborted));
  requests.forEach(({ reject }) => reject(new Error("cancelled")));
  await flush();
  assert.equal(cancelled.ground.ensureProcedural(), false, "a disposed ground never paints");
  cancelled.ground.setFilmActive(false);
  assert.deepEqual(cancelled.sizes(), [4, 4]);
  assert.equal(cancelled.invalidations, 0);
  assert.equal(cancelled.draws.filter((draw) => draw !== "fillRect").length, 0);
});

test("a step between the tiers' shadow map sizes frees the drawn map for one of the new size", () => {
  const { rendering } = createRendering();
  const sun = rendering.lights.sun;
  const profile = (tier, mapSize) => ({
    tier,
    lighting: {
      fogNear: 60,
      fogFar: 150,
      ambientIntensity: 0.2,
      hemisphereIntensity: 0.6,
      directionalIntensity: 3,
      fillIntensity: 0.4,
      extraDirectional: true,
    },
    shadows: { enabled: true, mapSize },
  });
  rendering.applyQuality(profile("high", 2048));
  assert.equal(rendering.tier, "high");
  let freed = 0;
  sun.shadow.map = { width: 2048, dispose: () => freed++ };
  rendering.applyQuality(profile("high", 2048));
  assert.equal(freed, 0, "the same size keeps its map");
  rendering.applyQuality(profile("balanced", 1024));
  assert.equal(freed, 1);
  assert.equal(sun.shadow.map, null, "the next shadow draw allocates it at 1024");
  assert.equal(sun.shadow.mapSize.width, 1024);
  assert.equal(sun.shadow.needsUpdate, true);
  assert.equal(rendering.tier, "balanced");
});

test("an unfinished hidden camera cannot claim subjects or start opening coverage", async () => {
  const entry = await source("scene/index.js");
  const begin = entry.indexOf(
      "        if (\n          !canvasShown &&\n          cinematicApplied",
    ),
    end = entry.indexOf("          const lanternSettled", begin);
  assert.ok(begin > 0 && end > begin);
  const calls = [],
    context = vm.createContext({
      canvasShown: false,
      cinematicApplied: false,
      cinematic: { current: "tree", frame: null },
      opening: { view: "tree" },
      sceneFailed: false,
      settleOpening: (stage) => calls.push(stage),
    });
  const body = new vm.Script(entry.slice(begin, end) + "}");
  body.runInContext(context);
  context.cinematic.frame = {};
  body.runInContext(context);
  assert.deepEqual(calls, [], "a previous fit cannot make pending work ready");
  context.cinematicApplied = true;
  context.cinematic.frame = null;
  body.runInContext(context);
  assert.deepEqual(calls, []);
  context.cinematic.frame = {};
  body.runInContext(context);
  assert.deepEqual(calls, ["subjects"]);
});

test("the real frame draw waits for complete opening preparation, and lost or disposed renderers stay safe", async () => {
  const entry = await source("scene/index.js"),
    renderingSource = await source("scene/rendering.js"),
    begin = entry.indexOf("// Partial preparation can still carry linking terrain programs."),
    end = entry.indexOf("visitorHold?.frameRendered();", begin);
  assert.ok(begin > 0 && end > begin);
  const update = renderingSource.match(
    /update\(\{ render = true \} = \{\}\) \{([\s\S]*?)\n    \},/,
  );
  assert.ok(update, "exercise rendering's actual lost-context guard too");
  const calls = [],
    openingGate = createOpeningPreparation({
      stages: ["terrain", "foreground", "shaders", "presentation"],
    }),
    context = vm.createContext({
      canvasShown: false,
      openingGate,
      openingPresentation: { sample: () => false },
      timestamp: 0,
      sceneNow: () => 0,
      shaderWarmup: { pending: 0 },
      cinematic: { ready: true },
      groundTextures: { ensureProcedural: () => calls.push("texture") },
      firstFrameDrawn: false,
      frameStart: 0,
      measureScene: () => calls.push("first-frame"),
      disposed: false,
      lost: false,
      renderer: null,
      composer: { render: () => calls.push("draw") },
    });
  context.renderer = { getContext: () => ({ isContextLost: () => context.lost }) };
  context.rendering = {
    update: vm.runInContext(`(function({render=true}={}){${update[1]}})`, context),
  };
  const frame = new vm.Script("{" + entry.slice(begin, end) + "}");
  frame.runInContext(context);
  assert.deepEqual(calls, [], "partial preparation must never enter a driver draw");
  assert.equal(context.firstFrameDrawn, false, "waiting cannot claim a drawn frame");
  for (const stage of ["terrain", "foreground", "shaders"]) openingGate.settle(stage);
  context.shaderWarmup.pending = 1;
  frame.runInContext(context);
  assert.deepEqual(calls, [], "complete assets still wait for pending warm-ups");
  context.shaderWarmup.pending = 0;
  frame.runInContext(context);
  assert.deepEqual(calls, ["texture", "draw", "first-frame"]);
  calls.length = 0;
  context.lost = true;
  frame.runInContext(context);
  assert.deepEqual(calls, ["texture"], "physical context loss prevents Three's uniform lookup");
  calls.length = 0;
  context.lost = false;
  openingGate.reopen("foreground", "shaders");
  frame.runInContext(context);
  assert.deepEqual(calls, [], "a refit cannot draw its incomplete generation");
  openingGate.dispose();
  frame.runInContext(context);
  assert.deepEqual(calls, [], "cancelled preparation cannot draw late content");
  context.canvasShown = true;
  context.shaderWarmup.pending = 1;
  frame.runInContext(context);
  assert.deepEqual(calls, ["draw"], "revealed frames retain their existing draw path");
  calls.length = 0;
  context.disposed = true;
  frame.runInContext(context);
  assert.deepEqual(calls, [], "a retired renderer ignores a stale queued frame");
});
