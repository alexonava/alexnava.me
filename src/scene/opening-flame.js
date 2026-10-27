import { LANTERN_RESOLUTION, OPENING_LANTERN } from "./opening-lantern.js";

// Borrow constructors and camera helpers from the scene; this lazy helper must
// not import the side-effectful scene graph back into its preparation chunk.
export function createOpeningFlame({
  BufferAttribute,
  BufferGeometry,
  Mesh,
  Object3D,
  PerspectiveCamera,
  Vector3,
  createCinematicCamera,
  DIRECTED_SHOTS,
  resolveDirectedShot,
  lensSource,
  LANTERN_SCALE,
}) {
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
  const flameAt = /* @__PURE__ */ new Vector3();
  function openingFlame({
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

  return openingFlame;
}
