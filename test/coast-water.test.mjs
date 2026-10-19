import assert from "node:assert/strict";
import test from "node:test";
import { Scene } from "three";
import {
  FALLS,
  FLOW_RMS,
  RAPIDS,
  SEA,
  alongToFault,
  createFalls,
  createSea,
  rapidsFrame,
  rapidsGlsl,
  rapidsTravel,
  rapidsWeight,
  rippleOctaves,
  riverFalls,
} from "../src/scene/ocean.js";
import { MIST_PARS, MIST_UNIFORMS } from "../src/scene/drifting-mist.js";
import { FLASH_GROUND } from "../src/scene/film-light.js";
import { HIGH_VIEW, RANGE_MIST, SEA_SINK } from "../src/scene/hill-silhouette.js";
import { SLATE_TEXT_GUARD } from "../src/scene/mud-ground.js";
import {
  dripClock,
  RAPIDS_AT,
  RIVER,
  RIVER_LINE,
  RIVER_NEAR,
  riverAt,
} from "../src/scene/terrain-build.js";

// What film-scene.js lends the sea (terrain-build.js settleRoots()'s `lib`).
const lib = {
  SLATE_TEXT_GUARD,
  MIST_PARS,
  MIST_UNIFORMS,
  FLASH_GROUND,
  RANGE_MIST,
  SEA_SINK,
  HIGH_VIEW,
};
const rendering = () => ({ homeScene: new Scene(), lights: {}, tier: "high" });

// The flow noise (ocean.js flowNoiseGlsl()) over seaHash, read back as JavaScript.
const fract = (x) => x - Math.floor(x);
function seaHash(x, y) {
  let q = [fract(x * 0.1031), fract(y * 0.1031), fract(x * 0.1031)];
  const d = q[0] * (q[1] + 33.33) + q[1] * (q[2] + 33.33) + q[2] * (q[0] + 33.33);
  q = q.map((v) => v + d);
  return fract((q[0] + q[1]) * q[2]);
}
function flow(px, py, a = 0) {
  const s = (px + py) * 0.3660254,
    ix = Math.floor(px + s),
    iy = Math.floor(py + s),
    t = (ix + iy) * 0.2113249,
    x0 = [px - ix + t, py - iy + t],
    o = x0[0] > x0[1] ? [1, 0] : [0, 1],
    x1 = [x0[0] - o[0] + 0.2113249, x0[1] - o[1] + 0.2113249],
    x2 = [x0[0] - 0.5773503, x0[1] - 0.5773503],
    corners = [
      [ix, iy, x0],
      [ix + o[0], iy + o[1], x1],
      [ix + 1, iy + 1, x2],
    ];
  let value = 0,
    gx = 0,
    gy = 0;
  for (const [cx, cy, [x, y]] of corners) {
    const h = seaHash(cx, cy),
      r = h * 6.2831853 + a * (h - 0.5) * 4,
      g = [Math.cos(r), Math.sin(r)],
      tt = Math.max(0.5 - x * x - y * y, 0),
      dot = g[0] * x + g[1] * y,
      m = -8 * tt ** 3 * dot;
    value += tt ** 4 * dot;
    gx += m * x + tt ** 4 * g[0];
    gy += m * y + tt ** 4 * g[1];
  }
  return [70 * value, 70 * gx, 70 * gy];
}
// A fixed sequence of points (no Math.random: the test holds still).
const points = (n, size, seed = 7) => {
  let state = seed;
  const next = () => (state = (state * 1103515245 + 12345) % 2147483648) / 2147483648;
  return [...Array(n)].map(() => [next() * size, next() * size]);
};

test("the sea's fine ripples: smooth flow noise, a slope that never steepens toward fine, the far water's roughness kept", () => {
  const octaves = rippleOctaves();
  assert.equal(octaves.length, SEA.ripple.octaves);
  for (let o = 1; o < octaves.length; o++) {
    assert.ok(Math.abs(octaves[o].l / octaves[o - 1].l - SEA.ripple.ratio) < 1e-9, "geometric");
    assert.ok(octaves[o].slope <= octaves[o - 1].slope, "a finer ripple is never steeper");
    assert.ok(octaves[o].turn > octaves[o - 1].turn, "finer ripples turn faster");
  }
  const finest = octaves.at(-1).l;
  assert.ok(finest >= 0.15 && finest <= 0.3, "down to about a fifth of a unit");
  // Together they hand the far water the roughness it had (three value-noise
  // octaves of slope 0.12 at 0.15 each: 0.00648).
  const variance = octaves.reduce((sum, { slope }) => sum + slope * slope, 0);
  assert.ok(Math.abs(variance - 3 * 0.15 * 0.12 ** 2) < 1e-4);
  assert.ok(SEA.ripple.balanced < SEA.ripple.octaves);
  const sea = createSea({ lib, clock: dripClock({ value: 0 }), rendering: rendering() }),
    fragment = sea.material.fragmentShader;
  // Every octave is the flow noise; the balanced tier keeps the coarser ones.
  assert.ok(fragment.includes("vec3 seaFlowD(vec2 p,float a){"));
  assert.equal(fragment.split("vec3 n=seaFlowD(").length - 1, SEA.ripple.octaves);
  assert.equal(
    fragment.split("if(seaFine>.5)").length - 1,
    SEA.ripple.octaves - SEA.ripple.balanced,
  );
  assert.ok(!fragment.includes("texture2D("), "procedural: no texture");
  // Where the normal turns within a pixel the mirror and the moon's lobe widen.
  assert.ok(fragment.includes("vec3 dN=fwidth(N);"));
  assert.ok(SEA.glitter.alpha >= 0.1 && SEA.knee + SEA.glitter.knee < 0.85);
  // The cliffs' image follows the swell, not the fine ripples.
  assert.ok(fragment.includes("vec3 Rt=reflect(V,normalize(vec3(-gw.x,1.,-gw.y)));"));
  assert.equal(sea.material.uniforms.seaFine.value, 1);
  sea.material.dispose();
});

test("the flow noise is smooth: its gradient is exact and it has none of the value noise's flat lattice lines", () => {
  let sum = 0,
    worst = 0;
  const samples = points(4000, 64);
  for (const [x, y] of samples) {
    const [, gx, gy] = flow(x, y, 1.3),
      h = 1e-4,
      fx = (flow(x + h, y, 1.3)[0] - flow(x - h, y, 1.3)[0]) / (2 * h),
      fy = (flow(x, y + h, 1.3)[0] - flow(x, y - h, 1.3)[0]) / (2 * h);
    worst = Math.max(worst, Math.abs(fx - gx), Math.abs(fy - gy));
    sum += gx * gx + gy * gy;
  }
  assert.ok(worst < 1e-3, `analytic gradient (worst ${worst})`);
  const rms = Math.sqrt(sum / samples.length);
  assert.ok(Math.abs(rms / FLOW_RMS - 1) < 0.03, `FLOW_RMS ${FLOW_RMS} measured ${rms}`);
  // Along the lines x = integer its slope across them is as large as anywhere
  // (the value noise's is exactly zero there: square tiles in a mirror).
  let on = 0,
    off = 0;
  for (const [x, y] of samples) {
    on += Math.abs(flow(Math.round(x), y)[1]);
    off += Math.abs(flow(x, y)[1]);
  }
  assert.ok(Math.abs(on / off - 1) < 0.1, `on ${on} off ${off}`);
});

test("the rapids quicken the river's last stretch toward the falls without shear, and only there", () => {
  assert.equal(RAPIDS.from, -RIVER.flow, "they start at the river's own current");
  assert.ok(
    RAPIDS.to > 2 && RAPIDS.to <= FALLS.push,
    "and reach about the falls' speed off the brink",
  );
  assert.ok(RAPIDS.albedo <= 0.5);
  // Travel time grows upstream; its slope (one over the speed) runs from the brink's speed to the river's.
  const speed = (ra, h = 1e-4) => (2 * h) / (rapidsTravel(ra + h) - rapidsTravel(ra - h));
  for (let ra = 0.1; ra < 30; ra += 0.5) assert.ok(rapidsTravel(ra + 0.5) > rapidsTravel(ra));
  assert.ok(Math.abs(speed(1e-3) - RAPIDS.to) < 0.01);
  assert.ok(Math.abs(speed(RAPIDS.reach - 1e-3) - RAPIDS.from) < 1e-3);
  assert.ok(Math.abs(speed(RAPIDS.reach + 1e-3) - RAPIDS.from) < 1e-3, "continuous at the reach");
  // The frame is the falls' own, and the river's own course meets it at the lip.
  const drop = riverFalls(RIVER_LINE),
    frame = rapidsFrame(drop);
  assert.deepEqual({ ...RAPIDS_AT, s: undefined }, { ...frame, s: undefined });
  assert.equal(RAPIDS_AT.s, riverAt(drop.lip[0], drop.lip[1]).s);
  // Each of the falls' streams breaks on its own brink: the fit holds them within 0.15.
  const [b0, b1, b2] = frame.brink;
  for (let c = 0; c < 15; c++) {
    const w = (c / 14) * 2 - 1,
      [hx, hz] = drop.heading,
      bx = drop.lip[0] - hz * drop.lip[2] * w,
      bz = drop.lip[1] + hx * drop.lip[2] * w,
      b = alongToFault(bx, bz, drop.heading, 0),
      dx = bx + hx * b - drop.lip[0],
      dz = bz + hz * b - drop.lip[1],
      q = dx * frame.perp[0] + dz * frame.perp[1],
      u = -(dx * hx + dz * hz);
    assert.ok(Math.abs(b0 + b1 * q + b2 * q * q - u) < 0.15);
  }
  // Near the lip the frame's distance up the flow is the river's own course's.
  for (const u of [2, 4, 6]) {
    const x = drop.lip[0] - drop.heading[0] * u,
      z = drop.lip[1] - drop.heading[1] * u;
    assert.ok(Math.abs(riverAt(x, z).s - RAPIDS_AT.s - u) < 0.3);
  }
  // Strong at the brink, nothing by the lantern or anywhere upstream of the reach.
  assert.ok(rapidsWeight(0.5, 0.5) > 0.9);
  assert.equal(rapidsWeight(RAPIDS.reach + 0.01, 0), 0);
  assert.ok(RIVER_NEAR - RAPIDS_AT.s > RAPIDS.reach + 8, "the lantern's stretch is calm");
  assert.equal(rapidsWeight(1, 1.25), 0, "and none past the banks");
});

test("the falls' run takes the shelf's rapids on the ground's clock, so they meet at its edge", () => {
  const drop = riverFalls(RIVER_LINE),
    clock = dripClock({ value: 0 }),
    flowClock = { value: 3 },
    falls = createFalls({
      lib,
      clock,
      rendering: rendering(),
      drop,
      height: () => 1.25,
      flow: flowClock,
    }),
    fragment = falls.material.fragmentShader;
  assert.equal(falls.material.uniforms.fallsFlow, flowClock);
  assert.ok(fragment.includes(rapidsGlsl("fallsRp", rapidsFrame(drop))));
  assert.ok(fragment.includes("vec4 rp=fallsRpRapids(rpU.y,rpA,a,fallsFlow,rpFP)*(1.-fall);"));
  falls.dispose();
  const alone = createFalls({ lib, clock, rendering: rendering(), drop, height: () => 1.25 });
  assert.equal(
    alone.material.uniforms.fallsFlow,
    clock.uniform,
    "without the ground's clock, the sea's",
  );
  alone.dispose();
});
