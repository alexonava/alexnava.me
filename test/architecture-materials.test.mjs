import assert from "node:assert/strict";
import test from "node:test";
import { BoxGeometry, BufferAttribute, Group, Mesh, MeshStandardMaterial, Texture } from "three";
import {
  createCompleteTowerArchitecture,
  createTreeArchitecture,
  materialFor,
} from "../src/scene/architecture.js";

function sourceAsset(mapped) {
  const scene = new Group(),
    material = new MeshStandardMaterial({ roughness: 0.85 }),
    geometry = new BoxGeometry(1, 2, 1);
  material.map = new Texture();
  if (mapped) {
    material.normalMap = new Texture();
    material.roughnessMap = new Texture();
  }
  scene.add(new Mesh(geometry, material));
  const resources = [
    geometry,
    material,
    material.map,
    material.normalMap,
    material.roughnessMap,
  ].filter(Boolean);
  let disposals = 0;
  for (const resource of resources) resource.addEventListener("dispose", () => disposals++);
  return {
    scene,
    geometry,
    material,
    resources,
    get disposals() {
      return disposals;
    },
  };
}

function materialShader(material) {
  const shader = {
    uniforms: {},
    vertexShader: "#include <common>\n#include <begin_vertex>",
    fragmentShader: "#include <common>\n#include <roughnessmap_fragment>\n#include <map_fragment>",
  };
  material.onBeforeCompile(shader);
  return shader;
}

test("mapless tower retains direct matte response and borrowed atlas across film toggles", () => {
  const source = sourceAsset(false),
    originalUv = source.geometry.attributes.uv.array.slice(),
    tower = createCompleteTowerArchitecture({ asset: source }),
    mesh = tower.root.getObjectByName("complete-meshy-tower"),
    material = mesh.material,
    shader = materialShader(material);
  assert.notEqual(material, source.material);
  assert.equal(material.roughness, 0.9);
  assert.equal(material.map, source.material.map);
  assert.equal(material.normalMap, null);
  assert.equal(material.roughnessMap, null);
  assert.match(shader.fragmentShader, /#include <roughnessmap_fragment>/);
  assert.doesNotMatch(
    shader.fragmentShader,
    /roughnessFactor\s*=/,
    "no shader remap may lift a mapless scalar toward one",
  );
  for (const active of [true, false, true, false]) {
    tower.setFilmTreatment(active);
    assert.equal(material.roughness, 0.9);
    assert.equal(material.emissive.getHex(), 0);
    assert.equal(shader.uniforms.babelFilm.value, Number(active));
    assert.equal(mesh.material, material);
  }
  assert.equal(source.material.roughness, 0.85);
  assert.deepEqual(mesh.geometry.attributes.uv.array, originalUv);
  assert.deepEqual(source.geometry.attributes.uv.array, originalUv);
  assert.equal(tower.dispose(), true);
  assert.equal(tower.dispose(), false);
  assert.equal(source.disposals, 0);
  source.resources.forEach((resource) => resource.dispose());
});

test("tree preserves mapped roughness variation and texture ownership through quality and film changes", () => {
  const source = sourceAsset(true),
    tree = createTreeArchitecture({ asset: source, groundHeight: () => 0 }),
    material = tree.root.getObjectByName("meshy-tree").material,
    shader = materialShader(material);
  assert.equal(material.roughness, 1, "do not attenuate the source map before its bounded remap");
  assert.equal(material.roughnessMap, source.material.roughnessMap);
  assert.equal(material.normalMap, source.material.normalMap);
  assert.equal(material.map, source.material.map);
  assert.deepEqual(material.normalScale.toArray(), [0.46, 0.46]);
  const remap = shader.fragmentShader.match(
    /roughnessFactor = mix\(([\d.]+), ([\d.]+), roughnessFactor\);/,
  );
  assert.ok(remap, "the compiled material must bound the map's roughness");
  const floor = Number(remap[1]),
    ceiling = Number(remap[2]);
  assert.equal(floor, 0.84);
  assert.equal(ceiling, 0.97);
  assert.ok(Math.abs((floor + ceiling) / 2 - 0.905) < 1e-12);
  for (const tier of ["balanced", "low", "high"]) {
    tree.setFilmTreatment(true);
    tree.applyQuality({ tier });
    assert.equal(material.emissiveIntensity, 0.04, "no added tree glow");
    assert.equal(material.roughnessMap, source.material.roughnessMap);
    assert.equal(material.roughness, 1);
    tree.setFilmTreatment(false);
    assert.equal(material.emissiveIntensity, 0.22);
    assert.equal(shader.uniforms.babelFilm.value, 0);
  }
  assert.equal(source.material.roughness, 0.85);
  assert.equal(tree.dispose(), true);
  assert.equal(tree.dispose(), false);
  assert.equal(source.disposals, 0);
  source.resources.forEach((resource) => resource.dispose());
});

test("timber lookout reads its baked normal map at full strength with one uniform wood grade", () => {
  const scene = new Group(),
    geometry = new BoxGeometry(1, 2, 1),
    material = new MeshStandardMaterial({ roughness: 0.85 });
  // The delivered GLB stores the bake's tangents as normalized int8
  // (KHR_mesh_quantization). normalScale (1, 1) is only correct while they
  // survive preparation: without them three.js falls back to derivative
  // frames and the tree's inverted-green decode.
  geometry.computeTangents();
  const decoded = geometry.getAttribute("tangent"),
    packed = new Int8Array(decoded.count * 4);
  for (let i = 0; i < decoded.count; i++)
    for (const [k, value] of [
      decoded.getX(i),
      decoded.getY(i),
      decoded.getZ(i),
      decoded.getW(i),
    ].entries())
      packed[i * 4 + k] = Math.round(value * 127);
  geometry.setAttribute("tangent", new BufferAttribute(packed, 4, true));
  const source = geometry.getAttribute("tangent");
  material.map = new Texture();
  material.normalMap = new Texture();
  // GLTFLoader keeps normalScale (1, 1) for a mesh that stores its tangents.
  material.normalScale.set(1, 1);
  scene.add(new Mesh(geometry, material));
  const tower = createCompleteTowerArchitecture({ asset: { scene } }),
    mesh = tower.root.getObjectByName("complete-meshy-tower"),
    runtime = mesh.material,
    shader = materialShader(runtime),
    tangent = mesh.geometry.getAttribute("tangent");
  assert.ok(tangent, "the stored tangents must reach the runtime geometry");
  assert.equal(tangent.itemSize, 4);
  assert.equal(tangent.count, source.count);
  // Uniform scale and translation leave each tangent's direction and handedness.
  for (let i = 0; i < source.count; i++) {
    for (const axis of ["X", "Y", "Z"])
      assert.ok(
        Math.abs(tangent["get" + axis](i) - source["get" + axis](i)) < 0.02,
        `tangent ${i} ${axis}`,
      );
    assert.equal(tangent.getW(i), source.getW(i), `tangent ${i} handedness`);
  }
  assert.equal(tangent.getW(0), 1);
  assert.equal(runtime.normalMap, material.normalMap);
  assert.deepEqual(runtime.normalScale.toArray(), [1, 1]);
  assert.equal(runtime.roughness, 0.9);
  assert.doesNotMatch(
    shader.fragmentShader,
    /babelLocal\.y/,
    "no height band may single out part of the all-timber tower",
  );
  tower.dispose();
  for (const resource of [geometry, material, material.map, material.normalMap]) resource.dispose();
});

test("the bare tree takes no procedural film extras and the rocks darken above their sunk base", () => {
  const source = sourceAsset(true),
    tree = createTreeArchitecture({ asset: source, groundHeight: () => 0 }),
    treeShader = materialShader(tree.root.getObjectByName("meshy-tree").material);
  // The leafy asset's leaf lift tinted the bare tree's mossy upper trunk cyan;
  // its sub-pixel furrow only printed aliased lines.
  assert.doesNotMatch(treeShader.fragmentShader, /leafMask|furrow|fwidth/);
  tree.dispose();
  source.resources.forEach((resource) => resource.dispose());
  const stone = sourceAsset(false),
    rock = materialFor({ scene: stone.scene }, 1, "rock"),
    band = materialShader(rock).fragmentShader.match(
      /mix\(([\d.]+), 1\., smoothstep\(([\d.]+), ([\d.]+), babelLocal\.y\)\)/,
    );
  assert.ok(band, "the rock darkens toward its base in local height");
  // rock-build.js sinks each stone up to 0.35 of its height: the band must
  // still show above the slate.
  assert.ok(Number(band[3]) >= 0.35 + 0.1, `band ends at ${band[3]}`);
  assert.ok(Number(band[1]) >= 0.4 && Number(band[1]) < 1);
  rock.dispose();
  stone.resources.forEach((resource) => resource.dispose());
});
