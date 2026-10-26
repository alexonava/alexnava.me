// Shared by UI boot and the scene without importing the renderer. Angles here
// are zero-based; public ?angle= values remain one-based and keep their meaning.
export const SCENE_VIEWS = Object.freeze(["watch", "tree"]);
export const DEFAULT_SCENE_OPENING = Object.freeze({ view: "tree", angle: 1 });
const ANGLES = Object.freeze({ watch: 1, tree: 4 });

export function resolveSceneOpening(search = "", overrides = {}) {
  const query = new URLSearchParams(search);
  const explicit = query.has("view") || query.has("angle");
  const requested = query.get("view");
  let view = explicit
    ? SCENE_VIEWS.includes(requested)
      ? requested
      : "watch"
    : DEFAULT_SCENE_OPENING.view;
  let angle = explicit ? 0 : DEFAULT_SCENE_OPENING.angle;
  // A script selecting a subject retains the subject's first-shot fallback.
  if (overrides.view != null) {
    view = SCENE_VIEWS.includes(overrides.view) ? overrides.view : "watch";
    angle = 0;
  }
  const validAngle = (value) => Number.isInteger(value) && value >= 0 && value < ANGLES[view];
  const publicAngle = Number(query.get("angle")) - 1;
  if (validAngle(publicAngle)) angle = publicAngle;
  if (overrides.angle != null) angle = validAngle(overrides.angle) ? overrides.angle : 0;
  return { view, angle };
}

export function resolveSceneView(search = "") {
  return resolveSceneOpening(search).view;
}
