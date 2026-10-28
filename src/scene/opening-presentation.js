// Admission is based on completed scene draws, never an independent rAF loop.
// The final opening stays at phase zero while uploads and driver work settle.
// The scene opens as soon as it draws (the owner's call of 2026-10-27, "as soon as it
// can draw"): OPENING_FRAMES drawn frames and the GPU's fence, whatever their pace. Their
// fastest interval (frameMs) tells the scene whether to step its resolution down, still
// hidden, before it shows: an upload, a late link or a skipped frame only lengthens a gap,
// while a GPU too slow for the profile lengthens every one.
export const OPENING_FRAMES = 4;
export function createOpeningPresentation(gl = null) {
  let previous = null,
    frames = 0,
    fence = null,
    gpuReady = !gl?.fenceSync,
    ready = false,
    failed = false,
    disposed = false;
  const gaps = [];
  const clearFence = () => {
    if (fence && !gl.isContextLost?.()) gl.deleteSync(fence);
    fence = null;
  };
  const reset = () => {
    clearFence();
    previous = null;
    frames = 0;
    gaps.length = 0;
    ready = failed = false;
    gpuReady = !gl?.fenceSync;
  };
  return {
    prepare: prepareOpeningResources,
    get ready() {
      return ready;
    },
    get failed() {
      return failed;
    },
    // The drawn frames' fastest interval in ms (0 before two frames).
    get frameMs() {
      return gaps.length ? Math.min(...gaps) : 0;
    },
    get gaps() {
      return [...gaps];
    },
    reset,
    sample(timestamp, workMs) {
      if (disposed || ready || failed) return ready;
      if (!Number.isFinite(timestamp) || !Number.isFinite(workMs) || gl?.isContextLost?.()) {
        reset();
        return false;
      }
      try {
        if (!gpuReady) {
          if (!fence) {
            fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
            if (!fence) throw new Error("Opening fence unavailable");
            gl.flush();
          } else {
            const status = gl.clientWaitSync(fence, 0, 0);
            if (status === gl.WAIT_FAILED) throw new Error("Opening fence failed");
            gpuReady = status === gl.ALREADY_SIGNALED || status === gl.CONDITION_SATISFIED;
            if (gpuReady) clearFence();
          }
        }
      } catch {
        failed = true;
        clearFence();
        return false;
      }
      const gap = previous === null ? 0 : timestamp - previous;
      previous = timestamp;
      if (gap < 0 || workMs < 0) return false;
      if (gap > 0) gaps.push(gap);
      frames++;
      ready = gpuReady && frames >= OPENING_FRAMES;
      return ready;
    },
    dispose() {
      reset();
      disposed = true;
    },
  };
}

// The opening's resource orchestration belongs to this already lazy owner.
// A failed optional sky resolves to the procedural sky; terrain remains required.
export function prepareOpeningResources(frame, owners, settle) {
  const { atmosphere, rendering, filmScene, groundTextures, rockScatter, groundContacts } = owners;
  const sky = atmosphere.prepareOpening(frame.plate).then((changed) => {
    if (changed) rendering.refreshEnvironment();
    settle("sky");
  });
  if (!frame.tree) return sky.then(() => true);
  const terrain = filmScene.prepareOpening(frame);
  const maps = groundTextures.prepareOpening().then(() => {
    filmScene.prelinkGround?.();
    settle("materials");
  });
  const rocks = rockScatter.prepareOpening().then(() => {
    if (rockScatter.committed) groundContacts.slateRockContact.value = 1;
    settle("rocks");
  });
  return Promise.all([terrain, maps, rocks, sky]).then(([ready]) => ready);
}
