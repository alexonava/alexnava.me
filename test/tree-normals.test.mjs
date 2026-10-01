import assert from "node:assert/strict";
import test from "node:test";
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Vector3 } from "three";
import { smoothTreeNormals } from "../src/scene/tree-normals.js";
import { createTreeArchitecture } from "../src/scene/architecture.js";

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

test("film tree softens its normals in place, restores them, and places the lantern outside the trunk", () => {
  const scene = new Group();
  scene.add(new Mesh(new BoxGeometry(1, 2, 1), new MeshStandardMaterial()));
  const c = createTreeArchitecture({
    asset: { scene },
    groundHeight: (x, z) => x * 0.01 + z * 0.02,
  });
  const tree = c.root.getObjectByName("meshy-tree"),
    n = tree.geometry.attributes.normal,
    original = n.array.slice();
  const l = c.root.getObjectByName("tree-lantern");
  assert.ok(Math.abs(Math.hypot(l.position.x, l.position.z) - 5) < 1e-6);
  assert.ok(Math.abs(l.position.y - (l.position.x * 0.01 + l.position.z * 0.02)) < 1e-6);
  c.setFilmTreatment(true);
  assert.equal(tree.geometry.attributes.normal, n);
  assert.notDeepEqual(n.array, original);
  c.applyQuality({ tier: "balanced" });
  assert.notDeepEqual(n.array, original, "a quality change keeps the softened normals");
  c.setFilmTreatment(false);
  assert.equal(tree.geometry.attributes.normal, n);
  assert.deepEqual(n.array, original);
  c.dispose();
});
