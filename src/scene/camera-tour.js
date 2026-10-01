import { DIRECTED_SHOTS } from "./directed-shots.js";
import { PUSH_IN } from "./cinematic.js";

// Visitors get each shot's own hold; 3, 5 and 20 remain fixed review cadences.
export const TOUR_PER_SHOT = "shot";
export const DEFAULT_TOUR_INTERVAL = TOUR_PER_SHOT;
const TOUR_INTERVALS = Object.freeze([3, 5, 20]);
export const TOUR_HOLD_FALLBACK = 7;
const directedViews = Object.entries(DIRECTED_SHOTS).flatMap(([subject, shots]) =>
  shots.map((shot, angle) => ({ subject, angle, shot })),
);
const tourViews = directedViews.filter(({ shot }) => shot.tour !== false);

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
    prepared = false;
  const running = () => !disposed && ready && !paused && !reduced && !held;
  function findNext(accept) {
    const start = directedViews.findIndex(
      ({ subject, angle }) => subject === camera.current && angle === camera.angle,
    );
    for (let offset = 1; offset <= directedViews.length; offset++) {
      const view = directedViews[(start + offset) % directedViews.length];
      if (view.shot.tour !== false && accept(view)) return view;
    }
    return null;
  }
  function advance() {
    findNext(({ subject, angle }) => camera.setPreviewShot(subject, angle));
    elapsed = 0;
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
    get state() {
      const subject = camera.current,
        tourIndex = tourViews.findIndex(
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
        total: tourViews.length,
      };
    },
    update({ elapsedSeconds, reducedMotion = false, panelOpen = false }) {
      if (disposed) return null;
      reduced = reducedMotion;
      held = panelOpen;
      ready = camera.ready && camera.isAvailable(camera.current);
      const active = ready && !paused && !reduced && !held;
      cut = false;
      if (!active) capturing = dissolving = false;
      else {
        if (capturing) {
          advance();
          capturing = false;
          cut = dissolving = true;
        }
        if (wasActive && lastTime !== null) elapsed += Math.max(0, elapsedSeconds - lastTime);
        if (dissolving && elapsed >= dissolveSeconds) dissolving = false;
        const seconds = hold();
        if (!cut && !dissolving && elapsed >= seconds) {
          elapsed = seconds;
          capturing = true;
          dissolveSeconds = dissolve();
          zoom = Math.max(TOUR_TRANSITION.minZoom, (PUSH_IN * dissolveSeconds) / seconds);
        } else if (!cut && prepareDue()) prepareUpcoming();
      }
      lastTime = elapsedSeconds;
      wasActive = active;
      return reduced ? 0.5 : Math.min(1, elapsed / hold());
    },
    setPaused,
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
