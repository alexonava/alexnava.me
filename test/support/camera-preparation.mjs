import { createHash } from "node:crypto";
import { Fog, Group, PerspectiveCamera } from "three";
import { createTreeArchitecture } from "../../src/scene/architecture.js";
import { DIRECTED_SHOTS, resolveDirectedShot } from "../../src/scene/directed-shots.js";
import { watchMeasure } from "../../src/scene/opening-star.js";
import { glbAsset, modelBytes } from "./glb.mjs";

export const preparationLayouts = [
  [1920, 1080],
  [390, 844],
  [844, 390],
  [1080, 1920],
  [820, 1180],
  [650, 400],
];

// Numeric review of both delivered tiers, all five original shots and their
// resolved viewport variants. No GPU, clock override or geometry substitution.
export function cameraPreparationSignatures(api, factory = null) {
  const signatures = {};
  for (const tier of ["high", "balanced"]) {
    const tree = createTreeArchitecture({
        asset: glbAsset(modelBytes("tree", tier)),
        groundHeight: () => 1.25,
      }),
      watch = new Group(),
      stored = watchMeasure(tier),
      measure = (root, shot) => (root === watch ? stored(root, shot) : api.measureShot(root, shot));
    for (const [width, height] of preparationLayouts)
      for (const [kind, shots] of Object.entries(DIRECTED_SHOTS))
        for (const [angle, base] of shots.entries()) {
          const camera = new PerspectiveCamera(45, width / height, 0.1, 500),
            fog = new Fog(0, 62, 150),
            controller = api.createCinematicCamera({
              camera,
              fog,
              selected: kind,
              angle,
              getSafeArea: api.cinematicSafeArea,
              getGroundY: () => 1.25,
              measure,
              measureSteps: (root, shot) =>
                root === watch ? null : api.measureShotSteps?.(root, shot),
            }),
            root = kind === "tree" ? tree.root : watch,
            shot = resolveDirectedShot(base, width, height),
            measured = measure(root, shot),
            digest = createHash("sha256");
          controller.setSubject("watch", watch);
          controller.setSubject("tree", tree.root);
          controller.setStatus({ kind: "watch", status: "ready" });
          controller.setStatus({ kind: "tree", status: "ready" });
          digest.update(
            Buffer.from(
              measured.points.buffer,
              measured.points.byteOffset,
              measured.points.byteLength,
            ),
          );
          const records = [
            measured.target.toArray(),
            measured.groundAnchor.toArray(),
            measured.cameraY,
            measured.height,
            measured.footing,
            measured.radius,
            measured.region.min.toArray(),
            measured.region.max.toArray(),
          ];
          if (factory) {
            let attempts = 0;
            while (controller.prepare(kind, angle, width, height, factory) === "pending") {
              if (++attempts > 10000) throw new Error("preparation failed to finish");
            }
          }
          for (const tourPhase of [0, 0.25, 0.5, 0.75, 1]) {
            controller.apply({ width, height, tourPhase, elapsedSeconds: 6 * tourPhase });
            records.push(
              camera.position.toArray(),
              camera.fov,
              [...camera.projectionMatrix.elements],
              controller.target.toArray(),
              fog.near,
              fog.far,
              controller.frame.distance,
              controller.frame.cameraY,
              controller.frame.radius,
            );
          }
          digest.update(JSON.stringify(records));
          signatures[`${tier}:${kind}:${angle}:${width}x${height}`] = digest.digest("hex");
          controller.dispose();
        }
    tree.dispose();
  }
  return signatures;
}
