import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

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
  assert.equal(w.DEV_MODE, undefined, "the developer camera's constants are gone");

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
    assert.ok(
      hexRegex.test(value) || rgbaRegex.test(value),
      `expected CSS color, got ${value}`,
    );
  }

  for (const value of Object.values(scene.GROUND_TEXTURE_PALETTE)) expectColor(value);

  assert.ok(scene.GROUND_SURFACE_MATERIAL.bumpScale > 0 && scene.GROUND_SURFACE_MATERIAL.bumpScale < 1);

  assert.ok(scene.GROUND_SURFACE_MATERIAL.roughness >= 0 && scene.GROUND_SURFACE_MATERIAL.roughness <= 1);
  assert.ok(scene.GROUND_SURFACE_MATERIAL.metalness >= 0 && scene.GROUND_SURFACE_MATERIAL.metalness <= 1);
});
