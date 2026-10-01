import assert from "node:assert/strict";
import test from "node:test";
import { parseGlb } from "./support/glb.mjs";
import { readFile } from "node:fs/promises";
import {
  Box3,
  BoxGeometry,
  BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Texture,
  Vector3,
} from "three";
import { createLanternArchitecture, createLanternMount } from "../src/scene/lantern.js";
import { createTreeArchitecture } from "../src/scene/architecture.js";
import { createPropScale } from "../src/scene/prop-scale.js";
import { createCinematicCamera, cinematicSafeArea } from "../src/scene/cinematic.js";
import { DIRECTED_SHOTS, measureShot } from "../src/scene/directed-shots.js";
import { ARCHITECTURE_ASSET_BUDGETS } from "../src/scene/architecture-assets.js";

const near = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) < 1e-5, `${actual} != ${expected}`);
function readyMount(options = {}) {
  let prepared;
  const ready = new Promise((resolve) => {
    prepared = resolve;
  });
  return Object.assign(
    createLanternMount({
      ...options,
      onPrepared() {
        options.onPrepared?.();
        prepared();
      },
    }),
    { ready },
  );
}
function asset({ width = 1.3, height = 3.1, depth = 1, translated = false } = {}) {
  const scene = new Group();
  const geometry = new BoxGeometry(width, height, depth);
  const material = new MeshStandardMaterial({
    color: 0x947345,
    roughness: 0.53,
    metalness: 0.37,
    emissive: 0xffbb55,
    emissiveIntensity: 0.65,
  });
  for (const name of ["map", "normalMap", "roughnessMap", "metalnessMap", "emissiveMap"])
    material[name] = new Texture();
  const mesh = new Mesh(geometry, material);
  mesh.position.y = height / 2;
  if (translated) mesh.position.set(4, height / 2 - 5, -3);
  scene.add(mesh);
  scene.userData.lantern = {
    luminousCenter: [
      translated ? 4 : 0,
      height * 0.43 + (translated ? -5 : 0),
      translated ? -3 : 0,
    ],
  };
  return { scene, geometry, material };
}
function treeFixture() {
  const source = asset({ height: 22, width: 8, depth: 8 });
  const ground = (x, z) => 0.03 * x - 0.02 * z;
  const tree = createTreeArchitecture({
    asset: source,
    groundHeight: ground,
    anchor: [55.1, 36.1],
  });
  const root = new Group();
  root.add(tree.root);
  const scale = createPropScale({ groundRoot: root, groundHeight: ground });
  scale.setTree(tree);
  scale.setActive(true);
  return {
    tree,
    root,
    scale,
    ground,
    dispose() {
      scale.dispose();
      tree.dispose();
    },
  };
}

test("lantern normalization preserves shape, UVs, authored PBR and borrowed textures", () => {
  const source = asset({ translated: true }),
    materialBefore = source.material.clone();
  const vertices = source.geometry.attributes.position.array.slice(),
    uv = source.geometry.attributes.uv.array.slice();
  let sourceDisposals = 0,
    cloneDisposals = 0;
  source.geometry.addEventListener("dispose", () => sourceDisposals++);
  source.material.addEventListener("dispose", () => sourceDisposals++);
  source.material.map.addEventListener("dispose", () => sourceDisposals++);
  const lantern = createLanternArchitecture({ asset: source, anisotropy: 6 });
  const mesh = lantern.root.children[0],
    bounds = new Box3().setFromObject(lantern.root);
  near(bounds.min.y, 0);
  near(bounds.max.y, 2.48);
  near(bounds.getCenter(new Vector3()).x, 0);
  near(bounds.getCenter(new Vector3()).z, 0);
  near(bounds.max.x - bounds.min.x, (1.3 / 3.1) * 2.48);
  near(lantern.luminousCenter.y, 0.43 * 2.48);
  assert.deepEqual(mesh.geometry.attributes.uv.array, uv);
  assert.deepEqual(source.geometry.attributes.position.array, vertices);
  assert.notEqual(mesh.geometry, source.geometry);
  assert.notEqual(mesh.material, source.material);
  assert.deepEqual(mesh.material.color, materialBefore.color);
  assert.equal(mesh.material.roughness, materialBefore.roughness);
  assert.equal(mesh.material.metalness, materialBefore.metalness);
  assert.deepEqual(mesh.material.emissive, materialBefore.emissive);
  assert.equal(mesh.material.emissiveIntensity, materialBefore.emissiveIntensity);
  for (const name of ["map", "normalMap", "roughnessMap", "metalnessMap", "emissiveMap"])
    assert.equal(mesh.material[name], source.material[name]);
  mesh.geometry.addEventListener("dispose", () => cloneDisposals++);
  mesh.material.addEventListener("dispose", () => cloneDisposals++);
  assert.equal(lantern.dispose(), true);
  assert.equal(lantern.dispose(), false);
  assert.equal(cloneDisposals, 2);
  assert.equal(sourceDisposals, 0);
});

test("staged lantern waits for tree and cut, preserves anchor and light count, and restores before release", async () => {
  const f = treeFixture(),
    events = [],
    mount = readyMount({ onChange: (state) => events.push(state.committed) });
  const parent = f.tree.root.getObjectByName("tree-lantern"),
    point = parent.getWorldPosition(new Vector3());
  const fallback = [...parent.children],
    light = f.tree.light,
    lightPosition = light.position.clone();
  const release = mount.stage(asset());
  assert.equal(mount.take(), false, "the independent tree is still loading");
  mount.setTree(f.tree);
  await mount.ready;
  assert.equal(mount.take({ revealed: true, running: true }), false);
  assert.deepEqual(parent.children, fallback);
  assert.equal(mount.take({ revealed: true, running: true, cut: true }), true);
  assert.equal(mount.take({ cut: true }), false);
  assert.equal(parent.getObjectByName("lantern-frame"), undefined);
  assert.equal(parent.getObjectByName("tree-lantern-light"), light);
  let lights = 0;
  f.tree.root.traverse((o) => {
    if (o.isLight) lights++;
  });
  assert.equal(lights, 2);
  near(parent.getWorldPosition(new Vector3()).distanceTo(point), 0);
  const bounds = new Box3().setFromObject(parent);
  near(bounds.min.y, f.ground(point.x, point.z));
  near(bounds.max.y - bounds.min.y, 1.98);
  near(light.position.y, 0.43 * 2.48);
  f.scale.setActive(false);
  near(light.position.y, 0.43 * 2.48, "prop-scale undo must not overwrite the luminous center");
  f.scale.setActive(true);
  near(light.position.y, 0.43 * 2.48);
  release();
  assert.deepEqual(new Set(parent.children), new Set(fallback));
  assert.deepEqual(light.position, lightPosition);
  assert.deepEqual(events, [true, false]);
  assert.equal(mount.committed, false);
  mount.dispose();
  f.dispose();
});

test("compact normalized attributes decode before lantern transforms", () => {
  const source = asset({ width: 1, height: 1, depth: 1 });
  const original = source.geometry.attributes.position.array;
  const quantized = new Int16Array(original.length);
  original.forEach((value, i) => {
    quantized[i] = Math.round(value * 32767);
  });
  source.geometry.setAttribute("position", new BufferAttribute(quantized, 3, true));
  source.scene.position.set(12, -7, 3);
  const copy = quantized.slice();
  const replacement = createLanternArchitecture({ asset: source });
  const bounds = new Box3().setFromObject(replacement.root);
  near(bounds.min.y, 0);
  near(bounds.max.y, 2.48);
  assert.ok(
    replacement.root.children[0].geometry.attributes.position.array instanceof Float32Array,
  );
  assert.deepEqual(quantized, copy);
  replacement.dispose();
});

test("pre-reveal and paused scenes commit on the next frame and tree loss cancels attachment", async () => {
  for (const frame of [
    { revealed: false, running: true },
    { revealed: true, running: false },
  ]) {
    const f = treeFixture(),
      mount = readyMount();
    mount.setTree(f.tree);
    const release = mount.stage(asset());
    await mount.ready;
    assert.equal(mount.take(frame), true);
    mount.setTree(null);
    assert.equal(mount.committed, false);
    assert.ok(f.tree.root.getObjectByName("lantern-frame"));
    assert.equal(mount.take(frame), false);
    mount.setTree(f.tree);
    assert.equal(mount.take(frame), true, "a new tree can use the retained current asset");
    assert.equal(mount.dispose(), true);
    assert.equal(mount.dispose(), false);
    release();
    assert.equal(mount.take(frame), false);
    f.dispose();
  }
});

test("invalid lantern staging retains the procedural stand-in without borrowed resource disposal", () => {
  const f = treeFixture(),
    mount = createLanternMount();
  mount.setTree(f.tree);
  const invalid = asset();
  invalid.geometry.deleteAttribute("uv");
  assert.throws(() => mount.stage(invalid), /UV-mapped/);
  assert.equal(mount.take(), false);
  assert.ok(f.tree.root.getObjectByName("lantern-frame"));
  mount.dispose();
  f.dispose();
});

test("lantern swap refreshes cached camera measurements for desktop and portrait details", async () => {
  for (const [width, height] of [
    [1600, 900],
    [390, 844],
  ]) {
    const f = treeFixture(),
      camera = new PerspectiveCamera(38, width / height, 0.1, 450);
    const area = cinematicSafeArea(
      width,
      height,
      height > width ? { right: 340, bottom: 253 } : { right: 530, bottom: 220 },
      { top: height - 110 },
    );
    const cinematic = createCinematicCamera({
      camera,
      selected: "tree",
      angle: 1,
      getSafeArea: () => area,
      getGroundY: f.ground,
    });
    cinematic.setSubject("tree", f.tree.root);
    cinematic.setStatus({ kind: "tree", status: "ready" });
    cinematic.setSubject("tower", f.tree.root);
    cinematic.setStatus({ kind: "tower", status: "ready" });
    cinematic.apply({ width, height, reducedMotion: true });
    const oldFrame = cinematic.frame;
    const mount = readyMount({
      onChange({ tree }) {
        cinematic.setSubject("tree", tree?.root ?? null);
      },
    });
    mount.setTree(f.tree);
    mount.stage(asset({ width: 2.4 }));
    await mount.ready;
    mount.take();
    cinematic.apply({ width, height, reducedMotion: true });
    assert.notEqual(
      cinematic.frame,
      oldFrame,
      "unchanged tree matrix still needs a fresh focal volume",
    );
    for (const angle of [1, 3]) {
      cinematic.setPreviewShot("tree", angle);
      cinematic.apply({ width, height, reducedMotion: true });
      camera.updateMatrixWorld(true);
      const measured = measureShot(f.tree.root, DIRECTED_SHOTS.tree[1]);
      for (let i = 0; i < measured.points.length; i += 3) {
        const p = new Vector3().fromArray(measured.points, i).project(camera);
        assert.ok(
          Math.abs(p.x) < 1 && Math.abs(p.y) < 1,
          `${width} ${DIRECTED_SHOTS.tree[angle].name} crops lantern`,
        );
      }
    }
    mount.dispose();
    cinematic.dispose();
    f.dispose();
  }
});

test("flame preparation is synchronous to stage ownership, ignores stale imports and retains static glow on failure", async () => {
  const f = treeFixture(),
    requests = [];
  let configured = 0,
    prepared = 0,
    effectDisposals = 0;
  const module = {
    createLanternFlame() {
      configured++;
      return {
        update: () => 1.12,
        dispose() {
          effectDisposals++;
        },
      };
    },
  };
  const mount = createLanternMount({
    loadFlame: () => new Promise((resolve, reject) => requests.push({ resolve, reject })),
    onPrepared: () => prepared++,
  });
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  mount.setTree(f.tree);
  const obsolete = mount.stage(asset());
  assert.equal(
    typeof obsolete,
    "function",
    "the asset controller receives its lease cleanup immediately",
  );
  assert.equal(mount.take(), false);
  await flush();
  obsolete();
  const current = mount.stage(asset());
  await flush();
  requests[0].resolve(module);
  await flush();
  assert.equal(configured, 0, "an obsolete chunk completion cannot touch disposed materials");
  assert.equal(prepared, 0);
  requests[1].reject(new Error("flame chunk unavailable"));
  await flush();
  assert.equal(prepared, 1);
  assert.equal(mount.take(), true, "the current lantern remains usable with its static emission");
  const parent = f.tree.root.getObjectByName("tree-lantern");
  const material = parent.getObjectByName("supplied-meshy-lantern").children[0].material;
  assert.equal(material.emissiveIntensity, 0.65);
  const intensity = f.tree.light.intensity;
  mount.update({ deltaSeconds: 0.1 });
  assert.equal(f.tree.light.intensity, intensity);
  current();
  mount.stage(asset());
  await flush();
  requests[2].resolve(module);
  await flush();
  assert.equal(configured, 1);
  assert.equal(mount.take(), true);
  mount.update({ deltaSeconds: 0.1 });
  near(f.tree.light.intensity, intensity * 1.12);
  mount.dispose();
  near(f.tree.light.intensity, intensity);
  assert.equal(effectDisposals, 1);
  f.dispose();
});

test("disposing before flame preparation prevents any later material attachment or redraw", async () => {
  let resolve,
    prepared = 0,
    configured = 0;
  const mount = createLanternMount({
    loadFlame: () =>
      new Promise((done) => {
        resolve = done;
      }),
    onPrepared: () => prepared++,
  });
  mount.stage(asset());
  await Promise.resolve();
  mount.dispose();
  resolve({
    createLanternFlame() {
      configured++;
    },
  });
  await new Promise((done) => setImmediate(done));
  assert.equal(configured, 0);
  assert.equal(prepared, 0);
  assert.equal(mount.take(), false);
});

test("both delivered lantern tiers embed authored PBR maps, masked emission and emitter metadata within budget", async () => {
  for (const tier of ["high", "balanced"]) {
    const bytes = await readFile(
      new URL(`../images/architecture/lantern-${tier}.glb`, import.meta.url),
    );
    assert.equal(bytes.toString("ascii", 0, 4), "glTF");
    assert.equal(bytes.readUInt32LE(8), bytes.length);
    assert.ok(bytes.length <= ARCHITECTURE_ASSET_BUDGETS[tier]);
    const { json } = parseGlb(bytes);
    const primitive = json.meshes[0].primitives[0],
      material = json.materials[primitive.material];
    assert.equal(json.accessors[primitive.indices].count / 3, 3000);
    for (const field of [
      material.normalTexture,
      material.pbrMetallicRoughness.baseColorTexture,
      material.pbrMetallicRoughness.metallicRoughnessTexture,
      material.emissiveTexture,
    ]) {
      assert.ok(
        Number.isInteger(field.index),
        `${tier} must preserve all authored maps and the emission mask`,
      );
      const image = json.images[json.textures[field.index].source];
      assert.ok(Number.isInteger(image.bufferView));
      assert.equal(image.uri, undefined);
    }
    assert.ok(material.emissiveFactor.some((value) => value > 0));
    const emitter = json.scenes[json.scene ?? 0].extras.lantern.luminousCenter;
    assert.equal(emitter.length, 3);
    assert.ok(emitter.every(Number.isFinite));
    assert.ok(emitter[1] > 0 && emitter[1] < 2.48);
    assert.equal(json.animations?.length || 0, 0);
  }
});
