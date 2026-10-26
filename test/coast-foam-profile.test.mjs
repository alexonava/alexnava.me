import test from "node:test";
import assert from "node:assert/strict";
import { MeshStandardMaterial, Scene, ShaderLib } from "three";
import {
  createFalls,
  RAPIDS,
  rapidsFrame,
  rapidsGlsl,
  rapidsSpeed,
  rapidsTravel,
  riverFalls,
} from "../src/scene/ocean.js";
import { RAPIDS_AT, RIVER_LINE, filmHeight, shadeSlateGround } from "../src/scene/terrain-build.js";
import { configureGroundShading } from "../src/scene/mud-ground.js";

const frame = rapidsFrame(riverFalls(RIVER_LINE));
const ordinary = rapidsGlsl("probe", frame),
  profiled = rapidsGlsl("probe", frame, RAPIDS, "coastProbe");
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const smoothstep = (a, b, x) => {
  const u = clamp((x - a) / (b - a), 0, 1);
  return u * u * (3 - 2 * u);
};
const mix = (a, b, u) => a + (b - a) * u;

function evaluator() {
  const initial = ordinary.match(/float foam=([^;]+);/)?.[1];
  const gate = profiled.match(/if\(coastProbe>\.5\)\{[\s\S]+?\n\}/)?.[0];
  assert.ok(initial && gate, "evaluate the actual emitted shader expressions");
  return new Function(
    "coastProbe",
    "ra",
    "streakFoam",
    "churn",
    "k",
    "ch1",
    "lace",
    "cell",
    "smoothstep",
    "mix",
    "max",
    "clamp",
    "q=0",
    "T=0",
    "sp=6.4",
    "fp=.01",
    "r=0",
    `let foam=${initial};${gate.replace(/\bfloat\b/g, "let").replace(/\bsqrt\(/g, "Math.sqrt(")};return clamp(foam,0,1);`,
  );
}

test("the optional coastal foam block leaves default GLSL and every sampled field unchanged", () => {
  const start = profiled.indexOf("// Near the brink"),
    tail = profiled.lastIndexOf("return vec4(g*w");
  assert.ok(start > 0 && tail > start);
  assert.equal(profiled.slice(0, start) + profiled.slice(tail), ordinary);
  assert.equal(rapidsGlsl("probe", frame, RAPIDS, null), ordinary);
  assert.equal(
    (profiled.match(/\bprobeF\(/g) || []).length,
    (ordinary.match(/\bprobeF\(/g) || []).length,
  );
  assert.equal((profiled.match(/\btexture\w*\(/g) || []).length, 0);
  assert.ok(!/\b(?:float|vec[234])\s+(?:flat|smooth|in|out|centroid)\b/.test(profiled));
});

test("unresolved coastal chop converges to its measured mean while resolved values stay exact", () => {
  const code = profiled.match(/float coastStretch=[\s\S]+?(?=float coastChurn=)/)?.[0];
  assert.ok(code);
  const evaluate = new Function(
    "q",
    "T",
    "sp",
    "fp",
    "ch1",
    "smoothstep",
    "mix",
    `${code.replace(/\bfloat\b/g, "let").replace(/\bsqrt\(/g, "Math.sqrt(")};return {span:coastChopSpan,resolve:coastChopResolve,value:coastChop};`,
  );
  // Two deterministic 1,048,576-point cohorts of the existing field give
  // 0.6659122264 and 0.6658622982; their pooled mean rounds to five decimals.
  const measuredMean = 0.66589,
    results = [];
  for (let x = -1; x <= 1; x += 0.025) {
    const near = evaluate(0, 0, RAPIDS.to, 0.001, { x }, smoothstep, mix);
    assert.equal(near.resolve, 1);
    assert.equal(near.value, mix(0.25, 1.15, smoothstep(0.3, 0.75, 0.5 + 0.5 * x)));
    const far = evaluate(0, 0, RAPIDS.to, 2, { x }, smoothstep, mix);
    assert.equal(far.resolve, 0);
    assert.equal(far.value, measuredMean);
    results.push(far.value);
  }
  assert.equal(Math.max(...results) - Math.min(...results), 0);
  const early = evaluate(0, rapidsTravel(0.5), rapidsSpeed(0.5), 0.1, { x: 0.5 }, smoothstep, mix);
  const later = evaluate(
    0,
    rapidsTravel(0.5) + 32,
    rapidsSpeed(0.5),
    0.1,
    { x: 0.5 },
    smoothstep,
    mix,
  );
  assert.equal(early.resolve, 1);
  assert.equal(later.resolve, 0, "time-compressed chop cannot bypass its pixel filter");
  assert.ok(later.span < early.span / 5);
  for (const ra of [0.5, 2, 6])
    for (const q of [-3, 0, 3])
      for (const time of [0, 8, 32, 120]) {
        const [b0, b1, b2] = frame.brink,
          u = ra + b0 + b1 * q + b2 * q * q,
          h = 0.0001;
        const coordinate = (u, q) => {
          const a = Math.max(0, u - b0 - b1 * q - b2 * q * q);
          return [q * RAPIDS.chop[0], (rapidsTravel(a) + time) * rapidsSpeed(a) * RAPIDS.chop[0]];
        };
        const du = coordinate(u + h, q).map((v, i) => (v - coordinate(u - h, q)[i]) / (2 * h));
        const dq = coordinate(u, q + h).map((v, i) => (v - coordinate(u, q - h)[i]) / (2 * h));
        const finiteFrequency = Math.hypot(...du, ...dq),
          value = evaluate(
            q,
            rapidsTravel(ra) + time,
            rapidsSpeed(ra),
            0.1,
            { x: 0.2 },
            smoothstep,
            mix,
          );
        assert.ok(
          Math.abs(value.span * finiteFrequency - 1) < 0.001,
          "analytic footprint matches finite-difference coordinate frequency",
        );
      }
});

test("profile zero and water beyond the fourteen-unit support preserve the old foam exactly", () => {
  const evaluate = evaluator();
  const run = (profile, ra, s, l, c = 1) =>
    evaluate(profile, ra, s, c, 0.7, { x: 0.15 }, l, 8, smoothstep, mix, Math.max, clamp);
  for (const s of [0, 0.1, 0.22, 0.5, 0.85, 1])
    for (const l of [0, 0.1, 0.5, 1])
      for (const c of [0, 0.2, 0.8, 1]) {
        const previous = run(0, 0, s, l, c);
        for (const ra of [0, 1, 2, 4, 8, 10, 12, 14, 16]) {
          assert.equal(run(0, ra, s, l, c), previous);
          if (ra >= RAPIDS.reach) assert.equal(run(1, ra, s, l, c), previous);
          assert.ok(run(1, ra, s, l, c) >= 0 && run(1, ra, s, l, c) <= 1);
        }
      }
  assert.equal(run(0, 0, 0, 1), 1, "old independent lace remains between absent packets");
  assert.equal(
    run(1, 2, 0, 1),
    0,
    "near-coast lace cannot form a complete cell scaffold between packets",
  );
  assert.ok(run(1, 0, 0.8, 0.3) > 0.2, "advected aerated packets remain visible");
  for (const boundary of [RAPIDS.waves[5], RAPIDS.reach]) {
    const center = run(1, boundary, 0.2, 1),
      h = 0.0001;
    assert.ok(Math.abs(run(1, boundary - h, 0.2, 1) - center) / h < 0.0001);
    assert.ok(Math.abs(run(1, boundary + h, 0.2, 1) - center) / h < 0.0001);
  }
});

test("the actual ground and falls borrow identical profile fields and one flow clock", () => {
  const mood = { value: 0 },
    material = new MeshStandardMaterial();
  const shader = {
    uniforms: {},
    vertexShader: ShaderLib.physical.vertexShader,
    fragmentShader: ShaderLib.physical.fragmentShader,
  };
  configureGroundShading(material, true, { detail: { isTexture: true } });
  material.onBeforeCompile(shader);
  assert.equal(
    shadeSlateGround(shader, {
      coastStudy: mood,
      coastAlbedo: { value: null },
      coastAlbedoOn: { value: 0 },
      coastDetail: { value: null },
      coastDetailOn: { value: 0 },
    }).puddles,
    true,
  );
  const lib = {
    COAST_MOOD: mood,
    MIST_UNIFORMS: {},
    RANGE_MIST: { value: { x: 0, y: 0, z: 0, w: 0 } },
    FLASH_GROUND: { babelFlash: { value: { x: 0, y: 0, z: 0, w: 0 } } },
    SLATE_TEXT_GUARD: "",
    MIST_PARS: "",
  };
  const falls = createFalls({
    lib,
    clock: { uniform: { value: 0 }, tick: () => 0 },
    flow: shader.uniforms.slateFlow,
    rendering: { homeScene: new Scene(), tier: "high" },
    drop: riverFalls(RIVER_LINE),
    height: filmHeight(() => 0, true),
  });
  try {
    const groundCode = rapidsGlsl("slateRp", RAPIDS_AT, RAPIDS, "slateCoastStudy"),
      fallsCode = rapidsGlsl("fallsRp", frame, RAPIDS, "coastStudy");
    assert.ok(shader.fragmentShader.includes(groundCode));
    assert.ok(falls.material.fragmentShader.includes(fallsCode));
    assert.equal(
      groundCode.replaceAll("slateRp", "probe").replaceAll("slateCoastStudy", "coastProbe"),
      fallsCode.replaceAll("fallsRp", "probe").replaceAll("coastStudy", "coastProbe"),
    );
    assert.equal(shader.uniforms.slateCoastStudy, mood);
    assert.equal(falls.material.uniforms.coastStudy, mood);
    assert.equal(falls.material.uniforms.fallsFlow, shader.uniforms.slateFlow);
    const before = [shader.fragmentShader, falls.material.fragmentShader];
    mood.value = 1;
    assert.equal(shader.uniforms.slateCoastStudy.value, 1);
    assert.equal(falls.material.uniforms.coastStudy.value, 1);
    assert.deepEqual([shader.fragmentShader, falls.material.fragmentShader], before);
  } finally {
    falls.dispose();
    material.dispose();
  }
});
