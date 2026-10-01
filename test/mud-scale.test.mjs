import assert from "node:assert/strict";
import test from "node:test";
import { Box3, BoxGeometry, Group, Mesh, MeshStandardMaterial, Vector3, PointLight } from "three";
import { DOOR_HEIGHT as D } from "../src/scene/mud-ground.js";
import { createPropScale } from "../src/scene/prop-scale.js";
import { DIRECTED_SHOTS, measureShot, fitShot } from "../src/scene/directed-shots.js";
import { TERRAIN_HORIZON } from "../src/scene/hill-silhouette.js";
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
  near(expected.footing, -5);
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
  assert.deepEqual(tree.position, original.position);
  assert.deepEqual(tree.scale, original.scale);
  assert.deepEqual(tree.geometry.attributes.position.array, original.vertices);
  assert.deepEqual(tree.geometry.attributes.uv.array, original.uv);
  for (const mesh of [tree, decoration]) {
    mesh.geometry.dispose();
    mesh.material.dispose();
  }
});

const FILM_CHUNKS = [
  "#include <map_fragment>",
  "#include <roughnessmap_fragment>",
  "#include <normal_fragment_maps>",
  "#include <lights_fragment_end>",
  "#include <fog_fragment>",
].join("\n");

test("each ground shading has its own program cache key; the slate's shading needs film", async () => {
  const {
    configureGroundShading,
    createSlateContacts,
    SLATE_WET,
    SLATE_TILING,
    SLATE_PUDDLES,
    SLATE_CONTACTS,
  } = await import("../src/scene/mud-ground.js");
  const detail = { isTexture: true };
  const material = new MeshStandardMaterial();
  const compile = (...args) => {
    configureGroundShading(material, ...args);
    const shader = {
      uniforms: {},
      vertexShader: "#include <begin_vertex>",
      fragmentShader: FILM_CHUNKS,
    };
    material.onBeforeCompile(shader);
    return {
      key: material.customProgramCacheKey(),
      fragment: shader.fragmentShader,
      uniforms: shader.uniforms,
    };
  };
  for (const [args, key, slate, authored] of [
    [[false], "ground-baseline", false, false],
    [[false, { detail }], "ground-baseline", false, false],
    // The procedural surface while the maps load, or after a fallback.
    [[true], "moonlit-slate-v3-p", true, false],
    [[true, { detail }], "moonlit-slate-v3", true, true],
  ]) {
    const compiled = compile(...args);
    assert.equal(compiled.key, key, JSON.stringify(args));
    assert.equal(compiled.fragment.includes("slateWet"), slate, key);
    assert.equal(compiled.fragment.includes("slatePuddle"), slate, key);
    // Only the authored maps blend two tile lookups and add the detail map.
    assert.equal(compiled.fragment.includes("uniform sampler2D slateDetail;"), authored, key);
    assert.equal(compiled.fragment.includes("#include <map_fragment>"), !authored, key);
    // Film ground writes the ground depth layer for the tour's staggered dissolve.
    assert.equal(compiled.fragment.includes("gl_FragColor.a = 0.6667;"), Boolean(args[0]), key);
  }
  // Without film the ground keeps Three's own program.
  configureGroundShading(material, false);
  const baseline = {
    uniforms: {},
    vertexShader: "#include <begin_vertex>",
    fragmentShader: FILM_CHUNKS,
  };
  material.onBeforeCompile(baseline);
  assert.deepEqual(baseline, {
    uniforms: {},
    vertexShader: "#include <begin_vertex>",
    fragmentShader: FILM_CHUNKS,
  });
  const contacts = createSlateContacts();
  const { fragment, uniforms } = compile(true, { detail, contacts });
  const horizon = TERRAIN_HORIZON.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  assert.match(
    fragment,
    new RegExp(
      `gl_FragColor\\.rgb = mix\\(gl_FragColor\\.rgb, ${horizon}, earthHorizon\\);\\s*#endif\\s*gl_FragColor\\.a = 0\\.6667;`,
    ),
  );
  // Delay distance haze so the phone foreground retains texture; the outer
  // 190-unit square boundary still reaches the shared mountain-foot tone.
  assert.match(
    fragment,
    /float earthHorizon = max\([^;]*,\s*smoothstep\(230\.0, 330\.0, vFogDepth\)\);/,
  );
  // The film specular clamp stays; the wet term only relaxes it, within the
  // brief's 1 + 1.6 bound; puddles take the existing moon and lantern glints.
  assert.match(fragment, /reflectedLight\.directSpecular \*= mix\(\.12, \.22, damp\);/);
  assert.match(
    fragment,
    /reflectedLight\.directSpecular \*= \(1\.0 \+ 0\.8\*slateWet\)\*\(1\.0 \+ 4\.0\*slatePuddle - 3\.2\*slateLanternPuddle\);/,
  );
  assert.match(fragment, /roughnessFactor = mix\(roughnessFactor, 0\.2, slateLanternPuddle\);/);
  assert.match(
    fragment,
    /reflectedLight\.directSpecular \/= 1\.0 \+ 2\.5\*dot\(reflectedLight\.directSpecular,vec3\(\.2126,\.7152,\.0722\)\)\*slateLanternPuddle;/,
  );
  // The zone's explicit support prevents dark detail texels elsewhere from
  // receiving the lantern override; parentheses preserve the 1 - fade mask.
  assert.match(
    fragment,
    /float slateLanternPuddle = slatePuddle\*\(1\.-smoothstep\(\.5,1\.,length\([^;]*\)\/2\.8\)\);/,
  );
  assert.equal(SLATE_PUDDLES.lantern.specular, 0.8);
  assert.equal(SLATE_PUDDLES.lantern.roughness, 0.2);
  assert.ok(SLATE_WET.specular <= 1.6);
  assert.ok(
    SLATE_WET.fresnel <= 0.2,
    "the grazing sheen stays low behind the intro text and in the distance",
  );
  assert.ok(
    fragment.indexOf("slateWet = ") > fragment.indexOf("float worn ="),
    "wetness follows the worn mask",
  );
  // The footing and root plate stay dry; the path is dry except in the lantern clearing.
  assert.match(
    fragment,
    /float slateDry = max\(max\(footingDry, 1\.0-smoothstep\(3\.2,5\.7, slateTree\)\), approach\*smoothstep\(4\.0,7\.0, length\(vMudWorld\.xz-vec2\(50\.92,33\.36\)\)\)\);/,
  );
  assert.match(fragment, /float slateWet = clamp\([^;]*\)\*\(1\.0-slateDry\);/);
  // Puddles fill the detail map's low texels, glassy and darker, with a sky
  // reflection built from the fog and zenith colours (no environment map).
  assert.match(
    fragment,
    /float slatePuddle = smoothstep\(-\.04, \.04, [^;]*-slateH\)\*\(1\.0-slateDry\);/,
  );
  assert.match(
    fragment,
    new RegExp(
      `mix\\(fogColor, vec3\\(${SLATE_PUDDLES.zenith.join(",").replaceAll(".", "\\.")}\\)`,
    ),
  );
  assert.ok(SLATE_PUDDLES.roughness < 0.2 && SLATE_PUDDLES.darken <= 0.5);
  // Seamless tile: a second, larger lookup turned 126.87 degrees; contrast
  // restored about the tile's mean; detail and macro variation.
  assert.match(fragment, /slateUvB = slateTurnB\*vMapUv\*0\.866\+vec2\(0\.37,0\.61\)/);
  assert.match(fragment, /\/length\(vec2\(slateW,1\.-slateW\)\)/);
  const turn =
    (Math.atan2(SLATE_TILING.second.turn[1], SLATE_TILING.second.turn[0]) * 180) / Math.PI;
  assert.ok(Math.abs(turn - 126.87) < 0.01, `${turn}`);
  // Two normal fetches (both tile lookups) and three detail fetches.
  assert.equal((fragment.match(/texture2D\(normalMap/g) || []).length, 2);
  assert.equal((fragment.match(/texture2D\(slateDetail/g) || []).length, 3);
  // Contact darkening: the tree and lantern always, rocks behind a uniform gate.
  assert.match(fragment, new RegExp(`uniform vec4 slateContacts\\[${SLATE_CONTACTS}\\];`));
  assert.match(fragment, /\(i < 2 \? 1\.0 : slateRockContact\)/);
  assert.match(fragment, /diffuseColor\.rgb \*= 1\.0 - slateAo\*slateContactGain;/);
  // The shared uniform objects: rocks arriving or shadows switching change
  // values, never the program.
  for (const name of ["slateContacts", "slateRockContact", "slateContactGain", "slateDetail"])
    assert.equal(uniforms[name], contacts[name], name);
  assert.equal(contacts.slateDetail.value, detail);
  const key = material.customProgramCacheKey();
  contacts.slateContactGain.value = 0.6;
  contacts.slateRockContact.value = 1;
  assert.equal(material.customProgramCacheKey(), key);
  material.dispose();
});
test("the film ground material follows the film, so loading and fallback surfaces match", async () => {
  const { filmGroundSurface } = await import("../src/scene/mud-ground.js");
  globalThis.window ??= { BabelSite: {} };
  await import("../src/scene/palette.js");
  const surface = globalThis.window.BabelSite.scene.GROUND_SURFACE_MATERIAL;
  assert.equal(surface.filmColor, 0x5c5048);
  // The film slate, with its maps or with the procedural loading/fallback surface.
  assert.deepEqual(filmGroundSurface({ film: true, surface }), {
    color: surface.filmColor,
    roughness: 0.98,
    metalness: 0,
  });
  // Before the film activates.
  assert.deepEqual(filmGroundSurface({ film: false, surface }), {
    color: 0x5d6574,
    roughness: 0.98,
    metalness: 0.02,
  });
});

test("the ground shading call site takes its tint and shading from the film state", async () => {
  const { readFile } = await import("node:fs/promises");
  const index = flat(await readFile(new URL("../src/scene/index.js", import.meta.url), "utf8"));
  // onDetailChange: tint, roughness and metalness all come from the same surface.
  assert.match(
    index,
    /const surface = filmGroundSurface\(\{ film: filmActive, surface: GROUND_SURFACE_MATERIAL \}\);[^]*?configureGroundShading\(material, filmActive, \{ detail: detailMap, contacts: groundContacts \}\);[^]*?material\.roughness = surface\.roughness;\s*material\.metalness = surface\.metalness;\s*material\.color\.setHex\(surface\.color\);/,
  );
  assert.equal((index.match(/configureGroundShading\(/g) || []).length, 1);
});

test("the wet hollows restate the terrain dune field exactly", async () => {
  const { readFile } = await import("node:fs/promises");
  const vm = await import("node:vm");
  const { configureGroundShading, terrainDune, TERRAIN_DUNE_TERMS } =
    await import("../src/scene/mud-ground.js");
  const window = { BabelSite: {} };
  vm.runInNewContext(await readFile(new URL("../src/scene/helpers.js", import.meta.url), "utf8"), {
    window,
    Math,
  });
  const { groundHeight } = window.BabelSite.scene;
  let samples = 0;
  for (let x = -190; x <= 190; x += 7.3)
    for (let z = -190; z <= 190; z += 6.1) {
      // Outside the tower and tree terraces, the ground height is the dune field.
      if (Math.hypot(x, z) < 20 || Math.hypot(x - 55.1, z - 36.1) < 14) continue;
      assert.ok(Math.abs(groundHeight(x, z) - terrainDune(x, z)) < 1e-12, `${x},${z}`);
      samples++;
    }
  assert.ok(samples > 2500);
  // The shader carries the same terms, in world x/z.
  const material = new MeshStandardMaterial();
  configureGroundShading(material, true);
  const shader = {
    uniforms: {},
    vertexShader: "#include <begin_vertex>",
    fragmentShader: FILM_CHUNKS,
  };
  material.onBeforeCompile(shader);
  // Evaluated per vertex (the dune field spans 100+ units over 3-unit quads);
  // fragments read the interpolated height.
  const dune = shader.vertexShader.match(/vSlateDune = (.*);/)[1];
  assert.match(
    shader.fragmentShader,
    /varying float vSlateDune;[^]*float slateHollow = 1\.0 - smoothstep\(-3\.2, -1\.0, vSlateDune\);/,
  );
  assert.equal(dune.split(" + ").length, TERRAIN_DUNE_TERMS.length);
  const glsl = new Function(
    "x",
    "z",
    `const vMudWorld = { xz: [x, z] };
    const vec2 = (a, b) => [a, b];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
    const { sin, cos } = Math;
    return ${dune};`,
  );
  for (const [x, z] of [
    [-120, 40],
    [0, 0],
    [55.1, 36.1],
    [73, -91],
    [150, 150],
  ]) {
    assert.ok(Math.abs(glsl(x, z) - terrainDune(x, z)) < 1e-9, `${x},${z}`);
  }
  material.dispose();
});

// Formatting-neutral source: comment lines go, whitespace runs become one
// space with none just inside brackets, and trailing commas go, so a check
// reads the same before and after Prettier.
function flat(code) {
  return code
    .replace(/^[ \t]*\/\/.*$/gm, "")
    .replace(/\s+/g, " ")
    .replace(/,(\s*[)\]}])/g, "$1")
    .replace(/([([]) | ([)\]])/g, "$1$2");
}
