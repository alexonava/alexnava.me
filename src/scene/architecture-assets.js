import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  ClampToEdgeWrapping,
  Color,
  DoubleSide,
  Group,
  InterleavedBuffer,
  InterleavedBufferAttribute,
  LinearFilter,
  LinearMipmapLinearFilter,
  LinearMipmapNearestFilter,
  LinearSRGBColorSpace,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  MirroredRepeatWrapping,
  NearestFilter,
  NearestMipmapLinearFilter,
  NearestMipmapNearestFilter,
  Object3D,
  RepeatWrapping,
  SRGBColorSpace,
  Sphere,
  Texture,
  Vector2,
  Vector3,
} from "three";
import { measureScene, sceneNow } from "./perf-marks.js";

// The tree and optional lantern, the film's scattered rocks (rock-scatter.js)
// and its massifs (hill-silhouette.js) load through one manifest. The watch,
// the sky over the terrace, loads no model: its channel waits on the scene's
// stage (`stage`) and commits as a model's does.
const ROLES = [
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

// The only glTF extensions the models use; the reader below reads no others.
const EXTENSIONS = new Set(["EXT_texture_webp", "KHR_mesh_quantization"]);

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
  if (
    [...(json.extensionsRequired || []), ...(json.extensionsUsed || [])].some(
      (extension) => !EXTENSIONS.has(extension),
    )
  ) {
    throw new Error("Architecture GLB uses an unsupported extension");
  }
  // The binary chunk, when there is one, follows the JSON chunk.
  const bin = 28 + jsonLength;
  if (
    json.buffers?.length &&
    (bin > buffer.byteLength ||
      view.getUint32(bin - 4, true) !== 0x004e4942 ||
      view.getUint32(bin - 8, true) > buffer.byteLength - bin)
  ) {
    throw new Error("Invalid architecture GLB binary chunk");
  }
  return { json, bin };
}

// The models' part of glTF, read into the objects three r160's GLTFLoader
// builds from it, so every consumer meets the same attributes, materials,
// names and userData: a scene Group of node meshes, each one indexed triangle
// primitive with one metallic-roughness material.
const COMPONENTS = {
  5120: Int8Array,
  5121: Uint8Array,
  5122: Int16Array,
  5123: Uint16Array,
  5125: Uint32Array,
  5126: Float32Array,
};
const WIDTHS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
// KHR_mesh_quantization's normalized integers, as values from -1 or 0 to 1.
const QUANTIZED = { 5120: 1 / 127, 5121: 1 / 255, 5122: 1 / 32767, 5123: 1 / 65535 };
const ATTRIBUTES = {
  POSITION: "position",
  NORMAL: "normal",
  TANGENT: "tangent",
  TEXCOORD_0: "uv",
  COLOR_0: "color",
};
const FILTERS = {
  9728: NearestFilter,
  9729: LinearFilter,
  9984: NearestMipmapNearestFilter,
  9985: LinearMipmapNearestFilter,
  9986: NearestMipmapLinearFilter,
  9987: LinearMipmapLinearFilter,
};
const WRAPS = { 33071: ClampToEdgeWrapping, 33648: MirroredRepeatWrapping, 10497: RepeatWrapping };

// A material's maps by slot. Colour and emission are sRGB; the rest are data.
function materialMaps(material) {
  const pbr = material.pbrMetallicRoughness || {};
  return [
    ["map", pbr.baseColorTexture, SRGBColorSpace],
    ["metalnessMap", pbr.metallicRoughnessTexture],
    ["roughnessMap", pbr.metallicRoughnessTexture],
    ["normalMap", material.normalTexture],
    ["aoMap", material.occlusionTexture],
    ["emissiveMap", material.emissiveTexture, SRGBColorSpace],
  ].filter(([, info]) => info);
}

// GLTFLoader's image path: Image elements on Safari, on Firefox before 98 and
// without createImageBitmap; elsewhere ImageBitmaps, unpremultiplied and
// without colour-space conversion.
function imageDecoder() {
  const agent = globalThis.navigator?.userAgent || "",
    firefox = agent.match(/Firefox\/([0-9]+)\./);
  if (
    typeof createImageBitmap !== "undefined" &&
    !/^((?!chrome|android).)*safari/i.test(agent) &&
    !(firefox && firefox[1] < 98)
  ) {
    return (blob) =>
      createImageBitmap(blob, { premultiplyAlpha: "none", colorSpaceConversion: "none" });
  }
  return (blob) => {
    const url = URL.createObjectURL(blob),
      image = new Image();
    return new Promise((resolve, reject) => {
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = url;
    }).finally(() => URL.revokeObjectURL(url));
  };
}

const assignExtras = (object, def) => {
  if (def.extras && typeof def.extras === "object") Object.assign(object.userData, def.extras);
};

async function readGlb(buffer, { json, bin }) {
  const views = [],
    accessors = [],
    interleaved = new Map(),
    names = new Map();
  const viewBytes = (id) => {
    const { byteOffset = 0, byteLength = 0 } = json.bufferViews[id];
    return new Uint8Array(buffer, bin + byteOffset, byteLength);
  };
  // Attributes view a copy of their buffer view, as GLTFLoader's do; a view
  // with a byte stride wider than its items becomes one InterleavedBuffer.
  const accessor = (id) => {
    if (accessors[id]) return accessors[id];
    const def = json.accessors[id];
    if (def.bufferView === undefined || def.sparse) {
      throw new Error("Unsupported architecture accessor");
    }
    const Type = COMPONENTS[def.componentType],
      size = WIDTHS[def.type],
      width = Type.BYTES_PER_ELEMENT,
      offset = def.byteOffset || 0,
      stride = json.bufferViews[def.bufferView].byteStride,
      normalized = def.normalized === true,
      data = (views[def.bufferView] ||= viewBytes(def.bufferView).slice().buffer);
    if (stride && stride !== width * size) {
      const slice = Math.floor(offset / stride),
        key = `${def.bufferView}:${def.componentType}:${slice}:${def.count}`;
      if (!interleaved.has(key)) {
        const array = new Type(data, slice * stride, (def.count * stride) / width);
        interleaved.set(key, new InterleavedBuffer(array, stride / width));
      }
      accessors[id] = new InterleavedBufferAttribute(
        interleaved.get(key),
        size,
        (offset % stride) / width,
        normalized,
      );
    } else {
      accessors[id] = new BufferAttribute(
        new Type(data, offset, def.count * size),
        size,
        normalized,
      );
    }
    return accessors[id];
  };
  // Object names as PropertyBinding.sanitizeNodeName leaves them, made unique.
  const unique = (name) => {
    const clean = name.replace(/\s/g, "_").replace(/[[\].:/]/g, "");
    if (!names.has(clean)) {
      names.set(clean, 0);
      return clean;
    }
    names.set(clean, names.get(clean) + 1);
    return `${clean}_${names.get(clean)}`;
  };

  // Every map's image decodes before anything is built. One failure fails the
  // model: a missing PBR map must keep the fallback rather than change the asset.
  const decode = imageDecoder(),
    used = new Set(
      (json.materials || []).flatMap((material) =>
        materialMaps(material).map(([, info]) => info.index),
      ),
    ),
    blobs = [...used].map((index) => {
      const def = json.textures[index],
        image = json.images[def.extensions?.EXT_texture_webp?.source ?? def.source];
      return [index, new Blob([viewBytes(image.bufferView)], { type: image.mimeType })];
    }),
    images = new Map(blobs.map(([index, blob]) => [index, decode(blob)]));
  const decoded = await Promise.allSettled(images.values());
  const close = () =>
    decoded.forEach(({ status, value }) => {
      if (status === "fulfilled") value.close?.();
    });
  if (decoded.some(({ status }) => status === "rejected")) {
    close();
    throw new Error("Architecture image decode failed");
  }

  try {
    const textures = new Map();
    [...images.keys()].forEach((index, i) => {
      const def = json.textures[index],
        image = json.images[def.extensions?.EXT_texture_webp?.source ?? def.source],
        sampler = json.samplers?.[def.sampler] || {},
        texture = new Texture(decoded[i].value);
      texture.needsUpdate = true;
      texture.flipY = false;
      texture.name = def.name || image.name || "";
      texture.magFilter = FILTERS[sampler.magFilter] || LinearFilter;
      texture.minFilter = FILTERS[sampler.minFilter] || LinearMipmapLinearFilter;
      texture.wrapS = WRAPS[sampler.wrapS] || RepeatWrapping;
      texture.wrapT = WRAPS[sampler.wrapT] || RepeatWrapping;
      texture.userData.mimeType = image.mimeType;
      textures.set(index, texture);
    });

    const material = (def) => {
      const pbr = def.pbrMetallicRoughness || {},
        color = pbr.baseColorFactor,
        alphaMode = def.alphaMode || "OPAQUE",
        params = {
          color: new Color(1, 1, 1),
          opacity: 1,
          metalness: pbr.metallicFactor ?? 1,
          roughness: pbr.roughnessFactor ?? 1,
          transparent: alphaMode === "BLEND",
        };
      if (Array.isArray(color)) {
        params.color.setRGB(color[0], color[1], color[2], LinearSRGBColorSpace);
        params.opacity = color[3];
      }
      if (def.doubleSided === true) params.side = DoubleSide;
      // GLTFLoader leaves a blended material's depth unwritten (three.js #17706).
      if (alphaMode === "BLEND") params.depthWrite = false;
      if (alphaMode === "MASK") params.alphaTest = def.alphaCutoff ?? 0.5;
      if (def.normalTexture) {
        const scale = def.normalTexture.scale ?? 1;
        params.normalScale = new Vector2(scale, scale);
      }
      if (def.occlusionTexture?.strength !== undefined) {
        params.aoMapIntensity = def.occlusionTexture.strength;
      }
      if (def.emissiveFactor) {
        const [r, g, b] = def.emissiveFactor;
        params.emissive = new Color().setRGB(r, g, b, LinearSRGBColorSpace);
      }
      for (const [slot, info, colorSpace] of materialMaps(def)) {
        const texture = textures.get(info.index);
        if (colorSpace) texture.colorSpace = colorSpace;
        params[slot] = texture;
      }
      const result = new MeshStandardMaterial(params);
      if (def.name) result.name = def.name;
      assignExtras(result, def);
      return result;
    };

    const mesh = (index) => {
      const def = json.meshes[index];
      if (def.primitives.length !== 1 || (def.primitives[0].mode ?? 4) !== 4) {
        throw new Error("Architecture meshes must be one triangle primitive");
      }
      const [primitive] = def.primitives,
        geometry = new BufferGeometry();
      for (const [semantic, id] of Object.entries(primitive.attributes)) {
        if (!ATTRIBUTES[semantic]) throw new Error("Unsupported architecture attribute");
        geometry.setAttribute(ATTRIBUTES[semantic], accessor(id));
      }
      if (primitive.indices !== undefined) geometry.setIndex(accessor(primitive.indices));
      assignExtras(geometry, primitive);
      // Bounds come from POSITION's min and max, dequantized.
      const position = json.accessors[primitive.attributes.POSITION];
      if (position?.min && position.max) {
        const scale = position.normalized ? QUANTIZED[position.componentType] : 1;
        geometry.boundingBox = new Box3(
          new Vector3().fromArray(position.min).multiplyScalar(scale),
          new Vector3().fromArray(position.max).multiplyScalar(scale),
        );
        geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(new Sphere());
      }
      const surface = material(json.materials[primitive.material]);
      // GLTFLoader's final material: without tangents the normal map's green
      // flips for derivative tangents (three.js #11438); without normals the
      // surface shades flat; COLOR_0 tints it.
      if (!geometry.attributes.tangent) surface.normalScale.y *= -1;
      if (geometry.attributes.color) surface.vertexColors = true;
      if (!geometry.attributes.normal) surface.flatShading = true;
      const result = new Mesh(geometry, surface);
      result.name = unique(def.name || `mesh_${index}`);
      assignExtras(result, def);
      return result;
    };

    // A node with a mesh is that mesh; its name and extras follow the mesh's.
    const node = (index) => {
      const def = json.nodes[index],
        name = def.name ? unique(def.name) : "",
        result = def.mesh === undefined ? new Object3D() : mesh(def.mesh);
      if (def.name) {
        result.userData.name = def.name;
        result.name = name;
      }
      assignExtras(result, def);
      if (def.matrix) result.applyMatrix4(new Matrix4().fromArray(def.matrix));
      else {
        if (def.translation) result.position.fromArray(def.translation);
        if (def.rotation) result.quaternion.fromArray(def.rotation);
        if (def.scale) result.scale.fromArray(def.scale);
      }
      (def.children || []).forEach((child) => result.add(node(child)));
      return result;
    };

    const sceneDef = json.scenes[json.scene || 0],
      scene = new Group();
    if (sceneDef.name) scene.name = unique(sceneDef.name);
    assignExtras(scene, sceneDef);
    (sceneDef.nodes || []).forEach((index) => scene.add(node(index)));
    return { scene, scenes: [scene] };
  } catch (error) {
    close();
    throw error;
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
  const glb = validateEmbeddedGlb(buffer, maxBytes);
  // Decoding embedded images cannot be aborted. Always return a completed
  // parse: the controller owns and disposes it even when the request became stale.
  const parseStart = sceneNow();
  const parsed = await readGlb(buffer, glb);
  measureScene(`glb-parse:${role}`, parseStart);
  return parsed;
}

export function collectResources(asset) {
  const resources = {
    geometries: new Set(),
    materials: new Set(),
    textures: new Set(),
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
  loadAsset = loadArchitectureAsset,
  urls = ARCHITECTURE_ASSET_URLS,
  // What the watch waits on before it commits (a promise; a rejection falls back).
  stage = () => Promise.resolve(),
  onWatchReady = () => {},
  onTreeReady = () => {},
  onLanternReady = () => {},
  onRestoreWatch = () => {},
  onRestoreTree = () => {},
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
    { kind: "watch", roles: [], wait: stage, ready: onWatchReady, restore: onRestoreWatch },
    { kind: "tree", roles: ["tree"], ready: onTreeReady, restore: onRestoreTree },
    { kind: "lantern", roles: ["lantern"], ready: onLanternReady, restore: () => {} },
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
        // by several maps or by independently loaded models.
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
    Promise.all([
      channel.wait?.(),
      ...channel.roles.map(async (role) => {
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
    ])
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
        const cleanup = channel.ready(assets[channel.kind], { tier });
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
    const tier = live && ARCHITECTURE_ASSET_BUDGETS[currentAssetTier] ? currentAssetTier : null;
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
    cancelOptional(kind, reason = "opening-deadline") {
      if (disposed || kind !== "lantern") return false;
      const channel = channels.find((entry) => entry.kind === kind);
      if (!channel) return false;
      stop(channel, true);
      publish(channel, "fallback", reason);
      return true;
    },
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
