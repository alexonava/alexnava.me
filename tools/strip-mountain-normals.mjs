// Strips the NORMAL attribute from the delivered mountain models
// (images/architecture/mountain-*-{high,balanced}.glb). The massif shader
// shades from the object-space normal map alone, so the vertex normals the
// packager (Assets/Architecture/mountains-v2) writes are never read. Every
// other JSON value and binary byte stays; later buffer views close up,
// 4-byte aligned. `node tools/strip-mountain-normals.mjs` rewrites
// the six files in place, and does nothing to a model already without normals.
import { readFileSync, writeFileSync } from "node:fs";

const ROOT = new URL("../images/architecture/", import.meta.url);
const pad = (length) => Math.ceil(length / 4) * 4;

function stripNormals(bytes) {
  const jsonLength = bytes.readUInt32LE(12),
    bin = 28 + jsonLength,
    json = JSON.parse(bytes.toString("utf8", 20, 20 + jsonLength)),
    [primitive] = json.meshes[0].primitives,
    normal = primitive.attributes.NORMAL;
  if (normal === undefined) return bytes;
  const view = json.accessors[normal].bufferView;
  if (json.accessors.some((accessor, i) => i !== normal && accessor.bufferView === view)) {
    throw new Error("the normals share their buffer view");
  }
  delete primitive.attributes.NORMAL;
  json.accessors.splice(normal, 1);
  const accessor = (id) => (id > normal ? id - 1 : id);
  for (const name of Object.keys(primitive.attributes))
    primitive.attributes[name] = accessor(primitive.attributes[name]);
  primitive.indices = accessor(primitive.indices);
  const [removed] = json.bufferViews.splice(view, 1);
  for (const item of [...json.accessors, ...json.images])
    if (item.bufferView > view) item.bufferView -= 1;
  const chunks = [];
  let offset = 0;
  for (const bufferView of json.bufferViews) {
    const start = bin + (bufferView.byteOffset || 0);
    chunks.push(bytes.subarray(start, start + bufferView.byteLength));
    const end = offset + bufferView.byteLength;
    if (pad(end) > end) chunks.push(Buffer.alloc(pad(end) - end));
    bufferView.byteOffset = offset;
    offset = pad(end);
  }
  if (removed.buffer !== 0) throw new Error("one buffer expected");
  json.buffers[0].byteLength = offset;
  const text = Buffer.from(JSON.stringify(json)),
    head = Buffer.alloc(28 + pad(text.length), 0x20);
  head.writeUInt32LE(0x46546c67, 0);
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(head.length + offset, 8);
  head.writeUInt32LE(pad(text.length), 12);
  head.writeUInt32LE(0x4e4f534a, 16);
  text.copy(head, 20);
  head.writeUInt32LE(offset, 20 + pad(text.length));
  head.writeUInt32LE(0x004e4942, 24 + pad(text.length));
  return Buffer.concat([head, ...chunks]);
}

for (const role of ["ridge", "spine", "summit"])
  for (const tier of ["high", "balanced"]) {
    const file = new URL(`mountain-${role}-${tier}.glb`, ROOT),
      before = readFileSync(file),
      after = stripNormals(before);
    if (after !== before) writeFileSync(file, after);
    console.log(`mountain-${role}-${tier}.glb ${before.length} -> ${after.length}`);
  }
