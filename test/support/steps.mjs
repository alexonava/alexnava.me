import {
  crestSteps,
  geometrySteps,
  MOUNTAINS,
  rangeSteps,
} from "../../src/scene/mountain-build.js";
import {
  bankSteps,
  litterSteps,
  poolFieldSteps,
  rushSteps,
} from "../../src/scene/terrain-build.js";

// The lazy chunks build in steps (generators) that the scene spreads over idle
// slices; tests take each build at once.
export function drain(steps) {
  for (;;) {
    const next = steps.next();
    if (next.done) return next.value;
  }
}

export const scatterLitter = (surface, groundColor) => drain(litterSteps(surface, groundColor));
export const plantRushes = (surface) => drain(rushSteps(surface));
export const scatterBanks = (surface, groundColor) => drain(bankSteps(surface, groundColor));
export const poolField = (heights, w, h, at) => drain(poolFieldSteps(heights, w, h, at));

// Crest elevation in degrees per range and column, near range first; as the
// massifs' backdrop (RANGE_BACKDROP) with `backdrop`.
export const mountainCrests = (backdrop = null) =>
  MOUNTAINS.share.map((_, range) => drain(crestSteps(range, backdrop)));
// The five rings, or with { backdrop, nearer } the backdrop behind the massifs.
export const createMountainGeometry = (options) => drain(geometrySteps(options));
// The massifs and their backdrop: models as placeRange() takes them, keyed by role.
export const createRangeGeometry = (models, placements) => drain(rangeSteps(models, placements));
