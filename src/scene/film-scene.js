import { DIRECTED_SHOTS, measureShot } from "./directed-shots.js";
import { EARTH } from "./filmic-earth.js";
import { MIST_PARS, MIST_UNIFORMS } from "./drifting-mist.js";
import { FLASH_GROUND } from "./film-light.js";
import { RANGE_MIST, SEA_SINK } from "./hill-silhouette.js";
import { SLATE_TEXT_GUARD } from "./mud-ground.js";
import { createCinematicCamera, cinematicSafeArea } from "./cinematic.js";
import { grassMaterial, GROWTH } from "./estate-ground-detail.js";
import { ESTATE, estatePathDistance } from "./estate-layout.js";
import { rockKeepouts } from "./rock-scatter.js";
import { watchMeasure } from "./opening-star.js";

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
    settled = null,
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
        if (terrain && !settled) ground.geometry = terrain;
        // The lazy owner prepares terrain and shore together, then lands them
        // unseen. Ready publishes the prepared sampler for parallel rock loads;
        // its delegated height follows the visible ground until that commit.
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
                typeof settleRoots === "function",
              ))
            )
              return;
            // A terrain finished after disposal is freed, never kept.
            if (disposed) return terrain.dispose();
            // The sea (ocean.js, in the terrain's chunk) borrows the entry's shared GLSL and
            // uniforms, and adds the fault's own shots to the tree's list while it stands.
            settled = settleRoots?.(terrain, ground, rendering, groundHeight, invalidate, tour, {
              SLATE_TEXT_GUARD,
              MIST_PARS,
              MIST_UNIFORMS,
              FLASH_GROUND,
              RANGE_MIST,
              SEA_SINK,
              DIRECTED_SHOTS,
              createCinematicCamera,
              cinematicSafeArea,
              measureShot,
              watchMeasure,
              grassMaterial,
              GROWTH,
              ESTATE,
              estatePathDistance,
              rockKeepouts,
              originalGeometry,
              active,
            });
            if (settled) return settled;
            if (active) ground.geometry = terrain;
            invalidate();
          })
          .catch(() => {
            terrain?.dispose();
            terrain = settled = null;
          }); // Keep the borrowed procedural ground on failure.
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
      settled?.setActive(active);
    },
    finishFrame(camera, target, frame, phoneDetail = false, textBottom = 0.25) {
      if (!active || disposed) return;
      rendering.focusFilmShadow(frame?.shadow || target, frame?.radius || 20);
      rendering.postprocessPipeline.setTextProtection?.(phoneDetail, textBottom);
    },
    update(frame) {
      if (!active || disposed) return false;
      return settled?.updateForeground?.(frame) ?? false;
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
