// Each shot keeps its own quality level (the owner's plan of 2026-10-28, "perform well
// everywhere"): a governor step taken on a heavy shot (Lantern study) lowers that shot's
// resolution for its later visits, not the tour's, and a light shot keeps the best level the
// device started on. index.js calls enter() on each cut, and at the reveal, with the shot's
// key (subject and angle). Only balanced and its resolution steps are kept per shot, so a
// change between shots is only the pixel ratio; a desktop's step from high to balanced holds
// for every shot, and a pinned ?quality= keeps one level.
const BEST = Object.freeze({ tier: "balanced", resolutionLevel: 0 });
const same = (a, b) => a.tier === b.tier && a.resolutionLevel === b.resolutionLevel;

export function createShotLevels(qualityState) {
  const levels = new Map();
  let current = null;
  return {
    // At a cut to shot `key`: keeps the outgoing shot's level and takes the incoming
    // shot's (BEST for a shot not yet seen). The profile to apply at this cut, or null.
    enter(key, { nowMs = 0, profile } = {}) {
      const governor = qualityState?.governor;
      if (!governor?.getLevel || governor.isFixed() || key == null) return null;
      const previous = current,
        level = governor.getLevel();
      current = key;
      if (level.tier === "high") return null;
      if (previous !== null) levels.set(previous, level);
      const target = levels.get(key) ?? BEST;
      return same(target, level) ? null : qualityState.takeLevel(target, { nowMs, profile });
    },
    // The level a shot has kept, or null.
    levelOf(key) {
      return levels.get(key) ?? null;
    },
  };
}
