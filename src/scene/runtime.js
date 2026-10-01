const DEFAULT_FRAME_SECONDS = 1 / 60;
const REFRESH_RATES = [30, 48, 50, 60, 72, 75, 90, 100, 120, 144, 165, 180, 240, 360];

function clampFrameSeconds(value, maximum) {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.min(maximum, value);
}

/**
 * Display frames per rendered frame, so renders land on every nth vsync near
 * baseRate. "floor" keeps at least baseRate (144 Hz renders 72 fps); "ceil"
 * keeps at most baseRate, which saves a phone's battery (90 Hz renders 45).
 */
export function renderDivisor(hz, { baseRate = 60, round = "floor" } = {}) {
  if (!(hz > 0) || !(baseRate > 0)) return 1;
  const ratio = hz / baseRate;
  return Math.max(1, round === "ceil" ? Math.ceil(ratio - 0.05) : Math.floor(ratio + 0.05));
}

/**
 * Estimates the display's refresh rate from rAF intervals. Every 16 samples
 * the 30th percentile of the last 32 is snapped to a common rate within 4%;
 * two agreeing estimates adopt it. Estimation never stops, so a monitor
 * switch or an LTPO rate change is followed. reset() drops the samples and
 * keeps the adopted rate; hz is 0 until one is adopted.
 */
export function createRefreshEstimator() {
  const intervals = new Float64Array(32);
  const sorted = new Float64Array(32);
  let candidate = 0;
  let count = 0;
  let fresh = 0;
  let hz = 0;
  let next = 0;

  return {
    get hz() {
      return hz;
    },
    reset() {
      candidate = count = fresh = next = 0;
    },
    sample(intervalMs) {
      if (!(intervalMs >= 2.5 && intervalMs <= 40)) return hz;
      intervals[next] = intervalMs;
      next = (next + 1) % intervals.length;
      count = Math.min(intervals.length, count + 1);
      if (++fresh < 16) return hz;
      fresh = 0;
      sorted.set(intervals);
      const window = sorted.subarray(0, count).sort();
      const rate = 1000 / window[Math.floor((count - 1) * 0.3)];
      let snapped = 0;
      for (const common of REFRESH_RATES) {
        const error = Math.abs(rate - common);
        const nearest = !snapped || error < Math.abs(rate - snapped);
        if (error <= common * 0.04 && nearest) snapped = common;
      }
      if (snapped && snapped === candidate) hz = snapped;
      candidate = snapped;
      return hz;
    },
  };
}

/**
 * Owns scene frame scheduling without owning any Three.js resources.
 *
 * Animated mode schedules continuously. Reduced-motion and still modes freeze
 * elapsed scene time and render only after invalidate(); still mode leaves the
 * reported reducedMotion preference alone. While any named hold is set nothing
 * renders or schedules, as when isRenderable() fails; releasing the last hold
 * resumes with a fresh delta. A separate per-rAF sample is retained when
 * frameStride > 1 so the quality governor does not mistake a deliberate 30fps
 * render cap for 30fps frame pressure.
 *
 * displayCadence ({ baseRate, round }) renders on every renderDivisor()th
 * vsync of the estimated refresh rate, evenly spaced where a targetFrameRate
 * accumulator alternates intervals (11/22 ms at 90 Hz); until a rate is
 * adopted it caps at baseRate like targetFrameRate. A late vsync re-phases the
 * cadence instead of drawing twice in a row, and the governor's sample reads a
 * met cadence as one base-rate frame.
 */
export function createSceneFrameScheduler({
  cancelFrame = globalThis.cancelAnimationFrame?.bind(globalThis),
  displayCadence = null,
  frameStride = 1,
  isRenderable = () => true,
  maxDeltaSeconds = 0.1,
  now = () => globalThis.performance?.now?.() ?? 0,
  onUpdate,
  reducedMotion = false,
  requestFrame = globalThis.requestAnimationFrame?.bind(globalThis),
  targetFrameRate = 0,
} = {}) {
  if (typeof onUpdate !== "function") {
    throw new TypeError("createSceneFrameScheduler requires onUpdate");
  }
  if (typeof requestFrame !== "function") {
    throw new TypeError("createSceneFrameScheduler requires requestFrame");
  }

  const stableStride = Math.max(1, Math.floor(frameStride || 1));
  const cadence = displayCadence || null;
  const refresh = cadence ? createRefreshEstimator() : null;
  // Until a refresh rate is adopted, a cadence caps at its base rate.
  const stableTargetFrameRate =
    Number.isFinite(targetFrameRate) && targetFrameRate > 0
      ? targetFrameRate
      : cadence
        ? cadence.baseRate || 60
        : 0;
  const targetFrameSeconds = stableTargetFrameRate > 0 ? 1 / stableTargetFrameRate : 0;
  const frameToleranceSeconds = Math.min(0.00075, targetFrameSeconds * 0.05);
  let active = false;
  let dirty = true;
  let elapsedSeconds = 0;
  let frameHandle = null;
  let frameTick = 0;
  let hasRendered = false;
  const holds = new Set();
  let lastTimestamp = null;
  let maxSampleDeltaSeconds = 0;
  let pendingDeltaSeconds = 0;
  let renderAccumulatorSeconds = 0;
  let prefersReducedMotion = Boolean(reducedMotion);
  let still = false;

  function isAnimated() {
    return !prefersReducedMotion && !still;
  }

  function schedule() {
    if (!active || holds.size > 0 || frameHandle !== null) return;
    frameHandle = requestFrame(update);
  }

  function cancel() {
    if (frameHandle !== null && typeof cancelFrame === "function") {
      cancelFrame(frameHandle);
    }
    frameHandle = null;
  }

  function resetTiming() {
    lastTimestamp = null;
    maxSampleDeltaSeconds = 0;
    pendingDeltaSeconds = 0;
    renderAccumulatorSeconds = 0;
    frameTick = 0;
    hasRendered = false;
    refresh?.reset();
  }

  function resume() {
    resetTiming();
    dirty = true;
    schedule();
  }

  function update(timestamp = now()) {
    frameHandle = null;
    if (!active) return;
    if (holds.size > 0 || !isRenderable()) {
      resetTiming();
      return;
    }

    const safeTimestamp = Number.isFinite(timestamp) ? timestamp : now();
    const sampleDeltaSeconds =
      lastTimestamp === null
        ? 0
        : clampFrameSeconds((safeTimestamp - lastTimestamp) / 1000, maxDeltaSeconds);
    lastTimestamp = safeTimestamp;
    maxSampleDeltaSeconds = Math.max(maxSampleDeltaSeconds, sampleDeltaSeconds);

    const animated = isAnimated();
    if (animated) {
      pendingDeltaSeconds += sampleDeltaSeconds;
      renderAccumulatorSeconds += sampleDeltaSeconds;
      elapsedSeconds += sampleDeltaSeconds;
      refresh?.sample(sampleDeltaSeconds * 1000);
      schedule();
    }

    if (!animated && !dirty) return;
    if (animated && stableStride > 1) {
      frameTick = (frameTick + 1) % stableStride;
      if (frameTick !== 0) return;
    }
    const hz = refresh?.hz ?? 0;
    const divisor = animated && hz > 0 ? renderDivisor(hz, cadence) : 1;
    if (
      animated &&
      hasRendered &&
      (hz > 0
        ? Math.round(renderAccumulatorSeconds * hz) < divisor
        : targetFrameSeconds > 0 &&
          renderAccumulatorSeconds + frameToleranceSeconds < targetFrameSeconds)
    ) {
      return;
    }

    const deltaSeconds = animated ? clampFrameSeconds(pendingDeltaSeconds, maxDeltaSeconds) : 0;
    // A met cadence reads as one base-rate frame. A cadence slower than the
    // base rate leaves out the vsyncs it waits by design; a faster one reports
    // its real interval, so a late render counts as on a base-rate display.
    const baseSeconds = 1 / (cadence?.baseRate || 60);
    const qualitySampleSeconds =
      divisor > 1
        ? Math.max(baseSeconds, pendingDeltaSeconds - Math.max(0, divisor / hz - baseSeconds))
        : maxSampleDeltaSeconds > 0
          ? maxSampleDeltaSeconds
          : DEFAULT_FRAME_SECONDS;
    pendingDeltaSeconds = 0;
    maxSampleDeltaSeconds = 0;
    if (hz > 0) {
      renderAccumulatorSeconds = 0;
    } else if (targetFrameSeconds > 0) {
      renderAccumulatorSeconds =
        renderAccumulatorSeconds < targetFrameSeconds
          ? 0
          : renderAccumulatorSeconds % targetFrameSeconds;
    } else {
      renderAccumulatorSeconds = 0;
    }
    hasRendered = true;
    dirty = false;
    onUpdate({
      deltaSeconds,
      elapsedSeconds,
      reducedMotion: prefersReducedMotion,
      sampleDeltaSeconds: qualitySampleSeconds,
      timestamp: safeTimestamp,
    });
  }

  return {
    dispose() {
      active = false;
      holds.clear();
      cancel();
      resetTiming();
    },
    getState() {
      return {
        active,
        dirty,
        elapsedSeconds,
        held: holds.size > 0,
        reducedMotion: prefersReducedMotion,
        scheduled: frameHandle !== null,
        still,
      };
    },
    invalidate() {
      dirty = true;
      schedule();
    },
    resume,
    setHold(reason, held) {
      const wasHeld = holds.size > 0;
      if (held) holds.add(reason);
      else holds.delete(reason);
      if (holds.size > 0 && !wasHeld) {
        cancel();
        resetTiming();
      } else if (holds.size === 0 && wasHeld) {
        resume();
      }
      return holds.size > 0;
    },
    setStill(value) {
      const next = Boolean(value);
      if (still === next) return;
      const wasAnimated = isAnimated();
      still = next;
      if (isAnimated() === wasAnimated) return;
      resetTiming();
      if (wasAnimated) return;
      dirty = true;
      schedule();
    },
    setReducedMotion(value) {
      const next = Boolean(value);
      if (prefersReducedMotion === next) return;
      prefersReducedMotion = next;
      resetTiming();
      dirty = true;
      schedule();
    },
    start() {
      if (active) return;
      active = true;
      dirty = true;
      resetTiming();
      schedule();
    },
    update,
  };
}

/**
 * Holds scene rendering behind an open dialog through the scheduler's "panel"
 * hold. sync() runs whenever isOpen() may have changed: the hold starts delayMs
 * after a dialog opens, once its dim overlay has faded in, and ends with the
 * last dialog, calling onRelease. A resize clears the canvas, so redraw()
 * releases the hold only until frameRendered() reports the next drawn frame.
 */
export function createPanelHold({
  clearTimer = globalThis.clearTimeout?.bind(globalThis),
  delayMs = 450,
  isOpen,
  onRelease = () => {},
  scheduler,
  setTimer = globalThis.setTimeout?.bind(globalThis),
}) {
  let held = false;
  let redrawing = false;
  let timer = null;

  function setHeld(next) {
    if (timer !== null) clearTimer(timer);
    timer = null;
    if (held === next) return;
    held = next;
    scheduler.setHold("panel", next);
  }

  return {
    get held() {
      return held;
    },
    sync() {
      if (!isOpen()) {
        const released = held || redrawing;
        redrawing = false;
        setHeld(false);
        if (released) onRelease();
      } else if (!held && !redrawing && timer === null) {
        timer = setTimer(() => setHeld(true), delayMs);
      }
    },
    redraw() {
      if (!held) return;
      redrawing = true;
      setHeld(false);
    },
    frameRendered() {
      if (!redrawing) return;
      redrawing = false;
      if (isOpen()) setHeld(true);
    },
    dispose() {
      if (timer !== null) clearTimer(timer);
      timer = null;
      redrawing = false;
    },
  };
}

/**
 * Holds scene rendering for a visitor's pause through the scheduler's
 * "visitor" hold, which composes with the dialog's "panel" hold. A pause
 * before the reveal waits for it and keeps the first revealed frame; a later
 * pause draws one more frame, so a tour crossfade settles on its incoming
 * shot, then holds. As with createPanelHold(), redraw() releases the hold only
 * until frameRendered() reports the next drawn frame.
 * Releasing a held pause calls onRelease.
 */
export function createVisitorHold({ onRelease = () => {}, scheduler }) {
  let disposed = false;
  let held = false;
  let paused = false;
  let redrawing = false;
  let revealed = false;

  function setHeld(next) {
    if (held === next) return;
    held = next;
    scheduler.setHold("visitor", next);
  }

  function release() {
    const released = held || redrawing;
    redrawing = false;
    setHeld(false);
    if (released) onRelease();
  }

  return {
    get held() {
      return held;
    },
    get paused() {
      return paused;
    },
    set(value) {
      const next = Boolean(value);
      if (disposed || paused === next) return paused;
      paused = next;
      if (!paused) release();
      else if (revealed) {
        redrawing = true;
        scheduler.invalidate();
      }
      return paused;
    },
    // Called once the frame that shows the canvas has drawn.
    reveal() {
      if (disposed || revealed) return;
      revealed = true;
      if (paused) setHeld(true);
    },
    redraw() {
      if (disposed || !held) return;
      redrawing = true;
      setHeld(false);
    },
    frameRendered() {
      if (!redrawing) return;
      redrawing = false;
      if (paused) setHeld(true);
    },
    dispose() {
      disposed = true;
      redrawing = false;
    },
  };
}

/**
 * Links new scene programs through compile() in a task of its own, instead of
 * in a blocking first draw or inside the commit that added them. pending counts
 * warm-ups not yet settled. A subject passed to warm() stays hidden until its
 * programs are ready. Program keys count visible lights (the tree carries two),
 * so every waiting subject is shown for the synchronous compile and hidden again
 * before any draw. compile() resolves true once linked; a false result, a
 * rejection or a throw still settles the warm-up, as not ready.
 */
export function createShaderWarmup({
  compile,
  schedule = (task) => globalThis.setTimeout(task, 0),
}) {
  let pending = 0;
  const waiting = new Set();

  return {
    get pending() {
      return pending;
    },
    warm(subject = null, onSettled = () => {}) {
      pending += 1;
      if (subject) {
        subject.visible = false;
        waiting.add(subject);
      }
      schedule(() => {
        waiting.forEach((object) => { object.visible = true; });
        let compiled;
        try {
          compiled = compile();
        } catch {
          compiled = false;
        }
        waiting.forEach((object) => { object.visible = false; });
        Promise.resolve(compiled)
          .then((ready) => ready === true, () => false)
          .then((ready) => {
            pending -= 1;
            if (subject) {
              waiting.delete(subject);
              subject.visible = true;
            }
            onSettled(ready);
          });
      });
    },
  };
}

/**
 * Holds an adaptive quality step for a tour cut, where the crossfade's kept
 * frame hides its one-off work. queue() links the new variant through
 * prepare() at once; a newer step replaces a waiting one. take() returns the
 * step on the first cut after prepare() settles (resolved or not), at once
 * while the tour is not running, and after maxWaitMs at most.
 */
export function createDeferredQualityStep({ prepare = () => true, maxWaitMs = 30000 } = {}) {
  let profile = null;
  let queuedAt = 0;
  let ready = false;
  let version = 0;

  return {
    get pending() {
      return profile !== null;
    },
    queue(nextProfile, nowMs = 0) {
      if (!nextProfile) return;
      const queued = ++version;
      const settle = () => {
        if (queued === version) ready = true;
      };
      profile = nextProfile;
      queuedAt = nowMs;
      ready = false;
      try {
        Promise.resolve(prepare(nextProfile)).then(settle, settle);
      } catch {
        settle();
      }
    },
    take({ cut = false, running = false, nowMs = 0 } = {}) {
      if (profile === null) return null;
      if (running && !(cut && ready) && nowMs - queuedAt < maxWaitMs) return null;
      const next = profile;
      profile = null;
      return next;
    },
  };
}

/**
 * Coalesces resize bursts and suppresses work when the CSS viewport is
 * unchanged. It owns only its queued callback; renderer/composer disposal
 * remains with their respective owners.
 */
export function createSceneResizeController({
  cancelFrame = globalThis.cancelAnimationFrame?.bind(globalThis),
  onResize,
  readSize,
  requestFrame = globalThis.requestAnimationFrame?.bind(globalThis),
} = {}) {
  if (typeof onResize !== "function" || typeof readSize !== "function") {
    throw new TypeError("createSceneResizeController requires readSize and onResize");
  }
  if (typeof requestFrame !== "function") {
    throw new TypeError("createSceneResizeController requires requestFrame");
  }

  let disposed = false;
  let frameHandle = null;
  let lastHeight = null;
  let lastPixelRatio = null;
  let lastWidth = null;

  function update({ force = false } = {}) {
    if (disposed) return false;
    const size = readSize() || {};
    const width = Math.max(1, Number(size.width) || 0);
    const height = Math.max(1, Number(size.height) || 0);
    const pixelRatio = Math.max(0.1, Number(size.pixelRatio) || 1);
    if (!force && width === lastWidth && height === lastHeight && pixelRatio === lastPixelRatio) {
      return false;
    }
    lastWidth = width;
    lastHeight = height;
    lastPixelRatio = pixelRatio;
    onResize({ height, pixelRatio, width });
    return true;
  }

  function flush() {
    frameHandle = null;
    update();
  }

  return {
    dispose() {
      disposed = true;
      if (frameHandle !== null && typeof cancelFrame === "function") {
        cancelFrame(frameHandle);
      }
      frameHandle = null;
    },
    getSize() {
      return { height: lastHeight, pixelRatio: lastPixelRatio, width: lastWidth };
    },
    resize() {
      if (disposed || frameHandle !== null) return;
      frameHandle = requestFrame(flush);
    },
    update,
  };
}

function collectTexture(value, textures) {
  if (!value) return;
  if (value.isTexture) {
    textures.add(value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => collectTexture(entry, textures));
  }
}

function collectMaterialResources(material, materials, textures) {
  if (!material || materials.has(material)) return;
  materials.add(material);
  for (const value of Object.values(material)) {
    collectTexture(value, textures);
  }
  if (material.uniforms) {
    for (const uniform of Object.values(material.uniforms)) {
      collectTexture(uniform?.value, textures);
    }
  }
}

/**
 * Releases resources owned by a scene graph exactly once. Render-target
 * textures are left to their render target so cube captures are not
 * double-disposed through both an envMap and WebGLRenderTarget.
 */
export function disposeSceneResources(root, { renderTargets = [] } = {}) {
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  const ownedRenderTargets = new Set(renderTargets.filter(Boolean));

  collectTexture(root?.background, textures);
  collectTexture(root?.environment, textures);
  root?.traverse?.((object) => {
    if (object.geometry) geometries.add(object.geometry);
    const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
    objectMaterials.forEach((material) => collectMaterialResources(material, materials, textures));
    if (object.renderTarget?.isWebGLRenderTarget) {
      ownedRenderTargets.add(object.renderTarget);
    }
  });

  const renderTargetTextures = new Set();
  ownedRenderTargets.forEach((target) => {
    collectTexture(target.texture, renderTargetTextures);
    collectTexture(target.textures, renderTargetTextures);
    collectTexture(target.depthTexture, renderTargetTextures);
  });

  geometries.forEach((geometry) => geometry.dispose?.());
  materials.forEach((material) => material.dispose?.());
  textures.forEach((texture) => {
    if (!renderTargetTextures.has(texture)) texture.dispose?.();
  });
  ownedRenderTargets.forEach((target) => target.dispose?.());

  return {
    geometries: geometries.size,
    materials: materials.size,
    renderTargets: ownedRenderTargets.size,
    textures: [...textures].filter((texture) => !renderTargetTextures.has(texture)).length,
  };
}

export function disposeSceneRuntimeResources({
  postprocessPipeline,
  renderer,
  renderTargets,
  scene,
} = {}) {
  postprocessPipeline?.dispose?.();
  const disposed = disposeSceneResources(scene, { renderTargets });
  scene?.clear?.();
  renderer?.dispose?.();
  renderer?.forceContextLoss?.();
  const canvas = renderer?.domElement;
  if (canvas?.parentNode && typeof canvas.parentNode.removeChild === "function") {
    canvas.parentNode.removeChild(canvas);
  } else {
    canvas?.remove?.();
  }
  return disposed;
}

export function hasMeaningfulScalarChange(previous, next, epsilon = 1e-4) {
  return (
    !Number.isFinite(previous) ||
    !Number.isFinite(next) ||
    Math.abs(previous - next) > Math.max(0, epsilon)
  );
}
