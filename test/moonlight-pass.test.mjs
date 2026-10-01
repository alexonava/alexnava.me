import assert from "node:assert/strict";
import test from "node:test";
import {
  Box3,
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  Vector3,
} from "three";
import { createCinematicCamera, PUSH_IN } from "../src/scene/cinematic.js";
import { createCameraTour, TOUR_IDLE } from "../src/scene/camera-tour.js";
import { createPostprocessPipeline } from "../src/scene/postprocess.js";
import {
  applyFilmGrade,
  createCompleteTowerArchitecture,
  createTreeArchitecture,
} from "../src/scene/architecture.js";
import { DIRECTED_SHOTS } from "../src/scene/directed-shots.js";

const close = (a, b, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

function tourSetup(interval = 5) {
  const camera = new PerspectiveCamera(),
    tower = new Group(),
    tree = new Group();
  const material = new MeshBasicMaterial(),
    geometry = new BoxGeometry(10, 20, 10);
  for (const root of [tower, tree]) {
    const mesh = new Mesh(geometry, material);
    mesh.position.y = 10;
    root.add(mesh);
  }
  tree.position.set(55.1, 0, 36.1);
  const controller = createCinematicCamera({
    camera,
    selected: "tower",
    angle: 0,
    getSafeArea: () => ({ left: 450, top: 32, width: 940, height: 720 }),
  });
  for (const [kind, root] of [
    ["tower", tower],
    ["tree", tree],
  ]) {
    controller.setSubject(kind, root);
    controller.setStatus({ kind, status: "ready" });
  }
  const tour = createCameraTour({ camera: controller, interval });
  const render = (time, flags = {}) => {
    const phase = tour.update({ elapsedSeconds: time, ...flags });
    controller.apply({
      width: 1440,
      height: 900,
      elapsedSeconds: time,
      tourPhase: phase,
      ...flags,
    });
    return phase;
  };
  return { camera, controller, tour, render };
}

const LOW = { postprocessGrading: true, postprocessVignette: false, postprocessGrain: false };
const rendererMock = () => ({
  autoClear: true,
  autoClearColor: true,
  autoClearDepth: true,
  autoClearStencil: true,
  clear() {},
  getPixelRatio: () => 1,
  getRenderTarget: () => null,
  getSize(target) {
    target.width = 800;
    target.height = 600;
    return target;
  },
  render() {},
  setRenderTarget() {},
});

test("tour shots open without black and dissolve the kept outgoing frame into each cut", () => {
  const f = tourSetup(5);
  const pipeline = createPostprocessPipeline(rendererMock(), { isScene: true }, f.camera, LOW, {
    matchMedia: () => ({ matches: false }),
  });
  const pass = pipeline.passes.vignetteGrain;
  // Mirrors index.js: the tour, then the pipeline, then the camera and the draw.
  const frame = (time, flags = {}) => {
    const phase = f.tour.update({ elapsedSeconds: time, ...flags });
    pipeline.setTransition(f.tour.transition);
    f.controller.apply({
      width: 1440,
      height: 900,
      elapsedSeconds: time,
      tourPhase: phase,
      ...flags,
    });
    pipeline.composer.render(0);
  };
  frame(0);
  assert.deepEqual({ ...f.tour.transition }, { ...TOUR_IDLE }, "the opening shot shows at once");
  assert.equal(pass.enabled, false);
  assert.equal(pass.uniforms.uProgress.value, 1);
  assert.equal(pass.uniforms.uLayered.value, 0, "outside film the dissolve is not staggered");
  frame(4.95);
  assert.equal(pass.enabled, false);

  frame(5);
  assert.equal(f.tour.transition.capture, true);
  assert.equal(f.controller.shot.name, "The watch", "the capture keeps the outgoing shot");
  assert.equal(pass.enabled, true, "the low tier adds the final pass for the crossfade");
  assert.equal(pass.uniforms.uProgress.value, 1);
  assert.ok(pass.uniforms.tPrev.value, "grading's output is kept");
  // The kept frame pushes in about the safe-area centre, in UV from the bottom.
  close(pass.uniforms.uPrevOrigin.value.x, (450 + 940 / 2) / 1440, 1e-6);
  close(pass.uniforms.uPrevOrigin.value.y, 1 - (32 + 720 / 2) / 900, 1e-6);
  pipeline.setQualityProfile(LOW);
  assert.equal(pass.enabled, true, "a quality step keeps the crossfade");

  frame(5.05);
  const { cut, progress, zoom } = f.tour.transition;
  assert.equal(f.controller.shot.name, "Threshold");
  assert.equal(cut, true);
  close(progress, 0.05, 1e-6);
  // Linear here; the final pass eases it, per depth layer in film.
  close(pass.uniforms.uProgress.value, progress, 1e-9);
  close(pass.uniforms.uPrevScale.value, 1 / (1 + zoom * progress), 1e-9);
  assert.equal(pass.uniforms.uLayered.value, 0);
  frame(5.5);
  close(pass.uniforms.uProgress.value, 0.5, 1e-6);
  frame(6.1);
  assert.deepEqual({ ...f.tour.transition }, { ...TOUR_IDLE });
  assert.equal(pass.uniforms.uProgress.value, 1);
  assert.equal(pass.enabled, false, "the low tier drops the final pass after the dissolve");

  // A pause mid-dissolve settles on the incoming shot; resuming does not replay it.
  frame(10);
  assert.equal(f.tour.transition.capture, true);
  frame(10.3);
  assert.equal(f.controller.shot.name, "Gallery detail");
  assert.ok(pass.uniforms.uProgress.value < 1);
  f.tour.toggle();
  frame(10.4);
  assert.equal(pass.uniforms.uProgress.value, 1);
  assert.equal(pass.enabled, false);
  f.tour.toggle();
  frame(10.5);
  assert.equal(pass.uniforms.uProgress.value, 1);
  frame(10.6, { reducedMotion: true });
  assert.deepEqual({ ...f.tour.transition }, { ...TOUR_IDLE });
  assert.equal("uFade" in pass.uniforms, false, "no dip to black remains");
  f.tour.dispose();
  assert.deepEqual({ ...f.tour.transition }, { ...TOUR_IDLE });
  pipeline.dispose();
  f.controller.dispose();
});

test("each shot dollies in slowly within its fitted margin and holds still with reduced motion", () => {
  const f = tourSetup(5);
  const phase0 = f.render(0);
  assert.equal(phase0, 0);
  const start = f.camera.position.distanceTo(f.controller.target);
  f.render(4.99);
  const end = f.camera.position.distanceTo(f.controller.target);
  assert.ok(end < start * (1 - PUSH_IN * 0.9) && end > start * (1 - PUSH_IN * 1.01));
  f.render(2.5, { reducedMotion: true });
  close(f.camera.position.distanceTo(f.controller.target), start, 1e-6);
  f.tour.dispose();
  f.controller.dispose();
});

test("tour shots drift at a constant rate between unchanged start, middle and end poses", () => {
  const f = tourSetup(5);
  const pose = (tourPhase) => {
    f.controller.apply({ width: 1440, height: 900, elapsedSeconds: 0, tourPhase });
    const x = f.camera.position.x - f.controller.target.x,
      z = f.camera.position.z - f.controller.target.z;
    return { yaw: (Math.atan2(z, x) * 180) / Math.PI, distance: Math.hypot(x, z) };
  };
  const start = pose(0);
  const { shot, frame } = f.controller;
  const middle = pose(0.5),
    end = pose(1);
  close(start.yaw, shot.azimuth - shot.arc / 2, 1e-6);
  close(middle.yaw, shot.azimuth, 1e-6);
  close(end.yaw, shot.azimuth + shot.arc / 2, 1e-6);
  close(start.distance, frame.distance, 1e-6);
  close(middle.distance, frame.distance * (1 - PUSH_IN / 2), 1e-6);
  close(end.distance, frame.distance * (1 - PUSH_IN), 1e-6);
  // The pan and the dolly-in move as fast by the cuts as mid-shot.
  const rate = (from, to) => {
    const a = pose(from),
      b = pose(to);
    return [(b.yaw - a.yaw) / (to - from), (b.distance - a.distance) / (to - from)];
  };
  const [midYaw, midPush] = rate(0.495, 0.505);
  close(midYaw, shot.arc, 1e-6);
  close(midPush, -PUSH_IN * frame.distance, 1e-6);
  for (const [from, to] of [
    [0, 0.01],
    [0.99, 1],
  ]) {
    const [yaw, push] = rate(from, to);
    close(yaw, midYaw, 1e-6);
    close(push, midPush, 1e-6);
  }
  f.tour.dispose();
  f.controller.dispose();
});

const asset = () => {
  const scene = new Group();
  scene.add(new Mesh(new BoxGeometry(1, 2, 1), new MeshStandardMaterial()));
  return { scene };
};

test("supplied tower and tree switch between source and moonlight grades without rebuilding materials", () => {
  const tower = createCompleteTowerArchitecture({ asset: asset(), groundY: 0 });
  const material = tower.root.getObjectByName("complete-meshy-tower").material;
  const u = material.userData.babelGrade.uniforms;
  assert.equal(material.userData.babelGrade.role, "tower");
  close(u.babelSaturation.value, 0.94);
  assert.equal(u.babelLift.value, 0);
  tower.setFilmTreatment(true);
  close(u.babelSaturation.value, 0.75);
  close(u.babelHighlights.value, 0.3);
  close(u.babelTint.value.r, 0.93);
  close(u.babelShadowTint.value.b, 0.2);
  close(u.babelLift.value, 0.14);
  tower.setFilmTreatment(false);
  close(u.babelSaturation.value, 0.94);
  assert.equal(u.babelTint.value.r, 1);
  close(u.babelShadowTint.value.r, 0.19);
  assert.equal(u.babelLift.value, 0);
  assert.equal(applyFilmGrade(new MeshStandardMaterial(), true), false);
  const shader = {
    uniforms: {},
    vertexShader: "#include <common>\n#include <begin_vertex>",
    fragmentShader: "#include <common>\n#include <map_fragment>\n#include <roughnessmap_fragment>",
  };
  material.onBeforeCompile(shader);
  assert.equal(shader.uniforms.babelTint, u.babelTint);
  assert.equal(shader.uniforms.babelShadowTint, u.babelShadowTint);
  assert.match(shader.fragmentShader, /babelLift/);
  tower.dispose();
  tower.setFilmTreatment(true);
  assert.equal(u.babelLift.value, 0);

  const tree = createTreeArchitecture({ asset: asset(), groundHeight: () => 0 });
  const treeUniforms =
    tree.root.getObjectByName("meshy-tree").material.userData.babelGrade.uniforms;
  tree.setFilmTreatment(true);
  close(treeUniforms.babelSaturation.value, 0.8);
  tree.setFilmTreatment(false);
  assert.equal(treeUniforms.babelSaturation.value, 1);
  tree.dispose();
});

test("the lantern is an iron post lantern with glass, candle and flame, authored 2.48 units tall and fully owned", () => {
  const tree = createTreeArchitecture({ asset: asset(), groundHeight: () => 0 });
  const lantern = tree.root.getObjectByName("tree-lantern");
  const names = lantern.children
    .filter((o) => o.isMesh)
    .map((o) => o.name)
    .sort();
  assert.deepEqual(names, [
    "lantern-candle",
    "lantern-flame",
    "lantern-frame",
    "lantern-glass",
    "lantern-glass",
    "lantern-glass",
    "lantern-glass",
  ]);
  lantern.updateWorldMatrix(true, true);
  const size = new Box3().setFromObject(lantern).getSize(new Vector3());
  close(size.y, 2.48, 0.05);
  assert.ok(size.x < 1.05 && size.z < 1.05);
  const glass = lantern.getObjectByName("lantern-glass").material;
  assert.equal(glass.transparent, true);
  assert.equal(glass.depthWrite, false);
  const flame = lantern.getObjectByName("lantern-flame");
  close(tree.light.position.y, flame.position.y);
  tree.setFilmTreatment(true);
  close(glass.emissiveIntensity, 0.018);
  close(flame.material.emissiveIntensity, 1.35);
  const geometries = new Set(),
    materials = new Set();
  lantern.traverse((o) => {
    if (o.isMesh) {
      geometries.add(o.geometry);
      materials.add(o.material);
    }
  });
  let disposed = 0;
  for (const resource of [...geometries, ...materials])
    resource.addEventListener("dispose", () => disposed++);
  assert.equal(tree.dispose(), true);
  assert.equal(disposed, geometries.size + materials.size);
});

test("the eight directed shots keep their names and distinct viewpoints", () => {
  const all = [...DIRECTED_SHOTS.tower, ...DIRECTED_SHOTS.tree];
  assert.deepEqual(
    all.map((s) => s.name),
    [
      "The watch",
      "Threshold",
      "Masonry study",
      "Gallery detail",
      "Portrait",
      "Lantern study",
      "Close-up",
      "Root and lantern",
    ],
  );
  const keys = new Set(all.map((s) => `${s.azimuth}/${s.height}/${s.region.join()}`));
  assert.equal(keys.size, 8);
  for (const shot of all) {
    assert.ok(shot.height >= 0.1 && shot.height <= 0.7);
    assert.ok(shot.fov >= 30 && shot.fov <= 46);
  }
});
