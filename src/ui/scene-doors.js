// The opening's paper doors (#scene-doors in index.html).
//
// The doors are closed over the whole page at the first paint, the identity, Contact and
// the loading line under them, before the page knows whether the live scene will load, and
// the stylesheet alone opens them after 4s, so a page whose scripts never run is never left
// behind them. Evaluated early (app.js runs this before main.js), the script holds them:
// the stylesheet's last-resort backstop moves beyond the functional loading deadline.
// Only the scene's prepared reveal or a settled static fallback parts them. Early input
// cannot bypass preparation; concealed content is temporarily inert. Once open they
// leave the page (hidden) after their opening.
//
// On the live path the loading line's begin() upgrades them: the paper doors' own script
// (src/doors-entry.js) draws the sheets as real paper over the stylesheet's, in a worker
// where it can, and they replace the stylesheet's once drawn; any failure, then or later,
// leaves the stylesheet's doors as they stand. Through the paper the scene's star warms
// with the load: the loading line's star (paintStar()) reports where and how warm through
// light().
(() => {
  const site = (window.BabelSite = window.BabelSite || {});
  // The stylesheet's unheld opening (styles.css .scene-doors__leaf animation-delay), less
  // a margin: past it the stylesheet is already opening them. Held, its backstop
  // (.scene-doors.is-held), after the script's own cap.
  const FAILSAFE_MS = 4000 - 150;
  const BACKSTOP_MS = 35000;
  const CAP_MS = 34000;
  const TICK_MS = 250;
  // Longer than the slowest opening.
  const LEAVE_MS = 2300;
  // The scene has already demonstrated even rendered frames before reveal.
  // Wait only for its CSS opacity fade; hidden time cannot uncover the page.
  const FADE_MS = 480;
  const GLOW = Object.freeze({ radii: 7, min: 64 });
  const DOORS_URL = typeof __BABEL_DOORS_URL__ !== "undefined" ? __BABEL_DOORS_URL__ : "";

  let doors = null;
  let state = "absent";
  let glows = [];
  // The paper doors: null, "loading", or the drawing; why the drawing last failed.
  let paper = null;
  let failure = null;
  let lit = {};
  const cleanups = [];
  let revealAt = null;

  // The doors are decorative: they never throw into the loader, main.js or the scene.
  const safe =
    (method, fallback) =>
    (...args) => {
      try {
        return method(...args);
      } catch {
        return fallback?.(...args);
      }
    };
  const now = () => window.performance?.now?.() ?? 0;
  // The stylesheet's own opening's clock: from the first style, paused while the page is
  // hidden (is-paused), so it counts the page's visible time; null where animations
  // cannot be read.
  const clock = () => {
    const [animation] = doors?.querySelector(".scene-doors__leaf")?.getAnimations?.() ?? [];
    return typeof animation?.currentTime === "number" ? animation.currentTime : null;
  };

  function release() {
    cleanups.splice(0).forEach((cleanup) => safe(cleanup)());
  }

  // The stylesheet's doors stand in again where the drawing fails.
  const drop = safe(() => {
    const drawing = paper;
    paper = null;
    doors?.classList.remove("is-drawn", "is-drawn-only");
    if (drawing && typeof drawing === "object") safe(() => drawing.dispose())();
  });

  function hide() {
    release();
    doors.hidden = true;
    state = "gone";
    drop();
  }

  const part = safe(() => {
    state = "open";
    release();
    doors.classList.remove("is-paused");
    window.setTimeout(hide, LEAVE_MS);
    // A backstop already under way (the script was held up past it) finishes as it is; the
    // stylesheet's halves show again in place of a drawing that would not have moved.
    if ((clock() ?? 0) >= BACKSTOP_MS) return drop();
    doors.classList.add("is-open");
    if (paper && typeof paper === "object") safe(() => paper.open().catch?.(drop), drop)();
    else paper = null;
  }, hide);

  const open = safe((reason) => {
    if (!["held", "settling"].includes(state)) return;
    if (!["revealed", "static", "stalled"].includes(reason)) return;
    if (reason !== "revealed") return part();
    if (state === "settling") return;
    state = "settling";
    revealAt = now() + FADE_MS;
    const timer = window.setTimeout(() => {
      if (!document.hidden && state === "settling") part();
    }, FADE_MS);
    cleanups.push(() => window.clearTimeout(timer));
  });

  // The star through the paper (or, in a lantern opening, the lantern's flame: its `kind`):
  // its CSS px and radius as the loading line has them, its warmth (0 to 1) and the load's
  // progress, which lights the seam and fills the line's bar on the paper (styles.css
  // .scene-doors::after), shown from the line's first word.
  const light = safe(({ star = null, warm = 0, progress = 0 } = {}) => {
    if (state !== "held") return;
    lit = { star, warm, progress };
    if (paper && typeof paper === "object") safe(() => paper.light(lit), drop)();
    const level = Math.min(1, Math.max(0, Number(progress) || 0));
    doors.style.setProperty("--doors-light", String(Math.round(level * 1000) / 1000));
    doors.classList.add("is-loading");
    const valid = star && [star.x, star.y, star.radius].every(Number.isFinite) && star.radius > 0;
    // A lantern opening's light is the lantern glass's amber (styles.css .is-lantern).
    if (valid) doors.classList.toggle("is-lantern", star.kind === "lantern");
    const heat = valid ? Math.min(1, Math.max(0, Number(warm) || 0)) : 0;
    const radius = valid ? Math.max(GLOW.min, GLOW.radii * star.radius) : 0;
    for (const glow of glows) {
      glow.style.opacity = String(Math.round(heat * 1000) / 1000);
      if (valid) {
        const scale = ((2 * radius) / 100) * (0.55 + 0.45 * Math.sqrt(heat));
        glow.style.transform = `translate(${star.x}px, ${star.y}px) scale(${scale})`;
      }
    }
  });

  // A failed or lost drawing gives the doors back to the stylesheet.
  function fail(drawing, why) {
    failure = String(why);
    if (paper === drawing || paper === "loading") drop();
    safe(() => drawing?.dispose())();
  }

  // The drawing takes over once its first frame is on the canvas; the stylesheet's paper
  // goes from under it when the canvas has faded in.
  function adopt(drawing) {
    if (state !== "held" || paper !== "loading") return safe(() => drawing.dispose())();
    paper = drawing;
    safe(() => paper.light(lit), drop)();
    if (paper !== drawing) return;
    doors.classList.add("is-drawn");
    window.setTimeout(() => {
      if (paper === drawing) doors.classList.add("is-drawn-only");
    }, 600);
  }

  // The live path: the paper doors' script draws the sheets (src/doors-entry.js).
  const upgrade = safe(({ tier = null } = {}) => {
    if (state !== "held" || paper || !DOORS_URL) return;
    // Increased contrast keeps plain paper (styles.css): no drawing to load.
    if (window.matchMedia?.("(prefers-contrast: more)").matches) return;
    paper = "loading";
    const script = document.createElement("script");
    script.src = DOORS_URL;
    script.async = true;
    script.onload = safe(
      () => site.paperDoors.start(doors, { tier, drawn: adopt, failed: fail }),
      () => fail(null, "the drawing did not start"),
    );
    script.onerror = () => fail(null, "the drawing's script failed");
    document.head.appendChild(script);
  });

  function hold() {
    doors = document.getElementById("scene-doors");
    // No doors under reduced motion or forced colours (styles.css).
    if (!doors || doors.hidden || window.getComputedStyle?.(doors).display === "none") return;
    glows = Array.from(doors.querySelectorAll(".scene-doors__glow"));
    if (now() >= FAILSAFE_MS) {
      // The stylesheet is opening them already; let it, then take them off the page.
      state = "failsafe";
      window.setTimeout(hide, LEAVE_MS);
      return;
    }
    state = "held";
    doors.classList.add("is-held");

    // Only visible time counts toward the cap, read on the stylesheet's own clock, so the
    // cap always comes a second before the backstop it pauses with; where that clock
    // cannot be read, the script counts the visible time since it ran.
    let visible = document.hidden ? 0 : now();
    let last = now();
    const onVisibility = () => {
      doors.classList.toggle("is-paused", document.hidden === true);
      if (!document.hidden && state === "settling" && now() >= revealAt) part();
    };
    const tick = window.setInterval(() => {
      const at = now();
      if (!document.hidden) visible += at - last;
      last = at;
      if ((clock() ?? visible) >= CAP_MS) {
        // Functional preparation normally settles by 30s. This independent
        // escape also retires a stranded renderer before uncovering the title.
        const host = document.getElementById("home-scene");
        site.scene?.disposeHomeSceneRuntime?.();
        if (host) host.hidden = true;
        site.sceneLoader?.end?.("static");
        open("static");
      }
    }, TICK_MS);
    document.addEventListener("visibilitychange", onVisibility);
    onVisibility();

    const content = Array.from(document.querySelectorAll?.(".skip-link, main, footer") ?? []);
    const borrowed = content.map((element) => [element, element.inert]);
    for (const element of content) element.inert = true;
    cleanups.push(
      () => window.clearInterval(tick),
      () => document.removeEventListener("visibilitychange", onVisibility),
      () => borrowed.forEach(([element, inert]) => (element.inert = inert)),
    );
  }

  safe(hold)();

  site.sceneDoors = {
    open,
    light,
    upgrade,
    get state() {
      return state;
    },
    get closed() {
      return state === "held" || state === "settling";
    },
    get drawing() {
      return paper && typeof paper === "object" ? "drawn" : paper || failure || "none";
    },
  };
})();
