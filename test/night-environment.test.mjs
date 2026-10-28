// The film's night sky as the scene's environment (night-environment.js).

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { BackSide, HalfFloatType, PlaneGeometry, ShaderMaterial, Texture, Vector3 } from "three";
import { createEstateSkyMaterial } from "../src/scene/estate-sky.js";
import { createNightEnvironment, NIGHT_SKY } from "../src/scene/night-environment.js";
import { createSceneRendering } from "../src/scene/rendering.js";
import { FILM_UNTONE_GLSL } from "../src/scene/film-light.js";
import { compactShaderSource } from "../tools/shader-compact.mjs";

const skyMaterial = () =>
  createEstateSkyMaterial({
    skyTopColor: 0x181d2d,
    skyBottomColor: 0x4f4d55,
    skyGlowColor: 0xc0895d,
    sunDirection: new Vector3(32, 28, 14).normalize(),
    sunColor: 0xdfb882,
    shellOpacity: 0.52,
  });

// A renderer that links programs in parallel and records what it compiles.
function parallelRenderer() {
  const calls = [];
  let target = null;
  return {
    calls,
    extensions: { has: (name) => name === "KHR_parallel_shader_compile" },
    getRenderTarget: () => target,
    setRenderTarget(next) {
      target = next;
      calls.push(["target", next]);
    },
    compileAsync(scene, camera) {
      calls.push(["compile", target, scene, camera]);
      return Promise.resolve(scene);
    },
  };
}

test("the first environment capture waits for both sky and filter programs and caches its exact result", async () => {
  const renderer = parallelRenderer();
  const links = [];
  renderer.compileAsync = (scene) => new Promise((resolve) => links.push({ scene, resolve }));
  const tasks = [];
  const geometry = new PlaneGeometry(2, 2);
  const blur = new ShaderMaterial();
  const texture = new Texture();
  let draws = 0,
    disposed = 0;
  const environment = createNightEnvironment(renderer, {
    schedule: (task) => tasks.push(task),
    createGenerator: () => ({
      _setSize() {},
      _allocateTargets: () => ({ dispose() {} }),
      _lodPlanes: [geometry],
      _blurMaterial: blur,
      fromScene() {
        draws++;
        return { texture, dispose: () => disposed++ };
      },
      dispose() {},
    }),
  });
  const sky = skyMaterial();
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  environment.setSky(sky);
  assert.equal(environment.capture(), null, "a film activation cannot race the pending capture");
  assert.equal(draws, 0);
  assert.equal(links.length, 1);
  links[0].resolve();
  await flush();
  tasks.shift()();
  await flush();
  assert.equal(links.length, 2);
  assert.equal(draws, 0, "neither a pending sky nor filter program is first used by a draw");
  links[1].resolve();
  await flush();
  tasks.shift()();
  assert.equal(await environment.ready, texture);
  assert.equal(environment.status, "ready");
  assert.equal(draws, 1);
  assert.equal(environment.capture(), texture, "the model commit reuses the prepared capture");
  assert.equal(draws, 1);
  environment.dispose();
  assert.equal(disposed, 1);
  geometry.dispose();
  blur.dispose();
  sky.dispose();
  texture.dispose();
});

test("disposing during environment preparation never starts a late capture", async () => {
  const renderer = parallelRenderer();
  let settle;
  renderer.compileAsync = () => new Promise((resolve) => (settle = resolve));
  let generators = 0;
  const environment = createNightEnvironment(renderer, {
    createGenerator: () => {
      generators++;
      throw new Error("must not capture");
    },
  });
  const sky = skyMaterial();
  environment.setSky(sky);
  environment.dispose();
  assert.equal(await environment.ready, null);
  assert.equal(generators, 0);
  assert.equal(environment.capture(), null, "a disposed environment cannot force a capture");
  settle();
  sky.dispose();
});

test("disposing during the filter link settles readiness but waits for an adapter's raw poll before freeing it", async () => {
  const renderer = parallelRenderer();
  const links = [];
  renderer.compileAsync = (scene) => new Promise((resolve) => links.push({ scene, resolve }));
  const tasks = [];
  const geometry = new PlaneGeometry(2, 2);
  const blur = new ShaderMaterial();
  let draws = 0,
    disposals = 0;
  const environment = createNightEnvironment(renderer, {
    schedule: (task) => tasks.push(task),
    createGenerator: () => ({
      _setSize() {},
      _allocateTargets: () => ({ dispose() {} }),
      _lodPlanes: [geometry],
      _blurMaterial: blur,
      fromScene() {
        draws++;
        throw new Error("must not draw after disposal");
      },
      dispose() {
        disposals++;
      },
    }),
  });
  const sky = skyMaterial();
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  environment.setSky(sky);
  links[0].resolve();
  await flush();
  tasks.shift()();
  await flush();
  assert.equal(links.length, 2);
  environment.dispose();
  assert.equal(await environment.ready, null);
  assert.equal(disposals, 0, "the compileAsync-only adapter may still read its materials");
  assert.equal(draws, 0);
  links[1].resolve();
  await flush();
  assert.equal(disposals, 1);
  geometry.dispose();
  blur.dispose();
  sky.dispose();
});

test("a never-settling sky link times out and leaves the normal capture available", async () => {
  const renderer = parallelRenderer();
  renderer.compileAsync = () => new Promise(() => {});
  const texture = new Texture();
  let captures = 0;
  const environment = createNightEnvironment(renderer, {
    prepareTimeoutMs: 5,
    createGenerator: () => ({
      fromScene() {
        captures++;
        return { texture, dispose() {} };
      },
      dispose() {},
    }),
  });
  const sky = skyMaterial();
  environment.setSky(sky);
  assert.equal(await environment.ready, null);
  assert.equal(captures, 0, "timeout alone never forces a blocking draw");
  assert.equal(environment.capture(), texture, "the film may use the established capture path");
  assert.equal(captures, 1);
  environment.dispose();
  sky.dispose();
  texture.dispose();
});

test("a lost context settles a pending environment without a late draw", async () => {
  const renderer = parallelRenderer();
  let lost = false;
  renderer.getContext = () => ({ isContextLost: () => lost });
  renderer.compileAsync = () => new Promise(() => {});
  let draws = 0;
  const environment = createNightEnvironment(renderer, {
    createGenerator: () => {
      draws++;
      throw new Error("must not enter a lost context");
    },
  });
  const sky = skyMaterial();
  environment.setSky(sky);
  lost = true;
  assert.equal(await environment.ready, null);
  assert.equal(environment.capture(), null);
  assert.equal(draws, 0);
  environment.dispose();
  sky.dispose();
});

test("context restoration can capture after preparation lost its context before making a target", async () => {
  const renderer = parallelRenderer();
  let lost = false;
  renderer.getContext = () => ({ isContextLost: () => lost });
  renderer.compileAsync = () => new Promise(() => {});
  const texture = new Texture();
  let draws = 0;
  const environment = createNightEnvironment(renderer, {
    createGenerator: () => ({
      fromScene() {
        draws++;
        return { texture, dispose() {} };
      },
      dispose() {},
    }),
  });
  const sky = skyMaterial();
  environment.setSky(sky);
  lost = true;
  assert.equal(await environment.ready, null);
  lost = false;
  assert.equal(environment.restore(), texture);
  assert.equal(await environment.ready, texture, "restored readiness reports the current target");
  assert.equal(draws, 1);
  environment.dispose();
  sky.dispose();
  texture.dispose();
});

test("a never-settling filter link also times out without freeing an adapter's polled materials", async () => {
  const renderer = parallelRenderer();
  const links = [];
  renderer.compileAsync = () => new Promise((resolve) => links.push(resolve));
  const geometry = new PlaneGeometry(2, 2);
  const blur = new ShaderMaterial();
  let draws = 0,
    disposals = 0;
  const environment = createNightEnvironment(renderer, {
    prepareTimeoutMs: 5,
    createGenerator: () => ({
      _setSize() {},
      _allocateTargets: () => ({ dispose() {} }),
      _lodPlanes: [geometry],
      _blurMaterial: blur,
      fromScene() {
        draws++;
        throw new Error("timeout must not force a draw");
      },
      dispose() {
        disposals++;
      },
    }),
  });
  const sky = skyMaterial();
  environment.setSky(sky);
  links[0]();
  assert.equal(await environment.ready, null);
  assert.equal(links.length, 2);
  assert.equal(draws, 0);
  environment.dispose();
  assert.equal(disposals, 0);
  links[1]();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(disposals, 1);
  geometry.dispose();
  blur.dispose();
  sky.dispose();
});

test("the real renderer's bounded poll snapshots programs instead of polling mutable material properties", async () => {
  const renderer = parallelRenderer();
  const properties = new Map();
  renderer.properties = { get: (material) => properties.get(material) };
  renderer.compileAsync = () => {
    throw new Error("the real renderer must not start r160's unbounded material poll");
  };
  let calls = 0,
    skyReady = false;
  renderer.compile = (scene) => {
    const materials = new Set();
    scene.traverse((object) => {
      if (!object.material) return;
      materials.add(object.material);
      const sky = calls === 0;
      properties.set(object.material, { currentProgram: { isReady: () => !sky || skyReady } });
    });
    calls++;
    return materials;
  };
  const geometry = new PlaneGeometry(2, 2);
  const blur = new ShaderMaterial();
  const texture = new Texture();
  const environment = createNightEnvironment(renderer, {
    createGenerator: () => ({
      _setSize() {},
      _allocateTargets: () => ({ dispose() {} }),
      _lodPlanes: [geometry],
      _blurMaterial: blur,
      fromScene: () => ({ texture, dispose() {} }),
      dispose() {},
    }),
  });
  const sky = skyMaterial();
  environment.setSky(sky);
  assert.equal(calls, 1);
  for (const material of properties.keys())
    properties.set(material, { currentProgram: { isReady: () => false } });
  skyReady = true;
  assert.equal(await environment.ready, texture);
  assert.equal(calls, 2, "sky and filter groups both use the owned readiness poll");
  environment.dispose();
  geometry.dispose();
  blur.dispose();
  sky.dispose();
  texture.dispose();
});

test("the environment is the film sky shell's own shader, with the moon's glow, the ranges and the ground", () => {
  const renderer = parallelRenderer(),
    environment = createNightEnvironment(renderer, { keyDirection: [32, 28, 14] }),
    sky = skyMaterial();
  const liveCloud = new Texture();
  let cloudDisposals = 0;
  liveCloud.addEventListener("dispose", () => cloudDisposals++);
  sky.uniforms.uCloudMap.value = liveCloud;
  sky.uniforms.uCloudMix.value = 1;
  assert.equal(environment.status, "none");
  assert.equal(environment.capture(), null, "no sky, no capture");
  // The sky arrives at start-up: its capture program links in the background.
  environment.setSky(sky, 0.52);
  const compile = renderer.calls.find(([kind]) => kind === "compile");
  assert.ok(compile, "the capture's program links where programs compile in parallel");
  const [, target, scene, camera] = compile;
  // Against a linear half-float target, as the PMREM cube draws it, then restored.
  assert.equal(target.texture.type, HalfFloatType);
  assert.equal(renderer.getRenderTarget(), null);
  assert.equal(camera.fov, 90);
  const material = scene.children[0].material;
  assert.notEqual(material, sky, "a clone: the live shell is never touched");
  assert.equal(material.side, BackSide);
  assert.equal(material.transparent, false);
  // The film sky with its clouds and nebula at the high sky's octaves, still.
  assert.equal(material.uniforms.uFilm.value, 1);
  assert.equal(material.uniforms.uClouds.value, 1);
  assert.equal(material.uniforms.uNebulaLayers.value, NIGHT_SKY.layers);
  assert.equal(material.uniforms.uTime.value, 0);
  // It mirrors the cel plate on the shell: the same uniforms, so a cut's plate change
  // reaches it on refresh().
  assert.equal(material.uniforms.uCloudMap, sky.uniforms.uCloudMap);
  assert.equal(material.uniforms.uCloudMix, sky.uniforms.uCloudMix);
  assert.equal(sky.uniforms.uCloudMap.value, liveCloud);
  assert.equal(sky.uniforms.uCloudMix.value, 1);
  assert.equal(sky.uniforms.uFilm.value, 0);
  // The cube's faces have no name behind them: the clouds' text guard reads an empty
  // box of the capture's own, never the live one the clone would share.
  sky.uniforms.slateText.value.x = 0;
  assert.notEqual(material.uniforms.slateText, sky.uniforms.slateText);
  assert.deepEqual(material.uniforms.slateText.value, { x: 2, y: 2, z: -1, w: -1 });
  // It lights the scene with the sky as it stands, reshaping included, never turning
  // the live shell's weight.
  assert.equal(material.uniforms.uCloudReshape.value, 1);
  assert.notEqual(material.uniforms.uCloudReshape, sky.uniforms.uCloudReshape);
  assert.equal(sky.uniforms.uCloudReshape.value, 1);
  // The additions sit after the film sky, before the shell's opacity, which they divide out.
  const fragment = material.fragmentShader;
  assert.ok(
    fragment.includes(
      `uniform float envCapture;\nuniform vec3 envKeyDirection;\n${FILM_UNTONE_GLSL}\nvoid main()`,
    ),
  );
  assert.ok(fragment.indexOf("if(envCapture>.5){") < fragment.indexOf("gl_FragColor=uFilm>.5?"));
  assert.ok(fragment.indexOf("col+=filmBand(altitude);") < fragment.indexOf("if(envCapture>.5){"));
  assert.match(fragment, /\/0\.52;/);
  // Last, the sky as shown goes back through the tone curve to the scene light
  // that shows as it (film-light.js filmUntone()): the lit layers' materials take
  // it in scene light, so a mirror in it shows the sky as the frame does.
  assert.match(fragment, /col=filmUntone\(col\*0\.52\)\/0\.52;\s*\}\s*gl_FragColor=uFilm>\.5\?/);
  const key = material.uniforms.envKeyDirection.value;
  assert.ok(key.distanceTo(new Vector3(32, 28, 14).normalize()) < 1e-9);
  // Below the horizon the dark ground, never the shell's pale horizon colour.
  assert.ok(NIGHT_SKY.ground.every((value) => value < 0.06));
  assert.ok(NIGHT_SKY.ranges.tone.every((value) => value < 0.12));
  sky.dispose();
  environment.dispose();
  assert.equal(cloudDisposals, 0, "the capture never frees the live artwork");
  liveCloud.dispose();
});

test("the published, compacted sky shader keeps the environment's anchor", async () => {
  const source = compactShaderSource(
    await readFile(new URL("../src/scene/estate-sky.js", import.meta.url), "utf8"),
  );
  assert.equal(source.split("gl_FragColor=uFilm>.5?").length - 1, 1);
  assert.match(source, /col\+=filmBand\(altitude\);\s*\}\s*gl_FragColor=uFilm>\.5\?/);
});

test("a capture that cannot draw fails once, quietly, and never retries", () => {
  let attempts = 0;
  const renderer = {
    extensions: { has: () => false },
    getRenderTarget: () => null,
    setRenderTarget() {},
    // A capture starts with a PMREMGenerator, which links its blur program at
    // once: this renderer cannot.
    compile() {
      attempts++;
      throw new Error("no context");
    },
  };
  const environment = createNightEnvironment(renderer, { keyDirection: [0, 1, 0] });
  const sky = skyMaterial();
  environment.setSky(sky);
  assert.equal(environment.capture(), null);
  assert.equal(attempts, 1);
  assert.equal(environment.status, "failed");
  assert.equal(environment.texture, null);
  assert.equal(environment.capture(), null);
  assert.equal(attempts, 1, "no second attempt");
  assert.equal(environment.restore(), null, "nothing to restore");
  environment.dispose();
  sky.dispose();
});

// Three polls a program linking in the background until it is ready, and that
// poll throws once its material is freed: the capture's sky waits for the link.
test("the capture's sky is freed only once its background link settles", async () => {
  let settle = null,
    linked = null;
  const renderer = {
    extensions: { has: (name) => name === "KHR_parallel_shader_compile" },
    getRenderTarget: () => null,
    setRenderTarget() {},
    compileAsync(scene) {
      linked = scene;
      return new Promise((resolve) => (settle = resolve));
    },
  };
  const later = () => new Promise((resolve) => setImmediate(resolve));
  const sky = skyMaterial();
  // Torn down mid-link: freed when the link settles.
  const early = createNightEnvironment(renderer, { keyDirection: [0, 1, 0] });
  early.setSky(sky, 0.52);
  let freed = 0;
  linked.children[0].material.addEventListener("dispose", () => freed++);
  early.dispose();
  await later();
  assert.equal(freed, 0, "still linking");
  settle(linked);
  await later();
  assert.equal(freed, 1, "freed once linked");
  // Torn down after the link: freed at once.
  const settled = createNightEnvironment(renderer, { keyDirection: [0, 1, 0] });
  settled.setSky(sky, 0.52);
  freed = 0;
  linked.children[0].material.addEventListener("dispose", () => freed++);
  settle(linked);
  await later();
  settled.dispose();
  assert.equal(freed, 1);
  sky.dispose();
});

// A rendering over a renderer stub; `listeners` holds its canvas's handlers.
function filmRendering() {
  const listeners = {};
  const renderer = {
    capabilities: { getMaxAnisotropy: () => 8 },
    domElement: {
      addEventListener: (type, handler) => (listeners[type] = handler),
      removeEventListener() {},
    },
    extensions: { has: () => false },
    shadowMap: {},
    getContext: () => ({ isContextLost: () => false }),
    getRenderTarget: () => null,
    setClearColor() {},
    setRenderTarget() {},
  };
  const rendering = createSceneRendering({
    container: { appendChild() {} },
    createPipeline: () => ({
      composer: { readBuffer: null, addPass() {}, render() {} },
      setFilmTreatment() {},
      setQualityProfile() {},
    }),
    createRenderer: () => renderer,
    disposeResources: () => ({}),
    height: 600,
    lighting: {
      ambientColor: 0xffffff,
      ambientIntensity: 0.2,
      directionalColor: 0xffffff,
      directionalIntensity: 2,
      directionalPosition: { x: 32, y: 28, z: 14 },
      fogColor: 0,
      fogFar: 150,
      fogNear: 60,
      hemisphereGroundColor: 0,
      hemisphereIntensity: 0.7,
      hemisphereSkyColor: 0,
    },
    profile: {},
    width: 800,
    world: {
      CAMERA_FAR: 210,
      CAMERA_FOV: 48,
      CAMERA_NEAR: 0.5,
      FILL_LIGHT_POSITION: [-30, 22, -28],
      SHADOW_CAMERA_FAR: 120,
      SHADOW_CAMERA_HALF_EXTENT: 34,
      SHADOW_CAMERA_NEAR: 0.5,
    },
  });
  return { rendering, listeners };
}

test("the film sets the night sky as the scene's environment and clears it without the film", () => {
  const { rendering } = filmRendering();
  const sky = { isTexture: true };
  let captures = 0;
  rendering.environment.capture = () => {
    captures++;
    return sky;
  };
  assert.equal(rendering.homeScene.environment, null);
  rendering.setFilmTreatment(true);
  assert.equal(rendering.homeScene.environment, sky);
  rendering.setFilmTreatment(false);
  assert.equal(rendering.homeScene.environment, null);
  assert.equal(captures, 1);
  rendering.setFilmTreatment(true);
  rendering.dispose();
  assert.equal(rendering.homeScene.environment, null, "disposed before the scene's resources");
});

test("a restored context draws the sky again, with or without the film", () => {
  const { rendering, listeners } = filmRendering();
  let drawn = { isTexture: true },
    restores = 0;
  rendering.environment.capture = () => drawn;
  rendering.environment.restore = () => {
    restores++;
    return (drawn = { isTexture: true, restored: restores });
  };
  // Lost and restored with the film off: the sky is drawn again all the same,
  // and the film's next start takes the fresh drawing, never the lost one.
  listeners.webglcontextrestored();
  assert.equal(restores, 1);
  assert.equal(rendering.homeScene.environment, null, "no environment without the film");
  rendering.setFilmTreatment(true);
  assert.equal(rendering.homeScene.environment.restored, 1);
  // Restored during the film: the scene takes the fresh drawing at once.
  listeners.webglcontextrestored();
  assert.equal(rendering.homeScene.environment.restored, 2);
  rendering.dispose();
});

test("context loss retires the old environment before a fresh GPU generation can dispose it", () => {
  let lost = false;
  const events = [],
    meshes = [];
  const renderer = { getContext: () => ({ isContextLost: () => lost }) };
  const environment = createNightEnvironment(renderer, {
    createGenerator: () => ({
      fromScene(scene) {
        assert.equal(lost, false);
        const mesh = scene.children[0];
        meshes.push(mesh);
        for (const [kind, resource] of [
          ["material", mesh.material],
          ["geometry", mesh.geometry],
        ])
          resource.addEventListener("dispose", () => events.push([kind, lost]));
        return { texture: new Texture(), dispose: () => events.push(["target", lost]) };
      },
      dispose() {},
    }),
  });
  const sky = skyMaterial();
  let borrowedDisposals = 0;
  sky.addEventListener("dispose", () => borrowedDisposals++);
  environment.setSky(sky);
  const original = environment.capture();
  lost = true;
  environment.contextLost();
  environment.contextLost();
  assert.equal(environment.texture, null);
  assert.equal(environment.capture(), null, "lost graphics cannot draw a replacement");
  assert.deepEqual(events, [
    ["target", true],
    ["material", true],
    ["geometry", true],
  ]);
  lost = false;
  const restored = environment.restore();
  assert.notEqual(restored, original);
  assert.notEqual(meshes[0].geometry, meshes[1].geometry);
  assert.equal(events.length, 3, "restoring cannot dispose old-context objects");
  assert.equal(borrowedDisposals, 0);
  environment.dispose();
  assert.equal(borrowedDisposals, 0, "the supplied sky remains borrowed");
  sky.dispose();
});

test("the loss handler retires owned targets and withdraws stale environment bindings", () => {
  const { rendering, listeners } = filmRendering();
  const events = [];
  rendering.environment.capture = () => ({ isTexture: true });
  rendering.environment.contextLost = () => events.push("environment");
  rendering.postprocessPipeline.invalidatePrograms = (options) => {
    assert.equal(options.contextLost, true);
    events.push("compositor");
  };
  rendering.lights.sun.shadow.map = { dispose: () => events.push("shadow") };
  rendering.lights.sun.shadow.mapPass = { dispose: () => events.push("shadow-filter") };
  rendering.setFilmTreatment(true);
  listeners.webglcontextlost({ preventDefault: () => events.push("prevent-default") });
  assert.deepEqual(events, [
    "prevent-default",
    "compositor",
    "environment",
    "shadow",
    "shadow-filter",
  ]);
  assert.equal(rendering.homeScene.environment, null);
  assert.equal(rendering.lights.sun.shadow.map, null);
  assert.equal(rendering.lights.sun.shadow.mapPass, null);
  rendering.dispose();
});
