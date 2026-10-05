import { ESTATE } from "../../src/scene/estate-layout.js";
import { terrainDune } from "../../src/scene/mud-ground.js";

// The live scene's analytic ground (helpers.js scene.groundHeight: the plain and
// the tower's and tree's terraces) at the film's scene offset (-6.8), for
// framing fixtures; scene-basics.test.mjs holds helpers.js to the same terms.
function terrace(x, z, base, { x: cx, z: cz, lift, flat, blend }) {
  const r = Math.hypot(x - cx, z - cz);
  if (r >= blend) return base;
  const level = terrainDune(cx, cz) + lift;
  if (r <= flat) return level;
  const t = (r - flat) / (blend - flat),
    eased = t * t * (3 - 2 * t);
  return level * (1 - eased) + base * eased;
}
export function sceneGround(x, z) {
  return terrace(x, z, terrace(x, z, terrainDune(x, z), ESTATE.tower), ESTATE.tree) - 6.8;
}
