// Directed shots framed around the delivered models (and The watch around the lookout's
// stored outline): detail compositions, the camera-centred mountain ranges and the fixed sun.

import assert from "node:assert/strict";
import test from "node:test";
import { sceneGround } from "./support/ground.mjs";
import { glbAsset, modelBytes } from "./support/glb.mjs";
import {
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  Vector3,
  BoxGeometry,
  Raycaster,
  DoubleSide,
} from "three";
import { createTreeArchitecture } from "../src/scene/architecture.js";
import { watchMeasure } from "../src/scene/opening-star.js";
import { outlineKey } from "../src/scene/opening-outline-key.js";
import { createPropScale } from "../src/scene/prop-scale.js";
import { rootSupportHeight } from "../src/scene/terrain-build.js";
import { createLanternMount } from "../src/scene/lantern.js";
import { FLAME } from "../src/scene/lantern-flame.js";
import {
  DIRECTED_SHOTS,
  measureShot,
  resolveDirectedShot,
  SQUAT_LANDSCAPE,
  TABLET_WIDTH,
} from "../src/scene/directed-shots.js";
import {
  createCinematicCamera,
  cinematicSafeArea,
  letterboxShare,
} from "../src/scene/cinematic.js";
import { TOUR_ORDER } from "../src/scene/camera-tour.js";
import { COAST_SHOTS, coastShot } from "../src/scene/ocean.js";
const coastalTourOrder = TOUR_ORDER.flatMap((name) => [
  name,
  ...COAST_SHOTS.filter((shot) => shot.after === name).map((shot) => shot.name),
]);
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { MASSIF_SNOW, MASSIFS, SNOW, snowReach } from "../src/scene/hill-silhouette.js";
import { SOLAR_GLOW_RADIUS } from "../src/scene/solar-body.js";
import {
  createMountainGeometry,
  createRangeGeometry,
  mountainCrests,
  MOUNTAINS,
  RANGE_BACKDROP,
  RANGE_SKY,
} from "../src/scene/mountain-build.js";

// The live scene's level plain and terraces.
const ground = sceneGround;

// The fault's shots (ocean.js COAST_SHOTS) join the tree's list once the sea lands;
// here they stand on it throughout, set in the estate's frame (at the film's scene
// offset, as the ground), so every tour check below holds for them too.
const estate = new Group();
estate.position.y = -6.8;
estate.updateMatrixWorld(true);
DIRECTED_SHOTS.tree.push(...COAST_SHOTS.map((shot) => coastShot(shot, estate)));

// The delivered models' actual normalized, quantized vertices: texture
// decoding is irrelevant to projection; component types and normalization are not.
const asset = async (name, tier = "high") => glbAsset(modelBytes(name, tier));

// The lantern mounted on a tree, as the live scene stages it.
async function lanternFor(tree, tier = "high") {
  let prepared;
  const ready = new Promise((resolve) => {
    prepared = resolve;
  });
  const lantern = createLanternMount({ onPrepared: prepared });
  lantern.setTree(tree);
  lantern.stage(await asset("lantern", tier));
  await ready;
  lantern.take();
  return lantern;
}

function screen(camera, point, width, height) {
  const p = point.clone().project(camera);
  return { x: ((p.x + 1) * width) / 2, y: ((1 - p.y) * height) / 2, ndc: p };
}

// The watch: nothing stands on the terrace (the owner's call of 2026-10-20). As index.js stages
// it, its subject is a marker where the lookout's root stood (its posts 0.22 into the terrace),
// measured by the lookout's stored outline for the tier (opening-star.js watchMeasure()); the
// tree is measured as it stands. Every resolved form of The watch has an outline.
function watchFor(tier = "high", y = ground(0, 0) - 0.22) {
  const root = new Object3D();
  root.position.set(0, y, 0);
  root.updateMatrixWorld(true);
  const stored = watchMeasure(tier);
  const measure = (subject, shot) => {
    if (subject !== root) return measureShot(subject, shot);
    const measured = stored(subject, shot);
    assert.ok(measured, `${shot.name}: a stored ${tier} outline for ${outlineKey(shot)}`);
    return measured;
  };
  return { root, measure };
}
// The subject kind a tour shot's name belongs to.
const kindOf = (name) =>
  DIRECTED_SHOTS.watch.some((shot) => shot.name === name) ? "watch" : "tree";

for (const tier of ["high", "balanced"])
  test(`${tier} authored detail compositions stay intimate and distinct across desktop and phone`, async () => {
    const assets = {
      tree: await asset("tree", tier),
      lantern: await asset("lantern", tier),
    };
    const watch = watchFor(tier);
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
        // Maximised browsers, cut to 2.39:1, where the shots' tilt is fitted with them.
        [
          1992,
          1020,
          null,
          { hero: { left: 110, right: 434, top: 555, bottom: 828 }, nav: { top: 902 } },
        ],
        [
          1920,
          960,
          null,
          { hero: { left: 106, right: 430, top: 501, bottom: 774 }, nav: { top: 842 } },
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
          ["watch", watch],
          ["tree", tree],
        ]) {
          for (let angle = 0; angle < DIRECTED_SHOTS[kind].length; angle++) {
            const shot = resolveDirectedShot(DIRECTED_SHOTS[kind][angle], width, height);
            // The fault's shots measure themselves: their aim stays in the safe area.
            const measured = (shot.measure || watch.measure)(object.root, shot);
            const camera = new PerspectiveCamera(38, width / height, 0.1, 450);
            const controller = createCinematicCamera({
              camera,
              selected: kind,
              angle,
              getSafeArea: () => area,
              getGroundY: ground,
              measure: watch.measure,
            });
            for (const [name, subject] of [
              ["watch", watch],
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
  const watch = DIRECTED_SHOTS.watch[0];
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
    // Landscape phones keep the giant's view from the terrace, fitted from a little higher up
    // the stored outline (the short frame all sky), and drift.
    const shot = resolveDirectedShot(watch, width, height);
    assert.notEqual(shot, watch);
    assert.equal(shot.height, watch.height);
    assert.equal(shot.azimuth, watch.azimuth);
    assert.equal(shot.region, watch.landscape.region);
    assert.ok(shot.region[0] > watch.region[0]);
    // No room about the name for a move: landscape phones keep the drift.
    assert.equal(shot.move, null);
    assert.equal(shot.fov, watch.fov);
    assert.equal(resolveDirectedShot(watch, width, height), shot, "each variant is built once");
  }
  // Desktops, cut to 2.39:1 or not, take the base shot: it has no letterbox variant.
  for (const [width, height] of [
    [1440, 501],
    [2560, 1080],
    [1440, 900],
    [1024, 768],
    [1992, 1020],
  ])
    assert.equal(resolveDirectedShot(watch, width, height), watch);
  // Squarish short windows (narrower than SQUAT_LANDSCAPE) take its squat variant: aimed further
  // left, still, the star whole inside the right edge; every landscape phone is wider.
  assert.equal(SQUAT_LANDSCAPE, 1.55);
  for (const [width, height] of [
    [599, 499],
    [620, 499],
    [700, 480],
    [560, 450],
    [760, 499],
  ]) {
    const shot = resolveDirectedShot(watch, width, height);
    assert.equal(shot.azimuth, watch.squat.azimuth ?? watch.azimuth);
    assert.equal(shot.move, null);
    assert.equal(resolveDirectedShot(watch, width, height), resolveDirectedShot(watch, 700, 480));
  }
  for (const [width, height] of [
    [568, 320],
    [667, 375],
    [640, 360],
    [844, 390],
    [932, 430],
  ])
    assert.ok(width >= SQUAT_LANDSCAPE * height, `${width}x${height} is a landscape phone`);
  // A shot's tall variant reframes portrait monitors alone (the name below the subject),
  // over its portrait variant; phones and tablets, the hero stacked above, keep that one.
  // Its tablet variant, over the portrait one too, reframes stacked layouts from
  // TABLET_WIDTH wide (portrait tablets and squares up to 1024px wide) alone.
  {
    const probe = {
      name: "probe",
      azimuth: 10,
      anchor: [0.5, 0.5],
      portrait: { azimuth: 20, anchor: [0.3, 0.5] },
      tall: { anchor: [0.7, 0.4] },
    };
    const tall = resolveDirectedShot(probe, 1080, 1920);
    assert.deepEqual([tall.azimuth, tall.anchor], [20, [0.7, 0.4]]);
    assert.equal(resolveDirectedShot(probe, 1200, 1920), tall, "built once");
    for (const [width, height] of [
      [390, 844],
      [820, 1180],
      [1024, 1366],
    ])
      assert.deepEqual(resolveDirectedShot(probe, width, height).anchor, [0.3, 0.5]);
    assert.equal(resolveDirectedShot(probe, 1920, 1080).anchor, probe.anchor);
    const both = { ...probe, tablet: { anchor: [0.4, 0.6] } };
    assert.equal(TABLET_WIDTH, 600);
    const tablet = resolveDirectedShot(both, 820, 1180);
    assert.deepEqual([tablet.azimuth, tablet.anchor], [20, [0.4, 0.6]]);
    for (const [width, height] of [
      [600, 900],
      [768, 1024],
      [1024, 1366],
      [900, 900],
    ])
      assert.equal(
        resolveDirectedShot(both, width, height),
        tablet,
        `${width}x${height} built once`,
      );
    for (const [width, height, anchor] of [
      [390, 844, [0.3, 0.5]],
      [599, 900, [0.3, 0.5]],
      [560, 700, [0.3, 0.5]],
      [1080, 1920, [0.7, 0.4]],
      [700, 480, [0.3, 0.5]],
      [1920, 1080, [0.5, 0.5]],
    ])
      assert.deepEqual(
        resolveDirectedShot(both, width, height).anchor,
        anchor,
        `${width}x${height}`,
      );
  }
  // Portrait screens take the portrait variant: turned to -12 and aimed left of centre, the
  // star whole to its right. Portrait monitors keep the prior anchor so far
  // snow stays off the lower name; tablets aim a little further right.
  const portrait = resolveDirectedShot(watch, 430, 932);
  assert.equal(portrait.azimuth, watch.portrait.azimuth);
  assert.equal(portrait.azimuth, -12);
  assert.ok(portrait.anchor[0] < 0.5);
  const monitor = resolveDirectedShot(watch, 1080, 1920);
  assert.deepEqual(watch.tall, { anchor: [0.28, 0.54] });
  assert.deepEqual({ ...monitor }, { ...watch, ...watch.portrait, ...watch.tall });
  assert.deepEqual(monitor.anchor, [0.28, 0.54]);
  assert.equal(
    outlineKey(monitor),
    outlineKey(portrait),
    "an anchor never changes the stored outline",
  );
  const tablet = resolveDirectedShot(watch, 820, 1180);
  assert.deepEqual({ ...tablet }, { ...watch, ...watch.portrait, ...watch.tablet });
  assert.equal(tablet.azimuth, portrait.azimuth);
  assert.ok(tablet.anchor[0] > portrait.anchor[0] && tablet.anchor[0] < 0.5);
  assert.equal(resolveDirectedShot(watch, 768, 1024), tablet, "tablets share one variant");
  // Landscape phones under 600px wide take a compact variant: a drift, a little nearer the
  // star's bearing.
  for (const [width, height] of [
    [568, 320],
    [599, 360],
  ]) {
    const shot = resolveDirectedShot(watch, width, height);
    assert.equal(shot.azimuth, watch.compact.azimuth ?? watch.azimuth);
    assert.equal(shot.move, null);
    assert.equal(resolveDirectedShot(watch, width, height), shot);
  }
  // Shots with a move give landscape phones a drift-only variant: Portrait and
  // Close-up; under 600px wide, without a compact variant, Portrait keeps its own.
  for (const [shot, width, height] of [
    [DIRECTED_SHOTS.tree[0], 568, 320],
    [DIRECTED_SHOTS.tree[2], 844, 390],
  ]) {
    const resolved = resolveDirectedShot(shot, width, height);
    assert.equal(resolved, shot.landscape ? resolveDirectedShot(shot, 932, 430) : shot);
    assert.equal(resolved.move, null, `${shot.name} ${width}x${height}`);
  }
});

test("every moving shot holds still on landscape phones and keeps a move on desktops and portrait", () => {
  for (const shot of [...DIRECTED_SHOTS.watch, ...DIRECTED_SHOTS.tree]) {
    if (!shot.move) {
      // Shots outside the tour keep the old drift everywhere.
      assert.equal(shot.tour, false, `${shot.name} is in the tour without a move`);
      continue;
    }
    for (const [width, height] of [
      [844, 390],
      [932, 430],
      [667, 375],
      [568, 320],
    ])
      assert.equal(
        resolveDirectedShot(shot, width, height).move,
        null,
        `${shot.name} ${width}x${height}`,
      );
    for (const [width, height] of [
      [1440, 900],
      [2560, 1080],
      [1440, 501],
      [390, 844],
      [1080, 1920],
    ])
      assert.ok(resolveDirectedShot(shot, width, height).move, `${shot.name} ${width}x${height}`);
  }
  // Phones and portrait monitors take moves without a sideways truck: this
  // close, a truck takes the lens into the trunk.
  for (const shot of DIRECTED_SHOTS.tree.filter((s) => s.move))
    for (const [width, height] of [
      [390, 844],
      [1080, 1920],
    ])
      assert.equal(
        resolveDirectedShot(shot, width, height).move.truck,
        undefined,
        `${shot.name} ${width}x${height}`,
      );
});

// Hero text and bottom bar measured from the live page at each size (2026-10-15: the hero's
// layout box and the bottom bar's rect, as the scene reads them).
const LAYOUTS = [
  {
    width: 390,
    height: 844,
    hero: { left: 12, right: 299, top: 34, bottom: 177 },
    nav: { top: 766 },
  },
  {
    width: 450,
    height: 800,
    hero: { left: 12, right: 302, top: 34, bottom: 194 },
    nav: { top: 722 },
  },
  // A portrait tablet (measured 2026-10-15): the name stacked above the subject, as on
  // phones, in a wider frame.
  {
    width: 820,
    height: 1180,
    hero: { left: 16, right: 323, top: 48, bottom: 226 },
    nav: { top: 1098 },
  },
  {
    width: 844,
    height: 390,
    hero: { left: 16, right: 262, top: 12, bottom: 138 },
    nav: { top: 316 },
  },
  {
    width: 1440,
    height: 900,
    hero: { left: 130, right: 454, top: 447, bottom: 720 },
    nav: { top: 818 },
  },
  {
    width: 1600,
    height: 900,
    hero: { left: 210, right: 534, top: 447, bottom: 720 },
    nav: { top: 818 },
  },
  {
    width: 2560,
    height: 1080,
    hero: { left: 141, right: 465, top: 613, bottom: 886 },
    nav: { top: 998 },
  },
  // Maximised browsers: a 1080p desktop and a wider window, where The watch tilts up; a 16:9
  // window, a MacBook and a 125%-scaled laptop, where it keeps level.
  {
    width: 1992,
    height: 1020,
    hero: { left: 110, right: 434, top: 555, bottom: 828 },
    nav: { top: 938 },
  },
  {
    width: 1920,
    height: 960,
    hero: { left: 106, right: 430, top: 501, bottom: 774 },
    nav: { top: 878 },
  },
  {
    width: 1680,
    height: 950,
    hero: { left: 250, right: 574, top: 492, bottom: 765 },
    nav: { top: 868 },
  },
  {
    width: 1440,
    height: 800,
    hero: { left: 130, right: 454, top: 357, bottom: 630 },
    nav: { top: 718 },
  },
  {
    width: 1536,
    height: 730,
    hero: { left: 178, right: 502, top: 294, bottom: 567 },
    nav: { top: 648 },
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
  // A squarish short window: the name top left beside the subject, which takes
  // a shot's squat framing (or its portrait one).
  {
    width: 700,
    height: 480,
    hero: { left: 16, right: 261, top: 12, bottom: 148 },
    nav: { top: 406 },
  },
  // 4:3 and 5:4 screens, landscape iPads and taller 16:10 windows (the hero measured
  // 2026-10-12): deep bars, and the longest reaches from a subject. Measured for The watch
  // (`giant`); the tree's shots keep their framings there as they were, and Close-up's far snow
  // can stand behind the name on 5:4 and landscape-iPad screens.
  ...[
    [1024, 768, 16, 283, 381, 601],
    [1280, 1024, 50, 355, 564, 832],
    [1180, 820, 16, 297, 400, 648],
    [1366, 1024, 93, 417, 559, 832],
    [1680, 1050, 250, 574, 583, 856],
    [1920, 1200, 106, 430, 733, 1006],
    [1280, 800, 50, 355, 362, 630],
  ].map(([width, height, left, right, top, bottom]) => ({
    width,
    height,
    hero: { left, right, top, bottom },
    nav: { top: height - 82 },
    giant: true,
  })),
];

const PHASES = [0, 0.5, 1];
// The giant under the milky sky (the owner's direction of 2026-10-11), looking up from the
// terrace; the tree's shots keep their own framings by the water (the owner's call of
// 2026-10-12).
const GIANTS = Object.freeze(["The watch"]);

// The film mountains follow the camera, so their framing depends only on where each
// directed shot puts it: fit The watch's stored outline and the real tree, then project the
// crest line.
// These are the five procedural rings, which land when a Meshy massif cannot load;
// the massifs' own framing follows.
test("the camera-centred ranges frame every tour shot: sun, tree shots, phones and the name", async () => {
  const window = { BabelSite: {} };
  vm.runInNewContext(await readFile(new URL("../src/scene/world.js", import.meta.url), "utf8"), {
    window,
  });
  const { SUN_POSITION, CAMERA_FAR } = window.BabelSite.scene.WORLD,
    sun = new Vector3(...SUN_POSITION);
  const assets = { tree: await asset("tree") };
  const watch = watchFor();
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
  // The lantern stands by the tree as live: the lantern shots fit it alone.
  const lantern = await lanternFor(tree);
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
        portrait = height > width,
        // What the bars cover is hidden.
        bar = letterboxShare(width, height) * height;
      for (const name of coastalTourOrder) {
        const kind = kindOf(name),
          angle = DIRECTED_SHOTS[kind].findIndex((shot) => shot.name === name);
        const camera = new PerspectiveCamera(38, width / height, 0.1, CAMERA_FAR);
        const controller = createCinematicCamera({
          camera,
          selected: kind,
          angle,
          getSafeArea: () => cinematicSafeArea(width, height, hero, nav),
          getGroundY: ground,
          measure: watch.measure,
        });
        for (const [subject, object] of [
          ["watch", watch],
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
          if (
            (desktop || (name === "The watch" && height < 500)) &&
            (!layout.giant || GIANTS.includes(name))
          )
            for (let v = 0; v < terrain.count; v++) {
              if (!snowReach(elevationOf(v), terrain.getW(v))) continue;
              const p = screen(vertex(v));
              assert.ok(
                p.depth <= 0 ||
                  p.x < hero.left ||
                  p.x > hero.right ||
                  p.y < Math.max(hero.top, bar) ||
                  p.y > Math.min(hero.bottom, height - bar),
                label + " puts snow behind the name",
              );
            }
          // Under the milky sky: on landscape desktops the giant looks up from the terrace, the
          // horizon below the name. (A portrait monitor sets the name under it.)
          if (desktop && !portrait && GIANTS.includes(name)) {
            const forward = camera.getWorldDirection(new Vector3()).setY(0).normalize();
            const level = screen(forward.multiplyScalar(1000).add(camera.position));
            assert.ok(
              level.depth > 0 && level.y > hero.bottom,
              `${label} horizon at ${level.y.toFixed(0)} px, above the name's foot (${hero.bottom})`,
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
    lantern.dispose();
    scale.dispose();
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
test("the Meshy massifs frame every tour shot: sun, open sky over the tree, phones and the name", async () => {
  const window = { BabelSite: {} };
  vm.runInNewContext(await readFile(new URL("../src/scene/world.js", import.meta.url), "utf8"), {
    window,
  });
  const { SUN_POSITION, CAMERA_FAR } = window.BabelSite.scene.WORLD,
    sun = new Vector3(...SUN_POSITION);
  const assets = { tree: await asset("tree") };
  const watch = watchFor();
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
  // The lantern stands by the tree as live: the lantern shots fit it alone.
  const lantern = await lanternFor(tree);
  const treePoints = [];
  tree.root.traverse((o) => {
    if (!o.isMesh) return;
    const p = o.geometry.attributes.position;
    for (let i = 0; i < p.count; i++)
      treePoints.push(new Vector3().fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld));
  });
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
        portrait = height > width,
        // What the bars cover is hidden.
        bar = letterboxShare(width, height) * height;
      for (const name of coastalTourOrder) {
        const kind = kindOf(name),
          angle = DIRECTED_SHOTS[kind].findIndex((shot) => shot.name === name);
        const camera = new PerspectiveCamera(38, width / height, 0.1, CAMERA_FAR);
        const controller = createCinematicCamera({
          camera,
          selected: kind,
          angle,
          getSafeArea: () => cinematicSafeArea(width, height, hero, nav),
          getGroundY: ground,
          measure: watch.measure,
        });
        for (const [subject, object] of [
          ["watch", watch],
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
          if (
            (desktop || (name === "The watch" && height < 500)) &&
            (!layout.giant || GIANTS.includes(name))
          )
            for (const point of snowy) {
              const p = screen(point.clone().add(camera.position));
              assert.ok(
                p.depth <= 0 ||
                  p.x < hero.left ||
                  p.x > hero.right ||
                  p.y < Math.max(hero.top, bar) ||
                  p.y > Math.min(hero.bottom, height - bar),
                label + " puts snow behind the name",
              );
            }
          // Under the milky sky: on landscape desktops the giant looks up from the terrace, the
          // horizon below the name. (A portrait monitor sets the name under it.)
          if (desktop && !portrait && GIANTS.includes(name)) {
            const forward = camera.getWorldDirection(new Vector3()).setY(0).normalize();
            const level = screen(forward.multiplyScalar(1000).add(camera.position));
            assert.ok(
              level.depth > 0 && level.y > hero.bottom,
              `${label} horizon at ${level.y.toFixed(0)} px, above the name's foot (${hero.bottom})`,
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
          // No silhouette merges with the snow behind it (the owner's composition
          // pass of 2026-10-08): a coarse screen grid of a model's vertices, a cell
          // either way of slack.
          const cell = 6,
            columns = Math.ceil(width / cell),
            rows = Math.ceil(height / cell),
            cellOf = (p) =>
              p.depth > 0 && p.x >= 0 && p.x < width && p.y >= 0 && p.y < height
                ? Math.floor(p.y / cell) * columns + Math.floor(p.x / cell)
                : -1,
            cover = (points, slack = 0) => {
              const cells = new Set();
              for (const point of points) {
                const p = screen(point);
                if (p.depth <= 0 || p.x < 0 || p.x >= width || p.y < 0 || p.y >= height) continue;
                const cx = Math.floor(p.x / cell),
                  cy = Math.floor(p.y / cell);
                for (let y = Math.max(0, cy - slack); y <= Math.min(rows - 1, cy + slack); y++)
                  for (let x = Math.max(0, cx - slack); x <= Math.min(columns - 1, cx + slack); x++)
                    cells.add(y * columns + x);
              }
              return cells;
            };
          if (name === "Portrait") {
            // The crown meets open cloud: no massif's snow behind the tree (the
            // procedural backdrop rings behind them are hazed, and not counted).
            const crown = cover(treePoints, 1);
            assert.ok(crown.size > 0, `${label} shows the tree`);
            let behind = 0;
            for (const point of snowy) {
              if (crown.has(cellOf(screen(point.clone().add(camera.position))))) behind++;
            }
            assert.equal(behind, 0, `${label} shows snow behind the crown`);
          }
        }
        controller.dispose();
      }
    }
  } finally {
    Object.values(composed.geometries).forEach((geometry) => geometry.dispose());
    lantern.dispose();
    scale.dispose();
    tree.dispose();
    for (const item of Object.values(assets))
      item.scene.traverse((mesh) => {
        mesh.geometry?.dispose();
        mesh.material?.dispose();
      });
  }
});

// Under the milky sky (the owner's direction of 2026-10-11). On every measured layout and
// through every move of every tour shot: the lens never leaves the sky's reach (each ray through
// the picture meets the sky shell, so its rim never shows), and the star stands whole, clear of
// the text and unhidden by the tree, or out of frame. The giant also keeps its lens clear of the
// tree and the tree out of its picture, and on landscape desktops looks up (at least 15 degrees)
// at the stored outline it frames, the outline on the right of the frame, the name in the open
// sky on its left.
test("under the milky sky The watch looks up, and every tour shot keeps the star whole or absent", async () => {
  const window = { BabelSite: {} };
  vm.runInNewContext(await readFile(new URL("../src/scene/world.js", import.meta.url), "utf8"), {
    window,
  });
  const { SUN_POSITION, CAMERA_FAR, SKY_DOME_RADIUS } = window.BabelSite.scene.WORLD,
    sun = new Vector3(...SUN_POSITION);
  const assets = { tree: await asset("tree") };
  const watch = watchFor();
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
  const lantern = await lanternFor(tree);
  tree.root.updateMatrixWorld(true);
  tree.root.traverse((o) => {
    if (o.isMesh) o.material.side = DoubleSide;
  });
  const rad = Math.PI / 180;
  // The tree's vertices (not the lantern's), for the giant's lens clearance.
  const solid = [];
  for (const root of [tree.root])
    root.traverse((mesh) => {
      if (!mesh.isMesh || /lantern/i.test(mesh.name) || /lantern/i.test(mesh.parent?.name ?? ""))
        return;
      const p = mesh.geometry.attributes.position;
      for (let i = 0; i < p.count; i++)
        solid.push(new Vector3().fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld));
    });
  const nearest = (o) => Math.sqrt(Math.min(...solid.map((v) => v.distanceToSquared(o))));
  // Each landmark's vertices, flat, so a frame can look for the other landmark in its picture.
  const flatten = (root) => {
    const out = [];
    root.traverse((mesh) => {
      if (!mesh.isMesh || /lantern/i.test(mesh.name) || /lantern/i.test(mesh.parent?.name ?? ""))
        return;
      const p = mesh.geometry.attributes.position,
        v = new Vector3();
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld);
        out.push(v.x, v.y, v.z);
      }
    });
    return new Float32Array(out);
  };
  const landmarks = { tree: flatten(tree.root) };
  try {
    for (const { width, height, hero, nav } of LAYOUTS) {
      const landscapeDesktop = width >= 1000 && width > height && height > 500,
        bar = letterboxShare(width, height) * height;
      for (const name of coastalTourOrder) {
        const kind = kindOf(name),
          angle = DIRECTED_SHOTS[kind].findIndex((shot) => shot.name === name);
        const camera = new PerspectiveCamera(38, width / height, 0.1, CAMERA_FAR);
        const controller = createCinematicCamera({
          camera,
          selected: kind,
          angle,
          getSafeArea: () => cinematicSafeArea(width, height, hero, nav),
          getGroundY: ground,
          measure: watch.measure,
        });
        for (const [subject, object] of [
          ["watch", watch],
          ["tree", tree],
        ]) {
          controller.setSubject(subject, object.root);
          controller.setStatus({ kind: subject, status: "ready" });
        }
        const shot = resolveDirectedShot(DIRECTED_SHOTS[kind][angle], width, height),
          measured = watch.measure(kind === "tree" ? tree.root : watch.root, shot);
        for (const tourPhase of [0, 0.25, 0.5, 0.75, 1]) {
          controller.apply({ width, height, tourPhase });
          camera.updateMatrixWorld(true);
          const label = `${name} ${width}x${height} phase ${tourPhase}`;
          const screen = (point) => {
            const depth = -point.clone().applyMatrix4(camera.matrixWorldInverse).z,
              p = point.clone().project(camera);
            return { x: ((p.x + 1) * width) / 2, y: ((1 - p.y) * height) / 2, depth };
          };
          const giant = GIANTS.includes(name);
          if (giant) assert.ok(nearest(camera.position) >= 6, `${label} lens inside the tree`);
          // The giant is the sky's: the tree never stands in its picture (between the bars).
          // The fault's shots show it neither: they are the coast's own.
          const coast = COAST_SHOTS.some((shot) => shot.name === name);
          for (const other of giant || coast ? [landmarks.tree] : []) {
            const m = new Matrix4().multiplyMatrices(
                camera.projectionMatrix,
                camera.matrixWorldInverse,
              ).elements,
              top = 1 - (2 * bar) / height;
            let shown = 0,
              where = "";
            for (let i = 0; i < other.length; i += 3) {
              const x = other[i],
                y = other[i + 1],
                z = other[i + 2],
                w = m[3] * x + m[7] * y + m[11] * z + m[15];
              if (w <= 0) continue;
              const nx = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w,
                ny = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w;
              if (Math.abs(nx) < 1 && Math.abs(ny) < top) {
                shown++;
                where = `${nx.toFixed(3)},${ny.toFixed(3)}`;
              }
            }
            assert.equal(shown, 0, `${label} shows the tree (${shown}, at ${where})`);
          }
          // The sky shell's rim never shows.
          for (let gy = 0; gy <= 6; gy++)
            for (let gx = 0; gx <= 6; gx++) {
              const y = bar + ((height - 2 * bar) * gy) / 6;
              const d = new Vector3((gx / 6) * 2 - 1, 1 - (y / height) * 2, 0.5)
                .unproject(camera)
                .sub(camera.position)
                .normalize();
              const b = camera.position.dot(d),
                disc = b * b - (camera.position.lengthSq() - SKY_DOME_RADIUS ** 2);
              assert.ok(disc > 0 && Math.sqrt(disc) - b > 0, `${label} looks past the sky shell`);
            }
          // The star: whole and clear, or out of frame.
          const s = screen(sun),
            radius = (((4.2 * camera.projectionMatrix.elements[5]) / s.depth) * height) / 2;
          const out =
            s.depth <= 0 ||
            s.x + radius < 0 ||
            s.x - radius > width ||
            s.y + radius < bar ||
            s.y - radius > height - bar;
          if (!out) {
            assert.ok(
              s.x - radius > 10 &&
                s.x + radius < width - 10 &&
                s.y - radius > bar + 10 &&
                s.y + radius < Math.min(nav.top, height - bar) - 10,
              label + " crops the star",
            );
            const text = Math.hypot(
              s.x - Math.max(hero.left, Math.min(s.x, hero.right)),
              s.y - Math.max(hero.top, Math.min(s.y, hero.bottom)),
            );
            assert.ok(
              text > (radius * SOLAR_GLOW_RADIUS) / 4.2 + 4,
              label + " star glow on the text",
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
                ray.intersectObjects([tree.root], true).length,
                0,
                label + " hides the star",
              );
            }
          }
          if (!landscapeDesktop || !GIANTS.includes(name)) continue;
          // Looking up at the giant's outline, the outline on the right.
          const forward = camera.getWorldDirection(new Vector3());
          const pitch = Math.atan2(forward.y, Math.hypot(forward.x, forward.z)) / rad;
          assert.ok(pitch >= 15, `${label} looks up only ${pitch.toFixed(1)} degrees`);
          let left = Infinity,
            right = -Infinity;
          for (let i = 0; i < measured.points.length; i += 3) {
            const p = screen(new Vector3().fromArray(measured.points, i));
            left = Math.min(left, p.x);
            right = Math.max(right, p.x);
          }
          assert.ok((left + right) / 2 > width / 2, `${label} giant left of centre`);
          assert.ok(left > hero.right, `${label} giant behind the name`);
        }
        controller.dispose();
      }
    }
  } finally {
    lantern.dispose();
    scale.dispose();
    tree.dispose();
    for (const item of Object.values(assets))
      item.scene.traverse((mesh) => {
        mesh.geometry?.dispose();
        mesh.material?.dispose();
      });
  }
});

for (const tier of ["high", "balanced"])
  test(tier + " The watch frames the fixed sun whole and clear of the text", async () => {
    const window = { BabelSite: {} };
    vm.runInNewContext(await readFile(new URL("../src/scene/world.js", import.meta.url), "utf8"), {
      window,
    });
    const sun = new Vector3(...window.BabelSite.scene.WORLD.SUN_POSITION);
    // Ground at origin 2.9, ground root offset -6.8, the lookout's footing overlap -0.22.
    const watch = watchFor(tier, 2.9 - 6.8 - 0.22);
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
    // The watch frames the sun: the whole corona, uncropped and clear of the name, through
    // its breath and its tour move. (Any other shot on the watch's list would either leave it
    // wholly out of frame or show all of it so.)
    for (const layout of layouts)
      for (let angle = 0; angle < DIRECTED_SHOTS.watch.length; angle++) {
        const { width, height, hero, nav } = layout;
        const camera = new PerspectiveCamera(
          38,
          width / height,
          0.1,
          window.BabelSite.scene.WORLD.CAMERA_FAR,
        );
        const controller = createCinematicCamera({
          camera,
          selected: "watch",
          angle,
          getSafeArea: () => cinematicSafeArea(width, height, hero, nav),
          measure: watch.measure,
        });
        controller.setSubject("watch", watch.root);
        controller.setStatus({ kind: "watch", status: "ready" });
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
            DIRECTED_SHOTS.watch[angle].name +
            " " +
            width +
            "x" +
            height +
            " " +
            JSON.stringify(sample);
          // Widescreen bars cover the frame's top and bottom: the star must sit
          // whole between them, or wholly behind them.
          const bar = letterboxShare(width, height) * height;
          const outOfFrame =
            depth <= 0 ||
            x + radius < 0 ||
            x - radius > width ||
            y + radius < bar ||
            y - radius > height - bar;
          if (angle > 0 && outOfFrame) continue;
          assert.ok(depth > 0 && depth < camera.far, label + " depth");
          assert.ok(
            x - radius > 10 &&
              x + radius < width - 10 &&
              y - radius > bar + 10 &&
              y + radius < Math.min(nav.top, height - bar) - 10,
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
          // Its glow, out to its furthest reach, stays clear of the text too.
          const glow = (radius * SOLAR_GLOW_RADIUS) / 4.2;
          assert.ok(
            textDistance > glow + 4,
            label + " glow approaches text: " + (textDistance - glow),
          );
        }
        controller.dispose();
      }
  });

// The lantern's assembly on the tree: its model, its light and the light's streak.
const inLantern = (object) => {
  for (let node = object; node; node = node.parent) if (/lantern/i.test(node.name)) return true;
  return false;
};

// Portrait on upright and squat screens (its portrait, tablet, tall and squat variants; the
// reviews of 2026-10-14 and 2026-10-15), through its whole push in 24 steps: the root never
// hides the lantern's flame, and no snow (a Meshy massif's or the backdrop rings', at its mean
// snowline and above the nearer layers' skyline) meets a side edge, where the frame would cut
// a snowy summit. On phones (the owner's rule: the lantern first) the root hides none of the
// lantern's glass, and no part of the tree, in front or behind, comes within 2 CSS px of the
// flame, where its edge would run through it.
test("Portrait on upright and squat screens keeps the lantern and the snowy summits clear through its push", async () => {
  const world = { BabelSite: {} };
  vm.runInNewContext(await readFile(new URL("../src/scene/world.js", import.meta.url), "utf8"), {
    window: world,
  });
  const { CAMERA_FAR } = world.BabelSite.scene.WORLD;
  const assets = { tree: await asset("tree") };
  const watch = watchFor();
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
  const lantern = await lanternFor(tree);
  groundRoot.updateMatrixWorld(true);
  let lanternRoot = null;
  groundRoot.traverse((object) => {
    if (!lanternRoot && object.name === "supplied-meshy-lantern") lanternRoot = object;
  });
  assert.ok(lanternRoot, "the lantern stands by the tree");
  // The flame's body, its lower quarter to its tip.
  const flame = [0.25, 0.5, 0.75, 1].map((share) =>
    lanternRoot.localToWorld(new Vector3(0, FLAME.base + share * FLAME.height, 0)),
  );
  const solid = [],
    lanternMeshes = [],
    lanternPoints = [];
  tree.root.traverse((mesh) => {
    if (!mesh.isMesh || inLantern(mesh)) return;
    mesh.material.side = DoubleSide;
    solid.push(mesh);
  });
  lanternRoot.traverse((mesh) => {
    if (!mesh.isMesh) return;
    mesh.material.side = DoubleSide;
    lanternMeshes.push(mesh);
    const p = mesh.geometry.attributes.position;
    for (let i = 0; i < p.count; i += 7)
      lanternPoints.push(new Vector3().fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld));
  });
  // The massifs' snow that can show: each vertex over its mean snowline (the shader's noise
  // and gully tongues average out about it) and above every nearer layer's skyline.
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
    rad = Math.PI / 180;
  const nearer = (layer, azimuth) => {
    let top = -90;
    for (const { placement, sky } of composed.placed) {
      if (placement.layer >= layer) continue;
      const bin = Math.floor(((((azimuth - sky.from) % 360) + 360) % 360) / RANGE_SKY.bin);
      if (bin < sky.values.length) top = Math.max(top, sky.values[bin]);
    }
    return top;
  };
  const snow = [];
  for (const geometry of Object.values(composed.geometries)) {
    const p = geometry.attributes.position,
      terrain = geometry.attributes.aTerrain;
    for (let v = 0; v < p.count; v++) {
      const line = terrain.getZ(v),
        massif = terrain.getW(v);
      if (!line) continue;
      const elevation = Math.atan2(p.getY(v), Math.hypot(p.getX(v), p.getZ(v))) / rad,
        cap = Math.min(MASSIF_SNOW.max, Math.max(0, (massif - line) * MASSIF_SNOW.depth));
      if (cap <= 0.001 || elevation <= massif - cap) continue;
      if (elevation > nearer(terrain.getY(v), Math.atan2(p.getZ(v), p.getX(v)) / rad))
        snow.push(new Vector3(p.getX(v), p.getY(v), p.getZ(v)));
    }
  }
  assert.ok(snow.length > 500, "the massifs carry snow");
  // The backdrop rings' snow (the rings' own rule), where it stands above every massif.
  const rings = createMountainGeometry({ backdrop: RANGE_BACKDROP, nearer: composed.nearer });
  {
    const p = rings.attributes.position,
      terrain = rings.attributes.aTerrain;
    let count = 0;
    for (let v = 0; v < p.count; v++) {
      const massif = terrain.getW(v),
        elevation = Math.atan2(p.getY(v), Math.hypot(p.getX(v), p.getZ(v))) / rad,
        cap = Math.min(SNOW.max, Math.max(0, (massif - SNOW.line) * SNOW.depth));
      if (cap <= 0.001 || elevation <= massif - cap) continue;
      if (elevation > nearer(Infinity, Math.atan2(p.getZ(v), p.getX(v)) / rad)) {
        snow.push(new Vector3(p.getX(v), p.getY(v), p.getZ(v)));
        count++;
      }
    }
    assert.ok(count > 30, "the backdrop rings carry snow");
  }
  const upright = LAYOUTS.filter(({ width, height }) =>
    ["390x844", "450x800", "820x1180", "1080x1920", "700x480"].includes(`${width}x${height}`),
  );
  assert.equal(upright.length, 5);
  const phone = (width, height) => height > width && width < TABLET_WIDTH;
  const layouts = [
    ...upright,
    {
      width: 430,
      height: 932,
      hero: { left: 12, right: 301, top: 34, bottom: 189 },
      nav: { top: 854 },
    },
    // A phone with its browser's bars showing.
    {
      width: 390,
      height: 664,
      hero: { left: 12, right: 299, top: 34, bottom: 177 },
      nav: { top: 586 },
    },
    {
      width: 599,
      height: 499,
      hero: { left: 12, right: 254, top: 12, bottom: 151 },
      nav: { top: 425 },
    },
    {
      width: 560,
      height: 450,
      hero: { left: 12, right: 253, top: 12, bottom: 143 },
      nav: { top: 376 },
    },
  ];
  const caster = new Raycaster(),
    edge = 6;
  try {
    for (const { width, height, hero, nav } of layouts) {
      const camera = new PerspectiveCamera(38, width / height, 0.1, CAMERA_FAR);
      const controller = createCinematicCamera({
        camera,
        selected: "tree",
        angle: 0,
        getSafeArea: () => cinematicSafeArea(width, height, hero, nav),
        getGroundY: ground,
        measure: watch.measure,
      });
      for (const [subject, object] of [
        ["watch", watch],
        ["tree", tree],
      ]) {
        controller.setSubject(subject, object.root);
        controller.setStatus({ kind: subject, status: "ready" });
      }
      for (let step = 0; step <= 24; step++) {
        const tourPhase = step / 24;
        controller.apply({ width, height, tourPhase });
        camera.updateMatrixWorld(true);
        const label = `Portrait ${width}x${height} phase ${tourPhase.toFixed(3)}`;
        assert.equal(controller.shot.name, "Portrait");
        for (const point of flame) {
          const toward = point.clone().sub(camera.position);
          caster.set(camera.position, toward.clone().normalize());
          caster.far = toward.length();
          assert.equal(
            caster.intersectObjects(solid, false).length,
            0,
            `${label}: the root hides the lantern's flame`,
          );
        }
        if (phone(width, height)) {
          const screen = (point) => {
            const p = point.clone().project(camera);
            return { x: ((p.x + 1) * width) / 2, y: ((1 - p.y) * height) / 2 };
          };
          const through = (x, y) =>
            caster.setFromCamera({ x: (x / width) * 2 - 1, y: 1 - (y / height) * 2 }, camera);
          caster.far = Infinity;
          // The glass: its band, from an eighth of the lantern's height above its foot to a
          // quarter below its top, sampled on a grid; where a ray meets the lantern, no
          // part of the tree comes first.
          const box = lanternPoints.map(screen),
            left = Math.min(...box.map((p) => p.x)),
            right = Math.max(...box.map((p) => p.x)),
            top = Math.min(...box.map((p) => p.y)),
            foot = Math.max(...box.map((p) => p.y)),
            tall = foot - top;
          for (let row = 0; row <= 4; row++)
            for (let column = 0; column <= 6; column++) {
              through(
                left + ((right - left) * column) / 6,
                foot - tall * (0.12 + (0.63 * row) / 4),
              );
              const glass = caster.intersectObjects(lanternMeshes, false)[0];
              if (!glass) continue;
              caster.far = glass.distance;
              assert.equal(
                caster.intersectObjects(solid, false).length,
                0,
                `${label}: the root hides the lantern's glass`,
              );
              caster.far = Infinity;
            }
          // The flame: no part of the tree, in front or behind, within 2 CSS px of it.
          for (const point of flame) {
            const { x, y } = screen(point);
            for (let k = 0; k <= 8; k++) {
              const a = (k * Math.PI) / 4,
                r = k === 8 ? 0 : 2;
              through(x + r * Math.cos(a), y + r * Math.sin(a));
              assert.equal(
                caster.intersectObjects(solid, false).length,
                0,
                `${label}: the tree's edge runs within 2 px of the lantern's flame`,
              );
            }
          }
        }
        for (const point of snow) {
          const p = point.clone().add(camera.position);
          if (p.clone().applyMatrix4(camera.matrixWorldInverse).z >= 0) continue;
          p.project(camera);
          const x = ((p.x + 1) * width) / 2,
            y = ((1 - p.y) * height) / 2;
          assert.ok(
            y < 0 || y > height || (Math.abs(x) > edge && Math.abs(x - width) > edge),
            `${label}: a side edge cuts a summit's snow at ${x.toFixed(0)},${y.toFixed(0)}`,
          );
        }
      }
      controller.dispose();
    }
  } finally {
    rings.dispose();
    Object.values(composed.geometries).forEach((geometry) => geometry.dispose());
    lantern.dispose();
    scale.dispose();
    tree.dispose();
    for (const item of Object.values(assets))
      item.scene.traverse((mesh) => {
        mesh.geometry?.dispose();
        mesh.material?.dispose();
      });
  }
});

// The crown on the wider upright screens (the review of 2026-10-14), through its tour move in 24
// steps: on a portrait monitor Close-up keeps the tree out of the name.
test("the crown keeps the name clear on portrait monitors", async () => {
  const world = { BabelSite: {} };
  vm.runInNewContext(await readFile(new URL("../src/scene/world.js", import.meta.url), "utf8"), {
    window: world,
  });
  const { CAMERA_FAR } = world.BabelSite.scene.WORLD;
  const assets = { tree: await asset("tree") };
  const watch = watchFor();
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
  const lantern = await lanternFor(tree);
  const points = (root, keep = () => true) => {
    const out = [];
    root.updateMatrixWorld(true);
    root.traverse((mesh) => {
      if (!mesh.isMesh || !keep(mesh)) return;
      const p = mesh.geometry.attributes.position;
      for (let i = 0; i < p.count; i++)
        out.push(new Vector3().fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld));
    });
    return out;
  };
  const crown = points(tree.root, (mesh) => !inLantern(mesh));
  const at = (width, height) => LAYOUTS.find((l) => l.width === width && l.height === height);
  const checks = [
    {
      name: "Close-up",
      layout: at(1080, 1920),
      subject: crown,
      fails: (p, { hero }) =>
        p.x >= hero.left && p.x <= hero.left + 170 && p.y >= hero.top && p.y <= hero.top + 180,
      why: (p) => `the tree at ${p.x.toFixed(0)},${p.y.toFixed(0)} in the name`,
    },
  ];
  try {
    for (const { name, layout, subject, fails, why } of checks) {
      const { width, height, hero, nav } = layout;
      const kind = kindOf(name),
        angle = DIRECTED_SHOTS[kind].findIndex((shot) => shot.name === name);
      const camera = new PerspectiveCamera(38, width / height, 0.1, CAMERA_FAR);
      const controller = createCinematicCamera({
        camera,
        selected: kind,
        angle,
        getSafeArea: () => cinematicSafeArea(width, height, hero, nav),
        getGroundY: ground,
        measure: watch.measure,
      });
      for (const [k, object] of [
        ["watch", watch],
        ["tree", tree],
      ]) {
        controller.setSubject(k, object.root);
        controller.setStatus({ kind: k, status: "ready" });
      }
      for (let step = 0; step <= 24; step++) {
        const tourPhase = step / 24;
        controller.apply({ width, height, tourPhase });
        camera.updateMatrixWorld(true);
        for (const point of subject) {
          const p = point.clone().project(camera);
          if (p.z > 1) continue;
          const s = { x: ((p.x + 1) * width) / 2, y: ((1 - p.y) * height) / 2 };
          if (s.y < 0 || s.y > height) continue;
          assert.ok(
            !fails(s, layout),
            `${name} ${width}x${height} phase ${tourPhase.toFixed(3)}: ${why(s, layout)}`,
          );
        }
      }
      controller.dispose();
    }
  } finally {
    lantern.dispose();
    scale.dispose();
    tree.dispose();
    for (const item of Object.values(assets))
      item.scene.traverse((mesh) => {
        mesh.geometry?.dispose();
        mesh.material?.dispose();
      });
  }
});

// The text on a portrait monitor (the review of 2026-10-15): through each tour move in 24
// steps, Close-up's tree keeps 24 CSS px or more off the whole text block, the name's two lines
// and the intro, and no crest of the ranges (each massif's where it rises over the nearer layers,
// and the skyline with the backdrop rings) runs through a letter.
// The letters' ink as measured on 1080x1920 (relative to the hero's box): per letter or run of
// letters [left, right, top, bottom], the tops their real glyph tops.
const MONITOR_LETTERS = [
  [-2, 22, 26, 70],
  [22, 40, 14, 70],
  [40, 60, 31, 70],
  [60, 78, 6, 70],
  [78, 160, 34, 70],
  [0, 56, 110, 166],
  [56, 170, 129, 166],
  [0, 268, 212, 226],
];
test("Close-up keeps the tree and the crests off the text on portrait monitors", async () => {
  const world = { BabelSite: {} };
  vm.runInNewContext(await readFile(new URL("../src/scene/world.js", import.meta.url), "utf8"), {
    window: world,
  });
  const { CAMERA_FAR } = world.BabelSite.scene.WORLD;
  const assets = { tree: await asset("tree") };
  const watch = watchFor();
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
  const lantern = await lanternFor(tree);
  groundRoot.updateMatrixWorld(true);
  const meshes = (root, keep = () => true) => {
    const out = [];
    root.traverse((mesh) => {
      if (!mesh.isMesh || !keep(mesh)) return;
      mesh.material.side = DoubleSide;
      out.push(mesh);
    });
    return out;
  };
  const subjects = {
    "Close-up": meshes(tree.root, (mesh) => !inLantern(mesh)),
  };
  // The crests: every massif copy's where it stands over the nearer layers, and the skyline
  // (the highest of them all and of the backdrop rings) per bin of azimuth.
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
  const nearer = (layer, azimuth) => {
    let top = -90;
    for (const { placement, sky } of composed.placed) {
      if (placement.layer >= layer) continue;
      const bin = Math.floor(((((azimuth - sky.from) % 360) + 360) % 360) / RANGE_SKY.bin);
      if (bin < sky.values.length) top = Math.max(top, sky.values[bin]);
    }
    return top;
  };
  const bins = Math.round(360 / RANGE_SKY.bin),
    highest = new Float32Array(bins).fill(-90),
    crests = [];
  for (const { placement, sky } of composed.placed)
    sky.values.forEach((e, j) => {
      if (e <= -90) return;
      const azimuth = sky.from + (j + 0.5) * RANGE_SKY.bin,
        bin = Math.floor((((azimuth % 360) + 360) % 360) / RANGE_SKY.bin) % bins;
      highest[bin] = Math.max(highest[bin], e);
      if (e > nearer(placement.layer, azimuth)) crests.push(direction(azimuth, e));
    });
  for (const range of RANGE_BACKDROP.ranges)
    backdrop[range].forEach((e, j) => {
      const from = (j / MOUNTAINS.columns) * 360,
        to = ((j + 1) / MOUNTAINS.columns) * 360;
      for (let bin = Math.floor(from / RANGE_SKY.bin); bin * RANGE_SKY.bin < to; bin++)
        highest[bin % bins] = Math.max(highest[bin % bins], e);
    });
  highest.forEach((e, bin) => crests.push(direction((bin + 0.5) * RANGE_SKY.bin, e)));
  const layout = LAYOUTS.find((l) => l.width === 1080 && l.height === 1920),
    { width, height, hero, nav } = layout,
    letters = MONITOR_LETTERS.map(([left, right, top, bottom]) => ({
      left: hero.left + left,
      right: hero.left + right,
      top: hero.top + top,
      bottom: hero.top + bottom,
    })),
    air = 24,
    caster = new Raycaster();
  try {
    for (const name of Object.keys(subjects)) {
      const kind = kindOf(name),
        angle = DIRECTED_SHOTS[kind].findIndex((shot) => shot.name === name);
      const camera = new PerspectiveCamera(38, width / height, 0.1, CAMERA_FAR);
      const controller = createCinematicCamera({
        camera,
        selected: kind,
        angle,
        getSafeArea: () => cinematicSafeArea(width, height, hero, nav),
        getGroundY: ground,
        measure: watch.measure,
      });
      for (const [k, object] of [
        ["watch", watch],
        ["tree", tree],
      ]) {
        controller.setSubject(k, object.root);
        controller.setStatus({ kind: k, status: "ready" });
      }
      for (let step = 0; step <= 24; step++) {
        const tourPhase = step / 24;
        controller.apply({ width, height, tourPhase });
        camera.updateMatrixWorld(true);
        const label = `${name} ${width}x${height} phase ${tourPhase.toFixed(3)}`;
        // The subject: rays every 8 CSS px over the letters and within 24 px of them.
        for (const box of letters)
          for (let y = box.top - air; y <= box.bottom + air; y += 8)
            for (let x = Math.max(0, box.left - air); x <= box.right + air; x += 8) {
              const dx = Math.max(box.left - x, 0, x - box.right),
                dy = Math.max(box.top - y, 0, y - box.bottom);
              if (Math.hypot(dx, dy) > air) continue;
              caster.setFromCamera({ x: (x / width) * 2 - 1, y: 1 - (y / height) * 2 }, camera);
              assert.equal(
                caster.intersectObjects(subjects[name], false).length,
                0,
                `${label}: the tree at ${x},${y}, within ${air} px of the text`,
              );
            }
        for (const point of crests) {
          const p = point.clone().add(camera.position);
          if (p.clone().applyMatrix4(camera.matrixWorldInverse).z >= 0) continue;
          p.project(camera);
          const x = ((p.x + 1) * width) / 2,
            y = ((1 - p.y) * height) / 2;
          for (const box of letters)
            assert.ok(
              x < box.left - 2 || x > box.right + 2 || y < box.top - 2 || y > box.bottom + 2,
              `${label}: a crest at ${x.toFixed(0)},${y.toFixed(0)} runs through the text`,
            );
        }
      }
      controller.dispose();
    }
  } finally {
    Object.values(composed.geometries).forEach((geometry) => geometry.dispose());
    lantern.dispose();
    scale.dispose();
    tree.dispose();
    for (const item of Object.values(assets))
      item.scene.traverse((mesh) => {
        mesh.geometry?.dispose();
        mesh.material?.dispose();
      });
  }
});
