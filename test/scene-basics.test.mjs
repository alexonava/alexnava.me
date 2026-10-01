// The scene's shared constants, helpers and URL modes, and the pinned Three.js revision.

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { resolveSceneView, SCENE_VIEWS } from "../src/scene/scene-modes.js";
import { REVISION } from "three";
import { ESTATE, estateLantern, estatePathDistance } from "../src/scene/estate-layout.js";

const testDir = path.dirname(fileURLToPath(import.meta.url));

const projectRoot = path.resolve(testDir, "..");

const worldPath = path.join(projectRoot, "src", "scene", "world.js");

const palettePath = path.join(projectRoot, "src", "scene", "palette.js");

async function loadScene(scriptPaths) {
  const window = { BabelSite: {} };
  for (const scriptPath of scriptPaths) {
    const source = await readFile(scriptPath, "utf8");
    vm.runInNewContext(source, { window, console }, { filename: scriptPath });
  }
  return window.BabelSite.scene;
}

test("WORLD constants are frozen and expose the documented orbit geometry", async () => {
  const scene = await loadScene([worldPath]);
  const w = scene.WORLD;

  assert.ok(Object.isFrozen(w));
  assert.ok(Object.isFrozen(w.SUN_DIRECTION));
  assert.ok(Object.isFrozen(w.FILL_LIGHT_POSITION));
  assert.ok(Object.isFrozen(w.SUN_POSITION));

  assert.equal(w.FLOOR_Y, 0);
  assert.ok(w.GROUND_RADIUS > 0);
  assert.ok(w.GROUND_RADIUS < w.SKY_DOME_RADIUS);

  assert.ok(w.CAMERA_NEAR > 0);
  assert.ok(w.CAMERA_NEAR < w.CAMERA_FAR);
  assert.ok(w.CAMERA_FAR >= w.SKY_DOME_RADIUS, "camera far plane must enclose sky dome");
  assert.ok(w.CAMERA_FOV > 0 && w.CAMERA_FOV < 180);

  assert.ok(w.SHADOW_CAMERA_NEAR > 0);
  assert.ok(w.SHADOW_CAMERA_NEAR < w.SHADOW_CAMERA_FAR);
  const orbitRadius = 62;
  assert.ok(
    w.SHADOW_CAMERA_HALF_EXTENT * 2 >= orbitRadius,
    "shadow frustum must cover the mobile orbit diameter",
  );

  for (const axis of w.SUN_DIRECTION) assert.equal(typeof axis, "number");
  assert.notEqual(
    w.SUN_DIRECTION[0] ** 2 + w.SUN_DIRECTION[1] ** 2 + w.SUN_DIRECTION[2] ** 2,
    0,
    "SUN_DIRECTION must be non-zero (will be normalized by caller)",
  );
});

test("palette tokens are parseable CSS colors and the ground material stays in range", async () => {
  const scene = await loadScene([palettePath]);

  const hexRegex = /^#[0-9a-fA-F]{6}$/;
  const rgbaRegex = /^rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*(?:0|1|0?\.\d+)\s*\)$/;

  function expectColor(value) {
    if (Array.isArray(value)) {
      for (const entry of value) expectColor(entry);
      return;
    }
    assert.equal(typeof value, "string");
    assert.ok(hexRegex.test(value) || rgbaRegex.test(value), `expected CSS color, got ${value}`);
  }

  for (const value of Object.values(scene.GROUND_TEXTURE_PALETTE)) expectColor(value);

  assert.ok(
    scene.GROUND_SURFACE_MATERIAL.bumpScale > 0 && scene.GROUND_SURFACE_MATERIAL.bumpScale < 1,
  );

  assert.ok(
    scene.GROUND_SURFACE_MATERIAL.roughness >= 0 && scene.GROUND_SURFACE_MATERIAL.roughness <= 1,
  );
  assert.ok(
    scene.GROUND_SURFACE_MATERIAL.metalness >= 0 && scene.GROUND_SURFACE_MATERIAL.metalness <= 1,
  );
});

const helpersPath = path.join(projectRoot, "src", "scene", "helpers.js");

const webglProbePath = path.join(projectRoot, "src", "shared", "webgl-probe.js");

async function loadHelpers({ webgl = "ok" } = {}) {
  const window = { BabelSite: {} };
  if (webgl !== "no-window-constructor") {
    window.WebGLRenderingContext = function WebGLRenderingContext() {};
  }
  const document = {
    createElement() {
      return {
        getContext(kind) {
          if (webgl === "throws") {
            throw new Error("boom");
          }
          if (webgl === "ok") return { kind };
          if (webgl === "experimental-only") {
            return kind === "experimental-webgl" ? { kind } : null;
          }
          return null;
        },
      };
    },
  };
  const context = { window, document, console };
  const probeSource = await readFile(webglProbePath, "utf8");
  vm.runInNewContext(probeSource, context, { filename: webglProbePath });
  const helpersSource = await readFile(helpersPath, "utf8");
  vm.runInNewContext(helpersSource, context, { filename: helpersPath });
  return window.BabelSite.scene;
}

test("clamp01 clamps below zero, above one, and preserves interior values", async () => {
  const scene = await loadHelpers();
  assert.equal(scene.clamp01(-0.3), 0);
  assert.equal(scene.clamp01(0), 0);
  assert.equal(scene.clamp01(0.42), 0.42);
  assert.equal(scene.clamp01(1), 1);
  assert.equal(scene.clamp01(2.7), 1);
});

test("smoothstep01 is clamped, monotonic, and passes the Hermite fixed points", async () => {
  const scene = await loadHelpers();
  assert.equal(scene.smoothstep01(-1), 0);
  assert.equal(scene.smoothstep01(0), 0);
  assert.equal(scene.smoothstep01(0.5), 0.5);
  assert.equal(scene.smoothstep01(1), 1);
  assert.equal(scene.smoothstep01(2), 1);

  let previous = scene.smoothstep01(0);
  for (let i = 1; i <= 20; i += 1) {
    const next = scene.smoothstep01(i / 20);
    assert.ok(next >= previous - 1e-12, `smoothstep01 not monotonic at ${i}`);
    previous = next;
  }
});

test("groundHeight is deterministic and stays inside its analytic bound", async () => {
  const scene = await loadHelpers();
  // The tower and tree knolls never overlap (their centers are ~66 units
  // apart against ~15-unit radii), so the worst case anywhere is the dune
  // ceiling plus whichever single knoll amplitude is larger.
  const limit = 1.8 + 1.35 + 0.9 + 0.55 + 1.0;
  const probes = [
    [0, 0],
    [12, -7],
    [-40, 22],
    [88, 88],
    [-88, -88],
  ];
  for (const [x, y] of probes) {
    const a = scene.groundHeight(x, y);
    const b = scene.groundHeight(x, y);
    assert.equal(a, b);
    assert.ok(Math.abs(a) <= limit + 1e-12, `groundHeight(${x}, ${y}) = ${a} exceeded ${limit}`);
  }
  assert.notEqual(scene.groundHeight(0, 0), scene.groundHeight(25, 0));
});

test("groundHeight terraces flat under the tower and tree footprints, then blends back to the dune field", async () => {
  const scene = await loadHelpers();
  const dune = (x, y) =>
    1.8 * Math.sin(0.055 * x) +
    1.35 * Math.cos(0.052 * y) +
    0.9 * Math.sin(0.031 * (x + y)) +
    0.55 * Math.cos(0.018 * (x - y));

  // Flat terrace: every point within flatRadius sits at the exact same
  // height (the anchor's dune value plus the terrace amplitude), regardless
  // of the dune field's own local slope there. This is what removes the
  // floating-footing problem an additive-only bump left behind.
  const towerFlat = dune(0, 0) + 1.0;
  for (const [x, y] of [
    [0, 0],
    [6, 0],
    [0, -8],
    [5, 5],
  ]) {
    assert.ok(
      Math.abs(scene.groundHeight(x, y) - towerFlat) < 1e-9,
      `tower terrace should be perfectly flat at (${x}, ${y})`,
    );
  }
  const treeFlat = dune(55.1, 36.1) + 0.75;
  for (const [x, y] of [
    [55.1, 36.1],
    [55.1 + 5, 36.1],
    [55.1, 36.1 - 5],
  ]) {
    assert.ok(
      Math.abs(scene.groundHeight(x, y) - treeFlat) < 1e-9,
      `tree terrace should be perfectly flat at (${x}, ${y})`,
    );
  }

  // Falloff: well outside each terrace's outer radius, it's exactly the
  // plain dune field again.
  assert.ok(
    Math.abs(scene.groundHeight(30, 0) - dune(30, 0)) < 1e-9,
    "tower terrace should have fully blended away by (30, 0)",
  );
  assert.ok(
    Math.abs(scene.groundHeight(55.1 + 25, 36.1) - dune(55.1 + 25, 36.1)) < 1e-9,
    "tree terrace should have fully blended away 25 units from its anchor",
  );
});

test("supportsWebGL detects standard, experimental-only, and missing contexts", async () => {
  const ok = await loadHelpers({ webgl: "ok" });
  assert.equal(ok.supportsWebGL(), true);

  const experimentalOnly = await loadHelpers({ webgl: "experimental-only" });
  assert.equal(experimentalOnly.supportsWebGL(), true);

  const missing = await loadHelpers({ webgl: "no-window-constructor" });
  assert.equal(missing.supportsWebGL(), false);

  const throws = await loadHelpers({ webgl: "throws" });
  assert.equal(throws.supportsWebGL(), false);
});

test("the film opens on the tower unless the URL asks for the tree", () => {
  assert.deepEqual(SCENE_VIEWS, ["tower", "tree"]);
  for (const search of [
    "",
    "?view=tower&angle=1",
    "?quality=balanced&qaTime=0&tour=0",
    "?view=unknown",
  ]) {
    assert.equal(resolveSceneView(search), "tower", search);
  }
  assert.equal(resolveSceneView("?view=tree"), "tree");
  assert.equal(resolveSceneView("?view=tree&angle=4&sceneDebug=1"), "tree");
});

// src/scene/rendering.js opts into r160's legacy light units through the
// private renderer._useLegacyLights flag. Later releases remove that path, so a
// routine dependency bump would silently relight the scene.
test("Three.js stays pinned to the r160 legacy-light revision", async () => {
  assert.equal(
    REVISION,
    "160",
    "three must stay at r160 until the lighting is re-reviewed without legacy light units",
  );
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.equal(
    packageJson.devDependencies.three,
    "0.160.1",
    "an exact three version keeps installs from drifting past r160",
  );
});

const flat = () => 0;

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
  assert.ok(
    Math.abs(
      Math.hypot(lantern.x - ESTATE.tree.x, lantern.z - ESTATE.tree.z) - ESTATE.lantern.offset,
    ) < 1e-9,
  );
  assert.ok(
    estatePathDistance(lantern.x, lantern.z) < 1.5,
    "the lantern stands beside the approach",
  );
  const architecture = await readFile(
    new URL("../src/scene/architecture.js", import.meta.url),
    "utf8",
  );
  assert.match(
    architecture,
    /ESTATE\.lantern\.offset/,
    "the tree builder places the lantern from ESTATE",
  );
});
