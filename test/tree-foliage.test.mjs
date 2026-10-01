import assert from "node:assert/strict";
import test from "node:test";
import {
  BoxGeometry,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
  Vector3,
} from "three";
import { createTreeFoliage, smoothTreeNormals } from "../src/scene/tree-foliage.js";
import { createTreeArchitecture } from "../src/scene/architecture.js";

test("derived canopy is repeatable, follows the tree transform, scales by quality and disposes once", () => {
  const source = new BoxGeometry(9, 20, 9).translate(0, 10, 0),
    original = source.attributes.position.array.slice();
  const parent = new Group(),
    a = createTreeFoliage(source, parent),
    b = createTreeFoliage(source, parent);
  assert.equal(a.mesh.count, 3600);
  assert.equal(a.mesh.visible, false);
  assert.deepEqual(a.mesh.instanceMatrix.array, b.mesh.instanceMatrix.array);
  assert.deepEqual(a.mesh.instanceColor.array, b.mesh.instanceColor.array);
  assert.equal(a.mesh.geometry.attributes.position.count, 6, "two triangles per leaf");
  assert.equal(a.mesh.material.transparent, false);
  assert.equal(a.mesh.material.roughness, 0.96);
  assert.equal(a.mesh.material.emissive.getHex(), 0);
  assert.deepEqual(source.attributes.position.array, original);
  a.setActive(true);
  a.applyQuality({ tier: "balanced" });
  assert.equal(a.mesh.count, 1800);
  assert.equal(a.mesh.visible, true);
  a.applyQuality({ tier: "low" });
  assert.equal(a.mesh.visible, false);
  a.applyQuality({ tier: "high" });
  assert.equal(a.mesh.count, 3600);
  parent.scale.setScalar(1.26);
  parent.position.set(55, 2, 36);
  parent.updateMatrixWorld(true);
  const point = new Vector3(1, 2, 3);
  assert.deepEqual(a.mesh.localToWorld(point).toArray(), [56.26, 4.52, 39.78]);
  let released = 0;
  for (const r of [a.mesh.geometry, a.mesh.material])
    r.addEventListener("dispose", () => released++);
  assert.equal(a.dispose(), true);
  assert.equal(a.dispose(), false);
  assert.equal(released, 2);
  assert.equal(a.mesh.parent, null);
  b.dispose();
  source.dispose();
});

function canopyPatches(rightSize, rightSegments) {
  const positions = [],
    indices = [];
  for (const [x, size, segments] of [
    [-12, 8, 1],
    [4, rightSize, rightSegments],
  ]) {
    const start = positions.length / 3;
    for (let y = 0; y <= segments; y++)
      for (let column = 0; column <= segments; column++)
        positions.push(x + (column * size) / segments, 12 + (y * size) / segments, 0);
    for (let y = 0; y < segments; y++)
      for (let column = 0; column < segments; column++) {
        const a = start + y * (segments + 1) + column,
          b = a + 1,
          c = a + segments + 1,
          d = c + 1;
        indices.push(a, b, d, a, d, c);
      }
  }
  // An empty face must neither attract leaves nor break cumulative sampling.
  indices.unshift(0, 0, 0);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

test("leaf density follows area rather than triangle count on indexed and unindexed canopies", () => {
  for (const [rightSize, rightSegments, expectedLeftFraction] of [
    [8, 8, 0.5],
    [4, 1, 0.8],
  ]) {
    const indexed = canopyPatches(rightSize, rightSegments),
      unindexed = indexed.toNonIndexed(),
      results = [];
    for (const source of [indexed, unindexed]) {
      const before = source.attributes.position.array.slice(),
        foliage = createTreeFoliage(source, new Group());
      assert.equal(foliage.mesh.count, 3600);
      let left = 0;
      for (let i = 0; i < foliage.mesh.count; i++)
        if (foliage.mesh.instanceMatrix.array[i * 16 + 12] < 0) left++;
      assert.ok(
        Math.abs(left / foliage.mesh.count - expectedLeftFraction) < 0.035,
        `${left} leaves on left patch; expected fraction ${expectedLeftFraction}`,
      );
      assert.ok(foliage.mesh.instanceMatrix.array.every(Number.isFinite));
      assert.deepEqual(source.attributes.position.array, before);
      results.push(foliage.mesh.instanceMatrix.array.slice());
      foliage.dispose();
      source.dispose();
    }
    assert.deepEqual(results[0], results[1], "indexing alone must not change placement");
  }
});

test("a canopy with no surface area remains empty and hidden across quality changes", () => {
  const source = new BufferGeometry();
  source.setAttribute("position", new Float32BufferAttribute([4, 12, 0, 4, 12, 0, 4, 12, 0], 3));
  const foliage = createTreeFoliage(source, new Group());
  foliage.setActive(true);
  for (const tier of ["high", "balanced", "low", "high"]) {
    foliage.applyQuality({ tier });
    assert.equal(foliage.mesh.count, 0);
    assert.equal(foliage.mesh.visible, false);
  }
  assert.equal(foliage.dispose(), true);
  assert.equal(foliage.dispose(), false);
  source.dispose();
});

test("softened normals preserve positions, UV seams and the original normal buffer", () => {
  const g = new BoxGeometry(2, 2, 2),
    n = g.attributes.normal.array.slice(),
    p = g.attributes.position.array.slice(),
    uv = g.attributes.uv.array.slice();
  const smooth = smoothTreeNormals(g);
  assert.notEqual(smooth, g.attributes.normal);
  assert.deepEqual(g.attributes.normal.array, n);
  assert.deepEqual(g.attributes.position.array, p);
  assert.deepEqual(g.attributes.uv.array, uv);
  for (let i = 0; i < smooth.count; i++) {
    const v = new Vector3().fromBufferAttribute(smooth, i);
    assert.ok(Math.abs(v.length() - 1) < 1e-6);
    assert.ok(v.dot(new Vector3().fromBufferAttribute(g.attributes.position, i)) > 0);
  }
  g.dispose();
});

test("film tree owns its foliage under the scaled model, restores normals, and places lantern outside trunk", () => {
  const scene = new Group();
  scene.add(new Mesh(new BoxGeometry(1, 2, 1), new MeshStandardMaterial()));
  const c = createTreeArchitecture({
    asset: { scene },
    groundHeight: (x, z) => x * 0.01 + z * 0.02,
  });
  const tree = c.root.getObjectByName("meshy-tree"),
    n = tree.geometry.attributes.normal,
    original = n.array.slice();
  assert.equal(c.root.getObjectByName("estate-canopy-leaves").parent, tree);
  const l = c.root.getObjectByName("tree-lantern");
  assert.ok(Math.abs(Math.hypot(l.position.x, l.position.z) - 5) < 1e-6);
  assert.ok(Math.abs(l.position.y - (l.position.x * 0.01 + l.position.z * 0.02)) < 1e-6);
  c.setFilmTreatment(true);
  assert.equal(tree.geometry.attributes.normal, n);
  assert.notDeepEqual(n.array, original);
  c.applyQuality({ tier: "balanced" });
  assert.equal(c.root.getObjectByName("estate-canopy-leaves").count, 1800);
  c.setFilmTreatment(false);
  assert.equal(tree.geometry.attributes.normal, n);
  assert.deepEqual(n.array, original);
  c.dispose();
});
