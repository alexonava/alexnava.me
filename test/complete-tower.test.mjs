import assert from "node:assert/strict";
import test from "node:test";
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Texture, Vector3 } from "three";
import { createCompleteTowerArchitecture } from "../src/scene/architecture.js";

function source(width = 2, height = 4, depth = 2) {
  const scene = new Group();
  const geometry = new BoxGeometry(width, height, depth);
  const material = new MeshStandardMaterial({ map: new Texture() });
  const mesh = new Mesh(geometry, material);
  mesh.position.set(8, 3, -6);
  scene.add(mesh);
  return { scene, mesh };
}

test("complete tower retains source proportions, authored maps, and one owned mesh", () => {
  const asset = source();
  const positions = asset.mesh.geometry.attributes.position.array.slice();
  const replacement = createCompleteTowerArchitecture({ asset, groundY: -5, yaw: 0.7 });
  const tower = replacement.root.getObjectByName("complete-meshy-tower");
  const dimensions = tower.geometry.boundingBox.getSize(new Vector3());
  assert.equal(replacement.root.children.length, 1);
  assert.ok(Math.abs(dimensions.y - 39) < 1e-6);
  assert.ok(Math.abs(dimensions.x / dimensions.y - 0.5) < 1e-6);
  assert.ok(Math.abs(dimensions.z / dimensions.y - 0.5) < 1e-6);
  assert.equal(tower.geometry.boundingBox.min.y, 0);
  assert.equal(replacement.root.position.y, -5 + 1.64);
  assert.equal(replacement.root.rotation.y, 0.7);
  assert.ok(replacement.root.userData.architecture.radius <= 20.4);
  assert.deepEqual(replacement.root.userData.architecture.sourceRoles, ["tower"]);
  assert.equal(tower.material.map, asset.mesh.material.map);
  assert.notEqual(tower.material, asset.mesh.material);
  assert.equal(tower.castShadow, true);
  assert.equal(tower.receiveShadow, true);
  assert.deepEqual(asset.mesh.geometry.attributes.position.array, positions);
  let geometryDisposals = 0,
    materialDisposals = 0,
    borrowedDisposals = 0;
  tower.geometry.addEventListener("dispose", () => geometryDisposals++);
  tower.material.addEventListener("dispose", () => materialDisposals++);
  for (const item of [asset.mesh.geometry, asset.mesh.material, asset.mesh.material.map]) {
    item.addEventListener("dispose", () => borrowedDisposals++);
  }
  assert.equal(replacement.dispose(), true);
  assert.equal(replacement.dispose(), false);
  assert.equal(geometryDisposals, 1);
  assert.equal(materialDisposals, 1);
  assert.equal(borrowedDisposals, 0);
});

test("wide complete tower fits the plinth uniformly and failed construction frees its clone", () => {
  const asset = source(20, 4, 12);
  const replacement = createCompleteTowerArchitecture({ asset });
  const dimensions = replacement.root.children[0].geometry.boundingBox.getSize(new Vector3());
  assert.ok(dimensions.y < 39);
  assert.ok(Math.abs(dimensions.x / dimensions.y - 5) < 1e-6);
  assert.ok(Math.abs(replacement.root.userData.architecture.radius - 20.4) < 1e-6);
  replacement.dispose();
  const clone = asset.mesh.geometry.clone.bind(asset.mesh.geometry);
  let disposals = 0;
  asset.mesh.geometry.clone = () => {
    const geometry = clone();
    geometry.addEventListener("dispose", () => disposals++);
    return geometry;
  };
  asset.mesh.material.clone = () => {
    throw new Error("Material unavailable");
  };
  assert.throws(() => createCompleteTowerArchitecture({ asset }), /Material unavailable/);
  assert.equal(disposals, 1);
  assert.throws(() => createCompleteTowerArchitecture({ asset, groundY: NaN }), /placement/);
});

test("earth footing seats the unchanged tower without the raised plinth", () => {
  const asset = source();
  const tower = createCompleteTowerArchitecture({ asset, groundY: -3, footingOffset: -0.08 });
  assert.equal(tower.root.position.y, -3.08);
  assert.equal(tower.root.children[0].geometry.boundingBox.min.y, 0);
  assert.ok(Math.abs(tower.root.children[0].geometry.boundingBox.max.y - 39) < 1e-6);
  tower.dispose();
  assert.throws(() => createCompleteTowerArchitecture({ asset, footingOffset: NaN }), /placement/);
});
