// Bakes the supplied lantern's stored outline for src/scene/opening-lantern.js from both
// delivered lantern models (images/architecture/lantern-{high,balanced}.glb): the convex hull
// of each as lantern.js createLanternArchitecture() normalizes it (its foot at the origin,
// LANTERN_AUTHORING_HEIGHT tall), its corners as multiples of LANTERN_RESOLUTION sorted by
// height, and its flame's place (luminousCenter). The tiers share one shape, so one outline
// serves both; the bake fails where they differ. `node tools/bake-lantern-outline.mjs` prints
// the constant to paste into opening-lantern.js; the opening-star test re-bakes and compares.
import { fileURLToPath } from "node:url";
import { Vector3 } from "three";
import { ConvexHull } from "three/examples/jsm/math/ConvexHull.js";
import { createLanternArchitecture } from "../src/scene/lantern.js";
import { LANTERN_RESOLUTION } from "../src/scene/opening-lantern.js";
import { glbAsset, modelBytes } from "../test/support/glb.mjs";

export const LANTERN_TIERS = Object.freeze(["high", "balanced"]);

// The tier's lantern as the scene draws it, before the prop scale: its hull's corners as
// integers (x, y, z in turn) and its luminous centre to 1e-4 lantern units.
export function lanternOutline(tier) {
  const { root, luminousCenter, dispose } = createLanternArchitecture({
    asset: glbAsset(modelBytes("lantern", tier)),
  });
  try {
    root.updateMatrixWorld(true);
    const points = [];
    root.traverse((mesh) => {
      if (!mesh.isMesh) return;
      const position = mesh.geometry.attributes.position;
      for (let i = 0; i < position.count; i++)
        points.push(new Vector3().fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld));
    });
    const corners = new Map();
    for (const face of new ConvexHull().setFromPoints(points).faces) {
      let edge = face.edge;
      do {
        const { x, y, z } = edge.head().point,
          corner = [x, y, z].map((v) => Math.round(v / LANTERN_RESOLUTION));
        corners.set(corner.join(","), corner);
        edge = edge.next;
      } while (edge !== face.edge);
    }
    const sorted = [...corners.values()].sort((a, b) => a[1] - b[1] || a[0] - b[0] || a[2] - b[2]);
    return {
      points: sorted.flat(),
      luminousCenter: luminousCenter.toArray().map((v) => Math.round(v * 1e4) / 1e4),
    };
  } finally {
    dispose();
  }
}

// The outline both tiers share, as opening-lantern.js stores it.
export function bakeLanternOutline() {
  const [first, ...rest] = LANTERN_TIERS.map(lanternOutline);
  for (const other of rest)
    if (JSON.stringify(other) !== JSON.stringify(first))
      throw new Error("The lantern's tiers differ in shape: store an outline per tier.");
  const bytes = Buffer.alloc(2 * first.points.length);
  first.points.forEach((value, i) => bytes.writeInt16LE(value, 2 * i));
  return { points: bytes.toString("base64"), luminousCenter: first.luminousCenter };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { points, luminousCenter } = bakeLanternOutline();
  console.log(`export const OPENING_LANTERN = Object.freeze({
  points:
    "${points}",
  luminousCenter: Object.freeze([${luminousCenter.join(", ")}]),
});`);
}
