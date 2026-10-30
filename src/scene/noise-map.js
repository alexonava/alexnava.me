// The lite ground's baked value noise (mud-ground.js SLATE_NOISE_MAP, SLATE_LITE), a lazy
// chunk: phones and laptops open on The watch, which shows no ground, so it lands before the
// ground first draws without weighing on the scene's entry.
// It imports only Three.js: the ground's GLSL reads it over mud-ground.js SLATE_NOISE_CELLS.
import { DataTexture, LinearFilter, RepeatWrapping } from "three";

// The lattice's cells across (as SLATE_NOISE_CELLS) and texels a cell.
export const NOISE_MAP = Object.freeze({ cells: 32, texels: 8 });

export function bakeSlateNoise({ cells, texels } = NOISE_MAP) {
  const size = cells * texels,
    data = new Uint8Array(size * size * 4),
    fract = (x) => x - Math.floor(x),
    wrap = (i) => ((i % cells) + cells) % cells;
  // slateHash(), as the shader computes it.
  const hash = (x, y) => {
    let a = fract(x * 0.1031),
      b = fract(y * 0.1031),
      c = fract(x * 0.1031);
    const d = a * (b + 33.33) + b * (c + 33.33) + c * (a + 33.33);
    a += d;
    b += d;
    c += d;
    return fract((a + b) * c);
  };
  for (let v = 0; v < size; v++)
    for (let u = 0; u < size; u++) {
      const px = (u + 0.5) / texels,
        py = (v + 0.5) / texels,
        ix = Math.floor(px),
        iy = Math.floor(py),
        fx = px - ix,
        fy = py - iy,
        sx = fx * fx * (3 - 2 * fx),
        sy = fy * fy * (3 - 2 * fy),
        h = (dx, dy) => hash(wrap(ix + dx), wrap(iy + dy)),
        top = h(0, 0) + (h(1, 0) - h(0, 0)) * sx,
        bottom = h(0, 1) + (h(1, 1) - h(0, 1)) * sx,
        k = (v * size + u) * 4;
      data[k] = data[k + 1] = data[k + 2] = Math.round(255 * (top + (bottom - top) * sy));
      data[k + 3] = 255;
    }
  return data;
}

export function createSlateNoiseMap(map = NOISE_MAP) {
  const size = map.cells * map.texels,
    texture = new DataTexture(bakeSlateNoise(map), size, size);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.magFilter = texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}
