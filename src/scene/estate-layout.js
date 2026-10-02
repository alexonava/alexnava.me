// The estate's anchors in world x/z: the one place the tower, tree and lantern
// positions live. The ground shading, tufts, rocks and the tree and lantern
// builders read them here, and nothing reads the tree or lantern geometry, so
// replacement models only need these points. helpers.js restates the tower and
// tree terraces (lift, flat and blend radii); a test holds the two equal.
// clear: keep-out radius for scattered rocks. root: the root contact's radius
// (rock-scatter.js estateContacts()). sink: how far prop-scale.js sets the tree
// into the soil below its lowest vertex (terrain-build.js TREE_SINK restates it).
export const ESTATE = Object.freeze({
  tower: Object.freeze({ x: 0, z: 0, lift: 1, flat: 9, blend: 20, clear: 16 }),
  tree: Object.freeze({
    x: 55.1,
    z: 36.1,
    lift: 0.75,
    flat: 6,
    blend: 14,
    root: 3.2,
    clear: 8,
    sink: 0.45,
  }),
  // The lantern stands `offset` units from the tree toward the tower.
  lantern: Object.freeze({ offset: 5, clear: 1.2 }),
  // The winding approach from the tower's entrance side to the lantern clearing.
  path: Object.freeze({ bend: 2.4, clear: 2.1 }),
});

export function estateLantern() {
  const { tree, tower, lantern } = ESTATE,
    length = Math.hypot(tower.x - tree.x, tower.z - tree.z);
  return {
    x: tree.x + ((tower.x - tree.x) / length) * lantern.offset,
    z: tree.z + ((tower.z - tree.z) / length) * lantern.offset,
  };
}

// A point `dist` units from an anchor ("tower", "tree" or "lantern") at the
// world angle `deg` (atan2(z, x), degrees).
export function estatePoint(anchor, deg, dist) {
  const { x, z } = anchor === "lantern" ? estateLantern() : ESTATE[anchor],
    angle = (deg * Math.PI) / 180;
  return { x: x + Math.cos(angle) * dist, z: z + Math.sin(angle) * dist };
}

// Distance from the approach's centreline, which bends 2.4 units either side
// of the straight line from the tower to the tree.
export function estatePathDistance(x, z) {
  const { tower, tree, path } = ESTATE,
    length = Math.hypot(tree.x - tower.x, tree.z - tower.z),
    dx = (tree.x - tower.x) / length,
    dz = (tree.z - tower.z) / length,
    px = x - tower.x,
    pz = z - tower.z;
  const along = Math.max(0, Math.min(length, px * dx + pz * dz));
  const bend = Math.sin((along / length) * Math.PI * 2) * path.bend;
  return Math.hypot(px - dx * along + dz * bend, pz - dz * along - dx * bend);
}
