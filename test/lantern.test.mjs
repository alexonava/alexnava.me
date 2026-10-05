import assert from "node:assert/strict";
import test from "node:test";
import { parseGlb, glbAsset, modelBytes } from "./support/glb.mjs";
import { readFile, mkdir, mkdtemp, rm } from "node:fs/promises";
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
  BufferGeometry,
  PointLight,
} from "three";
import { createLanternArchitecture, createLanternMount } from "../src/scene/lantern.js";
import { createTreeArchitecture, LANTERN_FILM_INTENSITY } from "../src/scene/architecture.js";
import { LANTERN_MOOD } from "../src/scene/film-light.js";
import { createPropScale } from "../src/scene/prop-scale.js";
import { createCinematicCamera, cinematicSafeArea } from "../src/scene/cinematic.js";
import { DIRECTED_SHOTS, measureShot } from "../src/scene/directed-shots.js";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { compactShaderSource } from "../tools/shader-compact.mjs";
import { createLanternFlame, FLAME, lanternDraught } from "../src/scene/lantern-flame.js";

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

test("both delivered lantern tiers embed authored PBR maps, masked emission and emitter metadata", async () => {
  for (const tier of ["high", "balanced"]) {
    const bytes = await readFile(
      new URL(`../images/architecture/lantern-${tier}.glb`, import.meta.url),
    );
    assert.equal(bytes.toString("ascii", 0, 4), "glTF");
    assert.equal(bytes.readUInt32LE(8), bytes.length);
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
      // A WebP map is named by EXT_texture_webp (required, so it has no fallback source).
      const texture = json.textures[field.index];
      const image = json.images[texture.extensions?.EXT_texture_webp?.source ?? texture.source];
      assert.ok(Number.isInteger(image.bufferView));
      assert.equal(image.uri, undefined);
    }
    // Delivered like the other models: WebP maps and quantized geometry.
    assert.deepEqual([...json.extensionsRequired].sort(), [
      "EXT_texture_webp",
      "KHR_mesh_quantization",
    ]);
    assert.ok(material.emissiveFactor.some((value) => value > 0));
    const emitter = json.scenes[json.scene ?? 0].extras.lantern.luminousCenter;
    assert.equal(emitter.length, 3);
    assert.ok(emitter.every(Number.isFinite));
    assert.ok(emitter[1] > 0 && emitter[1] < 2.48);
    assert.equal(json.animations?.length || 0, 0);
  }
});

const approx = (actual, expected, tolerance = 1e-6) =>
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
  approx(FLAME.height, 0.3);
  approx(FLAME.top, FLAME.base + FLAME.height);
  approx(FLAME.center, FLAME.base + 0.35 * FLAME.height);
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
    approx(lantern.luminousCenter.y, 0.7146, 1e-3);
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
  approx(flame.time, time + 0.016);
  assert.equal(shader.uniforms.lanternTime.value, flame.time);
  assert.equal(
    f.material.customProgramCacheKey(),
    key,
    "uniform-only animation cannot compile new programs",
  );
  flame.update({ deltaSeconds: Infinity });
  approx(flame.time, time + 0.016);
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
  approx(lamp.distanceTo(light.getWorldPosition(new Vector3())), 0, 1e-9);
  // Three puts pointLights[] in view space with the camera's view matrix, as
  // the shader does with lanternLight: the match is exact up to float slack.
  f.camera.updateMatrixWorld(true);
  const view = (v) => v.clone().applyMatrix4(f.camera.matrixWorldInverse);
  const lightView = view(new Vector3().setFromMatrixPosition(light.matrixWorld));
  approx(view(lamp).distanceTo(lightView), 0, 1e-9);
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
  approx(
    shader.uniforms.lanternLight.value.distanceTo(tree.light.getWorldPosition(new Vector3())),
    0,
    1e-9,
  );
  approx(
    tree.light.intensity,
    LANTERN_FILM_INTENSITY * 0.84 * shader.uniforms.lanternFlicker.value[0],
  );
  for (const [material, hook, key] of standIn) {
    assert.equal(material.onBeforeCompile, hook);
    assert.equal(material.customProgramCacheKey, key);
  }
  mount.dispose();
  assert.equal(mesh.material.isMaterial, true, "dispose restored the single material");
  assert.equal(mesh.geometry.groups.length, 0);
  approx(tree.light.intensity, LANTERN_FILM_INTENSITY * 0.84);
  tree.dispose();
});

test("point-light flicker uses cached film/quality base without accumulating or rewriting tree normals", () => {
  const source = fixture();
  const tree = createTreeArchitecture({ asset: { scene: source.root }, groundHeight: () => 0 });
  const normal = tree.root.getObjectByName("meshy-tree").geometry.attributes.normal;
  tree.setFilmTreatment(true);
  tree.applyQuality({ tier: "high", lighting: { practicalIntensityScale: 1.08 } });
  const version = normal.version,
    base = LANTERN_FILM_INTENSITY * 1.08;
  const fill = tree.fillLight.intensity;
  for (let i = 0; i < 100; i++) tree.setLanternFlicker(1.12);
  approx(tree.light.intensity, base * 1.12);
  assert.equal(normal.version, version);
  assert.equal(tree.fillLight.intensity, fill);
  tree.applyQuality({ tier: "balanced", lighting: { practicalIntensityScale: 0.84 } });
  approx(tree.light.intensity, LANTERN_FILM_INTENSITY * 0.84 * 1.12);
  tree.setLanternFlicker(0.88);
  approx(tree.light.intensity, LANTERN_FILM_INTENSITY * 0.84 * 0.88);
  tree.setLanternFlicker();
  approx(tree.light.intensity, LANTERN_FILM_INTENSITY * 0.84);
  tree.setLanternFlicker(NaN);
  approx(tree.light.intensity, LANTERN_FILM_INTENSITY * 0.84);
  // The shot's lantern mood (film-light.js) scales the flickering practical in
  // film, from the same cached base, and never accumulates.
  try {
    LANTERN_MOOD.value = 1.45;
    const moodVersion = normal.version;
    for (let i = 0; i < 10; i++) tree.setLanternFlicker(1.12);
    approx(tree.light.intensity, LANTERN_FILM_INTENSITY * 0.84 * 1.12 * 1.45);
    assert.equal(normal.version, moodVersion);
    LANTERN_MOOD.value = 0.7;
    tree.setLanternFlicker(0.88);
    approx(tree.light.intensity, LANTERN_FILM_INTENSITY * 0.84 * 0.88 * 0.7);
    // Outside film the mood is ignored.
    tree.setFilmTreatment(false);
    tree.setLanternFlicker(1);
    approx(tree.light.intensity, 4 * 0.84);
  } finally {
    LANTERN_MOOD.value = 1;
  }
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
