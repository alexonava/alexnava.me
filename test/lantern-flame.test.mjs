import assert from "node:assert/strict";
import test from "node:test";
import { glbAsset, modelBytes } from "./support/glb.mjs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PointLight,
  Texture,
  Vector3,
} from "three";
import { compactShaderSource } from "../tools/shader-compact.mjs";
import { createLanternFlame, FLAME, lanternDraught } from "../src/scene/lantern-flame.js";
import { createTreeArchitecture } from "../src/scene/architecture.js";
import { createLanternArchitecture, createLanternMount } from "../src/scene/lantern.js";

const near = (actual, expected, tolerance = 1e-6) =>
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
function fixture(geometry = new BoxGeometry()) {
  const root = new Group(),
    material = new MeshStandardMaterial({ emissiveMap: new Texture(), emissive: 0xffa040 });
  material.map = new Texture();
  const mesh = new Mesh(geometry, material);
  root.add(mesh);
  const camera = new PerspectiveCamera();
  camera.position.set(4, 2, 5);
  return { root, mesh, material, camera };
}
// Two triangles on the globe shell (y .6, r ~.28) and one on the burner (y .3).
function globeGeometry() {
  const g = new BufferGeometry();
  g.setAttribute(
    "position",
    new BufferAttribute(
      new Float32Array([
        0.28, 0.6, 0, 0, 0.6, 0.27, -0.28, 0.6, 0, 0, 0.9, -0.1, 0.2, 0.3, 0, 0, 0.3, 0.2,
      ]),
      3,
    ),
  );
  g.setAttribute("uv", new BufferAttribute(new Float32Array(12), 2));
  g.setIndex([4, 5, 0, 0, 1, 3, 1, 2, 3]);
  return g;
}
// The stand-in for Three's program assembly: the anchors the hooks extend.
function compile(material, renderer = {}) {
  const shader = {
    uniforms: {},
    vertexShader: "#include <common>\n#include <begin_vertex>",
    fragmentShader:
      "#include <common>\n#include <emissivemap_fragment>\n#include <lights_fragment_end>",
  };
  material.onBeforeCompile(shader, renderer);
  return shader;
}
// The supplied GLB's single mesh, built as the asset controller hands it over.
const suppliedAsset = async (tier) =>
  glbAsset(modelBytes("lantern", tier), {
    material: new MeshStandardMaterial({ emissiveMap: new Texture(), map: new Texture() }),
  });
const triangles = (array) =>
  Array.from({ length: array.length / 3 }, (_, k) =>
    [...array.slice(k * 3, k * 3 + 3)].join(","),
  ).sort();

test("flame v3 keeps the pinned hooks, adds the near field and owns no borrowed resource", () => {
  const f = fixture(),
    initial = {
      geometry: f.mesh.geometry,
      map: f.material.map,
      emission: f.material.emissiveMap,
      hook: f.material.onBeforeCompile,
      key: f.material.customProgramCacheKey,
    };
  const positions = f.mesh.geometry.attributes.position.array.slice();
  let borrowedDisposals = 0;
  for (const resource of [initial.geometry, initial.map, initial.emission, f.material])
    resource.addEventListener("dispose", () => borrowedDisposals++);
  const flame = createLanternFlame(f),
    shader = compile(f.material);
  assert.match(shader.vertexShader, /vLanternPoint = position/);
  assert.match(shader.fragmentShader, /lanternMask = emissiveColor\.r/);
  assert.match(
    shader.fragmentShader,
    /totalEmissiveRadiance = lanternFire\(vLanternPoint\) \* lanternMask/,
  );
  // The emission mask's 18 UV islands drew seams: the mask is remapped and
  // the globe taken by a spatial gate.
  assert.match(
    shader.fragmentShader,
    /smoothstep\(\.08, \.4, lanternMask\), lanternBulb\(vLanternPoint\)/,
    "seam-free mask",
  );
  assert.match(
    shader.fragmentShader,
    /#include <lights_fragment_end>[\s\S]*NUM_POINT_LIGHTS[\s\S]*lanternNearGain/,
    "near field after the lights",
  );
  // The practical light is recognised where the view matrix puts it, not by
  // a prop-scale-dependent distance from the flame.
  assert.match(
    shader.fragmentShader,
    /lanternLightView = \(viewMatrix \* vec4\(lanternLight, 1\.\)\)\.xyz/,
  );
  assert.match(
    shader.fragmentShader,
    /distance\( lanternPoint\.position, lanternLightView \) < lanternMatch/,
  );
  // Bloom is an explicit uniform, not the shadow-map define standing in for it.
  assert.match(shader.fragmentShader, /uniform float lanternBloom/);
  assert.doesNotMatch(shader.fragmentShader, /USE_SHADOWMAP/);
  assert.doesNotMatch(shader.fragmentShader, /texture2D/, "reuse Three's one emission mask tap");
  assert.equal(f.mesh.geometry, initial.geometry);
  assert.deepEqual(f.mesh.geometry.attributes.position.array, positions);
  assert.equal(f.mesh.material, f.material, "a box has no globe: no glass group");
  assert.equal(f.material.map, initial.map);
  assert.equal(f.material.emissiveMap, initial.emission);
  assert.ok(f.material.customProgramCacheKey().endsWith("|lantern-flame-v3"));
  assert.equal(flame.dispose(), true);
  assert.equal(flame.dispose(), false);
  assert.equal(f.material.onBeforeCompile, initial.hook);
  assert.equal(f.material.customProgramCacheKey, initial.key);
  assert.equal(borrowedDisposals, 0);
});

test("the exported profile is frozen, self-consistent and is what the shader draws", () => {
  assert.ok(
    Object.isFrozen(FLAME) &&
      Object.isFrozen(FLAME.axis) &&
      Object.isFrozen(FLAME.globe) &&
      Object.isFrozen(FLAME.color),
  );
  for (const color of Object.values(FLAME.color))
    assert.ok(Object.isFrozen(color) && color.length === 3);
  near(FLAME.height, 0.3);
  near(FLAME.top, FLAME.base + FLAME.height);
  near(FLAME.center, FLAME.base + 0.35 * FLAME.height);
  // Recommended: about 44% of the globe, standing on the wick inside it.
  const globe = FLAME.globe.top - FLAME.globe.bottom;
  assert.ok(FLAME.height / globe > 0.4 && FLAME.height / globe < 0.48);
  assert.ok(
    FLAME.base > FLAME.globe.bottom &&
      FLAME.top < FLAME.globe.top &&
      FLAME.halfWidth * 1.45 < FLAME.globe.radius,
  );
  const f = fixture(),
    flame = createLanternFlame(f),
    glsl = compile(f.material).fragmentShader;
  assert.match(glsl, /#define FLAME_BASE 0\.49\b/);
  assert.match(glsl, /#define FLAME_H 0\.3\b/);
  assert.match(glsl, /#define FLAME_W 0\.047\b/);
  assert.match(glsl, /#define LANTERN_AXIS vec2\(0\.0, -0\.01\)/);
  for (const name of ["blue", "core", "body", "tip"])
    assert.ok(
      glsl.includes(
        `vec3(${FLAME.color[name]
          .map((c) =>
            String(c)
              .replace(/^(-?)0?\./, "$10.")
              .replace(/^(\d+)$/, "$1.0"),
          )
          .join(", ")})`,
      ),
      name,
    );
  assert.match(glsl, /fire \* 1\.6 \+ glass/);
  assert.match(
    glsl,
    /vec3\(0\.0, 0\.595, -0\.01\)/,
    "near field centred on the flame's bright band",
  );
  flame.dispose();
});

test("the globe becomes its own see-through draw group and is restored exactly", () => {
  const f = fixture(globeGeometry()),
    index = f.mesh.geometry.index,
    before = index.array.slice();
  const flame = createLanternFlame(f);
  assert.deepEqual(
    [...f.mesh.geometry.groups].map((g) => [g.start, g.count, g.materialIndex]),
    [
      [0, 3, 0],
      [3, 6, 1],
    ],
  );
  assert.equal(f.mesh.geometry.index, index, "same index attribute, reordered in place");
  assert.deepEqual([...index.array.slice(0, 3)], [4, 5, 0], "the burner stays opaque");
  assert.deepEqual(triangles(index.array), triangles(before), "a permutation of whole triangles");
  const [opaque, glass] = f.mesh.material;
  assert.equal(opaque, f.material);
  assert.ok(
    glass.transparent &&
      glass.depthWrite &&
      glass.side === 0 &&
      glass.blending === 5 &&
      glass.blendDst === 214 &&
      glass.blendAlpha === 0.08,
  );
  assert.equal(glass.blendSrcAlpha, 201);
  assert.equal(glass.blendDstAlpha, 200);
  assert.equal(glass.map, f.material.map, "the clone borrows the maps");
  assert.equal(glass.name, "lantern glass");
  // warmShaders() compiles through renderer.compile(), which walks material
  // arrays: both programs link at the commit.
  assert.deepEqual([f.mesh.material].flat(), [opaque, glass]);
  const glassShader = compile(glass),
    opaqueShader = compile(f.material);
  assert.match(
    glassShader.fragmentShader,
    /lanternMask = 1\.;\ndiffuseColor\.a = 1\.;/,
    "opaque alpha keeps the subject's layer code",
  );
  assert.doesNotMatch(
    glassShader.fragmentShader,
    /lanternNearGain/,
    "the glass pays for no near field",
  );
  assert.doesNotMatch(opaqueShader.fragmentShader, /lanternMask = 1\./);
  assert.equal(
    glassShader.uniforms.lanternFlicker,
    opaqueShader.uniforms.lanternFlicker,
    "one draught for both programs",
  );
  assert.notEqual(glass.customProgramCacheKey(), f.material.customProgramCacheKey());
  let glassDisposed = 0,
    mapDisposed = 0;
  glass.addEventListener("dispose", () => glassDisposed++);
  f.material.map.addEventListener("dispose", () => mapDisposed++);
  flame.dispose();
  assert.deepEqual([...index.array], [...before]);
  assert.equal(f.mesh.geometry.groups.length, 0);
  assert.equal(f.mesh.material, f.material);
  assert.equal(glassDisposed, 1);
  assert.equal(mapDisposed, 0);
});

test("both delivered lantern tiers split exactly their 268 globe triangles and restore the index", async () => {
  for (const tier of ["high", "balanced"]) {
    const lantern = createLanternArchitecture({ asset: await suppliedAsset(tier) });
    const mesh = lantern.root.children[0],
      index = mesh.geometry.index,
      before = index.array.slice(),
      material = mesh.material;
    const flame = createLanternFlame({ root: lantern.root });
    const [shell, glass] = [mesh.geometry.groups[1], mesh.material[1]];
    assert.deepEqual(
      mesh.geometry.groups.map((g) => [g.start, g.count, g.materialIndex]),
      [
        [0, 9000 - 804, 0],
        [9000 - 804, 804, 1],
      ],
      tier,
    );
    const position = mesh.geometry.attributes.position;
    for (let k = shell.start; k < shell.start + shell.count; k += 3) {
      const corners = [0, 1, 2].map((j) => index.array[k + j]);
      const centroid = corners.reduce((sum, i) => sum + position.getY(i), 0) / 3;
      assert.ok(centroid > FLAME.globe.bottom && centroid < FLAME.globe.top);
      for (const i of corners)
        assert.ok(
          Math.hypot(position.getX(i) - FLAME.axis[0], position.getZ(i) - FLAME.axis[1]) <
            FLAME.globe.radius,
        );
    }
    assert.deepEqual(triangles(index.array), triangles(before));
    // The flame stands on the wick inside the globe, below the authored light.
    near(lantern.luminousCenter.y, 0.7146, 1e-3);
    assert.ok(FLAME.center < lantern.luminousCenter.y && lantern.luminousCenter.y < FLAME.top);
    assert.equal(glass.transparent, true);
    flame.dispose();
    assert.deepEqual(index.array, before);
    assert.equal(mesh.geometry.groups.length, 0);
    assert.equal(mesh.material, material);
    lantern.dispose();
  }
});

test("a failure part-way through construction restores every mesh, hook and clone", () => {
  const f = fixture(globeGeometry()),
    index = f.mesh.geometry.index,
    before = index.array.slice();
  const hook = f.material.onBeforeCompile,
    key = f.material.customProgramCacheKey;
  let clones = 0,
    cloneDisposals = 0;
  f.material.clone = function () {
    const copy = MeshStandardMaterial.prototype.clone.call(this);
    clones++;
    copy.addEventListener("dispose", () => cloneDisposals++);
    return copy;
  };
  const broken = new Mesh(new BoxGeometry(), f.material);
  Object.defineProperty(broken, "material", {
    get() {
      throw new Error("broken lantern part");
    },
  });
  f.root.add(broken);
  assert.throws(() => createLanternFlame(f), /broken lantern part/);
  assert.equal(clones, 1, "the globe had already split");
  assert.equal(cloneDisposals, 1);
  assert.deepEqual([...index.array], [...before]);
  assert.equal(f.mesh.geometry.groups.length, 0);
  assert.equal(f.mesh.material, f.material);
  assert.equal(f.material.onBeforeCompile, hook);
  assert.equal(f.material.customProgramCacheKey, key);
});

test("draught flicker is visible, bounded, neutral at rest and shared with the uniform", () => {
  assert.deepEqual(lanternDraught(0), [1, 1, 0, 0]);
  const f = fixture(),
    flame = createLanternFlame(f),
    shader = compile(f.material);
  const factors = [];
  for (let i = 0; i < 80; i++) {
    factors.push(flame.update({ deltaSeconds: 0.016 }));
    assert.equal(
      shader.uniforms.lanternFlicker.value[0],
      factors.at(-1),
      "uniform equals the returned factor",
    );
    assert.deepEqual(shader.uniforms.lanternFlicker.value, lanternDraught(flame.time));
  }
  assert.ok(
    Math.max(...factors) - Math.min(...factors) > 0.08,
    "calm breath is visible within 1.28 s",
  );
  for (let i = 0; i < 1170; i++) factors.push(flame.update({ deltaSeconds: 0.016 }));
  assert.ok(Math.max(...factors) - Math.min(...factors) > 0.12, "a draught arrives within 20 s");
  let lean = 0;
  for (let t = 0; t < 600; t += 0.01) {
    const [glow, height, x, z] = lanternDraught(t);
    lean = Math.max(lean, Math.hypot(x, z));
    assert.ok(
      glow >= 0.88 && glow <= 1.1 && height > 0.7 && height < 1.1 && Math.hypot(x, z) < 0.05,
      `t ${t}`,
    );
  }
  assert.ok(lean > 0.03, "draughts lean the tip");
  // The puddle mirror (terrain-build.js) reads the same draught from the root.
  assert.equal(f.root.userData.lanternFlicker, shader.uniforms.lanternFlicker);
  flame.dispose();
  assert.equal(f.root.userData.lanternFlicker, undefined, "withdrawn on dispose");
});

test("flame time and light multiplier freeze under every hold and resume without wall-clock jumps", () => {
  const f = fixture(),
    flame = createLanternFlame(f),
    shader = compile(f.material);
  const factors = [];
  for (let i = 0; i < 80; i++) factors.push(flame.update({ deltaSeconds: 0.016 }));
  const time = flame.time,
    factor = factors.at(-1),
    key = f.material.customProgramCacheKey();
  const draught = [...shader.uniforms.lanternFlicker.value];
  // motionPaused carries the visitor hold and open panels (index.js).
  for (const hold of [
    { reducedMotion: true },
    { motionPaused: true },
    { reducedMotion: true, motionPaused: true },
  ]) {
    for (let i = 0; i < 10; i++) assert.equal(flame.update({ deltaSeconds: 100, ...hold }), factor);
    assert.equal(flame.time, time);
    assert.deepEqual(
      shader.uniforms.lanternFlicker.value,
      draught,
      "shape, glow and lean hold too",
    );
  }
  flame.update({ deltaSeconds: 0.016 });
  near(flame.time, time + 0.016);
  assert.equal(shader.uniforms.lanternTime.value, flame.time);
  assert.equal(
    f.material.customProgramCacheKey(),
    key,
    "uniform-only animation cannot compile new programs",
  );
  flame.update({ deltaSeconds: Infinity });
  near(flame.time, time + 0.016);
  flame.dispose();
  assert.equal(flame.update({ deltaSeconds: 0.1 }), 1);
});

test("the bloom flag follows an explicit flag, else the renderer's tier pairing, and never drops the globe's glow", () => {
  const f = fixture(globeGeometry()),
    flame = createLanternFlame(f);
  const shader = compile(f.material),
    key = f.material.customProgramCacheKey();
  flame.update({});
  assert.equal(shader.uniforms.lanternBloom.value, 1, "no renderer known yet: assume bloom");
  const renderer = { shadowMap: { enabled: false } };
  compile(f.mesh.material[1], renderer);
  flame.update({});
  assert.equal(shader.uniforms.lanternBloom.value, 0, "balanced/low: no shadows, no bloom");
  renderer.shadowMap.enabled = true;
  flame.update({});
  assert.equal(shader.uniforms.lanternBloom.value, 1, "high: shadows and bloom");
  flame.update({ bloom: false });
  assert.equal(shader.uniforms.lanternBloom.value, 0, "an explicit flag wins");
  renderer.shadowMap.enabled = false;
  flame.update({ bloom: true });
  assert.equal(shader.uniforms.lanternBloom.value, 1);
  assert.equal(f.material.customProgramCacheKey(), key, "a tier change swaps no program");
  const glsl = shader.fragmentShader;
  // Bloom at this flame's size adds almost nothing (review 2026-09-28: the high
  // tier's globe nearly vanished), so it only trims the glare and rim a little.
  assert.match(
    glsl,
    /exp\(-dot\(b, b\)\) \* \(1\. - \.25 \* lanternBloom\)/,
    "the glare keeps three quarters under bloom",
  );
  assert.match(
    glsl,
    /mix\(1\.6, 1\.5, lanternBloom\)/,
    "the rim keeps most of its strength under bloom",
  );
  assert.doesNotMatch(
    glsl,
    /\(1\. - lanternBloom\)|mix\(1\.6, 1\., lanternBloom\)/,
    "bloom never removes the glass glow outright",
  );
  flame.dispose();
});

test("the near field finds the practical light beside the lantern at any prop scale", () => {
  const f = fixture(),
    parent = new Group(),
    light = new PointLight(),
    fill = new PointLight();
  parent.add(f.root, light, fill);
  light.position.set(0.002, 0.7146, -0.003);
  fill.position.set(-3.8, 9, -2.5);
  const world = new Group();
  world.add(parent);
  world.position.set(59, -6.2, 36);
  world.rotation.y = 0.7;
  world.scale.setScalar(0.7984);
  const flame = createLanternFlame(f),
    shader = compile(f.material),
    lamp = shader.uniforms.lanternLight.value;
  assert.ok(lamp.y > 1e3, "not yet attached: nothing matches");
  flame.update({ deltaSeconds: 0.016 });
  world.updateMatrixWorld(true);
  near(lamp.distanceTo(light.getWorldPosition(new Vector3())), 0, 1e-9);
  // Three puts pointLights[] in view space with the camera's view matrix, as
  // the shader does with lanternLight: the match is exact up to float slack.
  f.camera.updateMatrixWorld(true);
  const view = (v) => v.clone().applyMatrix4(f.camera.matrixWorldInverse);
  const lightView = view(new Vector3().setFromMatrixPosition(light.matrixWorld));
  near(view(lamp).distanceTo(lightView), 0, 1e-9);
  const slack = 0.02 + 0.004 * lightView.length();
  assert.ok(
    view(fill.getWorldPosition(new Vector3())).distanceTo(lightView) > 20 * slack,
    "the fill light never matches",
  );
  parent.remove(f.root);
  flame.update({ deltaSeconds: 0.016 });
  assert.ok(lamp.y > 1e3, "detached: the near field matches no light");
  flame.dispose();
});

test("projected flame camera coordinates follow the lantern's parent transform even during a pause", () => {
  const f = fixture();
  f.root.position.set(12, -3, 4);
  f.root.rotation.y = 0.8;
  f.root.scale.setScalar(0.8);
  const flame = createLanternFlame(f),
    shader = compile(f.material);
  flame.update({ deltaSeconds: 0.016 });
  const expected = f.root.worldToLocal(f.camera.getWorldPosition(new Vector3()));
  assert.deepEqual(shader.uniforms.lanternEye.value, expected);
  const time = flame.time;
  f.camera.position.x += 2;
  flame.update({ deltaSeconds: 0.016, motionPaused: true });
  assert.notDeepEqual(shader.uniforms.lanternEye.value, expected);
  assert.equal(flame.time, time);
  flame.dispose();
});

test("the mounted supplied lantern drives the tree's practical light and leaves the stand-in untouched", async () => {
  const source = fixture();
  const tree = createTreeArchitecture({ asset: { scene: source.root }, groundHeight: () => 0 });
  tree.setFilmTreatment(true);
  tree.applyQuality({ tier: "balanced", lighting: { practicalIntensityScale: 0.84 } });
  tree.root.scale.setScalar(0.7984);
  const standIn = [];
  tree.root.getObjectByName("tree-lantern").traverse((o) => {
    if (o.material)
      standIn.push([o.material, o.material.onBeforeCompile, o.material.customProgramCacheKey]);
  });
  let ready;
  const prepared = new Promise((resolve) => {
    ready = resolve;
  });
  const camera = new PerspectiveCamera();
  camera.position.set(70, 2, 50);
  const mount = createLanternMount({
    camera,
    onPrepared: () => ready(),
    loadFlame: () => import("../src/scene/lantern-flame.js"),
  });
  mount.setTree(tree);
  mount.stage(await suppliedAsset("balanced"));
  await prepared;
  assert.equal(mount.take(), true);
  const lantern = tree.root.getObjectByName("supplied-meshy-lantern"),
    mesh = lantern.children[0];
  assert.ok(Array.isArray(mesh.material), "the committed lantern draws its globe as glass");
  const shader = compile(mesh.material[0]);
  mount.update({ deltaSeconds: 0.016 });
  tree.root.updateMatrixWorld(true);
  near(
    shader.uniforms.lanternLight.value.distanceTo(tree.light.getWorldPosition(new Vector3())),
    0,
    1e-9,
  );
  near(tree.light.intensity, 4.8 * 0.84 * shader.uniforms.lanternFlicker.value[0]);
  for (const [material, hook, key] of standIn) {
    assert.equal(material.onBeforeCompile, hook);
    assert.equal(material.customProgramCacheKey, key);
  }
  mount.dispose();
  assert.equal(mesh.material.isMaterial, true, "dispose restored the single material");
  assert.equal(mesh.geometry.groups.length, 0);
  near(tree.light.intensity, 4.8 * 0.84);
  tree.dispose();
});

test("point-light flicker uses cached film/quality base without accumulating or rewriting tree normals", () => {
  const source = fixture();
  const tree = createTreeArchitecture({ asset: { scene: source.root }, groundHeight: () => 0 });
  const normal = tree.root.getObjectByName("meshy-tree").geometry.attributes.normal;
  tree.setFilmTreatment(true);
  tree.applyQuality({ tier: "high", lighting: { practicalIntensityScale: 1.08 } });
  const version = normal.version,
    base = 4.8 * 1.08;
  const fill = tree.fillLight.intensity;
  for (let i = 0; i < 100; i++) tree.setLanternFlicker(1.12);
  near(tree.light.intensity, base * 1.12);
  assert.equal(normal.version, version);
  assert.equal(tree.fillLight.intensity, fill);
  tree.applyQuality({ tier: "balanced", lighting: { practicalIntensityScale: 0.84 } });
  near(tree.light.intensity, 4.8 * 0.84 * 1.12);
  tree.setLanternFlicker(0.88);
  near(tree.light.intensity, 4.8 * 0.84 * 0.88);
  tree.setLanternFlicker();
  near(tree.light.intensity, 4.8 * 0.84);
  tree.setLanternFlicker(NaN);
  near(tree.light.intensity, 4.8 * 0.84);
  tree.dispose();
});

test("both programs stay within GLSL ES 1.00, so WebGL1 compiles them too", () => {
  const f = fixture(globeGeometry()),
    flame = createLanternFlame(f);
  for (const material of f.mesh.material) {
    const { vertexShader, fragmentShader } = compile(material);
    const glsl = (vertexShader + "\n" + fragmentShader).replace(/\/\/.*$/gm, "");
    for (const [pattern, why] of [
      [/\btexture(Lod|Grad|Size|Offset|Proj)?\s*\(|\btexelFetch/, "ES3 texture functions"],
      [
        /\b(round|roundEven|trunc|inverse|transpose|determinant|outerProduct|isnan|isinf|[sc]osh|tanh|a[sc]osh|atanh|modf)\s*\(/,
        "ES3 built-ins",
      ],
      [/\b(u?int|float)BitsTo|\buint\b|\buvec[234]\b|\d+u\b/, "unsigned and bit casts"],
      [/<<|>>|%|(^|[^&])&([^&]|$)|(^|[^|])\|([^|]|$)|\^\^?|~/m, "integer and bitwise operators"],
      [
        /\b(switch|flat|smooth|layout|centroid|out|in)\s+(vec|float|int|mat|\()|\bswitch\b|\bdo\s*\{/,
        "ES3 qualifiers and statements",
      ],
      [/\[\s*\]|\b(vec[234]|float|int)\s*\[/, "array constructors and unsized arrays"],
      [/#version|gl_FragColor\s*=|\bout\s+highp/, "no own outputs or version"],
    ])
      assert.doesNotMatch(glsl, pattern, why);
    // The one loop indexes a uniform array: ES 1.00 accepts that only with a
    // constant bound, and Three unrolls it (below, after compaction) anyway.
    const loops = glsl.match(/\bfor\s*\([^)]*\)/g) || [];
    assert.ok(
      loops.every((loop) => /^for \( int i = 0; i < NUM_POINT_LIGHTS; i \+\+ \)$/.test(loop)),
      loops.join(),
    );
    assert.equal(loops.length, material === f.material ? 1 : 0);
    assert.doesNotMatch(glsl, /\bwhile\b/);
  }
  flame.dispose();
});

test("the compacted chunk keeps its anchors and Three still unrolls the near-field loop", async () => {
  // Bundle lantern-flame.js as build.mjs does: its GLSL loses indentation, the
  // spaces beside punctuation and most newlines.
  const scratchRoot = fileURLToPath(new URL("../.tmp-preview-review/", import.meta.url));
  await mkdir(scratchRoot, { recursive: true });
  const scratch = await mkdtemp(path.join(scratchRoot, "lantern-flame-"));
  try {
    const outfile = path.join(scratch, "lantern-flame.mjs");
    await build({
      entryPoints: [fileURLToPath(new URL("../src/scene/lantern-flame.js", import.meta.url))],
      bundle: true,
      format: "esm",
      outfile,
      external: ["three"],
      logLevel: "silent",
      plugins: [
        {
          name: "compact-shaders",
          setup(bundler) {
            bundler.onLoad(
              { filter: /[\\/]src[\\/]scene[\\/][^\\/]+\.js$/ },
              async ({ path: file }) => ({
                contents: compactShaderSource(await readFile(file, "utf8")),
                loader: "js",
              }),
            );
          },
        },
      ],
    });
    const shipped = await import(pathToFileURL(outfile).href);
    assert.deepEqual(shipped.FLAME, FLAME);
    const f = fixture(globeGeometry()),
      flame = shipped.createLanternFlame(f);
    const [opaque, glass] = f.mesh.material;
    const { vertexShader, fragmentShader } = compile(opaque);
    assert.doesNotMatch(
      fragmentShader,
      /totalEmissiveRadiance = lanternFire/,
      "the bundle is compacted",
    );
    assert.match(fragmentShader, /totalEmissiveRadiance=lanternFire\(vLanternPoint\)\*lanternMask/);
    assert.match(vertexShader, /vLanternPoint = position;/);
    assert.match(
      compile(glass).fragmentShader,
      /lanternBulb\(vLanternPoint\)\);\nlanternMask = 1\.;\ndiffuseColor\.a = 1\.;\n/,
    );
    // Three r160 (WebGLProgram): replaceLightNums, then unrollLoops.
    const unrollLoopPattern =
      /#pragma unroll_loop_start\s+for\s*\(\s*int\s+i\s*=\s*(\d+)\s*;\s*i\s*<\s*(\d+)\s*;\s*i\s*\+\+\s*\)\s*{([\s\S]+?)}\s+#pragma unroll_loop_end/g;
    const unrolled = fragmentShader
      .replace(/NUM_POINT_LIGHTS/g, "2")
      .replace(unrollLoopPattern, (match, start, end, body) => {
        let text = "";
        for (let i = +start; i < +end; i++) text += body.replace(/\[\s*i\s*\]/g, `[ ${i} ]`);
        return text;
      });
    assert.doesNotMatch(unrolled, /unroll_loop|\bfor\s*\(/);
    assert.match(unrolled, /pointLights\[ 0 \][\s\S]*pointLights\[ 1 \]/);
    assert.equal(unrolled.match(/RE_Direct\(/g).length, 2);
    for (const directive of [
      "#if defined( USE_EMISSIVEMAP ) && 2 > 0",
      "#ifdef USE_EMISSIVEMAP",
      "#ifndef FLAT_SHADED",
      "#include <lights_fragment_end>",
      "#include <emissivemap_fragment>",
    ])
      assert.match(
        unrolled,
        new RegExp(`(^|\\n)${directive.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\n|$)`),
        directive,
      );
    flame.dispose();
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});
