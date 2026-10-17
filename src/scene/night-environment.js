import {
  BackSide,
  HalfFloatType,
  Group,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  SphereGeometry,
  Vector3,
  Vector4,
  WebGLRenderTarget,
} from "three";

// The film's night sky as an environment map: the sky shell's own film sky and
// cloud banks, drawn once into a prefiltered cube (PMREM) when the film starts
// (and again after a lost context), never per frame. Its colours are the sky as
// the frame shows it (the shell's opacity applied), so a mirror in it is never
// brighter than the sky it reflects. Below the clouds it adds what the shell
// leaves to other meshes: the moon's soft glow about the key light (the moon
// itself stays out of every shot), the ranges' dark broken crest along the
// horizon and the dark ground below it. Materials take it as scene.environment
// (Three's standard IBL): each role weighs its diffuse sky light and its
// reflections (architecture.js ENVIRONMENT_ROLES); the ground does its own
// (mud-ground.js).
export const NIGHT_SKY = Object.freeze({
  // The moon's glow, [gain, falloff exponent] pairs about the key's direction.
  moon: Object.freeze({
    color: Object.freeze([0.8, 0.83, 0.9]),
    halo: Object.freeze([0.12, 48]),
    glow: Object.freeze([0.045, 5]),
  }),
  // The ranges' crest (direction.y, a mean and the noise's reach) and their tone,
  // as the frame shows them.
  ranges: Object.freeze({
    crest: Object.freeze([0.028, 0.05]),
    tone: Object.freeze([0.07, 0.078, 0.098]),
  }),
  ground: Object.freeze([0.04, 0.041, 0.047]),
  layers: 3, // the cloud and nebula octaves (the high sky's)
});

const glsl = (value) => (Number.isInteger(value) ? value.toFixed(1) : String(value));
const vec3 = (values) => `vec3(${values.map(glsl).join(",")})`;
// Added after the film sky (main's scope: `direction`, `col`), before the
// shell's opacity, which the frame applies after it: so these divide by it.
const ENVIRONMENT_GLSL = (shell) => {
  const { moon, ranges, ground } = NIGHT_SKY;
  return `if(envCapture>.5){
float envKey=max(dot(direction,envKeyDirection),0.);
col+=${vec3(moon.color)}*(${glsl(moon.halo[0])}*pow(envKey,${glsl(moon.halo[1])})+${glsl(moon.glow[0])}*pow(envKey,${glsl(moon.glow[1])}))/${glsl(shell)};
float envAz=atan(direction.z,direction.x);
float envCrest=${glsl(ranges.crest[0])}+${glsl(ranges.crest[1])}*(noise(vec2(envAz*5.0,1.7))*.62+noise(vec2(envAz*17.0,4.3))*.38-.5);
col=mix(col,${vec3(ranges.tone)}/${glsl(shell)},1.0-smoothstep(envCrest-.006,envCrest+.006,direction.y));
col=mix(col,${vec3(ground)}/${glsl(shell)},smoothstep(-.004,-.06,direction.y));
}
`;
};

// Inserts text before the shell's output, with any whitespace where the
// anchor has none (the published build compacts GLSL).
function insertBefore(source, anchor, text) {
  const pattern = new RegExp(
    anchor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/=/g, "\\s*=\\s*"),
  );
  const match = pattern.exec(source);
  return match && source.slice(0, match.index) + text + source.slice(match.index);
}

// The environment, captured from the live sky material's own shader. setSky()
// links the capture's sky program in the background where programs compile in
// parallel, so the capture itself costs a few milliseconds. capture() returns
// the PMREM texture (null without a sky or on failure) and keeps it until
// dispose(); restore() draws it again into a fresh target after a lost
// context. status: "none" | "ready" | "failed"; ms: the capture's time.
export function createNightEnvironment(
  renderer,
  {
    keyDirection,
    shellOpacity = 0.52,
    createGenerator = () => new PMREMGenerator(renderer),
    schedule = (task) => setTimeout(task, 0),
    prepareTimeoutMs = 2000,
  } = {},
) {
  let sky = null,
    shell = shellOpacity,
    capture = null,
    target = null,
    status = "none",
    ms = 0,
    linking = null,
    preparing = null,
    generation = 0,
    disposed = false;
  const waiting = new Set();
  const contextLost = () => renderer.getContext?.()?.isContextLost?.() === true;
  const current = (ticket) => !disposed && ticket === generation && !contextLost();
  const cancelPreparation = () => {
    for (const cancel of waiting) cancel();
  };
  const nextTask = () =>
    new Promise((resolve) => {
      const finish = () => {
        waiting.delete(finish);
        resolve();
      };
      waiting.add(finish);
      schedule(finish);
    });

  // r160's compileAsync polls mutable material properties without a timeout.
  // The real renderer lets us snapshot its programs and own a bounded poll;
  // a compileAsync-only adapter keeps its resources until that raw poll settles.
  function awaitPrograms(ticket, programs = null, raw = null) {
    return new Promise((resolve) => {
      let timer = null;
      let settled = false;
      const until = performance.now() + prepareTimeoutMs;
      const finish = (ready = false) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        waiting.delete(cancel);
        resolve(ready && current(ticket));
      };
      const cancel = () => finish(false);
      waiting.add(cancel);
      const poll = () => {
        try {
          if (!current(ticket) || performance.now() >= until) return finish(false);
          if (programs?.every((program) => program.isReady())) return finish(true);
        } catch {
          return finish(false);
        }
        timer = setTimeout(poll, 10);
      };
      if (raw)
        raw.then(
          (ready) => finish(ready),
          () => finish(false),
        );
      poll();
    });
  }
  function linkPrograms(scene, camera, ticket) {
    if (typeof renderer.compile === "function" && typeof renderer.properties?.get === "function") {
      const materials = renderer.compile(scene, camera);
      const programs = [...materials].map(
        (material) => renderer.properties.get(material).currentProgram,
      );
      const ready = awaitPrograms(ticket, programs);
      return { ready, settled: ready.then(() => {}) };
    }
    const raw = Promise.resolve(renderer.compileAsync(scene, camera)).then(
      () => true,
      () => false,
    );
    return { ready: awaitPrograms(ticket, null, raw), settled: raw.then(() => {}) };
  }
  const key = new Vector3(...(keyDirection ?? [0, 1, 0])).normalize();
  // The sky shell's film sky, with the environment's additions, on a sphere.
  function captureScene() {
    if (capture) return capture;
    const material = sky.clone();
    const fragment = insertBefore(
      material.fragmentShader,
      "gl_FragColor=uFilm>.5?",
      ENVIRONMENT_GLSL(shell),
    );
    if (!fragment) {
      material.dispose();
      throw new Error("Sky shader lacks its output anchor");
    }
    material.fragmentShader = fragment.replace(
      "void main()",
      "uniform float envCapture;\nuniform vec3 envKeyDirection;\nvoid main()",
    );
    // The cube's faces have no name or intro behind them: the clouds' text guard
    // reads an empty box, not the live one the clone shares. The capture keeps
    // the authored clouds without their reshaping (estate-sky.js CLOUD_RESHAPE),
    // so the sky light and reflections the materials take keep their brightness,
    // and never a lightning flash (lightning.js), even one lit as it is taken.
    Object.assign(material.uniforms, {
      envCapture: { value: 1 },
      envKeyDirection: { value: key },
      slateText: { value: { x: 2, y: 2, z: -1, w: -1 } },
      uCloudReshape: { value: 0 },
      uFlash: { value: new Vector4(0, 1, 0, 0) },
    });
    material.uniforms.uFilm.value = 1;
    material.uniforms.uClouds.value = 1;
    material.uniforms.uNebulaLayers.value = NIGHT_SKY.layers;
    material.uniforms.uTime.value = 0;
    Object.assign(material, { side: BackSide, transparent: false, depthWrite: false });
    const geometry = new SphereGeometry(50, 64, 32),
      scene = new Scene();
    scene.add(new Mesh(geometry, material));
    return (capture = { scene, material, geometry });
  }
  // While its program links in the background, Three polls it until it is
  // ready: freeing the capture's material sooner would throw from that poll,
  // so it is freed once the link settles.
  function release() {
    const done = capture;
    capture = null;
    if (!done) return;
    const free = () => {
      done.material.dispose();
      done.geometry.dispose();
    };
    if (linking) linking.then(free);
    else free();
  }
  // Links the capture's program against a linear half-float target, as the
  // PMREM cube draws it, without blocking (KHR_parallel_shader_compile).
  function prepare() {
    if (
      !sky ||
      target ||
      (typeof renderer.compileAsync !== "function" &&
        !(
          typeof renderer.compile === "function" && typeof renderer.properties?.get === "function"
        )) ||
      renderer.extensions?.has?.("KHR_parallel_shader_compile") !== true
    )
      return null;
    let probe = null;
    const previous = renderer.getRenderTarget?.() ?? null;
    try {
      const { scene } = captureScene();
      probe = new WebGLRenderTarget(1, 1, { type: HalfFloatType });
      renderer.setRenderTarget(probe);
      const job = linkPrograms(scene, new PerspectiveCamera(90, 1, 0.1, 100), generation);
      linking = job.settled;
      job.settled.then(() => {
        if (linking === job.settled) linking = null;
      });
      return job;
    } catch {
      // The capture links on its own draw instead.
      return null;
    } finally {
      renderer.setRenderTarget?.(previous);
      probe?.dispose();
    }
  }
  // r160 creates its blur material only when the target size is known. Warm
  // that exact material, and the cube's background, before fromScene() first
  // introspects either program. These are the pinned generator's allocation
  // hooks; its actual capture and filtering remain Three's unchanged path.
  async function prepareCapture(skyLink, ticket) {
    if (!(await skyLink.ready) || !current(ticket) || !sky) return null;
    await nextTask();
    if (!current(ticket)) return null;
    let probe = null;
    let background = null;
    let prefilter = null;
    let job = null;
    let consumed = false;
    const previous = renderer.getRenderTarget?.() ?? null;
    try {
      prefilter = createGenerator();
      prefilter._setSize(256);
      probe = prefilter._allocateTargets();
      background = new MeshBasicMaterial({ side: BackSide, depthWrite: false, depthTest: false });
      const programs = new Group();
      programs.add(new Mesh(prefilter._lodPlanes[0], prefilter._blurMaterial));
      programs.add(new Mesh(prefilter._lodPlanes[0], background));
      renderer.setRenderTarget(probe);
      job = linkPrograms(programs, new PerspectiveCamera(), ticket);
    } catch {
      // A renderer without the pinned hooks still captures through fromScene().
    } finally {
      renderer.setRenderTarget?.(previous);
    }
    try {
      if (job && !(await job.ready)) return null;
      await nextTask();
      if (!current(ticket)) return null;
      consumed = true;
      return attempt(prefilter);
    } finally {
      const free = () => {
        probe?.dispose();
        background?.dispose();
        if (!consumed) prefilter?.dispose();
      };
      // A compileAsync-only adapter can still be polling these materials.
      // Readiness settles promptly, but disposal waits for its raw poll.
      if (job) job.settled.then(free);
      else free();
    }
  }
  function draw(prepared = null) {
    const start = globalThis.performance?.now?.() ?? 0;
    const { scene } = captureScene(),
      prefilter = prepared ?? createGenerator();
    try {
      const next = prefilter.fromScene(scene, 0, 0.1, 100);
      target?.dispose();
      target = next;
    } finally {
      prefilter.dispose();
    }
    status = "ready";
    ms = (globalThis.performance?.now?.() ?? 0) - start;
  }
  function attempt(prepared = null) {
    if (disposed || contextLost()) {
      prepared?.dispose();
      return null;
    }
    try {
      draw(prepared);
    } catch {
      status = "failed";
      target?.dispose();
      target = null;
    }
    return target?.texture ?? null;
  }
  return {
    get ready() {
      return target ? Promise.resolve(target.texture) : (preparing ?? Promise.resolve(null));
    },
    get status() {
      return status;
    },
    get ms() {
      return ms;
    },
    get texture() {
      return target?.texture ?? null;
    },
    setSky(material, opacity) {
      if (disposed) return;
      release();
      generation += 1;
      cancelPreparation();
      sky = material?.isShaderMaterial ? material : null;
      if (Number.isFinite(opacity)) shell = opacity;
      const job = prepare();
      preparing = job ? prepareCapture(job, generation).catch(() => null) : null;
    },
    capture() {
      if (target) return target.texture;
      if (!sky || status === "failed") return null;
      return attempt();
    },
    // A restored context holds no target contents: draw the sky again.
    restore() {
      generation += 1;
      cancelPreparation();
      return target || (sky && status !== "failed") ? attempt() : null;
    },
    dispose() {
      disposed = true;
      generation += 1;
      cancelPreparation();
      target?.dispose();
      target = null;
      release();
      sky = null;
    },
  };
}
