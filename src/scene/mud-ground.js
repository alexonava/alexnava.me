import { DEPTH_LAYER } from "./depth-layers.js";
import { HORIZON_AIR, TERRAIN_HORIZON } from "./hill-silhouette.js";
import { ESTATE, estatePoint } from "./estate-layout.js";
// The estate's human scale for props and trees: one doorway height. The
// timber lookout matches it: its cabin rises about 6.5 from gallery floor
// (29.9) to eave (36.4) above a railing about 3.9 high.
export const DOOR_HEIGHT = 6.6;

// The terrain's dune field, helpers.js dune(): amplitude * wave(frequency *
// (sx * x + sz * z)) in world x/z. Restated here so the slate's wet sheen can
// find the hollows in the shader; a test holds it to scene.groundHeight.
export const TERRAIN_DUNE_TERMS = Object.freeze([
  Object.freeze({ amplitude: 1.8, wave: "sin", frequency: 0.055, sx: 1, sz: 0 }),
  Object.freeze({ amplitude: 1.35, wave: "cos", frequency: 0.052, sx: 0, sz: 1 }),
  Object.freeze({ amplitude: 0.9, wave: "sin", frequency: 0.031, sx: 1, sz: 1 }),
  Object.freeze({ amplitude: 0.55, wave: "cos", frequency: 0.018, sx: 1, sz: -1 }),
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
  hollow: Object.freeze([-3.2, -1.0]), // dune height: fully wet below, dry above
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
});

// The seamless slate v2 tile (Assets/Materials/slate-v2), repeated every 22
// units. A second lookup of the same tile, 1/0.866 larger and turned 126.87
// degrees (a 3-4-5 turn), is blended in by a 17-unit noise and by which sample
// is higher (lighter), with the blend's lost contrast restored about the tile's
// mean linear colour (delivery-report.json). The detail map, a 5.03-unit high
// band turned 36.87 degrees, adds close relief and grain within 6-28 units of
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
    strength: 2.4, // tangent slope per grey step of one texel (about the base map's relief)
    albedo: 0.18,
    near: Object.freeze([6.0, 28.0]), // view distance: full detail within, none beyond
  }),
});

// Moonlit puddles where the lantern's reflection lands in both lantern shots,
// along the tree's drip line and in Portrait's right foreground: zone anchors
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
      dist: 3.0,
      radius: 2.8,
      stretch: 1.4,
      along: 33,
    }),
    Object.freeze({ anchor: "tree", deg: 185, dist: 8.0, radius: 2.2 }),
    Object.freeze({ anchor: "tree", deg: 75, dist: 9.0, radius: 2.5 }),
    Object.freeze({ anchor: "tree", deg: -100, dist: 16.0, radius: 2.0 }),
  ]),
  fill: 0.62,
  roughness: 0.12,
  darken: 0.5,
  flatten: 0.85,
  specular: 4,
  lantern: Object.freeze({ roughness: 0.2, specular: 0.8 }),
  zenith: Object.freeze([0.07, 0.085, 0.13]),
});

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
// them, over a fifth of the screen's smaller side (index.js measures the text:
// slateText, slateAbout); there all the ground reflects, the water and the
// soil's own highlights (a puddle's moon glint among them), then passes a
// luminance knee, text[1]; beside About so do the bark's highlights from the
// lantern and the crown's fill (architecture.js, through SLATE_TEXT_GUARD).
export const SLATE_WATER = Object.freeze({
  f0: 0.02,
  text: Object.freeze([0.3, 0.035]),
  level: 0.7,
  film: Object.freeze([0.5, 0.45]),
  patch: Object.freeze([9, 0.55]),
  roughness: Object.freeze([0.12, 0.02]),
  gain: Object.freeze([1.5, 1.8]),
  far: Object.freeze([70.0, 130.0]),
  moon: Object.freeze({ roughness: 0.25, gain: 1, knee: 0.06 }),
  lamp: Object.freeze({ roughness: 0.18, gain: 1.6, knee: 0.35 }),
});

// The text guard's screen test, shared by the ground and the bark
// (architecture.js): slateBehindText() is 1 behind the name and intro
// (slateText) or About (slateAbout), boxes in the canvas's UV, easing to 0
// over a fifth of the screen's smaller side (slateAspect, the canvas's);
// vSlateClip is the fragment's clip-space position.
export const SLATE_TEXT_GLSL = `float slateBehind(vec4 r,vec2 v){vec2 f=max(max(r.xy-v,v-r.zw),0.)*vec2(slateAspect,1.)/min(slateAspect,1.);return 1.-smoothstep(0.,.2,length(f));}
float slateBehindText(){vec2 v=vSlateClip.xy/vSlateClip.w*.5+.5;return max(slateBehind(slateText,v),slateBehind(slateAbout,v));}
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
    // The name and intro, and About, on the canvas (x0, y0, x1, y1 in its UV,
    // y up; empty beyond it) and the canvas's aspect, for the water to ease off
    // behind them.
    slateText: { value: { x: 2, y: 2, z: -1, w: -1 } },
    slateAbout: { value: { x: 2, y: 2, z: -1, w: -1 } },
    slateAspect: { value: 1 },
  };
}

const glslVec = (values) => `vec${values.length}(${values.map(glslNumber).join(",")})`;
const glslPoint = ({ x, z }) => glslVec([+x.toFixed(2), +z.toFixed(2)]);
const TREE_GLSL = glslPoint(ESTATE.tree);
const PATH_LENGTH = glslNumber(
  +Math.hypot(ESTATE.tree.x - ESTATE.tower.x, ESTATE.tree.z - ESTATE.tower.z).toFixed(2),
);
const SECOND = SLATE_TILING.second,
  DETAIL = SLATE_TILING.detail;
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
const PUDDLE_GLSL = PUDDLE_ZONES_GLSL.reduce((all, zone) => `max(${all},${zone})`);
const unitGlsl = (values) => {
  const length = Math.hypot(...values);
  return glslVec(values.map((value) => +(value / length).toFixed(4)));
};
const LUMA = "vec3(.2126,.7152,.0722)";
const WATER = SLATE_WATER,
  LIGHT = SLATE_LIGHT;
// The film ground's own direct light (SLATE_LIGHT): it finds the key and the
// fill among the directional lights by their fixed directions and the lantern
// by its warm colour; any other light is the crown's cool point fill. Three's
// light loops fetch each light through get*LightInfo(), so wrapping those marks
// a directional one (slateDirectional): where the crown's point light lines up
// with the key or the fill from some spot on the ground, it stays the crown's.
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
const WATER_BEFORE_LIGHTS = `slateWaterN = normalize(mix(mix(normal, nonPerturbedNormal, ${glslNumber(WATER.level)}), mat3(viewMatrix)[1], slatePuddle)+slateWaterTilt);
      slateWetFilm = (${glslNumber(WATER.film[0])}*(1.0-slateDry)+${glslNumber(WATER.film[1])}*slateWet)*mix(${glslNumber(WATER.patch[1])}, 1.0, smoothstep(.3, .7, slateNoise(vMudWorld.xz/${glslNumber(WATER.patch[0])})))*(1.0-slatePuddle)*(1.0-smoothstep(${WATER.far.map(glslNumber)}, length(vViewPosition)));
      #include <lights_fragment_begin>`;
// After the light maps: the ambient's share and the night sky's light, and the
// sky the water mirrors, at the film's or a puddle's roughness.
const WATER_SKY = `#include <lights_fragment_maps>
      #ifdef USE_ENVMAP
      irradiance *= ${glslNumber(LIGHT.ambient)};
      iblIrradiance *= ${glslNumber(LIGHT.sky)};
      vec3 slateWaterSky = mix(getIBLRadiance(geometryViewDir, slateWaterN, mix(${glslNumber(WATER.roughness[0])}, ${glslNumber(WATER.roughness[1])}, slatePuddle))*mix(${glslNumber(WATER.gain[0])}, ${glslNumber(WATER.gain[1])}, slatePuddle), slateWaterBark, slateWaterVeil*slatePuddle);
      #endif`;
// After the soil's own clamps: the water's mirror (water Fresnel, the film's
// share or a puddle whole, fading with distance; slateSkyVis is the sky the
// tree leaves open, terrain-build.js) and the lantern on the film, under its knee.
const WATER_AFTER_LIGHTS = `
      #ifdef USE_ENVMAP
      float slateWaterCover = slateWetFilm+slatePuddle*(1.0-smoothstep(${WATER.far.map(glslNumber)}, length(vViewPosition)));
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
  { detail = null, contacts = null } = {},
) {
  const useWet = Boolean(film);
  const authored = Boolean(useWet && detail);
  const uniforms = contacts ?? createSlateContacts();
  if (authored) uniforms.slateDetail.value = detail;
  // terrain-build.js settleRoots() sets material.userData.slateRoot once the film
  // terrain and its root attribute arrive; the slate then applies it last
  // (the roots' contact shade and settled soil) under a "+root" key.
  material.customProgramCacheKey = () =>
    (useWet ? (authored ? "moonlit-slate-v3" : "moonlit-slate-v3-p") : "ground-baseline") +
    (useWet && material.userData.slateRoot ? "+root" : "");
  material.onBeforeCompile = (shader) => {
    if (!useWet) return;
    Object.assign(shader.uniforms, uniforms);
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
uniform float slateRockContact, slateContactGain, slateAspect;
#define SLATE_TEXT_KNEE ${glslNumber(WATER.text[1])}
uniform vec4 slateText, slateAbout;
${authored ? "uniform sampler2D slateDetail;\n" : ""}float slateHash(vec2 p){vec3 q=fract(p.xyx*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
float slateNoise(vec2 p){vec2 i=floor(p),f=fract(p);f*=f*(3.-2.*f);return mix(mix(slateHash(i),slateHash(i+vec2(1,0)),f.x),mix(slateHash(i+vec2(0,1)),slateHash(i+1.),f.x),f.y);}
${SLATE_TEXT_GLSL}`
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
      float slatePuddle = smoothstep(-.04, .04, ${PUDDLE_GLSL}*(${glslNumber(SLATE_PUDDLES.fill)}+.4*slateNoise(vMudWorld.xz*.9))-slateH)*(1.0-slateDry);
      float slateLanternPuddle = slatePuddle*(${PUDDLE_ZONES_GLSL[0]});
      slateWet = max(slateWet, slatePuddle);
      roughnessFactor = mix(mix(roughnessFactor, ${glslNumber(SLATE_WET.roughness)}, slateWet*${glslNumber(SLATE_WET.roughnessWeight)}), ${glslNumber(SLATE_PUDDLES.roughness)}, slatePuddle);
      roughnessFactor = mix(roughnessFactor, ${glslNumber(SLATE_PUDDLES.lantern.roughness)}, slateLanternPuddle);
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
      vec3 mapN = vec3((mix(slateNA.xy, slateNB.xy*slateTurnB, slateW)/length(vec2(slateW,1.-slateW))*normalScale+(slateH-slateHx)*slateTurnD*(${glslNumber(DETAIL.strength)}*slateNear))*(1.-${glslNumber(SLATE_PUDDLES.flatten)}*slatePuddle), mix(slateNA.z, slateNB.z, slateW));
      normal = normalize(tbn*mapN);
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
      reflectedLight.directSpecular *= (1.0 + ${glslNumber(SLATE_WET.specular)}*slateWet)*(1.0 + ${glslNumber(SLATE_PUDDLES.specular)}*slatePuddle - ${glslNumber(SLATE_PUDDLES.specular - SLATE_PUDDLES.lantern.specular)}*slateLanternPuddle);
      reflectedLight.directSpecular /= 1.0 + 2.5*dot(reflectedLight.directSpecular,vec3(.2126,.7152,.0722))*slateLanternPuddle;
      float slateBehind = slateBehindText(), slateShow = 1.0-${glslNumber(WATER.text[0])}*slateBehind;
      reflectedLight.indirectSpecular *= mix(1.0, ${glslNumber(+(SLATE_WET.indirect[1] / SLATE_WET.indirect[0]).toFixed(4))}, slateWet*slateShow);${WATER_AFTER_LIGHTS}
      reflectedLight.directSpecular /= 1.0+slateBehind*dot(reflectedLight.directSpecular,vec3(.2126,.7152,.0722))/SLATE_TEXT_KNEE;
      reflectedLight.indirectSpecular /= 1.0+slateBehind*dot(reflectedLight.indirectSpecular,vec3(.2126,.7152,.0722))/SLATE_TEXT_KNEE;
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
      #ifdef USE_FOG
      float earthHorizon = max(smoothstep(155.0, 190.0, max(abs(vMudWorld.x),abs(vMudWorld.z))),
        smoothstep(230.0, 330.0, vFogDepth));
      vec3 earthAir = ${TERRAIN_HORIZON}*${glslNumber(HORIZON_AIR.ground)};
      earthHorizon *= smoothstep(1.0, 1.15, dot(gl_FragColor.rgb, ${LUMA})/dot(earthAir, ${LUMA}));
      gl_FragColor.rgb = mix(gl_FragColor.rgb, earthAir, earthHorizon);
      #endif
      gl_FragColor.a = ${DEPTH_LAYER.ground};
    `,
        );
    if (useWet) material.userData.slateRoot?.(shader);
  };
  material.needsUpdate = true;
}
