import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../src/ui/scene-controls.js", import.meta.url), "utf8");
const STORAGE_KEY = "babel:scene-paused";

function run(storage) {
  const window = { localStorage: storage };
  window.BabelSite = {};
  vm.runInNewContext(source, { window });
  return window.BabelSite;
}

test("the retired Pause scene control leaves no stored pause behind", () => {
  const store = new Map([[STORAGE_KEY, "1"]]);
  const site = run({ removeItem: (key) => store.delete(key) });
  assert.equal(site.ui.initSceneControls(), true);
  assert.equal(store.has(STORAGE_KEY), false, "a visitor who paused before is not stuck paused");
  assert.equal(site.scene.visitorPausedPreference, false);
});

test("blocked or missing storage is a safe no-op", () => {
  for (const storage of [
    undefined,
    {
      removeItem() {
        throw new Error("blocked");
      },
    },
  ]) {
    const site = run(storage);
    assert.equal(site.ui.initSceneControls(), true);
    assert.equal(site.scene.visitorPausedPreference, false);
  }
});
