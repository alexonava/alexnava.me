import assert from "node:assert/strict";
import test from "node:test";
import {
  FALLS,
  FLOW_RMS,
  RAPIDS,
  SEA,
  coastBedPhase,
  createFalls,
  createSea,
  fallsGeometry,
  rapidsFrame,
  rapidsGlsl,
  riverFalls,
} from "../src/scene/ocean.js";
import { RIVER_LINE, filmHeight } from "../src/scene/terrain-build.js";
import { flat } from "./support/code.mjs";

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const lib = {
  MIST_UNIFORMS: {},
  RANGE_MIST: { value: { x: 0, y: 0, z: 0, w: 0 } },
  FLASH_GROUND: { babelFlash: { value: { x: 0, y: 0, z: 0, w: 0 } } },
  SLATE_TEXT_GUARD: "",
  MIST_PARS: "",
};
const clock = () => ({ uniform: { value: 0 }, tick: () => 0 });

test("coastal beds vary their thickness without folding or introducing a height discontinuity", () => {
  const thicknesses = [];
  for (let s = -150; s <= 150; s += 9.5) {
    let previous = coastBedPhase(s, -16),
      lastBoundary;
    for (let y = -15.99; y <= 8; y += 0.01) {
      const phase = coastBedPhase(s, y),
        slope = (phase - previous) / 0.01;
      assert.ok(slope > 0.15 && slope < 0.8, `ordered, bounded strata at ${s},${y}`);
      if (Math.floor(phase) > Math.floor(previous)) {
        if (lastBoundary !== undefined) thicknesses.push(y - lastBoundary);
        lastBoundary = y;
      }
      previous = phase;
    }
  }
  assert.ok(thicknesses.length > 250);
  assert.ok(Math.max(...thicknesses) / Math.min(...thicknesses) > 1.8, "not an equal-pitch stack");
  assert.ok(Math.min(...thicknesses) > 1 && Math.max(...thicknesses) < 5.2);
});

test("the delivered rapids keep crossing waves at the banks and coherent downstream flow in the centre", () => {
  const shader = flat(rapidsGlsl("probe", rapidsFrame(riverFalls(RIVER_LINE)))),
    bankExpression = shader.match(/float banks=(.+?),c2=/)?.[1],
    wave = shader.match(/g\+=([\d.]+)\*a\*vec2\(([^;]+)\);/);
  assert.ok(wave && bankExpression.startsWith("smoothstep("));
  const bank = new Function("r", "smoothstep", `return ${bankExpression};`),
    components = wave[2].split(/,(?![^()]*\))/),
    evaluate = components.map(
      (body) =>
        new Function("banks", "ph", "c2", "c3", `return ${body.replaceAll("cos(", "Math.cos(")};`),
    );
  assert.equal(evaluate.length, 2);
  assert.equal(bank(0, smoothstep), 0);
  assert.equal(bank(0.4, smoothstep), 0);
  assert.equal(bank(0.95, smoothstep), 1);
  let energy = 0;
  for (let i = 0; i < 300; i++) {
    const ph = i * 0.37,
      c2 = i * 0.51,
      c3 = i * 0.27 + 0.7;
    assert.equal(evaluate[0](bank(0, smoothstep), ph, c2, c3), Math.cos(ph));
    assert.ok(Math.abs(evaluate[1](bank(0, smoothstep), ph, c2, c3)) === 0);
    energy += evaluate[1](bank(0.95, smoothstep), ph, c2, c3) ** 2;
  }
  assert.ok(
    energy / 300 > 0.015,
    "banks retain lateral disturbance rather than flattening all water",
  );
});

test("the delivered fine white streaks converge to their mean once a pixel cannot resolve them", () => {
  const shader = flat(rapidsGlsl("probe", rapidsFrame(riverFalls(RIVER_LINE)))),
    expression = shader.match(/float streakFoam=([^;]+);/)?.[1];
  assert.ok(expression);
  const evaluate = new Function(
    "sx",
    "sp",
    "fp",
    "smoothstep",
    "mix",
    "min",
    `return ${expression.replaceAll("s.x", "sx")};`,
  );
  const mix = (a, b, t) => a + (b - a) * t;
  for (const speed of [RAPIDS.from, 1, RAPIDS.to]) {
    const resolved = [],
      unresolved = [];
    for (let sx = -1; sx <= 1; sx += 0.02) {
      resolved.push(evaluate(sx, speed, 0.001, smoothstep, mix, Math.min));
      unresolved.push(evaluate(sx, speed, 10, smoothstep, mix, Math.min));
    }
    assert.ok(Math.max(...resolved) - Math.min(...resolved) > 0.95);
    assert.ok(
      unresolved.every((value) => value === 0.22),
      "no raw s.x foam survives unresolved",
    );
  }
  assert.match(shader, /float foam=max\([^;]+streakFoam\*smoothstep/);
});

test("the sea mirror includes the actual displaced broad swell and its analytic slopes", () => {
  const sea = createSea({ lib, clock: clock() });
  try {
    const shader = flat(sea.material.fragmentShader),
      terms = [
        ...shader.matchAll(
          /g\+=vec2\(([-\d.]+),([-\d.]+)\)\*([\d.]+)\*cos\(dot\(vec2\([^)]+\),P.xz\)\*([\d.]+)-seaTime\*([\d.]+)\+([\d.]+)\)\*f;/g,
        ),
      ];
    assert.equal(terms.length, SEA.swell.length);
    for (let i = 0; i < terms.length; i++) {
      const [, dx, dz, slope, k, w, phase] = terms[i].map(Number),
        [length, amplitude, heading] = SEA.swell[i],
        direction = (heading * Math.PI) / 180;
      assert.ok(Math.abs(dx - Math.cos(direction)) < 1e-5);
      assert.ok(Math.abs(dz - Math.sin(direction)) < 1e-5);
      assert.ok(Math.abs(k - (2 * Math.PI) / length) < 1e-5);
      assert.ok(Math.abs(w - Math.sqrt((32.2 * 2 * Math.PI) / length)) < 1e-5);
      assert.ok(Math.abs(phase - i * 1.7) < 1e-5);
      for (let sample = 0; sample < 60; sample++) {
        const x = sample * 1.19,
          z = sample * -0.73,
          t = sample * 0.13,
          h = 0.001,
          height = (x, z) => amplitude * Math.sin((dx * x + dz * z) * k - t * w + phase),
          gx = (height(x + h, z) - height(x - h, z)) / (2 * h),
          gz = (height(x, z + h) - height(x, z - h)) / (2 * h),
          cosine = Math.cos((dx * x + dz * z) * k - t * w + phase);
        assert.ok(Math.abs(gx - dx * slope * cosine) < 1e-5);
        assert.ok(Math.abs(gz - dz * slope * cosine) < 1e-5);
      }
    }
    assert.ok(
      shader.indexOf(terms[0][0]) < shader.indexOf("vec2 gw=g"),
      "cliff reflection uses the swell too",
    );
  } finally {
    sea.dispose();
  }
});

test("near-shore foam follows the rastered swell while the raised horizon retains its level-plane projection", () => {
  const sea = createSea({ lib, clock: clock() });
  try {
    const shader = flat(sea.material.fragmentShader),
      rim = shader.match(/float rim=(smoothstep\([^;]+);/)?.[1],
      point = shader.match(/vec3 P=mix\(vSeaW,cameraPosition\+V\*t,([^;]+)\);/)?.[1],
      distance = shader.match(/float fp=max\((mix\([^;]+?\))\*length\(fwidth\(V\)\)/)?.[1];
    assert.ok(rim && point && distance);
    const weight = new Function(
        "radius",
        "smoothstep",
        `return ${rim.replace("length(vSeaW.xz-cameraPosition.xz)", "radius")};`,
      ),
      range = new Function("L", "t", "rim", "mix", `return ${distance};`),
      mix = (a, b, u) => a + (b - a) * u,
      eye = [0, 3, 0],
      sample = (radius, y) => {
        const surface = [radius * 0.8, y, radius * 0.6],
          delta = surface.map((n, i) => n - eye[i]),
          L = Math.hypot(...delta),
          V = delta.map((n) => n / L),
          t = Math.min(eye[1] / Math.max(-V[1], 1e-5), 1e4),
          mean = eye.map((n, i) => n + V[i] * t),
          rim = weight(radius, smoothstep);
        return {
          surface,
          mean,
          point: surface.map((n, i) => mix(n, mean[i], rim)),
          footprintDistance: range(L, t, rim, mix),
          L,
          t,
        };
      };
    assert.equal(point, "rim", "position and footprint share the same transition");
    const edges = rim
      .match(/smoothstep\(([\d.]+),([\d.]+),/)
      ?.slice(1)
      .map(Number);
    assert.ok(Math.abs(edges[0] - SEA.rim.from * SEA.radius) < 1e-5);
    assert.equal(edges[1], SEA.radius);
    const raisedEdges = flat(sea.material.vertexShader)
      .match(/w.y\+=smoothstep\(([\d.]+),([\d.]+),r\)/)
      ?.slice(1)
      .map(Number);
    assert.deepEqual(
      raisedEdges,
      edges,
      "the shading transition follows the existing raised rim, not a new shore mask",
    );
    for (const y of [-0.3, 0.3])
      for (const r of [5, 30, 80, edges[0]]) {
        const s = sample(r, y);
        assert.deepEqual(s.point, s.surface);
        assert.equal(s.footprintDistance, s.L);
        assert.ok(
          Math.hypot(s.mean[0] - s.surface[0], s.mean[2] - s.surface[2]) > 0.4,
          "the old mean plane can address foam across the actual rock-water boundary",
        );
      }
    const far = sample(SEA.radius, 1.5);
    assert.ok(far.point.every((n, i) => Math.abs(n - far.mean[i]) < 1e-10));
    assert.equal(far.footprintDistance, far.t);
    let previous = sample(edges[0] - 0.01, 0.3);
    for (let r = edges[0]; r <= SEA.radius + 0.01; r += 0.1) {
      const next = sample(r, 0.3);
      assert.ok(next.point.every(Number.isFinite));
      assert.ok(Math.hypot(...next.point.map((n, i) => n - previous.point[i])) < 0.2);
      assert.ok(Math.abs(next.footprintDistance - previous.footprintDistance) < 0.2);
      previous = next;
    }
  } finally {
    sea.dispose();
  }
});

test("unresolved plunge slopes disappear into roughness while retaining their variance", () => {
  const sea = createSea({ lib, clock: clock() });
  try {
    const shader = flat(sea.material.fragmentShader),
      filter = shader.match(/float resolve=([^;]+);/)?.[1],
      slope = Number(shader.match(/g\+=churn\.yz\*([\d.]+)\*impact\*resolve;/)?.[1]) * FLOW_RMS,
      carried = shader.match(/v\+=\.006\*impact\+([^;]+);/)?.[1];
    assert.ok(filter && carried && Number.isFinite(slope));
    const resolve = new Function(
        "radius",
        "fp",
        "smoothstep",
        `return ${filter.replace("seaFalls.z", "radius")};`,
      ),
      variance = new Function("impact", "resolve", `return ${carried};`),
      radius = 9;
    assert.equal(resolve(radius, 0.1, smoothstep), 1);
    assert.equal(resolve(radius, 3, smoothstep), 0);
    assert.equal(slope * resolve(radius, 3, smoothstep), 0, "no aliased normal remains");
    for (const impact of [0, 0.2, 0.6, 1])
      for (const fp of [0.1, 0.5, 0.9, 1.3, 3]) {
        const f = resolve(radius, fp, smoothstep),
          energy = (slope * impact * f) ** 2 + variance(impact, f);
        assert.ok(
          Math.abs(energy - (slope * impact) ** 2) < 5e-6,
          "resolved slope plus unresolved variance stays constant",
        );
        assert.ok(variance(impact, f) >= 0);
      }
    assert.ok(variance(1, 0) > 0.008, "the far impact does not turn into a glassy patch");
  } finally {
    sea.dispose();
  }
});

test("falling sheets keep their ballistic middle and vary folds through the lower drop", () => {
  const drop = riverFalls(RIVER_LINE),
    { geometry, plunge } = fallsGeometry(
      drop,
      filmHeight(() => 0, true),
    ),
    position = geometry.attributes.position,
    { across, ring } = geometry.userData.falls,
    middle = (across - 1) / 2,
    back = (c) => across + 2 + across - 1 - c,
    final = FALLS.rows * ring + back(middle);
  try {
    assert.ok(Math.abs(position.getX(final) - plunge[0]) < 1e-5);
    assert.ok(Math.abs(position.getZ(final) - plunge[1]) < 1e-5);
    assert.ok(Math.abs(position.getY(final) - (SEA.level - 1)) < 1e-5);
    const [hx, hz] = drop.heading;
    let changingStreams = 0;
    // Remove each stream's own ballistic bow before comparing its lower
    // course. Most interior streams must vary physically; a constant
    // extrusion cannot pass by merely changing acceleration or one column.
    for (let column = 1; column < across - 1; column++) {
      const brink = FALLS.run * ring + column,
        centre = FALLS.run * ring + middle,
        w = (column / (across - 1)) * 2 - 1,
        fall = Math.sqrt((2 * (position.getY(brink) - SEA.level + 1)) / 32.2),
        residuals = [];
      for (let row = FALLS.rows - 5; row <= FALLS.rows; row++) {
        const k = (row - FALLS.run) / (FALLS.rows - FALLS.run),
          i = row * ring + back(column),
          scale = 1 + FALLS.spread * k,
          x = position.getX(centre) + (position.getX(brink) - position.getX(centre)) * scale,
          z = position.getZ(centre) + (position.getZ(brink) - position.getZ(centre)) * scale;
        residuals.push(
          (position.getX(i) - x) * hx +
            (position.getZ(i) - z) * hz -
            FALLS.push * k * fall * (1 - FALLS.drag * w * w),
        );
      }
      if (Math.max(...residuals) - Math.min(...residuals) > drop.lip[2] * 0.01) changingStreams++;
    }
    assert.ok(changingStreams > (across - 2) / 2, "broad folds evolve over most interior streams");
    for (const attribute of Object.values(geometry.attributes))
      assert.ok([...attribute.array].every(Number.isFinite));
  } finally {
    geometry.dispose();
  }
});

test("the falling sheet's unresolved channels fade to their mean and its impact stays local", () => {
  const falls = createFalls({
    lib,
    clock: clock(),
    drop: riverFalls(RIVER_LINE),
    height: filmHeight(() => 0, true),
  });
  try {
    const shader = flat(falls.material.fragmentShader);
    assert.ok(shader.includes("vec3 fallsSheet(vec2 p,float a)"));
    // Extract each actual attenuation up to its closing parenthesis.
    const weights = [
      ...shader.matchAll(
        /a[123]=1\.-smoothstep\(([\d.]+),([\d.]+),max\(fx\*([\d.]+),ft\*([\d.]+)\)\)/g,
      ),
    ];
    assert.equal(weights.length, 3);
    for (const [, lo, hi, across, along] of weights) {
      const weight = (fx, ft) => 1 - smoothstep(+lo, +hi, Math.max(fx * +across, ft * +along));
      assert.equal(weight(0, 0), 1);
      assert.equal(weight(1, 1), 0);
      assert.ok(weight(0.01, 0.01) >= weight(0.03, 0.03));
    }
    const impact = shader.match(/float impact=(smoothstep\([^;]+)\*\(\.5\+\.5\*bend\.x\);/)?.[1];
    assert.ok(impact);
    const envelope = new Function("v", "smoothstep", `return ${impact};`);
    assert.equal(envelope(1.4, smoothstep), 0, "no impact turbulence at the lip or upper fall");
    assert.equal(envelope(2, smoothstep), 1);
  } finally {
    falls.dispose();
  }
});

test("broader current clusters keep matched variance through partial footprints and fade to a stable mean", () => {
  const falls = createFalls({
    lib,
    clock: clock(),
    drop: riverFalls(RIVER_LINE),
    height: filmHeight(() => 0, true),
  });
  try {
    const shader = flat(falls.material.fragmentShader),
      weights = shader.match(/float streak=r1\*([\d.]+)\+r2\*([\d.]+)\+r3\*([\d.]+),d=([^;]+);/),
      variance = weights?.[4].match(/sqrt\(([\d.]+)\*a1\*a1\+([\d.]+)\*a2\*a2\+([\d.]+)\*a3\*a3\)/),
      filteredFrequency = Number(
        shader.match(/a1=1\.-smoothstep\([\d.]+,[\d.]+,max\(fx\*([\d.]+)/)?.[1],
      ),
      sampleFrequency = Number(shader.match(/float r1=[^;]+?vec2\(q\*([\d.]+)/)?.[1]);
    assert.ok(weights && variance);
    const w = weights.slice(1, 4).map(Number),
      squared = variance.slice(1, 4).map(Number),
      density = new Function(
        "streak",
        "a1",
        "a2",
        "a3",
        "smoothstep",
        "max",
        "sqrt",
        `return ${weights[4]};`,
      ),
      sample = (raw, attenuation) => {
        const streak = raw.reduce(
          (sum, value, i) => sum + w[i] * (0.5 + (value - 0.5) * attenuation[i]),
          0,
        );
        return density(streak, ...attenuation, smoothstep, Math.max, Math.sqrt);
      };
    assert.ok(Math.abs(w.reduce((sum, n) => sum + n, 0) - 1) < 1e-12);
    for (let i = 0; i < w.length; i++) assert.ok(Math.abs(squared[i] - w[i] ** 2) < 1e-12);
    assert.equal(
      filteredFrequency,
      sampleFrequency,
      "the actual broader current uses its own footprint",
    );
    assert.ok(
      sampleFrequency < 8,
      "the primary streams are a few across, with fine wisps independent",
    );
    assert.equal(sample([0.1, 0.9, 0.3], [0, 0, 0]), 0.5);
    const normalizedVariance = (a) => {
      const value = squared.reduce((sum, weight, i) => sum + weight * a[i] ** 2, 0);
      return value / Math.max(0.3, Math.sqrt(value)) ** 2;
    };
    assert.ok(
      Math.abs(normalizedVariance([1, 0, 0]) - normalizedVariance([1, 1, 1])) < 1e-12,
      "removing finer wisps does not amplify the coarse field by the old denominator",
    );
    for (const channel of [0, 1, 2]) {
      let previous;
      for (let step = 0; step <= 2000; step++) {
        const a = [1, 1, 1];
        a[channel] = step / 2000;
        const value = sample([0.73, 0.36, 0.61], a);
        assert.ok(Number.isFinite(value) && value >= 0 && value <= 1);
        if (previous !== undefined)
          assert.ok(Math.abs(value - previous) < 0.002, "continuous partial-footprint handoff");
        previous = value;
      }
    }
  } finally {
    falls.dispose();
  }
});

test("falling water keeps dark continuous thickness under white current and whitens into the impact at its foot", () => {
  const falls = createFalls({
    lib,
    clock: clock(),
    drop: riverFalls(RIVER_LINE),
    height: filmHeight(() => 0, true),
  });
  try {
    const shader = flat(falls.material.fragmentShader),
      toe = shader.match(/float toe=([^;]+);/)?.[1],
      travel = shader.match(/float tau=([^;]+);/)?.[1],
      froth = shader.match(/,mix\(([\d.]+),([\d.]+),d\),white\)/),
      body = shader.match(/water=mix\(water,lit\*([\d.]+),white\);/),
      whiten = shader.match(/foam=(mix\(foam,max\(foam,[^;]+\),toe\*[\d.]+\));/)?.[1],
      coarse = shader.match(/a1=1\.-smoothstep\([\d.]+,[\d.]+,max\(fx\*([\d.]+),ft\*([\d.]+)\)\)/);
    assert.ok(toe && travel && coarse && froth && body && whiten);
    const aeration = new Function(
        "vSeaY",
        "y",
        "smoothstep",
        `return ${toe.replace("vW.y", "y")};`,
      ),
      foot = new Function("foam", "toe", "r2", "mix", "max", `return ${whiten};`),
      mix = (a, b, t) => a + (b - a) * t,
      tau = new Function("vTravel", `return ${travel};`),
      clamp = (x, a, b) => Math.max(a, Math.min(b, x));
    const discard = [...shader.matchAll(/if\(([^;]+)\)discard;/g)];
    assert.equal(discard.length, 0, "closed physical walls define the silhouette and stay visible");
    const intensity = (density) =>
      +body[1] + (1 - +body[1]) * (+froth[1] + (+froth[2] - +froth[1]) * density);
    assert.ok(intensity(0) > 0.1 && intensity(0) < 0.25, "thin water is dark and continuous");
    assert.ok(
      intensity(1) / intensity(0) > 3.5,
      "aerated clusters retain depth rather than a flat grey floor",
    );
    // Above the impact the streams are as they are; at the foot they churn white.
    for (let foam = 0; foam <= 1; foam += 0.1)
      for (let r2 = 0; r2 <= 1; r2 += 0.25) {
        assert.equal(
          foot(foam, 0, r2, mix, Math.max),
          foam,
          "head and main current are not changed",
        );
        const atFoot = foot(foam, 1, r2, mix, Math.max);
        assert.ok(atFoot >= foam - 1e-9 && atFoot >= 0.6 && atFoot <= 1, "white where it lands");
      }
    assert.equal(aeration(SEA.level, SEA.level + 3, smoothstep), 0);
    assert.equal(aeration(SEA.level, SEA.level, smoothstep), 1);
    assert.ok(aeration(SEA.level, SEA.level + 1, smoothstep) > 0.4);
    const geometry = falls.mesh.geometry,
      { across, ring, rows } = geometry.userData.falls,
      middle = (across - 1) / 2,
      brink = FALLS.run * ring + middle,
      toeIndex = (rows - 1) * ring + across + 2 + across - 1 - middle,
      lowerTravel =
        tau(geometry.attributes.aTravel.getX(toeIndex)) -
        tau(geometry.attributes.aTravel.getX(brink)),
      ballisticTime = Math.sqrt(
        (2 *
          (geometry.attributes.position.getY(brink) -
            geometry.attributes.position.getY(toeIndex))) /
          32.2,
      );
    assert.ok(shader.includes("4.5*(tau-seaTime)"), "the streams move with the water itself");
    assert.ok(shader.includes("*(tau-seaTime)),seaTime*.3).x);"), "packets fall with the water");
    assert.ok(
      Math.abs(lowerTravel - ballisticTime) < 2e-6 && lowerTravel * +coarse[2] > 0.7,
      "the current turns over during the actual ballistic fall rather than an arbitrary normalized course",
    );
  } finally {
    falls.dispose();
  }
});
