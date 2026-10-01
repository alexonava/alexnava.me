import { PlaneGeometry, Vector3 } from "three";

// The dunes alone on the film terrain's coarse grid, with analytic normals:
// the baseline the terrain tests measure the film terrain against.
export function plainDunes(groundHeight, { width = 384, subdivisions = 128 } = {}) {
  const geometry = new PlaneGeometry(width, width, subdivisions, subdivisions);
  const p = geometry.attributes.position,
    n = geometry.attributes.normal;
  const normal = new Vector3(),
    step = width / subdivisions / 2;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i),
      z = -p.getY(i);
    p.setZ(i, groundHeight(x, z));
    const dx = (groundHeight(x + step, z) - groundHeight(x - step, z)) / (2 * step);
    const dz = (groundHeight(x, z + step) - groundHeight(x, z - step)) / (2 * step);
    normal.set(-dx, dz, 1).normalize();
    n.setXYZ(i, normal.x, normal.y, normal.z);
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
