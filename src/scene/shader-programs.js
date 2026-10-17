// Three r160's compileAsync polls mutable material properties after disposal.
// Capture this compile's programs while their keys are current, and stop before
// querying a freed/lost generation. A stalled driver never holds reveal open.
export function compilePrograms(renderer, objects, camera, targetScene, valid, timeoutMs = 2000) {
  let programs;
  const current = () => valid() && !renderer.getContext?.()?.isContextLost?.();
  try {
    if (!current()) return Promise.resolve(false);
    programs = [...renderer.compile(objects, camera, targetScene)].map(
      (material) => renderer.properties.get(material).currentProgram,
    );
  } catch {
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    (function poll() {
      try {
        if (!current()) return resolve(false);
        if (programs.every((program) => program?.isReady())) return resolve(true);
      } catch {
        return resolve(false);
      }
      if (Date.now() >= deadline) resolve(false);
      else setTimeout(poll, 10);
    })();
  });
}
