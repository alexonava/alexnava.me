// The prefers-reduced-motion query shared across UI modules.
//
// `reducedMotionQuery()` returns the live MediaQueryList so callers that
// need to react to the user toggling the OS setting mid-session can subscribe.
(() => {
  const site = (window.BabelSite = window.BabelSite || {});
  const shared = (site.shared = site.shared || {});

  function reducedMotionQuery() {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return null;
    }
    try {
      return window.matchMedia("(prefers-reduced-motion: reduce)");
    } catch {
      return null;
    }
  }

  shared.reducedMotionQuery = reducedMotionQuery;
})();
