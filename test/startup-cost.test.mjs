import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import {
  BoxGeometry,
  CanvasTexture,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  MirroredRepeatWrapping,
  RepeatWrapping,
  ShaderMaterial,
  SRGBColorSpace,
  Texture,
  WebGLRenderTarget,
} from "three";
import { markSceneEvaluated, measureScene, sceneNow } from "../src/scene/perf-marks.js";
import { createSceneRendering } from "../src/scene/rendering.js";
import { createShaderWarmup } from "../src/scene/runtime.js";

const flush = () => new Promise((resolve) => setImmediate(resolve));
const source = (path) => readFile(new URL(`../src/${path}`, import.meta.url), "utf8");

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

function createRendering(rendererOverrides = {}) {
  const calls = [];
  let target = "screen";
  let rendererOptions = null;
  const renderer = {
    capabilities: { getMaxAnisotropy: () => 8 },
    domElement: {},
    extensions: { has: (name) => name === "KHR_parallel_shader_compile" },
    shadowMap: {},
    getContext: () => ({ isContextLost: () => false }),
    getRenderTarget: () => target,
    setClearColor() {},
    setRenderTarget(next) {
      target = next;
      calls.push(["target", next]);
    },
    compileAsync(scene, camera) {
      calls.push(["compile", target, scene, camera]);
      return Promise.resolve(scene);
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
  });
  return { calls, rendering, rendererOptions, getTarget: () => target };
}

test("shader warm-up compiles against the composer's scene target and always settles", async () => {
  const ready = createRendering();
  assert.equal(ready.rendererOptions.powerPreference, "default");
  assert.equal(await ready.rendering.compileShaders(), true);
  assert.deepEqual(ready.calls[0], ["post"], "the crossfade's programs link in the same task");
  const compile = ready.calls.find(([kind]) => kind === "compile");
  assert.equal(compile[1], "scene-target", "program keys follow the scene pass's target");
  assert.equal(compile[2], ready.rendering.homeScene);
  assert.equal(compile[3], ready.rendering.camera);
  assert.equal(ready.getTarget(), "screen", "the previous target is restored");

  const rejected = createRendering({ compileAsync: () => Promise.reject(new Error("lost")) });
  assert.equal(await rejected.rendering.compileShaders(), false);

  const throwing = createRendering({
    compileAsync() {
      throw new Error("compile failed");
    },
  });
  assert.equal(await throwing.rendering.compileShaders(), false);
  assert.equal(throwing.getTarget(), "screen");

  const stalled = createRendering({ compileAsync: () => new Promise(() => {}) });
  assert.equal(await stalled.rendering.compileShaders(5), false, "a stalled poll times out");

  const unsupported = createRendering({ compileAsync: undefined });
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

test("shader warm-up uploads visible maps; a quality step links its shadow variant", async () => {
  const uploaded = [];
  const compiled = [];
  let rendering = null;
  const setup = createRendering({
    initTexture: (texture) => uploaded.push(texture.name),
    compileAsync(scene) {
      const { fill, sun } = rendering.lights;
      compiled.push([rendering.renderer.shadowMap.enabled, sun.castShadow, fill.visible]);
      return Promise.resolve(scene);
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

test("a quality step returns materials to their drawn programs and waits for its own", async () => {
  // compile() moves every material to the step's variant, which links in the
  // background; a draw with it would block until it has.
  let linking = true;
  const current = new WeakMap();
  const { rendering } = createRendering({
    properties: { get: (material) => ({ currentProgram: current.get(material) }) },
    compileAsync(scene) {
      scene.traverse(({ material }) => {
        if (material) current.set(material, { isReady: () => !linking });
      });
      return Promise.resolve(scene);
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

test("shader warm-ups compile in their own task, hide waiting subjects and always settle", async () => {
  const tasks = [];
  const compiles = [];
  const settled = [];
  const tower = { name: "tower", visible: true };
  const tree = { name: "tree", visible: true };
  const warmup = createShaderWarmup({
    schedule: (task) => tasks.push(task),
    compile() {
      const call = { shown: [tower.visible, tree.visible] };
      call.promise = new Promise((resolve, reject) => Object.assign(call, { resolve, reject }));
      compiles.push(call);
      return call.promise;
    },
  });

  warmup.warm(null, (ready) => settled.push(["scene", ready]));
  warmup.warm(tower, (ready) => settled.push(["tower", ready]));
  assert.equal(warmup.pending, 2);
  assert.equal(tower.visible, false, "a subject with nothing visible to replace waits hidden");
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
  assert.deepEqual([tower.visible, tree.visible], [false, false], "and hidden again before a draw");

  compiles[1].resolve(true);
  compiles[0].reject(new Error("context lost"));
  await flush();
  assert.deepEqual(settled, [
    ["tower", true],
    ["scene", false],
  ]);
  assert.equal(tower.visible, true, "a ready subject is shown");
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

function createGround(createGroundTextures, { tier = "high", groundSize = 1024 } = {}) {
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

test("the film ground starts from a flat preview and paints in full in the next task", async (t) => {
  const createGroundTextures = await loadGroundTextures();
  const originalFetch = globalThis.fetch;
  const requested = [];
  globalThis.fetch = (url) => {
    requested.push(url);
    return Promise.reject(new Error("offline"));
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const film = createGround(createGroundTextures);
  assert.deepEqual(film.sizes(), [4, 4], "initialization fills only a preview");
  assert.equal(film.draws.filter((draw) => draw !== "fillRect").length, 0);
  const disposed = [];
  film.ground.colorMap.addEventListener("dispose", () => disposed.push("color"));
  film.ground.bumpMap.addEventListener("dispose", () => disposed.push("bump"));
  const versions = [film.ground.colorMap.version, film.ground.bumpMap.version];

  await nextTask();
  assert.deepEqual(
    film.sizes(),
    [1024, 1024],
    "the reveal, a film reset and a fallback all find the painted ground",
  );
  assert.ok(film.draws.includes("arc") && film.draws.includes("ellipse"));
  assert.deepEqual(disposed.sort(), ["bump", "color"], "grown canvases get fresh GPU storage");
  assert.ok(
    film.ground.colorMap.version > versions[0] && film.ground.bumpMap.version > versions[1],
  );
  assert.equal(film.invalidations, 1);

  assert.deepEqual(requested, [], "no ground map downloads before the film activates");
  film.ground.setFilmActive(true);
  await flush();
  await flush();
  assert.deepEqual(
    requested,
    [
      "/images/materials/slate-color-1024.webp",
      "/images/materials/slate-normal-1024.webp",
      "/images/materials/slate-detail-512.webp",
    ],
    "the film slate requests only its own three maps",
  );
  assert.ok(
    film.statuses.some(
      (status) => status.status === "fallback" && status.material === "Cracked Desert Ground",
    ),
  );
  assert.equal(film.invalidations, 1, "a slate fallback finds the ground already painted");
  assert.equal(film.ground.ensureProcedural(), false, "the full paint happens once");

  // A fallback before that task paints at once, and the task then has nothing to do.
  const early = createGround(createGroundTextures);
  assert.equal(early.ground.ensureProcedural(), true);
  assert.deepEqual(early.sizes(), [1024, 1024]);
  const earlyDraws = early.draws.length;
  await nextTask();
  assert.equal(early.draws.length, earlyDraws);
  assert.equal(early.invalidations, 1);

  const disposedEarly = createGround(createGroundTextures);
  disposedEarly.ground.dispose();
  await nextTask();
  assert.deepEqual(disposedEarly.sizes(), [4, 4], "disposal cancels the pending paint");
  assert.equal(disposedEarly.invalidations, 0);

  // Balanced takes the same preview and its 512 slate pair.
  requested.length = 0;
  const balanced = createGround(createGroundTextures, { tier: "balanced", groundSize: 768 });
  assert.deepEqual(balanced.sizes(), [4, 4]);
  balanced.ground.applyQuality({ tier: "balanced" }, { assetTier: "balanced" });
  balanced.ground.setFilmActive(true);
  await flush();
  await flush();
  assert.deepEqual(requested, [
    "/images/materials/slate-color-512.webp",
    "/images/materials/slate-normal-512.webp",
    "/images/materials/slate-detail-512.webp",
  ]);
  balanced.ground.dispose();
  await nextTask();

  // A profile outside high and balanced paints in full at once.
  const full = createGround(createGroundTextures, { tier: "low", groundSize: 512 });
  assert.deepEqual(full.sizes(), [512, 512]);
  assert.equal(full.ground.ensureProcedural(), false);
  // Only the film slate's maps remain: no stone, ground, earth or grass loaders.
  const textures = await source("scene/textures.js");
  assert.doesNotMatch(textures, /grass|earth-|materials\/ground|stone-|marble|mud/i);
});
