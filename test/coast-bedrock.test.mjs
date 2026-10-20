import assert from "node:assert/strict";
import test from "node:test";
import { MeshStandardMaterial, ShaderLib } from "three";
import { coastDistance, COAST } from "../src/scene/ocean.js";
import { configureGroundShading } from "../src/scene/mud-ground.js";
import {
  COAST_BEDROCK,
  coastBedrockWeight,
  shadeCoastBedrock,
  shadeSlateGround,
} from "../src/scene/terrain-build.js";

test("exposed coastal bedrock has bounded continuous coverage, full at the lip and absent inland", () => {
  let lip = 0,
    inland = 0;
  const bearing = (COAST.bearing * Math.PI) / 180,
    n = [Math.cos(bearing), Math.sin(bearing)];
  for (let s = -160; s <= 160; s += 2.3) {
    // Bisect the unchanged shared coastline equation instead of restating it.
    const t = [-n[1] * s, n[0] * s];
    let lo = 70,
      hi = 165;
    for (let k = 0; k < 45; k++) {
      const mid = (lo + hi) / 2;
      if (coastDistance(t[0] + n[0] * mid, t[1] + n[1] * mid) > 0) lo = mid;
      else hi = mid;
    }
    const x = t[0] + (n[0] * (lo + hi)) / 2,
      z = t[1] + (n[1] * (lo + hi)) / 2;
    assert.equal(coastBedrockWeight(x, z), 1);
    lip++;
    for (let d = 0; d < 70; d += 0.125) {
      const a = coastBedrockWeight(x - n[0] * d, z - n[1] * d),
        b = coastBedrockWeight(x - n[0] * (d + 0.001), z - n[1] * (d + 0.001));
      assert.ok(Number.isFinite(a) && a >= 0 && a <= 1);
      assert.ok(Math.abs(a - b) < 0.005, "no threshold seam on a smooth coast segment");
      if (coastDistance(x - n[0] * d, z - n[1] * d) > COAST_BEDROCK.far + COAST_BEDROCK.wobble) {
        assert.equal(a, 0);
        inland++;
      }
    }
  }
  assert.ok(lip > 100 && inland > 1000);
});

test("the shelf and ground share optional albedo and detail bindings without recompiling when a tile lands", () => {
  const material = new MeshStandardMaterial();
  configureGroundShading(material, true, { detail: { isTexture: true } });
  const shader = {
    uniforms: {},
    vertexShader: ShaderLib.physical.vertexShader,
    fragmentShader: ShaderLib.physical.fragmentShader,
  };
  material.onBeforeCompile(shader);
  const uniforms = {
    coastAlbedo: { value: null },
    coastAlbedoOn: { value: 0 },
    coastDetail: { value: null },
    coastDetailOn: { value: 0 },
  };
  assert.equal(shadeSlateGround(shader, uniforms).shore, true);
  for (const name of Object.keys(uniforms)) assert.equal(shader.uniforms[name], uniforms[name]);
  const before = shader.fragmentShader;
  uniforms.coastAlbedo.value = uniforms.coastDetail.value = { isTexture: true };
  uniforms.coastAlbedoOn.value = uniforms.coastDetailOn.value = 1;
  assert.equal(shader.fragmentShader, before);
  assert.match(before, /if\(coastAlbedoOn>\.5\)/);
  // Two turned lookups of each map, blended by a noise, so the tile never repeats.
  assert.equal(before.match(/texture2D\(coastAlbedo,rock[UV]\)/g).length, 2);
  assert.equal(before.match(/texture2D\(coastDetail,rock[UV]\)/g).length, 2);
  assert.match(before, /rockV=mat2\(0\.28,0\.96,-0\.96,0\.28\)\*rockU\*0\.83\+vec2\(0\.41,0\.17\)/);
  // The rock's own detail in place of the soil's relief; without the map, the soil's flattened.
  assert.match(
    before,
    /\*rockR,slateBedrock\)\);\n\}else normal=normalize\(mix\(normal,nonPerturbedNormal,slateBedrock\*\.8\)\);/,
  );
  material.dispose();
});

test("the shelf's rock never takes the close soil's crumbs and keeps only its grit", () => {
  const map = { isTexture: true };
  const build = (maps) => {
    const material = new MeshStandardMaterial();
    configureGroundShading(material, true, maps);
    const shader = {
      uniforms: {},
      vertexShader: ShaderLib.physical.vertexShader,
      fragmentShader: ShaderLib.physical.fragmentShader,
    };
    material.onBeforeCompile(shader);
    assert.equal(shadeSlateGround(shader).shore, true);
    material.dispose();
    return shader.fragmentShader;
  };
  const close = build({ detail: map, grit: map, relief: map });
  const keep = close.indexOf(
    `slateCG=mix(slateCG,.5+(slateCG-slateCK-.5)*${COAST_BEDROCK.grit.toFixed(1)},slateBedrock);`,
  );
  // After the crumbs are counted and the rock's colour laid, before the soil's grit scales the albedo.
  assert.ok(keep > close.indexOf("float slateCK = slateCrumb*"));
  assert.ok(keep > close.indexOf("diffuseColor.rgb=mix(diffuseColor.rgb,rockColour,"));
  assert.ok(keep < close.indexOf("diffuseColor.rgb *= 1.+(slateCG-.5)*"));
  // Without the close soil there is nothing to keep off the rock.
  assert.doesNotMatch(build({ detail: map }), /slateCK/);
});

test("missing bedrock anchors leave every shader field and borrowed binding unchanged", () => {
  const shader = {
      uniforms: { keep: { value: 4 } },
      fragmentShader: "#define STANDARD\ndiffuseColor *= sampledDiffuseColor;",
    },
    original = shader.fragmentShader,
    originalUniforms = { ...shader.uniforms };
  assert.equal(
    shadeCoastBedrock(shader, {
      coastAlbedo: { value: {} },
      coastAlbedoOn: { value: 1 },
      coastDetail: { value: {} },
      coastDetailOn: { value: 1 },
    }),
    false,
  );
  assert.equal(shader.fragmentShader, original);
  assert.deepEqual(shader.uniforms, originalUniforms);
});
