// User Timing for scene start-up. Names carry a "babel:" prefix so Lighthouse's
// User Timing audit and the Performance panel group them. Every call is
// best-effort: without User Timing (or its option form) nothing is recorded.
const timing = globalThis.performance;

export function sceneNow() {
  try {
    return timing?.now?.() ?? 0;
  } catch {
    return 0;
  }
}

// scene-entry.js imports this module first, so this is when the entry chunk
// began evaluating. Under ES module rules the entry's static import, the
// shared Three.js chunk (scene.shared.HASH.js), has already evaluated by then:
// scene-eval excludes Three.js evaluation. main.js marks babel:scene-request
// when it appends the scene script, for a span that covers both downloads and
// Three.js evaluation.
const evaluationStart = sceneNow();

export function markScene(name, startTime) {
  try {
    timing?.mark?.(`babel:${name}`, startTime === undefined ? undefined : { startTime });
  } catch {
    // Older User Timing implementations reject the options form.
  }
}

// Measures from a performance.now() timestamp to now.
export function measureScene(name, start) {
  try {
    timing?.measure?.(`babel:${name}`, { start });
  } catch {
    // As above; a missing measure never affects the scene.
  }
}

export function markSceneEvaluated() {
  markScene("scene-entry", evaluationStart);
  measureScene("scene-eval", evaluationStart);
}
