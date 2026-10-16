// The opening shot's stored outline (opening-outline.js): its points' resolution in world units
// and the key a resolved shot looks its measurement up by: everything measureShot() reads from the
// shot, so a change to The watch's framing finds no stale outline.
export const OUTLINE_RESOLUTION = 0.005;

export function outlineKey(shot) {
  return JSON.stringify([
    shot.subject ?? null,
    shot.region,
    shot.focus ?? null,
    shot.azimuth,
    shot.height,
    shot.targetHeight ?? null,
  ]);
}
