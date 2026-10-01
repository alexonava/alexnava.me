// The film treatment: its scene borrowing, the slate ground maps, the estate's
// growth and ground detail, depth layers and the environment root.

import assert from "node:assert/strict";
import test from "node:test";
import {
  BoxGeometry,
  Color,
  Group,
  Mesh,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  Vector3,
} from "three";
import { createEarthDetail, FILM_GROUND_PRESETS } from "../src/scene/filmic-earth.js";
import { createFilmScene } from "../src/scene/film-scene.js";
import { DEPTH_LAYER, stampDepthLayer } from "../src/scene/depth-layers.js";
import { createEstateGroundDetail, estatePathDistance } from "../src/scene/estate-ground-detail.js";
import { rockKeepouts } from "../src/scene/rock-scatter.js";
import { createSceneEnvironment } from "../src/scene/environment.js";

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-5, `${a} != ${b}`);

test("film scene restores geometry, lighting and sky before disposal and tolerates repeated teardown", async () => {
  const ground = new Mesh(new BoxGeometry(), new MeshStandardMaterial()),
    original = ground.geometry;
  const states = [],
    skyMaterial = { uniforms: { sunColor: { value: new Color(0xffaa00) } } };
  const controller = createFilmScene({
    ground,
    groundHeight: () => 0,
    skyMaterial,
    rendering: { setFilmTreatment: (a) => states.push(a) },
    atmosphere: { setFilmTreatment() {} },
    onGroundChange() {},
  });
  controller.setActive(true);
  await controller.ready;
  const terrain = ground.geometry;
  assert.notEqual(terrain, original);
  let disposed = 0;
  terrain.addEventListener("dispose", () => {
    disposed++;
    assert.equal(ground.geometry, original);
  });
  controller.setActive(false);
  assert.equal(skyMaterial.uniforms.sunColor.value.getHex(), 0xffaa00);
  controller.setActive(true);
  assert.equal(ground.geometry, terrain);
  controller.dispose();
  controller.dispose();
  assert.equal(disposed, 1);
  assert.deepEqual(states, [true, false, true, false]);
  original.dispose();
  ground.material.dispose();
});

const tick = () => new Promise((resolve) => setImmediate(resolve));

const canvas = () => ({ width: 0, height: 0, getContext: () => ({ drawImage() {} }) });

test("the default film slate binds its seamless maps and shared detail map at the classic tile after the film gate", async () => {
  const pending = [],
    published = [],
    closed = [];
  let bound = null;
  const slate = createEarthDetail({
    profile: { tier: "high" },
    anisotropy: 4,
    createCanvas: canvas,
    publish: (m) => {
      bound = m;
      published.push(m);
    },
    restore: () => {
      bound = null;
    },
    loadImage: (url, { signal }) =>
      new Promise((resolve) => pending.push({ url, signal, resolve })),
  });
  assert.equal(pending.length, 0, "no download before the film activates");
  slate.setActive(true);
  assert.deepEqual(
    pending.map(({ url }) => url),
    [
      "/images/materials/slate-color-1024.webp",
      "/images/materials/slate-normal-1024.webp",
      "/images/materials/slate-detail-512.webp",
    ],
  );
  slate.applyQuality({ tier: "balanced" });
  assert.ok(pending.slice(0, 3).every(({ signal }) => signal.aborted));
  // Both tiers share the one 512 detail map.
  assert.deepEqual(
    pending.slice(3).map(({ url }) => url),
    [
      "/images/materials/slate-color-512.webp",
      "/images/materials/slate-normal-512.webp",
      "/images/materials/slate-detail-512.webp",
    ],
  );
  pending.forEach((r, i) => {
    const size = i < 2 ? 1024 : 512;
    r.resolve({ width: size, height: size, close: () => closed.push(i) });
  });
  await tick();
  await tick();
  assert.equal(published.length, 1);
  assert.equal(closed.length, 6);
  // The seamless v2 tile repeats every 22 world units (the classic ground's
  // tile), so 384 / 22 across the film terrain, without mirroring.
  close(FILM_GROUND_PRESETS.slate.tile, 22);
  for (const map of [bound.colorMap, bound.normalMap, bound.detailMap]) {
    close(map.repeat.x, 384 / 22);
    close(map.repeat.y, 384 / 22);
    assert.equal(map.wrapS, RepeatWrapping);
    assert.equal(map.wrapT, RepeatWrapping);
    assert.equal(map.anisotropy, 4);
  }
  assert.equal(bound.colorMap.colorSpace, SRGBColorSpace);
  assert.notEqual(bound.normalMap.colorSpace, SRGBColorSpace);
  assert.notEqual(bound.detailMap.colorSpace, SRGBColorSpace, "the detail map holds linear height");
  assert.equal(bound.normalScale, 0.45);
  assert.equal(bound.roughnessMap, null);
  assert.equal(bound.bumpMap, null);
  assert.equal(bound.filmTiled, true, "index.js keeps the film tiling as published");
  let disposals = 0;
  for (const m of [bound.colorMap, bound.normalMap, bound.detailMap])
    m.addEventListener("dispose", () => {
      assert.equal(bound, null, "bindings are restored before the maps are freed");
      disposals++;
    });
  slate.setActive(false);
  assert.equal(disposals, 3);
  slate.dispose();
  assert.equal(slate.dispose(), false);
});

test("a failed slate map reports a fallback, and the slate is the only preset", async () => {
  const statuses = [];
  let published = 0,
    closed = 0;
  const slate = createEarthDetail({
    preset: "slate",
    profile: { tier: "high" },
    anisotropy: 4,
    createCanvas: canvas,
    publish: () => published++,
    restore: () => {},
    report: (status) => statuses.push(status.status),
    loadImage: async (url) => {
      if (url.includes("normal")) throw Error("404");
      const size = url.includes("detail") ? 512 : 1024;
      return { width: size, height: size, close: () => closed++ };
    },
  });
  slate.setActive(true);
  await tick();
  await tick();
  assert.equal(published, 0);
  assert.equal(closed, 2, "the color and detail maps that did load are closed");
  assert.deepEqual(statuses.slice(-1), ["fallback"]);
  slate.dispose();
  assert.deepEqual(Object.keys(FILM_GROUND_PRESETS), ["slate"]);
  for (const preset of ["earth", "mud"])
    assert.throws(
      () => createEarthDetail({ preset, publish() {}, restore() {} }),
      /Unknown film ground preset/,
    );
});

test("the slate keeps its loaded maps through adaptive profile changes with a pinned asset tier", async () => {
  for (const [create, kinds] of [[createEarthDetail, 3]]) {
    const pending = [];
    let published = 0,
      restored = 0;
    const layer = create({
      profile: { tier: "high" },
      anisotropy: 4,
      createCanvas: canvas,
      publish: () => published++,
      restore: () => restored++,
      loadImage: (url, { signal }) =>
        new Promise((resolve) => pending.push({ url, signal, resolve })),
    });
    layer.applyQuality({ tier: "high" }, { pixelRatio: 2, assetTier: "high" });
    layer.setActive(true);
    assert.equal(pending.length, kinds);
    pending.forEach(({ url, resolve }) => {
      const size = url.includes("detail") ? 512 : 1024;
      resolve({ width: size, height: size, close() {} });
    });
    await tick();
    await tick();
    assert.equal(published, 1);
    const restoredBefore = restored;
    for (const tier of ["balanced", "low", "high"]) {
      layer.applyQuality({ tier }, { pixelRatio: 1, assetTier: "high" });
    }
    assert.equal(pending.length, kinds, "no other map size is fetched");
    assert.ok(pending.every(({ signal }) => !signal.aborted));
    assert.equal(restored, restoredBefore, "the bound maps are never restored away");
    // Reactivation reuses the pinned tier rather than the latest adaptive profile.
    layer.setActive(false);
    layer.applyQuality({ tier: "balanced" }, { pixelRatio: 1, assetTier: "high" });
    layer.setActive(true);
    assert.equal(pending.length, 2 * kinds);
    assert.ok(
      pending
        .slice(kinds)
        .every(({ url }) => url.endsWith("-1024.webp") || url.endsWith("detail-512.webp")),
    );
    layer.dispose();
  }
});

const groundHeight = (x, z) => Math.sin(x * 0.07) + Math.cos(z * 0.04);

const profile = { tier: "high" };

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
  environment.applyQuality({ tier: "low" });
  assert.equal(mesh.visible, false);
  environment.dispose();
  assert.equal(mesh.parent, null);
  assert.equal(environment.setFilmTreatment(true), false);
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

const highProfile = {
  lighting: {
    practicalIntensityScale: 1,
  },
  tier: "high",
};

test("environment owns composition and its disposal", () => {
  const parent = new Group();
  const environment = createSceneEnvironment({
    groundHeight: (x, z) => x + z,
    parent,
    profile: highProfile,
  });
  environment.resize({ composition: { sceneOffsetY: -6 } });
  assert.equal(environment.root.position.y, -6);
  assert.equal(environment.applyQuality({ tier: "balanced" }), true);
  assert.equal(environment.dispose(), true);
  assert.equal(environment.dispose(), false);
  assert.equal(environment.root.visible, false);
  assert.equal(environment.applyQuality(highProfile), false);
  assert.equal(parent.children.includes(environment.root), true);
});
