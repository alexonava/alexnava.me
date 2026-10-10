// The film storm's lightning (src/scene/lightning.js): its seeded schedule and
// the flash limit, the reference banks it keeps off, the bolt's path, the
// subsystem's flash on the sky, the film's materials, the ground and the
// mist (never the scene's lights or the moon rim) and its holds, the flash's
// guarded term (film-light.js flashHook()), and the shaders and wiring that
// carry it.

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
import {
  FLASH_GROUND,
  FLASH_UNIFORMS,
  RIM_UNIFORMS,
  flashHook,
  lendFlashText,
  setRim,
} from "../src/scene/film-light.js";
import { MIST_UNIFORMS } from "../src/scene/drifting-mist.js";
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
    LIGHTNING.interval[0] >= 3 && LIGHTNING.interval[1] <= 15,
    "an event every 4-12 s (the owner asked for more, 2026-10-09)",
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
function lightningRig({
  az = 20,
  forceAt = [],
  shot = "Portrait",
  tier = "high",
  textGuard = null,
  ...rest
} = {}) {
  const sky = skyUniforms();
  const parent = new Group();
  const state = { shot, film: true };
  const grey = { r: 1, g: 1, b: 1 };
  const lights = {
    hemisphere: { intensity: 0.5, color: grey },
    ambient: { intensity: 0.1, color: grey },
    fill: { position: new Vector3(-30, 22, -28) },
  };
  const lightning = createLightning({
    parent,
    camera: lookToward(az),
    rendering: { lights },
    textGuard,
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
  return { lightning, sky, state, step, bolt: parent.children[0] };
}

test("a flash lights the banks, the film's materials, the ground and the mist, then nothing", () => {
  setRim(1, 0);
  const moonRim = RIM_UNIFORMS.babelRimLight.value.clone(),
    moonKey = RIM_UNIFORMS.babelKeyView.value.clone();
  const L = FLASH_UNIFORMS.babelFlashLight.value;
  const rig = lightningRig({ forceAt: [{ at: 2, u: 0.7, v: 0.6, bolt: true, strength: 1 }] });
  rig.step(1.9);
  assert.equal(rig.sky.uFlash.value.w, 0, "nothing before the event");
  assert.equal(L.w, 0);
  rig.step(0.1);
  assert.ok(Math.abs(rig.lightning.state.time - 2) < 1e-9);
  assert.ok(rig.sky.uFlash.value.w > 0.99, "the peak");
  assert.ok(Math.abs(new Vector3(...rig.sky.uFlash.value).length() - 1) < 1e-6);
  assert.equal(rig.sky.uFlashGlow.value.y, LIGHTNING.sky.gain);
  assert.equal(rig.sky.uFlashCore.value, LIGHTNING.sky.core);
  // The flash's light on the film's materials: from the cool fill's side for a
  // flash in view, its sky a share of the hemisphere's, the cold rim, the text guard.
  const { relight } = LIGHTNING;
  assert.ok(L.w > 0.99);
  assert.ok(Math.abs(L.z - relight.color[2] * relight.fill * L.w) < 1e-9);
  const key = FLASH_UNIFORMS.babelFlashKey.value;
  assert.ok(
    key.distanceTo(new Vector3(-30, 22, -28).normalize()) < 1e-6,
    "in view: the fill's side",
  );
  const lift = FLASH_UNIFORMS.babelFlashSky.value;
  assert.ok(Math.abs(lift.z - relight.color[2] * relight.hemisphere * 0.5 * L.w) < 1e-9);
  assert.ok(Math.abs(lift.w - relight.ambient * 0.1 * L.w) < 1e-9);
  assert.ok(
    Math.abs(FLASH_UNIFORMS.babelFlashRim.value.z - relight.rimColor[2] * relight.rim * L.w) < 1e-9,
  );
  assert.deepEqual(FLASH_UNIFORMS.babelFlashReach.value.toArray(), [...relight.text]);
  assert.ok(FLASH_GROUND.babelFlash.value.x > 0 && FLASH_GROUND.babelFlash.value.y > 0);
  assert.ok(MIST_UNIFORMS.mistFlash.value.z > 0 && MIST_UNIFORMS.mistFlash.value.w > 0.99);
  // The scene's lights and the moon rim are never touched.
  assert.ok(RIM_UNIFORMS.babelRimLight.value.equals(moonRim));
  assert.ok(RIM_UNIFORMS.babelKeyView.value.equals(moonKey));
  assert.equal(rig.lightning.state.event.bolt, true);
  assert.equal(rig.bolt.visible, true);
  assert.ok(rig.bolt.geometry.drawRange.count > 0);
  assert.ok(rig.bolt.material.uniforms.uLevel.value > 1);
  rig.step(1.5);
  assert.equal(rig.sky.uFlash.value.w, 0, "gone after the event");
  assert.equal(L.w, 0);
  assert.deepEqual(L.toArray(), [0, 0, 0, 0]);
  assert.deepEqual(FLASH_UNIFORMS.babelFlashSky.value.toArray(), [0, 0, 0, 0]);
  assert.equal(FLASH_UNIFORMS.babelFlashRim.value.z, 0);
  assert.equal(FLASH_GROUND.babelFlash.value.x, 0);
  assert.equal(FLASH_GROUND.babelFlash.value.y, 0);
  assert.deepEqual({ ...MIST_UNIFORMS.mistFlash.value }, { x: 0, y: 0, z: 0, w: 0 });
  assert.equal(rig.bolt.visible, false);
  rig.lightning.dispose();
  setRim(0, 0);
});

test("a flash beside the frame lights the subjects from its side", () => {
  const rig = lightningRig({ forceAt: [{ at: 1, u: 2.4, v: 0.6, strength: 1 }] });
  rig.step(1);
  const key = FLASH_UNIFORMS.babelFlashKey.value,
    flash = new Vector3(...rig.sky.uFlash.value).normalize(),
    fill = new Vector3(-30, 22, -28).normalize();
  assert.ok(
    key.distanceTo(flash) < 0.3 * fill.distanceTo(flash),
    "the light comes from the flash's side, not the fill's",
  );
  rig.lightning.dispose();
});

test("a bolt's leader grows down before its first stroke", () => {
  const { leader } = LIGHTNING.bolt;
  const rig = lightningRig({ forceAt: [{ at: 1, u: 0.7, v: 0.6, bolt: true, strength: 1 }] });
  rig.step(58 / 60);
  assert.ok(
    rig.lightning.state.time >= 1 - leader && rig.lightning.state.time < 1 - LIGHTNING.attack,
  );
  assert.equal(rig.lightning.state.level, 0, "before the stroke's own rise");
  assert.equal(rig.bolt.visible, true, "the leader draws");
  const u = rig.bolt.material.uniforms;
  assert.ok(u.uGrow.value > 0 && u.uGrow.value < 0.6);
  assert.ok(u.uLevel.value > 0 && u.uLevel.value < LIGHTNING.bolt.brightness);
  assert.equal(rig.sky.uFlash.value.w, 0, "no flash until the stroke");
  assert.equal(FLASH_UNIFORMS.babelFlashLight.value.w, 0);
  rig.lightning.dispose();
});

test("disposing mid-flash leaves no flash behind", () => {
  const rig = lightningRig({ forceAt: [{ at: 1, u: 0.7, v: 0.6, strength: 1 }] });
  rig.step(1);
  assert.ok(FLASH_UNIFORMS.babelFlashLight.value.w > 0.99);
  rig.lightning.dispose();
  assert.equal(rig.sky.uFlash.value.w, 0);
  assert.equal(FLASH_UNIFORMS.babelFlashLight.value.w, 0);
  assert.equal(MIST_UNIFORMS.mistFlash.value.w, 0);
  assert.equal(FLASH_GROUND.babelFlash.value.x, 0);
  assert.equal(rig.bolt.parent, null);
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
  assert.equal(FLASH_UNIFORMS.babelFlashLight.value.w, 0);
});

test("a cut ends a flash, whose place belonged to the shot before", () => {
  const rig = lightningRig({ forceAt: [{ at: 1, u: 0.7, v: 0.6, strength: 1 }] });
  rig.step(1);
  assert.ok(rig.sky.uFlash.value.w > 0.99);
  rig.state.shot = "Threshold";
  rig.step(1 / 60);
  assert.equal(rig.sky.uFlash.value.w, 0);
  assert.equal(FLASH_UNIFORMS.babelFlashLight.value.w, 0);
  assert.equal(rig.lightning.state.event, null, "no stale event");
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

test("a tall bolt keeps its size where it fits and falls back to shorter ones before going without", () => {
  // The owner's tall bolts, facing the reference banks' edge, where many don't fit.
  const big = { ...LIGHTNING.bolt, chance: 1, top: [26, 40], lean: 7, branches: [5, 9] };
  const run = (fallback) => {
    const rig = lightningRig({
      az: 185,
      first: 0.5,
      interval: [1.2, 1.6],
      bolt: { ...big, fallback },
    });
    const seen = new Map();
    for (let i = 0; i < 60 * 150; i++) {
      rig.lightning.update({ deltaSeconds: 1 / 60 });
      const { level, event } = rig.lightning.state;
      if (level > 0 && event?.wanted && !seen.has(event.start)) seen.set(event.start, event.bolt);
    }
    rig.lightning.dispose();
    return [...seen.values()];
  };
  const none = run([]),
    some = run([0.6, 0.3]);
  assert.ok(none.length > 40 && some.length === none.length);
  const placed = (list) => list.filter(Boolean).length;
  assert.ok(placed(some) >= placed(none), `${placed(some)} >= ${placed(none)}`);
  assert.ok(placed(some) > 0);
});

test("a bolt keeps its gap from the name, the intro and About", () => {
  // The name and intro across the frame's left half, About low left, on a 16:9 canvas.
  const textGuard = {
    slateText: { value: { x: 0.12, y: 0.3, z: 0.48, w: 0.62 } },
    slateAbout: { value: { x: 0.01, y: 0.02, z: 0.05, w: 0.05 } },
    slateAspect: { value: 16 / 9 },
  };
  const big = { ...LIGHTNING.bolt, chance: 1, top: [26, 40], lean: 7, branches: [5, 9] };
  const rig = lightningRig({ textGuard, first: 0.5, interval: [1.2, 1.6], bolt: big });
  const camera = lookToward(20);
  const box = textGuard.slateText.value,
    gap = LIGHTNING.bolt.textGap;
  let drawn = 0;
  for (let i = 0; i < 60 * 90; i++) {
    rig.lightning.update({ deltaSeconds: 1 / 60 });
    if (!rig.bolt.visible || !(rig.lightning.state.level > 0)) continue;
    drawn++;
    const position = rig.bolt.geometry.attributes.position;
    for (let v = 0; v < (rig.bolt.geometry.drawRange.count / 6) * 4; v++) {
      const p = new Vector3().fromBufferAttribute(position, v).multiplyScalar(100).project(camera);
      const [u, w] = [(p.x + 1) / 2, (p.y + 1) / 2];
      const dx = Math.max(box.x - u, u - box.z, 0) * (16 / 9),
        dy = Math.max(box.y - w, w - box.w, 0);
      assert.ok(
        Math.hypot(dx, dy) >= gap - 1e-9,
        `vertex ${v} is ${Math.hypot(dx, dy)} from the text`,
      );
    }
  }
  assert.ok(drawn > 0);
  rig.lightning.dispose();
});

test("balanced draws no bolt, even a forced one", () => {
  const rig = lightningRig({ tier: "balanced", forceAt: [{ at: 1, u: 0.7, v: 0.6, bolt: true }] });
  rig.step(1);
  assert.ok(rig.sky.uFlash.value.w > 0);
  assert.equal(rig.lightning.state.event.bolt, false);
  assert.equal(rig.bolt.visible, false);
});

// A fragment shader with the chunks the hook anchors on.
const FRAGMENT =
  "#include <common>\nvoid main(){\n#include <lights_fragment_end>\n#include <aomap_fragment>\n#include <fog_fragment>\n}";

test("flashHook adds the flash after a material's lights, composed and keyed, guarded by the text", () => {
  const calls = [];
  const material = {
    userData: {},
    onBeforeCompile(shader) {
      calls.push("own");
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <lights_fragment_end>",
        "#include <lights_fragment_end>\nOWN_RIM;",
      );
    },
    customProgramCacheKey: () => "tower-v9",
  };
  assert.equal(flashHook(material, { rim: true, sky: "babelEnvironment.x" }), material);
  assert.equal(flashHook(material), material, "once");
  assert.equal(material.customProgramCacheKey(), "tower-v9|flash-rim");
  const shader = { uniforms: {}, fragmentShader: FRAGMENT };
  material.onBeforeCompile(shader);
  assert.deepEqual(calls, ["own"], "its own hook first");
  for (const name of Object.keys(FLASH_UNIFORMS))
    assert.equal(shader.uniforms[name], FLASH_UNIFORMS[name], `${name} is lent, not copied`);
  const glsl = flat(shader.fragmentShader);
  assert.ok(glsl.includes("float babelFlashKeep(vec3 viewPosition)"));
  assert.ok(glsl.includes("return (1.-b)*(1.-b);"), "none of the flash behind the text");
  assert.ok(glsl.includes("if (babelFlashLight.w > 0.0) {"), "a uniform test between flashes");
  assert.ok(glsl.includes("float babelFK = babelFlashKeep(-vViewPosition);"));
  assert.ok(glsl.includes("*(babelEnvironment.x))*material.diffuseColor;"), "the role's sky share");
  assert.ok(glsl.includes("reflectedLight.directDiffuse += babelFK*babelFlashRim.rgb*pow("));
  assert.ok(glsl.indexOf("OWN_RIM;") < glsl.indexOf("babelFK*"), "after the lights' own terms");
  assert.ok(glsl.indexOf("babelFK*") < glsl.indexOf("#include <aomap_fragment>"), "before the sum");
  const plain = { userData: {}, onBeforeCompile() {}, customProgramCacheKey: () => "grass" };
  flashHook(plain);
  const plainShader = { uniforms: {}, fragmentShader: FRAGMENT };
  plain.onBeforeCompile(plainShader);
  assert.ok(!plainShader.fragmentShader.includes("babelFlashRim.rgb*pow"), "no rim unless asked");
  assert.ok(plainShader.fragmentShader.includes("*(1.0))*material.diffuseColor;"));
  assert.equal(plain.customProgramCacheKey(), "grass|flash");
  // The ground's text boxes guard it, lent by the lightning.
  const contacts = {
    slateText: { value: {} },
    slateAbout: { value: {} },
    slateAspect: { value: 1.7 },
  };
  const before = { ...FLASH_UNIFORMS };
  lendFlashText(contacts);
  assert.equal(FLASH_UNIFORMS.babelFlashText, contacts.slateText);
  assert.equal(FLASH_UNIFORMS.babelFlashAbout, contacts.slateAbout);
  assert.equal(FLASH_UNIFORMS.babelFlashAspect, contacts.slateAspect);
  Object.assign(FLASH_UNIFORMS, before);
});

test("every lit film material takes the flash, and none of the scene's lights moves for it", () => {
  const architecture = flat(source("src/scene/architecture.js"));
  assert.ok(
    architecture.includes(
      'flashHook(material, { rim: rimmed, sky: "babelEnvironment.x" }); return mistHook(material);',
    ),
    "the lookout, the tree and the rocks",
  );
  assert.equal(architecture.match(/flashHook\(\s*mistHook\(new MeshStandardMaterial/g)?.length, 2);
  assert.ok(
    flat(source("src/scene/estate-ground-detail.js")).includes(
      "flashHook(material); return stampDepthLayer(mistHook(material), DEPTH_LAYER.ground);",
    ),
    "the growth, litter and rushes",
  );
  assert.ok(flat(source("src/scene/lantern.js")).includes("material = flashHook(source.clone());"));
  assert.ok(!flat(source("src/scene/rendering.js")).includes("setFlash"));
  assert.ok(!flat(source("src/scene/lightning.js")).includes("RIM_UNIFORMS"));
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
  assert.ok(!ground.includes("babelFillAim"), "the slate's fill keeps its fixed direction");
  assert.ok(
    ground.includes("Object.assign(shader.uniforms, uniforms, FLASH_GROUND, FLASH_UNIFORMS);"),
  );
  assert.ok(ground.includes("if (babelFlashLight.w > 0.0)"));
  assert.ok(
    ground.includes("reflectedLight.directDiffuse += (1.0-slateBehind)*(1.0-slateBehind)*("),
    "the flash's light on the slate eases off the text",
  );
  const mist = flat(source("src/scene/drifting-mist.js"));
  assert.ok(mist.includes("if(mistFlash.w>0.){"), "the mist scatters the flash");
  assert.ok(
    mist.includes("glow+=mistFlash.xyz*flash*(1.-max(mistBox(mistText,fu,"),
    "off the text",
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
