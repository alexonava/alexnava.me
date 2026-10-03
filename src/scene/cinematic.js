import { resolveSceneView } from "./scene-modes.js";
import { Vector3 } from "three";
import {
  DIRECTED_SHOTS,
  measureShot,
  fitShot,
  isStackedLayout,
  resolveDirectedShot,
} from "./directed-shots.js";

// The bootstrap reads the page's layout from here too.
export { isStackedLayout };

export function chooseCinematicView(search = "") {
  return resolveSceneView(search);
}
export function chooseCinematicAngle(search = "", view = null) {
  const q = new URLSearchParams(search),
    explicit = Number(q.get("angle")),
    count = DIRECTED_SHOTS[view]?.length ?? 3;
  if (Number.isInteger(explicit) && explicit >= 1 && explicit <= count) return explicit - 1;
  // Every fresh visit opens The watch; subject and valid angle URLs remain reproducible.
  return 0;
}
// Stacked layouts frame the subject below the name. The others frame it beside
// the name, right of the hero, from 32px under the top edge down to the bottom
// bar, except portrait monitors: their name sits bottom-left, so the subject
// takes the full width above it.
export function cinematicSafeArea(width, height, hero, nav) {
  const stacked = isStackedLayout(width, height),
    above = !stacked && height > width;
  const top = stacked ? Math.max(24, (hero?.bottom || 180) + 24) : 32;
  const floor = Math.min(height - 32, (nav?.top || height - 120) - 28);
  const bottom = Math.max(top + 120, above ? Math.min(floor, (hero?.top || height) - 24) : floor);
  const left =
    stacked || above
      ? 20
      : Math.min(width * 0.48, Math.max(width * 0.34, (hero?.right || 300) + 36));
  return {
    left,
    top,
    width: Math.max(140, width - left - 24),
    height: Math.max(120, bottom - top),
  };
}
// Page-coordinate layout box from the offsetParent chain. Unlike
// getBoundingClientRect it ignores scroll and CSS transforms (the hero's reveal
// and scroll fade), so those cannot reframe the camera. Not for fixed elements.
export function layoutRect(element) {
  if (!element) return undefined;
  let left = 0,
    top = 0;
  for (let node = element; node; node = node.offsetParent) {
    left += node.offsetLeft || 0;
    top += node.offsetTop || 0;
  }
  const width = element.offsetWidth || 0,
    height = element.offsetHeight || 0;
  return { left, top, right: left + width, bottom: top + height, width, height, x: left, y: top };
}
// Largest dolly-in fraction of the fitted distance within one shot.
export const PUSH_IN = 0.045;
// A tour shot keeps its fit through height-only resizes up to this share (a
// phone's address bar) until the next cut.
const DEFER_HEIGHT_SHARE = 0.2;
function sameMatrix(a, b) {
  for (let i = 0; i < 16; i++) if (a[i] !== b[i]) return false;
  return true;
}
// The fit in use is kept while the view is unchanged or, during a tour, while
// only the height changes a little and the subject stays on the canvas.
function keepsFit(lock, shot, measured, area, width, height, defer) {
  if (lock?.shot !== shot || lock.measured !== measured) return false;
  const a = lock.area;
  if (
    width === lock.width &&
    height === lock.height &&
    area.left === a.left &&
    area.top === a.top &&
    area.width === a.width &&
    area.height === a.height
  )
    return true;
  if (
    !defer ||
    Math.abs(width - lock.width) >= 1 ||
    Math.abs(height - lock.height) > DEFER_HEIGHT_SHARE * lock.height ||
    Math.abs(area.left - a.left) >= 1 ||
    Math.abs(area.top - a.top) >= 1 ||
    Math.abs(area.width - a.width) >= 1
  )
    return false;
  const extent = (Math.min(1, (shot.margin ?? 0.85) / (1 - PUSH_IN)) * a.height) / 2;
  return a.top + a.height / 2 + extent <= height - 16;
}
export function createCinematicCamera({
  camera,
  fog,
  selected,
  angle = 0,
  getSafeArea,
  getGroundY,
}) {
  let tower = null,
    tree = null,
    disposed = false,
    started = null,
    applied = false;
  let status = { tower: "pending", tree: "pending" };
  const target = new Vector3();
  // The fit in use: { shot, measured, fitted, width, height, area, areaKey }.
  let lock = null;
  let currentShot = null;
  // Resolved shot -> { root, matrix, measured }; area key -> Map<shot, { measured, fitted }>.
  const measurements = new Map(),
    fits = new Map();
  const areaMemo = [];
  let areaKey = "";
  const originalFog = fog ? { near: fog.near, far: fog.far } : null;
  function cachedMeasurement(root, shot) {
    const entry = measurements.get(shot);
    return entry?.root === root && sameMatrix(entry.matrix, root.matrixWorld.elements)
      ? entry.measured
      : null;
  }
  function measurementFor(root, shot) {
    let measured = cachedMeasurement(root, shot);
    if (!measured) {
      measured = measureShot(root, shot);
      measurements.set(shot, {
        root,
        matrix: Float64Array.from(root.matrixWorld.elements),
        measured,
      });
    }
    return measured;
  }
  function areaKeyFor(area, width, height) {
    const m = areaMemo;
    if (
      m[0] !== width ||
      m[1] !== height ||
      m[2] !== area.left ||
      m[3] !== area.top ||
      m[4] !== area.width ||
      m[5] !== area.height
    ) {
      m.splice(0, 6, width, height, area.left, area.top, area.width, area.height);
      areaKey = m.join(",");
    }
    return areaKey;
  }
  function fitWithClearance(shot, measured, area, width, height) {
    let cameraY = measured.cameraY,
      fitted;
    const targetFoot = measured.groundAnchor;
    for (let pass = 0; pass < 6; pass++) {
      fitted = fitShot({ ...measured, cameraY }, shot, area, width, height);
      fitted.cameraY = cameraY;
      if (!getGroundY) break;
      let clearanceY = cameraY;
      // Sample the whole sweep and the dolly-in range (up to PUSH_IN).
      for (let step = -4; step <= 4; step++) {
        const yaw = ((shot.azimuth + (step * shot.arc) / 4) * Math.PI) / 180;
        for (const reach of [1, 1 - PUSH_IN]) {
          const x = measured.target.x + Math.cos(yaw) * fitted.distance * reach,
            z = measured.target.z + Math.sin(yaw) * fitted.distance * reach;
          clearanceY = Math.max(clearanceY, getGroundY(x, z) + 0.8);
          // A low camera can be above the earth yet look through a hill.
          // Keep footing views clear without moving or resizing the subject.
          if (shot.region[0] === 0) {
            const footY = Math.max(measured.footing, getGroundY(targetFoot.x, targetFoot.z)) + 0.18;
            for (let sample = 1; sample < 24; sample++) {
              const t = sample / 24;
              const groundY = getGroundY(
                x * (1 - t) + targetFoot.x * t,
                z * (1 - t) + targetFoot.z * t,
              );
              clearanceY = Math.max(clearanceY, (groundY + 0.08 - footY * t) / (1 - t));
            }
          }
        }
      }
      if (clearanceY - cameraY < 0.005) break;
      cameraY = clearanceY;
    }
    return fitted;
  }
  // Fits are kept for the last three viewport/safe-area generations; the
  // generation of the fit in use is never evicted.
  function fitFor(shot, measured, area, width, height) {
    const key = areaKeyFor(area, width, height);
    let generation = fits.get(key);
    if (!generation) {
      fits.set(key, (generation = new Map()));
      for (const old of fits.keys())
        if (fits.size > 3 && old !== key && old !== lock?.areaKey) fits.delete(old);
    }
    const entry = generation.get(shot);
    if (entry?.measured === measured) return entry.fitted;
    const fitted = fitWithClearance(shot, measured, area, width, height);
    generation.set(shot, { measured, fitted });
    return fitted;
  }
  function resolved() {
    if (status.tower === "fallback" || status.tower === "procedural") return "orbit";
    if (!tower || status.tower !== "ready") return null;
    if (selected === "tower") return "tower";
    if (tree && status.tree === "ready") return "tree";
    return ["fallback", "procedural"].includes(status.tree) ? "tower" : null;
  }
  return {
    get selected() {
      return selected;
    },
    get angle() {
      return angle;
    },
    isAvailable(kind) {
      return (
        !disposed &&
        Boolean(tower) &&
        status.tower === "ready" &&
        (kind === "tower" || (kind === "tree" && Boolean(tree) && status.tree === "ready"))
      );
    },
    setPreviewShot(kind, nextAngle) {
      if (
        !this.isAvailable(kind) ||
        !Number.isInteger(nextAngle) ||
        nextAngle < 0 ||
        nextAngle >= (DIRECTED_SHOTS[kind]?.length ?? 0)
      )
        return false;
      selected = kind;
      angle = nextAngle;
      started = null;
      lock = null;
      return true;
    },
    // Measures, then fits, a shot ahead of its cut: one heavy step per call.
    // Never touches the camera, fog or the fit in use.
    prepare(kind, nextAngle, width, height) {
      const base = DIRECTED_SHOTS[kind]?.[nextAngle];
      if (!base || !this.isAvailable(kind)) return "unavailable";
      const root = kind === "tree" ? tree : tower,
        shot = resolveDirectedShot(base, width, height);
      root.updateWorldMatrix(true, false);
      const measured = cachedMeasurement(root, shot);
      if (!measured) {
        measurementFor(root, shot);
        return "pending";
      }
      fitFor(shot, measured, getSafeArea(width, height), width, height);
      return "ready";
    },
    get shot() {
      return currentShot;
    },
    get frame() {
      return lock?.fitted ?? null;
    },
    get ready() {
      return resolved() !== null;
    },
    get current() {
      return resolved();
    },
    get target() {
      return target;
    },
    applyQuality(profile) {
      if (disposed || !originalFog || !profile?.lighting) return;
      originalFog.near = profile.lighting.fogNear;
      originalFog.far = profile.lighting.fogFar;
    },
    setSubject(kind, root) {
      if (disposed) return;
      lock = null;
      measurements.clear();
      fits.clear();
      if (kind === "tower") tower = root;
      else tree = root;
    },
    setStatus(record) {
      if (!disposed) status[record.kind] = record.status;
    },
    apply({
      width,
      height,
      elapsedSeconds = 0,
      reducedMotion = false,
      fallbackFov = 45,
      tourPhase = null,
    }) {
      if (disposed) return false;
      const view = resolved();
      if (!view || view === "orbit") {
        if (applied) {
          if (fog) Object.assign(fog, originalFog);
          camera.fov = fallbackFov;
          camera.updateProjectionMatrix();
          applied = false;
        }
        return false;
      }
      started ??= elapsedSeconds;
      const root = view === "tree" ? tree : tower;
      root.updateWorldMatrix(true, true);
      const shot = resolveDirectedShot(
        DIRECTED_SHOTS[view][angle] || DIRECTED_SHOTS[view][0],
        width,
        height,
      );
      const measured = measurementFor(root, shot),
        area = getSafeArea(width, height);
      if (!keepsFit(lock, shot, measured, area, width, height, tourPhase !== null))
        lock = {
          shot,
          measured,
          fitted: fitFor(shot, measured, area, width, height),
          width,
          height,
          area,
          areaKey: areaKeyFor(area, width, height),
        };
      const { fitted } = lock;
      currentShot = shot;
      target.copy(measured.target);
      // Tour shots drift at a constant rate so the camera never settles before
      // a cut; a 2.5% breath follows the 48-second arc without a tour. A tour
      // shot's dolly-in reaches 4.5% at its cut; the fit keeps a 15% margin.
      const phase = Math.min(1, Math.max(0, tourPhase ?? 0));
      const arc = reducedMotion
        ? 0
        : tourPhase !== null
          ? (phase - 0.5) * shot.arc
          : Math.sin(((elapsedSeconds - started) * Math.PI * 2) / 48) * shot.arc;
      const push = reducedMotion
        ? 0
        : tourPhase !== null
          ? PUSH_IN * phase
          : 0.025 * (0.5 - 0.5 * Math.cos(((elapsedSeconds - started) * Math.PI * 2) / 48));
      const distance = fitted.distance * (1 - push);
      const yaw = ((shot.azimuth + arc) * Math.PI) / 180;
      camera.position.set(
        target.x + Math.cos(yaw) * distance,
        fitted.cameraY,
        target.z + Math.sin(yaw) * distance,
      );
      camera.lookAt(target);
      // A kept fit becomes a crop anchored to the top of the canvas: the pixel
      // scale and the subject's distance from the top edge stay constant.
      const centerX = lock.area.left + lock.area.width / 2,
        centerY = lock.area.top + lock.area.height / 2;
      camera.fov =
        height === lock.height
          ? shot.fov
          : (360 / Math.PI) *
            Math.atan((Math.tan((shot.fov * Math.PI) / 360) * height) / lock.height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      camera.projectionMatrix.elements[8] = -((2 * centerX) / width - 1);
      camera.projectionMatrix.elements[9] = -(1 - (2 * centerY) / height);
      camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
      if (fog) {
        fog.near = Math.max(originalFog.near, fitted.distance * 0.88);
        fog.far = Math.max(originalFog.far, fitted.distance + 85);
      }
      applied = true;
      return true;
    },
    dispose() {
      if (disposed) return false;
      disposed = true;
      tower = tree = null;
      lock = currentShot = null;
      measurements.clear();
      fits.clear();
      if (fog) Object.assign(fog, originalFog);
      if (applied) {
        camera.fov = 45;
        camera.updateProjectionMatrix();
      }
      return true;
    },
  };
}
