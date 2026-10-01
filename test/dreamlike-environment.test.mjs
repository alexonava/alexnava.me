import assert from "node:assert/strict";
import test from "node:test";
import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  CustomBlending,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NoBlending,
  NormalBlending,
  OneFactor,
  OneMinusSrcAlphaFactor,
  ShaderMaterial,
  SrcAlphaFactor,
  Vector3,
  ZeroFactor,
} from "three";
import { DEPTH_LAYER, stampDepthLayer } from "../src/scene/depth-layers.js";
import { createEstateSkyMaterial, FILM_SKY_GLSL } from "../src/scene/estate-sky.js";
import { createEstateGroundDetail, estatePathDistance } from "../src/scene/estate-ground-detail.js";
import { rockKeepouts } from "../src/scene/rock-scatter.js";
import { createSceneEnvironment } from "../src/scene/environment.js";
import { createSceneAtmosphere } from "../src/scene/atmosphere.js";
import { createFilmScene } from "../src/scene/film-scene.js";

const groundHeight = (x, z) => Math.sin(x * 0.07) + Math.cos(z * 0.04);
const profile = { tier: "high", isLow: false };
test("estate growth is seeded, terrain-seated and clear of both footprints and the winding approach", () => {
  const a = createEstateGroundDetail(groundHeight),
    b = createEstateGroundDetail(groundHeight);
  const keepouts = rockKeepouts();
  const p = a.mesh.geometry.attributes.position,
    q = b.mesh.geometry.attributes.position;
  assert.deepEqual(p.array, q.array);
  assert.equal(p.count, 360 * 12);
  for (let i = 0; i < p.count; i += 12) {
    const x = (p.getX(i) + p.getX(i + 1)) / 2,
      z = (p.getZ(i) + p.getZ(i + 1)) / 2;
    assert.ok(Math.abs(p.getY(i) - groundHeight(x, z) + 0.018) < 1e-5);
    assert.ok(Math.hypot(x, z) > 10.4);
    assert.ok(Math.hypot(x - 55.1, z - 36.1) > 5.8);
    assert.ok(estatePathDistance(x, z) > 2.09);
    assert.ok(p.getY(i + 3) > p.getY(i));
    // No tuft stands in a scattered rock or the ring its pebble may take.
    for (const rock of keepouts) assert.ok(Math.hypot(x - rock.x, z - rock.z) >= rock.radius);
  }
  assert.equal(a.mesh.material.transparent, false);
  // Growth dissolves with the ground it stands on in the tour's staggered cut.
  assert.match(a.mesh.material.customProgramCacheKey(), /\|depth-layer-0\.6667$/);
  const shader = { vertexShader: "", fragmentShader: "#include <dithering_fragment>\n}" };
  a.mesh.material.onBeforeCompile(shader);
  assert.equal(shader.fragmentShader, "#include <dithering_fragment>\ngl_FragColor.a = 0.6667;\n}");
  a.dispose();
  b.dispose();
});
test("ground-detail quality changes trim a shared geometry and restore original world positions", () => {
  const detail = createEstateGroundDetail(groundHeight),
    mesh = detail.mesh;
  const original = mesh.geometry.attributes.position.array.slice();
  assert.equal(mesh.visible, false);
  detail.setActive(true);
  assert.equal(mesh.geometry.drawRange.count, 360 * 18);
  detail.applyQuality({ tier: "balanced" });
  assert.equal(mesh.geometry.drawRange.count, 300 * 18);
  assert.equal(mesh.visible, true);
  detail.applyQuality({ tier: "low" });
  assert.equal(mesh.visible, false);
  detail.applyQuality(profile);
  assert.deepEqual(mesh.geometry.attributes.position.array, original);
  assert.equal(mesh.visible, true);
  detail.setActive(false);
  assert.equal(mesh.visible, false);
  let freed = 0;
  mesh.geometry.addEventListener("dispose", () => freed++);
  assert.equal(detail.dispose(), true);
  assert.equal(detail.dispose(), false);
  detail.setActive(true);
  assert.equal(mesh.visible, false);
  assert.equal(freed, 1);
});
test("environment creates growth only after film activation and owns its lifecycle", () => {
  const parent = new Group(),
    environment = createSceneEnvironment({ parent, groundHeight, profile });
  assert.equal(environment.root.children.length, 0);
  environment.setFilmTreatment(true);
  const mesh = environment.root.getObjectByName("estate-ground-growth");
  assert.ok(mesh?.visible);
  environment.resize({ composition: { sceneOffsetY: -7.5 } });
  assert.equal(mesh.getWorldPosition(new Vector3()).y, -7.5);
  environment.setFilmTreatment(false);
  assert.equal(mesh.visible, false);
  environment.setFilmTreatment(true);
  assert.equal(environment.root.children.length, 1);
  environment.applyQuality({ tier: "low", isLow: true });
  assert.equal(mesh.visible, false);
  environment.dispose();
  assert.equal(mesh.parent, null);
  assert.equal(environment.setFilmTreatment(true), false);
});
test("film makes the sky opaque and restores its baseline compositing", () => {
  const ground = new Mesh(new BoxGeometry(), new MeshStandardMaterial()),
    parent = new Group();
  const atmosphere = createSceneAtmosphere({ parent, profile });
  const sky = {
    transparent: true,
    uniforms: { sunColor: { value: new Color(0x334455) }, uFilm: { value: 0 } },
  };
  const rendering = { setFilmTreatment() {}, focusFilmShadow() {}, postprocessPipeline: {} };
  const film = createFilmScene({ ground, groundHeight, atmosphere, rendering, skyMaterial: sky });
  film.setActive(true);
  assert.equal(sky.uniforms.uFilm.value, 1);
  assert.equal(sky.transparent, false);
  film.finishFrame(null, new Vector3(), null);
  film.setActive(false);
  assert.equal(sky.uniforms.uFilm.value, 0);
  assert.equal(sky.transparent, true);
  assert.equal(sky.uniforms.sunColor.value.getHex(), 0x334455);
  film.setActive(true);
  film.dispose();
  assert.equal(sky.transparent, true);
  assert.equal(sky.uniforms.uFilm.value, 0);
  atmosphere.dispose();
  ground.geometry.dispose();
  ground.material.dispose();
});
test("estate sky uses one world-space shell with preserved baseline uniforms and no image dependency", () => {
  const direction = new Vector3(1, 2, 3).normalize();
  const material = createEstateSkyMaterial({
    skyTopColor: 0x112233,
    skyBottomColor: 0x334455,
    skyGlowColor: 0x445566,
    sunColor: 0xffbb77,
    sunDirection: direction,
    shellOpacity: 0.9,
  });
  assert.equal(material.uniforms.uFilm.value, 0);
  assert.equal(material.uniforms.sunDirection.value, direction);
  assert.equal(material.uniforms.topColor.value.getHex(), 0x112233);
  assert.equal(material.depthWrite, false);
  assert.equal(material.uniforms.uTime.value, 0);
  assert.match(material.vertexShader, /modelMatrix \* vec4\(position/);
  assert.match(material.fragmentShader, /if \(uFilm>.5\)/);
  // The opaque film shell writes the sky's depth layer; the baseline keeps its opacity.
  assert.match(
    material.fragmentShader,
    /gl_FragColor=uFilm>\.5\?vec4\(col\*0\.9,0\.0\):vec4\(col,0\.9\);/,
  );
  assert.doesNotMatch(material.fragmentShader, /sampler2D|gl_FragCoord/);
  // The film gradient and horizon band are the shared functions the mountains haze toward.
  assert.ok(material.fragmentShader.includes(FILM_SKY_GLSL));
  assert.match(material.fragmentShader, /col=filmSky\(altitude\);/);
  assert.match(material.fragmentShader, /col\+=filmBand\(altitude\);\s*}\s*gl_FragColor=/);
  material.dispose();
});

test("film clouds keep defined low-sky silhouettes while low quality retains its original fade", () => {
  const material = createEstateSkyMaterial({
    sunDirection: new Vector3(0, 1, 0),
    shellOpacity: 0.52,
  });
  const smoothstep = (a, b, x) => {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  const mix = (a, b, t) => a + (b - a) * t;
  // Evaluate the emitted scalar GLSL expressions, so this checks the shader's
  // actual opacity and edge width instead of a second set of tuning constants.
  const scalar = (name) =>
    new Function(
      "uNebulaLayers",
      "altitude",
      "smoothstep",
      "mix",
      `return ${material.fragmentShader.match(new RegExp(`float ${name}=([^;]+);`))[1]}`,
    );
  const fade = scalar("horizonFade"),
    edge = scalar("w");
  for (const layers of [2, 3]) {
    assert.equal(fade(layers, 0, smoothstep, mix), 0, "no seam below the horizon");
    assert.ok(
      fade(layers, Math.sin((2 * Math.PI) / 180), smoothstep, mix) > 0.85,
      "cloud bodies remain distinct two degrees above the shell horizon",
    );
    assert.equal(fade(layers, 0.045, smoothstep, mix), 1);
    let previous = 0;
    for (const altitude of [-0.1, 0, 0.01, 0.02, 0.03, 0.04, 0.045, 0.1, 0.3, 0.8, 1]) {
      const value = fade(layers, altitude, smoothstep, mix);
      assert.ok(value >= previous && value <= 1, "the narrow fade is smooth and bounded");
      assert.equal(edge(layers, altitude, smoothstep, mix), 0.034);
      previous = value;
    }
  }
  for (const altitude of [-0.1, 0, 0.02, 0.045, 0.1, 0.17, 0.5, 0.8, 1]) {
    assert.equal(fade(0, altitude, smoothstep, mix), smoothstep(-0.03, 0.17, altitude));
    assert.equal(
      edge(0, altitude, smoothstep, mix),
      mix(0.05, 0.034, smoothstep(0.45, 0.8, altitude)),
    );
  }
  material.dispose();
});

test("sky drift follows the scheduler clock, freezes for reduced motion and stops on disposal", () => {
  const atmosphere = createSceneAtmosphere({ parent: new Group(), profile });
  const sky = { uniforms: { uTime: { value: 0 } } };
  atmosphere.setSkyMaterial(sky);
  atmosphere.update({ elapsedSeconds: 12 });
  assert.equal(sky.uniforms.uTime.value, 12);
  atmosphere.update({ elapsedSeconds: 24, reducedMotion: true });
  assert.equal(sky.uniforms.uTime.value, 12);
  atmosphere.update({ elapsedSeconds: 25 });
  assert.equal(sky.uniforms.uTime.value, 25);
  atmosphere.dispose();
  atmosphere.update({ elapsedSeconds: 30 });
  assert.equal(sky.uniforms.uTime.value, 25);
});

test("depth-layer stamps compose with a material's own shader hook and program key", () => {
  assert.deepEqual({ ...DEPTH_LAYER }, { sky: "0.0", mountains: "0.3333", ground: "0.6667" });
  assert.ok(Object.isFrozen(DEPTH_LAYER));
  const material = new MeshStandardMaterial();
  const calls = [];
  material.onBeforeCompile = function (shader, renderer) {
    calls.push([this, renderer]);
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <fog_fragment>",
      "#include <fog_fragment>\nfogged();",
    );
  };
  material.customProgramCacheKey = () => "own-key";
  assert.equal(stampDepthLayer(material, DEPTH_LAYER.mountains), material);
  const shader = { fragmentShader: "#include <fog_fragment>\n#include <dithering_fragment>\n}" };
  const renderer = {};
  material.onBeforeCompile(shader, renderer);
  assert.deepEqual(calls, [[material, renderer]]);
  assert.equal(
    shader.fragmentShader,
    "#include <fog_fragment>\nfogged();\n#include <dithering_fragment>\ngl_FragColor.a = 0.3333;\n}",
  );
  assert.equal(material.customProgramCacheKey(), "own-key|depth-layer-0.3333");
  material.dispose();
});

function overlayRig() {
  const atmosphere = createSceneAtmosphere({ parent: new Group(), profile });
  const stars = new ShaderMaterial({ transparent: true, blending: AdditiveBlending });
  const sun = new ShaderMaterial({ transparent: true });
  const shell = new ShaderMaterial({ transparent: true });
  const opaque = new MeshBasicMaterial();
  const unblended = new ShaderMaterial({ transparent: true, blending: NoBlending });
  const geometry = new BoxGeometry();
  const nested = new Group();
  nested.add(new Mesh(geometry, [sun, opaque]));
  atmosphere.root.add(
    new Mesh(geometry, stars),
    new Mesh(geometry, shell),
    new Mesh(geometry, unblended),
    nested,
  );
  return { atmosphere, stars, sun, shell, opaque, unblended, geometry };
}
const factors = (m) => [m.blending, m.blendSrc, m.blendDst, m.blendSrcAlpha, m.blendDstAlpha];

test("film stars and sun blend their colour as before but keep the sky's depth layer, and restore on exit", () => {
  const { atmosphere, stars, sun, shell, opaque, unblended, geometry } = overlayRig();
  shell.transparent = false;
  const before = [stars, sun, shell, opaque, unblended].map(factors);
  atmosphere.setFilmTreatment(true);
  assert.deepEqual(factors(stars), [
    CustomBlending,
    SrcAlphaFactor,
    OneFactor,
    ZeroFactor,
    OneFactor,
  ]);
  assert.deepEqual(factors(sun), [
    CustomBlending,
    SrcAlphaFactor,
    OneMinusSrcAlphaFactor,
    ZeroFactor,
    OneFactor,
  ]);
  assert.deepEqual(
    [shell, opaque, unblended].map(factors),
    before.slice(2),
    "opaque and unblended materials are untouched",
  );
  atmosphere.setFilmTreatment(true);
  assert.deepEqual(
    factors(stars),
    [CustomBlending, SrcAlphaFactor, OneFactor, ZeroFactor, OneFactor],
    "idempotent",
  );
  atmosphere.setFilmTreatment(false);
  assert.deepEqual([stars, sun, shell, opaque, unblended].map(factors), before);
  assert.equal(stars.blending, AdditiveBlending);
  assert.equal(sun.blending, NormalBlending);
  atmosphere.setFilmTreatment(true);
  atmosphere.setFilmTreatment(false);
  assert.deepEqual(
    [stars, sun].map(factors),
    before.slice(0, 2),
    "a second round trip restores the originals",
  );
  atmosphere.dispose();
  geometry.dispose();
});

test("film makes the sky shell opaque before the overlays switch, so the sky is never blended away", () => {
  const { atmosphere, stars, geometry } = overlayRig();
  const sky = createEstateSkyMaterial({
    skyTopColor: 0x112233,
    skyBottomColor: 0x334455,
    skyGlowColor: 0x445566,
    sunColor: 0xffbb77,
    sunDirection: new Vector3(0, 1, 0),
    shellOpacity: 0.52,
  });
  atmosphere.root.add(new Mesh(geometry, sky));
  const ground = new Mesh(new BoxGeometry(), new MeshStandardMaterial());
  const rendering = { setFilmTreatment() {}, focusFilmShadow() {}, postprocessPipeline: {} };
  const film = createFilmScene({ ground, groundHeight, atmosphere, rendering, skyMaterial: sky });
  film.setActive(true);
  // Reversed, the shell (alpha 0 in film) would take the overlays' blending and turn black.
  assert.equal(sky.transparent, false);
  assert.equal(sky.blending, NormalBlending);
  assert.equal(sky.blendDstAlpha, null);
  assert.equal(stars.blending, CustomBlending);
  film.setActive(false);
  assert.equal(sky.transparent, true);
  assert.equal(sky.blending, NormalBlending);
  assert.equal(stars.blending, AdditiveBlending);
  film.dispose();
  atmosphere.dispose();
  sky.dispose();
  geometry.dispose();
  ground.geometry.dispose();
  ground.material.dispose();
});
