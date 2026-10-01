import assert from "node:assert/strict";
import test from "node:test";
import { glbAsset, modelBytes } from "./support/glb.mjs";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { Group, PerspectiveCamera, Vector3 } from "three";
import {
  createCompleteTowerArchitecture,
  createTreeArchitecture,
} from "../src/scene/architecture.js";
import { createPropScale } from "../src/scene/prop-scale.js";
import { DIRECTED_SHOTS } from "../src/scene/directed-shots.js";
import { createCinematicCamera, cinematicSafeArea } from "../src/scene/cinematic.js";
import { snowReach } from "../src/scene/hill-silhouette.js";
import { createMountainGeometry, MOUNTAINS } from "../src/scene/mountain-build.js";

// The film mountains follow the camera, so their framing depends only on where each
// directed shot puts it: fit the real tower and tree, then project the crest line.
const ground = (x, z) =>
  1.8 * Math.sin(0.055 * x) +
  1.35 * Math.cos(0.052 * z) +
  0.9 * Math.sin(0.031 * (x + z)) +
  0.55 * Math.cos(0.018 * (x - z)) -
  6.8;
const asset = async (name, tier = "high") => glbAsset(modelBytes(name, tier));

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
];
const PHASES = [0, 0.5, 1];

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
            // The corona (4.2 units, as in solar-framing) stays clear of every crest.
            const s = screen(sun),
              radius = (((4.2 * camera.projectionMatrix.elements[5]) / s.depth) * height) / 2;
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
