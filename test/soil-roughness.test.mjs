import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  RepeatWrapping,
  Texture,
} from "three";
import {
  createSoilRoughness,
  loadSoilRoughnessImage,
  SOIL_ROUGHNESS,
  SOIL_ROUGHNESS_URL,
} from "../src/scene/soil-roughness.js";
import { createEarthDetail } from "../src/scene/filmic-earth.js";

const tick = () => new Promise((resolve) => setImmediate(resolve));
function bitmap(width = 512, height = width) {
  return {
    width,
    height,
    closed: 0,
    close() {
      this.closed++;
    },
  };
}
function rig(options = {}) {
  const order = [],
    applications = [],
    textures = [],
    statuses = [];
  let bound = null,
    requestedFrames = 0;
  const owner = createSoilRoughness({
    profile: { tier: "high" },
    anisotropy: 6,
    publish(texture) {
      bound = texture;
      applications.push(texture);
      order.push(texture ? "apply" : "reset");
    },
    report: ({ status }) => statuses.push(status),
    requestFrame() {
      requestedFrames++;
    },
    createTexture(image) {
      const texture = new Texture(image);
      texture.addEventListener("dispose", () => {
        assert.equal(bound, null, "restore the shader binding before disposing its texture");
        order.push("dispose");
      });
      textures.push(texture);
      return texture;
    },
    ...options,
  });
  return { owner, order, applications, textures, statuses, frames: () => requestedFrames };
}

test("the optional soil asset has the bounded, deterministic 512px data layout", async () => {
  const bytes = await readFile(
    new URL("../images/materials/slate-soil-roughness-512.webp", import.meta.url),
  );
  assert.equal(bytes.length, 3042);
  assert.ok(bytes.length <= SOIL_ROUGHNESS.maxBytes);
  assert.equal(bytes.subarray(0, 4).toString(), "RIFF");
  assert.equal(bytes.subarray(8, 12).toString(), "WEBP");
  assert.equal(bytes.subarray(12, 16).toString(), "VP8 ");
  assert.equal(bytes.readUInt16LE(26) & 0x3fff, SOIL_ROUGHNESS.size);
  assert.equal(bytes.readUInt16LE(28) & 0x3fff, SOIL_ROUGHNESS.size);
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    "1bfd73de6b856c482275fa572e7b3f360e46c06d1fbd2532481577fe8370ae3d",
  );
  assert.equal(SOIL_ROUGHNESS.mean, 0.9450162550982307);
  assert.equal(SOIL_ROUGHNESS.timeoutMs, 8000);
  assert.equal(SOIL_ROUGHNESS.maxBytes, 12 * 1024);
});

test("the soil loader bounds streamed bytes and keeps linear image data and orientation", async () => {
  const image = bitmap(),
    abort = new AbortController();
  let fetched = 0,
    decoded = 0;
  assert.equal(
    await loadSoilRoughnessImage("/soil.webp", {
      signal: abort.signal,
      fetcher: async (url, options) => {
        fetched++;
        assert.equal(url, "/soil.webp");
        assert.equal(options.signal, abort.signal);
        return new Response(new Uint8Array(17));
      },
      decode: async (blob, options) => {
        decoded++;
        assert.equal(blob.size, 17);
        assert.equal(blob.type, "image/webp");
        assert.deepEqual(options, {
          imageOrientation: "flipY",
          premultiplyAlpha: "none",
          colorSpaceConversion: "none",
        });
        return image;
      },
    }),
    image,
  );
  assert.deepEqual([fetched, decoded, image.closed], [1, 1, 0]);
});

test("HTTP, header and streamed body failures stop before soil decoding", async () => {
  for (const failure of ["http", "header", "body"]) {
    let cancelled = 0,
      decoded = 0;
    const stream = new ReadableStream({
      start(controller) {
        if (failure === "body") {
          controller.enqueue(new Uint8Array(SOIL_ROUGHNESS.maxBytes));
          controller.enqueue(new Uint8Array(1));
        }
      },
      cancel() {
        cancelled++;
      },
    });
    await assert.rejects(
      loadSoilRoughnessImage("/soil.webp", {
        fetcher: async () =>
          new Response(stream, {
            status: failure === "http" ? 404 : 200,
            headers:
              failure === "header" ? { "content-length": String(SOIL_ROUGHNESS.maxBytes + 1) } : {},
          }),
        decode() {
          decoded++;
        },
      }),
      /Soil roughness/,
    );
    assert.equal(cancelled, 1, failure);
    assert.equal(decoded, 0, failure);
  }
});

test("the optional map waits for reveal and an unseen cut, retains data and reuses it across quality steps", async () => {
  const image = bitmap();
  let loads = 0;
  const r = rig({
    loadImage: async (url, options) => {
      loads++;
      assert.equal(url, SOIL_ROUGHNESS_URL);
      assert.equal(options.maxBytes, SOIL_ROUGHNESS.maxBytes);
      return image;
    },
  });
  try {
    r.owner.setActive(true);
    await tick();
    assert.equal(loads, 0, "nothing before reveal");
    r.owner.update({ revealed: true });
    await tick();
    assert.equal(loads, 1);
    assert.equal(r.frames(), 1, "a ready map requests one frame, including while paused");
    assert.equal(r.applications.length, 0, "decode alone cannot change the visible shot");
    assert.equal(r.owner.update(), false);
    assert.equal(r.owner.update({ cut: true }), true);
    const texture = r.applications[0];
    assert.equal(texture.image, image);
    assert.equal(texture.colorSpace, NoColorSpace);
    assert.equal(texture.wrapS, RepeatWrapping);
    assert.equal(texture.wrapT, RepeatWrapping);
    assert.equal(texture.minFilter, LinearMipmapLinearFilter);
    assert.equal(texture.magFilter, LinearFilter);
    assert.equal(texture.generateMipmaps, true);
    assert.equal(texture.flipY, false);
    assert.equal(texture.anisotropy, 6);
    assert.equal(image.closed, 0, "retain upload data for context restoration");
    r.owner.applyQuality({ tier: "balanced" }, { assetTier: "high" });
    r.owner.applyQuality({ tier: "low" }, { assetTier: "high" });
    r.owner.setActive(false);
    assert.equal(r.applications.at(-1), null);
    assert.equal(image.closed, 0, "inactive cached data remains owned");
    r.owner.setActive(true);
    assert.equal(r.owner.update(), false);
    assert.equal(r.owner.update({ still: true }), true);
    assert.equal(r.applications.at(-1), texture);
    assert.equal(loads, 1);
  } finally {
    r.owner.dispose();
  }
  assert.equal(image.closed, 1);
  assert.deepEqual(r.order.slice(-2), ["reset", "dispose"]);
  assert.equal(r.owner.dispose(), false);
});

test("low startup and disabled comparisons never request optional soil data", async () => {
  for (const options of [{ profile: { tier: "low" } }, { disabled: true }]) {
    let loads = 0;
    const r = rig({
      ...options,
      loadImage: async () => {
        loads++;
        return bitmap();
      },
    });
    r.owner.setActive(true);
    r.owner.update({ revealed: true, still: true });
    r.owner.applyQuality({ tier: "high" });
    await tick();
    assert.equal(loads, 0);
    assert.equal(r.applications.length, 0);
    r.owner.dispose();
  }
});

test("timeout aborts the optional request and closes an ignored late image without allocation", async () => {
  let expire, resolve, signal, delay;
  const r = rig({
    setTimer(fn, ms) {
      expire = fn;
      delay = ms;
      return 1;
    },
    clearTimer() {},
    loadImage: (_, options) => {
      signal = options.signal;
      return new Promise((done) => {
        resolve = done;
      });
    },
  });
  r.owner.setActive(true);
  r.owner.update({ revealed: true });
  await tick();
  assert.equal(delay, 8000);
  expire();
  assert.equal(signal.aborted, true);
  assert.equal(r.statuses.at(-1), "fallback");
  const image = bitmap();
  resolve(image);
  await tick();
  assert.equal(image.closed, 1);
  assert.equal(r.textures.length, 0);
  assert.equal(r.owner.update({ still: true }), false);
  r.owner.dispose();
});

test("withdrawal cancels pending data and a fresh activation cannot adopt the stale generation", async () => {
  const pending = [];
  const r = rig({
    loadImage: (_, { signal }) =>
      new Promise((resolve) => {
        pending.push({ signal, resolve });
      }),
  });
  r.owner.setActive(true);
  r.owner.update({ revealed: true });
  await tick();
  r.owner.setActive(false);
  assert.equal(pending[0].signal.aborted, true);
  r.owner.setActive(true);
  await tick();
  const stale = bitmap(),
    current = bitmap();
  pending[0].resolve(stale);
  pending[1].resolve(current);
  await tick();
  assert.equal(stale.closed, 1);
  assert.equal(current.closed, 0);
  assert.equal(r.textures.length, 1);
  r.owner.update({ still: true });
  assert.equal(r.applications[0].image, current);
  r.owner.dispose();
  assert.equal(current.closed, 1);
});

test("invalid dimensions, failed allocation and rejected binding release optional data", async () => {
  for (const failure of ["dimensions", "allocation", "binding"]) {
    const image = bitmap(failure === "dimensions" ? 1024 : 512),
      r = rig({
        loadImage: async () => image,
        ...(failure === "allocation"
          ? {
              createTexture() {
                throw Error("allocation");
              },
            }
          : {}),
        ...(failure === "binding"
          ? {
              publish(texture) {
                if (texture) throw Error("binding");
              },
            }
          : {}),
      });
    r.owner.setActive(true);
    r.owner.update({ revealed: true });
    await tick();
    assert.equal(r.owner.update({ still: true }), false);
    assert.equal(r.statuses.at(-1), "fallback");
    assert.equal(image.closed, 1, failure);
    assert.equal(r.owner.update({ still: true }), false);
    r.owner.dispose();
    assert.equal(image.closed, 1, "disposal does not free the failed bitmap twice");
  }
});

test("disposing a pending optional request aborts it and releases a late decode", async () => {
  let resolve, signal;
  const r = rig({
    loadImage: (_, options) => {
      signal = options.signal;
      return new Promise((done) => {
        resolve = done;
      });
    },
  });
  r.owner.setActive(true);
  r.owner.update({ revealed: true });
  await tick();
  r.owner.dispose();
  assert.equal(signal.aborted, true);
  const image = bitmap();
  resolve(image);
  await tick();
  assert.equal(image.closed, 1);
  assert.equal(r.textures.length, 0);
});

test("optional roughness failure never blocks or resets the required slate set", async () => {
  const published = [],
    soil = [],
    statuses = [];
  let restored = 0,
    soilLoads = 0;
  const detail = createEarthDetail({
    profile: { tier: "high" },
    publish: (value) => published.push(value),
    restore() {
      restored++;
    },
    publishSoilRoughness: (texture) => soil.push(texture),
    report: ({ status }) => statuses.push(status),
    loadImage: async (url) => bitmap(url.includes("detail") ? 512 : 1024),
    loadSoilImage: async () => {
      soilLoads++;
      throw Error("optional 404");
    },
    createCanvas: () => ({ width: 0, height: 0, getContext: () => ({ drawImage() {} }) }),
  });
  try {
    detail.setActive(true);
    detail.update({ revealed: true, still: true });
    await tick();
    assert.equal(soilLoads, 1);
    assert.equal(published.length, 1);
    assert.equal(statuses.at(-1), "ready");
    assert.equal(soil.length, 0);
    assert.equal(
      published[0].roughnessMap,
      null,
      "the soil channel never becomes global roughness",
    );
    assert.equal(restored, 1, "only the normal required-map transaction restored its old binding");
    detail.update({ still: true });
    assert.equal(published.length, 1);
    assert.equal(restored, 1);
  } finally {
    detail.dispose();
  }
});

test("an unresolved optional map cannot delay the required maps and binds independently on a still frame", async () => {
  const published = [],
    soil = [];
  let resolve;
  const detail = createEarthDetail({
    profile: { tier: "balanced" },
    publish: (maps) => published.push(maps),
    restore() {},
    publishSoilRoughness: (texture) => soil.push(texture),
    loadImage: async () => bitmap(),
    loadSoilImage: () =>
      new Promise((done) => {
        resolve = done;
      }),
    createCanvas: () => ({ width: 0, height: 0, getContext: () => ({ drawImage() {} }) }),
  });
  detail.setActive(true);
  detail.update({ revealed: true });
  await tick();
  assert.equal(published.length, 1, "the five-map transaction does not await optional data");
  const image = bitmap();
  resolve(image);
  await tick();
  assert.equal(soil.length, 0);
  assert.equal(detail.update({ still: true }), true);
  assert.equal(soil.length, 1);
  assert.equal(soil[0].image, image);
  assert.equal(published.length, 1, "binding does not republish or replace the required map set");
  detail.setActive(false);
  assert.equal(soil.at(-1), null);
  detail.dispose();
  assert.equal(image.closed, 1);
});
