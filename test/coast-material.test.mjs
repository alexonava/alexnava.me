import assert from "node:assert/strict";
import test from "node:test";
import { MeshStandardMaterial, NoColorSpace, Scene, SRGBColorSpace } from "three";
import { createCliff, coastGeometrySettings } from "../src/scene/ocean.js";
import { MIST_PARS, MIST_UNIFORMS } from "../src/scene/drifting-mist.js";
import { FLASH_GROUND } from "../src/scene/film-light.js";
import { RANGE_MIST } from "../src/scene/hill-silhouette.js";
import { SLATE_TEXT_GUARD } from "../src/scene/mud-ground.js";

const lib = { MIST_PARS, MIST_UNIFORMS, FLASH_GROUND, RANGE_MIST, SLATE_TEXT_GUARD };
const tick = () => new Promise((resolve) => setImmediate(resolve));
const cliff = (tier, groundMaterial = null) =>
  createCliff({
    lib,
    clock: { uniform: { value: 0 } },
    rendering: { tier, lights: {}, homeScene: new Scene() },
    height: () => 1.25,
    groundMaterial,
  });

test("the coastal owner binds independent optional colour and data maps on a cut and restores borrowed ground before disposal", async () => {
  const fetcher = globalThis.fetch,
    decoder = globalThis.createImageBitmap;
  let requests = 0,
    closed = 0,
    freed = 0;
  globalThis.fetch = async (url) => {
    requests++;
    return new Response(new Uint8Array([url.includes("albedo") ? 2 : 1]));
  };
  globalThis.createImageBitmap = async (blob) => {
    const size = new Uint8Array(await blob.arrayBuffer())[0] === 2 ? 512 : 256;
    return {
      width: size,
      height: size,
      close() {
        closed++;
      },
    };
  };
  const ground = new MeshStandardMaterial(),
    borrowed = { coastAlbedo: { value: null }, coastAlbedoOn: { value: 0 } };
  ground.userData.coastAlbedoUniforms = borrowed;
  let groundFreed = 0;
  ground.addEventListener("dispose", () => groundFreed++);
  const coast = cliff("high", ground),
    uniforms = coast.material.uniforms;
  try {
    coast.setActive(true);
    coast.take({ revealed: false, running: true, cut: false });
    await tick();
    assert.equal(requests, 0, "preparation cannot start this optional download before reveal");
    coast.take({ revealed: true, running: true, cut: false });
    for (let i = 0; i < 8; i++) await tick();
    assert.equal(requests, 2);
    assert.equal(uniforms.coastDetailOn.value, 0, "decoded detail waits while a shot is visible");
    assert.equal(uniforms.coastAlbedoOn.value, 0);
    assert.equal(borrowed.coastAlbedo.value, null);
    coast.take({ revealed: true, running: true, cut: true });
    const texture = uniforms.coastDetail.value,
      albedo = uniforms.coastAlbedo.value;
    assert.ok(texture?.isTexture);
    assert.equal(uniforms.coastDetailOn.value, 1);
    assert.ok(albedo?.isTexture);
    assert.equal(albedo.colorSpace, SRGBColorSpace);
    assert.equal(texture.colorSpace, NoColorSpace);
    assert.equal(uniforms.coastAlbedoOn.value, 1);
    assert.equal(borrowed.coastAlbedo.value, albedo);
    assert.equal(borrowed.coastAlbedoOn.value, 1);
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
    albedo.addEventListener("dispose", () => {
      freed++;
      assert.equal(uniforms.coastAlbedo.value, null);
      assert.equal(uniforms.coastAlbedoOn.value, 0);
      assert.equal(borrowed.coastAlbedo.value, null);
      assert.equal(borrowed.coastAlbedoOn.value, 0);
    });
    coast.setActive(false);
    assert.equal(uniforms.coastDetail.value, null);
    assert.equal(borrowed.coastAlbedo.value, null);
    assert.equal(freed, 0, "withdrawal retains the cached optional texture");
    coast.setActive(true);
    coast.take({ revealed: true, running: true, cut: false });
    assert.equal(uniforms.coastDetailOn.value, 0);
    coast.take({ revealed: true, running: true, cut: true });
    assert.equal(uniforms.coastDetail.value, texture);
    assert.equal(uniforms.coastAlbedo.value, albedo);
    assert.equal(borrowed.coastAlbedo.value, albedo);
    assert.equal(requests, 2, "reactivation reuses both startup maps");
  } finally {
    coast.dispose();
    globalThis.fetch = fetcher;
    globalThis.createImageBitmap = decoder;
  }
  assert.equal(freed, 2);
  assert.equal(closed, 2);
  assert.equal(groundFreed, 0, "the coastal owner never frees the borrowed ground material");
  ground.dispose();
});

for (const failed of ["albedo", "detail"])
  test(`optional ${failed} failure does not suppress the other coastal map or retry on cuts`, async () => {
    const fetcher = globalThis.fetch,
      decoder = globalThis.createImageBitmap,
      requests = [];
    globalThis.fetch = async (url) => {
      requests.push(url);
      if (url.includes(failed)) throw new Error("optional map failed");
      return new Response(new Uint8Array([url.includes("albedo") ? 2 : 1]));
    };
    globalThis.createImageBitmap = async (blob) => {
      const size = new Uint8Array(await blob.arrayBuffer())[0] === 2 ? 512 : 256;
      return { width: size, height: size, close() {} };
    };
    const coast = cliff("balanced"),
      uniforms = coast.material.uniforms;
    try {
      coast.setActive(true);
      coast.take({ revealed: true, running: true, cut: false });
      for (let i = 0; i < 8; i++) await tick();
      for (let i = 0; i < 4; i++) coast.take({ revealed: true, running: true, cut: true });
      assert.equal(requests.length, 2);
      assert.equal(uniforms.coastDetailOn.value, failed === "detail" ? 0 : 1);
      assert.equal(uniforms.coastAlbedoOn.value, failed === "albedo" ? 0 : 1);
      coast.setActive(false);
      coast.setActive(true);
      coast.take({ revealed: true, running: false });
      for (let i = 0; i < 2; i++) await tick();
      assert.equal(
        requests.length,
        2,
        "withdraw/reapply does not create optional network retry loops",
      );
    } finally {
      coast.dispose();
      globalThis.fetch = fetcher;
      globalThis.createImageBitmap = decoder;
    }
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
