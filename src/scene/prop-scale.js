import { Box3, Group, Vector3 } from "three";
import { DOOR_HEIGHT as D } from "./mud-ground.js";
export function createPropScale({
  groundRoot,
  groundHeight,
  stones = [],
  rubble = [],
  plants = [],
  plantRecords = [],
  torches = [],
  trim = [],
}) {
  let active = false,
    disposed = false,
    undo = [],
    tree = null,
    treeUndo = [];
  const save = (o, list = undo) => {
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
  function fit(o, min, max, height = Infinity, width = Infinity, list = undo) {
    save(o, list);
    const size = bounds(o).getSize(new Vector3()),
      long = Math.max(size.x, size.y, size.z);
    if (!long) return;
    const f = Math.min(
      Math.max(min / long, Math.min(1, max / long)),
      height / (size.y || 1),
      width / (Math.max(size.x, size.z) || 1),
    );
    o.scale.multiplyScalar(f);
    ground(o);
  }
  function wrap(objects, pivot, scale, target = pivot) {
    const items = objects.filter(Boolean);
    if (!items.length) return;
    const parent = items[0].parent,
      g = new Group();
    parent.add(g);
    g.scale.setScalar(scale);
    g.position.copy(target).addScaledVector(pivot, -scale);
    for (const o of items) {
      const old = o.parent;
      g.add(o);
      undo.push(() => old.add(o));
    }
    g.updateWorldMatrix(true, true);
    undo.unshift(() => g.removeFromParent());
  }
  function scaleTree() {
    treeUndo
      .splice(0)
      .reverse()
      .forEach((f) => f());
    if (!active || !tree) return;
    const root = tree.root,
      t = root.getObjectByName("meshy-tree"),
      l = root.getObjectByName("tree-lantern");
    if (t) {
      save(t, treeUndo);
      // Leaf accents inherit this transform, but their distribution must not
      // change the authored tree's size, footing or subsequent camera fit.
      const size = bounds(t, true).getSize(new Vector3());
      // Larger canopy: the tree now reads as a mature tree beside the tower.
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
      treeUndo
        .splice(0)
        .reverse()
        .forEach((f) => f());
      tree = next;
      scaleTree();
    },
    setActive(next) {
      if (disposed || active === Boolean(next)) return;
      active = Boolean(next);
      if (!active) {
        treeUndo
          .splice(0)
          .reverse()
          .forEach((f) => f());
        undo
          .splice(0)
          .reverse()
          .forEach((f) => f());
        return;
      }
      try {
        stones.forEach((o) => fit(o, 0.02 * D, 0.1 * D));
        rubble.forEach((o) => fit(o, 0.1 * D, 0.25 * D));
        plants.forEach((o) => fit(o, 0, Infinity, 0.12 * D, 0.25 * D));
        for (const r of plantRecords) {
          const old = { baseY: r.baseY, amp: r.amp };
          fit(r.mesh, 0, Infinity, 0.12 * D, 0.25 * D);
          r.baseY = r.mesh.position.y;
          r.amp = Math.min(r.amp, 0.01 * D);
          undo.push(() => Object.assign(r, old));
        }
        for (const o of trim) {
          save(o);
          const b = bounds(o),
            h = b.max.y - b.min.y;
          if (h > 0.08 * D) {
            o.scale.z *= (0.08 * D) / h;
          }
        }
        for (const r of torches) {
          const base = new Vector3(r.baseX, groundHeight(r.baseX, r.baseZ), r.baseZ);
          fit(r.stand, 0, Infinity);
          save(r.stand);
          const h = bounds(r.stand).getSize(new Vector3()).y;
          r.stand.scale.multiplyScalar((0.63 * D) / h);
          ground(r.stand);
          const pivot = new Vector3(r.baseX, r.baseFlameY, r.baseZ),
            target = base.clone();
          target.y += 0.69 * D;
          wrap(
            [r.flameCore, r.flameOuter, r.flameHot, ...r.embers.map((e) => e.mesh)],
            pivot,
            (0.12 * D) / 2.4,
            target,
          );
          if (r.light) {
            const dist = r.light.distance;
            undo.push(() => (r.light.distance = dist));
            r.light.distance *= (0.75 * D) / 4;
            wrap([r.light], pivot, 1, target);
          }
        }
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
