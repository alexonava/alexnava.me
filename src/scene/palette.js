(() => {
  const site = (window.BabelSite = window.BabelSite || {});
  const scene = (site.scene = site.scene || {});

  // The procedural ground (textures.js) shown before the film slate's maps
  // arrive, or after they fail.
  scene.GROUND_TEXTURE_PALETTE = {
    baseColor: "#7c8290",
    bumpBase: "#5d6574",
    emberDustColor: "rgba(157, 89, 65, 0.16)",
    coolDustColor: "rgba(78, 91, 126, 0.14)",
    mossColor: "rgba(63, 72, 47, 0.18)",
    mossCore: "rgba(74, 83, 54, 0.22)",
  };

  scene.GROUND_SURFACE_MATERIAL = {
    color: 0x5d6574,
    // The default film slate: the same authored pair, tinted warm so that the
    // cool film light leaves it a dark grey near the classic ground's balance,
    // only slightly cool in moonlight and short of brown under the lantern.
    filmColor: 0x5c5048,
    roughness: 0.98,
    metalness: 0.02,
    bumpScale: 0.28,
  };
})();
