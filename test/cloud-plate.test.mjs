import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { Group, PerspectiveCamera, Texture, NoColorSpace, LinearMipmapLinearFilter } from "three";
import {
  CLOUD_PLATE_LIMITS,
  createCloudPlate,
  loadCloudPlateTexture,
} from "../src/scene/cloud-plate.js";
import { cloudFieldGLSL, createEstateSkyMaterial } from "../src/scene/estate-sky.js";
import { createStarfield } from "../src/scene/starfield.js";

const uniforms = () => ({ uCloudMap: { value: null }, uCloudMix: { value: 0 } });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
function ownedTexture() {
  const counts = { disposed: 0, closed: 0 };
  const texture = new Texture({ width: 2, height: 1, close: () => counts.closed++ });
  texture.addEventListener("dispose", () => counts.disposed++);
  return { texture, counts };
}

test("cloud preparation is deduplicated and waits for a cut, including quality changes", async () => {
  const pending = deferred(),
    target = uniforms(),
    { texture, counts } = ownedTexture();
  let calls = 0;
  const owner = createCloudPlate({
    uniforms: target,
    load: () => {
      calls++;
      return pending.promise;
    },
  });
  const first = owner.prepare();
  assert.equal(owner.prepare(), first);
  assert.equal(owner.commit(), false);
  pending.resolve(texture);
  assert.equal(await first, true);
  assert.equal(calls, 1);
  assert.equal(owner.status, "ready");
  assert.equal(target.uCloudMap.value, null, "late artwork cannot appear in a moving shot");
  assert.equal(owner.commit(), true);
  assert.equal(target.uCloudMap.value, texture);
  assert.equal(target.uCloudMix.value, 1);
  assert.equal(owner.commit(), false);
  owner.setEnabled(false);
  assert.equal(target.uCloudMap.value, null);
  assert.equal(target.uCloudMix.value, 0);
  assert.equal(owner.commit(), false);
  owner.setEnabled(true);
  assert.equal(target.uCloudMix.value, 0, "a quality upgrade also waits for a cut");
  assert.equal(owner.commit(), true);
  assert.equal(owner.dispose(), true);
  assert.equal(owner.dispose(), false);
  assert.equal(await owner.prepare(), false);
  assert.equal(owner.commit(), false);
  assert.deepEqual(counts, { disposed: 1, closed: 1 });
  assert.equal(target.uCloudMap.value, null);
});

test("sky replacement restores borrowed uniforms and never frees a borrowed texture", async () => {
  const first = uniforms(),
    second = uniforms(),
    borrowed = ownedTexture(),
    owned = ownedTexture();
  first.uCloudMap.value = borrowed.texture;
  first.uCloudMix.value = 0.25;
  const owner = createCloudPlate({ uniforms: first, load: async () => owned.texture });
  await owner.prepare();
  owner.commit();
  assert.equal(owner.setTarget(second), true);
  assert.equal(first.uCloudMap.value, borrowed.texture);
  assert.equal(first.uCloudMix.value, 0.25);
  assert.equal(second.uCloudMix.value, 0);
  owner.commit();
  owner.dispose();
  assert.equal(second.uCloudMap.value, null);
  assert.equal(second.uCloudMix.value, 0);
  assert.deepEqual(borrowed.counts, { disposed: 0, closed: 0 });
  assert.deepEqual(owned.counts, { disposed: 1, closed: 1 });
  borrowed.texture.dispose();
  borrowed.texture.image.close();
});

test("a decode completing after cancellation is released without rebinding the sky", async () => {
  const pending = deferred(),
    target = uniforms(),
    owned = ownedTexture();
  let signal;
  const owner = createCloudPlate({
    uniforms: target,
    load: (_url, next) => {
      signal = next;
      return pending.promise;
    },
  });
  const preparing = owner.prepare();
  await Promise.resolve();
  owner.dispose();
  assert.equal(signal.aborted, true);
  pending.resolve(owned.texture);
  assert.equal(await preparing, false);
  assert.equal(owner.status, "disposed");
  assert.equal(target.uCloudMix.value, 0);
  assert.deepEqual(owned.counts, { disposed: 1, closed: 1 });
});

test("failure and the bounded timeout retain the procedural fallback without retry loops", async () => {
  let expire,
    delay,
    cleared = 0,
    calls = 0;
  const target = uniforms();
  const owner = createCloudPlate({
    uniforms: target,
    scheduleTimeout(task, ms) {
      expire = task;
      delay = ms;
      return 7;
    },
    cancelTimeout(ticket) {
      assert.equal(ticket, 7);
      cleared++;
    },
    load: (_url, signal) =>
      new Promise((_resolve, reject) => {
        calls++;
        signal.addEventListener("abort", () => reject(new Error("timed out")), { once: true });
      }),
  });
  const preparing = owner.prepare();
  await Promise.resolve();
  assert.equal(delay, 4000);
  expire();
  assert.equal(await preparing, false);
  assert.equal(owner.status, "failed");
  assert.equal(owner.commit(), false);
  assert.equal(await owner.prepare(), false);
  assert.equal(calls, 1);
  assert.equal(cleared, 1);
  assert.equal(target.uCloudMix.value, 0);
  owner.dispose();
  assert.equal(cleared, 1);
});

test("the decoder bounds bytes and pixels, preserves alpha orientation, and closes rejected bitmaps", async () => {
  let decoded = 0,
    closed = 0;
  const controller = new AbortController();
  const decode = async (_blob, options) => {
    decoded++;
    assert.equal(options.premultiplyAlpha, "none");
    assert.equal(options.imageOrientation, "none");
    return { width: 1774, height: 887, close: () => closed++ };
  };
  const fetchImpl = async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 });
  const texture = await loadCloudPlateTexture("/cloud.webp", controller.signal, {
    fetchImpl,
    decode,
  });
  assert.equal(
    texture.colorSpace,
    NoColorSpace,
    "the plate matches the display-referred artistic sky",
  );
  assert.equal(texture.flipY, false);
  assert.equal(texture.minFilter, LinearMipmapLinearFilter);
  assert.equal(decoded, 1);
  texture.dispose();
  texture.image.close();
  assert.equal(closed, 1);
  for (const fetchBad of [
    async () => new Response(null, { status: 404 }),
    async () =>
      new Response(new Uint8Array([1]), {
        headers: { "content-length": CLOUD_PLATE_LIMITS.bytes + 1 },
      }),
    async () => new Response(new Uint8Array(CLOUD_PLATE_LIMITS.bytes + 1)),
  ]) {
    await assert.rejects(
      loadCloudPlateTexture("/bad", controller.signal, { fetchImpl: fetchBad, decode }),
    );
  }
  assert.equal(decoded, 1, "bad responses are rejected before decoding");
  await assert.rejects(
    loadCloudPlateTexture("/too-large", controller.signal, {
      fetchImpl,
      decode: async () => ({ width: 2049, height: 1024, close: () => closed++ }),
    }),
  );
  assert.equal(closed, 2);
  controller.abort();
  await assert.rejects(
    loadCloudPlateTexture("/cancelled", controller.signal, { fetchImpl, decode }),
  );
  assert.equal(closed, 3, "a late bitmap is closed even when its request ignored abort");
});

test("the stars borrow the actual plate and clock and never dispose either", async () => {
  const sky = createEstateSkyMaterial({ shellOpacity: 0.52 }),
    owned = ownedTexture();
  const stars = createStarfield({
    parent: new Group(),
    camera: new PerspectiveCamera(),
    sky: sky.uniforms,
  });
  const owner = createCloudPlate({ uniforms: sky.uniforms, load: async () => owned.texture });
  await owner.prepare();
  owner.commit();
  for (const key of ["uCloudMap", "uCloudMix", "uCloudReshape"])
    assert.equal(stars.root.material.uniforms[key], sky.uniforms[key]);
  assert.equal(stars.root.material.uniforms.uSkyTime, sky.uniforms.uTime);
  stars.dispose();
  assert.deepEqual(owned.counts, { disposed: 0, closed: 0 });
  owner.dispose();
  sky.dispose();
  assert.deepEqual(owned.counts, { disposed: 1, closed: 1 });
});

test("the emitted cloud mask stays bounded and vanishes at the longitude seam and horizon", () => {
  const expression = cloudFieldGLSL()
    .match(/cp\.a=([^;]+);/)[1]
    .replaceAll("cp.a", "alpha")
    .replaceAll("vd", "storm")
    .replaceAll("cu.x", "u")
    .replaceAll("min(", "Math.min(");
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const smoothstep = (a, b, x) => {
    const t = clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };
  const mask = new Function(
    "alpha",
    "storm",
    "u",
    "horizonFade",
    "uClouds",
    "cloudText",
    "clamp",
    "smoothstep",
    `return ${expression}`,
  );
  for (const alpha of [-0.2, 0, 0.2, 0.7, 1, 1.2])
    for (const storm of [-1, -0.2, 0, 0.5, 1])
      for (const u of [0, 0.01, 0.1, 0.5, 0.9, 0.99, 1])
        for (const horizon of [0, 0.5, 1])
          for (const clouds of [0, 0.5, 1])
            for (const text of [0, 0.5, 1]) {
              const value = mask(alpha, storm, u, horizon, clouds, text, clamp, smoothstep);
              assert.ok(Number.isFinite(value) && value >= 0 && value <= 1);
              if (u === 0 || u === 1 || horizon === 0 || clouds === 0) assert.equal(value, 0);
            }
});

test("the emitted plate projection is finite at the zenith and across long-running drift", () => {
  const field = cloudFieldGLSL();
  const azimuth = field
    .match(/float ca=([^;]+);/)[1]
    .replace(/dot\(bv?,bv?\)/g, "(x*x+z*z)")
    .replace(/\bbv?\.x/g, "x")
    .replace(/\bbv?\.y/g, "z");
  const source = field.match(/vec2 cu=vec2\(([^;]+)\);/)[1];
  let depth = 0,
    split = -1;
  for (let i = 0; i < source.length; i++) {
    if (source[i] === "(") depth++;
    if (source[i] === ")") depth--;
    if (source[i] === "," && depth === 0) {
      split = i;
      break;
    }
  }
  assert.ok(split > 0);
  const expression = [source.slice(0, split), source.slice(split + 1)].map((value) =>
    value.replace(/\bbv?\.x/g, "x").replace(/\bbv?\.y/g, "z"),
  );
  const project = new Function(
    "x",
    "z",
    "hzS",
    "T",
    "fract",
    "atan",
    "asin",
    "clamp",
    `const ca=${azimuth}; return [${expression.join(",")}];`,
  );
  const fract = (x) => x - Math.floor(x),
    clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  // GLSL atan(0, 0) is undefined; JavaScript's defined zero must not hide that case.
  const atan = (y, x) => (x === 0 && y === 0 ? NaN : Math.atan2(y, x));
  for (const [x, z] of [
    [0, 0],
    [0, 1],
    [0, -1],
    [1, 0],
    [-1, 0],
    [-1e-6, 0],
    [1e-12, -1e-12],
  ])
    for (const height of [-1e-6, 0, 0.5, 1, 1 + 1e-6])
      for (const time of [0, 1 / 120, 60, 1e6]) {
        const uv = project(x, z, height, time, fract, atan, Math.asin, clamp);
        assert.ok(uv.every(Number.isFinite));
        assert.ok(uv[0] >= 0 && uv[0] < 1);
      }
});

test("the shipped plate has a real alpha channel and stays within its delivery and decode budgets", async () => {
  const data = await readFile(
    new URL("../images/materials/moonlit-clouds-1774.webp", import.meta.url),
  );
  assert.ok(data.byteLength <= CLOUD_PLATE_LIMITS.bytes);
  assert.equal(data.toString("ascii", 0, 4), "RIFF");
  assert.equal(data.toString("ascii", 8, 12), "WEBP");
  assert.equal(data.readUInt32LE(4) + 8, data.byteLength);
  let extended;
  for (let offset = 12; offset + 8 <= data.length;) {
    const size = data.readUInt32LE(offset + 4);
    if (data.toString("ascii", offset, offset + 4) === "VP8X")
      extended = data.subarray(offset + 8, offset + 8 + size);
    offset += 8 + size + (size % 2);
  }
  assert.ok(extended && extended[0] & 16, "RGBA, not a painted black background");
  const width = extended.readUIntLE(4, 3) + 1,
    height = extended.readUIntLE(7, 3) + 1;
  assert.deepEqual([width, height], [1774, 887]);
  assert.ok(width * height <= CLOUD_PLATE_LIMITS.pixels);
});
