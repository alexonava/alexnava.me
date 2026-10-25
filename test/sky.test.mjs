// The sky shell, its clouds and nebula, the stars and the sun.

import assert from "node:assert/strict";
import test from "node:test";
import {
  Group,
  PerspectiveCamera,
  Quaternion,
  Vector3,
  AdditiveBlending,
  BoxGeometry,
  Color,
  CustomBlending,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NoBlending,
  NormalBlending,
  OneFactor,
  OneMinusSrcAlphaFactor,
  ShaderMaterial,
  SrcAlphaFactor,
  ZeroFactor,
} from "three";
import {
  createSolarBody,
  createCelestialClock,
  SOLAR_GLOW_RADIUS,
  SOLAR_LOOK,
  SOLAR_RADIUS,
  solarUnrest,
} from "../src/scene/solar-body.js";
import { STAR_LAYER } from "../src/scene/depth-layers.js";
import {
  createStarfield,
  makeStarGeometry,
  STAR_COUNTS,
  STAR_MIN_FOOTPRINT,
  STAR_TEXT_REACH,
} from "../src/scene/starfield.js";
import { createSceneAtmosphere } from "../src/scene/atmosphere.js";
import {
  CLOUD_BRUSH,
  CLOUD_ISLANDS,
  CLOUD_RESHAPE,
  CLOUD_TEXT_GLSL,
  CLOUD_VORTEX,
  CLOUD_VORTEX_GLSL,
  cloudFieldGLSL,
  cloudVortexCenter,
  cloudVortexInSeason,
  cloudVortexPresent,
  cloudVortexReach,
  createEstateSkyMaterial,
  FILM_SKY_GLSL,
  SKY_GLOW,
} from "../src/scene/estate-sky.js";
import { celestialClusterDirection, NEBULA_FRAME } from "../src/scene/celestial-field.js";
import { createFilmScene } from "../src/scene/film-scene.js";
import { flat, source } from "./support/code.mjs";

test("solar clock freezes for reduced motion and resumes without a time jump", () => {
  const clock = createCelestialClock();
  assert.equal(clock.tick(3), 0);
  assert.equal(clock.tick(4), 1);
  assert.equal(clock.tick(6, true), 1);
  assert.equal(clock.tick(16, true), 1);
  assert.equal(clock.tick(20, false), 1);
  assert.equal(clock.tick(21), 2);
  assert.equal(clock.tick(19), 2);
  assert.equal(clock.tick(NaN), 2);
});

test("the star's two parts, its tiers and its resources survive repeated transitions", () => {
  const parent = new Group(),
    camera = new PerspectiveCamera();
  camera.position.set(0, 2, 20);
  camera.lookAt(0, 0, 0);
  const controller = createSolarBody({
    parent,
    camera,
    position: new Vector3(-85, 55, -29),
    profile: { tier: "high" },
  });
  const objects = [];
  controller.root.traverse((o) => {
    if (o.isMesh) objects.push(o);
  });
  const disc = objects.find((o) => o.name === "solar-disc"),
    glow = objects.find((o) => o.name === "solar-glow");
  // The painted disc and its glow: no photographic surface, loops or lens streak.
  assert.deepEqual(objects.map((o) => o.name).sort(), ["solar-disc", "solar-glow"]);
  assert.deepEqual(controller.root.position.toArray(), [-85, 55, -29]);
  assert.equal(disc.geometry.parameters.radius, SOLAR_RADIUS);
  assert.equal(disc.material.depthWrite, true);
  // The glow goes down first, so the disc's smoothed edge lays over it with no seam.
  assert.ok(glow.renderOrder < disc.renderOrder);
  assert.ok(objects.every((o) => o.material.depthTest && !o.castShadow));
  for (const tier of ["low", "high", "balanced", "low", "high"]) {
    assert.equal(controller.applyQuality({ tier }), true);
    assert.equal(controller.tier, tier);
  }
  const resources = objects.flatMap((o) => [o.geometry, o.material]),
    counts = resources.map(() => 0);
  resources.forEach((r, i) => r.addEventListener("dispose", () => counts[i]++));
  assert.equal(controller.dispose(), true);
  assert.equal(controller.dispose(), false);
  assert.equal(parent.children.length, 0);
  assert.deepEqual(
    objects.flatMap((o, i) => (counts[2 * i] === 1 && counts[2 * i + 1] === 1 ? [] : [o.name])),
    [],
    "each part's geometry and material is disposed once",
  );
  assert.equal(controller.applyQuality({ tier: "high" }), false);
  assert.equal(controller.update({ elapsedSeconds: 20 }), false);
});

test("the star is painted: a pale core warming to its limb in brushed bands, its glow carrying on from the limb", () => {
  assert.ok(Object.isFrozen(SOLAR_LOOK) && Object.isFrozen(SOLAR_LOOK.glow));
  const { core, mid, rim, bands, inner, outer, glow, tail, plane, hold } = SOLAR_LOOK;
  // Paler at the core and warmer out to the limb, every channel past red stepping down;
  // the glow warms as it goes.
  assert.ok(core[1] > mid[1] && mid[1] > rim[1] && core[2] > mid[2] && mid[2] > rim[2]);
  assert.ok(inner[1] > outer[1] && inner[2] > outer[2]);
  assert.ok(bands[0] < bands[1] && bands[1] + bands[2] < 1.0);
  // The glow starts near the limb's own light (no dark line where they meet) and its tail
  // is fainter and slower to fall.
  assert.ok(glow[0] >= 0.8 && tail[0] < glow[0] && tail[1] < glow[1]);
  // Its furthest reach is the one SOLAR_GLOW_RADIUS (the framing checks') mirrors, inside
  // the plane's own fade.
  assert.equal(SOLAR_GLOW_RADIUS, SOLAR_RADIUS * glow[2]);
  assert.ok(glow[2] < plane / 2 - 0.6);
  const parent = new Group(),
    controller = createSolarBody({
      parent,
      camera: new PerspectiveCamera(),
      position: new Vector3(0, 0, -60),
      profile: { tier: "high" },
    });
  const mesh = (name) => controller.root.getObjectByName(name),
    disc = mesh("solar-disc").material.fragmentShader,
    plate = mesh("solar-glow"),
    halo = plate.material.fragmentShader;
  assert.equal(plate.geometry.parameters.width, SOLAR_RADIUS * plane);
  const glsl = (v) => (Number.isInteger(v) ? v.toFixed(1) : String(v));
  // The disc: soft bands, their edges wobbling, bristles along the sky's brush.
  assert.ok(
    disc.includes(`smoothstep(${glsl(bands[0] - bands[2])},${glsl(bands[0] + bands[2])},rr)`),
  );
  assert.ok(disc.includes(`float rr=r+${glsl(SOLAR_LOOK.wobble)}*`));
  assert.ok(disc.includes(`vec2(${glsl(SOLAR_LOOK.dir[0])},${glsl(SOLAR_LOOK.dir[1])})`));
  // No photographic surface: no granules, spots or limb darkening.
  assert.doesNotMatch(disc, /cells\(|spot|umbra|limb=/);
  // The glow: brushed, its edge irregular (never a circle), its tail fainter.
  assert.ok(halo.includes(`vec2 p=(vUv-.5)*${glsl(plane)};`));
  assert.ok(halo.includes(`float reach=${glsl(glow[2])}*(.78+.22*noise3(`));
  assert.ok(halo.includes(`${glsl(glow[0])}*exp(-h*${glsl(glow[1])})`));
  assert.ok(halo.includes(`${glsl(tail[0])}*exp(-h*${glsl(tail[1])})`));
  assert.doesNotMatch(halo, /solarFire|outside/);
  // The mask is held whole over the whole glow, past its reach, so the clouds' cel step
  // never bands its tail (the owner's note of 2026-10-10), and ends inside the plane; the
  // hold marks the mask whole in the grade (STAR_LAYER x cover >= its 0.006 knee).
  assert.ok(
    halo.includes(
      `float hold=${glsl(hold.cover)}*(1.0-smoothstep(${glsl(glow[2])},${glsl(glow[2] + hold.feather)},r));`,
    ),
  );
  assert.ok(STAR_LAYER * hold.cover >= 0.006);
  assert.ok(glow[2] + hold.feather <= plane / 2 - 0.2);
  // A pause holds it with the rest of the sky.
  controller.update({ elapsedSeconds: 0 });
  controller.update({ elapsedSeconds: 4 });
  const time = plate.material.uniforms.uTime.value;
  controller.update({ elapsedSeconds: 6, motionPaused: true });
  assert.equal(plate.material.uniforms.uTime.value, time);
  controller.dispose();
});

test("the star's unrest is gentle, irregular and still under reduced motion", () => {
  const { breath, breathRate, lean } = SOLAR_LOOK;
  assert.deepEqual(solarUnrest(12.5), solarUnrest(12.5));
  let low = Infinity,
    high = -Infinity,
    jump = 0,
    previous = solarUnrest(0).breath;
  for (let t = 1 / 60; t < 600; t += 1 / 60) {
    const u = solarUnrest(t);
    low = Math.min(low, u.breath);
    high = Math.max(high, u.breath);
    jump = Math.max(jump, Math.abs(u.breath - previous));
    previous = u.breath;
    assert.ok(Math.hypot(...u.lean) <= lean + 1e-9);
  }
  // Within its bounds, using most of them, and never a frame-to-frame flicker.
  assert.ok(low >= 1 - breath - 1e-9 && high <= 1 + breath + 1e-9);
  assert.ok(high - low > breath);
  assert.ok(jump < breath * 0.05, `breath jumps ${jump} in a frame`);
  // Not a steady beat: one noise period on, it has moved on.
  const period = 1 / breathRate;
  assert.ok(
    [3, 7, 11, 19].some(
      (t) => Math.abs(solarUnrest(t).breath - solarUnrest(t + period).breath) > breath * 0.2,
    ),
  );
  // The controller drives the uniforms from the celestial clock, so reduced motion holds them.
  const controller = createSolarBody({
    parent: new Group(),
    camera: new PerspectiveCamera(),
    position: new Vector3(0, 0, -60),
    profile: { tier: "high" },
  });
  const uniforms = controller.root.getObjectByName("solar-glow").material.uniforms;
  controller.update({ elapsedSeconds: 0 });
  controller.update({ elapsedSeconds: 9 });
  assert.equal(uniforms.uBreath.value, solarUnrest(9).breath);
  assert.deepEqual(uniforms.uLean.value.toArray(), solarUnrest(9).lean);
  const held = uniforms.uBreath.value;
  controller.update({ elapsedSeconds: 15, reducedMotion: true });
  assert.equal(uniforms.uBreath.value, held);
  controller.dispose();
});

test("seeded stars preserve positions between tiers and remain distant while camera moves", () => {
  const a = makeStarGeometry(),
    b = makeStarGeometry(),
    c = makeStarGeometry(3);
  assert.deepEqual(a.attributes.position.array, b.attributes.position.array);
  assert.notDeepEqual(a.attributes.position.array, c.attributes.position.array);
  let faint = 0;
  for (let i = 0; i < a.attributes.aSize.count; i++) if (a.attributes.aSize.getX(i) < 1.8) faint++;
  assert.ok(faint > STAR_COUNTS.high * 0.75);
  const parent = new Group(),
    camera = new PerspectiveCamera();
  parent.position.y = -7;
  const controller = createStarfield({ parent, camera, profile: { tier: "high" } });
  camera.position.set(9, 15, 20);
  parent.updateMatrixWorld(true);
  controller.update({ elapsedSeconds: 0 });
  assert.ok(controller.root.getWorldPosition(new Vector3()).distanceTo(camera.position) < 1e-8);
  const positions = controller.root.geometry.attributes.position.array;
  controller.applyQuality({ tier: "low" }, { pixelRatio: 2 });
  assert.equal(controller.root.geometry.drawRange.count, STAR_COUNTS.low);
  assert.equal(controller.root.material.uniforms.uPixelRatio.value, 2);
  controller.applyQuality({ tier: "balanced" });
  assert.equal(controller.root.geometry.attributes.position.array, positions);
  assert.equal(controller.root.geometry.drawRange.count, STAR_COUNTS.balanced);
  assert.equal(controller.root.material.depthTest, true);
  assert.equal(controller.root.material.depthWrite, false);
  let disposed = 0;
  controller.root.material.addEventListener("dispose", () => disposed++);
  controller.dispose();
  controller.dispose();
  assert.equal(disposed, 1);
  assert.equal(parent.children.length, 0);
  [a, b, c].forEach((g) => g.dispose());
});

test("faint stars keep a two-pixel footprint and their light, so they hold still as the camera drifts", () => {
  assert.equal(STAR_MIN_FOOTPRINT, 2);
  const stars = createStarfield({ parent: new Group(), profile: { tier: "high" } }),
    shader = flat(stars.root.material.vertexShader);
  assert.ok(
    shader.includes(
      "float size=aSize*uPixelRatio, footprint=max(size,2.0); vColor*=size*size/(footprint*footprint); gl_PointSize=footprint; }",
    ),
    "the point size is set last, from the footprint",
  );
  // Evaluate the emitted terms: never under two device pixels, and the sprite's
  // light (colour times area) is the star's own at every size and pixel ratio.
  const [, footprintTerm] = shader.match(/footprint=([^;]+);/),
    [, gainTerm] = shader.match(/vColor\*=([^;]+);\s*gl_PointSize=footprint;/);
  const footprintOf = new Function("size", "max", `return ${footprintTerm}`),
    gainOf = new Function("size", "footprint", `return ${gainTerm}`);
  const sizes = makeStarGeometry().attributes.aSize;
  for (const pixelRatio of [0.5, 1, 1.25, 1.5, 2]) {
    for (let i = 0; i < sizes.count; i += 7) {
      const size = sizes.getX(i) * pixelRatio,
        footprint = footprintOf(size, Math.max),
        gain = gainOf(size, footprint);
      assert.ok(footprint >= 2 && footprint >= size);
      assert.ok(Math.abs(gain * footprint * footprint - size * size) < 1e-9);
      if (size >= 2) assert.equal(gain, 1, "stars already two pixels wide are unchanged");
    }
  }
  stars.dispose();
});

test("no star shows behind the name and intro; beside them stars ease back in", () => {
  assert.equal(STAR_TEXT_REACH, 0.04);
  const slateText = { value: { x: 0.1, y: 0.6, z: 0.5, w: 0.9 } },
    slateAspect = { value: 0.5 };
  const stars = createStarfield({
      parent: new Group(),
      profile: { tier: "high" },
      sky: { slateText, slateAspect },
    }),
    { uniforms, vertexShader } = stars.root.material;
  assert.equal(uniforms.slateText, slateText, "the sky's measured box, borrowed");
  assert.equal(uniforms.slateAspect, slateAspect);
  const shader = flat(vertexShader),
    guard = shader.indexOf("vColor*=smoothstep(0.,0.040,length(starOff));");
  // In every treatment (after the film's cloud cover closes), before the size.
  assert.ok(
    guard > shader.indexOf("cloudTextAt(gl_Position)); }"),
    "outside the film's cloud block",
  );
  assert.ok(guard < shader.indexOf("float size=aSize*uPixelRatio"), "before the point size");
  assert.ok(
    shader.includes(
      "vec2 starAt=gl_Position.xy/gl_Position.w*.5+.5; vec2 starOff=max(max(slateText.xy-starAt,starAt-slateText.zw),0.)*vec2(slateAspect,1.)/min(slateAspect,1.);",
    ),
    "the clouds' own distance from the box, on the screen's smaller side",
  );
  stars.dispose();
});

function skyMaterial() {
  return createEstateSkyMaterial({
    skyTopColor: 0x181d2d,
    skyBottomColor: 0x4f4d55,
    skyGlowColor: 0xc0895d,
    sunDirection: new Vector3(32, 28, 14).normalize(),
    sunColor: 0xdfb882,
    shellOpacity: 0.52,
  });
}

test("nebula quality and film state reach late-bound sky and stars", () => {
  const parent = new Group();
  const atmosphere = createSceneAtmosphere({ parent, profile: { tier: "high" } });
  atmosphere.applyQuality({ tier: "balanced" });
  atmosphere.setFilmTreatment(true);
  const sky = skyMaterial();
  assert.equal(sky.uniforms.uNebulaLayers.value, 0);
  atmosphere.setSkyMaterial(sky);
  const stars = createStarfield({
    parent,
    profile: { tier: "balanced" },
    nebulaLayers: sky.uniforms.uNebulaLayers,
  });
  const starUniform = stars.root.material.uniforms.uNebulaLayers;
  assert.equal(starUniform, sky.uniforms.uNebulaLayers);
  assert.equal(starUniform.value, 2);
  assert.equal(sky.uniforms.uClouds.value, 1, "the clouds stay on");
  for (const [tier, layers] of [
    ["low", 0],
    ["high", 3],
    ["balanced", 2],
    ["high", 3],
  ]) {
    atmosphere.applyQuality({ tier });
    stars.applyQuality({ tier });
    assert.equal(starUniform.value, layers);
    assert.equal(stars.root.geometry.drawRange.count, STAR_COUNTS[tier]);
    assert.equal(stars.root.material.uniforms.uCelestialTier.value, tier === "low" ? 0 : 1);
  }
  assert.equal(starUniform.value, 3);
  atmosphere.setFilmTreatment(false);
  assert.equal(starUniform.value, 0, "asset fallback and legacy treatment restore the old sky");
  atmosphere.setFilmTreatment(true);
  assert.equal(starUniform.value, 3);
  stars.dispose();
  assert.equal(starUniform.value, 3, "stars borrow rather than own the sky uniform");
  atmosphere.dispose();
  assert.equal(starUniform.value, 0);
  sky.dispose();
});

test("sky replacement and teardown clear borrowed celestial state without disposing the material", () => {
  const atmosphere = createSceneAtmosphere({ parent: new Group(), profile: { tier: "high" } });
  const first = skyMaterial(),
    second = skyMaterial();
  let freed = 0;
  first.addEventListener("dispose", () => freed++);
  second.addEventListener("dispose", () => freed++);
  atmosphere.setFilmTreatment(true);
  atmosphere.setSkyMaterial(first);
  assert.equal(first.uniforms.uNebulaLayers.value, 3);
  atmosphere.setSkyMaterial(second);
  assert.equal(first.uniforms.uNebulaLayers.value, 0);
  assert.equal(second.uniforms.uNebulaLayers.value, 3);
  atmosphere.setSkyMaterial(null);
  assert.equal(second.uniforms.uNebulaLayers.value, 0);
  atmosphere.setSkyMaterial(second);
  assert.equal(atmosphere.dispose(), true);
  assert.equal(atmosphere.dispose(), false);
  assert.equal(atmosphere.applyQuality({ tier: "balanced" }), false);
  assert.equal(atmosphere.setFilmTreatment(true), false);
  assert.equal(atmosphere.setSkyMaterial(first), false);
  assert.equal(second.uniforms.uNebulaLayers.value, 0);
  assert.equal(freed, 0);
  first.dispose();
  second.dispose();
  assert.equal(freed, 2);
});

test("cluster occupies existing distant star slots and leaves the low-quality sky intact", () => {
  const a = makeStarGeometry(),
    b = makeStarGeometry();
  const base = a.attributes.position,
    clustered = a.attributes.aCelestialPosition;
  assert.equal(base.count, STAR_COUNTS.high);
  assert.equal(clustered.count, base.count);
  assert.deepEqual(clustered.array, b.attributes.aCelestialPosition.array);
  let changed = 0,
    balancedChanged = 0;
  const center = celestialClusterDirection(0.17, -0.04);
  for (let i = 0; i < base.count; i++) {
    const original = new Vector3().fromBufferAttribute(base, i);
    const next = new Vector3().fromBufferAttribute(clustered, i);
    assert.ok(Math.abs(next.length() - 180) < 1e-4);
    if (original.distanceTo(next) > 1e-4) {
      changed++;
      if (i < STAR_COUNTS.balanced) balancedChanged++;
      assert.ok(i >= STAR_COUNTS.low, "low tier retains every original star position");
      assert.ok(
        next.normalize().angleTo(center) < 0.13,
        "cluster remains a loose, bounded sky patch",
      );
    }
  }
  assert.ok(balancedChanged >= 20 && balancedChanged < 40);
  assert.ok(changed > balancedChanged && changed < 70);
  const n = new Vector3(...NEBULA_FRAME.center),
    x = new Vector3(...NEBULA_FRAME.horizontal),
    y = new Vector3(...NEBULA_FRAME.vertical);
  assert.ok(Math.abs(n.dot(x)) < 1e-12 && Math.abs(n.dot(y)) < 1e-12 && Math.abs(x.dot(y)) < 1e-12);
  a.dispose();
  b.dispose();
});

test("celestial stars stay fixed in direction through camera translation, reduced motion and quality changes", () => {
  const parent = new Group(),
    camera = new PerspectiveCamera();
  const layers = { value: 3 };
  const stars = createStarfield({
    parent,
    camera,
    profile: { tier: "high" },
    nebulaLayers: layers,
  });
  const geometry = stars.root.geometry;
  const positions = geometry.attributes.aCelestialPosition.array.slice();
  const localStar = new Vector3().fromBufferAttribute(geometry.attributes.aCelestialPosition, 1222);
  let initialDirection;
  for (const position of [
    [8, 12, 35],
    [-14, 7, -20],
  ]) {
    camera.position.set(...position);
    camera.updateMatrixWorld(true);
    stars.update({ elapsedSeconds: 1 });
    parent.updateMatrixWorld(true);
    const ray = stars.root.localToWorld(localStar.clone()).sub(camera.position).normalize();
    if (initialDirection) assert.ok(ray.distanceTo(initialDirection) < 1e-12);
    initialDirection = ray;
  }
  stars.update({ elapsedSeconds: 2 });
  const time = stars.root.material.uniforms.uTime.value;
  stars.update({ elapsedSeconds: 8, reducedMotion: true });
  stars.applyQuality({ tier: "low" });
  assert.equal(stars.root.material.uniforms.uCelestialTier.value, 0);
  stars.applyQuality({ tier: "balanced" });
  assert.equal(stars.root.material.uniforms.uTime.value, time);
  assert.equal(stars.root.geometry, geometry);
  assert.deepEqual(geometry.attributes.aCelestialPosition.array, positions);
  assert.equal(parent.children.length, 1, "celestial treatment adds no mesh or draw object");
  let freed = 0;
  geometry.addEventListener("dispose", () => freed++);
  stars.dispose();
  stars.dispose();
  assert.equal(freed, 1);
  assert.equal(parent.children.length, 0);
  assert.equal(layers.value, 3);
});

const groundHeight = (x, z) => Math.sin(x * 0.07) + Math.cos(z * 0.04);

const profile = { tier: "high" };

test("film makes the sky opaque and restores its baseline compositing", () => {
  const ground = new Mesh(new BoxGeometry(), new MeshStandardMaterial()),
    parent = new Group();
  const atmosphere = createSceneAtmosphere({ parent, profile });
  const sky = {
    transparent: true,
    uniforms: { sunColor: { value: new Color(0x334455) }, uFilm: { value: 0 } },
  };
  const rendering = { setFilmTreatment() {}, focusFilmShadow() {}, postprocessPipeline: {} };
  const film = createFilmScene({ ground, groundHeight, atmosphere, rendering, skyMaterial: sky });
  film.setActive(true);
  assert.equal(sky.uniforms.uFilm.value, 1);
  assert.equal(sky.transparent, false);
  film.finishFrame(null, new Vector3(), null);
  film.setActive(false);
  assert.equal(sky.uniforms.uFilm.value, 0);
  assert.equal(sky.transparent, true);
  assert.equal(sky.uniforms.sunColor.value.getHex(), 0x334455);
  film.setActive(true);
  film.dispose();
  assert.equal(sky.transparent, true);
  assert.equal(sky.uniforms.uFilm.value, 0);
  atmosphere.dispose();
  ground.geometry.dispose();
  ground.material.dispose();
});

test("estate sky uses one world-space shell with preserved baseline uniforms and no image dependency", () => {
  const direction = new Vector3(1, 2, 3).normalize();
  const material = createEstateSkyMaterial({
    skyTopColor: 0x112233,
    skyBottomColor: 0x334455,
    skyGlowColor: 0x445566,
    sunColor: 0xffbb77,
    sunDirection: direction,
    shellOpacity: 0.9,
  });
  assert.equal(material.uniforms.uFilm.value, 0);
  assert.equal(material.uniforms.sunDirection.value, direction);
  assert.equal(material.uniforms.topColor.value.getHex(), 0x112233);
  assert.equal(material.depthWrite, false);
  assert.equal(material.uniforms.uTime.value, 0);
  assert.match(material.vertexShader, /modelMatrix \* vec4\(position/);
  assert.match(material.fragmentShader, /if \(uFilm>.5\)/);
  // The opaque film shell writes the sky's depth layer; the baseline keeps its opacity.
  assert.match(
    material.fragmentShader,
    /gl_FragColor=uFilm>\.5\?vec4\(col\*0\.9,0\.0\):vec4\(col,0\.9\);/,
  );
  assert.doesNotMatch(material.fragmentShader, /sampler2D|gl_FragCoord/);
  // The film gradient and horizon band are the shared functions the mountains haze toward.
  assert.ok(material.fragmentShader.includes(FILM_SKY_GLSL));
  assert.match(material.fragmentShader, /col=filmSky\(altitude\);/);
  assert.match(material.fragmentShader, /col\+=filmBand\(altitude\);\s*}\s*gl_FragColor=/);
  material.dispose();
});

test("film clouds keep defined low-sky silhouettes while low quality retains its original fade", () => {
  const material = createEstateSkyMaterial({
    sunDirection: new Vector3(0, 1, 0),
    shellOpacity: 0.52,
  });
  const smoothstep = (a, b, x) => {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  const mix = (a, b, t) => a + (b - a) * t;
  // Evaluate the emitted scalar GLSL expressions, so this checks the shader's
  // actual opacity and edge width instead of a second set of tuning constants.
  const scalar = (name) =>
    new Function(
      "uNebulaLayers",
      "altitude",
      "smoothstep",
      "mix",
      `return ${material.fragmentShader.match(new RegExp(`float ${name}=([^;]+);`))[1]}`,
    );
  const fade = scalar("horizonFade"),
    edge = scalar("w");
  for (const layers of [2, 3]) {
    assert.equal(fade(layers, 0, smoothstep, mix), 0, "no seam below the horizon");
    assert.ok(
      fade(layers, Math.sin((2 * Math.PI) / 180), smoothstep, mix) > 0.85,
      "cloud bodies remain distinct two degrees above the shell horizon",
    );
    assert.equal(fade(layers, 0.045, smoothstep, mix), 1);
    let previous = 0;
    for (const altitude of [-0.1, 0, 0.01, 0.02, 0.03, 0.04, 0.045, 0.1, 0.3, 0.8, 1]) {
      const value = fade(layers, altitude, smoothstep, mix);
      assert.ok(value >= previous && value <= 1, "the narrow fade is smooth and bounded");
      assert.equal(edge(layers, altitude, smoothstep, mix), 0.034);
      previous = value;
    }
  }
  for (const altitude of [-0.1, 0, 0.02, 0.045, 0.1, 0.17, 0.5, 0.8, 1]) {
    assert.equal(fade(0, altitude, smoothstep, mix), smoothstep(-0.03, 0.17, altitude));
    assert.equal(
      edge(0, altitude, smoothstep, mix),
      mix(0.05, 0.034, smoothstep(0.45, 0.8, altitude)),
    );
  }
  material.dispose();
});

test("the clouds' reshaping never reaches the reference banks or the clear lane, and fills the open sky", () => {
  const material = skyMaterial(),
    shader = material.fragmentShader;
  const smoothstep = (a, b, x) => {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  const line = (name) => shader.match(new RegExp(`float ${name}=([^;]+);`))[1];
  // The emitted scalar expressions, evaluated for a point b on the cloud plane.
  const degrees = (r) => (r * 180) / Math.PI;
  const azimuthOf = new Function("b", "atan", "degrees", `return ${line("cloudAz")}`);
  assert.match(shader, /cloudAz\+=cloudAz<0\.\?360\.:0\.;/);
  const openOf = new Function("cloudAz", "bl", "gapG", "smoothstep", `return ${line("open")}`);
  const lane = shader.match(
    /vec2 gapUV=\(b-vec2\(([-\d.]+),([-\d.]+)\)\)\/vec2\(([-\d.]+),([-\d.]+)\);/,
  );
  assert.ok(lane, "the clear lane is the authored gaussian");
  assert.match(shader, /float gapG=exp\(-dot\(gapUV,gapUV\)\);/);
  const [cx, cy, rx, ry] = lane.slice(1).map(Number);
  const open = (x, y) => {
    const b = { x, y },
      bl = Math.max(Math.hypot(x, y), 0.001);
    let az = azimuthOf(b, Math.atan2, degrees);
    if (az < 0) az += 360;
    const gapG = Math.exp(-(((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2));
    return openOf(az, bl, gapG, smoothstep);
  };
  // The reference: The watch's top-left 1100x440 at 1600x900 through its whole drift
  // (corners, edges and inside), measured from the shot's camera on the shell.
  for (const [x, y] of [
    [-0.7, 1.15],
    [-1.13, 0.12],
    [-2.36, 0.25],
    [-1.34, 2.04],
    [-1.57, 0.2],
    [-2.0, 1.3],
    [-2.3, 0.6],
    [-1.1, 0.5],
    [-1.5, 0.9],
    [-0.9, 0.8],
  ])
    assert.equal(open(x, y), 0, `reference banks at ${x},${y}`);
  // The clear lane (gapG).
  assert.equal(open(cx, cy), 0, "the clear lane");
  assert.ok(open(-1.39, -0.17) < 0.1, "the lane keeps the sun clear");
  // The open sky: Portrait, Lantern study, Close-up, two more stretches of it and the zenith.
  for (const [x, y] of [
    [1.5, 2],
    [3.5, 3],
    [3.5, 1],
    [-0.7, -0.8],
    [0.6, 0.9],
    [0, 0],
  ])
    assert.ok(open(x, y) > 0.95, `open sky at ${x},${y}`);
  // Below the sun it reshapes too.
  assert.ok(open(-1.8, -1.2) > 0.8);
  // Bounded and finite across the plane, the zenith and the wedge's seams included.
  for (let x = -5; x <= 5; x += 0.05)
    for (let y = -5; y <= 5; y += 0.25) {
      const value = open(x, y);
      assert.ok(Number.isFinite(value) && value >= 0 && value <= 1, `${x},${y}`);
    }
  // Past the horizon's knee the noise radius grows slower but never folds back, and
  // nearer the zenith it is the plane's own.
  // (Where the vortex turns, its radius blv stands for bl; elsewhere blv is bl itself.)
  // Below the dome's knee (CLOUD_RESHAPE.dome) it follows the dome, whose u the shader finds
  // from the plane radius (hzU); the reference banks' own radius (wedgeR) is the plane's
  // above their dome's knee (wedgeDome).
  const statement = (name) => {
    const match = shader.match(new RegExp(`float ${name}=([^;]+);`));
    assert.ok(match, name);
    return match[1].replace(/\bblv\b/g, "bl");
  };
  const radii = new Function(
    "bl",
    "sqrt",
    "log",
    "exp",
    "max",
    `const cloudOut=${statement("cloudOut")};
const hzB=bl*bl,hzS=(-.48*hzB+sqrt(4.5612*hzB+5.8564))/(2.*hzB+2.42),hzU=.5*log((1.+hzS)/max(1.-hzS,1e-5));
return [${statement("cloudR")}, ${statement("wedgeR")}, hzS];`,
  );
  const at = (bl) => radii(bl, Math.sqrt, Math.log, Math.exp, Math.max);
  const blOf = (deg) => {
    const s = Math.sin((deg * Math.PI) / 180);
    return (1.1 * Math.sqrt(1 - s * s)) / (s + 0.24);
  };
  // hzS is the shell's sin(altitude) back from the plane radius.
  for (const deg of [1, 5, 15, 40, 80])
    assert.ok(Math.abs(at(blOf(deg))[2] - Math.sin((deg * Math.PI) / 180)) < 1e-6);
  const [knee] = CLOUD_RESHAPE.horizon;
  let previous = 0,
    previousWedge = 0;
  for (let bl = 0.001; bl <= blOf(0.05); bl += 0.01) {
    const [r, w] = at(bl);
    assert.ok(r > previous && r <= bl + 1e-12, `cloudR at ${bl}`);
    assert.ok(w > previousWedge && w <= bl + 1e-12, `wedgeR at ${bl}`);
    if (bl < knee - 0.5) assert.ok(Math.abs(r - bl) < 0.01);
    if (bl < blOf(CLOUD_RESHAPE.wedgeDome[0]))
      assert.equal(w, bl, "the reference banks' coordinates above their low part");
    previous = r;
    previousWedge = w;
  }
  // Flatness (d ln R / d ln((1 + sin a) / cos a)) runs on through the knee and ends at the
  // dome's `flatness` at the horizon, where the plane draws banks about three times flatter.
  const flatness = (deg, index) => {
    const lnR = (d) => Math.log(at(blOf(d))[index]),
      u = (d) => Math.atanh(Math.sin((d * Math.PI) / 180)),
      h = 1e-3;
    return -(lnR(deg + h) - lnR(deg - h)) / (u(deg + h) - u(deg - h));
  };
  for (const [index, [kneeDeg, flat]] of [CLOUD_RESHAPE.dome, CLOUD_RESHAPE.wedgeDome].entries()) {
    assert.ok(
      Math.abs(flatness(kneeDeg + 0.05, index) - flatness(kneeDeg - 0.05, index)) < 0.05,
      "no seam at the knee",
    );
    assert.ok(Math.abs(flatness(0.02, index) - flat) < 0.05, "the dome's flatness at the horizon");
  }
  assert.ok(
    flatness(1, 1) < 2 && blOf(1) > 0,
    "the reference's low part no longer flattens as the plane's",
  );
  // The sky draws the reshaping; the environment's capture turns it off.
  assert.match(shader, /\*\(1\.-gapG\);\s*open\*=uCloudReshape;/);
  assert.equal(material.uniforms.uCloudReshape.value, 1);
  // The coordinates' weight, bend: 0 over the reference too, but easing in over wider
  // azimuths and radius, and never held off by the clear lane (bending coordinates
  // fast would shear the noise; the lane keeps its own clearing in the density).
  const bendOf = new Function(
    "cloudAz",
    "bl",
    "uCloudReshape",
    "smoothstep",
    `return ${line("bend")}`,
  );
  const bend = (x, y) => {
    let az = azimuthOf({ x, y }, Math.atan2, degrees);
    if (az < 0) az += 360;
    return bendOf(az, Math.max(Math.hypot(x, y), 0.001), 1, smoothstep);
  };
  for (const [x, y] of [
    [-0.7, 1.15],
    [-1.13, 0.12],
    [-2.36, 0.25],
    [-1.34, 2.04],
    [-2.0, 1.3],
    [-1.1, 0.5],
  ])
    assert.equal(bend(x, y), 0, `reference banks keep their coordinates at ${x},${y}`);
  assert.ok(bend(cx, cy) > 0, "the lane's own coordinates may reshape");
  assert.equal(bendOf(150, 2, 0, smoothstep), 0, "the environment's capture: none");
  assert.ok(open(-0.5, 0.6) > 0.9, "above the reference, toward the zenith, it reshapes");
  // It eases over at least 20 degrees on each side of the wedge.
  const [farLeft, farRight] = CLOUD_RESHAPE.bend;
  assert.ok(CLOUD_RESHAPE.wedge[1] - farLeft >= 20 && farRight - CLOUD_RESHAPE.wedge[2] >= 20);
  const scale = CLOUD_RESHAPE.scale;
  assert.ok(scale > 0 && scale <= 1);
  assert.ok(
    shader.includes(
      CLOUD_VORTEX.on
        ? `vec2 bn=bv*mix(wedgeR/blv,cloudR/blv*${scale},bend);`
        : `vec2 bn=b*mix(wedgeR/bl,cloudR/bl*${scale},bend);`,
    ),
  );
  assert.match(shader, /vec2 p=bn\+2\.98\*\(/);
  // The swirl turns the noise along half a turn of the half-frequency octave.
  const swirlLine = shader.match(/wo\+=bend\*([\d.]+)\*vec2\(cos\(turn\),sin\(turn\)\);/);
  const turnLine = shader.match(/float turn=([\d.]+)\*NV\[0\];/);
  assert.ok(swirlLine && turnLine);
  assert.equal(Number(swirlLine[1]), CLOUD_RESHAPE.swirl);
  // With every weight at full strength, the map from the cloud plane to the noise never
  // folds: the noise is never mirrored into creases. The model below is the emitted
  // code's coordinate path (its value noise, the reference warp, the swirl and the
  // radius and scale above) over the whole plane the shell reaches (|b| <= 1.1/.24).
  const fract = (v) => v - Math.floor(v);
  const noise = (x, y) => {
    const xi = Math.floor(x),
      yi = Math.floor(y);
    let fx = x - xi,
      fy = y - yi;
    fx = fx * fx * (3 - 2 * fx);
    fy = fy * fy * (3 - 2 * fy);
    const corner = (cxi, cyi) => {
      const h1 = fract(cxi * 0.1031),
        h2 = fract(cyi * 0.1031),
        h3 = h1;
      const hd = h1 * (h2 + 33.33) + h2 * (h3 + 33.33) + h3 * (h1 + 33.33);
      return fract((h1 + h2 + 2 * hd) * (h3 + hd));
    };
    const top = corner(xi, yi) + (corner(xi + 1, yi) - corner(xi, yi)) * fx,
      bottom = corner(xi, yi + 1) + (corner(xi + 1, yi + 1) - corner(xi, yi + 1)) * fx;
    return top + (bottom - top) * fy;
  };
  assert.ok(shader.includes("vec4 hv=fract((h1+h2+2.*hd)*(h3+hd));"));
  assert.ok(shader.includes("NP[0]=q*.5+vec2(7.3,1.9);"));
  assert.ok(shader.includes("vec2 wo=vec2(.8,-.5)*(NV[0]-.5)*.8*(1.-exp(-dot(wm,wm)));"));
  const turnScale = Number(turnLine[1]);
  const noiseAt = (x, y) => {
    const bl = Math.max(Math.hypot(x, y), 0.001),
      w = bend(x, y),
      [cloudR, wedgeR] = at(bl),
      k = (wedgeR / bl) * (1 - w) + (cloudR / bl) * scale * w;
    const qx = x * k + 5.7,
      qy = y * k + 0.9;
    const nv = noise(qx * 0.5 + 7.3, qy * 0.5 + 1.9);
    const wmx = (x + 1.1) / 1.1,
      wmy = (y - 0.3) / 1.1;
    const shear = (nv - 0.5) * 0.8 * (1 - Math.exp(-(wmx * wmx + wmy * wmy)));
    const turn = turnScale * nv;
    return [
      qx + 0.8 * shear + w * CLOUD_RESHAPE.swirl * Math.cos(turn),
      qy - 0.5 * shear + w * CLOUD_RESHAPE.swirl * Math.sin(turn),
    ];
  };
  const h = 1e-4;
  for (let x = -4.58; x <= 4.58; x += 0.06)
    for (let y = -4.58; y <= 4.58; y += 0.06) {
      if (Math.hypot(x, y) > 1.1 / 0.24) continue;
      const a = noiseAt(x, y),
        dx = noiseAt(x + h, y),
        dy = noiseAt(x, y + h);
      const det = ((dx[0] - a[0]) * (dy[1] - a[1]) - (dy[0] - a[0]) * (dx[1] - a[1])) / (h * h);
      // Never folds; the dome draws the plane's last stretch to the horizon into less noise
      // by design (about 0.046 at its least), so the margin is smaller than above it.
      assert.ok(det > 0.03, `the noise folds at ${x.toFixed(2)},${y.toFixed(2)}`);
    }
  // The banks lift only the open sky, and decisively: clear sky below the octave's [2]
  // and a bank above its [3], so no stray peak of the finer octaves stands alone in the
  // clear as an island; within a bank the next octave cuts darker lanes.
  const bankOf = new Function(
    "open",
    "cloudText",
    "NV",
    "mix",
    "smoothstep",
    `return ${line("bank")}`,
  );
  const mix = (a, b, t) => a + (b - a) * t;
  const bank = (o, nv0, nv2 = 0.5, text = 0) => bankOf(o, text, [nv0, 0, nv2], mix, smoothstep);
  const [clear, lift, from, to] = CLOUD_RESHAPE.banks;
  const lanes = CLOUD_RESHAPE.lanes;
  assert.ok(clear < 0 && lift > 0 && from < to && lanes > 0);
  assert.ok(bank(0, 1) === 0 && bank(0, 0) === 0, "none over the reference");
  assert.ok(bank(0, 1, 0.5, 1) === 0, "nor behind the text there");
  for (const nv0 of [0, from / 2, from])
    for (const nv2 of [0, 0.5, 1])
      assert.ok(Math.abs(bank(1, nv0, nv2) - clear) < 1e-12, "the clear takes no lanes");
  // The clear eases in by open squared, so the wedge's ease never reads as a clear column.
  assert.ok(Math.abs(bank(0.5, 0) - clear / 4) < 1e-12);
  assert.ok(Math.abs(bank(0.5, 1) - lift / 2) < 1e-12);
  for (const nv0 of [to, (to + 1) / 2, 1]) {
    assert.ok(Math.abs(bank(1, nv0) - lift) < 1e-12);
    assert.ok(Math.abs(bank(1, nv0, 1) - (lift + lanes / 2)) < 1e-12);
    assert.ok(Math.abs(bank(1, nv0, 0) - (lift - lanes / 2)) < 1e-12);
  }
  // Even the darkest lane keeps a bank above the clear.
  assert.ok(lift - lanes / 2 > clear);
  let last = -Infinity;
  for (let nv0 = 0; nv0 <= 1; nv0 += 0.01) {
    assert.ok(bank(1, nv0) >= last - 1e-12, "the bank rises with the octave");
    last = bank(1, nv0);
  }
  // Behind the name and intro [0] comes off the reshaped density, so the banks there burn
  // off along their own contours. The guard works on the density only, never the tone:
  // the grade's cel step would turn a screen-space fade of tone into a hard ring.
  const [clearing, textReach] = CLOUD_RESHAPE.text;
  assert.ok(clearing > 0 && clearing < 0.5);
  for (const nv0 of [0, 0.5, 1])
    assert.ok(Math.abs(bank(1, nv0, 0.5, 1) - (bank(1, nv0) - clearing)) < 1e-12);
  const field = cloudFieldGLSL("uTime");
  // It reaches the reshaped bank, where the vortex turns the vortex (CLOUD_VORTEX), and the
  // brush's dry edge, which eases off there (CLOUD_BRUSH): density only, never tone.
  assert.equal(
    field.match(/cloudText/g).length,
    1 + (CLOUD_VORTEX.on ? 1 : 0) + (CLOUD_BRUSH.on ? 1 : 0),
    "the guard reaches only the bank, the vortex and the brush's edge",
  );
  // It ends with the bank's cover, its threshold broken by the brush's dry edge (CLOUD_BRUSH),
  // with no lone islands (CLOUD_ISLANDS): the fine octaves move it only where the coarse
  // field comes near the threshold.
  assert.match(field, /float cover=smoothstep\(\.548-w,\.548\+w,d\+brushEdge\);\n/);
  assert.match(field, /cover\*=horizonFade\*uClouds;$/);
  // Only the finest octaves count: the medium one (n1) shapes lanes, windows and pockets.
  assert.ok(field.includes("fineD=(g2-.62)*.16+(fine-.5)*.07;"));
  const [c0, c1] = CLOUD_ISLANDS.clear.map((m) => (0.548 - m).toFixed(3)),
    [f0, f1] = CLOUD_ISLANDS.fill.map((m) => (0.548 + m).toFixed(3));
  assert.ok(
    field.includes(
      `if(uNebulaLayers>1.5){float dC=d-fineD;cover=mix(cover,max(cover*smoothstep(${c0},${c1},dC),smoothstep(${f0},${f1},dC)),uCloudReshape);}`,
    ),
  );
  assert.ok(CLOUD_ISLANDS.clear[0] > CLOUD_ISLANDS.clear[1] && CLOUD_ISLANDS.clear[1] > 0);
  assert.ok(CLOUD_ISLANDS.fill[1] > CLOUD_ISLANDS.fill[0] && CLOUD_ISLANDS.fill[0] > 0);
  assert.ok(shader.includes("col+=vec3(.027,.03,.036)*smoothstep(.36,.54,d)*horizonFade*uClouds;"));
  assert.match(shader, /d\+=bank; da\+=bank;/);
  // NV[0] exists only on the high and balanced skies: its readers sit after the
  // octave's own `continue` for the low sky, or inside the >1.5 branch.
  const lowSkip = shader.indexOf("if(k==0 && uNebulaLayers<1.5) continue;");
  assert.ok(lowSkip > 0 && shader.indexOf("float turn=") > lowSkip);
  const bankBranch = shader.indexOf("if(uNebulaLayers>1.5){\nfloat c2=");
  assert.ok(bankBranch > 0 && shader.indexOf("float bank=") > bankBranch);
  assert.ok(shader.indexOf("float bank=") < shader.indexOf("vec2 bankUV="));
  // The guard reads the clip position the shell's vertex shader hands on, and the
  // ground's box and aspect (nothing behind the text without them). Its exact source:
  assert.equal(
    CLOUD_TEXT_GLSL,
    `float cloudTextAt(vec4 clip){vec2 v=clip.xy/clip.w*.5+.5;
vec2 f=max(max(slateText.xy-v,v-slateText.zw),0.)*vec2(slateAspect,1.)/min(slateAspect,1.);
return 1.-smoothstep(0.,${textReach},length(f));}`,
  );
  // which behaves so: 1 inside the box, 0 at [1] of the smaller side beyond it, in x
  // and in y under either aspect, after the perspective divide.
  const textAt = ([x, y, , w], box, aspect) => {
    const vx = (x / w) * 0.5 + 0.5,
      vy = (y / w) * 0.5 + 0.5;
    const fx = (Math.max(box.x - vx, vx - box.z, 0) * aspect) / Math.min(aspect, 1),
      fy = Math.max(box.y - vy, vy - box.w, 0) / Math.min(aspect, 1);
    return 1 - smoothstep(0, textReach, Math.hypot(fx, fy));
  };
  const box = { x: 0.1, y: 0.2, z: 0.3, w: 0.5 };
  for (const aspect of [16 / 9, 9 / 19.5]) {
    const small = Math.min(aspect, 1);
    assert.equal(textAt([-0.6 * 2, -0.3 * 2, 0, 2], box, aspect), 1);
    assert.ok(textAt([(0.3 + (textReach * small) / aspect) * 2 - 1, 0, 0, 1], box, aspect) < 1e-9);
    assert.ok(textAt([-0.6, (0.5 + textReach * small) * 2 - 1, 0, 1], box, aspect) < 1e-9);
    assert.ok(textAt([(0.3 + (textReach * small) / aspect / 2) * 2 - 1, 0, 0, 1], box, aspect) > 0);
  }
  assert.ok(shader.includes(CLOUD_TEXT_GLSL));
  assert.match(shader, /float cloudText=cloudTextAt\(vCloudClip\);/);
  assert.match(material.vertexShader, /vCloudClip = gl_Position;/);
  assert.deepEqual(material.uniforms.slateText.value, { x: 2, y: 2, z: -1, w: -1 });
  const guard = { slateText: { value: {} }, slateAspect: { value: 1 } };
  const guarded = createEstateSkyMaterial({ sunDirection: new Vector3(0, 1, 0) }, guard);
  assert.equal(guarded.uniforms.slateText, guard.slateText);
  assert.equal(guarded.uniforms.slateAspect, guard.slateAspect);
  guarded.dispose();
  material.dispose();
});

test("the cloud vortex turns about the star's eye, never over the reference banks or the capture", () => {
  const material = skyMaterial(),
    shader = material.fragmentShader;
  assert.equal(CLOUD_VORTEX.on, 1);
  assert.ok(Object.isFrozen(CLOUD_VORTEX) && Object.isFrozen(CLOUD_VORTEX.arms));
  // Its ring about the eye is nearly gone (the owner's note of 2026-10-20, "i don't want the
  // ring to be very visible"): far fainter than the arms it sits among.
  assert.ok(CLOUD_VORTEX.ring[0] <= 0.05 && CLOUD_VORTEX.ring[0] < CLOUD_VORTEX.arms[2] / 2);
  const smoothstep = (a, b, x) => {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  // The density's weight takes the reshaping's own wedge and radius, easing out over
  // `protect`: exactly 0 over the reference banks (azimuths 119-176 from radius 1.12
  // out), for any eye, and 0 in the environment's capture (uCloudReshape 0).
  const weight = shader.match(/float vxW=([^;]+);/)[1];
  const protectOf = new Function(
    "cloudAz",
    "bl",
    "uCloudReshape",
    "smoothstep",
    `return ${weight}`,
  );
  const [, from] = CLOUD_RESHAPE.wedge;
  assert.ok(
    from >= 119 &&
      CLOUD_VORTEX.protect[0] >= CLOUD_RESHAPE.wedge[2] &&
      CLOUD_VORTEX.protect[0] < CLOUD_VORTEX.protect[1],
  );
  for (let az = 119; az <= CLOUD_VORTEX.protect[0]; az += 0.5)
    for (let bl = CLOUD_RESHAPE.radius[1]; bl < 4.6; bl += 0.05)
      assert.equal(protectOf(az, bl, 1, smoothstep), 0, `reference banks at ${az},${bl}`);
  assert.equal(protectOf(200, 1.4, 0, smoothstep), 0, "the capture draws none");
  assert.equal(protectOf(200, 1.4, 1, smoothstep), 1, "open sky beyond the wedge");
  assert.match(shader, /smoothstep\(0\.85,1\.12,bl\)\)\*uCloudReshape;/);
  // The turn's angle reads the distance from the eye alone (vxRho, and the guard's hole
  // about it), never the azimuth, the density's shifted disc or its protection, so it
  // never folds the noise; it ends at the reach the eye allows (uVortex.z).
  const turn = shader.match(/float vxA=([^;]+);/)[1];
  assert.doesNotMatch(turn, /vxW|cloudAz|\bbl\b|vxE|vxD/);
  assert.match(turn, /\(1\.-smoothstep\([\d.]+\*uVortex\.z,uVortex\.z,vxRho\)\)/);
  assert.match(turn, /^uVortex\.z>0\.\?uCloudReshape\*vxHole\*/);
  assert.match(
    shader,
    /float vxRho=length\(vxE\),vxHole=mix\(1\.,smoothstep\([\d.]+,[\d.]+,vxRho\),uVortex\.w\);/,
  );
  // Where the turn and the weight are 0 the noise's coordinates and the density are
  // untouched: both sit in branches the reference never takes.
  assert.ok(shader.includes("vec2 bv=b;\nif(vxA>0.){vec2 vxS=vec2(cos(vxA),sin(vxA))"));
  assert.ok(shader.includes("float blv=max(length(bv),.001);\nfloat cloudOut=blv-1.5;"));
  // Out of season (uVortex.z below 0) neither the turn nor the density is taken.
  assert.match(shader, /if\(vxW>0\.&&uVortex\.z>=0\.\)\{vec2 vxL=L\*clamp\(bl\*\.1,\.1,\.2\);/);
  // The turn is a rotation of the local frame by that angle; the arms turn rigidly on
  // the drift clock, a turn in many minutes.
  assert.match(shader, /vxF=vec2\(vxS\.x\*vxE\.x-vxS\.y\*vxE\.y,vxS\.y\*vxE\.x\+vxS\.x\*vxE\.y\)/);
  assert.ok(CLOUD_VORTEX.arms[3] >= 300, "a turn in many minutes");
  assert.ok(
    CLOUD_VORTEX_GLSL.includes(
      `-t*${((2 * Math.PI) / CLOUD_VORTEX.arms[3] / CLOUD_VORTEX.arms[0]).toFixed(8)};`,
    ),
  );
  // The arms are cloud, not a wave (the owner's pick of 2026-10-20, 2 Warm organic): crests
  // narrower than their gaps, a wandering phase and wisps unwound along the spiral, so their
  // breaks turn with them.
  const { crest, wobble, wisp, warm } = CLOUD_VORTEX;
  assert.ok(crest > 1 && wobble > 0 && wisp[0] > 0 && wisp[0] < 1);
  assert.ok(
    CLOUD_VORTEX_GLSL.includes(
      `float arm=2.*pow(.5+.5*cos(${CLOUD_VORTEX.arms[0].toFixed(1)}*sv),${crest})-1.;`,
    ),
  );
  assert.ok(CLOUD_VORTEX_GLSL.includes("vxNoise(r*vec2(cos(sv),sin(sv))*"));
  // The star's warmth on the swirl's lit edges, near the eye, never behind the text.
  assert.ok(warm[0] > 0 && warm[0] <= 0.6 && warm[1] > 0);
  assert.match(shader, /float vxGlow=vxW\*\(1\.-cloudText\)\*exp\(-vxRho\//);
  // Behind the name and intro it takes nothing (the text guard).
  assert.match(shader, /float vxK=vxW\*\(1\.-cloudText\);/);
  // The guard shots keep the star's disc and glow as they were (the bloom they feed
  // reaches the reference banks) and lean the density's disc away from them.
  assert.deepEqual([...CLOUD_VORTEX.guardShots], ["The watch"]);
  assert.match(shader, /length\(vxE-vec2\([\d.]+,[\d.]+\)\*uVortex\.w\)/);
  // Its eye: where a lens sees the star on the cloud plane, as the field maps the
  // shell (b = xz / (max(y, 0) + .24) * 1.1); from the world origin, the star's own
  // direction; set on each cut and refit from the shot's lens (index.js).
  const star = [-72.25, 50, -11.9],
    n = Math.hypot(...star),
    d = star.map((v) => v / n),
    eye = cloudVortexCenter({ x: 0, y: 0, z: 0 }, star, 130);
  assert.ok(Math.abs(eye.x - (d[0] / (d[1] + 0.24)) * 1.1) < 1e-9);
  assert.ok(Math.abs(eye.y - (d[2] / (d[1] + 0.24)) * 1.1) < 1e-9);
  // From The watch's lens the star stands just past the wedge (the reference banks lie
  // left of it on screen), so its turn reaches less far than the disc's rim.
  const watch = cloudVortexCenter({ x: 97.29, y: 26.38, z: -13.99 }, star, 130);
  let az = (Math.atan2(watch.y, watch.x) * 180) / Math.PI;
  if (az < 0) az += 360;
  assert.ok(az > CLOUD_VORTEX.protect[1] && az < 190, `${az}`);
  assert.ok(watch.z > 0.2 && watch.z < CLOUD_VORTEX.radius, `${watch.z}`);
  const index = flat(source("src/scene/index.js"));
  assert.ok(
    index.includes(
      "if (cinematicApplied && (cinematic.shot !== vortexShot || cinematic.frame !== vortexFit)) {",
    ),
  );
  assert.ok(
    index.includes("uVortex.value.w = CLOUD_VORTEX.guardShots.includes(vortexShot?.name) ? 1 : 0;"),
  );
  const { value } = material.uniforms.uVortex;
  assert.equal(value.z, cloudVortexReach(value.x, value.y));
  material.dispose();
});

test("the maelstrom comes now and then, and each shot has it whole or not at all", () => {
  const [first, cycle, span] = CLOUD_VORTEX.life;
  assert.ok(Object.isFrozen(CLOUD_VORTEX.life));
  assert.ok(span > 0 && span < cycle / 2, "occasionally");
  // Calm before the first.
  for (let t = 0; t < first; t += 0.5) assert.equal(cloudVortexPresent(t), false);
  // Once each cycle, at a seeded moment, it stands for `span`.
  const spans = [];
  let start = null,
    previous = false;
  for (let t = 0; t < 3600; t += 0.25) {
    const here = cloudVortexPresent(t);
    assert.equal(typeof here, "boolean");
    if (here && !previous) start = t;
    if (!here && previous) spans.push(t - start);
    previous = here;
  }
  const cycles = (3600 - first) / cycle;
  assert.ok(spans.length >= Math.floor(cycles) - 1 && spans.length <= Math.ceil(cycles));
  for (const stood of spans) assert.ok(Math.abs(stood - span) <= 0.25, `stood ${stood} s`);
  // The shader has no life of its own, so it is never seen forming: the reach (uVortex.z)
  // gives all of it or none, decided as each shot opens and kept through its refits.
  const shader = skyMaterial().fragmentShader;
  assert.doesNotMatch(shader, /vxLife/);
  const index = flat(source("src/scene/index.js"));
  assert.match(
    index,
    /if \(cinematic\.shot !== vortexShot\) vortexHere = vortexSeason && cloudVortexPresent\(skyShell\.material\.uniforms\.uTime\.value\); vortexShot = cinematic\.shot;/,
  );
  assert.match(
    index,
    /skyShell\.material\.uniforms\.uVortex\.value\); if \(!vortexHere\) skyShell\.material\.uniforms\.uVortex\.value\.z = -1;/,
  );
});

test("the vortex's turn never folds the noise and never reaches the reference banks, from any eye", () => {
  const smoothstep = (a, b, x) => {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  const VX = CLOUD_VORTEX,
    [, from, to] = CLOUD_RESHAPE.wedge,
    near = CLOUD_RESHAPE.radius[1];
  // The emitted turn (estate-sky.js VORTEX_FRAME): b to bv about an eye, guard w.
  const turn = (eye, w, b) => {
    const l = Math.hypot(eye.x, eye.y),
      R = [eye.x / l, eye.y / l],
      T = [-R[1], R[0]],
      D = [b[0] - eye.x, b[1] - eye.y],
      E = [D[0] * T[0] + D[1] * T[1], (D[0] * R[0] + D[1] * R[1]) * VX.squash],
      rho = Math.hypot(...E),
      hole = 1 + (smoothstep(VX.hole[0], VX.hole[1], rho) - 1) * w,
      A =
        eye.z > 0
          ? ((hole * VX.twist) / (1 + (rho * rho) / VX.eye[1] ** 2)) *
            (1 - smoothstep(VX.fade * eye.z, eye.z, rho))
          : 0;
    if (!(A > 0)) return [b, 0];
    const F = [Math.cos(A) * E[0] - Math.sin(A) * E[1], Math.sin(A) * E[0] + Math.cos(A) * E[1]];
    return [
      [
        eye.x + F[0] * T[0] + (F[1] / VX.squash) * R[0],
        eye.y + F[0] * T[1] + (F[1] / VX.squash) * R[1],
      ],
      A,
    ];
  };
  // Every shot's lens at 1600x900 and the phones' The watch and Portrait (The watch
  // with its guard, and without), and a sweep of eyes all round the wedge.
  const star = [-72.25, 50, -11.9],
    eyes = [
      [97.29, 26.38, -13.99, 1],
      [97.29, 26.38, -13.99, 0],
      [59.27, 2.98, 173.19, 0],
      [1.73, 18.58, 34.77, 0],
      [35.52, 10.78, -16.53, 0],
      [-5, 19.36, -29.6, 0],
      [81.72, 0.77, -28.67, 0],
      [46.92, -4.93, 27.44, 0],
      [20.19, 1.6, 16.38, 0],
      [41.4, -1.45, 11.94, 0],
      [153.57, 21.62, -8.35, 1],
      [99.09, 0.08, -90.99, 0],
    ].map(([x, y, z, w]) => [cloudVortexCenter({ x, y, z }, star, 130), w]);
  for (let deg = 100; deg <= 260; deg += 8)
    for (const bl of [1.0, 1.2, 1.45, 1.8]) {
      const a = (deg * Math.PI) / 180,
        x = bl * Math.cos(a),
        y = bl * Math.sin(a);
      eyes.push([{ x, y, z: cloudVortexReach(x, y) }, 0]);
    }
  const h = 1e-5;
  let worst = Infinity,
    turned = 0;
  for (const [eye, w] of eyes) {
    assert.ok(eye.z >= 0 && eye.z <= VX.radius);
    // The turn is a rotation by an angle of the distance alone: the map keeps area,
    // so its Jacobian determinant stays 1 (finite differences across the hole's edge
    // read a little less), and it never turns over.
    for (let x = eye.x - 0.45; x <= eye.x + 0.45; x += 0.009)
      for (let y = eye.y - 0.55; y <= eye.y + 0.55; y += 0.009) {
        const [p, A] = turn(eye, w, [x, y]);
        if (!(A > 0)) continue;
        turned++;
        const px = turn(eye, w, [x + h, y])[0],
          py = turn(eye, w, [x, y + h])[0];
        worst = Math.min(
          worst,
          ((px[0] - p[0]) * (py[1] - p[1]) - (px[1] - p[1]) * (py[0] - p[0])) / (h * h),
        );
      }
    // Over the reference banks the turn is exactly 0, whatever the eye.
    for (let az = from; az <= to; az += 1)
      for (let bl = near; bl < 3; bl += 0.02) {
        const a = (az * Math.PI) / 180;
        assert.equal(turn(eye, w, [bl * Math.cos(a), bl * Math.sin(a)])[1], 0, `${az},${bl}`);
      }
  }
  assert.ok(turned > 10000, `${turned}`);
  assert.ok(worst > 0.5, `the turn folds: det ${worst}`);
});

test("sky drift follows the scheduler clock, freezes for reduced motion and stops on disposal", () => {
  const atmosphere = createSceneAtmosphere({ parent: new Group(), profile });
  const sky = { uniforms: { uTime: { value: 0 } } };
  atmosphere.setSkyMaterial(sky);
  atmosphere.update({ elapsedSeconds: 12 });
  assert.equal(sky.uniforms.uTime.value, 12);
  atmosphere.update({ elapsedSeconds: 24, reducedMotion: true });
  assert.equal(sky.uniforms.uTime.value, 12);
  atmosphere.update({ elapsedSeconds: 25 });
  assert.equal(sky.uniforms.uTime.value, 25);
  atmosphere.dispose();
  atmosphere.update({ elapsedSeconds: 30 });
  assert.equal(sky.uniforms.uTime.value, 25);
});

test("film stars hide behind the sky's cloud banks, on the sky's own clock and switches", () => {
  const parent = new Group(),
    atmosphere = createSceneAtmosphere({ parent, profile }),
    sky = skyMaterial();
  atmosphere.setSkyMaterial(sky);
  const stars = createStarfield({
    parent,
    camera: new PerspectiveCamera(),
    profile,
    sky: sky.uniforms,
    skyRadius: 130,
  });
  const { uniforms, vertexShader } = stars.root.material;
  // The same uniform objects, never copies: one drift clock, film switch and tier.
  assert.equal(uniforms.uSkyTime, sky.uniforms.uTime);
  assert.equal(uniforms.uFilm, sky.uniforms.uFilm);
  assert.equal(uniforms.uClouds, sky.uniforms.uClouds);
  assert.equal(uniforms.uNebulaLayers, sky.uniforms.uNebulaLayers);
  assert.equal(uniforms.uSkyRadius.value, 130);
  // The banks' text guard reads the sky's own box and aspect objects too.
  assert.equal(uniforms.uCloudReshape, sky.uniforms.uCloudReshape);
  assert.equal(uniforms.uVortex, sky.uniforms.uVortex);
  assert.ok(vertexShader.includes(CLOUD_VORTEX_GLSL));
  assert.equal(uniforms.slateText, sky.uniforms.slateText);
  assert.equal(uniforms.slateAspect, sky.uniforms.slateAspect);
  // The stars evaluate the sky's own cloud field where their view ray leaves the
  // shell, and dim by the bank's opacity in the sky (.94).
  assert.ok(sky.fragmentShader.includes(cloudFieldGLSL("uTime")));
  assert.ok(vertexShader.includes(cloudFieldGLSL("uSkyTime")));
  assert.match(sky.fragmentShader, /col=mix\(col,cloudCol,cover\*\.94\);/);
  const shader = flat(vertexShader);
  assert.ok(
    shader.includes(
      "float skyCloudCover(vec3 direction,float cloudText){ float altitude=direction.y;",
    ),
  );
  assert.ok(vertexShader.includes(CLOUD_TEXT_GLSL));
  assert.ok(
    shader.includes(
      "if(uFilm>.5 && uClouds>.001){ vec3 ray=normalize((modelMatrix*vec4(starPosition,1.0)).xyz-cameraPosition);",
    ),
  );
  // The guard is read where the star lands on screen, so its clip position comes first.
  assert.ok(
    shader.includes(
      "vColor*=1.0-.94*skyCloudCover(normalize(cameraPosition+ray*reach),cloudTextAt(gl_Position));",
    ),
  );
  assert.ok(
    shader.indexOf("gl_Position=projectionMatrix*modelViewMatrix*vec4(starPosition,1.0);") <
      shader.indexOf("cloudTextAt(gl_Position)"),
  );
  // The emitted ray-shell distance lands on the shell from anywhere inside it.
  const reach = new Function(
    "along",
    "cameraPosition",
    "uSkyRadius",
    "dot",
    "sqrt",
    "max",
    `return ${vertexShader.match(/float reach=([^;]+);/)[1]}`,
  );
  for (const [eye, ray] of [
    [new Vector3(), new Vector3(0, 1, 0)],
    [new Vector3(8, 12, 35), new Vector3(-1, 0.3, 0.2).normalize()],
    [new Vector3(-14, 7, -20), new Vector3(0.2, 0.9, -0.1).normalize()],
    [new Vector3(30, 2, 10), new Vector3(1, 0.02, 0.3).normalize()],
  ]) {
    const t = reach(eye.dot(ray), eye, 130, (a, b) => a.dot(b), Math.sqrt, Math.max);
    assert.ok(t > 0);
    assert.ok(Math.abs(eye.clone().addScaledVector(ray, t).length() - 130) < 1e-9);
  }
  // The sky's clock drives the banks over the stars; the stars' own clock does not.
  atmosphere.update({ elapsedSeconds: 12 });
  stars.update({ elapsedSeconds: 40 });
  assert.equal(uniforms.uSkyTime.value, 12);
  atmosphere.update({ elapsedSeconds: 20, reducedMotion: true });
  assert.equal(uniforms.uSkyTime.value, 12);
  // Film turns the cover on for both, and its exit turns it off.
  const ground = new Mesh(new BoxGeometry(), new MeshStandardMaterial());
  const rendering = { setFilmTreatment() {}, focusFilmShadow() {}, postprocessPipeline: {} };
  const film = createFilmScene({ ground, groundHeight, atmosphere, rendering, skyMaterial: sky });
  film.setActive(true);
  assert.equal(uniforms.uFilm.value, 1);
  film.setActive(false);
  assert.equal(uniforms.uFilm.value, 0);
  film.setActive(true);
  // The stars borrow: disposing them frees neither the sky nor its uniforms' values.
  let skyFreed = 0;
  sky.addEventListener("dispose", () => skyFreed++);
  assert.equal(stars.dispose(), true);
  assert.equal(skyFreed, 0);
  assert.deepEqual(
    [sky.uniforms.uTime, sky.uniforms.uFilm, sky.uniforms.uClouds].map((u) => u.value),
    [12, 1, 1],
  );
  atmosphere.update({ elapsedSeconds: 30 });
  assert.equal(sky.uniforms.uTime.value, 30, "the sky keeps drifting after the stars go");
  film.dispose();
  atmosphere.dispose();
  sky.dispose();
  ground.geometry.dispose();
  ground.material.dispose();
  // Without a sky the stars own inert switches and draw over a clear sky.
  const bare = createStarfield({ parent: new Group(), profile });
  assert.equal(bare.root.material.uniforms.uFilm.value, 0);
  assert.equal(bare.root.material.uniforms.uClouds.value, 0);
  bare.dispose();
});

test("the maelstrom is spooky October's, with the lightning, by one date the scene starts with", () => {
  assert.deepEqual([...CLOUD_VORTEX.months], [10], "the owner's call of 2026-10-13");
  for (const [date, season] of [
    [new Date(2026, 9, 1), true],
    [new Date(2026, 9, 31, 23, 59), true],
    [new Date(2026, 8, 30, 23, 59), false],
    [new Date(2026, 10, 1), false],
    [new Date(2027, 0, 15), false],
  ])
    assert.equal(cloudVortexInSeason(date), season, String(date));
  // Gentler since the quiet cut: it frames the star without shouting.
  assert.ok(
    CLOUD_VORTEX.twist <= 3.5 && CLOUD_VORTEX.arms[2] <= 0.15 && CLOUD_VORTEX.ring[0] <= 0.2,
  );
  const index = flat(source("src/scene/index.js"));
  assert.match(
    index,
    /const sceneDate = new Date\(\); const vortexSeason = cloudVortexInSeason\(sceneDate\);/,
  );
  assert.equal(index.match(/new Date\(/g).length, 1, "one date for the whole storm");
  // The reach starts below 0, and out of season no shot takes it.
  assert.match(
    index,
    /skyShell\.material\.depthWrite = false; skyShell\.material\.uniforms\.uVortex\.value\.z = -1;/,
  );
  assert.match(index, /vortexHere = vortexSeason && cloudVortexPresent\(/);
  assert.equal(index.match(/vortexHere = (?!false;)/g).length, 1, "no other shot takes it");
  assert.match(index, /createLightning\(\{[^}]*date: sceneDate,? \}\)/);
});

test("the bootstrap hands the stars the sky shell's uniforms and radius", () => {
  const index = flat(source("src/scene/index.js"));
  // The shell is a sphere of that radius about the world origin, as the stars assume,
  // and its banks' text guard borrows the ground's text boxes, made just before it.
  assert.match(
    index,
    /const groundContacts = createSlateContacts\(estateContacts\(\)\); const skyShell = new Mesh\(new SphereGeometry\(WORLD\.SKY_DOME_RADIUS, skyWidthSegments, skyHeightSegments\), createEstateSkyMaterial\(skyConfig, groundContacts\)\);/,
  );
  assert.equal(index.match(/createSlateContacts\(/g).length, 1);
  assert.doesNotMatch(index, /skyShell\.position/);
  assert.match(
    index,
    /createStarfield\(\{ parent: atmosphereSystem\.root, camera, profile: state\.profile, sky: skyShell\.material\.uniforms, skyRadius: WORLD\.SKY_DOME_RADIUS \}\)/,
  );
});

function overlayRig() {
  const atmosphere = createSceneAtmosphere({ parent: new Group(), profile });
  const stars = new ShaderMaterial({ transparent: true, blending: AdditiveBlending });
  const sun = new ShaderMaterial({ transparent: true });
  const shell = new ShaderMaterial({ transparent: true });
  const opaque = new MeshBasicMaterial();
  const unblended = new ShaderMaterial({ transparent: true, blending: NoBlending });
  const geometry = new BoxGeometry();
  const nested = new Group();
  nested.add(new Mesh(geometry, [sun, opaque]));
  atmosphere.root.add(
    new Mesh(geometry, stars),
    new Mesh(geometry, shell),
    new Mesh(geometry, unblended),
    nested,
  );
  return { atmosphere, stars, sun, shell, opaque, unblended, geometry };
}

const factors = (m) => [m.blending, m.blendSrc, m.blendDst, m.blendSrcAlpha, m.blendDstAlpha];

test("film stars and sun blend their colour as before but keep the sky's depth layer, and restore on exit", () => {
  const { atmosphere, stars, sun, shell, opaque, unblended, geometry } = overlayRig();
  shell.transparent = false;
  const before = [stars, sun, shell, opaque, unblended].map(factors);
  atmosphere.setFilmTreatment(true);
  assert.deepEqual(factors(stars), [
    CustomBlending,
    SrcAlphaFactor,
    OneFactor,
    ZeroFactor,
    OneFactor,
  ]);
  assert.deepEqual(factors(sun), [
    CustomBlending,
    SrcAlphaFactor,
    OneMinusSrcAlphaFactor,
    ZeroFactor,
    OneFactor,
  ]);
  assert.deepEqual(
    [shell, opaque, unblended].map(factors),
    before.slice(2),
    "opaque and unblended materials are untouched",
  );
  atmosphere.setFilmTreatment(true);
  assert.deepEqual(
    factors(stars),
    [CustomBlending, SrcAlphaFactor, OneFactor, ZeroFactor, OneFactor],
    "idempotent",
  );
  atmosphere.setFilmTreatment(false);
  assert.deepEqual([stars, sun, shell, opaque, unblended].map(factors), before);
  assert.equal(stars.blending, AdditiveBlending);
  assert.equal(sun.blending, NormalBlending);
  atmosphere.setFilmTreatment(true);
  atmosphere.setFilmTreatment(false);
  assert.deepEqual(
    [stars, sun].map(factors),
    before.slice(0, 2),
    "a second round trip restores the originals",
  );
  atmosphere.dispose();
  geometry.dispose();
});

test("film makes the sky shell opaque before the overlays switch, so the sky is never blended away", () => {
  const { atmosphere, stars, geometry } = overlayRig();
  const sky = createEstateSkyMaterial({
    skyTopColor: 0x112233,
    skyBottomColor: 0x334455,
    skyGlowColor: 0x445566,
    sunColor: 0xffbb77,
    sunDirection: new Vector3(0, 1, 0),
    shellOpacity: 0.52,
  });
  atmosphere.root.add(new Mesh(geometry, sky));
  const ground = new Mesh(new BoxGeometry(), new MeshStandardMaterial());
  const rendering = { setFilmTreatment() {}, focusFilmShadow() {}, postprocessPipeline: {} };
  const film = createFilmScene({ ground, groundHeight, atmosphere, rendering, skyMaterial: sky });
  film.setActive(true);
  // Reversed, the shell (alpha 0 in film) would take the overlays' blending and turn black.
  assert.equal(sky.transparent, false);
  assert.equal(sky.blending, NormalBlending);
  assert.equal(sky.blendDstAlpha, null);
  assert.equal(stars.blending, CustomBlending);
  film.setActive(false);
  assert.equal(sky.transparent, true);
  assert.equal(sky.blending, NormalBlending);
  assert.equal(stars.blending, AdditiveBlending);
  film.dispose();
  atmosphere.dispose();
  sky.dispose();
  geometry.dispose();
  ground.geometry.dispose();
  ground.material.dispose();
});

test("every part of the star writes the star's layer mask, and the glow faces the lens", () => {
  const parent = new Group(),
    camera = new PerspectiveCamera();
  camera.position.set(0, 2, 20);
  const controller = createSolarBody({
    parent,
    camera,
    position: new Vector3(0, 0, -60),
    profile: { tier: "high" },
  });
  const mesh = (name) => controller.root.getObjectByName(name),
    disc = mesh("solar-disc"),
    glow = mesh("solar-glow");
  // Each part's alpha adds STAR_LAYER times its coverage (constant-alpha), so
  // the grade keeps the star out of the cloud banks' cel step.
  for (const part of [disc, glow]) {
    assert.equal(part.material.blending, 5, part.name);
    assert.equal(part.material.blendSrcAlpha, 213, part.name);
    assert.equal(part.material.blendDstAlpha, 201, part.name);
    assert.equal(part.material.blendAlpha, STAR_LAYER, part.name);
  }
  assert.equal(disc.material.blendDst, 205, "the disc draws over");
  assert.equal(glow.material.blendDst, 201, "the glow adds light");
  assert.equal(glow.material.depthWrite, false);
  assert.equal(glow.material.uniforms.uBreath, disc.material.uniforms.uBreath);
  // The glow's plane faces the lens.
  controller.update({ elapsedSeconds: 1 });
  camera.updateMatrixWorld();
  assert.ok(glow.quaternion.angleTo(camera.getWorldQuaternion(new Quaternion())) < 1e-6);
  controller.dispose();
});

test("the painted sky's brush follows the clouds' flow, and the capture keeps them as authored", () => {
  const field = cloudFieldGLSL();
  const shader = skyMaterial().fragmentShader;
  assert.equal(CLOUD_BRUSH.on, 1);
  // The dry edge: in the clouds' own noise space (q, after the warp), on high and balanced,
  // eased off behind the text and scaled by uCloudReshape (0 in the environment capture).
  const edge = field.slice(field.indexOf("float brushEdge=0.;"));
  assert.ok(
    field.indexOf("q+=wo; p+=wo;") < field.indexOf("float brushEdge=0.;"),
    "after the warp",
  );
  assert.match(edge, /^float brushEdge=0\.;\nif\(uNebulaLayers>1\.5\)\{vec2 bex=vec2\(dot\(q,/);
  assert.match(edge, /brushEdge=[\d.]+\*\(be-\.5\)\*2\.\*\(1\.-cloudText\)\*uCloudReshape;/);
  // The streaks: before the soft knee, high only, scaled the same way.
  const streak = shader.indexOf("if(uNebulaLayers>2.5){vec2 bsx=");
  assert.ok(streak > 0 && streak < shader.indexOf("vec3 kn=vec3(.64,.62,.66)"));
  assert.match(shader, /cloudCol\*=1\.\+[\d.]+\*\(bs-\.5\)\*2\.\*uCloudReshape;/);
  for (const [amount, along, across] of [CLOUD_BRUSH.edge, CLOUD_BRUSH.streak])
    assert.ok(amount <= 0.1 && across > along, "slight, and longer along the brush than across");
  // Sine-free, as every cloud noise is.
  assert.doesNotMatch(edge, /sin\(/);
});

test("the clear sky stays night down to the ranges, but not over the reference banks above their low part", async () => {
  // filmNight (SKY_GLOW) rolls the glow's luma off under the grade's first cel threshold, so
  // the cel step draws no ruled band across the low sky (the owner's pick of 2026-10-24).
  const glsl = FILM_SKY_GLSL.match(/vec3 filmNight\(vec3 c, float a, float w\) \{([\s\S]*?)\n\}/);
  assert.ok(glsl, "filmNight");
  const body = glsl[1]
    .replace(/vec3\(\.299,\.587,\.114\)/, "Y")
    .replace(/float l=/, "let l=")
    .replace(/,t=/, ";let t=");
  const night = new Function(
    "c",
    "a",
    "w",
    "dot",
    "exp",
    "mix",
    "smoothstep",
    "Y",
    body.replace(/return c\*mix\(1\.,t\/l,(.+)\);/s, "return c*mix(1,t/l,$1);"),
  );
  const smoothstep = (e0, e1, x) => {
    const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  };
  const mix = (x, y, a) => x * (1 - a) + y * a;
  const luma = (s) =>
    night(s, Math.sin((20 * Math.PI) / 180), 1, (x, y) => x * y, Math.exp, mix, smoothstep, 1);
  for (let l = 0.01; l < 0.4; l += 0.01)
    assert.ok(luma(l) < SKY_GLOW.cap + 1e-9 && luma(l) <= l + 1e-12);
  assert.equal(luma(0.1), 0.1, "under the knee it is the gradient's own");
  const below = night(
    0.3,
    Math.sin(((SKY_GLOW.from - 0.5) * Math.PI) / 180),
    1,
    (x, y) => x * y,
    Math.exp,
    mix,
    smoothstep,
    1,
  );
  assert.equal(below, 0.3, "below `from` (behind the ranges) the glow is as it was");
  assert.equal(
    night(0.3, 0.5, 0, (x, y) => x * y, Math.exp, mix, smoothstep, 1),
    0.3,
    "weight 0: untouched",
  );
  const shader = flat(
    createEstateSkyMaterial({
      skyTopColor: 0,
      skyBottomColor: 0,
      skyGlowColor: 0,
      sunDirection: null,
      sunColor: 0,
      shellOpacity: 0.52,
    }).fragmentShader,
  );
  // The shell weighs it by the reference banks' protection above their low part and by
  // uCloudReshape (0 in the environment's capture, whose sky light stays as approved).
  assert.match(
    shader,
    /col=filmNight\(col,altitude,uCloudReshape\*\(1\.-smoothstep\(99\.0,119\.0,cloudAz\)/,
  );
  // The ranges haze toward the same night.
  assert.match(
    flat(source("src/scene/hill-silhouette.js")),
    /vec3 s0=\(filmNight\(filmSky\(a\),a,1\.\)\+filmBand\(a\)\)\*uSky\.y/,
  );
});
