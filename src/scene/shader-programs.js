// Three r160's compileAsync polls mutable material properties after disposal.
// Capture every retained variant while material keys are current, and stop before
// querying a freed/lost generation. Three clears a destroyed wrapper's program
// field; checking that JS field avoids synchronous gl.isProgram driver queries.
// Link status is read only after nonblocking completion. A stalled driver never
// holds reveal open.
export function linkedPrograms(renderer, programs, valid = () => true) {
  const gl = renderer.getContext?.();
  const current = () => valid() && !gl?.isContextLost?.();
  return (
    current() &&
    programs.every(
      (program) =>
        program &&
        current() &&
        program?.diagnostics?.runnable !== false &&
        (!gl?.getProgramParameter || program.program) &&
        program.isReady?.() !== false &&
        (!gl?.getProgramParameter ||
          gl.getProgramParameter(program.program, gl.LINK_STATUS) === true),
    )
  );
}

// Background suspension is not a shader failure. Do not query or retire a
// still-linking program just because a hidden tab cannot submit GPU work.
export function shaderWaitBudget(timeoutMs, clock = Date.now, document = globalThis.document) {
  let remaining = timeoutMs,
    previous = clock(),
    visible = document?.hidden !== true;
  return () => {
    const now = clock(),
      shown = document?.hidden !== true;
    if (visible) remaining -= Math.max(0, now - previous);
    previous = now;
    visible = shown;
    return remaining <= 0 ? -1 : shown ? 1 : 0;
  };
}

export function compilePrograms(renderer, objects, camera, targetScene, valid, timeoutMs = 2000) {
  let programs;
  const current = () => valid() && !renderer.getContext?.()?.isContextLost?.();
  try {
    if (!current()) return Promise.resolve(false);
    programs = [
      ...new Set(
        [...renderer.compile(objects, camera, targetScene)].flatMap((material) => {
          const properties = renderer.properties.get(material);
          return properties.programs
            ? [...properties.programs.values()]
            : [properties.currentProgram];
        }),
      ),
    ];
    // Compilation runs in tasks, outside a frame boundary. Submit the batch
    // before polling its nonblocking completion status.
    renderer.getContext?.()?.flush?.();
  } catch {
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    const budget = shaderWaitBudget(timeoutMs);
    (function poll() {
      try {
        if (!current()) return resolve(false);
        const waiting = budget();
        if (waiting < 0) return resolve(false);
        if (!waiting) return setTimeout(poll, 100);
        const gl = renderer.getContext?.();
        if (gl?.getProgramParameter && programs.some((program) => !program?.program))
          return resolve(false);
        if (programs.every((program) => program?.isReady())) {
          // Completion alone includes failed links; production disables Three's
          // lazy diagnostics. Query success only after parallel work finishes.
          return resolve(linkedPrograms(renderer, programs, current));
        }
      } catch {
        return resolve(false);
      }
      setTimeout(poll, 10);
    })();
  });
}
