// Each shot keeps its own quality level (the owner's plan of 2026-10-28, "perform well
// everywhere"): a governor step taken on a heavy shot (Lantern study) lowers that shot's
// resolution for its later visits, and a light shot that keeps up climbs back one step per
// visit, so one heavy shot no longer sets the whole tour's resolution. index.js calls enter()
// on each cut, and at the reveal, with the shot's key (subject and angle), and sample() with
// each frame the governor samples. A shot not yet seen starts at the level the tour holds.
// Only balanced and its resolution steps are kept per shot, so a change between shots is only
// the pixel ratio; a desktop's step from high to balanced holds for every shot, and a pinned
// ?quality= keeps one level.
export const SHOT_LEVELS = Object.freeze({
  // A visit keeps up when no more than this share of its sampled frames came over the
  // governor's slow line (20 ms; quality.js), over at least `frames` of them.
  late: 0.05,
  slow: 20,
  frames: 60,
});
const same = (a, b) => a.tier === b.tier && a.resolutionLevel === b.resolutionLevel;
// One step back up: a resolution step toward balanced at full resolution.
const raised = ({ tier, resolutionLevel }) =>
  tier === "low"
    ? resolutionLevel > 1
      ? { tier, resolutionLevel: resolutionLevel - 1 }
      : { tier: "balanced", resolutionLevel: 0 }
    : { tier, resolutionLevel };

export function createShotLevels(qualityState) {
  // Per shot: its level, whether the last visit climbed, and whether a climb has failed
  // there (it then keeps its level).
  const shots = new Map();
  let current = null,
    entered = null,
    frames = 0,
    late = 0;
  return {
    // Each frame the governor samples (its display interval in ms).
    sample(frameMs) {
      frames += 1;
      if (frameMs > SHOT_LEVELS.slow) late += 1;
    },
    // At a cut to shot `key`: keeps the outgoing shot's level (a step up after a visit that
    // kept up) and takes the incoming shot's. The profile to apply at this cut, or null.
    enter(key, { nowMs = 0, profile } = {}) {
      const governor = qualityState?.governor;
      if (!governor?.getLevel || governor.isFixed() || key == null) return null;
      const level = governor.getLevel();
      if (current !== null && entered && level.tier !== "high") {
        const kept = shots.get(current) ?? { climbed: false, held: false },
          stepped = !same(level, entered),
          held = kept.held || (stepped && kept.climbed),
          keptUp =
            !stepped && !held && frames >= SHOT_LEVELS.frames && late <= SHOT_LEVELS.late * frames;
        const next = keptUp ? raised(level) : level;
        shots.set(current, { level: next, climbed: !same(next, level), held });
      }
      current = key;
      frames = late = 0;
      if (level.tier === "high") {
        entered = null;
        return null;
      }
      const target = shots.get(key)?.level ?? level;
      entered = target;
      if (!same(target, level)) return qualityState.takeLevel(target, { nowMs, profile });
      // The same level: only the governor's window starts afresh, the new shot's own.
      governor.setLevel(level, nowMs);
      return null;
    },
    // The level a shot has kept, or null.
    levelOf(key) {
      return shots.get(key)?.level ?? null;
    },
  };
}
