// Actual delivered geometry, with the original reconstructed from 252 recorded
// byte differences. The source-hash check makes the fixture self-contained in
// CI without a private asset archive or a Python/NumPy test dependency.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Matrix3, Vector3 } from "three";
import { modelBytes, parseGlb, readAccessor } from "./support/glb.mjs";

const baseline = JSON.parse(
  readFileSync(new URL("./support/landmark-baseline.json", import.meta.url)),
);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const raw = (attribute) =>
  Buffer.from(attribute.array.buffer, attribute.array.byteOffset, attribute.array.byteLength);
const point = (attribute, i) => new Vector3().fromBufferAttribute(attribute, i);

function mesh(bytes) {
  const glb = parseGlb(bytes),
    primitive = glb.json.meshes[0].primitives[0];
  const attributes = Object.fromEntries(
    Object.entries(primitive.attributes).map(([name, i]) => [name, readAccessor(glb, i)]),
  );
  return { ...glb, attributes, index: readAccessor(glb, primitive.indices) };
}

function original(bytes, reference) {
  const result = Buffer.from(bytes),
    patch = Buffer.from(reference.originalBytePatch, "base64");
  assert.equal(patch.length % 5, 0);
  let previous = -1;
  for (let i = 0; i < patch.length; i += 5) {
    const offset = patch.readUInt32LE(i);
    assert.ok(offset > previous && offset < result.length);
    assert.notEqual(result[offset], patch[i + 4]);
    result[offset] = patch[i + 4];
    previous = offset;
  }
  assert.equal(sha(result), reference.sourceSHA256, "reconstructed original SHA256");
  return mesh(result);
}

function differences(before, after) {
  const moved = new Set(),
    affected = new Set(),
    faces = [];
  for (let i = 0; i < before.attributes.POSITION.count; i++)
    if (!point(before.attributes.POSITION, i).equals(point(after.attributes.POSITION, i)))
      moved.add(i);
  for (let i = 0; i < before.index.count; i += 3) {
    const indices = [0, 1, 2].map((k) => before.index.getX(i + k));
    const touched = indices.some((v) => moved.has(v));
    if (touched) for (const v of indices) affected.add(v);
    faces.push({ indices, touched });
  }
  return { moved, affected, faces };
}

function face(mesh, indices) {
  const p = indices.map((i) => point(mesh.attributes.POSITION, i));
  const e1 = p[1].sub(p[0]),
    e2 = p[2].sub(p[0]),
    cross = e1.clone().cross(e2);
  return { e1, e2, normal: cross.clone().normalize(), area: cross.length() };
}

function basis({ e1, e2, normal: n }) {
  return new Matrix3().set(e1.x, e2.x, n.x, e1.y, e2.y, n.y, e1.z, e2.z, n.z);
}

// The repaired landmark: the tree's two tiers (tools/repair-landmark-geometry.py).
for (const tier of ["high", "balanced"]) {
  const name = `tree-${tier}`,
    reference = baseline[name],
    bytes = modelBytes("tree", tier),
    after = mesh(bytes),
    before = original(bytes, reference);
  const { moved, affected, faces } = differences(before, after);

  test(`${name} local repair retains original topology, UVs, maps, AABB and contacts`, () => {
    assert.equal(bytes.length, reference.bytes);
    assert.equal(sha(bytes), reference.approvedSHA256, "visually approved result");
    assert.deepEqual(after.json, before.json, "JSON/material/buffer layout unchanged");
    assert.equal(after.index.count / 3, reference.triangles);
    assert.equal(after.attributes.POSITION.count, reference.vertices);
    for (const [semantic, expected] of Object.entries(reference.originalChannelsSHA256)) {
      const old = semantic === "indices" ? before.index : before.attributes[semantic];
      assert.equal(sha(raw(old)), expected, `${semantic} original channel`);
      if (["TEXCOORD_0", "indices"].includes(semantic))
        assert.deepEqual(
          raw(semantic === "indices" ? after.index : after.attributes[semantic]),
          raw(old),
        );
    }
    for (const image of after.json.images) {
      const view = after.json.bufferViews[image.bufferView],
        start = after.bin + (view.byteOffset || 0);
      assert.deepEqual(
        bytes.subarray(start, start + view.byteLength),
        before.bytes.subarray(start, start + view.byteLength),
      );
    }
    const bounds = [
        [Infinity, Infinity, Infinity],
        [-Infinity, -Infinity, -Infinity],
      ],
      protectedRows = [];
    for (let i = 0; i < after.attributes.POSITION.count; i++) {
      const p = point(after.attributes.POSITION, i),
        q = point(before.attributes.POSITION, i);
      for (let k = 0; k < 3; k++) {
        const value = after.attributes.POSITION.array[i * 3 + k];
        bounds[0][k] = Math.min(bounds[0][k], value);
        bounds[1][k] = Math.max(bounds[1][k], value);
      }
      if (q.y < 0.5) {
        assert.ok(p.equals(q), `${i}: root moved`);
        protectedRows.push(raw(after.attributes.POSITION).subarray(i * 6, i * 6 + 6));
      }
      if (moved.has(i)) {
        assert.ok(p.distanceTo(q) <= reference.deltaCap, `${i}: excessive displacement`);
        const v = q.clone().sub(new Vector3(-0.13884071, 0.55025373, 0.21587493));
        const thin = v.dot(new Vector3(-0.33909859, -0.92057248, -0.19380002));
        const across = v.dot(new Vector3(0.71307868, -0.38589061, 0.58532661));
        const along = v.dot(new Vector3(-0.61362118, 0.06028876, 0.78729557));
        assert.ok(
          Math.abs(thin) < 0.012 && (across / 0.025) ** 2 + (along / 0.038) ** 2 < 1,
          `${i}: outside fork`,
        );
      }
    }
    assert.deepEqual(bounds, reference.bounds);
    assert.equal(sha(Buffer.concat(protectedRows)), reference.protectedPositionsSHA256);
    assert.equal(moved.size, reference.movedVertices);
    assert.equal(affected.size, reference.frameVertices);
  });

  test(`${name} preserves positive face area and transports local normal/tangent frames`, () => {
    const sums = new Map([...affected].map((i) => [i, { matrix: new Float64Array(9), area: 0 }]));
    for (const { indices, touched } of faces) {
      if (!indices.some((i) => affected.has(i))) continue;
      const a = face(before, indices),
        b = face(after, indices);
      if (a.area < 1e-12) {
        assert.equal(touched, false, "old degenerate face changed");
        continue;
      }
      assert.ok(b.area / a.area > 0.5, "face lost area or collapsed");
      assert.ok(
        a.normal.dot(b.normal) > Math.cos(Math.PI / 4),
        "face inverted/turned over 45 degrees",
      );
      const jacobian = basis(b).multiply(basis(a).invert());
      for (const i of indices) {
        const sum = sums.get(i);
        if (!sum) continue;
        for (let k = 0; k < 9; k++) sum.matrix[k] += jacobian.elements[k] * a.area;
        sum.area += a.area;
      }
    }
    for (let i = 0; i < after.attributes.POSITION.count; i++) {
      if (!affected.has(i)) {
        assert.ok(
          point(after.attributes.NORMAL, i).equals(point(before.attributes.NORMAL, i)),
          `${i}: unrelated normal changed`,
        );
        if (after.attributes.TANGENT)
          for (let k = 0; k < 4; k++)
            assert.equal(
              after.attributes.TANGENT.array[i * 4 + k],
              before.attributes.TANGENT.array[i * 4 + k],
            );
        continue;
      }
      const sum = sums.get(i),
        jacobian = new Matrix3().fromArray([...sum.matrix].map((v) => v / sum.area));
      assert.ok(jacobian.determinant() > 0.25, "mirrored/singular frame");
      const n = point(before.attributes.NORMAL, i)
        .applyMatrix3(jacobian.clone().invert().transpose())
        .normalize();
      const actualN = point(after.attributes.NORMAL, i);
      assert.ok(Math.abs(actualN.length() - 1) < 0.008);
      for (const key of ["x", "y", "z"])
        assert.ok(
          Math.abs(n[key] - actualN[key]) <= 1 / 254 + 1e-7,
          `${i}: ${key} normal transport`,
        );
      if (after.attributes.TANGENT) {
        const t = point(before.attributes.TANGENT, i).applyMatrix3(jacobian);
        t.addScaledVector(n, -t.dot(n)).normalize();
        const actualT = point(after.attributes.TANGENT, i);
        for (const key of ["x", "y", "z"])
          assert.ok(
            Math.abs(t[key] - actualT[key]) <= 1 / 254 + 1e-7,
            `${i}: ${key} tangent transport`,
          );
        assert.equal(after.attributes.TANGENT.getW(i), before.attributes.TANGENT.getW(i));
        assert.ok(
          Math.abs(actualN.clone().normalize().dot(actualT.clone().normalize())) < 0.012,
          "quantized tangent not perpendicular",
        );
      }
    }
  });
}
