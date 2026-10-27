import { DEPTH_LAYER } from "./depth-layers.js";
import { FLASH_GROUND, FLASH_UNIFORMS, SHOT_KEY } from "./film-light.js";
import { HORIZON_AIR, RANGE_MIST, TERRAIN_HORIZON } from "./hill-silhouette.js";
import { ESTATE, estateLantern, estatePoint } from "./estate-layout.js";
import { MIST_PARS, MIST_UNIFORMS, mistOn } from "./drifting-mist.js";
// The estate's human scale for props and trees: one doorway height.
export const DOOR_HEIGHT = 6.6;

// The terrain's dune field, helpers.js dune(): amplitude * wave(frequency *
// (sx * x + sz * z)) in world x/z. Restated here so the slate's wet sheen can
// find the hollows in the shader; a test holds it to scene.groundHeight.
// The plain's level (the first, constant term) and its faint swell.
export const TERRAIN_BASE = 1.25;
export const TERRAIN_DUNE_TERMS = Object.freeze([
  Object.freeze({ amplitude: TERRAIN_BASE, wave: "cos", frequency: 0, sx: 0, sz: 0 }),
  Object.freeze({ amplitude: 0.27, wave: "sin", frequency: 0.055, sx: 1, sz: 0 }),
  Object.freeze({ amplitude: 0.2025, wave: "cos", frequency: 0.052, sx: 0, sz: 1 }),
  Object.freeze({ amplitude: 0.135, wave: "sin", frequency: 0.031, sx: 1, sz: 1 }),
  Object.freeze({ amplitude: 0.0825, wave: "cos", frequency: 0.018, sx: 1, sz: -1 }),
]);
export function terrainDune(x, z) {
  return TERRAIN_DUNE_TERMS.reduce(
    (sum, { amplitude, wave, frequency, sx, sz }) =>
      sum + amplitude * Math[wave](frequency * (sx * x + sz * z)),
    0,
  );
}
const glslNumber = (value) => (Number.isInteger(value) ? value.toFixed(1) : String(value));
const TERRAIN_DUNE_GLSL = TERRAIN_DUNE_TERMS.map(
  ({ amplitude, wave, frequency, sx, sz }) =>
    `${glslNumber(amplitude)}*${wave}(dot(vMudWorld.xz, vec2(${glslNumber(frequency * sx)}, ${glslNumber(frequency * sz)})))`,
).join(" + ");

// The film slate just after rain. Terrain hollows and the map's dark crack
// texels hold water, and a wide halo about the tree (the root area, the path
// and the lantern clearing with it) is wet; only the watch's raised terrace stays dry.
// Wet ground is glossy rather than darker (it keeps the ground's brightness):
// smoother, its direct highlight clamped less, its own sky reflection clamped
// less (indirect: the soil's share where wet), and a film of water mirrors the
// night sky (SLATE_WATER), fading with view distance, so the far plain behind
// the intro text stays calm.
export const SLATE_WET = Object.freeze({
  hollow: Object.freeze([0.77, 1.1]), // plain height: fully wet below, dry above
  crack: Object.freeze([0.07, 0.24]), // linear map luminance: dark cracks hold water
  crackWeight: 0.8,
  halo: Object.freeze([8.0, 40.0]), // distance from the tree: wet within, drier beyond
  haloWeight: 0.55,
  // Smoother than dry ground (0.88), never mirror-smooth: at 0.28-0.44 the
  // crack walls near the lens glint behind the name and intro in the lantern
  // shots (down to 2.7:1).
  roughness: 0.5,
  roughnessWeight: 0.9,
  darken: 0.04,
  specular: 1.6, // direct specular clamp relaxed by up to 1 + 1.6 (the cap)
  indirect: Object.freeze([0.18, 0.6]), // the soil's own sky reflection kept: dry, wet
  // Up close damp soil reads matte (the owner's note of 2026-10-04: "too
  // glossy"): fully within near[0] of the lens and gone by near[1], the soil
  // (never the river, puddles or streams) eases to `roughness`, keeps `film`
  // of its water film, `specular` of its direct highlights and `sky` of its
  // own sky reflection.
  close: Object.freeze({
    near: Object.freeze([6, 18]),
    roughness: 0.8,
    film: 0.3,
    specular: 0.45,
    sky: 0.45,
  }),
});

// The seamless slate v2 tile (Assets/Materials/slate-v2), repeated every 22
// units. A second lookup of the same tile, 1/0.866 larger and turned 126.87
// degrees (a 3-4-5 turn), is blended in by a 17-unit noise and by which sample
// is higher (lighter), with the blend's lost contrast restored about the tile's
// mean linear colour (delivery-report.json). The detail map, a 5.03-unit high
// band turned 36.87 degrees, adds close relief and grain within 6-55 units of
// the lens, and a 53-unit noise varies the tone.
export const SLATE_TILING = Object.freeze({
  tile: 22,
  second: Object.freeze({
    scale: 0.866,
    turn: Object.freeze([-0.6, 0.8, -0.8, -0.6]), // column-major mat2
    offset: Object.freeze([0.37, 0.61]),
  }),
  blendCell: 17,
  blendGain: 2.4,
  heightGain: 1.6,
  mean: Object.freeze([0.2293, 0.2258, 0.2366]),
  lift: 1.2, // albedo multiplier on the whole slate ground
  macroCell: 53,
  detail: Object.freeze({
    ratio: 4.37, // base tiles per detail tile: 22 / 4.37 = 5.03 units
    turn: Object.freeze([0.8, 0.6, -0.6, 0.8]),
    strength: 4.2, // tangent slope per grey step of one texel (about the base map's relief)
    albedo: 0.36,
    near: Object.freeze([6.0, 55.0]), // view distance: full detail within, none beyond
  }),
});

// The close soil near the lens (Assets/Materials/dirt-close-v1, from CC0
// PolyHaven "Dirt"): its grit (albedo detail about 0.5) and relief (height)
// maps tile every `tile` units, a second lookup `scale` times larger, turned
// (a 7-24-25 turn) and offset, blended in by a `blendCell` noise so no repeat
// reads. Near the lens the slate's own mid-scale blotches, enlarged there, give
// way to its broad tone (`calm` of it: the tile `blur` mip levels down, and
// its relief calmed alike). The grit moves the soil's albedo by up to `albedo` about it; the
// relief, `relief` units high, tilts its normal by its slope worked out at
// each pixel (the map's own texel differences and the crumbs' exact slope),
// never by screen derivatives, which step in two-pixel blocks along the lit
// crests. Both are full within near[0] of the lens and gone by near[1], and
// the relief fades where a texel (one of `texels` across the tile) shrinks
// below `footprint` pixels and under water. Near the lens (near[0] to near[1])
// the soil's brightest channel eases past `ceiling` with the colour scaled whole
// (the shown frame's highlight shoulder would otherwise clip the lantern-lit
// crests channel by channel into flat, chalky grey patches).
export const SLATE_CLOSE = Object.freeze({
  tile: 6.6,
  second: Object.freeze({
    scale: 0.83,
    turn: Object.freeze([0.28, 0.96, -0.96, 0.28]),
    offset: Object.freeze([0.41, 0.17]),
  }),
  blendCell: 2.6,
  albedo: 0.65,
  relief: 0.045,
  blur: 5,
  calm: 0.9,
  near: Object.freeze([6, 32]),
  footprint: Object.freeze([0.8, 2]),
  featureTexels: 8,
  texels: 1024,
  // Crumbs: a cellular noise of `cell`-unit grains on the close soil's relief
  // (`height`, in relief-map units) and albedo (`albedo`), so it reads as
  // crumbly earth; gone where a cell shrinks under `fade` pixels. Neighbouring
  // grains meet in a valley rounded by a smooth minimum (`round`: its
  // sharpness), so no crease cuts a hard line along a lit crest, and their
  // walls tilt at most toward a slope of `steep` (a soft limit on its
  // tangent): near-vertical, the wall facing the lantern at each valley lit
  // into a continuous 1-2 px pale rim about the cobble.
  crumb: Object.freeze({
    cell: 0.025,
    height: 0.18,
    albedo: 0.12,
    fade: Object.freeze([1.8, 4]),
    round: 12,
    steep: 0.35,
  }),
  ceiling: 0.8,
});

// The far plain's own structure (the owner's pick of 2026-10-09, "detailed"):
// past the close detail the slate tile's mips average it to one flat tone to the
// horizon. Broad noise swathes (`cells` units, `weights`, with offsets) move
// the soil's tone by up to `amount` either way, drifting from cool to warm over
// a `hueCell` noise; then two more lookups of the slate tile, `scale` times
// its size (about 55 and 185 units) and turned and offset so neither lines up
// with the base, carry its cracks and blotches far out: their luma about the
// tile's mean, weighted, raised to `gain` and kept within `range`, scales the
// albedo. Each eases in over its `near` view distances, so the close soil
// keeps its own maps.
export const SLATE_FAR = Object.freeze({
  swathes: Object.freeze({
    cells: Object.freeze([29, 83, 9]),
    weights: Object.freeze([0.45, 0.35, 0.2]),
    offsets: Object.freeze([0, 7.3, 3.1]),
    amount: 0.22,
    hueCell: 89,
    hueOffset: 11.7,
    cool: Object.freeze([0.98, 0.98, 1]),
    warm: Object.freeze([1.1, 1.01, 0.9]),
    near: Object.freeze([16, 55]),
  }),
  tile: Object.freeze([
    Object.freeze({ scale: 0.4, offset: Object.freeze([0.31, 0.17]), weight: 0.55 }),
    Object.freeze({
      scale: 0.12,
      turn: Object.freeze([0.6, -0.8, 0.8, 0.6]), // column-major mat2
      offset: Object.freeze([0.57, 0.23]),
      weight: 0.45,
    }),
  ]),
  gain: 2.2,
  range: Object.freeze([0.35, 2.2]),
  near: Object.freeze([12, 40]),
});

// Moonlit puddles along the tree's drip line and in Portrait's right
// foreground: zone anchors and angles as estatePoint() takes them, radius in
// units. Water fills the detail map's low texels first (fill: the zone's
// level over them), so edges follow the cracks. Puddles and the river
// (SLATE_RIVER) are glassy, darker and calmer, catch the existing moon and
// lantern lights, and mirror the night sky (the film's environment,
// SLATE_WATER); the river, where the lantern's image lands, and the stream
// keep their own roughness and highlight (lantern), so the moon's glint on the
// stream's ripples between its white water never flares into a flat white
// patch, and zenith is the sky its mirror falls back to without the
// environment.
export const SLATE_PUDDLES = Object.freeze({
  zones: Object.freeze([
    Object.freeze({ anchor: "tree", deg: 185, dist: 8.0, radius: 1.6 }),
    Object.freeze({ anchor: "tree", deg: 75, dist: 9.0, radius: 2.5 }),
    Object.freeze({ anchor: "tree", deg: -100, dist: 16.0, radius: 1.5 }),
  ]),
  fill: 0.62,
  roughness: 0.12,
  darken: 0.5,
  flatten: 0.85,
  specular: 4,
  lantern: Object.freeze({ roughness: 0.2, specular: 0.8 }),
  zenith: Object.freeze([0.07, 0.085, 0.13]),
});

// The river's bed and banks (SLATE_RIVER), across it: its water lies `level`
// below the lantern's foot; the bed falls to `depth` below the water down its
// middle (a parabola in the normalised radius) and the bank rises toward
// `rise` above it, smoothly from the shore, until it meets the ground
// (terrain-build.js carves it within reach[1] radii, inside the fine grid; the
// lantern's footing stays level). The shader finds the water from the same
// shape: its level is the depth times `shore` (the puddles' level units), the
// detail map's texels moving the shore a little (`texel`), and it is no water
// beyond reach[0] to reach[1] radii.
export const SLATE_RIVER_BED = Object.freeze({
  depth: 0.18,
  rise: 0.15,
  level: -0.04,
  shore: 3,
  texel: 0.06,
  reach: Object.freeze([1.25, 1.55]),
});
// The stream (the owner's asks of 2026-10-10: "a flowing stream of rushing
// water", then "a proper stream / small river", added to Lantern study's
// shot; the owner's picks: the rushing stream, as a small river; and of
// 2026-10-23, "should flow in the opposite direction. (from the river to the
// tree instead)", C Rushing): it leaves the river in front of the lantern,
// runs past the lantern's left and sinks away under the root arch. Its course
// is [dx, dz] offsets from the lantern's foot, its head (under the arch)
// first and its mouth (on the river) last, drawn as a smooth curve sampled
// every `step` units, `width` units wide at its head and at its mouth; its
// banks meander by a noise (`meander` units at `wobble` cycles per unit). Its
// water runs at `flow` units a second along its course (negative: from its
// mouth up toward its head): the current ripples it (`current`, as the
// river's RIVER_RIPPLE: [along, across] cycles per unit and their tilt), and
// across the confluence (water depths `confluence`) the river's water eases
// into the stream's. White water (`foam`) breaks on it, over `amount` of the
// water, `join` where courses meet and `mouth` in a band where it leaves the
// river (rising from reach[0] - 0.3 to reach[0] of the river's radius, gone
// by reach[1]), in drifting patches (`patch` cycles per unit), covering at
// most `cover` of the water's colour, at albedo `albedo`. It is a lace of
// bubble rafts, the borders of cells `lace` per unit
// ([along, across]) drifting at `drift` of the current (as the leaves on it
// do; at its whole speed its thin strands moved over a quarter of a cell a
// frame and seemed to re-form every frame), warped by `warp` of a cell,
// their lines `edge` of a cell thick from calm to churning water, gathered in
// clumps (where the churn passes clump[0] to clump[1]) and broken by a noise
// `broken` cells across; where the cells are too fine to draw it eases to
// `far` of its churn. `cell` ([along, across] cycles per unit) breaks the
// froth about the stones. Out in the river the plume thins to `plume` toward
// its middle, and behind the text it keeps 1 - `text` (terrain-build.js
// STREAM_FOAM). terrain-build.js restates this.
export const SLATE_STREAMS = Object.freeze({
  courses: Object.freeze(
    [
      {
        path: [
          [5.6, 2.9],
          [4.9, 2.5],
          [3.7, 1.5],
          [2.9, 0.3],
          [2.4, -1.36],
          [1.5, -2.5],
          [2.31, -4.1],
          [3.2, -5.6],
          [2.3, -7.4],
          [0.7, -9],
          [-1.4, -9.9],
          [-3.6, -10.2],
          [-5.7, -10.9],
          [-6.9, -11.4],
        ],
        width: [0.9, 1.3],
        flare: [1.3, 3.6, 1.2],
        // Fixed treeward station, original course length, lower branch width.
        profile: [5.556, 9.415, 1.2],
      },
    ].map(({ path, width, flare, profile }) =>
      Object.freeze({
        path: Object.freeze(path.map((p) => Object.freeze(p))),
        width: Object.freeze(width),
        ...(flare && { flare: Object.freeze(flare) }),
        ...(profile && { profile: Object.freeze(profile) }),
      }),
    ),
  ),
  step: 0.45,
  meander: 0.28,
  wobble: 1.6,
  flow: -1.4,
  calm: Object.freeze({ from: 5.556, span: 2, foam: 0.25, ripple: 0.5 }),
  confluence: Object.freeze([0.3, 1]),
  current: Object.freeze({
    coarse: Object.freeze([1.1, 2.4]),
    fine: Object.freeze([3, 6.5]),
    tilt: Object.freeze([0.05, 0.024]),
  }),
  foam: Object.freeze({
    cell: Object.freeze([9, 30]),
    patch: Object.freeze([1.2, 2]),
    amount: 0.5,
    join: 0.65,
    mouth: 1,
    reach: Object.freeze([1, 1.9]),
    cover: 0.85,
    far: 0.5,
    plume: 0,
    albedo: 0.34,
    text: 0.9,
    lace: Object.freeze([6, 9]),
    warp: 0.35,
    edge: Object.freeze([0.1, 0.32]),
    clump: Object.freeze([0.3, 0.7]),
    broken: 0.8,
    drift: 0.5,
  }),
  // The channel (as SLATE_RIVER_BED, across the course: r is 1 on its banks,
  // half its width out): its water lies `level` below the lantern's foot where
  // it leaves the river (the river's own level), falling `drop` more toward its
  // head, down which it runs (terrain-build.js streamLevel()); its
  // bed falls to `depth` below the water down its middle (a course narrower
  // than `full` units in proportion) and its banks rise toward `rise`, until
  // they meet the ground. Through a bend the channel leans (`skew` of the bend,
  // its signed turn over `turn` degrees across two samples): deeper under the
  // outside bank, which stands steep and up to `cut` times higher (the cut
  // bank), and shallowing to the inside bank, which slopes gently out of the
  // water (the point bar). terrain-build.js carves it within reach[1], the
  // smooth minimum (`blend` units) of the ground and that shape, clear of the
  // lantern's footing and the roots; the river's water sheet (terrain-build.js
  // riverSurfaceSteps()) fills it at that level, joined to the river's, and the
  // shader's water fills it to its banks
  // (`shore` level units a unit of depth, the detail map's texels moving the
  // waterline by `texel`) and is no water beyond reach[0] to reach[1].
  bed: Object.freeze({
    depth: 0.2,
    full: 1.6,
    rise: 0.1,
    level: -0.04,
    drop: 0.1,
    sill: Object.freeze({
      depth: Object.freeze([0.3, 1]),
      along: 3,
      back: 1,
      across: 1.4,
      reach: 1.6,
    }),
    shore: 3,
    texel: 0.05,
    reach: Object.freeze([1.3, 1.7]),
    blend: 0.04,
    turn: 25,
    skew: 0.6,
    cut: 1.6,
  }),
  // The water's body in the channel: as it deepens to `deep` (level units) it
  // hides the cracks under silt (`calm` of the way to `silt`) and darkens by
  // `darken`, easing into the river's own water where the stream leaves it.
  body: Object.freeze({
    deep: 0.5,
    calm: 0.55,
    silt: Object.freeze([0.11, 0.095, 0.08]),
    darken: 0.55,
  }),
  // Stones in the stream's bed: [dx, dz] from the lantern's foot, height, type
  // and yaw (degrees). rock-build.js seats them darker (`tone`, wet), `sink` of
  // their height into the bed, and where the channel is deeper raises them so
  // `show` of their height stands out of the water (streamWater()), their feet
  // under it. The white water wraps each at the waterline (`radius` of its
  // height about its centre, a ring `ring` units wide) and trails off
  // downstream, toward the roots, in a wake `wake` units long, widening by
  // `spread` a unit (terrain-build.js STREAM_FOAM).
  stones: Object.freeze({
    tone: 0.5,
    sink: 0.22,
    show: 0.5,
    radius: 0.6,
    ring: 0.07,
    wake: 1.6,
    spread: 0.45,
    list: Object.freeze(
      [
        [3.34, 0.26, 0.22, "weathered", 20],
        [2.2, -0.63, 0.28, "lichen", 110],
        [2.4, -2.06, 0.2, "weathered", 250],
        [1.2, -2.42, 0.28, "weathered", 75],
      ].map((stone) => Object.freeze(stone)),
    ),
  }),
});
// The water's banks (the owner's picks of 2026-10-10, "make the ground more
// interesting"): beyond the waterline a band of wet, dark mud (`darken`, as
// damp as the water's margin) out to stream[1] normalised radii of the stream
// and river[1] of the river. Through the stream's bends its banks differ:
// outside, the cut bank stands darker still (`cut`, raw wet earth in its own
// shade); inside, the point bar is smooth silt (`silt.amount` of the way to
// the slate's mean, `silt.calm` of its relief flattened) ripple-marked across
// the flow near the lens (`silt.ripple`: cycles per unit and height). The pale
// silt thins behind the text (`text`).
export const SLATE_BANKS = Object.freeze({
  stream: Object.freeze([1.0, 1.5]),
  river: Object.freeze([1.0, 1.3]),
  darken: 0.2,
  cut: 0.16,
  silt: Object.freeze({ amount: 0.5, calm: 0.7, tone: 1.15, ripple: Object.freeze([5.5, 0.02]) }),
  text: 0.8,
});
// A smooth curve through world points (Catmull-Rom), each span cut into
// pieces about `step` units long, or the span's own step where its first point
// carries one ([x, z, half-width, step]): the samples ([x, z], and the
// half-width, linear across each span, where the points carry one) and the
// sample each point's span starts at.
function courseSamples(p, step) {
  const at = (i) => p[Math.max(0, Math.min(p.length - 1, i))],
    points = [],
    starts = [];
  for (let i = 0; i + 1 < p.length; i++) {
    const [a, b, c, d] = [at(i - 1), at(i), at(i + 1), at(i + 2)],
      pieces = Math.max(1, Math.ceil(Math.hypot(c[0] - b[0], c[1] - b[1]) / (b[3] ?? step)));
    starts.push(points.length);
    for (let k = 0; k < pieces; k++) {
      const t = k / pieces,
        t2 = t * t,
        t3 = t2 * t,
        f = (q) =>
          0.5 *
          (2 * b[q] +
            (c[q] - a[q]) * t +
            (2 * a[q] - 5 * b[q] + 4 * c[q] - d[q]) * t2 +
            (3 * b[q] - a[q] - 3 * c[q] + d[q]) * t3);
      points.push(b.length > 2 ? [f(0), f(1), b[2] + (c[2] - b[2]) * t] : [f(0), f(1)]);
    }
  }
  starts.push(points.length);
  points.push(p.at(-1).slice(0, 3));
  return { points, starts };
}
// A smooth course through world points (Catmull-Rom), sampled about every
// `step` units: [x, z, distance along] at each sample.
function smoothCourse(p, step) {
  const { points } = courseSamples(p, step);
  let s = 0;
  return points.map(([x, z], i) => {
    if (i) s += Math.hypot(x - points[i - 1][0], z - points[i - 1][1]);
    return Object.freeze([+x.toFixed(3), +z.toFixed(3), +s.toFixed(3)]);
  });
}
// Each sample's bend (SLATE_STREAMS.bed): the signed turn of the course across
// two samples either side, over `turn` degrees, within -1..1 (positive turning
// from +x toward +z).
function courseBends(points, turn) {
  const at = (i) => points[Math.max(0, Math.min(points.length - 1, i))];
  return points.map((_, k) => {
    const [ax, az] = at(k - 2),
      [bx, bz] = at(k),
      [cx, cz] = at(k + 2),
      ux = bx - ax,
      uz = bz - az,
      vx = cx - bx,
      vz = cz - bz;
    if (!(ux || uz) || !(vx || vz)) return 0;
    const angle = (Math.atan2(ux * vz - uz * vx, ux * vx + uz * vz) * 180) / Math.PI;
    return +Math.max(-1, Math.min(1, angle / turn)).toFixed(4);
  });
}
// The width at a fixed course station: preserve the treeward profile, then
// narrow the lower branch and flare only where it reaches the river.
function courseWidth({ width: [w0, w1], flare, profile }, s, length) {
  const t = flare ? Math.min(1, Math.max(0, (s - length + flare[1]) / (flare[1] - flare[2]))) : 0;
  const base = profile
    ? w0 +
      ((w1 - w0) * Math.min(s, profile[0])) / profile[1] +
      (profile[2] - w0 - ((w1 - w0) * profile[0]) / profile[1]) *
        Math.max(0, (s - profile[0]) / (length - profile[0]))
    : w0 + ((w1 - w0) * s) / length;
  return base + (flare ? flare[0] * t * t * (3 - 2 * t) : 0);
}
function courseLevel({ profile }, s, length, bed) {
  const t = profile
    ? Math.min(s, profile[0]) / profile[1] +
      (1 - profile[0] / profile[1]) * Math.max(0, (s - profile[0]) / (length - profile[0]))
    : s / length;
  return bed.level - bed.drop * (1 - t);
}
// The streams' courses, sampled: world [x, z, distance along] points, the
// width at head and mouth, each course's length, each sample's bend and its
// width there (courseWidth()).
export function streamLines({ courses, step, bed } = SLATE_STREAMS) {
  const { x: lx, z: lz } = estateLantern();
  return courses.map((course) => {
    const points = smoothCourse(
        course.path.map(([dx, dz]) => [lx + dx, lz + dz]),
        step,
      ),
      length = points.at(-1)[2];
    return Object.freeze({
      points: Object.freeze(points),
      width: course.width,
      length,
      bends: Object.freeze(courseBends(points, bed.turn)),
      widths: Object.freeze(points.map(([, , s]) => +courseWidth(course, s, length).toFixed(4))),
      levels: Object.freeze(points.map(([, , s]) => courseLevel(course, s, length, bed))),
    });
  });
}
// The river through the set (the owner's picks of 2026-10-10, a broad, slow
// river past the lantern, and 2026-10-11, "much more water", carried through
// the set across Portrait's foreground and into a lake behind the watch): it
// pours off the cliffs north-east behind the tree (the owner's open sea of
// 2026-10-17, terrain-build.js and ocean.js riverFalls()); along it from there
// it rounds a meander north-west of the lantern, then its broad bend stands
// farther west, its water more than 6 units clear of the lantern. The narrow
// tree stream crosses the restored ground to meet it. Clear of the roots,
// rocks and puddles, it crosses Portrait's foreground, rounds past its lens, passes
// well south of the watch's terrace (its water 10 units beyond the terrace's grass)
// and widens across The watch's plain into a lake 60 units across, where it
// comes in off the plain from toward the summit. Its course is a smooth
// centreline through `path` ([dx, dz] offsets from the lantern's foot, from the
// falls first), sampled every `step` units; its half-width
// is `width` (the normalised radius is 1 on its shore), wobbled along its
// length (`wobble`) so its banks never run parallel. A point may carry its own
// half-width and step ([dx, dz, half-width, step]): the half-width changes
// linearly to the next point's, and the step cuts the span the point starts.
// Its distance along its course is `datum[1]` at the `datum[0]`th point, and
// the wobble stretches with the half-width (`width` sets its pace). Its bed
// and banks are SLATE_RIVER_BED, and its water runs at `flow` units a second
// along its course (negative: back toward its first point, to the falls). Where `valley` is set, the foothills open along it (terrain-build.js
// valleyGap()): flat within `floor` half-widths of its centreline, rising to
// their full height over `shoulder` units beyond.
export const SLATE_RIVER = Object.freeze({
  path: Object.freeze(
    [
      [33.1, 52.6, 3.9, 5],
      [17.1, 36.6, 3.3, 3],
      [1.1, 30.6, 2.9, 3],
      [-14.9, 32.6, 2.8, 3],
      [-29.9, 30.6, 2.7, 3],
      [-41.9, 23.6, 2.5, 2.5],
      [-43.9, 14.6, 2.3, 2],
      [-36.9, 9.1, 2.1, 1.5],
      [-21, 0.4, 2, 0.9],
      [-13, -0.9],
      [-8.6, -3.1],
      [-7.1, -5.2],
      [-6.4, -7.5],
      [-6.5, -9.7],
      [-7.3, -11.6],
      [-8.7, -13.5],
      [-9.9, -15.7],
      [-9.9, -19],
      [-8.4, -22.5, 2, 3],
      [-6.9, -26.9, 2.4, 2],
      [-3.4, -30.8, 2.7, 3],
      [4.1, -31.4, 3.2, 3],
      [12.1, -29.2, 3.6, 4],
      [23.1, -28.4, 4, 4],
      [35.1, -32.4, 4.4, 5],
      [45.1, -43.4, 4.8, 6],
      [48.1, -61.4, 5.2, 8],
      [43.1, -83.4, 5.6, 12],
      [25.1, -101.4, 6, 12],
      [-4.9, -111.4, 6.6, 12],
      [-38.9, -109.4, 7.2, 12],
      [-70.9, -103.4, 7.8, 12],
      [-100.9, -97.4, 8.4, 12],
      [-134.9, -89.4, 9.2, 8],
      [-147.9, -81.4, 14, 8],
      [-155.9, -67.4, 24, 7],
      [-159.9, -49.4, 30, 7],
      [-161.9, -29.4, 27, 7],
      [-165.9, -11.4, 18, 8],
      [-173.9, 6.6, 11, 10],
      [-186.9, 24.6, 10, 12],
      [-205.9, 44.6, 10, 12],
      [-226.9, 66.6, 10, 12],
      [-250.9, 90.6, 10, 12],
    ].map((p) => Object.freeze(p)),
  ),
  step: 0.9,
  width: 2,
  wobble: Object.freeze([0.08, 0.05]),
  flow: -0.25,
  datum: Object.freeze([9, 8.109509849439533]),
  valley: Object.freeze({ floor: 1.6, shoulder: 30 }),
});
// The river's centreline, sampled (Catmull-Rom through `path`): world [x, z]
// points, the distance along the river at each, its half-width there and its
// wobble's phase there less that distance (0 while it is `width` wide).
export function riverLine({ path, step, width, datum } = SLATE_RIVER) {
  const { x: lx, z: lz } = estateLantern();
  const { points, starts } = courseSamples(
    path.map(([dx, dz, w = width, own = step]) => [lx + dx, lz + dz, w, own]),
    step,
  );
  const along = [0],
    phase = [0];
  for (let i = 1; i < points.length; i++)
    along.push(
      along[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]),
    );
  // The wobble runs `width` / half-width as fast as the distance along.
  const k0 = starts[datum[0]],
    slow = (i, j) => (along[j] - along[i]) * ((2 * width) / (points[i][2] + points[j][2]) - 1);
  phase[k0] = 0;
  for (let i = k0 + 1; i < points.length; i++) phase[i] = phase[i - 1] + slow(i - 1, i);
  for (let i = k0 - 1; i >= 0; i--) phase[i] = phase[i + 1] - slow(i, i + 1);
  return points.map(([x, z, w], i) =>
    Object.freeze([
      +x.toFixed(3),
      +z.toFixed(3),
      +(along[i] - along[k0] + datum[1]).toFixed(3),
      +w.toFixed(4),
      +phase[i].toFixed(4),
    ]),
  );
}
const RIVER_LINE = riverLine();
// A course's segments in runs of at most RIVER_RUN segments and RIVER_RUN_LENGTH
// units, each with its box and its widest half-width: a point measures only
// the runs that could hold its nearest segment.
const RIVER_RUN = 8,
  RIVER_RUN_LENGTH = 40;
const courseRuns = (() => {
  const known = new WeakMap();
  return (line) => {
    let runs = known.get(line);
    if (runs) return runs;
    runs = [];
    const length = (k) => Math.hypot(line[k + 1][0] - line[k][0], line[k + 1][1] - line[k][1]);
    for (let from = 0; from + 1 < line.length;) {
      let to = from + 1,
        span = length(from);
      while (to + 1 < line.length && to - from < RIVER_RUN && span + length(to) <= RIVER_RUN_LENGTH)
        span += length(to++);
      const ends = line.slice(from, to + 1),
        xs = ends.map(([x]) => x),
        zs = ends.map(([, z]) => z);
      runs.push(
        Object.freeze({
          from,
          to,
          box: Object.freeze([Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)]),
          widest: Math.max(...ends.map(([, , , w]) => w)),
        }),
      );
      from = to;
    }
    known.set(line, Object.freeze(runs));
    return runs;
  };
})();
export const riverRuns = (line = RIVER_LINE) => courseRuns(line);
// A world point's place on the river: its distance from the centreline (d),
// how far downstream (s), which bank (side, +1 left of the flow), the flow's
// direction there and the half-width there (w); r is the normalised radius (1
// on its wobbled shore). The nearest segment is the nearest in half-widths
// (the first of equals): only the run nearest the point and those whose boxes
// are no farther are measured.
export function riverAt(x, z, line = RIVER_LINE, river = SLATE_RIVER) {
  const runs = courseRuns(line),
    { width, wobble } = river,
    near = runs.map(
      ({ box, widest }) =>
        Math.hypot(Math.max(box[0] - x, 0, x - box[1]), Math.max(box[2] - z, 0, z - box[3])) *
        (width / widest),
    );
  let best = { key: Infinity, k: 0 };
  const measure = ({ from, to }) => {
    for (let k = from + 1; k <= to; k++) {
      const [ax, az, s0, wa, ca] = line[k - 1],
        [bx, bz, , wb, cb] = line[k],
        ex = bx - ax,
        ez = bz - az,
        len = Math.hypot(ex, ez),
        h = Math.min(1, Math.max(0, ((x - ax) * ex + (z - az) * ez) / (len * len))),
        d = Math.hypot(x - ax - ex * h, z - az - ez * h),
        w = wa + h * (wb - wa),
        key = d * (width / w);
      if (key < best.key || (key === best.key && k < best.k))
        best = {
          key,
          k,
          d,
          s: s0 + h * len,
          phase: ca + h * (cb - ca),
          side: Math.sign(ex * (z - az) - ez * (x - ax)) || 1,
          dx: ex / len,
          dz: ez / len,
          w,
        };
    }
  };
  let first = 0;
  for (let j = 1; j < runs.length; j++) if (near[j] < near[first]) first = j;
  measure(runs[first]);
  for (let j = 0; j < runs.length; j++)
    if (j !== first && near[j] <= best.key + 1e-9) measure(runs[j]);
  const { key, d, s, phase, side, dx, dz, w } = best,
    turn = s + phase;
  return {
    d,
    s,
    side,
    dx,
    dz,
    w,
    r:
      key /
      (width *
        (1 + wobble[0] * Math.sin(0.9 * turn + 1.3) + wobble[1] * Math.sin(2.3 * turn + 0.4))),
  };
}
// The river's bed and banks above its water at normalised radius r (1 on the shore).
export function riverBed(r) {
  const { depth, rise } = SLATE_RIVER_BED;
  return r < 1 ? -depth * (1 - r * r) : rise * (1 - Math.exp((-(r - 1) * 2 * depth) / rise));
}

// The moon key and the cool back-fill, world directions toward each light
// (index.js directionalPosition and world.js FILL_LIGHT_POSITION, restated: a
// test holds them equal), so the film ground can tell its lights apart.
export const MOON_LIGHTS = Object.freeze({
  key: Object.freeze([32, 28, 14]),
  fill: Object.freeze([-30, 22, -28]),
});

// How the film ground takes the night's light. The moon key rakes it and casts
// the tree's shadow across it, so it dominates: the unshadowed fill, which
// models the bark, keeps only a share here, and the flat ambient
// and hemisphere give way to
// the night sky's own light from the environment (night-environment.js),
// brighter toward the lit clouds and the horizon, which the cracks and relief
// catch. The lantern's light also comes back off its own pool and the near
// roots (bounce: the share of its light that reaches the soil from all about,
// not only from the lamp's low angle), so its warm pool spreads to the light's
// reach. Without an environment the fills and ambient stay whole.
// Behind Contact, under a shot's `poolAbout` (film-light.js), that pool (the
// lantern's direct diffuse and its bounce) passes a luminance knee (poolKnee)
// by that share, across the text guard's reach about Contact (SLATE_WATER.text[3]):
// on a portrait monitor Lantern study's push-in carries the lit crests of the
// near cobbles across the small label (3.92:1 at 1080x1920). Only the crests
// near the ceiling give way; the pool keeps its warmth and its relief.
export const SLATE_LIGHT = Object.freeze({
  key: 1.35,
  fill: 0.35,
  ambient: 0.3,
  sky: 1.5, // the environment's diffuse light, times (the open plain sees all of the sky)
  bounce: 0.18,
  poolKnee: 0.08,
});

// Water on the ground mirrors the night sky (the environment), with water's
// Fresnel (f0) on a normal levelled by the water (level: its share of the
// surface's own, unmapped normal): after the rain a film of water lies on the
// soil, film[0] of it everywhere but the dry terrace and film[1] more
// with the wet mask, in broad drained and glossy patches (patch: the noise's
// cell in units and the share it keeps at least), a little rough
// (roughness[0]) as it follows the soil; standing water (the knoll's low-spot
// pools) is whole and sharp (roughness[1]). The authored puddles take none of
// this: terrain-build.js's zone mirror draws their sky, at the sky as shown.
// The sky the water mirrors is the sky at its own radiance times gain ([film,
// standing water]), and in standing water the tree's trunk darkens it where
// it stands in the way (terrain-build.js sets slateWaterVeil; the rough film
// would only smear it). It fades with view distance
// (far), so the far plain behind the intro text stays calm.
// The moon and the lantern light the film as water too: a sharper lobe each
// (roughness, gain and a luminance knee that bounds it), so the moon glints
// across the wet soil toward its side and the lantern's glints run in streaks
// toward the eye, while the soil's own highlight stays clamped. The water's
// mirror and glints (and the soil's relaxed sky reflection) ease off behind
// the name and intro and behind Contact, text[0] of them, over text[2] of the
// screen's smaller side about the name and intro and text[3] about Contact
// (index.js measures the text: slateText, slateAbout); there all the ground
// reflects, the water and the soil's own highlights (a puddle's moon glint
// among them), then passes a luminance knee, text[1];
// beside Contact so do the bark's highlights from the lantern and the crown's
// fill (architecture.js, through SLATE_TEXT_GUARD). The knee is blended in
// over the whole reach (slateTextKnee()), never scaled into its divisor, where
// a knee that low would crush bright glare at a few percent of the guard and
// end the wet plain's moon glare in a hard wall beside the name. Half the
// screen's smaller side, the clouds' reach (estate-sky.js CLOUD_RESHAPE.text),
// lets the glare fade out along the plain; the small Contact label keeps a fifth,
// so on phones the river's image of the lantern above it stays bright.
// On the moving water the moon's shadow edge softens (`shadow`, LOOK_SHADOW).
export const SLATE_WATER = Object.freeze({
  f0: 0.02,
  text: Object.freeze([0.3, 0.035, 0.5, 0.2]),
  level: 0.7,
  film: Object.freeze([0.12, 0.18]),
  patch: Object.freeze([9, 0.55]),
  roughness: Object.freeze([0.3, 0.02]),
  gain: Object.freeze([1, 1]),
  far: Object.freeze([70.0, 130.0]),
  moon: Object.freeze({ roughness: 0.25, gain: 1, knee: 0.06 }),
  lamp: Object.freeze({ roughness: 0.18, gain: 1.6, knee: 0.35 }),
  shadow: Object.freeze({ texels: 12, taps: 12 }),
});

// The text guard's screen test, shared by the ground and the bark
// (architecture.js): slateBehindText() is 1 behind the name and intro
// (slateText) or Contact (slateAbout, slateBehindAbout(): named for About, the
// label Contact replaced), boxes in the canvas's UV, easing to 0 over
// SLATE_WATER.text[2] or text[3] of the screen's smaller side (slateAspect,
// the canvas's); vSlateClip is the fragment's
// clip-space position. slateTextKnee(c, b) takes the light c through the knee
// by b, the test's value: the knee's share, 1-(1-b)^2, stays near whole
// through the inner part of the reach, so the ground about the text stays
// calm, and the light's shown tone still fades about evenly across the reach.
export const SLATE_TEXT_GLSL = `float slateBehind(vec4 r,vec2 v,float d){vec2 f=max(max(r.xy-v,v-r.zw),0.)*vec2(slateAspect,1.)/min(slateAspect,1.);return 1.-smoothstep(0.,d,length(f));}
float slateBehindAbout(vec2 v){return slateBehind(slateAbout,v,${glslNumber(SLATE_WATER.text[3])});}
float slateBehindText(){vec2 v=vSlateClip.xy/vSlateClip.w*.5+.5;return max(slateBehind(slateText,v,${glslNumber(SLATE_WATER.text[2])}),slateBehindAbout(v));}
vec3 slateTextKnee(vec3 c,float b){return c*mix(1.,1./(1.+dot(c,vec3(.2126,.7152,.0722))/SLATE_TEXT_KNEE),b*(2.-b));}
`;
// The guard for another material: the ground's box uniforms (share the
// createSlateContacts() objects), its knee (SLATE_WATER.text[1]) and the test.
export const SLATE_TEXT_GUARD = `uniform float slateAspect;
uniform vec4 slateText, slateAbout;
#define SLATE_TEXT_KNEE ${glslNumber(SLATE_WATER.text[1])}
${SLATE_TEXT_GLSL}`;

// Contact darkening on the slate: slateContacts[i] = (x, z, radius, strength),
// darkest within 0.55 radius and gone by 1.35. The first two (the tree's roots
// and the lantern) are always on; the rest are the scattered rocks
// (rock-scatter.js), gated by slateRockContact until they appear. Uniforms, so
// shadows switching on or off (gain 0.6 with, 1 without) never recompiles.
export const SLATE_CONTACTS = 18;
// The set also holds the detail map's slot: a program reused from the cache
// keeps its first uniform objects, so a new detail map must fill the same one.
export function createSlateContacts(values = new Float32Array(SLATE_CONTACTS * 4)) {
  return {
    slateContacts: { value: values },
    slateRockContact: { value: 0 },
    slateContactGain: { value: 1 },
    slateDetail: { value: null },
    slateGrit: { value: null },
    slateRelief: { value: null },
    slateSoilRoughness: { value: null },
    slateSoilRoughnessOn: { value: 0 },
    // The name and intro, and Contact, on the canvas (x0, y0, x1, y1 in its UV,
    // y up; empty beyond it) and the canvas's aspect, for the water to ease off
    // behind them.
    slateText: { value: { x: 2, y: 2, z: -1, w: -1 } },
    slateAbout: { value: { x: 2, y: 2, z: -1, w: -1 } },
    slateAspect: { value: 1 },
    // The shot's `poolAbout` (SLATE_LIGHT.poolKnee): off until a shot asks.
    slatePoolAbout: { value: 0 },
    // The shot's subject on the plain (slateCalmFor()): its moon shadow's fade centres there.
    slateCalmAt: { value: { x: 0, y: 0, z: 0, w: 1 } },
    // The shot's look (slateCalmFor(), SLATE_LOOK), each off until a shot asks
    // for it: the clearing (its centre x, z and radii; its light and the rest
    // of the plain's share; its shade near the lens and whether it is on), the
    // mist (its colour and amount, shared with the ranges: RANGE_MIST), the
    // gloss (the film's share, its sky's gain, whether it is on) and the
    // distances from the subject over which the moon's shadow fades (none at 0).
    slateClear: { value: { x: 0, y: 0, z: 0, w: 1 } },
    slateClearLight: { value: { x: 1, y: 1, z: 1, w: 1 } },
    slateClearShade: { value: { x: 0, y: 0, z: 1, w: 0 } },
    slateMist: RANGE_MIST,
    slateGloss: { value: { x: 0, y: 0, z: 0, w: 0 } },
    // The rain pools' fill on the plain (SLATE_LOOK.pools), 0 for none.
    slatePools: { value: 0 },
    slateShadowFade: { value: { x: 0, y: 0 } },
  };
}

// A shot's `ground` about its subject: its look (SLATE_LOOK) centred on the
// subject at `at`, written in place every frame, so a cut never recompiles;
// off without a frame. The plain itself is never burned or flattened about the
// subject (photoreal, 2026-10-19): it is lit as it is.
export function slateCalmFor(contacts, shot, distance, at) {
  const ground = shot?.ground,
    a = contacts.slateCalmAt.value;
  if (!ground || !(distance > 0) || !at) {
    slateLookFor(contacts, null);
    return a;
  }
  a.x = at.x;
  a.y = at.z;
  slateLookFor(contacts, ground, shot.azimuth ?? 0, at);
  return a;
}

// A shot's look on the plain about its subject (the owner's pick of
// 2026-10-08 for Portrait: all three), each part of `ground` optional:
// - clearing: a pool of moonlight through a break in the cloud, centred
//   `toward` units from the subject toward the lens. Within radius[0] of it
//   the slate takes `light` (rgb), easing over a wobbled edge (clearing.wobble
//   of the distance, by a clearing.cell-unit noise) to `rest` of its light by
//   radius[1]; shade: [amount, near, far] darkens the slate within near units
//   of the lens by `amount`, gone by far. Keep the calm's `keep` about as wide,
//   so the clearing shows the slate's texture.
// - mist: a low moonlit mist (color, linear, and amount) over the far plain,
//   from mist.reach[0] to [1] units of view distance and varied by two noises
//   (mist.cells, mist.wisp: [floor, swing]), and over the ranges' feet
//   (hill-silhouette.js RANGE_MIST_GLSL), so the plain never meets them at a
//   hard line.
// - gloss: the plain after rain catches the sky. Its water film takes `film`
//   of the soil (SLATE_WATER.film[0] elsewhere) and its sky `gain` (gain[0]),
//   tinted from gloss.warm toward the cool gloss.tint by the shot's `cool`
//   (Portrait's whole, by default; the other wide shots' none, so their plain
//   keeps its warmth), out to gloss.far units of view distance (the
//   puddles too); all of it away from the text only, eased over gloss.text ([name and
//   intro, Contact] as shares of the screen's smaller side, as the text guard
//   measures), and in broad wetter and drier patches (gloss.patch: [cell in
//   units, the drier patches' share]).
// - shadow: [near, far]: the moon's shadow (the crown's, far out on the plain,
//   where a real shadow would be wide and soft) fades from near to far units
//   of the subject.
// - pools: after the rain water stands on the plain, filling the slate's low
//   texels to `pools` (the puddles' level units, as SLATE_PUDDLES.fill) in
//   broad wet patches (pools.cells: two noises' cells in units, weighted
//   pools.weights; standing where they pass pools.patch[0] to [1]), out to
//   pools.far units of view distance, so the puddles' mirror shows the sky in
//   them.
export const SLATE_LOOK = Object.freeze({
  clearing: Object.freeze({ wobble: 0.45, cell: 11 }),
  mist: Object.freeze({
    reach: Object.freeze([55, 190]),
    cells: Object.freeze([23, 7.1]),
    wisp: Object.freeze([0.75, 0.45]),
  }),
  gloss: Object.freeze({
    far: Object.freeze([400, 1100]),
    tint: Object.freeze([0.72, 0.88, 1.18]),
    warm: Object.freeze([1, 1, 1]),
    text: Object.freeze([0.45, 0.25]),
    patch: Object.freeze([31, 0.35]),
  }),
  pools: Object.freeze({
    cells: Object.freeze([9, 2.7]),
    weights: Object.freeze([0.65, 0.35]),
    patch: Object.freeze([0.42, 0.6]),
    far: Object.freeze([90, 160]),
  }),
});
function slateLookFor(contacts, look, azimuth = 0, at = null) {
  const clear = contacts.slateClear.value,
    light = contacts.slateClearLight.value,
    shade = contacts.slateClearShade.value,
    mist = contacts.slateMist.value,
    gloss = contacts.slateGloss.value,
    pools = contacts.slatePools,
    shadow = contacts.slateShadowFade.value;
  const clearing = look?.clearing,
    yaw = (azimuth * Math.PI) / 180;
  if (clearing && at) {
    clear.x = at.x + Math.cos(yaw) * clearing.toward;
    clear.y = at.z + Math.sin(yaw) * clearing.toward;
    clear.z = clearing.radius[0];
    clear.w = Math.max(clearing.radius[1], clearing.radius[0] + 0.01);
    [light.x, light.y, light.z] = clearing.light;
    light.w = clearing.rest;
    [shade.x, shade.y] = clearing.shade;
    shade.z = Math.max(clearing.shade[2], clearing.shade[1] + 0.01);
    shade.w = 1;
  } else shade.w = 0;
  if (look?.mist) {
    [mist.x, mist.y, mist.z] = look.mist.color;
    mist.w = look.mist.amount;
  } else mist.w = 0;
  if (look?.gloss) {
    gloss.x = look.gloss.film;
    gloss.y = look.gloss.gain;
    gloss.z = 1;
    gloss.w = look.gloss.cool ?? 1;
  } else gloss.z = 0;
  pools.value = look?.pools ?? 0;
  const fade = look?.shadow;
  shadow.x = fade ? fade[0] : 0;
  shadow.y = fade ? Math.max(fade[1], fade[0] + 0.01) : 0;
}

const glslVec = (values) => `vec${values.length}(${values.map(glslNumber).join(",")})`;
const glslPoint = ({ x, z }) => glslVec([+x.toFixed(2), +z.toFixed(2)]);
const TREE_GLSL = glslPoint(ESTATE.tree);
const PATH_LENGTH = glslNumber(
  +Math.hypot(ESTATE.tree.x - ESTATE.watch.x, ESTATE.tree.z - ESTATE.watch.z).toFixed(2),
);
const SECOND = SLATE_TILING.second,
  DETAIL = SLATE_TILING.detail,
  CLOSE = SLATE_CLOSE,
  CLOSE_TEXEL = glslNumber(1 / SLATE_CLOSE.texels);
const FAR = SLATE_FAR,
  FAR_SWATHE = FAR.swathes.cells
    .map((cell, i) => {
      const offset = FAR.swathes.offsets[i];
      return `${glslNumber(FAR.swathes.weights[i])}*slateNoise(slateFarP/${glslNumber(cell)}${offset ? "+" + glslNumber(offset) : ""})`;
    })
    .join("+"),
  FAR_TILE = FAR.tile.map(
    ({ scale, turn, offset }) =>
      `texture2D(map,${turn ? `mat2(${turn.map(glslNumber)})*` : ""}vMapUv*${glslNumber(scale)}+${glslVec(offset)}).rgb`,
  );
// Near the lens the slate's mid-scale blotches, enlarged there, give way to its
// broad tone (the tile blend `blur` mip levels down, `calm` of it), and the close
// soil's two lookups, blended by a noise, carry the detail: its grit on the
// albedo after the map and the settled soil.
const SOIL_SAMPLE = `
#if __VERSION__ >= 300 || defined(GL_EXT_shader_texture_lod)
#define SLATE_SOIL_GRAD
vec4 slateSoilSample(sampler2D t, vec2 uv, vec2 dx, vec2 dy) { return texture2DGradEXT(t,uv,dx,dy); }
#else
vec4 slateSoilSample(sampler2D t, vec2 uv, vec2 dx, vec2 dy) { return texture2D(t,uv); }
#endif
`;
const CLOSE_PRE = `
      vec2 slateCU = vMudWorld.xz/${glslNumber(CLOSE.tile)}, slateCV = mat2(${CLOSE.second.turn.map(glslNumber)})*slateCU*${glslNumber(CLOSE.second.scale)}+${glslVec(CLOSE.second.offset)};
      float slateCW = smoothstep(.3, .7, slateNoise(vMudWorld.xz/${glslNumber(CLOSE.blendCell)})), slateCN = 1.-smoothstep(${CLOSE.near.map(glslNumber)}, length(vViewPosition));
      // Derivatives belong outside the distance branch. Explicit gradients retain
      // mip filtering at its boundary; WebGL1 without the extension samples whole.
      vec2 slateCUX=dFdx(slateCU), slateCUY=dFdy(slateCU), slateCVX=dFdx(slateCV), slateCVY=dFdy(slateCV), slateBlendD=vec2(dFdx(slateCW),dFdy(slateCW)), slateMapX=dFdx(vMapUv), slateMapY=dFdy(vMapUv), slateMapBX=dFdx(slateUvB), slateMapBY=dFdy(slateUvB);
      float slateCHU=.5, slateCHV=.5, slateCG=.5, slateCH=.5, slateSoilMask=1., slateSoilRough=.0;
      vec2 slateCDH=vec2(0.);
      #ifdef SLATE_SOIL_GRAD
      if(slateCN>0.) {
      #endif
      slateCHU = slateSoilSample(slateRelief, slateCU, slateCUX, slateCUY).r;
      slateCHV = slateSoilSample(slateRelief, slateCV, slateCVX, slateCVY).r;
      slateCG = mix(slateSoilSample(slateGrit, slateCU, slateCUX, slateCUY).r, slateSoilSample(slateGrit, slateCV, slateCVX, slateCVY).r, slateCW);
      slateCH = mix(slateCHU, slateCHV, slateCW);
      // A smaller, differently turned photographic grain breaks up the broad
      // compacted soil. Its frequency is filtered with its own gradients.
      vec2 slateFine=mat2(.8,.6,-.6,.8)*slateCU*2.6+vec2(.19,.73);
      slateCG += (slateSoilSample(slateGrit,slateFine,mat2(.8,.6,-.6,.8)*slateCUX*2.6,mat2(.8,.6,-.6,.8)*slateCUY*2.6).r-.5)*.35;
      // The relief's slope per world unit, from each lookup's next texels (the second's turned and scaled back).
      slateCDH = mix(vec2(slateSoilSample(slateRelief, slateCU+vec2(${CLOSE_TEXEL}, 0.),slateCUX,slateCUY).r, slateSoilSample(slateRelief, slateCU+vec2(0., ${CLOSE_TEXEL}),slateCUX,slateCUY).r)-slateCHU,
        (vec2(slateSoilSample(slateRelief, slateCV+vec2(${CLOSE_TEXEL}, 0.),slateCVX,slateCVY).r, slateSoilSample(slateRelief, slateCV+vec2(0., ${CLOSE_TEXEL}),slateCVX,slateCVY).r)-slateCHV)*mat2(${CLOSE.second.turn.map(glslNumber)})*${glslNumber(CLOSE.second.scale)}, slateCW)*${glslNumber(CLOSE.texels / CLOSE.tile)};
      if(slateSoilRoughnessOn>.5) slateSoilRough=mix(slateSoilSample(slateSoilRoughness,slateCU,slateCUX,slateCUY).r,slateSoilSample(slateSoilRoughness,slateCV,slateCVX,slateCVY).r,slateCW)-.9450162551;
      sampledDiffuseColor.rgb = mix(sampledDiffuseColor.rgb, mix(slateSoilSample(map,vMapUv,slateMapX*${glslNumber(2 ** CLOSE.blur)},slateMapY*${glslNumber(2 ** CLOSE.blur)}).rgb, slateSoilSample(map,slateUvB,slateMapBX*${glslNumber(2 ** CLOSE.blur)},slateMapBY*${glslNumber(2 ** CLOSE.blur)}).rgb, slateW)*(.93+.14*slateNoise(vMudWorld.xz/${glslNumber(SLATE_TILING.macroCell)})), ${glslNumber(CLOSE.calm)}*slateCN);
      #ifdef SLATE_SOIL_GRAD
      }
      #endif
      vec2 slateKP = vMudWorld.xz/${glslNumber(CLOSE.crumb.cell)}, slateKI = floor(slateKP), slateKF = fract(slateKP), slateKD = vec2(0.);
      float slateKW = slateCN*smoothstep(${CLOSE.crumb.fade.map(glslNumber)}, 1./max(length(fwidth(slateKP)), 1e-4)), slateK1 = 1.;
      // Only where the crumbs show (near the lens, a cell over a few pixels): the
      // nearest grain by a smooth minimum, and its slope per world unit.
      if (slateKW > 0.) {
        float slateKS = 0.;
        for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
          vec2 slateKG = vec2(float(i), float(j));
          vec3 slateKH = fract(vec3(slateKI+slateKG, slateKI.x+slateKG.x)*vec3(.1031, .103, .0973));
          slateKH += dot(slateKH, slateKH.yzx+33.33);
          vec2 slateKO = fract((slateKH.xx+slateKH.yz)*slateKH.zy)-slateKF+slateKG;
          float slateKE = exp(-${glslNumber(CLOSE.crumb.round)}*dot(slateKO, slateKO));
          slateKS += slateKE;
          slateKD += slateKE*slateKO;
        }
        slateK1 = -log(slateKS)/${glslNumber(CLOSE.crumb.round)};
        slateKD *= -2./(slateKS*${glslNumber(CLOSE.crumb.cell)});
      }
      float slateCrumb = (1.-smoothstep(0., .6, slateK1))-.4, slateKT = clamp(slateK1/.6, 0., 1.);
      slateCH += slateCrumb*${glslNumber(CLOSE.crumb.height)}*slateKW;
      // The crumbs' own slope, its tangent eased toward SLATE_CLOSE.crumb.steep at most.
      vec2 slateKG = 10.*slateKT*(1.-slateKT)*slateKD*${glslNumber(CLOSE.crumb.height)}*slateKW;
      slateCDH -= slateKG/(1.+length(slateKG)*${glslNumber(CLOSE.relief / CLOSE.crumb.steep)});
      slateCG += slateCrumb*${glslNumber(CLOSE.crumb.albedo)}*slateKW;
      `;
const CLOSE_MAP = `
      diffuseColor.rgb *= 1.+(slateCG-.5)*${glslNumber(CLOSE.albedo)}*slateCN*(1.-slatePuddle)*slateSoilMask;`;
// Its relief on the normal (as three's perturbNormalArb()), the height's change
// across a pixel taken from its slope at that pixel (and the lookups' slowly
// varying blend), faded where a texel shrinks below a pixel and under water.
const CLOSE_NORMAL = `
      float slateCF = slateCN*smoothstep(${CLOSE.footprint.map(glslNumber)}, ${glslNumber(CLOSE.featureTexels)}/max(length(fwidth(slateCU))*${glslNumber(CLOSE.texels)}, 1e-4))*(1.-slatePuddle);
      vec3 slateSX = dFdx(-vViewPosition), slateSY = dFdy(-vViewPosition), slateR1 = cross(slateSY, normal), slateR2 = cross(normal, slateSX);
      float slateDet = dot(slateSX, slateR1);
      vec2 slateDH = (vec2(dot(slateCDH, dFdx(vMudWorld.xz)), dot(slateCDH, dFdy(vMudWorld.xz)))+slateBlendD*(slateCHV-slateCHU))*${glslNumber(CLOSE.relief)}*slateCF;
      // The silt bar's ripple marks, across the flow (SLATE_BANKS.silt.ripple).
      float slateRipple = sin(6.2832*(slateStreamQ.y*${glslNumber(SLATE_BANKS.silt.ripple[0])}+.35*slateNoise(vec2(slateStreamQ.y*1.7, slateStreamQ.z*slateStreamQ.w*2.3))))*${glslNumber(SLATE_BANKS.silt.ripple[1])}*slateSilt*slateCN;
      slateDH += vec2(dFdx(slateRipple), dFdy(slateRipple));
      normal = normalize(abs(slateDet)*normal-sign(slateDet)*(slateDH.x*slateR1+slateDH.y*slateR2));`;
// Each zone: 1 inside half its radius, 0 at its radius.
const PUDDLE_ZONES_GLSL = SLATE_PUDDLES.zones.map(
  ({ anchor, deg, dist, radius, stretch = 1, along = 0 }) => {
    const offset = `(vMudWorld.xz-${glslPoint(estatePoint(anchor, deg, dist))})`,
      c = +Math.cos((along * Math.PI) / 180).toFixed(4),
      s = +Math.sin((along * Math.PI) / 180).toFixed(4);
    const local =
      stretch === 1
        ? offset
        : `mat2(${[c, -s, s, c].map(glslNumber)})*${offset}/vec2(${glslNumber(stretch)},1.)`;
    return `1.-smoothstep(.5,1.,length(${local})/${glslNumber(radius)})`;
  },
);
// The drip-line and Portrait puddles' zones; the river takes its own level
// and mask from its shape (SLATE_RIVER_BED).
const PUDDLE_GLSL = PUDDLE_ZONES_GLSL.reduce((all, zone) => `max(${all},${zone})`);
// slateStreamAt(p, dir, join): the streams at a world point (SLATE_STREAMS):
// (weight, 1 within a course's middle easing to 0 at its edge; distance
// along it from its head; place across it, -.5 to .5 on its banks; its width),
// the flow's direction in dir, and in join the weight of the next course there
// (where courses meet). Each course is tried only within its box grown by its
// widest half-width.
const STREAM_LINES = streamLines();
// The stream's water at a world x/z (rock-build.js seats its stones by it): its
// level below the lantern's foot where its course passes nearest, the river's
// where it leaves the river, falling `bed.drop` toward its head.
export function streamWater(x, z, lines = STREAM_LINES, { bed } = SLATE_STREAMS) {
  let best = Infinity,
    level = bed.level;
  for (const { points, levels } of lines)
    for (let k = 1; k < points.length; k++) {
      const [ax, az, s0] = points[k - 1],
        [bx, bz, s1] = points[k],
        ex = bx - ax,
        ez = bz - az,
        h = Math.min(1, Math.max(0, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez))),
        d = Math.hypot(x - ax - ex * h, z - az - ez * h);
      if (d < best) {
        best = d;
        level = levels[k - 1] + (levels[k] - levels[k - 1]) * h;
      }
    }
  return level;
}
const STREAM_GLSL = (() => {
  const { meander, wobble, bed } = SLATE_STREAMS;
  const n = (v) => glslNumber(+v.toFixed(4));
  const courses = STREAM_LINES.map(({ points, widths, bends }) => {
    const pad = (Math.max(...widths) / 2) * bed.reach[1] + 0.05,
      xs = points.map(([x]) => x),
      zs = points.map(([, z]) => z);
    const segments = points.slice(1).map(([bx, bz, s1], k) => {
      const [ax, az, s0] = points[k],
        ex = bx - ax,
        ez = bz - az,
        len = Math.hypot(ex, ez);
      return `pa=p-vec2(${n(ax)},${n(az)});ba=vec2(${n(ex)},${n(ez)});h=clamp(dot(pa,ba)*${n(1 / (len * len))},0.,1.);d=${n(widths[k])}+h*${n(widths[k + 1] - widths[k])};w=length(pa-ba*h)/d;if(w<c.x){c=vec4(w,${n(s0)}+h*${n(len)},(pa.x*ba.y-pa.y*ba.x)*${n(1 / len)}/d,d);cd=ba*${n(1 / len)};cb=${n(bends[k])}+h*${n(bends[k + 1] - bends[k])};}`;
    });
    // The nearest segment (in widths) gives the place along and across; the weight follows from it.
    return `if(p.x>${n(Math.min(...xs) - pad)}&&p.x<${n(Math.max(...xs) + pad)}&&p.y>${n(Math.min(...zs) - pad)}&&p.y<${n(Math.max(...zs) + pad)}){c=vec4(1e9,0.,0.,1.);cd=vec2(1.,0.);
${segments.join("\n")}
w=1.-smoothstep(.3,.5,c.x);if(c.x<r){join=max(join,q.x);r=c.x;q=c;q.x=w;dir=cd;bend=cb;}else join=max(join,w);}`;
  });
  return `vec4 slateStreamAt(vec2 p,out vec2 dir,out float join,out float r,out float bend){p+=(vec2(slateNoise(p*${glslNumber(wobble)}),slateNoise(p*${glslNumber(wobble)}+7.3))-.5)*${glslNumber(meander * 2)};
vec4 q=vec4(0.,0.,0.,1.),c;vec2 pa,ba,cd;float h,d,w,cb=0.;dir=vec2(1.,0.);join=0.;r=1e9;bend=0.;
${courses.join("\n")}
r*=2.;return q;}
float slateStreamBed(float r,float w,float side){float k=${glslNumber(bed.depth)}*min(1.,w*${glslNumber(+(1 / bed.full).toFixed(4))})*(1.+${glslNumber(bed.skew)}*side),R=${glslNumber(bed.rise)}*(1.+${glslNumber(+(bed.cut - 1).toFixed(4))}*max(side,0.));return r<1.?-k*(1.-r*r):R*(1.-exp(-(r-1.)*2.*k/R));}
`;
})();
// The streams' water level (slateStreamR, their normalised radius, found once), as the river's.
const STREAM_LEVEL = `mix(-slateStreamBed(slateStreamR,slateStreamQ.w,clamp(2.*slateStreamQ.z,-1.,1.)*slateStreamBend)*${glslNumber(SLATE_STREAMS.bed.shore)}-(slateH-.5)*${glslNumber(SLATE_STREAMS.bed.texel)},-1.,smoothstep(${SLATE_STREAMS.bed.reach.map(glslNumber)},slateStreamR))`;
// slateRiver(p, dir): the river at a world point, as riverAt() finds it:
// (normalised radius, distance downstream, signed distance across, distance),
// and the flow's direction in dir. Its segments go in its runs (courseRuns()),
// each tried only within its box grown by the bank's widest reach there
// (beyond that the point is no river), so a point tries about one run.
// Outside them all, the radius is about 1e9. While the river is `width` wide
// all along, a segment is the nearest by distance and every segment is written
// out (past RIVER_GROUP runs, boxed again in fours); else the nearest in
// half-widths, its segments and boxes in constant arrays walked by loops, so a
// long course compiles about as fast as a short one.
const RIVER_GROUP = 8;
export function riverGlsl(line = RIVER_LINE, river = SLATE_RIVER, bed = SLATE_RIVER_BED) {
  const { width, wobble } = river,
    even = line.every(([, , , w, c]) => w === width && c === 0),
    reach = (widest) => widest * bed.reach[1] * (1 + wobble[0] + wobble[1]) + 0.5;
  const n = (v) => glslNumber(+v.toFixed(4));
  if (!even) {
    // A long course compiles slowly unrolled (a driver's compile time grows with every segment):
    // its segments ([start, step] and [distance down, half-width, its change, wobble phase]) and
    // run boxes go in constant arrays instead, walked by two loops. A segment's length and its
    // wobble phase's change (riverLine()) follow from those.
    const all = courseRuns(line),
      v4 = (values) => `vec4(${values.map(n).join(",")})`,
      seg = [[], []];
    for (let k = 0; k + 1 < line.length; k++) {
      const [ax, az, s0, wa, ca] = line[k],
        [bx, bz, , wb] = line[k + 1];
      seg[0].push(v4([ax, az, bx - ax, bz - az]));
      seg[1].push(v4([s0, wa, wb - wa, ca]));
    }
    const boxes = all.map(({ box, widest }) => {
        const pad = reach(widest);
        return v4([box[0] - pad, box[1] + pad, box[2] - pad, box[3] + pad]);
      }),
      spans = all.map(({ from, to }) => `ivec2(${from},${to})`);
    return `const vec4 slateRiverBox[${all.length}]=vec4[](${boxes.join(",")});
const ivec2 slateRiverSpan[${all.length}]=ivec2[](${spans.join(",")});
const vec4 slateRiverA[${seg[0].length}]=vec4[](${seg[0].join(",")});
const vec4 slateRiverB[${seg[0].length}]=vec4[](${seg[1].join(",")});
vec4 slateRiver(vec2 p,out vec2 dir){dir=vec2(1.,0.);
float b=1e9,s=0.,g=0.,c=1e9;
for(int r=0;r<${all.length};r++){vec4 q=slateRiverBox[r];if(p.x>q.x&&p.x<q.y&&p.y>q.z&&p.y<q.w){ivec2 u=slateRiverSpan[r];for(int k=u.x;k<u.y;k++){vec4 A=slateRiverA[k],B=slateRiverB[k];vec2 pa=p-A.xy,ba=A.zw;float l=dot(ba,ba),h=clamp(dot(pa,ba)/l,0.,1.),e=length(pa-ba*h),d=e*${n(width)}/(B.y+h*B.z);if(d<b){l=sqrt(l);b=d;s=B.x+h*l;g=B.w+h*l*(${n(2 * width)}/(2.*B.y+B.z)-1.);dir=ba/l;c=pa.x*ba.y-pa.y*ba.x<0.?e:-e;}}}}
return vec4(b/(${n(width)}*(1.+${n(wobble[0])}*sin(.9*(s+g)+1.3)+${n(wobble[1])}*sin(2.3*(s+g)+.4))),s,c,abs(c));}
`;
  }
  // One width all along: each segment unrolled, the nearest by distance.
  const segment = (k) => {
    const [ax, az, s0] = line[k],
      [bx, bz] = line[k + 1],
      ex = bx - ax,
      ez = bz - az,
      len = Math.hypot(ex, ez);
    return `pa=p-vec2(${n(ax)},${n(az)});ba=vec2(${n(ex)},${n(ez)});h=clamp(dot(pa,ba)*${n(1 / (len * len))},0.,1.);d=length(pa-ba*h);if(d<b){b=d;s=${n(s0)}+h*${n(len)};dir=ba*${n(1 / len)};c=pa.x*ba.y-pa.y*ba.x<0.?1.:-1.;}`;
  };
  const boxed = (box, pad, body) =>
    `if(p.x>${n(box[0] - pad)}&&p.x<${n(box[1] + pad)}&&p.y>${n(box[2] - pad)}&&p.y<${n(box[3] + pad)}){\n${body}}`;
  const runs = courseRuns(line).map(({ from, to, box, widest }) =>
    boxed(
      box,
      reach(widest),
      Array.from({ length: to - from }, (_, j) => segment(from + j)).join("\n"),
    ),
  );
  let body = runs;
  if (runs.length > RIVER_GROUP) {
    const all = courseRuns(line);
    body = [];
    for (let j = 0; j < all.length; j += 4) {
      const group = all.slice(j, j + 4),
        grown = group.map(({ box, widest }) =>
          box.map((v, i) => v + (i % 2 ? 1 : -1) * reach(widest)),
        );
      body.push(
        boxed(
          [
            Math.min(...grown.map((b) => b[0])),
            Math.max(...grown.map((b) => b[1])),
            Math.min(...grown.map((b) => b[2])),
            Math.max(...grown.map((b) => b[3])),
          ],
          0,
          runs.slice(j, j + 4).join("\n"),
        ),
      );
    }
  }
  return `vec4 slateRiver(vec2 p,out vec2 dir){dir=vec2(1.,0.);
vec2 pa,ba;float h,d,b=1e9,s=0.,c=1.;
${body.join("\n")}
return vec4(b/(${n(width)}*(1.+${n(wobble[0])}*sin(.9*s+1.3)+${n(wobble[1])}*sin(2.3*s+.4))),s,c*b,b);}
`;
}
const RIVER_GLSL = riverGlsl();
const RIVER_BED_GLSL = `${RIVER_GLSL}float slateRiverBed(float r){return r<1.?${glslNumber(-SLATE_RIVER_BED.depth)}*(1.-r*r):${glslNumber(SLATE_RIVER_BED.rise)}*(1.-exp(-(r-1.)*${glslNumber(+((2 * SLATE_RIVER_BED.depth) / SLATE_RIVER_BED.rise).toFixed(4))}));}
`;
// The river's water level (slateRiverR is its normalised radius, found once).
const RIVER_LEVEL = `mix(-slateRiverBed(slateRiverR)*${glslNumber(SLATE_RIVER_BED.shore)}-(slateH-.5)*${glslNumber(SLATE_RIVER_BED.texel)},-1.,smoothstep(${SLATE_RIVER_BED.reach.map(glslNumber)},slateRiverR))`;
const LUMA = "vec3(.2126,.7152,.0722)";
// The plain's edge: from [0] to [1] units out along either axis (its square)
// the slate meets the far plain's air, and a shot's look meets the ranges'.
const PLAIN_EDGE = `smoothstep(${glslNumber(155)}, ${glslNumber(190)}, max(abs(vMudWorld.x),abs(vMudWorld.z)))`;
// The far plain's swathes, then its tile structure (SLATE_FAR), after the calm,
// fading out toward the plain's edge with its air, so no blotch meets that air at
// a line. Its darker blotches darken the albedo the cracks read (slateCrack), so
// the wet sheen comes and goes with them far out. Behind Contact (slateBehindAbout(),
// its share eased in as the text knee's is) the lighter swathes and blotches ease
// to the soil's own tone and only the darker ones stay: in Close-up and, on
// landscape phones, Masonry study, the plain's lit blotches behind the small label
// read 4.49:1 at 1080x1920 and 4.89:1 at 844x390.
const FAR_ABOUT =
  "float slateFarA=slateBehindAbout(vSlateClip.xy/vSlateClip.w*.5+.5);slateFarA*=2.-slateFarA;";
const FAR_MAP = `
      {float slateFarD=length(vViewPosition),slateFarF=smoothstep(${FAR.swathes.near.map(glslNumber)},slateFarD)*(1.-${PLAIN_EDGE});vec2 slateFarP=vMudWorld.xz;${FAR_ABOUT}
      float slateFarS=${FAR_SWATHE};float slateFarH=slateNoise(slateFarP/${glslNumber(FAR.swathes.hueCell)}+${glslNumber(FAR.swathes.hueOffset)});
      vec3 slateFarC=(${glslNumber(1 - FAR.swathes.amount)}+${glslNumber(2 * FAR.swathes.amount)}*slateFarS)*mix(${glslVec(FAR.swathes.cool)},${glslVec(FAR.swathes.warm)},slateFarH);
      sampledDiffuseColor.rgb*=mix(vec3(1.),min(slateFarC,mix(slateFarC,vec3(1.),slateFarA)),slateFarF);}
      {float slateFarD=length(vViewPosition),slateFarF=smoothstep(${FAR.near.map(glslNumber)},slateFarD)*(1.-${PLAIN_EDGE});vec3 slateFarW=vec3(.2126,.7152,.0722);float slateFarM=dot(slateMean,slateFarW);${FAR_ABOUT}
      vec3 slateFarT1=${FAR_TILE[0]},slateFarT2=${FAR_TILE[1]};
      float slateFarL=${glslNumber(FAR.tile[0].weight)}*dot(slateFarT1,slateFarW)/slateFarM+${glslNumber(FAR.tile[1].weight)}*dot(slateFarT2,slateFarW)/slateFarM;
      float slateFarC=clamp(pow(slateFarL,${glslNumber(FAR.gain)}),${FAR.range.map(glslNumber)});
      sampledDiffuseColor.rgb*=mix(1.,min(slateFarC,mix(slateFarC,1.,slateFarA)),slateFarF);}`;
// The shot's look (SLATE_LOOK, slateCalmFor()): its uniforms and helpers.
// slateGlossSet(), before the lights: the gloss away from the name, the intro
// and Contact (slateGlossT) and, in wetter and drier patches, its share there
// (slateGlossW); both 0 without a gloss, and only then is anything computed.
// slateWaterFar(d): the water's fade at view distance d, reaching gloss.far
// under a gloss. slateTextGap(): how far a point lies outside a text box, as
// slateBehind() measures it.
const LOOK = SLATE_LOOK;
const POOLS = LOOK.pools;
const LOOK_GLSL = `uniform vec4 slateClear, slateClearLight, slateClearShade, slateMist, slateGloss;
uniform vec2 slateShadowFade;
uniform float slatePools;
float slatePoolsAt(float h,float d){if(slatePools<=0.)return -1.;float n=${POOLS.cells.map((cell, i) => `${glslNumber(POOLS.weights[i])}*slateNoise(vMudWorld.xz/${glslNumber(cell)}${i ? "+" + glslNumber(5.1) : ""})`).join("+")};return mix(slatePools*smoothstep(${POOLS.patch.map(glslNumber).join(",")},n)-h,-1.,smoothstep(${POOLS.far.map(glslNumber).join(",")},d));}
float slateGlossT = 0.0, slateGlossW = 0.0;
float slateTextGap(vec4 r,vec2 v){return length(max(max(r.xy-v,v-r.zw),0.)*vec2(slateAspect,1.)/min(slateAspect,1.));}
float slateWaterFar(float d){return smoothstep(mix(${glslNumber(SLATE_WATER.far[0])},${glslNumber(LOOK.gloss.far[0])},slateGlossT),mix(${glslNumber(SLATE_WATER.far[1])},${glslNumber(LOOK.gloss.far[1])},slateGlossT),d);}
void slateGlossSet(){if(slateGloss.z>0.){vec2 v=vSlateClip.xy/vSlateClip.w*.5+.5;slateGlossT=smoothstep(0.,${glslNumber(LOOK.gloss.text[0])},slateTextGap(slateText,v))*smoothstep(0.,${glslNumber(LOOK.gloss.text[1])},slateTextGap(slateAbout,v));slateGlossW=slateGlossT*mix(${glslNumber(LOOK.gloss.patch[1])},1.,smoothstep(.35,.7,slateNoise(vMudWorld.xz/${glslNumber(LOOK.gloss.patch[0])})));}}
`;
// After the shadow maps' functions: the moon's shadow fades with distance from
// the subject under a shot's look (slateShadowFade: near, far; whole at 0). On
// the moving water (slateShadowWater, the river's and the stream's share there,
// which terrain-build.js sets) its edge softens over SLATE_WATER.shadow's
// `texels` of the map: `taps` single taps in a disc (a Vogel spiral) about the
// filtered one, so the trunk's shadow across the rippled water has no ruled line.
const SHADOW_SOFT = SLATE_WATER.shadow;
const SHADOW_WATER = SHADOW_SOFT.texels
  ? `if(slateShadowWater>0.){vec3 c=coord.xyz/coord.w;c.z+=bias;if(c.z<=1.){float b=0.;for(int i=0;i<${SHADOW_SOFT.taps};i++){float t=float(i)+.5;b+=texture2DCompare(map,clamp(c.xy+vec2(cos(t*2.39996),sin(t*2.39996))*sqrt(t/${glslNumber(SHADOW_SOFT.taps)})*${glslNumber(SHADOW_SOFT.texels)}/size,0.,1.),c.z);}s=mix(s,(s+b)/${glslNumber(SHADOW_SOFT.taps + 1)},slateShadowWater);}}`
  : "";
const LOOK_SHADOW = `#include <shadowmap_pars_fragment>
float slateShadowWater = 0.0;
#ifdef USE_SHADOWMAP
float slateShadow(sampler2D map,vec2 size,float bias,float radius,vec4 coord){float s=getShadow(map,size,bias,radius,coord);${SHADOW_WATER}return slateShadowFade.y>0.?mix(1.,s,1.-smoothstep(slateShadowFade.x,slateShadowFade.y,length(vMudWorld.xz-slateCalmAt.xy))):s;}
#define getShadow slateShadow
#endif`;
// Last: the clearing (its light, and its shade near the lens) and the mist,
// each only under a shot's look. At the plain's edge the rest of the plain
// keeps its light and the mist is whole, as on the ranges' feet.
const LOOK_AFTER = `
      if (slateClearShade.w > 0.) {
        float slateCR = length(vMudWorld.xz-slateClear.xy)*(1.+${glslNumber(LOOK.clearing.wobble)}*(slateNoise(vMudWorld.xz/${glslNumber(LOOK.clearing.cell)})-.5));
        gl_FragColor.rgb *= mix(1.-slateClearShade.x, 1., smoothstep(slateClearShade.y, slateClearShade.z, length(vViewPosition)))*mix(vec3(mix(slateClearLight.w, 1., ${PLAIN_EDGE})), slateClearLight.rgb, 1.-smoothstep(slateClear.z, slateClear.w, slateCR));
      }
      if (slateMist.w > 0.) {
        float slateMN = slateNoise(vMudWorld.xz/${glslNumber(LOOK.mist.cells[0])})*.65+slateNoise(vMudWorld.xz/${glslNumber(LOOK.mist.cells[1])}+3.7)*.35;
        gl_FragColor.rgb = mix(gl_FragColor.rgb, slateMist.rgb, clamp(smoothstep(${LOOK.mist.reach.map(glslNumber)}, length(vViewPosition))*mix(${glslNumber(LOOK.mist.wisp[0])}+${glslNumber(LOOK.mist.wisp[1])}*slateMN, 1., ${PLAIN_EDGE}), 0., 1.)*slateMist.w);
      }`;
const WATER = SLATE_WATER,
  LIGHT = SLATE_LIGHT;
// The film ground's own direct light (SLATE_LIGHT): it finds the key and the
// fill among the directional lights by their fixed directions and the lantern
// by its warm colour. Three's light loops fetch each light through
// get*LightInfo(), so wrapping those marks a directional one (slateDirectional):
// where the lantern lines up with the key from some spot on the ground, it
// stays the lantern's.
// Where the soil is wet (slateWetLamp, set before the lights) the moon and the
// lantern also light the water film over it (SLATE_WATER.moon, .lamp), on the
// water's normal (slateWaterN), into slateMoonSpec and slateLampSpec.
// Behind Contact, under a shot's poolAbout (slatePoolAbout), the lantern's pool
// passes its knee (SLATE_LIGHT.poolKnee): slatePoolKnee() is what the knee takes
// off it, by 1-(1-b)^2 of the guard's value b, as slateTextKnee() blends.
// The root shading (terrain-build.js) wraps this function in turn.
const MOONLIT_LIGHTS = `
bool slateDirectional = false;
#if NUM_DIR_LIGHTS > 0
void slateDirectionalInfo(const in DirectionalLight light, out IncidentLight incident) {
  getDirectionalLightInfo(light, incident);
  slateDirectional = true;
}
#define getDirectionalLightInfo slateDirectionalInfo
#endif
#if NUM_POINT_LIGHTS > 0
void slatePointInfo(const in PointLight light, const in vec3 position, out IncidentLight incident) {
  getPointLightInfo(light, position, incident);
  slateDirectional = false;
}
#define getPointLightInfo slatePointInfo
#endif
vec3 slateWaterN = vec3(0.0, 0.0, 1.0), slateLampSpec = vec3(0.0), slateMoonSpec = vec3(0.0);
float slateWetFilm = 0.0, slateSkyVis = 1.0, slateWaterVeil = 0.0;
vec3 slateWaterTilt = vec3(0.0);
vec3 slateWaterBark = vec3(0.0);
vec3 slateWaterLobe(const in IncidentLight light, const in vec3 viewDir, const in PhysicalMaterial material, const in float roughness) {
  PhysicalMaterial slateWM = material;
  slateWM.roughness = roughness;
  slateWM.specularColor = vec3(${glslNumber(WATER.f0)});
  slateWM.specularF90 = 1.0;
  return saturate(dot(slateWaterN, light.direction))*light.color*BRDF_GGX(light.direction, viewDir, slateWaterN, slateWM)*slateWetFilm;
}
uniform float slatePoolAbout;
vec3 slatePoolKnee(const in IncidentLight light, const in vec3 normal, const in PhysicalMaterial material) {
  float slatePN = saturate(dot(normal, light.direction));
  #ifdef USE_ENVMAP
  slatePN += ${glslNumber(LIGHT.bounce)};
  #endif
  vec3 slatePool = slatePN*light.color*BRDF_Lambert(material.diffuseColor);
  float slatePB = slatePoolAbout*slateBehindAbout(vSlateClip.xy/vSlateClip.w*.5+.5);
  return slatePool*slatePB*(2.0-slatePB)*(1.0-1.0/(1.0+dot(slatePool, ${LUMA})/${glslNumber(LIGHT.poolKnee)}));
}
void RE_Direct_Moonlit(const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight) {
  IncidentLight slateL = directLight;
  bool slateWarm = directLight.color.b < .7*directLight.color.r;
  bool slateKey = slateDirectional && !slateWarm && dot(directLight.direction, normalize(mat3(viewMatrix)*babelKeyDir)) > .9999;
  #ifdef USE_ENVMAP
  if (!slateWarm) slateL.color *= slateKey ? ${glslNumber(LIGHT.key)} : ${glslNumber(LIGHT.fill)};
  #endif
  RE_Direct_Physical(slateL, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight);
  #ifdef USE_ENVMAP
  if (slateWarm) reflectedLight.directDiffuse += ${glslNumber(LIGHT.bounce)}*slateL.color*BRDF_Lambert(material.diffuseColor);
  #endif
  if (slateWarm && slatePoolAbout > 0.0) reflectedLight.directDiffuse -= slatePoolKnee(slateL, geometryNormal, material);
  if (slateWetFilm > 0.0) {
    if (slateWarm) slateLampSpec += slateWaterLobe(slateL, geometryViewDir, material, ${glslNumber(WATER.lamp.roughness)});
    else if (slateKey) slateMoonSpec += slateWaterLobe(slateL, geometryViewDir, material, ${glslNumber(WATER.moon.roughness)});
  }
}
#undef RE_Direct
#define RE_Direct RE_Direct_Moonlit
`;
// Before the lights: the water's normal (the film's levelled by it, standing
// water's level: the world's up) and the water film's share
// of the wet soil (none in a puddle, which mirrors the lights on its own).
const WATER_BEFORE_LIGHTS = `slateGlossSet();
      slateWaterN = normalize(mix(mix(normal, nonPerturbedNormal, ${glslNumber(WATER.level)}), mat3(viewMatrix)[1], slatePuddle)+slateWaterTilt);
      slateWetFilm = (mix(${glslNumber(WATER.film[0])}, slateGloss.x, slateGlossW)*(1.0-slateDry)+${glslNumber(WATER.film[1])}*slateWet)*mix(${glslNumber(WATER.patch[1])}, 1.0, smoothstep(.3, .7, slateNoise(vMudWorld.xz/${glslNumber(WATER.patch[0])})))*(1.0-slatePuddle)*(1.0-slateWaterFar(length(vViewPosition)))*(1.0-${glslNumber(1 - SLATE_WET.close.film)}*slateMatte);
      #ifdef SLATE_MUD_FLAT
      slateWetFilm *= 1.0-slateBedrock*SLATE_ROCK_FILM;
      #endif
      #include <lights_fragment_begin>`;
// After the light maps: the ambient's share and the night sky's light, and the
// sky the water mirrors, at the film's or a puddle's roughness, each brighter by
// a lightning flash's share away from the text (FLASH_GROUND.babelFlash.x, .y).
const WATER_SKY = `#include <lights_fragment_maps>
      #ifdef USE_ENVMAP
      irradiance *= ${glslNumber(LIGHT.ambient)};
      iblIrradiance *= ${glslNumber(LIGHT.sky)};
      float slateFlashAway = babelFlash.x+babelFlash.y > 0.0 ? 1.0-slateBehindText() : 0.0;
      iblIrradiance *= 1.0+babelFlash.x*slateFlashAway;
      vec3 slateWaterSky = mix(getIBLRadiance(geometryViewDir, slateWaterN, mix(${glslNumber(WATER.roughness[0])}, ${glslNumber(WATER.roughness[1])}, slatePuddle))*mix(mix(${glslNumber(WATER.gain[0])}, slateGloss.y, slateGlossT)*mix(vec3(1.0), mix(${glslVec(SLATE_LOOK.gloss.warm)}, ${glslVec(SLATE_LOOK.gloss.tint)}, slateGloss.w), slateGlossT), vec3(${glslNumber(WATER.gain[1])}), slatePuddle), slateWaterBark, slateWaterVeil*slatePuddle);
      slateWaterSky *= 1.0+babelFlash.y*slateFlashAway;
      #endif`;
// After the soil's own clamps: the water's mirror (water Fresnel, the film's
// share or a puddle whole, fading with distance; slateSkyVis is the sky the
// tree leaves open, terrain-build.js) and the lantern on the film, under its knee.
const WATER_AFTER_LIGHTS = `
      #ifdef USE_ENVMAP
      float slateWaterCover = slateWetFilm+slatePuddle*(1.0-slateWaterFar(length(vViewPosition)));
      vec3 slateWaterRefl = slateWaterSky*(${glslNumber(WATER.f0)}+${glslNumber(1 - WATER.f0)}*pow(1.0-saturate(dot(slateWaterN, geometryViewDir)), 5.0))*slateWaterCover*slateSkyVis*slateShow;
      reflectedLight.indirectSpecular += slateWaterRefl;
      slateLampSpec *= ${glslNumber(WATER.lamp.gain)}*slateShow;
      slateMoonSpec *= ${glslNumber(WATER.moon.gain)}*slateShow;
      reflectedLight.directSpecular += slateLampSpec/(1.0+dot(slateLampSpec, ${LUMA})/${glslNumber(WATER.lamp.knee)})+slateMoonSpec/(1.0+dot(slateMoonSpec, ${LUMA})/${glslNumber(WATER.moon.knee)});
      #endif`;

// The ground's material follows the film treatment rather than the published
// maps, so the procedural surface shown while the slate maps load matches the
// loaded ground: under film it takes the slate tint, before the film starts the
// classic ground's. `surface` is palette.js GROUND_SURFACE_MATERIAL.
export function filmGroundSurface({ film = false, surface }) {
  if (!film)
    return { color: surface.color, roughness: surface.roughness, metalness: surface.metalness };
  return { color: surface.filmColor, roughness: surface.roughness, metalness: 0 };
}

// The film slate's shading: wetness, puddles and contacts. `detail` is the
// slate's detail map: with it (the authored maps) the slate also blends its two
// tile lookups and adds the close relief; without it (the procedural surface
// while maps load, or after a fallback) the `-p` program skips both.
// `contacts` is the shared createSlateContacts() uniform set. Without film the
// ground keeps Three's own program.
export function configureGroundShading(
  material,
  film = false,
  { detail = null, grit = null, relief = null, contacts = null } = {},
) {
  const useWet = Boolean(film);
  const authored = Boolean(useWet && detail);
  // The close soil comes with the authored maps' grit and relief (SLATE_CLOSE).
  const close = Boolean(authored && grit && relief);
  if (authored) (material.extensions ??= {}).shaderTextureLOD = true;
  const uniforms = contacts ?? createSlateContacts();
  if (authored) uniforms.slateDetail.value = detail;
  if (close) {
    uniforms.slateGrit.value = grit;
    uniforms.slateRelief.value = relief;
  }
  // terrain-build.js settleRoots() sets material.userData.slateRoot once the film
  // terrain and its root attribute arrive; the slate then applies it last
  // (the roots' contact shade and settled soil) under a "+root" key.
  material.customProgramCacheKey = () =>
    (useWet ? (authored ? "moonlit-slate-v3" : "moonlit-slate-v3-p") : "ground-baseline") +
    (close ? "+soil" : "") +
    (useWet && material.userData.slateRoot ? "+root" : "");
  material.onBeforeCompile = (shader) => {
    if (!useWet) return;
    Object.assign(shader.uniforms, uniforms, FLASH_GROUND, FLASH_UNIFORMS, SHOT_KEY);
    // The drifting mist (drifting-mist.js), last, over the slate's own air and look.
    if (mistOn) Object.assign(shader.uniforms, MIST_UNIFORMS);
    // The dune field varies over 100+ world units; the film terrain's 3-unit
    // quads carry it per vertex, so fragments only read the interpolated height.
    const wetVarying = useWet ? "varying float vSlateDune;\nvarying vec4 vSlateClip;\n" : "";
    shader.vertexShader = "varying vec3 vMudWorld;\n" + wetVarying + shader.vertexShader;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvMudWorld = (modelMatrix * vec4(position, 1.0)).xyz;" +
          (useWet ? `\nvSlateDune = ${TERRAIN_DUNE_GLSL};` : ""),
      )
      .replace("#include <project_vertex>", "#include <project_vertex>\nvSlateClip = gl_Position;");
    // Hoskins' sine-free hash, so every GPU draws the same value noise.
    shader.fragmentShader =
      "varying vec3 vMudWorld;\n" +
      wetVarying +
      (useWet
        ? `uniform vec4 slateContacts[${SLATE_CONTACTS}];
uniform vec4 slateCalmAt;
uniform float slateRockContact, slateContactGain, slateAspect;
uniform vec3 babelFlashKey;
uniform vec4 babelFlash, babelFlashLight, babelFlashSky;
uniform vec3 babelKeyDir;
#define SLATE_TEXT_KNEE ${glslNumber(WATER.text[1])}
uniform vec4 slateText, slateAbout;
${authored ? "uniform sampler2D slateDetail;\n" + SOIL_SAMPLE : ""}${close ? "#define SLATE_CLOSE_SOIL\nuniform sampler2D slateGrit, slateRelief, slateSoilRoughness;\nuniform float slateSoilRoughnessOn;\n" : ""}${RIVER_BED_GLSL}float slateHash(vec2 p){vec3 q=fract(p.xyx*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
float slateNoise(vec2 p){vec2 i=floor(p),f=fract(p);f*=f*(3.-2.*f);return mix(mix(slateHash(i),slateHash(i+vec2(1,0)),f.x),mix(slateHash(i+vec2(0,1)),slateHash(i+1.),f.x),f.y);}
${STREAM_GLSL}
${SLATE_TEXT_GLSL}${LOOK_GLSL}${mistOn ? `uniform mat4 projectionMatrix;\n${MIST_PARS}` : ""}`
        : "") +
      shader.fragmentShader;
    if (authored)
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <map_fragment>",
        `#ifdef USE_MAP
      mat2 slateTurnB = mat2(${SECOND.turn.map(glslNumber)}), slateTurnD = mat2(${DETAIL.turn.map(glslNumber)});
      vec2 slateUvB = slateTurnB*vMapUv*${glslNumber(SECOND.scale)}+${glslVec(SECOND.offset)}, slateUvD = slateTurnD*vMapUv*${glslNumber(DETAIL.ratio)};
      vec4 slateA = texture2D(map, vMapUv), slateB = texture2D(map, slateUvB);
      float slateW = clamp((slateNoise(vMudWorld.xz/${glslNumber(SLATE_TILING.blendCell)})-.5)*${glslNumber(SLATE_TILING.blendGain)}+dot(slateB.rgb-slateA.rgb,vec3(.2126,.7152,.0722))*${glslNumber(SLATE_TILING.heightGain)}+.5,0.,1.);
      float slateH = texture2D(slateDetail, slateUvD).r, slateNear = 1.-smoothstep(${DETAIL.near.map(glslNumber)},length(vViewPosition));
      vec3 slateMean = ${glslVec(SLATE_TILING.mean)};
      vec4 sampledDiffuseColor = vec4(max(slateMean+(mix(slateA.rgb,slateB.rgb,slateW)-slateMean)/length(vec2(slateW,1.-slateW)),0.)*(1.+(slateH-.5)*${glslNumber(DETAIL.albedo)}*slateNear)*(.93+.14*slateNoise(vMudWorld.xz/${glslNumber(SLATE_TILING.macroCell)})),1.);
      ${close ? CLOSE_PRE : ""}${FAR_MAP}
      diffuseColor *= sampledDiffuseColor;
      #endif`,
      );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <roughnessmap_fragment>",
      `#include <roughnessmap_fragment>
      float mudPatch = 0.5 + 0.25 * sin(vMudWorld.x * 0.21 + sin(vMudWorld.z * 0.13)) + 0.25 * sin(vMudWorld.z * 0.17 + sin(vMudWorld.x * 0.11));
      float footingDry = 1.0 - smoothstep(7.0, 13.0, length(vMudWorld.xz));
      roughnessFactor = mix(0.9, roughnessFactor, smoothstep(0.72, 0.95, mudPatch) * (1.0 - footingDry));
      diffuseColor.rgb *= 1.0 - 0.08 * footingDry;
      diffuseColor.rgb *= 0.9 + 0.15 * mudPatch;
      
      ${
        film
          ? `
      float earthBroad = .5 + .16*sin(vMudWorld.x*.043 + sin(vMudWorld.z*.031)) + .12*sin(vMudWorld.z*.067 + sin(vMudWorld.x*.052)) + .08*sin((vMudWorld.x+vMudWorld.z)*.109);
      float earthContact = max(1.0-smoothstep(5.0,13.0,length(vMudWorld.xz)), 1.0-smoothstep(2.5,10.0,length(vMudWorld.xz-${TREE_GLSL})));
      vec2 pathAxis = normalize(${TREE_GLSL});
      float along = clamp(dot(vMudWorld.xz,pathAxis),0.0,${PATH_LENGTH});
      vec2 pathCenter = pathAxis*along+vec2(-pathAxis.y,pathAxis.x)*sin(along/${PATH_LENGTH}*6.283185)*${glslNumber(ESTATE.path.bend)};
      float approach = 1.0-smoothstep(1.2,3.8,length(vMudWorld.xz-pathCenter));
      float worn = max(earthContact,approach);
      float damp = smoothstep(.78,.98,earthBroad)*(1.0-earthContact);
      roughnessFactor = mix(max(.88,roughnessFactor), .78, damp);
      diffuseColor.rgb *= ${glslNumber(SLATE_TILING.lift)}*(.84 + .10*earthBroad - .04*earthContact - .035*damp + .035*approach);
      roughnessFactor = mix(roughnessFactor,.94,approach*.65);
      ${
        useWet
          ? `
      float slateHollow = 1.0 - smoothstep(${glslNumber(SLATE_WET.hollow[0])}, ${glslNumber(SLATE_WET.hollow[1])}, vSlateDune);
      #ifdef USE_MAP
      float slateCrack = 1.0 - smoothstep(${glslNumber(SLATE_WET.crack[0])}, ${glslNumber(SLATE_WET.crack[1])}, dot(sampledDiffuseColor.rgb, vec3(.299,.587,.114)));
      #else
      float slateCrack = 0.0;
      #endif
      ${authored ? "" : "float slateH = .5;"}
      float slateTree = length(vMudWorld.xz-${TREE_GLSL});
      float slateDry = footingDry;
      float slateWet = clamp(max(slateHollow, slateCrack*${glslNumber(SLATE_WET.crackWeight)}) + (1.0-smoothstep(${SLATE_WET.halo.map(glslNumber)}, slateTree))*${glslNumber(SLATE_WET.haloWeight)}, 0.0, 1.0)*(1.0-slateDry);
      vec2 slateRiverDir;
      vec4 slateRiverQ = slateRiver(vMudWorld.xz, slateRiverDir);
      float slateRiverR = slateRiverQ.x;
      vec2 slateStreamDir;
      float slateStreamJoin, slateStreamR, slateStreamBend;
      vec4 slateStreamQ = slateStreamAt(vMudWorld.xz, slateStreamDir, slateStreamJoin, slateStreamR, slateStreamBend);
      float slateStreamCalm = smoothstep(${glslNumber(SLATE_STREAMS.calm.from)}, ${glslNumber(SLATE_STREAMS.calm.from + SLATE_STREAMS.calm.span)}, slateStreamQ.y);
      float slatePuddle = smoothstep(-.04, .04, max(max(max(${PUDDLE_GLSL}*(${glslNumber(SLATE_PUDDLES.fill)}+.4*slateNoise(vMudWorld.xz*.9))-slateH, slatePoolsAt(slateH, length(vViewPosition))), ${STREAM_LEVEL}), ${RIVER_LEVEL}))*(1.0-slateDry);
      float slateLanternPuddle = slatePuddle*max(1.0-smoothstep(1.0, 1.4, slateRiverR), 1.0-smoothstep(1.0, 1.4, slateStreamR));
      slateWet = max(slateWet, slatePuddle);
      // The banks (SLATE_BANKS): the wet band beyond the waterline, and through the stream's bends its cut bank (outside) and silt bar (inside).
      float slateSide = clamp(2.*slateStreamQ.z, -1., 1.)*slateStreamBend;
      float slateBank = max(smoothstep(${glslNumber(SLATE_BANKS.stream[0] - 0.06)}, ${glslNumber(SLATE_BANKS.stream[0])}, slateStreamR)*(1.-smoothstep(${glslNumber(SLATE_BANKS.stream[0])}, ${glslNumber(SLATE_BANKS.stream[1])}, slateStreamR)), smoothstep(${glslNumber(SLATE_BANKS.river[0] - 0.04)}, ${glslNumber(SLATE_BANKS.river[0])}, slateRiverR)*(1.-smoothstep(${glslNumber(SLATE_BANKS.river[0])}, ${glslNumber(SLATE_BANKS.river[1])}, slateRiverR)))*(1.0-slateDry)*(1.0-slatePuddle);
      float slateSilt = slateBank*smoothstep(.08, .4, -slateSide)*(1.-step(${glslNumber(SLATE_BANKS.stream[1])}, slateStreamR)), slateCut = slateBank*smoothstep(.08, .4, slateSide);
      slateWet = max(slateWet, slateBank);
      roughnessFactor = mix(mix(roughnessFactor, ${glslNumber(SLATE_WET.roughness)}, slateWet*${glslNumber(SLATE_WET.roughnessWeight)}), ${glslNumber(SLATE_PUDDLES.roughness)}, slatePuddle);
      roughnessFactor = mix(roughnessFactor, ${glslNumber(SLATE_PUDDLES.lantern.roughness)}, slateLanternPuddle);
      float slateMatte = (1.0-smoothstep(${SLATE_WET.close.near.map(glslNumber)}, length(vViewPosition)))*(1.0-slatePuddle)*(1.0-slateBank);
      roughnessFactor = mix(roughnessFactor, max(roughnessFactor, ${glslNumber(SLATE_WET.close.roughness)}), slateMatte);
      ${close ? "roughnessFactor = clamp(roughnessFactor+slateSoilRough*slateCN*(1.-slatePuddle)*slateSoilMask,.04,1.);" : ""}
      ${close ? CLOSE_MAP : ""}
      diffuseColor.rgb *= (1.0 - ${glslNumber(SLATE_WET.darken)}*slateWet)*(1.0 - ${glslNumber(SLATE_PUDDLES.darken)}*slatePuddle);
      diffuseColor.rgb = mix(diffuseColor.rgb*(1.0-${glslNumber(SLATE_BANKS.darken)}*slateBank-${glslNumber(SLATE_BANKS.cut)}*slateCut), ${glslVec(SLATE_TILING.mean.map((v) => +(v * SLATE_TILING.lift * SLATE_BANKS.silt.tone).toFixed(4)))}, ${glslNumber(SLATE_BANKS.silt.amount)}*slateSilt*(1.0-${glslNumber(SLATE_BANKS.text)}*slateBehindText()));
      float slateAo = 0.0;
      for (int i = 0; i < ${SLATE_CONTACTS}; i++) slateAo = max(slateAo, (1.0-smoothstep(.55, 1.35, length(vMudWorld.xz-slateContacts[i].xy)/max(slateContacts[i].z, .001)))*slateContacts[i].w*(i < 2 ? 1.0 : slateRockContact));
      diffuseColor.rgb *= 1.0 - slateAo*slateContactGain;
      #ifdef SLATE_MUD_FLAT
      // The coast's bedrock (terrain-build.js COAST_ROCK) is matte stone, not the plain's damp film.
      roughnessFactor = mix(roughnessFactor, SLATE_ROCK_ROUGH, slateBedrock); slateWet *= 1.0-slateBedrock*SLATE_ROCK_DRY;
      #endif
      `
          : ""
      }
      
      `
          : ""
      }
    `,
    );
    // Both tile lookups' normals, B's turned back into A's tangent frame, then
    // the detail map's slope from two more taps a texel away; puddles calm both.
    if (authored)
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <normal_fragment_maps>",
        `#ifdef USE_NORMALMAP_TANGENTSPACE
      vec3 slateNA = texture2D(normalMap, vNormalMapUv).xyz*2.-1., slateNB = texture2D(normalMap, slateUvB).xyz*2.-1.;
      vec2 slateDetailX=dFdx(slateUvD), slateDetailY=dFdy(slateUvD), slateHx=vec2(slateH);
      #ifdef SLATE_SOIL_GRAD
      if(slateNear>0.) {
      #endif
      slateHx = vec2(slateSoilSample(slateDetail, slateUvD+vec2(1./512.,0.),slateDetailX,slateDetailY).r, slateSoilSample(slateDetail, slateUvD+vec2(0.,1./512.),slateDetailX,slateDetailY).r);
      #ifdef SLATE_SOIL_GRAD
      }
      #endif
      vec3 mapN = vec3((mix(slateNA.xy, slateNB.xy*slateTurnB, slateW)/length(vec2(slateW,1.-slateW))*normalScale+(slateH-slateHx)*slateTurnD*(${glslNumber(DETAIL.strength)}*slateNear))${close ? `*(1.-${glslNumber(CLOSE.calm)}*slateCN)` : ""}*(1.-${glslNumber(SLATE_BANKS.silt.calm)}*slateSilt)*(1.-${glslNumber(SLATE_PUDDLES.flatten)}*slatePuddle), mix(slateNA.z, slateNB.z, slateW));
      normal = normalize(tbn*mapN);${close ? CLOSE_NORMAL : ""}
      #ifdef SLATE_MUD_FLAT
      // The plain's smooth mud (terrain-build.js PLAIN_MUD): little of the slate's relief.
      normal = normalize(mix(normal, nonPerturbedNormal, SLATE_MUD_FLAT));
      #endif
      #endif`,
      );
    // The film ground's own lights, the sky's light and the water's mirror
    // (SLATE_LIGHT, SLATE_WATER).
    if (useWet)
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <lights_physical_pars_fragment>",
          `#include <lights_physical_pars_fragment>${MOONLIT_LIGHTS}`,
        )
        .replace("#include <shadowmap_pars_fragment>", LOOK_SHADOW)
        .replace("#include <lights_fragment_begin>", WATER_BEFORE_LIGHTS)
        .replace("#include <lights_fragment_maps>", WATER_SKY);
    if (film)
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <lights_fragment_end>",
          `#include <lights_fragment_end>
      // Bound the grazing response of compact soil in the legacy light pipeline.
      reflectedLight.directSpecular *= mix(.12, .22, damp);
      reflectedLight.indirectSpecular *= .18;
      ${
        useWet
          ? `
      reflectedLight.directSpecular *= mix(1.0, ${glslNumber(SLATE_WET.close.specular)}, slateMatte)*(1.0 + ${glslNumber(SLATE_WET.specular)}*slateWet)*(1.0 + ${glslNumber(SLATE_PUDDLES.specular)}*slatePuddle - ${glslNumber(SLATE_PUDDLES.specular - SLATE_PUDDLES.lantern.specular)}*slateLanternPuddle);
      reflectedLight.directSpecular /= 1.0 + 2.5*dot(reflectedLight.directSpecular,vec3(.2126,.7152,.0722))*slateLanternPuddle;
      float slateBehind = slateBehindText(), slateShow = 1.0-${glslNumber(WATER.text[0])}*slateBehind;
      // A lightning flash's light (film-light.js FLASH_UNIFORMS) at the slate's
      // shares of the fill and the flat light, none of it behind the text.
      if (babelFlashLight.w > 0.0)
        reflectedLight.directDiffuse += (1.0-slateBehind)*(1.0-slateBehind)*(babelFlashLight.rgb*saturate(dot(normal, (viewMatrix*vec4(babelFlashKey, 0.0)).xyz))*${glslNumber(LIGHT.fill)}+(babelFlashSky.rgb*(.5+.5*dot(normal, viewMatrix[1].xyz))+babelFlashSky.w)*${glslNumber(LIGHT.ambient)})*material.diffuseColor;
      reflectedLight.indirectSpecular *= mix(1.0, ${glslNumber(+(SLATE_WET.indirect[1] / SLATE_WET.indirect[0]).toFixed(4))}, slateWet*slateShow)*mix(1.0, ${glslNumber(SLATE_WET.close.sky)}, slateMatte);${WATER_AFTER_LIGHTS}
      reflectedLight.directSpecular = slateTextKnee(reflectedLight.directSpecular, slateBehind);
      reflectedLight.indirectSpecular = slateTextKnee(reflectedLight.indirectSpecular, slateBehind);
      `
          : ""
      }
    `,
        )
        // In place of the scene fog the slate's far edge (and the plain past 230
        // units of view depth) darkens toward the far plain's air, the shared
        // slate lifted by HORIZON_AIR.ground, where the ranges' body below eye
        // level meets it. It never lightens: slate already darker keeps its tone,
        // so the edge cannot rise through the grade's cel step into a pale rim.
        .replace(
          "#include <fog_fragment>",
          `
      // Near the lens the soil's brightest channel eases past SLATE_CLOSE.ceiling, the colour scaled whole, so a lit crest keeps
      // its warmth rather than clipping channel by channel into a chalky grey.
      { float slateCM = max(gl_FragColor.r, max(gl_FragColor.g, gl_FragColor.b)), slateCE = max(slateCM-${glslNumber(CLOSE.ceiling)}, 0.); gl_FragColor.rgb *= mix(1., (slateCM-slateCE+slateCE/(1.+slateCE/${glslNumber(CLOSE.ceiling)}))/max(slateCM, 1e-5), 1.-smoothstep(${CLOSE.near.map(glslNumber)}, length(vViewPosition))); }
      #ifdef USE_FOG
      float earthHorizon = max(${PLAIN_EDGE},
        smoothstep(230.0, 330.0, vFogDepth));
      vec3 earthAir = ${TERRAIN_HORIZON}*${glslNumber(HORIZON_AIR.ground)};
      earthHorizon *= smoothstep(1.0, 1.15, dot(gl_FragColor.rgb, ${LUMA})/dot(earthAir, ${LUMA}));
      gl_FragColor.rgb = mix(gl_FragColor.rgb, earthAir, earthHorizon);
      #endif${LOOK_AFTER}${useWet && mistOn ? "\n      gl_FragColor.rgb = mistGround(gl_FragColor.rgb, vMudWorld);" : ""}
      gl_FragColor.a = ${DEPTH_LAYER.ground};
    `,
        );
    if (useWet) material.userData.slateRoot?.(shader);
  };
  material.needsUpdate = true;
}
