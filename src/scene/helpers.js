(() => {
  const site = (window.BabelSite = window.BabelSite || {});
  const scene = (site.scene = site.scene || {});

  function clamp01(val) {
    return Math.min(1, Math.max(0, val));
  }

  scene.clamp01 = clamp01;

  scene.smoothstep01 = function (val) {
    const xx = clamp01(val);
    return xx * xx * (3 - 2 * xx);
  };

  // A nearly level plain (the owner's note of 2026-10-04: one level, two at
  // most): a faint swell, 15% of the old dunes, about the tree's footing height.
  function dune(xx, yy) {
    return (
      1.25 +
      0.27 * Math.sin(0.055 * xx) +
      0.2025 * Math.cos(0.052 * yy) +
      0.135 * Math.sin(0.031 * (xx + yy)) +
      0.0825 * Math.cos(0.018 * (xx - yy))
    );
  }

  // A flat terrace under an object's footprint (out to `flatRadius`), blending
  // smoothly back into the surrounding dune terrain by `radius`. A simple
  // additive bump raises the neighbourhood roughly evenly but never cancels
  // the dune field's own local slope, so one side of a footing still touches
  // while the other floats; holding the ground level under the whole
  // footprint removes that slope outright instead of just lifting it.
  function terrace(xx, yy, base, cx, cy, amplitude, flatRadius, radius) {
    const r = Math.hypot(xx - cx, yy - cy);
    if (r >= radius) return base;
    const flat = dune(cx, cy) + amplitude;
    if (r <= flatRadius) return flat;
    const eased = scene.smoothstep01((r - flatRadius) / (radius - flatRadius));
    return flat * (1 - eased) + base * eased;
  }

  // The tower and tree terraces restate estate-layout.js ESTATE (x, z, lift,
  // flat, blend): this file runs without imports, and a test holds them equal.
  scene.groundHeight = function (xx, yy) {
    let height = dune(xx, yy);
    height = terrace(xx, yy, height, 0, 0, 1.36, 9, 20);
    height = terrace(xx, yy, height, 55.1, 36.1, 0.0, 6, 14);
    return height;
  };

  scene.supportsWebGL = function () {
    return site.shared.supportsWebGL();
  };
})();
