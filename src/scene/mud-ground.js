import { DEPTH_LAYER } from "./depth-layers.js";
import { FLASH_GROUND, FLASH_UNIFORMS } from "./film-light.js";
import { HORIZON_AIR, RANGE_MIST, TERRAIN_HORIZON } from "./hill-silhouette.js";
import { ESTATE, estateLantern, estatePoint } from "./estate-layout.js";
import { MIST_PARS, MIST_UNIFORMS, mistOn } from "./drifting-mist.js";
// The estate's human scale for props and trees: one doorway height. The
// timber lookout matches it: its cabin rises about 6.5 from gallery floor
// (29.9) to eave (36.4) above a railing about 3.9 high.
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
// and the lantern clearing with it) is wet; only the tower footing stays dry.
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
  // (never the pond, puddles or streams) eases to `roughness`, keeps `film`
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
// relief, `relief` units high, tilts its normal through its screen
// derivatives. Both are full within near[0] of the lens and gone by near[1],
// and the relief fades where a texel shrinks below `footprint` pixels and
// under water.
export const SLATE_CLOSE = Object.freeze({
  tile: 6.6,
  second: Object.freeze({
    scale: 0.83,
    turn: Object.freeze([0.28, 0.96, -0.96, 0.28]),
    offset: Object.freeze([0.41, 0.17]),
  }),
  blendCell: 2.6,
  albedo: 1.5,
  relief: 0.16,
  blur: 5,
  calm: 0.9,
  near: Object.freeze([7, 24]),
  footprint: Object.freeze([0.8, 2]),
  // Crumbs: a cellular noise of `cell`-unit grains on the close soil's relief
  // (`height`, in relief-map units) and albedo (`albedo`), so it reads as
  // crumbly earth; gone where a cell shrinks under `fade` pixels.
  crumb: Object.freeze({ cell: 0.075, height: 1, albedo: 0.6, fade: Object.freeze([1.6, 4]) }),
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

// The small pond in front of the lantern, where its reflection lands in both
// lantern shots (SLATE_PUDDLES.zones[0] is its footprint, SLATE_POND its
// basin), and moonlit puddles along the tree's drip line and in Portrait's
// right foreground: zone anchors
// and angles as estatePoint() takes them, radius in units, stretched along a
// world angle. Water fills the detail map's low texels first (fill: the zone's
// level over them), so edges follow the cracks. Puddles are glassy, darker and
// calmer, catch the existing moon and lantern lights, and mirror the night sky
// (the film's environment, SLATE_WATER); zenith is the sky the lantern
// puddle's mirror falls back to without it.
export const SLATE_PUDDLES = Object.freeze({
  zones: Object.freeze([
    Object.freeze({
      anchor: "lantern",
      deg: -115,
      dist: 2.1,
      radius: 2.2,
      stretch: 0.47,
      along: -115,
    }),
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

// The pond (SLATE_PUDDLES.zones[0]): a shallow basin whose shore is the
// footprint's ellipse (2.2 across the lantern shots' view, 1.03 along it),
// wobbled by three and five lobes (wobble) so it never reads as a drawn
// ellipse. Its water lies `level` below the lantern's foot; the floor falls to
// `depth` below the water at its centre (a parabola in the footprint's
// normalised radius) and the bank rises toward `rise` above it, smoothly from
// the shore, until it meets the ground (terrain-build.js carves it, within
// reach[1] radii; the lantern's footing stays level). The shader finds the
// water from the same shape: its level is the depth times `shore` (the
// puddles' level units), the detail map's texels moving the shore a little
// (`texel`), and it is no zone beyond reach[0] to reach[1] radii.
export const SLATE_POND = Object.freeze({
  wobble: Object.freeze([0.08, 0.05]),
  depth: 0.18,
  rise: 0.15,
  level: -0.04,
  shore: 3,
  texel: 0.06,
  reach: Object.freeze([1.25, 1.55]),
});
// Rain streams: thin trickles that run off the roots between them and into the
// pond, each a polyline of [dx, dz] offsets from the lantern's foot, `width`
// units wide at its head and its mouth. They meander by a noise (`meander`
// units at `wobble` cycles per unit) and fill like the puddles, in the detail
// map's low texels first (`fill` times the puddles' level), so they follow
// the cracks and break up toward their heads.
export const SLATE_STREAMS = Object.freeze({
  paths: Object.freeze([
    Object.freeze([
      [5.28, 1.04],
      [3.68, 0.04],
      [2.28, -1.06],
      [1.08, -1.56],
      [0.08, -1.86],
    ]),
    Object.freeze([
      [2.28, 1.24],
      [1.38, 0.64],
      [0.98, -0.36],
      [0.1, -1.7],
    ]),
    Object.freeze([
      [4.48, -2.36],
      [3.08, -1.96],
      [1.68, -2.06],
      [0.48, -2.06],
    ]),
  ]),
  width: Object.freeze([0.14, 0.34]),
  meander: 0.28,
  wobble: 1.6,
  fill: 1.25,
});
// The pond's height above its water at normalised radius r (1 on the shore).
export function pondShape(r) {
  const { depth, rise } = SLATE_POND;
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
// the tree's shadow across it, so it dominates: the unshadowed fills, which
// model the tower and the bark, keep only a share here (the crown's point fill
// stands where no light is), and the flat ambient and hemisphere give way to
// the night sky's own light from the environment (night-environment.js),
// brighter toward the lit clouds and the horizon, which the cracks and relief
// catch. The lantern's light also comes back off its own pool and the near
// roots (bounce: the share of its light that reaches the soil from all about,
// not only from the lamp's low angle), so its warm pool spreads to the light's
// reach. Without an environment the fills and ambient stay whole.
export const SLATE_LIGHT = Object.freeze({
  key: 1.35,
  fill: 0.35,
  crown: 0.15,
  ambient: 0.3,
  sky: 3.4, // the environment's diffuse light, times (its colours are the sky as shown)
  bounce: 0.18,
});

// Water on the ground mirrors the night sky (the environment), with water's
// Fresnel (f0) on a normal levelled by the water (level: its share of the
// surface's own, unmapped normal): after the rain a film of water lies on the
// soil, film[0] of it everywhere but the dry tower footing and film[1] more
// with the wet mask, in broad drained and glossy patches (patch: the noise's
// cell in units and the share it keeps at least), a little rough
// (roughness[0]) as it follows the soil; standing water (the knoll's low-spot
// pools) is whole and sharp (roughness[1]). The authored puddles take none of
// this: terrain-build.js's zone mirror draws their sky, at the sky as shown.
// The sky the water mirrors is the sky as shown times gain ([film, standing
// water]: above 1 the stylised night's dimmed sky lights its own reflection
// more), and in standing water the tree's trunk darkens it where
// it stands in the way (terrain-build.js sets slateWaterVeil; the rough film
// would only smear it). It fades with view distance
// (far), so the far plain behind the intro text stays calm.
// The moon and the lantern light the film as water too: a sharper lobe each
// (roughness, gain and a luminance knee that bounds it), so the moon glints
// across the wet soil toward its side and the lantern's glints run in streaks
// toward the eye, while the soil's own highlight stays clamped. Like the light
// shafts' air, the water's mirror and glints (and the soil's relaxed sky
// reflection) ease off behind the name and intro and behind About, text[0] of
// them, over text[2] of the screen's smaller side about the name and intro and
// text[3] about About (index.js measures the text: slateText, slateAbout);
// there all the ground reflects, the water and the soil's own highlights (a
// puddle's moon glint among them), then passes a luminance knee, text[1];
// beside About so do the bark's highlights from the lantern and the crown's
// fill (architecture.js, through SLATE_TEXT_GUARD). The knee is blended in
// over the whole reach (slateTextKnee()), never scaled into its divisor, where
// a knee that low would crush bright glare at a few percent of the guard and
// end the wet plain's moon glare in a hard wall beside the name. Half the
// screen's smaller side, the clouds' reach (estate-sky.js CLOUD_RESHAPE.text),
// lets the glare fade out along the plain; the small About label keeps a fifth,
// so on phones the pond's image of the lantern above it stays bright.
export const SLATE_WATER = Object.freeze({
  f0: 0.02,
  text: Object.freeze([0.3, 0.035, 0.5, 0.2]),
  level: 0.7,
  film: Object.freeze([0.12, 0.18]),
  patch: Object.freeze([9, 0.55]),
  roughness: Object.freeze([0.3, 0.02]),
  gain: Object.freeze([1.5, 1.8]),
  far: Object.freeze([70.0, 130.0]),
  moon: Object.freeze({ roughness: 0.25, gain: 1, knee: 0.06 }),
  lamp: Object.freeze({ roughness: 0.18, gain: 1.6, knee: 0.35 }),
});

// The text guard's screen test, shared by the ground and the bark
// (architecture.js): slateBehindText() is 1 behind the name and intro
// (slateText) or About (slateAbout, slateBehindAbout()), boxes in the
// canvas's UV, easing to 0 over SLATE_WATER.text[2] or text[3] of the screen's
// smaller side (slateAspect, the canvas's); vSlateClip is the fragment's
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
    // The name and intro, and About, on the canvas (x0, y0, x1, y1 in its UV,
    // y up; empty beyond it) and the canvas's aspect, for the water to ease off
    // behind them.
    slateText: { value: { x: 2, y: 2, z: -1, w: -1 } },
    slateAbout: { value: { x: 2, y: 2, z: -1, w: -1 } },
    slateAspect: { value: 1 },
    // The shot's calm (slateCalmFor()): off until a shot asks for it.
    slateCalm: { value: { x: 0, y: 1, z: 2, w: 0 } },
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
    slateShadowFade: { value: { x: 0, y: 0 } },
  };
}

// A calmed slate's glints and sky reflection ease by this share of its flatten
// (slateCalmFor()): 0.7 x 0.5 = 35% in Portrait, 0.7 x 0.6 = about 40% in
// Watch and tree.
export const SLATE_CALM_GLINT = 0.7;

// A shot's `ground` calm: the plain about the subject quietens so the subject,
// the ranges and the sky carry the frame. Within burn.reach (fractions of the
// camera's distance to the subject: full at [0], gone by [1]) the slate,
// its water included, is darkened by up to burn.amount; beyond keep (world
// units from the subject: kept within [0], calm by [1]) its tone and relief
// are pulled `flatten` of the way to the tile's mean (lifting its darkest
// cracks a little, so fewer hold water), and its glints and sky reflection
// ease with it (SLATE_CALM_GLINT). The burn never lightens. Uniforms, written in
// place every frame, so a cut never recompiles; so is the shot's look
// (SLATE_LOOK), which this writes too.
export function slateCalmFor(contacts, shot, distance, at) {
  const calm = shot?.ground,
    v = contacts.slateCalm.value,
    a = contacts.slateCalmAt.value;
  if (!calm || !(distance > 0) || !at) {
    v.x = 0;
    v.y = 1;
    v.z = 2;
    v.w = 0;
    slateLookFor(contacts, null);
    return v;
  }
  const reach = calm.burn?.reach ?? [0, 1],
    keep = calm.keep ?? [0, 1];
  v.x = calm.burn?.amount ?? 0;
  v.y = reach[0] * distance;
  v.z = Math.max(reach[1], reach[0] + 0.01) * distance;
  v.w = calm.flatten ?? 0;
  a.x = at.x;
  a.y = at.z;
  a.z = keep[0];
  a.w = Math.max(keep[1], keep[0] + 0.01);
  slateLookFor(contacts, calm, shot.azimuth ?? 0, at);
  return v;
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
//   intro, About] as shares of the screen's smaller side, as the text guard
//   measures), and in broad wetter and drier patches (gloss.patch: [cell in
//   units, the drier patches' share]).
// - shadow: [near, far]: the moon's shadow (the crown's, far out on the plain,
//   where a real shadow would be wide and soft) fades from near to far units
//   of the subject.
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
    warm: Object.freeze([1, 0.97, 0.94]),
    text: Object.freeze([0.45, 0.25]),
    patch: Object.freeze([31, 0.35]),
  }),
});
function slateLookFor(contacts, look, azimuth = 0, at = null) {
  const clear = contacts.slateClear.value,
    light = contacts.slateClearLight.value,
    shade = contacts.slateClearShade.value,
    mist = contacts.slateMist.value,
    gloss = contacts.slateGloss.value,
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
  const fade = look?.shadow;
  shadow.x = fade ? fade[0] : 0;
  shadow.y = fade ? Math.max(fade[1], fade[0] + 0.01) : 0;
}

const glslVec = (values) => `vec${values.length}(${values.map(glslNumber).join(",")})`;
const glslPoint = ({ x, z }) => glslVec([+x.toFixed(2), +z.toFixed(2)]);
const TREE_GLSL = glslPoint(ESTATE.tree);
const PATH_LENGTH = glslNumber(
  +Math.hypot(ESTATE.tree.x - ESTATE.tower.x, ESTATE.tree.z - ESTATE.tower.z).toFixed(2),
);
const SECOND = SLATE_TILING.second,
  DETAIL = SLATE_TILING.detail,
  CLOSE = SLATE_CLOSE;
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
const CLOSE_PRE = `
      vec2 slateCU = vMudWorld.xz/${glslNumber(CLOSE.tile)}, slateCV = mat2(${CLOSE.second.turn.map(glslNumber)})*slateCU*${glslNumber(CLOSE.second.scale)}+${glslVec(CLOSE.second.offset)};
      float slateCW = smoothstep(.3, .7, slateNoise(vMudWorld.xz/${glslNumber(CLOSE.blendCell)})), slateCN = 1.-smoothstep(${CLOSE.near.map(glslNumber)}, length(vViewPosition));
      float slateCG = mix(texture2D(slateGrit, slateCU).r, texture2D(slateGrit, slateCV).r, slateCW), slateCH = mix(texture2D(slateRelief, slateCU).r, texture2D(slateRelief, slateCV).r, slateCW);
      vec2 slateKP = vMudWorld.xz/${glslNumber(CLOSE.crumb.cell)}, slateKI = floor(slateKP), slateKF = fract(slateKP);
      float slateKW = slateCN*smoothstep(${CLOSE.crumb.fade.map(glslNumber)}, 1./max(length(fwidth(slateKP)), 1e-4)), slateK1 = 1.;
      // Only where the crumbs show (near the lens, a cell over a few pixels).
      if (slateKW > 0.) {
        for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
          vec2 slateKG = vec2(float(i), float(j));
          vec3 slateKH = fract(vec3(slateKI+slateKG, slateKI.x+slateKG.x)*vec3(.1031, .103, .0973));
          slateKH += dot(slateKH, slateKH.yzx+33.33);
          vec2 slateKO = fract((slateKH.xx+slateKH.yz)*slateKH.zy)-slateKF+slateKG;
          slateK1 = min(slateK1, dot(slateKO, slateKO));
        }
      }
      float slateCrumb = (1.-smoothstep(0., .6, slateK1))-.4;
      slateCH += slateCrumb*${glslNumber(CLOSE.crumb.height)}*slateKW;
      slateCG += slateCrumb*${glslNumber(CLOSE.crumb.albedo)}*slateKW;
      sampledDiffuseColor.rgb = mix(sampledDiffuseColor.rgb, mix(texture2D(map, vMapUv, ${glslNumber(CLOSE.blur)}).rgb, texture2D(map, slateUvB, ${glslNumber(CLOSE.blur)}).rgb, slateW)*(.93+.14*slateNoise(vMudWorld.xz/${glslNumber(SLATE_TILING.macroCell)})), ${glslNumber(CLOSE.calm)}*slateCN);
      `;
const CLOSE_MAP = `
      diffuseColor.rgb *= 1.+(slateCG-.5)*${glslNumber(CLOSE.albedo)}*slateCN;`;
// Its relief on the normal, from the height's screen derivatives (as three's
// perturbNormalArb()), faded where a texel shrinks below a pixel and under water.
const CLOSE_NORMAL = `
      float slateCF = slateCN*smoothstep(${CLOSE.footprint.map(glslNumber)}, 1./max(length(fwidth(slateCU))*1024., 1e-4))*(1.-slatePuddle);
      vec3 slateSX = dFdx(-vViewPosition), slateSY = dFdy(-vViewPosition), slateR1 = cross(slateSY, normal), slateR2 = cross(normal, slateSX);
      float slateDet = dot(slateSX, slateR1);
      vec2 slateDH = vec2(dFdx(slateCH), dFdy(slateCH))*${glslNumber(CLOSE.relief)}*slateCF;
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
// The drip-line and Portrait puddles' zones; the pond (zones[0]) takes its own
// level and mask from its shape (SLATE_POND).
const PUDDLE_GLSL = PUDDLE_ZONES_GLSL.slice(1).reduce((all, zone) => `max(${all},${zone})`);
const POND_ZONE = SLATE_PUDDLES.zones[0],
  POND_CENTRE = glslPoint(estatePoint(POND_ZONE.anchor, POND_ZONE.deg, POND_ZONE.dist)),
  POND_C = +Math.cos((POND_ZONE.along * Math.PI) / 180).toFixed(4),
  POND_S = +Math.sin((POND_ZONE.along * Math.PI) / 180).toFixed(4);
// slatePondR(): the normalised radius in the pond's footprint, 1 on its
// wobbled shore; slatePondShape(): its height above the water there.
// The streams' weight at a world point: 1 within their middle, easing to 0
// at their edge (SLATE_STREAMS), times their fill.
const LANTERN_AT = estateLantern();
const STREAM_GLSL = (() => {
  const { paths, width, meander, wobble, fill } = SLATE_STREAMS;
  const body = paths
    .flatMap((path) =>
      path.slice(1).map((end, k) => {
        const [ax, az] = path[k],
          [bx, bz] = end,
          w0 = width[0] + ((width[1] - width[0]) * k) / (path.length - 1),
          w1 = width[0] + ((width[1] - width[0]) * (k + 1)) / (path.length - 1);
        const a = `vec2(${glslNumber(+(LANTERN_AT.x + ax).toFixed(3))},${glslNumber(+(LANTERN_AT.z + az).toFixed(3))})`,
          b = `vec2(${glslNumber(+(LANTERN_AT.x + bx).toFixed(3))},${glslNumber(+(LANTERN_AT.z + bz).toFixed(3))})`;
        return `q=slateSeg(p,${a},${b});w=max(w,1.-smoothstep(.3,.5,q.x/mix(${glslNumber(w0)},${glslNumber(w1)},q.y)));`;
      }),
    )
    .join("");
  return `vec2 slateSeg(vec2 p,vec2 a,vec2 b){vec2 pa=p-a,ba=b-a;float h=clamp(dot(pa,ba)/dot(ba,ba),0.,1.);return vec2(length(pa-ba*h),h);}
float slateStreams(vec2 p){p+=(vec2(slateNoise(p*${glslNumber(wobble)}),slateNoise(p*${glslNumber(wobble)}+7.3))-.5)*${glslNumber(meander * 2)};vec2 q;float w=0.;${body}return w*${glslNumber(fill)};}
`;
})();
const POND_GLSL = `float slatePondR(vec2 p){vec2 q=mat2(${[POND_C, -POND_S, POND_S, POND_C].map(glslNumber)})*(p-${POND_CENTRE})/vec2(${glslNumber(POND_ZONE.stretch)},1.)/${glslNumber(POND_ZONE.radius)};float a=atan(q.y,q.x);return length(q)/(1.+${glslNumber(SLATE_POND.wobble[0])}*sin(3.*a+1.3)+${glslNumber(SLATE_POND.wobble[1])}*sin(5.*a+.4));}
float slatePondShape(float r){return r<1.?${glslNumber(-SLATE_POND.depth)}*(1.-r*r):${glslNumber(SLATE_POND.rise)}*(1.-exp(-(r-1.)*${glslNumber(+((2 * SLATE_POND.depth) / SLATE_POND.rise).toFixed(4))}));}
`;
const POND_LEVEL = `mix(-slatePondShape(slatePondR(vMudWorld.xz))*${glslNumber(SLATE_POND.shore)}-(slateH-.5)*${glslNumber(SLATE_POND.texel)},-1.,smoothstep(${SLATE_POND.reach.map(glslNumber)},slatePondR(vMudWorld.xz)))`;
const unitGlsl = (values) => {
  const length = Math.hypot(...values);
  return glslVec(values.map((value) => +(value / length).toFixed(4)));
};
const LUMA = "vec3(.2126,.7152,.0722)";
// The plain's edge: from [0] to [1] units out along either axis (its square)
// the slate meets the far plain's air, and a shot's look meets the ranges'.
const PLAIN_EDGE = `smoothstep(${glslNumber(155)}, ${glslNumber(190)}, max(abs(vMudWorld.x),abs(vMudWorld.z)))`;
// The far plain's swathes, then its tile structure (SLATE_FAR), after the calm,
// fading out toward the plain's edge with its air, so no blotch meets that air at
// a line. Its darker blotches darken the albedo the cracks read (slateCrack), so
// the wet sheen comes and goes with them far out. Behind About (slateBehindAbout(),
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
// and About (slateGlossT) and, in wetter and drier patches, its share there
// (slateGlossW); both 0 without a gloss, and only then is anything computed.
// slateWaterFar(d): the water's fade at view distance d, reaching gloss.far
// under a gloss. slateTextGap(): how far a point lies outside a text box, as
// slateBehind() measures it.
const LOOK = SLATE_LOOK;
const LOOK_GLSL = `uniform vec4 slateClear, slateClearLight, slateClearShade, slateMist, slateGloss;
uniform vec2 slateShadowFade;
float slateGlossT = 0.0, slateGlossW = 0.0;
float slateTextGap(vec4 r,vec2 v){return length(max(max(r.xy-v,v-r.zw),0.)*vec2(slateAspect,1.)/min(slateAspect,1.));}
float slateWaterFar(float d){return smoothstep(mix(${glslNumber(SLATE_WATER.far[0])},${glslNumber(LOOK.gloss.far[0])},slateGlossT),mix(${glslNumber(SLATE_WATER.far[1])},${glslNumber(LOOK.gloss.far[1])},slateGlossT),d);}
void slateGlossSet(){if(slateGloss.z>0.){vec2 v=vSlateClip.xy/vSlateClip.w*.5+.5;slateGlossT=smoothstep(0.,${glslNumber(LOOK.gloss.text[0])},slateTextGap(slateText,v))*smoothstep(0.,${glslNumber(LOOK.gloss.text[1])},slateTextGap(slateAbout,v));slateGlossW=slateGlossT*mix(${glslNumber(LOOK.gloss.patch[1])},1.,smoothstep(.35,.7,slateNoise(vMudWorld.xz/${glslNumber(LOOK.gloss.patch[0])})));}}
`;
// After the shadow maps' functions: the moon's shadow fades with distance from
// the subject under a shot's look (slateShadowFade: near, far; whole at 0).
const LOOK_SHADOW = `#include <shadowmap_pars_fragment>
#ifdef USE_SHADOWMAP
float slateShadow(sampler2D map,vec2 size,float bias,float radius,vec4 coord){float s=getShadow(map,size,bias,radius,coord);return slateShadowFade.y>0.?mix(1.,s,1.-smoothstep(slateShadowFade.x,slateShadowFade.y,length(vMudWorld.xz-slateCalmAt.xy))):s;}
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
// by its warm colour; any other light is the crown's cool point fill. Three's light loops fetch each light through get*LightInfo(), so
// wrapping those marks a directional one (slateDirectional): where the crown's
// point light lines up with the key or the fill from some spot on the ground,
// it stays the crown's.
// Where the soil is wet (slateWetLamp, set before the lights) the moon and the
// lantern also light the water film over it (SLATE_WATER.moon, .lamp), on the
// water's normal (slateWaterN), into slateMoonSpec and slateLampSpec.
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
void RE_Direct_Moonlit(const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight) {
  IncidentLight slateL = directLight;
  bool slateWarm = directLight.color.b < .7*directLight.color.r;
  bool slateKey = slateDirectional && !slateWarm && dot(directLight.direction, normalize(mat3(viewMatrix)*${unitGlsl(MOON_LIGHTS.key)})) > .9999;
  #ifdef USE_ENVMAP
  if (!slateWarm) slateL.color *= slateKey ? ${glslNumber(LIGHT.key)} : slateDirectional && dot(directLight.direction, normalize(mat3(viewMatrix)*${unitGlsl(MOON_LIGHTS.fill)})) > .9999 ? ${glslNumber(LIGHT.fill)} : ${glslNumber(LIGHT.crown)};
  #endif
  RE_Direct_Physical(slateL, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight);
  #ifdef USE_ENVMAP
  if (slateWarm) reflectedLight.directDiffuse += ${glslNumber(LIGHT.bounce)}*slateL.color*BRDF_Lambert(material.diffuseColor);
  #endif
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
    Object.assign(shader.uniforms, uniforms, FLASH_GROUND, FLASH_UNIFORMS);
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
uniform vec4 slateCalm, slateCalmAt;
float slateFlatAt(vec2 p){return slateCalm.w*smoothstep(slateCalmAt.z,slateCalmAt.w,length(p-slateCalmAt.xy));}
uniform float slateRockContact, slateContactGain, slateAspect;
uniform vec3 babelFlashKey;
uniform vec4 babelFlash, babelFlashLight, babelFlashSky;
#define SLATE_TEXT_KNEE ${glslNumber(WATER.text[1])}
uniform vec4 slateText, slateAbout;
${authored ? "uniform sampler2D slateDetail;\n" : ""}${close ? "uniform sampler2D slateGrit, slateRelief;\n" : ""}${POND_GLSL}float slateHash(vec2 p){vec3 q=fract(p.xyx*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
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
      ${close ? CLOSE_PRE : ""}sampledDiffuseColor.rgb = mix(sampledDiffuseColor.rgb, slateMean, slateFlatAt(vMudWorld.xz));${FAR_MAP}
      diffuseColor *= sampledDiffuseColor;${close ? CLOSE_MAP : ""}
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
      float slatePuddle = smoothstep(-.04, .04, max(max(${PUDDLE_GLSL}, slateStreams(vMudWorld.xz))*(${glslNumber(SLATE_PUDDLES.fill)}+.4*slateNoise(vMudWorld.xz*.9))-slateH, ${POND_LEVEL}))*(1.0-slateDry);
      float slateLanternPuddle = slatePuddle*(1.0-smoothstep(1.0, 1.4, slatePondR(vMudWorld.xz)));
      slateWet = max(slateWet, slatePuddle);
      roughnessFactor = mix(mix(roughnessFactor, ${glslNumber(SLATE_WET.roughness)}, slateWet*${glslNumber(SLATE_WET.roughnessWeight)}), ${glslNumber(SLATE_PUDDLES.roughness)}, slatePuddle);
      roughnessFactor = mix(roughnessFactor, ${glslNumber(SLATE_PUDDLES.lantern.roughness)}, slateLanternPuddle);
      float slateMatte = (1.0-smoothstep(${SLATE_WET.close.near.map(glslNumber)}, length(vViewPosition)))*(1.0-slatePuddle);
      roughnessFactor = mix(roughnessFactor, max(roughnessFactor, ${glslNumber(SLATE_WET.close.roughness)}), slateMatte);
      diffuseColor.rgb *= (1.0 - ${glslNumber(SLATE_WET.darken)}*slateWet)*(1.0 - ${glslNumber(SLATE_PUDDLES.darken)}*slatePuddle);
      float slateAo = 0.0;
      for (int i = 0; i < ${SLATE_CONTACTS}; i++) slateAo = max(slateAo, (1.0-smoothstep(.55, 1.35, length(vMudWorld.xz-slateContacts[i].xy)/max(slateContacts[i].z, .001)))*slateContacts[i].w*(i < 2 ? 1.0 : slateRockContact));
      diffuseColor.rgb *= 1.0 - slateAo*slateContactGain;
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
      vec2 slateHx = vec2(texture2D(slateDetail, slateUvD+vec2(1./512.,0.)).r, texture2D(slateDetail, slateUvD+vec2(0.,1./512.)).r);
      vec3 mapN = vec3((mix(slateNA.xy, slateNB.xy*slateTurnB, slateW)/length(vec2(slateW,1.-slateW))*normalScale+(slateH-slateHx)*slateTurnD*(${glslNumber(DETAIL.strength)}*slateNear))${close ? `*(1.-${glslNumber(CLOSE.calm)}*slateCN)` : ""}*(1.-slateFlatAt(vMudWorld.xz))*(1.-${glslNumber(SLATE_PUDDLES.flatten)}*slatePuddle), mix(slateNA.z, slateNB.z, slateW));
      normal = normalize(tbn*mapN);${close ? CLOSE_NORMAL : ""}
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
      float slateQuiet = 1.0-${glslNumber(SLATE_CALM_GLINT)}*slateFlatAt(vMudWorld.xz)*(1.0-slatePuddle);
      reflectedLight.directSpecular *= slateQuiet;
      reflectedLight.indirectSpecular *= slateQuiet;
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
      gl_FragColor.rgb *= 1.0-slateCalm.x*(1.0-smoothstep(slateCalm.y, slateCalm.z, length(vViewPosition)));
      #ifdef USE_FOG
      float earthHorizon = max(${PLAIN_EDGE},
        smoothstep(230.0, 330.0, vFogDepth));
      vec3 earthAir = ${TERRAIN_HORIZON}*${glslNumber(HORIZON_AIR.ground)};
      earthHorizon *= smoothstep(1.0, 1.15, dot(gl_FragColor.rgb, ${LUMA})/dot(earthAir, ${LUMA}));
      gl_FragColor.rgb = mix(gl_FragColor.rgb, earthAir, earthHorizon);
      #endif${LOOK_AFTER}${useWet && mistOn ? "\n      gl_FragColor.rgb = mistOver(gl_FragColor.rgb, vMudWorld);" : ""}
      gl_FragColor.a = ${DEPTH_LAYER.ground};
    `,
        );
    if (useWet) material.userData.slateRoot?.(shader);
  };
  material.needsUpdate = true;
}
