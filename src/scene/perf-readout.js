// ?perf=1 (quality.js readSceneQualityControls()): a small readout in the window's corner for
// checking the scene on a real phone or laptop: the frames drawn per second over the last
// second and that second's longest gap, the shot, the drawn resolution (device pixels per CSS
// pixel and megapixels) and the governor's level. Debug only, never on an ordinary visit; it
// is decorative text the page ignores (aria-hidden, no pointer events).
export function createPerfReadout(host, doc = globalThis.document) {
  if (!host?.appendChild || typeof doc?.createElement !== "function") return null;
  const element = doc.createElement("div");
  element.className = "scene-perf-readout";
  element.setAttribute("aria-hidden", "true");
  Object.assign(element.style, {
    position: "fixed",
    top: "calc(8px + env(safe-area-inset-top, 0px))",
    right: "calc(8px + env(safe-area-inset-right, 0px))",
    zIndex: "50",
    padding: "4px 6px",
    borderRadius: "3px",
    background: "rgba(0, 0, 0, 0.6)",
    color: "#f7f1ea",
    font: "11px/1.35 ui-monospace, Menlo, Consolas, monospace",
    whiteSpace: "pre",
    pointerEvents: "none",
  });
  host.appendChild(element);
  let since = null,
    frames = 0,
    longest = 0,
    previous = null;
  return {
    element,
    // Each drawn frame: its rAF timestamp and what it drew.
    frame(timestamp, { shot = null, pixelRatio = 1, width = 0, height = 0, level = "" } = {}) {
      if (previous !== null) longest = Math.max(longest, timestamp - previous);
      previous = timestamp;
      since ??= timestamp;
      frames += 1;
      const span = timestamp - since;
      if (span < 1000) return;
      element.textContent = [
        `${Math.round((1000 * (frames - 1)) / span)} fps  longest ${Math.round(longest)} ms`,
        shot || "-",
        `${pixelRatio.toFixed(2)}x  ${((width * height) / 1e6).toFixed(2)} MP`,
        level,
      ].join("\n");
      since = timestamp;
      frames = 1;
      longest = 0;
    },
    dispose() {
      element.remove();
    },
  };
}
