// The loading line's star stands where the opening shot will show the scene's star
// (src/scene/opening-star.js): The watch frames the lookout's stored outline
// (opening-outline.js; the lookout itself left the scene on 2026-10-20), every form of the shot
// has one, and openingStar() fits it as the scene's own camera does.

import assert from "node:assert/strict";
import test from "node:test";
import { Group, Object3D, PerspectiveCamera, Vector3 } from "three";
import { flat, source } from "./support/code.mjs";
import { sceneGround } from "./support/ground.mjs";
import { createCinematicCamera, cinematicSafeArea } from "../src/scene/cinematic.js";
import { DIRECTED_SHOTS, measureShot, resolveDirectedShot } from "../src/scene/directed-shots.js";
import { OPENING_OUTLINES } from "../src/scene/opening-outline.js";
import { OUTLINE_RESOLUTION, outlineKey } from "../src/scene/opening-outline-key.js";
import { openingStar, watchMeasure } from "../src/scene/opening-star.js";
import { lensSource } from "../src/scene/postprocess.js";
import { SOLAR_RADIUS } from "../src/scene/solar-body.js";

// world.js SUN_POSITION (index.js places the star there; framing.test holds it).
const SUN = new Vector3(-72.25, 50, -11.9);
const TIERS = ["high", "balanced"];

const near = (a, b, eps, label) => assert.ok(Math.abs(a - b) < eps, `${label}: ${a} != ${b}`);

function decode(points) {
  const bytes = Buffer.from(points, "base64");
  return Array.from({ length: bytes.length / 2 }, (_, i) => bytes.readInt16LE(2 * i));
}

// Every form resolveDirectedShot() gives The watch over the window sizes its outline was baked
// for (280 to 4000 CSS px wide and 280 to 2600 tall, every 20 px), by outline key.
const variants = new Map();
for (let width = 280; width <= 4000; width += 20)
  for (let height = 280; height <= 2600; height += 20) {
    const shot = resolveDirectedShot(DIRECTED_SHOTS.watch[0], width, height);
    if (!variants.has(outlineKey(shot))) variants.set(outlineKey(shot), shot);
  }
const stored = (tier, key) =>
  OPENING_OUTLINES.filter((entry) => entry.tier === tier && entry.key === key);

test("every form The watch takes has one stored outline per tier, and nothing else is stored", () => {
  assert.equal(DIRECTED_SHOTS.watch[0].name, "The watch");
  assert.ok(variants.size >= 3, "its desktop, portrait and short landscape forms");
  assert.equal(OPENING_OUTLINES.length, TIERS.length * variants.size, "one per tier and form");
  for (const tier of TIERS)
    for (const [key, shot] of variants) {
      const entries = stored(tier, key),
        label = `${tier} ${key}`;
      assert.equal(entries.length, 1, `${label} is stored once`);
      // A whole measurement as measureShot() returned it for the lookout, its root at the
      // origin: its hull's points inside its region, the region within the shot's band of the
      // lookout's height above its footing (the legs cross its foot; a focus may trim its
      // top), and the aim and the lens's height set by the shot.
      const [entry] = entries,
        points = decode(entry.points),
        [minX, minY, minZ, maxX, maxY, maxZ] = entry.region,
        slack = OUTLINE_RESOLUTION / 2 + 1e-4;
      assert.ok(points.length >= 12 && points.length % 3 === 0, `${label}: a hull`);
      for (let i = 0; i < points.length; i += 3) {
        const [x, y, z] = points.slice(i, i + 3).map((v) => v * OUTLINE_RESOLUTION);
        assert.ok(
          x >= minX - slack &&
            x <= maxX + slack &&
            y >= minY - slack &&
            y <= maxY + slack &&
            z >= minZ - slack &&
            z <= maxZ + slack,
          `${label}: a point outside its region`,
        );
      }
      assert.ok(entry.height > 0, label);
      near(minY, entry.footing + entry.height * shot.region[0], 1e-3, `${label} region foot`);
      assert.ok(
        maxY > minY && maxY <= entry.footing + entry.height * shot.region[1] + 1e-3,
        `${label} region top`,
      );
      near(entry.target[0], (minX + maxX) / 2, 1e-3, `${label} target x`);
      near(entry.target[2], (minZ + maxZ) / 2, 1e-3, `${label} target z`);
      near(
        entry.target[1],
        entry.footing + entry.height * shot.targetHeight,
        1e-3,
        `${label} target y`,
      );
      near(entry.cameraY, entry.footing + entry.height * shot.height, 1e-3, `${label} lens`);
      near(
        entry.radius,
        Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) / 2,
        1e-3,
        `${label} radius`,
      );
    }
});

test("watchMeasure() gives each tier's stored outline lifted to the root's height in the world", () => {
  // The marker under the scene's composition height, as index.js stages it.
  const environment = new Group(),
    root = new Object3D();
  environment.position.y = -2.4;
  root.position.set(0, sceneGround(0, 0) - 0.22, 0);
  environment.add(root);
  environment.updateMatrixWorld(true);
  const y = root.getWorldPosition(new Vector3()).y;
  for (const tier of TIERS) {
    const measure = watchMeasure(tier);
    for (const [key, shot] of variants) {
      const [entry] = stored(tier, key),
        measured = measure(root, shot),
        label = `${tier} ${key}`,
        lift = (values) => values.map((v, i) => v + (i % 3 === 1 ? y : 0));
      assert.ok(measured, `${label} is measured`);
      const points = decode(entry.points);
      assert.equal(measured.points.length, points.length, label);
      points.forEach((v, i) =>
        near(measured.points[i], v * OUTLINE_RESOLUTION + (i % 3 === 1 ? y : 0), 1e-4, label),
      );
      for (const [field, value, expected] of [
        ["target", measured.target.toArray(), lift(entry.target)],
        ["groundAnchor", measured.groundAnchor.toArray(), lift(entry.groundAnchor)],
        [
          "region",
          [...measured.region.min.toArray(), ...measured.region.max.toArray()],
          lift(entry.region),
        ],
        ["cameraY", [measured.cameraY], [entry.cameraY + y]],
        ["footing", [measured.footing], [entry.footing + y]],
        ["height", [measured.height], [entry.height]],
        ["radius", [measured.radius], [entry.radius]],
      ])
        value.forEach((v, i) => near(v, expected[i], 1e-9, `${label} ${field}`));
    }
  }
  // Moved, the root carries its outline with it.
  const [entry] = stored("high", outlineKey(DIRECTED_SHOTS.watch[0]));
  root.position.y += 5;
  environment.updateMatrixWorld(true);
  near(
    watchMeasure("high")(root, DIRECTED_SHOTS.watch[0]).target.y,
    entry.target[1] + y + 5,
    1e-9,
    "moved",
  );
  // Nothing for a tier without outlines, another shot, or a framing changed since its bake.
  assert.equal(watchMeasure("low")(root, DIRECTED_SHOTS.watch[0]), null);
  assert.equal(watchMeasure("high")(root, DIRECTED_SHOTS.tree[0]), null);
  assert.equal(watchMeasure("high")(root, { ...DIRECTED_SHOTS.watch[0], azimuth: 0 }), null);
});

// The scene's camera as index.js stages it: The watch's marker at watchY, measured by the
// tier's stored outline (the tree as it stands).
function sceneStar(tier, width, height, area, watchY) {
  const camera = new PerspectiveCamera(45, width / height, 0.1, 450),
    watchRoot = new Object3D(),
    measureWatch = watchMeasure(tier);
  watchRoot.position.y = watchY;
  const controller = createCinematicCamera({
    camera,
    selected: "watch",
    angle: 0,
    getSafeArea: () => area,
    getGroundY: sceneGround,
    measure: (root, shot) =>
      root === watchRoot ? measureWatch(root, shot) : measureShot(root, shot),
  });
  controller.setSubject("watch", watchRoot);
  controller.setStatus({ kind: "watch", status: "ready" });
  try {
    assert.ok(controller.apply({ width, height, elapsedSeconds: 0, tourPhase: 0 }));
    camera.updateMatrixWorld();
    return lensSource(camera, SUN, SOLAR_RADIUS, [0, 0, 0, 0]);
  } finally {
    controller.dispose();
  }
}

test("openingStar() puts the star where the scene's camera fitted to The watch puts it", () => {
  const watchY = sceneGround(0, 0) - 0.22;
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
    const expected = sceneStar(tier, width, height, area, watchY);
    const star = openingStar({
      width,
      height,
      getSafeArea: () => area,
      getGroundY: sceneGround,
      sun: SUN,
      watchY,
      tier,
    });
    assert.ok(star, `${width}x${height}: a star`);
    const px = Math.hypot((star[0] - expected[0]) * width, (star[1] - expected[1]) * height);
    assert.ok(px < 1, `${tier} ${width}x${height}: ${px.toFixed(2)} px from the scene's`);
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
  assert.equal(openingStar({ ...base, selected: "tower" }), null, "the lookout's view is gone");
  assert.equal(openingStar({ ...base, angle: 1 }), null);
  assert.equal(openingStar({ ...base, tier: "low" }), null, "no outline for a tier");
  assert.equal(openingStar({ ...base, width: 0 }), null);
});

test("the scene stages The watch on its outline and reports the opening fit's star, then its camera's, until the reveal", () => {
  const index = flat(source("src/scene/index.js"));
  // The watch's marker: nothing drawn, where the lookout's root stood (its posts 0.22 into the
  // terrace), measured by the startup tier's stored outline; the tree as it stands.
  assert.match(
    index,
    /watchRoot = new Object3D\(\); watchRoot\.position\.set\(ESTATE\.watch\.x, groundHeight\(ESTATE\.watch\.x, ESTATE\.watch\.z\) - 0\.22, ESTATE\.watch\.z\);/,
  );
  assert.match(index, /const measureWatch = watchMeasure\(assetTier\);/);
  assert.match(
    index,
    /measure: \(root, shot\) => root === watchRoot \? measureWatch\(root, shot\) : measureShot\(root, shot\)/,
  );
  assert.match(index, /cinematic\.setSubject\("watch", watchRoot\);/);
  // From the scene's start, after a resize has set the composition, and once the fonts load.
  assert.match(
    index,
    /subsystemRegistry\.resize\(\{[^}]*\}\); predictLoaderStar\(\); visitorHold\?\.redraw\(\);/,
  );
  assert.match(index, /invalidateContent\(\); predictLoaderStar\(\); \};/);
  // Where the watch's marker stands, under the composition's height, for the startup tier and
  // the tour's opening phase.
  assert.match(index, /watchRoot\.getWorldPosition\(openingWatch\);/);
  assert.match(
    index,
    /watchY: openingWatch\.y, tier: assetTier, tourPhase: cameraTour \? 0 : null/,
  );
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
