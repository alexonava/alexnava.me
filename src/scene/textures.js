import { createEarthDetail, FILM_GROUND_PRESETS } from "./filmic-earth.js";
import { measureScene, sceneNow } from "./perf-marks.js";

(() => {
  const site = (window.BabelSite = window.BabelSite || {});
  const scene = (site.scene = site.scene || {});
  const { GROUND_TEXTURE_PALETTE: groundPalette } = scene;

  function hashNoise(xx, yy, zz = 0) {
    const val = 43758.5453123 * Math.sin(12.9898 * xx + 78.233 * yy + 37.719 * zz);
    return val - Math.floor(val);
  }

  function makeTexture(THREE, canvas, configure) {
    const tex = new THREE.CanvasTexture(canvas);
    configure(tex);
    return tex;
  }

  // Blotches, dust, pebbles, moss and tonal breakup over the ground's base fill.
  function paintGroundDetail({ colorCtx, bumpCtx, size, balanced }) {
    const dirtBlotchCount = balanced ? 90 : 120;
    for (let idx = 0; idx < dirtBlotchCount; idx += 1) {
      const cx = hashNoise(idx, 601) * size;
      const cy = hashNoise(idx, 602) * size;
      const radius = size * (0.025 + 0.07 * hashNoise(idx, 603));
      const tone = hashNoise(idx, 604);
      const colorGrad = colorCtx.createRadialGradient(cx, cy, 0, cx, cy, radius);
      colorGrad.addColorStop(
        0,
        tone > 0.58
          ? `rgba(86, 70, 54, ${0.12 + 0.1 * hashNoise(idx, 605)})`
          : tone < 0.32
            ? `rgba(232, 218, 196, ${0.08 + 0.08 * hashNoise(idx, 606)})`
            : `rgba(168, 148, 124, ${0.06 + 0.08 * hashNoise(idx, 607)})`,
      );
      colorGrad.addColorStop(1, "rgba(120, 104, 84, 0)");
      colorCtx.fillStyle = colorGrad;
      colorCtx.beginPath();
      colorCtx.ellipse(
        cx,
        cy,
        radius,
        radius * (0.6 + 0.5 * hashNoise(idx, 608)),
        hashNoise(idx, 609) * Math.PI,
        0,
        2 * Math.PI,
      );
      colorCtx.fill();

      const bumpGrad = bumpCtx.createRadialGradient(cx, cy, 0, cx, cy, radius);
      bumpGrad.addColorStop(0, tone > 0.5 ? "#9b8e7e" : "#d3c8ba");
      bumpGrad.addColorStop(1, groundPalette.bumpBase);
      bumpCtx.fillStyle = bumpGrad;
      bumpCtx.beginPath();
      bumpCtx.ellipse(
        cx,
        cy,
        radius,
        radius * (0.6 + 0.5 * hashNoise(idx, 608)),
        hashNoise(idx, 609) * Math.PI,
        0,
        2 * Math.PI,
      );
      bumpCtx.fill();
    }

    const dustCount = balanced ? 3900 : 5200;
    for (let idx = 0; idx < dustCount; idx += 1) {
      const px = hashNoise(idx, 21) * size;
      const py = hashNoise(idx, 22) * size;
      const radius = size * (8e-4 + 0.0038 * hashNoise(idx, 23));
      const tone = hashNoise(idx, 24);
      colorCtx.fillStyle =
        tone > 0.68
          ? groundPalette.emberDustColor
          : tone < 0.22
            ? groundPalette.coolDustColor
            : `rgba(118, 108, 102, ${0.04 + 0.08 * hashNoise(idx, 25)})`;
      colorCtx.beginPath();
      colorCtx.arc(px, py, radius, 0, 2 * Math.PI);
      colorCtx.fill();

      const gray = 135 + Math.floor(80 * hashNoise(idx, 26));
      bumpCtx.fillStyle = `rgb(${gray}, ${gray}, ${gray})`;
      bumpCtx.beginPath();
      bumpCtx.arc(px, py, radius, 0, 2 * Math.PI);
      bumpCtx.fill();
    }

    const pebbleCount = balanced ? 360 : 520;
    for (let idx = 0; idx < pebbleCount; idx += 1) {
      const cx = hashNoise(idx, 301) * size;
      const cy = hashNoise(idx, 302) * size;
      const big = hashNoise(idx, 310) > 0.86;
      const radius =
        size * (big ? 0.006 + 0.012 * hashNoise(idx, 303) : 0.0022 + 0.005 * hashNoise(idx, 303));
      const base = 44 + Math.floor(46 * hashNoise(idx, 304));
      const shade = hashNoise(idx, 305);
      const shadowOffset = radius * 0.35;

      colorCtx.save();
      colorCtx.fillStyle = `rgba(20, 14, 8, ${0.22 + 0.14 * hashNoise(idx, 320)})`;
      colorCtx.beginPath();
      colorCtx.ellipse(
        cx + shadowOffset,
        cy + shadowOffset,
        radius * 1.05,
        radius * 0.75,
        0,
        0,
        2 * Math.PI,
      );
      colorCtx.fill();
      colorCtx.restore();

      colorCtx.fillStyle =
        shade > 0.68
          ? `rgba(${Math.min(240, base + 70)}, ${Math.min(230, base + 60)}, ${Math.min(210, base + 44)}, ${0.55 + 0.25 * hashNoise(idx, 306)})`
          : shade > 0.36
            ? `rgba(${base + 26}, ${base + 18}, ${base + 8}, ${0.48 + 0.25 * hashNoise(idx, 307)})`
            : `rgba(${Math.max(28, base - 18)}, ${Math.max(22, base - 24)}, ${Math.max(16, base - 30)}, ${0.5 + 0.25 * hashNoise(idx, 308)})`;
      colorCtx.beginPath();
      colorCtx.ellipse(
        cx,
        cy,
        radius,
        radius * (0.75 + 0.25 * hashNoise(idx, 311)),
        hashNoise(idx, 312) * Math.PI,
        0,
        2 * Math.PI,
      );
      colorCtx.fill();

      if (big) {
        const hi = colorCtx.createRadialGradient(
          cx - radius * 0.3,
          cy - radius * 0.3,
          0,
          cx - radius * 0.3,
          cy - radius * 0.3,
          radius * 0.7,
        );
        hi.addColorStop(0, "rgba(255, 246, 224, 0.35)");
        hi.addColorStop(1, "rgba(255, 246, 224, 0)");
        colorCtx.fillStyle = hi;
        colorCtx.beginPath();
        colorCtx.ellipse(
          cx - radius * 0.3,
          cy - radius * 0.3,
          radius * 0.5,
          radius * 0.35,
          0,
          0,
          2 * Math.PI,
        );
        colorCtx.fill();
      }

      const bumpGray = big
        ? 210 + Math.floor(40 * hashNoise(idx, 309))
        : 170 + Math.floor(60 * hashNoise(idx, 309));
      bumpCtx.fillStyle = `rgb(${bumpGray}, ${bumpGray}, ${bumpGray})`;
      bumpCtx.beginPath();
      bumpCtx.ellipse(
        cx,
        cy,
        radius,
        radius * (0.75 + 0.25 * hashNoise(idx, 311)),
        hashNoise(idx, 312) * Math.PI,
        0,
        2 * Math.PI,
      );
      bumpCtx.fill();
      bumpCtx.fillStyle = "#7d7468";
      bumpCtx.beginPath();
      bumpCtx.ellipse(
        cx + shadowOffset,
        cy + shadowOffset,
        radius * 1.05,
        radius * 0.75,
        0,
        0,
        2 * Math.PI,
      );
      bumpCtx.fill();
    }

    const mossColor = groundPalette.mossColor || "rgba(66, 84, 44, 0.14)";
    const mossCore = groundPalette.mossCore || "rgba(86, 104, 54, 0.18)";
    const mossCount = balanced ? 5 : 6;
    for (let idx = 0; idx < mossCount; idx += 1) {
      const cx = hashNoise(idx, 401) * size;
      const cy = hashNoise(idx, 402) * size;
      const radius = size * (0.03 + 0.05 * hashNoise(idx, 403));
      const grad = colorCtx.createRadialGradient(cx, cy, 0, cx, cy, radius);
      grad.addColorStop(0, mossCore);
      grad.addColorStop(0.5, mossColor);
      grad.addColorStop(1, "rgba(66, 84, 44, 0)");
      colorCtx.fillStyle = grad;
      colorCtx.beginPath();
      colorCtx.ellipse(
        cx,
        cy,
        radius,
        radius * (0.6 + 0.5 * hashNoise(idx, 404)),
        hashNoise(idx, 405) * Math.PI,
        0,
        2 * Math.PI,
      );
      colorCtx.fill();

      for (let fleck = 0; fleck < 8; fleck += 1) {
        const fx = cx + radius * 0.6 * (hashNoise(idx, 410 + fleck) - 0.5) * 2;
        const fy = cy + radius * 0.6 * (hashNoise(idx, 420 + fleck) - 0.5) * 2;
        colorCtx.fillStyle = `rgba(86, 104, 54, ${0.12 + 0.14 * hashNoise(idx, 430 + fleck)})`;
        colorCtx.beginPath();
        colorCtx.arc(fx, fy, 0.9 + 1.4 * hashNoise(idx, 440 + fleck), 0, 2 * Math.PI);
        colorCtx.fill();
      }
    }

    const breakupCount = balanced ? 60 : 90;
    for (let idx = 0; idx < breakupCount; idx += 1) {
      const cx = hashNoise(idx, 501) * size;
      const cy = hashNoise(idx, 502) * size;
      const radius = size * (0.05 + 0.12 * hashNoise(idx, 503));
      const grad = colorCtx.createRadialGradient(cx, cy, 0, cx, cy, radius);
      const tone = hashNoise(idx, 504);
      grad.addColorStop(
        0,
        tone > 0.5
          ? `rgba(40, 34, 28, ${0.03 + 0.04 * hashNoise(idx, 505)})`
          : `rgba(248, 236, 216, ${0.02 + 0.03 * hashNoise(idx, 506)})`,
      );
      grad.addColorStop(1, "rgba(0, 0, 0, 0)");
      colorCtx.fillStyle = grad;
      colorCtx.beginPath();
      colorCtx.arc(cx, cy, radius, 0, 2 * Math.PI);
      colorCtx.fill();
    }
  }

  scene.createGroundTextures = function ({
    THREE,
    qualityProfile,
    chooseAnisotropy,
    invalidate = () => {},
    onDetailChange = () => {},
    onDetailStatus = () => {},
  }) {
    const profile = qualityProfile || scene.getSceneQualityProfile("high");
    const balanced = profile.tier === "balanced";
    const size = profile.textures.groundSize;
    const colorCanvas = document.createElement("canvas");
    const bumpCanvas = document.createElement("canvas");
    const colorCtx = colorCanvas.getContext("2d");
    const bumpCtx = bumpCanvas.getContext("2d");
    if (!colorCtx || !bumpCtx) {
      return { colorMap: null, bumpMap: null, applyQuality: () => false, dispose: () => false };
    }

    // The film slate maps replace this pair on high and balanced, so start-up
    // fills only a flat preview and paints the detail in a task of its own
    // right after (or sooner through ensureProcedural()). The reveal, a film
    // ground reset and a fallback then all show the painted ground while maps load.
    let detailed = false;
    function paintGround(detail) {
      const start = sceneNow();
      const paintSize = detail ? size : 4;
      for (const canvas of [colorCanvas, bumpCanvas]) canvas.width = canvas.height = paintSize;
      colorCtx.fillStyle = groundPalette.baseColor;
      colorCtx.fillRect(0, 0, paintSize, paintSize);
      bumpCtx.fillStyle = groundPalette.bumpBase;
      bumpCtx.fillRect(0, 0, paintSize, paintSize);
      if (!detail) return;
      paintGroundDetail({ colorCtx, bumpCtx, size, balanced });
      detailed = true;
      measureScene("ground-paint", start);
    }
    paintGround(!["high", "balanced"].includes(profile.tier));

    const aniso = chooseAnisotropy(profile.anisotropy.max);
    const textures = {
      colorMap: makeTexture(THREE, colorCanvas, (tex) => {
        tex.wrapS = THREE.MirroredRepeatWrapping;
        tex.wrapT = THREE.MirroredRepeatWrapping;
        tex.repeat.set(4, 4);
        tex.anisotropy = aniso;
        tex.colorSpace = THREE.SRGBColorSpace;
      }),
      bumpMap: makeTexture(THREE, bumpCanvas, (tex) => {
        tex.wrapS = THREE.MirroredRepeatWrapping;
        tex.wrapT = THREE.MirroredRepeatWrapping;
        tex.repeat.set(4, 4);
        tex.anisotropy = aniso;
      }),
    };
    // Never throws: it runs from a timer, load callbacks and fallback statuses.
    function ensureProcedural() {
      if (detailed) return false;
      try {
        paintGround(true);
      } catch {
        return false;
      }
      for (const texture of [textures.colorMap, textures.bumpMap]) {
        texture.dispose(); // The canvases grew; the next upload reallocates storage.
        texture.needsUpdate = true;
      }
      invalidate();
      return true;
    }
    let paintTimer = detailed
      ? null
      : setTimeout(() => {
          paintTimer = null;
          ensureProcedural();
        }, 0);

    // The slate maps replace the procedural pair only after they decode; the
    // procedural canvases stay alive so a reset or fallback can rebind them.
    function publishGround() {
      onDetailChange({ ...textures, normalMap: null, roughnessMap: null, normalScale: 0 });
    }
    const filmMaps = createEarthDetail({
      profile,
      disabled: false,
      anisotropy: aniso,
      publish: onDetailChange,
      restore: publishGround,
      report(status) {
        if (status.status === "fallback") ensureProcedural();
        onDetailStatus({ ...status, material: FILM_GROUND_PRESETS.slate.material });
      },
    });
    return {
      ...textures,
      ensureProcedural,
      setFilmActive(active) {
        publishGround();
        filmMaps.setActive(active);
      },
      lifecycleOrder: 21,
      applyQuality(profile, context) {
        filmMaps.applyQuality(profile, context);
      },
      dispose() {
        clearTimeout(paintTimer);
        paintTimer = null;
        return filmMaps.dispose();
      },
    };
  };
})();
