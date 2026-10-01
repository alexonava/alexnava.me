import assert from "node:assert/strict";
import test from "node:test";
import { resolveSceneView, SCENE_VIEWS } from "../src/scene/scene-modes.js";

test("the film opens on the tower unless the URL asks for the tree", () => {
  assert.deepEqual(SCENE_VIEWS, ["tower", "tree"]);
  for (const search of [
    "",
    "?view=tower&angle=1",
    "?quality=balanced&qaTime=0&tour=0",
    "?view=unknown",
  ]) {
    assert.equal(resolveSceneView(search), "tower", search);
  }
  assert.equal(resolveSceneView("?view=tree"), "tree");
  assert.equal(resolveSceneView("?view=tree&angle=4&sceneDebug=1"), "tree");
});
