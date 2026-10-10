// The film's distant firelights (far-fires.js): their layout on the plain, their
// light and air, the guards that keep them off the text, the subjects and The
// watch's reference clouds, and their clock.

import assert from "node:assert/strict";
import test from "node:test";
import {
  BoxGeometry,
  CustomBlending,
  Group,
  Mesh,
  MeshBasicMaterial,
  OneFactor,
  PerspectiveCamera,
  Points,
  SrcAlphaFactor,
  ZeroFactor,
} from "three";
import {
  createFarFires,
  FAR_FIRES,
  farFireCount,
  farFireGround,
  farFireLayout,
  kelvinColor,
} from "../src/scene/far-fires.js";
import { RANGE_MIST, RANGE_MIST_SHAPE, TERRAIN_EDGE } from "../src/scene/hill-silhouette.js";
import { RANGE_LAYERS, MOUNTAINS } from "../src/scene/mountain-build.js";
import { foothillHeight } from "../src/scene/terrain-build.js";
import { createSlateContacts, TERRAIN_BASE } from "../src/scene/mud-ground.js";
import { flat, source } from "./support/code.mjs";

test("the default is the scattered layout: a dozen small clusters of one to six fires", () => {
  assert.equal(FAR_FIRES.clusters.length, 12);
  for (const [azimuth, distance, spread, count, power] of FAR_FIRES.clusters) {
    assert.ok(azimuth >= 0 && azimuth < 360);
    assert.ok(count >= 1 && count <= 6, "one to six fires a cluster");
    assert.ok(spread >= 0 && power > 0 && power <= 1.5);
    // Out on the plain and the foothills, beyond the estate and its knoll.
    assert.ok(distance >= 120, `cluster at ${distance} units stands inside the estate`);
  }
  assert.equal(FAR_FIRES.glow.cluster, -1, "the scattered fires lift no settlement glow");
  assert.ok(FAR_FIRES.enabled);
});

test("the fires burn at 2000-2500 K, amber to deep orange", () => {
  assert.deepEqual([...FAR_FIRES.colour.kelvin], [2000, 2500]);
  const [deep, amber] = FAR_FIRES.colour.kelvin.map(kelvinColor);
  for (const [r, g, b] of [deep, amber]) {
    assert.equal(r, 1);
    assert.ok(g > b && g < 0.5, "warm: green well under red, blue under green");
  }
  assert.ok(amber[1] > deep[1] && amber[2] > deep[2], "the hotter fire is the paler");
  // Display sRGB of Helland's fit: 2000 K is (255, 137, 14).
  const display = (v) =>
    Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055));
  assert.deepEqual(deep.map(display), [255, 137, 14]);
  // A guttering fire sinks deeper orange, never toward white or blue.
  const [r, g, b] = FAR_FIRES.colour.gutter;
  assert.ok(r === 1 && g < 1 && b < g);
});

test("each fire stands on the film terrain's plain or foothills, or the far plain's level", () => {
  for (let r = 120; r < TERRAIN_EDGE; r += 7)
    for (let a = 0; a < 360; a += 13) {
      const x = r * Math.cos((a * Math.PI) / 180),
        z = r * Math.sin((a * Math.PI) / 180);
      assert.ok(
        Math.abs(farFireGround(x, z) - (TERRAIN_BASE + foothillHeight(x, z))) < 1e-9,
        `ground at ${r}, ${a} degrees`,
      );
    }
  assert.equal(farFireGround(TERRAIN_EDGE + 1, 0), TERRAIN_BASE);
  assert.equal(farFireGround(0, -2000), TERRAIN_BASE);
  for (const fire of farFireLayout()) {
    const ground = farFireGround(fire.x, fire.z);
    assert.ok(Math.abs(fire.y - ground - FAR_FIRES.lift) < 1e-9, "lifted a flame's height");
  }
});

test("the layout is deterministic, inside its clusters, and the balanced share keeps every cluster", () => {
  const fires = farFireLayout(),
    again = farFireLayout();
  assert.deepEqual(fires, again, "the same seed, the same fires");
  assert.equal(
    fires.length,
    FAR_FIRES.clusters.reduce((sum, cluster) => sum + cluster[3], 0),
  );
  for (const fire of fires) {
    const [azimuth, distance, spread] = FAR_FIRES.clusters[fire.cluster],
      a = (azimuth * Math.PI) / 180;
    assert.ok(
      Math.hypot(fire.x - distance * Math.cos(a), fire.z - distance * Math.sin(a)) <= spread + 1e-9,
    );
    assert.ok(fire.temperature >= 0 && fire.temperature < 1 && fire.kind === 0);
    assert.ok(fire.power > 0 && fire.power <= FAR_FIRES.clusters[fire.cluster][4]);
  }
  const shifted = farFireLayout({ ...FAR_FIRES, seed: FAR_FIRES.seed + 1 });
  assert.notDeepEqual(shifted, fires, "the seed places them");
  // Balanced draws the first share of the ranked list: each cluster's first fires.
  const kept = fires.slice(0, farFireCount(fires, "balanced"));
  assert.equal(kept.length, Math.ceil(fires.length * FAR_FIRES.balanced.share));
  assert.ok(kept.length < fires.length);
  assert.deepEqual(
    new Set(kept.map((fire) => fire.cluster)).size,
    FAR_FIRES.clusters.length,
    "every cluster keeps a fire on balanced",
  );
  assert.equal(farFireCount(fires, "high"), fires.length);
});

test("a settlement's glow rides first, above its cluster's heart, sized from its spread", () => {
  const config = {
    ...FAR_FIRES,
    clusters: [[184, 520, 42, 64, 0.75, 0.12], ...FAR_FIRES.clusters.slice(1)],
    glow: { ...FAR_FIRES.glow, cluster: 0, gain: 0.18 },
  };
  const fires = farFireLayout(config),
    [glow] = fires,
    town = fires.filter((fire) => fire.cluster === 0 && fire.kind === 0);
  assert.equal(glow.kind, 1);
  assert.equal(town.length, 64);
  assert.ok(Math.abs(glow.x - town.reduce((s, f) => s + f.x, 0) / 64) < 1e-9);
  assert.equal(glow.power, 42 * config.glow.width);
  assert.ok(glow.y > farFireGround(glow.x, glow.z), "it lifts into the haze above the cluster");
  // The valley's far side climbs: its farthest fires stand highest.
  const far = town.reduce((a, b) => (Math.hypot(a.x, a.z) > Math.hypot(b.x, b.z) ? a : b)),
    near = town.reduce((a, b) => (Math.hypot(a.x, a.z) < Math.hypot(b.x, b.z) ? a : b));
  assert.ok(far.y > near.y + 5);
  assert.equal(farFireCount(fires, "balanced", config) > 0 && fires[0].kind, 1);
});

test("far fires draw in front of the ranges and behind every nearer surface", () => {
  const world = source("src/scene/world.js"),
    near = Number(world.match(/CAMERA_NEAR: ([\d.]+)/)[1]),
    far = Number(world.match(/CAMERA_FAR: ([\d.]+)/)[1]);
  // Perspective NDC depth, and the ranges' compressed depth (hill-silhouette.js:
  // gl_Position.z mixed .8 toward w).
  const ndc = (d) => (far + near) / (far - near) - (2 * far * near) / ((far - near) * d);
  const ranges = (d) => 0.2 * ndc(d) + 0.8;
  assert.match(
    flat(source("src/scene/hill-silhouette.js")),
    /gl_Position\.z=mix\(gl_Position\.z,gl_Position\.w,\.8\);/,
  );
  const nearest = Math.min(RANGE_LAYERS[0][0], ...MOUNTAINS.radii.map((r) => r * 0.85));
  assert.ok(ndc(FAR_FIRES.haze.draw) < ranges(nearest), "in front of the nearest range");
  assert.ok(FAR_FIRES.haze.draw < far);
  // Beyond the terrain's edge every fire is at least the draw distance away from
  // a lens inside the estate's reach, so terrain nearer than it still hides it.
  assert.ok(FAR_FIRES.haze.draw > TERRAIN_EDGE);
  // The far plain ends at the ranges' ground line, where their mist lies.
  assert.equal(FAR_FIRES.haze.feet, -RANGE_MIST_SHAPE.floor);
  const material = createFarFires({ parent: new Group() }).root.material;
  assert.match(material.vertexShader, /min\(1\.,320\.0\/length\(e\)\)/);
});

test("the fires are one depth-tested Points draw of added light that keeps the depth layer, no light and no texture", () => {
  const parent = new Group(),
    fires = createFarFires({ parent, profile: { tier: "high" } });
  assert.equal(parent.children.length, 1);
  const points = parent.children[0];
  assert.ok(points instanceof Points);
  assert.equal(points.name, "far-fires");
  let lights = 0;
  parent.traverse((object) => (lights += object.isLight ? 1 : 0));
  assert.equal(lights, 0);
  const m = points.material;
  assert.equal(m.blending, CustomBlending);
  assert.deepEqual(
    [m.blendSrc, m.blendDst, m.blendSrcAlpha, m.blendDstAlpha],
    [SrcAlphaFactor, OneFactor, ZeroFactor, OneFactor],
  );
  assert.ok(m.depthTest && !m.depthWrite && m.transparent && !m.fog);
  for (const uniform of Object.values(m.uniforms))
    assert.ok(!uniform.value?.isTexture, "no texture");
  // After the ranges (-0.5 and -0.6), so their compressed depth never covers them.
  assert.ok(points.renderOrder > -0.5);
  // Hidden until the film shows.
  assert.equal(points.visible, false);
  fires.setFilmActive(true);
  assert.equal(points.visible, true);
  fires.setFilmActive(false);
  assert.equal(points.visible, false);
  assert.equal(fires.dispose(), true);
  assert.equal(parent.children.length, 0);
  assert.equal(fires.dispose(), false);
});

test("the fires' cores stay under the bloom's threshold, and the air reddens and dims them", () => {
  const { vertexShader } = createFarFires({ parent: new Group() }).root.material;
  // Core and halo together, over the far plain's air and a shot's mist (up to
  // about .2), stay under UnrealBloomPass's 0.9 threshold (postprocess.js), so no
  // fire blooms and the bloom elsewhere (The watch's reference clouds) is untouched.
  assert.ok(FAR_FIRES.light.peak + 0.2 < 0.9);
  assert.match(
    source("src/scene/postprocess.js"),
    /new UnrealBloomPass\(size, 0\.18, 0\.45, 0\.9\)/,
  );
  assert.match(
    vertexShader,
    /float peak=dot\(vCore\+vHalo,vec3\(\.2126,\.7152,\.0722\)\)\*1\.22;\s*float cap=min\(1\.,0\.55\/max\(peak,1e-4\)\)\*f;\s*vCore\*=cap;\s*vHalo\*=cap;/,
  );
  // Nor does light pile up: a cluster's fires stand apart as seen from the estate.
  const fires = farFireLayout();
  for (const a of fires)
    for (const b of fires) {
      if (a === b || a.cluster !== b.cluster) continue;
      const [azimuth, distance] = FAR_FIRES.clusters[a.cluster],
        u = (azimuth * Math.PI) / 180,
        dx = a.x - b.x,
        dz = a.z - b.z;
      const across = -Math.sin(u) * dx + Math.cos(u) * dz,
        along = Math.cos(u) * dx + Math.sin(u) * dz;
      assert.ok(Math.hypot(across, 0.03 * along) > FAR_FIRES.gap * distance);
    }
  const [r, g, b] = FAR_FIRES.haze.redden;
  assert.ok(r < g && g < b, "blue goes first, red last");
  assert.match(
    vertexShader,
    /vec3 T=exp\(-D\/2200\.0\*vec3\(0\.8,1\.0,1\.45\)\)\*\(1\.-0\.6\*mist\);/,
  );
  // The shot's low mist on the ranges' feet, shared with the ranges and the slate.
  assert.equal(createFarFires({ parent: new Group() }).uniforms.uMist, RANGE_MIST);
});

test("the fires breathe on the scene clock and hold for pauses, dialogs and reduced motion", () => {
  const fires = createFarFires({ parent: new Group() }),
    time = fires.uniforms.uTime;
  fires.update({ deltaSeconds: 0.5 });
  assert.equal(time.value, 0, "nothing runs while the film is off");
  fires.setFilmActive(true);
  fires.update({ deltaSeconds: 0.05 });
  assert.equal(time.value, 0.05);
  fires.update({ deltaSeconds: 0.05, reducedMotion: true });
  fires.update({ deltaSeconds: 0.05, motionPaused: true });
  assert.equal(time.value, 0.05);
  fires.update({ deltaSeconds: 5 });
  assert.ok(Math.abs(time.value - 0.15) < 1e-12, "a long frame advances at most 0.1 s");
  // Slow irregular breath and flutter, never a strobe: under 3 Hz.
  const { vertexShader } = fires.root.material;
  assert.match(vertexShader, /fn\(t\*\(\.45\+\.35\*aFire\.z\)\+s\)/);
  assert.match(vertexShader, /fn\(t\*\(1\.7\+\.9\*fract\(s\*\.37\)\)\+s\*3\.1\)/);
  assert.ok(FAR_FIRES.flicker.rate * 2.6 < 3);
  assert.ok(FAR_FIRES.flicker.breath + FAR_FIRES.flicker.flutter < 0.3);
});

test("balanced draws fewer fires, with no pools and a smaller halo", () => {
  const fires = createFarFires({ parent: new Group(), profile: { tier: "balanced" } }),
    { geometry } = fires.root;
  assert.equal(geometry.drawRange.count, farFireCount(fires.fires, "balanced"));
  assert.equal(fires.uniforms.uPool.value, 0);
  assert.equal(fires.uniforms.uHalo.value, FAR_FIRES.balanced.halo);
  fires.applyQuality({ tier: "high" }, { pixelRatio: 1.5 });
  assert.equal(geometry.drawRange.count, fires.fires.length);
  assert.equal(fires.uniforms.uPool.value, FAR_FIRES.light.pool);
  assert.equal(fires.uniforms.uPixelRatio.value, 1.5);
  fires.resize({ height: 900 });
  assert.equal(fires.uniforms.uHeight.value, 1350);
});

test("the fires borrow the slate's text boxes, and The watch keeps its reference clouds clear", () => {
  const contacts = createSlateContacts(),
    fires = createFarFires({ parent: new Group(), textGuard: contacts });
  for (const name of ["slateText", "slateAbout", "slateAspect"])
    assert.equal(fires.uniforms[name], contacts[name], `${name} is lent, not copied`);
  const { vertexShader } = fires.root.material;
  assert.match(
    vertexShader,
    /\(1\.-near\(slateText,v,0\.,0\.06\)\)\*\(1\.-near\(slateAbout,v,0\.,0\.04\)\)/,
  );
  // The 1100x440 top-left crop at 1600x900 lies inside The watch's kept-clear rect.
  const [x0, y0, x1, y1] = FAR_FIRES.shots["The watch"].clear;
  assert.ok(x0 <= 0 && y1 >= 1 && x1 >= 1100 / 1600 && y0 <= 1 - 440 / 900);
  let shot = { name: "The watch" };
  const camera = new PerspectiveCamera(),
    guarded = createFarFires({ parent: new Group(), camera, shot: () => shot });
  guarded.setFilmActive(true);
  guarded.update({});
  assert.deepEqual(guarded.uniforms.uClear.value.toArray(), [
    ...FAR_FIRES.shots["The watch"].clear,
  ]);
  shot = { name: "Portrait" };
  guarded.update({});
  assert.deepEqual(guarded.uniforms.uClear.value.toArray(), [2, 2, -1, -1]);
});

test("the subjects' silhouettes keep the fires off them, band by band", () => {
  const camera = new PerspectiveCamera(30, 16 / 9, 0.1, 450);
  camera.position.set(0, 5, 60);
  camera.lookAt(0, 5, 0);
  camera.updateMatrixWorld();
  const subject = new Group(),
    tower = new Mesh(new BoxGeometry(6, 24, 6), new MeshBasicMaterial());
  tower.position.y = 12;
  subject.add(tower);
  const behind = new Group();
  behind.add(new Mesh(new BoxGeometry(4, 4, 4), new MeshBasicMaterial()));
  behind.position.set(0, 2, 120);
  const fires = createFarFires({ parent: new Group(), camera, subjects: () => [subject, behind] });
  fires.setFilmActive(true);
  fires.update({});
  const rects = fires.uniforms.uSubjects.value,
    bands = FAR_FIRES.guard.bands;
  assert.equal(rects.length, 2 * bands);
  // The tower's bands stack up the canvas about its centre line.
  for (let i = 0; i < bands; i++) {
    const r = rects[i];
    assert.ok(r.x < 0.5 && r.z > 0.5 && r.x > 0.4, `band ${i} spans the tower's width`);
    if (i) assert.ok(r.w > rects[i - 1].w, "each band higher than the one below");
  }
  // A subject wholly behind the lens covers nothing.
  for (let i = bands; i < 2 * bands; i++) assert.ok(rects[i].x > rects[i].z);
  // The bands follow the subject when its root moves (a new scene offset).
  const before = rects[0].y;
  subject.position.y = -2;
  subject.updateMatrixWorld(true);
  fires.update({});
  assert.ok(rects[0].y < before);
  assert.match(
    fires.root.material.vertexShader,
    /for\(int i=0;i<16;i\+\+\)keep\*=1\.-near\(uSubjects\[i\],v,0\.012,0\.02\);/,
  );
});

test("the bootstrap adds the fires under the ground's root and shows them with the film", () => {
  const index = flat(source("src/scene/index.js"));
  assert.match(
    index,
    /const farFires = createFarFires\(\{ parent: environmentRoot, camera, subjects: \(\) => \[completeTower\?\.root, treeArchitecture\?\.root\], shot: \(\) => cinematic\.shot, textGuard: groundContacts, profile: state\.profile \}\); subsystemRegistry\.register\(farFires\);/,
  );
  assert.match(index, /rockScatter\.setFilmActive\(active\); farFires\.setFilmActive\(active\);/);
});
