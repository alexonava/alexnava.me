import { Box3, Vector3 } from "three";

// Heights and focal widths are proportions of the selected authored subject.
// Detail shots intentionally crop incidental roof/canopy geometry; fitting the
// entire horizontal slice would turn every portrait detail into a wide shot.
// hold: seconds the tour stays on a shot, cut to cut; tour=3|5|20 overrides it.
export const DIRECTED_SHOTS = {
  tower: [
    {
      name: "The watch",
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
      landscape: { height: 0.55, azimuth: -12 },
      // Under 600px wide the intro spans nearly half the screen and the range
      // still met its last line at 0.55; lower again, it runs below the intro.
      compact: { height: 0.4, azimuth: -12 },
    },
    {
      name: "Threshold",
      // The lookout's threshold: the ladder on its +Z access side arriving
      // through the gap in the gallery railing. Nearer the ladder's face than 82
      // degrees brings the sun behind the name on landscape phones. The region
      // is raised to 0.64-0.93 so the gable apex keeps headroom under the top
      // edge through the end-of-hold push-in on desktop and landscape phones;
      // portrait phones, which had that headroom, keep 0.62-0.90.
      region: [0.64, 0.93],
      fov: 36,
      azimuth: 82,
      height: 0.5,
      arc: 2,
      hold: 7,
      focus: { width: 0.3, depth: [0.06, 0.34] },
      margin: 0.91,
      portrait: { region: [0.62, 0.9], focus: { width: 0.22, depth: [0.06, 0.34] } },
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
      azimuth: -20,
      height: 0.4,
      arc: 1,
      focus: { width: 0.2, depth: [0.13, 0.36] },
      // Keeps the far corner leg off the right frame edge through its drift.
      margin: 0.87,
      portrait: { focus: { width: 0.16, depth: [0.13, 0.36] } },
    },
    {
      name: "Gallery detail",
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
  ],
  tree: [
    {
      name: "Portrait",
      region: [0, 1],
      fov: 36,
      azimuth: -77,
      height: 0.24,
      arc: 4,
      hold: 9,
      margin: 0.93,
    },
    {
      name: "Lantern study",
      subject: "tree-lantern",
      region: [0, 1],
      fov: 34,
      azimuth: -115,
      height: 0.62,
      arc: 2,
      hold: 6,
      margin: 0.7,
    },
    {
      name: "Close-up",
      // The twisted tree's fork sits high on the trunk.
      region: [0.38, 0.56],
      fov: 30,
      azimuth: -155,
      height: 0.42,
      arc: 2,
      hold: 6,
      focus: { width: 0.23, depth: [-0.09, 0.14] },
      margin: 0.83,
      portrait: { focus: { width: 0.16, depth: [-0.09, 0.14] } },
    },
    {
      name: "Root and lantern",
      region: [0, 0.16],
      fov: 32,
      azimuth: -115,
      height: 0.14,
      arc: 1,
      hold: 6,
      focus: { width: 0.3, depth: [-0.1, 0.32] },
      margin: 0.91,
      portrait: { focus: { width: 0.25, depth: [-0.1, 0.32] } },
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
// portrait variant, wherever the name sits; landscape screens under 500px tall
// take the landscape one, or the compact one under 600px wide.
const variantShots = new WeakMap();
export function resolveDirectedShot(shot, width, height) {
  const variant =
    height > width || isStackedLayout(width, height)
      ? shot.portrait
      : height < 500 && ((width < 600 && shot.compact) || shot.landscape);
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

export function fitShot(measured, shot, area, width, height) {
  const tan = Math.tan((shot.fov * Math.PI) / 360),
    aspect = width / height,
    margin = shot.margin ?? 0.85;
  const maxX = ((tan * aspect * area.width) / width) * margin;
  const maxY = ((tan * area.height) / height) * margin;
  const dy = measured.cameraY - measured.target.y;
  const projected = [];
  for (const offset of [-shot.arc, 0, shot.arc]) {
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
    const length = Math.hypot(distance, dy),
      c = distance / length,
      s = dy / length;
    for (const points of projected)
      for (let i = 0; i < points.length; i += 3) {
        const depth = length - points[i + 2] * c - points[i + 1] * s;
        if (
          depth <= 0.1 ||
          Math.abs(points[i]) > maxX * depth ||
          Math.abs(points[i + 1] * c - points[i + 2] * s) > maxY * depth
        )
          return false;
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
