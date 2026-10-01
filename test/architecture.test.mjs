import assert from "node:assert/strict";
import test from "node:test";
import { glbAsset, modelBytes } from "./support/glb.mjs";
import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from "three";
import { createTreeArchitecture } from "../src/scene/architecture.js";

const asset = () => {
  const scene = new Group();
  const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial());
  scene.add(mesh);
  return { scene };
};

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
  replacement.light.distance = 39; // A previously applied prop-scale range.
  replacement.fillLight.distance = 37.8;
  replacement.setFilmTreatment(true);
  replacement.applyQuality({ lighting: { practicalIntensityScale: 1 } });
  assert.equal(replacement.light.intensity, 4.8);
  assert.equal(replacement.light.distance, 10.5);
  assert.equal(replacement.fillLight.intensity, 2.4 * 0.95);
  assert.equal(replacement.fillLight.color.getHex(), 0xc2d2ec);
  assert.equal(tree.material.emissiveIntensity, 0.04);
  // The unshadowed crown fill stops short of the lantern clearing in film.
  assert.equal(replacement.fillLight.distance, 24);
  replacement.setFilmTreatment(false);
  assert.equal(replacement.light.distance, 39);
  assert.equal(tree.material.emissiveIntensity, 0.22);
  assert.equal(replacement.fillLight.distance, 37.8);
  replacement.applyQuality({ lighting: { practicalIntensityScale: 0.5 } });
  assert.equal(replacement.light.distance, 39);
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

for (const tier of ["high", "balanced"])
  test(
    "actual " + tier + " quantized tree scales to22 units without changing its compact source",
    async () => {
      const source = glbAsset(modelBytes("tree", tier));
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
