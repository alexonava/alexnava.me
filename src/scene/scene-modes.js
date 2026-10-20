// The film opens on the watch, the sky over the terrace; ?view=tree opens on the
// tree instead (any other value keeps the watch), and ?angle= picks a shot within
// it (cinematic.js).
export const SCENE_VIEWS = Object.freeze(["watch", "tree"]);

export function resolveSceneView(search = "") {
  const view = new URLSearchParams(search).get("view");
  return SCENE_VIEWS.includes(view) ? view : "watch";
}
