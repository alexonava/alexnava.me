// Anchored coordinate constants for the Three.js scene.
//
// Convention (ported from dead-signal-3d-draft): positions are feet-anchored.
// FLOOR_Y is the implicit y=0 reference; the procedural ground surface
// (scene.groundHeight) undulates around it. Every fixed spatial value below
// ought to read as an offset, distance, or extent relative to this anchor.
//
// Vector-valued constants are stored as `[x, y, z]` arrays (not THREE.Vector3)
// because the scene IIFEs execute at page load — before three.min.js is
// injected by main.js. Callers construct the Vector3 at use time with
// `new THREE.Vector3(...scene.WORLD.SUN_POSITION)`.
(() => {
  const site = (window.BabelSite = window.BabelSite || {});
  const scene = (site.scene = site.scene || {});

  scene.WORLD = Object.freeze({
    // --- Ground plane ---
    FLOOR_Y: 0,
    GROUND_RADIUS: 88,
    GROUND_OVERLAY_RADIUS: 70,

    // --- Sky & atmosphere ---
    SKY_DOME_RADIUS: 130,

    // --- Lights (positions are world-space, feet-anchored) ---
    // The sky shader reads SUN_DIRECTION as a normalized direction vector;
    // callers must `.normalize()` after construction.
    SUN_DIRECTION: Object.freeze([32, 28, 14]),
    // A lateral, cool back-fill keeps the tower readable against the night
    // sky without flattening the warm key light on its front-facing shell.
    FILL_LIGHT_POSITION: Object.freeze([-30, 22, -28]),

    // --- Sun / orbital glow anchor ---
    // Placed in open sky on the tower side of the field, clear of both the
    // tower silhouette and the tree canopy, so the directed shots that look
    // this way frame it against empty night rather than behind geometry.
    // Shared by The watch and Gallery detail; never moved per shot.
    SUN_POSITION: Object.freeze([-72.25, 50, -11.9]),

    // --- Main camera (PerspectiveCamera) ---
    CAMERA_FOV: 45,
    CAMERA_NEAR: 0.1,
    CAMERA_FAR: 450,

    // --- Sun shadow frustum (orthographic, symmetric around the scene) ---
    SHADOW_CAMERA_HALF_EXTENT: 60,
    SHADOW_CAMERA_NEAR: 1,
    SHADOW_CAMERA_FAR: 120,

    // --- Developer mode (first-person grounded character) ---
    // Constants ported from the standing. project's character controller
    // (apps/activity-client/src/scene/runtime.ts) and converted yards -> feet
    // (x3) to match babel's world units.
    DEV_MODE: Object.freeze({
      RUN_SPEED: 21, // ft/s forward, was 7 yd/s in standing.
      BACK_SPEED: 13.5, // ft/s, was 4.5 yd/s
      STRAFE_SPEED: 21, // ft/s, was 7 yd/s
      GRAVITY: 32, // ft/s^2, was 10.6 yd/s^2 — close to Earth (32.2)
      JUMP_VY: 17, // ft/s initial, was 5.64 yd/s — apex ~4.5 ft
      EYE_HEIGHT: 4.86, // ft from feet to eye, was 1.62 yd
      MOUSE_SENSITIVITY: 0.005, // standing.-tuned drag-look rate
      PITCH_LIMIT: 1.55, // rad, ~89 degrees
    }),
  });
})();
