import assert from "node:assert/strict";
import test from "node:test";
import { glbAsset, modelBytes } from "./support/glb.mjs";
import {
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Texture,
  Vector3,
  Box3,
  PointLight,
  ShaderChunk,
  ShaderLib,
} from "three";
import {
  createTreeArchitecture,
  materialFor,
  applyFilmGrade,
  BARK_TEXT_GLINT,
  BARK_TEXT_LIGHTS,
  ENVIRONMENT_ROLES,
  ROCK_TEXT_LIGHTS,
  LANTERN_REACH,
  FILM_GRADES,
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
import { createPropScale } from "../src/scene/prop-scale.js";
import {
  FILM_LIGHT,
  GLINT,
  GLINT_MOOD,
  LANTERN_MOOD,
  STONE_MOOD,
  STONE_TEXT,
} from "../src/scene/film-light.js";

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
  assert.equal(tree.material.emissive.getHex(), 0);
  assert.equal(tree.material.emissiveIntensity, 0);
  assert.deepEqual(tree.material.normalScale.toArray(), [0.75, 0.75]);
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
  // The film lantern: a candle with a hot core at its foot, brighter than the
  // 4.0 practical.
  assert.equal(replacement.light.intensity, LANTERN_REACH.intensity);
  assert.ok(LANTERN_REACH.intensity > 4);
  assert.deepEqual(replacement.light.color.toArray(), [...FILM_LIGHT.candle]);
  // Its light falls off with the square of the distance (decay 2, patched into
  // r160's legacy lights), held within half its anchor, eased out at its reach.
  assert.equal(replacement.light.distance, LANTERN_REACH.distance);
  assert.equal(replacement.light.decay, 2);
  const a = LANTERN_REACH.anchor;
  assert.ok(
    ShaderChunk.lights_pars_begin.includes(
      `if ( decayExponent == 2.0 ) return ${(a * a).toFixed(2)} / max( lightDistance * lightDistance, ${(LANTERN_REACH.hold ** 2).toFixed(2)} ) * pow2( saturate( 1.0 - pow4( lightDistance / cutoffDistance ) ) );`,
    ),
  );
  const falloff = (d) =>
    ((a * a) / Math.max(d * d, LANTERN_REACH.hold ** 2)) *
    Math.max(0, 1 - (d / LANTERN_REACH.distance) ** 4) ** 2;
  assert.equal(falloff(a), (1 - (a / LANTERN_REACH.distance) ** 4) ** 2);
  assert.ok(Math.abs(falloff(6) / falloff(3) - 0.25) < 0.04, "inverse square in the pool");
  assert.equal(falloff(LANTERN_REACH.distance), 0);
  // In film the crown's fill goes: the moon, the sky and the lantern light the tree.
  assert.equal(replacement.fillLight.visible, false);
  assert.equal(tree.material.emissiveIntensity, 0);
  replacement.setFilmTreatment(false);
  assert.equal(replacement.light.distance, 39);
  assert.equal(replacement.light.color.getHex(), 0xffbe72);
  assert.equal(replacement.fillLight.visible, true);
  assert.equal(tree.material.emissiveIntensity, 0);
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

test("non-lantern subjects cannot inherit self-illumination from supplied materials", () => {
  for (const role of ["tree", "rock"]) {
    const source = sourceAsset(true),
      emission = new Texture();
    source.resources.push(emission);
    source.material.emissive.setRGB(0.7, 0.5, 0.2);
    source.material.emissiveIntensity = 3;
    source.material.emissiveMap = emission;
    const material = materialFor(source, 4, role);
    try {
      for (const film of [false, true, false]) {
        applyFilmGrade(material, film);
        assert.equal(
          material.emissive.getHex(),
          0,
          role + " reflects existing light rather than emitting it",
        );
        assert.equal(material.emissiveIntensity, 0);
        assert.equal(material.emissiveMap, null);
        assert.equal(material.map, source.material.map);
        assert.equal(material.normalMap, source.material.normalMap);
      }
      assert.deepEqual(source.material.emissive.toArray(), [0.7, 0.5, 0.2]);
      assert.equal(source.material.emissiveIntensity, 3);
      assert.equal(source.material.emissiveMap, emission);
    } finally {
      material.dispose();
      assert.equal(source.disposals, 0, "the derived material never frees borrowed textures");
      source.resources.forEach((resource) => resource.dispose());
    }
  }
});

test("bark albedo and physical shading take no painted pale or rim", () => {
  const source = sourceAsset(true),
    tree = createTreeArchitecture({ asset: source, groundHeight: () => 0 }),
    treeShader = materialShader(tree.root.getObjectByName("meshy-tree").material),
    rock = materialFor(boxAsset(), 1, "rock"),
    rockShader = materialShader(rock);
  for (const shader of [treeShader, rockShader]) {
    assert.doesNotMatch(shader.fragmentShader, /babelPale|babelRim/);
    assert.equal(shader.uniforms.babelPale, undefined);
    assert.equal(shader.uniforms.babelRimLight, undefined);
  }
  assert.equal(tree.root.getObjectByName("meshy-tree").material.map, source.material.map);
  assert.match(treeShader.fragmentShader, /#include <map_fragment>\s*float babelLuma/);
  tree.dispose();
  rock.dispose();
  source.resources.forEach((resource) => resource.dispose());
});

test("mapless rocks keep their scalar roughness and borrowed atlas across film toggles", () => {
  const source = sourceAsset(false),
    originalUv = source.geometry.attributes.uv.array.slice(),
    material = materialFor(source, 1, "rock"),
    shader = materialShader(material);
  assert.notEqual(material, source.material);
  assert.equal(material.roughness, 0.5);
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
    assert.equal(applyFilmGrade(material, active), true);
    assert.equal(material.roughness, 0.5);
    assert.equal(material.emissive.getHex(), 0);
    assert.equal(shader.uniforms.babelFilm.value, Number(active));
  }
  assert.equal(source.material.roughness, 0.85);
  assert.deepEqual(source.geometry.attributes.uv.array, originalUv);
  material.dispose();
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
  assert.deepEqual(material.normalScale.toArray(), [0.75, 0.75]);
  const remap = shader.fragmentShader.match(
    /roughnessFactor = mix\(([\d.]+), ([\d.]+), roughnessFactor\);/,
  );
  assert.ok(remap, "the compiled material must bound the map's roughness");
  const floor = Number(remap[1]),
    ceiling = Number(remap[2]);
  assert.equal(floor, 0.82);
  assert.equal(ceiling, 1);
  assert.ok(Math.abs((floor + ceiling) / 2 - 0.91) < 1e-12);
  assert.ok(
    ceiling - floor > 0.97 - 0.84,
    "retain more local map variation at the same matte mean",
  );
  for (const mapValue of [0, 0.1, 0.4, 0.7, 1]) {
    const response = floor + (ceiling - floor) * mapValue;
    assert.ok(response >= 0.8 && response <= 1, "dry bark stays matte across its map");
    if (mapValue > 0) assert.ok(response > floor, "the map is never flattened to one roughness");
  }
  for (const tier of ["balanced", "low", "high"]) {
    tree.setFilmTreatment(true);
    tree.applyQuality({ tier });
    assert.equal(material.emissiveIntensity, 0, "no added tree glow");
    assert.equal(material.roughnessMap, source.material.roughnessMap);
    assert.equal(material.roughness, 1);
    tree.setFilmTreatment(false);
    assert.equal(material.emissiveIntensity, 0);
    assert.equal(shader.uniforms.babelFilm.value, 0);
  }
  assert.equal(source.material.roughness, 0.85);
  assert.equal(tree.dispose(), true);
  assert.equal(tree.dispose(), false);
  assert.equal(source.disposals, 0);
  source.resources.forEach((resource) => resource.dispose());
});

test("the night environment lights and is mirrored at its own radiance", () => {
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
  // The sky lights and is mirrored at its own radiance (no gain); the flat
  // lights keep only what it leaves out.
  assert.deepEqual(Object.keys(ENVIRONMENT_ROLES), ["tree", "rock"]);
  for (const role of ["tree", "rock"]) {
    const [ambient, sky, reflection] = ENVIRONMENT_ROLES[role];
    assert.ok(ambient > 0 && ambient < 0.5, role);
    assert.equal(sky, 1, role);
    assert.equal(reflection, 1, role);
  }
  const rockSource = sourceAsset(false),
    rock = materialFor(rockSource, 1, "rock"),
    rockShader = materialShader(rock);
  for (const active of [true, false, true]) {
    applyFilmGrade(rock, active);
    assert.deepEqual(
      rockShader.uniforms.babelEnvironment.value.toArray(),
      active ? [...ENVIRONMENT_ROLES.rock] : [1, 0, 0],
    );
    assert.equal(rock.roughness, 0.5);
    assert.equal(rock.map, rockSource.material.map);
  }
  rock.dispose();
  assert.equal(rockSource.disposals, 0);
  rockSource.resources.forEach((resource) => resource.dispose());
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
  // below the band (its matte map remap stays above it), with a faint grazing
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
  // matte; the rocks take none.
  assert.ok(treeShader.fragmentShader.includes("float babelMoss = babelFilm*"));
  assert.ok(treeShader.fragmentShader.includes(")*(.65+.7*babelMossFine)"));
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

test("supplied tree and rocks switch between source and moonlight grades without rebuilding materials", () => {
  assert.deepEqual(Object.keys(FILM_GRADES), ["tree", "rock"]);
  const tree = createTreeArchitecture({ asset: boxAsset(), groundHeight: () => 0 });
  const material = tree.root.getObjectByName("meshy-tree").material;
  const u = material.userData.babelGrade.uniforms;
  assert.equal(material.userData.babelGrade.role, "tree");
  // The maps keep their colour in and out of film (the camera's balance and
  // night's colour are the tone curve's): no saturation grade.
  assert.equal(u.babelSaturation, undefined);
  closeTo(u.babelHighlights.value, 0.12);
  // In film only their baked highlights come down.
  tree.setFilmTreatment(true);
  closeTo(u.babelHighlights.value, FILM_GRADES.tree);
  assert.ok(FILM_GRADES.tree > 0 && FILM_GRADES.tree < 0.3);
  tree.setFilmTreatment(false);
  closeTo(u.babelHighlights.value, 0.12);
  assert.equal(material.userData.babelGrade.uniforms, u);
  assert.equal(applyFilmGrade(new MeshStandardMaterial(), true), false);
  const shader = {
    uniforms: {},
    vertexShader: "#include <common>\n#include <begin_vertex>",
    fragmentShader: "#include <common>\n#include <map_fragment>\n#include <roughnessmap_fragment>",
  };
  material.onBeforeCompile(shader);
  assert.equal(shader.uniforms.babelHighlights, u.babelHighlights);
  assert.doesNotMatch(shader.fragmentShader, /babelSaturation|babelTint|babelShadowTint|babelLift/);
  tree.dispose();
  tree.setFilmTreatment(true);
  closeTo(u.babelHighlights.value, 0.12);

  const rock = materialFor(boxAsset(), 1, "rock"),
    rockUniforms = rock.userData.babelGrade.uniforms;
  assert.equal(rock.userData.babelGrade.role, "rock");
  assert.equal(rockUniforms.babelSaturation, undefined);
  assert.equal(rockUniforms.babelHighlights.value, 0);
  assert.equal(applyFilmGrade(rock, true), true);
  closeTo(rockUniforms.babelHighlights.value, FILM_GRADES.rock);
  applyFilmGrade(rock, false);
  assert.equal(rockUniforms.babelHighlights.value, 0);
  assert.equal(rock.userData.babelGrade.uniforms, rockUniforms);
  rock.dispose();
});

test("beside Contact the bark's highlights from the lantern and the crown's fill pass the ground's knee", () => {
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
  // After all the lights, beside Contact only: the point lights' highlight
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
  // The knee's define, then Contact's test and the blended knee the bark calls.
  const guardAt = (text) => SLATE_TEXT_GUARD.indexOf(text);
  assert.ok(
    guardAt("#define SLATE_TEXT_KNEE ") >= 0 &&
      guardAt("#define SLATE_TEXT_KNEE ") < guardAt("vec3 slateTextKnee(vec3 c,float b){") &&
      guardAt("float slateBehindAbout(vec2 v){") >= 0,
  );
  assert.doesNotMatch(BARK_TEXT_LIGHTS, /\bslateText\b|directionalLights|spotLights/);
  // Actual physical lighting retains its text guards, without a painted diffuse rim.
  assert.equal(shader.uniforms.babelRimText, undefined);
  assert.doesNotMatch(shader.fragmentShader, /babelRim/);
  // Everything the specular guard reads is declared before main().
  const main = shader.fragmentShader.indexOf("void main");
  for (const declared of [
    "varying vec4 vSlateClip;",
    "uniform vec4 slateText, slateAbout;",
    "float slateBehind(vec4 r,vec2 v,float d)",
  ]) {
    const at = shader.fragmentShader.indexOf(declared);
    assert.ok(at >= 0 && at < main, declared);
  }
  // Without the ground's uniforms the bark is as it was, on its own program.
  const plain = createTreeArchitecture({ asset: boxAsset(), groundHeight: () => 0 }),
    plainMaterial = plain.root.getObjectByName("meshy-tree").material,
    unguarded = physical();
  plainMaterial.onBeforeCompile(unguarded);
  assert.doesNotMatch(unguarded.fragmentShader + unguarded.vertexShader, /slateBehind|vSlateClip/);
  assert.equal(unguarded.uniforms.slateText, undefined);
  assert.doesNotMatch(unguarded.fragmentShader, /babelRimText/);
  assert.doesNotMatch(unguarded.fragmentShader, /babelRim/);
  assert.notEqual(material.customProgramCacheKey(), plainMaterial.customProgramCacheKey());
  // The rocks never take it (their own guard is ROCK_TEXT_LIGHTS).
  const rock = materialFor(boxAsset(), 1, "rock", contacts),
    rockShader = physical();
  rock.onBeforeCompile(rockShader);
  assert.doesNotMatch(rockShader.fragmentShader, /babelBehind\b|slateBehindAbout\(vSlate|babelRim/);
  assert.ok(!rockShader.fragmentShader.includes(BARK_TEXT_LIGHTS));
  rock.dispose();
  tree.dispose();
  plain.dispose();
});

test("behind the name and intro the bark's glints pass the same knee, by the shot's share", () => {
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
  // The shot's share, a shared uniform: a cut recompiles nothing, and it is
  // off until a shot asks.
  assert.equal(shader.uniforms.babelGlint, GLINT_MOOD);
  assert.equal(GLINT_MOOD.value, 0);
  // After all the lights, so the moon's and the lantern's highlights are both
  // in it: the whole direct highlight through the ground's knee, behind the
  // name and intro's box, easing out over a fifth of the screen's smaller side.
  const glsl = shader.fragmentShader;
  assert.ok(glsl.includes(`#include <lights_fragment_end>\n${BARK_TEXT_GLINT}`));
  assert.equal(GLINT.reach, 0.2);
  assert.ok(Object.isFrozen(GLINT));
  assert.ok(
    BARK_TEXT_GLINT.startsWith(
      "float babelGlintBehind = babelGlint*slateBehind(slateText, vSlateClip.xy/vSlateClip.w*.5+.5, 0.20);\n",
    ),
  );
  assert.ok(
    BARK_TEXT_GLINT.includes(
      "if (babelGlintBehind > 0.0) reflectedLight.directSpecular = slateTextKnee(reflectedLight.directSpecular, babelGlintBehind);",
    ),
    "at 0, every other shot, nothing runs",
  );
  assert.doesNotMatch(BARK_TEXT_GLINT, /slateAbout|directDiffuse|indirect/);
  // Everything it reads is declared before main().
  const main = glsl.indexOf("void main()");
  for (const declared of [
    "uniform float babelGlint;",
    "varying vec4 vSlateClip;",
    "uniform vec4 slateText, slateAbout;",
    "float slateBehind(vec4 r,vec2 v,float d){",
    "vec3 slateTextKnee(vec3 c,float b){",
  ])
    assert.ok(glsl.indexOf(declared) >= 0 && glsl.indexOf(declared) < main, declared);
  assert.ok(glsl.indexOf(BARK_TEXT_GLINT) > main);
  // Without the ground's uniforms, and on the rocks, none.
  const plain = createTreeArchitecture({ asset: boxAsset(), groundHeight: () => 0 }),
    unguarded = physical();
  plain.root.getObjectByName("meshy-tree").material.onBeforeCompile(unguarded);
  assert.doesNotMatch(unguarded.fragmentShader, /babelGlint/);
  assert.equal(unguarded.uniforms.babelGlint, undefined);
  const rock = materialFor(boxAsset(), 1, "rock", contacts),
    rockShader = physical();
  rock.onBeforeCompile(rockShader);
  assert.doesNotMatch(rockShader.fragmentShader, /babelGlint/);
  rock.dispose();
  tree.dispose();
  plain.dispose();
});

test("behind the name and intro the stones' lamplight passes a knee, by the shot's share", () => {
  const contacts = createSlateContacts(),
    physical = () => ({
      uniforms: {},
      vertexShader: ShaderLib.physical.vertexShader,
      fragmentShader: ShaderLib.physical.fragmentShader,
    });
  const rock = materialFor(boxAsset(), 1, "rock", contacts),
    shader = physical();
  rock.onBeforeCompile(shader);
  // The ground's own boxes, and the shot's share as a shared uniform: a cut
  // recompiles nothing, and it is off until a shot asks.
  for (const name of ["slateText", "slateAbout", "slateAspect"])
    assert.equal(shader.uniforms[name], contacts[name], name);
  assert.equal(shader.uniforms.babelStone, STONE_MOOD);
  assert.equal(STONE_MOOD.value, 0);
  assert.match(shader.vertexShader, /#include <project_vertex>\nvSlateClip = gl_Position;/);
  // After all the lights: the point lights' direct diffuse and highlight,
  // taken again as RE_Direct_Physical takes them, keep 1/(1+L/knee) of
  // themselves behind the name and intro's box, easing out over a fifth of the
  // screen's smaller side.
  const glsl = shader.fragmentShader;
  assert.ok(glsl.includes(`#include <lights_fragment_end>\n${ROCK_TEXT_LIGHTS}`));
  assert.ok(Object.isFrozen(STONE_TEXT));
  assert.deepEqual(STONE_TEXT, { knee: 2, reach: 0.2 });
  assert.ok(
    ROCK_TEXT_LIGHTS.startsWith(
      "float babelStoneBehind = babelStone*slateBehind(slateText, vSlateClip.xy/vSlateClip.w*.5+.5, 0.20);\n#if NUM_POINT_LIGHTS > 0\nif (babelStoneBehind > 0.0) {",
    ),
    "at 0, every other shot, nothing runs",
  );
  const loop = ROCK_TEXT_LIGHTS.match(
    /#pragma unroll_loop_start\s+for \( int i = 0; i < NUM_POINT_LIGHTS; i \+\+ \) \{([^}]*)\}\s+#pragma unroll_loop_end/,
  );
  assert.ok(loop, "one unrolled loop over the point lights");
  assert.match(
    loop[1],
    /getPointLightInfo\(pointLights\[ i \], geometryPosition, babelLight\);\s+babelLampIrradiance = saturate\(dot\(geometryNormal, babelLight\.direction\)\)\*babelLight\.color;\s+babelLampDiffuse \+= babelLampIrradiance\*BRDF_Lambert\(material\.diffuseColor\);\s+babelLampSpecular \+= babelLampIrradiance\*BRDF_GGX\(babelLight\.direction, geometryViewDir, geometryNormal, material\);/,
  );
  // Unrolled, a declaration in the loop's body would be declared once per light.
  assert.doesNotMatch(loop[1], /\b(?:vec[234]|float|IncidentLight)\s+\w+/);
  assert.ok(
    ROCK_TEXT_LIGHTS.includes(
      "float babelLampOff = babelStoneBehind*(2.0-babelStoneBehind)*(1.0-1.0/(1.0+babelLampLuma/2.000));",
    ),
  );
  assert.ok(
    ROCK_TEXT_LIGHTS.includes("reflectedLight.directDiffuse -= babelLampDiffuse*babelLampOff;"),
  );
  assert.ok(
    ROCK_TEXT_LIGHTS.includes("reflectedLight.directSpecular -= babelLampSpecular*babelLampOff;"),
  );
  assert.doesNotMatch(ROCK_TEXT_LIGHTS, /slateAbout|indirect|directionalLights|spotLights/);
  // Everything it reads is declared before main().
  const main = glsl.indexOf("void main()");
  for (const declared of [
    "uniform float babelStone;",
    "varying vec4 vSlateClip;",
    "uniform vec4 slateText, slateAbout;",
    "float slateBehind(vec4 r,vec2 v,float d){",
  ])
    assert.ok(glsl.indexOf(declared) >= 0 && glsl.indexOf(declared) < main, declared);
  assert.ok(glsl.indexOf(ROCK_TEXT_LIGHTS) > main);
  // Without the ground's uniforms the stones are as they were, on their own program.
  const plain = materialFor(boxAsset(), 1, "rock"),
    unguarded = physical();
  plain.onBeforeCompile(unguarded);
  assert.doesNotMatch(unguarded.fragmentShader + unguarded.vertexShader, /babelStone|vSlateClip/);
  assert.equal(unguarded.uniforms.babelStone, undefined);
  assert.notEqual(rock.customProgramCacheKey(), plain.customProgramCacheKey());
  // The bark never takes it.
  const tree = createTreeArchitecture({
    asset: boxAsset(),
    groundHeight: () => 0,
    textGuard: contacts,
  });
  const bark = physical();
  tree.root.getObjectByName("meshy-tree").material.onBeforeCompile(bark);
  assert.doesNotMatch(bark.fragmentShader, /babelStone/);
  for (const material of [rock, plain]) material.dispose();
  tree.dispose();
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
    closeTo(tree.light.intensity, LANTERN_REACH.intensity * 1.1);
    LANTERN_MOOD.value = 1.4;
    tree.setLanternFlicker(0.9);
    closeTo(strength.value, FLAME_STREAK.strength * 0.9 * 1.4);
    closeTo(tree.light.intensity, LANTERN_REACH.intensity * 0.9 * 1.4);
    tree.setFilmTreatment(false);
    assert.equal(strength.value, 0);
    closeTo(tree.light.intensity, 4 * 0.9, 1e-9);
  } finally {
    LANTERN_MOOD.value = 1;
  }
  tree.dispose();
});
