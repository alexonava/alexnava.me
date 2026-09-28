import assert from "node:assert/strict";
import test from "node:test";
import { readdir, readFile } from "node:fs/promises";
import vm from "node:vm";
import { transform } from "esbuild";
import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from "three";
import { compactShaderSource } from "../tools/shader-compact.mjs";
import { ESTATE, estateLantern, estatePathDistance, estatePoint } from "../src/scene/estate-layout.js";
import {
  createRockScatter,
  estateContacts,
  PEBBLE_UNDER,
  ROCK_CLUSTERS,
  ROCK_LIB,
  rockKeepouts,
} from "../src/scene/rock-scatter.js";
import { createRocks, createRockLayout, rockClear, rockFootprints, writeRockContacts } from "../src/scene/rock-build.js";
import { SLATE_CONTACTS } from "../src/scene/mud-ground.js";

const flat = () => 0;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test("shader compaction strips GLSL indentation, comments and spaces but keeps directives and expressions", () => {
  const source = [
    "const a = `",
    "  #ifdef USE_MAP",
    "    float x = a * b; // a comment",
    "",
    "    vec2 y = vec2( 1.0, x );",
    "    float z = a - -b;",
    "  #endif",
    "  float w = ${value} * 2.0;",
    "  gl_FragColor.a = ${alpha};`;",
    "const b = `  plain   text ${x}  `;",
    "const re = /`[^`]*`/g, half = 1 / 2 / 3;",
    'const s = "`  float not = 1;  `";',
  ].join("\n");
  const out = compactShaderSource(source);
  assert.equal(
    out,
    [
      "const a = `",
      "#ifdef USE_MAP",
      "float x=a*b;vec2 y=vec2(1.0,x);float z=a- -b;",
      "#endif",
      // Spaces at a ${} edge stay: the expression may end in anything.
      "float w= ${value} *2.0;",
      "gl_FragColor.a= ${alpha};`;",
      "const b = `  plain   text ${x}  `;",
      "const re = /`[^`]*`/g, half = 1 / 2 / 3;",
      'const s = "`  float not = 1;  `";',
    ].join("\n"),
  );
  assert.equal(compactShaderSource(out), out, "idempotent");
  // A regex after a comment (three's /*@__PURE__*/ style) is still a regex.
  assert.equal(compactShaderSource("x = /*c*/ /`/.source;"), "x = /*c*/ /`/.source;");
  assert.throws(() => compactShaderSource("const a = `float x;"), /unterminated template literal/);
});

test("every scene module compacts to JavaScript that still parses and minifies no larger", async () => {
  const dir = new URL("../src/scene/", import.meta.url);
  let before = 0,
    after = 0;
  for (const name of (await readdir(dir)).filter((file) => file.endsWith(".js"))) {
    const source = await readFile(new URL(name, dir), "utf8");
    const compact = compactShaderSource(source);
    const a = (await transform(source, { minify: true, format: "esm" })).code;
    const b = (await transform(compact, { minify: true, format: "esm" })).code;
    assert.ok(b.length <= a.length, name);
    before += a.length;
    after += b.length;
  }
  assert.ok(before - after > 2000, `saved ${before - after} bytes`);
});

test("helpers.js restates the estate anchors and terraces from estate-layout.js", async () => {
  const helpers = await readFile(new URL("../src/scene/helpers.js", import.meta.url), "utf8");
  for (const { x, z, lift, flat: flatRadius, blend } of [ESTATE.tower, ESTATE.tree]) {
    const call = `terrace(xx, yy, height, ${x}, ${z}, ${lift.toFixed(Number.isInteger(lift) ? 1 : 2)}, ${flatRadius}, ${blend});`;
    assert.ok(helpers.includes(call), call);
  }
  const window = { BabelSite: {} };
  vm.runInNewContext(helpers, { window, Math });
  const { groundHeight } = window.BabelSite.scene;
  // Inside each flat radius the terrace is level.
  for (const { x, z, flat: flatRadius } of [ESTATE.tower, ESTATE.tree])
    assert.ok(Math.abs(groundHeight(x, z) - groundHeight(x + flatRadius * 0.9, z)) < 1e-9);
  const lantern = estateLantern();
  assert.ok(Math.abs(Math.hypot(lantern.x - ESTATE.tree.x, lantern.z - ESTATE.tree.z) - ESTATE.lantern.offset) < 1e-9);
  assert.ok(estatePathDistance(lantern.x, lantern.z) < 1.5, "the lantern stands beside the approach");
  const architecture = await readFile(new URL("../src/scene/architecture.js", import.meta.url), "utf8");
  assert.match(architecture, /ESTATE\.lantern\.offset/, "the tree builder places the lantern from ESTATE");
});

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
      assert.ok(Math.hypot(rock.x - ESTATE.tower.x, rock.z - ESTATE.tower.z) > ESTATE.tower.clear + rock.radius, rock.id);
      assert.ok(Math.hypot(rock.x - ESTATE.tree.x, rock.z - ESTATE.tree.z) > ESTATE.tree.clear + rock.radius, rock.id);
      assert.ok(estatePathDistance(rock.x, rock.z) > ESTATE.path.clear + rock.radius, rock.id);
    }
    for (const other of a) {
      if (other !== rock) assert.ok(Math.hypot(rock.x - other.x, rock.z - other.z) > 0.5 * (rock.radius + other.radius), `${rock.id}/${other.id}`);
    }
  }
  // The growth keep-outs cover every rock and pebble the placement makes.
  const keepouts = rockKeepouts();
  for (const rock of a)
    assert.ok(
      keepouts.some((zone) => Math.hypot(rock.x - zone.x, rock.z - zone.z) + (rock.pebble ? 0 : rock.radius) <= zone.radius + 1e-9),
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
  assert.deepEqual([...contacts.slice(0, 2)], [Math.fround(ESTATE.tree.x), Math.fround(ESTATE.tree.z)]);
  assert.ok(contacts.slice(8).every((value) => value === 0), "rock slots stay empty until the rocks load");
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
  // Low tier and ?rocks=off never fetch the chunk.
  for (const options of [{ tier: "low" }, { tier: "high", enabled: false }]) {
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
  assert.equal(rocks.take({ cut: false, running: true, nowMs: 0 }), false, "queued, not yet linked");
  await tick();
  assert.equal(rocks.take({ cut: false, running: true, nowMs: 16 }), false, "linked, waiting for a cut");
  assert.equal(root.visible, false);
  assert.equal(rocks.take({ cut: true, running: true, nowMs: 32 }), true);
  assert.equal(rocks.committed, true);
  assert.equal(root.visible, true);
  assert.ok(root.children.every((mesh) => mesh.count === mesh.instanceMatrix.count && mesh.count > 0));
  assert.deepEqual(statuses, ["loading", "ready"]);
  rocks.setFilmActive(false);
  assert.equal(root.visible, false);
  assert.equal(rocks.dispose(), true);
  assert.equal(rocks.dispose(), false);
  assert.equal(root.parent, null);
});

test("the rock scatter waits for the film terrain and seats the rocks on its root-aware height", async () => {
  const fake = { setFilmActive() {}, take: () => false, dispose() {} };
  for (const [terrainHeight, expected] of [[(x, z) => x + z, "terrain"], [undefined, "analytic"]]) {
    let seen = null, release;
    const rocks = createRockScatter({
      tier: "high",
      parent: new Group(),
      groundHeight: flat,
      load: async () => ({ createRocks: (lib, options) => ((seen = options.groundHeight), fake) }),
      terrain: () => new Promise((resolve) => { release = resolve; }),
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
