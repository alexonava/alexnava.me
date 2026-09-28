import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Vector3,
} from "three";
import {
  ARCHITECTURE,
  bendFlight,
  bendWall,
  createTowerArchitecture,
  createTreeArchitecture,
  towerRadius,
} from "../src/scene/architecture.js";

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

test("wall deformation follows the tapered shell with finite unit normals", () => {
  const geometry = new BoxGeometry(1, 1, 1, 8, 2, 1).translate(0, 0.5, 0);
  bendWall(geometry, { bottom: 18.5, height: 4.25, arc: Math.PI / 8 });
  const point = new Vector3();
  const normal = new Vector3();
  for (let i = 0; i < geometry.attributes.position.count; i++) {
    point.fromBufferAttribute(geometry.attributes.position, i);
    const radius = Math.hypot(point.x, point.z);
    assert.ok(Math.abs(radius - towerRadius(point.y)) < 0.73);
    normal.fromBufferAttribute(geometry.attributes.normal, i);
    assert.ok(Math.abs(normal.length() - 1) < 1e-5);
  }
  assert.equal(towerRadius(1.5), 12.2);
  assert.equal(towerRadius(35.5), 8.8);
  geometry.dispose();
});

test("measured walking levels create equal risers and contiguous flight joins", () => {
  const levels = [0, 0.145, 0.282, 0.418, 0.558, 0.708, 0.858, 1];
  const rise = (ARCHITECTURE.stairEnd - ARCHITECTURE.stairStart) / 8;
  assert.equal(ARCHITECTURE.stairStart, 0.7);
  assert.equal(ARCHITECTURE.stairEnd, 33.5);
  for (let flight = 0; flight < 8; flight++) {
    for (let step = 0; step < levels.length; step++) {
      const geometry = new BoxGeometry(1, 1, 1);
      const position = geometry.attributes.position;
      for (let i = 0; i < position.count; i++)
        position.setXYZ(i, 0.5, levels[step], step === 7 ? 0.5 : -0.5);
      bendFlight(geometry, flight, 0.32 * Math.PI, { levels });
      const point = new Vector3().fromBufferAttribute(position, 0);
      assert.ok(Math.abs(point.y - (ARCHITECTURE.stairStart + (flight + step / 7) * rise)) < 1e-5);
      if (step === 7 && flight < 7) {
        const next = new BoxGeometry(1, 1, 1);
        const nextPosition = next.attributes.position;
        for (let i = 0; i < nextPosition.count; i++) nextPosition.setXYZ(i, 0.5, 0, -0.5);
        bendFlight(next, flight + 1, 0.32 * Math.PI, { levels });
        assert.ok(point.distanceTo(new Vector3().fromBufferAttribute(nextPosition, 0)) < 1e-5);
        next.dispose();
      }
      geometry.dispose();
    }
  }
});

test("tower assembly instances walls and merges flights without mutating borrowed assets", () => {
  const assets = Object.fromEntries(
    ["stairs", "wall", "base", "crown"].map((role) => [role, asset()]),
  );
  const sourceArrays = Object.values(assets).map((item) => [
    ...item.scene.children[0].geometry.attributes.position.array,
  ]);
  const tower = createTowerArchitecture({
    assets,
    groundY: -7,
    baseRecords: [{ position: new Vector3(18, 0, 0) }],
  });
  assert.equal(tower.root.position.y, -7);
  assert.equal(
    tower.root.children.filter((mesh) => mesh.name.startsWith("masonry-tier")).length,
    8,
  );
  assert.equal(
    tower.root.children.filter((mesh) => mesh.name === "eight-solid-stair-flights").length,
    1,
  );
  assert.equal(tower.root.userData.architecture.wallCount, 125);
  assert.deepEqual(tower.root.userData.architecture.sourceRoles.sort(), [
    "base",
    "crown",
    "stairs",
    "wall",
  ]);
  const wall = tower.root.getObjectByName("masonry-tier-0");
  const stairs = tower.root.getObjectByName("eight-solid-stair-flights");
  const support = tower.root.getObjectByName("spiral-masonry-support");
  const crown = tower.root.getObjectByName("bastion-breach");
  const base = tower.root.getObjectByName("ruined-base-masonry");
  stairs.geometry.computeBoundingBox();
  support.geometry.computeBoundingBox();
  assert.ok(Math.abs(stairs.geometry.boundingBox.min.y - ARCHITECTURE.stairStart) < 1e-5);
  assert.ok(Math.abs(stairs.geometry.boundingBox.max.y - ARCHITECTURE.stairEnd) < 1e-5);
  assert.ok(Math.abs(support.geometry.boundingBox.min.y - 0.1) < 1e-5);
  const structure = tower.root.userData.architecture.stairSupports;
  assert.equal(structure.closedCore, true);
  assert.equal(structure.flights.length, 8);
  assert.ok(structure.triangles <= structure.maxTriangles);
  assert.equal(support.material, wall.material);
  assert.equal(support.castShadow, true);
  assert.equal(support.receiveShadow, true);
  assert.equal(tower.root.getObjectByName("stair-meshy-wall-apron"), undefined);
  assert.equal(tower.root.getObjectByName("stair-meshy-base-corbel-supports"), undefined);
  for (const flight of structure.flights) {
    assert.ok(flight.topY > flight.stairBottomY);
    assert.ok(flight.topY < flight.firstTreadY);
  }
  assert.equal(wall.material.color.getHex(), 0xe4ded0);
  assert.deepEqual(wall.material.normalScale.toArray(), [0.36, 0.36]);
  assert.equal(wall.instanceColor.count, 16);
  const firstWallTone = new Color();
  const secondWallTone = new Color();
  wall.getColorAt(0, firstWallTone);
  wall.getColorAt(1, secondWallTone);
  assert.notDeepEqual(firstWallTone.toArray(), secondWallTone.toArray());
  assert.ok(firstWallTone.r > 0.9 && firstWallTone.g > 0.9 && firstWallTone.b > 0.85);
  assert.equal(stairs.material.color.getHex(), 0xe2ddd1);
  assert.deepEqual(stairs.material.normalScale.toArray(), [0.4, 0.4]);
  assert.equal(crown.material.color.getHex(), 0xddd8cf);
  assert.deepEqual(crown.material.normalScale.toArray(), [0.32, 0.32]);
  assert.equal(base.material.color.getHex(), 0xd9d0be);
  assert.deepEqual(base.material.normalScale.toArray(), [0.38, 0.38]);
  let borrowedDisposals = 0;
  let supportDisposals = 0;
  support.geometry.addEventListener("dispose", () => supportDisposals++);
  Object.values(assets).forEach((item, index) => {
    const mesh = item.scene.children[0];
    assert.deepEqual([...mesh.geometry.attributes.position.array], sourceArrays[index]);
    mesh.geometry.addEventListener("dispose", () => borrowedDisposals++);
    mesh.material.addEventListener("dispose", () => borrowedDisposals++);
  });
  tower.dispose();
  tower.dispose();
  assert.equal(supportDisposals, 1);
  assert.equal(borrowedDisposals, 0);
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

test("curved wall front faces retain outward winding and authored normals across a UV seam", () => {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new Float32BufferAttribute(
      [-0.5, 0, 0.5, 0, 0, 0.5, 0, 1, 0.5, 0, 0, 0.5, 0.5, 0, 0.5, 0, 1, 0.5],
      3,
    ),
  );
  geometry.setAttribute(
    "normal",
    new Float32BufferAttribute(Array.from({ length: 6 }, () => [0, 0, 1]).flat(), 3),
  );
  bendWall(geometry, { bottom: 10, height: 4.25, arc: Math.PI / 2 });
  const { position, normal } = geometry.attributes;
  const seamA = new Vector3().fromBufferAttribute(normal, 1);
  const seamB = new Vector3().fromBufferAttribute(normal, 3);
  assert.ok(seamA.distanceTo(seamB) < 1e-7, "UV seam split an authored smooth normal");
  for (let triangle = 0; triangle < 2; triangle++) {
    const a = new Vector3().fromBufferAttribute(position, triangle * 3);
    const b = new Vector3().fromBufferAttribute(position, triangle * 3 + 1);
    const c = new Vector3().fromBufferAttribute(position, triangle * 3 + 2);
    const face = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
    const center = a
      .clone()
      .add(b)
      .add(c)
      .multiplyScalar(1 / 3);
    const radial = new Vector3(center.x, 0, center.z).normalize();
    assert.ok(face.dot(radial) > 0.8, "Outer wall winding faces inward");
  }
  for (let index = 0; index < normal.count; index++) {
    const n = new Vector3().fromBufferAttribute(normal, index);
    const p = new Vector3().fromBufferAttribute(position, index);
    assert.ok(n.dot(new Vector3(p.x, 0, p.z).normalize()) > 0.99);
    assert.ok(Math.abs(n.length() - 1) < 1e-6);
  }
  geometry.dispose();
});

test("wall joints alternate by half a sector and all instanced buffers release exactly once", () => {
  const assets = Object.fromEntries(
    ["stairs", "wall", "base", "crown"].map((role) => [role, asset()]),
  );
  const yaw = 0.32 * Math.PI;
  const tower = createTowerArchitecture({
    assets,
    collapseYaw: yaw,
    baseRecords: [{ position: new Vector3(18, 0, 0) }],
  });
  const matrix = new Matrix4();
  for (let tier = 0; tier < 8; tier++) {
    tower.root.getObjectByName("masonry-tier-" + tier).getMatrixAt(0, matrix);
    const facing = new Vector3(1, 0, 0).applyMatrix4(matrix);
    const expected = yaw + ((tier % 2 ? 0 : 0.5) * Math.PI) / 8;
    // Top tier omits the three breach sectors, so its first retained instance is sector2.
    const angle = tier === 7 ? expected + (2 * Math.PI) / 8 : expected;
    assert.ok(Math.abs(facing.x - Math.cos(angle)) < 1e-6);
    assert.ok(Math.abs(facing.z - Math.sin(angle)) < 1e-6);
  }
  const instances = tower.root.children.filter((mesh) => mesh.isInstancedMesh);
  const counts = instances.map(() => 0);
  instances.forEach((mesh, index) => mesh.addEventListener("dispose", () => counts[index]++));
  assert.equal(tower.root.userData.architecture.wallCount, 125);
  assert.equal(instances.length, 9);
  assert.equal(tower.dispose(), true);
  assert.equal(tower.dispose(), false);
  assert.deepEqual(counts, Array(9).fill(1));
});

test("tower assembly failure frees every derived geometry and material while leaving sources owned by the loader", () => {
  const assets = Object.fromEntries(
    ["stairs", "wall", "base", "crown"].map((role) => [role, asset()]),
  );
  assets.stairs.scene.children[0].userData.walking = { levels: [0, 0, 1] };
  const derived = [];
  let sourceDisposals = 0;
  Object.values(assets).forEach(({ scene }) => {
    for (const resource of [scene.children[0].geometry, scene.children[0].material]) {
      resource.addEventListener("dispose", () => sourceDisposals++);
      const clone = resource.clone.bind(resource);
      resource.clone = () => {
        const result = clone();
        const counter = { count: 0 };
        result.addEventListener("dispose", () => counter.count++);
        derived.push(counter);
        return result;
      };
    }
  });
  assert.throws(() => createTowerArchitecture({ assets }), /Invalid stair walking levels/);
  assert.ok(derived.length > 10);
  assert.ok(derived.every((counter) => counter.count === 1));
  assert.equal(sourceDisposals, 0);
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

function quantizedAsset() {
  const source = asset();
  const mesh = source.scene.children[0];
  for (const name of ["position", "normal"]) {
    const original = mesh.geometry.getAttribute(name);
    const values = new Int16Array(original.count * 3);
    for (let i = 0; i < original.count; i++) {
      values[i * 3] = Math.round(original.getX(i) * 32767);
      values[i * 3 + 1] = Math.round(original.getY(i) * 32767);
      values[i * 3 + 2] = Math.round(original.getZ(i) * 32767);
    }
    mesh.geometry.setAttribute(name, new BufferAttribute(values, 3, true));
  }
  mesh.scale.set(3, 4, 2);
  mesh.position.set(2, 5, -1);
  return source;
}

test("tower quantized clones become Float32 before source transforms and world-space bending", () => {
  const assets = Object.fromEntries(
    ["stairs", "wall", "base", "crown"].map((role) => [role, quantizedAsset()]),
  );
  const originals = Object.values(assets).map((item) => [
    ...item.scene.children[0].geometry.attributes.position.array,
  ]);
  const tower = createTowerArchitecture({ assets });
  tower.root.traverse((object) => {
    if (!object.geometry) return;
    assert.ok(object.geometry.attributes.position.array instanceof Float32Array);
    assert.ok(object.geometry.attributes.normal.array instanceof Float32Array);
    object.geometry.computeBoundingBox();
    const { min, max } = object.geometry.boundingBox;
    assert.ok([min.x, min.y, min.z, max.x, max.y, max.z].every(Number.isFinite));
  });
  const upper = tower.root.getObjectByName("masonry-tier-7").geometry.boundingBox;
  assert.ok(
    upper.max.y > 35 && upper.max.y < 36,
    "Quantized world coordinates wrapped at the crown",
  );
  Object.values(assets).forEach((item, index) => {
    const position = item.scene.children[0].geometry.attributes.position;
    assert.ok(position.array instanceof Int16Array);
    assert.equal(position.normalized, true);
    assert.deepEqual([...position.array], originals[index]);
  });
  tower.dispose();
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
