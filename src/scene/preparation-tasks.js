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
    document?.addEventListener?.("visibilitychange", visibilityChanged);
    enqueue();
  });
}
