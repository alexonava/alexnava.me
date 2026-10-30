import assert from "node:assert/strict";
import test from "node:test";
import { SLATE_NOISE_CELLS } from "../src/scene/mud-ground.js";
import { bakeSlateNoise, createSlateNoiseMap, NOISE_MAP } from "../src/scene/noise-map.js";

// The shader's own value noise (mud-ground.js slateHash() and slateNoise()), in JavaScript.
const fract = (x) => x - Math.floor(x);
function hash(x, y) {
  let a = fract(x * 0.1031),
    b = fract(y * 0.1031),
    c = fract(x * 0.1031);
  const d = a * (b + 33.33) + b * (c + 33.33) + c * (a + 33.33);
  a += d;
  b += d;
  c += d;
  return fract((a + b) * c);
}

test("the lite ground's baked noise is the shader's value noise over a wrapping lattice", () => {
  assert.equal(NOISE_MAP.cells, SLATE_NOISE_CELLS, "the GLSL reads the map over its own cells");
  const { cells, texels } = NOISE_MAP,
    size = cells * texels,
    data = bakeSlateNoise();
  assert.equal(data.length, size * size * 4);
  // At a texel centre the map holds the smoothed noise of the lattice about it.
  for (const [u, v] of [
    [0, 0],
    [17, 3],
    [100, 200],
    [size - 1, size - 1],
  ]) {
    const px = (u + 0.5) / texels,
      py = (v + 0.5) / texels,
      ix = Math.floor(px),
      iy = Math.floor(py),
      s = (t) => t * t * (3 - 2 * t),
      sx = s(px - ix),
      sy = s(py - iy),
      h = (dx, dy) => hash((ix + dx) % cells, (iy + dy) % cells),
      top = h(0, 0) + (h(1, 0) - h(0, 0)) * sx,
      bottom = h(0, 1) + (h(1, 1) - h(0, 1)) * sx,
      k = (v * size + u) * 4;
    assert.ok(Math.abs(data[k] / 255 - (top + (bottom - top) * sy)) <= 0.5 / 255);
    assert.equal(data[k + 3], 255);
  }
  // It wraps: the last column's right neighbour is the first's lattice.
  const map = createSlateNoiseMap();
  assert.equal(map.image.width, size);
  assert.equal(map.wrapS, map.wrapT);
  map.dispose();
});
