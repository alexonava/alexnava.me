import { Box3, Group, Mesh, Vector3 } from "three";
import { editableGeometry } from "./architecture.js";
import { CAGE_MOOD, CAGE_TEXT, flashHook } from "./film-light.js";
import { SLATE_TEXT_GUARD } from "./mud-ground.js";

export const LANTERN_AUTHORING_HEIGHT = 2.48;
// The lantern's iron and glass mirror the film's night sky (night-environment.js)
// at this share: cool glints on the cap and the glass, the metal still dark.
export const LANTERN_ENVIRONMENT = 0.7;

// Behind the name and intro, by the shot's share (babelCage, its mood's
// cageText), the lantern's direct light passes a luminance knee (film-light.js
// CAGE_TEXT), easing out over its reach: all the direct diffuse and highlight
// there keep 1/(1+L/knee) of themselves at their luminance L. On the iron that
// is the flame's light a hand's width away (lantern-flame.js adds its near
// field at the same chunk, before this) with the moon's faint share. The
// macros' tall frames stand the cage's lit posts behind the name and intro
// (Lantern study 4.66:1 and Root and lantern 4.07:1 at 1080x1920). At 0, every
// other shot, nothing runs.
export const LANTERN_TEXT_LIGHTS = `float babelCageBehind = babelCage*slateBehind(slateText, vSlateClip.xy/vSlateClip.w*.5+.5, ${CAGE_TEXT.reach.toFixed(2)});
if (babelCageBehind > 0.0) {
  float babelCageLuma = dot(reflectedLight.directDiffuse+reflectedLight.directSpecular, vec3(.2126, .7152, .0722));
  float babelCageOff = babelCageBehind*(2.0-babelCageBehind)*(1.0-1.0/(1.0+babelCageLuma/${CAGE_TEXT.knee.toFixed(3)}));
  reflectedLight.directDiffuse *= 1.0-babelCageOff;
  reflectedLight.directSpecular *= 1.0-babelCageOff;
}
`;

// The text guard on a lantern material: the ground's text boxes (textGuard,
// createSlateContacts()) and the shot's share, after the lights.
function cageTextHook(material, textGuard) {
  const before = material.onBeforeCompile,
    key = material.customProgramCacheKey;
  material.onBeforeCompile = function (shader, renderer) {
    before?.call(this, shader, renderer);
    Object.assign(shader.uniforms, {
      slateText: textGuard.slateText,
      slateAbout: textGuard.slateAbout,
      slateAspect: textGuard.slateAspect,
      babelCage: CAGE_MOOD,
    });
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec4 vSlateClip;")
      .replace("#include <project_vertex>", "#include <project_vertex>\nvSlateClip = gl_Position;");
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        () =>
          `#include <common>\nvarying vec4 vSlateClip;\nuniform float babelCage;\n${SLATE_TEXT_GUARD}`,
      )
      .replace(
        "#include <lights_fragment_end>",
        () => `#include <lights_fragment_end>\n${LANTERN_TEXT_LIGHTS}`,
      );
  };
  material.customProgramCacheKey = function () {
    return `${key?.call(this) ?? ""}|cage-text`;
  };
  return material;
}

// The asset controller owns the GLB and its maps. This assembly owns only its
// geometry/material clones; its authored PBR and masked emission receive no
// tower/tree grade. Normalize in world space so imported node transforms and
// off-centre Meshy origins cannot move the existing ground anchor. textGuard:
// the ground's createSlateContacts() uniforms, for the iron's text guard
// (LANTERN_TEXT_LIGHTS); without it the materials are as authored.
export function createLanternArchitecture({ asset, anisotropy = 4, textGuard = null }) {
  const root = new Group();
  root.name = "supplied-meshy-lantern";
  const geometries = new Set(),
    materials = new Set(),
    clonedMaterials = new Map();
  let disposed = false;
  function dispose() {
    if (disposed) return false;
    disposed = true;
    root.removeFromParent();
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
    return true;
  }
  try {
    if (!asset?.scene?.isObject3D) throw new Error("Invalid lantern scene");
    asset.scene.updateMatrixWorld(true);
    const bounds = new Box3();
    const cloneMaterial = (source) => {
      if (!source?.isMeshStandardMaterial)
        throw new Error("Lantern requires authored PBR materials");
      let material = clonedMaterials.get(source);
      if (!material) {
        // A lightning flash lights it too (film-light.js flashHook()).
        material = flashHook(source.clone());
        if (textGuard) cageTextHook(material, textGuard);
        material.envMapIntensity = LANTERN_ENVIRONMENT;
        clonedMaterials.set(source, material);
        materials.add(material);
        Object.values(material).forEach((value) => {
          if (value?.isTexture) value.anisotropy = anisotropy;
        });
      }
      return material;
    };
    asset.scene.traverse((source) => {
      if (!source.isMesh) return;
      if (
        source.isSkinnedMesh ||
        !source.geometry?.attributes.position ||
        !source.geometry.attributes.uv
      )
        throw new Error("Lantern requires static UV-mapped meshes");
      const geometry = editableGeometry(source.geometry);
      geometries.add(geometry);
      geometry.applyMatrix4(source.matrixWorld);
      geometry.computeBoundingBox();
      bounds.union(geometry.boundingBox);
      const material = Array.isArray(source.material)
        ? source.material.map(cloneMaterial)
        : cloneMaterial(source.material);
      const mesh = new Mesh(geometry, material);
      mesh.name = source.name || "lantern-mesh";
      mesh.castShadow = mesh.receiveShadow = true;
      root.add(mesh);
    });
    const height = bounds.max.y - bounds.min.y;
    if (!root.children.length || !Number.isFinite(height) || height <= 0)
      throw new Error("Lantern asset has empty bounds");
    const center = bounds.getCenter(new Vector3());
    const scale = LANTERN_AUTHORING_HEIGHT / height;
    geometries.forEach((geometry) => {
      geometry.translate(-center.x, -bounds.min.y, -center.z);
      geometry.scale(scale, scale, scale);
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
    });
    const authoredCenter = asset.scene.userData?.lantern?.luminousCenter;
    const luminousCenter =
      Array.isArray(authoredCenter) &&
      authoredCenter.length === 3 &&
      authoredCenter.every(Number.isFinite)
        ? new Vector3(...authoredCenter)
            .sub(new Vector3(center.x, bounds.min.y, center.z))
            .multiplyScalar(scale)
        : new Vector3(0, 1.665, 0);
    root.userData.lantern = {
      authoringHeight: LANTERN_AUTHORING_HEIGHT,
      luminousCenter: luminousCenter.toArray(),
    };
    return { root, luminousCenter, dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}

// The lantern may finish before or after the tree. Hold its borrowed asset
// until both exist, then swap before reveal or under the next tour dissolve.
// Paused/reduced-motion reviews have no cut, so their next still frame commits.
export function createLanternMount({
  anisotropy = 4,
  camera,
  textGuard = null,
  onChange = () => {},
  onPrepared = () => {},
  loadFlame = () => import("./lantern-flame.js"),
} = {}) {
  let tree = null,
    replacement = null,
    attached = null,
    disposed = false;
  const release = (item) => {
    item?.flame?.dispose();
    item?.dispose();
  };
  function restore() {
    if (!attached) return false;
    const { lantern, light, position, children } = attached;
    attached = null;
    replacement?.root.removeFromParent();
    children.forEach((child) => lantern.add(child));
    light.position.copy(position);
    tree?.setLanternFlicker();
    onChange({ committed: false, tree });
    return true;
  }
  return {
    get committed() {
      return attached !== null;
    },
    setTree(next) {
      if (disposed || next === tree) return false;
      restore();
      tree = next;
      return true;
    },
    stage(asset) {
      if (disposed) return () => {};
      const next = createLanternArchitecture({ asset, anisotropy, textGuard });
      restore();
      release(replacement);
      replacement = next;
      // A ready callback must stay synchronous so its source-asset lease is
      // owned immediately. Defer only preparation; a failed optional chunk
      // leaves the supplied lantern's authored static glow usable.
      next.prepared = false;
      Promise.resolve()
        .then(loadFlame)
        .then(({ createLanternFlame }) => {
          if (!disposed && replacement === next)
            next.flame = createLanternFlame({ root: next.root, camera });
        })
        .catch(() => {})
        .then(() => {
          if (disposed || replacement !== next) return;
          next.prepared = true;
          onPrepared();
        });
      return () => {
        if (replacement === next) {
          restore();
          replacement = null;
        }
        release(next);
      };
    },
    take({ revealed = false, running = false, cut = false } = {}) {
      if (disposed || !replacement?.prepared || !tree || attached || (revealed && running && !cut))
        return false;
      const lantern = tree.root.getObjectByName("tree-lantern"),
        light = tree.light;
      if (!lantern || light?.parent !== lantern) return false;
      // Detach the stand-in, rather than merely hide a parent: camera fitting
      // must see only the replacement's actual geometry.
      const children = lantern.children.filter((child) => child !== light);
      attached = { lantern, light, children, position: light.position.clone() };
      children.forEach((child) => child.removeFromParent());
      lantern.add(replacement.root);
      light.position.copy(replacement.luminousCenter);
      lantern.updateWorldMatrix(true, true);
      onChange({ committed: true, tree });
      return true;
    },
    update(frame) {
      if (!disposed && attached && replacement.flame)
        tree.setLanternFlicker?.(replacement.flame.update(frame));
    },
    dispose() {
      if (disposed) return false;
      restore();
      disposed = true;
      release(replacement);
      replacement = tree = null;
      return true;
    },
  };
}
