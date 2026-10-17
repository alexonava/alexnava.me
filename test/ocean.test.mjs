import test from "node:test";
import assert from "node:assert/strict";
import { BoxGeometry, Color, Group, Mesh, MeshStandardMaterial, Scene, Vector3 } from "three";
import {
  CLIFF,
  COAST,
  FALLS,
  SEA,
  SEA_SHARED,
  SHORE,
  STACKS,
  cliffGeometry,
  coastDistance,
  coastGlsl,
  coastLand,
  coastPlane,
  createCliff,
  createFalls,
  createSea,
  fallsGeometry,
  faultAlong,
  landFactor,
  riverFalls,
  slateShoreEdits,
  stackGeometry,
  stacksSurfGlsl,
} from "../src/scene/ocean.js";
import { DEPTH_LAYER } from "../src/scene/depth-layers.js";
import { MIST_PARS, MIST_UNIFORMS, mistOn } from "../src/scene/drifting-mist.js";
import { FLASH_GROUND } from "../src/scene/film-light.js";
import { createFilmScene } from "../src/scene/film-scene.js";
import { HIGH_VIEW, HORIZON_AIR, RANGE_MIST, SEA_SINK } from "../src/scene/hill-silhouette.js";
import { configureGroundShading, SLATE_TEXT_GUARD } from "../src/scene/mud-ground.js";
import {
  createEarthGeometry,
  dripClock,
  filmHeight,
  foothillHeight,
  FINE_WINDOW,
  LANTERN_FOOT,
  RIVER_LINE,
  settleRoots,
  shadeSlateGround,
  TERRAIN_BASE,
  TREE_FOOTING,
} from "../src/scene/terrain-build.js";
import { compilePrograms } from "../src/scene/shader-programs.js";
import { flat, source } from "./support/code.mjs";

// What film-scene.js lends the sea (terrain-build.js settleRoots()'s `lib`).
const lib = {
  SLATE_TEXT_GUARD,
  MIST_PARS,
  MIST_UNIFORMS,
  FLASH_GROUND,
  RANGE_MIST,
  SEA_SINK,
  HIGH_VIEW,
};
const rendering = () => ({ homeScene: new Scene(), lights: {}, tier: "high" });

// seaCoast() read back as JavaScript, so the GLSL and coastDistance() are held equal.
function glslCoast() {
  const body = coastGlsl()
    .replace(/^float seaCoast\(vec2 p\)\{/, "")
    .replace(/\}$/, "")
    .replace(/float /g, "let ")
    .replace(/dot\(p,vec2\(([^,]+),([^)]+)\)\)/g, "(p[0]*($1)+p[1]*($2))")
    .replace(/\b(sin|cos|abs|sqrt)\(/g, "Math.$1(")
    .replace(/inversesqrt\(/g, "1/Math.sqrt(")
    .replace(/(\d)\.(?!\d)/g, "$1.0");
  return new Function("p", body);
}

test("the fault's distance is one table, in JavaScript and GLSL, about a unit a unit near the line and seamless", () => {
  const seaCoast = glslCoast();
  for (let x = -190; x <= 190; x += 7.3)
    for (let z = -190; z <= 190; z += 6.1) {
      const d = coastDistance(x, z);
      // (The GLSL keeps six decimals of each coefficient: exact enough near the line, where it is read.)
      assert.ok(
        Math.abs(seaCoast([x, z]) - d) < (Math.abs(d) < 15 ? 0.01 : 0.005 * Math.abs(d)),
        `${x},${z}`,
      );
    }
  // The fault's mean line, for the ranges that sink past it.
  const [nx, nz, offset] = coastPlane();
  assert.ok(Math.abs(nx - Math.cos((COAST.bearing * Math.PI) / 180)) < 1e-12);
  assert.ok(Math.abs(nz - Math.sin((COAST.bearing * Math.PI) / 180)) < 1e-12);
  assert.equal(offset, COAST.offset);
  // Near the line it measures distance (the drop, the walk's edge and the sea's own edge read it
  // there); and nowhere near it does it jump, not even through a fracture's cusp.
  const slope = (x, z, e = 0.005) =>
    Math.hypot(
      coastDistance(x + e, z) - coastDistance(x - e, z),
      coastDistance(x, z + e) - coastDistance(x, z - e),
    ) /
    (2 * e);
  let near = 0;
  for (let x = -190; x <= 190; x += 0.53)
    for (let z = -190; z <= 190; z += 0.53) {
      const d = Math.abs(coastDistance(x, z));
      if (d > 9) continue;
      const g = slope(x, z);
      assert.ok(g < 4, `a jump at ${x},${z}`);
      if (d < 1) {
        assert.ok(g > 0.75 && g < 1.3, `${g} at ${x},${z}`);
        near++;
      }
    }
  assert.ok(near > 1000, `${near} samples on the line`);
});

test("the land falls to the seabed past the fault, well clear of the estate, its foothills fading first", () => {
  const base = (x, z) => 0.3 * Math.sin(x * 0.05) + 0.2 * Math.cos(z * 0.07);
  const film = filmHeight(base),
    land = filmHeight(base, true);
  for (let x = -190; x <= 190; x += 3.7)
    for (let z = -190; z <= 190; z += 4.3) {
      const d = coastDistance(x, z);
      if (d < SHORE.drop) assert.equal(film(x, z), SHORE.deep, `${x},${z}`);
      else assert.equal(film(x, z), land(x, z), `${x},${z}`);
      assert.ok(land(x, z) > SHORE.deep + 20);
      assert.equal(coastLand(d, 1), d >= SHORE.drop ? 1 : SHORE.deep);
      // The foothills fade out over SHORE.hills inland of the shelf.
      if (d < SHORE.shelf) assert.ok(land(x, z) - TERRAIN_BASE < 1e-9 || Math.hypot(x, z) < 113);
    }
  assert.equal(landFactor(SHORE.shelf), 0);
  assert.equal(landFactor(SHORE.shelf + SHORE.hills), 1);
  // The seabed lies well under the sea; the shelf covers the drop and a coarse cell's diagonal.
  assert.ok(SHORE.deep < SEA.level - 6);
  assert.ok(SHORE.shelf >= SHORE.drop + 3 * Math.SQRT2);
  // Nothing of the estate stands near it: the lookout, the tree's root window, the lantern.
  assert.ok(coastDistance(0, 0) > 100);
  for (const x of [FINE_WINDOW.x[0], FINE_WINDOW.x[1]])
    for (const z of [FINE_WINDOW.z[0], FINE_WINDOW.z[1]])
      assert.ok(coastDistance(TREE_FOOTING.x + x, TREE_FOOTING.z + z) > SHORE.shelf + 3);
  assert.ok(coastDistance(LANTERN_FOOT.x, LANTERN_FOOT.z) > SHORE.shelf + 10);
  // The foothills, where they stand, stand on the land.
  for (let a = 0; a < 360; a += 3)
    for (const r of [120, 139, 156]) {
      const x = r * Math.cos((a * Math.PI) / 180),
        z = r * Math.sin((a * Math.PI) / 180);
      if (coastDistance(x, z) < SHORE.shelf) assert.equal(land(x, z), TERRAIN_BASE, `${x},${z}`);
      assert.ok(foothillHeight(x, z) >= 0);
    }
});

test("the sea is one program: the film's environment its only texture, the ground's depth stamp, and the entry's guard, mist and lightning", () => {
  const clock = dripClock({ value: 0 }),
    sea = createSea({ lib, clock, rendering: rendering() }),
    { mesh, material } = sea,
    fragment = material.fragmentShader;
  assert.ok(material.isShaderMaterial);
  assert.ok(!material.lights, "it reads the scene's lights itself, as uniforms");
  assert.equal(material.uniforms.seaTime, clock.uniform, "on the sea's own clock");
  // Shared, not copied: the lightning, the shot's mist, and the text boxes.
  assert.equal(material.uniforms.babelFlash, FLASH_GROUND.babelFlash);
  assert.equal(material.uniforms.uMist, RANGE_MIST);
  assert.equal(material.uniforms.slateText, MIST_UNIFORMS.mistText);
  assert.equal(material.uniforms.slateAbout, MIST_UNIFORMS.mistAbout);
  assert.ok(fragment.includes(SLATE_TEXT_GUARD));
  assert.ok(fragment.includes("slateBehindText()") && fragment.includes("slateTextKnee("));
  assert.equal(fragment.includes("mistOver("), mistOn);
  if (mistOn) assert.ok(fragment.includes(MIST_PARS));
  // The ground's depth layer, as the entry's (depth-layers.js).
  assert.equal(SEA_SHARED.layer, DEPTH_LAYER.ground);
  assert.ok(fragment.includes(`gl_FragColor=vec4(c,${DEPTH_LAYER.ground});`));
  assert.ok(
    Math.abs(SEA_SHARED.edgeLift - (HORIZON_AIR.edge / HORIZON_AIR.ground - 1)) < 5e-5,
    "the walk's far edge lifts to the far plain's air",
  );
  // No texture but the environment's (through three's CubeUV chunks), no shadows.
  assert.doesNotMatch(fragment, /uniform sampler|texture2D\(/);
  assert.ok(fragment.includes("#include <cube_uv_reflection_fragment>"));
  assert.equal(mesh.castShadow, false);
  assert.equal(mesh.receiveShadow, false);
  assert.equal(mesh.frustumCulled, false, "it rides on the lens");
  assert.equal(mesh.renderOrder, 0.5);
  // Its light stays under the bloom's threshold (0.85 luma): the mirror's and the glitter's knees.
  assert.ok(SEA.knee + SEA.glitter.knee < 0.85);
  assert.ok(SEA.surf.albedo <= 0.5 && FALLS.albedo <= 0.5);
  // The white water about the stacks and where the falls land.
  assert.ok(fragment.includes(stacksSurfGlsl()));
  assert.equal(material.uniforms.seaFalls.value.w, 0);
  const plunge = createSea({ lib, clock, rendering: rendering(), plunge: [80, 82, 8] });
  assert.deepEqual({ ...plunge.material.uniforms.seaFalls.value }, { x: 80, y: 82, z: 8, w: 1 });
  plunge.dispose();
  sea.dispose();
});

test("the sea reads the scene's lights and environment each draw, as the standard materials take them", () => {
  const view = rendering(),
    { mesh, material } = createSea({ lib, clock: dripClock({ value: 0 }), rendering: view });
  const light = (color, intensity, position) => {
    const l = new Group();
    l.color = new Color(color);
    l.intensity = intensity;
    l.position.copy(position);
    l.target = new Group();
    l.updateMatrixWorld();
    l.target.updateMatrixWorld();
    return l;
  };
  view.lights = {
    sun: light(0xffffff, 2, new Vector3(0, 10, 0)),
    fill: light(0x8080ff, 0.5, new Vector3(10, 0, 0)),
    ambient: { color: new Color(0x404040), intensity: 0.25 },
    hemisphere: { color: new Color(0xffffff), groundColor: new Color(0x000000), intensity: 0.6 },
  };
  view.homeScene.environment = { isTexture: true };
  mesh.onBeforeRender();
  const u = material.uniforms;
  assert.deepEqual(u.seaKey.value.toArray(), [0, 1, 0]);
  assert.deepEqual(u.seaKeyColor.value.toArray(), [2, 2, 2]);
  assert.deepEqual(u.seaFill.value.toArray(), [1, 0, 0]);
  assert.ok(Math.abs(u.seaFillColor.value.z - 0.5) < 1e-9);
  assert.ok(Math.abs(u.seaAmbient.value.x - new Color(0x404040).r * 0.25) < 1e-9);
  assert.deepEqual(u.seaHemiSky.value.toArray(), [0.6, 0.6, 0.6]);
  assert.deepEqual(u.seaHemiGround.value.toArray(), [0, 0, 0]);
  assert.equal(material.envMap, view.homeScene.environment);
  assert.equal(u.envMap.value, view.homeScene.environment);
  // The balanced tier draws no lace in the foam.
  view.tier = "balanced";
  mesh.onBeforeRender();
  assert.equal(u.seaLace.value, 0);
  material.dispose();
});

test("the cliffs cover the terrain's drop with their shelf, fall below the sea, and carry the stacks", () => {
  const height = () => 1.25,
    geometry = cliffGeometry(height),
    p = geometry.attributes.position,
    a = geometry.attributes.aCliff;
  assert.equal(a.itemSize, 3);
  let inner = Infinity,
    foot = Infinity;
  for (let i = 0; i < p.count; i++) {
    const [x, y, z] = [p.getX(i), p.getY(i), p.getZ(i)],
      [v, off] = [a.getY(i), a.getZ(i)];
    assert.ok(Number.isFinite(x + y + z));
    if (v === 0) inner = Math.min(inner, off);
    foot = Math.min(foot, y);
    // The shelf lies just over the plain; nothing stands far above it.
    assert.ok(y < 1.25 + CLIFF.lip[1] + 0.2, `${y} at ${x},${z}`);
  }
  assert.ok(inner <= -SHORE.shelf, "the shelf reaches over the whole drop");
  assert.ok(foot <= SEA.level - 3, "the face goes on under the sea");
  geometry.dispose();
  // The stacks stand out at sea clear of the cliffs' surf, under the bloom's light.
  const stacks = stackGeometry(),
    q = stacks.attributes.position;
  assert.equal(stacks.attributes.aCliff.itemSize, 3);
  // Every stack carries the stacks' mark (2), so the cliffs' material darkens it with spray.
  for (let i = 0; i < stacks.attributes.aCliff.count; i += 97)
    assert.equal(stacks.attributes.aCliff.getY(i), 2);
  assert.ok(STACKS.wet > 0 && STACKS.wet < 1);
  for (const [s, out, height, half, stretch] of STACKS.list) {
    assert.ok(out - half * stretch > SEA.surf.reach + 6, `a stack at ${s} crowds the cliffs`);
    // A stack is a remnant of the plateau: its cap no higher than about the plain.
    if (stretch <= 2)
      assert.ok(height <= -SEA.level + 1.5, `a stack at ${s} stands over the plain`);
  }
  let top = -Infinity;
  for (let i = 0; i < q.count; i++) {
    top = Math.max(top, q.getY(i));
    assert.ok(coastDistance(q.getX(i), q.getZ(i)) < -SEA.surf.reach, "every stack is out at sea");
  }
  assert.ok(top < SEA.level + 25);
  stacks.dispose();
  // One material for both: the stacks ride on the cliff's mesh, and go with it.
  const cliff = createCliff({
      lib,
      clock: dripClock({ value: 0 }),
      rendering: rendering(),
      height,
    }),
    [child] = cliff.mesh.children;
  assert.equal(child.name, "estate-stacks");
  assert.equal(child.material, cliff.material);
  assert.ok(cliff.material.fragmentShader.includes(`alb*=mix(1.,${STACKS.wet},step(1.5,vC.y));`));
  assert.equal(cliff.material.uniforms.cliffRiver.value.w, 0, "no falls without a drop");
  let freed = 0;
  cliff.mesh.geometry.addEventListener("dispose", () => freed++);
  child.geometry.addEventListener("dispose", () => freed++);
  cliff.dispose();
  assert.equal(freed, 2);
});

test("the river pours off the cliffs where it meets the fault, into white water at their foot", () => {
  const drop = riverFalls(RIVER_LINE);
  assert.ok(drop, "the river reaches the fault");
  const [x, z, half] = drop.lip;
  assert.ok(Math.abs(coastDistance(x, z)) < 0.05, "its lip is on the fault");
  assert.ok(Math.abs(drop.along - faultAlong(x, z)) < 1e-9);
  // It runs out to sea, its width the river's there.
  assert.ok(
    drop.heading[0] * Math.cos(Math.PI / 3) + drop.heading[1] * Math.sin(Math.PI / 3) > 0.8,
  );
  assert.ok(half > 2 && half < 6);
  const height = () => 1.25,
    { geometry, plunge } = fallsGeometry(drop, height),
    p = geometry.attributes.position,
    f = geometry.attributes.aFall;
  let low = Infinity,
    high = -Infinity;
  for (let i = 0; i < p.count; i++) {
    low = Math.min(low, p.getY(i));
    high = Math.max(high, p.getY(i));
    assert.ok(f.getY(i) >= 0 && f.getY(i) <= 2);
  }
  assert.ok(low <= SEA.level, "the sheet reaches the sea");
  assert.ok(high <= 1.25 + FALLS.lift + 1e-6, "and starts on the shelf");
  assert.ok(coastDistance(plunge[0], plunge[1]) < 0, "it lands out at sea");
  assert.ok(Math.hypot(plunge[0] - x, plunge[1] - z) < 8, "at the cliffs' foot");
  assert.equal(plunge[2], half * FALLS.plunge);
  geometry.dispose();
  // The falls, and the cliffs' slot and shelf water for them.
  const clock = dripClock({ value: 0 }),
    falls = createFalls({ lib, clock, rendering: rendering(), drop, height }),
    cliff = createCliff({ lib, clock, rendering: rendering(), height, drop });
  assert.deepEqual(falls.plunge, plunge);
  assert.equal(falls.material.side, 2, "seen from either side");
  assert.equal(cliff.material.uniforms.cliffRiver.value.w, half);
  assert.ok(falls.material.fragmentShader.includes(`gl_FragColor=vec4(c,${DEPTH_LAYER.ground});`));
  falls.dispose();
  cliff.dispose();
});

test("the slate's shore edits: the walk's view from up high fades the land's far edge, but not at the cliffs", () => {
  const edits = slateShoreEdits(HIGH_VIEW.fade);
  assert.equal(edits.length, 2);
  for (const [stage] of edits) assert.equal(stage, "fragmentShader");
  assert.ok(edits[0][2].includes("uniform float slateHigh;"));
  assert.ok(edits[0][2].includes(coastGlsl()));
  assert.ok(edits[1][2].includes("slateHigh*smoothstep(80.0, 188.0, length(vMudWorld.xz))"));
  assert.ok(edits[1][2].includes("smoothstep(30.0, 70.0, seaCoast(vMudWorld.xz))"));
  assert.ok(edits[1][2].includes(`earthAir *= 1.0+slateHigh*${SEA_SHARED.edgeLift};`));
  assert.deepEqual(HIGH_VIEW.fade, [80, 188]);
});

test("the sea, the cliffs and the falls land with the film terrain, sink the ranges past the fault, and go with it", async () => {
  const scene = new Scene(),
    root = new Group(),
    ground = new Mesh(new BoxGeometry(), new MeshStandardMaterial());
  scene.add(root);
  root.add(ground);
  const film = createFilmScene({
    ground,
    groundHeight: () => 0,
    loadTerrain: () => import("../src/scene/terrain-build.js"),
    skyMaterial: { uniforms: { sunColor: { value: new Color() } } },
    rendering: { setFilmTreatment() {}, homeScene: scene, lights: {} },
    atmosphere: { setFilmTreatment() {} },
    invalidate() {},
  });
  film.setActive(true);
  const height = await film.ready;
  assert.equal(height.shore, coastDistance, "the walk's edge");
  const names = root.children.map((child) => child.name);
  for (const name of ["estate-sea", "estate-cliff", "estate-falls"])
    assert.ok(names.includes(name), `${name} in ${names}`);
  assert.deepEqual(
    [SEA_SINK.value.x, SEA_SINK.value.y, SEA_SINK.value.z, SEA_SINK.value.w],
    [...coastPlane(), 1],
  );
  film.dispose();
  for (const name of ["estate-sea", "estate-cliff", "estate-falls"])
    assert.ok(!root.children.some((child) => child.name === name), `${name} stays`);
  assert.equal(SEA_SINK.value.w, 0, "the ranges stand again");
  ground.material.dispose();
});

test("the ranges sink past the fault in both mountain programs, off until the sea lands", () => {
  const silhouette = flat(source("src/scene/hill-silhouette.js"));
  assert.equal(SEA_SINK.value.w, 0);
  assert.ok(
    silhouette.includes(
      "w.y-=uSea.w*smoothstep(0.,60.,dot(w.xz,uSea.xy)-uSea.z)*(w.y-modelMatrix[3].y+40.);",
    ),
  );
  assert.equal(silhouette.match(/uSea: SEA_SINK|uniforms\.uSea = SEA_SINK/g)?.length, 2);
  assert.equal(silhouette.match(/\$\{SINK_GLSL\}/g)?.length, 2);
  // The sea's module is the terrain chunk's own (terrain-build.js imports it), and imports
  // nothing first-party: what it shares with the entry is restated or lent.
  const imports = (path) =>
    [...flat(source(path)).matchAll(/import [^;]*? from "([^"]+)";/g)].map((match) => match[1]);
  assert.ok(imports("src/scene/terrain-build.js").includes("./ocean.js"));
  assert.deepEqual(imports("src/scene/ocean.js"), ["three"]);
});

test("the sea, the cliffs and the falls link with the slate's root shading and land only with it, unseen", async () => {
  const queue = [],
    previous = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = (task) => queue.push(task);
  const step = async (count = 1) => {
    for (let i = 0; i < count; i++) {
      for (const task of queue.splice(0)) task(performance.now());
      await new Promise((resolve) => setImmediate(resolve));
    }
  };
  try {
    const terrain = createEarthGeometry(() => 0),
      material = new MeshStandardMaterial();
    configureGroundShading(material, true, { detail: { isTexture: true } });
    const root = new Group(),
      ground = new Mesh(terrain, material);
    root.add(ground);
    // A renderer that links in parallel, its programs ready at once; it records each batch.
    const batches = [],
      cache = new WeakMap(),
      renderer = {
        domElement: { parentNode: { classList: { contains: (name) => name === "is-ready" } } },
        extensions: { has: (name) => name === "KHR_parallel_shader_compile" },
        getContext: () => ({ isContextLost: () => false }),
        properties: {
          get(m) {
            if (!cache.has(m)) cache.set(m, {});
            return cache.get(m);
          },
        },
        shadowMap: { enabled: false },
        getRenderTarget: () => null,
        setRenderTarget() {},
        compile(objects) {
          const materials = new Set(),
            names = [];
          objects.traverse((object) => {
            if (!object.material) return;
            names.push(object.name);
            materials.add(object.material);
            renderer.properties.get(object.material).currentProgram = { isReady: () => true };
          });
          batches.push(names);
          return materials;
        },
      };
    const rendering = {
        renderer,
        compilePrograms,
        homeScene: new Scene(),
        lights: {},
        camera: { isCamera: true },
        composer: { readBuffer: { isRenderTarget: true } },
      },
      tour = { running: true, transition: { cut: false } };
    const landed = () =>
      ["estate-sea", "estate-cliff", "estate-falls"].filter((name) =>
        root.children.some((child) => child.name === name),
      );
    settleRoots(
      terrain,
      ground,
      rendering,
      () => 0,
      () => {},
      tour,
      lib,
    );
    // One batch: the slate's stand-in beside the sea, the cliffs (with their stacks) and the falls.
    assert.equal(batches.length, 1);
    for (const name of ["estate-sea", "estate-cliff", "estate-stacks", "estate-falls"])
      assert.ok(batches[0].includes(name), `${name} in ${batches[0]}`);
    await step(3);
    assert.deepEqual(landed(), [], "linked, but nothing lands mid-shot");
    assert.equal(SEA_SINK.value.w, 0, "the ranges stand");
    assert.equal(material.userData.slateRoot, undefined);
    tour.transition.cut = true;
    await step(2);
    assert.deepEqual(
      landed(),
      ["estate-sea", "estate-cliff", "estate-falls"],
      "on the cut, with the slate",
    );
    assert.equal(material.userData.slateRoot, shadeSlateGround);
    assert.equal(SEA_SINK.value.w, 1);
    terrain.dispose();
    assert.deepEqual(landed(), []);
    assert.equal(SEA_SINK.value.w, 0);
    material.dispose();
  } finally {
    if (previous) globalThis.requestAnimationFrame = previous;
    else delete globalThis.requestAnimationFrame;
  }
});
