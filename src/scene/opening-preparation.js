// The scene's readiness gate is independent of the decorative loading UI.
// Time is charged only between visible observations; a visibility event must
// tick at its boundary, so a suspended tab cannot spend the opening budget.
export function createOpeningPreparation({
  stages,
  idleMs = 15000,
  totalMs = 30000,
  report = () => {},
  fail = () => {},
} = {}) {
  const completed = new Set();
  let status = "preparing",
    reason = "",
    previous = null,
    wasVisible = false,
    elapsed = 0,
    idle = 0,
    progress = 0;
  const snapshot = () => ({
    status,
    completed: completed.size,
    total: stages.length,
    stage: stages.find((stage) => !completed.has(stage)) ?? "",
    reason,
  });
  const publish = () => report(snapshot());
  publish();
  return {
    get state() {
      return { ...snapshot(), elapsed, idle };
    },
    get ready() {
      return status === "ready";
    },
    settle(stage) {
      if (status !== "preparing" || !stages.includes(stage) || completed.has(stage)) return;
      completed.add(stage);
      idle = 0;
      if (completed.size === stages.length) status = "ready";
      publish();
    },
    reopen(...stages) {
      if (!["preparing", "ready"].includes(status)) return;
      for (const stage of stages) completed.delete(stage);
      status = "preparing";
      publish();
    },
    tick(timestamp, visible, nextProgress = progress) {
      const delta = previous === null ? 0 : Math.max(0, timestamp - previous);
      previous = timestamp;
      if (wasVisible && status === "preparing") {
        elapsed += delta;
        idle += delta;
      }
      wasVisible = visible;
      if (status !== "preparing") return;
      if (elapsed < totalMs && idle < idleMs) {
        if (Number.isFinite(nextProgress) && nextProgress > progress) {
          progress = nextProgress;
          idle = 0;
        }
        return;
      }
      status = "failed";
      reason = elapsed >= totalMs ? "deadline" : "stalled";
      publish();
      fail(reason);
    },
    dispose() {
      status = "disposed";
    },
  };
}
