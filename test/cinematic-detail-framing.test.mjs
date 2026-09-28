import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  BufferGeometry,
  BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Vector3,
  BoxGeometry,
} from "three";
import {
  createCompleteTowerArchitecture,
  createTreeArchitecture,
} from "../src/scene/architecture.js";
import { createPropScale } from "../src/scene/prop-scale.js";
import { rootSupportHeight } from "../src/scene/terrain-build.js";
import { createLanternMount } from "../src/scene/lantern.js";
import { DIRECTED_SHOTS, measureShot, resolveDirectedShot } from "../src/scene/directed-shots.js";
import { createCinematicCamera, cinematicSafeArea } from "../src/scene/cinematic.js";

// Decode the actual normalized/quantized model vertices. Texture decoding is
// irrelevant to projection; source component types and normalization are not.
const ground = (x, z) =>
  1.8 * Math.sin(0.055 * x) +
  1.35 * Math.cos(0.052 * z) +
  0.9 * Math.sin(0.031 * (x + z)) +
  0.55 * Math.cos(0.018 * (x - z)) -
  6.8;
async function asset(name, tier = "high") {
  const b = await readFile(new URL(`../images/architecture/${name}-${tier}.glb`, import.meta.url)),
    len = b.readUInt32LE(12),
    j = JSON.parse(b.subarray(20, 20 + len)),
    p = j.meshes[0].primitives[0],
    g = new BufferGeometry();
  for (const [n, id, size] of [
    ["position", p.attributes.POSITION, 3],
    ["normal", p.attributes.NORMAL, 3],
    ["uv", p.attributes.TEXCOORD_0, 2],
    ["index", p.indices, 1],
  ]) {
    const a = j.accessors[id],
      v = j.bufferViews[a.bufferView],
      T = {
        5120: Int8Array,
        5122: Int16Array,
        5126: Float32Array,
        5125: Uint32Array,
        5123: Uint16Array,
      }[a.componentType],
      get = {
        5120: "readInt8",
        5122: "readInt16LE",
        5126: "readFloatLE",
        5125: "readUInt32LE",
        5123: "readUInt16LE",
      }[a.componentType],
      data = new T(a.count * size),
      start = 28 + len + (v.byteOffset || 0) + (a.byteOffset || 0);
    for (let i = 0; i < a.count; i++)
      for (let k = 0; k < size; k++)
        data[i * size + k] = b[get](
          start + i * (v.byteStride || size * T.BYTES_PER_ELEMENT) + k * T.BYTES_PER_ELEMENT,
        );
    const attr = new BufferAttribute(data, size, Boolean(a.normalized));
    if (n === "index") g.setIndex(attr);
    else g.setAttribute(n, attr);
  }
  const scene = new Group();
  scene.add(new Mesh(g, new MeshStandardMaterial()));
  return { scene };
}

function screen(camera, point, width, height) {
  const p = point.clone().project(camera);
  return { x: ((p.x + 1) * width) / 2, y: ((1 - p.y) * height) / 2, ndc: p };
}

for (const tier of ["high", "balanced"])
  test(`${tier} authored detail compositions stay intimate and distinct across desktop and phone`, async () => {
    const assets = { tower: await asset("tower", tier), tree: await asset("tree", tier), lantern: await asset("lantern", tier) };
    const tower = createCompleteTowerArchitecture({
      asset: assets.tower,
      groundY: ground(0, 0),
      footingOffset: -0.22,
    });
    const tree = createTreeArchitecture({
      asset: assets.tree,
      groundHeight: ground,
      anchor: [55.1, 36.1],
    });
    const groundRoot = new Group();
    groundRoot.add(tree.root);
    const scale = createPropScale({ groundRoot, groundHeight: ground });
    scale.setTree(tree);
    scale.setActive(true);
    tree.setFilmTreatment(true);
    tree.applyQuality({ tier });
    let prepared;
    const lanternPrepared = new Promise((resolve) => { prepared = resolve; });
    const lantern = createLanternMount({ onPrepared: prepared });
    lantern.setTree(tree);
    lantern.stage(assets.lantern);
    await lanternPrepared;
    lantern.take();
    try {
      for (const [width, height, heroBottom] of [
        [1600, 900],
        [390, 844],
        [390, 844, 180],
        [450, 800],
        [844, 390],
      ]) {
        const hero =
          height > width
            ? { right: 340, bottom: heroBottom ?? 253 }
            : { right: width * 0.33, bottom: 220 };
        const area = cinematicSafeArea(width, height, hero, { top: height - 110 });
        const distances = {},
          sizes = {};
        for (const [kind, object] of [
          ["tower", tower],
          ["tree", tree],
        ]) {
          for (let angle = 0; angle < DIRECTED_SHOTS[kind].length; angle++) {
            const shot = resolveDirectedShot(DIRECTED_SHOTS[kind][angle], width, height);
            const measured = measureShot(object.root, shot);
            const camera = new PerspectiveCamera(38, width / height, 0.1, 450);
            const controller = createCinematicCamera({
              camera,
              film: true,
              selected: kind,
              angle,
              getSafeArea: () => area,
              getGroundY: ground,
            });
            for (const [name, subject] of [
              ["tower", tower],
              ["tree", tree],
            ]) {
              controller.setSubject(name, subject.root);
              controller.setStatus({ kind: name, status: "ready" });
            }
            for (const sample of [
              { elapsedSeconds: 0 },
              { elapsedSeconds: 12 },
              { elapsedSeconds: 36 },
              { tourPhase: 0 },
              { tourPhase: 1 },
            ]) {
              assert.equal(controller.apply({ width, height, ...sample }), true);
              camera.updateMatrixWorld(true);
              const label = `${shot.name} ${tier} ${width}x${height} ${JSON.stringify(sample)}`;
              assert.ok(
                camera.position.y >= ground(camera.position.x, camera.position.z) + 0.795,
                label + " ground clearance",
              );
              assert.ok(camera.position.y >= rootSupportHeight(camera.position.x, camera.position.z, ground) + .3,
                label + " root support lens clearance");
              let minY = Infinity,
                maxY = -Infinity;
              for (let i = 0; i < measured.points.length; i += 3) {
                const p = screen(
                  camera,
                  new Vector3().fromArray(measured.points, i),
                  width,
                  height,
                );
                assert.ok(
                  p.x >= area.left - 0.01 &&
                    p.x <= area.left + area.width + 0.01 &&
                    p.y >= area.top - 0.01 &&
                    p.y <= area.top + area.height + 0.01,
                  label + " focal region escaped",
                );
                minY = Math.min(minY, p.y);
                maxY = Math.max(maxY, p.y);
              }
              distances[shot.name] = controller.frame.distance;
              sizes[shot.name] = (maxY - minY) / area.height;
              if (shot.name === "The watch" && height > width) {
                const footing = measureShot(tower.root, {
                  region: [0, 0.025],
                  azimuth: shot.azimuth,
                  height: 0,
                });
                let highestFooting = -Infinity;
                for (let i = 0; i < footing.points.length; i += 3) {
                  const p = new Vector3().fromArray(footing.points, i).project(camera);
                  highestFooting = Math.max(highestFooting, p.y);
                }
                assert.ok(
                  highestFooting < -1.02,
                  label + ` hero ${hero.bottom} shows the tower footing at ${highestFooting}`,
                );
              }
              if (shot.name === "Root and lantern") {
                const lantern = measureShot(tree.root, DIRECTED_SHOTS.tree[1]);
                for (let i = 0; i < lantern.points.length; i += 3) {
                  const p = new Vector3().fromArray(lantern.points, i).project(camera);
                  assert.ok(Math.abs(p.x) < 1 && Math.abs(p.y) < 1, label + " crops the lantern");
                }
              }
              if (shot.name === "Close-up") {
                const roots = measureShot(tree.root, {
                  region: [0, 0.025],
                  height: 0,
                  azimuth: shot.azimuth,
                });
                for (let i = 0; i < roots.points.length; i += 3) {
                  const p = new Vector3().fromArray(roots.points, i).project(camera);
                  assert.ok(p.y < -1, label + " roots enter full viewport");
                }
                const lantern = measureShot(tree.root, { ...DIRECTED_SHOTS.tree[1], height: 0 });
                for (let i = 0; i < lantern.points.length; i += 3) {
                  const p = new Vector3().fromArray(lantern.points, i).project(camera);
                  assert.ok(
                    p.y < -1,
                    label + " lantern enters canopy composition " + p.toArray().join(","),
                  );
                }
              }
            }
            controller.dispose();
          }
        }
        assert.ok(
          distances["Gallery detail"] < distances["The watch"] * 0.65,
          `${tier} ${width} gallery repeated the roof-wide view`,
        );
        assert.ok(
          distances["Close-up"] < distances.Portrait * 0.65,
          `${tier} ${width} close-up backed out to whole tree`,
        );
        assert.ok(
          distances["Lantern study"] < distances["Root and lantern"] * 0.65,
          `${tier} ${width} lantern study repeated the roots view`,
        );
        assert.ok(
          sizes["Lantern study"] > 0.55,
          `${tier} ${width} lantern is not the clear subject`,
        );
      }
    } finally {
      lantern.dispose();
      scale.dispose();
      tower.dispose();
      tree.dispose();
      for (const item of Object.values(assets))
        item.scene.traverse((mesh) => {
          mesh.geometry?.dispose();
          mesh.material?.dispose();
        });
    }
  });

test("focal clipping intersects large triangles and excludes secondary edge-leaf meshes", () => {
  const root = new Group();
  const trunk = new Mesh(new BoxGeometry(4, 20, 4), new MeshStandardMaterial());
  trunk.name = "meshy-tree";
  trunk.position.y = 10;
  root.add(trunk);
  const shot = resolveDirectedShot(DIRECTED_SHOTS.tree[2], 390, 844);
  const before = measureShot(root, shot);
  const decoration = new Mesh(new BoxGeometry(100, 10, 100), new MeshStandardMaterial());
  decoration.position.y = 10;
  decoration.userData.excludeFromShot = true;
  trunk.add(decoration);
  const after = measureShot(root, shot);
  assert.deepEqual(after.points, before.points);
  assert.equal(after.height, before.height);
  assert.deepEqual(after.target, before.target);
  assert.ok(
    before.points.length > 0,
    "crossing triangles survive despite having vertices outside the crop",
  );
  const yaw = (shot.azimuth * Math.PI) / 180,
    right = new Vector3(-Math.sin(yaw), 0, Math.cos(yaw));
  for (let i = 0; i < before.points.length; i += 3) {
    const p = new Vector3().fromArray(before.points, i);
    assert.ok(Math.abs(p.dot(right)) <= (shot.focus.width * 20) / 2 + 1e-5);
    assert.ok(p.y >= 20 * shot.region[0] - 1e-5 && p.y <= 20 * shot.region[1] + 1e-5);
  }
  for (const mesh of [trunk, decoration]) {
    mesh.geometry.dispose();
    mesh.material.dispose();
  }
});

test("The watch resolves its landscape variant only for short landscape viewports", () => {
  const watch = DIRECTED_SHOTS.tower[0];
  for (const [width, height] of [[844, 390], [932, 430], [667, 375], [1200, 480], [1440, 499]]) {
    const shot = resolveDirectedShot(watch, width, height);
    assert.equal(shot.height, 0.55);
    assert.equal(shot.azimuth, -12);
    assert.equal(shot.region, watch.region);
    assert.equal(resolveDirectedShot(watch, width, height), shot, "each variant is built once");
  }
  for (const [width, height] of [[1440, 900], [1440, 500], [1024, 768]])
    assert.equal(resolveDirectedShot(watch, width, height), watch);
  assert.equal(resolveDirectedShot(watch, 430, 932).height, 0.66, "portrait keeps its own variant");
  assert.equal(resolveDirectedShot(DIRECTED_SHOTS.tower[1], 844, 390), DIRECTED_SHOTS.tower[1]);
});
