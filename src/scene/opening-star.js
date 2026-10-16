import { Box3, Object3D, PerspectiveCamera, Vector3 } from "three";
import { createCinematicCamera } from "./cinematic.js";
import { OPENING_OUTLINES } from "./opening-outline.js";
import { OUTLINE_RESOLUTION, outlineKey } from "./opening-outline-key.js";
import { lensSource } from "./postprocess.js";
import { SOLAR_RADIUS } from "./solar-body.js";

// The opening shot's stored outline as measureShot() returns it for a tower whose root stands
// at height towerY, per model tier and outlineKey().
let outlines = null,
  outlinesY = null;
function storedOutlines(towerY) {
  if (outlines && outlinesY === towerY) return outlines;
  outlines = new Map();
  outlinesY = towerY;
  for (const entry of OPENING_OUTLINES) {
    const binary = atob(entry.points),
      bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const view = new DataView(bytes.buffer),
      points = new Float32Array(bytes.length / 2);
    for (let i = 0; i < points.length; i++)
      points[i] = view.getInt16(2 * i, true) * OUTLINE_RESOLUTION + (i % 3 === 1 ? towerY : 0);
    const lift = new Vector3(0, towerY, 0);
    outlines.set(`${entry.tier} ${entry.key}`, {
      points,
      target: new Vector3(...entry.target).add(lift),
      cameraY: entry.cameraY + towerY,
      footing: entry.footing + towerY,
      groundAnchor: new Vector3(...entry.groundAnchor).add(lift),
      height: entry.height,
      region: new Box3(
        new Vector3(...entry.region.slice(0, 3)),
        new Vector3(...entry.region.slice(3)),
      ).translate(lift),
      radius: entry.radius,
    });
  }
  return outlines;
}

// Where the opening shot (The watch, the tour's first) will show the star in a width x height
// canvas, before the tower loads: a cinematic camera of its own, fitted to the `tier` model's
// stored outline as the scene's camera will be fitted to the model (the same safe area and
// ground, the tower's root at towerY, the tour's phase as it opens: 0, or null without a tour),
// and the star
// projected through it as the lens projects it (lensSource(): canvas UV, y up, its radius in
// frame heights, and 1). Null when the opening is another shot, the outline is stale, or the
// star stands outside the frame.
export function openingStar({
  width,
  height,
  getSafeArea,
  getGroundY,
  sun,
  towerY = 0,
  tier = "high",
  tourPhase = 0,
  selected = "tower",
  angle = 0,
  out = [0, 0, 0, 0],
}) {
  if (selected !== "tower" || angle !== 0 || !(width > 0) || !(height > 0)) return null;
  const stored = storedOutlines(towerY);
  let missing = false;
  const camera = new PerspectiveCamera(45, width / height, 0.1, 450);
  const controller = createCinematicCamera({
    camera,
    selected: "tower",
    angle: 0,
    getSafeArea,
    getGroundY,
    measure: (root, shot) => {
      const measured = stored.get(`${tier} ${outlineKey(shot)}`);
      if (!measured) missing = true;
      return measured ?? { points: new Float32Array(0) };
    },
  });
  controller.setSubject("tower", new Object3D());
  controller.setStatus({ kind: "tower", status: "ready" });
  try {
    if (!controller.apply({ width, height, elapsedSeconds: 0, tourPhase }) || missing) return null;
    // Before disposal, which resets the camera's lens.
    camera.updateMatrixWorld();
    const star = lensSource(camera, sun, SOLAR_RADIUS, out);
    return star[3] > 0 && star[0] > 0 && star[0] < 1 && star[1] > 0 && star[1] < 1 ? star : null;
  } catch {
    return null;
  } finally {
    controller.dispose();
  }
}
