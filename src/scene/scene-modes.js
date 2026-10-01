// The film opens on the tower; ?view=tree opens on the tree instead (any other
// value keeps the tower), and ?angle= picks a shot within it (cinematic.js).
export const SCENE_VIEWS = Object.freeze(["tower", "tree"]);

export function resolveSceneView(search = "") {
  const view = new URLSearchParams(search).get("view");
  return SCENE_VIEWS.includes(view) ? view : "tower";
}
