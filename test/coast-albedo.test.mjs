import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { NoColorSpace, SRGBColorSpace, Texture } from "three";
import {
  COAST_ALBEDO,
  COAST_ALBEDO_URL,
  createCoastAlbedo,
  createCoastDetail,
  loadCoastImage,
} from "../src/scene/coast-detail.js";

const tick = () => new Promise((resolve) => setImmediate(resolve));
const bitmap = (size = 512) => ({
  width: size,
  height: size,
  closed: 0,
  close() {
    this.closed++;
  },
});
function rig(options = {}) {
  const applied = [],
    statuses = [],
    order = [];
  let bound = null;
  const controller = createCoastAlbedo({
    apply(texture) {
      bound = texture;
      applied.push(texture);
      order.push("apply");
    },
    reset() {
      bound = null;
      order.push("reset");
    },
    createTexture(image) {
      const texture = new Texture(image);
      texture.addEventListener("dispose", () => {
        assert.equal(bound, null);
        order.push("dispose");
      });
      return texture;
    },
    onStatus({ status }) {
      statuses.push(status);
    },
    ...options,
  });
  controller.setActive(true);
  controller.setRevealed();
  return { controller, applied, statuses, order };
}

test("photographic coast colour has one bounded 512px source at the existing physical scale", async () => {
  const bytes = await readFile(
    new URL("../images/materials/coast-albedo-512.webp", import.meta.url),
  );
  assert.equal(bytes.toString("ascii", 0, 4), "RIFF");
  assert.equal(bytes.toString("ascii", 8, 12), "WEBP");
  assert.ok(bytes.length <= COAST_ALBEDO.maxBytes);
  const kind = bytes.toString("ascii", 12, 16);
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
  assert.deepEqual([width, height], [COAST_ALBEDO.size, COAST_ALBEDO.size]);
  assert.equal(COAST_ALBEDO.size, 512);
  assert.equal(COAST_ALBEDO.tile, 6.56);
  assert.ok(COAST_ALBEDO.mean.every((value) => value > 0.03 && value < 0.08));
});

test("sRGB colour stages on a cut, reuses the startup texture across quality and activation, then unbinds before disposal", async () => {
  const image = bitmap();
  let loads = 0;
  const r = rig({
    loadImage: async (url, { maxBytes }) => {
      assert.equal(url, COAST_ALBEDO_URL);
      assert.equal(maxBytes, COAST_ALBEDO.maxBytes);
      loads++;
      return image;
    },
  });
  await tick();
  assert.equal(r.controller.take({ running: true }), false);
  assert.equal(r.controller.take({ running: true, cut: true }), true);
  const [texture] = r.applied;
  assert.equal(texture.colorSpace, SRGBColorSpace);
  assert.equal(texture.generateMipmaps, true);
  assert.equal(texture.flipY, false);
  r.controller.applyQuality({ tier: "balanced" });
  r.controller.setActive(false);
  r.controller.setActive(true);
  await tick();
  assert.equal(r.controller.take({ running: false }), true);
  assert.equal(r.applied[1], texture);
  assert.equal(loads, 1);
  assert.equal(r.controller.dispose(), true);
  assert.equal(r.controller.dispose(), false);
  assert.equal(image.closed, 1);
  assert.deepEqual(r.order, ["apply", "reset", "apply", "reset", "dispose"]);
});

test("colour and normal detail fail independently and use different colour spaces", async () => {
  const detailImage = bitmap(256);
  let detailTexture;
  const detail = createCoastDetail({
    apply(texture) {
      detailTexture = texture;
    },
    reset() {},
    loadImage: async () => detailImage,
  });
  const colour = rig({
    loadImage: async () => {
      throw new Error("offline");
    },
  });
  detail.setActive(true);
  detail.setRevealed();
  await tick();
  assert.equal(colour.controller.take({ running: false }), false);
  assert.equal(detail.take({ running: false }), true);
  assert.equal(detailTexture.colorSpace, NoColorSpace);
  assert.deepEqual(colour.statuses, ["loading", "fallback"]);
  detail.dispose();
  colour.controller.dispose();
  assert.equal(detailImage.closed, 1);
});

test("invalid colour dimensions are closed, remain procedural and never retry automatically", async () => {
  for (const size of [0, 256, 1024]) {
    const image = bitmap(size);
    let loads = 0;
    const r = rig({
      loadImage: async () => {
        loads++;
        return image;
      },
    });
    await tick();
    assert.equal(r.controller.take({ running: false }), false);
    assert.equal(image.closed, 1);
    r.controller.setActive(false);
    r.controller.setActive(true);
    await tick();
    assert.equal(loads, 1);
    r.controller.dispose();
  }
});

test("cancelled or disposed colour generations reject late images and cancellation can reactivate once", async () => {
  const requests = [];
  const r = rig({
    loadImage: (url, options) => new Promise((resolve) => requests.push({ ...options, resolve })),
  });
  await tick();
  r.controller.setActive(false);
  assert.equal(requests[0].signal.aborted, true);
  r.controller.setActive(true);
  await tick();
  const stale = bitmap(),
    current = bitmap();
  requests[0].resolve(stale);
  requests[1].resolve(current);
  await tick();
  assert.equal(stale.closed, 1);
  assert.equal(r.controller.take({ running: false }), true);
  r.controller.dispose();
  assert.equal(current.closed, 1);
  let finish;
  const pending = rig({
    loadImage: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  await tick();
  pending.controller.dispose();
  const late = bitmap();
  finish(late);
  await tick();
  assert.equal(late.closed, 1);
  assert.equal(pending.applied.length, 0);
});

test("colour streaming enforces its own byte cap and timeout remains a procedural fallback", async () => {
  let decoded = 0;
  await assert.rejects(
    loadCoastImage("/colour.webp", {
      maxBytes: COAST_ALBEDO.maxBytes,
      fetcher: async () => new Response(new Uint8Array(COAST_ALBEDO.maxBytes + 1)),
      decode: () => {
        decoded++;
      },
    }),
    /too large/,
  );
  assert.equal(decoded, 0);
  let finish, signal;
  const r = rig({
    timeoutMs: 5,
    loadImage: (url, options) => {
      signal = options.signal;
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(signal.aborted, true);
  assert.deepEqual(r.statuses, ["loading", "fallback"]);
  const late = bitmap();
  finish(late);
  await tick();
  assert.equal(late.closed, 1);
  assert.equal(r.controller.take({ running: false }), false);
  r.controller.dispose();
});
