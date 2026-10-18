import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { Mesh, MeshBasicMaterial, Raycaster, Vector3 } from "three";
import {
  FALLS,
  SEA,
  cliffGeometry,
  coastDistance,
  coastGeometrySettings,
  fallsGeometry,
  fallsNotch,
  riverFalls,
} from "../src/scene/ocean.js";
import { filmHeight, RIVER_LINE } from "../src/scene/terrain-build.js";

// Use the live dune sampler and the actual river/fault intersection, rather
// than a flat substitute: the water must start under the delivered notch's
// shelf and run over its sunken lip to the brink.
const context = { window: { BabelSite: {} } };
vm.runInNewContext(
  readFileSync(new URL("../src/scene/helpers.js", import.meta.url), "utf8"),
  context,
);
const height = filmHeight(context.window.BabelSite.scene.groundHeight, true),
  drop = riverFalls(RIVER_LINE);

for (const tier of ["high", "balanced"])
  test(`${tier} falls run from under the real shelf over the sunken lip to their brink, clear of the rock`, () => {
    const settings = coastGeometrySettings(tier),
      cliff = new Mesh(
        cliffGeometry(height, settings.cliff, 190, fallsNotch(drop)),
        new MeshBasicMaterial({ side: 2 }),
      ),
      { geometry, plunge } = fallsGeometry(drop, height),
      positions = geometry.attributes.position,
      normals = geometry.attributes.normal,
      flow = geometry.attributes.aFall,
      ray = new Raycaster(),
      at = new Vector3();
    cliff.updateMatrixWorld();
    const across = positions.count / (FALLS.rows + 1),
      rockAbove = () => {
        ray.set(new Vector3(at.x, at.y + 0.001, at.z), new Vector3(0, 1, 0));
        return ray.intersectObject(cliff)[0];
      };
    try {
      for (let r = 0; r <= FALLS.run; r++)
        for (let c = 0; c < across; c++) {
          const i = r * across + c;
          at.fromBufferAttribute(positions, i);
          assert.ok(flow.getY(i) < 0.851, "its run to the brink is the glassy river");
          assert.ok(at.y <= height(at.x, at.z) + 0.15, "it runs at the river's own height");
          if (r === 0) {
            // It starts where the river on the shelf ends: at the shelf's edge and height.
            ray.set(new Vector3(at.x, 20, at.z), new Vector3(0, -1, 0));
            const shelf = ray.intersectObject(cliff)[0];
            assert.ok(
              shelf && Math.abs(shelf.point.y - at.y) < 0.05,
              "it meets the shelf without a step",
            );
          } else if (Math.abs(flow.getX(i)) < 0.8)
            // Its edges tuck under the banks beside the sunken lip.
            assert.ok(!rockAbove(), "it runs over the sunken lip, no rock rising through it");
          if (r === FALLS.run)
            assert.ok(
              Math.abs(coastDistance(at.x, at.z)) < 0.02,
              "each stream's brink is on the fault",
            );
        }
      // Falling, it hangs along the cliff, clear of its face but for a graze.
      let under = 0;
      for (let i = (FALLS.run + 1) * across; i < positions.count; i++) {
        at.fromBufferAttribute(positions, i);
        const hit = rockAbove();
        if (hit) {
          under++;
          assert.ok(hit.point.y - at.y < 0.3, "never deep inside the cliff");
        }
      }
      assert.ok(under <= 4, "the sheet stays clear of the face");
      // It must stay a continuous, downward falling sheet, including its first
      // strip, with no folded or invalid normals.
      for (let i = 0; i < positions.count; i++) {
        const n = new Vector3().fromBufferAttribute(normals, i);
        assert.ok(n.toArray().every(Number.isFinite));
        assert.ok(Math.abs(n.length() - 1) < 1e-5);
        if (i >= across) assert.ok(positions.getY(i) < positions.getY(i - across));
        if (i > 0 && i < across)
          assert.ok(n.dot(new Vector3().fromBufferAttribute(normals, i - 1)) > 0.98);
      }
      assert.ok(positions.getY(positions.count - 1) < SEA.level);
      assert.ok(coastDistance(plunge[0], plunge[1]) < 0, "the sheet still lands at sea");
    } finally {
      cliff.geometry.dispose();
      cliff.material.dispose();
      geometry.dispose();
    }
  });
