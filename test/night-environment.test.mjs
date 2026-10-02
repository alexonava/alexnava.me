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
  let draws = 0;
  const renderer = {
    extensions: { has: () => false },
    getRenderTarget: () => null,
    setRenderTarget() {},
    // PMREMGenerator asks the renderer to draw: this one cannot.
    render() {
      draws++;
      throw new Error("no context");
    },
  };
  const environment = createNightEnvironment(renderer, { keyDirection: [0, 1, 0] });
  environment.setSky(skyMaterial());
  assert.equal(environment.capture(), null);
  assert.equal(environment.status, "failed");
  assert.equal(environment.texture, null);
  assert.equal(environment.capture(), null);
  assert.ok(draws <= 1);
  assert.equal(environment.restore(), null, "nothing to restore");
  environment.dispose();
});

test("the film sets the night sky as the scene's environment and clears it without the film", () => {
  const renderer = {
    capabilities: { getMaxAnisotropy: () => 8 },
    domElement: {},
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
