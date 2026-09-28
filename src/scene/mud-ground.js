import { resolveSceneModes } from "./scene-modes.js";
import { DEPTH_LAYER } from "./depth-layers.js";
import { TERRAIN_HORIZON } from "./hill-silhouette.js";
import { ESTATE, estateLantern, estatePoint } from "./estate-layout.js";
// The estate's human scale for props, trees and mud tiles: one doorway height.
// It was measured on the earlier stone tower's arched door (sill 1.64 to arch
// ~8.24). The timber lookout keeps the same scale: its cabin rises about 6.5
// from gallery floor (29.9) to eave (36.4) above a railing about 3.9 high.
export const DOOR_HEIGHT = 6.6;
export const MUD_TILE_WIDTH = DOOR_HEIGHT * 1.6;
export function wantsMud(search = "") {
  return resolveSceneModes(search).mud;
}
export function wantsPropScale(search = "") {
  return resolveSceneModes(search).propScale;
}
const smooth = (x) => x * x * (3 - 2 * x);
function noise(u, v, cells) {
  const x = u * cells,
    y = v * cells,
    ix = Math.floor(x),
    iy = Math.floor(y);
  const h = (a, b) => {
    const n =
      Math.sin(
        (((a % cells) + cells) % cells) * 127.1 + (((b % cells) + cells) % cells) * 311.7 + 19.3,
      ) * 43758.5453;
    return n - Math.floor(n);
  };
  const fx = smooth(x - ix),
    fy = smooth(y - iy);
  return (
    (h(ix, iy) * (1 - fx) + h(ix + 1, iy) * fx) * (1 - fy) +
    (h(ix, iy + 1) * (1 - fx) + h(ix + 1, iy + 1) * fx) * fy
  );
}
// Periodic world-scaled fields: same features at every quality tier.
export function mudSample(u, v) {
  const broad = noise(u, v, 4),
    soil = noise(u, v, 16),
    grain = noise(u, v, 64);
  const wet = smooth(Math.max(0, Math.min(1, (broad - 0.67) / 0.22)));
  return {
    height: 0.6 * soil + 0.16 * grain,
    tone: broad * 0.6 + soil * 0.4,
    wet,
    roughness: 0.9 - 0.35 * wet,
  };
}
export function makeMudCanvases(source, createCanvas = () => document.createElement("canvas")) {
  const size = source.width,
    maps = {};
  const original = source.getContext("2d").getImageData(0, 0, size, size).data;
  const heights = new Float32Array(size * size);
  for (const kind of ["color", "normal", "roughness"]) {
    const canvas = createCanvas();
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Mud canvas unavailable");
    maps[kind] = { canvas, ctx, pixels: ctx.createImageData(size, size) };
  }
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = y * size + x,
        p = i * 4,
        s = mudSample(x / size, y / size);
      heights[i] = s.height;
      const detail = (original[p] + original[p + 1] + original[p + 2]) / 3 / 255 - 0.5;
      const shade = 0.78 + 0.34 * s.tone - 0.12 * s.wet + 0.1 * detail;
      const c = maps.color.pixels.data,
        r = maps.roughness.pixels.data;
      c[p] = 82 * shade;
      c[p + 1] = 69 * shade;
      c[p + 2] = 56 * shade;
      c[p + 3] = 255;
      r[p] = r[p + 1] = r[p + 2] = Math.round(s.roughness * 255);
      r[p + 3] = 255;
    }
  const h = (x, y) => heights[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const p = (y * size + x) * 4,
        n = maps.normal.pixels.data;
      const dx = (h(x + 1, y) - h(x - 1, y)) * size * 0.008,
        dy = (h(x, y + 1) - h(x, y - 1)) * size * 0.008;
      const len = Math.hypot(dx, dy, 1);
      n[p] = 128 - (127 * dx) / len;
      n[p + 1] = 128 - (127 * dy) / len;
      n[p + 2] = 128 + 127 / len;
      n[p + 3] = 255;
    }
  for (const map of Object.values(maps)) map.ctx.putImageData(map.pixels, 0, 0);
  return Object.fromEntries(Object.entries(maps).map(([k, v]) => [k, v.canvas]));
}

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

// The default film slate's calm wet sheen. Terrain hollows and the map's dark
// crack texels hold water, and a halo around the tree stays damp under its
// drip line; the tower footing, the tree's root plate and the path stay dry,
// except where the path crosses the lantern clearing. Wet ground is smoother
// and darker, its direct highlight is clamped a little less, and a low Fresnel
// term reflects a mostly neutral share of the fog color at grazing angles.
// Both lifts are kept well under the dry ground's own radiance, so distant
// ground does not wash out pale blue-grey.
export const SLATE_WET = Object.freeze({
  hollow: Object.freeze([-3.2, -1.0]), // dune height: fully wet below, dry above
  crack: Object.freeze([0.07, 0.18]), // linear map luminance: dark cracks hold water
  crackWeight: 0.55,
  halo: Object.freeze([6.0, 16.0]), // distance from the tree: damp within, dry beyond
  haloWeight: 0.45,
  rootDry: Object.freeze([ESTATE.tree.root, 5.7]), // the root plate stays dry
  roughness: 0.5,
  roughnessWeight: 0.75,
  darken: 0.14,
  specular: 0.8, // direct specular clamp relaxed by up to 1 + 0.8
  fresnel: 0.15, // low: grazing sheen only, measured calm behind the intro text
  fresnelNeutral: 0.6, // share of the fog reflection taken at the fog's own luminance
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
  macroCell: 53,
  detail: Object.freeze({
    ratio: 4.37, // base tiles per detail tile: 22 / 4.37 = 5.03 units
    turn: Object.freeze([0.8, 0.6, -0.6, 0.8]),
    strength: 2.4, // tangent slope per grey step of one texel (about the base map's relief)
    albedo: 0.18,
    near: Object.freeze([6.0, 28.0]), // view distance: full detail within, none beyond
  }),
});

// Moonlit puddles where the lantern's reflection lands in both lantern shots
// and along the tree's drip line: zone anchors and angles as estatePoint()
// takes them, radius in units, stretched along a world angle. Water fills the
// detail map's low texels first, so edges follow the cracks. Puddles are glassy,
// darker and calmer, catch the existing moon and lantern lights, and reflect a
// sky built from the fog and zenith colours (no environment map).
export const SLATE_PUDDLES = Object.freeze({
  zones: Object.freeze([
    Object.freeze({ anchor: "lantern", deg: -115, dist: 3.0, radius: 2.8, stretch: 1.4, along: 33 }),
    Object.freeze({ anchor: "tree", deg: 185, dist: 8.0, radius: 2.2 }),
    Object.freeze({ anchor: "tree", deg: 75, dist: 9.0, radius: 2.5 }),
  ]),
  roughness: 0.12,
  darken: 0.5,
  flatten: 0.85,
  specular: 4,
  lantern: Object.freeze({ roughness: 0.20, specular: 0.8 }),
  sky: 2,
  zenith: Object.freeze([0.07, 0.085, 0.13]),
  lanternPathRelease: Object.freeze([4.0, 7.0]), // the path is wet only this near the lantern
});

// Contact darkening on the slate: slateContacts[i] = (x, z, radius, strength),
// darkest within 0.55 radius and gone by 1.35. The first two (the tree's roots
// and the lantern) are always on; the rest are the scattered rocks
// (rock-scatter.js), gated by slateRockContact until they appear. Uniforms, so
// shadows switching on or off (gain 0.6 with, 1 without) never recompiles.
export const SLATE_CONTACTS = 16;
// The set also holds the detail map's slot: a program reused from the cache
// keeps its first uniform objects, so a new detail map must fill the same one.
export function createSlateContacts(values = new Float32Array(SLATE_CONTACTS * 4)) {
  return {
    slateContacts: { value: values },
    slateRockContact: { value: 0 },
    slateContactGain: { value: 1 },
    slateDetail: { value: null },
  };
}

const glslVec = (values) => `vec${values.length}(${values.map(glslNumber).join(",")})`;
const glslPoint = ({ x, z }) => glslVec([+x.toFixed(2), +z.toFixed(2)]);
const TREE_GLSL = glslPoint(ESTATE.tree);
const PATH_LENGTH = glslNumber(+Math.hypot(ESTATE.tree.x - ESTATE.tower.x, ESTATE.tree.z - ESTATE.tower.z).toFixed(2));
const SECOND = SLATE_TILING.second,
  DETAIL = SLATE_TILING.detail;
// Each zone: 1 inside half its radius, 0 at its radius.
const PUDDLE_ZONES_GLSL = SLATE_PUDDLES.zones
  .map(({ anchor, deg, dist, radius, stretch = 1, along = 0 }) => {
    const offset = `(vMudWorld.xz-${glslPoint(estatePoint(anchor, deg, dist))})`,
      c = +Math.cos((along * Math.PI) / 180).toFixed(4),
      s = +Math.sin((along * Math.PI) / 180).toFixed(4);
    const local = stretch === 1 ? offset : `mat2(${[c, -s, s, c].map(glslNumber)})*${offset}/vec2(${glslNumber(stretch)},1.)`;
    return `1.-smoothstep(.5,1.,length(${local})/${glslNumber(radius)})`;
  });
const PUDDLE_GLSL = PUDDLE_ZONES_GLSL.reduce((all, zone) => `max(${all},${zone})`);

// Film ground material, chosen from the mode rather than the published maps,
// so the procedural surface shown while maps load, or after a fallback,
// matches the loaded ground. `slate` (the default film ground) takes the
// slate tint, the wet sheen, puddles and contacts. `surface` is palette.js
// GROUND_SURFACE_MATERIAL.
export const FILM_EARTH_SURFACE = Object.freeze({ color: 0x615447, roughness: 0.93 });
export function filmGroundSurface({ muddy = false, film = false, slate = false, surface }) {
  if (muddy) return { color: 0xffffff, roughness: 1, metalness: 0, slate: false };
  if (!film) return { color: surface.color, roughness: surface.roughness, metalness: surface.metalness, slate: false };
  if (slate) return { color: surface.filmColor, roughness: surface.roughness, metalness: 0, slate: true };
  return { ...FILM_EARTH_SURFACE, metalness: 0, slate: false };
}

// `grass`, when present, is { grassColorMap, grassMaskMap, grassTile } and only ever applies
// under `film` — patchy grass blended in away from the worn tower/root rings
// `earthContact` already tracks, using its own lower-frequency sine field so
// it doesn't correlate with the earth patchiness pattern. `slate` adds the
// default slate's wetness, puddles and contacts under `film`; the earth
// comparison's grass never takes them. `detail` is the slate's detail map: with
// it (the authored maps) the slate also blends its two tile lookups and adds
// the close relief; without it (the procedural surface while maps load, or
// after a fallback) the `-p` program skips both. `contacts` is the shared
// createSlateContacts() uniform set.
export function configureMudShading(
  material,
  active,
  quiet = false,
  film = false,
  grass = null,
  { slate = false, detail = null, contacts = null } = {},
) {
  const useGrass = Boolean(film && grass);
  const useWet = Boolean(film && slate && !grass);
  const authored = Boolean(useWet && detail);
  const uniforms = contacts ?? createSlateContacts();
  if (authored) uniforms.slateDetail.value = detail;
  // terrain-build.js settleRoots() sets material.userData.slateRoot once the film
  // terrain and its root attribute arrive; the slate then applies it last
  // (the roots' contact shade and settled soil) under a "+root" key.
  material.customProgramCacheKey = () =>
    (film
      ? useGrass
        ? "moonlit-earth-grass-v1"
        : useWet
          ? authored
            ? "moonlit-slate-v3"
            : "moonlit-slate-v3-p"
          : "moonlit-earth-v2"
      : active
        ? quiet
          ? "mud-quiet-earth-v2"
          : "mud-world-variation-v1"
        : "ground-baseline") + (useWet && material.userData.slateRoot ? "+root" : "");
  material.onBeforeCompile = (shader) => {
    if (!active && !film) return;
    if (useGrass) {
      shader.uniforms.grassColor = { value: grass.grassColorMap };
      shader.uniforms.grassMask = { value: grass.grassMaskMap };
    }
    if (useWet) Object.assign(shader.uniforms, uniforms);
    // The dune field varies over 100+ world units; the film terrain's 3-unit
    // quads carry it per vertex, so fragments only read the interpolated height.
    const wetVarying = useWet ? "varying float vSlateDune;\n" : "";
    shader.vertexShader = "varying vec3 vMudWorld;\n" + wetVarying + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      "#include <begin_vertex>\nvMudWorld = (modelMatrix * vec4(position, 1.0)).xyz;" +
        (useWet ? `\nvSlateDune = ${TERRAIN_DUNE_GLSL};` : ""),
    );
    // Hoskins' sine-free hash, so every GPU draws the same value noise.
    shader.fragmentShader =
      (useGrass ? "uniform sampler2D grassColor;\nuniform sampler2D grassMask;\n" : "") +
      "varying vec3 vMudWorld;\n" +
      wetVarying +
      (useWet
        ? `uniform vec4 slateContacts[${SLATE_CONTACTS}];
uniform float slateRockContact, slateContactGain;
${authored ? "uniform sampler2D slateDetail;\n" : ""}float slateHash(vec2 p){vec3 q=fract(p.xyx*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
float slateNoise(vec2 p){vec2 i=floor(p),f=fract(p);f*=f*(3.-2.*f);return mix(mix(slateHash(i),slateHash(i+vec2(1,0)),f.x),mix(slateHash(i+vec2(0,1)),slateHash(i+1.),f.x),f.y);}
`
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
    const tree = ESTATE.tree;
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <roughnessmap_fragment>",
      `#include <roughnessmap_fragment>
      float mudPatch = 0.5 + 0.25 * sin(vMudWorld.x * 0.21 + sin(vMudWorld.z * 0.13)) + 0.25 * sin(vMudWorld.z * 0.17 + sin(vMudWorld.x * 0.11));
      float footingDry = 1.0 - smoothstep(7.0, 13.0, length(vMudWorld.xz));
      roughnessFactor = mix(0.9, roughnessFactor, smoothstep(0.72, 0.95, mudPatch) * (1.0 - footingDry));
      diffuseColor.rgb *= 1.0 - 0.08 * footingDry;
      diffuseColor.rgb *= 0.9 + 0.15 * mudPatch;
      ${
        quiet && !film
          ? `
      float rootContact = 1.0 - smoothstep(1.8, 6.5, length(vMudWorld.xz - ${TREE_GLSL}));
      float dryContact = max(footingDry, rootContact);
      roughnessFactor = mix(0.94, max(0.72, roughnessFactor), smoothstep(0.84, 0.99, mudPatch) * (1.0 - dryContact));
      diffuseColor.rgb *= 1.0 - 0.08 * rootContact;
      `
          : ""
      }
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
      diffuseColor.rgb *= .84 + .10*earthBroad - .04*earthContact - .035*damp + .035*approach;
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
      float slateDry = max(max(footingDry, 1.0-smoothstep(${SLATE_WET.rootDry.map(glslNumber)}, slateTree)), approach*smoothstep(${SLATE_PUDDLES.lanternPathRelease.map(glslNumber)}, length(vMudWorld.xz-${glslPoint(estateLantern())})));
      float slateWet = clamp(max(slateHollow, slateCrack*${glslNumber(SLATE_WET.crackWeight)}) + (1.0-smoothstep(${SLATE_WET.halo.map(glslNumber)}, slateTree))*${glslNumber(SLATE_WET.haloWeight)}, 0.0, 1.0)*(1.0-slateDry);
      float slatePuddle = smoothstep(-.04, .04, ${PUDDLE_GLSL}*(.45+.4*slateNoise(vMudWorld.xz*.9))-slateH)*(1.0-slateDry);
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
      ${
        useGrass
          ? `
      vec2 grassUv = vMudWorld.xz / ${grass.grassTile.toFixed(3)};
      vec3 grassColorSample = texture2D(grassColor, grassUv).rgb;
      float grassMaskSample = texture2D(grassMask, grassUv).r;
      float grassAmount = clamp((grassMaskSample - 0.28) / 0.48, 0.0, 1.0) * .22 * (1.0 - worn);
      diffuseColor.rgb = mix(diffuseColor.rgb, grassColorSample, grassAmount);
      roughnessFactor = mix(roughnessFactor, .82, grassAmount);
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
      #ifdef USE_FOG
      float slateFresnel = pow(1.0 - saturate(dot(geometryNormal, geometryViewDir)), 5.0);
      vec3 slateSheen = mix(fogColor, vec3(dot(fogColor, vec3(.2126,.7152,.0722))), ${glslNumber(SLATE_WET.fresnelNeutral)});
      reflectedLight.indirectSpecular += slateSheen*(slateWet*slateFresnel*${glslNumber(SLATE_WET.fresnel)});
      reflectedLight.indirectSpecular += mix(fogColor, ${glslVec(SLATE_PUDDLES.zenith)}, smoothstep(0.0, 0.5, (reflect(-geometryViewDir, normal)*mat3(viewMatrix)).y))*((.02+.98*slateFresnel)*${glslNumber(SLATE_PUDDLES.sky)}*slatePuddle);
      #endif
      `
          : ""
      }
    `,
        )
        .replace(
          "#include <fog_fragment>",
          `
      #ifdef USE_FOG
      float earthHorizon = max(smoothstep(155.0, 190.0, max(abs(vMudWorld.x),abs(vMudWorld.z))),
        smoothstep(230.0, 330.0, vFogDepth));
      gl_FragColor.rgb = mix(gl_FragColor.rgb, ${TERRAIN_HORIZON}, earthHorizon);
      #endif
      gl_FragColor.a = ${DEPTH_LAYER.ground};
    `,
        );
    if (useWet) material.userData.slateRoot?.(shader);
  };
  material.needsUpdate = true;
}
