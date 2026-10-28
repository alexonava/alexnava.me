export { createOpeningFlame } from "./opening-flame.js";
export { createOpeningPresentation } from "./opening-presentation.js";

// Lazy builders keep their exact generator order while yielding between short
// tasks. Priority work avoids nested timers' 4 ms clamp; visible refinement
// retains its idle deadlines. No task advances a hidden or cancelled build.
export function runPreparationSteps(
  steps,
  {
    priority = () => false,
    priorityMs = () => 4,
    cancelled = () => false,
    progress = null,
    idleMs = 8,
    fallbackMs = 5,
    minimumMs = 2,
  } = {},
  host = globalThis,
) {
  return new Promise((resolve, reject) => {
    const document = host.document;
    let finished = false,
      cancelPending = null,
      channel = null,
      message = null,
      ticket = 0,
      canPost = Boolean(host.scheduler?.postTask && host.AbortController);
    const clearPending = () => {
      cancelPending?.();
      cancelPending = null;
    };
    const finish = (value, error = null) => {
      finished = true;
      clearPending();
      document?.removeEventListener?.("visibilitychange", visibilityChanged);
      if (channel) {
        channel.port1.onmessage = null;
        channel.port1.close();
        channel.port2.close();
        channel = message = null;
      }
      if (error) reject(error);
      else resolve(value);
    };
    const timer = (delay) => {
      const id = host.setTimeout(run, delay);
      cancelPending = () => host.clearTimeout(id);
    };
    const priorityTask = () => {
      if (canPost) {
        const controller = new host.AbortController();
        let active = true;
        cancelPending = () => {
          active = false;
          controller.abort();
        };
        try {
          Promise.resolve(
            host.scheduler.postTask(
              () => {
                if (!active) return;
                active = false;
                run();
              },
              { priority: "user-visible", signal: controller.signal },
            ),
          ).catch(() => {
            if (!active || finished) return;
            active = false;
            controller.abort();
            canPost = false;
            priorityTask();
          });
          return;
        } catch {
          controller.abort();
          canPost = false;
        }
      }
      if (host.MessageChannel) {
        if (!channel) {
          channel = new host.MessageChannel();
          channel.port1.onmessage = ({ data }) => {
            if (!message || data !== message.ticket) return;
            message = null;
            run();
          };
        }
        const next = ++ticket;
        message = { ticket: next };
        channel.port2.postMessage(next);
        cancelPending = () => {
          message = null;
        };
      } else timer(0);
    };
    function enqueue(fast = false) {
      if (finished) return;
      if (document?.hidden) return timer(100);
      if (fast) return priorityTask();
      if (host.requestIdleCallback) {
        const id = host.requestIdleCallback(run, { timeout: 100 });
        cancelPending = () => host.cancelIdleCallback?.(id);
      } else timer(0);
    }
    function visibilityChanged() {
      clearPending();
      enqueue(priority());
    }
    function run(deadline) {
      cancelPending = null;
      if (finished) return;
      try {
        if (cancelled()) {
          steps.return?.();
          return finish(null);
        }
        if (document?.hidden) return enqueue();
        const fast = priority(),
          until =
            host.performance.now() +
            (fast
              ? priorityMs()
              : !deadline
                ? fallbackMs
                : deadline.didTimeout
                  ? 2
                  : Math.max(minimumMs, Math.min(idleMs, deadline.timeRemaining())));
        do {
          const next = steps.next();
          if (fast) progress?.();
          if (next.done) return finish(next.value);
        } while (host.performance.now() < until);
        enqueue(fast);
      } catch (error) {
        try {
          steps.return?.();
        } catch {}
        finish(null, error);
      }
    }
    try {
      // A lazy import can settle after its owner has gone. Do not even enqueue
      // a stale builder into another owner's next idle window.
      if (cancelled()) {
        steps.return?.();
        return finish(null);
      }
      document?.addEventListener?.("visibilitychange", visibilityChanged);
      enqueue();
    } catch (error) {
      finish(null, error);
    }
  });
}

// A preparation job snapshots the same root and safe area the synchronous cut
// would use. Only completed measurements/fits enter the camera's existing caches.
export function createCameraPreparation(
  camera,
  roots,
  shots,
  resolveShot,
  safeArea,
  measure,
  fit,
  now = () => performance.now(),
) {
  let job = null;
  const cancel = () => {
    const previous = job;
    job = null;
    previous?.steps.return?.();
  };
  return {
    cancel,
    prepare(kind, angle, width, height) {
      const base = shots[kind]?.[angle];
      if (!base || !camera.isAvailable(kind)) {
        cancel();
        return "unavailable";
      }
      const root = roots()[kind === "tree" ? 1 : 0],
        shot = resolveShot(base, width, height),
        area = { ...safeArea(width, height) };
      root.updateWorldMatrix(true, false);
      const snapshot = [
        root,
        shot,
        width,
        height,
        area.left,
        area.top,
        area.width,
        area.height,
        ...root.matrixWorld.elements,
      ];
      if (job && !snapshot.every((value, i) => value === job.snapshot[i])) cancel();
      if (!job)
        job = {
          snapshot,
          steps: (function* () {
            const measured = yield* measure(root, shot, true);
            return yield* fit(shot, measured, area, width, height);
          })(),
        };
      const until = now() + 4;
      do {
        const next = job.steps.next();
        if (next.done) {
          job = null;
          return "ready";
        }
        if (next.value === true) return "pending";
      } while (now() < until);
      return "pending";
    },
  };
}

const tourPreparations = new WeakMap();
export function queueTourShot(camera, subject, angle, frame, host = globalThis) {
  let job = tourPreparations.get(camera);
  if (job) {
    job.shot = [subject, angle];
    job.frame = frame;
    return;
  }
  job = { shot: [subject, angle], frame };
  tourPreparations.set(camera, job);
  const idle = (task) =>
    host.requestIdleCallback
      ? host.requestIdleCallback(task, { timeout: 1500 })
      : host.setTimeout(task, 50);
  idle(function step() {
    const current = job.frame();
    if (!current) {
      tourPreparations.delete(camera);
      return;
    }
    const [width, height, transition] = current;
    if (
      host.document?.hidden ||
      transition.capture ||
      transition.progress < 1 ||
      camera.prepare(...job.shot, width, height, createCameraPreparation) === "pending"
    )
      idle(step);
    else tourPreparations.delete(camera);
  });
}

// A readiness timeout does not finish the driver's link. Keep an owned probe's
// material alive until that work settles, or its context disappears. Never free
// its borrowed maps or geometry. The last-resort bound handles a stalled driver.
export function retireShaderMaterial(
  renderer,
  material,
  { timeoutMs = 15000, now = Date.now, schedule = setTimeout, document = globalThis.document } = {},
) {
  const properties = renderer.properties,
    record = properties?.get?.(material),
    programs = [
      ...new Set(
        record?.programs
          ? record.programs.values()
          : record?.currentProgram
            ? [record.currentProgram]
            : [],
      ),
    ],
    started = now();
  let remaining = timeoutMs,
    previous = started,
    wasVisible = document?.hidden !== true;
  const budget = () => {
    const at = now(),
      visible = document?.hidden !== true;
    if (wasVisible) remaining -= Math.max(0, at - previous);
    previous = at;
    wasVisible = visible;
    return remaining <= 0 ? -1 : visible ? 1 : 0;
  };
  return new Promise((resolve) => {
    const finish = () => {
      material.dispose();
      resolve();
    };
    (function poll() {
      try {
        if (renderer.properties !== properties || renderer.getContext?.()?.isContextLost?.())
          return finish();
        const visible = budget();
        if (
          visible < 0 ||
          (visible && programs.every((p) => !p?.program || p.isReady?.() !== false))
        )
          return finish();
      } catch {
        return finish();
      }
      schedule(poll, 100);
    })();
  });
}
