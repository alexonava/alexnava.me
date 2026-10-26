import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { build as bundle } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  ShaderLib,
  Vector3,
} from "three";
import { createTreeArchitecture } from "../src/scene/architecture.js";
import { createCinematicCamera, cinematicSafeArea } from "../src/scene/cinematic.js";
import { DIRECTED_SHOTS, measureShot } from "../src/scene/directed-shots.js";
import {
  createEstateGroundDetail,
  grassMaterial,
  GROWTH,
} from "../src/scene/estate-ground-detail.js";
import { ESTATE, estatePathDistance } from "../src/scene/estate-layout.js";
import { createFilmScene } from "../src/scene/film-scene.js";
import { configureGroundShading } from "../src/scene/mud-ground.js";
import {
  FOREGROUND,
  foregroundChunkSteps,
  foregroundCoverageSteps,
  foregroundPlacement,
  prepareForegroundDetail,
} from "../src/scene/foreground-detail.js";
import { COAST_SHOTS, coastDistance, coastShot, FALLS, SPRAY_FIT } from "../src/scene/ocean.js";
import { watchMeasure } from "../src/scene/opening-star.js";
import { rockKeepouts } from "../src/scene/rock-scatter.js";
import {
  coastBedrockWeight,
  createEarthGeometry,
  LANTERN_FOOT,
  loosePebbleBurial,
  PUDDLE_ZONES,
  ROOT_LATTICE,
  rootCovered,
  rootOcclusion,
  scatterBanks,
  scatterLitter,
  streamRadius,
  terrainHeight,
  TREE_FOOTING,
  TRUNK,
  zoneDistance,
} from "../src/scene/terrain-build.js";
import { glbAsset, modelBytes } from "./support/glb.mjs";

const helpers = {
  createCinematicCamera,
  cinematicSafeArea,
  DIRECTED_SHOTS,
  measureShot,
  watchMeasure,
  grassMaterial,
  GROWTH,
  ESTATE,
  estatePathDistance,
  rockKeepouts,
  coastDistance,
  FALLS,
  SPRAY_FIT,
  coastBedrockWeight,
  LANTERN_FOOT,
  loosePebbleBurial,
  ROOT_LATTICE,
  rootCovered,
  rootOcclusion,
  PUDDLE_ZONES,
  streamRadius,
  TREE_FOOTING,
  TRUNK,
  zoneDistance,
};
const openHelpers = {
  ...helpers,
  estatePathDistance: () => 100,
  coastDistance: () => 100,
  rockKeepouts: () => [],
  rootCovered: () => false,
  rootOcclusion: () => [0, 0],
  PUDDLE_ZONES: [],
  streamRadius: () => 100,
  coastBedrockWeight: () => 0,
  LANTERN_FOOT: { x: 1000, z: 1000 },
};
function finish(steps) {
  for (;;) {
    const next = steps.next();
    if (next.done) return next.value;
  }
}
function digest(geometry) {
  const hash = createHash("sha256");
  for (const attribute of [...Object.values(geometry.attributes), geometry.index])
    if (attribute)
      hash.update(
        Buffer.from(attribute.array.buffer, attribute.array.byteOffset, attribute.array.byteLength),
      );
  return hash.digest("hex");
}
function baseGround() {
  const window = {};
  Function(
    "window",
    readFileSync(new URL("../src/scene/helpers.js", import.meta.url), "utf8"),
  )(window);
  return window.BabelSite.scene.groundHeight;
}
const flat = () => 0;
const openPlacement = foregroundPlacement({ surface: flat, helpers: openHelpers });
const build = (tile = { x: 2, z: 1 }, extra = {}) =>
  finish(
    foregroundChunkSteps(tile, {
      surface: flat,
      placement: openPlacement,
      helpers: openHelpers,
      ...extra,
    }),
  );
const tile = (x, z) => ({
  x,
  z,
  views: new Map(),
  box: new Box3(
    new Vector3(x * 8 - 0.6, -0.1, z * 8 - 0.6),
    new Vector3((x + 1) * 8 + 0.6, 0.8, (z + 1) * 8 + 0.6),
  ),
});
function lens(x = 20, z = 16) {
  const camera = new PerspectiveCamera(65, 1.7, 0.1, 200);
  camera.position.set(x, 5, z);
  camera.lookAt(x, 0, z - 10);
  camera.updateMatrixWorld(true);
  return camera;
}
async function flush(field, frame, predicate = () => field.state.pendingChunks === 0) {
  for (let i = 0; i < 500; i++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    field.update(frame);
    if (predicate()) return;
  }
  assert.fail("foreground idle work did not settle");
}
async function fieldFor(tiles, extra = {}) {
  const root = new Group();
  const field = await prepareForegroundDetail({
    root,
    surface: flat,
    helpers: openHelpers,
    coverage: { tiles, shots: [], poses: 1 },
    ...extra,
  });
  root.add(field.group);
  return field;
}

test("foreground pieces are deterministic, smooth, finite and nondegenerate; balanced keeps whole seeded pieces", () => {
  const a = build(),
    b = build(),
    data = a.userData.foreground;
  try {
    assert.equal(digest(a), digest(b));
    assert.ok(data.pieces.length > 250);
    assert.deepEqual(new Set(data.pieces.map((piece) => piece.kind)), new Set([0, 1, 2, 3, 4]));
    assert.ok(data.balancedTriangles > 0 && data.balancedTriangles < data.highTriangles);
    assert.ok(data.bytes < 2 * 1024 * 1024);
    let last = 0;
    const p = a.attributes.position,
      n = a.attributes.normal,
      ids = a.index.array;
    const u = new Vector3(),
      v = new Vector3(),
      w = new Vector3();
    for (const piece of data.pieces) {
      assert.equal(piece.first, last);
      last += piece.count;
      assert.equal(piece.quality < FOREGROUND.balanced, piece.first < data.balanced);
      for (let k = piece.first; k < last; k += 3) {
        u.fromBufferAttribute(p, ids[k]);
        v.fromBufferAttribute(p, ids[k + 1]);
        w.fromBufferAttribute(p, ids[k + 2]);
        v.sub(u);
        w.sub(u);
        v.cross(w);
        assert.ok(v.lengthSq() > 1e-18, `kind ${piece.kind} has no collapsed face`);
        if (piece.kind < 4) assert.ok(v.y > 0, `kind ${piece.kind} faces upward`);
      }
    }
    for (let i = 0; i < p.count; i++) {
      assert.ok(Number.isFinite(p.getX(i) + p.getY(i) + p.getZ(i)));
      assert.ok(Math.abs(Math.hypot(n.getX(i), n.getY(i), n.getZ(i)) - 1) < 1e-6);
    }
  } finally {
    a.dispose();
    b.dispose();
  }
});

test("loose grit and pebbles keep their placements and random stream while varied caps enter the soil", () => {
  const seated = build(),
    reference = build(undefined, { helpers: { ...openHelpers, loosePebbleBurial: () => 0 } });
  try {
    const p = seated.attributes.position,
      old = reference.attributes.position;
    assert.equal(p.count, old.count);
    assert.deepEqual(seated.index.array, reference.index.array);
    assert.deepEqual(seated.userData.foreground.pieces, reference.userData.foreground.pieces);
    for (const name of ["normal", "color", "aGrass", "aForeground", "aForegroundRange"])
      assert.deepEqual(seated.attributes[name].array, reference.attributes[name].array, name);
    const exposure = [];
    for (const piece of seated.userData.foreground.pieces) {
      const ids = new Set(seated.index.array.slice(piece.first, piece.first + piece.count));
      const height = Math.max(...[...ids].map((i) => old.getY(i)));
      const fraction =
        piece.kind < 2 ? loosePebbleBurial(piece.center[0], piece.center[2], piece.kind) : 0;
      for (const i of ids) {
        assert.equal(p.getX(i), old.getX(i));
        assert.equal(p.getZ(i), old.getZ(i));
        assert.ok(
          Math.abs(p.getY(i) - (old.getY(i) - height * fraction)) < 1e-7,
          "only the expected vertical seating changes",
        );
      }
      if (piece.kind < 2) {
        const top = Math.max(...[...ids].map((i) => p.getY(i))),
          bottom = Math.min(...[...ids].map((i) => p.getY(i)));
        assert.ok(bottom < 0 && top > 0, "the base enters soil and its cap stays exposed");
        exposure.push(top / height);
      }
    }
    assert.ok(Math.min(...exposure) >= 0.4 - 1e-6 && Math.max(...exposure) <= 0.85 + 1e-6);
    assert.ok(
      Math.max(...exposure) - Math.min(...exposure) > 0.4,
      "the pieces have visibly varied exposure",
    );
    assert.notEqual(loosePebbleBurial(20.1, 10.3, 0), loosePebbleBurial(20.1, 10.3, 1));
  } finally {
    seated.dispose();
    reference.dispose();
  }
});

test("legacy fine grit uses the same burial helper while hero stones, clods, leaves and bank gravel retain their geometry", async () => {
  // Build a reference with only the pure burial helper disabled. Its original
  // placement/RNG code remains intact, so an extra draw or reordered candidate
  // would change the full XZ/colour/topology comparison below.
  const source = readFileSync(new URL("../src/scene/terrain-build.js", import.meta.url), "utf8");
  const start = source.indexOf("export function loosePebbleBurial("),
    end = source.indexOf("\n}", start) + 2;
  assert.ok(start > 0 && end > start);
  const referenceSource =
    source.slice(0, start) +
    "export function loosePebbleBurial() { return 0; }" +
    source.slice(end);
  const compiled = await bundle({
    stdin: {
      contents: referenceSource,
      resolveDir: path.dirname(
        fileURLToPath(new URL("../src/scene/terrain-build.js", import.meta.url)),
      ),
      sourcefile: "terrain-without-burial.js",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    logLevel: "silent",
  });
  const referenceModule = await import(
    `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`
  );
  const color = { r: 0.36, g: 0.31, b: 0.28 },
    seated = scatterLitter(flat, color),
    reference = referenceModule.scatterLitter(flat, color);
  try {
    const p = seated.attributes.position,
      old = reference.attributes.position,
      pieces = seated.userData.finePieces;
    assert.deepEqual(seated.userData, reference.userData);
    assert.equal(p.count, old.count);
    for (const name of ["normal", "color", "aGrass"])
      assert.deepEqual(seated.attributes[name].array, reference.attributes[name].array, name);
    let changed = 0,
      min = Infinity,
      max = -Infinity;
    for (let i = 0; i < p.count; i++) {
      assert.equal(p.getX(i), old.getX(i));
      assert.equal(p.getZ(i), old.getZ(i));
      if (i < seated.userData.fine[0])
        assert.equal(p.getY(i), old.getY(i), "authored hero litter and stones stay fixed");
    }
    pieces.forEach((first, k) => {
      const end = pieces[k + 1] ?? p.count,
        offset = old.getY(first) - p.getY(first);
      for (let i = first; i < end; i++)
        assert.ok(
          Math.abs(old.getY(i) - p.getY(i) - offset) < 1e-7,
          "a whole piece translates without distortion",
        );
      if (offset < 1e-7) return;
      changed++;
      let height = -Infinity,
        top = -Infinity,
        bottom = Infinity;
      for (let i = first; i < end; i++) {
        height = Math.max(height, old.getY(i));
        top = Math.max(top, p.getY(i));
        bottom = Math.min(bottom, p.getY(i));
      }
      assert.ok(bottom < 0 && top > 0);
      const fraction = offset / height;
      min = Math.min(min, fraction);
      max = Math.max(max, fraction);
      assert.ok(fraction >= 0.15 - 1e-5 && fraction <= 0.6 + 1e-5);
    });
    assert.equal(changed, 2000, "only the 2000 loose fine grains sink");
    assert.ok(min < 0.16 && max > 0.59);
    // The rounded bank gravel calls the shared dome emitter separately and
    // retains its positions, colours and counts when burial is disabled.
    const banks = scatterBanks(flat, color),
      oldBanks = referenceModule.scatterBanks(flat, color);
    try {
      assert.equal(digest(banks), digest(oldBanks));
      assert.deepEqual(banks.userData, oldBanks.userData);
    } finally {
      banks.dispose();
      oldBanks.dispose();
    }
  } finally {
    seated.dispose();
    reference.dispose();
  }
});

test("emitted footprint checks catch water and root cells entirely inside a piece", () => {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new BufferAttribute(new Float32Array([0, 0, 0, 0.1, 0, 0, 0, -0.1, 0]), 3),
  );
  geometry.setIndex([0, 1, 2]);
  geometry.userData.riverBedIndexCount = 0;
  const triangle = [
    [-0.2, -0.2],
    [0.4, -0.2],
    [-0.2, 0.4],
  ];
  try {
    const wet = foregroundPlacement({ surface: flat, terrain: geometry, helpers: openHelpers });
    assert.ok(triangle.every(([x, z]) => wet.pointAllowed(x, z)));
    assert.equal(wet.triangleAllowed(triangle), false);
    const rooted = foregroundPlacement({
      surface: flat,
      helpers: {
        ...openHelpers,
        ROOT_LATTICE: { x: 0, z: 0 },
        rootCovered: (x, z) => Math.abs(x) < 0.01 && Math.abs(z) < 0.01,
      },
    });
    assert.ok(triangle.every(([x, z]) => rooted.pointAllowed(x, z)));
    assert.equal(rooted.triangleAllowed(triangle), false);
  } finally {
    geometry.dispose();
  }
});

test("foreground stays off whole legacy piece footprints and steep, wet or occupied ground", () => {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new BufferAttribute(new Float32Array([0, 0, 0, 0.1, 0, 0, 0, 0, 0.1]), 3),
  );
  geometry.userData.finePieces = [0];
  try {
    const existing = foregroundPlacement({
      surface: flat,
      helpers: openHelpers,
      legacy: [geometry],
    });
    assert.equal(
      existing.triangleAllowed([
        [-0.2, -0.2],
        [0.4, -0.2],
        [-0.2, 0.4],
      ]),
      false,
    );
    const steep = foregroundPlacement({ surface: (x) => x, helpers: openHelpers });
    assert.equal(steep.pointAllowed(20, 20), false);
    for (const override of [
      { coastDistance: () => 1.9 },
      { estatePathDistance: () => 2 },
      { streamRadius: () => 1 },
      { LANTERN_FOOT: { x: 20, z: 20 } },
      { rockKeepouts: () => [{ x: 20, z: 20, radius: 1 }] },
    ])
      assert.equal(
        foregroundPlacement({
          surface: flat,
          helpers: { ...openHelpers, ...override },
        }).pointAllowed(20, 20),
        false,
      );
  } finally {
    geometry.dispose();
  }
});

test("actual terrain buffers and the relocated river stay unchanged while rich pieces clear the rendered water", () => {
  const terrain = createEarthGeometry(baseGround()),
    before = digest(terrain),
    surface = terrainHeight(terrain),
    placement = foregroundPlacement({ surface, terrain, helpers });
  const chunks = [];
  try {
    for (const at of [
      { x: 6, z: 3 },
      { x: 5, z: 3 },
      { x: 4, z: 2 },
    ]) {
      const geometry = finish(foregroundChunkSteps(at, { surface, placement, helpers }));
      chunks.push(geometry);
      const p = geometry.attributes.position,
        ids = geometry.index.array;
      for (let k = 0; k < ids.length; k += 3)
        assert.ok(
          placement.triangleAllowed(
            [ids[k], ids[k + 1], ids[k + 2]].map((i) => [p.getX(i), p.getZ(i)]),
          ),
        );
    }
    assert.ok(
      chunks.reduce((n, geometry) => n + geometry.userData.foreground.pieces.length, 0) > 50,
    );
    assert.equal(digest(terrain), before);
    assert.equal(terrain.userData.riverBedIndexCount / 3, 74604);
    assert.equal((terrain.index.count - terrain.userData.riverBedIndexCount) / 3, 5888);
  } finally {
    chunks.forEach((geometry) => geometry.dispose());
    terrain.dispose();
  }
});

test("idle preparation invalidates a held frame, commits only at a safe frame, and recovers from low", async () => {
  let invalidations = 0;
  const field = await fieldFor([tile(2, 0), tile(2, 1)], { invalidate: () => invalidations++ });
  const frame = {
    camera: lens(),
    viewport: { width: 1600, height: 900 },
    profile: { tier: "high" },
    revealed: true,
    deltaSeconds: 1 / 60,
  };
  try {
    field.update(frame);
    assert.equal(field.state.preparedChunks, 0, "frame queues work without generating geometry");
    await flush(
      field,
      frame,
      () => field.state.preparedChunks === 2 && field.state.pendingChunks === 0,
    );
    assert.ok(invalidations >= 2);
    assert.equal(field.state.visibleBatches, 0, "new work waits for a cut");
    field.update({ ...frame, cut: true });
    assert.ok(field.state.visibleBatches > 0);
    field.update({ ...frame, profile: { tier: "low" } });
    assert.equal(field.group.visible, false);
    field.update(frame);
    assert.equal(field.group.visible, true);
    assert.ok(field.state.visibleBatches > 0);
    field.update({ ...frame, profile: { tier: "balanced" }, still: true });
    assert.ok(
      field.state.visibleBatches <= 6 &&
        field.state.visibleTriangles <= 64000 &&
        field.state.residentBytes <= 16 * 1024 * 1024,
    );
    for (const mesh of field.group.children)
      if (mesh.visible)
        assert.equal(mesh.geometry.drawRange.count, mesh.geometry.userData.foreground.balanced);
  } finally {
    assert.equal(field.dispose(), true);
    assert.equal(field.dispose(), false);
  }
});

test("committed chunks enter the frustum during a move without waiting for another cut", async () => {
  const field = await fieldFor([tile(2, 0), tile(7, 0)]),
    camera = lens(),
    frame = { camera, cut: true, profile: { tier: "high" }, revealed: true, deltaSeconds: 1 / 60 };
  try {
    field.update(frame);
    await flush(field, frame, () => field.state.preparedChunks >= 1);
    camera.position.x = 60;
    camera.lookAt(60, 0, 0);
    field.update(frame);
    await flush(field, frame, () => field.state.preparedChunks === 2);
    // Commit both ready chunks, even though the first is out of frame.
    field.update(frame);
    const first = field.group.children.find((mesh) => mesh.name === "foreground-2:0");
    assert.ok(first);
    camera.position.x = 20;
    camera.lookAt(20, 0, 0);
    field.update({ ...frame, cut: false });
    assert.equal(first.visible, true);
  } finally {
    field.dispose();
  }
});

test("hidden opening preparation publishes its whole finite move cohort before the first visible hold", async () => {
  const field = await fieldFor([tile(2, 0), tile(7, 0)]),
    camera = lens(),
    frame = { camera, profile: { tier: "high" }, revealed: false, preparing: true };
  try {
    const ready = field.prepareOpening(frame);
    await flush(field, frame, () => field.state.openingStatus === "ready");
    assert.equal(await ready, true);
    assert.equal(field.state.preparedChunks, 2);
    const geometries = field.group.children.map((mesh) => mesh.geometry);
    for (let step = 0; step <= 60; step++) {
      camera.position.x = 20 + (step * 2) / 3;
      camera.lookAt(camera.position.x, 0, 0);
      field.update({ ...frame, revealed: true, preparing: false, deltaSeconds: 0.1 });
      assert.equal(field.state.pendingChunks, 0);
      assert.ok(field.state.visibleBatches <= 12);
    }
    assert.deepEqual(
      field.group.children.map((mesh) => mesh.geometry),
      geometries,
    );
  } finally {
    field.dispose();
  }
});

test("disposing an opening cohort settles its readiness without publishing a stale redraw", async () => {
  const saved = globalThis.requestIdleCallback,
    idle = [];
  globalThis.requestIdleCallback = (task) => idle.push(task);
  let invalidations = 0;
  const field = await fieldFor([tile(2, 0)], { invalidate: () => invalidations++ });
  try {
    const ready = field.prepareOpening({ camera: lens(), revealed: false });
    field.dispose();
    while (idle.length) {
      idle.shift()({ didTimeout: true, timeRemaining: () => 0 });
      await Promise.resolve();
    }
    assert.equal(await ready, false);
    assert.equal(invalidations, 0);
  } finally {
    field.dispose();
    globalThis.requestIdleCallback = saved;
  }
});

test("hidden preparation reports actual generator progress rather than frames or elapsed time", async () => {
  const frame = { camera: lens(), preparing: true, revealed: false, profile: { tier: "high" } },
    rendering = {
      renderer: { domElement: { parentNode: { classList: { contains: () => false } } } },
    },
    field = await fieldFor([tile(2, 0)], { openingFrame: frame, rendering });
  try {
    const ready = field.prepareOpening(frame);
    await flush(field, frame, () => field.state.openingStatus === "ready");
    assert.equal(await ready, true);
    assert.ok(rendering.openingProgress > 0);
    const completed = rendering.openingProgress;
    for (let n = 0; n < 10; n++) field.update({ ...frame, deltaSeconds: 100 });
    assert.equal(rendering.openingProgress, completed, "waiting/held frames add no work progress");
  } finally {
    field.dispose();
  }
});

test("compiler polling restores the target immediately and a failed optional program stays hidden", async () => {
  let settle,
    current = "home",
    invalidations = 0;
  const pending = new Promise((resolve) => (settle = resolve));
  const rendering = {
    renderer: {
      extensions: { has: () => true },
      getRenderTarget: () => current,
      setRenderTarget: (value) => (current = value),
    },
    composer: { readBuffer: "film" },
    compilePrograms() {
      assert.equal(current, "film");
      return pending;
    },
  };
  const field = await fieldFor([tile(2, 0)], { rendering, invalidate: () => invalidations++ });
  const frame = { camera: lens(), still: true };
  try {
    field.update(frame);
    await flush(field, frame, () => field.state.preparedChunks === 1);
    assert.equal(current, "home");
    assert.equal(field.state.visibleBatches, 0);
    settle(false);
    await flush(field, frame, () => field.state.failed);
    assert.equal(field.group.visible, false);
    assert.ok(invalidations > 0);
  } finally {
    field.dispose();
  }
});

test("foreground shader preserves the authored lighting hooks and fades complete pieces", async () => {
  const clock = { value: 7 },
    field = await fieldFor([tile(2, 0)], { windTime: clock });
  const frame = { camera: lens(), still: true, deltaSeconds: 0.1 };
  try {
    field.update(frame);
    await flush(field, frame, () => field.state.preparedChunks === 1);
    const mesh = field.group.children[0],
      shader = {
        uniforms: {},
        vertexShader: ShaderLib.lambert.vertexShader,
        fragmentShader: ShaderLib.lambert.fragmentShader,
      };
    mesh.material.onBeforeCompile(shader);
    mesh.onBeforeRender();
    assert.equal(shader.uniforms.grassTime, clock);
    assert.equal(shader.uniforms.foregroundChunkFade.value, 1);
    assert.match(
      shader.vertexShader,
      /transformed=aForeground.xyz\+\(transformed-aForeground.xyz\)\*foregroundKeep/,
    );
    assert.match(shader.vertexShader, /smoothstep\(\.75,1.5,foregroundPixels\)/);
    assert.match(shader.fragmentShader, /RE_Direct_Grass/);
    assert.equal(mesh.castShadow, false);
    assert.equal(mesh.receiveShadow, true);
    assert.equal(mesh.material.transparent, false);
    assert.equal(clock.value, 7, "the borrowed wind clock is not advanced twice");
  } finally {
    field.dispose();
  }
});

test("moving finite fields retain draw, triangle and resident limits through quality changes", async () => {
  const tiles = [];
  for (let x = -4; x <= 12; x++) for (let z = -3; z <= 1; z++) tiles.push(tile(x, z));
  const field = await fieldFor(tiles),
    camera = lens(),
    frame = { camera, still: true, profile: { tier: "high" }, deltaSeconds: 1 / 60 };
  const check = (tier) => {
    const visible = field.group.children.filter((mesh) => mesh.visible);
    const triangles = visible.reduce((n, mesh) => n + mesh.geometry.drawRange.count / 3, 0);
    assert.ok(visible.length <= FOREGROUND.batches[tier]);
    assert.ok(triangles <= FOREGROUND.triangles[tier]);
    assert.ok(field.state.residentBytes <= FOREGROUND.bytes[tier]);
    assert.equal(field.state.visibleTriangles, triangles);
  };
  try {
    for (const x of [-16, 16, 48, 80]) {
      camera.position.set(x, 5, 12);
      camera.lookAt(x, 0, -10);
      field.update(frame);
      await flush(field, frame);
      check("high");
      for (let tick = 0; tick < 40; tick++) {
        camera.position.x += 0.04;
        camera.lookAt(camera.position.x, 0, -10);
        field.update({ ...frame, still: false });
        check("high");
      }
    }
    field.update({ ...frame, profile: { tier: "balanced" } });
    check("balanced");
    assert.ok(field.state.preparedChunks > 28, "the sweep exercises cache eviction");
  } finally {
    field.dispose();
  }
});

test("idle work pauses at low and disposal cancels queued generation without invalidation", async () => {
  const saved = globalThis.requestIdleCallback,
    callbacks = [];
  globalThis.requestIdleCallback = (callback) => callbacks.push(callback);
  let invalidations = 0;
  const field = await fieldFor([tile(2, 0), tile(2, 1)], { invalidate: () => invalidations++ });
  const frame = { camera: lens(), still: true, profile: { tier: "high" } };
  try {
    field.update(frame);
    assert.equal(callbacks.length, 1);
    field.update({ ...frame, profile: { tier: "low" } });
    while (callbacks.length) {
      callbacks.shift()({ didTimeout: false, timeRemaining: () => 20 });
      await Promise.resolve();
    }
    assert.equal(field.state.preparedChunks, 0);
    assert.equal(field.group.children.length, 0);
    field.update(frame);
    assert.equal(callbacks.length, 1);
    field.dispose();
    while (callbacks.length) {
      callbacks.shift()({ didTimeout: false, timeRemaining: () => 20 });
      await Promise.resolve();
    }
    assert.equal(field.group.children.length, 0);
    assert.equal(invalidations, 0);
  } finally {
    field.dispose();
    globalThis.requestIdleCallback = saved;
  }
});

test("disposal during compiler polling frees each owned resource once and never publishes stale work", async () => {
  let settle,
    valid,
    invalidations = 0;
  const pending = new Promise((resolve) => (settle = resolve));
  const rendering = {
    renderer: {
      extensions: { has: () => true },
      getRenderTarget: () => null,
      setRenderTarget() {},
    },
    compilePrograms(_renderer, _mesh, _camera, _scene, current) {
      valid = current;
      return pending;
    },
  };
  const field = await fieldFor([tile(2, 0)], { rendering, invalidate: () => invalidations++ }),
    frame = { camera: lens(), still: true };
  field.update(frame);
  await flush(field, frame, () => field.state.preparedChunks === 1);
  const mesh = field.group.children[0];
  let geometries = 0,
    materials = 0;
  mesh.geometry.addEventListener("dispose", () => geometries++);
  mesh.material.addEventListener("dispose", () => materials++);
  assert.equal(valid(), true);
  field.dispose();
  assert.equal(valid(), false);
  settle(false);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(geometries, 1);
  assert.equal(materials, 1);
  assert.equal(invalidations, 0);
  assert.equal(field.group.children.length, 0);
});

test("finite camera envelopes include all eight authored shots and layouts without moving the subject", async () => {
  const base = baseGround(),
    tree = createTreeArchitecture({
      asset: glbAsset(modelBytes("tree", "high")),
      groundHeight: base,
      anchor: [55.1, 36.1],
    }),
    root = new Group();
  root.position.y = -6.8;
  root.add(tree.root);
  root.updateMatrixWorld(true);
  const matrix = tree.root.matrixWorld.clone(),
    original = DIRECTED_SHOTS.tree.length;
  DIRECTED_SHOTS.tree.push(...COAST_SHOTS.map((shot) => coastShot(shot, root)));
  try {
    const started = performance.now(),
      coverage = finish(foregroundCoverageSteps({ root, surface: base, helpers }));
    assert.equal(coverage.poses, 8 * 8 * 5);
    assert.equal(coverage.shots.length, 8);
    assert.ok(coverage.tiles.length > 40 && coverage.tiles.length < 1200);
    for (const [width, height] of FOREGROUND.layouts)
      for (const name of coverage.shots) {
        const view = `${width}:${height}:${name}`;
        assert.ok(Object.hasOwn(coverage.views, view), `${view} was measured`);
        if (name !== "The watch" && name !== "Close-up")
          assert.ok(
            coverage.tiles.some((tile) => tile.views.has(view)),
            `${view} has ground coverage`,
          );
      }
    assert.deepEqual(tree.root.matrixWorld.elements, matrix.elements);
    assert.ok(performance.now() - started < 15000, "finite coverage is bounded CPU work");
  } finally {
    DIRECTED_SHOTS.tree.splice(original);
    tree.dispose();
  }
});

test("a narrow visible ground sliver between the nine coverage probes still admits its tile", () => {
  const root = new Group(),
    tree = new Group();
  tree.name = "supplied-meshy-tree";
  root.add(tree);
  let camera;
  const preview = {
    setSubject() {},
    setStatus() {},
    setPreviewShot() {},
    prepare: () => "ready",
    apply() {
      camera.position.set(0.6, 2, 0.6);
      camera.up.set(0, 0, -1);
      camera.lookAt(0.6, 0, 0.6);
      camera.fov = 6;
      camera.aspect = 1;
      camera.updateProjectionMatrix();
    },
    dispose() {},
  };
  const coverage = finish(
    foregroundCoverageSteps({
      root,
      surface: flat,
      shots: [{ name: "Ground sliver" }],
      layouts: [[1000, 1000]],
      helpers: {
        ...openHelpers,
        watchMeasure: undefined,
        createCinematicCamera(options) {
          camera = options.camera;
          return preview;
        },
      },
    }),
  );
  for (const x of [0, 4, 8])
    for (const z of [0, 4, 8]) {
      const p = new Vector3(x, 0, z).project(camera);
      assert.ok(Math.abs(p.x) >= 1.2 || Math.abs(p.y) >= 1.2);
    }
  const center = new Vector3(0.6, 0, 0.6).project(camera);
  assert.ok(Math.abs(center.x) < 1 && Math.abs(center.y) < 1);
  assert.ok(coverage.tiles.some((tile) => tile.x === 0 && tile.z === 0));
});

for (const tier of ["high", "balanced"])
  test(`${tier} live film owner prepares the complete lantern move and its physical ground while still hidden`, async () => {
    // Exercise both real ownership boundaries, rather than passing a duplicate
    // helper fixture straight into prepareForegroundDetail. Missing lexical
    // imports in settleRoots' async closure must fail this observable result.
    const base = baseGround(),
      root = new Group(),
      original = new PlaneGeometry(2, 2),
      material = new MeshStandardMaterial();
    configureGroundShading(material, true);
    const ground = new Mesh(original, material),
      growth = createEstateGroundDetail(base);
    const tree = createTreeArchitecture({
      asset: glbAsset(modelBytes("tree", tier)),
      groundHeight: base,
      anchor: [55.1, 36.1],
    });
    root.position.y = -6.8;
    root.add(ground, growth.mesh, tree.root);
    root.updateMatrixWorld(true);
    const camera = lens(LANTERN_FOOT.x - 3, LANTERN_FOOT.z - 5);
    const opener = createCinematicCamera({
      camera,
      selected: "tree",
      angle: 1,
      getSafeArea: cinematicSafeArea,
      getGroundY: (x, z) => base(x, z) - 6.8,
    });
    opener.setSubject("watch", new Group());
    opener.setSubject("tree", tree.root);
    opener.setStatus({ kind: "watch", status: "ready" });
    opener.setStatus({ kind: "tree", status: "ready" });
    opener.apply({ width: 1920, height: 1080, elapsedSeconds: 0, tourPhase: 0 });
    const rendering = {
      assetTier: tier,
      renderer: {
        domElement: { parentNode: { classList: { contains: () => false } } },
        extensions: { has: () => false },
        getContext: () => ({ isContextLost: () => false }),
        shadowMap: { enabled: false },
        getPixelRatio: () => 1,
      },
      homeScene: root,
      camera,
      composer: { readBuffer: null },
      setFilmTreatment() {},
    };
    const idle = [],
      animation = [],
      previousIdle = globalThis.requestIdleCallback,
      previousFrame = globalThis.requestAnimationFrame;
    globalThis.requestIdleCallback = (task) => idle.push(task);
    globalThis.requestAnimationFrame = (task) => animation.push(task);
    let invalidations = 0,
      field,
      openingResult,
      preparedHeight,
      disposedGeometry = null;
    const film = createFilmScene({
      ground,
      groundHeight: base,
      rendering,
      atmosphere: { setFilmTreatment() {} },
      skyMaterial: {
        uniforms: { sunColor: { value: new Color(0xffffff) }, uFilm: { value: 0 } },
        transparent: false,
      },
      invalidate: () => invalidations++,
    });
    const frame = {
      camera,
      viewport: { width: 1920, height: 1080 },
      profile: { tier },
      still: false,
      preparing: true,
      revealed: false,
      shot: "Lantern study",
      deltaSeconds: 1 / 60,
    };
    try {
      film.setActive(true);
      let prepared = false;
      film.ready.then((height) => {
        prepared = true;
        preparedHeight = height;
        void height.prepareOpening(frame).then((ready) => (openingResult = ready));
      });
      const deadline = performance.now() + 30000;
      while (performance.now() < deadline) {
        for (let n = 0; n < 8 && idle.length; n++)
          idle.shift()({ didTimeout: true, timeRemaining: () => 0 });
        for (const task of animation.splice(0)) task(performance.now());
        await new Promise((resolve) => setImmediate(resolve));
        film.update(frame);
        field = root.getObjectByName("estate-foreground-field");
        if (
          prepared &&
          openingResult &&
          field?.userData.foreground.preparedChunks > 0 &&
          field.userData.foreground.visibleBatches > 0
        )
          break;
      }
      assert.ok(prepared, "real film terrain and settleRoots completed");
      assert.equal(openingResult, true);
      assert.deepEqual(
        { ...preparedHeight.openingState },
        {
          terrain: true,
          details: true,
          foreground: true,
          failed: false,
          foregroundStatus: "ready",
        },
      );
      assert.ok(field, "settleRoots' real lazy import/provider closure added the field");
      assert.ok(field.userData.foreground.preparedChunks > 0, "actual terrain generated a chunk");
      assert.ok(
        field.userData.foreground.visibleBatches > 0,
        "the hidden opener published its complete cohort",
      );
      assert.equal(field.userData.foreground.failed, false);
      assert.equal(field.userData.foreground.openingStatus, "ready");
      for (const name of [
        "estate-root-litter",
        "estate-river-rushes",
        "estate-stream-reeds",
        "estate-water-banks",
      ])
        assert.ok(root.getObjectByName(name), `${name} settled before reveal`);
      assert.equal(
        field.userData.foreground.poses,
        25,
        "only the full opening move was fitted before reveal",
      );
      const preparedNames = new Set(field.children.map((mesh) => mesh.name));
      film.update({ ...frame, preparing: false, revealed: true });
      for (let tick = 0; tick < 1000 && field.userData.foreground.poses === 25; tick++) {
        for (let n = 0; n < 8 && idle.length; n++)
          idle.shift()({ didTimeout: true, timeRemaining: () => 0 });
        await new Promise((resolve) => setImmediate(resolve));
      }
      assert.ok(
        field.userData.foreground.poses > 25,
        "other shot/viewport envelopes completed only after reveal",
      );
      for (let tick = 0; tick <= 120; tick++) {
        opener.apply({
          width: 1920,
          height: 1080,
          elapsedSeconds: tick / 20,
          tourPhase: tick / 120,
        });
        film.update({ ...frame, preparing: false, revealed: true, deltaSeconds: 1 / 20 });
        assert.equal(
          field.userData.foreground.pendingChunks,
          0,
          `no missing opening tile at ${tick / 20}s`,
        );
        for (const mesh of field.children)
          if (mesh.visible) assert.ok(preparedNames.has(mesh.name));
      }
      // A resize while the host is still hidden needs a new complete cohort,
      // rather than reusing a fulfilled readiness promise for the old lens.
      opener.apply({ width: 390, height: 844, elapsedSeconds: 0, tourPhase: 0 });
      const resized = { ...frame, viewport: { width: 390, height: 844 } },
        beforeResize = field.userData.foreground.poses;
      let resizedReady = false;
      const refreshed = preparedHeight
        .prepareOpening(resized)
        .then((ready) => (resizedReady = ready));
      assert.equal(preparedHeight.openingState.foreground, false);
      const resizeDeadline = performance.now() + 15000;
      while (!resizedReady && performance.now() < resizeDeadline) {
        for (let n = 0; n < 8 && idle.length; n++)
          idle.shift()({ didTimeout: true, timeRemaining: () => 0 });
        for (const task of animation.splice(0)) task(performance.now());
        await new Promise((resolve) => setImmediate(resolve));
        film.update(resized);
      }
      assert.equal(await refreshed, true);
      assert.equal(field.userData.foreground.poses, beforeResize + 25);
      assert.equal(preparedHeight.openingState.foreground, true);
      for (let tick = 0; tick <= 120; tick++) {
        opener.apply({ width: 390, height: 844, elapsedSeconds: tick / 20, tourPhase: tick / 120 });
        film.update({ ...resized, preparing: false, revealed: true, deltaSeconds: 1 / 20 });
        assert.equal(
          field.userData.foreground.pendingChunks,
          0,
          `no missing resized opening tile at ${tick / 20}s`,
        );
      }
      assert.ok(
        field.userData.foreground.shots.includes("The falls"),
        "coastal providers and shots landed before coverage",
      );
      assert.ok(invalidations > 0);
      disposedGeometry = field.children[0].geometry;
      let freed = 0;
      disposedGeometry.addEventListener("dispose", () => freed++);
      film.dispose();
      opener.dispose();
      assert.equal(root.getObjectByName("estate-foreground-field"), undefined);
      assert.equal(ground.geometry, original, "the borrowed ground is restored");
      assert.equal(freed, 1, "terrain disposal frees the foreground chunk once");
    } finally {
      film.dispose();
      for (let n = 0; n < 100 && (idle.length || animation.length); n++) {
        idle.splice(0).forEach((task) => task({ didTimeout: true, timeRemaining: () => 0 }));
        animation.splice(0).forEach((task) => task(performance.now()));
        await Promise.resolve();
      }
      if (previousIdle) globalThis.requestIdleCallback = previousIdle;
      else delete globalThis.requestIdleCallback;
      if (previousFrame) globalThis.requestAnimationFrame = previousFrame;
      else delete globalThis.requestAnimationFrame;
      growth.dispose();
      tree.dispose();
      material.dispose();
      original.dispose();
    }
  });
