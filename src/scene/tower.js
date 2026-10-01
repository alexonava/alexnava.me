import { Group } from "three";

// The tower's root under the environment, scaled by the composition.
export function createSceneTower({ parent }) {
  const root = new Group();
  parent.add(root);

  let disposed = false;

  return {
    lifecycleOrder: 20,
    root,
    dispose() {
      if (disposed) return false;
      disposed = true;
      root.visible = false;
      return true;
    },
    resize({ composition } = {}) {
      if (disposed || !composition) return false;
      root.scale.setScalar(composition.towerScale || 1);
      return true;
    },
  };
}
