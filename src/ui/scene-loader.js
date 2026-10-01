// The title card's loading line (#scene-loader in index.html).
//
// main.js begins a run only on the live path, after every static gate has
// passed, and reports two stages: the scene bundle loaded and the scene
// initialized. The required models report their downloaded bytes through
// track(), and the scene's User Timing measures (perf-marks.js names) report
// each one's parse, assembly and shader warm-up. The value is that real
// progress, held below 100% until #home-scene gains is-ready (the reveal); it
// then reads 100% and fades out with the canvas's fade-in. A scene host that is
// hidden (a failed scene) or a run that stops progressing retires the line
// below 100%, so it is never left on screen. Static visitors never see it.
(() => {
  const site = (window.BabelSite = window.BabelSite || {});
  // The early and the scene's own model requests: ROLE-TIER[.HASH].glb.
  const MODEL = /\/(tower|tree)-(high|balanced)(?:\.[0-9a-f]{8})?\.glb(?:[?#]|$)/;
  // A required model's build steps, as the scene measures them.
  const STEP = /^babel:(glb-parse|assembly|shaders):(tower|tree)$/;
  const STEPS = { "glb-parse": 0.35, assembly: 0.25, shaders: 0.4 };
  // Before the reveal: 10% bundle, 4% initialization, 70% bytes, 12% build.
  const CAP = 0.96;
  // Longer than the line's own 120ms + 360ms fade.
  const EXIT_MS = 600;
  const WATCH_MS = 2000;
  const STALL_MS = 15000;
  // Each tier's tower and tree sizes in bytes (build.mjs), as decoded bodies.
  const SIZES =
    typeof __BABEL_ARCHITECTURE_PREFETCH_BYTES__ !== "undefined"
      ? __BABEL_ARCHITECTURE_PREFETCH_BYTES__
      : null;
  const IDLE = {
    status: "idle",
    target: 0,
    tier: null,
    roles: [],
    ledger: [],
    stages: { bundle: false, init: false },
    built: {},
  };
  let run = IDLE;

  // The line is decorative: it never throws into main.js or the scene.
  const safe =
    (method, fallback) =>
    (...args) => {
      try {
        return method(...args);
      } catch {
        return fallback?.(...args);
      }
    };
  const loading = (r) => r.status === "loading";
  const fraction = (bytes) =>
    bytes.done ? 1 : bytes.expected ? Math.min(bytes.received / bytes.expected, 1) : 0;

  // A role's furthest request, so a retried download never adds to the one it
  // replaced; an unknown size counts nothing until its body ends.
  function roleBytes(r, role) {
    let best = { received: 0, expected: SIZES?.[r.tier]?.[role] || 0, done: false };
    for (const entry of r.ledger) {
      if (entry.role === role && fraction(entry) >= fraction(best)) best = entry;
    }
    return { received: best.received, expected: best.expected, done: best.done };
  }

  function measure(r) {
    const bytes = r.roles.map((role) => roleBytes(r, role));
    const known = bytes.filter((entry) => entry.expected);
    // A role of unknown size weighs as much as the average known one.
    const fallback = known.reduce((sum, entry) => sum + entry.expected, 0) / known.length || 1;
    let total = 0;
    let got = 0;
    let built = 0;
    for (const entry of bytes) {
      const weight = entry.expected || fallback;
      total += weight;
      got += weight * fraction(entry);
    }
    for (const role of r.roles) {
      for (const step in STEPS) if (r.built[role][step]) built += STEPS[step];
    }
    const value =
      0.1 * r.stages.bundle +
      0.04 * r.stages.init +
      0.7 * (got / total) +
      (0.12 * built) / r.roles.length;
    return Math.min(Math.round(value * 1e6) / 1e6, CAP);
  }

  function paint(r) {
    const shown = r.status === "revealed" ? 1 : r.target;
    r.fill.style.transform = `scaleX(${shown})`;
    r.value.textContent =
      shown === 1 ? "100%" : `${Math.floor(Math.min(shown, 0.99) * 100 + 1e-6)}%`;
  }

  // Byte counts arrive per network chunk; the line redraws at most once a frame.
  function schedule(r) {
    if (r.frame || !loading(r) || typeof window.requestAnimationFrame !== "function") return;
    r.frame = true;
    window.requestAnimationFrame(() => {
      r.frame = false;
      if (loading(r)) paint(r);
    });
  }

  // Progress never decreases.
  function update(r) {
    if (!loading(r)) return;
    const next = measure(r);
    if (next > r.target) {
      r.target = next;
      schedule(r);
    }
  }
  const tally = safe(update);

  // "revealed" completes the line; "static" (the scene host hidden or the
  // scene declined) and "stalled" retire it where it stands.
  const end = safe((reason) => {
    const r = run;
    if (!loading(r)) return;
    r.status = reason === "revealed" || reason === "stalled" ? reason : "static";
    r.cleanups.splice(0).forEach((cleanup) => safe(cleanup)());
    if (r.status === "revealed") {
      r.target = 1;
      paint(r);
    }
    r.el.classList.add("is-done");
    r.el.classList.remove("is-loading");
    r.exit = window.setTimeout(() => {
      r.el.hidden = true;
      r.el.classList.remove("is-done");
      r.fill.style.transform = "";
    }, EXIT_MS);
  });

  function begin({ tier = null } = {}) {
    if (loading(run)) return;
    const el = document.getElementById("scene-loader");
    const host = document.getElementById("home-scene");
    const fill = el?.querySelector(".scene-loader__fill");
    const value = el?.querySelector(".scene-loader__value");
    if (!host || !fill || !value) return;
    if (run.exit) window.clearTimeout(run.exit);
    // The tower opens the film; ?view=tree also waits for the tree.
    const roles =
      new URLSearchParams(window.location?.search || "").get("view") === "tree"
        ? ["tower", "tree"]
        : ["tower"];
    const r = (run = {
      el,
      host,
      fill,
      value,
      tier: tier || null,
      roles,
      status: "loading",
      ledger: [],
      stages: { bundle: false, init: false },
      built: Object.fromEntries(
        roles.map((role) => [role, { "glb-parse": false, assembly: false, shaders: false }]),
      ),
      target: 0,
      seen: 0,
      idle: 0,
      frame: false,
      exit: 0,
      cleanups: [],
    });
    // Only the loading run is current, so a guarded end() always ends this run.
    if (typeof window.MutationObserver === "function") {
      const mutations = new window.MutationObserver(() => {
        if (!loading(r)) return;
        if (host.classList.contains("is-ready")) end("revealed");
        else if (host.hidden) end("static");
      });
      mutations.observe(host, { attributes: true, attributeFilter: ["class", "hidden"] });
      r.cleanups.push(() => mutations.disconnect());
    }
    // Without PerformanceObserver the build share waits for the reveal.
    safe(() => {
      const timing = new window.PerformanceObserver((list) => {
        for (const { name, entryType } of list.getEntries()) {
          if (!loading(r)) return;
          // The reveal's mark backs up the class change.
          if (name === "babel:reveal" && entryType === "mark") return end("revealed");
          const [, step, role] = (entryType === "measure" && STEP.exec(name)) || [];
          if (r.built[role]) {
            r.built[role][step] = true;
            update(r);
          }
        }
      });
      timing.observe({ entryTypes: ["mark", "measure"] });
      r.cleanups.push(() => timing.disconnect());
    })();
    // Frames pause in a hidden tab; draw the latest value when it returns.
    const onVisibility = () => {
      if (!document.hidden) schedule(r);
    };
    document.addEventListener("visibilitychange", onVisibility);
    r.cleanups.push(() => document.removeEventListener("visibilitychange", onVisibility));
    // Only visible time without an open dialog counts toward a stall.
    const watchdog = window.setInterval(() => {
      if (!loading(r)) return;
      if (host.classList.contains("is-ready")) return end("revealed");
      if (document.hidden || document.body?.hasAttribute("data-panel-open")) return;
      if (r.target !== r.seen) {
        r.seen = r.target;
        r.idle = 0;
      } else if ((r.idle += WATCH_MS) >= STALL_MS) end("stalled");
    }, WATCH_MS);
    r.cleanups.push(() => window.clearInterval(watchdog));
    el.classList.remove("is-done");
    el.hidden = false;
    // Flush the unhidden style so the fade-in transition runs.
    void el.offsetWidth;
    el.classList.add("is-loading");
    paint(r);
  }

  function stage(name) {
    const r = run;
    if (loading(r) && (name === "bundle" || name === "init")) {
      r.stages[name] = true;
      update(r);
    }
  }

  // Counts a required model's body as it arrives. The body is read eagerly, so
  // an early request counts before the scene takes it; the copy returned stays
  // the data path after the line has ended.
  function track(url, response) {
    const r = run;
    const [, role, tier] = MODEL.exec(String(url)) || [];
    if (
      !loading(r) ||
      !r.roles.includes(role) ||
      !response?.ok ||
      !response.body ||
      typeof window.ReadableStream !== "function" ||
      typeof window.Response !== "function"
    )
      return response;
    let reader = null;
    let controller = null;
    const stream = new window.ReadableStream({
      start(streamController) {
        controller = streamController;
      },
      cancel(reason) {
        return reader?.cancel(reason);
      },
    });
    const copy = new window.Response(stream, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
    // The last step that can fail: until here the original stays usable.
    reader = response.body.getReader();
    r.tier ||= tier;
    const entry = { role, expected: SIZES?.[tier]?.[role] || 0, received: 0, done: false };
    r.ledger.push(entry);
    // Only the stream steps can end the copy; counting never touches it. A
    // cancelled copy refuses close() and enqueue(), so it never counts as done.
    (async () => {
      for (;;) {
        let chunk;
        try {
          chunk = await reader.read();
          if (chunk.done) controller.close();
          else controller.enqueue(chunk.value);
        } catch (error) {
          return safe(() => controller.error(error))();
        }
        if (chunk.done) entry.done = true;
        else entry.received += chunk.value.byteLength;
        tally(r);
        if (chunk.done) return;
      }
    })();
    return copy;
  }

  site.sceneLoader = {
    begin: safe(begin),
    track: safe(track, (url, response) => response),
    stage: safe(stage),
    end,
    get state() {
      const r = run;
      return {
        status: r.status,
        progress: r.target,
        tier: r.tier,
        roles: [...r.roles],
        bytes: Object.fromEntries(r.roles.map((role) => [role, roleBytes(r, role)])),
        stages: { ...r.stages },
        built: JSON.parse(JSON.stringify(r.built)),
      };
    },
  };
})();
