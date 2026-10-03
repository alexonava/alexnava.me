// The film's night sky as the scene's environment (night-environment.js).

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { BackSide, HalfFloatType, Vector3 } from "three";
import { createEstateSkyMaterial } from "../src/scene/estate-sky.js";
import { createNightEnvironment, NIGHT_SKY } from "../src/scene/night-environment.js";
import { createSceneRendering } from "../src/scene/rendering.js";
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

test("the environment is the film sky shell's own shader, with the moon's glow, the ranges and the ground", () => {
  const renderer = parallelRenderer(),
    environment = createNightEnvironment(renderer, { keyDirection: [32, 28, 14] }),
    sky = skyMaterial();
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
  assert.equal(sky.uniforms.uFilm.value, 0);
  // The cube's faces have no name behind them: the clouds' text guard reads an empty
  // box of the capture's own, never the live one the clone would share.
  sky.uniforms.slateText.value.x = 0;
  assert.notEqual(material.uniforms.slateText, sky.uniforms.slateText);
  assert.deepEqual(material.uniforms.slateText.value, { x: 2, y: 2, z: -1, w: -1 });
  // It lights the scene with the authored clouds, without the sky's reshaping, so
  // the materials' approved sky light and reflections keep their brightness.
  assert.equal(material.uniforms.uCloudReshape.value, 0);
  assert.notEqual(material.uniforms.uCloudReshape, sky.uniforms.uCloudReshape);
  assert.equal(sky.uniforms.uCloudReshape.value, 1);
  // The additions sit after the film sky, before the shell's opacity, which they divide out.
  const fragment = material.fragmentShader;
  assert.match(fragment, /uniform float envCapture;\nuniform vec3 envKeyDirection;\nvoid main\(\)/);
  assert.ok(fragment.indexOf("if(envCapture>.5){") < fragment.indexOf("gl_FragColor=uFilm>.5?"));
  assert.ok(fragment.indexOf("col+=filmBand(altitude);") < fragment.indexOf("if(envCapture>.5){"));
  assert.match(fragment, /\/0\.52;/);
  const key = material.uniforms.envKeyDirection.value;
  assert.ok(key.distanceTo(new Vector3(32, 28, 14).normalize()) < 1e-9);
  // Below the horizon the dark ground, never the shell's pale horizon colour.
  assert.ok(NIGHT_SKY.ground.every((value) => value < 0.06));
  assert.ok(NIGHT_SKY.ranges.tone.every((value) => value < 0.12));
  sky.dispose();
  environment.dispose();
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
