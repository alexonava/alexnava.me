import {
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  RepeatWrapping,
  Texture,
} from "three";
import { slateMaterialUrl } from "./stone-detail.js";

export const SOIL_ROUGHNESS = Object.freeze({
  size: 512,
  maxBytes: 12 * 1024,
  timeoutMs: 8000,
  // Measured from the encoded grayscale map, in linear data space.
  mean: 0.9450162550982307,
});
export const SOIL_ROUGHNESS_URL = slateMaterialUrl("soil-roughness", SOIL_ROUGHNESS.size);

// This optional data map has its own bounded request. A failed roughness map
// never cancels, delays or replaces the five required slate maps.
export async function loadSoilRoughnessImage(
  url,
  {
    signal,
    maxBytes = SOIL_ROUGHNESS.maxBytes,
    fetcher = globalThis.fetch,
    decode = globalThis.createImageBitmap,
  } = {},
) {
  const response = await fetcher(url, { signal });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error("Soil roughness response");
  }
  if (Number(response.headers.get("content-length")) > maxBytes) {
    await response.body?.cancel();
    throw new Error("Soil roughness too large");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Soil roughness body unavailable");
  const chunks = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        throw new Error("Soil roughness too large");
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

export function createSoilRoughness({
  profile = { tier: "high" },
  disabled = false,
  anisotropy = 1,
  publish = () => {},
  report = () => {},
  requestFrame = () => {},
  loadImage = loadSoilRoughnessImage,
  createTexture = (image) => new Texture(image),
  timeoutMs = SOIL_ROUGHNESS.timeoutMs,
  setTimer = globalThis.setTimeout,
  clearTimer = globalThis.clearTimeout,
} = {}) {
  // Adaptive quality retains the startup asset tier. This one fixed-size tile
  // changes neither URL nor decoded storage when the renderer steps down.
  const tier = profile.tier,
    eligible = !disabled && ["high", "balanced"].includes(tier),
    status = (value) => {
      try {
        report({ status: value, tier });
      } catch {
        // Optional diagnostics never own the material's state or resources.
      }
    };
  let active = false,
    revealed = false,
    preparing = false,
    disposed = false,
    attempted = false,
    applied = false,
    generation = 0,
    pending = null,
    cached = null;

  function cancel() {
    generation++;
    if (!pending) return;
    clearTimer(pending.timer);
    pending.abort.abort();
    pending = null;
    attempted = false;
  }
  function withdraw() {
    if (!applied) return;
    applied = false;
    publish(null);
  }
  function free() {
    if (!cached) return;
    cached.texture.dispose();
    cached.image.close?.();
    cached = null;
  }
  function start() {
    if (disposed || !active || (!revealed && !preparing) || !eligible || attempted || cached)
      return;
    attempted = true;
    const current = ++generation,
      abort = new AbortController(),
      timer = setTimer(() => {
        if (disposed || current !== generation) return;
        generation++;
        pending = null;
        abort.abort();
        status("fallback");
      }, timeoutMs);
    pending = { abort, timer };
    status("loading");
    Promise.resolve()
      .then(() => {
        if (current !== generation) throw new Error("Soil roughness cancelled");
        return loadImage(SOIL_ROUGHNESS_URL, {
          signal: abort.signal,
          maxBytes: SOIL_ROUGHNESS.maxBytes,
        });
      })
      .then(
        (image) => {
          if (disposed || current !== generation || !active) return image?.close?.();
          clearTimer(timer);
          pending = null;
          let texture;
          try {
            if (image?.width !== SOIL_ROUGHNESS.size || image?.height !== SOIL_ROUGHNESS.size)
              throw new Error("Soil roughness dimensions");
            texture = createTexture(image);
            texture.colorSpace = NoColorSpace;
            texture.wrapS = texture.wrapT = RepeatWrapping;
            texture.minFilter = LinearMipmapLinearFilter;
            texture.magFilter = LinearFilter;
            texture.generateMipmaps = true;
            texture.flipY = false;
            texture.anisotropy = anisotropy;
            texture.needsUpdate = true;
            cached = { texture, image };
            status("staged");
            try {
              requestFrame();
            } catch {
              // The staged data remains usable on the next scene frame.
            }
          } catch {
            texture?.dispose();
            image?.close?.();
            status("fallback");
          }
        },
        () => {
          if (disposed || current !== generation) return;
          clearTimer(timer);
          pending = null;
          status("fallback");
        },
      );
  }

  return {
    setActive(next) {
      if (disposed || active === Boolean(next)) return;
      active = Boolean(next);
      if (active) start();
      else {
        cancel();
        withdraw();
      }
    },
    applyQuality() {
      return false;
    },
    update({
      revealed: shown = false,
      preparing: hiddenPreparation = false,
      cut = false,
      still = false,
    } = {}) {
      if (disposed) return false;
      if (shown) revealed = true;
      preparing = hiddenPreparation && !revealed;
      start();
      if (!active || !cached || applied || (!cut && !still && !preparing)) return false;
      try {
        publish(cached.texture);
        applied = true;
        status("ready");
        return true;
      } catch {
        try {
          publish(null);
        } catch {
          // An optional binding failure must not stop the scene's next frame.
        } finally {
          free();
        }
        status("fallback");
        return false;
      }
    },
    dispose() {
      if (disposed) return false;
      disposed = true;
      cancel();
      try {
        withdraw();
      } finally {
        free();
      }
      return true;
    },
  };
}
