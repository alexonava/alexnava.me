import assert from "node:assert/strict";
import test from "node:test";
import { Scene } from "three";
import { createCliff, coastGeometrySettings } from "../src/scene/ocean.js";
import { MIST_PARS, MIST_UNIFORMS } from "../src/scene/drifting-mist.js";
import { FLASH_GROUND } from "../src/scene/film-light.js";
import { RANGE_MIST } from "../src/scene/hill-silhouette.js";
import { SLATE_TEXT_GUARD } from "../src/scene/mud-ground.js";

const lib = { MIST_PARS, MIST_UNIFORMS, FLASH_GROUND, RANGE_MIST, SLATE_TEXT_GUARD };
const tick = () => new Promise((resolve) => setImmediate(resolve));
const cliff = (tier) =>
  createCliff({
    lib,
    clock: { uniform: { value: 0 } },
    rendering: { tier, lights: {}, homeScene: new Scene() },
    height: () => 1.25,
  });

test("the coastal owner binds one optional data map on a cut and restores it before disposal", async () => {
  const fetcher = globalThis.fetch,
    decoder = globalThis.createImageBitmap;
  let requests = 0,
    closed = 0,
    freed = 0;
  globalThis.fetch = async () => {
    requests++;
    return new Response(new Uint8Array(16));
  };
  globalThis.createImageBitmap = async () => ({
    width: 256,
    height: 256,
    close() {
      closed++;
    },
  });
  const coast = cliff("high"),
    uniforms = coast.material.uniforms;
  try {
    coast.setActive(true);
    coast.take({ revealed: false, running: true, cut: false });
    await tick();
    assert.equal(requests, 0, "preparation cannot start this optional download before reveal");
    coast.take({ revealed: true, running: true, cut: false });
    for (let i = 0; i < 6; i++) await tick();
    assert.equal(requests, 1);
    assert.equal(uniforms.coastDetailOn.value, 0, "decoded detail waits while a shot is visible");
    coast.take({ revealed: true, running: true, cut: true });
    const texture = uniforms.coastDetail.value;
    assert.ok(texture?.isTexture);
    assert.equal(uniforms.coastDetailOn.value, 1);
    assert.equal(
      coast.mesh.children[0].material,
      coast.material,
      "cliff and stacks share the same binding",
    );
    texture.addEventListener("dispose", () => {
      freed++;
      assert.equal(uniforms.coastDetail.value, null);
      assert.equal(uniforms.coastDetailOn.value, 0);
    });
    coast.setActive(false);
    assert.equal(uniforms.coastDetail.value, null);
    assert.equal(freed, 0, "withdrawal retains the cached optional texture");
    coast.setActive(true);
    coast.take({ revealed: true, running: true, cut: false });
    assert.equal(uniforms.coastDetailOn.value, 0);
    coast.take({ revealed: true, running: true, cut: true });
    assert.equal(uniforms.coastDetail.value, texture);
    assert.equal(requests, 1, "reactivation reuses the startup map");
  } finally {
    coast.dispose();
    globalThis.fetch = fetcher;
    globalThis.createImageBitmap = decoder;
  }
  assert.equal(freed, 1);
  assert.equal(closed, 1);
});

test("the actual coastal owner chooses the startup tier's geometry without adding draw groups", () => {
  for (const tier of ["high", "balanced"]) {
    const coast = cliff(tier),
      settings = coastGeometrySettings(tier);
    try {
      const geometry = coast.mesh.geometry,
        stacks = coast.mesh.children[0].geometry;
      assert.equal(
        geometry.userData.coastGeometry.rows,
        settings.cliff.rows + settings.cliff.shelfRows + 2,
      );
      assert.ok(
        geometry.index.count / 3 + stacks.attributes.position.count / 3 <= settings.maxTriangles,
      );
      assert.equal(geometry.groups.length, 0, "one rock draw when no borrowed ground is supplied");
      assert.equal(coast.mesh.children.length, 1, "rubble is merged, not a new mesh/pass");
    } finally {
      coast.dispose();
    }
  }
});
