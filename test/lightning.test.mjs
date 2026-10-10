// The film storm's lightning (src/scene/lightning.js): its seeded schedule and
// the flash limit, the reference banks it keeps off, the bolt's path, the
// subsystem's flash on the sky, the lights, the rim and the ground and its
// holds, rendering's setFlash(), and the shaders and wiring that carry it.

import assert from "node:assert/strict";
import test from "node:test";
import { Group, PerspectiveCamera, Vector3, Vector4 } from "three";
import {
  LIGHTNING,
  boltPath,
  createLightning,
  createLightningSchedule,
  lightningLevel,
  lightningPulse,
  lightningRandom,
  lightningTier,
  referenceKeep,
  skyDirection,
} from "../src/scene/lightning.js";
import { CLOUD_RESHAPE, FLASH_REFERENCE } from "../src/scene/estate-sky.js";
import { FILM_LIGHT, FLASH_GROUND, RIM_UNIFORMS, setRim } from "../src/scene/film-light.js";
import { createSceneRendering } from "../src/scene/rendering.js";
import { flat, source } from "./support/code.mjs";

// Every pulse peak an event list holds.
const peaksOf = (events) => events.flatMap((event) => event.peaks.map((p) => p.t));
// The most peaks any one-second window holds.
function busiestSecond(peaks) {
  const sorted = [...peaks].sort((a, b) => a - b);
  let most = 0;
  for (let i = 0; i < sorted.length; i++) {
    let j = i;
    while (j < sorted.length && sorted[j] - sorted[i] < 1) j++;
    most = Math.max(most, j - i);
  }
  return most;
}

test("the storm's lightning is occasional, bold and off nothing but a debug override", () => {
  assert.equal(LIGHTNING.enabled, true);
  assert.deepEqual([...LIGHTNING.forceAt], [], "captures force flashes; the site never does");
  assert.ok(
    LIGHTNING.interval[0] >= 2 && LIGHTNING.interval[1] <= 8,
    "an event every 2-6 s (the owner asked for more, twice, 2026-10-09)",
  );
  assert.ok(LIGHTNING.pulses[0] >= 1 && LIGHTNING.pulses[1] <= 3, "1-3 pulses");
  assert.equal(LIGHTNING.perSecond, 3, "WCAG 2.3.1: never more than three flashes a second");
  assert.ok(
    LIGHTNING.bolt.chance > 0.5 && LIGHTNING.bolt.chance < 1,
    "most events send a bolt, some flicker in the banks",
  );
  assert.ok(
    LIGHTNING.strength[0] < LIGHTNING.strength[1] && LIGHTNING.skew > 1,
    "they vary, skewed toward the fainter",
  );
  const balanced = lightningTier(LIGHTNING, "balanced");
  assert.equal(balanced.bolt.draw, false, "phones draw no bolt");
  assert.equal(balanced.bolt.chance, 0);
  assert.equal(balanced.sky.thin, 0, "and a plain glow");
  assert.equal(lightningTier(LIGHTNING, "high"), LIGHTNING);
  assert.equal(balanced.relight.fill, LIGHTNING.relight.fill, "a tier overrides only its own");
});

test("the schedule is seeded, so every capture of a phase is the same", () => {
  const a = createLightningSchedule(LIGHTNING).until(300);
  const b = createLightningSchedule(LIGHTNING).until(300);
  assert.deepEqual(a, b);
  const [near, far] = LIGHTNING.interval;
  assert.ok(a.length >= 300 / far - 1 && a.length <= 300 / near + 1, `${a.length} events in 300 s`);
  assert.equal(a[0].start, LIGHTNING.first);
  for (let i = 1; i < a.length; i++) {
    const apart = a[i].start - a[i - 1].start;
    assert.ok(apart >= LIGHTNING.interval[0] && apart <= LIGHTNING.interval[1] + 1, `gap ${apart}`);
  }
  for (const event of a) {
    assert.ok(event.peaks.length >= 1 && event.peaks.length <= 3);
    const span = event.end - event.start;
    assert.ok(span > 0.15 && span < 1.4, `an event lasts ${span} s`);
  }
  const reseeded = createLightningSchedule({ ...LIGHTNING, seed: LIGHTNING.seed + 1 }).until(300);
  assert.notDeepEqual(
    reseeded.map((e) => e.start),
    a.map((e) => e.start),
  );
  // The hash is uniform enough that the bolt share holds over a long run.
  let low = 0;
  for (let k = 0; k < 4000; k++) if (lightningRandom(LIGHTNING.seed, k, 4) < 0.2) low++;
  assert.ok(Math.abs(low / 4000 - 0.2) < 0.03);
});

test("no second ever holds more than three flashes, even forced and crowded", () => {
  assert.ok(busiestSecond(peaksOf(createLightningSchedule(LIGHTNING).until(3600))) <= 3);
  const crowded = {
    ...LIGHTNING,
    interval: [0.2, 0.4],
    pulses: [3, 6],
    gap: [0.05, 0.06],
    forceAt: [5, 5.2, 5.4, { at: 5.6, pulses: 9 }, 7, { at: 7.1, shot: "Portrait" }],
  };
  const schedule = createLightningSchedule(crowded);
  const events = schedule.until(120);
  for (const event of events) assert.ok(event.peaks.length <= 3);
  assert.ok(busiestSecond(peaksOf(events)) <= 3);
  // Random events keep clear of the forced ones.
  for (const event of events.filter((e) => !e.forced))
    for (const forced of schedule.forced)
      assert.ok(event.start >= forced.end + 2 || event.end <= forced.start - 2);
});

test("a pulse rises over its attack and falls to exactly nothing", () => {
  assert.equal(lightningPulse(-0.03, 0.025, 0.1), 0);
  assert.equal(lightningPulse(0, 0.025, 0.1), 1);
  assert.ok(lightningPulse(-0.0125, 0.025, 0.1) < 0.3);
  assert.ok(Math.abs(lightningPulse(0.1, 0.025, 0.1) - Math.exp(-1)) < 1e-12);
  assert.equal(lightningPulse(0.61, 0.025, 0.1), 0);
  // A forced event's first pulse peaks exactly at its time, with full light.
  const schedule = createLightningSchedule({ ...LIGHTNING, forceAt: [{ at: 24, pulses: 2 }] });
  const event = schedule.at(24);
  assert.equal(event.peaks[0].t, 24);
  assert.equal(lightningLevel(event, 24), 1);
  assert.equal(schedule.at(24, "Portrait"), event, "an event with no shot shows in any");
  const only = createLightningSchedule({ ...LIGHTNING, forceAt: [{ at: 24, shot: "Threshold" }] });
  assert.equal(only.at(24, "Portrait"), null);
  assert.equal(only.at(24, "Threshold").forced.shot, "Threshold");
});

test("a flash keeps exactly off The watch's reference banks, its crop's span", () => {
  // The crop spans azimuths 122-174 from radius 1.13 out (estate-sky.js);
  // FLASH_REFERENCE zeroes at least that, inside the reshaping's own wedge.
  assert.ok(FLASH_REFERENCE.wedge[1] <= 122 && FLASH_REFERENCE.wedge[2] >= 174);
  assert.ok(FLASH_REFERENCE.radius[1] <= 1.13);
  assert.ok(FLASH_REFERENCE.wedge[0] >= CLOUD_RESHAPE.wedge[0]);
  assert.ok(FLASH_REFERENCE.wedge[3] <= CLOUD_RESHAPE.wedge[3]);
  for (let az = 122.5; az <= 173.5; az += 1.5)
    for (const alt of [-2, 0, 3, 8, 15, 25, 33])
      assert.equal(referenceKeep(skyDirection(az, alt)), 0, `az ${az} alt ${alt}`);
  for (const az of [0, 60, 100, 200, 300])
    for (const alt of [2, 10, 30]) assert.equal(referenceKeep(skyDirection(az, alt)), 1);
  assert.ok(referenceKeep(skyDirection(150, 70)) === 1, "the zenith beyond the crop is free");
});

test("a bolt's path is seeded, jagged, branching and reaches below the crest", () => {
  const a = boltPath(LIGHTNING, 0.42, 30, 12);
  assert.deepEqual(boltPath(LIGHTNING, 0.42, 30, 12), a);
  assert.notDeepEqual(boltPath(LIGHTNING, 0.43, 30, 12), a);
  const main = a.filter((s) => s.width === 1);
  assert.equal(main.length, 2 ** LIGHTNING.bolt.detail);
  assert.deepEqual(main[0].a, [30, 12]);
  assert.equal(main.at(-1).b[1], LIGHTNING.bolt.bottom);
  assert.equal(main.at(-1).sb, 1);
  assert.ok(Math.abs(main.at(-1).b[0] - 30) <= LIGHTNING.bolt.lean * 1.31);
  const branches = a.filter((s) => s.width < 1);
  assert.ok(branches.length > 0 && a.length <= 192);
  for (const s of a) {
    assert.ok(s.sa <= s.sb && s.sa >= 0, "it grows down from the cloud");
    assert.ok(s.ga >= 0 && s.ga <= 1 && s.gb >= 0 && s.gb <= 1);
  }
  assert.ok(
    main.some((s, i) => i && Math.abs(s.a[0] - 30) > 0.05),
    "never a straight line",
  );
});

// A camera at the origin, so view rays and the shell's directions agree.
function lookToward(az, alt = 4) {
  const camera = new PerspectiveCamera(40, 16 / 9, 0.1, 450);
  camera.position.set(0, 0, 0);
  camera.lookAt(skyDirection(az, alt).multiplyScalar(100));
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
  return camera;
}
function skyUniforms() {
  return {
    uFlash: { value: new Vector4(0, 1, 0, 0) },
    uFlashGlow: { value: new Vector4() },
    uFlashTone: { value: new Vector4() },
    uFlashCore: { value: 0 },
  };
}
function lightningRig({ az = 20, forceAt = [], shot = "Portrait", tier = "high", ...rest } = {}) {
  const calls = [];
  const sky = skyUniforms();
  const parent = new Group();
  const state = { shot, film: true };
  const lightning = createLightning({
    parent,
    camera: lookToward(az),
    rendering: { setFlash: (flash) => calls.push(flash) },
    sky,
    film: () => state.film,
    shot: () => state.shot,
    profile: { tier },
    config: { ...LIGHTNING, forceAt, ...rest },
  });
  lightning.resize({ width: 1600, height: 900 });
  const step = (seconds, options = {}) => {
    for (let i = 0; i < Math.round(seconds * 60); i++)
      lightning.update({ deltaSeconds: 1 / 60, ...options });
  };
  return { lightning, sky, calls, state, step, bolt: parent.children[0] };
}

test("a flash lights the banks, the lights, the rim and the ground, then leaves them whole", () => {
  setRim(1, 0);
  const rig = lightningRig({ forceAt: [{ at: 2, u: 0.7, v: 0.6, bolt: true, strength: 1 }] });
  rig.step(1.9);
  assert.equal(rig.sky.uFlash.value.w, 0, "nothing before the event");
  assert.equal(rig.calls.length, 0);
  rig.step(0.1);
  assert.ok(Math.abs(rig.lightning.state.time - 2) < 1e-9);
  assert.ok(rig.sky.uFlash.value.w > 0.99, "the peak");
  assert.ok(Math.abs(new Vector3(...rig.sky.uFlash.value).length() - 1) < 1e-6);
  assert.equal(rig.sky.uFlashGlow.value.y, LIGHTNING.sky.gain);
  assert.equal(rig.sky.uFlashCore.value, LIGHTNING.sky.core);
  const lit = rig.calls.at(-1);
  assert.ok(Math.abs(lit.fill - LIGHTNING.relight.fill) < 0.01);
  assert.ok(lit.aim < 0.01, "a flash in view leaves the fill where it is");
  assert.ok(FLASH_GROUND.babelFlash.value.x > 0 && FLASH_GROUND.babelFlash.value.y > 0);
  const rim = RIM_UNIFORMS.babelRimLight.value;
  assert.ok(rim.z > 0.36 + LIGHTNING.relight.rim * 0.9, "the moon rim takes the flash's light");
  assert.ok(
    RIM_UNIFORMS.babelRimText.value > 0.5,
    "and the bark's text guard takes it off the text",
  );
  assert.equal(rig.lightning.state.event.bolt, true);
  assert.equal(rig.bolt.visible, true);
  assert.ok(rig.bolt.geometry.drawRange.count > 0);
  assert.ok(rig.bolt.material.uniforms.uLevel.value > 1);
  rig.step(1.5);
  assert.equal(rig.sky.uFlash.value.w, 0, "gone after the event");
  assert.equal(rig.calls.at(-1), null, "the lights are given back");
  assert.equal(FLASH_GROUND.babelFlash.value.x, 0);
  assert.equal(FLASH_GROUND.babelFlash.value.y, 0);
  assert.equal(rig.bolt.visible, false);
  rig.lightning.dispose();
  setRim(0, 0);
});

test("lightning holds with the scene and never flashes under reduced motion", () => {
  const rig = lightningRig({ forceAt: [{ at: 1, u: 0.7, v: 0.6, strength: 1 }] });
  rig.step(0.5);
  rig.step(5, { motionPaused: true });
  assert.ok(Math.abs(rig.lightning.state.time - 0.5) < 1e-9, "a pause or a dialog holds its clock");
  rig.step(0.5);
  const lit = rig.sky.uFlash.value.w;
  assert.ok(lit > 0.99);
  rig.step(3, { motionPaused: true });
  assert.equal(rig.sky.uFlash.value.w, lit, "a held flash holds still");
  rig.step(3, { reducedMotion: true });
  assert.equal(rig.sky.uFlash.value.w, 0, "reduced motion: no flash");
  assert.ok(Math.abs(rig.lightning.state.time - 1) < 1e-9, "and no clock");
  const off = lightningRig({ forceAt: [{ at: 1, u: 0.7, v: 0.6 }] });
  off.state.film = false;
  off.step(1);
  assert.equal(off.sky.uFlash.value.w, 0, "only in film");
  assert.equal(off.calls.length, 0);
});

test("a cut ends a flash, whose place belonged to the shot before", () => {
  const rig = lightningRig({ forceAt: [{ at: 1, u: 0.7, v: 0.6, strength: 1 }] });
  rig.step(1);
  assert.ok(rig.sky.uFlash.value.w > 0.99);
  rig.state.shot = "Threshold";
  rig.step(1 / 60);
  assert.equal(rig.sky.uFlash.value.w, 0);
  assert.equal(rig.calls.at(-1), null);
});

test("no flash centres on the reference banks and no bolt reaches them", () => {
  // Facing the crop's azimuths, the schedule's flashes find the sky beside them.
  for (const az of [130, 150, 170, 180]) {
    const rig = lightningRig({ az, first: 0.5, interval: [1.2, 1.6], bolt: { chance: 0.5 } });
    let lit = 0;
    for (let i = 0; i < 60 * 60; i++) {
      rig.lightning.update({ deltaSeconds: 1 / 60 });
      const { level, event } = rig.lightning.state;
      if (!(level > 0)) continue;
      lit++;
      assert.ok(referenceKeep(skyDirection(event.azimuth, event.altitude)) >= 0.98);
      if (!rig.bolt.visible) continue;
      const position = rig.bolt.geometry.attributes.position;
      for (let v = 0; v < (rig.bolt.geometry.drawRange.count / 6) * 4; v++)
        assert.ok(
          referenceKeep(new Vector3().fromBufferAttribute(position, v)) > 0,
          `bolt vertex ${v} facing ${az}`,
        );
    }
    assert.ok(lit > 0, `some flash shows facing ${az}`);
    rig.lightning.dispose();
  }
});

test("balanced draws no bolt, even a forced one", () => {
  const rig = lightningRig({ tier: "balanced", forceAt: [{ at: 1, u: 0.7, v: 0.6, bolt: true }] });
  rig.step(1);
  assert.ok(rig.sky.uFlash.value.w > 0);
  assert.equal(rig.lightning.state.event.bolt, false);
  assert.equal(rig.bolt.visible, false);
});

function filmRendering() {
  const renderer = {
    capabilities: { getMaxAnisotropy: () => 8 },
    domElement: {},
    shadowMap: {},
    getContext: () => ({ isContextLost: () => false }),
    getPixelRatio: () => 1,
    setClearColor() {},
    setPixelRatio() {},
    setSize() {},
  };
  const pipeline = {
    composer: { addPass() {}, render() {}, setPixelRatio() {}, setSize() {} },
    resize() {},
    setQualityProfile() {},
  };
  const profile = {
    lighting: {
      ambientIntensity: 0.22,
      directionalIntensity: 2.9,
      extraDirectional: true,
      fillIntensity: 0.31,
      fogFar: 150,
      fogNear: 62,
      hemisphereIntensity: 0.71,
    },
    shadows: { enabled: true, mapSize: 1024 },
  };
  const rendering = createSceneRendering({
    container: { appendChild() {} },
    createPipeline: () => pipeline,
    createRenderer: () => renderer,
    disposeResources: () => ({}),
    height: 600,
    lighting: {
      ambientColor: 0xffffff,
      ambientIntensity: 0.22,
      directionalColor: 0xffffff,
      directionalIntensity: 2.9,
      directionalPosition: { x: 32, y: 28, z: 14 },
      fillColor: 0x7486b5,
      fogColor: 0x222222,
      fogFar: 150,
      fogNear: 62,
      hemisphereGroundColor: 0x111111,
      hemisphereIntensity: 0.71,
      hemisphereSkyColor: 0x596d96,
    },
    profile,
    width: 800,
    world: {
      CAMERA_FAR: 210,
      CAMERA_FOV: 48,
      CAMERA_NEAR: 0.5,
      FILL_LIGHT_POSITION: [-30, 22, -28],
      SHADOW_CAMERA_FAR: 120,
      SHADOW_CAMERA_HALF_EXTENT: 34,
      SHADOW_CAMERA_NEAR: 0.5,
    },
  });
  rendering.applyQuality(profile);
  rendering.setFilmTreatment(true);
  return rendering;
}

test("setFlash rides the existing lights as uniforms and gives every one back exactly", () => {
  const rendering = filmRendering();
  const { fill, sun, hemisphere, ambient } = rendering.lights;
  const before = {
    fill: [fill.position.clone(), fill.color.getHex(), fill.intensity],
    sun: [sun.position.clone(), sun.color.getHex(), sun.intensity],
    hemisphere: [hemisphere.color.getHex(), hemisphere.intensity],
    ambient: ambient.intensity,
  };
  assert.equal(fill.intensity, 0.31 * FILM_LIGHT.fill);
  assert.equal(fill.castShadow, false, "the fill has no shadow map to redraw");
  sun.shadow.needsUpdate = false;
  const flash = {
    fill: 1,
    direction: [1, 0.2, 0],
    color: [0.74, 0.83, 1],
    hemisphere: 0.2,
    ambient: 0.1,
  };
  rendering.setFlash(flash);
  const share = 1 / (before.fill[2] + 1);
  assert.ok(Math.abs(fill.intensity - (before.fill[2] + 1)) < 1e-9);
  const expected = before.fill[0]
    .clone()
    .normalize()
    .lerp(new Vector3(1, 0.2, 0).normalize(), share);
  assert.ok(fill.position.clone().normalize().distanceTo(expected.normalize()) < 1e-9, "it turns");
  assert.ok(Math.abs(fill.position.length() - before.fill[0].length()) < 1e-9);
  assert.ok(Math.abs(FLASH_GROUND.babelFlash.value.z - share) < 1e-9);
  assert.ok(FLASH_GROUND.babelFillAim.value.distanceTo(fill.position.clone().normalize()) < 1e-9);
  assert.ok(fill.color.b > fill.color.r, "cold");
  assert.ok(Math.abs(hemisphere.intensity - before.hemisphere[1] * 1.2) < 1e-9);
  assert.ok(Math.abs(ambient.intensity - before.ambient * 1.1) < 1e-9);
  assert.ok(sun.position.equals(before.sun[0]), "the key never moves");
  assert.equal(sun.intensity, before.sun[2]);
  assert.equal(sun.shadow.needsUpdate, false, "and its shadow map keeps its frame");
  rendering.setFlash({ ...flash, aim: 0 });
  assert.ok(fill.position.equals(before.fill[0]), "a flash in view leaves the fill's aim");
  assert.ok(fill.intensity > before.fill[2]);
  rendering.setFlash(null);
  assert.ok(fill.position.equals(before.fill[0]));
  assert.equal(fill.color.getHex(), before.fill[1]);
  assert.equal(fill.intensity, before.fill[2]);
  assert.equal(hemisphere.color.getHex(), before.hemisphere[0]);
  assert.equal(hemisphere.intensity, before.hemisphere[1]);
  assert.equal(ambient.intensity, before.ambient);
  assert.equal(FLASH_GROUND.babelFlash.value.z, 0);
  assert.equal(rendering.setFlash(null), false, "no flash, no work");
  // A mood change mid-flash keeps the flash over the new balance.
  rendering.setFlash(flash);
  rendering.setShotLight({ key: 1, fill: 2 });
  assert.ok(Math.abs(fill.intensity - (before.fill[2] * 2 + 1)) < 1e-9);
  rendering.setFlash(null);
  rendering.setFilmTreatment(false);
  rendering.setFlash(flash);
  assert.ok(fill.position.equals(before.fill[0]), "outside the film a flash changes nothing");
  rendering.setFlash(null);
  rendering.dispose();
  FLASH_GROUND.babelFillAim.value.set(-30, 22, -28).normalize();
});

test("the sky draws the flash in the banks, off the crop and the text, never in the environment", () => {
  const sky = flat(source("src/scene/estate-sky.js"));
  assert.ok(sky.includes("if(uFlash.w>0.){"), "the shell's glow costs nothing between flashes");
  const [w0, w1, w2, w3] = FLASH_REFERENCE.wedge.map((v) => v.toFixed(1));
  assert.ok(sky.includes("const { wedge: flashWedge, radius: flashRadius } = FLASH_REFERENCE;"));
  assert.ok(
    sky.includes(
      "(1.-smoothstep(${glslFloat(flashWedge[0])},${glslFloat(flashWedge[1])},cloudAz)*(1.-smoothstep(${glslFloat(flashWedge[2])},${glslFloat(flashWedge[3])},cloudAz))*smoothstep(${glslFloat(flashRadius[0])},${glslFloat(flashRadius[1])},bl))",
    ),
  );
  assert.ok(sky.includes("*(1.-max(cloudText,1.-smoothstep(0.,uFlashTone.w,length(fa))))"));
  assert.ok([w0, w1, w2, w3].every((v) => Number.isFinite(Number(v))));
  const environment = flat(source("src/scene/night-environment.js"));
  assert.ok(environment.includes("uFlash: { value: new Vector4(0, 1, 0, 0) }"));
  const ground = flat(source("src/scene/mud-ground.js"));
  assert.ok(ground.includes("normalize(mat3(viewMatrix)*babelFillAim)) > .9999"));
  assert.ok(ground.includes("Object.assign(shader.uniforms, uniforms, FLASH_GROUND);"));
  assert.ok(
    ground.includes("1.0-babelFlash.z*slateBehindText()"),
    "the fill's flash eases off the text",
  );
  assert.ok(ground.includes("babelFlash.x+babelFlash.y > 0.0 ? 1.0-slateBehindText() : 0.0"));
  const puddles = flat(source("src/scene/terrain-build.js"));
  assert.ok(puddles.includes("1.0+babelFlash.y*(1.0-slateBehindText())"));
});

test("index.js wires the lightning in film, by shot, before the first warm-up", () => {
  const index = flat(source("src/scene/index.js"));
  const registered = index.indexOf("subsystemRegistry.register(lightning);");
  assert.ok(registered > index.indexOf("subsystemRegistry.register(starfield);"));
  assert.ok(registered < index.indexOf('warmShaders("scene");'), "its bolt links in the warm-up");
  assert.ok(index.includes("film: () => filmActive,"));
  assert.ok(index.includes("shot: () => cinematic.shot?.name ?? null,"));
  assert.ok(index.includes("sky: skyShell.material.uniforms,"));
  assert.ok(index.includes("textGuard: groundContacts,"));
  assert.ok(index.includes("if (qualityDebug) qualityDebug.lightning = lightning.state;"));
});
