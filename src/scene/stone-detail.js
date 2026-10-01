// Authored materials are optional scene resources. Nothing here runs in the UI
// bundle or delays the first procedural frame.
async function loadStoneImage(url, { signal }) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Stone material response: ${response.status}`);
  return createImageBitmap(await response.blob());
}

export const GROUND_DETAIL_SETTINGS = Object.freeze({
  normalScale: 0.45,
});

// build.mjs defines the hashed slate map names as a JSON string, like the
// architecture manifest, so it stays in the scene entry chunk.
const MATERIAL_URLS =
  typeof __BABEL_MATERIAL_URLS__ !== "undefined" ? JSON.parse(__BABEL_MATERIAL_URLS__) : {};
export function slateMaterialUrl(kind, size) {
  const name = `slate-${kind}-${size}.webp`;
  return MATERIAL_URLS[name] ?? `/images/materials/${name}`;
}

export function createStoneDetailController({
  profile,
  disabled = false,
  apply,
  reset,
  report = () => {},
  loadImage = loadStoneImage,
  kinds,
  urlFor,
  // Pixel size of one kind at the tier's size: a shared map keeps its own.
  sizeFor = (kind, size) => size,
}) {
  let disposed = false;
  let revision = 0;
  let currentTier;
  let pending = null;
  let rendered = false;

  // context.assetTier (adaptive quality) keeps the startup map size loaded.
  function applyQuality(nextProfile = {}, context = {}) {
    if (disposed) return false;
    const requested = context?.assetTier ?? nextProfile.tier;
    const tier = !disabled && ["high", "balanced"].includes(requested) ? requested : null;
    if (tier === currentTier) return false;
    currentTier = tier;
    const requestRevision = ++revision;
    pending?.abort();
    pending = null;
    if (rendered) {
      reset({ disposing: false });
      rendered = false;
    }
    if (!tier) {
      report({ status: "procedural", tier: requested });
      return true;
    }

    const controller = new AbortController();
    pending = controller;
    const size = tier === "high" ? 1024 : 512;
    report({ status: "loading", tier });
    void (async () => {
      const results = await Promise.allSettled(
        kinds.map(async (kind) => {
          try {
            return await loadImage(urlFor(kind, sizeFor(kind, size)), {
              signal: controller.signal,
            });
          } catch (error) {
            controller.abort();
            throw error;
          }
        }),
      );
      const images = results
        .filter((result) => result.status === "fulfilled")
        .map((result) => result.value);
      try {
        if (disposed || requestRevision !== revision) return;
        pending = null;
        if (controller.signal.aborted || results.some((result) => result.status === "rejected")) {
          report({ status: "fallback", tier });
          return;
        }
        if (
          images.some(
            (image, i) =>
              image.width !== sizeFor(kinds[i], size) || image.height !== sizeFor(kinds[i], size),
          )
        ) {
          report({ status: "fallback", tier });
          return;
        }
        try {
          apply({ ...Object.fromEntries(kinds.map((kind, i) => [kind, images[i]])), tier });
          rendered = true;
          report({ status: "ready", tier });
        } catch {
          // A failed canvas upload must not leave a partially authored surface.
          reset({ disposing: false });
          report({ status: "fallback", tier });
        }
      } finally {
        images.forEach((image) => image.close?.());
      }
    })();
    return true;
  }

  const controller = {
    lifecycleOrder: 21,
    applyQuality,
    dispose() {
      if (disposed) return false;
      disposed = true;
      revision += 1;
      pending?.abort();
      pending = null;
      if (rendered) reset({ disposing: true });
      rendered = false;
      return true;
    },
  };
  applyQuality(profile);
  return controller;
}
