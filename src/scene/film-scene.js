import { EARTH } from "./filmic-earth.js";

// Borrow existing resources; restore originals before freeing the derived terrain.
export function createFilmScene({
  ground,
  groundHeight,
  rendering,
  atmosphere,
  skyMaterial,
  onGroundChange = () => {},
  invalidate = () => {},
  tour,
  loadTerrain = () => import("./terrain-build.js"),
}) {
  let active = false,
    disposed = false,
    terrain = null,
    pending = null,
    undo = [];
  const originalGeometry = ground.geometry;
  return {
    lifecycleOrder: 18,
    get ready() {
      return pending;
    },
    get active() {
      return active;
    },
    setActive(next) {
      if (disposed || active === Boolean(next)) return;
      active = Boolean(next);
      if (active) {
        if (terrain) ground.geometry = terrain;
        // The terrain builds in short slices and arrives only where the new
        // ground cannot show mid-shot (terrain-build.js); before the reveal it
        // takes idle time only, and it stops if the scene is disposed first. The tufts and the
        // slate's root shading then follow the tree's root supports, and ready
        // resolves to the height the rocks sit on.
        pending ||= loadTerrain()
          .then(async ({ createEarthGeometry, settleRoots }) => {
            if (
              disposed ||
              !(terrain = await createEarthGeometry(
                groundHeight,
                EARTH,
                rendering,
                tour,
                () => disposed,
              ))
            )
              return;
            // A terrain finished after disposal is freed, never kept.
            if (disposed) return terrain.dispose();
            if (active) ground.geometry = terrain;
            invalidate();
            return settleRoots?.(terrain, ground, rendering, groundHeight, invalidate, tour);
          })
          .catch(() => {}); // Keep the borrowed procedural ground on failure.
        const sunColor = skyMaterial.uniforms.sunColor.value.clone(),
          transparent = skyMaterial.transparent;
        const filmUniform = skyMaterial.uniforms.uFilm,
          previousFilm = filmUniform?.value;
        undo.push(() => {
          skyMaterial.uniforms.sunColor.value.copy(sunColor);
          skyMaterial.transparent = transparent;
          skyMaterial.needsUpdate = true;
          if (filmUniform) filmUniform.value = previousFilm;
        });
        skyMaterial.uniforms.sunColor.value.setHex(0x7e8eab).multiplyScalar(0.35);
        if (filmUniform) filmUniform.value = 1;
        // Opaque-list first: the nearer shell must never haze over distant hills.
        skyMaterial.transparent = false;
        skyMaterial.needsUpdate = true;
      } else {
        ground.geometry = originalGeometry;
        undo
          .splice(0)
          .reverse()
          .forEach((fn) => fn());
      }
      rendering.setFilmTreatment(active);
      atmosphere.setFilmTreatment(active);
      onGroundChange(active);
    },
    finishFrame(camera, target, frame, phoneDetail = false, textBottom = 0.25) {
      if (!active || disposed) return;
      rendering.focusFilmShadow(target, frame?.radius || 20);
      rendering.postprocessPipeline.setTextProtection?.(phoneDetail, textBottom);
    },
    dispose() {
      if (disposed) return false;
      this.setActive(false);
      disposed = true;
      terrain?.dispose();
      terrain = null;
      return true;
    },
  };
}
