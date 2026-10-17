import { Group } from "three";
import { createEstateGroundDetail, prepareEstateGroundDetail } from "./estate-ground-detail.js";

// The ground's root (the ground, hills, rocks, tower and tree hang under it)
// and the film's ground detail.
export function createSceneEnvironment({ groundHeight, parent, profile }) {
  const root = new Group();
  parent.add(root);

  let disposed = false;
  let groundDetail = null,
    pendingDetail = null,
    filmActive = false,
    currentProfile = profile;

  function adopt(detail) {
    if (!detail) return null;
    if (disposed || groundDetail) {
      detail.dispose();
      return groundDetail;
    }
    groundDetail = detail;
    detail.applyQuality(currentProfile);
    if (filmActive) root.add(detail.mesh);
    detail.setActive(filmActive);
    return detail;
  }

  return {
    lifecycleOrder: 10,
    root,
    // Called before the tower commits: prepare exact grass geometry during
    // downloads, keeping it detached until the film takes it.
    prepareFilmDetail() {
      if (disposed) return Promise.resolve(null);
      if (groundDetail) return Promise.resolve(groundDetail);
      pendingDetail ||= prepareEstateGroundDetail(groundHeight, { cancelled: () => disposed })
        .then(adopt)
        .catch((error) => {
          pendingDetail = null;
          throw error;
        });
      return pendingDetail;
    },
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
      filmActive = Boolean(active);
      if (active && !groundDetail && !pendingDetail) adopt(createEstateGroundDetail(groundHeight));
      if (active && groundDetail && groundDetail.mesh.parent !== root) root.add(groundDetail.mesh);
      groundDetail?.setActive(active);
      return true;
    },
  };
}
