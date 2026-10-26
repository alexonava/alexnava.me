// The film treatment: its scene borrowing, the slate ground maps, the estate's
// growth and ground detail, depth layers and the environment root.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  BoxGeometry,
  BufferGeometry,
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
import {
  BLADE_VERTICES,
  GROWTH,
  createEstateGroundDetail,
  prepareEstateGroundDetail,
  estatePathDistance,
  streamDistance,
} from "../src/scene/estate-ground-detail.js";
import { GRASS_MOOD } from "../src/scene/film-light.js";
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

test("hidden opening preparation waits for the terrain sampler and delegates the latest frame", async () => {
  const ground = new Mesh(new BoxGeometry(), new MeshStandardMaterial());
  let release;
  const loading = new Promise((resolve) => (release = resolve));
  const frames = [];
  const height = Object.assign(() => 0, {
    openingState: { terrain: true, details: true, foreground: true },
    setActive() {},
    prepareOpening: async (frame) => {
      frames.push(frame);
      return true;
    },
  });
  const controller = createFilmScene({
    ground,
    groundHeight: () => 0,
    skyMaterial: { uniforms: { sunColor: { value: new Color() } } },
    rendering: { setFilmTreatment() {} },
    atmosphere: { setFilmTreatment() {} },
    loadTerrain: () => loading,
  });
  controller.setActive(true);
  const frame = { viewport: { width: 390, height: 844 }, shot: "Lantern study" };
  const preparation = controller.prepareOpening(frame);
  assert.equal(frames.length, 0);
  const terrain = new BoxGeometry();
  release({ createEarthGeometry: async () => terrain, settleRoots: () => height });
  assert.equal(await preparation, true);
  assert.equal(frames[0], frame);
  assert.equal(controller.openingState, height.openingState);
  controller.dispose();
  assert.equal(await controller.prepareOpening(frame), false);
  ground.geometry.dispose();
  ground.material.dispose();
});

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
      "/images/materials/slate-grit-1024.webp",
      "/images/materials/slate-relief-1024.webp",
    ],
  );
  slate.applyQuality({ tier: "balanced" });
  assert.ok(pending.slice(0, 5).every(({ signal }) => signal.aborted));
  // Both tiers share the one 512 detail map; the close soil's maps follow the tier.
  assert.deepEqual(
    pending.slice(5).map(({ url }) => url),
    [
      "/images/materials/slate-color-512.webp",
      "/images/materials/slate-normal-512.webp",
      "/images/materials/slate-detail-512.webp",
      "/images/materials/slate-grit-512.webp",
      "/images/materials/slate-relief-512.webp",
    ],
  );
  pending.forEach((r, i) => {
    const size = i < 5 && !r.url.includes("detail") ? 1024 : 512;
    r.resolve({ width: size, height: size, close: () => closed.push(i) });
  });
  await tick();
  await tick();
  assert.equal(published.length, 1);
  assert.equal(closed.length, 10);
  // The seamless v2 tile repeats every 22 world units (the classic ground's
  // tile), so 384 / 22 across the film terrain, without mirroring.
  close(FILM_GROUND_PRESETS.slate.tile, 22);
  assert.notEqual(bound.gritMap.colorSpace, SRGBColorSpace, "the grit holds linear albedo detail");
  assert.notEqual(bound.reliefMap.colorSpace, SRGBColorSpace, "the relief holds linear height");
  for (const map of [
    bound.colorMap,
    bound.normalMap,
    bound.detailMap,
    bound.gritMap,
    bound.reliefMap,
  ]) {
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
  for (const m of [
    bound.colorMap,
    bound.normalMap,
    bound.detailMap,
    bound.gritMap,
    bound.reliefMap,
  ])
    m.addEventListener("dispose", () => {
      assert.equal(bound, null, "bindings are restored before the maps are freed");
      disposals++;
    });
  slate.setActive(false);
  assert.equal(disposals, 5);
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
  assert.equal(closed, 4, "the color, detail, grit and relief maps that did load are closed");
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
  for (const [create, kinds] of [[createEarthDetail, 5]]) {
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

function grassIdleTasks() {
  const previous = globalThis.requestIdleCallback,
    queue = [],
    slices = [];
  globalThis.requestIdleCallback = (task) => queue.push(task);
  return {
    slices,
    async step() {
      const task = queue.shift();
      if (!task) return;
      const start = performance.now();
      task({ didTimeout: true, timeRemaining: () => 0 });
      slices.push(performance.now() - start);
      await Promise.resolve();
    },
    async flush() {
      while (queue.length) await this.step();
      await Promise.resolve();
    },
    restore() {
      if (previous) globalThis.requestIdleCallback = previous;
      else delete globalThis.requestIdleCallback;
    },
  };
}

test("prepared estate growth yields through generation, normals and bounds with identical geometry", async () => {
  const idle = grassIdleTasks();
  let detail;
  try {
    let complete = false;
    const ready = prepareEstateGroundDetail(groundHeight).then((value) => {
      complete = true;
      return value;
    });
    await idle.step();
    assert.equal(complete, false, "one task cannot build all of the grass");
    await idle.flush();
    detail = await ready;
    assert.ok(idle.slices.length > 3, `${idle.slices.length} cooperative tasks`);
    assert.ok(
      Math.max(...idle.slices) < 50,
      `no long task (${Math.max(...idle.slices).toFixed(1)} ms)`,
    );
    const direct = createEstateGroundDetail(groundHeight);
    try {
      for (const name of ["position", "normal", "color", "aGrass"])
        assert.deepEqual(
          detail.mesh.geometry.attributes[name].array,
          direct.mesh.geometry.attributes[name].array,
          name,
        );
      assert.deepEqual(detail.mesh.geometry.index.array, direct.mesh.geometry.index.array);
      assert.deepEqual(detail.mesh.geometry.boundingSphere, direct.mesh.geometry.boundingSphere);
      detail.setActive(true);
      direct.setActive(true);
      for (const tier of ["balanced", "high"])
        for (const each of [detail, direct]) {
          each.applyQuality({ tier });
          assert.equal(each.mesh.geometry.drawRange.count, tier === "high" ? 145350 : 57294);
        }
    } finally {
      direct.dispose();
    }
  } finally {
    detail?.dispose();
    idle.restore();
  }
});

test("environment prepares once while detached and activates the ready grass at the current tier", async () => {
  const idle = grassIdleTasks(),
    parent = new Group(),
    environment = createSceneEnvironment({ parent, groundHeight, profile });
  try {
    const first = environment.prepareFilmDetail(),
      second = environment.prepareFilmDetail();
    assert.equal(first, second, "parallel callers share preparation");
    environment.applyQuality({ tier: "balanced" });
    await idle.flush();
    const prepared = await first;
    assert.equal(prepared.mesh.parent, null);
    assert.equal(prepared.mesh.visible, false);
    assert.equal(environment.root.children.length, 0);
    environment.setFilmTreatment(true);
    assert.equal(environment.root.children.length, 1);
    assert.equal(
      environment.root.children[0],
      prepared.mesh,
      "activation reuses the prepared geometry",
    );
    assert.equal(prepared.mesh.geometry.drawRange.count, 57294);
    assert.equal(prepared.mesh.visible, true);
    environment.setFilmTreatment(false);
    environment.setFilmTreatment(true);
    assert.equal(environment.root.children[0], prepared.mesh);
    let freed = 0;
    prepared.mesh.geometry.addEventListener("dispose", () => freed++);
    environment.dispose();
    environment.dispose();
    assert.equal(freed, 1);
  } finally {
    environment.dispose();
    idle.restore();
  }
});

test("pending grass activation and disposal never duplicate or leak the detached build", async () => {
  for (const cancel of [false, true]) {
    const idle = grassIdleTasks(),
      environment = createSceneEnvironment({ parent: new Group(), groundHeight, profile });
    const original = BufferGeometry.prototype.setAttribute;
    let geometry = null,
      freed = 0;
    BufferGeometry.prototype.setAttribute = function (name, attribute) {
      if (name === "position" && attribute.count === 64600) {
        geometry = this;
        this.addEventListener("dispose", () => freed++);
      }
      return original.call(this, name, attribute);
    };
    try {
      const ready = environment.prepareFilmDetail();
      environment.setFilmTreatment(true);
      assert.equal(environment.root.children.length, 0, "no synchronous duplicate while pending");
      for (let steps = 0; !geometry && steps < 1000; steps++) await idle.step();
      assert.ok(geometry, "a partial detached geometry has been allocated");
      if (cancel) environment.dispose();
      await idle.flush();
      const result = await ready;
      assert.equal(result === null, cancel);
      assert.equal(environment.root.children.length, cancel ? 0 : 1);
      if (!cancel) assert.equal(environment.root.children[0].geometry, geometry);
      environment.dispose();
      assert.equal(freed, 1);
    } finally {
      BufferGeometry.prototype.setAttribute = original;
      environment.dispose();
      idle.restore();
    }
  }
});

test("estate growth retains the authored seeded buffers and tier cuts", () => {
  const detail = createEstateGroundDetail(groundHeight),
    geometry = detail.mesh.geometry;
  try {
    // Pin the reviewed stream's growth keepout, including all geometry,
    // shading and wind data, not only the silhouette.
    const expected = {
      position: "30aad87d1170e502c28d41ef80ec8f6693737bc0c230689153c23384ce3a8024",
      color: "08d589a31fbffdc7d1f686122d6dac6a68193e3250c203c248e9b446a8f081ed",
      aGrass: "5db2d72b76cee36f62d752a1139ea6c1a12e33fc33dcf0d62707b0b69395d704",
      normal: "5224220376bb8c7b6c2d7e7efb4baa5c9d13f11e5339fba786f62ac9cf9fa7f7",
      index: "17c887e93b15d5c63dbbfc35e503a5fa1a3338ffd8fbd04b17dbf82db93363dc",
    };
    assert.equal(geometry.attributes.position.count, 64600);
    assert.equal(geometry.index.count, 145350);
    assert.ok(geometry.index.array instanceof Uint16Array);
    for (const [name, hash] of Object.entries(expected)) {
      const { array } = name === "index" ? geometry.index : geometry.attributes[name];
      const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
      assert.equal(createHash("sha256").update(bytes).digest("hex"), hash, name);
      assert.equal(array.buffer.byteLength, array.byteLength, `${name} keeps no unused capacity`);
    }
    detail.setActive(true);
    assert.equal(geometry.drawRange.count, 145350);
    detail.applyQuality({ tier: "balanced" });
    assert.equal(geometry.drawRange.count, 57294);
    detail.applyQuality({ tier: "high" });
    assert.equal(geometry.drawRange.count, 145350);
  } finally {
    detail.dispose();
  }
});

test("estate growth is seeded, terrain-seated and clear of both footprints and the winding approach", () => {
  const a = createEstateGroundDetail(groundHeight),
    b = createEstateGroundDetail(groundHeight);
  const keepouts = rockKeepouts();
  const p = a.mesh.geometry.attributes.position,
    q = b.mesh.geometry.attributes.position,
    grass = a.mesh.geometry.attributes.aGrass;
  assert.deepEqual(p.array, q.array);
  assert.equal(a.mesh.geometry.userData.bladeVertices, BLADE_VERTICES);
  assert.equal(p.count % BLADE_VERTICES, 0);
  const blades = p.count / BLADE_VERTICES;
  // Every clump: GROWTH.blades[0] to [1] blades.
  assert.ok(blades >= GROWTH.tufts * GROWTH.blades[0] && blades <= GROWTH.tufts * GROWTH.blades[1]);
  // A blade's foot may stand a little off its clump's centre.
  const slack = GROWTH.size[1] * 1.25 * 0.05;
  for (let i = 0; i < p.count; i += BLADE_VERTICES) {
    const x = (p.getX(i) + p.getX(i + 1)) / 2,
      z = (p.getZ(i) + p.getZ(i + 1)) / 2;
    assert.ok(Math.abs(p.getY(i) - groundHeight(x, z) + 0.018) < 0.02);
    assert.ok(Math.hypot(x, z) > 10.4 - slack);
    assert.ok(Math.hypot(x - 55.1, z - 36.1) > 5.8 - slack);
    assert.ok(estatePathDistance(x, z) > 2.09 - slack);
    // It rises to its tip, which sways and its foot never does.
    assert.ok(p.getY(i + BLADE_VERTICES - 1) > p.getY(i));
    assert.equal(grass.getX(i), 0);
    assert.ok(grass.getX(i + BLADE_VERTICES - 1) > 0);
    // No tuft stands in a scattered rock or the ring its pebble may take.
    for (const rock of keepouts)
      assert.ok(Math.hypot(x - rock.x, z - rock.z) >= rock.radius - slack);
  }
  assert.equal(a.mesh.material.transparent, false);
  assert.equal(a.mesh.receiveShadow, true);
  // Growth dissolves with the ground it stands on in the tour's staggered cut.
  assert.match(a.mesh.material.customProgramCacheKey(), /\|depth-layer-0\.6667$/);
  const shader = {
    uniforms: {},
    vertexShader: "#include <common>\n#include <begin_vertex>",
    fragmentShader:
      "#include <common>\n#include <normal_fragment_begin>\n#include <dithering_fragment>\n}",
  };
  a.mesh.material.onBeforeCompile(shader);
  assert.ok(
    shader.fragmentShader.endsWith("#include <dithering_fragment>\ngl_FragColor.a = 0.6667;\n}"),
  );
  assert.match(shader.vertexShader, /attribute vec2 aGrass;[^]*transformed\.xz \+= aGrass\.x/);
  assert.equal(shader.uniforms.grassTime, a.mesh.material.userData.grassTime);
  a.dispose();
  b.dispose();
});

test("the grass stays within its triangle budget on each tier and out of the water", () => {
  const detail = createEstateGroundDetail(groundHeight),
    geometry = detail.mesh.geometry,
    p = geometry.attributes.position;
  detail.setActive(true);
  assert.ok(geometry.drawRange.count / 3 < 50000, `${geometry.drawRange.count / 3} on high`);
  detail.applyQuality({ tier: "balanced" });
  assert.ok(geometry.drawRange.count / 3 < 20000, `${geometry.drawRange.count / 3} on balanced`);
  for (let i = 0; i < p.count; i += BLADE_VERTICES) {
    const x = (p.getX(i) + p.getX(i + 1)) / 2,
      z = (p.getZ(i) + p.getZ(i + 1)) / 2;
    assert.ok(streamDistance(x, z) > -0.05, `a blade stands in a stream at ${x},${z}`);
  }
  detail.dispose();
});

test("balanced trims the fine litter only at whole pieces", () => {
  const detail = createEstateGroundDetail(groundHeight),
    // Leaves (24 vertices) and domes (54) alternating from vertex 100.
    pieces = [100];
  for (let k = 1; k < 10; k++) pieces.push(pieces[k - 1] + (k % 2 ? 24 : 54));
  const end = pieces.at(-1) + 24,
    litter = new Mesh(new BufferGeometry());
  litter.geometry.userData.fine = [100, end];
  litter.geometry.userData.finePieces = pieces;
  detail.mesh.add(litter);
  detail.setActive(true);
  assert.equal(litter.geometry.drawRange.count, end);
  detail.applyQuality({ tier: "balanced" });
  assert.equal(litter.geometry.drawRange.count, pieces[Math.floor(10 * GROWTH.balanced)]);
  detail.applyQuality({ tier: "high" });
  assert.equal(litter.geometry.drawRange.count, end);
  detail.dispose();
});

test("a shot's grassInside reads the grass's colour inside its blades, and at 0 nothing changes", () => {
  const detail = createEstateGroundDetail(groundHeight),
    material = detail.mesh.material;
  const shader = {
    uniforms: {},
    vertexShader: "#include <common>\n#include <color_vertex>\n#include <begin_vertex>",
    fragmentShader:
      "#include <common>\n#include <color_fragment>\n#include <normal_fragment_begin>\n#include <dithering_fragment>\n}",
  };
  material.onBeforeCompile(shader);
  // The mood's shared uniform, off unless a shot asks for it.
  assert.equal(shader.uniforms.grassInside, GRASS_MOOD);
  assert.equal(GRASS_MOOD.value, 0);
  // A centroid copy of the vertex colour, only where GLSL 3 has centroid
  // (WebGL2, where the film is multisampled), taken after color_vertex sets it.
  const centroid = /#if __VERSION__ >= 300\ncentroid varying vec3 vGrassColor;\n#endif/;
  assert.match(shader.vertexShader, centroid);
  assert.match(shader.fragmentShader, centroid);
  assert.match(
    shader.vertexShader,
    /#include <color_vertex>\n#include <begin_vertex>[^]*vGrassColor = vColor;/,
  );
  // three's own colour stays, so at 0 the blade reads exactly as before; the
  // mood's share replaces it with the colour inside the blade.
  assert.match(
    shader.fragmentShader,
    /uniform float grassInside;[^]*vec3 grassBase = diffuseColor\.rgb;\n#include <color_fragment>\n#if __VERSION__ >= 300\nif \(grassInside > 0\.0\) diffuseColor\.rgb = grassBase\*mix\(vColor, vGrassColor, grassInside\);\n#endif\n#include <normal_fragment_begin>/,
  );
  // Every growth material shares the one mood.
  const other = createEstateGroundDetail(groundHeight),
    second = { uniforms: {}, vertexShader: "", fragmentShader: "" };
  other.mesh.material.onBeforeCompile(second);
  assert.equal(second.uniforms.grassInside, GRASS_MOOD);
  detail.dispose();
  other.dispose();
});

test("the grass's wind runs with drawn frames and holds while motion is held", () => {
  const detail = createEstateGroundDetail(groundHeight),
    time = detail.mesh.material.userData.grassTime;
  assert.equal(detail.update({ deltaSeconds: 0.5 }), false);
  assert.equal(time.value, 0);
  detail.setActive(true);
  detail.update({ deltaSeconds: 0.05 });
  detail.update({ deltaSeconds: 5 });
  assert.ok(Math.abs(time.value - 0.15) < 1e-9);
  detail.update({ deltaSeconds: 0.05, reducedMotion: true });
  detail.update({ deltaSeconds: 0.05, motionPaused: true });
  assert.ok(Math.abs(time.value - 0.15) < 1e-9);
  detail.dispose();
});

test("ground-detail quality changes trim a shared geometry and restore original world positions", () => {
  const detail = createEstateGroundDetail(groundHeight),
    mesh = detail.mesh;
  const original = mesh.geometry.attributes.position.array.slice(),
    indices = mesh.geometry.index.count;
  assert.equal(mesh.visible, false);
  detail.setActive(true);
  assert.equal(mesh.geometry.drawRange.count, indices);
  detail.applyQuality({ tier: "balanced" });
  const share = mesh.geometry.drawRange.count / indices;
  assert.ok(share > GROWTH.balanced - 0.05 && share < GROWTH.balanced + 0.05, `${share}`);
  assert.equal(mesh.geometry.drawRange.count % 6, 0);
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
