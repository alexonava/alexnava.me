import { Box3, Vector3 } from "three";

// Heights and focal widths are proportions of the selected authored subject.
// Detail shots intentionally crop incidental roof/canopy geometry; fitting the
// entire horizontal slice would turn every portrait detail into a wide shot.
// hold: seconds the tour stays on a shot, cut to cut; tour=3|5|20 overrides it.
//
// Under the milky sky (the owner's direction of 2026-10-11: "make this more about the artsy
// background milky theme, with bigger than life close up scenes… one cohesive idea"): the
// tour alternates the sky over the watch and the tree by the water. The watch (GIANT, below)
// stands its lens low on the terrace and looks up, so on desktops the horizon, the plain and
// the ranges fall below the name and the painted banks fill the frame behind it, the star and
// its maelstrom whole beside the name, and travels a dolly zoom as the gaze lifts; no lens
// softens the sky. The lookout it was framed around is gone (the owner's call of 2026-10-20:
// "leave the tower out going forward"); it frames that lookout's stored outline
// (opening-star.js watchMeasure()), so the sky keeps the composition picked with it. The
// tree's shots keep their own framings, which show the plain, the river and the stream (the
// owner's call of 2026-10-12: "i liked the tree shots how they were. they showed the water
// more").
const GIANT_MOVE = Object.freeze({
  dolly: Object.freeze([1.04, 0.94]),
  tilt: Object.freeze([0, 2.5]),
  ease: 0.6,
});
const GIANT = Object.freeze({
  fov: 44,
  height: 0.1,
  arc: 2,
  margin: 0.9,
  anchor: Object.freeze([0.6, 0.54]),
  move: GIANT_MOVE,
});
// After the rain (the owner's picks of 2026-10-09): every wide shot's plain
// catches the sky (Portrait's gloss, but untinted, so the plain keeps main's
// warmth) and a light, warm grey mist lies on the ranges' feet, so the plain
// meets them softly (mud-ground.js SLATE_LOOK).
// After the rain, wetter since the owner pushed the look toward the Graphics concepts
// (2026-10-27): more of the film and water standing in the low spots,
// so the lantern, the sun and the sky lie in the ground (film 0.32, no pools before; film 0.5 and pools 0.6 at the first look).
const AFTER_RAIN = Object.freeze({
  mist: Object.freeze({ color: Object.freeze([0.27, 0.26, 0.29]), amount: 0.45 }),
  gloss: Object.freeze({ film: 0.65, gain: 1, cool: 0 }),
  pools: 0.8,
});
// Portrait on upright and squat screens: the tree on the lower third, open sky above it, at
// its own size (no tilt) and pushed in without the sideways truck. The tall frame reaches
// high into the sky, clear at the base's -72 degrees ("for this one the sky cannot be
// seen"), so it turns toward the banks (the owner's pick of 2026-10-14, -38, then -40).
const PORTRAIT_UPRIGHT = Object.freeze({
  move: Object.freeze({
    dolly: Object.freeze([1.06, 0.94]),
    crane: Object.freeze([0, 0.08]),
    ease: 0.6,
  }),
  margin: 0.93,
  tilt: null,
});
// Phones (the owner's rule of 2026-10-15: the lantern first): at -41.75 with a quarter-degree
// orbit, the tree a little left of centre, the camera looks from higher (0.38 of the tree's
// height, the base's 0.12 elsewhere) over the root at the lantern, so its glass and flame stand
// clear of the root through the whole push, the root's edge 2 CSS px or more below the flame
// (from 0.12 the root hid the foot and the lower glass all push and the flame lay on its edge
// at the start). No snow meets a side edge (orbiting on to -40.25 a far cap did at the end;
// further round a snowy horn meets the left edge, and from about -48 it rises behind the crown).
// The far range's small snowy tips (the backdrop rings' near 137 degrees) pass behind the trunk
// and the lower crown through the push: holding them off it would carry the lantern behind the
// root or the horn onto the edge. (An orbit of exactly 2 would also turn on the phone text
// band, which index.js gives arc-2 shots.)
const PORTRAIT_PHONE = Object.freeze({
  ...PORTRAIT_UPRIGHT,
  anchor: Object.freeze([0.39, 0.66]),
  margin: 0.97,
  height: 0.38,
  arc: 0.25,
  azimuth: -41.75,
});
// Its wider frames (tablets, portrait monitors, squat windows) reach further round either side
// of the tree, so they turn to -43.5 and orbit a degree, the tree right of centre: the snowy
// horn on the left stands whole inside the frame, its foot clear of the edge, and no other
// snow meets an edge through the push (from -40 their edges cut the horn or a summit on the
// right), the horn never reaches behind the crown (from about -44.5 it does), and the lantern
// stays clear; they keep the base's height and the upright fit. Squat windows stand half a
// degree nearer (-43) and a little left (0.58), so a far ring's snowy cap stays inside their
// right edge at the start (at -43.5 the edge cut it).
const PORTRAIT_WIDE = Object.freeze({
  azimuth: -43.5,
  arc: 1,
  anchor: Object.freeze([0.6, 0.66]),
  margin: 0.93,
  height: 0.12,
});
export const DIRECTED_SHOTS = {
  watch: [
    {
      name: "The watch",
      // The opener: the sky over the terrace, facing the star from the east (164 degrees), the
      // star and its maelstrom whole right of the frame's middle, the name in the open sky on
      // its left. Its region, focus, height and target height select the stored outline it
      // frames (opening-outline-key.js), the lookout's cab and upper legs, from the foot of
      // its legs. Its flourish is the dolly zoom (46 to 36 degrees on desktops, the owner's
      // pick of 2026-10-12): the sky and the star swell. (A longer tilt would make the fit
      // back off and lower the cut's look up on 4:3 screens.)
      ...GIANT,
      move: { zoom: [46, 36], dollyZoom: true, tilt: GIANT_MOVE.tilt, ease: 0.6 },
      // One night (the owner's pick of 2026-10-12): the key and fill dimmed; far fires stay
      // out of the shot (far-fires.js FAR_FIRES.shots).
      // Lit as the owner's Artistic set (2026-10-27, v3), toward Graphics.
      light: { key: 2.2, fill: 0.35 },
      region: [0.5, 1],
      targetHeight: 0.66,
      azimuth: -16,
      anchor: [0.45, 0.54],
      hold: 9,
      ground: { ...AFTER_RAIN, mist: { ...AFTER_RAIN.mist, amount: 0.75 } },
      // Portrait screens, narrower, aim left of centre, the star whole to its right, and keep
      // the gentler dolly zoom (the wider one crops the star there). Portrait monitors take it
      // as it is.
      portrait: {
        azimuth: -12,
        anchor: [0.28, 0.54],
        margin: 0.88,
        focus: { width: 0.22, depth: [-0.3, 0.3] },
        move: { zoom: [44, 38], dollyZoom: true, tilt: GIANT_MOVE.tilt, ease: 0.6 },
      },
      tablet: { anchor: [0.31, 0.54] },
      // Landscape phones fit a little higher, the short frame all sky.
      landscape: { move: null, region: [0.56, 1], anchor: [0.5, 0.62] },
      compact: { move: null, region: [0.56, 1], anchor: [0.5, 0.62] },
      // Squarish short windows aim further left, so the star stays whole inside the right edge.
      squat: { move: null, anchor: [0.35, 0.54] },
    },
  ],
  tree: [
    {
      name: "Portrait",
      // Phones set the tree on the lower third, open sky above it.
      portrait: PORTRAIT_PHONE,
      // Tablets, portrait monitors and squat windows turn a little further (PORTRAIT_WIDE).
      tablet: { ...PORTRAIT_WIDE },
      tall: { ...PORTRAIT_WIDE },
      squat: { ...PORTRAIT_UPRIGHT, ...PORTRAIT_WIDE, azimuth: -43, anchor: [0.58, 0.66] },
      // One night (2026-10-12): the lantern a little stronger at the trunk's
      // foot, leading into Lantern study.
      // Lit as the owner's Artistic set (2026-10-27, v3), toward Graphics.
      light: { key: 2.6, fill: 0.3, lantern: 1.2 },
      look: { tone: [1.6, 2, 0.3], ambient: 0.3, hemisphere: 0.4 },
      move: { truck: [-0.07, 0.07], crane: [0, 0.13], dolly: [1.05, 0.92], ease: 0.6 },
      // Low (0.12), so the plain ahead is foreshortened under the ranges, and
      // calmed: the near slate burned down, its texture and glints quietened
      // beyond the moonlit clearing about the tree (slateCalmFor()). The
      // owner's pick of 2026-10-08, all three (mud-ground.js SLATE_LOOK): the
      // clearing with its texture, the near plain in shade; a low mist over the
      // far plain and the ranges' feet; the plain after rain catching the sky
      // away from the text; the crown's shadow softening far out on the plain.
      // The crown stands against the clouds over bare near ranges: no snowy
      // massif rises behind it (mountain-build.js RANGE_PLACEMENTS).
      region: [0, 1],
      fov: 36,
      azimuth: -72,
      height: 0.12,
      arc: 4,
      hold: 9,
      // Sky first (the owner's pick of 2026-10-11, "A sky open"): the tree fits
      // smaller (0.93 before) so more of the clouds stand over it; the aim starts a
      // little high, so the tilt keeps the whole tree inside the frame. Water to sky
      // (the owner's pick of 2026-10-12): the camera opens tilted 1 degree down onto
      // the river and lifts 4 degrees up into the crown by the end of the move.
      margin: 0.82,
      anchor: [0.5, 0.42],
      tilt: [-1, 4],
      // The moon through a break in the cloud lights the plain about the tree;
      // beyond it the cloud's shadow takes the moon and leaves the sky's light
      // (photoreal, 2026-10-19: no staged light, burn or flattening).
      ground: {
        clearing: {
          toward: 5,
          radius: [7, 34],
          light: [1, 1, 1],
          rest: 0.55,
          shade: [0, 22, 70],
        },
        mist: { color: [0.23, 0.26, 0.335], amount: 0.8 },
        gloss: { film: 0.65, gain: 1, cool: 0 },
        shadow: [12, 30],
        // After the rain water stands on the plain in its low spots (the owner's ask of
        // 2026-10-23, "more reflection on the dirt", B Rain pools; mud-ground.js SLATE_LOOK.pools).
        pools: 0.85,
      },
      // Landscape phones keep the drift: no room about the name for a move.
      landscape: { move: null },
    },
    {
      name: "Lantern study",
      // Its grass stands (index.js): the other shots leave the plain bare.
      growth: true,
      // Lantern-led, its bark's glints off the text: the lantern's glint on a
      // wet root beside the name at the end of the push-in (4.67:1 at
      // 1920x1080) passes the ground's knee (film-light.js GLINT). Its grass
      // reads its colour inside the blades (film-light.js GRASS_MOOD): a
      // rush's tip read past its edge, lit by the lantern, sparkled on the
      // name's top edge (4.19:1 at 1920x1080, phase 24.4 of the move). Its
      // stones' lamplight passes a knee behind the name and intro
      // (film-light.js STONE_TEXT): the lantern lit the near face of a stone
      // in the stream at the corner of the name's box (4.76:1 at 1440x900,
      // phase 32.35). Its pool is kept off Contact: on a portrait monitor the
      // push-in carries the pool's lit cobble crests across the label (3.92:1
      // at 1080x1920), so there the pool passes its knee (mud-ground.js
      // SLATE_LIGHT.poolKnee). One night (2026-10-12): less of the frontal fill,
      // so the lantern models the scene and the moon's backlight separates the
      // trunk; the lantern at the tree shots' one level, 1.4.
      // Lit as the owner's Artistic set (2026-10-27, v3), toward Graphics.
      light: {
        key: 2.2,
        fill: 0.35,
        lantern: 1.4,
        grassInside: 1,
        glintText: 1,
        stoneText: 1,
        poolAbout: 1,
      },
      // The water nearer the lens than the lantern softens only a quarter as much, so the
      // river's ripples, the stream's froth and the lantern's glints read moving at the start
      // of the push-in (the owner's pick of 2026-10-23: "in the third shot it isnt flowing").
      lens: { blur: 8, near: 0.35 },
      // From the water up to the flame: the push-in lifts from the river (its image of the
      // lantern) to the flame (the owner's pick of 2026-10-12).
      move: { dolly: [1.2, 0.85], tilt: [-1.5, 0], ease: 0.6 },
      subject: "tree-lantern",
      // Across the river, a little round from the -115° axis and with the
      // lantern right of the area's centre, so less of the root flare stands
      // behind the name at the end of the push-in. Phones keep that axis.
      region: [0, 1],
      fov: 34,
      azimuth: -125,
      height: 0.62,
      arc: 2,
      hold: 6,
      margin: 0.7,
      anchor: [0.56, 0.5],
      ground: AFTER_RAIN,
      landscape: { move: null, azimuth: -115, anchor: [0.5, 0.5] },
      // Phones fit it wider and aim up and right, so the lantern and the root arching over
      // it both stand in the frame (the owner's ask of 2026-10-27).
      portrait: {
        move: { dolly: [1.1, 0.9], tilt: [-1.5, 0], ease: 0.6 },
        azimuth: -115,
        margin: 0.5,
        anchor: [0.62, 0.62],
      },
    },
    {
      name: "Close-up",
      // One night (2026-10-12): a pure backlight, less frontal fill. Its twigs'
      // glints off the intro (glintText): a one-pixel sparkle behind it set the
      // small window's intro at 5.25:1 (599x499, the re-review of 2026-10-15).
      // Lit as the owner's Artistic set (2026-10-27, v3), toward Graphics. The sun behind the crown;
      // the limbs are lit from the front by the fill.
      light: { key: 2.8, fill: 2.9, glintText: 1 },
      look: { tone: [1.9, 1.95, 0.3], ambient: 0.7, hemisphere: 0.9 },
      // Its own sun (the owner's pick of 2026-10-27, "use the sun instead"): low behind the
      // crown's right, the key coming from it, the cel sky lit from there (rendering.js
      // setShotSun(), cloud-plate.js).
      sun: { at: [0.9, 0.35, 0.16], plate: "close-up" },
      // The low sun catches the branches from the lens's side (the owner's reference of
      // 2026-10-27): a warm fill from the upper left, over the film's cool one (rendering.js
      // setShotFill()).
      fill: { at: [-0.41, 0.27, -0.87], color: [1, 0.72, 0.44], gain: 4.5 },
      // No lens blur: the clouds behind the crown read sharp (sky first, below). A tracking
      // pan (the owner's pick of 2026-10-12): the camera slides to its left while the lens
      // turns to hold the crown, so the limbs slide across the clouds behind it.
      move: { truck: [-0.1, 0.1], pan: [-2, 2], ease: 0.5 },
      // The crown: low under the fork high on the trunk, looking up at the
      // limbs against the sky, open sky beside the name.
      region: [0.5, 0.78],
      fov: 32,
      azimuth: -155,
      height: 0.28,
      arc: 2,
      hold: 6,
      focus: { width: 0.32, depth: [-0.15, 0.2] },
      // Sky first (the owner's pick of 2026-10-11, "A sky open"): the crown fits
      // smaller (0.92 before; phones keep it, or the roots enter their frame) and the
      // lens no longer softens the sky.
      margin: 0.8,
      anchor: [0.58, 0.45],
      // Phones push in: a sideways truck this close takes the lens into the
      // trunk. Their aim sits a little high, which lifts the far range's snow
      // clear above the name on portrait monitors.
      portrait: {
        focus: { width: 0.26, depth: [-0.15, 0.2] },
        anchor: [0.5, 0.4],
        move: { dolly: [1.1, 0.94], ease: 0.5 },
        margin: 0.92,
      },
      // Landscape phones keep the drift (no room about the name for a move),
      // from higher, so the roots stay below the short frame.
      landscape: { move: null, margin: 0.83, height: 0.5, anchor: [0.5, 0.5] },
      // Portrait monitors, the name below the subject: turned 15.5 degrees, the trunk a little
      // larger and right of centre, seen from higher (0.46) and aimed lower, so the trunk keeps
      // 25 CSS px or more off the name and the intro through the push (from -162 at the centre
      // it crossed "ex" and "va" by the end; at -166 the intro's last word met it), the roots
      // and lantern stay below the frame, and the ranges stand wholly above the name, the text
      // on the plain below their feet (from 0.28 a crag's crest ran through "Alex" and their
      // feet behind "Nava").
      tall: { azimuth: -170.5, anchor: [0.6, 0.555], height: 0.46, margin: 0.96 },
    },
    {
      name: "Root and lantern",
      // It pulls back and lifts toward the river behind the trunk (the owner's pick of
      // 2026-10-12).
      move: { dolly: [0.86, 1.05], crane: [0, 0.05], tilt: [-2, 1.5], ease: 0.6 },
      // The moon's glint on a wet root under the intro's end at the start of
      // the pull-back (4.32:1 at 1440x900) passes the ground's knee, and its
      // grass reads its colour inside the blades (film-light.js GRASS_MOOD),
      // as in Lantern study: a blade's tip read past its edge, lit by the
      // moon, sparkled under the intro (4.21:1 at 1440x900, phase 24.1 of the
      // move).
      // One night (2026-10-12): less of the frontal fill, as in Lantern study.
      // Lit as the owner's Artistic set (2026-10-27, v3), toward Graphics.
      light: { key: 2.2, fill: 0.35, lantern: 1.4, grassInside: 1, glintText: 1 },
      // Its own sun (2026-10-27): setting over the river behind the trunk.
      sun: { at: [0.699, 0.085, 0.71], plate: "root-and-lantern" },
      lens: { blur: 6, near: 0.35 },
      // Round from the -115° axis, so the trunk stands right of centre and
      // the lantern on the right third, the plain behind the name; the aim
      // sits low, which keeps the ranges under the top edge's open band.
      // Phones set the lantern low on that third.
      region: [0, 0.16],
      fov: 32,
      azimuth: -120,
      height: 0.14,
      arc: 1,
      hold: 6,
      focus: { width: 0.3, depth: [-0.1, 0.32] },
      margin: 0.91,
      anchor: [0.52, 0.64],
      ground: AFTER_RAIN,
      portrait: {
        focus: { width: 0.25, depth: [-0.1, 0.32] },
        anchor: [0.55, 0.66],
        move: { dolly: [0.92, 1.06], ease: 0.6 },
      },
      // Landscape phones keep the drift (no room about the name for a move)
      // and the -115° axis.
      landscape: { move: null, azimuth: -115, anchor: [0.5, 0.5] },
    },
  ],
};

// Whether the name stacks above the subject. It follows styles.css, where the
// hero tops portrait screens (squares included) up to 1024px wide and landscape
// ones up to 760px wide or 500px tall. Of those, landscape screens up to 500px
// tall (phones turned sideways, of any width) or from 600px wide frame the
// subject beside the name. Elsewhere the hero sits bottom-left: beside the
// subject on desktops, below it on portrait monitors (cinematicSafeArea).
export function isStackedLayout(width, height) {
  return height >= width ? width <= 1024 : width < 600 && height > 500;
}

// Each portrait or short-landscape variant is built once, so a shot and
// orientation always resolve to the same object: the cinematic camera keys its
// measurements and fits on it. Tall canvases and stacked layouts take the
// portrait variant, wherever the name sits, and so do landscape screens up to
// 500px tall (the hero's own short-landscape breakpoint) narrower than
// SQUAT_LANDSCAPE: on those squarish windows the wide variants push the sun out
// past the right edge. Wider ones up to 500px tall, every landscape phone among
// them, take the landscape variant, or the compact one under 600px wide. A
// shot may give those squat windows a `squat` variant of their own instead.
export const SQUAT_LANDSCAPE = 1.55;
// Widescreen bars on landscape screens from 1000px wide and over 500px tall
// (short landscapes keep their own variants): the frame is cut to
// LETTERBOX.ratio, each bar a share of the height, none under 2% of it. A shot
// may give those letterboxed windows a `letterbox` variant of its own.
export const LETTERBOX = Object.freeze({ ratio: 2.39, minWidth: 1000 });
export function letterboxShare(width, height) {
  if (
    isStackedLayout(width, height) ||
    height > width ||
    height <= 500 ||
    width < LETTERBOX.minWidth
  )
    return 0;
  const share = (height - width / LETTERBOX.ratio) / (2 * height);
  return share > 0.02 ? share : 0;
}
// Stacked layouts from this width (portrait tablets, and squares up to 1024px wide)
// may take a shot's `tablet` variant over its portrait one: their frame is wider than
// a phone's, so it reaches further round either side of the subject.
export const TABLET_WIDTH = 600;
const variantShots = new WeakMap();
export function resolveDirectedShot(shot, width, height) {
  const short = height <= 500,
    squat = short && width > height && width < SQUAT_LANDSCAPE * height,
    stacked = isStackedLayout(width, height);
  // Portrait monitors (taller than wide, too wide to stack the hero) set the name
  // below the subject, where phones set it above: a shot's `tall` variant, over its
  // portrait one, reframes them alone. Tablets, the hero stacked above the subject as
  // on phones, may take a `tablet` variant over the portrait one too.
  const tall = shot.tall && height > width && !stacked,
    tablet = shot.tablet && stacked && width >= TABLET_WIDTH;
  const variant =
    shot.letterbox && letterboxShare(width, height) > 0
      ? shot.letterbox
      : squat && shot.squat
        ? shot.squat
        : tall
          ? shot.tall
          : tablet
            ? shot.tablet
            : height > width || stacked || squat
              ? shot.portrait
              : short && ((width < 600 && shot.compact) || shot.landscape);
  if (!variant) return shot;
  let resolved = variantShots.get(variant);
  if (!resolved)
    variantShots.set(
      variant,
      (resolved =
        tall || tablet ? { ...shot, ...shot.portrait, ...variant } : { ...shot, ...variant }),
    );
  return resolved;
}

// Clip each triangle against the directed volume, retaining intersections rather
// than discarding large triangles whose vertices lie outside the crop. The same
// world-space points drive the fit and its regression checks on both asset tiers.
// Synchronous callers and cooperative preparation drain the same arithmetic.
export function finishShotSteps(steps) {
  for (;;) {
    const next = steps.next();
    if (next.done) return next.value;
  }
}
export function measureShot(root, shot) {
  return finishShotSteps(measureShotSteps(root, shot));
}
export function* measureShotSteps(root, shot) {
  root.updateWorldMatrix(true, true);
  const subject =
    (shot.subject && root.getObjectByName(shot.subject)) ||
    root.getObjectByName("meshy-tree") ||
    root;
  const box = new Box3();
  // Decoration parented to a subject inherits its scale; flagged
  // excludeFromShot, it never enlarges the focal bounds or the clipped fit.
  subject.traverse((mesh) => {
    if (!mesh.isMesh || !mesh.visible || mesh.userData.excludeFromShot) return;
    mesh.geometry.computeBoundingBox();
    box.union(mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld));
  });
  const height = box.max.y - box.min.y;
  if (!Number.isFinite(height) || height <= 0) throw new Error("Empty cinematic subject");
  // A subject set into the soil (prop-scale.js sinks the tree) is framed from
  // the soil line, as before it sank: the camera keeps its height above the
  // ground and the lantern its place in the frame; the buried toe never counts.
  const footing = box.min.y + (subject.userData.sunk ?? 0);
  const lo = footing + height * shot.region[0];
  const hi = footing + height * shot.region[1];
  const center = box.getCenter(new Vector3());
  const yaw = (shot.azimuth * Math.PI) / 180;
  const right = new Vector3(-Math.sin(yaw), 0, Math.cos(yaw));
  const front = new Vector3(Math.cos(yaw), 0, Math.sin(yaw));
  const planes = [
    { normal: new Vector3(0, 1, 0), limit: hi },
    { normal: new Vector3(0, -1, 0), limit: -lo },
  ];
  if (shot.focus) {
    const halfWidth = (shot.focus.width * height) / 2;
    planes.push(
      { normal: right, limit: center.dot(right) + halfWidth },
      { normal: right.clone().negate(), limit: -center.dot(right) + halfWidth },
      { normal: front, limit: center.dot(front) + shot.focus.depth[1] * height },
      { normal: front.clone().negate(), limit: -center.dot(front) - shot.focus.depth[0] * height },
    );
  }
  const points = [],
    region = new Box3();
  const a = new Vector3(),
    b = new Vector3(),
    c = new Vector3();
  // A selected prop is measured on its own. Other shots include surrounding
  // meshes within the volume (notably the lantern in Root and lantern).
  const traversalRoot = shot.subject ? subject : root;
  const meshes = [];
  traversalRoot.traverse((mesh) => meshes.push(mesh));
  for (const mesh of meshes) {
    if (!mesh.isMesh || !mesh.visible || mesh.userData.excludeFromShot) continue;
    const position = mesh.geometry.attributes.position,
      index = mesh.geometry.index;
    if (!position) continue;
    const count = index ? index.count : position.count;
    for (let i = 0; i < count; i += 3) {
      if (i % 384 === 0) yield;
      const vertices = [a, b, c];
      vertices.forEach((p, k) =>
        p
          .fromBufferAttribute(position, index ? index.getX(i + k) : i + k)
          .applyMatrix4(mesh.matrixWorld),
      );
      let polygon = vertices;
      for (const { normal, limit } of planes) {
        const clipped = [];
        for (let j = 0; j < polygon.length; j++) {
          const p = polygon[j],
            q = polygon[(j + 1) % polygon.length];
          const d = p.dot(normal) - limit,
            next = q.dot(normal) - limit;
          if (d <= 0) clipped.push(p);
          if ((d < 0 && next > 0) || (d > 0 && next < 0))
            clipped.push(p.clone().lerp(q, d / (d - next)));
        }
        polygon = clipped;
        if (!polygon.length) break;
      }
      for (const p of polygon) {
        points.push(p.x, p.y, p.z);
        region.expandByPoint(p);
      }
    }
  }
  if (!points.length) throw new Error("Empty cinematic focal region");
  const target = region.getCenter(new Vector3());
  target.y = footing + height * (shot.targetHeight ?? (shot.region[0] + shot.region[1]) / 2);
  return {
    points: new Float32Array(points),
    target,
    cameraY: footing + shot.height * height,
    footing,
    groundAnchor: subject.getWorldPosition(new Vector3()),
    height,
    region,
    radius: region.getSize(new Vector3()).length() / 2,
  };
}

// Largest dolly-in fraction of the fitted distance within one shot.
export const PUSH_IN = 0.045;

// A shot's `move`: its camera travels through the hold, each part a [from, to]
// pair from the cut to the next. `dolly` scales the fitted distance, `crane`
// raises the camera by a share of the subject's height, `truck` slides camera
// and aim sideways by a share of the distance (positive to the camera's left),
// `zoom` sets the lens in degrees; with `dollyZoom` the distance follows the
// lens so the subject keeps its size while the background swells or sinks;
// `tilt` pitches the camera in degrees (positive up) about its own horizontal
// axis; and `pan` turns it in place in degrees (positive to the right), the
// camera standing still while the view sweeps across the sky and the plain.
// The fit holds both. `ease` (0-1) eases the travel in and out, keeping
// 1 - ease of the mean speed at the cuts, so the camera never stops. Shots
// without a move keep the constant drift and the PUSH_IN dolly.
export const MOVE_PHASES = Object.freeze([0, 0.25, 0.5, 0.75, 1]);
export function shotPose(shot, phase) {
  const move = shot.move;
  if (!move)
    return {
      yaw: (phase - 0.5) * shot.arc,
      scale: 1 - PUSH_IN * phase,
      crane: 0,
      truck: 0,
      fov: shot.fov,
      tilt: 0,
      pan: 0,
    };
  const ease = move.ease ?? 0,
    e = phase + ease * (phase * phase * (3 - 2 * phase) - phase),
    along = (pair, rest) => (pair ? pair[0] + (pair[1] - pair[0]) * e : rest);
  const fov = along(move.zoom, shot.fov);
  let scale = along(move.dolly, 1);
  if (move.dollyZoom && move.zoom)
    scale *= Math.tan((move.zoom[0] * Math.PI) / 360) / Math.tan((fov * Math.PI) / 360);
  return {
    yaw: (e - 0.5) * shot.arc,
    scale,
    crane: along(move.crane, 0),
    truck: along(move.truck, 0),
    fov,
    tilt: along(move.tilt, 0),
    pan: along(move.pan, 0),
  };
}
// The poses a fit must hold: a move's sampled phases, or the drift's extremes
// (the 48-second breath without a tour swings the full arc either way).
export function fitPoses(shot) {
  return shot.move
    ? MOVE_PHASES.map((phase) => shotPose(shot, phase))
    : [-shot.arc, 0, shot.arc].map((yaw) => ({
        yaw,
        scale: 1,
        crane: 0,
        truck: 0,
        fov: shot.fov,
        tilt: 0,
        pan: 0,
      }));
}

// A shot's `anchor`: where its aim lands in the safe area, as shares of the
// area's width from its left edge and of its height from its top, so a subject
// can stand on a third rather than at the centre. The fit keeps the focal
// volume inside the area on every side of that point, a move's tilt and pan
// included: the pan turns the view about the camera before it looks at the
// aim, the pitch after. A
// shot's own `tilt` pitches the camera after the fit, moving the aim off its
// anchor; leave margin for it.
export const CENTRE = Object.freeze([0.5, 0.5]);
export function shotAnchor(shot) {
  return shot.anchor ?? CENTRE;
}

export function fitShot(measured, shot, area, width, height) {
  return finishShotSteps(fitShotSteps(measured, shot, area, width, height));
}
export function* fitShotSteps(measured, shot, area, width, height) {
  const aspect = width / height,
    margin = shot.margin ?? 0.85,
    [across, down] = shotAnchor(shot),
    poses = fitPoses(shot);
  // Per pose, the slopes the focal volume may reach from the aim: to the left
  // and right of it, then above and below it.
  const limits = poses.map(({ fov }) => {
    const tan = Math.tan((fov * Math.PI) / 360),
      wide = ((2 * tan * aspect * area.width) / width) * margin,
      tall = ((2 * tan * area.height) / height) * margin;
    return [wide * across, wide * (1 - across), tall * down, tall * (1 - down)];
  });
  const dy = measured.cameraY - measured.target.y;
  const projected = [];
  for (const { yaw: offset } of poses) {
    const yaw = ((shot.azimuth + offset) * Math.PI) / 180,
      co = Math.cos(yaw),
      si = Math.sin(yaw);
    const data = new Float32Array(measured.points.length);
    for (let i = 0; i < data.length; i += 3) {
      if (i % 768 === 0) yield;
      const x = measured.points[i] - measured.target.x,
        y = measured.points[i + 1] - measured.target.y,
        z = measured.points[i + 2] - measured.target.z;
      data[i] = -si * x + co * z;
      data[i + 1] = y;
      data[i + 2] = co * x + si * z;
    }
    projected.push(data);
  }
  function* fits(distance) {
    for (let k = 0; k < poses.length; k++) {
      const { scale, crane, truck, tilt = 0, pan = 0 } = poses[k],
        [left, right, above, below] = limits[k],
        reach = distance * scale,
        rise = dy + crane * measured.height,
        side = truck * reach,
        length = Math.hypot(reach, rise),
        c = reach / length,
        s = rise / length,
        ct = Math.cos((tilt * Math.PI) / 180),
        st = Math.sin((tilt * Math.PI) / 180),
        cp = Math.cos((pan * Math.PI) / 180),
        sp = Math.sin((pan * Math.PI) / 180),
        points = projected[k];
      // Across is positive to the camera's left, up is positive upward; the
      // pan turns the view right about the camera's vertical axis, then the
      // tilt pitches it up about its own horizontal axis. Without a pan the
      // arithmetic is the unpanned form exactly.
      for (let i = 0; i < points.length; i += 3) {
        if (i % 384 === 0) yield;
        let level, rising, across;
        if (pan) {
          const ahead = reach - points[i + 2],
            aside = points[i] - side,
            forward = ahead * cp - aside * sp,
            y = points[i + 1] - rise;
          across = aside * cp + ahead * sp;
          level = forward * c - y * s;
          rising = y * c + forward * s;
        } else {
          level = length - points[i + 2] * c - points[i + 1] * s;
          rising = points[i + 1] * c - points[i + 2] * s;
          across = points[i] - side;
        }
        const depth = level * ct + rising * st,
          up = rising * ct - level * st;
        if (
          depth <= 0.1 ||
          across > left * depth ||
          -across > right * depth ||
          up > above * depth ||
          -up > below * depth
        )
          return false;
      }
    }
    return true;
  }
  let lo = 0.1,
    hi = Math.max(20, measured.height * 3);
  while (!(yield* fits(hi)) && hi < 4096) hi *= 2;
  for (let i = 0; i < 22; i++) {
    const mid = (lo + hi) / 2;
    if (yield* fits(mid)) hi = mid;
    else lo = mid;
  }
  return { distance: hi, radius: measured.radius, region: measured.region, area };
}
