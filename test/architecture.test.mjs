import assert from "node:assert/strict";
import test from "node:test";
import { glbAsset, modelBytes } from "./support/glb.mjs";
import {
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  BufferAttribute,
  Texture,
  Vector3,
  Box3,
  PointLight,
  ShaderLib,
} from "three";
import {
  createTreeArchitecture,
  createCompleteTowerArchitecture,
  materialFor,
  applyFilmGrade,
  BARK_TEXT_LIGHTS,
  BARK_RIM_TEXT,
  ENVIRONMENT_ROLES,
  LANTERN_REACH,
  LANTERN_FILM_INTENSITY,
  FLAME_STREAK,
  WET_BARK,
  ROOT_MOSS,
} from "../src/scene/architecture.js";
import { ESTATE } from "../src/scene/estate-layout.js";
import { smoothTreeNormals } from "../src/scene/tree-normals.js";
import { DIRECTED_SHOTS, measureShot, fitShot } from "../src/scene/directed-shots.js";
import {
  DOOR_HEIGHT as D,
  SLATE_TEXT_GUARD,
  createSlateContacts,
} from "../src/scene/mud-ground.js";
import { goboHook } from "../src/scene/light-shafts.js";
import { createPropScale } from "../src/scene/prop-scale.js";
import { LANTERN_MOOD, PALE, PALE_MOOD, RIM, RIM_UNIFORMS } from "../src/scene/film-light.js";

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
  // The film lantern: a hot core at its foot, brighter than the 4.0 practical.
  assert.equal(replacement.light.intensity, LANTERN_FILM_INTENSITY);
  assert.ok(LANTERN_FILM_INTENSITY > 4 && LANTERN_FILM_INTENSITY <= 10);
  // A candle's warm pool on the wet soil out to about six units (LANTERN_REACH):
  // a short reach with a fast falloff, so the pool stays at the lantern's foot.
  assert.equal(replacement.light.distance, LANTERN_REACH.distance);
  assert.equal(replacement.light.decay, LANTERN_REACH.decay);
  assert.ok(LANTERN_REACH.distance >= 8 && LANTERN_REACH.distance <= 12);
  assert.ok(LANTERN_REACH.decay >= 1.5 && LANTERN_REACH.decay <= 2);
  // At six units the pool keeps under a tenth of its one-unit strength.
  const falloff = (d) =>
    Math.pow(Math.max(0, 1 - Math.pow(d / LANTERN_REACH.distance, 4)), 2) /
    Math.pow(d, LANTERN_REACH.decay);
  assert.ok(falloff(6) / falloff(1) < 0.1);
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

test("only the tree's pale wood turns moonlit grey, and only under a shot's pale", () => {
  const source = sourceAsset(true),
    tree = createTreeArchitecture({ asset: source, groundHeight: () => 0 }),
    treeShader = materialShader(tree.root.getObjectByName("meshy-tree").material),
    tower = createCompleteTowerArchitecture({ asset: boxAsset(), groundY: 0 }),
    towerShader = materialShader(tower.root.getObjectByName("complete-meshy-tower").material);
  // One mood for the tree's every material, off until a shot asks for it.
  assert.equal(treeShader.uniforms.babelPale, PALE_MOOD);
  assert.equal(PALE_MOOD.value, 0);
  assert.equal("babelPale" in towerShader.uniforms, false);
  assert.doesNotMatch(towerShader.fragmentShader, /babelPale/);
  // First on the map's own colour, before the role's grade: the pale share
  // eases to a cool grey; at 0 the mix leaves the colour exactly as it was.
  const pale = `#include <map_fragment>
          float babelPaleLuma = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(babelPaleLuma)*vec3(${PALE.tint.map((v) => v.toFixed(3)).join(", ")}), babelPale*smoothstep(${PALE.luma.map((v) => v.toFixed(3)).join(", ")}, babelPaleLuma));`;
  assert.ok(treeShader.fragmentShader.includes(pale));
  assert.ok(
    treeShader.fragmentShader.indexOf(pale) < treeShader.fragmentShader.indexOf("float babelLuma"),
  );
  assert.ok(PALE.tint[2] > 1 && PALE.tint[0] < 1, "cool");
  assert.ok(PALE.luma[0] < PALE.luma[1] && PALE.luma[1] < 0.5, "the pale wood, not the dark bark");
  tree.dispose();
  source.resources.forEach((resource) => resource.dispose());
});

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

test("the film's night sky lights the bark and the rocks from above and leaves the tower as it was", () => {
  const source = sourceAsset(true),
    tree = createTreeArchitecture({ asset: source, groundHeight: () => 0 }),
    material = tree.root.getObjectByName("meshy-tree").material;
  const shader = {
    uniforms: {},
    vertexShader: "#include <common>\n#include <begin_vertex>",
    fragmentShader: "#include <common>\n#include <lights_fragment_maps>",
  };
  material.onBeforeCompile(shader);
  // The light maps' own sums, reweighted by role right after Three makes them,
  // only with an environment: without one (a failed capture) the ambient stays whole.
  assert.match(
    shader.fragmentShader,
    /#include <lights_fragment_maps>\s*#ifdef USE_ENVMAP\s*irradiance \*= babelEnvironment\.x;\s*iblIrradiance \*= babelEnvironment\.y;\s*radiance \*= babelEnvironment\.z;\s*#endif/,
  );
  const environment = shader.uniforms.babelEnvironment.value;
  assert.deepEqual(environment.toArray(), [1, 0, 0], "outside the film nothing changes");
  tree.setFilmTreatment(true);
  assert.deepEqual(environment.toArray(), [...ENVIRONMENT_ROLES.tree]);
  tree.setFilmTreatment(false);
  assert.deepEqual(environment.toArray(), [1, 0, 0]);
  // The tower keeps its look: all of its ambient, none of the sky.
  assert.deepEqual([...ENVIRONMENT_ROLES.tower], [1, 0, 0]);
  for (const role of ["tree", "rock"]) {
    const [ambient, sky, reflection] = ENVIRONMENT_ROLES[role];
    assert.ok(ambient > 0.5 && ambient < 1, role);
    assert.ok(sky > 1 && sky <= 2.5, role);
    assert.ok(reflection >= 1 && reflection <= 2, role);
  }
  tree.dispose();
  source.resources.forEach((resource) => resource.dispose());
});

test("the bare tree takes no procedural film extras and the rocks darken above their sunk base", () => {
  const source = sourceAsset(true),
    tree = createTreeArchitecture({ asset: source, groundHeight: () => 0 }),
    treeShader = materialShader(tree.root.getObjectByName("meshy-tree").material);
  // The leafy asset's leaf lift tinted the bare tree's mossy upper trunk cyan;
  // its sub-pixel furrow only printed aliased lines.
  assert.doesNotMatch(treeShader.fragmentShader, /leafMask|furrow|fwidth/);
  // After the rain the bark is wet at its base, under film only: smoother
  // below the band (its 0.84-0.97 remap stays above it), with a faint grazing
  // sheen where the lights end.
  const [low, high] = WET_BARK.band.map((v) => v.toFixed(2));
  assert.ok(
    treeShader.fragmentShader.includes(
      `float babelWet = babelFilm*(1.0-smoothstep(${low}, ${high}, babelLocal.y));\nroughnessFactor = mix(roughnessFactor, ${WET_BARK.roughness.toFixed(2)}, babelWet);`,
    ),
  );
  assert.ok(WET_BARK.roughness >= 0.5 && WET_BARK.roughness < 0.84 && WET_BARK.sheen <= 0.15);
  const lit = {
    uniforms: {},
    vertexShader: "#include <common>\n#include <begin_vertex>",
    fragmentShader:
      "#include <common>\n#include <roughnessmap_fragment>\n#include <map_fragment>\n#include <lights_fragment_end>",
  };
  tree.root.getObjectByName("meshy-tree").material.onBeforeCompile(lit);
  assert.match(lit.fragmentShader, /reflectedLight\.indirectSpecular \+= fogColor\*\(babelWet\*/);
  // With the film's night sky as the environment, the wet bark mirrors it
  // instead of the fog-colour stand-in.
  assert.match(
    lit.fragmentShader,
    /#if defined\( USE_FOG \) && !defined\( USE_ENVMAP \)\s*reflectedLight\.indirectSpecular \+= fogColor/,
  );
  // Where the roots and the trunk enter the soil the bark is muddy: darker and
  // wetter, in film only, below the wet band.
  const [mudLow, mudHigh] = WET_BARK.mud.map((v) => v.toFixed(2));
  assert.ok(
    treeShader.fragmentShader.includes(
      `float babelMud = babelFilm*(1.0-smoothstep(${mudLow}, ${mudHigh}, babelLocal.y));\nroughnessFactor = mix(roughnessFactor, ${WET_BARK.mudRoughness.toFixed(2)}, babelMud);`,
    ),
  );
  assert.ok(
    treeShader.fragmentShader.includes(
      `diffuseColor.rgb *= mix(vec3(1.0), vec3(${WET_BARK.mudTone.map((v) => v.toFixed(2)).join(", ")}), babelFilm*(1.0-smoothstep(${mudLow}, ${mudHigh}, babelLocal.y)));`,
    ),
  );
  assert.ok(WET_BARK.mud[1] < WET_BARK.band[0], "the mud stays below the wet band's edge");
  assert.ok(WET_BARK.mudTone.every((v) => v >= 0.5 && v < 1));
  assert.ok(WET_BARK.mudRoughness < WET_BARK.roughness);
  // Damp moss on the roots' sky-facing tops above the mud, in film only,
  // under the role's tint, matte; the rocks and the tower take none.
  assert.ok(treeShader.fragmentShader.includes("float babelMoss = babelFilm*"));
  assert.ok(treeShader.fragmentShader.includes(")*babelTint*(.65+.7*babelMossFine)"));
  assert.ok(
    treeShader.fragmentShader.includes(
      `roughnessFactor = mix(roughnessFactor, ${ROOT_MOSS.roughness.toFixed(2)}, babelMoss);`,
    ),
  );
  assert.ok(treeShader.vertexShader.includes("babelLocalN = objectNormal;"));
  assert.ok(ROOT_MOSS.band[0] >= WET_BARK.mud[0] && ROOT_MOSS.band[3] > ROOT_MOSS.band[2]);
  const [r, g, b] = ROOT_MOSS.tone;
  assert.ok(g > r && g > b && (g - Math.min(r, b)) / g < 0.5, "a dull grey-green");
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
  // Wet from the rain: pale enough to read on the slate, smooth enough to glint.
  assert.equal(rock.roughness, 0.5);
  assert.ok(rock.color.getHex() === 0xc8c4bc);
  rock.dispose();
  stone.resources.forEach((resource) => resource.dispose());
});

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

const closeTo = (a, b, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

const boxAsset = () => {
  const scene = new Group();
  scene.add(new Mesh(new BoxGeometry(1, 2, 1), new MeshStandardMaterial()));
  return { scene };
};

test("supplied tower and tree switch between source and moonlight grades without rebuilding materials", () => {
  const tower = createCompleteTowerArchitecture({ asset: boxAsset(), groundY: 0 });
  const material = tower.root.getObjectByName("complete-meshy-tower").material;
  const u = material.userData.babelGrade.uniforms;
  assert.equal(material.userData.babelGrade.role, "tower");
  closeTo(u.babelSaturation.value, 0.94);
  assert.equal(u.babelLift.value, 0);
  tower.setFilmTreatment(true);
  closeTo(u.babelSaturation.value, 0.75);
  closeTo(u.babelHighlights.value, 0.3);
  closeTo(u.babelTint.value.r, 0.93);
  closeTo(u.babelShadowTint.value.b, 0.2);
  closeTo(u.babelLift.value, 0.14);
  tower.setFilmTreatment(false);
  closeTo(u.babelSaturation.value, 0.94);
  assert.equal(u.babelTint.value.r, 1);
  closeTo(u.babelShadowTint.value.r, 0.19);
  assert.equal(u.babelLift.value, 0);
  assert.equal(applyFilmGrade(new MeshStandardMaterial(), true), false);
  const shader = {
    uniforms: {},
    vertexShader: "#include <common>\n#include <begin_vertex>",
    fragmentShader: "#include <common>\n#include <map_fragment>\n#include <roughnessmap_fragment>",
  };
  material.onBeforeCompile(shader);
  assert.equal(shader.uniforms.babelTint, u.babelTint);
  assert.equal(shader.uniforms.babelShadowTint, u.babelShadowTint);
  assert.match(shader.fragmentShader, /babelLift/);
  tower.dispose();
  tower.setFilmTreatment(true);
  assert.equal(u.babelLift.value, 0);

  const tree = createTreeArchitecture({ asset: boxAsset(), groundHeight: () => 0 });
  const treeUniforms =
    tree.root.getObjectByName("meshy-tree").material.userData.babelGrade.uniforms;
  tree.setFilmTreatment(true);
  closeTo(treeUniforms.babelSaturation.value, 0.8);
  tree.setFilmTreatment(false);
  assert.equal(treeUniforms.babelSaturation.value, 1);
  tree.dispose();
});

test("beside About the bark's highlights from the lantern and the crown's fill pass the ground's knee", () => {
  const contacts = createSlateContacts(),
    physical = () => ({
      uniforms: {},
      vertexShader: ShaderLib.physical.vertexShader,
      fragmentShader: ShaderLib.physical.fragmentShader,
    });
  const tree = createTreeArchitecture({
    asset: boxAsset(),
    groundHeight: () => 0,
    textGuard: contacts,
  });
  const material = tree.root.getObjectByName("meshy-tree").material,
    shader = physical();
  material.onBeforeCompile(shader);
  // The ground's own uniform objects, so the boxes index.js measures reach the bark.
  for (const name of ["slateText", "slateAbout", "slateAspect"])
    assert.equal(shader.uniforms[name], contacts[name], name);
  assert.ok(shader.fragmentShader.includes(SLATE_TEXT_GUARD));
  assert.match(SLATE_TEXT_GUARD, /#define SLATE_TEXT_KNEE /);
  assert.match(shader.vertexShader, /#include <project_vertex>\nvSlateClip = gl_Position;/);
  assert.match(shader.fragmentShader, /varying vec4 vSlateClip;/);
  // After all the lights, beside About only: the point lights' highlight
  // taken again as RE_Direct_Physical takes it, and only the knee's cut removed.
  assert.ok(
    shader.fragmentShader.includes(`#include <lights_fragment_begin>\n${BARK_TEXT_LIGHTS}`),
  );
  assert.match(
    BARK_TEXT_LIGHTS,
    /^float babelBehind = slateBehindAbout\(vSlateClip\.xy\/vSlateClip\.w\*\.5\+\.5\);\nif \(babelBehind > 0\.0\) \{/,
  );
  assert.match(
    BARK_TEXT_LIGHTS,
    /#pragma unroll_loop_start\s+for \( int i = 0; i < NUM_POINT_LIGHTS; i \+\+ \) \{\s+getPointLightInfo\(pointLights\[ i \], geometryPosition, babelLight\);\s+babelPoint \+= saturate\(dot\(geometryNormal, babelLight\.direction\)\)\*babelLight\.color\*BRDF_GGX\(babelLight\.direction, geometryViewDir, geometryNormal, material\);\s+\}\s+#pragma unroll_loop_end/,
  );
  assert.ok(
    BARK_TEXT_LIGHTS.includes(
      "reflectedLight.directSpecular -= babelPoint-slateTextKnee(babelPoint, babelBehind);",
    ),
  );
  // The knee's define, then About's test and the blended knee the bark calls.
  const guardAt = (text) => SLATE_TEXT_GUARD.indexOf(text);
  assert.ok(
    guardAt("#define SLATE_TEXT_KNEE ") >= 0 &&
      guardAt("#define SLATE_TEXT_KNEE ") < guardAt("vec3 slateTextKnee(vec3 c,float b){") &&
      guardAt("float slateBehindAbout(vec2 v){") >= 0,
  );
  assert.doesNotMatch(BARK_TEXT_LIGHTS, /\bslateText\b|directionalLights|spotLights/);
  // The moon rim comes off behind the name, the intro and About by the shot's
  // share (Close-up's), easing out over RIM.textReach; at 0 the factor is 1.
  assert.equal(shader.uniforms.babelRimText, RIM_UNIFORMS.babelRimText);
  assert.match(shader.fragmentShader, /uniform float babelRimText;/);
  assert.ok(
    shader.fragmentShader.includes(
      `reflectedLight.directDiffuse += babelRimLight.rgb*babelFilm*babelRim${BARK_RIM_TEXT}*mix(babelRimLight.w, 1.0,`,
    ),
  );
  const reach = RIM.textReach.toFixed(2);
  assert.equal(
    BARK_RIM_TEXT,
    `*(1.0-babelRimText*max(slateBehind(slateText, vSlateClip.xy/vSlateClip.w*.5+.5, ${reach}), slateBehind(slateAbout, vSlateClip.xy/vSlateClip.w*.5+.5, ${reach})))`,
  );
  // The light shafts' gobo still lands after the light chunk, on its own hook.
  const gobo = goboHook(material, {}, 0),
    composed = physical();
  gobo.install();
  material.onBeforeCompile(composed);
  assert.ok(composed.fragmentShader.includes("if(shaftGoboGain>0.){"));
  assert.ok(composed.fragmentShader.includes(BARK_TEXT_LIGHTS));
  assert.ok(composed.fragmentShader.includes(BARK_RIM_TEXT));
  // Everything the rim's factor reads is declared before main().
  const main = composed.fragmentShader.indexOf("void main");
  for (const declared of [
    "uniform float babelRimText;",
    "varying vec4 vSlateClip;",
    "uniform vec4 slateText, slateAbout;",
    "float slateBehind(vec4 r,vec2 v,float d)",
  ]) {
    const at = composed.fragmentShader.indexOf(declared);
    assert.ok(at >= 0 && at < main, declared);
  }
  gobo.restore();
  // Without the ground's uniforms the bark is as it was, on its own program.
  const plain = createTreeArchitecture({ asset: boxAsset(), groundHeight: () => 0 }),
    plainMaterial = plain.root.getObjectByName("meshy-tree").material,
    unguarded = physical();
  plainMaterial.onBeforeCompile(unguarded);
  assert.doesNotMatch(unguarded.fragmentShader + unguarded.vertexShader, /slateBehind|vSlateClip/);
  assert.equal(unguarded.uniforms.slateText, undefined);
  assert.doesNotMatch(unguarded.fragmentShader, /babelRimText/);
  assert.match(unguarded.fragmentShader, /babelRimLight\.rgb\*babelFilm\*babelRim\*mix\(/);
  assert.notEqual(material.customProgramCacheKey(), plainMaterial.customProgramCacheKey());
  // The tower and the rocks never take it.
  const rock = materialFor(boxAsset(), 1, "rock", contacts),
    rockShader = physical();
  rock.onBeforeCompile(rockShader);
  assert.doesNotMatch(rockShader.fragmentShader, /slateBehind/);
  rock.dispose();
  // The lookout's rim stays whole.
  const tower = materialFor(boxAsset(), 1, "tower", contacts),
    towerShader = physical();
  tower.onBeforeCompile(towerShader);
  assert.match(towerShader.fragmentShader, /babelRimLight\.rgb\*babelFilm\*babelRim\*mix\(/);
  assert.doesNotMatch(towerShader.fragmentShader, /babelRimText|slateBehind/);
  tower.dispose();
  tree.dispose();
  plain.dispose();
});

test("the lantern is an iron post lantern with glass, candle and flame, authored 2.48 units tall and fully owned", () => {
  const tree = createTreeArchitecture({ asset: boxAsset(), groundHeight: () => 0 });
  const lantern = tree.root.getObjectByName("tree-lantern");
  const names = lantern.children
    .filter((o) => o.isMesh)
    .map((o) => o.name)
    .sort();
  assert.deepEqual(names, [
    "lantern-candle",
    "lantern-flame",
    "lantern-frame",
    "lantern-glass",
    "lantern-glass",
    "lantern-glass",
    "lantern-glass",
  ]);
  lantern.updateWorldMatrix(true, true);
  const size = new Box3().setFromObject(lantern).getSize(new Vector3());
  closeTo(size.y, 2.48, 0.05);
  assert.ok(size.x < 1.05 && size.z < 1.05);
  const glass = lantern.getObjectByName("lantern-glass").material;
  assert.equal(glass.transparent, true);
  assert.equal(glass.depthWrite, false);
  const flame = lantern.getObjectByName("lantern-flame");
  closeTo(tree.light.position.y, flame.position.y);
  tree.setFilmTreatment(true);
  closeTo(glass.emissiveIntensity, 0.018);
  closeTo(flame.material.emissiveIntensity, 1.35);
  const geometries = new Set(),
    materials = new Set();
  lantern.traverse((o) => {
    if (o.isMesh) {
      geometries.add(o.geometry);
      materials.add(o.material);
    }
  });
  let disposed = 0;
  for (const resource of [...geometries, ...materials])
    resource.addEventListener("dispose", () => disposed++);
  // The film's anamorphic flame streak rides on the practical inside the
  // lantern, so the tree owns its geometry and material too.
  const streak = lantern.getObjectByName("lantern-streak");
  assert.ok(streak?.isMesh, "the flame streak hangs from the lantern's practical");
  assert.equal(streak.parent, tree.light);
  assert.ok(geometries.has(streak.geometry) && materials.has(streak.material));
  assert.equal(tree.dispose(), true);
  assert.equal(
    disposed,
    geometries.size + materials.size,
    "every lantern resource, the flame streak included, is disposed",
  );
});

const size = (o) => new Box3().setFromObject(o).getSize(new Vector3());

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-5, `${a} != ${b}`);

function fixture() {
  const root = new Group();
  root.position.y = -7;
  const make = (w, h, d, x) => {
    const m = new Mesh(new BoxGeometry(w, h, d), new MeshStandardMaterial());
    m.position.set(x, 4, 0);
    root.add(m);
    return m;
  };
  return { root, make };
}

test("independently loaded tree and lantern resize and restore without changing borrowed geometry", () => {
  const { root, make } = fixture();
  const treeRoot = new Group();
  root.add(treeRoot);
  const tree = make(8, 22, 8, 0);
  tree.name = "meshy-tree";
  treeRoot.add(tree);
  const lantern = new Group();
  lantern.name = "tree-lantern";
  treeRoot.add(lantern);
  const housing = make(0.86, 2.48, 0.86, 0);
  housing.position.set(0, 1.24, 0);
  lantern.add(housing);
  const light = new PointLight(0xffffff, 4, 23);
  lantern.add(light);
  const fillLight = new PointLight(0xffffff, 2, 30);
  treeRoot.add(fillLight);
  const c = createPropScale({ groundRoot: root, groundHeight: () => 0 });
  c.setActive(true);
  c.setTree({ root: treeRoot, light, fillLight });
  near(size(tree).y, 4.2 * D);
  near(size(lantern).y, 0.3 * D);
  // The lantern stands on the ground; the tree ESTATE.tree.sink into it, so
  // its resting roots enter the soil (the ground root sits at -7).
  near(new Box3().setFromObject(lantern).min.y, -7);
  near(new Box3().setFromObject(tree).min.y, -7 - ESTATE.tree.sink);
  c.setTree(null);
  near(size(tree).y, 22);
  near(light.distance, 23);
  c.dispose();
});

test("decorative canopy bounds cannot change authored tree scale, footing or fitted camera", () => {
  const { root, make } = fixture(),
    treeRoot = new Group(),
    tree = make(8, 22, 8, 0);
  root.add(treeRoot);
  treeRoot.add(tree);
  tree.name = "meshy-tree";
  const original = {
    position: tree.position.clone(),
    scale: tree.scale.clone(),
    vertices: tree.geometry.attributes.position.array.slice(),
    uv: tree.geometry.attributes.uv.array.slice(),
  };
  const controller = createPropScale({ groundRoot: root, groundHeight: () => 2 });
  controller.setActive(true);
  controller.setTree({ root: treeRoot });
  const expectedScale = tree.scale.clone(),
    expectedPosition = tree.position.clone(),
    shot = DIRECTED_SHOTS.tree[0],
    expected = measureShot(treeRoot, shot),
    area = { left: 576, top: 80, width: 806, height: 820 },
    expectedFit = fitShot(expected, shot, area, 1440, 1000);
  near(expected.height, 4.2 * D);
  // The tree stands ESTATE.tree.sink into the soil below its lowest vertex;
  // its shots are framed from the soil line all the same.
  near(expected.footing, -5);
  assert.equal(tree.userData.sunk, ESTATE.tree.sink);
  assert.ok(expectedFit.distance > 0 && expectedFit.distance < 200);
  const decoration = new Mesh(new BoxGeometry(100, 100, 100), new MeshStandardMaterial());
  decoration.userData.excludeFromShot = true;
  tree.add(decoration);
  for (const [visible, y] of [
    [false, 80],
    [true, 80],
    [true, -80],
  ]) {
    decoration.visible = visible;
    decoration.position.y = y;
    controller.setTree({ root: treeRoot });
    const measured = measureShot(treeRoot, shot);
    assert.deepEqual(tree.scale, expectedScale);
    assert.deepEqual(tree.position, expectedPosition);
    assert.deepEqual(measured.points, expected.points);
    assert.deepEqual(measured.target, expected.target);
    near(measured.height, expected.height);
    near(measured.footing, expected.footing);
    assert.deepEqual(fitShot(measured, shot, area, 1440, 1000), expectedFit);
  }
  controller.dispose();
  assert.equal(tree.userData.sunk, undefined, "restored with the tree");
  assert.deepEqual(tree.position, original.position);
  assert.deepEqual(tree.scale, original.scale);
  assert.deepEqual(tree.geometry.attributes.position.array, original.vertices);
  assert.deepEqual(tree.geometry.attributes.uv.array, original.uv);
  for (const mesh of [tree, decoration]) {
    mesh.geometry.dispose();
    mesh.material.dispose();
  }
});

test("the flame streak shows in film only and follows the flicker and the shot's lantern mood", () => {
  const tree = createTreeArchitecture({ asset: boxAsset(), groundHeight: () => 0 });
  const streak = tree.root.getObjectByName("lantern-streak"),
    strength = streak.material.uniforms.uStrength;
  assert.equal(streak.userData.excludeFromShot, true, "the streak never enters a fit");
  assert.equal(streak.material.depthWrite, false);
  assert.equal(strength.value, 0, "outside film there is no streak");
  tree.setLanternFlicker(1.1);
  assert.equal(strength.value, 0);
  try {
    tree.setFilmTreatment(true);
    closeTo(strength.value, FLAME_STREAK.strength * 1.1);
    closeTo(tree.light.intensity, LANTERN_FILM_INTENSITY * 1.1);
    LANTERN_MOOD.value = 1.4;
    tree.setLanternFlicker(0.9);
    closeTo(strength.value, FLAME_STREAK.strength * 0.9 * 1.4);
    closeTo(tree.light.intensity, LANTERN_FILM_INTENSITY * 0.9 * 1.4);
    tree.setFilmTreatment(false);
    assert.equal(strength.value, 0);
    closeTo(tree.light.intensity, 4 * 0.9, 1e-9);
  } finally {
    LANTERN_MOOD.value = 1;
  }
  tree.dispose();
});
