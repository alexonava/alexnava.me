// The ground: its scattered rocks, its shading and the slate's detail maps.

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Box3, Vector3 } from "three";
import { ESTATE, estatePathDistance, estatePoint } from "../src/scene/estate-layout.js";
import {
  createRockScatter,
  estateContacts,
  PEBBLE_UNDER,
  ROCK_CLUSTERS,
  ROCK_LIB,
  rockKeepouts,
} from "../src/scene/rock-scatter.js";
import {
  createRocks,
  createRockLayout,
  rockClear,
  rockFootprints,
  writeRockContacts,
} from "../src/scene/rock-build.js";
import { SLATE_CONTACTS } from "../src/scene/mud-ground.js";
import { TERRAIN_HORIZON } from "../src/scene/hill-silhouette.js";
import { createStoneDetailController } from "../src/scene/stone-detail.js";

const flat = () => 0;

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test("rock placement is seeded, clear of the estate and every directed shot, and adds one pebble per tall rock", () => {
  const a = rockFootprints(ROCK_LIB),
    b = rockFootprints(ROCK_LIB);
  assert.deepEqual(a, b);
  const tall = ROCK_CLUSTERS.filter(([, , , , , height]) => height >= PEBBLE_UNDER).length;
  const pebbles = a.filter((rock) => rock.pebble);
  assert.equal(a.length - pebbles.length, ROCK_CLUSTERS.length);
  assert.ok(pebbles.length >= tall - 1 && pebbles.length <= tall, `${pebbles.length} pebbles`);
  for (const rock of a) {
    // Generated pebbles pass every keep-out; the authored clusters clear the
    // tower and tree (the lantern stones are placed at the lantern's foot).
    if (rock.pebble) assert.ok(rockClear(ROCK_LIB, rock.x, rock.z, rock.radius), rock.id);
    else if (!rock.lanternStone) {
      assert.ok(
        Math.hypot(rock.x - ESTATE.tower.x, rock.z - ESTATE.tower.z) >
          ESTATE.tower.clear + rock.radius,
        rock.id,
      );
      assert.ok(
        Math.hypot(rock.x - ESTATE.tree.x, rock.z - ESTATE.tree.z) >
          ESTATE.tree.clear + rock.radius,
        rock.id,
      );
      assert.ok(estatePathDistance(rock.x, rock.z) > ESTATE.path.clear + rock.radius, rock.id);
    }
    for (const other of a) {
      if (other !== rock)
        assert.ok(
          Math.hypot(rock.x - other.x, rock.z - other.z) > 0.5 * (rock.radius + other.radius),
          `${rock.id}/${other.id}`,
        );
    }
  }
  // The growth keep-outs cover every rock and pebble the placement makes.
  const keepouts = rockKeepouts();
  for (const rock of a)
    assert.ok(
      keepouts.some(
        (zone) =>
          Math.hypot(rock.x - zone.x, rock.z - zone.z) + (rock.pebble ? 0 : rock.radius) <=
          zone.radius + 1e-9,
      ),
      rock.id,
    );
  // A point between a directed shot's camera and its subject is refused.
  const portrait = ROCK_LIB.DIRECTED_SHOTS.tree.find((shot) => shot.name === "Portrait");
  const inWedge = estatePoint("tree", portrait.azimuth, 30);
  assert.equal(rockClear(ROCK_LIB, inWedge.x, inWedge.z, 0.5), false);
});

test("rocks sit on the terrain and fill the ground's contact slots after the tree and lantern", () => {
  const slope = (x, z) => 0.1 * x - 0.05 * z;
  const layout = createRockLayout(ROCK_LIB, { groundHeight: slope });
  assert.equal(layout.length, rockFootprints(ROCK_LIB).length);
  for (const rock of layout) {
    assert.ok(rock.y <= slope(rock.x, rock.z), `${rock.id} is buried at its base`);
    assert.ok(rock.y > slope(rock.x, rock.z) - rock.height, `${rock.id} is not swallowed`);
    assert.ok(rock.matrix.elements.every(Number.isFinite));
  }
  const contacts = estateContacts();
  assert.equal(contacts.length, SLATE_CONTACTS * 4);
  assert.deepEqual(
    [...contacts.slice(0, 2)],
    [Math.fround(ESTATE.tree.x), Math.fround(ESTATE.tree.z)],
  );
  assert.ok(
    contacts.slice(8).every((value) => value === 0),
    "rock slots stay empty until the rocks load",
  );
  writeRockContacts(contacts, layout);
  const filled = layout.filter((rock) => rock.height >= 0.3).length;
  assert.ok(contacts[8 + 4 * (Math.min(filled, SLATE_CONTACTS - 2) - 1) + 3] > 0);
  assert.equal(contacts[3], Math.fround(0.22), "the tree contact is kept");
});

function fakeAsset() {
  const scene = new Group();
  scene.add(new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial()));
  return scene;
}

test("the rock scatter waits for the reveal, film, tree and tier, loads its chunk once and commits on a cut", async () => {
  const statuses = [];
  let loads = 0;
  const load = async () => {
    loads++;
    return { createRocks };
  };
  const parent = new Group();
  const loadAsset = async () => ({ scene: fakeAsset() });
  // The low tier (the static title card) never fetches the chunk.
  for (const options of [{ tier: "low" }]) {
    const idle = createRockScatter({ ...options, parent, groundHeight: flat, load, loadAsset });
    idle.setFilmActive(true);
    idle.setTreeStatus("ready");
    idle.setRevealed();
    await tick();
    assert.equal(loads, 0);
    idle.dispose();
  }
  const contacts = estateContacts();
  const rocks = createRockScatter({
    tier: "balanced",
    parent,
    groundHeight: flat,
    load,
    loadAsset,
    contacts,
    compile: () => true,
    onStatus: (status) => statuses.push(status.status),
  });
  rocks.setFilmActive(true);
  await tick();
  assert.equal(loads, 0, "the tree channel has not settled");
  rocks.setTreeStatus("loading");
  rocks.setTreeStatus("fallback");
  rocks.setTreeStatus("ready");
  await tick();
  assert.equal(loads, 0, "nothing loads before the reveal");
  rocks.setRevealed();
  for (let i = 0; i < 4; i++) await tick();
  assert.equal(loads, 1);
  const root = parent.getObjectByName("film-rocks");
  assert.equal(root.children.length, 2, "one instanced mesh per stone");
  assert.ok(root.children.every((mesh) => mesh.count === 0 && mesh.castShadow === false));
  assert.equal(root.visible, false);
  assert.ok(contacts[8 + 3] > 0, "rock contacts are written before they show");
  // The link is queued, then the instances land on a tour cut.
  assert.equal(
    rocks.take({ cut: false, running: true, nowMs: 0 }),
    false,
    "queued, not yet linked",
  );
  await tick();
  assert.equal(
    rocks.take({ cut: false, running: true, nowMs: 16 }),
    false,
    "linked, waiting for a cut",
  );
  assert.equal(root.visible, false);
  assert.equal(rocks.take({ cut: true, running: true, nowMs: 32 }), true);
  assert.equal(rocks.committed, true);
  assert.equal(root.visible, true);
  assert.ok(
    root.children.every((mesh) => mesh.count === mesh.instanceMatrix.count && mesh.count > 0),
  );
  assert.deepEqual(statuses, ["loading", "ready"]);
  rocks.setFilmActive(false);
  assert.equal(root.visible, false);
  assert.equal(rocks.dispose(), true);
  assert.equal(rocks.dispose(), false);
  assert.equal(root.parent, null);
});

test("the rock scatter waits for the film terrain and seats the rocks on its root-aware height", async () => {
  const fake = { setFilmActive() {}, take: () => false, dispose() {} };
  for (const [terrainHeight, expected] of [
    [(x, z) => x + z, "terrain"],
    [undefined, "analytic"],
  ]) {
    let seen = null,
      release;
    const rocks = createRockScatter({
      tier: "high",
      parent: new Group(),
      groundHeight: flat,
      load: async () => ({ createRocks: (lib, options) => ((seen = options.groundHeight), fake) }),
      terrain: () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    });
    rocks.setFilmActive(true);
    rocks.setTreeStatus("ready");
    rocks.setRevealed();
    for (let i = 0; i < 4; i++) await tick();
    assert.equal(seen, null, "no rocks before the film terrain settles");
    // The earth comparison's film has no root supports: the analytic ground.
    release(terrainHeight);
    for (let i = 0; i < 4; i++) await tick();
    assert.equal(seen, expected === "terrain" ? terrainHeight : flat, expected);
    rocks.dispose();
  }
});

test("a failed stone leaves no rocks and reports a fallback", async () => {
  const statuses = [];
  const parent = new Group();
  const rocks = createRocks(ROCK_LIB, {
    parent,
    groundHeight: flat,
    tier: "high",
    loadAsset: async (url, { role }) => {
      if (role === "weathered-stone") throw new Error("404");
      return { scene: fakeAsset() };
    },
    urls: { high: { "lichen-rock": "/a.glb", "weathered-stone": "/b.glb" } },
    onStatus: (status) => statuses.push(status.status),
  });
  for (let i = 0; i < 4; i++) await tick();
  assert.deepEqual(statuses, ["fallback"]);
  assert.equal(parent.getObjectByName("film-rocks").children.length, 0);
  assert.equal(rocks.take({ cut: true }), false);
  rocks.dispose();
});

const size = (o) => new Box3().setFromObject(o).getSize(new Vector3());

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

const flush = () => new Promise((resolve) => setImmediate(resolve));

// A two-map fixture set; the controller itself names no maps.
const fixtureUrl = (kind, size) => `/images/materials/stone-${kind}-${size}.webp`;

function harness({
  tier = "high",
  disabled = false,
  failApply = false,
  kinds = ["color", "roughness"],
  urlFor = fixtureUrl,
} = {}) {
  const requests = [],
    applied = [],
    resets = [],
    statuses = [];
  const controller = createStoneDetailController({
    profile: { tier },
    disabled,
    kinds,
    urlFor,
    apply(sources) {
      applied.push(sources);
      if (failApply) throw new Error("canvas upload failed");
    },
    reset(options) {
      resets.push(options);
    },
    report(status) {
      statuses.push(status);
    },
    loadImage(url, { signal }) {
      let resolve, reject;
      const promise = new Promise((yes, no) => {
        resolve = yes;
        reject = no;
      });
      requests.push({ url, signal, resolve, reject });
      return promise;
    },
  });
  function image(size = 1024) {
    return {
      width: size,
      height: size,
      closed: 0,
      close() {
        this.closed += 1;
      },
    };
  }
  return { controller, requests, applied, resets, statuses, image };
}

test("stone detail makes no requests for low tier or explicit procedural comparison", () => {
  for (const options of [{ tier: "low" }, { tier: "high", disabled: true }, { tier: "unknown" }]) {
    const h = harness(options);
    assert.equal(h.requests.length, 0);
    assert.equal(h.statuses.at(-1).status, "procedural");
    h.controller.dispose();
  }
});

test("stone detail applies the matched color and roughness pair atomically and releases decoded images", async () => {
  const h = harness();
  const color = h.image(),
    roughness = h.image();
  assert.deepEqual(
    h.requests.map((r) => r.url),
    ["/images/materials/stone-color-1024.webp", "/images/materials/stone-roughness-1024.webp"],
  );
  h.requests[0].resolve(color);
  await flush();
  assert.equal(h.applied.length, 0);
  h.requests[1].resolve(roughness);
  await flush();
  assert.equal(h.applied.length, 1);
  assert.equal(h.applied[0].color, color);
  assert.equal(h.applied[0].roughness, roughness);
  assert.equal(color.closed, 1);
  assert.equal(roughness.closed, 1);
  assert.equal(h.statuses.at(-1).status, "ready");
  assert.equal(h.controller.applyQuality({ tier: "high" }), false);
  assert.equal(h.requests.length, 2);
  h.controller.dispose();
  assert.deepEqual(h.resets, [{ disposing: true }]);
});

test("failed companion map keeps the procedural surface and closes the decoded image", async () => {
  const h = harness();
  const color = h.image();
  h.requests[0].resolve(color);
  h.requests[1].reject(new Error("404"));
  await flush();
  assert.equal(h.requests[0].signal.aborted, true);
  assert.equal(h.applied.length, 0);
  assert.equal(h.resets.length, 0);
  assert.equal(color.closed, 1);
  assert.equal(h.statuses.at(-1).status, "fallback");
  h.controller.dispose();
});

test("wrong image dimensions fail safely and a canvas failure restores procedural painting", async () => {
  for (const failApply of [false, true]) {
    const h = harness({ failApply });
    const images = [h.image(failApply ? 1024 : 256), h.image()];
    images.forEach((image, i) => h.requests[i].resolve(image));
    await flush();
    assert.equal(h.statuses.at(-1).status, "fallback");
    assert.equal(h.applied.length, failApply ? 1 : 0);
    assert.equal(h.resets.length, failApply ? 1 : 0);
    assert.ok(images.every((image) => image.closed === 1));
    h.controller.dispose();
  }
});

test("quality downgrade cancels high assets, ignores late completion, and selects the balanced pair", async () => {
  const h = harness();
  h.controller.applyQuality({ tier: "balanced" });
  assert.ok(h.requests.slice(0, 2).every((r) => r.signal.aborted));
  assert.ok(h.requests.slice(2).every((r) => r.url.endsWith("-512.webp")));
  const stale = [h.image(), h.image()];
  stale.forEach((image, i) => h.requests[i].resolve(image));
  await flush();
  assert.equal(h.applied.length, 0);
  assert.ok(stale.every((image) => image.closed === 1));
  h.requests.slice(2).forEach((request) => request.resolve(h.image(512)));
  await flush();
  assert.equal(h.applied.length, 1);
  assert.equal(h.applied[0].tier, "balanced");
  h.controller.applyQuality({ tier: "low" });
  assert.deepEqual(h.resets, [{ disposing: false }]);
  assert.equal(h.statuses.at(-1).status, "procedural");
  assert.equal(h.requests.length, 4);
  h.controller.dispose();
});

test("a pinned asset tier keeps the loaded pair through adaptive profile changes", async () => {
  const h = harness();
  h.requests.forEach((request) => request.resolve(h.image()));
  await flush();
  assert.equal(h.applied.length, 1);
  for (const tier of ["balanced", "low", "high"]) {
    assert.equal(h.controller.applyQuality({ tier }, { pixelRatio: 1, assetTier: "high" }), false);
  }
  assert.equal(h.requests.length, 2, "no other map size is fetched");
  assert.deepEqual(h.resets, [], "the authored surface is never reset");
  assert.equal(h.statuses.at(-1).status, "ready");
  // Without a pinned tier, an explicit tier change still selects the other pair.
  h.controller.applyQuality({ tier: "balanced" });
  assert.equal(h.requests.length, 4);
  assert.ok(h.requests.slice(2).every((r) => r.url.endsWith("-512.webp")));
  h.controller.dispose();
});

test("disposing an in-flight layer prevents late canvas mutation and closes both images", async () => {
  const h = harness();
  assert.equal(h.controller.dispose(), true);
  assert.equal(h.controller.dispose(), false);
  assert.equal(h.controller.applyQuality({ tier: "balanced" }), false);
  assert.ok(h.requests.every((r) => r.signal.aborted));
  const images = [h.image(), h.image()];
  images.forEach((image, i) => h.requests[i].resolve(image));
  await flush();
  assert.equal(h.applied.length, 0);
  assert.equal(h.resets.length, 0);
  assert.ok(images.every((image) => image.closed === 1));
});
