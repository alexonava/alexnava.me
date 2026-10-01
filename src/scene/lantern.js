import { Box3, Group, Mesh, Vector3 } from "three";
import { editableGeometry } from "./architecture.js";

export const LANTERN_AUTHORING_HEIGHT = 2.48;

// The asset controller owns the GLB and its maps. This assembly owns only its
// geometry/material clones; its authored PBR and masked emission receive no
// tower/tree grade. Normalize in world space so imported node transforms and
// off-centre Meshy origins cannot move the existing ground anchor.
export function createLanternArchitecture({ asset, anisotropy = 4 }) {
  const root = new Group();
  root.name = "supplied-meshy-lantern";
  const geometries = new Set(), materials = new Set(), clonedMaterials = new Map();
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
      if (!source?.isMeshStandardMaterial) throw new Error("Lantern requires authored PBR materials");
      let material = clonedMaterials.get(source);
      if (!material) {
        material = source.clone();
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
      if (source.isSkinnedMesh || !source.geometry?.attributes.position || !source.geometry.attributes.uv)
        throw new Error("Lantern requires static UV-mapped meshes");
      const geometry = editableGeometry(source.geometry);
      geometries.add(geometry);
      geometry.applyMatrix4(source.matrixWorld);
      geometry.computeBoundingBox();
      bounds.union(geometry.boundingBox);
      const material = Array.isArray(source.material) ? source.material.map(cloneMaterial) : cloneMaterial(source.material);
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
    const luminousCenter = Array.isArray(authoredCenter) && authoredCenter.length === 3 && authoredCenter.every(Number.isFinite)
      ? new Vector3(...authoredCenter).sub(new Vector3(center.x, bounds.min.y, center.z)).multiplyScalar(scale)
      : new Vector3(0, 1.665, 0);
    root.userData.lantern = { authoringHeight: LANTERN_AUTHORING_HEIGHT, luminousCenter: luminousCenter.toArray() };
    return { root, luminousCenter, dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}

// The lantern may finish before or after the tree. Hold its borrowed asset
// until both exist, then swap before reveal or under the next tour dissolve.
// Paused/reduced-motion reviews have no cut, so their next still frame commits.
export function createLanternMount({ anisotropy = 4, camera, onChange = () => {}, onPrepared = () => {},
  loadFlame = () => import("./lantern-flame.js") } = {}) {
  let tree = null, replacement = null, attached = null, disposed = false;
  const release = (item) => { item?.flame?.dispose(); item?.dispose(); };
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
    get committed() { return attached !== null; },
    setTree(next) {
      if (disposed || next === tree) return false;
      restore();
      tree = next;
      return true;
    },
    stage(asset) {
      if (disposed) return () => {};
      const next = createLanternArchitecture({ asset, anisotropy });
      restore();
      release(replacement);
      replacement = next;
      // A ready callback must stay synchronous so its source-asset lease is
      // owned immediately. Defer only preparation; a failed optional chunk
      // leaves the supplied lantern's authored static glow usable.
      next.prepared = false;
      Promise.resolve().then(loadFlame).then(({ createLanternFlame }) => {
        if (!disposed && replacement === next) next.flame = createLanternFlame({ root: next.root, camera });
      }).catch(() => {}).then(() => {
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
      if (disposed || !replacement?.prepared || !tree || attached || (revealed && running && !cut)) return false;
      const lantern = tree.root.getObjectByName("tree-lantern"), light = tree.light;
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
