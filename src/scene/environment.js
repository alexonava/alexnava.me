import { Group } from "three";
import { createEstateGroundDetail } from "./estate-ground-detail.js";

// The ground's root (the ground, hills, rocks, tower and tree hang under it)
// and the film's ground detail.
export function createSceneEnvironment({ groundHeight, parent, profile }) {
  const root = new Group();
  parent.add(root);

  let disposed = false;
  let groundDetail = null,
    currentProfile = profile;

  return {
    lifecycleOrder: 10,
    root,
    applyQuality(nextProfile = {}) {
      if (disposed) return false;
      currentProfile = nextProfile;
      groundDetail?.applyQuality(nextProfile);
      return true;
    },
    dispose() {
      if (disposed) return false;
      disposed = true;
      root.visible = false;
      groundDetail?.dispose();
      return true;
    },
    // The grass's wind clock (estate-ground-detail.js).
    update(frame) {
      return disposed ? false : (groundDetail?.update(frame) ?? false);
    },
    resize({ composition } = {}) {
      if (disposed || !composition) return false;
      root.position.y = composition.sceneOffsetY;
      return true;
    },
    setFilmTreatment(active) {
      if (disposed) return false;
      if (active && !groundDetail) {
        groundDetail = createEstateGroundDetail(groundHeight);
        root.add(groundDetail.mesh);
        groundDetail.applyQuality(currentProfile);
      }
      groundDetail?.setActive(active);
      return true;
    },
  };
}
