import { Color, Group, InstancedMesh, Matrix4, Quaternion, Vector3 } from "three";
import { ARCHITECTURE_ASSET_URLS, collectResources, loadArchitectureAsset } from "./architecture-assets.js";
import { applyFilmGrade, materialFor, sourceMesh } from "./architecture.js";
import { DEPTH_LAYER, stampDepthLayer } from "./depth-layers.js";
import { DIRECTED_SHOTS } from "./directed-shots.js";
import { ESTATE, estateLantern, estatePathDistance, estatePoint } from "./estate-layout.js";
import { SLATE_CONTACTS } from "./mud-ground.js";
import { createDeferredQualityStep } from "./runtime.js";

// The film's scattered rocks: the owner's two Meshy stones, placed from a table
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
// A: right of the tower base in The watch. G: a distant silhouette in the fog.
// C: behind Root and lantern and Portrait. D: behind the lantern, to the right,
// in Lantern study. F: the right side of Portrait. E: at the lantern's foot.
export const ROCK_CLUSTERS = Object.freeze(
  [
    ["A1", "tower", -145.6, 21.2, "lichen", 3.4],
    ["A2", "tower", -162.8, 22.0, "weathered", 1.6],
    ["A3", "tower", -133.9, 21.9, "weathered", 0.55],
    ["A4", "tower", -153.4, 21.9, "lichen", 0.4],
    ["G1", "tower", -163.8, 64.6, "weathered", 5.0],
    ["C1", "tree", 15, 13.0, "weathered", 2.9],
    ["C2", "tree", 5, 14.5, "lichen", 0.7],
    ["C3", "tree", 25, 11.8, "weathered", 0.45],
    ["D1", "tree", 110, 12.0, "lichen", 2.4],
    ["F1", "tree", 170, 15.0, "lichen", 3.0],
    ["F2", "tree", 166, 17.0, "weathered", 0.6],
    ["F3", "tree", 160, 13.8, "lichen", 0.35],
    ["E1", "lantern", 125, 2.1, "weathered", 0.5],
    ["E2", "lantern", 140, 2.7, "lichen", 0.32],
    ["E3", "lantern", 150, 1.8, "weathered", 0.22],
  ].map(Object.freeze),
);
// Rocks at least this tall get one pebble each, 1.2-2.6 of their radius out.
export const PEBBLE_UNDER = 2;

// Where growth must not stand (estate-ground-detail.js): each cluster rock's
// widest stretched footprint, and for a tall rock the ring its pebble may take.
export function rockKeepouts() {
  return ROCK_CLUSTERS.map(([, anchor, deg, dist, type, height]) => {
    const [fx, fz] = ROCK_TYPES[type].footprint,
      radius = 0.5 * Math.hypot(fx * 1.25, fz) * height;
    return { ...estatePoint(anchor, deg, dist), radius: height >= PEBBLE_UNDER ? 2.6 * radius + 0.3 : radius };
  });
}

// The ground's contact darkening (mud-ground.js slateContacts): the tree's
// roots and the lantern, always on. rock-build.js fills the rock slots after.
export function estateContacts() {
  const lantern = estateLantern(),
    values = new Float32Array(SLATE_CONTACTS * 4);
  values.set([ESTATE.tree.x, ESTATE.tree.z, ESTATE.tree.root, 0.22, lantern.x, lantern.z, 0.9, 0.3]);
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

// Fetches rock-build.js once the scene has revealed, the film is on and the
// tree channel has settled, on high and balanced only; low, legacy comparisons
// and ?rocks=off never do. Nothing about the rocks delays the reveal. terrain()
// resolves to the film terrain's height once its root supports settle
// (film-scene.js ready); the rocks are placed on it, or on groundHeight without.
export function createRockScatter({
  enabled = true,
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
    rocks = null;
  function start() {
    if (started || disposed || !enabled || !film || !settled || !revealed || !["high", "balanced"].includes(tier)) return;
    started = true;
    onStatus({ status: "loading", tier });
    // Seat the rocks on the film terrain (the tree's root plate) once it exists.
    Promise.all([load(), terrain()]).then(
      ([{ createRocks }, groundHeight = options.groundHeight]) => {
        if (disposed) return;
        rocks = createRocks(ROCK_LIB, { ...options, groundHeight, tier, onStatus });
        rocks.setFilmActive(film);
      },
      () => onStatus({ status: "fallback", tier }),
    );
  }
  return {
    get committed() {
      return rocks?.committed === true;
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
      return rocks?.take(frame) ?? false;
    },
    dispose() {
      if (disposed) return false;
      disposed = true;
      rocks?.dispose();
      return true;
    },
  };
}
