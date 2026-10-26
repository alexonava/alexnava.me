// Three r160's compileAsync polls mutable material properties after disposal.
// Capture every retained variant while material keys are current, and stop before
// querying a freed/lost generation. A stalled driver never holds reveal open.
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
        (!gl?.getProgramParameter ||
          (program?.program && gl.getProgramParameter(program.program, gl.LINK_STATUS) === true)),
    )
  );
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
  } catch {
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    (function poll() {
      try {
        if (!current()) return resolve(false);
        if (programs.every((program) => program?.isReady())) {
          // Completion alone includes failed links; production disables Three's
          // lazy diagnostics. Query success only after parallel work finishes.
          return resolve(linkedPrograms(renderer, programs, current));
        }
      } catch {
        return resolve(false);
      }
      if (Date.now() >= deadline) resolve(false);
      else setTimeout(poll, 10);
    })();
  });
}
