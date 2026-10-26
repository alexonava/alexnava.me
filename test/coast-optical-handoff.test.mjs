import assert from "node:assert/strict";
import test from "node:test";
import { MeshStandardMaterial, Scene, ShaderLib, Vector3 } from "three";
import { createFalls, RAPIDS, RAPIDS_BODY, rapidsWeight, riverFalls } from "../src/scene/ocean.js";
import {
  RAPIDS_AT,
  PUDDLE_MIRROR,
  RIVER_LINE,
  filmHeight,
  riverAt,
  riverPoint,
  shadeSlateGround,
} from "../src/scene/terrain-build.js";
import { configureGroundShading, SLATE_LIGHT } from "../src/scene/mud-ground.js";

function owners() {
  const mood = { value: 1 },
    ground = new MeshStandardMaterial(),
    shader = {
      uniforms: {},
      vertexShader: ShaderLib.physical.vertexShader,
      fragmentShader: ShaderLib.physical.fragmentShader,
    };
  configureGroundShading(ground, true, { detail: { isTexture: true } });
  ground.onBeforeCompile(shader);
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
  const falls = createFalls({
    lib: {
      COAST_MOOD: mood,
      MIST_UNIFORMS: {},
      RANGE_MIST: { value: { x: 0, y: 0, z: 0, w: 0 } },
      FLASH_GROUND: { babelFlash: { value: { x: 0, y: 0, z: 0, w: 0 } } },
      SLATE_TEXT_GUARD: "",
      MIST_PARS: "",
    },
    clock: { uniform: { value: 0 }, tick: () => 0 },
    flow: shader.uniforms.slateFlow,
    rendering: { homeScene: new Scene(), tier: "high" },
    drop: riverFalls(RIVER_LINE),
    height: filmHeight(() => 0, true),
  });
  return {
    ground,
    shader,
    falls,
    dispose() {
      falls.dispose();
      ground.dispose();
    },
  };
}

// Read the coefficients delivered to each actual shader, then sample real
// joining geometry. This catches unequal caller frames even with an identical
// shared field implementation.
function coordinates(source, prefix) {
  const body = source.match(new RegExp(`vec2 ${prefix}UQ\\(vec2 xz\\)\\{([^}]+)\\}`))?.[1],
    vectors = [...body.matchAll(/vec2\(([-\d.]+),([-\d.]+)\)/g)].map((m) => m.slice(1).map(Number)),
    polynomial = source
      .match(
        new RegExp(
          `float ${prefix}RA\\(vec2 uq\\)\\{return max\\(uq.x-\\(([-\\d.]+)\\+([-\\d.]+)\\*uq.y\\+([-\\d.]+)\\*uq.y\\*uq.y\\),0.\\);\\}`,
        ),
      )
      ?.slice(1)
      .map(Number);
  assert.equal(vectors.length, 3);
  assert.equal(polynomial?.length, 3);
  const radius = source.match(
    prefix === "slateRp" ? /abs\(slateRpWorld.y\)\/([\d.]+)/ : /rpR=abs\(rpU.y\)\/([\d.]+)/,
  )?.[1];
  assert.ok(Number(radius) > 0);
  return (x, z) => {
    const [origin, head, perp] = vectors,
      d = [x - origin[0], z - origin[1]],
      u = -(d[0] * head[0] + d[1] * head[1]),
      q = d[0] * perp[0] + d[1] * perp[1],
      ra = Math.max(0, u - polynomial[0] - polynomial[1] * q - polynomial[2] * q * q),
      r = Math.abs(q) / Number(radius);
    return { q, ra, r, weight: rapidsWeight(ra, r), direction: [-head[0], -head[1]], across: perp };
  };
}

test("actual shared-head stations use one world frame, radius, slope basis and physical crest", () => {
  const o = owners();
  try {
    const ground = o.shader.fragmentShader,
      body = o.falls.material.fragmentShader,
      groundAt = coordinates(ground, "slateRp"),
      bodyAt = coordinates(body, "fallsRp"),
      p = o.falls.mesh.geometry.attributes.position,
      { across, ring } = o.falls.mesh.geometry.userData.falls;
    assert.match(
      ground,
      /if \(slateCoastStudy > \.5\) slateRpU = mix\(slateRpU, slateRpWorld, slateRpBlend\)/,
    );
    assert.match(ground, /slateRpDir = normalize\(mix\(slateRpDir, vec2\(/);
    assert.doesNotMatch(ground, /slateGC \*= 1\.0-\.55/);
    assert.match(body, /if\(coastStudy>\.5\)n=normalize\(mix\(vec3\(0\.,1\.,0\.\),n,fall\)\)/);
    assert.match(body, /raV=rpA;/);
    assert.match(body, /if\(coastStudy>\.5\)runFoam=rp.z;/);
    for (let row = 0; row <= 2; row++)
      for (let column = 0; column < across; column++) {
        const i = row * ring + column,
          g = groundAt(p.getX(i), p.getZ(i)),
          f = bodyAt(p.getX(i), p.getZ(i));
        assert.deepEqual(g, f, `same world input at actual station ${row}:${column}`);
        assert.ok(g.ra < 3, "every joining station uses the fully canonical frame");
        assert.ok(g.weight > 0.99, "the complete shared head is within full common support");
        for (const slope of [
          [0.1, 0.03],
          [-0.06, 0.07],
          [0, 0],
        ]) {
          const normal = (frame) =>
            new Vector3(
              -(frame.direction[0] * slope[0] + frame.across[0] * slope[1]),
              1,
              -(frame.direction[1] * slope[0] + frame.across[1] * slope[1]),
            ).normalize();
          assert.ok(normal(g).distanceTo(normal(f)) < 1e-12);
        }
      }
    assert.ok(
      Math.abs(RAPIDS_AT.half - Number(body.match(/rpR=abs\(rpU.y\)\/([\d.]+)/)[1])) < 1e-5,
    );
  } finally {
    o.dispose();
  }
});

test("the canonical join returns to the unchanged curved upstream frame before calm water", () => {
  const o = owners();
  try {
    const expression = o.shader.fragmentShader.match(
      /slateRpBlend = (1\.0-smoothstep\([^;]+);/,
    )?.[1];
    assert.ok(expression);
    const smoothstep = (a, b, x) => {
        const u = Math.max(0, Math.min(1, (x - a) / (b - a)));
        return u * u * (3 - 2 * u);
      },
      f = RAPIDS_AT,
      ra = ([u, q]) => Math.max(0, u - f.brink[0] - f.brink[1] * q - f.brink[2] * q * q),
      blend = new Function("slateRpWorld", "slateRpRA", "smoothstep", `return ${expression};`);
    let calm = 0;
    for (let distance = 0; distance <= 40; distance += 0.25)
      for (let across = -1; across <= 1; across += 0.1) {
        const [x, z, dx, dz] = riverPoint(f.s + distance),
          p = [x - dz * across * f.half, z + dx * across * f.half],
          r = riverAt(...p),
          d = [p[0] - f.lip[0], p[1] - f.lip[1]],
          world = [-d[0] * f.head[0] - d[1] * f.head[1], d[0] * f.perp[0] + d[1] * f.perp[1]],
          oldBlend = smoothstep(3, 8, world[0]),
          old = [
            world[0] + (r.s - f.s - world[0]) * oldBlend,
            world[1] + (r.d * r.side - world[1]) * oldBlend,
          ],
          b = blend(world, ra, smoothstep),
          current = old.map((v, i) => v + (world[i] - v) * b),
          radius = r.r + (Math.abs(world[1]) / f.half - r.r) * b;
        if (ra(old) >= RAPIDS.reach) {
          calm++;
          assert.equal(b, 0);
          assert.deepEqual(current, old);
          assert.equal(radius, r.r);
          assert.equal(rapidsWeight(ra(current), radius), 0);
        }
      }
    assert.ok(calm > 1500, "exercise real calm upstream water across its banks");
  } finally {
    o.dispose();
  }
});

test("the clear run and foam use the ground's existing albedo and legacy-light balance", () => {
  const o = owners();
  try {
    const ground = o.shader.fragmentShader,
      body = o.falls.material.fragmentShader,
      albedo = `vec3(${RAPIDS_BODY.map((v) => String(v)).join(",")})`,
      key = Number(body.match(/seaKey.y,0\.\)\*seaSun\*([\d.]+)/)?.[1]),
      fill = Number(body.match(/seaFill.y,0\.\)\*([\d.]+)/)?.[1]);
    assert.equal(key, SLATE_LIGHT.key);
    assert.equal(fill, SLATE_LIGHT.fill);
    assert.match(
      body,
      /runLight\+=\(\.3\*\(seaAmbient\+seaHemiSky\)\+1\.5\*runEnv\)\*vec3\(1\.14,1\.19,1\.25\)/,
    );
    assert.ok(ground.replaceAll(" ", "").includes(albedo));
    assert.ok(body.includes(albedo));
    assert.match(
      body,
      new RegExp(`lit=mix\\(runLight\\*${RAPIDS.albedo}\\*runDiffuse,lit,white\\)`),
    );
    assert.match(body, /if\(coastStudy<=\.5\)water\*=mix/);
    assert.equal((body.match(/seaEnv\(/g) || []).length, 3, "reuse the existing pool-light lookup");
  } finally {
    o.dispose();
  }
});

test("the coastal head matches cap reflection gain, horizon and mixed diffuse Fresnel", () => {
  const o = owners();
  try {
    const body = o.falls.material.fragmentShader,
      sky = body.match(/runSky=mix\(([\d.]+),runSky,white\)/)?.[1],
      expression = body.match(/runDiffuse=([^;]+);/)?.[1],
      attenuate = new Function("runF", "runCover", `return ${expression};`);
    assert.equal(Number(sky), PUDDLE_MIRROR.sky);
    assert.equal(PUDDLE_MIRROR.f0, 0.02);
    assert.equal(PUDDLE_MIRROR.knee, 0.5);
    assert.match(body, /R.y=mix\(R.y,max\(R.y,\.08\),white\)/);
    for (const F of [0.02, 0.1, 0.5, 0.9, 1])
      for (const foam of [0, 0.1, 0.5, 0.9, 1])
        for (const albedo of RAPIDS_BODY) {
          const cap = (albedo * (1 - foam) + RAPIDS.albedo * foam) * (1 - F * (1 - foam)),
            sheet = (albedo * (1 - foam) + RAPIDS.albedo * foam) * attenuate(F, foam);
          assert.equal(
            sheet,
            cap,
            "both owners attenuate the already mixed diffuse, including foam",
          );
        }
  } finally {
    o.dispose();
  }
});

test("the coast toe retains pool coverage and the airborne core shrinks toward the landing", () => {
  const o = owners();
  try {
    const body = o.falls.material.fragmentShader;
    assert.match(body, /if\(coastStudy>\.5\)foam=mix\(foam,\.8,toe\)/);
    assert.doesNotMatch(body, /if\(coastStudy>\.5\)foam=mix\(foam,1\.,toe\)/);
    assert.match(body, /vSeaY\+1\.2\+\.5\*bend.x/);
    assert.match(body, /if\(coastStudy>\.5\)\{k.y=1\.1;plumeHeight\*=\.6;plumeSize\*=\.65;\}/);
    const positions = o.falls.mesh.geometry.attributes.position,
      { rows, ring } = o.falls.mesh.geometry.userData.falls;
    for (let i = (rows - 1) * ring; i < rows * ring; i++) assert.equal(positions.getY(i), -13);
  } finally {
    o.dispose();
  }
});

test("one existing toe shadow lookup converges to the pool datum and keeps profile zero exact", () => {
  const o = owners();
  try {
    const body = o.falls.material.fragmentShader,
      block = body.match(/if\(coastStudy>\.5\)\{(shadowPoint=[^}]+)\}/)?.[1];
    assert.ok(block);
    assert.equal((body.match(/seaSun=seaShadow\(/g) || []).length, 1);
    const vec3 = (x, y, z) => ({ x, y, z }),
      mix = (a, b, t) => vec3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t),
      normalize = (n) => {
        const length = Math.hypot(n.x, n.y, n.z);
        return vec3(n.x / length, n.y / length, n.z / length);
      },
      evaluate = new Function(
        "coastStudy",
        "vW",
        "n",
        "vSeaY",
        "toe",
        "mix",
        "normalize",
        "vec3",
        `let shadowPoint=vW,shadowNormal=n;if(coastStudy>.5){${block}}return{point:shadowPoint,normal:shadowNormal};`,
      ),
      n = normalize(vec3(0.7, 0.1, 0.7));
    for (const y of [-13, -12, -11.5, -10]) {
      const p = vec3(83, y, 85);
      for (const toe of [0, 0.25, 0.5, 0.75, 1]) {
        assert.deepEqual(evaluate(0, p, n, -12, toe, mix, normalize, vec3), {
          point: p,
          normal: n,
        });
        const result = evaluate(1, p, n, -12, toe, mix, normalize, vec3);
        assert.ok(Object.values(result.point).every(Number.isFinite));
        assert.ok(Math.abs(Math.hypot(...Object.values(result.normal)) - 1) < 1e-12);
        if (toe === 1)
          assert.deepEqual(result, { point: vec3(p.x, -12, p.z), normal: vec3(0, 1, 0) });
      }
    }
  } finally {
    o.dispose();
  }
});
