import { Color, Group, InstancedMesh, Matrix4, Quaternion, Vector3 } from "three";
import {
  ARCHITECTURE_ASSET_URLS,
  collectResources,
  loadArchitectureAsset,
} from "./architecture-assets.js";
import { applyFilmGrade, materialFor, sourceMesh } from "./architecture.js";
import { DEPTH_LAYER, stampDepthLayer } from "./depth-layers.js";
import { DIRECTED_SHOTS } from "./directed-shots.js";
import { ESTATE, estateLantern, estatePathDistance, estatePoint } from "./estate-layout.js";
import { SLATE_CONTACTS, SLATE_STREAMS, streamWater } from "./mud-ground.js";
import { createDeferredQualityStep } from "./runtime.js";

// The film's scattered rocks: the two authored Meshy stones, placed from a table
// of clusters relative to the estate anchors (estate-layout.js) plus seeded
// pebbles. Nothing reads the tree or lantern geometry. The GLBs are unit height,
// bottom at 0; footprint is their x by z extent per unit height.
// The placement and meshes live in rock-build.js, a lazily loaded chunk; this
// module keeps the tables the tufts need and decides when to fetch it.
export const ROCK_TYPES = Object.freeze({
  lichen: Object.freeze({ role: "lichen-rock", footprint: Object.freeze([0.934, 0.676]) }),
  weathered: Object.freeze({ role: "weathered-stone", footprint: Object.freeze([1.195, 0.807]) }),
});

// [id, anchor, world angle atan2(z, x) in degrees, distance, type, height].
// A: by the watch's terrace (below The watch's frame, which looks up). G: a distant silhouette
// in the fog. C: behind Root and lantern and Portrait. D: behind the lantern, to the right,
// in Lantern study on landscape phones (desktops look past it, from -125). F: the right side of Portrait. E: at the lantern's foot.
// N: beyond the tree's north root, right of the trunk in Portrait, behind the
// lantern.
export const ROCK_CLUSTERS = Object.freeze(
  [
    ["A1", "watch", -145.6, 21.2, "lichen", 3.4],
    ["A2", "watch", -162.8, 22.0, "weathered", 1.6],
    ["A3", "watch", -133.9, 21.9, "weathered", 0.55],
    ["A4", "watch", -153.4, 21.9, "lichen", 0.4],
    ["G1", "watch", -163.8, 64.6, "weathered", 5.0],
    ["C1", "tree", 15, 13.0, "weathered", 3.8],
    ["C2", "tree", 5, 14.5, "lichen", 0.7],
    ["C3", "tree", 25, 11.8, "weathered", 0.45],
    ["D1", "tree", 110, 12.0, "lichen", 2.4],
    ["F1", "tree", 170, 15.0, "lichen", 3.9],
    ["F2", "tree", 166, 17.0, "weathered", 0.6],
    ["F3", "tree", 160, 13.8, "lichen", 0.35],
    ["E1", "lantern", 125, 2.1, "weathered", 0.5],
    ["E2", "lantern", 140, 2.7, "lichen", 0.32],
    ["E3", "lantern", 150, 1.8, "weathered", 0.22],
    ["N1", "tree", 126, 13.2, "weathered", 1.9],
    ["N2", "tree", 138, 12.4, "lichen", 0.85],
  ].map(Object.freeze),
);
// Rocks at least this tall get one pebble each, 1.2-2.6 of their radius out.
export const PEBBLE_UNDER = 2;

// Where growth must not stand (estate-ground-detail.js): each cluster rock's
// widest stretched footprint, and for a tall rock the ring its pebble may take;
// and each of the stream's stones (SLATE_STREAMS.stones).
export function rockKeepouts() {
  const lantern = estateLantern();
  return [
    ...ROCK_CLUSTERS.map(([, anchor, deg, dist, type, height]) => {
      const [fx, fz] = ROCK_TYPES[type].footprint,
        radius = 0.5 * Math.hypot(fx * 1.25, fz) * height;
      return {
        ...estatePoint(anchor, deg, dist),
        radius: height >= PEBBLE_UNDER ? 2.6 * radius + 0.3 : radius,
      };
    }),
    ...SLATE_STREAMS.stones.list.map(([dx, dz, height, type]) => {
      const [fx, fz] = ROCK_TYPES[type].footprint;
      return { x: lantern.x + dx, z: lantern.z + dz, radius: 0.5 * Math.hypot(fx, fz) * height };
    }),
  ];
}

// The ground's contact darkening (mud-ground.js slateContacts): the tree's
// roots and the lantern, always on. rock-build.js fills the rock slots after.
export function estateContacts() {
  const lantern = estateLantern(),
    values = new Float32Array(SLATE_CONTACTS * 4);
  values.set([
    ESTATE.tree.x,
    ESTATE.tree.z,
    ESTATE.tree.root,
    0.22,
    lantern.x,
    lantern.z,
    0.9,
    0.3,
  ]);
  return values;
}

// Everything rock-build.js uses from the entry's modules.
export const ROCK_LIB = Object.freeze({
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  Quaternion,
  Vector3,
  ROCK_TYPES,
  ROCK_CLUSTERS,
  PEBBLE_UNDER,
  STREAM_STONES: SLATE_STREAMS.stones,
  streamWater,
  ESTATE,
  DIRECTED_SHOTS,
  DEPTH_LAYER,
  ARCHITECTURE_ASSET_URLS,
  estateLantern,
  estatePathDistance,
  estatePoint,
  loadArchitectureAsset,
  collectResources,
  materialFor,
  applyFilmGrade,
  sourceMesh,
  stampDepthLayer,
  createDeferredQualityStep,
});

const NO_ROCKS = Object.freeze([]);

// Fetches rock-build.js once revealed or explicitly preparing a hidden opening,
// with the film on and the tree settled, on high and balanced only. terrain()
// resolves to the prepared film sampler (film-scene.js ready). The chunk and
// GLBs start while that sampler is preparing, wait for its coastal commit before placement, and
// takes the stable film height even if film withdraws during those loads.
export function createRockScatter({
  tier,
  onStatus = () => {},
  load = () => import("./rock-build.js"),
  terrain = () => {},
  ...options
}) {
  let film = false,
    settled = false,
    revealed = false,
    started = false,
    disposed = false,
    rocks = null,
    preparing = false,
    openingDone = false,
    opening = null,
    openingTimeout = 8000,
    openingPoll = null,
    lastStatus = null,
    finishOpening = () => {};
  const pendingLoads = new Set();
  function openingAsset(url, request) {
    const loadAsset = options.loadAsset ?? loadArchitectureAsset;
    if (!preparing) return loadAsset(url, request);
    return new Promise((resolve, reject) => {
      const abort = new AbortController();
      let ended = false,
        timer;
      const clean = () => {
        clearTimeout(timer);
        pendingLoads.delete(cancel);
        request.signal?.removeEventListener("abort", cancel);
      };
      const cancel = () => {
        if (ended) return;
        ended = true;
        clean();
        abort.abort();
        reject(new Error("Optional opening rock deadline"));
      };
      pendingLoads.add(cancel);
      request.signal?.addEventListener("abort", cancel, { once: true });
      timer = setTimeout(cancel, openingTimeout);
      if (request.signal?.aborted) cancel();
      if (ended) return;
      Promise.resolve()
        .then(() => loadAsset(url, { ...request, signal: abort.signal }))
        .then(
          (asset) => {
            if (ended) {
              if (!asset?.scene) return;
              const resources = collectResources(asset);
              for (const [kind, set] of Object.entries(resources))
                if (kind !== "bitmaps") set.forEach((resource) => resource.dispose?.());
              resources.bitmaps?.forEach((bitmap) => bitmap.close?.());
              return;
            }
            ended = true;
            clean();
            resolve(asset);
          },
          (error) => {
            if (ended) return;
            ended = true;
            clean();
            reject(error);
          },
        );
    });
  }
  const status = (value) => {
    lastStatus = value.status;
    onStatus(value);
    if (["ready", "fallback"].includes(value.status)) finishOpening();
  };
  function start() {
    if (
      started ||
      disposed ||
      !film ||
      !settled ||
      (!revealed && !preparing) ||
      !["high", "balanced"].includes(tier)
    )
      return;
    started = true;
    status({ status: "loading", tier });
    // Observe both stages even if the chunk fails or the owner is disposed.
    // Neither terrain preparation nor its eventual cut delays the downloads.
    const groundHeight = Promise.resolve()
      .then(terrain)
      .then((height) => (height === undefined ? options.groundHeight : height));
    groundHeight.then((height) => height?.ready).catch(() => {});
    Promise.resolve()
      .then(load)
      .then(({ createRocks }) => {
        if (disposed) return;
        rocks = createRocks(ROCK_LIB, {
          ...options,
          groundHeight,
          tier,
          onStatus: status,
          loadAsset: openingAsset,
        });
        rocks.setFilmActive(film);
      })
      .catch(() => {
        if (!disposed) status({ status: "fallback", tier });
      });
  }
  return {
    // Optional asset requests settle within eight seconds. Already loaded
    // assets may wait for required terrain without spending that allowance.
    prepareOpening({ timeoutMs = 8000 } = {}) {
      if (opening) return opening;
      if (disposed || !["high", "balanced"].includes(tier)) return Promise.resolve(true);
      if (["ready", "fallback"].includes(lastStatus)) return Promise.resolve(true);
      preparing = true;
      openingTimeout = timeoutMs;
      opening = new Promise((resolve) => {
        finishOpening = () => {
          openingDone = true;
          clearTimeout(openingPoll);
          finishOpening = () => {};
          resolve(true);
        };
        const poll = () => {
          if (disposed) return finishOpening();
          start();
          rocks?.take({ running: false, nowMs: performance.now() });
          if (!openingDone && !rocks?.committed) openingPoll = setTimeout(poll, 16);
        };
        poll();
      });
      return opening;
    },
    get committed() {
      return rocks?.committed === true;
    },
    // The rocks on show, for the walk's solids (rock-build.js); none until then.
    get footprints() {
      return rocks?.footprints ?? NO_ROCKS;
    },
    setFilmActive(active) {
      if (disposed) return;
      film = Boolean(active);
      rocks?.setFilmActive(film);
      start();
    },
    setTreeStatus(status) {
      if (disposed || !["ready", "fallback"].includes(status)) return;
      settled = true;
      start();
    },
    setRevealed() {
      if (disposed) return;
      revealed = true;
      start();
    },
    take(frame) {
      return rocks?.take(frame?.preparing ? { ...frame, running: false } : frame) ?? false;
    },
    dispose() {
      if (disposed) return false;
      disposed = true;
      finishOpening();
      for (const cancel of [...pendingLoads]) cancel();
      rocks?.dispose();
      return true;
    },
  };
}
