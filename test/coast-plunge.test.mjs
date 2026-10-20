import assert from "node:assert/strict";
import test from "node:test";
import { SEA, coastDistance, createSea, fallsGeometry, riverFalls } from "../src/scene/ocean.js";
import { filmHeight, RIVER_LINE } from "../src/scene/terrain-build.js";
import { flat } from "./support/code.mjs";

const smoothstep = (a, b, value) => {
  const t = Math.max(0, Math.min(1, (value - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function foamGate() {
  const sea = createSea({
    lib: {
      MIST_UNIFORMS: {},
      RANGE_MIST: { value: { x: 0, y: 0, z: 0, w: 0 } },
      FLASH_GROUND: { babelFlash: { value: { x: 0, y: 0, z: 0, w: 0 } } },
      SLATE_TEXT_GUARD: "",
      MIST_PARS: "",
    },
    clock: { uniform: { value: 0 }, tick: () => 0 },
  });
  try {
    const fragment = flat(sea.material.fragmentShader),
      gate = fragment.match(/if\((z<[^\{]+)\)\{\s*float swash=seaWash\(/),
      washEnd = Number(fragment.match(/wash=\.45\*\(1\.-smoothstep\(\.25,([\d.]+),pr\)/)?.[1]),
      near = fragment.match(/float foam=mix\(k,([^;]+),seaLace\*\(1\.-far\)\)/)?.[1],
      feather = fragment.match(/fw=([\d.]+)\+fp\*([\d.]+)/),
      distance = fragment.match(/far=clamp\(fp\*([\d.]+)-([\d.]+),0\.,1\.\)/);
    assert.ok(gate, "read the outer white-water gate from the delivered sea shader");
    assert.ok(washEnd > 0.25);
    assert.ok(
      near && feather && distance,
      "read the delivered fine-lace remap and footprint blend",
    );
    const expression = gate[1].replace("length(P.xz-seaFalls.xy)", "poolDistance()");
    return {
      fragment,
      gate: new Function("z", "sf", "seaFalls", "poolDistance", `return ${expression};`),
      washEnd,
      near: new Function("k", "fw", "lace", "smoothstep", `return ${near};`),
      feather: (fp) => Number(feather[1]) + fp * Number(feather[2]),
      far: (fp) => Math.max(0, Math.min(1, fp * Number(distance[1]) - Number(distance[2]))),
    };
  } finally {
    sea.dispose();
  }
}

test("the actual waterfall's outer fans survive crossing the near-shore surf cutoff", () => {
  const { gate, washEnd } = foamGate(),
    { geometry, plunge } = fallsGeometry(
      riverFalls(RIVER_LINE),
      filmHeight(() => 0, true),
    ),
    [x, z, radius] = plunge,
    falls = { x, y: z, z: radius, w: 1 };
  try {
    let beyond = 0;
    for (let angle = 0; angle < Math.PI * 2; angle += 0.05)
      for (let pr = 0.3; pr < washEnd; pr += 0.01) {
        const distance = pr * radius,
          px = x + Math.cos(angle) * distance,
          pz = z + Math.sin(angle) * distance,
          depth = -coastDistance(px, pz);
        if (depth <= SEA.surf.reach) continue;
        beyond++;
        assert.equal(
          gate(depth, 0, falls, () => distance),
          true,
          `fan at ${px},${pz}`,
        );
      }
    assert.ok(beyond > 50, "the delivered pool has substantial support outside the old gate");
    // At the existing wash's endpoint the new gate stops; it does not enlarge the pool.
    for (const pr of [washEnd, washEnd + 0.001, 1, 2])
      assert.equal(
        gate(SEA.surf.reach + 1, 0, falls, () => pr * radius),
        false,
      );
  } finally {
    geometry.dispose();
  }
});

test("plunge backwash clears the steady shore blanket while retaining the impact, outer coast and stack foam", () => {
  const { fragment, near, feather, far } = foamGate(),
    clearing = fragment.match(/shore=(1\.-[^;]+);/)?.[1],
    coreExpression = fragment.match(/float core=(1\.-smoothstep\([^)]+\)),wash=/)?.[1],
    washExpression = fragment.match(/,wash=([^;]+);/)?.[1],
    coverageExpression = fragment.match(/k=(max\(k\*shore,max\(core,wash\)\));/)?.[1],
    // The shore's wash at its mean (it pulses with the swell).
    meanExpression = fragment
      .match(/foam=mix\(foam,max\(([^;]+),[\d.]+\*sf\),far\);/)?.[1]
      ?.replace("swash", "0.5"),
    finishExpression = fragment.match(/foam=(mix\(foam,max\([^;]+\),far\));/)?.[1];
  assert.ok(
    clearing &&
      coreExpression &&
      washExpression &&
      coverageExpression &&
      meanExpression &&
      finishExpression,
  );
  const clear = new Function("pr", "smoothstep", `return ${clearing};`),
    core = new Function("pr", "smoothstep", `return ${coreExpression};`),
    // boil: the boils' foam share (their borders, broken), 0 to 1.
    wash = new Function(
      "pr",
      "boil",
      "lace",
      "smoothstep",
      "mix",
      `return ${washExpression
        .replace("seaFoam(pool*3.+seaTime*.08)", "lace")
        .replace(
          "(1.-smoothstep(0.,bw,cell))*smoothstep(.15,.6,seaFoam(pool*7.-seaTime*.07))",
          "boil",
        )};`,
    ),
    coverage = new Function("k", "shore", "core", "wash", "max", `return ${coverageExpression};`),
    mean = new Function("z", "shore", "smoothstep", `return ${meanExpression};`),
    finish = new Function(
      "foam",
      "z",
      "shore",
      "sf",
      "far",
      "smoothstep",
      "mix",
      "max",
      `return ${finishExpression.replace("swash", "0.5")};`,
    ),
    mix = (a, b, u) => a + (b - a) * u,
    sample = (pr, boil, lace, k = 0.75) =>
      coverage(
        k,
        clear(pr, smoothstep),
        core(pr, smoothstep),
        wash(pr, boil, lace, smoothstep, mix),
        Math.max,
      );
  assert.ok(
    fragment.indexOf("shore=1.;") >= 0 &&
      fragment.indexOf("shore=1.;") <
        fragment.indexOf("if(seaFalls.w>0.)", fragment.indexOf("shore=1.;")),
    "without a pool the shore starts unchanged",
  );
  assert.ok(
    fragment.indexOf("k=max(k,sf*(") > fragment.indexOf("k=max(k*shore,"),
    "stack surf is restored independently of the plunge's clearing",
  );
  assert.doesNotMatch(fragment, /fan=sin\(/, "no rings of foam about the impact");
  assert.ok(fragment.includes("cell=seaCells(vec2(log(pr+.08)*"), "boils spreading outward");
  for (const pr of [0, 0.03, 0.06])
    assert.equal(sample(pr, 0, 0), 1, "impact contact remains connected");
  const boils = [];
  for (let boil = 0; boil <= 1; boil += 0.05) boils.push(sample(0.3, boil, 0.5));
  assert.ok(
    Math.max(...boils) - Math.min(...boils) > 0.15,
    "the boils break the uniform near-shore blanket",
  );
  assert.ok(Math.max(...boils) < 0.5, "no flat .75-coverage plate between impacts");
  assert.ok(mean(0, clear(0.3, smoothstep), smoothstep) < mean(0, 1, smoothstep) * 0.25);
  for (const pr of [0.95, 1, 2]) {
    assert.equal(clear(pr, smoothstep), 1);
    assert.equal(sample(pr, 0, 0), 0.75, "outside the existing pool the coast is unchanged");
    assert.equal(mean(0, clear(pr, smoothstep), smoothstep), mean(0, 1, smoothstep));
  }
  const shaded = (k, shore, sf, fp, tier) => {
    const f = far(fp),
      fine = mix(k, near(k, feather(fp), 0.6, smoothstep), tier * (1 - f));
    return finish(fine, 0, shore, sf, f, smoothstep, mix, Math.max);
  };
  for (const tier of [0, 1])
    for (const fp of [0.01, 0.6, 1.2, 3]) {
      assert.ok(
        shaded(sample(0.3, 0, 0.5), clear(0.3, smoothstep), 0, fp, tier) <
          shaded(0.75, 1, 0, fp, tier),
        "both tiers and near/far footprints clear the generic blanket",
      );
      assert.equal(
        shaded(Math.max(sample(0.3, 0, 0.5), 1), clear(0.3, smoothstep), 1, fp, tier),
        shaded(1, 1, 1, fp, tier),
        "a stronger stack contribution retains both resolved foam and its far mean",
      );
      assert.equal(
        shaded(sample(0.95, 0, 0.5), clear(0.95, smoothstep), 0, fp, tier),
        shaded(0.75, 1, 0, fp, tier),
        "the exact existing pool boundary retains its coast coverage",
      );
    }
  let previous = clear(0.94, smoothstep);
  for (let pr = 0.94; pr <= 0.96; pr += 0.0001) {
    const value = clear(pr, smoothstep);
    assert.ok(value >= previous - 1e-12 && value - previous < 0.00002);
    previous = value;
  }
});

test("the actual lace remap removes the reported nonzero foam at zero pool coverage", () => {
  const { near, feather, far } = foamGate(),
    fp = 0.6,
    lace = 0.7512598368142671,
    f = far(fp),
    fw = feather(fp),
    // At P=[89.1051,82.2565], time=.1, the existing procedural lace has this
    // value on the pool's .95-radius edge, beyond the coast and stack bands.
    old = smoothstep(1 - fw, 1 + fw, lace) * (1 - f) ** 2;
  assert.ok(old > 0.13, "the original gate cut off visible lace even when wash was zero");
  for (const seaLace of [1, 0]) {
    const value = near(0, fw, lace, smoothstep) * seaLace * (1 - f) ** 2;
    assert.equal(value, 0, seaLace ? "high has no exposed edge" : "balanced stays at zero");
  }
});

test("pool foam reaches zero continuously and retains established high and balanced coverage", () => {
  const { near, feather, far, washEnd } = foamGate(),
    lace = 0.7512598368142671,
    // Outside the shore/stack bands the far white-water mean is zero. Evaluate
    // the shader's existing two blends, with only its actual near remap changed.
    coverage = (k, fp, seaLace, legacy = false) => {
      const f = far(fp),
        fw = feather(fp),
        fine = legacy ? smoothstep(1 - k - fw, 1 - k + fw, lace) : near(k, fw, lace, smoothstep);
      return (k + (fine - k) * seaLace * (1 - f)) * (1 - f);
    };
  for (const seaLace of [1, 0]) {
    let previous = Infinity;
    for (const gap of [0.1, 0.01, 0.001, 0.0001, 0.00001, 0]) {
      const pr = washEnd - gap,
        k = 0.45 * (1 - smoothstep(0.25, washEnd, pr)),
        value = coverage(k, 0.6, seaLace);
      assert.ok(
        value >= 0 && value <= previous + 1e-12,
        "the wash fades smoothly toward its endpoint",
      );
      previous = value;
      if (gap <= 0.0001) assert.ok(value < 1e-6, "no finite lace fringe remains near the cutoff");
    }
    assert.equal(previous, 0);
    for (const fp of [0.01, 0.6, 1.2])
      for (const k of [0.02, 0.025, 0.1, 0.4, 0.75])
        assert.ok(
          Math.abs(coverage(k, fp, seaLace) - coverage(k, fp, seaLace, true)) < 1e-12,
          "coverage at and above .02 and its far mean remain unchanged",
        );
  }
});

test("plunge gating keeps shore and stack surf, and bypasses an absent pool safely", () => {
  const { gate } = foamGate(),
    absent = { x: 0, y: 0, z: 0, w: 0 },
    unused = () => assert.fail("disabled pool must not be sampled");
  assert.equal(gate(SEA.surf.reach - 0.001, 0, absent, unused), true);
  assert.equal(gate(SEA.surf.reach + 1, 0.01, absent, unused), true);
  assert.equal(gate(SEA.surf.reach + 1, 0, absent, unused), false);
});
