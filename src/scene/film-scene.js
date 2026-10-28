import { DIRECTED_SHOTS, measureShot, measureShotSteps } from "./directed-shots.js";
import { EARTH } from "./filmic-earth.js";
import { MIST_PARS, MIST_UNIFORMS } from "./drifting-mist.js";
import { COAST_MOOD, FLASH_GROUND } from "./film-light.js";
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
    prelink = null,
    landed = false,
    failed = false,
    undo = [];
  const releasePrelink = () => prelink?.then((handle) => handle?.release());
  const originalGeometry = ground.geometry;
  return {
    lifecycleOrder: 18,
    get ready() {
      return pending;
    },
    get active() {
      return active;
    },
    get openingState() {
      return settled?.openingState ?? null;
    },
    // Whether the film's own ground has landed (its first commit), or will not: until one
    // is true the tour holds its cut to a ground shot (index.js).
    get landed() {
      return landed;
    },
    get failed() {
      return failed;
    },
    // The tree opening's ground maps are final: its shaded program starts linking now
    // (terrain-build.js prelinkSlateGround()), beside the terrain's build.
    prelinkGround() {
      if (disposed || !active || settled || prelink) return;
      prelink = loadTerrain()
        .then(({ prelinkSlateGround }) =>
          disposed || settled ? null : (prelinkSlateGround?.(ground, rendering) ?? null),
        )
        .catch(() => null);
    },
    async prepareOpening(frame) {
      const height = await pending;
      if (disposed || !active || !height?.prepareOpening) return false;
      return height.prepareOpening(frame);
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
              COAST_MOOD,
              RANGE_MIST,
              SEA_SINK,
              DIRECTED_SHOTS,
              createCinematicCamera,
              cinematicSafeArea,
              measureShot,
              measureShotSteps,
              watchMeasure,
              grassMaterial,
              GROWTH,
              ESTATE,
              estatePathDistance,
              rockKeepouts,
              originalGeometry,
              active,
            });
            // Its own link has taken the prelinked program from Three's cache.
            releasePrelink();
            if (settled) {
              Promise.resolve(settled.ready).then((ok) => {
                landed = ok === true;
                failed ||= ok === false;
              });
              return settled;
            }
            if (active) ground.geometry = terrain;
            landed = true;
            invalidate();
          })
          .catch(() => {
            terrain?.dispose();
            terrain = settled = null;
            failed = true;
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
      releasePrelink();
      terrain?.dispose();
      terrain = null;
      return true;
    },
  };
}
