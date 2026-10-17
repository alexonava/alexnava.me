import assert from "node:assert/strict";
import test from "node:test";
import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from "three";
import {
  createCompleteTowerArchitecture,
  createTreeArchitecture,
  prepareArchitecture,
} from "../src/scene/architecture.js";
import { glbAsset, modelBytes, parseGlb, readAccessor } from "./support/glb.mjs";

await import("../src/scene/architecture-prepare.js");

async function scheduledPreparation(asset, options) {
  const tasks = [];
  let slices = 0;
  const ready = prepareArchitecture(asset, { ...options, schedule: (task) => tasks.push(task) });
  // Let the demand-loaded helper settle before driving its explicit task queue.
  await new Promise((resolve) => setImmediate(resolve));
  return {
    ready,
    tasks,
    step() {
      tasks.shift()?.();
      slices++;
    },
    async finish() {
      while (tasks.length) this.step();
      return ready;
    },
    get slices() {
      return slices;
    },
  };
}

function bytes(attribute) {
  const array = attribute.array;
  return Buffer.from(array.buffer, array.byteOffset, array.byteLength);
}

function assertSameGeometry(actual, expected) {
  assert.deepEqual(Object.keys(actual.attributes), Object.keys(expected.attributes));
  for (const name of Object.keys(expected.attributes)) {
    assert.equal(
      actual.attributes[name].array.constructor,
      expected.attributes[name].array.constructor,
      name,
    );
    assert.equal(actual.attributes[name].normalized, expected.attributes[name].normalized, name);
    assert.deepEqual(bytes(actual.attributes[name]), bytes(expected.attributes[name]), name);
  }
  assert.deepEqual(bytes(actual.index), bytes(expected.index));
  assert.deepEqual(actual.boundingBox, expected.boundingBox);
  assert.deepEqual(actual.boundingSphere, expected.boundingSphere);
}

for (const role of ["tower", "tree"])
  for (const tier of ["high", "balanced"]) {
    test(`cooperative ${role} preparation preserves every ${tier} geometry byte and film normal`, async () => {
      const model = modelBytes(role, tier);
      const asset = glbAsset(model);
      const original = asset.scene.children[0].geometry;
      // The general framing fixture needs no tangents; actual loaded towers
      // carry them, including their handedness, through every transform.
      const glb = parseGlb(model);
      const tangent = glb.json.meshes[0].primitives[0].attributes.TANGENT;
      if (tangent !== undefined) original.setAttribute("tangent", readAccessor(glb, tangent));
      original.computeBoundingBox();
      original.computeBoundingSphere();
      const originalPosition = Buffer.from(bytes(original.attributes.position));
      const originalNormal = Buffer.from(bytes(original.attributes.normal));
      const construct = role === "tree" ? createTreeArchitecture : createCompleteTowerArchitecture;
      const expected = construct({ asset, groundHeight: () => 0 });
      const preparation = await scheduledPreparation(asset, { role });
      assert.equal(preparation.tasks.length, 1, "derived work starts in another task");
      assert.equal(await preparation.finish(), true);
      assert.ok(preparation.slices > 1, "actual delivered geometry yields between bounded slices");
      const actual = construct({ asset, groundHeight: () => 0 });
      const name = role === "tree" ? "meshy-tree" : "complete-meshy-tower";
      const actualMesh = actual.root.getObjectByName(name);
      const expectedMesh = expected.root.getObjectByName(name);
      assertSameGeometry(actualMesh.geometry, expectedMesh.geometry);
      assert.equal(actualMesh.material.color.getHex(), expectedMesh.material.color.getHex());
      assert.deepEqual(actual.root.userData.architecture, expected.root.userData.architecture);
      for (const film of [true, false]) {
        actual.setFilmTreatment(film);
        expected.setFilmTreatment(film);
        assertSameGeometry(actualMesh.geometry, expectedMesh.geometry);
        assert.equal(
          actualMesh.material.emissiveIntensity,
          expectedMesh.material.emissiveIntensity,
        );
      }
      assert.deepEqual(
        bytes(original.attributes.position),
        originalPosition,
        "source positions remain compact and unchanged",
      );
      assert.deepEqual(
        bytes(original.attributes.normal),
        originalNormal,
        "source normals remain unchanged",
      );
      actual.dispose();
      expected.dispose();
    });
  }

function watchedAsset(real = false) {
  const asset = real ? glbAsset(modelBytes("tree", "high")) : { scene: new Group() };
  if (!real) asset.scene.add(new Mesh(new BoxGeometry(1, 2, 1), new MeshStandardMaterial()));
  const source = asset.scene.children[0].geometry;
  const clone = source.clone.bind(source);
  let cloned = 0,
    disposed = 0,
    sourceDisposed = 0;
  source.addEventListener("dispose", () => sourceDisposed++);
  source.clone = () => {
    cloned++;
    const geometry = clone();
    geometry.addEventListener("dispose", () => disposed++);
    return geometry;
  };
  return {
    asset,
    get cloned() {
      return cloned;
    },
    get disposed() {
      return disposed;
    },
    get sourceDisposed() {
      return sourceDisposed;
    },
  };
}

test("aborting a cooperative build releases its partial clone and never frees the parsed source", async () => {
  const h = watchedAsset(true);
  const controller = new AbortController();
  const preparation = await scheduledPreparation(h.asset, {
    role: "tree",
    signal: controller.signal,
  });
  preparation.step();
  controller.abort();
  assert.equal(await preparation.ready, false);
  while (preparation.tasks.length) preparation.step();
  assert.equal(h.cloned, 1);
  assert.equal(h.disposed, 1);
  assert.equal(h.sourceDisposed, 0);
});

test("an aborted finished preparation is withdrawn before a constructor can consume it", async () => {
  const h = watchedAsset();
  const controller = new AbortController();
  const preparation = await scheduledPreparation(h.asset, {
    role: "tree",
    signal: controller.signal,
  });
  assert.equal(await preparation.finish(), true);
  controller.abort();
  assert.equal(h.disposed, 1);
  const tree = createTreeArchitecture({ asset: h.asset, groundHeight: () => 0 });
  assert.equal(h.cloned, 2, "a withdrawn record cannot supply a disposed clone");
  tree.dispose();
  assert.equal(h.disposed, 2);
  assert.equal(h.sourceDisposed, 0);
});

test("consuming a preparation transfers clone disposal to the existing constructor", async () => {
  const h = watchedAsset();
  const controller = new AbortController();
  const preparation = await scheduledPreparation(h.asset, {
    role: "tree",
    signal: controller.signal,
  });
  assert.equal(await preparation.finish(), true);
  const tree = createTreeArchitecture({ asset: h.asset, groundHeight: () => 0 });
  assert.equal(h.cloned, 1, "the synchronous commit reuses the prepared geometry");
  controller.abort();
  assert.equal(h.disposed, 0, "an old load abort cannot free a committed tree");
  tree.dispose();
  assert.equal(h.disposed, 1);
  assert.equal(h.sourceDisposed, 0);
});

test("a failed constructor releases the consumed prepared clone through its existing rollback", async () => {
  const h = watchedAsset();
  const preparation = await scheduledPreparation(h.asset, { role: "tree" });
  assert.equal(await preparation.finish(), true);
  h.asset.scene.children[0].material.clone = () => {
    throw new Error("material failed");
  };
  assert.throws(
    () => createTreeArchitecture({ asset: h.asset, groundHeight: () => 0 }),
    /material failed/,
  );
  assert.equal(h.disposed, 1);
  assert.equal(h.sourceDisposed, 0);
});
