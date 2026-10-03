// Anchored coordinate constants for the Three.js scene.
//
// Positions are feet-anchored. FLOOR_Y is the implicit y=0 reference; the
// procedural ground surface (scene.groundHeight) undulates around it. Every
// fixed spatial value below reads as an offset, distance or extent relative
// to this anchor.
//
// Vector-valued constants are frozen `[x, y, z]` arrays, not Vector3s: this
// file imports nothing (scene-entry.js imports it for its side effect, and
// tests run it in a bare vm context), so callers build the vector at use time,
// `new Vector3(...WORLD.SUN_POSITION)`.
(() => {
  const site = (window.BabelSite = window.BabelSite || {});
  const scene = (site.scene = site.scene || {});

  scene.WORLD = Object.freeze({
    // --- Ground plane ---
    // GROUND_RADIUS is the procedural ground's disc (index.js).
    FLOOR_Y: 0,
    GROUND_RADIUS: 88,

    // --- Sky & atmosphere ---
    // The sky shell's radius; the stars and the ranges take it too.
    SKY_DOME_RADIUS: 130,

    // --- Lights (positions are world-space, feet-anchored) ---
    // The baseline sky's glow direction: index.js normalizes it into
    // skyConfig.sunDirection, and the film sky replaces the glow. It points
    // along the moon key (index.js directionalPosition; hill-silhouette.test
    // holds them parallel) but is a separate constant: changing it does not
    // move the light.
    SUN_DIRECTION: Object.freeze([32, 28, 14]),
    // A lateral, cool back-fill keeps the tower readable against the night
    // sky without flattening the warm key light on its front-facing shell.
    // mud-ground.js MOON_LIGHTS restates it (ground.test holds them equal).
    FILL_LIGHT_POSITION: Object.freeze([-30, 22, -28]),

    // --- The star (the visible warm disc, solar-body.js; not a light) ---
    // Placed in open sky on the tower side of the field, clear of the tower's
    // silhouette. The watch frames it; every other tower shot shows it whole
    // or not at all, never behind geometry (framing.test). The light shafts'
    // star rays and the mountain shading read it too; it never moves per shot.
    SUN_POSITION: Object.freeze([-72.25, 50, -11.9]),

    // --- Main camera (PerspectiveCamera) ---
    // CAMERA_FOV is only the starting field of view: the composition profile
    // sets it on resize, and each directed shot sets its own.
    CAMERA_FOV: 45,
    CAMERA_NEAR: 0.1,
    CAMERA_FAR: 450,

    // --- The moon key's shadow frustum (orthographic, centred on its target) ---
    // The baseline keeps this extent; in film, rendering.js focusFilmShadow
    // narrows it to each shot.
    SHADOW_CAMERA_HALF_EXTENT: 60,
    SHADOW_CAMERA_NEAR: 1,
    SHADOW_CAMERA_FAR: 120,
  });
})();
