import assert from "node:assert/strict";
import test from "node:test";
import { createSceneRendering } from "../src/scene/rendering.js";

function createProfile() {
  return {
    lighting: {
      ambientIntensity: 0.22,
      directionalIntensity: 2.9,
      extraDirectional: true,
      fillIntensity: 0.31,
      fogFar: 150,
      fogNear: 62,
      hemisphereIntensity: 0.71,
    },
    shadows: {
      enabled: true,
      mapSize: 1024,
    },
  };
}

test("scene rendering owns quality, sizing, rendering, and disposal lifecycle", () => {
  const calls = [];
  let contextLost = false;
  let rendererOptions = null;
  let rendererRatio = 1;
  let composerRatio = 1;
  const renderer = {
    capabilities: { getMaxAnisotropy: () => 8 },
    domElement: {},
    outputColorSpace: null,
    shadowMap: {},
    getContext: () => ({ isContextLost: () => contextLost }),
    getPixelRatio: () => rendererRatio,
    setClearColor: (...args) => calls.push(["clear", ...args]),
    setPixelRatio: (value) => {
      rendererRatio = value;
      calls.push(["pixelRatio", value]);
    },
    setSize: (...args) => calls.push(["rendererSize", ...args]),
  };
  const composer = {
    addPass: () => calls.push(["passAdded"]),
    render: () => {
      if (contextLost) throw new TypeError("Shader log is null before contextlost dispatch");
      calls.push(["render"]);
    },
    setPixelRatio: (value) => {
      composerRatio = value;
      calls.push(["composerPixelRatio", value]);
    },
    setSize: (...args) => calls.push(["composerSize", ...args]),
  };
  const pipeline = {
    composer,
    resize: (...args) => calls.push(["postprocessSize", ...args]),
    setQualityProfile: (profile) => calls.push(["quality", profile]),
  };
  let disposedOptions = null;
  const profile = createProfile();
  const rendering = createSceneRendering({
    container: {
      appendChild(node) {
        assert.equal(node, renderer.domElement);
      },
    },
    createPipeline: () => pipeline,
    createRenderer: (options) => {
      rendererOptions = options;
      return renderer;
    },
    disposeResources(options) {
      disposedOptions = options;
      return { geometries: 1 };
    },
    height: 600,
    lighting: {
      ambientColor: 0xffffff,
      ambientIntensity: 0.22,
      directionalColor: 0xffffff,
      directionalIntensity: 2.9,
      directionalPosition: { x: 21, y: 29, z: 23 },
      fogColor: 0x222222,
      fogFar: 150,
      fogNear: 62,
      hemisphereGroundColor: 0x111111,
      hemisphereIntensity: 0.71,
      hemisphereSkyColor: 0x888888,
    },
    profile,
    threeExports: {},
    width: 800,
    world: {
      CAMERA_FAR: 210,
      CAMERA_FOV: 48,
      CAMERA_NEAR: 0.5,
      FILL_LIGHT_POSITION: [-20, 14, -18],
      SHADOW_CAMERA_FAR: 120,
      SHADOW_CAMERA_HALF_EXTENT: 34,
      SHADOW_CAMERA_NEAR: 0.5,
    },
  });

  assert.equal(rendering.lights.fill.visible, true);
  assert.equal(rendering.lights.fill.intensity, 0.58);
  assert.equal(rendererOptions.antialias, false, "only the composer targets multisample");
  rendering.applyQuality(profile, { pixelRatio: 1.5 });
  assert.equal(rendererRatio, 1.5);
  assert.equal(composerRatio, rendererRatio, "composer targets follow the canvas pixel ratio");
  assert.equal(
    calls.some((entry) => entry[0] === "postprocessSize"),
    false,
    "the ink contour's CSS-pixel texels ignore the pixel ratio",
  );
  assert.equal(rendering.lights.fill.intensity, 0.31);
  rendering.setGroundedLighting(true);
  assert.equal(rendering.lights.sun.color.getHex(), 0xd9e2f2);
  assert.equal(rendering.lights.sun.intensity, 2.9 * 0.8);
  assert.equal(rendering.lights.fill.intensity, 0.31 * 1.5);
  rendering.applyQuality(profile);
  assert.equal(rendering.lights.sun.intensity, 2.9 * 0.8);
  assert.equal(rendering.lights.fill.intensity, 0.31 * 1.5);
  rendering.applyQuality({
    ...profile,
    lighting: { ...profile.lighting, directionalIntensity: 2, fillIntensity: 0.2 },
  });
  assert.equal(rendering.lights.sun.intensity, 1.6);
  assert.equal(rendering.lights.fill.intensity, 0.2 * 1.5);
  rendering.setGroundedLighting(false);
  assert.equal(rendering.lights.sun.intensity, 2);
  assert.equal(rendering.lights.fill.intensity, 0.2);
  rendering.applyQuality(profile);
  assert.equal(rendering.lights.sun.color.getHex(), 0xffffff);
  assert.equal(rendering.lights.sun.intensity, 2.9);
  assert.equal(rendering.lights.fill.intensity, 0.31);
  const beforePosition = rendering.lights.sun.position.clone(),
    beforeTarget = rendering.lights.sun.target.position.clone();
  const direction = beforePosition.clone().sub(beforeTarget);
  rendering.setFilmTreatment(true);
  rendering.focusFilmShadow(new beforeTarget.constructor(55, 8, 36), 12);
  assert.ok(
    rendering.lights.sun.position
      .clone()
      .sub(rendering.lights.sun.target.position)
      .distanceTo(direction) < 1e-6,
  );
  assert.equal(rendering.lights.sun.shadow.camera.left, -32);
  rendering.applyQuality(profile);
  assert.equal(rendering.lights.fill.intensity, 0.31 * 1.66);
  rendering.setFilmTreatment(false);
  assert.deepEqual(rendering.lights.sun.position.toArray(), beforePosition.toArray());
  assert.deepEqual(rendering.lights.sun.target.position.toArray(), beforeTarget.toArray());
  assert.equal(rendering.lights.sun.shadow.camera.left, -34);

  rendering.applyQuality({
    ...profile,
    lighting: {
      ...profile.lighting,
      extraDirectional: false,
      fillIntensity: 0,
    },
  });
  assert.equal(rendering.lights.fill.visible, false);
  assert.equal(rendering.lights.fill.intensity, 0);
  rendering.resize({ cameraFov: 52, height: 400, width: 900 });
  rendering.update();
  const renderedBeforeLoss = calls.filter(([name]) => name === "render").length;
  // Deliberately dispatch no DOM event: the native context can be lost before
  // either Three or the scene scheduler receives its queued notification.
  contextLost = true;
  assert.equal(rendering.update(), false);
  assert.equal(rendering.update({ render: false }), true);
  assert.equal(calls.filter(([name]) => name === "render").length, renderedBeforeLoss);
  contextLost = false;
  assert.equal(rendering.update(), true);
  assert.equal(calls.filter(([name]) => name === "render").length, renderedBeforeLoss + 1);
  const renderTarget = { id: "reflection" };
  rendering.trackRenderTarget(renderTarget);

  assert.equal(rendering.camera.fov, 52);
  assert.equal(rendering.camera.aspect, 2.25);
  assert.deepEqual(
    calls.find((entry) => entry[0] === "pixelRatio"),
    ["pixelRatio", 1.5],
  );
  assert.equal(composerRatio, 1.5, "applyQuality without a ratio keeps the composer's");
  assert.deepEqual(
    calls.findLast((entry) => entry[0] === "composerSize"),
    ["composerSize", 900, 400],
  );
  assert.deepEqual(
    calls.findLast((entry) => entry[0] === "postprocessSize"),
    ["postprocessSize", 900, 400],
    "grading texels are CSS pixels",
  );
  assert.equal(
    calls.some((entry) => entry[0] === "passAdded"),
    false,
    "rendering adds no pass of its own",
  );
  assert.ok(calls.some((entry) => entry[0] === "render"));
  assert.deepEqual(rendering.dispose(), { geometries: 1 });
  assert.equal(rendering.dispose(), false);
  assert.equal(rendering.update(), false);
  assert.deepEqual(disposedOptions.renderTargets, [renderTarget]);
});

test("static shadows redraw the sun map only after reported changes", () => {
  const listeners = {};
  const renderer = {
    capabilities: { getMaxAnisotropy: () => 8 },
    domElement: {
      addEventListener: (name, handler) => (listeners[name] = handler),
      removeEventListener: (name) => delete listeners[name],
    },
    shadowMap: {},
    setClearColor() {},
    setPixelRatio() {},
    setSize() {},
  };
  const pipeline = {
    composer: { addPass() {}, render() {}, setPixelRatio() {}, setSize() {} },
    setQualityProfile() {},
  };
  const profile = createProfile();
  const rendering = createSceneRendering({
    container: { appendChild() {} },
    createPipeline: () => pipeline,
    createRenderer: () => renderer,
    disposeResources: () => ({}),
    height: 600,
    lighting: {
      ambientColor: 0xffffff,
      ambientIntensity: 0.22,
      directionalColor: 0xffffff,
      directionalIntensity: 2.9,
      directionalPosition: { x: 21, y: 29, z: 23 },
      fogColor: 0x222222,
      fogFar: 150,
      fogNear: 62,
      hemisphereGroundColor: 0x111111,
      hemisphereIntensity: 0.71,
      hemisphereSkyColor: 0x888888,
    },
    profile,
    threeExports: {},
    width: 800,
    world: {
      CAMERA_FAR: 210,
      CAMERA_FOV: 48,
      CAMERA_NEAR: 0.5,
      FILL_LIGHT_POSITION: [-20, 14, -18],
      SHADOW_CAMERA_FAR: 120,
      SHADOW_CAMERA_HALF_EXTENT: 34,
      SHADOW_CAMERA_NEAR: 0.5,
    },
  });
  const shadow = rendering.lights.sun.shadow;
  // Three clears needsUpdate after drawing the map; model that consumption.
  const redraws = (change) => {
    shadow.needsUpdate = false;
    change();
    return shadow.needsUpdate;
  };

  assert.equal(shadow.autoUpdate, true, "per-frame shadows by default");
  rendering.setStaticShadows(true);
  assert.equal(shadow.autoUpdate, false);
  assert.equal(shadow.needsUpdate, true, "the first static frame draws the map");

  assert.equal(
    redraws(() => rendering.applyQuality(profile)),
    true,
  );
  assert.equal(
    redraws(() => rendering.resize({ height: 400, width: 900 })),
    true,
  );
  assert.equal(
    redraws(() => rendering.setFilmTreatment(true)),
    true,
  );
  const focus = rendering.lights.sun.target.position.clone().set(55, 8, 36);
  assert.equal(
    redraws(() => rendering.focusFilmShadow(focus, 12)),
    true,
  );
  assert.equal(
    redraws(() => rendering.focusFilmShadow(focus.clone(), 12)),
    false,
    "an unchanged shot focus keeps the drawn map",
  );
  assert.equal(
    redraws(() => rendering.focusFilmShadow(focus.clone().setX(0), 12)),
    true,
  );
  assert.equal(
    redraws(() => rendering.setGroundedLighting(true)),
    true,
  );
  assert.equal(
    redraws(() => rendering.invalidateShadows()),
    true,
  );
  assert.equal(
    redraws(() => listeners.webglcontextrestored?.({})),
    true,
  );
  assert.equal(
    redraws(() => rendering.update()),
    false,
    "an ordinary frame keeps the map",
  );

  rendering.setStaticShadows(false);
  assert.equal(shadow.autoUpdate, true, "per-frame redraws can be restored");
  rendering.dispose();
  assert.equal(rendering.setStaticShadows(true), false);
  assert.equal(shadow.autoUpdate, true);
});

test("a lost context ends a tour crossfade before the scene hears of it", () => {
  const listeners = {};
  const calls = [];
  const rendering = createSceneRendering({
    container: { appendChild() {} },
    createPipeline: () => ({
      cancelTransition: () => calls.push("cancel"),
      invalidatePrograms: () => calls.push("invalidate"),
      composer: { addPass() {}, render() {}, setPixelRatio() {}, setSize() {} },
      setQualityProfile() {},
    }),
    createRenderer: () => ({
      domElement: {
        addEventListener: (name, handler) => (listeners[name] = handler),
        removeEventListener: (name) => delete listeners[name],
      },
      shadowMap: {},
      setClearColor() {},
    }),
    disposeResources: () => ({}),
    height: 600,
    lighting: {
      ambientColor: 0xffffff,
      ambientIntensity: 0.22,
      directionalColor: 0xffffff,
      directionalIntensity: 2.9,
      directionalPosition: { x: 21, y: 29, z: 23 },
      fogColor: 0x222222,
      fogFar: 150,
      fogNear: 62,
      hemisphereGroundColor: 0x111111,
      hemisphereIntensity: 0.71,
      hemisphereSkyColor: 0x888888,
    },
    onContextLost: () => calls.push("lost"),
    profile: createProfile(),
    threeExports: {},
    width: 800,
    world: {
      CAMERA_FAR: 210,
      CAMERA_FOV: 48,
      CAMERA_NEAR: 0.5,
      FILL_LIGHT_POSITION: [-20, 14, -18],
      SHADOW_CAMERA_FAR: 120,
      SHADOW_CAMERA_HALF_EXTENT: 34,
      SHADOW_CAMERA_NEAR: 0.5,
    },
  });

  listeners.webglcontextlost({ preventDefault: () => calls.push("prevented") });
  assert.deepEqual(calls, ["prevented", "cancel", "invalidate", "lost"]);
  rendering.dispose();
  assert.equal(listeners.webglcontextlost, undefined);
});
