import {
  CustomBlending,
  OneFactor,
  SrcAlphaFactor,
  ZeroFactor,
  BoxGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  PointLight,
  ShaderMaterial,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { smoothTreeNormals } from "./tree-normals.js";
import { ESTATE } from "./estate-layout.js";
import { SLATE_TEXT_GUARD } from "./mud-ground.js";
import { GLINT, GLINT_MOOD, LANTERN_MOOD, PALE, PALE_MOOD, RIM_UNIFORMS } from "./film-light.js";

export const ARCHITECTURE = Object.freeze({
  treeHeight: 22,
});

const MATERIAL_PROFILES = Object.freeze({
  // The supplied timber lookout: a pale weathered-wood atlas with a baked
  // tangent-space normal map read through its stored tangents at full strength.
  tower: {
    color: 0xf2eee6,
    normalScale: 1,
    roughness: 0.9,
    roughnessFloor: 0.9,
    saturation: 0.94,
    highlights: 0.18,
  },
  tree: {
    color: 0xffffff,
    emissive: 0x26351f,
    emissiveIntensity: 0.22,
    normalScale: 0.46,
    roughness: 1,
    roughnessFloor: 0.84,
    roughnessCeiling: 0.97,
    highlights: 0.12,
  },
  // The film's scattered Meshy rocks (rock-scatter.js): baked colour with its
  // ambient occlusion and a tangent-space normal map made for scale 1, wet
  // from the rain (roughness 0.5: the moon and the lantern glint on their
  // edges). Their geometry is unit height, so materialFor darkens local y
  // 0.1-0.5 toward the base: rock-build.js sinks each stone 0.12-0.35 of its
  // height, so the band must reach above the slate for the stones to sit in it
  // rather than on it.
  rock: { color: 0xc8c4bc, normalScale: 1, roughness: 0.5 },
});

// The tree's bark is wet at its base after the rain (film only): below the
// local height `band` (tree units: the tree is authored 22 tall, then
// prop-scale.js scales it 1.26x and sinks it 0.45, so about the lowest 1.5
// world units above the soil) its roughness eases to `roughness`, so it
// mirrors the night sky (the film's environment) at grazing angles. Where the
// roots and the trunk enter the soil (`mud`: local heights, about the lowest
// 0.1-0.55 world units above it) the bark is muddy: darker (`mudTone`) and
// wetter still (`mudRoughness`). Without the environment a faint grazing
// sheen of the fog colour (`sheen`) stands in for the reflection.
export const WET_BARK = Object.freeze({
  band: Object.freeze([1.1, 1.9]),
  roughness: 0.55,
  sheen: 0.12,
  mud: Object.freeze([0.45, 0.85]),
  mudTone: Object.freeze([0.55, 0.52, 0.5]),
  mudRoughness: 0.35,
});
// Damp moss on the roots where they meet the soil (film only): on the faces
// that turn to the sky (`up`: object normal y), between local heights `band`
// (tree units: rising from just above the mud line, fading out between about
// 1.6 and 2.7 world units above the tree's lowest point), in patches of a
// two-scale value noise (`patch`, `scale` per tree unit). It is a dark
// grey-green (`tone`, never saturated, under the role's tint like the bark),
// mottled by the fine noise, and matte (`roughness`).
export const ROOT_MOSS = Object.freeze({
  band: Object.freeze([0.5, 0.8, 1.6, 2.5]),
  up: Object.freeze([0.12, 0.55]),
  patch: Object.freeze([0.38, 0.66]),
  scale: Object.freeze([2.2, 11]),
  tone: Object.freeze([0.062, 0.078, 0.042]),
  cover: 0.9,
  roughness: 0.92,
});
const ROOT_MOSS_GLSL = `float babelHash(vec3 p){p=fract(p*.3183099+.1);p*=17.;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
float babelNoise(vec3 x){vec3 i=floor(x),f=fract(x);f=f*f*(3.-2.*f);return mix(mix(mix(babelHash(i),babelHash(i+vec3(1,0,0)),f.x),mix(babelHash(i+vec3(0,1,0)),babelHash(i+vec3(1,1,0)),f.x),f.y),mix(mix(babelHash(i+vec3(0,0,1)),babelHash(i+vec3(1,0,1)),f.x),mix(babelHash(i+vec3(0,1,1)),babelHash(i+vec3(1,1,1)),f.x),f.y),f.z);}`;
const f2 = (v) => v.toFixed(3);
const ROOT_MOSS_MAP = `float babelMossFine = babelNoise(babelLocal*${f2(ROOT_MOSS.scale[1])});
float babelMoss = babelFilm*smoothstep(${f2(ROOT_MOSS.band[0])}, ${f2(ROOT_MOSS.band[1])}, babelLocal.y)*(1.0-smoothstep(${f2(ROOT_MOSS.band[2])}, ${f2(ROOT_MOSS.band[3])}, babelLocal.y))*smoothstep(${f2(ROOT_MOSS.up[0])}, ${f2(ROOT_MOSS.up[1])}, normalize(babelLocalN).y)*smoothstep(${f2(ROOT_MOSS.patch[0])}, ${f2(ROOT_MOSS.patch[1])}, .7*babelNoise(babelLocal*${f2(ROOT_MOSS.scale[0])})+.3*babelMossFine);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(${ROOT_MOSS.tone.map(f2).join(", ")})*babelTint*(.65+.7*babelMossFine), babelMoss*${f2(ROOT_MOSS.cover)});`;

// How each film material takes the night sky (night-environment.js) once the
// film sets it as the scene's environment: [the share of the flat ambient and
// hemisphere it keeps, the sky's diffuse light (times the sky as shown), its
// reflection]. The tower keeps its look unchanged; the bark and the rocks are
// lit from above by the sky and darker beneath, and the wet stones and bark
// mirror it.
export const ENVIRONMENT_ROLES = Object.freeze({
  tower: Object.freeze([1, 0, 0]),
  tree: Object.freeze([0.7, 1.8, 1.3]),
  rock: Object.freeze([0.6, 2, 1.8]),
});

// Beside About the bark's highlights from the point lights (the lantern and
// the crown's fill) pass the ground's luminance knee (mud-ground.js
// SLATE_TEXT_GUARD: About's box, the same reach and knee): in tree-4 a root's
// wet, muddy base caught the lantern in a warm glint beside the small, dim
// label, the brightest pixel of its backdrop. Behind the name and intro, large
// and bright, the bark keeps its highlights unless a shot asks
// (BARK_TEXT_GLINT). After the lights (where the light shafts' gobo adds its
// own, light-shafts.js) the point lights' highlight is taken again as
// RE_Direct_Physical takes it, and only what the knee removes comes off; away
// from About nothing runs. Beside About the moon's broad sheen stays as it is.
export const BARK_TEXT_LIGHTS = `float babelBehind = slateBehindAbout(vSlateClip.xy/vSlateClip.w*.5+.5);
if (babelBehind > 0.0) {
  vec3 babelPoint = vec3(0.0);
  #if NUM_POINT_LIGHTS > 0
  IncidentLight babelLight;
  #pragma unroll_loop_start
  for ( int i = 0; i < NUM_POINT_LIGHTS; i ++ ) {
    getPointLightInfo(pointLights[ i ], geometryPosition, babelLight);
    babelPoint += saturate(dot(geometryNormal, babelLight.direction))*babelLight.color*BRDF_GGX(babelLight.direction, geometryViewDir, geometryNormal, material);
  }
  #pragma unroll_loop_end
  #endif
  reflectedLight.directSpecular -= babelPoint-slateTextKnee(babelPoint, babelBehind);
}
`;

// Behind the name and intro, by the shot's share (babelGlint, its mood's
// glintText), all the bark's direct highlights pass the same knee, easing out
// over film-light.js GLINT.reach. The lantern shots' wet roots catch the
// brightest glints behind their text: Lantern study's lantern on a root beside
// the name (4.67:1 at 1920x1080, the end of the push-in) and Root and lantern's
// moon on a root under the intro's end (4.32:1 at 1440x900, the start of the
// pull-back). At 0, every other shot, nothing runs.
export const BARK_TEXT_GLINT = `float babelGlintBehind = babelGlint*slateBehind(slateText, vSlateClip.xy/vSlateClip.w*.5+.5, ${GLINT.reach.toFixed(2)});
if (babelGlintBehind > 0.0) reflectedLight.directSpecular = slateTextKnee(reflectedLight.directSpecular, babelGlintBehind);
`;

// Moonlight grade for the supplied maps, which carry baked daylight and
// ambient occlusion: cooler, less saturated, compressed sunlit highlights and
// lifted black undersides. Uniform values switch without a shader rebuild.
const FILM_GRADES = Object.freeze({
  // The supplied maps contain their own warm daylight. Keep their authored
  // detail, but compress it beneath a cool moon key instead of just tinting
  // the entire asset blue. This leaves the lantern as the sole warm accent.
  // The timber atlas is mid-dark with few bright texels, so it needs less
  // highlight compression than the stone did, and a lighter shadow lift keeps
  // the wood reading grey-brown rather than veiled blue-grey.
  tower: {
    saturation: 0.75,
    highlights: 0.3,
    tint: [0.93, 0.97, 1.0],
    shadowTint: [0.12, 0.15, 0.2],
    lift: 0.14,
  },
  tree: {
    saturation: 0.8,
    highlights: 0.3,
    tint: [0.9, 0.95, 1.0],
    shadowTint: [0.1, 0.14, 0.18],
    lift: 0.1,
  },
  // The pale Meshy stones, wet from the rain, read clearly against the slate
  // without glowing through the fog.
  rock: {
    saturation: 0.6,
    highlights: 0.35,
    tint: [0.9, 0.95, 1.0],
    shadowTint: [0.08, 0.1, 0.13],
    lift: 0.1,
  },
});
export function applyFilmGrade(material, active) {
  const grade = material?.userData?.babelGrade;
  if (!grade) return false;
  const film = active ? FILM_GRADES[grade.role] : null;
  const profile = MATERIAL_PROFILES[grade.role] || {};
  grade.uniforms.babelSaturation.value = film?.saturation ?? profile.saturation ?? 1;
  grade.uniforms.babelHighlights.value = film?.highlights ?? profile.highlights ?? 0;
  grade.uniforms.babelTint.value.setRGB(...(film?.tint ?? [1, 1, 1]));
  grade.uniforms.babelShadowTint.value.setRGB(...(film?.shadowTint ?? [0.19, 0.17, 0.15]));
  grade.uniforms.babelLift.value = film?.lift ?? 0;
  grade.uniforms.babelFilm.value = active ? 1 : 0;
  grade.uniforms.babelEnvironment.value.set(
    ...((active && ENVIRONMENT_ROLES[grade.role]) || [1, 0, 0]),
  );
  return true;
}

// The supplied tower is fitted to this height and radius cap.
const COMPLETE_TOWER_HEIGHT = 39;
const COMPLETE_TOWER_RADIUS_CAP = 20.4;

const TREE_LANTERN_INTENSITY = 4.0;
// The film lantern's reach: a candle's warm pool about its foot on the wet
// soil, the near roots and stones, out to about six units.
export const LANTERN_REACH = Object.freeze({ distance: 10, decay: 1.7 });
// The film lantern's strength: a hot core at its foot falling off fast.
export const LANTERN_FILM_INTENSITY = 8.2;
// The flame's anamorphic streak: world length and height, peak opacity.
export const FLAME_STREAK = Object.freeze({ length: 4.2, height: 0.3, strength: 0.75, near: 0.9 });

const TREE_FILL_INTENSITY = 2.4;

export function sourceMesh(asset) {
  const meshes = [];
  asset?.scene?.updateMatrixWorld(true);
  asset?.scene?.traverse((object) => {
    if (object.isMesh) meshes.push(object);
  });
  if (
    meshes.length !== 1 ||
    !meshes[0].geometry?.attributes.uv ||
    !meshes[0].material?.isMaterial ||
    Array.isArray(meshes[0].material)
  ) {
    throw new Error("Architecture asset must contain one UV-mapped mesh.");
  }
  return meshes[0];
}

export function editableGeometry(source) {
  const geometry = source.clone();
  // Quantized GLB attributes are compact transport data. Decode before applying
  // transforms: normalized Int16 setters cannot store world-space coordinates.
  for (const name of ["position", "normal"]) {
    const attribute = geometry.getAttribute(name);
    if (!attribute) continue;
    const values = new Float32Array(attribute.count * 3);
    for (let index = 0; index < attribute.count; index += 1) {
      values[index * 3] = attribute.getX(index);
      values[index * 3 + 1] = attribute.getY(index);
      values[index * 3 + 2] = attribute.getZ(index);
    }
    geometry.setAttribute(name, new Float32BufferAttribute(values, 3));
  }
  return geometry;
}

// textGuard: the ground's createSlateContacts() uniforms, for the bark's guards
// beside About (BARK_TEXT_LIGHTS) and, by the shot's share, behind the name and
// intro (BARK_TEXT_GLINT); the tree takes it, the tower and the rocks never.
// The pale wood's cool grey under a shot's `pale` (film-light.js PALE), first,
// on the map's own colour.
const PALE_GLSL = `
          float babelPaleLuma = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(babelPaleLuma)*vec3(${PALE.tint.map((v) => v.toFixed(3)).join(", ")}), babelPale*smoothstep(${PALE.luma.map((v) => v.toFixed(3)).join(", ")}, babelPaleLuma));`;
export function materialFor(asset, anisotropy, role, textGuard = null) {
  const material = sourceMesh(asset).material.clone();
  const profile = MATERIAL_PROFILES[role] || {};
  try {
    material.color?.setHex(profile.color ?? 0xffffff);
    material.metalness = 0;
    material.roughness = profile.roughness ?? 0.94;
    material.emissive.setHex(profile.emissive ?? 0);
    material.emissiveIntensity = profile.emissiveIntensity ?? 1;
    material.emissiveMap = null;
    material.vertexColors = false;
    // Retain the tree map's variation within a matte range. The complete tower
    // and the rocks have no roughness map: keep their scalar direct rather than
    // lifting .9 to .99. Other architecture roles retain their existing per-role
    // matte treatment. Compress bright baked edge detail in linear color
    // without repainting maps.
    const roughnessFloor = profile.roughnessFloor ?? 0.86;
    const roughnessCeiling = profile.roughnessCeiling ?? 1;
    const directRoughness = (role === "tower" || role === "rock") && !material.roughnessMap;
    const roughnessFragment =
      "#include <roughnessmap_fragment>" +
      (directRoughness
        ? ""
        : `\nroughnessFactor = mix(${roughnessFloor.toFixed(3)}, ${roughnessCeiling.toFixed(3)}, roughnessFactor);`) +
      (role === "tree"
        ? `\nfloat babelWet = babelFilm*(1.0-smoothstep(${WET_BARK.band[0].toFixed(2)}, ${WET_BARK.band[1].toFixed(2)}, babelLocal.y));\nroughnessFactor = mix(roughnessFactor, ${WET_BARK.roughness.toFixed(2)}, babelWet);\nfloat babelMud = babelFilm*(1.0-smoothstep(${WET_BARK.mud[0].toFixed(2)}, ${WET_BARK.mud[1].toFixed(2)}, babelLocal.y));\nroughnessFactor = mix(roughnessFactor, ${WET_BARK.mudRoughness.toFixed(2)}, babelMud);
roughnessFactor = mix(roughnessFactor, ${ROOT_MOSS.roughness.toFixed(2)}, babelMoss);`
        : "");
    const guarded = role === "tree" && Boolean(textGuard);
    const uniforms = {
      babelSaturation: { value: profile.saturation ?? 1 },
      babelHighlights: { value: profile.highlights ?? 0 },
      babelTint: { value: new Color(1, 1, 1) },
      babelShadowTint: { value: new Color(0.19, 0.17, 0.15) },
      babelLift: { value: 0 },
      babelFilm: { value: 0 },
      babelEnvironment: { value: new Vector3(1, 0, 0) },
    };
    material.userData.babelGrade = { role, uniforms };
    material.customProgramCacheKey = () =>
      `babel-estate-material-v9-${role}-${roughnessFloor}-${roughnessCeiling}-${directRoughness}${guarded ? "-text" : ""}`;
    const rimmed = role === "tower" || role === "tree";
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      if (rimmed) Object.assign(shader.uniforms, RIM_UNIFORMS);
      if (role === "tree") shader.uniforms.babelPale = PALE_MOOD;
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          "#include <common>\nvarying vec3 babelLocal;\nvarying vec3 babelLocalN;",
        )
        .replace(
          "#include <begin_vertex>",
          "#include <begin_vertex>\nbabelLocal = position;\nbabelLocalN = objectNormal;",
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>
          uniform float babelSaturation;
          uniform float babelHighlights;
          uniform vec3 babelTint;
          uniform vec3 babelShadowTint;
          uniform float babelLift;
          uniform float babelFilm;
          uniform vec3 babelEnvironment;
          ${rimmed ? "uniform vec4 babelRimLight;\n          uniform vec3 babelKeyView;" : ""}
          varying vec3 babelLocal;
          varying vec3 babelLocalN;
          ${
            role === "tree"
              ? `uniform float babelPale;
${ROOT_MOSS_GLSL}`
              : ""
          }`,
        )
        // The role's share of the flat ambient and of the sky's light; without an
        // environment (the film off, or a failed capture) the ambient stays whole.
        .replace(
          "#include <lights_fragment_maps>",
          `#include <lights_fragment_maps>
          #ifdef USE_ENVMAP
          irradiance *= babelEnvironment.x;
          iblIrradiance *= babelEnvironment.y;
          radiance *= babelEnvironment.z;
          #endif`,
        )
        .replace("#include <roughnessmap_fragment>", roughnessFragment)
        .replace(
          "#include <map_fragment>",
          `#include <map_fragment>${role === "tree" ? PALE_GLSL : ""}
          float babelLuma = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
          diffuseColor.rgb = mix(vec3(babelLuma), diffuseColor.rgb, babelSaturation);
          diffuseColor.rgb *= 1.0 - babelHighlights * smoothstep(0.30, 0.85, babelLuma);
          diffuseColor.rgb = mix(diffuseColor.rgb, babelShadowTint, babelLift * (1.0 - smoothstep(0.02, 0.22, babelLuma)));
          diffuseColor.rgb *= babelTint;
          ${role === "rock" ? "diffuseColor.rgb *= mix(.62, 1., smoothstep(.1, .5, babelLocal.y));" : ""}
          ${
            role === "tree"
              ? `diffuseColor.rgb *= mix(vec3(1.0), vec3(${WET_BARK.mudTone.map((v) => v.toFixed(2)).join(", ")}), babelFilm*(1.0-smoothstep(${WET_BARK.mud[0].toFixed(2)}, ${WET_BARK.mud[1].toFixed(2)}, babelLocal.y)));
${ROOT_MOSS_MAP}`
              : ""
          }`,
        );
      // The moon rim (film-light.js): a cool edge where the surface turns from
      // the lens, strongest with the moon behind the subject.
      if (rimmed)
        shader.fragmentShader = shader.fragmentShader.replace(
          "#include <lights_fragment_end>",
          `#include <lights_fragment_end>
          float babelRim = pow(1.0-saturate(dot(geometryNormal, geometryViewDir)), 4.0);
          reflectedLight.directDiffuse += babelRimLight.rgb*babelFilm*babelRim*mix(babelRimLight.w, 1.0, saturate(dot(-geometryViewDir, babelKeyView)));`,
        );
      // Without the environment, the wet bark's faint grazing sheen.
      if (role === "tree")
        shader.fragmentShader = shader.fragmentShader.replace(
          "#include <lights_fragment_end>",
          `#include <lights_fragment_end>
          #if defined( USE_FOG ) && !defined( USE_ENVMAP )
          reflectedLight.indirectSpecular += fogColor*(babelWet*${WET_BARK.sheen.toFixed(2)}*pow(1.0-saturate(dot(geometryNormal, geometryViewDir)), 3.0));
          #endif`,
        );
      if (guarded) {
        Object.assign(shader.uniforms, {
          slateText: textGuard.slateText,
          slateAbout: textGuard.slateAbout,
          slateAspect: textGuard.slateAspect,
          babelGlint: GLINT_MOOD,
        });
        shader.vertexShader = shader.vertexShader
          .replace("#include <common>", "#include <common>\nvarying vec4 vSlateClip;")
          .replace(
            "#include <project_vertex>",
            "#include <project_vertex>\nvSlateClip = gl_Position;",
          );
        shader.fragmentShader = shader.fragmentShader
          .replace(
            "#include <common>",
            () =>
              `#include <common>\nvarying vec4 vSlateClip;\nuniform float babelGlint;\n${SLATE_TEXT_GUARD}`,
          )
          .replace(
            "#include <lights_fragment_begin>",
            () => `#include <lights_fragment_begin>\n${BARK_TEXT_LIGHTS}`,
          )
          .replace(
            "#include <lights_fragment_end>",
            () => `#include <lights_fragment_end>\n${BARK_TEXT_GLINT}`,
          );
      }
    };
    if (material.normalScale && profile.normalScale) {
      material.normalScale.set(profile.normalScale, profile.normalScale);
    }
    for (const value of Object.values(material)) {
      if (value?.isTexture) value.anisotropy = anisotropy;
    }
    return material;
  } catch (error) {
    material.dispose();
    throw error;
  }
}

// The supplied timber lookout is fitted uniformly; its lattice legs, ladder,
// gallery, cabin and roof keep their authored proportions instead of becoming
// curved modules. Its ladder and gallery opening face +Z, the access side.
export function createCompleteTowerArchitecture({
  asset,
  groundY = 0,
  yaw = Math.PI / 4,
  footingOffset = 1.64,
  anisotropy = 4,
}) {
  const root = new Group();
  root.name = "supplied-meshy-tower";
  let geometry;
  let material;
  let disposed = false;
  const dispose = () => {
    if (disposed) return false;
    disposed = true;
    root.removeFromParent();
    geometry?.dispose();
    material?.dispose();
    return true;
  };
  try {
    if (![groundY, yaw, footingOffset].every(Number.isFinite))
      throw new Error("Invalid complete tower placement.");
    const source = sourceMesh(asset);
    geometry = editableGeometry(source.geometry).applyMatrix4(source.matrixWorld);
    geometry.computeBoundingBox();
    const { min, max } = geometry.boundingBox;
    const dimensions = new Vector3().subVectors(max, min);
    if (
      ![dimensions.x, dimensions.y, dimensions.z].every(
        (value) => Number.isFinite(value) && value > 0,
      )
    ) {
      throw new Error("Complete tower asset has empty bounds.");
    }
    geometry.translate(-(min.x + max.x) / 2, -min.y, -(min.z + max.z) / 2);
    const position = geometry.attributes.position;
    let radius = 0;
    for (let i = 0; i < position.count; i += 1) {
      const x = position.getX(i),
        y = position.getY(i),
        z = position.getZ(i);
      if (![x, y, z].every(Number.isFinite))
        throw new Error("Complete tower positions must be finite.");
      radius = Math.max(radius, Math.hypot(x, z));
    }
    const scale = Math.min(
      COMPLETE_TOWER_HEIGHT / dimensions.y,
      COMPLETE_TOWER_RADIUS_CAP / radius,
    );
    geometry.scale(scale, scale, scale);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    material = materialFor(asset, anisotropy, "tower");
    const tower = new Mesh(geometry, material);
    tower.name = "complete-meshy-tower";
    tower.castShadow = tower.receiveShadow = true;
    root.add(tower);
    // The four posts end at y 0 and the ladder foot about 0.21 above them. The
    // earth footing (-0.22) sets the posts into the terrace and rests the ladder
    // foot on it; on the retained plinth (top near 1.7) the posts overlap it slightly.
    root.position.y = groundY + footingOffset;
    root.rotation.y = yaw;
    root.userData.architecture = {
      mode: "complete",
      sourceRoles: ["tower"],
      uniformScale: scale,
      height: dimensions.y * scale,
      radius: radius * scale,
      entranceAxis: "+Z",
    };
    return {
      root,
      dispose,
      setFilmTreatment(active) {
        if (!disposed) applyFilmGrade(material, active);
      },
    };
  } catch (error) {
    dispose();
    throw error;
  }
}

// textGuard: the ground's createSlateContacts() uniforms (materialFor()).
export function createTreeArchitecture({
  asset,
  groundHeight,
  anisotropy = 4,
  anchor = [58, 38],
  textGuard = null,
}) {
  const root = new Group();
  root.name = "supplied-meshy-tree";
  const [treeX, treeZ] = anchor;
  root.position.set(treeX, groundHeight(treeX, treeZ), treeZ);
  const geometries = new Set();
  const materials = new Set();
  const ownGeometry = (geometry) => {
    geometries.add(geometry);
    return geometry;
  };
  const ownMaterial = (material) => {
    materials.add(material);
    return material;
  };
  let disposed = false;
  const dispose = () => {
    if (disposed) return false;
    disposed = true;
    root.removeFromParent();
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
    geometries.clear();
    materials.clear();
    return true;
  };
  try {
    const source = sourceMesh(asset);
    const geometry = ownGeometry(editableGeometry(source.geometry));
    geometry.applyMatrix4(source.matrixWorld);
    geometry.computeBoundingBox();
    const bounds = geometry.boundingBox;
    const height = bounds.max.y - bounds.min.y;
    if (!Number.isFinite(height) || height <= 0) throw new Error("Tree asset has empty bounds.");
    const scale = ARCHITECTURE.treeHeight / height;
    geometry.translate(0, -bounds.min.y, 0);
    geometry.scale(scale, scale, scale);
    geometry.computeBoundingSphere();
    const material = ownMaterial(materialFor(asset, anisotropy, "tree", textGuard));
    const tree = new Mesh(geometry, material);
    tree.name = "meshy-tree";
    tree.castShadow = tree.receiveShadow = true;
    root.add(tree);
    const normalAttribute = geometry.attributes.normal;
    const originalNormals = normalAttribute.array.slice(),
      softenedNormals = smoothTreeNormals(geometry).array;
    const lantern = new Group();
    lantern.name = "tree-lantern";
    const direction = new Vector3(ESTATE.tower.x - treeX, 0, ESTATE.tower.z - treeZ).normalize();
    lantern.position.copy(direction.multiplyScalar(ESTATE.lantern.offset));
    lantern.position.y =
      groundHeight(treeX + lantern.position.x, treeZ + lantern.position.z) - root.position.y;
    // Iron post lantern, authored 2.48 units tall: foot, post, tray, four
    // stiles, top plate, pyramid cap and finial ring merge into one frame. The
    // candle flame is the emitter, seen through four tinted glass panes.
    const frameMaterial = ownMaterial(
      new MeshStandardMaterial({ color: 0x45413d, roughness: 0.84, metalness: 0.38 }),
    );
    const frameParts = [];
    let frameGeometry;
    try {
      const part = (shape, x, y, z, yaw = 0) => {
        shape.rotateY(yaw);
        shape.translate(x, y, z);
        frameParts.push(shape);
      };
      part(new CylinderGeometry(0.17, 0.21, 0.08, 10), 0, 0.04, 0);
      part(new CylinderGeometry(0.05, 0.07, 1.2, 8), 0, 0.64, 0);
      part(new BoxGeometry(0.74, 0.07, 0.74), 0, 1.265, 0);
      for (const x of [-0.31, 0.31])
        for (const z of [-0.31, 0.31]) part(new BoxGeometry(0.055, 0.7, 0.055), x, 1.65, z);
      part(new BoxGeometry(0.78, 0.05, 0.78), 0, 2.025, 0);
      part(new CylinderGeometry(0.03, 0.5, 0.27, 4), 0, 2.185, 0, Math.PI / 4);
      part(new TorusGeometry(0.06, 0.016, 6, 12), 0, 2.4, 0);
      frameGeometry = mergeGeometries(frameParts, false);
      if (!frameGeometry) throw new Error("Lantern frame cannot be merged.");
      ownGeometry(frameGeometry);
    } finally {
      frameParts.forEach((item) => item.dispose());
    }
    const frame = new Mesh(frameGeometry, frameMaterial);
    frame.name = "lantern-frame";
    lantern.add(frame);
    const glassMaterial = ownMaterial(
      new MeshStandardMaterial({
        color: 0xb7c9d0,
        emissive: 0xffb562,
        emissiveIntensity: 0.3,
        roughness: 0.72,
        metalness: 0,
        transparent: true,
        opacity: 0.065,
        depthWrite: false,
        side: DoubleSide,
      }),
    );
    const paneGeometry = ownGeometry(new BoxGeometry(0.6, 0.66, 0.02));
    for (const [x, z, yaw] of [
      [0, 0.31, 0],
      [0, -0.31, 0],
      [0.31, 0, Math.PI / 2],
      [-0.31, 0, Math.PI / 2],
    ]) {
      const pane = new Mesh(paneGeometry, glassMaterial);
      pane.name = "lantern-glass";
      pane.position.set(x, 1.65, z);
      pane.rotation.y = yaw;
      lantern.add(pane);
    }
    const candle = new Mesh(
      ownGeometry(new CylinderGeometry(0.06, 0.065, 0.3, 8)),
      ownMaterial(new MeshStandardMaterial({ color: 0xe9dcbc, roughness: 0.85 })),
    );
    candle.name = "lantern-candle";
    candle.position.y = 1.45;
    lantern.add(candle);
    const glowGeometry = ownGeometry(new SphereGeometry(0.04, 12, 12));
    const glowMaterial = ownMaterial(
      new MeshStandardMaterial({
        color: 0xffcf82,
        emissive: 0xffa640,
        emissiveIntensity: 2.0,
        roughness: 1,
      }),
    );
    const glow = new Mesh(glowGeometry, glowMaterial);
    glow.name = "lantern-flame";
    glow.scale.set(0.82, 2.0, 0.82);
    glow.position.y = 1.665;
    lantern.add(glow);
    const light = new PointLight(0xffbe72, TREE_LANTERN_INTENSITY, 23, 1.45);
    light.name = "tree-lantern-light";
    light.position.y = 1.665;
    light.castShadow = false;
    lantern.add(light);
    // The lens's anamorphic streak across the flame (film only), riding on the
    // practical, so it follows the supplied lantern's flame and its flicker. A
    // billboard drawn `near` units toward the lens, clear of the lantern's own
    // glass and cage, yet still behind any root in front.
    const streakUniforms = { uStrength: { value: 0 } };
    const streak = new Mesh(
      ownGeometry(new PlaneGeometry(1, 1)),
      ownMaterial(
        new ShaderMaterial({
          name: "LanternStreak",
          uniforms: streakUniforms,
          vertexShader: `varying vec2 vUv;
void main(){
vUv=uv*2.-1.;
vec4 mv=modelViewMatrix*vec4(0.,0.,0.,1.);
mv.xy+=position.xy*vec2(${FLAME_STREAK.length.toFixed(2)},${FLAME_STREAK.height.toFixed(2)});
mv.xyz+=normalize(-mv.xyz)*${FLAME_STREAK.near.toFixed(2)};
gl_Position=projectionMatrix*mv;
}`,
          fragmentShader: `uniform float uStrength;
varying vec2 vUv;
void main(){
float x=abs(vUv.x), y=abs(vUv.y);
float line=exp(-y*y*30.)*(.7*exp(-x*3.6)+.5*exp(-x*x*45.))*(1.-smoothstep(.8,1.,x));
gl_FragColor=vec4(vec3(1.,.66,.34)*line*uStrength,1.);
}`,
          // Added light that keeps the film's depth layer in alpha.
          blending: CustomBlending,
          blendSrc: SrcAlphaFactor,
          blendDst: OneFactor,
          blendSrcAlpha: ZeroFactor,
          blendDstAlpha: OneFactor,
          depthWrite: false,
          transparent: true,
          fog: false,
        }),
      ),
    );
    streak.name = "lantern-streak";
    streak.frustumCulled = false;
    streak.renderOrder = 5;
    streak.userData.excludeFromShot = true;
    light.add(streak);
    root.add(lantern);
    const fillLight = new PointLight(0xffd49a, TREE_FILL_INTENSITY, 30, 1.25);
    fillLight.name = "tree-fill-light";
    fillLight.position.set(-3.8, ARCHITECTURE.treeHeight * 0.42, -2.5);
    fillLight.castShadow = false;
    root.add(fillLight);
    let film = false,
      currentProfile = {},
      savedDistance = light.distance,
      savedDecay = light.decay,
      savedFillDistance = fillLight.distance;
    let lanternBaseIntensity = TREE_LANTERN_INTENSITY,
      lanternFlicker = 1;
    const originalFillColor = fillLight.color.clone(),
      originalEmission = material.emissiveIntensity;
    function applyTreeLighting() {
      const intensityScale = currentProfile.lighting?.practicalIntensityScale ?? 1;
      lanternBaseIntensity =
        (film ? LANTERN_FILM_INTENSITY : TREE_LANTERN_INTENSITY) * intensityScale;
      light.intensity = lanternBaseIntensity * lanternFlicker * (film ? LANTERN_MOOD.value : 1);
      streakUniforms.uStrength.value = film
        ? FLAME_STREAK.strength * lanternFlicker * LANTERN_MOOD.value
        : 0;
      fillLight.intensity = TREE_FILL_INTENSITY * (film ? 0.95 : 1) * intensityScale;
      fillLight.color.copy(originalFillColor);
      if (film) fillLight.color.setHex(0xc2d2ec);
      glowMaterial.emissiveIntensity = film ? 1.35 : 2;
      glassMaterial.emissiveIntensity = film ? 0.018 : 0.3;
      material.emissiveIntensity = film ? 0.04 : originalEmission;
      applyFilmGrade(material, film);
      normalAttribute.array.set(film ? softenedNormals : originalNormals);
      normalAttribute.needsUpdate = true;
      // The unshadowed fill sits in the crown about 10 units above the lantern.
      // In film its reach drops from the prop-scaled 37.8 to 24, so it models
      // the bark and the lantern cap without flooding the clearing.
      if (film) {
        light.distance = LANTERN_REACH.distance;
        light.decay = LANTERN_REACH.decay;
        fillLight.distance = 24;
      }
    }
    return {
      root,
      light,
      fillLight,
      // Per-frame flicker changes only the existing practical. Reapplying the
      // whole tree treatment here would upload its normals every frame.
      // Reapplies the lantern's mood (film-light.js LANTERN_MOOD) at the
      // current flicker, for a lantern with no flame module driving it.
      refreshLantern() {
        if (disposed) return;
        light.intensity = lanternBaseIntensity * lanternFlicker * (film ? LANTERN_MOOD.value : 1);
        streakUniforms.uStrength.value = film
          ? FLAME_STREAK.strength * lanternFlicker * LANTERN_MOOD.value
          : 0;
      },
      setLanternFlicker(value = 1) {
        if (disposed) return;
        lanternFlicker = Math.max(0.88, Math.min(1.12, Number.isFinite(value) ? value : 1));
        light.intensity = lanternBaseIntensity * lanternFlicker * (film ? LANTERN_MOOD.value : 1);
        streakUniforms.uStrength.value = film
          ? FLAME_STREAK.strength * lanternFlicker * LANTERN_MOOD.value
          : 0;
      },
      setFilmTreatment(active) {
        const next = Boolean(active);
        if (disposed || next === film) return;
        if (next) {
          savedDistance = light.distance;
          savedDecay = light.decay;
          savedFillDistance = fillLight.distance;
        }
        film = next;
        if (!film) {
          light.distance = savedDistance;
          light.decay = savedDecay;
          fillLight.distance = savedFillDistance;
        }
        applyTreeLighting();
      },
      applyQuality(profile = {}) {
        currentProfile = profile;
        applyTreeLighting();
      },
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
