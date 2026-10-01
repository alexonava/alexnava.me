import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
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
