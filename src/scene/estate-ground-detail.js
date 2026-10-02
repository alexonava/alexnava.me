import {
  BufferGeometry,
  Float32BufferAttribute,
  DoubleSide,
  Mesh,
  MeshLambertMaterial,
} from "three";
import { DEPTH_LAYER, stampDepthLayer } from "./depth-layers.js";
import { ESTATE, estatePathDistance } from "./estate-layout.js";
import { rockKeepouts } from "./rock-scatter.js";

// The same winding approach stays clear in every camera and quality tier.
// Its centerline joins the tower's entrance side to the tree's lantern clearing.
export { estatePathDistance };

export function createEstateGroundDetail(groundHeight) {
  let seed = 73421;
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  const positions = [],
    colors = [],
    indices = [];
  let count = 0;
  // Growth never pokes through a scattered rock or its pebble (rock-scatter.js).
  const rocks = rockKeepouts();
  for (let attempt = 0; attempt < 2400 && count < 360; attempt++) {
    const tree = attempt % 2,
      angle = random() * Math.PI * 2,
      anchor = tree ? ESTATE.tree : ESTATE.tower;
    const radius = (tree ? 5.9 : 10.5) + Math.pow(random(), 1.7) * (tree ? 10 : 17);
    const x = anchor.x + Math.cos(angle) * radius;
    const z = anchor.z + Math.sin(angle) * radius;
    if (
      estatePathDistance(x, z) < ESTATE.path.clear ||
      Math.sin(x * 0.6 + Math.cos(z * 0.37)) < -0.35 ||
      rocks.some((rock) => Math.hypot(x - rock.x, z - rock.z) < rock.radius)
    )
      continue;
    const size = 0.13 + random() * 0.3,
      tone = random();
    for (let blade = 0; blade < 3; blade++) {
      const yaw = angle + (blade * Math.PI) / 3,
        w = size * 0.085;
      const sx = Math.cos(yaw),
        sz = Math.sin(yaw),
        start = positions.length / 3;
      const y = groundHeight(x, z) - 0.018;
      positions.push(
        x - sx * w,
        y,
        z - sz * w,
        x + sx * w,
        y,
        z + sz * w,
        x + sx * w * 0.7 + sz * size * 0.18,
        y + size * 0.62,
        z + sz * w * 0.7 - sx * size * 0.18,
        x + sz * size * 0.32,
        y + size,
        z - sx * size * 0.32,
      );
      for (let v = 0; v < 4; v++) {
        const tip = 0.72 + v * 0.09;
        colors.push(
          (0.1 + tone * 0.045) * tip,
          (0.13 + tone * 0.04) * tip,
          (0.077 + tone * 0.03) * tip,
        );
      }
      indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
    }
    count++;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  // Film-only growth dissolves with the ground it stands on.
  const material = stampDepthLayer(
    new MeshLambertMaterial({ vertexColors: true, side: DoubleSide }),
    DEPTH_LAYER.ground,
  );
  const mesh = new Mesh(geometry, material);
  // terrain-build.js settleRoots() finds it by name and raises the blades that
  // stand on the tree's knoll once the film terrain arrives.
  mesh.name = "estate-ground-growth";
  mesh.castShadow = mesh.receiveShadow = false;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  mesh.visible = false;
  let active = false,
    tier = "high",
    disposed = false;
  function apply() {
    mesh.visible = active && tier !== "low";
    geometry.setDrawRange(0, Math.min(count, tier === "balanced" ? 300 : 360) * 18);
  }
  return {
    mesh,
    setActive(value) {
      if (!disposed) {
        active = Boolean(value);
        apply();
      }
    },
    applyQuality(profile = {}) {
      if (disposed) return false;
      tier = profile.tier || "high";
      apply();
      return true;
    },
    dispose() {
      if (disposed) return false;
      disposed = true;
      mesh.removeFromParent();
      geometry.dispose();
      material.dispose();
      return true;
    },
  };
}
