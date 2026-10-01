import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
} from "three";
import { createTreeArchitecture } from "../src/scene/architecture.js";

const asset = () => {
  const scene = new Group();
  const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial());
  scene.add(mesh);
  return { scene };
};

test("bare tree metadata suppresses derived leaves through quality and film changes", () => {
  const source = asset();
  source.scene.userData.tree = { foliage: false };
  const tree = createTreeArchitecture({ asset: source, groundHeight: () => 0 });
  for (const tier of ["high", "balanced", "low", "high"]) {
    tree.setFilmTreatment(true);
    tree.applyQuality({ tier });
    assert.equal(tree.root.getObjectByName("estate-canopy-leaves"), undefined);
    assert.ok(tree.root.getObjectByName("tree-lantern-light"));
    tree.setFilmTreatment(false);
  }
  assert.equal(tree.dispose(), true);
  assert.equal(tree.dispose(), false);
  source.scene.children[0].geometry.dispose();
  source.scene.children[0].material.dispose();
});

test("tree retains its anchor and height with a quality-scaled non-shadow lantern", () => {
  const source = asset();
  const replacement = createTreeArchitecture({ asset: source, groundHeight: () => -2 });
  assert.deepEqual(replacement.root.position.toArray(), [58, -2, 38]);
  const tree = replacement.root.getObjectByName("meshy-tree");
  tree.geometry.computeBoundingBox();
  assert.ok(Math.abs(tree.geometry.boundingBox.max.y - 22) < 1e-5);
  assert.equal(tree.material.color.getHex(), 0xffffff);
  assert.equal(tree.material.emissive.getHex(), 0x26351f);
  assert.equal(tree.material.emissiveIntensity, 0.22);
  assert.deepEqual(tree.material.normalScale.toArray(), [0.46, 0.46]);
  assert.equal(replacement.light.castShadow, false);
  assert.equal(replacement.light.distance, 23);
  assert.equal(replacement.fillLight.name, "tree-fill-light");
  assert.deepEqual(replacement.fillLight.position.toArray(), [-3.8, 9.24, -2.5]);
  assert.equal(replacement.fillLight.castShadow, false);
  assert.equal(replacement.fillLight.distance, 30);
  replacement.applyQuality({ lighting: { practicalIntensityScale: 0.5 } });
  assert.equal(replacement.light.intensity, 2);
  assert.equal(replacement.fillLight.intensity, 1.2);
  replacement.light.distance=39; // A previously applied prop-scale range.
  replacement.fillLight.distance=37.8;
  replacement.setFilmTreatment(true);replacement.applyQuality({lighting:{practicalIntensityScale:1}});
  assert.equal(replacement.light.intensity,4.8);assert.equal(replacement.light.distance,10.5);
  assert.equal(replacement.fillLight.intensity,2.4*.95);assert.equal(replacement.fillLight.color.getHex(),0xc2d2ec);assert.equal(tree.material.emissiveIntensity,.04);
  // The unshadowed crown fill stops short of the lantern clearing in film.
  assert.equal(replacement.fillLight.distance,24);
  replacement.setFilmTreatment(false);assert.equal(replacement.light.distance,39);assert.equal(tree.material.emissiveIntensity,.22);
  assert.equal(replacement.fillLight.distance,37.8);
  replacement.applyQuality({lighting:{practicalIntensityScale:.5}});assert.equal(replacement.light.distance,39);
  assert.equal(replacement.dispose(), true);
  assert.equal(replacement.dispose(), false);
});

test("tree construction rolls back its cloned geometry when material preparation fails", () => {
  const source = asset();
  const mesh = source.scene.children[0];
  const clone = mesh.geometry.clone.bind(mesh.geometry);
  let derivedDisposals = 0,
    sourceDisposals = 0;
  mesh.geometry.addEventListener("dispose", () => sourceDisposals++);
  mesh.geometry.clone = () => {
    const result = clone();
    result.addEventListener("dispose", () => derivedDisposals++);
    return result;
  };
  mesh.material.clone = () => {
    throw new Error("Cannot clone tree material");
  };
  assert.throws(
    () => createTreeArchitecture({ asset: source, groundHeight: () => 0 }),
    /Cannot clone tree material/,
  );
  assert.equal(derivedDisposals, 1);
  assert.equal(sourceDisposals, 0);
});

async function treeGeometryFromGlb(tier) {
  const bytes = await readFile(
    new URL("../images/architecture/tree-" + tier + ".glb", import.meta.url),
  );
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString());
  const binaryOffset = 28 + jsonLength;
  const node = json.nodes.find((item) => item.mesh !== undefined);
  const primitive = json.meshes[node.mesh].primitives[0];
  const geometry = new BufferGeometry();
  const types = {
    5120: [Int8Array, 1, "readInt8"],
    5122: [Int16Array, 2, "readInt16LE"],
    5126: [Float32Array, 4, "readFloatLE"],
  };
  for (const [name, semantic] of [
    ["position", "POSITION"],
    ["normal", "NORMAL"],
  ]) {
    const accessor = json.accessors[primitive.attributes[semantic]];
    const view = json.bufferViews[accessor.bufferView];
    const [Type, width, reader] = types[accessor.componentType];
    const values = new Type(accessor.count * 3);
    const start = binaryOffset + (view.byteOffset || 0) + (accessor.byteOffset || 0);
    for (let i = 0; i < accessor.count; i++)
      for (let axis = 0; axis < 3; axis++) {
        values[i * 3 + axis] = bytes[reader](
          start + i * (view.byteStride || width * 3) + axis * width,
        );
      }
    geometry.setAttribute(name, new BufferAttribute(values, 3, Boolean(accessor.normalized)));
  }
  geometry.setAttribute(
    "uv",
    new Float32BufferAttribute(new Float32Array(geometry.attributes.position.count * 2), 2),
  );
  const mesh = new Mesh(geometry, new MeshStandardMaterial());
  if (node.matrix)
    new Matrix4().fromArray(node.matrix).decompose(mesh.position, mesh.quaternion, mesh.scale);
  else {
    if (node.translation) mesh.position.fromArray(node.translation);
    if (node.rotation) mesh.quaternion.fromArray(node.rotation);
    if (node.scale) mesh.scale.fromArray(node.scale);
  }
  const scene = new Group();
  scene.add(mesh);
  return { scene };
}

for (const tier of ["high", "balanced"])
  test(
    "actual " + tier + " quantized tree scales to22 units without changing its compact source",
    async () => {
      const source = await treeGeometryFromGlb(tier);
      const original = source.scene.children[0].geometry.attributes.position;
      assert.ok(original.array instanceof Int16Array);
      assert.equal(original.normalized, true);
      const before = [...original.array];
      const replacement = createTreeArchitecture({ asset: source, groundHeight: () => 0 });
      const geometry = replacement.root.getObjectByName("meshy-tree").geometry;
      assert.ok(geometry.attributes.position.array instanceof Float32Array);
      assert.ok(geometry.attributes.normal.array instanceof Float32Array);
      geometry.computeBoundingBox();
      assert.ok(Math.abs(geometry.boundingBox.min.y) < 1e-5);
      assert.ok(Math.abs(geometry.boundingBox.max.y - 22) < 1e-4);
      assert.deepEqual([...original.array], before);
      replacement.dispose();
    },
  );
