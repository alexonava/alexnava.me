(() => {
  const site = (window.BabelSite = window.BabelSite || {});
  const ui = (site.ui = site.ui || {});

  // The art the dialogs paint first: the estate map for the current media and
  // the paper's grain and edge. Their computed styles already name the build's
  // hashed URLs, so nothing here repeats a path.
  const DIALOG_ART = [
    [".estate-home-map .estate-map", "::before", "background-image"],
    [".panel-parchment__sheet", "::before", "background-image"],
    [".panel-parchment__sheet", "::after", "border-image-source"],
  ];
  const INTENT = ["pointerenter", "focusin", "touchstart"];
  const warming = [];
  let warmBound = false;

  // On the first sign of intent toward About, fetch that art into the cache so
  // the map and the paper open already painted. Once, and never under Save-Data.
  function warmDialogArtOnIntent(entry) {
    if (warmBound || typeof entry.addEventListener !== "function") return;
    warmBound = true;
    const warm = () => {
      INTENT.forEach((type) => entry.removeEventListener(type, warm));
      try {
        if (site.scene?.detectSaveData?.() === true) return;
        if (typeof window.getComputedStyle !== "function" || typeof window.Image !== "function")
          return;
        const urls = new Set();
        for (const [selector, pseudo, property] of DIALOG_ART) {
          const element = document.querySelector(selector);
          if (!element) continue;
          const value = window.getComputedStyle(element, pseudo).getPropertyValue(property);
          for (const [, url] of String(value).matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g))
            urls.add(url);
        }
        urls.forEach((url) => {
          const image = new window.Image();
          image.decoding = "async";
          image.src = url;
          warming.push(image);
        });
      } catch {
        // A courtesy only: the dialogs still load their own art when opened.
      }
    };
    INTENT.forEach((type) => entry.addEventListener(type, warm, { passive: true }));
  }

  ui.initSceneMenu = function initSceneMenu() {
    const entry = document.querySelector(".scene-entry");
    const fallback = Array.from(document.querySelectorAll("[data-scene-fallback]"));
    if (!entry || !fallback.length) return false;
    if (fallback.some((element) => element.contains(document.activeElement))) return false;
    try {
      if (ui.initPanels?.() !== true) return false;
    } catch {
      return false;
    }
    entry.hidden = false;
    fallback.forEach((element) => {
      element.hidden = true;
    });
    warmDialogArtOnIntent(entry);
    return true;
  };
})();
