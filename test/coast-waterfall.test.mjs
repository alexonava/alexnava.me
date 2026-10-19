import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { FrontSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from "three";
import {
  FALLS,
  SEA,
  cliffGeometry,
  coastDistance,
  coastGeometrySettings,
  createFalls,
  fallsGeometry,
  fallsNotch,
  riverFalls,
  riverRunStart,
} from "../src/scene/ocean.js";
import { filmHeight, riverChannel, RIVER_LINE } from "../src/scene/terrain-build.js";

// Use the live dune sampler and the actual river/fault intersection, rather
// than a flat substitute: the water must start under the delivered notch's
// shelf and run over its sunken lip to the brink.
const context = { window: { BabelSite: {} } };
vm.runInNewContext(
  readFileSync(new URL("../src/scene/helpers.js", import.meta.url), "utf8"),
  context,
);
const height = riverChannel(filmHeight(context.window.BabelSite.scene.groundHeight, true)).bed,
  drop = riverFalls(RIVER_LINE);
const lib = {
  MIST_UNIFORMS: {},
  RANGE_MIST: { value: { x: 0, y: 0, z: 0, w: 0 } },
  FLASH_GROUND: { babelFlash: { value: { x: 0, y: 0, z: 0, w: 0 } } },
  SLATE_TEXT_GUARD: "",
  MIST_PARS: "",
};

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
    const { across, ring, rows } = geometry.userData.falls,
      rockAbove = () => {
        ray.set(new Vector3(at.x, at.y + 0.001, at.z), new Vector3(0, 1, 0));
        return ray.intersectObject(cliff)[0];
      };
    try {
      for (let r = 0; r <= FALLS.run; r++)
        for (let c = 0; c < across; c++) {
          const i = r * ring + c;
          at.fromBufferAttribute(positions, i);
          assert.ok(flow.getY(i) < 0.851, "its run to the brink is the glassy river");
          assert.ok(
            at.y <= height.water(at.x, at.z) + 0.15,
            "it runs at the river's upper surface, not the deep bed",
          );
          if (r === 0) {
            // It starts exactly on the same upper datum as the cap; the
            // physical shelf below it is the channel bed, not that surface.
            ray.set(new Vector3(at.x, 20, at.z), new Vector3(0, -1, 0));
            const shelf = ray.intersectObject(cliff)[0];
            assert.ok(Math.abs(height.water(at.x, at.z) - at.y) < 1e-5, "no upper cap/run step");
            if (Math.abs(flow.getX(i)) < 0.8)
              assert.ok(
                shelf && shelf.point.y < at.y - 0.2,
                "real channel bed lies below the joining water",
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
      for (let i = (FALLS.run + 4) * ring; i < rows * ring; i++) {
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
        if (i >= (FALLS.run + 4) * ring && i < rows * ring)
          assert.ok(positions.getY(i) < positions.getY(i - ring));
      }
      assert.ok(positions.getY(rows * ring - 1) < SEA.level);
      assert.ok(coastDistance(plunge[0], plunge[1]) < 0, "the sheet still lands at sea");
    } finally {
      cliff.geometry.dispose();
      cliff.material.dispose();
      geometry.dispose();
    }
  });

test("the waterfall is one watertight outward-facing solid, with irregular physical depth and two visible lateral currents", () => {
  const clock = { uniform: { value: 0 }, tick: () => 0 },
    falls = createFalls({ lib, clock, drop, height, rendering: { tier: "high" } }),
    other = createFalls({ lib, clock, drop, height, rendering: { tier: "balanced" } }),
    geometry = falls.mesh.geometry,
    p = geometry.attributes.position,
    f = geometry.attributes.aFall,
    { across, ring, rows } = geometry.userData.falls,
    a = new Vector3(),
    b = new Vector3(),
    c = new Vector3(),
    ab = new Vector3(),
    ac = new Vector3(),
    normal = new Vector3(),
    edges = new Map(),
    welded = new Map(),
    vertex = [];
  try {
    assert.equal(falls.material.side, FrontSide, "real outward skin is sufficient from every side");
    assert.equal(falls.material.transparent, false, "the depth stamp is not visual alpha blending");
    assert.equal(falls.material.depthWrite, true, "near skin occludes the back in the same draw");
    assert.equal(falls.material.depthTest, true);
    assert.equal(falls.mesh.children.length, 0);
    assert.equal(geometry.groups.length, 0, "one mesh and material remain one draw");
    assert.ok(geometry.index.count / 3 <= 1700);
    assert.deepEqual(p.array, other.mesh.geometry.attributes.position.array);
    assert.deepEqual(geometry.index.array, other.mesh.geometry.index.array);
    let volume = 0;
    for (let i = 0; i < p.count; i++) {
      const key = [p.getX(i), p.getY(i), p.getZ(i)].join(":");
      if (!welded.has(key)) welded.set(key, i);
      vertex[i] = welded.get(key);
    }
    const lateralArea = [0, 0],
      sideEyes = [
        new Vector3(-drop.heading[1], 0, drop.heading[0]),
        new Vector3(drop.heading[1], 0, -drop.heading[0]),
      ];
    for (let i = 0; i < geometry.index.count; i += 3) {
      const indices = [0, 1, 2].map((n) => geometry.index.getX(i + n));
      a.fromBufferAttribute(p, indices[0]);
      b.fromBufferAttribute(p, indices[1]);
      c.fromBufferAttribute(p, indices[2]);
      normal.crossVectors(ab.subVectors(b, a), ac.subVectors(c, a));
      assert.ok(normal.lengthSq() > 1e-12, "no collapsed wall or cap triangles");
      if (indices.every((index) => f.getY(index) < 0.801))
        assert.ok(
          normal.x * drop.heading[0] + normal.z * drop.heading[1] < 0,
          "every head cap triangle faces upstream",
        );
      if (indices.every((index) => f.getY(index) > 1.999))
        assert.ok(
          normal.y < 0,
          "every concave toe strip faces down, without crossing fan triangles",
        );
      volume += a.dot(ab.crossVectors(b, c)) / 6;
      const lateral =
        indices.some((index) => f.getZ(index) > 0 && f.getZ(index) < 1) &&
        indices.every((index) => Math.abs(f.getX(index)) > 0.99);
      if (lateral)
        sideEyes.forEach((eye, side) => {
          lateralArea[side] += Math.max(0, normal.dot(eye)) / 2;
        });
      for (let j = 0; j < 3; j++) {
        const from = vertex[indices[j]],
          to = vertex[indices[(j + 1) % 3]],
          key = from < to ? `${from}:${to}` : `${to}:${from}`,
          value = edges.get(key) ?? { count: 0, direction: 0 };
        value.count++;
        value.direction += from < to ? 1 : -1;
        edges.set(key, value);
      }
    }
    assert.ok(volume > 2, "a flat DoubleSide curtain has no enclosed water volume");
    for (const edge of edges.values()) {
      assert.equal(edge.count, 2, "no open boundary at either side, head or toe");
      assert.equal(edge.direction, 0, "neighboring faces have coherent outward winding");
    }
    assert.ok(
      lateralArea.every((area) => area > 2),
      `real side-on projected skin area: ${lateralArea}`,
    );
    const depths = [],
      at = (row, column, back) => row * ring + (back ? across + 2 + across - 1 - column : column);
    for (let row = 0; row < rows; row++)
      for (let column = 0; column < across; column++) {
        a.fromBufferAttribute(p, at(row, column, false));
        b.fromBufferAttribute(p, at(row, column, true));
        const depth = a.distanceTo(b);
        assert.ok(depth > 0.2 && depth < 1.9, "bounded positive front/back separation");
        assert.ok(a.y >= b.y - 1e-5);
        if (row >= FALLS.rows - 4) depths.push(depth);
      }
    assert.ok(Math.max(...depths) < 0.75 && Math.min(...depths) > 0.25);
    assert.ok(Math.max(...depths) / Math.min(...depths) > 1.3, "not an extruded constant slab");
    assert.ok([...geometry.attributes.normal.array].every(Number.isFinite));
    const headMiddle = at(0, (across - 1) / 2, false),
      bedMiddle = at(0, (across - 1) / 2, true);
    assert.ok(Math.abs(p.getY(headMiddle) - p.getY(bedMiddle) - FALLS.depth) < 0.001);
    assert.ok(
      geometry.attributes.normal.getY(headMiddle) > 0.95,
      "the upper join keeps a water-surface normal, not the upstream cap's",
    );
    const capMiddle = rows * ring + (across - 1) / 2;
    a.fromBufferAttribute(geometry.attributes.normal, headMiddle);
    b.fromBufferAttribute(geometry.attributes.normal, capMiddle);
    assert.ok(a.dot(b) < 0.1, "the submerged closure has its own normal across the welded seam");
    assert.ok(p.getY(rows * ring - 1) < SEA.level - 0.4, "the closed toe stays submerged");
  } finally {
    falls.dispose();
    other.dispose();
  }
});

test("the closed lateral skin retains continuous filtered flow and cannot disappear through silhouette discard", () => {
  const falls = createFalls({ lib, clock: { uniform: { value: 0 }, tick: () => 0 }, drop, height });
  try {
    const shader = falls.material.fragmentShader,
      phase = shader.match(/q=vF.x\+([\d.]+)\*vF.z/),
      side = shader.match(/float side=([^,]+),edge=max\(side,/);
    assert.ok(phase && side);
    assert.ok(!/\bdiscard\b/.test(shader.replace(/\/\/[^\n]*/g, "")));
    assert.ok(shader.includes("fx=fwidth(q)"), "depth-wise current is footprint-filtered too");
    const surface = new Function("depth", `return ${side[1].replaceAll("vF.z", "depth")};`);
    assert.equal(surface(0), 0);
    assert.equal(surface(1), 0);
    assert.equal(surface(0.5), 1, "a grazing side carries water instead of the old clipped edge");
    let previous = -1;
    for (let depth = 0; depth <= 1; depth += 0.01) {
      const q = -1 + Number(phase[1]) * depth;
      assert.ok(q >= previous && q - previous < 0.01);
      previous = q;
    }
  } finally {
    falls.dispose();
  }
});

test("the waterfall head takes the complete water datum once, independently of its deep channel bed", () => {
  let bedCalls = 0;
  const bed = Object.assign(
      () => {
        bedCalls++;
        return -5;
      },
      {
        water: (x, z) => 0.8 + 0.02 * Math.sin(x * 0.2 + z * 0.1),
      },
    ),
    { geometry } = fallsGeometry(drop, bed),
    p = geometry.attributes.position,
    { across } = geometry.userData.falls;
  try {
    for (let c = 0; c < across; c++) {
      const [x, z] = riverRunStart(drop, (c / (across - 1)) * 2 - 1);
      assert.ok(Math.abs(p.getX(c) - x) < 1e-5 && Math.abs(p.getZ(c) - z) < 1e-5);
      assert.ok(
        Math.abs(p.getY(c) - bed.water(x, z)) < 1e-6,
        "no second shelf lift or bed-height substitution",
      );
    }
    assert.equal(bedCalls, 0, "a provided upper datum is never reconstructed from the deep bed");
  } finally {
    geometry.dispose();
  }
});
