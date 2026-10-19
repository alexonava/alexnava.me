import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  RepeatWrapping,
  Texture,
} from "three";
import {
  COAST_DETAIL,
  COAST_MATERIAL_URL,
  createCoastDetail,
  loadCoastImage,
} from "../src/scene/coast-detail.js";

const tick = () => new Promise((resolve) => setImmediate(resolve));
function image(width = 256, height = 256) {
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
  const statuses = [],
    textures = [],
    applications = [],
    order = [];
  let bound = null;
  const controller = createCoastDetail({
    apply(texture) {
      bound = texture;
      applications.push(texture);
      order.push("apply");
    },
    reset() {
      bound = null;
      order.push("reset");
    },
    onStatus: ({ status }) => statuses.push(status),
    createTexture(bitmap) {
      const texture = new Texture(bitmap);
      texture.addEventListener("dispose", () => {
        assert.equal(bound, null, "unbind the optional texture before freeing it");
        order.push("dispose");
      });
      textures.push(texture);
      return texture;
    },
    ...options,
  });
  return { controller, statuses, textures, applications, order };
}

test("the packed coast asset is a bounded 256px WebP data map", async () => {
  const bytes = await readFile(
    new URL("../images/materials/coast-detail-256.webp", import.meta.url),
  );
  assert.ok(bytes.length > 0 && bytes.length <= COAST_DETAIL.maxBytes);
  assert.equal(bytes.subarray(0, 4).toString(), "RIFF");
  assert.equal(bytes.subarray(8, 12).toString(), "WEBP");
  const kind = bytes.subarray(12, 16).toString();
  let width, height;
  if (kind === "VP8 ") {
    width = bytes.readUInt16LE(26) & 0x3fff;
    height = bytes.readUInt16LE(28) & 0x3fff;
  } else if (kind === "VP8L") {
    const bits = bytes.readUInt32LE(21);
    width = (bits & 0x3fff) + 1;
    height = ((bits >>> 14) & 0x3fff) + 1;
  } else {
    assert.equal(kind, "VP8X");
    width = bytes.readUIntLE(24, 3) + 1;
    height = bytes.readUIntLE(27, 3) + 1;
  }
  assert.deepEqual([width, height], [COAST_DETAIL.size, COAST_DETAIL.size]);
  assert.equal(COAST_DETAIL.tile, 6.56, "the source's two metres in estate units");
});

test("the coast loader bounds a streamed response and decodes without color conversion", async () => {
  const bitmap = image(),
    abort = new AbortController();
  let fetched = 0,
    decoded = 0;
  const actual = await loadCoastImage("/coast.webp", {
    signal: abort.signal,
    fetcher: async (url, options) => {
      fetched++;
      assert.equal(url, "/coast.webp");
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
      return bitmap;
    },
  });
  assert.equal(actual, bitmap);
  assert.deepEqual([fetched, decoded, bitmap.closed], [1, 1, 0]);
});

test("HTTP failure, oversized headers and streamed overruns cancel before decoding", async () => {
  for (const failure of ["http", "header", "body"]) {
    let cancelled = 0,
      decoded = 0;
    const body = new ReadableStream({
      start(stream) {
        if (failure === "body") {
          stream.enqueue(new Uint8Array(COAST_DETAIL.maxBytes));
          stream.enqueue(new Uint8Array(1));
        }
      },
      cancel() {
        cancelled++;
      },
    });
    await assert.rejects(
      loadCoastImage("/coast.webp", {
        fetcher: async () =>
          new Response(body, {
            status: failure === "http" ? 404 : 200,
            headers:
              failure === "header" ? { "content-length": String(COAST_DETAIL.maxBytes + 1) } : {},
          }),
        decode: () => {
          decoded++;
        },
      }),
      /Coast detail/,
    );
    assert.equal(cancelled, 1, failure);
    assert.equal(decoded, 0, failure);
  }
});

test("detail starts after reveal only, stages until an unseen frame and keeps the bitmap for restoration", async () => {
  const bitmap = image();
  let loads = 0;
  const r = rig({
    loadImage: async (url) => {
      assert.equal(url, COAST_MATERIAL_URL);
      loads++;
      return bitmap;
    },
  });
  try {
    r.controller.setActive(true);
    await tick();
    assert.equal(loads, 0, "nothing before the first scene reveal");
    r.controller.setRevealed();
    r.controller.setRevealed();
    r.controller.setActive(true);
    await tick();
    assert.equal(loads, 1);
    assert.equal(r.textures.length, 1);
    assert.equal(r.applications.length, 0, "decode alone cannot change a visible shot");
    assert.equal(r.controller.take({ running: true, cut: false }), false);
    assert.equal(r.controller.take({ running: true, cut: true }), true);
    const [texture] = r.applications;
    assert.equal(texture.image, bitmap);
    assert.equal(texture.colorSpace, NoColorSpace);
    assert.equal(texture.wrapS, RepeatWrapping);
    assert.equal(texture.wrapT, RepeatWrapping);
    assert.equal(texture.minFilter, LinearMipmapLinearFilter);
    assert.equal(texture.magFilter, LinearFilter);
    assert.equal(texture.generateMipmaps, true);
    assert.equal(texture.flipY, false);
    assert.equal(bitmap.closed, 0, "the texture retains upload data across a lost context");
    assert.equal(r.controller.take({ running: false }), false, "one commit for this activation");
    assert.deepEqual(r.statuses, ["loading", "ready"]);
  } finally {
    assert.equal(r.controller.dispose(), true);
    assert.equal(r.controller.dispose(), false);
  }
  assert.equal(bitmap.closed, 1);
  assert.deepEqual(r.order, ["apply", "reset", "dispose"]);
});

test("withdrawal reuses one cached startup asset on a new cut, including adaptive tier changes", async () => {
  const bitmap = image();
  let loads = 0;
  const r = rig({
    tier: "high",
    loadImage: async () => {
      loads++;
      return bitmap;
    },
  });
  try {
    r.controller.setRevealed();
    r.controller.setActive(true);
    await tick();
    assert.equal(r.controller.take({ running: false }), true);
    r.controller.applyQuality({ tier: "balanced" }, { assetTier: "high" });
    r.controller.applyQuality({ tier: "high" }, { assetTier: "high" });
    r.controller.setActive(false);
    assert.equal(bitmap.closed, 0);
    assert.deepEqual(r.order, ["apply", "reset"]);
    r.controller.setActive(true);
    await tick();
    assert.equal(loads, 1);
    assert.equal(r.controller.take({ running: true, cut: false }), false);
    assert.equal(r.controller.take({ running: true, cut: true }), true);
    assert.equal(r.applications[0], r.applications[1]);
  } finally {
    r.controller.dispose();
  }
  assert.equal(bitmap.closed, 1);
});

test("a cancelled generation closes a late bitmap and reactivation starts just one fresh request", async () => {
  const requests = [],
    r = rig({
      loadImage: (url, options) => new Promise((resolve) => requests.push({ ...options, resolve })),
    });
  const old = image(),
    next = image();
  try {
    r.controller.take({ revealed: true });
    assert.equal(requests.length, 0, "reveal alone does not activate detail");
    r.controller.setActive(true);
    await tick();
    r.controller.setActive(false);
    assert.equal(requests[0].signal.aborted, true);
    r.controller.setActive(true);
    r.controller.setActive(true);
    r.controller.setRevealed();
    await tick();
    assert.equal(requests.length, 2);
    requests[0].resolve(old);
    requests[1].resolve(next);
    await tick();
    assert.equal(old.closed, 1);
    assert.equal(r.textures.length, 1, "a stale result never allocates a texture");
    assert.equal(r.controller.take({ running: false }), true);
    assert.equal(r.applications[0].image, next);
  } finally {
    r.controller.dispose();
  }
  assert.equal(next.closed, 1);
});

test("disposing pending or staged detail cancels and frees resources without a commit", async () => {
  for (const phase of ["pending", "staged"]) {
    let finish, signal;
    const bitmap = image(),
      r = rig({
        loadImage: (url, options) => {
          signal = options.signal;
          return new Promise((resolve) => {
            finish = resolve;
          });
        },
      });
    r.controller.setActive(true);
    r.controller.setRevealed();
    await tick();
    if (phase === "staged") {
      finish(bitmap);
      await tick();
    }
    r.controller.dispose();
    if (phase === "pending") {
      assert.equal(signal.aborted, true);
      finish(bitmap);
      await tick();
    }
    assert.equal(bitmap.closed, 1, phase);
    assert.equal(r.applications.length, 0);
    assert.equal(r.controller.take({ running: false }), false);
    r.controller.setActive(true);
    r.controller.setRevealed();
    assert.equal(r.controller.dispose(), false);
  }
});

test("failure and invalid dimensions remain procedural without an automatic network retry", async () => {
  for (const bitmap of [null, image(255, 256), image(256, 512)]) {
    let loads = 0;
    const r = rig({
      loadImage: async () => {
        loads++;
        if (!bitmap) throw new Error("offline");
        return bitmap;
      },
    });
    try {
      r.controller.setActive(true);
      r.controller.setRevealed();
      await tick();
      assert.deepEqual(r.statuses, ["loading", "fallback"]);
      assert.equal(r.textures.length, 0);
      assert.equal(bitmap?.closed ?? 1, 1);
      r.controller.applyQuality({ tier: "balanced" });
      r.controller.setActive(false);
      r.controller.setActive(true);
      assert.equal(r.controller.take({ running: false }), false);
      await tick();
      assert.equal(loads, 1);
    } finally {
      r.controller.dispose();
    }
  }
});

test("the bounded timeout aborts and ignores late decode completion", async () => {
  let finish, signal;
  const bitmap = image(),
    r = rig({
      timeoutMs: 5,
      loadImage: (url, options) => {
        signal = options.signal;
        return new Promise((resolve) => {
          finish = resolve;
        });
      },
    });
  r.controller.setRevealed();
  r.controller.setActive(true);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(signal.aborted, true);
  assert.deepEqual(r.statuses, ["loading", "fallback"]);
  finish(bitmap);
  await tick();
  assert.equal(bitmap.closed, 1);
  assert.equal(r.textures.length, 0);
  assert.equal(r.controller.take({ running: false }), false);
  r.controller.dispose();
});

test("an apply failure restores procedural bindings before releasing the optional asset", async () => {
  const bitmap = image(),
    r = rig({
      loadImage: async () => bitmap,
      apply() {
        throw new Error("upload");
      },
    });
  r.controller.setActive(true);
  r.controller.setRevealed();
  await tick();
  assert.equal(r.controller.take({ running: false }), false);
  assert.equal(bitmap.closed, 1);
  assert.deepEqual(r.order, ["reset", "dispose"]);
  assert.deepEqual(r.statuses, ["loading", "fallback"]);
  r.controller.dispose();
  assert.equal(bitmap.closed, 1);
});

test("a low startup tier never fetches the optional data map", async () => {
  let loads = 0;
  const r = rig({
    tier: "low",
    loadImage: async () => {
      loads++;
      return image();
    },
  });
  r.controller.setActive(true);
  r.controller.setRevealed();
  r.controller.applyQuality({ tier: "high" });
  assert.equal(r.controller.take({ running: false }), false);
  await tick();
  assert.equal(loads, 0);
  r.controller.dispose();
});
