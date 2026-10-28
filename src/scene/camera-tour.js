import { DIRECTED_SHOTS, shotPose } from "./directed-shots.js";
import { PUSH_IN } from "./cinematic.js";

// Visitors get each shot's own hold; ?tour=3, 5 and 20 are fixed cadences for review.
export const TOUR_PER_SHOT = "shot";
export const DEFAULT_TOUR_INTERVAL = TOUR_PER_SHOT;
const TOUR_INTERVALS = [3, 5, 20];
export const TOUR_HOLD_FALLBACK = 7;
// The tour opens on Lantern study, then continues the existing circular sequence:
// Close-up, Root and lantern, the sky, and Portrait. Each adjacent tree pair is
// a change of height and bearing (Lantern study and Root and lantern nearly
// share both, so they are kept apart); one sky shot, the owner's call of
// 2026-10-20. The fault's three shots (ocean.js COAST_SHOTS) join once the sea has landed,
// one between each pair and after the last: wide down the coast after
// Portrait, the falls after Lantern study, and the bay from above after
// Root and lantern, before The watch.
export const TOUR_ORDER = Object.freeze([
  "Lantern study",
  "Close-up",
  "Root and lantern",
  "The watch",
  "Portrait",
]);
// The tour's views as the lists stand: the fault's shots join the tree's when
// the sea lands (ocean.js COAST_SHOTS), and until then the tour passes them by.
const tourViews = () =>
  TOUR_ORDER.flatMap((name) =>
    Object.entries(DIRECTED_SHOTS).flatMap(([subject, shots]) =>
      shots.flatMap((shot, angle) =>
        (shot.after || shot.name) === name ? { subject, angle } : [],
      ),
    ),
  );

export function readTourInterval(search = "") {
  const query = new URLSearchParams(search);
  // A selected view sets the opening composition, not a static mode. The
  // tour stays alive unless a reviewer explicitly requests tour=0.
  if (!query.has("tour")) return DEFAULT_TOUR_INTERVAL;
  const seconds = Number(query.get("tour"));
  return TOUR_INTERVALS.includes(seconds) ? seconds : 0;
}

// Uses scene time rather than a separate timer: hidden/offscreen tabs do not skip
// shots, and all geometry, materials and decoded images remain loaded.
// Shots join by a depth-staggered dissolve: the post-process pipeline keeps the
// outgoing shot's last frame and dissolves it into the live one over 1 second,
// or 30% of a shorter hold, sky first, then mountains, ground and subject. The
// kept frame keeps pushing in by `zoom`, matching the drift it replaces. The
// upcoming shot is fitted in idle time `prepareAfter` seconds after the
// dissolve, or by mid-hold.
export const TOUR_TRANSITION = Object.freeze({
  dissolve: 1,
  maxShare: 0.3,
  prepareAfter: 1,
  minZoom: 0.004,
});
export const TOUR_IDLE = Object.freeze({ capture: false, cut: false, progress: 1, zoom: 0 });

export function createCameraTour({
  camera,
  interval = DEFAULT_TOUR_INTERVAL,
  invalidate = () => {},
  prepare = null,
}) {
  const validCadence = (value) => value === TOUR_PER_SHOT || TOUR_INTERVALS.includes(value);
  let cadence = validCadence(interval) ? interval : TOUR_PER_SHOT;
  // Looked up on every update, so an unresolved opening shot or a subject
  // fallback still gets the hold of the shot actually on screen.
  const hold = () =>
    cadence === TOUR_PER_SHOT
      ? (DIRECTED_SHOTS[camera.current]?.[camera.angle]?.hold ?? TOUR_HOLD_FALLBACK)
      : cadence;
  // The outgoing shot's push at its cut, per hold: how fast the subject grows
  // there (a dolly-in, a narrowing lens), so the kept frame carries it on; a
  // pull-out or a dolly-zoom's steady subject keeps the minimum.
  const closingPush = () => {
    const shot = camera.shot ?? DIRECTED_SHOTS[camera.current]?.[camera.angle];
    if (!shot?.move) return PUSH_IN;
    const a = shotPose(shot, 0.98),
      b = shotPose(shot, 1),
      size = (pose) => 1 / (pose.scale * Math.tan((pose.fov * Math.PI) / 360));
    return Math.max(0, (size(b) / size(a) - 1) / 0.02);
  };
  const dissolve = () => Math.min(TOUR_TRANSITION.dissolve, TOUR_TRANSITION.maxShare * hold());
  const transition = { ...TOUR_IDLE };
  let elapsed = 0,
    lastTime = null,
    wasActive = false,
    paused = false,
    reduced = false,
    held = false,
    ready = false,
    disposed = false,
    // One capture frame shows the outgoing shot at phase 1; the next update
    // cuts, and the dissolve runs on the new shot's elapsed time, which counts
    // from the capture frame.
    capturing = false,
    cut = false,
    dissolving = false,
    dissolveSeconds = 0,
    zoom = 0,
    prepared = false,
    // A shot whose hold has run out while the next shot cannot show yet (update's
    // cutReady) stays on its last frame; waited counts that time.
    waiting = false,
    waited = 0;
  const running = () => !disposed && ready && !paused && !reduced && !held;
  // A shot outside the tour (a URL's) is followed by the tour's first.
  function findNext(accept) {
    const views = tourViews(),
      start = views.findIndex(
        ({ subject, angle }) => subject === camera.current && angle === camera.angle,
      );
    for (let offset = 1; offset <= views.length; offset++) {
      const view = views[(start + offset) % views.length];
      if (accept(view)) return view;
    }
    return null;
  }
  function advance() {
    findNext(({ subject, angle }) => camera.setPreviewShot(subject, angle));
    elapsed = waited = 0;
    waiting = false;
    prepared = false;
    invalidate();
  }
  // Fits the upcoming shot ahead of its cut, once per shot and never between a
  // cut and the end of its dissolve.
  function prepareUpcoming() {
    prepared = true;
    const view = prepare && findNext(({ subject }) => camera.isAvailable(subject));
    if (view) prepare(view.subject, view.angle);
  }
  const prepareDue = () =>
    !prepared &&
    !capturing &&
    !dissolving &&
    elapsed >= Math.min(hold() * 0.5, dissolve() + TOUR_TRANSITION.prepareAfter);
  // Anything that stops the tour drops a pending capture or dissolve, so the
  // held frame is the clear shot and nothing replays on release.
  function settle() {
    capturing = cut = dissolving = false;
    lastTime = null;
    wasActive = false;
  }
  // Pausing keeps the current shot and its elapsed hold; resuming continues
  // from there without counting the paused time. A pause on the capture frame
  // keeps the outgoing shot, which captures again on resume and then cuts.
  function setPaused(value) {
    if (disposed || paused === Boolean(value)) return;
    paused = Boolean(value);
    settle();
    invalidate();
  }
  return {
    // One reused object for the post-process pipeline; `progress` is linear.
    get transition() {
      transition.capture = capturing;
      transition.cut = cut;
      transition.progress = dissolving ? elapsed / dissolveSeconds : 1;
      transition.zoom = capturing || dissolving ? zoom : 0;
      return transition;
    },
    get running() {
      return running();
    },
    // Dynamic, so coastal withdrawal and a missing subject cannot leave a stale
    // preparation target. This observes the same next view that advance takes.
    get nextShot() {
      if (disposed) return null;
      const view = findNext(({ subject }) => camera.isAvailable(subject));
      if (!view) return null;
      const shot = DIRECTED_SHOTS[view.subject]?.[view.angle];
      return { ...view, name: shot?.name ?? null, shot };
    },
    get state() {
      const subject = camera.current,
        views = tourViews(),
        tourIndex = views.findIndex(
          (view) => view.subject === subject && view.angle === camera.angle,
        );
      return {
        interval: cadence,
        dwell: hold(),
        paused,
        reduced,
        ready,
        name: DIRECTED_SHOTS[subject]?.[camera.angle]?.name || "Loading views",
        index: tourIndex < 0 ? null : tourIndex + 1,
        total: views.length,
      };
    },
    // Whether the shot on screen has run its hold and stays on its last frame until the next
    // can show (cutReady); `waited` is how long, in seconds.
    get waiting() {
      return waiting;
    },
    get waited() {
      return waited;
    },
    update({
      elapsedSeconds,
      reducedMotion = false,
      held: holding = false,
      ready: allowed = true,
      cutReady = true,
    }) {
      if (disposed) return null;
      reduced = reducedMotion;
      held = holding;
      ready = allowed && camera.ready && camera.isAvailable(camera.current);
      const active = running();
      cut = false;
      if (!active) capturing = dissolving = waiting = false;
      else {
        if (capturing) {
          advance();
          capturing = false;
          cut = dissolving = true;
        }
        // An active update always records lastTime; settle clears wasActive too.
        if (wasActive) elapsed += Math.max(0, elapsedSeconds - lastTime);
        if (dissolving && elapsed >= dissolveSeconds) dissolving = false;
        const seconds = hold();
        waiting = false;
        if (!cut && !dissolving && elapsed >= seconds && !cutReady) {
          // The next shot cannot show yet: hold this one's last frame.
          waited += elapsed - seconds;
          elapsed = seconds;
          waiting = true;
        } else if (!cut && !dissolving && elapsed >= seconds) {
          elapsed = seconds;
          capturing = true;
          dissolveSeconds = dissolve();
          zoom = Math.max(TOUR_TRANSITION.minZoom, (closingPush() * dissolveSeconds) / seconds);
        } else if (!cut && prepareDue()) prepareUpcoming();
      }
      lastTime = elapsedSeconds;
      wasActive = active;
      return reduced ? 0.5 : Math.min(1, elapsed / hold());
    },
    setPaused,
    // Startup can prepare a complete opener while held, then give it a full
    // visible dwell. Resetting does not select a different view or public angle.
    reset() {
      if (disposed) return;
      elapsed = 0;
      prepared = false;
      settle();
      invalidate();
    },
    toggle() {
      setPaused(!paused);
    },
    next() {
      if (disposed) return;
      advance();
      settle();
    },
    setInterval(value) {
      if (disposed || !validCadence(value)) return;
      cadence = value;
      elapsed = 0;
      settle();
      invalidate();
    },
    // After a resize or font load: refit the upcoming shot now, or once due.
    prepareNext() {
      if (disposed) return;
      prepared = false;
      if (running() && prepareDue()) prepareUpcoming();
    },
    dispose() {
      disposed = true;
      settle();
    },
  };
}
