import { Box3, Vector3 } from "three";

// Heights and focal widths are proportions of the selected authored subject.
// Detail shots intentionally crop incidental roof/canopy geometry; fitting the
// entire horizontal slice would turn every portrait detail into a wide shot.
// hold: seconds the tour stays on a shot, cut to cut; tour=3|5|20 overrides it.
export const DIRECTED_SHOTS = {
  tower: [
    {
      name: "The watch",
      letterbox: { height: 0.8, targetHeight: 0.82 },
      move: { zoom: [32, 26], dollyZoom: true, ease: 0.6 },
      light: { key: 1.2, fill: 0.85, rim: 1 },
      // The slimmer timber lookout fits closer than the stone tower did, so its roof
      // reached the fixed sun on desktop. A wider, slightly higher view three
      // degrees round restores the camera distance and sky gap. Higher than 0.68
      // pushes the sun against the top edge on landscape phones; portrait is unchanged.
      // Two more degrees round (-9) keep the sun clear of the eave corner through
      // the end-of-hold push-in on desktop and landscape phones.
      region: [0.5, 1],
      fov: 32,
      azimuth: -9,
      height: 0.68,
      arc: 2,
      hold: 9,
      portrait: { region: [0.62, 1], targetHeight: 1.11, azimuth: -4, height: 0.66 },
      // Landscape phones hold the intro over the upper third, where the snowy
      // range projected; lower and further round, it runs between text and tower.
      landscape: {
        height: 0.55,
        azimuth: -12,
        move: null,
      },
      // Under 600px wide the intro spans nearly half the screen and the range
      // still met its last line at 0.55; lower again, it runs below the intro.
      compact: {
        height: 0.4,
        azimuth: -12,
        move: null,
      },
    },
    {
      name: "Threshold",
      move: { crane: [-0.18, 0.1], dolly: [1.06, 0.94], ease: 0.6 },
      light: { fill: 0.8, rim: 1.8 },
      lens: { blur: 5 },
      // The lookout's threshold: the ladder on its +Z access side arriving
      // through the gap in the gallery railing. Nearer the ladder's face than 82
      // degrees brings the sun behind the name on landscape phones. The region
      // is raised to 0.64-0.93 so the gable apex keeps headroom under the top
      // edge through the end-of-hold push-in on desktop and landscape phones;
      // portrait phones, which had that headroom, keep 0.62-0.90.
      // A little left of and below the area's centre, so the gallery's far
      // corner and the gable apex clear the right and top edges rather than
      // grazing them.
      region: [0.64, 0.93],
      fov: 36,
      azimuth: 86,
      height: 0.5,
      arc: 2,
      hold: 7,
      focus: { width: 0.3, depth: [0.06, 0.34] },
      margin: 0.87,
      anchor: [0.47, 0.52],
      portrait: { region: [0.62, 0.9], focus: { width: 0.22, depth: [0.06, 0.34] } },
      // Landscape phones keep the drift (no room about the name for a move) and
      // the centred aim and fuller margin, which keep the star clear of the name.
      landscape: { move: null, azimuth: 82, anchor: [0.5, 0.5], margin: 0.91 },
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
      portrait: { focus: { width: 0.16, depth: [0.13, 0.36] } },
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
    },
    {
      name: "Watch and tree",
      light: { key: 1.15, fill: 0.45, rim: 2.4 },
      move: { dolly: [1.04, 0.94], ease: 0.5 },
      // The one shot with both landmarks, side by side and apart: the lookout
      // whole left of the area's centre, the tree whole to its right, the star
      // high between the name and the lookout, a triangle of the three. Small
      // in a wide frame, so the plain is calmed (as Portrait's) and the camera
      // tilts up through the hold (tilt: degrees of pitch at the cut and at the
      // next), the range staying above the name. Further out, the cut opens on
      // the hard top-left edge of the cloud cover at these bearings (it showed
      // at margin 0.55 from 66 degrees).
      region: [0, 1],
      fov: 34,
      azimuth: 70,
      height: 0.2,
      arc: 2,
      hold: 7,
      margin: 0.66,
      anchor: [0.36, 0.62],
      tilt: [-6, -3],
      // Phones and portrait monitors keep the lookout on the left third and the
      // tree whole to its right, both clear of the edges; the star is out of
      // their view. Landscape phones turn a little further round. Squat and the
      // smallest landscape windows, the name above the subject's left, see the
      // pair mirrored from across the plain: the tree left, the lookout right,
      // the star whole beyond it.
      portrait: { azimuth: 55, margin: 0.52, anchor: [0.2, 0.62], tilt: [-1, 2] },
      landscape: { azimuth: 75, margin: 0.6, anchor: [0.5, 0.55], tilt: [-3, 0], move: null },
      compact: { azimuth: -15, margin: 0.6, anchor: [0.6, 0.55], tilt: [-3, 0], move: null },
      squat: {
        azimuth: -15,
        margin: 0.6,
        anchor: [0.6, 0.55],
        tilt: [-5, 0],
        move: { dolly: [1.08, 0.94], ease: 0.5 },
      },
      ground: { burn: { amount: 0.45, reach: [0.3, 0.9] }, flatten: 0.6, keep: [9, 20] },
    },
  ],
  tree: [
    {
      name: "Portrait",
      // Phones set the tree on the lower third, open sky above it.
      portrait: {
        move: { dolly: [1.06, 0.94], crane: [0, 0.08], ease: 0.6 },
        anchor: [0.5, 0.66],
      },
      light: { fill: 0.85, rim: 1.3 },
      move: { truck: [-0.07, 0.07], crane: [0, 0.13], dolly: [1.05, 0.92], ease: 0.6 },
      // Low (0.12), so the plain ahead is foreshortened under the ranges, and
      // calmed: the near slate burned down, its texture and glints quietened
      // beyond the tree's knoll (slateCalmFor()). The crown stands against the
      // clouds over bare near ranges: no snowy massif rises behind it
      // (mountain-build.js RANGE_PLACEMENTS).
      region: [0, 1],
      fov: 36,
      azimuth: -72,
      height: 0.12,
      arc: 4,
      hold: 9,
      margin: 0.93,
      ground: { burn: { amount: 0.45, reach: [0.4, 0.95] }, flatten: 0.65, keep: [7, 16] },
      // Landscape phones keep the drift: no room about the name for a move.
      landscape: { move: null },
    },
    {
      name: "Lantern study",
      light: { key: 0.55, fill: 0.65, lantern: 1.45, rim: 0.7 },
      lens: { blur: 8 },
      move: { dolly: [1.2, 0.85], ease: 0.6 },
      subject: "tree-lantern",
      // Across the pond, a little round from its axis and with the lantern
      // right of the area's centre, so less of the root flare stands behind
      // the name at the end of the push-in. Phones keep the pond's axis.
      region: [0, 1],
      fov: 34,
      azimuth: -125,
      height: 0.62,
      arc: 2,
      hold: 6,
      margin: 0.7,
      anchor: [0.56, 0.5],
      landscape: { move: null, azimuth: -115, anchor: [0.5, 0.5] },
      portrait: { move: { dolly: [1.1, 0.9], ease: 0.6 }, azimuth: -115, anchor: [0.5, 0.5] },
    },
    {
      name: "Close-up",
      light: { fill: 0.7, rim: 2 },
      lens: { blur: 10 },
      move: { truck: [-0.1, 0.1], ease: 0.5 },
      // The crown: low under the fork high on the trunk, looking up at the
      // limbs against the sky, open sky beside the name.
      region: [0.5, 0.78],
      fov: 32,
      azimuth: -155,
      height: 0.28,
      arc: 2,
      hold: 6,
      focus: { width: 0.32, depth: [-0.15, 0.2] },
      margin: 0.92,
      anchor: [0.58, 0.45],
      // Phones push in: a sideways truck this close takes the lens into the
      // trunk. Their aim sits a little high, which lifts the far range's snow
      // clear above the name on portrait monitors.
      portrait: {
        focus: { width: 0.26, depth: [-0.15, 0.2] },
        anchor: [0.5, 0.4],
        move: { dolly: [1.1, 0.94], ease: 0.5 },
      },
      // Landscape phones keep the drift (no room about the name for a move),
      // from higher, so the roots stay below the short frame.
      landscape: { move: null, margin: 0.83, height: 0.5, anchor: [0.5, 0.5] },
    },
    {
      name: "Root and lantern",
      move: { dolly: [0.86, 1.05], crane: [0, 0.03], ease: 0.6 },
      light: { key: 0.6, fill: 0.75, lantern: 1.4, rim: 0.9 },
      lens: { blur: 8 },
      // Round from the pond's axis, so the trunk stands right of centre and
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
      portrait: {
        focus: { width: 0.25, depth: [-0.1, 0.32] },
        anchor: [0.55, 0.66],
        move: { dolly: [0.92, 1.06], ease: 0.6 },
      },
      // Landscape phones keep the drift (no room about the name for a move)
      // and the pond's axis.
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
// LETTERBOX.ratio, each bar a share of the height, none under 2% of it.
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
// at the cuts, so the camera never stops. Shots without a move keep the
// constant drift and the PUSH_IN dolly.
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
  };
}
// The poses a fit must hold: a move's sampled phases, or the drift's extremes
// (the 48-second breath without a tour swings the full arc either way).
export function fitPoses(shot) {
  return shot.move
    ? MOVE_PHASES.map((phase) => shotPose(shot, phase))
    : [-shot.arc, 0, shot.arc].map((yaw) => ({ yaw, scale: 1, crane: 0, truck: 0, fov: shot.fov }));
}

// A shot's `anchor`: where its aim lands in the safe area, as shares of the
// area's width from its left edge and of its height from its top, so a subject
// can stand on a third rather than at the centre. The fit keeps the focal
// volume inside the area on every side of that point. A shot's `tilt` pitches
// the camera after the fit, moving the aim off its anchor; leave margin for it.
export const CENTRE = Object.freeze([0.5, 0.5]);
export function shotAnchor(shot) {
  return shot.anchor ?? CENTRE;
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
      const { scale, crane, truck } = poses[k],
        [left, right, above, below] = limits[k],
        reach = distance * scale,
        rise = dy + crane * measured.height,
        side = truck * reach,
        length = Math.hypot(reach, rise),
        c = reach / length,
        s = rise / length,
        points = projected[k];
      // Across is positive to the camera's left, up is positive upward.
      for (let i = 0; i < points.length; i += 3) {
        const depth = length - points[i + 2] * c - points[i + 1] * s,
          across = points[i] - side,
          up = points[i + 1] * c - points[i + 2] * s;
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
