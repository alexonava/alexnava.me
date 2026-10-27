// Admission is based on completed scene draws, never an independent rAF loop.
// The final opening stays at phase zero while uploads and driver work settle.
export function createOpeningPresentation(gl = null) {
  let previous = null,
    first = null,
    frames = 0,
    fence = null,
    gpuReady = !gl?.fenceSync,
    ready = false,
    failed = false,
    disposed = false;
  const clearFence = () => {
    if (fence && !gl.isContextLost?.()) gl.deleteSync(fence);
    fence = null;
  };
  const reset = () => {
    clearFence();
    previous = first = null;
    frames = 0;
    ready = failed = false;
    gpuReady = !gl?.fenceSync;
  };
  return {
    get ready() {
      return ready;
    },
    get failed() {
      return failed;
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
      // Stable 30 Hz remains usable; the adaptive governor aims for 60 Hz.
      // Startup stalls and slow submissions must leave this fresh window.
      if (gap <= 0 || gap > 35 || workMs > 25 || workMs < 0) {
        first = timestamp;
        frames = 0;
        return false;
      }
      first ??= timestamp;
      frames++;
      ready = gpuReady && frames >= 12 && timestamp - first >= 250;
      return ready;
    },
    dispose() {
      reset();
      disposed = true;
    },
  };
}
