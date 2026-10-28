import {
  ClampToEdgeWrapping,
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  RepeatWrapping,
  Texture,
} from "three";

// The sky's plates: the cel sky's own banks, lit in volume and baked all the way round
// (u = azimuth / 2pi), one lit by the moon and one for each shot that shows its own sun
// (directed-shots.js `sun.plate`). The moon's loads first; the suns' follow in the
// background, each only ever shown from a cut.
export const CLOUD_PLATES = Object.freeze(["moon", "close-up", "root-and-lantern", "broken-coast"]);
export const CLOUD_PLATE_LIMITS = Object.freeze({
  bytes: 640 * 1024,
  pixels: 4096 * 1024,
  timeout: 8000,
});
export const CLOUD_PLATE_BALANCED_LIMITS = Object.freeze({
  bytes: 224 * 1024,
  pixels: 2048 * 512,
  timeout: 8000,
});
const defaultUrls =
  typeof __BABEL_CLOUD_PLATE_URLS__ === "string"
    ? JSON.parse(__BABEL_CLOUD_PLATE_URLS__)
    : Object.fromEntries(
        ["high", "balanced"].map((tier) => [
          tier,
          Object.fromEntries(
            CLOUD_PLATES.map((key) => [
              key,
              `/images/materials/cel-sky-${key}${tier === "balanced" ? "-balanced" : ""}.webp`,
            ]),
          ),
        ]),
      );

function release(texture) {
  if (!texture) return;
  texture.dispose();
  texture.image?.close?.();
}

export async function loadCloudPlateTexture(
  url,
  signal,
  {
    fetchImpl = globalThis.fetch,
    decode = globalThis.createImageBitmap,
    limits = CLOUD_PLATE_LIMITS,
  } = {},
) {
  const response = await fetchImpl(url, { signal });
  if (!response.ok || Number(response.headers.get("content-length")) > limits.bytes)
    throw new Error("Cloud plate unavailable or over budget");
  const bytes = await response.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength > limits.bytes)
    throw new Error("Cloud plate byte budget");
  const image = await decode(new Blob([bytes], { type: "image/webp" }), {
    imageOrientation: "from-image",
    premultiplyAlpha: "none",
    colorSpaceConversion: "none",
  });
  if (
    signal.aborted ||
    !Number.isInteger(image.width) ||
    !Number.isInteger(image.height) ||
    image.width <= 0 ||
    image.height <= 0 ||
    image.width * image.height > limits.pixels
  ) {
    image.close();
    throw new Error("Cloud plate cancelled or over pixel budget");
  }
  const texture = new Texture(image);
  // The artistic sky is display-referred, like filmSky(), outside the surface tone curve.
  texture.colorSpace = NoColorSpace;
  texture.flipY = false;
  // All the way round: it wraps at its seam; never past the zenith or the horizon.
  texture.wrapS = RepeatWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.needsUpdate = true;
  return texture;
}

// Optional artwork: preparation never blocks the scene. A decoded plate waits for the
// hidden preparation frames or the next tour cut, so a late response cannot pop into a
// moving shot. Only this owner frees the textures and their decoded bitmaps.
export function createCloudPlate({
  uniforms,
  tier = "high",
  load = (url, signal) =>
    loadCloudPlateTexture(url, signal, {
      limits: tier === "balanced" ? CLOUD_PLATE_BALANCED_LIMITS : CLOUD_PLATE_LIMITS,
    }),
  urls = defaultUrls,
  scheduleTimeout = setTimeout,
  cancelTimeout = clearTimeout,
} = {}) {
  let target = null,
    borrowed = null,
    pending = null,
    background = null,
    shown = null;
  const textures = new Map();
  const requests = new Set();
  const selectedUrls = urls[tier] ?? urls;
  let state = "idle",
    enabled = true,
    disposed = false;
  function restore() {
    if (target) {
      target.uCloudMap.value = borrowed.plate;
      target.uCloudMix.value = borrowed.mix;
    }
    target = borrowed = null;
    shown = null;
  }
  function setTarget(next) {
    restore();
    if (disposed || !next?.uCloudMap || !next.uCloudMix) return false;
    target = next;
    borrowed = { plate: target.uCloudMap.value, mix: target.uCloudMix.value };
    target.uCloudMix.value = 0;
    return true;
  }
  // One plate, within its own timeout.
  function loadOne(key) {
    return new Promise((resolve) => {
      const abort = new AbortController();
      requests.add(abort);
      let timer = null,
        finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        cancelTimeout(timer);
        requests.delete(abort);
        resolve(textures.has(key));
      };
      abort.signal.addEventListener("abort", finish, { once: true });
      timer = scheduleTimeout(() => abort.abort(), CLOUD_PLATE_LIMITS.timeout);
      Promise.resolve()
        .then(() => load(selectedUrls[key], abort.signal))
        .then((texture) => {
          if (disposed || abort.signal.aborted) release(texture);
          else textures.set(key, texture);
        })
        .catch(() => {})
        .finally(() => {
          abort.signal.removeEventListener("abort", finish);
          finish();
        });
    });
  }
  setTarget(uniforms);
  return {
    setTarget,
    get status() {
      return disposed ? "disposed" : target?.uCloudMix.value > 0 ? "active" : state;
    },
    // The plates loaded so far.
    get loaded() {
      return [...textures.keys()];
    },
    // The key of the plate on the sky (null while none is).
    get shown() {
      return shown;
    },
    prepare() {
      if (pending) return pending;
      if (disposed || state !== "idle") return Promise.resolve(!disposed && state === "ready");
      state = "loading";
      // Only the opening's shared plate belongs to the preparation path.
      pending = loadOne("moon").then((ok) => {
        if (disposed) return false;
        state = ok ? "ready" : "failed";
        pending = null;
        return ok;
      });
      return pending;
    },
    startBackground(watchOpening = false) {
      if (disposed) return Promise.resolve();
      const order = watchOpening
        ? ["broken-coast", "close-up", "root-and-lantern"]
        : CLOUD_PLATES.slice(1);
      return (background ||= (pending ?? Promise.resolve()).then(() =>
        order
          .filter((key) => selectedUrls[key])
          .reduce((chain, key) => chain.then(() => !disposed && loadOne(key)), Promise.resolve()),
      ));
    },
    setEnabled(value) {
      enabled = Boolean(value);
      if (!enabled && target) {
        target.uCloudMix.value = 0;
        target.uCloudMap.value = borrowed.plate;
        shown = null;
      }
    },
    // Puts `key`'s plate on the sky (the moon's while a sun's has not loaded). Called only
    // where a change cannot show: hidden preparation and tour cuts. Returns whether it changed.
    commit(key = "moon") {
      if (disposed || !enabled || !target) return false;
      const want = textures.has(key) ? key : "moon";
      const texture = textures.get(want);
      if (!texture || (shown === want && target.uCloudMix.value === 1)) return false;
      target.uCloudMap.value = texture;
      target.uCloudMix.value = 1;
      shown = want;
      return true;
    },
    dispose() {
      if (disposed) return false;
      disposed = true;
      for (const request of requests) request.abort();
      restore();
      for (const texture of textures.values()) release(texture);
      textures.clear();
      return true;
    },
  };
}
