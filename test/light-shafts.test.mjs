import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  BoxGeometry,
  DirectionalLight,
  Group,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PointLight,
  Scene,
  Vector3,
} from "three";
import { DIRECTED_SHOTS } from "../src/scene/directed-shots.js";
import {
  SHAFT_SHOTS,
  SHAFTS,
  blueNoise,
  goboHook,
  lightShafts,
  rasterizeLightMap,
  shaftDrift,
  shaftTreatment,
} from "../src/scene/light-shafts.js";
import { createSceneSubsystemRegistry } from "../src/scene/subsystem.js";

// Drives a light-map generator to completion, counting its yields.
function runMap(options) {
  const job = rasterizeLightMap(options);
  let step, yields = 0;
  while (!(step = job.next()).done) yields++;
  return { ...step.value, yields };
}
const texel = (map, x, y) => {
  const { data, width } = map.texture.image, i = (y * width + x) * 4;
  return [...data.subarray(i, i + 4)];
};

test("the light map rasterises first hits, the window, the light let through and its front", () => {
  // A 2 x 2 quad facing a light that travels along +z, two units past the origin.
  const positions = new Float32Array([-1, -1, 2, 1, -1, 2, 1, 1, 2, -1, 1, 2]);
  const map = runMap({
    positions, index: [0, 1, 2, 0, 2, 3], origin: new Vector3(), a: new Vector3(0, 0, 1),
    half: 4, res: 16, t0: 0, t1: 10, sharp: 1, mask: (x) => (x < 0 ? 1 : 0.5),
  });
  assert.equal(map.texture.image.width, 16);
  // Texels are half a unit: the quad covers texels 6-9 on both axes.
  const [depth, window, through, front] = texel(map, 7, 7);
  assert.equal(depth, Math.round((2 / 10) * 254), "first hit along the light");
  assert.equal(window, 255, "the mask is sampled at the texel centre");
  assert.ok(through < 40, `the light let through is near 0 over the quad (${through})`);
  assert.equal(front, depth, "without closing, the front is the first hit");
  assert.equal(texel(map, 9, 7)[1], 128, "the window varies across the map");
  assert.deepEqual(texel(map, 1, 1).filter((_, i) => i !== 1), [255, 255, 255], "no hit and full light away from the quad");
  assert.ok(map.coverage > 0.05 && map.coverage < 0.1, `coverage ${map.coverage}`);
  assert.ok(map.yields > 3, "the rasteriser yields so the builder can slice it");
  assert.equal(map.texture.flipY, false);
  assert.equal(map.texture.generateMipmaps, true, "softer levels widen a ray's edge with distance");
});

test("the closed silhouette lets light through its gaps only, with a front, and none outside it", () => {
  // A 6 x 6 frame (a one-unit border) around a 4 x 4 gap, facing the light at z = 3.
  const quad = (x0, y0, x1, y1) => [x0, y0, 3, x1, y0, 3, x1, y1, 3, x0, y1, 3];
  const positions = new Float32Array([...quad(-3, -3, 3, -2), ...quad(-3, 2, 3, 3), ...quad(-3, -2, -2, 2), ...quad(2, -2, 3, 2)]);
  const index = [0, 4, 8, 12].flatMap((o) => [o, o + 1, o + 2, o, o + 2, o + 3]);
  const map = runMap({ positions, index, origin: new Vector3(), a: new Vector3(0, 0, 1), half: 8, res: 32, t0: 0, t1: 10, close: 5, erode: 1, mask: () => 1 });
  // Texels are half a unit; the gap is texels 12-19 and the frame 10-21.
  const [gapHit, , gapThrough, gapFront] = texel(map, 16, 16);
  assert.equal(gapHit, 255, "nothing is hit in the gap");
  assert.ok(gapThrough > 200, `the gap lets its light through (${gapThrough})`);
  assert.equal(gapFront, Math.round((3 / 10) * 254), "and has the frame's front, so its air is lit only past it");
  assert.ok(texel(map, 11, 16)[2] < 80, `the timber stops it (${texel(map, 11, 16)[2]})`);
  const [, , outThrough, outFront] = texel(map, 4, 16);
  assert.deepEqual([outThrough, outFront], [0, 255], "outside the closed outline: no light and no front, so no ray or rim");
  // The back (its own map): R, the closed silhouette's last hit, filled across
  // the gap; G, the subject's own last hit, none in the gap; neither far outside.
  const back = (x, y, channel = 0) => map.backTexture.image.data[(y * 32 + x) * 2 + channel];
  assert.equal(back(16, 16), Math.round((3 / 10) * 254), "the air over the sky keeps its light only to a falloff past the back");
  assert.equal(back(16, 16, 1), 255, "the subject's own back: nothing in the gap");
  assert.equal(back(11, 16, 1), Math.round((3 / 10) * 254), "and the frame's own last hit on the frame");
  assert.deepEqual([back(4, 16), back(4, 16, 1)], [255, 255]);
  assert.equal(map.backTexture.format, 1030, "two channels");
  assert.deepEqual(map.depths.map((z) => +z.toFixed(3)), [3, 3, 3], "nearest and farthest front, deepest back");
  // Linear filtering never blends the closed back toward "no depth" at the
  // silhouette's edge: the texels just outside it hold a finite back, no
  // farther than their inside neighbour's, so no ring of light shows over
  // the open sky beside it.
  const inside = (x) => texel(map, x, 16)[3] < 255;
  const edge = [...Array(32).keys()].find(inside);
  assert.ok(edge > 6, `the closed silhouette starts at texel ${edge}`);
  for (let x = edge - 1; x >= edge - 4; x--) {
    assert.equal(texel(map, x, 16)[3], 255, `texel ${x} lies outside`);
    assert.ok(back(x, 16) < 255 && back(x, 16) <= back(x + 1, 16), `texel ${x} keeps a finite back (${back(x, 16)}) no farther than its inside neighbour (${back(x + 1, 16)})`);
  }
  // Beams split the light let through, and only that.
  const beams = runMap({ positions, index, origin: new Vector3(), a: new Vector3(0, 0, 1), half: 8, res: 32, t0: 0, t1: 10, close: 5, erode: 1, mask: () => 1, beams: (x) => (x < 0 ? 1 : 0.25) });
  assert.ok(texel(beams, 14, 16)[2] > 200 && texel(beams, 17, 16)[2] < 80, "a beam and the dark beside it");
  assert.equal(texel(beams, 17, 16)[1], 255, "the window (the light on surfaces) keeps its patches whole");
});

test("inside the closed silhouette's edge (inner) the hull's back gives way to the closed back", () => {
  // A far panel (z = 3) with a near cross-bar (z = 6): behind the panel, away
  // from the bar, the subject's own back is the panel's, which would cut the
  // air there into stepped notches; the closed back reaches the bar's.
  const quad = (x0, y0, x1, y1, z) => [x0, y0, z, x1, y0, z, x1, y1, z, x0, y1, z];
  const positions = new Float32Array([...quad(-5, -5, 5, 5, 3), ...quad(-5, -0.5, 5, 0.5, 6)]);
  const index = [0, 4].flatMap((o) => [o, o + 1, o + 2, o, o + 2, o + 3]);
  const run = (inner) => runMap({ positions, index, origin: new Vector3(), a: new Vector3(0, 0, 1), half: 8, res: 32, t0: 0, t1: 10, close: 5, erode: 1, inner, mask: () => 1 });
  const back = (map, x, y, channel) => map.backTexture.image.data[(y * 32 + x) * 2 + channel];
  const [panel, bar] = [3, 6].map((z) => Math.round((z / 10) * 254));
  const plain = run(0), blended = run(3);
  assert.equal(back(plain, 16, 18, 0), bar, "the closed back reaches the bar");
  assert.equal(back(plain, 16, 18, 1), panel, "without inner the subject's own back stays the panel's");
  assert.ok(bar - back(blended, 16, 18, 1) <= 2, `deep inside, the closed back (${back(blended, 16, 18, 1)})`);
  const edge = [...Array(32).keys()].find((x) => texel(blended, x, 18)[3] < 255);
  assert.ok(back(blended, edge, 18, 1) - panel < (bar - panel) / 4, `at the edge (texel ${edge}) the subject's own (${back(blended, edge, 18, 1)})`);
  for (let x = edge; x < 16; x++) assert.ok(back(blended, x + 1, 18, 1) >= back(blended, x, 18, 1), "a graded change, no step inward");
  assert.deepEqual([...blended.texture.image.data], [...plain.texture.image.data], "the light map itself is unchanged");
  assert.equal(SHAFTS.star.tower.inner, 4, "the star's tower keeps its ladder and legs strict");
  assert.equal(SHAFTS.moon.tower.inner ?? 0, 0, "the moon's maps are as they were");
});

test("a point source's map holds angles, so a nearer occluder shadows a wider cone", () => {
  const quad = (z) => new Float32Array([-1, -1, z, 1, -1, z, 1, 1, z, -1, 1, z]);
  const covered = (z) => {
    const map = runMap({
      positions: quad(z), index: [0, 1, 2, 0, 2, 3], point: new Vector3(), origin: new Vector3(), a: new Vector3(0, 0, 1),
      half: 0.5, res: 32, t0: 0, t1: 20, sharp: 1, soft: 2, mask: () => 1,
    });
    return map.coverage;
  };
  assert.ok(covered(4) > covered(8) * 3, "angular size falls with distance");
});

test("each directed shot takes its hybrid treatment: warm star, cool moon or none", () => {
  assert.deepEqual(SHAFT_SHOTS.star, ["The watch"]);
  assert.deepEqual(SHAFT_SHOTS.off, ["Lantern study", "Root and lantern"]);
  const treatments = Object.fromEntries(
    Object.values(DIRECTED_SHOTS).flat().map((shot) => [shot.name, shaftTreatment(shot.name)]),
  );
  assert.deepEqual(treatments, {
    "The watch": "star",
    Threshold: "moon",
    "Masonry study": "moon",
    "Gallery detail": "moon",
    Portrait: "moon",
    "Lantern study": null,
    "Close-up": "moon",
    "Root and lantern": null,
  });
  assert.equal(shaftTreatment(undefined), null);
  // Warm light belongs to the star only; the moonbeams keep the cool palette.
  assert.ok(SHAFTS.star.color[0] > SHAFTS.star.color[2]);
  assert.ok(SHAFTS.moon.color[2] > SHAFTS.moon.color[0]);
  // The star's rays stream through the whole cabin and lattice; the moon's are
  // slim shafts, sparse streaks about its vanishing point.
  assert.ok(SHAFTS.moon.rays[2] > SHAFTS.star.rays[2], "the moon's streaks are sparser");
});

test("the gobo composes with the subject's hooks, keys its program and restores both", () => {
  const material = new MeshStandardMaterial();
  const before = (shader) => {
    shader.fragmentShader += "\n// film grade";
  };
  const key = () => "babel-estate-material-v5-tower";
  material.onBeforeCompile = before;
  material.customProgramCacheKey = key;
  const uniforms = { shaftGoboGain: { value: 0 } };
  const hook = goboHook(material, uniforms, 0);
  hook.install();
  assert.notEqual(material.onBeforeCompile, before);
  assert.equal(material.customProgramCacheKey(), "babel-estate-material-v5-tower|light-shafts-0");
  const shader = {
    uniforms: {},
    vertexShader: "#include <common>\n#include <project_vertex>",
    fragmentShader: "#include <common>\n#include <lights_fragment_begin>\n#include <fog_fragment>",
  };
  material.onBeforeCompile(shader);
  assert.equal(shader.uniforms.shaftGoboGain, uniforms.shaftGoboGain, "shares the gobo's uniform objects");
  assert.match(shader.vertexShader, /vShaftWorld=\(modelMatrix\*vec4\(transformed,1\.\)\)\.xyz;vShaftClip=gl_Position;/);
  assert.match(shader.fragmentShader, /#define SHAFT_SHADOW 0/);
  assert.match(shader.fragmentShader, /lights_fragment_begin>\n\n#ifdef FLAT_SHADED[\s\S]*?\nif\(shaftGoboGain>0\.\)/);
  assert.match(shader.fragmentShader, /fog_fragment>\n\nfloat shaftFar=[^\n]*\nif\(shaftGain>0\.\)/, "the air before the subject follows fog, like the box");
  assert.match(shader.fragmentShader, /\/\/ film grade/, "the existing hook still runs");
  // Only the moon's own shadow map, by its slot, and only where it casts.
  assert.match(shader.fragmentShader, /defined\(USE_SHADOWMAP\)&&SHAFT_SHADOW>=0&&NUM_DIR_LIGHT_SHADOWS>SHAFT_SHADOW/);
  const version = material.version;
  hook.restore();
  assert.equal(material.onBeforeCompile, before);
  assert.equal(material.customProgramCacheKey, key);
  assert.ok(material.version > version, "the restored program is selected again");
});

// A small film scene: a 39-unit tower at the origin and a tree to the north-east,
// the moon key light, and stand-ins for the collaborators index.js passes.
function harness({ shot = "The watch", current = "tower", revealed = true, tour = null, search = "", eye = [70, 30, -40], parallel = true, compile = null } = {}) {
  const debug = {};
  globalThis.window = {
    BabelSite: { sceneDebug: debug },
    location: { search },
    setTimeout: (task, ms) => setTimeout(task, ms),
  };
  const homeScene = new Scene(), root = new Group(), camera = new PerspectiveCamera();
  const sun = new DirectionalLight();
  sun.position.set(32, 28, 14);
  sun.castShadow = true;
  homeScene.add(sun, sun.target, root);
  camera.position.set(...eye);
  const subject = (name, [w, h, d], [x, z]) => {
    const mesh = new Mesh(new BoxGeometry(w, h, d), new MeshStandardMaterial());
    mesh.name = name;
    mesh.position.set(x, h / 2, z);
    mesh.material.onBeforeCompile = () => {};
    mesh.material.customProgramCacheKey = () => name;
    root.add(mesh);
    return mesh;
  };
  const tower = subject("complete-meshy-tower", [6, 39, 6], [0, 0]);
  const tree = subject("meshy-tree", [3, 20, 3], [55, 36]);
  const counts = { compiles: 0, invalidations: 0, linked: [] };
  const readBuffer = { name: "composer read buffer" };
  let target = null;
  const rendering = {
    homeScene,
    camera,
    lights: { sun },
    composer: { readBuffer },
    renderer: {
      shadowMap: { enabled: true },
      domElement: { parentNode: { classList: { contains: () => revealed } } },
      extensions: { has: (name) => parallel && name === "KHR_parallel_shader_compile" },
      getContext: () => ({ isContextLost: () => false }),
      getRenderTarget: () => target,
      setRenderTarget(next) {
        target = next;
      },
      compileAsync(object, eye, lightsFrom) {
        counts.compiles++;
        counts.linked.push({ name: object.name || "stand-in", target, eye, lightsFrom, inScene: Boolean(object.parent === null || object.parent) });
        return compile ? compile(object) : Promise.resolve(object);
      },
    },
    postprocessPipeline: { passes: { vignetteGrain: { uniforms: { uTextBottom: { value: 0.25 }, uTextProtection: { value: 0 } } } } },
    compileShaders() {
      throw new Error("the whole scene should not be prepared again");
    },
  };
  const cinematic = { shot: { name: shot }, current };
  const film = { active: true, ready: Promise.resolve(() => 0) };
  const shafts = lightShafts(rendering, cinematic, tour, film, root, () => counts.invalidations++);
  const state = { debug, root, tower, tree, camera, cinematic, film, counts, shafts, rendering, set revealed(value) { revealed = value; } };
  state.until = async (condition, frame = {}) => {
    for (let i = 0; i < 400 && !condition(); i++) {
      shafts.update({ deltaSeconds: 0, ...frame });
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    shafts.update({ deltaSeconds: 0, ...frame });
    assert.ok(condition(), `timed out waiting in status ${debug.shafts?.status}`);
  };
  state.volumes = () => root.children.filter((object) => /^light-shafts-/.test(object.name));
  state.visible = () => state.volumes().filter((object) => object.visible).map((object) => object.name);
  return state;
}

test("the box adds colour only and leaves the film depth layer in alpha untouched", async () => {
  const h = harness();
  await h.until(() => h.debug.shafts?.status === "ready");
  const volumes = h.volumes();
  assert.deepEqual(volumes.map((mesh) => mesh.name).sort(), ["light-shafts-moon-tower", "light-shafts-moon-tree", "light-shafts-star-tower"]);
  for (const { name, material } of volumes) {
    const star = name === "light-shafts-star-tower";
    assert.equal(material.blending, 5, "custom blending");
    // The star's air is weighted by the film depth layer behind it (dst.a:
    // sky 0, mountains 1/3, ground 2/3), so none lands on the sky; the
    // moon's adds as it is.
    assert.deepEqual([material.blendSrc, material.blendDst], [star ? 206 : 201, 201], star ? "dst.rgb += src.rgb * dst.a" : "dst.rgb += src.rgb");
    assert.equal(material.uniforms.shaftLayer.value, star ? SHAFTS.star.layer : 1, "the land behind at full weight");
    assert.deepEqual([material.blendSrcAlpha, material.blendDstAlpha], [200, 201], "dst.a unchanged");
    assert.equal(material.depthWrite, false);
    assert.equal(material.depthTest, true, "opaque surfaces hide the far face");
    assert.equal(material.side, 1, "back faces");
    assert.match(material.fragmentShader, /if\(s\.r\+s\.g\+s\.b<=0\.\)discard;\ngl_FragColor=vec4\(s\*shaftLayer,0\.\);/, "an unlit pixel costs no blending");
    // Where the treatment asks, only view rays through the subject take air.
    assert.match(material.fragmentShader, /float w=mix\(shaftShape\.z,shaftShape\.y,ground\),k=w>0\.\?mix\(1\.,shaftHull\(ro,rd,far\),w\):1\.;/);
    const shape = material.uniforms.shaftShape.value;
    if (star) assert.deepEqual([shape.y, shape.z], [1, 1], "the star's air only through the tower, over the land and the sky");
    // Behind the far face lies near ground only where the view ray leaves the
    // box descending and close to it; elsewhere (the sky, the mountains, far
    // land) the air keeps only the light near the subject.
    assert.match(material.fragmentShader, /float ground=rd\.y<0\.\?1\.-smoothstep\(shaftGround\.x,shaftGround\.x\+shaftGround\.y,/);
    assert.ok(material.fragmentShader.indexOf("discard") > material.fragmentShader.indexOf("shaftQuad(shaftMarch("), "the quad's average is taken before any of its pixels leaves");
  }
  // Each box keeps its floor level and above the terrain under it.
  for (const { rotation, material } of volumes) {
    assert.equal(rotation.x, 0);
    assert.equal(rotation.z, 0);
    assert.ok(material.uniforms.shaftFade.value.x >= 0.05);
  }
  // Each subject links its hooked program on a detached stand-in and the box
  // program once, against the composer target and with the scene's lights.
  assert.deepEqual(h.counts.linked.map(({ name }) => name), ["stand-in", "light-shafts-star-tower", "stand-in", "light-shafts-moon-tree"]);
  for (const { target, eye, lightsFrom } of h.counts.linked) {
    assert.equal(target?.name, "composer read buffer");
    assert.equal(eye, h.camera);
    assert.ok(lightsFrom.isScene);
  }
  assert.equal(h.root.children.filter((object) => object.isMesh && !object.name).length, 0, "no stand-in joins the scene");
  h.shafts.dispose();
});

test("per shot: warm star in The watch, moon elsewhere, nothing in the lantern shots", async () => {
  const h = harness({ shot: "The watch", current: "tower" });
  await h.until(() => h.debug.shafts?.status === "ready");
  h.shafts.update({ deltaSeconds: 0 });
  assert.deepEqual(h.visible(), ["light-shafts-star-tower"]);
  assert.equal(h.debug.shafts.shown, "tower-star");
  assert.match(h.tower.material.customProgramCacheKey(), /\|light-shafts-0$/, "the warm catch lands on the tower");
  h.cinematic.shot = { name: "Gallery detail" };
  h.shafts.update({ deltaSeconds: 0 });
  assert.deepEqual(h.visible(), ["light-shafts-moon-tower"]);
  h.cinematic.shot = { name: "Portrait" };
  h.cinematic.current = "tree";
  h.shafts.update({ deltaSeconds: 0 });
  assert.deepEqual(h.visible(), ["light-shafts-moon-tree"]);
  for (const name of ["Lantern study", "Root and lantern"]) {
    h.cinematic.shot = { name };
    h.shafts.update({ deltaSeconds: 0 });
    assert.deepEqual(h.visible(), [], `${name} stays lit by the lantern alone`);
    assert.equal(h.debug.shafts.shown, "");
  }
  h.shafts.dispose();
});

test("a running tour switches treatment only on a cut, or while the canvas fades in", async () => {
  const tour = { running: true, transition: { cut: false } };
  const h = harness({ shot: "The watch", tour, revealed: false });
  window.getComputedStyle = () => ({ transitionDuration: "0.2s" });
  for (let i = 0; i < 40; i++) {
    h.shafts.update({ deltaSeconds: 0 });
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(h.counts.compiles, 0, "nothing links before the reveal");
  assert.equal(h.debug.shafts.shown, "");
  h.revealed = true;
  await h.until(() => h.debug.shafts.shown === "tower-star");
  assert.ok(h.counts.compiles > 0);
  // The fade-in ends, and the tower's moonbeams are built too (a loaded CPU
  // takes longer over the maps).
  await new Promise((resolve) => setTimeout(resolve, 250));
  await h.until(() => h.debug.shafts.status === "ready");
  h.cinematic.shot = { name: "Threshold" };
  h.shafts.update({ deltaSeconds: 0 });
  assert.equal(h.debug.shafts.shown, "tower-star", "never mid-hold");
  tour.transition.cut = true;
  const invalidations = h.counts.invalidations;
  h.shafts.update({ deltaSeconds: 0 });
  assert.equal(h.debug.shafts.shown, "tower-moon", "under the dissolve's kept frame");
  assert.ok(h.counts.invalidations > invalidations, "a paused or held scene draws the change once");
  tour.transition.cut = false;
  tour.running = false;
  h.cinematic.shot = { name: "Lantern study" };
  h.shafts.update({ deltaSeconds: 0 });
  assert.equal(h.debug.shafts.shown, "", "a still frame when the tour is not running");
  h.shafts.dispose();
});

test("inside the box the air is off and only the light on the subject stays", async () => {
  const h = harness({ shot: "Close-up", current: "tree", eye: [55, 12, 36] });
  await h.until(() => h.debug.shafts?.status === "ready");
  h.shafts.update({ deltaSeconds: 0 });
  assert.equal(h.debug.shafts.shown, "tree-moon:inside");
  assert.deepEqual(h.visible(), []);
  assert.match(h.tree.material.customProgramCacheKey(), /\|light-shafts-0$/, "the gobo is on the bark");
  h.shafts.dispose();
});

test("reduced motion and pauses freeze the drifting light", async () => {
  const h = harness();
  await h.until(() => h.debug.shafts?.status === "ready");
  const drift = () => ({ ...h.volumes()[0].material.uniforms.shaftDrift.value });
  h.shafts.update({ deltaSeconds: 0.05 });
  const start = drift();
  h.shafts.update({ deltaSeconds: 0.05, reducedMotion: true });
  assert.deepEqual(drift(), start, "reduced motion holds it");
  h.shafts.update({ deltaSeconds: 0.05, motionPaused: true });
  assert.deepEqual(drift(), start, "a pause holds it");
  h.shafts.update({ deltaSeconds: 0.05 });
  assert.notDeepEqual(drift(), start, "it drifts again when motion resumes");
  h.shafts.dispose();
});

test("dispose restores every hook and removes everything it added", async () => {
  const h = harness();
  const hooks = [h.tower, h.tree].map(({ material }) => [material.onBeforeCompile, material.customProgramCacheKey]);
  await h.until(() => h.debug.shafts?.status === "ready");
  h.shafts.update({ deltaSeconds: 0 });
  assert.notEqual(h.tower.material.onBeforeCompile, hooks[0][0], "the gobo is installed at the commit");
  assert.equal(h.shafts.dispose(), true);
  assert.deepEqual([h.tower, h.tree].map(({ material }) => [material.onBeforeCompile, material.customProgramCacheKey]), hooks);
  assert.deepEqual(h.volumes(), []);
  assert.equal(h.debug.shafts, undefined);
  assert.equal(h.debug.setShafts, undefined);
  assert.equal(h.shafts.dispose(), false);
  h.shafts.update({ deltaSeconds: 0 });
  assert.deepEqual(h.volumes(), [], "a disposed subsystem never rebuilds");
});

test("losing the film, a subject or its material disposes first and rebuilds", async () => {
  const h = harness();
  await h.until(() => h.debug.shafts?.status === "ready");
  h.shafts.update({ deltaSeconds: 0 });
  const original = h.tower.material;
  h.film.active = false;
  h.shafts.update({ deltaSeconds: 0 });
  assert.deepEqual(h.volumes(), [], "film off leaves the scene as it was");
  assert.equal(h.tower.material.customProgramCacheKey(), "complete-meshy-tower");
  h.film.active = true;
  const swapped = new MeshStandardMaterial();
  h.tower.material = swapped;
  await h.until(() => h.debug.shafts?.status === "ready" && h.debug.shafts.shown === "tower-star");
  assert.equal(original.customProgramCacheKey(), "complete-meshy-tower", "the old material keeps its own program");
  assert.match(swapped.customProgramCacheKey(), /light-shafts-0$/, "the new one takes the gobo");
  h.shafts.dispose();
});

test("the tower's star light lands first, before the terrain or the tree, and stays when the tree arrives", async () => {
  const h = harness({ shot: "The watch" });
  h.tree.removeFromParent();
  h.film.ready = new Promise(() => {}); // the terrain's root supports are still on their way
  await h.until(() => h.debug.shafts?.shown === "tower-star");
  assert.deepEqual(h.visible(), ["light-shafts-star-tower"]);
  assert.equal(h.debug.shafts.status, "building", "the moonbeams wait for the terrain");
  h.root.add(h.tree);
  h.film.ready = Promise.resolve(() => 0);
  for (let i = 0; i < 5; i++) h.shafts.update({ deltaSeconds: 0 });
  assert.equal(h.debug.shafts.shown, "tower-star", "the tree arriving leaves the tower's light alone");
  h.shafts.dispose();
});

test("programs linked before new lights arrive are linked again before the first commit", async () => {
  const tour = { running: true, transition: { cut: false } };
  // A lantern shot on screen: nothing commits until the cut to The watch.
  const h = harness({ shot: "Lantern study", tour });
  h.tree.removeFromParent();
  await h.until(() => h.debug.shafts?.status === "ready");
  const linked = h.counts.linked.length;
  h.shafts.update({ deltaSeconds: 0 });
  assert.equal(h.counts.linked.length, linked, "an unchanged light set links nothing again");
  h.root.add(new PointLight());
  for (let i = 0; i < 30; i++) h.shafts.update({ deltaSeconds: 0 });
  assert.deepEqual(h.counts.linked.slice(linked).map(({ name }) => name), ["stand-in", "light-shafts-star-tower", "light-shafts-moon-tower"], "checked twice a second");
  await new Promise((resolve) => setTimeout(resolve, 10));
  // A light arriving just before a cut is caught at the commit itself.
  h.root.add(new PointLight());
  h.cinematic.shot = { name: "The watch" };
  tour.transition.cut = true;
  const before = h.counts.linked.length;
  h.shafts.update({ deltaSeconds: 0 });
  assert.equal(h.debug.shafts.shown, "", "no commit with programs that predate the lights");
  assert.equal(h.counts.linked.length, before + 3);
  await h.until(() => h.debug.shafts.shown === "tower-star");
  // Once committed, the scene's own warm-ups link the hooked programs.
  const committed = h.counts.linked.length;
  h.root.add(new PointLight());
  h.shafts.update({ deltaSeconds: 0 });
  assert.equal(h.counts.linked.length, committed);
  h.shafts.dispose();
});

test("an import that resolves late, or after disposal, does nothing", async () => {
  const h = harness();
  h.shafts.update({ deltaSeconds: 0 });
  assert.equal(h.debug.shafts.status, "building");
  h.shafts.dispose();
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.deepEqual(h.volumes(), [], "a build cut short by disposal never lands");
  assert.equal(h.tower.material.customProgramCacheKey(), "complete-meshy-tower");
  const off = harness({ search: "?shafts=off" });
  for (let i = 0; i < 20; i++) off.shafts.update({ deltaSeconds: 0.1 });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepEqual(off.volumes(), [], "?shafts=off keeps the scene without them");
  off.shafts.dispose();
  // index.js: high and balanced film only, never low or legacy, and a late
  // or failed import leaves the scene as it is.
  const index = await readFile(new URL("../src/scene/index.js", import.meta.url), "utf8");
  assert.match(
    index,
    /if \(filmEnabled && !modes\.legacy && assetTier != "low" && renderer\.capabilities\.isWebGL2\) \{\s+import\("\.\/light-shafts\.js"\)\.then\(\(\{ lightShafts \}\) => subsystemRegistry\.disposed \|\|\s+subsystemRegistry\.register\(lightShafts\(rendering, cinematic, cameraTour, filmScene, environmentRoot, invalidateContent\)\), \(\) => \{\}\);\s+\}/,
  );
  assert.equal(index.match(/import\("\.\/light-shafts\.js"\)/g).length, 1);
});

test("WebGL1 never loads the shafts: their box and hooks use derivatives and a two-channel map", async () => {
  // three r160 falls back to a WebGL1 context where WebGL2 is missing. The
  // chunk's shaders take dFdx/fwidth (GL_OES_standard_derivatives there) and
  // its back map is RG, so index.js requests it only on WebGL2; the scene
  // renders on WebGL1 as it did before the shafts.
  const index = await readFile(new URL("../src/scene/index.js", import.meta.url), "utf8");
  const gate = index.indexOf("renderer.capabilities.isWebGL2) {"), load = index.indexOf('import("./light-shafts.js")');
  assert.ok(gate > 0 && load > gate && load - gate < 60, "the import sits behind the WebGL2 check");
  assert.match(index, /const \{ camera, homeScene, renderer \} = rendering;/, "the renderer in scope is the scene's");
  const material = new MeshStandardMaterial();
  goboHook(material, {}, 0).install();
  const shader = { uniforms: {}, vertexShader: "#include <common>\n#include <project_vertex>", fragmentShader: "#include <common>\n#include <lights_fragment_begin>\n#include <fog_fragment>" };
  material.onBeforeCompile(shader);
  assert.match(shader.fragmentShader, /dFdx\(/, "the reason: derivatives");
  const h = harness();
  await h.until(() => h.debug.shafts?.status === "ready");
  for (const { material: box } of h.volumes()) {
    assert.equal(box.uniforms.shaftBack.value.format, 1030, "an RG map, which WebGL1 cannot sample");
    assert.match(box.fragmentShader, /dFdx\(/);
  }
  h.shafts.dispose();
});

test("the window's sway stays bounded however long the page stays open", async () => {
  for (const kind of ["star", "moon"]) {
    const [amplitude] = SHAFTS[kind].drift;
    assert.ok(amplitude <= 0.03, `${kind}: a small sway in map units`);
    let peak = 0;
    for (let t = 0; t <= 1e4; t += 0.25) {
      const { x, y } = shaftDrift(t, SHAFTS[kind].drift);
      peak = Math.max(peak, Math.abs(x), Math.abs(y));
    }
    assert.ok(peak <= amplitude + 1e-12, `${kind}: never past its amplitude on either axis (${peak})`);
    assert.ok(peak > amplitude * 0.99, `${kind}: it does sway`);
  }
  // Through the subsystem: 1e4 s of 0.1 s frames.
  const h = harness();
  await h.until(() => h.debug.shafts?.shown === "tower-star");
  const uniform = h.volumes()[0].material.uniforms.shaftDrift, bound = Math.max(SHAFTS.star.drift[0], SHAFTS.moon.drift[0]);
  let peak = 0;
  for (let i = 0; i < 1e5; i++) {
    h.shafts.update({ deltaSeconds: 0.1 });
    peak = Math.max(peak, Math.abs(uniform.value.x), Math.abs(uniform.value.y));
  }
  assert.ok(peak <= bound + 1e-12, `after 1e4 s the window is still within ${bound} (${peak})`);
  h.shafts.dispose();
});

test("a quality step sets the march length from the tier it applies, ahead of rendering", async () => {
  const h = harness();
  const renderer = h.rendering.renderer;
  const registry = createSceneSubsystemRegistry();
  // rendering.js runs later in the same step (lifecycleOrder 100) and sets the shadow map.
  registry.register({ lifecycleOrder: 100, applyQuality(profile) { renderer.shadowMap.enabled = Boolean(profile.shadows.enabled); } });
  registry.register(h.shafts);
  await h.until(() => h.debug.shafts?.shown === "tower-star");
  const steps = () => h.volumes()[0].material.uniforms.shaftSteps.value;
  assert.equal(steps(), SHAFTS.star.steps[0]);
  registry.applyQuality({ shadows: { enabled: false } });
  assert.equal(renderer.shadowMap.enabled, false);
  assert.equal(steps(), SHAFTS.star.steps[1], "the balanced march at once, not a step late");
  registry.applyQuality({ shadows: { enabled: true } });
  assert.equal(steps(), SHAFTS.star.steps[0]);
  h.cinematic.shot = { name: "Threshold" };
  h.shafts.update({ deltaSeconds: 0 });
  assert.equal(steps(), SHAFTS.moon.steps[0], "each treatment keeps its own length");
  // Balanced (phones) draws the star's sparser streaks, a little brighter
  // each, and takes them on the step itself; the count stays.
  h.cinematic.shot = { name: "The watch" };
  h.shafts.update({ deltaSeconds: 0 });
  const box = h.volumes().find(({ name }) => name === "light-shafts-star-tower").material.uniforms;
  const count = box.shaftStreak.value.x;
  assert.deepEqual([box.shaftStreak.value.y, box.shaftStreak.value.z, box.shaftSource.value.w], [SHAFTS.star.rays[2], SHAFTS.star.rays[3], SHAFTS.star.rays[0]]);
  registry.applyQuality({ shadows: { enabled: false } });
  const [contrast, e0, e1, scale] = SHAFTS.star.sparse;
  assert.deepEqual([box.shaftStreak.value.y, box.shaftStreak.value.z, box.shaftSource.value.w], [e0, e1, contrast], "sparser streaks with darker gaps");
  assert.ok(e0 > SHAFTS.star.rays[2] && contrast > SHAFTS.star.rays[0]);
  assert.ok(Math.abs(box.shaftGain.value - SHAFTS.star.gain * scale) < 1e-12, "a little more light in each");
  assert.equal(box.shaftStreak.value.x, count, "no jump in the pattern");
  registry.dispose();
});

test("a quality step on the cut into a subject not yet shown clears the last shot's light, then brings the new one in", async () => {
  // index.js takes adaptive steps on cut frames, before the subsystems
  // update: the tree's programs, linked with the key light casting, must link
  // again first, and the tower's light from Threshold must not stay on for
  // the whole Portrait hold.
  const tour = { running: true, transition: { cut: true, progress: 1 } };
  const h = harness({ shot: "The watch", tour });
  const registry = createSceneSubsystemRegistry();
  registry.register({ lifecycleOrder: 100, applyQuality(profile) { h.rendering.renderer.shadowMap.enabled = Boolean(profile.shadows.enabled); } });
  registry.register(h.shafts);
  await h.until(() => h.debug.shafts?.status === "ready" && h.debug.shafts.shown === "tower-star");
  h.cinematic.shot = { name: "Threshold" };
  h.shafts.update({ deltaSeconds: 1 / 60 });
  tour.transition.cut = false;
  assert.equal(h.debug.shafts.shown, "tower-moon");
  h.cinematic.shot = { name: "Portrait" };
  h.cinematic.current = "tree";
  tour.transition.cut = true;
  registry.applyQuality({ shadows: { enabled: false } });
  h.shafts.update({ deltaSeconds: 1 / 60 });
  assert.equal(h.debug.shafts.shown, "", "the Threshold light leaves with the cut");
  assert.deepEqual(h.visible(), []);
  tour.transition.cut = false;
  await h.until(() => h.debug.shafts.shown === "tree-moon", { deltaSeconds: 1 / 60 });
  assert.ok(h.debug.shafts.level < 1, "the relinked tree's light fades in mid-hold");
  assert.deepEqual(h.visible(), ["light-shafts-moon-tree"]);
  registry.dispose();
});

test("a light that lands late in its own shot fades in, and only once its programs are linked", async () => {
  const tour = { running: true, transition: { cut: false } };
  const h = harness({ tour }); // revealed, the fade-in over
  const gain = () => h.volumes().find(({ name }) => name === "light-shafts-star-tower").material.uniforms.shaftGain.value;
  await h.until(() => h.debug.shafts?.shown === "tower-star");
  assert.ok(gain() < SHAFTS.star.gain, "it starts faint mid-hold");
  await new Promise((resolve) => setTimeout(resolve, 1050));
  h.shafts.update({ deltaSeconds: 0.016 });
  assert.equal(gain(), SHAFTS.star.gain, "and is full a second later");
  h.shafts.dispose();
  // Where programs cannot link in parallel, a first commit would compile on
  // screen: it waits for the cut.
  const serialTour = { running: true, transition: { cut: false } };
  const serial = harness({ tour: serialTour, parallel: false });
  await serial.until(() => serial.debug.shafts?.status === "ready");
  for (let i = 0; i < 5; i++) serial.shafts.update({ deltaSeconds: 0 });
  assert.equal(serial.debug.shafts.shown, "");
  serialTour.transition.cut = true;
  serial.shafts.update({ deltaSeconds: 0 });
  assert.equal(serial.debug.shafts.shown, "tower-star");
  serial.shafts.dispose();
});

test("disposing while a link is in flight frees its materials only once it settles", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const materials = [];
  const h = harness({
    compile(object) {
      materials.push(object.material);
      object.material.addEventListener("dispose", () => { object.material.disposedAt = performance.now(); });
      return gate.then(() => object);
    },
  });
  await h.until(() => materials.length >= 2);
  assert.equal(h.shafts.dispose(), true);
  assert.deepEqual(h.volumes(), [], "the boxes leave the scene at once");
  assert.ok(materials.every((material) => material.disposedAt === undefined), "kept while Three still polls them");
  release();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(materials.every((material) => material.disposedAt !== undefined), "freed once the link settles");
});

test("the march reads its maps at a named level, keeps to the lit core and starts on blue noise", () => {
  const material = new MeshStandardMaterial();
  goboHook(material, {}, 0).install();
  const shader = {
    uniforms: {},
    vertexShader: "#include <common>\n#include <project_vertex>",
    fragmentShader: "#include <common>\n#include <lights_fragment_begin>\n#include <fog_fragment>",
  };
  material.onBeforeCompile(shader);
  const glsl = shader.fragmentShader;
  // No gradient inside the uniform-gated branches, so ANGLE on Direct3D keeps
  // them real branches and a hooked subject costs nothing without its light.
  assert.match(glsl, /#if __VERSION__>=300\n#define shaftTex\(s,p,l\) textureLod\(s,p,l\)/);
  assert.equal(glsl.replace(/#if __VERSION__>=300[\s\S]*?#endif/, "").match(/\btexture(2D|Lod)?\(/g), null, "every read goes through shaftTex");
  assert.match(glsl, /shaftTex\(shaftNoise,gl_FragCoord\.xy\/32\.,0\.\)\.r/);
  assert.match(glsl, /uniform vec4 shaftCore;/, "the lit cylinder about the light's axis");
  assert.match(glsl, /1\.-smoothstep\(shaftReach\.x,shaftReach\.x\+shaftReach\.y,past\)/, "a ray fades past its reach");
  assert.match(glsl, /shaftGoboClip\.x\+shaftGoboClip\.y\*\(1\.-exp/, "a soft shoulder on the surface's light");
  assert.match(glsl, /ceil\(shaftSteps\*shaftAir\.w\)/, "the subject's own march takes a share of the steps");
  assert.ok(SHAFTS.moon.sub < SHAFTS.star.sub, "the moon's, over the whole crown in Portrait, fewer");
  for (const kind of ["star", "moon"]) assert.equal(SHAFTS[kind].over, 1, `${kind}: the rays show in front of the subject too`);
  for (const kind of ["star", "moon"]) for (const clip of [SHAFTS[kind].gobo.clip]) assert.ok(clip[0] + clip[1] <= 0.62, `${kind}: lit timber stays under ~0.6`);
});

test("the moon on the tower keeps to its box: no march of its own over the timber", async () => {
  const h = harness({ shot: "Threshold" });
  const shader = { uniforms: {}, vertexShader: "#include <common>\n#include <project_vertex>", fragmentShader: "#include <common>\n#include <lights_fragment_begin>\n#include <fog_fragment>" };
  await h.until(() => h.debug.shafts?.shown === "tower-moon" && h.debug.shafts.level === 1);
  h.tower.material.onBeforeCompile(shader, {});
  const box = h.volumes().find(({ name }) => name === "light-shafts-moon-tower").material.uniforms.shaftGain.value;
  assert.equal(SHAFTS.moon.tower.air.over, 0);
  assert.ok(box > 0, "the box's shafts past the cabin");
  assert.equal(shader.uniforms.shaftGain.value, 0, "the tower's own march is skipped");
  assert.ok(shader.uniforms.shaftGoboGain.value > 0, "its broken moonlight still lands on the timber");
  assert.ok(SHAFTS.star.over > 0 && !("over" in SHAFTS.moon.tree.air), "the watch's cabin and the crown keep theirs");
  h.shafts.dispose();
});

test("the terrain's own sliced build has the idle time first; the shafts wait for it", async () => {
  const h = harness();
  let release;
  // terrain-build.js holds this promise while its slices run.
  h.rendering.terrainSlicing = new Promise((resolve) => { release = resolve; });
  for (let i = 0; i < 30; i++) {
    h.shafts.update({ deltaSeconds: 0 });
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(h.debug.shafts.status, "building");
  assert.deepEqual(h.volumes(), [], "no map is built while the terrain slices");
  assert.equal(h.counts.compiles, 0);
  h.rendering.terrainSlicing = null;
  release();
  await h.until(() => h.debug.shafts?.shown === "tower-star");
  h.shafts.dispose();
});

test("a subject that arrives after the film is found on the next frame drawn, however few frames draw", async () => {
  const h = harness({ shot: "Portrait", current: "tree" });
  h.tree.removeFromParent();
  await h.until(() => h.debug.shafts?.status === "ready");
  assert.deepEqual(h.debug.shafts.parts.map(({ subject }) => subject), ["tower"]);
  // A still frame (reduced motion) draws only when something changes: one update.
  h.root.add(h.tree);
  h.shafts.update({ deltaSeconds: 0, reducedMotion: true });
  assert.deepEqual(h.debug.shafts.parts.map(({ subject }) => subject), ["tower", "tree"], "no wait for a periodic check");
  await h.until(() => h.debug.shafts.shown === "tree-moon", { reducedMotion: true });
  h.shafts.dispose();
});

test("a dissolve into the shot brings its light in with the subject layer, never ahead of it", async () => {
  const tour = { running: false, transition: { cut: false, progress: 1 } };
  const h = harness({ tour });
  // postprocess.js: each layer dissolves from 3 * step * code over the window; the subject's code is 1.
  h.rendering.postprocessPipeline.passes.vignetteGrain.uniforms.uStagger = { value: { x: 0.2, y: 0.4 } };
  await h.until(() => h.debug.shafts?.shown === "tower-star");
  const box = () => h.volumes().find(({ name }) => name === "light-shafts-star-tower").material.uniforms.shaftGain.value;
  assert.equal(box(), SHAFTS.star.gain);
  tour.running = true;
  tour.transition.progress = 0.5;
  h.shafts.update({ deltaSeconds: 0.016 });
  assert.equal(box(), 0, "the sky and ground layers are still dissolving: no warm window yet");
  tour.transition.progress = 0.8;
  h.shafts.update({ deltaSeconds: 0.016 });
  assert.ok(Math.abs(box() - SHAFTS.star.gain * 0.5) < 1e-9, "half way through the subject layer, half the light");
  tour.transition.progress = 1;
  h.shafts.update({ deltaSeconds: 0.016 });
  assert.equal(box(), SHAFTS.star.gain);
  h.shafts.dispose();
});

test("the rays streak about the light's own place on screen and ease off behind the name and intro", async () => {
  const h = harness();
  const rects = { ".hero h1": [100, 100, 400, 250], ".hero-intro": [100, 260, 380, 300] };
  window.document = { querySelector: (selector) => rects[selector] && { getBoundingClientRect: () => {
    const [left, top, right, bottom] = rects[selector];
    return { left, top, right, bottom, width: right - left, height: bottom - top };
  } } };
  h.rendering.renderer.domElement.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 500 });
  await h.until(() => h.debug.shafts?.shown === "tower-star");
  h.shafts.update({ deltaSeconds: 0 });
  const { uniforms } = h.volumes().find(({ name }) => name === "light-shafts-star-tower").material;
  const star = new Vector3(-72.25, 50, -11.9).project(h.camera);
  const source = uniforms.shaftSource.value;
  assert.ok(Math.abs(source.x - (star.x * 0.5 + 0.5)) < 1e-9 && Math.abs(source.y - (star.y * 0.5 + 0.5)) < 1e-9, "the star's place in the frame");
  assert.equal(source.w, SHAFTS.star.rays[0], "the streaks' contrast");
  assert.ok(Number.isInteger(uniforms.shaftStreak.value.x) && uniforms.shaftStreak.value.x >= 8, "a whole number of streaks about it, so they meet without a seam");
  const text = uniforms.shaftText.value;
  assert.deepEqual([text.x, text.y, text.z, text.w].map((v) => +v.toFixed(3)), [0.1, 0.4, 0.4, 0.8], "the text's box on the canvas, y up");
  assert.equal(uniforms.shaftJitter.value, 0, "the star's streaks keep their even fan");
  // Portrait's spacing wanders over groups of four streaks, so no two read
  // as even bars; a whole number of groups meets without a seam.
  await h.until(() => h.debug.shafts.status === "ready");
  h.cinematic.shot = { name: "Portrait" };
  h.cinematic.current = "tree";
  h.shafts.update({ deltaSeconds: 0 });
  const moon = h.volumes().find(({ name }) => name === "light-shafts-moon-tree").material.uniforms;
  assert.equal(h.debug.shafts.shown, "tree-moon");
  assert.equal(moon.shaftStreak.value.x % 4, 0);
  assert.equal(moon.shaftJitter.value, SHAFTS.moon.tree.air.jitter);
  assert.ok(SHAFTS.moon.tree.air.jitter > 0 && SHAFTS.moon.jitter === 0, "the crown's only; the cabin keeps its shafts where they were");
  delete window.document;
  h.shafts.dispose();
  // The march: the air lit only past the closed silhouette's front, streaked
  // by angle about the source, softly capped, and scaled down in the text's box.
  const material = new MeshStandardMaterial();
  goboHook(material, {}, 0).install();
  const shader = {
    uniforms: {},
    vertexShader: "#include <common>\n#include <project_vertex>",
    fragmentShader: "#include <common>\n#include <lights_fragment_begin>\n#include <fog_fragment>",
  };
  material.onBeforeCompile(shader);
  const glsl = shader.fragmentShader;
  const has = (text, message) => assert.ok(glsl.includes(text), message);
  has("float past=u.z-shaftDepth(shaftTex(shaftMap,u.xy,0.).a);", "lit only past the closed silhouette's front (A)");
  has("if(ground<1.)t*=max(ground,1.-smoothstep(shaftReach.z,shaftReach.z+shaftReach.w,u.z-shaftDepth(shaftTex(shaftBack,u.xy,0.).r)));", "over the sky, only to a falloff past its back");
  // The streaks are a stylised screen-space pattern about the source; the
  // soft cap bounds their peak, so the dark between them keeps its share
  // and a bright ray never turns into a veil.
  has("float w=mix(r,1.+shaftSource.w,shaftPeak),a=shaftGain*w*pow(", "the star's cap is taken at the streaks' peak");
  has("a/(1.+a/shaftCeil)*mix(1.,r/w,shaftPeak)*hull*(1.-shaftBehindText(v)*mix(.9,1.,shaftTextProtection))", "a soft cap, then (the star) the streaks, and 90% less behind the text");
  // Round the text's box the air fades back in over a fifth of the screen's
  // smaller side, measured in square units (the aspect undone), so neither
  // the rays nor their haze stop at a straight edge beside the name: the
  // 8% box feather read as a clear pane on the owner's desktop (2026-09-28).
  has("float shaftBehindText(vec2 v){vec2 f=max(max(shaftText.xy-v,v-shaftText.zw),0.)*vec2(shaftSource.z,1.)/min(shaftSource.z,1.);return 1.-smoothstep(0.,.2,length(f));}", "a round, wide, smooth fade about the text's box");
  assert.deepEqual([SHAFTS.star.peak, SHAFTS.moon.peak], [1, 0], "the moon's sparse shafts keep the streaked air under the cap, broad and full");
  has("if(r==0.)r=shaftRay(v,s);", "streaked about the source, only where light was gathered");
  has("a+=shaftJitter*(2.*mix(shaftHash(qi,.25*x),shaftHash(qi+1.,.25*x),qf*qf*(3.-2.*qf))-1.);", "their spacing wanders");
  // Each streak fades in past the front (rise, varied per streak), and part
  // of the light is read two levels sharper (tie), so the gaps shape it too.
  has("float rise=shaftShape.x*(.5+s);", "a streak's own fade-in length");
  has("*smoothstep(-soft,soft+rise,past)*", "no blunt start at the closed silhouette's front");
  has("if(shaftShape.w>0.)b=mix(b,shaftTex(shaftMap,u.xy,max(l-2.,0.)).b,shaftShape.w);", "the light map's own transmittance");
  // The hull test reads the subject's own back (G), not the closed one.
  has("*(1.-smoothstep(0.,.25,u.z-shaftDepth(shaftTex(shaftBack,u.xy,0.).g))));", "no view ray beside the subject passes");
  assert.ok(SHAFTS.moon.tree.air.rise > 0 && SHAFTS.moon.tree.air.tie > 0, "Portrait's shafts fade in and follow the crown's gaps in part");
  assert.equal(SHAFTS.moon.tree.air.hull[1], 1, "and over the sky keep to view rays through the crown");
  has("gk*=1.-shaftBehindText(vShaftClip.xy/vShaftClip.w*.5+.5)", "the light on surfaces eases off behind the text as well");
  has("shaftThin*pow(1.-abs(dot(geometryNormal,geometryViewDir)),3.)", "no rim glints on twigs thinner than a pixel");
  has("shaftQuad(shaftSeen,shaftFar)", "the air averaged over its pixel quad");
});

test("a shot with no treatment costs the update nothing past its subject checks", async () => {
  const h = harness({ shot: "Lantern study", current: "tree" });
  await h.until(() => h.debug.shafts?.status === "ready");
  const { uniforms } = h.volumes()[0].material;
  const drift = { ...uniforms.shaftDrift.value }, invalidations = h.counts.invalidations;
  uniforms.shaftShift.value.set(9, 9, 9);
  for (let i = 0; i < 10; i++) h.shafts.update({ deltaSeconds: 1 });
  assert.deepEqual(uniforms.shaftDrift.value, drift, "no sway computed");
  assert.deepEqual(uniforms.shaftShift.value.toArray(), [9, 9, 9], "no root placement read");
  assert.equal(h.counts.invalidations, invalidations, "nothing redrawn");
  // The next shot with a treatment takes the sway where time has brought it.
  h.cinematic.shot = { name: "Portrait" };
  h.shafts.update({ deltaSeconds: 0 });
  assert.equal(h.debug.shafts.shown, "tree-moon");
  assert.notDeepEqual(uniforms.shaftDrift.value, drift);
  h.shafts.dispose();
});

test("the blue-noise tile ranks every texel once and keeps neighbours apart", () => {
  const job = blueNoise();
  let step, yields = 0;
  while (!(step = job.next()).done) yields++;
  const texture = step.value, { data, width, height } = texture.image;
  assert.deepEqual([width, height], [32, 32]);
  assert.ok(yields > 10, "it builds in slices");
  const counts = new Map();
  for (let i = 0; i < data.length; i += 4) counts.set(data[i], (counts.get(data[i]) ?? 0) + 1);
  assert.equal(counts.size, 256, "every level");
  assert.ok([...counts.values()].every((count) => count === 4), "evenly");
  const at = (x, y) => data[(((y + 32) % 32) * 32 + ((x + 32) % 32)) * 4] / 255;
  let sum = 0;
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) sum += Math.abs(at(x, y) - at(x + 1, y)) + Math.abs(at(x, y) - at(x, y + 1));
  assert.ok(sum / 2048 > 0.38, `neighbours differ more than white noise's 1/3 (${(sum / 2048).toFixed(3)})`);
  assert.deepEqual([texture.wrapS, texture.wrapT, texture.magFilter, texture.minFilter], [1000, 1000, 1003, 1003], "tiled, one texel per pixel");
});
