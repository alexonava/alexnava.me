// The ground: its scattered rocks, its shading and the slate's detail maps.

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Box3, Vector3 } from "three";
import { ESTATE, estatePathDistance, estatePoint } from "../src/scene/estate-layout.js";
import { DIRECTED_SHOTS } from "../src/scene/directed-shots.js";
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
import {
  configureGroundShading,
  createSlateContacts,
  SLATE_CONTACTS,
  slateCalmFor,
} from "../src/scene/mud-ground.js";
import {
  createHillSilhouette,
  HORIZON_AIR,
  HORIZON_HAZE,
  RANGE_MIST,
  TERRAIN_EDGE,
  TERRAIN_HORIZON,
} from "../src/scene/hill-silhouette.js";
import { EARTH } from "../src/scene/filmic-earth.js";
import { flat as flatCode } from "./support/code.mjs";
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
  // Every rock 0.3 or taller has a slot of its own after the tree and lantern.
  assert.ok(filled <= SLATE_CONTACTS - 2, `${filled} rocks for ${SLATE_CONTACTS - 2} slots`);
  assert.ok(contacts[8 + 4 * (filled - 1) + 3] > 0);
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
  assert.ok(root.children.every((mesh) => mesh.count === 0));
  // Balanced draws the moon's shadow map too: its rocks cast into it and take the tree's.
  assert.ok(root.children.every((mesh) => mesh.castShadow && mesh.receiveShadow));
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
  "#include <lights_physical_pars_fragment>",
  "#include <map_fragment>",
  "#include <roughnessmap_fragment>",
  "#include <normal_fragment_maps>",
  "#include <lights_fragment_begin>",
  "#include <lights_fragment_maps>",
  "#include <lights_fragment_end>",
  "#include <fog_fragment>",
].join("\n");

test("the pond's water lies only below its shore, as the terrain carves it, and the close soil comes with its maps", async () => {
  const { configureGroundShading, SLATE_POND, SLATE_CLOSE, SLATE_PUDDLES, pondShape } =
    await import("../src/scene/mud-ground.js");
  const { POND, PUDDLE_ZONES, pondShapeAt, pondRadius } =
    await import("../src/scene/terrain-build.js");
  // The shader's pond and the terrain's agree: the same footprint, wobble, depth, bank and water.
  for (const key of ["wobble", "depth", "rise", "level", "reach"])
    assert.deepEqual(SLATE_POND[key], POND[key], key);
  const zone = SLATE_PUDDLES.zones[0],
    centre = estatePoint(zone.anchor, zone.deg, zone.dist);
  assert.ok(Math.hypot(centre.x - PUDDLE_ZONES[0].x, centre.z - PUDDLE_ZONES[0].z) < 1e-9);
  assert.ok(Math.abs(pondRadius(PUDDLE_ZONES[0].x, PUDDLE_ZONES[0].z)) < 1e-9);
  // Below the water inside its shore, level with it on the shore, above it on the bank.
  for (const r of [0, 0.3, 0.6, 0.9, 1, 1.2, 1.5, 2, 3]) {
    assert.equal(pondShape(r), pondShapeAt(r));
    assert.ok(r < 1 ? pondShape(r) < 0 : pondShape(r) >= 0, `${r}`);
  }
  assert.equal(pondShape(0), -SLATE_POND.depth);
  assert.ok(pondShape(3) < SLATE_POND.rise);
  // The shore and the shape in the shader are the JS shape's.
  const material = new MeshStandardMaterial();
  const compile = (maps) => {
    configureGroundShading(material, true, { detail: { isTexture: true }, ...maps });
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
  const plain = compile({});
  assert.ok(
    plain.fragment.includes(
      `float slatePondShape(float r){return r<1.?-${SLATE_POND.depth}*(1.-r*r):`,
    ),
  );
  assert.ok(
    plain.fragment.includes(
      "float slateLanternPuddle = slatePuddle*(1.0-smoothstep(1.0, 1.4, slatePondR(vMudWorld.xz)));",
    ),
  );
  assert.doesNotMatch(plain.fragment, /slateGrit|slateRelief/, "no close soil without its maps");
  assert.ok(!plain.key.includes("+soil"));
  // With its grit and relief maps the close soil fades in near the lens, and its relief fades
  // where a texel shrinks under a pixel and under water.
  const grit = { isTexture: true },
    relief = { isTexture: true };
  const soil = compile({ grit, relief });
  assert.ok(soil.key.includes("+soil"));
  assert.equal(soil.uniforms.slateGrit.value, grit);
  assert.equal(soil.uniforms.slateRelief.value, relief);
  assert.ok(soil.fragment.includes("uniform sampler2D slateGrit, slateRelief;"));
  assert.ok(
    soil.fragment.includes(
      `slateCN = 1.-smoothstep(${SLATE_CLOSE.near.map((v) => v.toFixed(1)).join(",")}, length(vViewPosition));`,
    ),
  );
  assert.ok(
    soil.fragment.includes(`diffuseColor.rgb *= 1.+(slateCG-.5)*${SLATE_CLOSE.albedo}*slateCN;`),
  );
  assert.ok(soil.fragment.includes("*(1.-slatePuddle);"));
  assert.match(
    soil.fragment,
    /slateDH = vec2\(dFdx\(slateCH\), dFdy\(slateCH\)\)\*[\d.]+\*slateCF;/,
  );
  // Near the lens the slate's blotches give way to its blurred tone.
  assert.ok(soil.fragment.includes(`texture2D(map, vMapUv, ${SLATE_CLOSE.blur}.0)`));
  assert.ok(SLATE_CLOSE.calm > 0 && SLATE_CLOSE.calm < 1);
  // Crumbs: a cellular noise on the close soil's relief and grit, worked out
  // only where they show (near the lens, a cell over a few pixels).
  assert.match(soil.fragment, /if \(slateKW > 0\.\) \{\s*for \(int j = -1; j <= 1; j\+\+\)/);
  assert.ok(soil.fragment.includes(`slateCH += slateCrumb*${SLATE_CLOSE.crumb.height}*slateKW;`));
  assert.doesNotMatch(soil.fragment, /slateKO = fract\(sin/);
  // The rain streams fill like the puddles, in the detail map's low texels.
  assert.ok(soil.fragment.includes("float slateStreams(vec2 p)"));
  assert.ok(soil.fragment.includes("max(max("));
});

test("each ground shading has its own program cache key; the slate's shading needs film", async () => {
  const {
    configureGroundShading,
    createSlateContacts,
    SLATE_WET,
    SLATE_TILING,
    SLATE_PUDDLES,
    SLATE_CONTACTS,
    SLATE_LIGHT,
    SLATE_WATER,
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
  // The slate's far edge darkens toward the far plain's air, the shared slate
  // lifted by HORIZON_AIR.ground, and never lightens: slate already darker
  // than that air keeps its tone. Only a shot's look follows it: its clearing
  // and its mist, each off unless a shot asks for it.
  const horizon = TERRAIN_HORIZON.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    LUMA = "vec3\\(\\.2126,\\.7152,\\.0722\\)";
  assert.match(
    fragment,
    new RegExp(
      `vec3 earthAir = ${horizon}\\*${String(HORIZON_AIR.ground).replace(".", "\\.")};\\s*` +
        `earthHorizon \\*= smoothstep\\(1\\.0, 1\\.15, dot\\(gl_FragColor\\.rgb, ${LUMA}\\)/dot\\(earthAir, ${LUMA}\\)\\);\\s*` +
        `gl_FragColor\\.rgb = mix\\(gl_FragColor\\.rgb, earthAir, earthHorizon\\);\\s*#endif\\s*` +
        `if \\(slateClearShade\\.w > 0\\.\\) \\{[^}]*\\}\\s*if \\(slateMist\\.w > 0\\.\\) \\{[^}]*\\}\\s*gl_FragColor\\.a = 0\\.6667;`,
    ),
  );
  // Delay distance haze so the phone foreground retains texture; the outer
  // 190-unit square boundary still reaches the far plain's air.
  assert.match(
    fragment,
    /float earthHorizon = max\([^;]*,\s*smoothstep\(230\.0, 330\.0, vFogDepth\)\);/,
  );
  // The film specular clamp stays; the wet term only relaxes it, within the
  // brief's 1 + 1.6 bound; puddles take the existing moon and lantern glints.
  assert.match(fragment, /reflectedLight\.directSpecular \*= mix\(\.12, \.22, damp\);/);
  assert.match(
    fragment,
    /reflectedLight\.directSpecular \*= mix\(1\.0, 0\.45, slateMatte\)\*\(1\.0 \+ 1\.6\*slateWet\)\*\(1\.0 \+ 4\.0\*slatePuddle - 3\.2\*slateLanternPuddle\);/,
  );
  assert.match(fragment, /roughnessFactor = mix\(roughnessFactor, 0\.2, slateLanternPuddle\);/);
  // Up close the damp soil is matte (never the water): rougher, a thinner
  // film and smaller highlights within SLATE_WET.close.near of the lens.
  assert.match(
    fragment,
    /float slateMatte = \(1\.0-smoothstep\(6\.0,18\.0, length\(vViewPosition\)\)\)\*\(1\.0-slatePuddle\);/,
  );
  assert.match(
    fragment,
    /roughnessFactor = mix\(roughnessFactor, max\(roughnessFactor, 0\.8\), slateMatte\);/,
  );
  assert.match(fragment, /\*\(1\.0-0\.7\*slateMatte\);/);
  assert.match(
    fragment,
    /reflectedLight\.directSpecular \/= 1\.0 \+ 2\.5\*dot\(reflectedLight\.directSpecular,vec3\(\.2126,\.7152,\.0722\)\)\*slateLanternPuddle;/,
  );
  // The zone's explicit support prevents dark detail texels elsewhere from
  // receiving the lantern override; parentheses preserve the 1 - fade mask.
  assert.match(
    fragment,
    /float slateLanternPuddle = slatePuddle\*\(1\.0-smoothstep\(1\.0, 1\.4, slatePondR\(vMudWorld\.xz\)\)\);/,
  );
  assert.equal(SLATE_PUDDLES.lantern.specular, 0.8);
  assert.equal(SLATE_PUDDLES.lantern.roughness, 0.2);
  assert.ok(SLATE_WET.specular <= 1.6);
  // Just after rain: wet ground is glossy, not darker (it keeps the ground's
  // brightness), its own sky reflection is clamped less where wet, and a film
  // of water mirrors the night sky, fading with view distance, so the far
  // plain stays calm.
  assert.ok(SLATE_WET.darken <= 0.05 && SLATE_WET.roughnessWeight >= 0.9);
  // Never mirror-smooth: below 0.5 the crack walls near the lens glint behind
  // the name and intro in the lantern shots (the water's own lobes are bounded
  // by their knees instead).
  assert.ok(SLATE_WET.roughness >= 0.5);
  assert.match(fragment, /reflectedLight\.indirectSpecular \*= \.18;/);
  assert.equal(SLATE_WET.indirect[0], 0.18, "the dry clamp is the literal the roots anchor on");
  assert.ok(SLATE_WET.indirect[1] > SLATE_WET.indirect[0] && SLATE_WET.indirect[1] <= 1);
  assert.ok(
    fragment.includes(
      `reflectedLight.indirectSpecular *= mix(1.0, ${+(SLATE_WET.indirect[1] / SLATE_WET.indirect[0]).toFixed(4)}, slateWet*slateShow)*mix(1.0, ${SLATE_WET.close.sky}, slateMatte);`,
    ),
  );
  // The water: water's Fresnel (f0 .02) on a normal levelled by the water
  // (standing water: the world's up), the film's share of the wet ground or a
  // puddle whole, faded by view distance; a mirror never brighter than about
  // twice the sky as shown.
  assert.equal(SLATE_WATER.f0, 0.02);
  assert.ok(SLATE_WATER.far[0] >= 50 && SLATE_WATER.far[1] <= 140, "the far plain stays calm");
  assert.ok(SLATE_WATER.gain.every((gain) => gain >= 1 && gain <= 2));
  assert.ok(
    SLATE_WATER.film.every((share) => share >= 0) && SLATE_WATER.film[0] + SLATE_WATER.film[1] <= 1,
  );
  assert.ok(SLATE_WATER.roughness[1] < SLATE_WATER.roughness[0]);
  assert.match(
    fragment,
    /slateWaterN = normalize\(mix\(mix\(normal, nonPerturbedNormal, [\d.]+\), mat3\(viewMatrix\)\[1\], slatePuddle\)\+slateWaterTilt\);/,
  );
  assert.ok(
    fragment.indexOf("slateWaterN = normalize(") <
      fragment.indexOf("#include <lights_fragment_begin>"),
    "the water's normal and share are set before the lights",
  );
  // The water fades with view distance (SLATE_WATER.far, reaching further only
  // under a shot's gloss).
  assert.ok(
    fragment.includes(
      "*(1.0-slatePuddle)*(1.0-slateWaterFar(length(vViewPosition)))*(1.0-0.7*slateMatte);",
    ),
  );
  const [farNear, farFar] = SLATE_WATER.far.map((v) =>
    Number.isInteger(v) ? v.toFixed(1) : String(v),
  );
  assert.ok(
    fragment.includes(
      `float slateWaterFar(float d){return smoothstep(mix(${farNear},400.0,slateGlossT),mix(${farFar},1100.0,slateGlossT),d);}`,
    ),
  );
  assert.match(
    fragment,
    /vec3 slateWaterSky = mix\(getIBLRadiance\(geometryViewDir, slateWaterN, /,
  );
  assert.match(
    fragment,
    /vec3 slateWaterRefl = slateWaterSky\*\(0\.02\+0\.98\*pow\(1\.0-saturate\(dot\(slateWaterN, geometryViewDir\)\), 5\.0\)\)\*slateWaterCover\*slateSkyVis\*slateShow;/,
  );
  // The moon's and the lantern's lobes on the water film are bounded by their knees.
  for (const lobe of [SLATE_WATER.moon, SLATE_WATER.lamp]) {
    assert.ok(lobe.knee > 0 && lobe.knee <= 0.4 && lobe.roughness >= 0.15);
  }
  assert.ok(SLATE_WATER.moon.knee <= 0.08, "the moon's glints stay low behind the name and intro");
  // Like the light shafts' air, the water eases off behind the name and intro
  // (over half the screen's smaller side, the clouds' reach) and behind About
  // (a fifth), and there the soil's own highlights pass a knee: text stays at
  // 5:1 over the wet ground. The name's reach is wide, so the moon's glare on
  // the wet plain fades out along it instead of ending beside the name; the
  // small label's stays short, clear of the pond's image of the lantern.
  const [share, knee, reach, aboutReach] = SLATE_WATER.text;
  assert.ok(share > 0 && share < 1 && knee > 0 && knee <= 0.05);
  assert.ok(reach >= 0.4 && reach <= 0.6, "reach");
  assert.ok(aboutReach > 0 && aboutReach <= 0.25, "About's reach");
  assert.ok(
    fragment.includes(
      "float slateBehind(vec4 r,vec2 v,float d){vec2 f=max(max(r.xy-v,v-r.zw),0.)*vec2(slateAspect,1.)/min(slateAspect,1.);return 1.-smoothstep(0.,d,length(f));}",
    ),
  );
  assert.ok(
    fragment.includes(
      `float slateBehindAbout(vec2 v){return slateBehind(slateAbout,v,${aboutReach});}`,
    ),
  );
  assert.ok(
    fragment.includes(`return max(slateBehind(slateText,v,${reach}),slateBehindAbout(v));`),
  );
  assert.ok(fragment.includes(`#define SLATE_TEXT_KNEE ${knee}\n`));
  // The knee is blended in by 1-(1-b)^2 of the test's value b, never scaled
  // into its divisor, where a 0.035 knee crushed bright glare at the guard's
  // faint edge into a hard wall beside the name.
  assert.ok(
    fragment.includes(
      "vec3 slateTextKnee(vec3 c,float b){return c*mix(1.,1./(1.+dot(c,vec3(.2126,.7152,.0722))/SLATE_TEXT_KNEE),b*(2.-b));}",
    ),
  );
  assert.ok(fragment.indexOf("vec3 slateTextKnee(") > fragment.indexOf("#define SLATE_TEXT_KNEE "));
  assert.doesNotMatch(fragment, /\/=\s*1\.0\s*\+\s*slateBehind\*/);
  // So a glare's shown tone (display gamma) fades about evenly from the edge of
  // the reach to the text: no 1% of the screen's smaller side takes more than
  // 5% of the change (the knee scaled into its divisor put 16% of a bright
  // glare's into one such step, about 11 px at 1080).
  const smooth = (x) => Math.min(1, Math.max(0, x)) ** 2 * (3 - 2 * Math.min(1, Math.max(0, x)));
  for (const glare of [0.05, 0.2, 0.6, 1]) {
    const shown = [];
    for (let i = 0; i <= 600; i++) {
      const b = 1 - smooth(i / 1000 / reach),
        k = b * (2 - b);
      shown.push((glare * (1 - k + k / (1 + glare / knee))) ** (1 / 2.2));
    }
    const change = shown[600] - shown[0],
      steepest = Math.max(...shown.slice(1).map((value, i) => value - shown[i])) * 10;
    assert.ok(steepest <= 0.05 * change, `glare ${glare}: ${steepest} of ${change}`);
  }
  // After the water's glints and mirror, both the direct and the sky's
  // reflections pass the knee there.
  for (const term of ["directSpecular", "indirectSpecular"])
    assert.ok(
      fragment.indexOf(
        `reflectedLight.${term} = slateTextKnee(reflectedLight.${term}, slateBehind);`,
      ) > fragment.indexOf("reflectedLight.indirectSpecular += slateWaterRefl;"),
      term,
    );
  assert.match(
    fragment,
    /slateLampSpec \*= [\d.]+\*slateShow;\s*slateMoonSpec \*= [\d.]+\*slateShow;/,
  );
  // The night's light on the film ground: the key dominates, the unshadowed
  // fills and the flat ambient keep a share, the sky lights it; only with the
  // environment (night-environment.js), else the fills and ambient stay whole.
  assert.ok(SLATE_LIGHT.key >= 1 && SLATE_LIGHT.key <= 1.5);
  for (const share of [SLATE_LIGHT.fill, SLATE_LIGHT.crown, SLATE_LIGHT.ambient])
    assert.ok(share > 0 && share < 1);
  assert.ok(SLATE_LIGHT.bounce > 0 && SLATE_LIGHT.bounce <= 0.25);
  assert.match(
    fragment,
    /#include <lights_physical_pars_fragment>\s*bool slateDirectional = false;[\s\S]*vec3 slateWaterN[\s\S]*void RE_Direct_Moonlit\([\s\S]*#undef RE_Direct\n#define RE_Direct RE_Direct_Moonlit/,
  );
  // Three's light loops fetch each light through get*LightInfo(): wrapped (after
  // Three defines them), they mark a directional light, so the key and the fill
  // are found among those by direction, and the crown's point light, lined up
  // with either from some spot on the ground, keeps its own share there.
  assert.match(
    fragment,
    /#if NUM_DIR_LIGHTS > 0\s*void slateDirectionalInfo\(const in DirectionalLight light, out IncidentLight incident\) \{\s*getDirectionalLightInfo\(light, incident\);\s*slateDirectional = true;\s*\}\s*#define getDirectionalLightInfo slateDirectionalInfo\s*#endif/,
  );
  assert.match(
    fragment,
    /#if NUM_POINT_LIGHTS > 0\s*void slatePointInfo\(const in PointLight light, const in vec3 position, out IncidentLight incident\) \{\s*getPointLightInfo\(light, position, incident\);\s*slateDirectional = false;\s*\}\s*#define getPointLightInfo slatePointInfo\s*#endif/,
  );
  assert.match(
    fragment,
    /bool slateKey = slateDirectional && !slateWarm && dot\(directLight\.direction,/,
  );
  assert.match(
    fragment,
    /: slateDirectional && dot\(directLight\.direction, normalize\(mat3\(viewMatrix\)\*/,
  );
  assert.match(fragment, /#ifdef USE_ENVMAP\s*irradiance \*= [\d.]+;\s*iblIrradiance \*= [\d.]+;/);
  assert.ok(
    fragment.indexOf("if (!slateWarm) slateL.color *=") > fragment.indexOf("#ifdef USE_ENVMAP"),
  );
  assert.ok(
    fragment.indexOf("slateWet = ") > fragment.indexOf("float worn ="),
    "wetness follows the worn mask",
  );
  // Only the tower footing stays dry: the root area, the path and the lantern
  // clearing are wet.
  assert.match(fragment, /float slateDry = footingDry;/);
  assert.match(fragment, /float slateWet = clamp\([^;]*\)\*\(1\.0-slateDry\);/);
  // The puddles fill fuller, Portrait's foreground puddle among them; the
  // pond (zones[0]) takes its own level from its shape beside theirs.
  assert.equal(SLATE_PUDDLES.zones.length, 4);
  assert.match(
    fragment,
    /\*\(0\.62\+\.4\*slateNoise\(vMudWorld\.xz\*\.9\)\)-slateH, mix\(-slatePondShape\(slatePondR\(vMudWorld\.xz\)\)\*3\.0/,
  );
  assert.match(fragment, /length\(\(vMudWorld\.xz-vec2\(52\.32,20\.34\)\)\)\/1\.5\)/);
  // Puddles fill the detail map's low texels, glassy and darker, and mirror
  // the night sky as standing water (SLATE_WATER above), no fog-colour sheen.
  assert.match(
    fragment,
    /float slatePuddle = smoothstep\(-\.04, \.04, max\([^;]*-slateH, [^;]*\)\)\*\(1\.0-slateDry\);/,
  );
  assert.equal(fragment.includes("slateSheen"), false);
  assert.equal(fragment.includes("mix(fogColor,"), false);
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
  for (const name of [
    "slateContacts",
    "slateRockContact",
    "slateContactGain",
    "slateDetail",
    "slateText",
    "slateAbout",
    "slateAspect",
  ])
    assert.equal(uniforms[name], contacts[name], name);
  assert.equal(contacts.slateDetail.value, detail);
  const key = material.customProgramCacheKey();
  contacts.slateContactGain.value = 0.6;
  contacts.slateRockContact.value = 1;
  assert.equal(material.customProgramCacheKey(), key);
  material.dispose();
});

// The film grade's contrast about mid-grey and the ground's cel step at graded
// luma .1 (postprocess.js: applyProfile under film, GRADING_SHADER).
const FILM_CONTRAST = 1.015,
  CEL_STEP = 0.1;
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

test("the far plain reads as dark air: the slate lifted toward the terrain's edge, above the ground's cel step", () => {
  const slate = TERRAIN_HORIZON.match(/[\d.]+/g)
    .slice(1)
    .map(Number);
  const luma = (gain) => (0.2126 * slate[0] + 0.7152 * slate[1] + 0.0722 * slate[2]) * gain;
  const { horizon, edge, ground } = HORIZON_AIR;
  // Past the terrain the bare slate (about 11/255 on screen) would lie darker
  // than the mountain feet and the lit ground. The air lifts it 1.5 to 2
  // times, lighter toward the terrain's edge and the lit ground, and stays a
  // dark slate, far below the night sky at the horizon (luma about .2).
  assert.ok(1.5 <= horizon && horizon < edge && edge <= 2, JSON.stringify(HORIZON_AIR));
  assert.ok(luma(edge) < 0.13, `edge air luma ${luma(edge)}`);
  // The slate's far edge only darkens toward its air, which the grade keeps
  // above the cel step: a plain lit above the step never drops through it.
  const graded = (luma(ground) - 0.5) * FILM_CONTRAST + 0.5;
  assert.ok(graded > CEL_STEP + 0.003, `ground air grades to ${graded}`);
  assert.equal(TERRAIN_EDGE, EARTH.width / 2);

  const hill = createHillSilhouette({ groundHeight: flat });
  hill.setFilmTreatment(true);
  const shader = hill.mesh.material.fragmentShader;
  hill.dispose();
  // The air runs from eye level (0) to where the view meets the terrain's
  // square edge at the datum (1); the body below eye level eases into it within
  // .02 of slope (about a degree), and the feet haze to it as before.
  assert.ok(
    shader.includes(
      `vec2 hz=vL.xz/r, ah=max(abs(hz),1e-4), eq=(${TERRAIN_EDGE}.0-hz/ah*o.xz)/ah;\n` +
        `vec3 pa=${TERRAIN_HORIZON}*mix(${horizon},${edge},clamp(vL.y/r*min(eq.x,eq.y)/(vL.y-vH),0.,1.));`,
    ),
  );
  assert.ok(
    shader.includes(
      `float fh=max(smoothstep(fogNear,fogFar,vD),smoothstep(${HORIZON_HAZE.near}.,${HORIZON_HAZE.far}.,vD));\n` +
        "c=mix(c,pa,fh*(1.-smoothstep(-.02,0.,vL.y/r)));\n" +
        "c=mix(c,pa,fh*(1.-smoothstep(0.,3.0,vH)*smoothstep(-.05,-.008,vL.y/r)));",
    ),
  );
  // Nothing at or above eye level eases: the ranges keep their own shade there.
  for (const slope of [0, 0.001, 0.05]) assert.equal(1 - smooth(-0.02, 0, slope), 0);
  assert.equal(1 - smooth(-0.02, 0, -0.02), 1);

  // The shader's reach, restated: for cameras about the estate and every
  // azimuth, the slope where it reads 1 is the one that meets the square's
  // edge (found here by bisection) at the datum, and half that slope reads .5.
  const reach = ([ox, oy, oz], [x, y, z]) => {
    const r = Math.hypot(x, z),
      hx = x / r,
      hz = z / r;
    const ax = Math.max(Math.abs(hx), 1e-4),
      az = Math.max(Math.abs(hz), 1e-4);
    const ex = (TERRAIN_EDGE - (hx / ax) * ox) / ax,
      ez = (TERRAIN_EDGE - (hz / az) * oz) / az;
    // vL.y - vH is minus the camera's height above the datum (oy here).
    return Math.min(1, Math.max(0, ((y / r) * Math.min(ex, ez)) / -oy));
  };
  for (const camera of [
    [0, 25, 130],
    [55, 6, 60],
    [-40, 2.6, -90],
  ])
    for (let azimuth = 0; azimuth < 360; azimuth += 7.5) {
      const a = (azimuth * Math.PI) / 180,
        hx = Math.cos(a),
        hz = Math.sin(a);
      let lo = 0,
        hi = 1000;
      for (let i = 0; i < 60; i++) {
        const mid = (lo + hi) / 2;
        if (Math.max(Math.abs(camera[0] + hx * mid), Math.abs(camera[2] + hz * mid)) < TERRAIN_EDGE)
          lo = mid;
        else hi = mid;
      }
      const slope = -camera[1] / lo;
      assert.ok(Math.abs(reach(camera, [hx, slope, hz]) - 1) < 1e-6, `${camera} ${azimuth}`);
      assert.ok(Math.abs(reach(camera, [hx, slope / 2, hz]) - 0.5) < 1e-6);
      assert.equal(reach(camera, [hx, 0.01, hz]), 0);
    }
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

test("the film ground tells the moon key and the cool fill by the directions index.js and world.js give them", async () => {
  const { MOON_LIGHTS } = await import("../src/scene/mud-ground.js");
  const window = { BabelSite: {} };
  vm.runInNewContext(await readFile(new URL("../src/scene/world.js", import.meta.url), "utf8"), {
    window,
  });
  assert.deepEqual([...MOON_LIGHTS.fill], [...window.BabelSite.scene.WORLD.FILL_LIGHT_POSITION]);
  // The key's direction is its position over its target at the origin.
  const index = await readFile(new URL("../src/scene/index.js", import.meta.url), "utf8");
  const [, x, y, z] = index.match(
    /directionalPosition: \{\s*x: (-?[\d.]+),\s*y: (-?[\d.]+),\s*z: (-?[\d.]+),?\s*\}/,
  );
  assert.deepEqual([...MOON_LIGHTS.key], [x, y, z].map(Number));
  assert.equal(/fillPosition/.test(index), false, "the fill keeps world.js's position");
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
    /varying float vSlateDune;[^]*float slateHollow = 1\.0 - smoothstep\(0\.77, 1\.1, vSlateDune\);/,
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

test("only the wide shots calm the plain, written in place, and the calm is off without a frame", () => {
  const contacts = createSlateContacts(),
    calm = contacts.slateCalm.value,
    at = contacts.slateCalmAt.value,
    target = { x: 55.1, y: 9, z: 36.1 };
  const off = { x: 0, y: 1, z: 2, w: 0 };
  const calmed = Object.values(DIRECTED_SHOTS)
    .flat()
    .filter((shot) => shot.ground)
    .map((shot) => shot.name);
  assert.deepEqual(calmed, ["Watch and tree", "Portrait"]);
  for (const shot of Object.values(DIRECTED_SHOTS).flat()) {
    assert.equal(slateCalmFor(contacts, shot, 60, target), calm, "the same object, in place");
    if (shot.ground) {
      assert.ok(calm.x > 0 && calm.x < 1, shot.name + " burns part way");
      assert.ok(calm.y < calm.z && calm.z <= 60, shot.name + " burn fades by the subject");
      assert.ok(calm.w > 0 && calm.w < 1, shot.name + " flattens part way");
      assert.deepEqual(
        { ...at },
        {
          x: target.x,
          y: target.z,
          z: shot.ground.keep[0],
          w: shot.ground.keep[1],
        },
      );
    } else assert.deepEqual({ ...calm }, off, shot.name + " leaves the slate as it is");
  }
  const portrait = DIRECTED_SHOTS.tree.find((shot) => shot.name === "Portrait");
  for (const [distance, point] of [
    [undefined, target],
    [0, target],
    [60, null],
  ]) {
    slateCalmFor(contacts, portrait, 60, target);
    slateCalmFor(contacts, portrait, distance, point);
    assert.deepEqual({ ...calm }, off);
  }
  slateCalmFor(contacts, null, 60, target);
  assert.deepEqual({ ...calm }, off);
  // The film slate's program reads them; the baseline ground keeps three's own.
  for (const film of [true, false]) {
    const material = new MeshStandardMaterial(),
      shader = {
        uniforms: {},
        vertexShader: ["#include <begin_vertex>", "#include <project_vertex>"].join("\n"),
        fragmentShader: [
          "#include <map_fragment>",
          "#include <roughnessmap_fragment>",
          "#include <lights_fragment_end>",
          "#include <fog_fragment>",
        ].join("\n"),
      };
    configureGroundShading(material, film, { contacts });
    material.onBeforeCompile(shader);
    assert.equal(shader.uniforms.slateCalm === contacts.slateCalm, film);
    assert.equal(/uniform vec4 slateCalm, slateCalmAt;/.test(shader.fragmentShader), film);
    assert.equal(shader.fragmentShader.includes("gl_FragColor.rgb *= 1.0-slateCalm.x"), film);
    material.dispose();
  }
});

test("only Portrait takes the look on its plain: a moonlit clearing, low mist, the gloss of rain and a softer crown shadow", (t) => {
  const contacts = createSlateContacts(),
    target = { x: 55.1, y: 9, z: 36.1 },
    clear = contacts.slateClear.value,
    light = contacts.slateClearLight.value,
    shade = contacts.slateClearShade.value,
    mist = contacts.slateMist.value,
    gloss = contacts.slateGloss.value,
    shadow = contacts.slateShadowFade.value;
  // The ranges read the same mist: their feet meet the plain's. It is one
  // object for the module, so it goes off again however this test ends.
  assert.equal(contacts.slateMist, RANGE_MIST);
  t.after(() => slateCalmFor(contacts, null, 60, target));
  const off = () => {
    assert.equal(shade.w, 0, "no clearing");
    assert.equal(mist.w, 0, "no mist");
    assert.equal(gloss.z, 0, "no gloss");
    assert.deepEqual({ ...shadow }, { x: 0, y: 0 }, "the moon's shadow whole");
  };
  off();
  const looks = Object.values(DIRECTED_SHOTS)
    .flat()
    .filter(({ ground }) => ground?.clearing || ground?.mist || ground?.gloss || ground?.shadow)
    .map(({ name }) => name);
  assert.deepEqual(looks, ["Portrait"]);
  const portrait = DIRECTED_SHOTS.tree.find((shot) => shot.name === "Portrait"),
    look = portrait.ground;
  for (const shot of Object.values(DIRECTED_SHOTS).flat()) {
    slateCalmFor(contacts, portrait, 60, target);
    slateCalmFor(contacts, shot, 60, target);
    if (shot !== portrait) off();
  }
  slateCalmFor(contacts, portrait, 60, target);
  // The clearing stands toward the lens, on the shot's bearing.
  const yaw = (portrait.azimuth * Math.PI) / 180;
  assert.ok(Math.abs(clear.x - (target.x + Math.cos(yaw) * look.clearing.toward)) < 1e-9);
  assert.ok(Math.abs(clear.y - (target.z + Math.sin(yaw) * look.clearing.toward)) < 1e-9);
  assert.deepEqual([clear.z, clear.w], look.clearing.radius);
  assert.deepEqual(
    [light.x, light.y, light.z, light.w],
    [...look.clearing.light, look.clearing.rest],
  );
  assert.deepEqual([shade.x, shade.y, shade.z, shade.w], [...look.clearing.shade, 1]);
  // Lit, cooler than warm, never darker than the rest of the plain.
  assert.ok(look.clearing.light.every((c) => c > look.clearing.rest && c < 2));
  assert.ok(look.clearing.light[2] > look.clearing.light[0], "moonlight is cool");
  assert.ok(look.keep[1] >= look.clearing.radius[1], "the clearing keeps its texture");
  assert.deepEqual([mist.x, mist.y, mist.z, mist.w], [...look.mist.color, look.mist.amount]);
  assert.ok(look.mist.color[2] > look.mist.color[0], "the mist is moonlit, cool");
  assert.deepEqual([gloss.x, gloss.y, gloss.z], [look.gloss.film, look.gloss.gain, 1]);
  assert.deepEqual([shadow.x, shadow.y], look.shadow);
  // Without a frame the look goes with the calm.
  slateCalmFor(contacts, portrait, 0, target);
  off();
  slateCalmFor(contacts, portrait, 60, target);
  slateCalmFor(contacts, null, 60, target);
  off();
});

test("the look's shading changes nothing until a shot asks for it", () => {
  const material = new MeshStandardMaterial(),
    contacts = createSlateContacts(),
    shader = {
      uniforms: {},
      vertexShader: ["#include <begin_vertex>", "#include <project_vertex>"].join("\n"),
      fragmentShader: ["#include <shadowmap_pars_fragment>", FILM_CHUNKS].join("\n"),
    };
  configureGroundShading(material, true, { contacts });
  material.onBeforeCompile(shader);
  const fragment = flatCode(shader.fragmentShader);
  for (const name of [
    "slateClear",
    "slateClearLight",
    "slateClearShade",
    "slateGloss",
    "slateShadowFade",
  ])
    assert.equal(shader.uniforms[name], contacts[name], name);
  assert.equal(shader.uniforms.slateMist, RANGE_MIST);
  // The moon's shadow fades from the subject only under a look (slateShadowFade.y > 0).
  assert.ok(
    fragment.includes(
      "#ifdef USE_SHADOWMAP float slateShadow(sampler2D map,vec2 size,float bias,float radius,vec4 coord){float s=getShadow(map,size,bias,radius,coord);return slateShadowFade.y>0.?",
    ),
  );
  assert.match(fragment, /:s;} #define getShadow slateShadow #endif/);
  // The film's share and the water's reach and sky change only under a gloss.
  assert.ok(fragment.includes("slateWetFilm = (mix(0.12, slateGloss.x, slateGlossW)"));
  assert.ok(
    fragment.includes(
      "void slateGlossSet(){if(slateGloss.z>0.){vec2 v=vSlateClip.xy/vSlateClip.w*.5+.5;slateGlossT=smoothstep(",
    ),
  );
  assert.ok(
    fragment.includes("smoothstep(mix(70.0,400.0,slateGlossT),mix(130.0,1100.0,slateGlossT)"),
  );
  assert.equal(
    fragment.match(/slateWaterFar\(length\(vViewPosition\)\)\)/g).length,
    2,
    "the film and the puddles",
  );
  assert.ok(
    fragment.includes(
      "*mix(mix(1.5, slateGloss.y, slateGlossT)*mix(vec3(1.0), vec3(0.72,0.88,1.18), slateGlossT), vec3(1.8), slatePuddle)",
    ),
  );
  // The gloss's weights are set once, before the water's share and the lights,
  // and its reach and sky follow the text guard as its share does.
  assert.ok(
    fragment.indexOf("slateGlossSet(); slateWaterN = normalize(") >= 0 &&
      fragment.indexOf("slateGlossSet(); slateWaterN = normalize(") <
        fragment.indexOf("slateWetFilm = (mix("),
  );
  assert.ok(fragment.includes("slateGlossW=slateGlossT*mix("));
  // The clearing and the mist are drawn only under a look, and at the plain's
  // edge (where the far plain's air meets the ranges) the rest of the plain
  // keeps its light and the mist is whole, as on the ranges' feet.
  const edge = "smoothstep(155.0, 190.0, max(abs(vMudWorld.x),abs(vMudWorld.z)))";
  assert.ok(fragment.includes(`float earthHorizon = max(${edge},`));
  assert.match(fragment, /if \(slateClearShade\.w > 0\.\) \{/);
  assert.ok(
    fragment.includes(`mix(vec3(mix(slateClearLight.w, 1., ${edge})), slateClearLight.rgb,`),
  );
  assert.match(fragment, /if \(slateMist\.w > 0\.\) \{/);
  assert.ok(fragment.includes(`*slateMN, 1., ${edge}), 0., 1.)*slateMist.w);`));
  material.dispose();
});

test("the terrain chunk restates the plain's level", async () => {
  const { TERRAIN_BASE: chunk } = await import("../src/scene/terrain-build.js");
  const { TERRAIN_BASE, TERRAIN_DUNE_TERMS } = await import("../src/scene/mud-ground.js");
  assert.equal(chunk, TERRAIN_BASE);
  // The plain's level is the dune field's constant term.
  assert.deepEqual(TERRAIN_DUNE_TERMS[0], {
    amplitude: TERRAIN_BASE,
    wave: "cos",
    frequency: 0,
    sx: 0,
    sz: 0,
  });
});
