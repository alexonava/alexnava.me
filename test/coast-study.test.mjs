import test from "node:test";
import assert from "node:assert/strict";
import { MeshStandardMaterial, Scene, ShaderLib } from "three";
import { COAST_MOOD, shotLight } from "../src/scene/film-light.js";
import { DIRECTED_SHOTS, resolveDirectedShot } from "../src/scene/directed-shots.js";
import {
  COAST_SHOTS,
  createCliff,
  createFalls,
  createSea,
  riverFalls,
} from "../src/scene/ocean.js";
import { RIVER_LINE, filmHeight, shadeSlateGround } from "../src/scene/terrain-build.js";
import { configureGroundShading } from "../src/scene/mud-ground.js";

test("coastal study response belongs only to the three coast shots in every layout", () => {
  assert.equal(COAST_MOOD.value, 0, "the shared owner starts on the established response");
  assert.equal(shotLight().coastStudy, 0);
  for (const shot of [...DIRECTED_SHOTS.watch, ...DIRECTED_SHOTS.tree, ...COAST_SHOTS])
    for (const [width, height] of [
      [1920, 1080],
      [2560, 1080],
      [390, 844],
      [844, 390],
      [1080, 1920],
      [700, 480],
    ])
      assert.equal(
        shotLight(resolveDirectedShot(shot, width, height)).coastStudy,
        COAST_SHOTS.includes(shot) ? 1 : 0,
        `${shot.name} ${width}x${height}`,
      );
});

test("the actual ground borrows the common rapids slope and roughness only within its support", () => {
  const material = new MeshStandardMaterial(),
    mood = { value: 0 },
    shader = () => {
      const value = {
        uniforms: {},
        vertexShader: ShaderLib.physical.vertexShader,
        fragmentShader: ShaderLib.physical.fragmentShader,
      };
      material.onBeforeCompile(value);
      assert.equal(
        shadeSlateGround(value, {
          coastStudy: mood,
          coastAlbedo: { value: null },
          coastAlbedoOn: { value: 0 },
          coastDetail: { value: null },
          coastDetailOn: { value: 0 },
        }).puddles,
        true,
      );
      return value;
    };
  configureGroundShading(material, true, { detail: { isTexture: true } });
  try {
    const compiled = shader(),
      body = compiled.fragmentShader,
      local = body.match(
        /if \(slateCoastStudy > \.5\) \{\s*(slateBrink = [\s\S]*?slateRoughT = [^;]+;)\s*\}/,
      )?.[1],
      rough = body.match(/if \(slateCoastStudy > \.5\) (slateEnvRough = [^;]+;)/)?.[1];
    assert.equal(compiled.uniforms.slateCoastStudy, mood);
    assert.ok(local && rough, "evaluate the installed shader expressions, not a second formula");
    assert.match(body, /textureCubeUV\(envMap, slateR, slateEnvRough\)/);
    const evaluate = new Function(
        "slateCoastStudy",
        "slateRpA",
        "slateRpWt",
        "slateRoughT",
        "initial",
        "smoothstep",
        "max",
        "mix",
        `let slateBrink=0,slateGC=1,slateG=1,slateRpP={w:slateRoughT},slateEnvRough=initial;
         if(slateCoastStudy>.5){${local}} if(slateCoastStudy>.5){${rough}}
         return [slateBrink,slateGC,slateEnvRough];`,
      ),
      smoothstep = (a, b, v) => {
        const x = Math.max(0, Math.min(1, (v - a) / (b - a)));
        return x * x * (3 - 2 * x);
      },
      mix = (a, b, u) => a + (b - a) * u,
      run = (profile, distance, weight = 1) =>
        evaluate(profile, distance, weight, 0.7, 0.33, smoothstep, Math.max, mix);
    for (let distance = 0; distance <= 30; distance += 0.125) {
      assert.deepEqual(
        run(0, distance),
        [0, 1, 0.33],
        "Lantern study and the established path are exact",
      );
      assert.deepEqual(
        run(1, distance, 0),
        [0, 1, 0.33],
        "dry banks and absent rapids stay unchanged",
      );
      const [weight, slope, roughness] = run(1, distance);
      assert.ok(weight >= 0 && weight <= 1);
      assert.equal(slope, 1, "the ground never damps the shared current slope at the join");
      assert.ok(roughness >= 0.33 && roughness <= 0.6 + 1e-9);
      assert.ok(Math.abs(slope - run(1, distance + 0.001)[1]) < 0.001, "continuous local handoff");
    }
    assert.equal(run(1, 0)[2], 0.6, "the last run takes the falls' broad reflection lobe");
    const source = compiled.fragmentShader;
    mood.value = 1;
    assert.equal(compiled.uniforms.slateCoastStudy.value, 1);
    assert.equal(
      compiled.fragmentShader,
      source,
      "a cut changes the borrowed scalar, not the program owner",
    );
    assert.equal(shader().fragmentShader, source);
  } finally {
    material.dispose();
  }
});

test("coast materials borrow one cut-owned response without rebuilding physical water or rock", () => {
  const mood = { value: 0 },
    lib = {
      COAST_MOOD: mood,
      MIST_UNIFORMS: {},
      RANGE_MIST: { value: { x: 0, y: 0, z: 0, w: 0 } },
      FLASH_GROUND: { babelFlash: { value: { x: 0, y: 0, z: 0, w: 0 } } },
      SLATE_TEXT_GUARD: "",
      MIST_PARS: "",
    },
    clock = { uniform: { value: 0 }, tick: () => 0 },
    rendering = { homeScene: new Scene(), tier: "balanced" },
    height = filmHeight(() => 0, true),
    drop = riverFalls(RIVER_LINE),
    owners = [
      createSea({ lib, clock, rendering }),
      createCliff({ lib, clock, rendering, height, drop }),
      createFalls({ lib, clock, rendering, height, drop }),
    ];
  try {
    const geometry = owners.map(({ mesh }) => ({
      object: mesh.geometry,
      positions: mesh.geometry.attributes.position.array.slice(),
      indices: mesh.geometry.index?.array.slice(),
    }));
    mood.value = 1;
    owners.forEach(({ material, mesh }, i) => {
      assert.equal(material.uniforms.coastStudy, mood);
      assert.equal(material.lights, false, "the existing scene light owner remains authoritative");
      assert.equal(mesh.geometry, geometry[i].object);
      assert.deepEqual(mesh.geometry.attributes.position.array, geometry[i].positions);
      assert.deepEqual(mesh.geometry.index?.array, geometry[i].indices);
    });
    const splash = owners[2].splash;
    assert.equal(splash.material.uniforms.coastStudy, mood);
    mood.value = 0;
    owners.forEach(({ material }) => assert.equal(material.uniforms.coastStudy.value, 0));
  } finally {
    owners.forEach((owner) => owner.dispose());
  }
});
