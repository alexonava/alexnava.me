import {
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  RepeatWrapping,
  SRGBColorSpace,
  Texture,
} from "three";

// Imported only by the lazy coastal owner. This URL never enters the entry's
// material manifest; one small data map serves every live startup tier.
export const COAST_MATERIAL_URL =
  typeof __BABEL_COAST_MATERIAL_URL__ !== "undefined"
    ? __BABEL_COAST_MATERIAL_URL__
    : "/images/materials/coast-detail-256.webp";
export const COAST_DETAIL = Object.freeze({
  size: 256,
  maxBytes: 48 * 1024,
  timeoutMs: 8000,
  tile: 6.56,
});
export const COAST_ALBEDO_URL =
  typeof __BABEL_COAST_ALBEDO_URL__ !== "undefined"
    ? __BABEL_COAST_ALBEDO_URL__
    : "/images/materials/coast-albedo-512.webp";
export const COAST_ALBEDO = Object.freeze({
  size: 512,
  maxBytes: 96 * 1024,
  timeoutMs: 8000,
  tile: COAST_DETAIL.tile,
  // Measured after encoding, in linear light; used to preserve the coast's
  // calibrated reflectance without baking the scan's exposure into the night.
  mean: Object.freeze([0.06094478945, 0.05268490379, 0.03892952341]),
});

// Count the streamed body as well as Content-Length; a bad/missing header
// cannot grow this optional download without bound.
export async function loadCoastImage(
  url,
  {
    signal,
    maxBytes = COAST_DETAIL.maxBytes,
    fetcher = globalThis.fetch,
    decode = globalThis.createImageBitmap,
  } = {},
) {
  const response = await fetcher(url, { signal });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error("Coast detail response");
  }
  if (Number(response.headers.get("content-length")) > maxBytes) {
    await response.body?.cancel();
    throw new Error("Coast detail too large");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Coast detail body unavailable");
  const chunks = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        throw new Error("Coast detail too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return decode(new Blob(chunks, { type: "image/webp" }), {
    imageOrientation: "flipY",
    premultiplyAlpha: "none",
    colorSpaceConversion: "none",
  });
}

export function createCoastDetail(options = {}) {
  return createCoastMaterial({
    ...options,
    url: COAST_MATERIAL_URL,
    settings: COAST_DETAIL,
    colorSpace: NoColorSpace,
  });
}

// Independent optional owners let colour survive a failed normal tile (and
// vice versa), without making either map part of the reveal's critical path.
export function createCoastAlbedo(options = {}) {
  return createCoastMaterial({
    ...options,
    url: COAST_ALBEDO_URL,
    settings: COAST_ALBEDO,
    colorSpace: SRGBColorSpace,
  });
}

function createCoastMaterial({
  url,
  settings,
  colorSpace,
  tier = "high",
  anisotropy = 4,
  apply,
  reset,
  onStatus = () => {},
  loadImage = loadCoastImage,
  createTexture = (image) => new Texture(image),
  timeoutMs = settings.timeoutMs,
} = {}) {
  let active = false,
    revealed = false,
    disposed = false,
    attempted = false,
    applied = false,
    generation = 0,
    pending = null,
    cached = null;
  const eligible = ["high", "balanced"].includes(tier),
    report = (status) => onStatus({ status, tier });
  function cancel() {
    generation++;
    if (!pending) return;
    clearTimeout(pending.timer);
    pending.abort.abort();
    pending = null;
    attempted = false;
  }
  function withdraw() {
    if (!applied) return;
    applied = false;
    reset();
  }
  function free() {
    if (!cached) return;
    cached.texture.dispose();
    cached.image.close?.();
    cached = null;
  }
  function start() {
    if (disposed || !active || !revealed || !eligible || attempted || cached) return;
    attempted = true;
    const current = ++generation,
      abort = new AbortController();
    const timer = setTimeout(() => {
      if (current !== generation || disposed) return;
      generation++;
      pending = null;
      abort.abort();
      report("fallback");
    }, timeoutMs);
    pending = { abort, timer };
    report("loading");
    Promise.resolve()
      .then(() => {
        if (current !== generation) throw new Error("Coast detail cancelled");
        return loadImage(url, { signal: abort.signal, maxBytes: settings.maxBytes });
      })
      .then(
        (image) => {
          if (current !== generation || disposed || !active) return image?.close?.();
          clearTimeout(timer);
          pending = null;
          let texture;
          try {
            if (image.width !== settings.size || image.height !== settings.size)
              throw new Error("Coast detail dimensions");
            texture = createTexture(image);
            texture.colorSpace = colorSpace;
            texture.wrapS = texture.wrapT = RepeatWrapping;
            texture.minFilter = LinearMipmapLinearFilter;
            texture.magFilter = LinearFilter;
            texture.generateMipmaps = true;
            texture.flipY = false; // ImageBitmap decoding already flips the rows.
            texture.anisotropy = anisotropy;
            texture.needsUpdate = true;
            cached = { texture, image };
          } catch {
            texture?.dispose();
            image?.close?.();
            report("fallback");
          }
        },
        () => {
          if (current !== generation || disposed) return;
          clearTimeout(timer);
          pending = null;
          report("fallback");
        },
      );
  }
  return {
    setActive(next) {
      if (disposed || active === Boolean(next)) return;
      active = Boolean(next);
      if (!active) {
        cancel();
        withdraw();
      } else start();
    },
    setRevealed() {
      if (disposed) return;
      revealed = true;
      start();
    },
    // Each fixed tile stays on the startup asset; adaptive tiers change no URL.
    applyQuality() {
      return false;
    },
    take({ revealed: shown = false, running = true, cut = false } = {}) {
      if (disposed) return false;
      if (shown) revealed = true;
      start();
      if (!active || !cached || applied || (running && !cut)) return false;
      try {
        apply(cached.texture);
        applied = true;
        report("ready");
        return true;
      } catch {
        reset();
        free();
        report("fallback");
        return false;
      }
    },
    dispose() {
      if (disposed) return false;
      disposed = true;
      cancel();
      withdraw(); // Remove borrowed shader bindings before releasing the image.
      free();
      return true;
    },
  };
}
