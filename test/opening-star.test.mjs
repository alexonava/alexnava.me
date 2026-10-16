// The loading line's star stands where the opening shot will show the scene's star
// (src/scene/opening-star.js): the tower's stored outline (opening-outline.js) against the
// models, and openingStar() against the scene's own camera fitted to the model.

import assert from "node:assert/strict";
import test from "node:test";
import { PerspectiveCamera, Vector3 } from "three";
import { ConvexHull } from "three/examples/jsm/math/ConvexHull.js";
import { flat, source } from "./support/code.mjs";
import { glbAsset, modelBytes } from "./support/glb.mjs";
import { sceneGround } from "./support/ground.mjs";
import { createCompleteTowerArchitecture } from "../src/scene/architecture.js";
import { createCinematicCamera, cinematicSafeArea } from "../src/scene/cinematic.js";
import { DIRECTED_SHOTS, measureShot, resolveDirectedShot } from "../src/scene/directed-shots.js";
import { OPENING_OUTLINES } from "../src/scene/opening-outline.js";
import { OUTLINE_RESOLUTION, outlineKey } from "../src/scene/opening-outline-key.js";
import { openingStar } from "../src/scene/opening-star.js";
import { lensSource } from "../src/scene/postprocess.js";
import { SOLAR_RADIUS } from "../src/scene/solar-body.js";

const towers = {};
const towerFor = (tier, groundY = 0) =>
  (towers[`${tier} ${groundY}`] ??= createCompleteTowerArchitecture({
    asset: glbAsset(modelBytes("tower", tier)),
    groundY,
    footingOffset: 0,
  }));
// world.js SUN_POSITION (index.js places the star there; framing.test holds it).
const SUN = new Vector3(-72.25, 50, -11.9);

function decode(points) {
  const bytes = Buffer.from(points, "base64");
  return Array.from({ length: bytes.length / 2 }, (_, i) => bytes.readInt16LE(2 * i));
}

test("the stored outline is each tier's tower measured for every variant The watch takes", () => {
  const variants = new Map();
  for (let width = 280; width <= 4000; width += 40)
    for (let height = 280; height <= 2600; height += 40) {
      const shot = resolveDirectedShot(DIRECTED_SHOTS.tower[0], width, height);
      variants.set(outlineKey(shot), shot);
    }
  assert.equal(OPENING_OUTLINES.length, 2 * variants.size, "one outline per tier and variant");
  for (const tier of ["high", "balanced"])
    for (const [key, shot] of variants) {
      const entry = OPENING_OUTLINES.find((item) => item.tier === tier && item.key === key);
      assert.ok(entry, `${tier} ${key} is stored`);
      const measured = measureShot(towerFor(tier).root, shot);
      for (const [field, value] of [
        ["target", measured.target.toArray()],
        ["groundAnchor", measured.groundAnchor.toArray()],
        ["region", [...measured.region.min.toArray(), ...measured.region.max.toArray()]],
      ])
        value.forEach((v, i) => assert.ok(Math.abs(entry[field][i] - v) < 1e-3, `${field} ${i}`));
      for (const field of ["cameraY", "footing", "height", "radius"])
        assert.ok(Math.abs(entry[field] - measured[field]) < 1e-3, field);
      // The stored points are the measured points' convex hull: every vertex of it, and
      // nothing outside it.
      const points = [];
      for (let i = 0; i < measured.points.length; i += 3)
        points.push(
          new Vector3(measured.points[i], measured.points[i + 1], measured.points[i + 2]),
        );
      const hull = new ConvexHull().setFromPoints(points);
      const vertices = new Set();
      for (const face of hull.faces) {
        let edge = face.edge;
        do {
          vertices.add(edge.head().point);
          edge = edge.next;
        } while (edge !== face.edge);
      }
      const stored = decode(entry.points);
      assert.equal(stored.length, vertices.size * 3, `${tier} ${key}: the hull's vertices`);
      let i = 0;
      for (const p of vertices)
        for (const v of [p.x, p.y, p.z])
          assert.equal(stored[i++], Math.round(v / OUTLINE_RESOLUTION), `${tier} ${key} point`);
    }
});

// The scene's camera fitted to the model itself, as index.js fits it at the reveal.
function modelStar(tier, width, height, area, towerY) {
  const camera = new PerspectiveCamera(45, width / height, 0.1, 450);
  const controller = createCinematicCamera({
    camera,
    selected: "tower",
    angle: 0,
    getSafeArea: () => area,
    getGroundY: sceneGround,
  });
  controller.setSubject("tower", towerFor(tier, towerY).root);
  controller.setStatus({ kind: "tower", status: "ready" });
  controller.apply({ width, height, elapsedSeconds: 0, tourPhase: 0 });
  camera.updateMatrixWorld();
  return lensSource(camera, SUN, SOLAR_RADIUS, [0, 0, 0, 0]);
}

test("openingStar() puts the star where the scene's camera fitted to the model puts it", () => {
  const towerY = sceneGround(0, 0) - 0.22;
  // Desktops, a wide and a square window, squat and portrait monitors, phones both ways
  // and a tablet, with heroes and bars measured from the live page.
  for (const [tier, width, height, hero, nav] of [
    ["high", 1440, 900, { left: 130, top: 447, right: 454, bottom: 720 }, { top: 818 }],
    ["high", 1920, 1080, { left: 165, top: 579, right: 489, bottom: 852 }, { top: 998 }],
    ["high", 2560, 1080, { left: 141, top: 579, right: 465, bottom: 852 }, { top: 998 }],
    ["high", 1000, 1000, { left: 16, top: 48, right: 323, bottom: 240 }, { top: 918 }],
    ["high", 700, 480, { left: 16, top: 12, right: 262, bottom: 138 }, { top: 402 }],
    ["high", 1080, 1920, { left: 16, top: 1496, right: 283, bottom: 1726 }, { top: 1838 }],
    ["balanced", 390, 844, { left: 12, top: 34, right: 299, bottom: 177 }, { top: 766 }],
    ["balanced", 844, 390, { left: 16, top: 12, right: 262, bottom: 138 }, { top: 312 }],
    ["balanced", 820, 1180, { left: 24, top: 48, right: 400, bottom: 260 }, { top: 1098 }],
  ]) {
    const area = cinematicSafeArea(width, height, hero, nav);
    const expected = modelStar(tier, width, height, area, towerY);
    const star = openingStar({
      width,
      height,
      getSafeArea: () => area,
      getGroundY: sceneGround,
      sun: SUN,
      towerY,
      tier,
    });
    assert.ok(star, `${width}x${height}: a star`);
    const px = Math.hypot((star[0] - expected[0]) * width, (star[1] - expected[1]) * height);
    assert.ok(px < 1, `${tier} ${width}x${height}: ${px.toFixed(2)} px from the model's`);
    assert.ok(Math.abs(star[2] - expected[2]) * height < 0.1, "the same radius");
  }
});

test("only The watch opens on the star; other openings and stale outlines give none", () => {
  const area = { left: 490, top: 165, width: 926, height: 570 };
  const base = {
    width: 1440,
    height: 900,
    getSafeArea: () => area,
    getGroundY: sceneGround,
    sun: SUN,
  };
  assert.ok(openingStar(base));
  assert.equal(openingStar({ ...base, selected: "tree" }), null);
  assert.equal(openingStar({ ...base, angle: 1 }), null);
  assert.equal(openingStar({ ...base, tier: "low" }), null, "no outline for a tier");
  assert.equal(openingStar({ ...base, width: 0 }), null);
});

test("the scene reports the opening fit's star, then its camera's, until the reveal", () => {
  const index = flat(source("src/scene/index.js"));
  // From the scene's start, after a resize has set the composition, and once the fonts load.
  assert.match(
    index,
    /subsystemRegistry\.resize\(\{[^}]*\}\); predictLoaderStar\(\); visitorHold\?\.redraw\(\);/,
  );
  assert.match(index, /invalidateContent\(\); predictLoaderStar\(\); \};/);
  // Where the tower will stand, under the composition's height, for the model's tier and the
  // tour's opening phase.
  assert.match(
    index,
    /towerRoot\.localToWorld\(openingTower\.set\(0, towerGroundY \+ TOWER_FOOTING, 0\)\);/,
  );
  assert.match(
    index,
    /towerY: openingTower\.y, tier: assetTier, tourPhase: cameraTour \? 0 : null/,
  );
  assert.match(index, /groundY: towerGroundY, footingOffset: TOWER_FOOTING/);
  // The camera's own star, once its fit lands, replaces the prediction until the reveal.
  assert.match(
    index,
    /if \(star && !canvasShown\) \{ openingCameraStar = true; reportLoaderStar\(star\); \}/,
  );
  assert.match(
    index,
    /if \(openingCameraStar \|\| canvasShown \|\| !site\.sceneLoader\?\.star\) return;/,
  );
  // In CSS px from the canvas's top-left, with the canvas's size.
  assert.match(
    index,
    /x: star\[0\] \* rect\.width, y: \(1 - star\[1\]\) \* rect\.height, radius: star\[2\] \* rect\.height, width: rect\.width, height: rect\.height \}/,
  );
});
