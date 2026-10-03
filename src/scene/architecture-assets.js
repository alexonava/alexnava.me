import { LoadingManager } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { measureScene, sceneNow } from "./perf-marks.js";

// The tower, tree and optional lantern, the film's scattered rocks
// (rock-scatter.js) and its Meshy massifs (hill-silhouette.js) load through one
// manifest.
const ROLES = [
  "tower",
  "tree",
  "lantern",
  "lichen-rock",
  "weathered-stone",
  "mountain-ridge",
  "mountain-spine",
  "mountain-summit",
];
export const ARCHITECTURE_ASSET_BUDGETS = Object.freeze({
  high: 6 * 1024 * 1024,
  balanced: 3 * 1024 * 1024,
});
const STABLE_ARCHITECTURE_ASSET_URLS = Object.freeze(
  Object.fromEntries(
    ["high", "balanced"].map((tier) => [
      tier,
      Object.freeze(
        Object.fromEntries(ROLES.map((role) => [role, `/images/architecture/${role}-${tier}.glb`])),
      ),
    ]),
  ),
);

// build.mjs defines the hashed manifest as a JSON string, which keeps it in
// the scene entry chunk rather than the shared Three.js chunk.
export const ARCHITECTURE_ASSET_URLS =
  typeof __BABEL_ARCHITECTURE_URLS__ !== "undefined"
    ? JSON.parse(__BABEL_ARCHITECTURE_URLS__)
    : STABLE_ARCHITECTURE_ASSET_URLS;

function validateEmbeddedGlb(buffer, maxBytes) {
  if (buffer.byteLength < 20 || buffer.byteLength > maxBytes) {
    throw new Error("Architecture GLB exceeds payload bounds");
  }
  const view = new DataView(buffer);
  const jsonLength = view.getUint32(12, true);
  if (
    view.getUint32(0, true) !== 0x46546c67 ||
    view.getUint32(4, true) !== 2 ||
    view.getUint32(8, true) !== buffer.byteLength ||
    view.getUint32(16, true) !== 0x4e4f534a ||
    jsonLength % 4 ||
    jsonLength > buffer.byteLength - 20
  ) {
    throw new Error("Invalid architecture GLB header");
  }
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, jsonLength)));
  if ([...(json.buffers || []), ...(json.images || [])].some((resource) => resource.uri)) {
    throw new Error("Architecture GLB must embed all buffers and images");
  }
  if (json.skins?.length || json.animations?.length) {
    throw new Error("Architecture assets must be static");
  }
  const supported = new Set([
    "EXT_texture_webp",
    "KHR_texture_transform",
    "KHR_mesh_quantization",
    "KHR_materials_emissive_strength",
  ]);
  if ((json.extensionsRequired || []).some((extension) => !supported.has(extension))) {
    throw new Error("Architecture GLB requires an unsupported extension");
  }
}

// main.js starts the startup tier's model requests beside the scene bundle and
// shares them here by URL. Each is taken at most once.
function prefetchedResponses() {
  const prefetched = globalThis.BabelSite?.scene?.prefetched;
  return prefetched instanceof Map ? prefetched : null;
}

function releasePrefetchedResponses() {
  const prefetched = prefetchedResponses();
  prefetched?.forEach((entry) => entry.abort?.());
  prefetched?.clear();
}

async function requestArchitectureAsset(url, signal, priority) {
  const prefetched = prefetchedResponses();
  const entry = prefetched?.get(url);
  if (entry) {
    prefetched.delete(url);
    // The early request has no signal of its own; this load's abort cancels it.
    const cancel = () => entry.abort?.();
    if (signal.aborted) cancel();
    else signal.addEventListener("abort", cancel, { once: true });
    try {
      const response = await entry.response;
      if (response.ok) return response;
      cancel();
    } catch {
      // A failed early request falls back to the scene's own request.
    }
  }
  // The title card's loading line (ui/scene-loader.js) counts this body too.
  // An early response arrives already counted, so it is never wrapped twice.
  const response = await fetch(url, priority ? { signal, priority } : { signal });
  return globalThis.BabelSite?.sceneLoader?.track?.(url, response) ?? response;
}

// priority: the fetch's priority hint ("low" for models that may land late).
export async function loadArchitectureAsset(url, { signal, tier, role = "asset", priority }) {
  const maxBytes = ARCHITECTURE_ASSET_BUDGETS[tier];
  if (!maxBytes) throw new Error("Invalid architecture quality tier");
  const response = await requestArchitectureAsset(url, signal, priority);
  if (!response.ok) throw new Error(`Architecture asset response: ${response.status}`);
  if (Number(response.headers.get("content-length")) > maxBytes) {
    throw new Error("Architecture asset exceeds transfer budget");
  }
  const buffer = await response.arrayBuffer();
  if (signal.aborted) throw new DOMException("Architecture load aborted", "AbortError");
  validateEmbeddedGlb(buffer, maxBytes);
  // Parsing embedded images cannot be aborted. Always return a completed parse:
  // the controller owns and disposes it even when the request became stale.
  const manager = new LoadingManager();
  const objectUrls = new Set();
  let imageFailed = false;
  let parser;
  let parsed;
  manager.onError = () => {
    imageFailed = true;
  };
  manager.setURLModifier((resourceUrl) => {
    if (resourceUrl.startsWith("blob:")) objectUrls.add(resourceUrl);
    return resourceUrl;
  });
  const loader = new GLTFLoader(manager);
  loader.register((sourceParser) => {
    parser = sourceParser;
    return { name: "BabelArchitectureResources" };
  });
  const parseStart = sceneNow();
  try {
    parsed = await loader.parseAsync(buffer, "");
    // GLTFLoader intentionally turns image failures into null maps. A missing
    // PBR map must retain our fallback instead of silently changing the asset.
    if (imageFailed) throw new Error("Architecture image decode failed");
    measureScene(`glb-parse:${role}`, parseStart);
    return parsed;
  } catch (error) {
    const sources = await Promise.allSettled(Object.values(parser?.sourceCache || {}));
    const resources = collectResources(
      parsed || {},
      sources.filter((result) => result.status === "fulfilled").map((result) => result.value),
    );
    Object.entries(resources).forEach(([kind, entries]) => {
      entries.forEach((resource) => {
        if (kind === "bitmaps") resource.close();
        else resource.dispose?.();
      });
    });
    throw error;
  } finally {
    objectUrls.forEach((resourceUrl) => URL.revokeObjectURL(resourceUrl));
  }
}

export function collectResources(asset, extraTextures = []) {
  const resources = {
    geometries: new Set(),
    materials: new Set(),
    textures: new Set(extraTextures.filter((texture) => texture?.isTexture)),
    bitmaps: new Set(),
  };
  const scenes = new Set([asset.scene, ...(asset.scenes || [])]);
  scenes.forEach((scene) => {
    scene?.traverse?.((object) => {
      if (object.geometry) resources.geometries.add(object.geometry);
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material) => {
        if (!material) return;
        resources.materials.add(material);
        Object.values(material).forEach((value) => {
          if (value?.isTexture) resources.textures.add(value);
        });
      });
    });
  });
  resources.textures.forEach((texture) => {
    const image = texture.source?.data ?? texture.image;
    (Array.isArray(image) ? image : [image]).forEach((bitmap) => {
      if (typeof bitmap?.close === "function") resources.bitmaps.add(bitmap);
    });
  });
  return resources;
}

export function createArchitectureAssetController({
  disabled = false,
  includeLantern = false,
  loadAsset = loadArchitectureAsset,
  urls = ARCHITECTURE_ASSET_URLS,
  onTowerReady = () => {},
  onTreeReady = () => {},
  onLanternReady = () => {},
  onRestoreTower = () => {},
  onRestoreTree = () => {},
  onRestoreLantern = () => {},
  onStatus = () => {},
} = {}) {
  let disposed = false;
  let currentProfile = {};
  let currentAssetTier;
  let live = false;
  let selectedTier;
  const assetReferences = new WeakMap();
  const resourceReferences = new Map();
  const freedResources = new WeakSet();
  const channels = [
    { kind: "tower", roles: ["tower"], ready: onTowerReady, restore: onRestoreTower },
    { kind: "tree", roles: ["tree"], ready: onTreeReady, restore: onRestoreTree },
    ...(includeLantern
      ? [{ kind: "lantern", roles: ["lantern"], ready: onLanternReady, restore: onRestoreLantern }]
      : []),
  ].map((channel) => ({ ...channel, run: null, leases: [], active: false, cleanup: null }));

  function safely(callback) {
    try {
      callback();
    } catch {
      // A consumer callback must not interrupt resource teardown or another channel.
    }
  }

  function publish(channel, status, reason) {
    safely(() =>
      onStatus({
        kind: channel.kind,
        status,
        tier: currentAssetTier,
        ...(reason ? { reason } : {}),
      }),
    );
  }

  function retain(asset) {
    if (!asset || typeof asset !== "object") return null;
    let record = assetReferences.get(asset);
    if (!record) {
      record = { count: 0, resources: collectResources(asset) };
      assetReferences.set(asset, record);
      Object.values(record.resources).forEach((resources) => {
        resources.forEach((resource) => {
          resourceReferences.set(resource, (resourceReferences.get(resource) || 0) + 1);
        });
      });
    }
    record.count += 1;
    let released = false;
    return {
      asset,
      release() {
        if (released) return;
        released = true;
        record.count -= 1;
        if (record.count > 0) return;
        assetReferences.delete(asset);
        // Texture disposal precedes ImageBitmap.close, including images shared
        // by several maps or by the independently loaded tower and tree.
        Object.entries(record.resources).forEach(([kind, resources]) => {
          resources.forEach((resource) => {
            const remaining = resourceReferences.get(resource) - 1;
            if (remaining > 0) {
              resourceReferences.set(resource, remaining);
              return;
            }
            resourceReferences.delete(resource);
            if (freedResources.has(resource)) return;
            freedResources.add(resource);
            safely(() => (kind === "bitmaps" ? resource.close() : resource.dispose?.()));
          });
        });
      },
    };
  }

  function stop(channel, restore = channel.active) {
    const run = channel.run;
    channel.run = null;
    run?.abort.abort();
    if (restore) safely(channel.restore);
    channel.active = false;
    const cleanup = channel.cleanup;
    channel.cleanup = null;
    if (cleanup) safely(cleanup);
    channel.leases.forEach((lease) => lease.release());
    channel.leases = [];
    run?.leases.forEach((lease) => lease.release());
    run?.leases.clear();
  }

  function start(channel, tier) {
    const run = { abort: new AbortController(), leases: new Map() };
    channel.run = run;
    const isCurrent = () => !disposed && channel.run === run;
    publish(channel, "loading");
    if (!isCurrent()) return;
    Promise.all(
      channel.roles.map(async (role) => {
        const url = urls[tier]?.[role];
        if (!url) throw new Error("Missing architecture asset URL");
        const asset = await loadAsset(url, { signal: run.abort.signal, tier, role });
        const lease = retain(asset);
        if (!isCurrent()) {
          lease?.release();
          return;
        }
        if (!asset?.scene?.isObject3D || !lease) {
          lease?.release();
          throw new Error("Invalid parsed architecture asset");
        }
        run.leases.set(role, lease);
      }),
    )
      .then(() => {
        if (!isCurrent()) return;
        const assets = Object.fromEntries(
          [...run.leases].map(([role, lease]) => [role, lease.asset]),
        );
        channel.leases = [...run.leases.values()];
        run.leases.clear();
        channel.active = true;
        // Ready callbacks borrow source resources and synchronously assemble or
        // stage them. Returned cleanup restores any attachment and owns only
        // derived geometry/material clones; staged assets retain their lease.
        // A throwing callback must roll back its own partial allocations.
        const cleanup = channel.ready(channel.kind === "tower" ? assets : assets[channel.kind], {
          tier,
        });
        if (cleanup !== undefined && typeof cleanup !== "function") {
          throw new Error(
            "Architecture ready callback must return a cleanup function or undefined",
          );
        }
        if (!isCurrent()) {
          if (cleanup) safely(cleanup);
          return;
        }
        channel.cleanup = cleanup || null;
        channel.run = null;
        publish(channel, "ready");
      })
      .catch(() => {
        if (!isCurrent()) return;
        stop(channel, true);
        publish(channel, "fallback", "asset-unavailable");
      });
  }

  // context.assetTier pins the model tier chosen at startup, so an adaptive
  // cost step neither blanks the live models nor downloads another tier.
  function setQuality(profile = {}, nextLive = false, context = {}) {
    if (disposed) return false;
    currentProfile = profile;
    currentAssetTier = context?.assetTier ?? profile.tier;
    live = Boolean(nextLive);
    const tier =
      !disabled && live && ARCHITECTURE_ASSET_BUDGETS[currentAssetTier] ? currentAssetTier : null;
    const changed = tier !== selectedTier;
    if (changed) {
      selectedTier = tier;
      channels.forEach((channel) => stop(channel));
      channels.forEach((channel) => {
        if (tier) start(channel, tier);
        else publish(channel, "procedural");
      });
    }
    // The live selection has taken any early request it uses; the rest name
    // another tier.
    if (live) releasePrefetchedResponses();
    return changed;
  }

  return {
    lifecycleOrder: 23,
    setQuality,
    applyQuality(profile, context) {
      return setQuality(profile, live, context);
    },
    setLive(nextLive) {
      return setQuality(currentProfile, nextLive, { assetTier: currentAssetTier });
    },
    dispose() {
      if (disposed) return false;
      disposed = true;
      selectedTier = null;
      channels.forEach((channel) => stop(channel));
      releasePrefetchedResponses();
      return true;
    },
  };
}
