import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_SCENE_OPENING,
  resolveSceneOpening,
  SCENE_VIEWS,
} from "../src/scene/scene-modes.js";
import { DIRECTED_SHOTS } from "../src/scene/directed-shots.js";

// An ordinary visit opens The watch: main.js chooseOpening() selects it before anything
// resolves (boot.test.mjs). The resolver's own default serves a script that drives the
// scene without that choice.
test("with no address and no selection the resolver falls back to Lantern study", () => {
  assert.deepEqual(SCENE_VIEWS, ["watch", "tree"]);
  assert.ok(Object.isFrozen(DEFAULT_SCENE_OPENING));
  for (const search of ["", "?quality=high", "?sceneDebug=1", "?tour=0"])
    assert.deepEqual(resolveSceneOpening(search), { view: "tree", angle: 1 });
  assert.equal(DIRECTED_SHOTS.tree[DEFAULT_SCENE_OPENING.angle].name, "Lantern study");
});

test("public view and angle addresses count angles from one", () => {
  for (const view of ["watch", "tree"]) {
    assert.deepEqual(resolveSceneOpening(`?view=${view}`), { view, angle: 0 });
    for (let angle = 1; angle <= DIRECTED_SHOTS[view].length; angle++)
      assert.deepEqual(resolveSceneOpening(`?view=${view}&angle=${angle}`), {
        view,
        angle: angle - 1,
      });
    for (const angle of ["", "0", "-1", "99", "2.5", "invalid"])
      assert.deepEqual(resolveSceneOpening(`?view=${view}&angle=${angle}`), { view, angle: 0 });
  }
  for (const search of [
    "?view=tower",
    "?view=orbit",
    "?view=unknown",
    "?view=",
    "?angle=3",
    "?angle=0",
    "?angle=",
  ])
    assert.deepEqual(resolveSceneOpening(search), { view: "watch", angle: 0 });
});

test("scripted selections use the same validated zero-based opening contract", () => {
  assert.deepEqual(resolveSceneOpening("", { view: "watch" }), { view: "watch", angle: 0 });
  assert.deepEqual(resolveSceneOpening("", { view: "tree" }), { view: "tree", angle: 0 });
  assert.deepEqual(resolveSceneOpening("", { view: "tree", angle: 1 }), { view: "tree", angle: 1 });
  assert.deepEqual(resolveSceneOpening("?view=watch", { view: "tree", angle: 3 }), {
    view: "tree",
    angle: 3,
  });
  assert.deepEqual(resolveSceneOpening("?angle=2", { view: "tree" }), { view: "tree", angle: 1 });
  assert.deepEqual(resolveSceneOpening("", { angle: 0 }), { view: "tree", angle: 0 });
  for (const angle of [-1, 4, 1.5, "1"])
    assert.deepEqual(resolveSceneOpening("", { view: "tree", angle }), { view: "tree", angle: 0 });
});
