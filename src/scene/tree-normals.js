import { Vector3 } from "three";

// Average coincident-vertex normals on a derived buffer, retaining UV splits and
// the source normals for the baseline. This softens authored polygon bands.
export function* smoothTreeNormalSteps(geometry) {
  const p = geometry.attributes.position,
    n = geometry.attributes.normal,
    sums = new Map();
  const key = (i) =>
    `${Math.round(p.getX(i) * 10000)},${Math.round(p.getY(i) * 10000)},${Math.round(p.getZ(i) * 10000)}`;
  for (let i = 0; i < p.count; i++) {
    const k = key(i),
      v = sums.get(k) || new Vector3();
    v.x += n.getX(i);
    v.y += n.getY(i);
    v.z += n.getZ(i);
    sums.set(k, v);
    if (i % 256 === 255) yield;
  }
  const result = n.clone();
  for (let i = 0; i < p.count; i++) {
    const v = sums.get(key(i)).normalize();
    result.setXYZ(i, v.x, v.y, v.z);
    if (i % 256 === 255) yield;
  }
  return result;
}

export function smoothTreeNormals(geometry) {
  const steps = smoothTreeNormalSteps(geometry);
  for (;;) {
    const next = steps.next();
    if (next.done) return next.value;
  }
}
