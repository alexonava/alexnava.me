// Directed shots framed around the delivered models: detail compositions, the
// camera-centred mountain ranges and the fixed sun.

import assert from "node:assert/strict";
import test from "node:test";
import { glbAsset, modelBytes } from "./support/glb.mjs";
import {
  Group,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Vector3,
  BoxGeometry,
  Raycaster,
  DoubleSide,
} from "three";
import {
  createCompleteTowerArchitecture,
  createTreeArchitecture,
} from "../src/scene/architecture.js";
import { createPropScale } from "../src/scene/prop-scale.js";
import { rootSupportHeight } from "../src/scene/terrain-build.js";
import { createLanternMount } from "../src/scene/lantern.js";
import {
  DIRECTED_SHOTS,
  measureShot,
  resolveDirectedShot,
  SQUAT_LANDSCAPE,
} from "../src/scene/directed-shots.js";
import { createCinematicCamera, cinematicSafeArea } from "../src/scene/cinematic.js";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { MASSIF_SNOW, MASSIFS, snowReach } from "../src/scene/hill-silhouette.js";
import { SOLAR_GLOW_RADIUS } from "../src/scene/solar-body.js";
import {
  createMountainGeometry,
  createRangeGeometry,
  mountainCrests,
  MOUNTAINS,
  RANGE_BACKDROP,
  RANGE_SKY,
} from "../src/scene/mountain-build.js";

const ground = (x, z) =>
  1.8 * Math.sin(0.055 * x) +
  1.35 * Math.cos(0.052 * z) +
  0.9 * Math.sin(0.031 * (x + z)) +
  0.55 * Math.cos(0.018 * (x - z)) -
  6.8;

// The delivered models' actual normalized, quantized vertices: texture
// decoding is irrelevant to projection; component types and normalization are not.
const asset = async (name, tier = "high") => glbAsset(modelBytes(name, tier));

function screen(camera, point, width, height) {
  const p = point.clone().project(camera);
  return { x: ((p.x + 1) * width) / 2, y: ((1 - p.y) * height) / 2, ndc: p };
}

for (const tier of ["high", "balanced"])
  test(`${tier} authored detail compositions stay intimate and distinct across desktop and phone`, async () => {
    const assets = {
      tower: await asset("tower", tier),
      tree: await asset("tree", tier),
      lantern: await asset("lantern", tier),
    };
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
    const lanternPrepared = new Promise((resolve) => {
      prepared = resolve;
    });
    const lantern = createLanternMount({ onPrepared: prepared });
    lantern.setTree(tree);
    lantern.stage(assets.lantern);
    await lanternPrepared;
    lantern.take();
    try {
      for (const [width, height, heroBottom, measured] of [
        [1600, 900],
        [390, 844],
        [390, 844, 180],
        [450, 800],
        [844, 390],
        // A small landscape phone (name top-left) and a portrait monitor (name
        // bottom-left), measured from the live page.
        [568, 320, null, { hero: { right: 253, bottom: 138 }, nav: { top: 246 } }],
        [
          1080,
          1920,
          null,
          { hero: { left: 16, right: 283, top: 1496, bottom: 1726 }, nav: { top: 1838 } },
        ],
      ]) {
        const hero =
          measured?.hero ??
          (height > width
            ? { right: 340, bottom: heroBottom ?? 253 }
            : { right: width * 0.33, bottom: 220 });
        const area = cinematicSafeArea(width, height, hero, measured?.nav ?? { top: height - 110 });
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
              assert.ok(
                camera.position.y >=
                  rootSupportHeight(camera.position.x, camera.position.z, ground) + 0.3,
                label + " root support lens clearance",
              );
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
  for (const [width, height] of [
    [844, 390],
    [932, 430],
    [667, 375],
    [1200, 480],
    [1440, 499],
    // The hero's short-landscape breakpoint includes 500px (max-height: 500px).
    [1440, 500],
    [780, 499],
  ]) {
    const shot = resolveDirectedShot(watch, width, height);
    assert.equal(shot.height, 0.55);
    assert.equal(shot.azimuth, -12);
    assert.equal(shot.region, watch.region);
    assert.equal(resolveDirectedShot(watch, width, height), shot, "each variant is built once");
  }
  for (const [width, height] of [
    [1440, 900],
    [1440, 501],
    [1024, 768],
  ])
    assert.equal(resolveDirectedShot(watch, width, height), watch);
  // Squarish short windows (narrower than SQUAT_LANDSCAPE) take the portrait
  // variant, which keeps the sun in frame; every landscape phone is wider.
  assert.equal(SQUAT_LANDSCAPE, 1.55);
  for (const [width, height] of [
    [599, 499],
    [620, 499],
    [700, 480],
    [560, 450],
    [760, 499],
  ])
    assert.equal(resolveDirectedShot(watch, width, height), resolveDirectedShot(watch, 430, 932));
  for (const [width, height] of [
    [568, 320],
    [667, 375],
    [640, 360],
    [844, 390],
    [932, 430],
  ])
    assert.ok(width >= SQUAT_LANDSCAPE * height, `${width}x${height} is a landscape phone`);
  assert.equal(resolveDirectedShot(watch, 430, 932).height, 0.66, "portrait keeps its own variant");
  // A portrait monitor sets the name below the subject, but keeps the portrait shot.
  assert.equal(resolveDirectedShot(watch, 1080, 1920).height, 0.66);
  assert.equal(resolveDirectedShot(watch, 1080, 1920), resolveDirectedShot(watch, 430, 932));
  // Landscape phones under 600px wide take a compact variant, lower again.
  for (const [width, height] of [
    [568, 320],
    [599, 360],
  ]) {
    const shot = resolveDirectedShot(watch, width, height);
    assert.equal(shot.height, 0.4);
    assert.equal(shot.azimuth, -12);
    assert.equal(resolveDirectedShot(watch, width, height), shot);
  }
  assert.equal(resolveDirectedShot(DIRECTED_SHOTS.tree[0], 568, 320), DIRECTED_SHOTS.tree[0]);
  assert.equal(resolveDirectedShot(DIRECTED_SHOTS.tower[1], 844, 390), DIRECTED_SHOTS.tower[1]);
});

// Hero text and bottom bar measured from the live page at each size.
const LAYOUTS = [
  {
    width: 390,
    height: 844,
    hero: { left: 32, right: 299, top: 34, bottom: 177 },
    nav: { top: 738 },
  },
  {
    width: 450,
    height: 800,
    hero: { left: 12, right: 345, top: 34, bottom: 270 },
    nav: { top: 694 },
  },
  {
    width: 844,
    height: 390,
    hero: { left: 16, right: 262, top: 12, bottom: 138 },
    nav: { top: 296 },
  },
  {
    width: 1440,
    height: 900,
    hero: { left: 130, right: 454, top: 447, bottom: 720 },
    nav: { top: 782 },
  },
  {
    width: 1600,
    height: 900,
    hero: { left: 210, right: 535, top: 447, bottom: 720 },
    nav: { top: 782 },
  },
  {
    width: 2560,
    height: 1080,
    hero: { left: 141, right: 465, top: 613, bottom: 886 },
    nav: { top: 962 },
  },
  // A small landscape phone sets the name top-left beside the subject; a
  // portrait monitor sets it bottom-left, below the subject.
  {
    width: 568,
    height: 320,
    hero: { left: 12, right: 253, top: 12, bottom: 138 },
    nav: { top: 246 },
  },
  {
    width: 1080,
    height: 1920,
    hero: { left: 16, right: 283, top: 1496, bottom: 1726 },
    nav: { top: 1838 },
  },
];

const PHASES = [0, 0.5, 1];

// The film mountains follow the camera, so their framing depends only on where each
// directed shot puts it: fit the real tower and tree, then project the crest line.
// These are the five procedural rings, which land when a Meshy massif cannot load;
// the massifs' own framing follows.
test("the camera-centred ranges frame every tour shot: sun, roof lane, tree shots, phones and the name", async () => {
  const window = { BabelSite: {} };
  vm.runInNewContext(await readFile(new URL("../src/scene/world.js", import.meta.url), "utf8"), {
    window,
  });
  const { SUN_POSITION, CAMERA_FAR } = window.BabelSite.scene.WORLD,
    sun = new Vector3(...SUN_POSITION);
  const assets = { tower: await asset("tower"), tree: await asset("tree") };
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
  tree.applyQuality({ tier: "high" });
  tower.root.updateMatrixWorld(true);
  // The roof: the top 6% of the lookout.
  const towerPoints = [];
  tower.root.traverse((o) => {
    if (!o.isMesh) return;
    const p = o.geometry.attributes.position;
    for (let i = 0; i < p.count; i++)
      towerPoints.push(new Vector3().fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld));
  });
  const top = Math.max(...towerPoints.map((p) => p.y)),
    bottom = Math.min(...towerPoints.map((p) => p.y));
  const roof = towerPoints.filter((p) => p.y > top - 0.06 * (top - bottom));
  const mountains = createMountainGeometry(),
    position = mountains.attributes.position,
    terrain = mountains.attributes.aTerrain,
    { columns, rows } = MOUNTAINS,
    perRange = rows.length * columns;
  const elevationOf = (v) =>
    (Math.atan2(position.getY(v), Math.hypot(position.getX(v), position.getZ(v))) * 180) / Math.PI;
  try {
    for (const layout of LAYOUTS) {
      const { width, height, hero, nav } = layout,
        desktop = width >= 1000,
        portrait = height > width;
      for (const [kind, angle] of [
        ["tower", 0],
        ["tower", 1],
        ["tower", 3],
        ["tree", 0],
        ["tree", 1],
        ["tree", 2],
        ["tree", 3],
      ]) {
        const name = DIRECTED_SHOTS[kind][angle].name;
        const camera = new PerspectiveCamera(38, width / height, 0.1, CAMERA_FAR);
        const controller = createCinematicCamera({
          camera,
          selected: kind,
          angle,
          getSafeArea: () => cinematicSafeArea(width, height, hero, nav),
          getGroundY: ground,
        });
        for (const [subject, object] of [
          ["tower", tower],
          ["tree", tree],
        ]) {
          controller.setSubject(subject, object.root);
          controller.setStatus({ kind: subject, status: "ready" });
        }
        for (const tourPhase of PHASES) {
          controller.apply({ width, height, tourPhase });
          camera.updateMatrixWorld(true);
          const label = `${name} ${width}x${height} phase ${tourPhase}`;
          const screen = (point) => {
            const depth = -point.clone().applyMatrix4(camera.matrixWorldInverse).z,
              p = point.clone().project(camera);
            return { x: ((p.x + 1) * width) / 2, y: ((1 - p.y) * height) / 2, depth };
          };
          const vertex = (v) => new Vector3().fromBufferAttribute(position, v).add(camera.position);
          // The visible crest: every range's crest vertices, densified along each ridge.
          const crest = [];
          for (let range = 0; range < MOUNTAINS.radii.length; range++)
            for (let j = 0; j < columns; j++) {
              const a = vertex(range * perRange + j),
                b = vertex(range * perRange + ((j + 1) % columns));
              for (let s = 0; s < 4; s++) {
                const point = screen(a.clone().lerp(b, s / 4));
                if (point.depth > 0 && point.x >= -2 && point.x <= width + 2) crest.push(point);
              }
            }
          assert.ok(crest.length > 0, label + " shows no mountains");
          // Landscape phones keep the opening shot's snow out from behind the intro too.
          // snowReach mirrors the shader's snowline: the vertex's elevation against
          // its massif (aTerrain.w), with the jitter and gully tongue at their most generous.
          if (desktop || (name === "The watch" && height < 500))
            for (let v = 0; v < terrain.count; v++) {
              if (!snowReach(elevationOf(v), terrain.getW(v))) continue;
              const p = screen(vertex(v));
              assert.ok(
                p.depth <= 0 ||
                  p.x < hero.left ||
                  p.x > hero.right ||
                  p.y < hero.top ||
                  p.y > hero.bottom,
                label + " puts snow behind the name",
              );
            }
          if (name === "The watch") {
            // The star's glow (SOLAR_GLOW_RADIUS, its furthest reach) stays clear of every crest.
            const s = screen(sun),
              radius =
                (((SOLAR_GLOW_RADIUS * camera.projectionMatrix.elements[5]) / s.depth) * height) /
                2;
            const nearest = Math.min(...crest.map((p) => Math.hypot(p.x - s.x, p.y - s.y)));
            assert.ok(
              nearest >= radius + 12,
              `${label} crest ${(nearest - radius).toFixed(1)} px from the corona`,
            );
            // The lane above the roof stays open sky.
            const r = roof.map(screen),
              left = Math.min(...r.map((p) => p.x)),
              right = Math.max(...r.map((p) => p.x)),
              roofTop = Math.min(...r.map((p) => p.y));
            for (const p of crest)
              if (p.x >= left && p.x <= right)
                assert.ok(
                  p.y >= roofTop + 15,
                  `${label} crest ${(roofTop - p.y).toFixed(1)} px above the roof top`,
                );
            if (portrait) {
              // Phones: the ranges show above the bottom bar across most of the width.
              let clear = 0;
              for (let x = 0; x < width; x++) {
                const column = crest.filter((p) => Math.abs(p.x - x) <= 1);
                if (column.length && Math.min(...column.map((p) => p.y)) < nav.top - 30) clear++;
              }
              assert.ok(
                clear >= width / 2,
                `${label} ranges clear the bottom bar over ${clear} px`,
              );
            }
          }
          if (name === "Lantern study" || name === "Root and lantern") {
            // Sky stays open above the ranges: never a wall behind the tree.
            const highest = Math.min(...crest.map((p) => p.y));
            assert.ok(highest > 0.12 * height, `${label} crest at ${highest.toFixed(1)} px`);
          }
        }
        controller.dispose();
      }
    }
  } finally {
    mountains.dispose();
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

// The Meshy massifs with their backdrop rings, through the same cameras: the
// crest is the composed skyline (every copy's own, finest bins, and the
// backdrop's), the snow every massif vertex snowReach() lets carry it. The tree
// shots may rise higher than the rings did (owner, 2026-10-03), under a band of
// open sky 8% of the frame tall; and in no frame does the same model show twice
// from the same side, in any layers.
test("the Meshy massifs frame every tour shot: sun, roof lane, open sky over the tree, phones and the name", async () => {
  const window = { BabelSite: {} };
  vm.runInNewContext(await readFile(new URL("../src/scene/world.js", import.meta.url), "utf8"), {
    window,
  });
  const { SUN_POSITION, CAMERA_FAR } = window.BabelSite.scene.WORLD,
    sun = new Vector3(...SUN_POSITION);
  const assets = { tower: await asset("tower"), tree: await asset("tree") };
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
  tree.applyQuality({ tier: "high" });
  tower.root.updateMatrixWorld(true);
  const towerPoints = [];
  tower.root.traverse((o) => {
    if (!o.isMesh) return;
    const p = o.geometry.attributes.position;
    for (let i = 0; i < p.count; i++)
      towerPoints.push(new Vector3().fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld));
  });
  const top = Math.max(...towerPoints.map((p) => p.y)),
    bottom = Math.min(...towerPoints.map((p) => p.y));
  const roof = towerPoints.filter((p) => p.y > top - 0.06 * (top - bottom));
  // The composed ranges.
  const models = {};
  for (const role of MASSIFS.roles) {
    const mesh = (await asset(role)).scene.children[0];
    models[role] = {
      position: mesh.geometry.attributes.position,
      uv: mesh.geometry.attributes.uv,
      index: mesh.geometry.index,
      height: mesh.userData.height,
    };
  }
  const composed = createRangeGeometry(models),
    backdrop = mountainCrests(RANGE_BACKDROP),
    rad = Math.PI / 180,
    direction = (azimuth, elevation) =>
      new Vector3(
        Math.cos(azimuth * rad),
        Math.tan(elevation * rad),
        Math.sin(azimuth * rad),
      ).multiplyScalar(300);
  const skyline = [];
  for (const { sky } of composed.placed)
    sky.values.forEach((e, j) => {
      if (e > -90) skyline.push(direction(sky.from + (j + 0.5) * RANGE_SKY.bin, e));
    });
  for (const range of RANGE_BACKDROP.ranges)
    backdrop[range].forEach((e, j) => skyline.push(direction((j / MOUNTAINS.columns) * 360, e)));
  // Every massif vertex that can carry snow, and each copy's azimuth span.
  const snowy = [];
  for (const geometry of Object.values(composed.geometries)) {
    const p = geometry.attributes.position,
      terrain = geometry.attributes.aTerrain;
    for (let v = 0; v < p.count; v++) {
      const line = terrain.getZ(v);
      if (!line) continue;
      const elevation = Math.atan2(p.getY(v), Math.hypot(p.getX(v), p.getZ(v))) / rad;
      if (snowReach(elevation, terrain.getW(v), { ...MASSIF_SNOW, line }))
        snowy.push(new Vector3(p.getX(v), p.getY(v), p.getZ(v)));
    }
  }
  try {
    for (const layout of LAYOUTS) {
      const { width, height, hero, nav } = layout,
        desktop = width >= 1000,
        portrait = height > width;
      for (const [kind, angle] of [
        ["tower", 0],
        ["tower", 1],
        ["tower", 3],
        ["tree", 0],
        ["tree", 1],
        ["tree", 2],
        ["tree", 3],
      ]) {
        const name = DIRECTED_SHOTS[kind][angle].name;
        const camera = new PerspectiveCamera(38, width / height, 0.1, CAMERA_FAR);
        const controller = createCinematicCamera({
          camera,
          selected: kind,
          angle,
          getSafeArea: () => cinematicSafeArea(width, height, hero, nav),
          getGroundY: ground,
        });
        for (const [subject, object] of [
          ["tower", tower],
          ["tree", tree],
        ]) {
          controller.setSubject(subject, object.root);
          controller.setStatus({ kind: subject, status: "ready" });
        }
        for (const tourPhase of PHASES) {
          controller.apply({ width, height, tourPhase });
          camera.updateMatrixWorld(true);
          const label = `${name} ${width}x${height} phase ${tourPhase}`;
          const screen = (point) => {
            const depth = -point.clone().applyMatrix4(camera.matrixWorldInverse).z,
              p = point.clone().project(camera);
            return { x: ((p.x + 1) * width) / 2, y: ((1 - p.y) * height) / 2, depth };
          };
          const crest = skyline
            .map((d) => screen(d.clone().add(camera.position)))
            .filter((p) => p.depth > 0 && p.x >= -2 && p.x <= width + 2);
          assert.ok(crest.length > 0, label + " shows no mountains");
          if (desktop || (name === "The watch" && height < 500))
            for (const point of snowy) {
              const p = screen(point.clone().add(camera.position));
              assert.ok(
                p.depth <= 0 ||
                  p.x < hero.left ||
                  p.x > hero.right ||
                  p.y < hero.top ||
                  p.y > hero.bottom,
                label + " puts snow behind the name",
              );
            }
          if (name === "The watch") {
            // The star's glow stays clear of every crest.
            const s = screen(sun),
              radius =
                (((SOLAR_GLOW_RADIUS * camera.projectionMatrix.elements[5]) / s.depth) * height) /
                2;
            const nearest = Math.min(...crest.map((p) => Math.hypot(p.x - s.x, p.y - s.y)));
            assert.ok(
              nearest >= radius + 12,
              `${label} crest ${(nearest - radius).toFixed(1)} px from the corona`,
            );
            const r = roof.map(screen),
              left = Math.min(...r.map((p) => p.x)),
              right = Math.max(...r.map((p) => p.x)),
              roofTop = Math.min(...r.map((p) => p.y));
            for (const p of crest)
              if (p.x >= left && p.x <= right)
                assert.ok(
                  p.y >= roofTop + 15,
                  `${label} crest ${(roofTop - p.y).toFixed(1)} px above the roof top`,
                );
            if (portrait) {
              let clear = 0;
              for (let x = 0; x < width; x++) {
                const column = crest.filter((p) => Math.abs(p.x - x) <= 1);
                if (column.length && Math.min(...column.map((p) => p.y)) < nav.top - 30) clear++;
              }
              assert.ok(
                clear >= width / 2,
                `${label} ranges clear the bottom bar over ${clear} px`,
              );
            }
          }
          if (name === "Lantern study" || name === "Root and lantern") {
            const highest = Math.min(...crest.map((p) => p.y));
            assert.ok(highest > 0.08 * height, `${label} crest at ${highest.toFixed(1)} px`);
          }
          // No model twice from one side within a frame, in any layers.
          const seen = new Map();
          for (const { placement, sky } of composed.placed) {
            const span = [sky.from, sky.from + sky.values.length * RANGE_SKY.bin];
            const shown = [0.1, 0.3, 0.5, 0.7, 0.9].some((f) => {
              const p = screen(
                direction(span[0] + f * (span[1] - span[0]), 0.5).add(camera.position),
              );
              return p.depth > 0 && p.x >= 0 && p.x <= width;
            });
            if (!shown) continue;
            const key = `${placement.role} ${placement.mirror}`;
            for (const yaw of seen.get(key) ?? [])
              assert.ok(
                Math.abs(yaw - placement.yaw) >= 15,
                `${label} shows ${placement.role} twice from one side`,
              );
            seen.set(key, [...(seen.get(key) ?? []), placement.yaw]);
          }
        }
        controller.dispose();
      }
    }
  } finally {
    Object.values(composed.geometries).forEach((geometry) => geometry.dispose());
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

for (const tier of ["high", "balanced"])
  test(
    tier + " tower keeps the fixed sun clear in the Watch and whole or absent in every tower shot",
    async () => {
      const window = { BabelSite: {} };
      vm.runInNewContext(
        await readFile(new URL("../src/scene/world.js", import.meta.url), "utf8"),
        {
          window,
        },
      );
      const sun = new Vector3(...window.BabelSite.scene.WORLD.SUN_POSITION);
      const asset = glbAsset(modelBytes("tower", tier));
      // Ground at origin 2.9, ground root offset -6.8, film footing overlap -0.22.
      const tower = createCompleteTowerArchitecture({
        asset,
        groundY: 2.9 - 6.8,
        footingOffset: -0.22,
      });
      tower.root.traverse((o) => {
        if (o.isMesh) o.material.side = DoubleSide;
      });
      const layouts = [
        {
          width: 390,
          height: 844,
          hero: { left: 12, right: 302, top: 34, bottom: 195 },
          nav: { top: 738 },
        },
        {
          width: 450,
          height: 800,
          hero: { left: 12, right: 345, top: 34, bottom: 270 },
          nav: { top: 694 },
        },
        {
          width: 1600,
          height: 900,
          hero: { left: 210, right: 535, top: 388, bottom: 720 },
          nav: { top: 782 },
        },
        {
          width: 1600,
          height: 900,
          hero: { left: 210, right: 535, top: 447, bottom: 720 },
          nav: { top: 782 },
        },
        {
          width: 450,
          height: 800,
          hero: { left: 12, right: 302, top: 34, bottom: 195 },
          nav: { top: 694 },
        },
        {
          width: 390,
          height: 844,
          hero: { left: 12, right: 341, top: 34, bottom: 253 },
          nav: { top: 738 },
        },
        // Landscape phone and ultrawide, measured from the live page (hero layout
        // box and bottom-bar rect): the name sits top-left and bottom-left.
        {
          width: 844,
          height: 390,
          hero: { left: 16, right: 262, top: 12, bottom: 138 },
          nav: { top: 296 },
        },
        {
          width: 2560,
          height: 1080,
          hero: { left: 141, right: 465, top: 613, bottom: 886 },
          nav: { top: 962 },
        },
        // A small landscape phone (name top-left) and a portrait monitor (name
        // bottom-left), measured from the live page.
        {
          width: 568,
          height: 320,
          hero: { left: 12, right: 253, top: 12, bottom: 138 },
          nav: { top: 246 },
        },
        {
          width: 1080,
          height: 1920,
          hero: { left: 16, right: 283, top: 1496, bottom: 1726 },
          nav: { top: 1838 },
        },
        // Squarish short windows, the hero top-left (measured from the live page):
        // the wide variants would push the sun past the right edge there.
        ...[
          [599, 499, 254, 151, 425],
          [599, 500, 254, 151, 426],
          [620, 499, 254, 151, 425],
          [700, 480, 261, 148, 406],
          [560, 450, 253, 143, 376],
        ].map(([width, height, right, bottom, top]) => ({
          width,
          height,
          hero: { left: 12, right, top: 12, bottom },
          nav: { top },
        })),
      ];
      // The Watch frames the sun. Every other tower shot either leaves the whole
      // corona out of frame or shows all of it, uncropped, clear of the name and
      // unoccluded: never hidden behind the lookout, where a small retune could
      // reveal it between beams or railing bars.
      for (const layout of layouts)
        for (let angle = 0; angle < DIRECTED_SHOTS.tower.length; angle++) {
          const { width, height, hero, nav } = layout;
          const camera = new PerspectiveCamera(
            38,
            width / height,
            0.1,
            window.BabelSite.scene.WORLD.CAMERA_FAR,
          );
          const controller = createCinematicCamera({
            camera,
            selected: "tower",
            angle,
            getSafeArea: () => cinematicSafeArea(width, height, hero, nav),
          });
          controller.setSubject("tower", tower.root);
          controller.setStatus({ kind: "tower", status: "ready" });
          const samples = [0, 6, 12, 18, 24, 30, 36, 42, 48].map((elapsedSeconds) => ({
            elapsedSeconds,
          }));
          samples.push(...[0, 0.25, 0.5, 0.75, 1].map((tourPhase) => ({ tourPhase })));
          for (const sample of samples) {
            controller.apply({ width, height, ...sample });
            camera.updateMatrixWorld(true);
            const p = sun.clone().project(camera),
              depth = -sun.clone().applyMatrix4(camera.matrixWorldInverse).z;
            // The disc is radius 3.027375; 4.2 also contains the nearby visible corona.
            const radius = (((4.2 * camera.projectionMatrix.elements[5]) / depth) * height) / 2;
            const x = ((p.x + 1) * width) / 2,
              y = ((1 - p.y) * height) / 2;
            const label =
              DIRECTED_SHOTS.tower[angle].name +
              " " +
              width +
              "x" +
              height +
              " " +
              JSON.stringify(sample);
            const outOfFrame =
              depth <= 0 ||
              x + radius < 0 ||
              x - radius > width ||
              y + radius < 0 ||
              y - radius > height;
            if (angle > 0 && outOfFrame) continue;
            assert.ok(depth > 0 && depth < camera.far, label + " depth");
            assert.ok(
              x - radius > 10 &&
                x + radius < width - 10 &&
                y - radius > 10 &&
                y + radius < nav.top - 10,
              label + " corona cropped",
            );
            const textDistance = Math.hypot(
              x - Math.max(hero.left, Math.min(x, hero.right)),
              y - Math.max(hero.top, Math.min(y, hero.bottom)),
            );
            assert.ok(
              textDistance > radius + 4,
              label + " corona approaches text: " + (textDistance - radius),
            );
            // Its glow, out to its furthest reach, stays clear of the text too. (Only the
            // glow's faint outer fade may graze the frame's edge while the star itself is
            // just out of frame, as in Threshold on landscape phones.)
            const glow = (radius * SOLAR_GLOW_RADIUS) / 4.2;
            assert.ok(
              textDistance > glow + 4,
              label + " glow approaches text: " + (textDistance - glow),
            );
            const right = new Vector3(1, 0, 0).applyQuaternion(camera.quaternion),
              up = new Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
            for (let i = 0; i < 9; i++) {
              const point = sun.clone();
              if (i)
                point
                  .addScaledVector(right, 4.2 * Math.cos((i * Math.PI) / 4))
                  .addScaledVector(up, 4.2 * Math.sin((i * Math.PI) / 4));
              const delta = point.sub(camera.position);
              const ray = new Raycaster(
                camera.position,
                delta.clone().normalize(),
                0,
                delta.length(),
              );
              assert.equal(
                ray.intersectObject(tower.root, true).length,
                0,
                label + " occluded by the lookout",
              );
            }
          }
          controller.dispose();
        }
      // Keep the authored footing out of Threshold throughout
      // normal sweep and the tour's dolly, including narrow phone layouts.
      const footing = measureShot(tower.root, { region: [0, 0.025], height: 0 });
      for (const layout of layouts)
        for (const angle of [1]) {
          const { width, height, hero, nav } = layout;
          const camera = new PerspectiveCamera(
            38,
            width / height,
            0.1,
            window.BabelSite.scene.WORLD.CAMERA_FAR,
          );
          const controller = createCinematicCamera({
            camera,
            selected: "tower",
            angle,
            getSafeArea: () => cinematicSafeArea(width, height, hero, nav),
          });
          controller.setSubject("tower", tower.root);
          controller.setStatus({ kind: "tower", status: "ready" });
          for (const sample of [0, 6, 12, 18, 24, 30, 36, 42, 48]
            .map((elapsedSeconds) => ({ elapsedSeconds }))
            .concat([0, 0.25, 0.5, 0.75, 1].map((tourPhase) => ({ tourPhase })))) {
            controller.apply({ width, height, ...sample });
            camera.updateMatrixWorld(true);
            for (let i = 0; i < footing.points.length; i += 3) {
              const point = new Vector3().fromArray(footing.points, i).project(camera);
              assert.ok(
                point.y < -1,
                `${DIRECTED_SHOTS.tower[angle].name} ${width} footing visible: ${point.y}`,
              );
            }
          }
          controller.dispose();
        }
      tower.dispose();
      asset.scene.traverse((o) => {
        o.geometry?.dispose();
        o.material?.dispose();
      });
    },
  );
