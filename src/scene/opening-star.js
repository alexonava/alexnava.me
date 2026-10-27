import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  Mesh,
  Object3D,
  PerspectiveCamera,
  Vector3,
} from "three";
import { createCinematicCamera } from "./cinematic.js";
import { DIRECTED_SHOTS, resolveDirectedShot } from "./directed-shots.js";
import { LANTERN_RESOLUTION, OPENING_LANTERN } from "./opening-lantern.js";
import { OPENING_OUTLINES } from "./opening-outline.js";
import { OUTLINE_RESOLUTION, outlineKey } from "./opening-outline-key.js";
import { lensSource } from "./postprocess.js";
import { LANTERN_SCALE } from "./prop-scale.js";
import { SOLAR_RADIUS } from "./solar-body.js";

// The watch's stored outline as measureShot() returned it for the lookout that stood on the
// terrace, its root at height y, per model tier and outlineKey().
let outlines = null,
  outlinesY = null;
function storedOutlines(y) {
  if (outlines && outlinesY === y) return outlines;
  outlines = new Map();
  outlinesY = y;
  for (const entry of OPENING_OUTLINES) {
    const binary = atob(entry.points),
      bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const view = new DataView(bytes.buffer),
      points = new Float32Array(bytes.length / 2);
    for (let i = 0; i < points.length; i++)
      points[i] = view.getInt16(2 * i, true) * OUTLINE_RESOLUTION + (i % 3 === 1 ? y : 0);
    const lift = new Vector3(0, y, 0);
    outlines.set(`${entry.tier} ${entry.key}`, {
      points,
      target: new Vector3(...entry.target).add(lift),
      cameraY: entry.cameraY + y,
      footing: entry.footing + y,
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

// How the watch is measured for a shot (cinematic.js `measure`): nothing stands on the terrace
// since the owner left the lookout out (2026-10-20), so The watch frames the outline the lookout
// left (opening-outline.js) for the `tier`, at its root's height; the sky, the star and the move
// keep the composition picked with it. It lifts the outline only: the watch stands at the
// world origin, where the outline was measured. Null when The watch's framing has changed since.
const rootAt = new Vector3();
export function watchMeasure(tier = "high") {
  return (root, shot) =>
    storedOutlines(root.getWorldPosition(rootAt).y).get(`${tier} ${outlineKey(shot)}`) ?? null;
}

// Where the opening shot (The watch, the tour's first) will show the star in a width x height
// canvas, before the scene commits it: a cinematic camera of its own, fitted to the `tier`'s
// stored outline as the scene's camera will be (the same safe area and ground, the watch's root
// at watchY, the tour's phase as it opens: 0, or null without a tour), and the star projected
// through it as the lens projects it (lensSource(): canvas UV, y up, its radius in frame
// heights, and 1). Null when the opening is another shot, the outline is stale, or the star
// stands outside the frame.
export function openingStar({
  width,
  height,
  getSafeArea,
  getGroundY,
  sun,
  watchY = 0,
  tier = "high",
  tourPhase = 0,
  selected = "watch",
  angle = 0,
  out = [0, 0, 0, 0],
}) {
  if (selected !== "watch" || angle !== 0 || !(width > 0) || !(height > 0)) return null;
  const measure = watchMeasure(tier);
  let missing = false;
  const camera = new PerspectiveCamera(45, width / height, 0.1, 450);
  const controller = createCinematicCamera({
    camera,
    selected: "watch",
    angle: 0,
    getSafeArea,
    getGroundY,
    measure: (root, shot) => {
      const measured = measure(root, shot);
      if (!measured) missing = true;
      return measured ?? { points: new Float32Array(0) };
    },
  });
  const root = new Object3D();
  root.position.y = watchY;
  root.updateMatrixWorld();
  controller.setSubject("watch", root);
  controller.setStatus({ kind: "watch", status: "ready" });
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

// The supplied lantern as its stored outline stands in for it (opening-lantern.js): a mesh of
// slivers from each corner of the hull to its centre, which directed-shots.js measureShot()
// measures as it measures the model: every corner (one on the edge of the shot's region kept as
// the model's surface keeps it), and the centre, inside the hull, binding no fit. Under a root of
// its own and named as the scene's lantern is, so a shot framed on the lantern finds it.
let lanternStandIn = null;
function storedLantern() {
  if (lanternStandIn) return lanternStandIn;
  const binary = atob(OPENING_LANTERN.points),
    count = binary.length / 6,
    corners = new Float32Array(3 * count),
    centre = [0, 0, 0];
  for (let i = 0; i < 3 * count; i++) {
    const bits = binary.charCodeAt(2 * i) | (binary.charCodeAt(2 * i + 1) << 8);
    corners[i] = ((bits << 16) >> 16) * LANTERN_RESOLUTION;
    centre[i % 3] += corners[i] / count;
  }
  const positions = new Float32Array(9 * count);
  for (let i = 0; i < count; i++)
    for (let k = 0; k < 3; k++) {
      positions[9 * i + k] = corners[3 * i + k];
      positions[9 * i + 3 + k] = positions[9 * i + 6 + k] = centre[k];
    }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  const root = new Object3D(),
    lantern = new Object3D();
  lantern.name = "tree-lantern";
  lantern.scale.setScalar(LANTERN_SCALE);
  lantern.add(new Mesh(geometry));
  root.add(lantern);
  lanternStandIn = {
    root,
    lantern,
    flame: new Vector3(...OPENING_LANTERN.luminousCenter),
    // The tree's shots come after the watch's commit, as in the scene.
    watch: new Object3D(),
  };
  return lanternStandIn;
}

// Where the opening shot, when it frames the whole lantern alone (Lantern study, which opens the
// film by chance: main.js chooseOpening()), will show the lantern's flame in a width x height
// canvas before the scene has the models: a cinematic camera of its own fitted to the supplied
// lantern's stored outline as the scene's camera fits the lantern (the same safe area and ground,
// the lantern standing on `foot`, its ground point in the world, drawn at prop-scale.js
// LANTERN_SCALE, and the tour's phase as it opens), and the flame, its luminous centre, projected
// as the lens projects it (lensSource(): canvas UV, y up, `glow` world units about it in frame
// heights, and 1). The hull fits as the model does only when nothing crops the lantern (the
// shot's region its whole height, no focus). Null when the opening is another shot, a form of
// it that crops the lantern, or the flame stands outside the frame.
const flameAt = new Vector3();
export function openingFlame({
  width,
  height,
  getSafeArea,
  getGroundY,
  foot,
  glow,
  tourPhase = 0,
  selected = "watch",
  angle = 0,
  out = [0, 0, 0, 0],
}) {
  if (selected !== "tree" || !DIRECTED_SHOTS.tree[angle] || !(width > 0) || !(height > 0)) {
    return null;
  }
  const shot = resolveDirectedShot(DIRECTED_SHOTS.tree[angle], width, height);
  if (shot.subject !== "tree-lantern" || shot.focus || shot.region[0] > 0 || shot.region[1] < 1)
    return null;
  if (!foot) return null;
  const { root, lantern, flame, watch } = storedLantern();
  lantern.position.copy(foot);
  root.updateMatrixWorld(true);
  const camera = new PerspectiveCamera(45, width / height, 0.1, 450);
  const controller = createCinematicCamera({
    camera,
    selected: "tree",
    angle,
    getSafeArea,
    getGroundY,
  });
  controller.setSubject("watch", watch);
  controller.setStatus({ kind: "watch", status: "ready" });
  controller.setSubject("tree", root);
  controller.setStatus({ kind: "tree", status: "ready" });
  try {
    if (!controller.apply({ width, height, elapsedSeconds: 0, tourPhase })) return null;
    // Before disposal, which resets the camera's lens.
    camera.updateMatrixWorld();
    const source = lensSource(camera, lantern.localToWorld(flameAt.copy(flame)), glow, out);
    return source[3] > 0 && source[0] > 0 && source[0] < 1 && source[1] > 0 && source[1] < 1
      ? source
      : null;
  } catch {
    return null;
  } finally {
    controller.dispose();
  }
}
