import assert from "node:assert/strict";
import test from "node:test";
import {
  BoxGeometry, BufferGeometry, Color, DirectionalLight, Float32BufferAttribute,
  Group, HemisphereLight, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial,
  MeshStandardMaterial, PerspectiveCamera, PointLight, Points, Scene, ShaderMaterial,
  Sprite, SpriteMaterial, Texture, Vector3,
} from "three";
import { createBlenderSnapshot, exportBlenderSnapshot, isBlenderExportAllowed } from "../src/scene/blender-export.js";
import { createEstateSkyMaterial } from "../src/scene/estate-sky.js";
import { createHillSilhouette } from "../src/scene/hill-silhouette.js";
import { createSolarBody } from "../src/scene/solar-body.js";

function fixture() {
  const scene = new Scene(), camera = new PerspectiveCamera(45, 16 / 9, 0.1, 600);
  scene.name = "Estate";
  camera.name = "Lantern study camera";
  camera.position.set(3, 4, 8);
  camera.lookAt(0, 1, 0);
  return { scene, camera, viewport: { width: 1600, height: 900 } };
}
const close = (a, b, epsilon = 1e-6) => assert.ok(Math.abs(a - b) < epsilon, `${a} != ${b}`);

test("export is restricted to explicit localhost diagnostic sessions", async () => {
  for (const url of ["http://localhost:4173/?sceneDebug=1", "http://127.0.0.1/?sceneDebug=1", "http://[::1]/?sceneDebug=1"]) {
    assert.equal(isBlenderExportAllowed(new URL(url)), true);
  }
  for (const url of ["https://alexnava.me/?sceneDebug=1", "http://localhost:4173/", "http://localhost/?sceneDebug=true", "http://localhost.example/?sceneDebug=1", "file:///test?sceneDebug=1"]) {
    assert.equal(isBlenderExportAllowed(new URL(url)), false);
    await assert.rejects(exportBlenderSnapshot({ location: new URL(url) }), /requires localhost/);
  }
});

test("instances share independently owned geometry and preserve hierarchy, transforms, colors and UVs", () => {
  const input = fixture(), parent = new Group();
  input.scene.position.x = 1;
  parent.position.set(2, 3, 4);
  input.scene.add(parent);
  const geometry = new BoxGeometry(), material = new MeshStandardMaterial({ color: 0xffffff });
  const mesh = new InstancedMesh(geometry, material, 2);
  mesh.name = "estate-canopy-leaves";
  mesh.setMatrixAt(0, new Matrix4().makeTranslation(0, 2, 0));
  mesh.setMatrixAt(1, new Matrix4().makeTranslation(4, 0, 0));
  mesh.setColorAt(0, new Color(1, 0.5, 0.25));
  mesh.setColorAt(1, new Color(0.2, 0.5, 1));
  parent.add(mesh);
  const before = Array.from(mesh.instanceMatrix.array);
  const snapshot = createBlenderSnapshot(input), group = snapshot.scene.getObjectByName(mesh.name);
  assert.equal(group.isGroup, true);
  assert.equal(group.children.length, 2);
  assert.equal(group.children[0].geometry, group.children[1].geometry);
  assert.notEqual(group.children[0].geometry, geometry);
  assert.deepEqual(Array.from(group.children[0].geometry.attributes.uv.array), Array.from(geometry.attributes.uv.array));
  assert.deepEqual(group.children[0].getWorldPosition(new Vector3()).toArray(), [3, 5, 4]);
  close(group.children[1].material.color.r, 0.2);
  group.children[0].geometry.attributes.position.setX(0, 99);
  assert.notEqual(geometry.attributes.position.getX(0), 99);
  assert.deepEqual(Array.from(mesh.instanceMatrix.array), before);
  assert.equal(snapshot.report.counts.triangles, 24);
  snapshot.dispose();
});

test("circular runtime metadata is removed without dirtying or disposing live resources", () => {
  const input = fixture(), texture = new Texture({ width: 4, height: 4 });
  texture.userData.cycle = texture.userData;
  const material = new MeshStandardMaterial({ map: texture, normalMap: texture });
  material.userData.runtime = material;
  material.userData.note = "retained";
  material.onBeforeCompile = () => {};
  const mesh = new Mesh(new BoxGeometry(), material);
  mesh.name = "slate-ground";
  mesh.userData.self = mesh;
  mesh.userData.loop = mesh.userData;
  mesh.userData.role = "ground";
  input.scene.add(mesh);
  let sourceDisposals = 0;
  for (const resource of [mesh.geometry, material, texture]) resource.addEventListener("dispose", () => sourceDisposals++);
  const sourceVersion = texture.source.version, textureVersion = texture.version;
  const snapshot = createBlenderSnapshot(input), copy = snapshot.scene.getObjectByName(mesh.name);
  assert.doesNotThrow(() => JSON.stringify(snapshot.report));
  assert.equal(copy.userData.self, undefined);
  assert.equal(copy.userData.role, "ground");
  assert.notEqual(copy.material, material);
  assert.notEqual(copy.material.map, texture);
  assert.notEqual(copy.material.map.source, texture.source);
  assert.equal(copy.material.map.image, texture.image);
  assert.equal(copy.material.map, copy.material.normalMap);
  assert.equal(texture.source.version, sourceVersion);
  assert.equal(texture.version, textureVersion);
  assert.ok(snapshot.report.approximations.some(item => item.reason.includes("onBeforeCompile")));
  assert.equal(snapshot.dispose(), true);
  assert.equal(snapshot.dispose(), false);
  assert.equal(sourceDisposals, 0);
});

test("point fields honor active count and shader celestial positions while becoming triangles", () => {
  const input = fixture(), geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute([1, 1, 1, 2, 2, 2, 3, 3, 3], 3));
  geometry.setAttribute("aCelestialPosition", new Float32BufferAttribute([10, 50, 20, 30, 60, 40, 50, 70, 60], 3));
  geometry.setAttribute("aSize", new Float32BufferAttribute([1, 2, 3], 1));
  geometry.setAttribute("color", new Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1], 3));
  geometry.setDrawRange(0, 2);
  const material = new ShaderMaterial({ name: "CelestialStars", uniforms: {
    uNebulaLayers: { value: 3 }, uCelestialTier: { value: 1 }, uVisibility: { value: 0.8 },
  } });
  const stars = new Points(geometry, material); stars.name = "celestial-starfield"; input.scene.add(stars);
  const snapshot = createBlenderSnapshot(input), copy = snapshot.scene.getObjectByName(stars.name);
  assert.equal(copy.isMesh, true);
  assert.equal(copy.geometry.index.count, 12);
  const center = new Vector3();
  for (let i = 0; i < 4; i++) center.add(new Vector3().fromBufferAttribute(copy.geometry.attributes.position, i));
  center.multiplyScalar(0.25);
  close(center.x, 10); close(center.y, 50); close(center.z, 20);
  assert.equal(geometry.drawRange.count, 2);
  assert.equal(geometry.attributes.position.getX(0), 1);
  snapshot.dispose();
});

test("sprites freeze camera-facing transforms and invisible branches are excluded", () => {
  const input = fixture(), parent = new Group();
  parent.rotation.y = 0.4; input.scene.add(parent);
  const sprite = new Sprite(new SpriteMaterial({ color: 0xffaa44 }));
  sprite.name = "glow"; sprite.position.set(2, 1, 0); sprite.scale.set(4, 3, 1); parent.add(sprite);
  const hidden = new Group(); hidden.visible = false; hidden.name = "inactive-procedural-fallback";
  hidden.add(new Mesh(new BoxGeometry(), new MeshBasicMaterial())); input.scene.add(hidden);
  const snapshot = createBlenderSnapshot(input), copy = snapshot.scene.getObjectByName("glow");
  assert.equal(copy.isMesh, true);
  assert.equal(snapshot.scene.getObjectByName(hidden.name), undefined);
  const direction = new Vector3(0, 0, 1).transformDirection(copy.matrixWorld);
  const cameraDirection = new Vector3(0, 0, 1).applyQuaternion(input.camera.quaternion);
  close(direction.dot(cameraDirection), 1);
  snapshot.dispose();
});

test("lights retain direction and hemisphere world data; external active camera is included", () => {
  const input = fixture(), light = new DirectionalLight(0xaabbff, 1.2);
  light.name = "moon"; light.position.set(8, 10, 0); light.target.position.set(1, 2, -3); input.scene.add(light);
  const hemisphere = new HemisphereLight(0x667799, 0x302820, 0.7); hemisphere.name = "cool-fill"; input.scene.add(hemisphere);
  const snapshot = createBlenderSnapshot(input), copy = snapshot.scene.getObjectByName("moon");
  const actual = new Vector3(0, 0, -1).transformDirection(copy.matrixWorld);
  const expected = light.target.position.clone().sub(light.position).normalize();
  close(actual.dot(expected), 1);
  assert.equal(snapshot.scene.getObjectByName(input.camera.name).isPerspectiveCamera, true);
  assert.equal(snapshot.scene.getObjectByName("cool-fill").userData.babelLight.type, "HemisphereLight");
  assert.equal(snapshot.report.lights.length, 2);
  assert.equal(snapshot.report.camera.fov, 45);
  snapshot.dispose();
});

test("off-axis camera projection is preserved in full in the report and glTF extras", () => {
  const input = fixture();
  input.camera.projectionMatrix.elements[8] = -0.34;
  input.camera.projectionMatrix.elements[9] = 0.18;
  const original = input.camera.projectionMatrix.toArray();
  const snapshot = createBlenderSnapshot(input);
  const copy = snapshot.scene.getObjectByName(input.camera.name);
  const extras = copy.userData.babelCameraProjection;
  assert.equal(extras.matrix.length, 16);
  assert.deepEqual(extras.matrix, original);
  assert.deepEqual(snapshot.report.camera.projectionMatrix, original);
  assert.deepEqual(extras.viewport, input.viewport);
  assert.equal(extras.aspect, input.camera.aspect);
  assert.ok(snapshot.report.approximations.some(item => item.reason.includes("VERTICAL sensor fit")));
  extras.matrix[8] = 99;
  assert.equal(input.camera.projectionMatrix.elements[8], -0.34);
  assert.equal(snapshot.report.camera.projectionMatrix[8], -0.34);
  snapshot.dispose();
});

test("light metadata preserves shadow allocation instead of enabling shadows on fill lights", () => {
  const input = fixture(), key = new DirectionalLight(), fill = new DirectionalLight(), lantern = new PointLight();
  key.name = "main moon"; key.castShadow = true;
  fill.name = "cool fill"; fill.castShadow = false;
  lantern.name = "lantern light"; lantern.castShadow = false;
  input.scene.add(key, fill, lantern);
  const snapshot = createBlenderSnapshot(input);
  for (const source of [key, fill, lantern]) {
    const copy = snapshot.scene.getObjectByName(source.name);
    assert.equal(copy.castShadow, source.castShadow);
    assert.equal(copy.userData.babelLight.castShadow, source.castShadow);
    assert.equal(snapshot.report.lights.find(light => light.name === source.name).castShadow, source.castShadow);
  }
  snapshot.dispose();
});

test("actual sky, film mountains, sun and prominence shaders survive as editable meshes", async () => {
  const input = fixture();
  const skyMaterial = createEstateSkyMaterial({ skyTopColor: 0x181d2d, skyBottomColor: 0x4f4d55,
    skyGlowColor: 0xc0895d, sunDirection: new Vector3(0, 1, 0), sunColor: 0xffaa55 });
  skyMaterial.uniforms.uFilm.value = 1;
  const sky = new Mesh(new BoxGeometry(400, 400, 400), skyMaterial); input.scene.add(sky);
  const mountains = createHillSilhouette({ groundHeight: () => 0, skyRadius: 260 });
  // The film ranges are a lazy chunk (mountain-build.js): wait until they land.
  mountains.setFilmTreatment(true); await mountains.ready; input.scene.add(mountains.mesh);
  assert.ok(mountains.mesh.geometry.attributes.position.count > 0, "the ranges landed before the snapshot");
  const sun = createSolarBody({ parent: input.scene, position: new Vector3(20, 30, -90), profile: { tier: "high" } });
  const snapshot = createBlenderSnapshot(input);
  const skyCopy = snapshot.scene.getObjectByName("estate-sky-shell");
  assert.equal(skyCopy.material.isMeshBasicMaterial, true);
  assert.equal(skyCopy.geometry.attributes.color.count, skyCopy.geometry.attributes.position.count);
  const mountainCopy = snapshot.scene.getObjectByName("hill-silhouette");
  assert.deepEqual(mountainCopy.position.toArray(), input.camera.position.toArray());
  assert.equal(mountainCopy.geometry.attributes.color.count, mountainCopy.geometry.attributes.position.count);
  const loops = snapshot.scene.getObjectByName("solar-prominences");
  const a = new Vector3().fromBufferAttribute(loops.geometry.attributes.position, 0);
  const b = new Vector3().fromBufferAttribute(loops.geometry.attributes.position, 1);
  assert.ok(a.distanceTo(b) > 0, "shader-only ribbon width must be baked into real geometry");
  assert.ok(snapshot.scene.getObjectByName("solar-corona").material.map);
  snapshot.dispose(); sun.dispose(); mountains.dispose();
});

test("GLTFExporter produces binary geometry, camera and punctual lights from the snapshot", async () => {
  const previous = globalThis.FileReader;
  globalThis.FileReader = class {
    readAsArrayBuffer(blob) { blob.arrayBuffer().then(result => { this.result = result; this.onloadend?.(); }); }
  };
  try {
    const input = fixture();
    input.camera.projectionMatrix.elements[8] = -0.34;
    input.camera.projectionMatrix.elements[9] = 0.18;
    input.scene.add(new Mesh(new BoxGeometry(), new MeshStandardMaterial()));
    const light = new DirectionalLight(); light.name = "key moon"; light.castShadow = true;
    input.scene.add(light);
    const output = await exportBlenderSnapshot({ ...input, location: new URL("http://localhost/?sceneDebug=1") });
    const data = new DataView(output.arrayBuffer);
    assert.equal(data.getUint32(0, true), 0x46546c67);
    const json = JSON.parse(new TextDecoder().decode(new Uint8Array(output.arrayBuffer, 20, data.getUint32(12, true))));
    assert.equal(json.meshes.length, 1);
    assert.equal(json.cameras.length, 1);
    const cameraNode = json.nodes.find(node => node.camera === 0);
    assert.deepEqual(cameraNode.extras.babelCameraProjection.matrix, input.camera.projectionMatrix.toArray());
    assert.equal(cameraNode.extras.babelCameraProjection.matrix.length, 16);
    assert.equal(json.extensions.KHR_lights_punctual.lights.length, 1);
    assert.equal(json.nodes.find(node => node.name === "key moon").extras.babelLight.castShadow, true);
    assert.equal(output.report.byteLength, output.arrayBuffer.byteLength);
  } finally { globalThis.FileReader = previous; }
});
