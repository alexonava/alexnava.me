import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import {
  BoxGeometry,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Raycaster,
  Scene,
  Vector3,
} from "three";
import { createCinematicCamera, cinematicSafeArea } from "../src/scene/cinematic.js";
import { DIRECTED_SHOTS, resolveDirectedShot } from "../src/scene/directed-shots.js";
import {
  COAST_SHOTS,
  FALLS,
  SEA,
  SHORE,
  SPRAY_FIT,
  coastShot,
  coastDistance,
  createFalls,
  riverFalls,
  coastGeometrySettings,
  cliffGeometry,
  fallsNotch,
  stackGeometry,
} from "../src/scene/ocean.js";
import { dripClock, filmHeight, riverChannel, RIVER_LINE } from "../src/scene/terrain-build.js";
import { MIST_UNIFORMS } from "../src/scene/drifting-mist.js";
import {
  createCoastObservation,
  assertCoastObservation,
} from "./support/preferred-coast-signatures.mjs";

// Actual page layout measurements for phones, with short/full desktop boxes.
const layouts = [
  [390, 844, { right: 299, bottom: 177 }, { top: 766 }],
  [844, 390, { right: 262, bottom: 138 }, { top: 316 }],
  [1280, 720, { right: 430, bottom: 570 }, { top: 638 }],
  [1920, 1080, { right: 534, bottom: 900 }, { top: 998 }],
  [820, 1180, { left: 16, right: 323, top: 48, bottom: 226 }, { top: 1098 }],
  [1080, 1920, { left: 16, right: 283, top: 1496, bottom: 1726 }, { top: 1838 }],
];

for (const tier of ["high", "balanced"])
  for (const shifted of [false, true])
    for (const shotName of ["The falls", "Over the fault"])
      test(`${tier} ${shotName} retains the selected before camera through the complete move${shifted ? " in a transformed estate" : ""}`, () => {
        const estate = new Group(),
          watch = new Mesh(new BoxGeometry(10, 30, 10), new MeshBasicMaterial()),
          tree = new Mesh(new BoxGeometry(10, 20, 10), watch.material);
        estate.position.set(shifted ? 13 : 0, -6.8, shifted ? -9 : 0);
        if (shifted) {
          estate.rotation.y = 0.17;
          estate.scale.setScalar(1.06);
        }
        estate.add(watch, tree);
        const falls = createFalls({
            lib: {
              MIST_UNIFORMS,
              FLASH_GROUND: { babelFlash: { value: new Color() } },
              RANGE_MIST: { value: { x: 0, y: 0, z: 0, w: 0 } },
              SLATE_TEXT_GUARD: "",
              MIST_PARS: "",
            },
            clock: dripClock({ value: 0 }),
            rendering: { homeScene: new Scene(), tier },
            drop: riverFalls(RIVER_LINE),
            height: riverChannel(filmHeight(() => 0, true)).bed,
          }),
          coast = COAST_SHOTS.map((base) => coastShot(base, estate, falls)),
          shot = coast.find((base) => base.name === shotName),
          camera = new PerspectiveCamera(45, 1, 0.1, 450);
        estate.add(falls.mesh);
        DIRECTED_SHOTS.tree.push(...coast);
        let area;
        const observation = createCoastObservation();
        const controller = createCinematicCamera({
          camera,
          selected: "tree",
          getSafeArea: () => area,
        });
        for (const [kind, root] of [
          ["watch", watch],
          ["tree", tree],
        ]) {
          controller.setSubject(kind, root);
          controller.setStatus({ kind, status: "ready" });
        }
        const points = [];
        // Assert actual delivered sheet vertices, independently of fit's point table.
        const p = falls.mesh.geometry.attributes.position;
        for (let i = 0; i < p.count; i++) points.push(new Vector3().fromBufferAttribute(p, i));
        const sheetCount = points.length,
          [x, z, radius] = falls.plunge,
          sigma = radius * FALLS.spray[1],
          spray = sigma * SPRAY_FIT,
          centre = SEA.level + FALLS.spray[0];
        // A denser independent contour than the fit's proxy: all of the
        // shader's radial fan support and the spray's heart above sea (its
        // thinner haze beyond may run past the frame, as a cloud does).
        for (let turn = 0; turn < 96; turn++) {
          const angle = (turn * Math.PI) / 48;
          points.push(
            new Vector3(
              x + Math.cos(angle) * radius * 1.15,
              SEA.level,
              z + Math.sin(angle) * radius * 1.15,
            ),
          );
          for (let row = 0; row <= 32; row++) {
            const phi = (row * Math.PI) / 32,
              y = centre + (Math.cos(phi) * spray) / 0.8;
            if (y >= SEA.level)
              points.push(
                new Vector3(
                  x + Math.cos(angle) * Math.sin(phi) * spray,
                  y,
                  z + Math.sin(angle) * Math.sin(phi) * spray,
                ),
              );
          }
        }
        try {
          // Resolve all short-landscape shots consecutively: a shared variant
          // cache once reused the first shot's bound aim for its siblings and
          // for a second estate. The two wide shots keep their original lenses.
          area = cinematicSafeArea(844, 390, layouts[1][2], layouts[1][3]);
          for (const bound of coast) {
            assert.ok(controller.setPreviewShot("tree", DIRECTED_SHOTS.tree.indexOf(bound)));
            controller.apply({ width: 844, height: 390, tourPhase: 0.5 });
            estate.updateWorldMatrix(true, true);
            assert.equal(controller.shot.name, bound.name);
            assert.ok(
              controller.target.distanceTo(
                new Vector3(...bound.aim).applyMatrix4(estate.matrixWorld),
              ) < 1e-8,
              `${bound.name} keeps its own estate's target`,
            );
            if (!bound.frameFalls)
              assert.equal(camera.fov, bound.fov, `${bound.name} keeps its lens`);
            assert.equal(controller.shot.hold, bound.hold);
            assert.equal(controller.shot.move, null, "short-landscape variant remains still");
          }
          for (const [width, height, hero, nav] of shotName === "The falls"
            ? layouts
            : layouts.slice(0, 4)) {
            area = cinematicSafeArea(width, height, hero, nav);
            assert.ok(controller.setPreviewShot("tree", DIRECTED_SHOTS.tree.indexOf(shot)));
            let lens;
            for (let i = 0; i <= 40; i++) {
              controller.apply({ width, height, elapsedSeconds: i, tourPhase: i / 40 });
              camera.updateMatrixWorld();
              estate.updateWorldMatrix(true, true);
              observation.add(width, height, i, camera.fov, ...camera.position.toArray());
              lens ??= camera.fov;
              assert.equal(camera.fov, lens, "one stable lens through the whole move");
              let sheetTop = Infinity,
                sheetBottom = -Infinity,
                visibleTop = Infinity,
                visibleBottom = -Infinity,
                vertex = 0;
              for (const local of points) {
                const ndc = local.clone().applyMatrix4(estate.matrixWorld).project(camera),
                  sx = ((ndc.x + 1) * width) / 2,
                  sy = ((1 - ndc.y) * height) / 2;
                observation.add(sx, sy, ndc.z);
                if (vertex++ < sheetCount) {
                  sheetTop = Math.min(sheetTop, sy);
                  sheetBottom = Math.max(sheetBottom, sy);
                  if (local.y >= SEA.level) {
                    visibleTop = Math.min(visibleTop, sy);
                    visibleBottom = Math.max(visibleBottom, sy);
                  }
                }
                assert.ok(
                  ndc.z > -1 && ndc.z < 1,
                  `${width}x${height} phase ${i / 40}: ${ndc.toArray()} eye ${camera.position.toArray()} target ${controller.target.toArray()}`,
                );
                // The falls frames its full envelope. The selected wide bay
                // view's crop is verified against its before-camera signature.
                if (shot.frameFalls)
                  assert.ok(
                    sx >= area.left &&
                      sx <= area.left + area.width &&
                      sy >= area.top &&
                      sy <= area.top + area.height,
                    `${width}x${height} phase ${i / 40}: ${sx},${sy} outside ${JSON.stringify(area)}`,
                  );
              }
              if (width >= 1280 && shotName === "The falls")
                assert.ok(
                  sheetBottom - sheetTop >= area.height * 0.35,
                  "the full falling sheet remains a readable close view",
                );
              if ([390, 820, 1080].includes(width) && shotName === "The falls")
                observation.add((visibleBottom - visibleTop) / area.height);
            }
          }
          assertCoastObservation(`projection:${tier}:${shotName}:${shifted}`, observation.finish());
        } finally {
          for (const bound of coast)
            DIRECTED_SHOTS.tree.splice(DIRECTED_SHOTS.tree.indexOf(bound), 1);
          controller.dispose();
          falls.dispose();
          watch.geometry.dispose();
          tree.geometry.dispose();
          watch.material.dispose();
        }
      });

test("the selected before Falls composition resolves on upright phones, tablets and tall screens", () => {
  const shot = COAST_SHOTS.find((s) => s.name === "The falls");
  for (const [width, height] of [
    [390, 844],
    [360, 780],
    [414, 896],
    [820, 1180],
    [1080, 1920],
  ]) {
    const view = resolveDirectedShot(shot, width, height);
    assert.deepEqual(
      [view.aim, view.azimuth, view.reach, view.rise, view.fovMax],
      [[80.5, -8, 82.3], -55, 44, 24, 62],
    );
    assert.equal(view.anchor, undefined);
    if (width === 820) assert.equal(view.fov, 34);
  }
  for (const [width, height] of [[700, 480]]) {
    const view = resolveDirectedShot(shot, width, height);
    assert.deepEqual(
      [view.aim, view.azimuth, view.reach, view.rise, view.fovMax],
      [[80.5, -8, 82.3], -55, 44, 24, 62],
    );
  }
  for (const [width, height] of [
    [1920, 1080],
    [2560, 1080],
    [1440, 900],
  ]) {
    const view = resolveDirectedShot(shot, width, height);
    assert.deepEqual(
      [view.aim, view.azimuth, view.reach, view.rise, view.fovMax],
      [[80.5, -8, 82.3], -44, 33, 10.25, 48],
    );
  }
});

for (const tier of ["high", "balanced"])
  test(`${tier} portrait broken coast shows two separate offshore forms through its full move`, () => {
    const settings = coastGeometrySettings(tier),
      estate = new Group(),
      material = new MeshBasicMaterial({ side: 2 }),
      cliff = new Mesh(
        cliffGeometry(
          filmHeight(() => 0, true),
          settings.cliff,
        ),
        material,
      ),
      stacks = new Mesh(stackGeometry(settings.stacks), material),
      watch = new Mesh(new BoxGeometry(10, 30, 10), material),
      tree = new Mesh(new BoxGeometry(10, 20, 10), material),
      base = COAST_SHOTS[0],
      shot = coastShot(base, estate),
      camera = new PerspectiveCamera(45, 1, 0.1, 450),
      ray = new Raycaster(),
      area = cinematicSafeArea(390, 844, layouts[0][2], layouts[0][3]),
      controller = createCinematicCamera({ camera, selected: "tree", getSafeArea: () => area });
    estate.position.y = -6.8;
    estate.add(cliff, stacks, watch, tree);
    DIRECTED_SHOTS.tree.push(shot);
    for (const [kind, root] of [
      ["watch", watch],
      ["tree", tree],
    ]) {
      controller.setSubject(kind, root);
      controller.setStatus({ kind, status: "ready" });
    }
    const p = stacks.geometry.attributes.position,
      count = settings.stacks.sides * (settings.stacks.rings * 6 + 3),
      forms = [1, 2].map((k) => {
        const points = [];
        for (let i = k * count; i < (k + 1) * count; i++) {
          const point = new Vector3().fromBufferAttribute(p, i);
          if (point.y >= SEA.level) points.push(point);
        }
        return points;
      });
    try {
      // The variant changes only portrait phones, preserving desktop, tablet,
      // short landscape and squat compositions and their existing motion.
      for (const [width, height] of [
        [1280, 720],
        [1920, 1080],
        [844, 390],
        [768, 1024],
        [1200, 1600],
        [600, 450],
      ]) {
        const resolved = resolveDirectedShot(shot, width, height);
        assert.deepEqual(resolved.aim, base.aim);
        assert.equal(resolved.fov, base.fov);
      }
      const shiftedEstate = new Group();
      shiftedEstate.position.set(11, -3, -7);
      shiftedEstate.updateMatrixWorld();
      const shifted = coastShot(base, shiftedEstate);
      for (const [width, height] of [
        [390, 844],
        [768, 1024],
        [1200, 1600],
        [600, 450],
      ]) {
        const local = resolveDirectedShot(shot, width, height),
          other = resolveDirectedShot(shifted, width, height),
          measured = other.measure(tree, other);
        assert.notEqual(local, other, "variant caches retain their bound estate owner");
        assert.ok(
          measured.target.distanceTo(
            new Vector3(...other.aim).applyMatrix4(shiftedEstate.matrixWorld),
          ) < 1e-8,
        );
      }
      assert.ok(controller.setPreviewShot("tree", DIRECTED_SHOTS.tree.indexOf(shot)));
      for (let phase = 0; phase <= 1; phase += 0.125) {
        controller.apply({ width: 390, height: 844, tourPhase: phase });
        camera.updateMatrixWorld();
        estate.updateWorldMatrix(true, true);
        assert.equal(controller.shot.hold, 7);
        assert.deepEqual(controller.shot.move, base.move);
        assert.ok(Math.hypot(camera.position.x, camera.position.z) < 122);
        const bounds = forms.map((points) => {
          const b = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
          for (const local of points) {
            const world = local.clone().applyMatrix4(estate.matrixWorld),
              ndc = world.clone().project(camera),
              x = ((ndc.x + 1) * 390) / 2,
              y = ((1 - ndc.y) * 844) / 2;
            assert.ok(ndc.z > -1 && ndc.z < 1);
            b.left = Math.min(b.left, x);
            b.right = Math.max(b.right, x);
            b.top = Math.min(b.top, y);
            b.bottom = Math.max(b.bottom, y);
          }
          assert.ok(
            b.left >= area.left &&
              b.right <= area.left + area.width &&
              b.top >= area.top &&
              b.bottom <= area.top + area.height,
            `${phase}: ${JSON.stringify(b)}`,
          );
          assert.ok(
            b.right - b.left >= 30 && b.bottom - b.top >= 65,
            "each complete offshore form remains readable",
          );
          const samples = points
            .filter((_, i) => i % 53 === 0)
            .sort((a, b) => b.y - a.y)
            .slice(0, 12);
          let visible = 0;
          for (const sample of samples) {
            const world = sample.clone().applyMatrix4(estate.matrixWorld),
              direction = world.clone().sub(camera.position);
            ray.set(camera.position, direction.clone().normalize());
            ray.far = direction.length() - 0.1;
            if (!ray.intersectObject(cliff).length) visible++;
          }
          assert.ok(visible >= 6, "actual headland geometry leaves the stack crown visible");
          return b;
        });
        assert.ok(bounds[1].left - bounds[0].right >= 12, "water separates the two silhouettes");
        const x = (bounds[0].right + bounds[1].left) / 2,
          y = Math.min(bounds[0].bottom, bounds[1].bottom) - 4;
        ray.setFromCamera({ x: (x / 390) * 2 - 1, y: 1 - (y / 844) * 2 }, camera);
        const seaY = SEA.level + estate.position.y,
          distance = (seaY - camera.position.y) / ray.ray.direction.y;
        assert.ok(distance > 0);
        ray.far = distance - 0.1;
        assert.equal(
          ray.intersectObjects([cliff, stacks]).length,
          0,
          "the projected gap reaches open water without foreground rock",
        );
        const horizon = controller.target
          .clone()
          .sub(camera.position)
          .setY(0)
          .normalize()
          .multiplyScalar(10000)
          .add(camera.position)
          .project(camera);
        const horizonY = ((1 - horizon.y) * 844) / 2;
        assert.ok(
          horizonY > layouts[0][2].bottom + 24 && horizonY < area.top + area.height * 0.4,
          "open horizon stays below the title with breathing room",
        );
      }
    } finally {
      DIRECTED_SHOTS.tree.splice(DIRECTED_SHOTS.tree.indexOf(shot), 1);
      controller.dispose();
      for (const mesh of [cliff, stacks, watch, tree]) mesh.geometry.dispose();
      material.dispose();
    }
  });

for (const tier of ["high", "balanced"])
  for (const shotName of ["The falls", "Over the fault"])
    for (const [width, height, hero, nav, shifted] of shotName === "The falls"
      ? [
          [...layouts[0], false],
          [...layouts[4], false],
          [...layouts[5], false],
          [...layouts[4], true],
          [...layouts[5], true],
        ]
      : [[...layouts[0], false]])
      test(`${tier} ${width}x${height} ${shotName} retains the before framing of the brink, curtain and plunge${shifted ? " in a transformed estate" : ""}`, () => {
        const context = { window: { BabelSite: {} } };
        vm.runInNewContext(
          readFileSync(new URL("../src/scene/helpers.js", import.meta.url), "utf8"),
          context,
        );
        const estate = new Group(),
          material = new MeshBasicMaterial({ side: 2 }),
          watch = new Mesh(new BoxGeometry(10, 30, 10), material),
          tree = new Mesh(new BoxGeometry(10, 20, 10), material),
          terrainHeight = riverChannel(
            filmHeight(context.window.BabelSite.scene.groundHeight, true),
          ).bed,
          drop = riverFalls(RIVER_LINE),
          cliff = new Mesh(
            cliffGeometry(terrainHeight, coastGeometrySettings(tier).cliff, 190, fallsNotch(drop)),
            material,
          ),
          falls = createFalls({
            lib: {
              MIST_UNIFORMS,
              FLASH_GROUND: { babelFlash: { value: new Color() } },
              RANGE_MIST: { value: { x: 0, y: 0, z: 0, w: 0 } },
              SLATE_TEXT_GUARD: "",
              MIST_PARS: "",
            },
            clock: dripClock({ value: 0 }),
            rendering: { homeScene: new Scene(), tier },
            drop,
            height: terrainHeight,
          }),
          shot = coastShot(
            COAST_SHOTS.find((base) => base.name === shotName),
            estate,
            falls,
          ),
          camera = new PerspectiveCamera(45, 1, 0.1, 450),
          area = cinematicSafeArea(width, height, hero, nav),
          controller = createCinematicCamera({ camera, selected: "tree", getSafeArea: () => area }),
          ray = new Raycaster(),
          position = falls.mesh.geometry.attributes.position,
          course = falls.mesh.geometry.attributes.aFall,
          targets = [];
        estate.position.set(shifted ? 13 : 0, -6.8, shifted ? -9 : 0);
        if (shifted) {
          estate.rotation.y = 0.17;
          estate.scale.setScalar(1.06);
        }
        estate.add(watch, tree, cliff, falls.mesh);
        // Sample both actual skins and their rounded sides, not just the old
        // zero-thickness central curtain or the fit proxy. A point can project
        // inside the safe area while the near shelf still hides it.
        for (let i = 0; i < position.count; i++)
          if (
            ((Math.abs(course.getX(i)) < 0.01 && course.getZ(i) === 0) ||
              (course.getY(i) >= 1.05 &&
                (Math.abs(course.getX(i)) < 0.01 || Math.abs(course.getX(i)) > 0.99))) &&
            course.getY(i) >= 0.85 &&
            position.getY(i) >= SEA.level
          )
            targets.push(new Vector3().fromBufferAttribute(position, i));
        assert.ok(targets.length > 40, "the complete curtain contains multiple rows and streams");
        const [x, z] = falls.plunge;
        targets.push(new Vector3(x, SEA.level + 0.05, z));
        DIRECTED_SHOTS.tree.push(shot);
        for (const [kind, root] of [
          ["watch", watch],
          ["tree", tree],
        ]) {
          controller.setSubject(kind, root);
          controller.setStatus({ kind, status: "ready" });
        }
        const observation = createCoastObservation();
        try {
          assert.ok(controller.setPreviewShot("tree", DIRECTED_SHOTS.tree.indexOf(shot)));
          for (let phase = 0; phase <= 16; phase++) {
            controller.apply({ width, height, tourPhase: phase / 16 });
            camera.updateMatrixWorld();
            estate.updateWorldMatrix(true, true);
            observation.add(phase, camera.fov, ...camera.position.toArray());
            const inverseEstate = estate.matrixWorld.clone().invert();
            for (const local of targets) {
              const world = local.clone().applyMatrix4(estate.matrixWorld),
                direction = world.clone().sub(camera.position);
              ray.set(camera.position, direction.clone().normalize());
              ray.far = direction.length() - 0.08;
              observation.add(ray.intersectObject(cliff).length);
              // The mesh includes the cliff's own shelf. Inland of that shelf,
              // check the live terrain sampler too: fitting a point inside the
              // viewport does not establish that foreground land leaves it visible.
              for (let step = 1; step < 80; step++) {
                const point = camera.position
                  .clone()
                  .lerp(world, step / 80)
                  .applyMatrix4(inverseEstate);
                if (coastDistance(point.x, point.z) >= SHORE.shelf) {
                  const ground = terrainHeight(point.x, point.z);
                  observation.add(point.x, point.y, point.z, Number.isFinite(ground) ? 1 : 0);
                  if (Number.isFinite(ground)) observation.add(point.y - ground);
                }
              }
            }
          }
          assertCoastObservation(
            `occlusion:${tier}:${width}x${height}:${shotName}:${shifted}`,
            observation.finish(),
          );
        } finally {
          DIRECTED_SHOTS.tree.splice(DIRECTED_SHOTS.tree.indexOf(shot), 1);
          controller.dispose();
          falls.dispose();
          for (const mesh of [cliff, watch, tree]) mesh.geometry.dispose();
          material.dispose();
        }
      });
