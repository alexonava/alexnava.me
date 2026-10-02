import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
  PointLight,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { smoothTreeNormals } from "./tree-normals.js";
import { ESTATE } from "./estate-layout.js";
import { SLATE_TEXT_GUARD } from "./mud-ground.js";

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
// label, the brightest pixel of its backdrop. The name and intro, large and
// bright, keep the bark's highlights behind them (6.4:1 or better as they
// are). After the lights (where the light shafts' gobo adds its own,
// light-shafts.js) the point lights' highlight is taken again as
// RE_Direct_Physical takes it, and only what the knee removes comes off; away
// from About nothing runs. The moon's broad sheen stays as it is.
export const BARK_TEXT_LIGHTS = `float babelBehind = slateBehind(slateAbout, vSlateClip.xy/vSlateClip.w*.5+.5);
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
  reflectedLight.directSpecular -= babelPoint*(1.0-1.0/(1.0+babelBehind*dot(babelPoint, vec3(.2126, .7152, .0722))/SLATE_TEXT_KNEE));
}
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
export const LANTERN_REACH = Object.freeze({ distance: 14, decay: 1 });
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

// textGuard: the ground's createSlateContacts() uniforms, for the bark's guard
// beside About (BARK_TEXT_LIGHTS); the tree takes it, the tower and the rocks never.
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
        ? `\nfloat babelWet = babelFilm*(1.0-smoothstep(${WET_BARK.band[0].toFixed(2)}, ${WET_BARK.band[1].toFixed(2)}, babelLocal.y));\nroughnessFactor = mix(roughnessFactor, ${WET_BARK.roughness.toFixed(2)}, babelWet);\nfloat babelMud = babelFilm*(1.0-smoothstep(${WET_BARK.mud[0].toFixed(2)}, ${WET_BARK.mud[1].toFixed(2)}, babelLocal.y));\nroughnessFactor = mix(roughnessFactor, ${WET_BARK.mudRoughness.toFixed(2)}, babelMud);`
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
      `babel-estate-material-v6-${role}-${roughnessFloor}-${roughnessCeiling}-${directRoughness}${guarded ? "-text" : ""}`;
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 babelLocal;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nbabelLocal = position;");
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
          varying vec3 babelLocal;`,
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
          `#include <map_fragment>
          float babelLuma = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
          diffuseColor.rgb = mix(vec3(babelLuma), diffuseColor.rgb, babelSaturation);
          diffuseColor.rgb *= 1.0 - babelHighlights * smoothstep(0.30, 0.85, babelLuma);
          diffuseColor.rgb = mix(diffuseColor.rgb, babelShadowTint, babelLift * (1.0 - smoothstep(0.02, 0.22, babelLuma)));
          diffuseColor.rgb *= babelTint;
          ${role === "rock" ? "diffuseColor.rgb *= mix(.62, 1., smoothstep(.1, .5, babelLocal.y));" : ""}
          ${role === "tree" ? `diffuseColor.rgb *= mix(vec3(1.0), vec3(${WET_BARK.mudTone.map((v) => v.toFixed(2)).join(", ")}), babelFilm*(1.0-smoothstep(${WET_BARK.mud[0].toFixed(2)}, ${WET_BARK.mud[1].toFixed(2)}, babelLocal.y)));` : ""}`,
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
            () => `#include <common>\nvarying vec4 vSlateClip;\n${SLATE_TEXT_GUARD}`,
          )
          .replace(
            "#include <lights_fragment_begin>",
            () => `#include <lights_fragment_begin>\n${BARK_TEXT_LIGHTS}`,
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
      lanternBaseIntensity = (film ? 4.8 : TREE_LANTERN_INTENSITY) * intensityScale;
      light.intensity = lanternBaseIntensity * lanternFlicker;
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
      setLanternFlicker(value = 1) {
        if (disposed) return;
        lanternFlicker = Math.max(0.88, Math.min(1.12, Number.isFinite(value) ? value : 1));
        light.intensity = lanternBaseIntensity * lanternFlicker;
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
