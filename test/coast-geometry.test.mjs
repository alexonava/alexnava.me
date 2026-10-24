import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test, { after } from "node:test";
import {
  COAST_BUTTRESSES,
  SEA,
  coastBedPhase,
  coastDistance,
  coastFracture,
  coastGeometrySettings,
  coastPlane,
  coastRockGlsl,
  cliffGeometry,
  fallsNotch,
  faultAlong,
  riverFalls,
  stackGeometry,
  stackOutline,
  stackOutlineGlsl,
  stackWaterlineProfile,
} from "../src/scene/ocean.js";
import { RIVER_LINE } from "../src/scene/terrain-build.js";
import { WALK } from "../src/scene/walk.js";

const height = () => 1.25;
const built = new Map();
function coast(tier) {
  if (!built.has(tier)) {
    const settings = coastGeometrySettings(tier);
    built.set(tier, {
      settings,
      cliff: cliffGeometry(height, settings.cliff),
      stacks: stackGeometry(settings.stacks),
    });
  }
  return built.get(tier);
}
after(() => {
  for (const { cliff, stacks } of built.values()) {
    cliff.dispose();
    stacks.dispose();
  }
});
const point = (geometry, i) => {
  const p = geometry.attributes.position;
  return [p.getX(i), p.getY(i), p.getZ(i)];
};
const close = (a, b, message) => {
  assert.equal(a.length, b.length);
  for (let i = 0; i < a.length; i++)
    assert.ok(Math.abs(a[i] - b[i]) < 3e-5, `${message}: ${a} != ${b}`);
};
const stackPoint = (geometry, settings, k, r, j) =>
  point(
    geometry,
    k * settings.sides * (settings.rings * 6 + 3) +
      (Math.min(r, settings.rings - 1) * settings.sides + j) * 6 +
      (r === settings.rings ? 2 : 0),
  );

// Captured independently from the immutable modest-edge source (identity0be43f3c),
// never from the selected slabs implementation. Row6 may move down/seaward;
// row5's incident normals may respond. Its positions/UVs and rows0–4 normals,
// the complete river collar, deep face, formations and topology stay protected.
const modestBaseline = JSON.parse(
  readFileSync(new URL("./support/coast-modest-baseline.json", import.meta.url), "utf8"),
);
assert.equal(
  modestBaseline.sourceSha256,
  "55fe2a0e02547f3e9ad0f8c14b7a16e1dea134fc3f174192b9cd89fbf5033269",
);
function originalTop(reference) {
  const bytes = Buffer.from(reference.topRowsBase64, "base64");
  assert.equal(createHash("sha256").update(bytes).digest("hex"), reference.topRowsSha256);
  return (column, row) =>
    [0, 1, 2].map((axis) => bytes.readFloatLE((column * 6 + (row - 5) * 3 + axis) * 4));
}
function protectedFingerprint(geometry, cliff, notch) {
  const hash = createHash("sha256"),
    info = geometry.userData.coastGeometry;
  for (const [name, attribute] of Object.entries(geometry.attributes)) {
    hash.update(name);
    for (let i = 0; i < attribute.count; i++) {
      const row = i % info.rows,
        grid = i < info.baseVertices,
        inSlot =
          notch && Math.abs(geometry.attributes.aCliff.getX(i) - notch[0]) <= notch[1] + 3 + 1.2,
        depth = (row - cliff.shelfRows - 1) / cliff.rows,
        keep =
          name === "normal"
            ? !grid || inSlot || row < cliff.shelfRows - 1 || depth >= 0.2
            : !["position", "uv", "aCliff"].includes(name) ||
              !grid ||
              inSlot ||
              row < cliff.shelfRows ||
              depth >= 0.12,
        bytes = Buffer.from(
          attribute.array.buffer,
          attribute.array.byteOffset + i * attribute.itemSize * 4,
          attribute.itemSize * 4,
        );
      if (keep) hash.update(bytes);
      else if (name === "position" && row > cliff.shelfRows + 1) hash.update(bytes.subarray(4, 8));
      else if (name === "aCliff") hash.update(bytes.subarray(0, 8));
    }
  }
  return hash
    .update(Buffer.from(geometry.index.array.buffer))
    .update(JSON.stringify(geometry.groups))
    .update(JSON.stringify(info))
    .digest("hex");
}

function originalCoreFingerprint(geometry, notch) {
  const hash = createHash("sha256"),
    info = geometry.userData.coastGeometry;
  for (const [name, attribute] of Object.entries(geometry.attributes)) {
    hash.update(name);
    for (let i = 0; i < info.baseVertices; i++)
      if (Math.abs(geometry.attributes.aCliff.getX(i) - notch[0]) <= notch[1] + 3)
        hash.update(
          Buffer.from(
            attribute.array.buffer,
            attribute.array.byteOffset + i * attribute.itemSize * 4,
            attribute.itemSize * 4,
          ),
        );
  }
  return hash.digest("hex");
}

test("faulted slabs preserve the inner shelf, complete original collar, deep face, formations and topology", () => {
  const notch = fallsNotch(riverFalls(RIVER_LINE));
  assert.deepEqual(notch, modestBaseline.notch);
  for (const tier of ["high", "balanced"])
    for (const [i, slot] of [null, notch].entries()) {
      const settings = coastGeometrySettings(tier),
        geometry = cliffGeometry(height, settings.cliff, 190, slot),
        reference = modestBaseline.tiers[tier][slot ? "notched" : "unnotched"];
      try {
        assert.equal(
          protectedFingerprint(geometry, settings.cliff, slot),
          reference.protectedFingerprint,
          `${tier}: ${i}`,
        );
        assert.equal(geometry.attributes.position.count, reference.vertices);
        assert.equal(geometry.index.count / 3, reference.triangles);
        assert.equal(
          createHash("sha256").update(Buffer.from(geometry.index.array.buffer)).digest("hex"),
          reference.indexSha256,
        );
        assert.deepEqual(geometry.groups, reference.groups);
        if (slot)
          assert.equal(originalCoreFingerprint(geometry, slot), reference.headCoreFingerprint);
      } finally {
        geometry.dispose();
      }
    }
});

test("faulted crest blocks move only down and seaward while upper triangles stay ordered and outward", () => {
  const notch = fallsNotch(riverFalls(RIVER_LINE));
  for (const tier of ["high", "balanced"]) {
    const settings = coastGeometrySettings(tier),
      geometry = cliffGeometry(height, settings.cliff, 190, notch),
      p = geometry.attributes.position,
      normal = geometry.attributes.normal,
      { columns, rows } = geometry.userData.coastGeometry,
      original = originalTop(modestBaseline.tiers[tier].notched),
      [nx, nz] = coastPlane();
    try {
      let changed = 0,
        leastPush = Infinity,
        greatestPush = -Infinity;
      for (let c = 0; c < columns; c++) {
        const crest = c * rows + settings.cliff.shelfRows,
          bevel = crest + 1,
          first = bevel + 1,
          along = geometry.attributes.aCliff.getX(crest),
          before = original(c, 6),
          after = point(geometry, crest),
          dx = after[0] - before[0],
          dz = after[2] - before[2],
          push = dx * nx + dz * nz;
        assert.ok(push >= -3e-5, "the crest never moves inland");
        assert.ok(after[1] <= before[1] + 3e-6, "no crest point is raised");
        assert.ok(Math.abs(-nz * dx + nx * dz) < 3e-5, "N motion retains alongshore order");
        if (Math.hypot(dx, dz) > 3e-5) changed++;
        if (Math.abs(along - notch[0]) > 20) {
          leastPush = Math.min(leastPush, push);
          greatestPush = Math.max(greatestPush, push);
        }
        const drop = p.getY(crest) - p.getY(bevel),
          oldD = coastDistance(before[0], before[2]),
          d = coastDistance(after[0], after[2]);
        assert.ok(d <= oldD + 3e-5, "the shared shoreline equation sees only seaward motion");
        assert.ok(drop >= 0.12 && p.getY(bevel) - p.getY(first) >= 0.12);
        for (let row = settings.cliff.shelfRows + 1; row < rows; row++) {
          if (
            row > settings.cliff.shelfRows + 1 &&
            (row - settings.cliff.shelfRows - 1) / settings.cliff.rows >= 0.12
          )
            break;
          const i = c * rows + row,
            d = coastDistance(p.getX(i), p.getZ(i));
          assert.ok(d <= 0.28, `${tier}: altered rock at ${d} intrudes inland`);
          assert.ok(d + WALK.body < WALK.bound.shore[1]);
          assert.ok(Math.abs(geometry.attributes.uv.getX(i) - (p.getX(i) / 384 + 0.5)) < 1e-6);
          assert.ok(Math.abs(geometry.attributes.uv.getY(i) - (0.5 - p.getZ(i) / 384)) < 1e-6);
        }
      }
      assert.ok(changed > 0, "the actual crest changes, not only the bevel below it");
      assert.ok(
        greatestPush - leastPush > 0.5,
        "coherent slabs do not become a uniformly shifted rim",
      );
      for (let i = 0; i < normal.count; i++) {
        const length = Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i));
        assert.ok(Number.isFinite(length) && Math.abs(length - 1) < 1e-5);
      }
      // Ordered heights alone do not detect a crossed strip at a fault cusp.
      // Its actual triangles must also have area and face the local sea.
      const upperEnd = settings.cliff.shelfRows + 1 + Math.ceil(0.2 * settings.cliff.rows);
      for (let q = 0; q < geometry.index.count; q += 3) {
        const ids = [0, 1, 2].map((k) => geometry.index.array[q + k]);
        if (
          ids.some(
            (i) =>
              i >= geometry.userData.coastGeometry.baseVertices ||
              i % rows < settings.cliff.shelfRows - 1 ||
              i % rows > upperEnd,
          )
        )
          continue;
        const pts = ids.map((i) => point(geometry, i)),
          u = pts[1].map((v, k) => v - pts[0][k]),
          v = pts[2].map((v, k) => v - pts[0][k]),
          n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]],
          x = pts.reduce((sum, p) => sum + p[0], 0) / 3,
          z = pts.reduce((sum, p) => sum + p[2], 0) / 3,
          dx = coastDistance(x - 0.001, z) - coastDistance(x + 0.001, z),
          dz = coastDistance(x, z - 0.001) - coastDistance(x, z + 0.001);
        assert.ok(Math.hypot(...n) > 1e-8, "every upper strip triangle has finite positive area");
        if (ids.some((i) => i % rows === settings.cliff.shelfRows - 1))
          assert.ok(n[1] > 0, "the walk-side top strip never turns downward");
        else
          assert.ok(
            n[0] * dx + n[2] * dz > 0,
            "upper strips keep their outward winding through cusps",
          );
      }
    } finally {
      geometry.dispose();
    }
  }
});

test("the actual walk-side top triangles never rise above the original top-plane envelope", () => {
  const plane = (a, b, c) => {
      const u = b.map((value, axis) => value - a[axis]),
        v = c.map((value, axis) => value - a[axis]),
        n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      assert.ok(Math.abs(n[1]) > 1e-8, "the original walk-side triangle defines a height plane");
      return [-n[0] / n[1], -n[2] / n[1], (n[0] * a[0] + n[1] * a[1] + n[2] * a[2]) / n[1]];
    },
    sample = (plane, point) => plane[0] * point[0] + plane[1] * point[2] + plane[2];
  for (const tier of ["high", "balanced"])
    for (const slot of [null, modestBaseline.notch]) {
      const reference = modestBaseline.tiers[tier][slot ? "notched" : "unnotched"],
        original = originalTop(reference),
        geometry = cliffGeometry(height, coastGeometrySettings(tier).cliff, 190, slot),
        { rows, columns } = geometry.userData.coastGeometry;
      try {
        for (let c = 0; c < columns - 1; c++) {
          const planes = [
            plane(original(c, 5), original(c + 1, 5), original(c, 6)),
            plane(original(c, 6), original(c + 1, 5), original(c + 1, 6)),
          ];
          for (const ids of [
            [c * rows + 5, (c + 1) * rows + 5, c * rows + 6],
            [c * rows + 6, (c + 1) * rows + 5, (c + 1) * rows + 6],
          ]) {
            const points = ids.map((i) => point(geometry, i)),
              candidates = [...points],
              side = points.map((p) => sample(planes[0], p) - sample(planes[1], p));
            // New height minus max(old planes) is piecewise affine. Its maximum
            // is at a triangle corner or where the old planes' intersection
            // crosses an edge. This checks the entire delivered triangle,
            // including the walking body's d>=.5 envelope, without pixel sampling.
            for (let edge = 0; edge < 3; edge++) {
              const next = (edge + 1) % 3;
              if (side[edge] * side[next] < 0) {
                const t = side[edge] / (side[edge] - side[next]);
                candidates.push(
                  points[edge].map((value, axis) => value + (points[next][axis] - value) * t),
                );
              }
            }
            for (const p of candidates)
              assert.ok(
                p[1] <= Math.max(...planes.map((plane) => sample(plane, p))) + 3e-5,
                `${tier}: crown adds a raised walk-side plane at column ${c}`,
              );
          }
        }
      } finally {
        geometry.dispose();
      }
    }
});

test("both coastal tiers contain finite rock geometry within their unchanged triangle caps", () => {
  for (const tier of ["high", "balanced"]) {
    const { settings, cliff, stacks } = coast(tier);
    assert.ok(
      Object.isFrozen(settings) &&
        Object.isFrozen(settings.cliff) &&
        Object.isFrozen(settings.stacks),
    );
    assert.equal(settings.maxTriangles, tier === "high" ? 45000 : 25000);
    const triangles = cliff.index.count / 3 + stacks.attributes.position.count / 3;
    assert.ok(triangles <= settings.maxTriangles, `${tier}: ${triangles}`);
    for (const geometry of [cliff, stacks]) {
      const p = geometry.attributes.position,
        n = geometry.attributes.normal;
      assert.equal(p.count, n.count);
      for (const attribute of Object.values(geometry.attributes))
        for (const value of attribute.array) assert.ok(Number.isFinite(value));
      for (let i = 0; i < p.count; i++) {
        assert.ok(Number.isFinite(p.getX(i) + p.getY(i) + p.getZ(i)));
        const length = Math.hypot(n.getX(i), n.getY(i), n.getZ(i));
        assert.ok(Math.abs(length - 1) < 1e-5, `${tier}: normal ${i}, ${length}`);
      }
    }
    assert.equal(
      cliff.userData.coastGeometry.parts.filter(({ kind }) => kind === "buttress").length,
      3,
    );
  }
});

test("added buttresses and sparse rubble share only the face group and leave the original shelf unchanged", () => {
  for (const tier of ["high", "balanced"]) {
    const { settings, cliff } = coast(tier),
      info = cliff.userData.coastGeometry,
      bare = cliffGeometry(height, { ...settings.cliff, buttressColumns: 0, rubble: 0 });
    try {
      assert.equal(cliff.groups.length, 2);
      assert.deepEqual(cliff.groups[0], bare.groups[0]);
      assert.equal(cliff.groups[0].materialIndex, 0);
      assert.equal(cliff.groups[1].materialIndex, 1);
      assert.equal(cliff.groups[1].start, cliff.groups[0].count);
      assert.equal(cliff.groups[1].start + cliff.groups[1].count, cliff.index.count);
      assert.deepEqual([...cliff.index.array.slice(0, bare.index.count)], [...bare.index.array]);
      for (const name of ["position", "uv", "slateRoot", "slateShade", "slatePool", "aCliff"]) {
        const a = cliff.attributes[name],
          b = bare.attributes[name];
        assert.deepEqual([...a.array.slice(0, b.array.length)], [...b.array], name);
      }
      for (let i = 0; i < cliff.groups[0].count; i++)
        assert.ok(cliff.index.array[i] < info.baseVertices);
      const p = cliff.attributes.position,
        uv = cliff.attributes.uv,
        roots = cliff.attributes.slateRoot;
      for (let i = info.baseVertices; i < p.count; i++) {
        const [x, , z] = point(cliff, i);
        assert.ok(coastDistance(x, z) <= 0.3, `${tier}: raised solid in the walk at ${x},${z}`);
        assert.ok(Math.abs(uv.getX(i) - (x / 384 + 0.5)) < 1e-6);
        assert.ok(Math.abs(uv.getY(i) - (0.5 - z / 384)) < 1e-6);
        assert.deepEqual(
          [roots.getX(i), roots.getY(i), roots.getZ(i), roots.getW(i)],
          [0, 0, 0, 1],
        );
      }
      const rubble = info.parts.filter(({ kind }) => kind === "rubble");
      assert.ok(rubble.length > 5 && rubble.length <= settings.cliff.rubble);
      for (const part of rubble) {
        let low = Infinity,
          high = -Infinity;
        const centre = [0, 0, 0],
          normals = cliff.attributes.normal;
        for (let i = part.first; i < part.first + part.count; i++) {
          const p = point(cliff, i);
          for (let axis = 0; axis < 3; axis++) centre[axis] += p[axis] / part.count;
        }
        for (let i = part.first; i < part.first + part.count; i++) {
          low = Math.min(low, p.getY(i));
          high = Math.max(high, p.getY(i));
          const at = point(cliff, i),
            out = [normals.getX(i), normals.getY(i), normals.getZ(i)].reduce(
              (sum, normal, axis) => sum + normal * (at[axis] - centre[axis]),
              0,
            );
          assert.ok(out > 0, "rubble faces out into the light, including its caps");
        }
        assert.ok(low < SEA.level && high > SEA.level, "fragments sit through the waterline");
        assert.ok(high < SEA.level + 1.7, "the foot is sparse low rubble, not another wall");
      }
    } finally {
      bare.dispose();
    }
  }
});

test("ribs jut from the face below the clifftop, with broken crowns and substantial feet, never fins", () => {
  for (const tier of ["high", "balanced"]) {
    const { cliff } = coast(tier);
    for (const part of cliff.userData.coastGeometry.parts.filter(
      ({ kind }) => kind === "buttress",
    )) {
      const section = part.first + (part.columns / 2) * part.rows,
        rear = point(cliff, section + 2),
        front = point(cliff, section + 3),
        toe = point(cliff, section + part.rows - 2),
        heel = point(cliff, section + part.rows - 1),
        width = Math.hypot(front[0] - rear[0], front[2] - rear[2]),
        depth = Math.hypot(toe[0] - heel[0], toe[2] - heel[2]);
      assert.ok(width > 3, `${tier}: broad crown ${width}`);
      assert.ok(Math.abs(front[1] - rear[1]) < 1.2, "the crown has thickness, not a steep sheet");
      assert.ok(depth > 6, `${tier}: substantial foot ${depth}`);
      // Its whole crown stands below the clifftop (the plain at 1.25): a rib of the
      // face, never a rounded mass over the plain (the owner's call of 2026-10-17).
      for (let c = 0; c <= part.columns; c++)
        for (let r = 0; r < 4; r++) {
          const y = point(cliff, part.first + c * part.rows + r)[1];
          assert.ok(y < 1.25 - 0.3, `${tier}: a rib's crown at ${y} stands over the plain`);
        }
    }
  }
});

test("the near headland leaves an open alongshore corridor beside the tilted offshore hero", () => {
  const bounds = (geometry, first, count) => {
    let low = Infinity,
      high = -Infinity;
    for (let i = first; i < first + count; i++) {
      const [x, , z] = point(geometry, i),
        s = faultAlong(x, z);
      low = Math.min(low, s);
      high = Math.max(high, s);
    }
    return [low, high];
  };
  for (const tier of ["high", "balanced"]) {
    const { settings, cliff, stacks } = coast(tier),
      near = cliff.userData.coastGeometry.parts.find(({ kind }) => kind === "buttress"),
      vertices = settings.stacks.sides * (settings.stacks.rings * 6 + 3),
      headland = bounds(cliff, near.first, near.count),
      hero = bounds(stacks, vertices * 2, vertices);
    assert.ok(hero[0] - headland[1] > 25, `${tier}: rock bodies close the hero's water corridor`);
  }
});

test("new rock clears every falls notch, including a notch through a buttress", () => {
  for (const tier of ["high", "balanced"])
    for (const [centre, halfWidth] of [
      [-28.1714846, 5.16],
      [1, 6],
      [-88, 8],
    ]) {
      const settings = coastGeometrySettings(tier),
        geometry = cliffGeometry(height, settings.cliff, 190, [centre, halfWidth]);
      try {
        const { baseVertices, parts } = geometry.userData.coastGeometry;
        for (let i = baseVertices; i < geometry.attributes.position.count; i++) {
          const [x, , z] = point(geometry, i);
          assert.ok(Math.abs(faultAlong(x, z) - centre) >= halfWidth + 3 - 1e-4);
        }
        if (centre === 1 || centre === -88)
          assert.ok(!parts.some(({ kind, along }) => kind === "buttress" && along === centre));
        else
          assert.equal(
            parts.filter(({ kind }) => kind === "buttress").length,
            COAST_BUTTRESSES.length,
          );
      } finally {
        geometry.dispose();
      }
    }
});

test("coastal density changes sample the same cliff, buttress and periodic stack geology", () => {
  const high = coast("high"),
    low = coast("balanced"),
    hp = high.cliff.userData.coastGeometry,
    lp = low.cliff.userData.coastGeometry,
    sHigh = high.cliff.attributes.aCliff,
    sLow = low.cliff.attributes.aCliff,
    lowColumns = new Map();
  for (let c = 0; c < lp.columns; c++) lowColumns.set(sLow.getX(c * lp.rows).toFixed(4), c);
  let shared = 0;
  for (let c = 0; c < hp.columns; c++) {
    const other = lowColumns.get(sHigh.getX(c * hp.rows).toFixed(4));
    if (other === undefined) continue;
    for (let r = 0; r < hp.rows; r++) {
      const shelf = high.settings.cliff.shelfRows + 2,
        t = (r - shelf + 1) / high.settings.cliff.rows,
        row = r < shelf ? r : t * low.settings.cliff.rows + shelf - 1;
      if (Math.abs(row - Math.round(row)) > 1e-8) continue;
      close(
        point(high.cliff, c * hp.rows + r),
        point(low.cliff, other * lp.rows + Math.round(row)),
        "cliff sample",
      );
      shared++;
    }
  }
  assert.ok(shared > 1000);
  for (const h of hp.parts.filter(({ kind }) => kind === "buttress")) {
    const l = lp.parts.find(({ kind, along }) => kind === "buttress" && along === h.along);
    for (let c = 0; c <= h.columns; c += 3) {
      const lc = (c / h.columns) * l.columns;
      for (let r = 0; r < h.rows; r++) {
        const t = (r - 3) / high.settings.cliff.buttressRows,
          lr = r < 4 ? r : r === h.rows - 1 ? l.rows - 1 : t * low.settings.cliff.buttressRows + 3;
        if (Math.abs(lr - Math.round(lr)) > 1e-8) continue;
        close(
          point(high.cliff, h.first + c * h.rows + r),
          point(low.cliff, l.first + lc * l.rows + Math.round(lr)),
          "buttress sample",
        );
      }
    }
  }
  for (let k = 0; k < high.settings.stacks.list.length; k++)
    for (let r = 0; r <= high.settings.stacks.rings; r += 3)
      for (let j = 0; j < high.settings.stacks.sides; j += 3)
        close(
          stackPoint(high.stacks, high.settings.stacks, k, r, j),
          stackPoint(low.stacks, low.settings.stacks, k, (r / 3) * 2, (j / 3) * 2),
          "periodic stack sample",
        );
});

test("stack side seams close physically while grain continues, and the two heroes have distinct crowns", () => {
  for (const tier of ["high", "balanced"]) {
    const { settings, stacks } = coast(tier),
      { sides, rings, list } = settings.stacks,
      a = stacks.attributes.aCliff;
    for (let k = 0; k < list.length; k++)
      for (let r = 0; r < rings; r++) {
        const first = k * sides * (rings * 6 + 3) + r * sides * 6,
          last = first + (sides - 1) * 6;
        close(point(stacks, first), point(stacks, last + 1), "closed lower seam");
        close(point(stacks, first + 2), point(stacks, last + 4), "closed upper seam");
        assert.ok(a.getX(last + 1) > a.getX(first) + 10, "grain does not wrap back to zero");
      }
    const crown = Array.from(
        { length: sides },
        (_, j) => stackPoint(stacks, settings.stacks, 3, rings, j)[1],
      ),
      cap = point(stacks, 3 * sides * (rings * 6 + 3) + rings * sides * 6 + 2)[1];
    assert.ok(Math.max(...crown) - Math.min(...crown) > 3);
    assert.ok(cap < Math.max(...crown) - 3, "the split crown's cleft is not filled by a domed cap");
    const centre = (k, r) => {
      const points = Array.from({ length: sides }, (_, j) =>
        stackPoint(stacks, settings.stacks, k, r, j),
      );
      return [0, 2].map((axis) => points.reduce((sum, p) => sum + p[axis], 0) / sides);
    };
    const bottom = centre(2, 0),
      top = centre(2, rings);
    assert.ok(
      Math.hypot(top[0] - bottom[0], top[1] - bottom[1]) > 10,
      "the slab has a strong lean",
    );
    // A remnant of the plateau: the upright crown at about the plain's height (1.25).
    assert.ok(Math.abs(Math.max(...crown) - 1.25) < 2.5, "the upright crown stands at the plain");
  }
});

test("geometry builds repeat exactly and the shader reads the same analytic erosion fields", () => {
  const { settings, cliff, stacks } = coast("balanced"),
    again = cliffGeometry(height, settings.cliff),
    rock = stackGeometry(settings.stacks);
  try {
    for (const [a, b] of [
      [cliff, again],
      [stacks, rock],
    ])
      for (const name of Object.keys(a.attributes))
        assert.deepEqual(a.attributes[name].array, b.attributes[name].array, name);
    assert.deepEqual(cliff.index.array, again.index.array);
  } finally {
    again.dispose();
    rock.dispose();
  }
  const body = coastRockGlsl()
    .replace(
      /float (coastBedPhase|coastFracture)\(float s,float y,float (bed|v)\)/g,
      "function $1(s,y,$2)",
    )
    .replace(/float /g, "let ")
    .replace(/\b(sin|floor|abs)\(/g, "Math.$1(");
  const smoothstep = (a, b, x) => {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  const shader = new Function("smoothstep", `${body};return {coastBedPhase,coastFracture};`)(
    smoothstep,
  );
  for (let s = -150; s <= 150; s += 3.7)
    for (let y = -16; y <= 10; y += 1.3) {
      assert.ok(
        Math.abs(coastBedPhase(s, y) - shader.coastBedPhase(s, y, settings.cliff.bed)) < 1e-10,
      );
      const v = Math.min(1, Math.max(0, (1.5 - y) / 17.5));
      assert.ok(Math.abs(coastFracture(s, y, v) - shader.coastFracture(s, y, v)) < 1e-10);
    }
});

test("the visible stacks and their contact wash share a periodic broad profile and waterline centre", () => {
  const body = stackOutlineGlsl()
    .replace("float stackOutline(float k,float angle,float v)", "function outline(k,angle,v)")
    .replace(/\b(sin|cos)\(/g, "Math.$1(");
  const shader = new Function(`${body};return outline;`)();
  for (const tier of ["high", "balanced"]) {
    const { settings } = coast(tier);
    for (let k = 0; k < settings.stacks.list.length; k++) {
      const profile = stackWaterlineProfile(settings.stacks, k);
      assert.ok(profile.v > 0 && profile.v < 1 && profile.taper > 0.9);
      assert.ok(profile.center.every(Number.isFinite));
      assert.ok(coastDistance(...profile.center) < -10);
      let low = Infinity,
        high = -Infinity;
      for (let i = 0; i <= 48; i++) {
        const a = (i / 48) * Math.PI * 2,
          value = stackOutline(k, a, profile.v);
        assert.ok(Math.abs(shader(k, a, profile.v) - value) < 1e-12);
        assert.ok(Math.abs(stackOutline(k, a + Math.PI * 2, profile.v) - value) < 1e-12);
        low = Math.min(low, value);
        high = Math.max(high, value);
      }
      assert.ok(
        low > 0.6 && high < 1.3 && high - low > 0.15,
        "coarse rock shape is not an ellipse",
      );
    }
  }
});
