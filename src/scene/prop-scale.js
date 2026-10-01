import { Box3, Vector3 } from "three";
import { DOOR_HEIGHT as D } from "./mud-ground.js";
// Sizes the authored tree and its post lantern to the estate's doorway scale
// and seats both on the ground while active.
export function createPropScale({ groundRoot, groundHeight }) {
  let active = false,
    disposed = false,
    tree = null,
    treeUndo = [];
  const save = (o, list) => {
    const p = o.position.clone(),
      s = o.scale.clone();
    list.push(() => {
      o.position.copy(p);
      o.scale.copy(s);
      o.updateMatrixWorld(true);
    });
  };
  function bounds(o, ownGeometry = false) {
    o.updateWorldMatrix(true, true);
    if (ownGeometry) {
      o.geometry.computeBoundingBox();
      return o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld);
    }
    return new Box3().setFromObject(o);
  }
  function ground(o, ownGeometry = false) {
    const b = bounds(o, ownGeometry),
      w = o.getWorldPosition(new Vector3()),
      local = groundRoot.worldToLocal(w.clone());
    local.y = groundHeight(local.x, local.z);
    const target = groundRoot.localToWorld(local);
    const bottom = o.parent.worldToLocal(new Vector3(w.x, b.min.y, w.z));
    const top = o.parent.worldToLocal(new Vector3(w.x, target.y, w.z));
    o.position.y += top.y - bottom.y;
    o.updateMatrixWorld(true);
  }
  function restoreTree() {
    treeUndo
      .splice(0)
      .reverse()
      .forEach((f) => f());
  }
  function scaleTree() {
    restoreTree();
    if (!active || !tree) return;
    const root = tree.root,
      t = root.getObjectByName("meshy-tree"),
      l = root.getObjectByName("tree-lantern");
    if (t) {
      save(t, treeUndo);
      // Measured by its own geometry, so nothing parented to the tree changes
      // its size, footing or camera fit.
      const size = bounds(t, true).getSize(new Vector3());
      // 4.2 doorways tall, the tree reads as a mature tree beside the tower.
      t.scale.multiplyScalar((4.2 * D) / size.y);
      ground(t, true);
    }
    if (l) {
      save(l, treeUndo);
      // A hand-scale post lantern, not a garden fixture.
      l.scale.setScalar((0.3 * D) / 2.48);
      ground(l);
    }
    for (const light of [tree.light, tree.fillLight])
      if (light) {
        const distance = light.distance;
        // Only the fill position is scaled here. Restoring the practical's
        // untouched position would overwrite a subsequently loaded lantern's
        // authored luminous centre.
        if (light === tree.fillLight) save(light, treeUndo);
        treeUndo.push(() => {
          light.distance = distance;
        });
        const f = light === tree.light ? (0.3 * D) / 2.48 : (4.2 * D) / 22;
        light.distance *= f;
        if (light === tree.fillLight) light.position.multiplyScalar(f);
      }
  }
  return {
    get active() {
      return active;
    },
    setTree(next) {
      if (disposed) return false;
      restoreTree();
      tree = next;
      scaleTree();
    },
    setActive(next) {
      if (disposed || active === Boolean(next)) return;
      active = Boolean(next);
      if (!active) {
        restoreTree();
        return;
      }
      try {
        scaleTree();
      } catch (e) {
        this.setActive(false);
        throw e;
      }
    },
    dispose() {
      if (disposed) return false;
      this.setActive(false);
      disposed = true;
      tree = null;
      return true;
    },
  };
}
