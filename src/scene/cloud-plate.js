import {
  ClampToEdgeWrapping,
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  Texture,
} from "three";

export const CLOUD_PLATE_LIMITS = Object.freeze({ bytes: 393216, pixels: 2097152, timeout: 4000 });
const cloudUrl =
  typeof __BABEL_CLOUD_PLATE_URL__ === "string"
    ? __BABEL_CLOUD_PLATE_URL__
    : "/images/materials/moonlit-clouds-1774.webp";

function release(texture) {
  if (!texture) return;
  texture.dispose();
  texture.image?.close?.();
}

export async function loadCloudPlateTexture(
  url,
  signal,
  { fetchImpl = globalThis.fetch, decode = globalThis.createImageBitmap } = {},
) {
  const response = await fetchImpl(url, { signal });
  if (!response.ok || Number(response.headers.get("content-length")) > CLOUD_PLATE_LIMITS.bytes)
    throw new Error("Cloud plate unavailable or over budget");
  const bytes = await response.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength > CLOUD_PLATE_LIMITS.bytes)
    throw new Error("Cloud plate byte budget");
  const image = await decode(new Blob([bytes], { type: "image/webp" }), {
    imageOrientation: "from-image",
    premultiplyAlpha: "none",
    colorSpaceConversion: "none",
  });
  if (signal.aborted || image.width * image.height > CLOUD_PLATE_LIMITS.pixels) {
    image.close();
    throw new Error("Cloud plate cancelled or over pixel budget");
  }
  const texture = new Texture(image);
  // The artistic sky is display-referred, like filmSky(), outside the surface tone curve.
  texture.colorSpace = NoColorSpace;
  texture.flipY = false;
  texture.wrapS = texture.wrapT = ClampToEdgeWrapping;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.needsUpdate = true;
  return texture;
}

// Optional artwork: preparation never blocks the scene. A decoded plate waits for
// the hidden preparation frames or the next tour cut, so a late response cannot pop
// into a moving shot. Only this owner frees the texture and its decoded bitmap.
export function createCloudPlate({
  uniforms,
  load = loadCloudPlateTexture,
  url = cloudUrl,
  scheduleTimeout = setTimeout,
  cancelTimeout = clearTimeout,
} = {}) {
  let target = null,
    borrowed = null,
    texture = null,
    pending = null,
    abort = null,
    timer = null;
  let state = "idle",
    enabled = true,
    disposed = false;
  function restore() {
    if (target) {
      target.uCloudMap.value = borrowed.plate;
      target.uCloudMix.value = borrowed.mix;
    }
    target = borrowed = null;
  }
  function setTarget(next) {
    restore();
    if (disposed || !next?.uCloudMap || !next.uCloudMix) return false;
    target = next;
    borrowed = { plate: target.uCloudMap.value, mix: target.uCloudMix.value };
    target.uCloudMix.value = 0;
    return true;
  }
  setTarget(uniforms);
  return {
    setTarget,
    get status() {
      return disposed ? "disposed" : target?.uCloudMix.value > 0 ? "active" : state;
    },
    prepare() {
      if (pending) return pending;
      if (disposed || state !== "idle") return Promise.resolve(!disposed && state === "ready");
      state = "loading";
      abort = new AbortController();
      timer = scheduleTimeout(() => abort.abort(), CLOUD_PLATE_LIMITS.timeout);
      pending = Promise.resolve()
        .then(() => load(url, abort.signal))
        .then((value) => {
          if (disposed || abort.signal.aborted) {
            release(value);
            if (!disposed) state = "failed";
            return false;
          }
          texture = value;
          state = "ready";
          return true;
        })
        .catch(() => {
          if (!disposed) state = "failed";
          return false;
        })
        .finally(() => {
          if (timer !== null) cancelTimeout(timer);
          timer = pending = null;
        });
      return pending;
    },
    setEnabled(value) {
      enabled = Boolean(value);
      if (!enabled && target) {
        target.uCloudMix.value = 0;
        target.uCloudMap.value = borrowed.plate;
      }
    },
    commit() {
      if (disposed || !enabled || !target || !texture || target.uCloudMix.value === 1) return false;
      target.uCloudMap.value = texture;
      target.uCloudMix.value = 1;
      return true;
    },
    dispose() {
      if (disposed) return false;
      disposed = true;
      abort?.abort();
      if (timer !== null) cancelTimeout(timer);
      timer = null;
      restore();
      release(texture);
      texture = null;
      return true;
    },
  };
}
