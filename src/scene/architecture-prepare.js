import { Box3, Float32BufferAttribute, Matrix3, Matrix4, Sphere, Vector3 } from "three";

// The same attribute arithmetic as Three's BufferGeometry transforms, split
// into small batches so quantized models do not assemble in one long task.
function* geometryBounds(geometry, box, sphere) {
  const position = geometry.attributes.position;
  const bounds = box ? (geometry.boundingBox ||= new Box3()) : new Box3();
  bounds.makeEmpty();
  const point = new Vector3();
  for (let i = 0; i < position.count; i++) {
    bounds.expandByPoint(point.fromBufferAttribute(position, i));
    if (i % 256 === 255) yield;
  }
  if (sphere) {
    geometry.boundingSphere ||= new Sphere();
    const center = geometry.boundingSphere.center;
    bounds.getCenter(center);
    let radiusSq = 0;
    for (let i = 0; i < position.count; i++) {
      radiusSq = Math.max(
        radiusSq,
        center.distanceToSquared(point.fromBufferAttribute(position, i)),
      );
      if (i % 256 === 255) yield;
    }
    geometry.boundingSphere.radius = Math.sqrt(radiusSq);
  }
}

function* transformGeometry(geometry, matrix) {
  const point = new Vector3();
  const normalMatrix = new Matrix3().getNormalMatrix(matrix);
  for (const name of ["position", "normal", "tangent"]) {
    const attribute = geometry.attributes[name];
    if (!attribute) continue;
    for (let i = 0; i < attribute.count; i++) {
      point.fromBufferAttribute(attribute, i);
      if (name === "position") point.applyMatrix4(matrix);
      else if (name === "normal") point.applyNormalMatrix(normalMatrix);
      else point.transformDirection(matrix);
      attribute.setXYZ(i, point.x, point.y, point.z);
      if (i % 256 === 255) yield;
    }
    attribute.needsUpdate = true;
  }
  if (geometry.boundingBox || geometry.boundingSphere)
    yield* geometryBounds(
      geometry,
      Boolean(geometry.boundingBox),
      Boolean(geometry.boundingSphere),
    );
}

function* prepareGeometrySteps(source, record, { treeHeight, smoothTreeNormalSteps }) {
  // Morph targets need Three's own bounds rules; the shipped static assets
  // contain none. The synchronous constructor remains their fallback.
  if (Object.values(source.geometry.morphAttributes).some((attributes) => attributes.length))
    throw new Error("Prepared architecture must have no morph targets.");
  const geometry = (record.geometry = source.geometry.clone());
  const world = source.matrixWorld.clone();
  yield;
  for (const name of ["position", "normal"]) {
    const attribute = geometry.getAttribute(name);
    if (!attribute) continue;
    const values = new Float32Array(attribute.count * 3);
    for (let i = 0; i < attribute.count; i++) {
      values[i * 3] = attribute.getX(i);
      values[i * 3 + 1] = attribute.getY(i);
      values[i * 3 + 2] = attribute.getZ(i);
      if (i % 256 === 255) yield;
    }
    geometry.setAttribute(name, new Float32BufferAttribute(values, 3));
  }
  yield* transformGeometry(geometry, world);
  yield* geometryBounds(geometry, true, false);
  const { min, max } = geometry.boundingBox;
  const dimensions = new Vector3().subVectors(max, min);
  const height = dimensions.y;
  if (!Number.isFinite(height) || height <= 0) throw new Error("Tree asset has empty bounds.");
  const scale = treeHeight / height;
  yield* transformGeometry(geometry, new Matrix4().makeTranslation(0, -min.y, 0));
  yield* transformGeometry(geometry, new Matrix4().makeScale(scale, scale, scale));
  yield* geometryBounds(geometry, false, true);
  record.originalNormals = geometry.attributes.normal.array.slice();
  yield;
  record.softenedNormals = (yield* smoothTreeNormalSteps(geometry)).array;
}

// Loading retains the parsed source until this settles; cancellation returns
// false so the asset controller can still receive and release a stale source.
// A constructor consumes the prepared clone and takes over its normal disposal.
export function prepareArchitectureGeometry(
  asset,
  { role, signal, schedule = (task) => setTimeout(task, 0) } = {},
  preparedArchitecture,
  configuration,
) {
  if (role !== "tree" || signal?.aborted) return Promise.resolve(false);
  if (preparedArchitecture.has(asset)) return Promise.resolve(true);
  const record = { role, geometry: null, detach: () => {} };
  const steps = prepareGeometrySteps(configuration.source, record, configuration);
  return new Promise((resolve) => {
    let finished = false;
    const release = () => {
      signal?.removeEventListener("abort", abort);
      if (preparedArchitecture.get(asset) === record) preparedArchitecture.delete(asset);
      record.geometry?.dispose();
      record.geometry = null;
    };
    const abort = () => {
      release();
      if (!finished) {
        finished = true;
        resolve(false);
      }
    };
    record.detach = () => signal?.removeEventListener("abort", abort);
    signal?.addEventListener("abort", abort, { once: true });
    const slice = () => {
      if (finished) return;
      const until = performance.now() + 4;
      try {
        do {
          if (steps.next().done) {
            finished = true;
            preparedArchitecture.set(asset, record);
            resolve(true);
            return;
          }
        } while (performance.now() < until);
        schedule(slice);
      } catch {
        release();
        finished = true;
        resolve(false);
      }
    };
    schedule(slice);
  });
}
