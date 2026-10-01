import assert from "node:assert/strict";
import test from "node:test";
import { glbAsset, modelBytes } from "./support/glb.mjs";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { PerspectiveCamera, Raycaster, Vector3, DoubleSide } from "three";
import { createCompleteTowerArchitecture } from "../src/scene/architecture.js";
import { DIRECTED_SHOTS, measureShot } from "../src/scene/directed-shots.js";
import { createCinematicCamera, cinematicSafeArea } from "../src/scene/cinematic.js";

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
