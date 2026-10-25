// The opening's paper doors (#scene-doors in index.html).
//
// The doors are closed behind the identity and Contact at the first paint, before the page
// knows whether the live scene will load, and the stylesheet alone opens them after 4s,
// so a page whose scripts never run is never left behind them. Evaluated early (app.js
// runs this before main.js), the script holds them: the stylesheet's own opening moves out
// to an 11s backstop and pauses while the tab is hidden, and the script opens them after
// 10s of visible time at the latest. They part sooner at the scene's reveal and whenever
// the loading line retires (ui/scene-loader.js end()), and on every static path (main.js
// disableSceneHost()). Once open they leave the page (hidden) after their opening.
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
  const BACKSTOP_MS = 11000;
  const CAP_MS = 10000;
  const TICK_MS = 250;
  // Longer than the slowest opening.
  const LEAVE_MS = 2300;
  // The canvas's fade-in at the reveal (styles.css .scene-canvas); then how long frames
  // must run evenly (each under CALM_FRAME_MS) before the doors part, and the longest wait.
  const FADE_MS = 480;
  const CALM_MS = 200;
  const CALM_FRAME_MS = 50;
  const SETTLE_MS = 900;
  // The stylesheet's glow: its radius in star radii, and its least radius in CSS px.
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
    doors.hidden = true;
    state = "gone";
    drop();
  }

  const part = safe(() => {
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
    if (state !== "held") return;
    state = "open";
    release();
    if (reason === "revealed") settle(part);
    else part();
  });

  // At the reveal the scene fades in and does its first work (its lazy parts' builds and
  // shader compiles) behind the closed doors. They part once frames have run evenly for a
  // while, so the opening never stalls on that work, or after SETTLE_MS regardless.
  function settle(then) {
    let done = false;
    const go = () => {
      if (done) return;
      done = true;
      then();
    };
    const begin = now();
    let last = 0;
    let calm = 0;
    const step = (at) => {
      if (done) return;
      const gap = last ? at - last : 0;
      last = at;
      calm = gap > 0 && gap < CALM_FRAME_MS ? calm + gap : 0;
      if (calm >= CALM_MS || now() - begin >= FADE_MS + SETTLE_MS) return go();
      window.requestAnimationFrame(step);
    };
    window.setTimeout(() => {
      if (typeof window.requestAnimationFrame === "function") window.requestAnimationFrame(step);
      else go();
    }, FADE_MS);
    // Frames stop in a hidden tab: the doors then part when the timers say so.
    window.setTimeout(go, FADE_MS + SETTLE_MS + 400);
  }

  // The star through the paper: its CSS px and radius as the loading line has them, its
  // warmth (0 to 1) and the load's progress, which lights the seam.
  const light = safe(({ star = null, warm = 0, progress = 0 } = {}) => {
    if (state !== "held") return;
    lit = { star, warm, progress };
    if (paper && typeof paper === "object") safe(() => paper.light(lit), drop)();
    const level = Math.min(1, Math.max(0, Number(progress) || 0));
    doors.style.setProperty("--doors-light", String(Math.round(level * 1000) / 1000));
    const valid = star && [star.x, star.y, star.radius].every(Number.isFinite) && star.radius > 0;
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
    const onVisibility = () => doors.classList.toggle("is-paused", document.hidden === true);
    const tick = window.setInterval(() => {
      const at = now();
      if (!document.hidden) visible += at - last;
      last = at;
      if ((clock() ?? visible) >= CAP_MS) open("cap");
    }, TICK_MS);
    document.addEventListener("visibilitychange", onVisibility);
    onVisibility();
    cleanups.push(
      () => window.clearInterval(tick),
      () => document.removeEventListener("visibilitychange", onVisibility),
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
    get drawing() {
      return paper && typeof paper === "object" ? "drawn" : paper || failure || "none";
    },
  };
})();
