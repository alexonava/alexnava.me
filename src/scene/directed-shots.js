import { Box3, Vector3 } from "three";

// Heights and focal widths are proportions of the selected authored subject.
// Detail shots intentionally crop incidental roof/canopy geometry; fitting the
// entire horizontal slice would turn every portrait detail into a wide shot.
// hold: seconds the tour stays on a shot, cut to cut; tour=3|5|20 overrides it.
//
// Under the milky sky (the owner's direction of 2026-10-11: "make this more about the artsy
// background milky theme, with bigger than life close up scenes… one cohesive idea"): the
// tour is one film, its sky the subject. Every tour shot but one obeys the same grammar
// (GIANT, below): the lens stands low at the subject's foot and looks up, so on desktops the
// horizon, the plain and the ranges fall below the name and the painted banks fill the frame
// behind it; a wide lens close in makes the subject a giant, cut by the bottom edge and
// rising beside the name; every shot travels the same move, a dolly-in as the gaze lifts;
// no lens softens the sky. The aim stands high in the frame (anchor about a third down), so
// the subject hangs into it from above the lens and its low, far parts still fit. Portrait is
// the one wide shot (the owner's pick): the tree whole on the plain and the river, under the
// sky, on the same move. The watch and Threshold look toward the star (its maelstrom whole
// beside the lookout); the two lantern shots are macros, the lens just above the soil.
const GIANT_MOVE = Object.freeze({ dolly: Object.freeze([1.04, 0.94]), ease: 0.6 });
const GIANT = Object.freeze({
  fov: 44,
  height: 0.1,
  arc: 2,
  margin: 0.9,
  anchor: Object.freeze([0.6, 0.54]),
  move: GIANT_MOVE,
  tilt: Object.freeze([0, 2.5]),
});
// Short landscape phones keep a drift: no room about the name for a move. Each shot needs
// its own variant object (resolveDirectedShot caches by it).
const still = () => ({ move: null });
// After the rain (the owner's picks of 2026-10-09): every wide shot's plain
// catches the sky (Portrait's gloss, but untinted, so the plain keeps main's
// warmth) and a light, warm grey mist lies on the ranges' feet, so the plain
// meets them softly (mud-ground.js SLATE_LOOK).
const AFTER_RAIN = Object.freeze({
  mist: Object.freeze({ color: Object.freeze([0.27, 0.26, 0.29]), amount: 0.45 }),
  gloss: Object.freeze({ film: 0.32, gain: 1.9, cool: 0 }),
});
export const DIRECTED_SHOTS = {
  tower: [
    {
      name: "The watch",
      // The opener: the lookout from the foot of its legs, its cab and upper legs fitted
      // (region from 0.5), the lower legs leaving the frame; it faces the star (213 degrees),
      // so the star and its maelstrom stand whole between the lookout and the name. Its
      // flourish of the shared move is the dolly zoom: the lookout keeps its size while the
      // sky behind it swells.
      ...GIANT,
      move: { zoom: [44, 38], dollyZoom: true, ease: 0.6 },
      // The lookout is a dark shape against the sky (its key and fill dimmed, its moonlit
      // rim kept); far fires stay out of the shot (far-fires.js FAR_FIRES.shots).
      light: { key: 0.4, fill: 0.45, rim: 1.3 },
      region: [0.5, 1],
      targetHeight: 0.66,
      azimuth: 33,
      hold: 9,
      ground: { ...AFTER_RAIN, mist: { ...AFTER_RAIN.mist, amount: 0.75 } },
      // Portrait screens, narrower, tuck the star behind the lattice from that bearing: there
      // the lookout stands left of centre from further round, the star whole to its right.
      portrait: {
        azimuth: -12,
        anchor: [0.28, 0.54],
        margin: 0.88,
        focus: { width: 0.22, depth: [-0.3, 0.3] },
      },
      landscape: still(),
      compact: still(),
      // Squarish short windows: a little further round keeps the star clear of the cab.
      squat: { azimuth: 36, move: null },
    },
    {
      name: "Threshold",
      // Under the star too (the owner's pick of 2026-10-12): from round the lookout's other
      // shoulder, its timber pale in the moon behind the lens, the star and its maelstrom
      // beside it; the ladder on its +Z access side climbs the frame.
      ...GIANT,
      light: { fill: 0.8, rim: 1.8 },
      region: [0.5, 1],
      targetHeight: 0.66,
      azimuth: 46,
      hold: 7,
      anchor: [0.64, 0.54],
      ground: AFTER_RAIN,
      // Portrait screens keep the bearing; the star stays just out of their frame.
      portrait: { anchor: [0.5, 0.56], margin: 0.88, focus: { width: 0.22, depth: [-0.3, 0.3] } },
      // Landscape phones fit from a little higher up the lookout, so the legs' footing stays
      // below the short frame.
      landscape: { move: null, region: [0.56, 1], anchor: [0.64, 0.62] },
      squat: { azimuth: 52, move: null },
    },
    {
      // The name and URL are retained; for the timber lookout it is a
      // structure study of a corner leg and the X-braced lattice meeting it. From
      // azimuth 0 to 10 the camera faces the sun: on portrait phones it sits behind
      // the name, hidden only by the gallery floor. At -20 it is out of frame.
      name: "Masonry study",
      tour: false, // Retain its URL without including it in the tour.
      region: [0.3, 0.6],
      fov: 32,
      azimuth: -26,
      height: 0.4,
      arc: 1,
      focus: { width: 0.2, depth: [0.13, 0.36] },
      // Keeps the far corner leg off the right frame edge through its drift.
      margin: 0.87,
      ground: AFTER_RAIN,
      portrait: { focus: { width: 0.16, depth: [0.13, 0.36] } },
      // Its broken moonlight eases off behind About (light-shafts.js): with no
      // cel step or ink on the timber, a lit leg edge beside it on portrait
      // phones reached 4.83:1 at 390x844.
      shafts: { gobo: { about: 1 } },
    },
    {
      name: "Gallery detail",
      tour: false, // Too near Threshold's view to follow it; its URL is retained.
      // Gallery floor (0.77) to eave (0.93), seen across the corner between the
      // cabin's local +X plank panel and its back gable; the sun is about 60-85
      // degrees off the view axis. Facing that panel (azimuth -30) centred the
      // balanced tier's faceted reduction patch, which every phone sees; here the
      // panel falls oblique and into shade. Nearer -8 the sun showed between rails.
      // Ten degrees further round (-100) keeps the plank panel clear of the
      // intro's last words through the end-of-hold push-in on desktop and
      // landscape phones; portrait phones keep -90.
      region: [0.72, 0.94],
      fov: 31,
      azimuth: -100,
      height: 0.62,
      arc: 1,
      hold: 7,
      focus: { width: 0.27, depth: [0.13, 0.41] },
      margin: 0.91,
      portrait: { azimuth: -90, focus: { width: 0.2, depth: [0.13, 0.41] } },
      // Its broken moonlight eases off behind About (light-shafts.js), where
      // portrait phones see the lattice's lit leg edges (4.24:1 at 390x844).
      shafts: { gobo: { about: 1 } },
    },
    {
      name: "Watch and tree",
      tour: false, // Out of the tour (owner, 2026-10-08); its URL is retained.
      light: { key: 1.15, fill: 0.45, rim: 2.4 },
      move: { dolly: [1.04, 0.94], ease: 0.5 },
      // The one shot with both landmarks, side by side and apart: the lookout
      // whole left of the area's centre, the tree whole to its right, the star
      // high between the name and the lookout, a triangle of the three. Small
      // in a wide frame, so the plain is calmed (as Portrait's) and the camera
      // tilts up through the hold (tilt: degrees of pitch at the cut and at the
      // next), the range staying above the name. Further out, the cut opens on
      // the hard top-left edge of the cloud cover at these bearings.
      region: [0, 1],
      fov: 34,
      azimuth: 70,
      height: 0.2,
      arc: 2,
      hold: 7,
      // The fit holds its pitched poses, so its margins (0.76, and its variants') keep the
      // distance it had when its tilt came after the fit.
      margin: 0.76,
      anchor: [0.36, 0.62],
      tilt: [-6, -3],
      // Phones and portrait monitors keep the lookout on the left third and the
      // tree whole to its right (portrait monitors crop its farthest twigs); the
      // star is out of their view. Further out the cut opens on the cloud
      // cover's edge behind the lookout. Landscape phones turn a little
      // further round. Squat and the
      // smallest landscape windows, the name above the subject's left, see the
      // pair mirrored from across the plain: the tree left, the lookout right,
      // the star whole beyond it.
      portrait: { azimuth: 55, margin: 0.8, anchor: [0.21, 0.62], tilt: [-1, 2] },
      landscape: { azimuth: 75, margin: 0.76, anchor: [0.5, 0.55], tilt: [-3, 0], move: null },
      compact: { azimuth: -15, margin: 0.76, anchor: [0.6, 0.55], tilt: [-3, 0], move: null },
      squat: {
        azimuth: -15,
        margin: 0.8,
        anchor: [0.6, 0.55],
        tilt: [-5, 0],
        move: { dolly: [1.08, 0.94], ease: 0.5 },
      },
      ground: {
        burn: { amount: 0.45, reach: [0.3, 0.9] },
        flatten: 0.6,
        keep: [9, 20],
        ...AFTER_RAIN,
      },
    },
  ],
  tree: [
    {
      name: "Portrait",
      // The one wide shot (the owner's pick of 2026-10-12, "keep one wide shot"): the tree
      // whole on the plain and the river under the sky, low, on the shared move; no snow
      // stands behind the name. Phones set the tree on the lower third, open sky above it.
      portrait: {
        move: GIANT_MOVE,
        anchor: [0.5, 0.66],
        // Phones keep their open-sky framing: no tilt, the tree at its own size.
        margin: 0.93,
        tilt: null,
      },
      // The crown in moonlight (the owner's pick of 2026-10-09): its pale,
      // bleached limbs read cool grey, not pink-beige (pale). The
      // moon catches it its own way (shafts.gobo over the tree's,
      // light-shafts.js): barely wrapped, so it falls on the faces turned to
      // the moon and leaves the rest dark, with a strong cool silver catch on
      // the edges toward it. Its rays are the tree's own.
      light: { fill: 0.85, rim: 1.3, pale: 0.75 },
      shafts: { gobo: { color: [0.6, 0.78, 1.2], gain: 3.4, wrap: 0.1, rim: 5 } },
      move: GIANT_MOVE,
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
      // smaller (0.93 before) and the camera tilts up 3 degrees at the cut, 4 by the
      // end of the move, so more of the clouds stand over it; the aim starts a
      // little high, so the tilt keeps the whole tree inside the frame.
      margin: 0.82,
      anchor: [0.5, 0.42],
      tilt: [3, 4],
      ground: {
        burn: { amount: 0.45, reach: [0.4, 0.95] },
        flatten: 0.5,
        keep: [18, 34],
        clearing: {
          toward: 5,
          radius: [7, 34],
          light: [1.64, 1.72, 1.89],
          rest: 0.85,
          shade: [0.55, 22, 70],
        },
        mist: { color: [0.23, 0.26, 0.335], amount: 0.8 },
        gloss: { film: 0.32, gain: 1.9 },
        shadow: [12, 30],
      },
      landscape: still(),
    },
    {
      name: "Lantern study",
      // The lantern as a lighthouse: the lens just above the soil (clearance 0.25), a few units
      // off, looking up at the lantern alone against the sky, a branch over its cap; the tree
      // stands behind the lens's right shoulder (at 115 degrees a pale stone by the lens
      // filled the left of the frame).
      // Lantern-led, its bark's glints off the text: the lantern's glint on a
      // wet root beside the name at the end of the push-in (4.67:1 at
      // 1920x1080) passes the ground's knee (film-light.js GLINT). Its grass
      // reads its colour inside the blades (film-light.js GRASS_MOOD): a
      // rush's tip read past its edge, lit by the lantern, sparkled on the
      // name's top edge (4.19:1 at 1920x1080, phase 24.4 of the move). Its
      // stones' lamplight passes a knee behind the name and intro
      // (film-light.js STONE_TEXT): the lantern lit the near face of a stone
      // in the stream at the corner of the name's box (4.76:1 at 1440x900,
      // phase 32.35). Its pool is kept off About: on a portrait monitor the
      // push-in carries the pool's lit cobble crests across the label (3.92:1
      // at 1080x1920), so there the pool passes its knee (mud-ground.js
      // SLATE_LIGHT.poolKnee).
      light: {
        key: 0.55,
        fill: 0.65,
        lantern: 1.45,
        rim: 0.7,
        grassInside: 1,
        glintText: 1,
        stoneText: 1,
        poolAbout: 1,
      },
      ...GIANT,
      subject: "tree-lantern",
      region: [0.55, 1],
      targetHeight: 0.95,
      clearance: 0.25,
      azimuth: 100,
      hold: 6,
      anchor: [0.62, 0.32],
      ground: AFTER_RAIN,
      portrait: { anchor: [0.5, 0.36], margin: 0.95 },
      landscape: still(),
    },
    {
      name: "Close-up",
      // Rim-led, its rim off the text: at the start of the move the lit edges
      // of the limbs reaching left stood behind the name (3.97:1 at 1440x900),
      // and the trunk's behind About on phones and portrait monitors.
      light: { fill: 0.7, rim: 2, rimText: 1 },
      // Under the crown: the lens at the trunk's foot looks steeply up into the limbs, the
      // moon behind them (ideal backlight, its rims full), the brightest banks between. Only
      // the crown's core is fitted (focus): its outer limbs leave the frame; the far ones,
      // lowest on screen, are trimmed from the fit (depth) so the lens stands close.
      ...GIANT,
      region: [0.6, 1],
      targetHeight: 0.92,
      azimuth: -155,
      hold: 6,
      focus: { width: 0.35, depth: [-0.25, 0.15] },
      margin: 0.95,
      anchor: [0.6, 0.32],
      tilt: [0, 3],
      portrait: { focus: { width: 0.25, depth: [-0.25, 0.15] }, anchor: [0.5, 0.36] },
      landscape: still(),
    },
    {
      name: "Root and lantern",
      // The giant's foot: the same low lens beside the lantern, turned to the tree, the root
      // flare and trunk towering behind the lantern; round to -150 degrees the trunk stands
      // right of it and open sky behind the name.
      // The moon's glint on a wet root under the intro's end at the start of
      // the pull-back (4.32:1 at 1440x900) passes the ground's knee, and its
      // grass reads its colour inside the blades (film-light.js GRASS_MOOD),
      // as in Lantern study: a blade's tip read past its edge, lit by the
      // moon, sparkled under the intro (4.21:1 at 1440x900, phase 24.1 of the
      // move).
      light: { key: 0.6, fill: 0.75, lantern: 1.4, rim: 0.9, grassInside: 1, glintText: 1 },
      ...GIANT,
      subject: "tree-lantern",
      region: [0.4, 1],
      targetHeight: 0.95,
      clearance: 0.25,
      azimuth: -150,
      hold: 6,
      anchor: [0.66, 0.34],
      ground: AFTER_RAIN,
      // A little higher on portrait screens keeps the plain's far snow under a portrait
      // monitor's name.
      portrait: { anchor: [0.55, 0.34] },
      landscape: still(),
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
const variantShots = new WeakMap();
export function resolveDirectedShot(shot, width, height) {
  const short = height <= 500,
    squat = short && width > height && width < SQUAT_LANDSCAPE * height;
  const variant =
    shot.letterbox && letterboxShare(width, height) > 0
      ? shot.letterbox
      : squat && shot.squat
        ? shot.squat
        : height > width || isStackedLayout(width, height) || squat
          ? shot.portrait
          : short && ((width < 600 && shot.compact) || shot.landscape);
  if (!variant) return shot;
  let resolved = variantShots.get(variant);
  if (!resolved) variantShots.set(variant, (resolved = { ...shot, ...variant }));
  return resolved;
}

// Clip each triangle against the directed volume, retaining intersections rather
// than discarding large triangles whose vertices lie outside the crop. The same
// world-space points drive the fit and its regression checks on both asset tiers.
export function measureShot(root, shot) {
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
  traversalRoot.traverse((mesh) => {
    if (!mesh.isMesh || !mesh.visible || mesh.userData.excludeFromShot) return;
    const position = mesh.geometry.attributes.position,
      index = mesh.geometry.index;
    if (!position) return;
    const count = index ? index.count : position.count;
    for (let i = 0; i < count; i += 3) {
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
  });
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
// and aim sideways by a share of the distance (positive to the camera's left), and
// `zoom` sets the lens in degrees; with `dollyZoom` the distance follows the
// lens so the subject keeps its size while the background swells or sinks.
// `ease` (0-1) eases the travel in and out, keeping 1 - ease of the mean speed
// at the cuts, so the camera never stops. A shot's `tilt` ([from, to] degrees
// of pitch, positive up) travels with the move, on the same ease. Shots without
// a move keep the constant drift and the PUSH_IN dolly, their tilt linear.
export const MOVE_PHASES = Object.freeze([0, 0.25, 0.5, 0.75, 1]);
export function shotPose(shot, phase) {
  const move = shot.move,
    tiltAt = (e) => (shot.tilt ? shot.tilt[0] + (shot.tilt[1] - shot.tilt[0]) * e : 0);
  if (!move)
    return {
      yaw: (phase - 0.5) * shot.arc,
      scale: 1 - PUSH_IN * phase,
      crane: 0,
      truck: 0,
      fov: shot.fov,
      tilt: tiltAt(phase),
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
    tilt: tiltAt(e),
  };
}
// The poses a fit must hold: a move's sampled phases, or the drift's extremes
// (the 48-second breath without a tour swings the full arc either way, and
// its tilt breathes between both ends).
export function fitPoses(shot) {
  if (shot.move) return MOVE_PHASES.map((phase) => shotPose(shot, phase));
  const tilts = shot.tilt ? [...new Set(shot.tilt)] : [0];
  return [-shot.arc, 0, shot.arc].flatMap((yaw) =>
    tilts.map((tilt) => ({ yaw, scale: 1, crane: 0, truck: 0, fov: shot.fov, tilt })),
  );
}

// A shot's `anchor`: where its aim lands in the safe area, as shares of the
// area's width from its left edge and of its height from its top, so a subject
// can stand on a third rather than at the centre. The fit keeps the focal
// volume inside the area on every side of that point, its `tilt` included: the
// pitch turns the view about the camera after it looks at the aim.
export const CENTRE = Object.freeze([0.5, 0.5]);
export function shotAnchor(shot) {
  return shot.anchor ?? CENTRE;
}
// How far the lens stays above the soil along a shot's path: CLEARANCE, or a
// shot's own `clearance`, which may sit lower only for a close look up at a
// small prop.
export const CLEARANCE = 0.8;
export function shotClearance(shot) {
  return shot.clearance ?? CLEARANCE;
}

export function fitShot(measured, shot, area, width, height) {
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
      const x = measured.points[i] - measured.target.x,
        y = measured.points[i + 1] - measured.target.y,
        z = measured.points[i + 2] - measured.target.z;
      data[i] = -si * x + co * z;
      data[i + 1] = y;
      data[i + 2] = co * x + si * z;
    }
    projected.push(data);
  }
  const fits = (distance) => {
    for (let k = 0; k < poses.length; k++) {
      const { scale, crane, truck, tilt = 0 } = poses[k],
        [left, right, above, below] = limits[k],
        reach = distance * scale,
        rise = dy + crane * measured.height,
        side = truck * reach,
        length = Math.hypot(reach, rise),
        c = reach / length,
        s = rise / length,
        ct = Math.cos((tilt * Math.PI) / 180),
        st = Math.sin((tilt * Math.PI) / 180),
        points = projected[k];
      // Across is positive to the camera's left, up is positive upward; the
      // tilt pitches the view up about the camera's own horizontal axis.
      for (let i = 0; i < points.length; i += 3) {
        const level = length - points[i + 2] * c - points[i + 1] * s,
          rising = points[i + 1] * c - points[i + 2] * s,
          depth = level * ct + rising * st,
          across = points[i] - side,
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
  };
  let lo = 0.1,
    hi = Math.max(20, measured.height * 3);
  while (!fits(hi) && hi < 4096) hi *= 2;
  for (let i = 0; i < 22; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) hi = mid;
    else lo = mid;
  }
  return { distance: hi, radius: measured.radius, region: measured.region, area };
}
