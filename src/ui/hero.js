(() => {
  const site = (window.BabelSite = window.BabelSite || {});
  const ui = (site.ui = site.ui || {});

  ui.initHeroChrome = function initHeroChrome() {
    const hero = document.getElementById("hero-minimal");
    if (!hero) return;

    const reduce = site.shared.reducedMotionQuery();

    let target = 0;
    let current = 0;
    let rafId = 0;
    // Cached so per-scroll computeTarget doesn't pay a layout-flushing read.
    let viewportHeight = window.innerHeight;

    function computeTarget() {
      const scrollY = window.scrollY || 0;
      return Math.min(scrollY / (0.58 * viewportHeight), 1);
    }

    function apply(progress) {
      hero.style.opacity = String(Math.max(0, 1 - 1.14 * progress));
      hero.style.transform = `translate3d(0, ${22 * progress}px, 0) scale(${1 - 0.025 * progress})`;
    }

    function tick() {
      rafId = 0;
      if (reduce?.matches) {
        current = 0;
        hero.style.opacity = "1";
        hero.style.transform = "none";
        return;
      }
      current += 0.16 * (target - current);
      if (Math.abs(target - current) < 0.001) {
        current = target;
        apply(current);
        return;
      }
      apply(current);
      rafId = requestAnimationFrame(tick);
    }

    function onScroll() {
      target = computeTarget();
      if (!rafId) rafId = requestAnimationFrame(tick);
    }

    onScroll();
    apply(current);

    window.addEventListener(
      "resize",
      () => {
        viewportHeight = window.innerHeight;
        onScroll();
      },
      { passive: true },
    );
    window.addEventListener("scroll", onScroll, { passive: true });
    reduce?.addEventListener("change", onScroll);
  };
})();
