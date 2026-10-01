import { readFileSync } from "node:fs";
import { BufferAttribute, BufferGeometry, Group, Matrix4, Mesh, MeshStandardMaterial } from "three";

const ROOT = new URL("../../", import.meta.url);

// The component types the delivered models use, with their DataView readers.
const COMPONENTS = {
  5120: [Int8Array, "getInt8"],
  5121: [Uint8Array, "getUint8"],
  5122: [Int16Array, "getInt16"],
  5123: [Uint16Array, "getUint16"],
  5125: [Uint32Array, "getUint32"],
  5126: [Float32Array, "getFloat32"],
};
const WIDTHS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

// A delivered model's bytes: modelBytes("tree", "high") reads
// images/architecture/tree-high.glb.
export function modelBytes(role, tier) {
  return readFileSync(new URL(`images/architecture/${role}-${tier}.glb`, ROOT));
}

// A binary glTF's JSON chunk and where its binary chunk's data starts.
export function parseGlb(bytes) {
  const length = bytes.readUInt32LE(12);
  return { json: JSON.parse(bytes.toString("utf8", 20, 20 + length)), bytes, bin: 28 + length };
}

// An accessor as a BufferAttribute in its own component type, normalized as
// the file says; interleaved views are read through their byte stride.
export function readAccessor({ json, bytes, bin }, id) {
  const accessor = json.accessors[id],
    view = json.bufferViews[accessor.bufferView];
  const [Type, read] = COMPONENTS[accessor.componentType],
    size = WIDTHS[accessor.type],
    width = Type.BYTES_PER_ELEMENT;
  const stride = view.byteStride || size * width,
    start = bin + (view.byteOffset || 0) + (accessor.byteOffset || 0);
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    values = new Type(accessor.count * size);
  for (let i = 0; i < accessor.count; i++)
    for (let k = 0; k < size; k++)
      values[i * size + k] = data[read](start + i * stride + k * width, true);
  return new BufferAttribute(values, size, Boolean(accessor.normalized));
}

// The model as the asset controller hands it over, without its browser-only
// textures: { scene } holding the mesh node's geometry under its own
// transform, with the scene's extras as scene.userData and the node's as the
// mesh's.
export function glbAsset(bytes, { material = new MeshStandardMaterial() } = {}) {
  const glb = parseGlb(bytes),
    { json } = glb;
  const node = json.nodes.find((item) => item.mesh !== undefined),
    primitive = json.meshes[node.mesh].primitives[0],
    geometry = new BufferGeometry();
  for (const [name, semantic] of [
    ["position", "POSITION"],
    ["normal", "NORMAL"],
    ["uv", "TEXCOORD_0"],
  ])
    if (primitive.attributes[semantic] !== undefined)
      geometry.setAttribute(name, readAccessor(glb, primitive.attributes[semantic]));
  if (primitive.indices !== undefined) geometry.setIndex(readAccessor(glb, primitive.indices));
  const mesh = new Mesh(geometry, material);
  if (node.matrix)
    new Matrix4().fromArray(node.matrix).decompose(mesh.position, mesh.quaternion, mesh.scale);
  else {
    if (node.translation) mesh.position.fromArray(node.translation);
    if (node.rotation) mesh.quaternion.fromArray(node.rotation);
    if (node.scale) mesh.scale.fromArray(node.scale);
  }
  mesh.userData = { ...node.extras };
  const scene = new Group();
  scene.userData = { ...json.scenes?.[json.scene ?? 0]?.extras };
  scene.add(mesh);
  return { scene };
}
