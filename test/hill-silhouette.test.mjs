import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { flat } from "./support/code.mjs";
import {
  BufferGeometry,
  FrontSide,
  Group,
  NoBlending,
  PerspectiveCamera,
  ShaderMaterial,
  Vector3,
} from "three";
import {
  createHillGeometry,
  createHillSilhouette,
  HILL,
  HILL_PROFILE,
  HORIZON_HAZE,
  MOUNTAIN_AIR,
  mountainBody,
  RANGE_MIST,
  RANGE_MIST_SHAPE,
  SNOW,
  snowReach,
  TERRAIN_HORIZON,
} from "../src/scene/hill-silhouette.js";
import {
  buildMountains,
  createMountainGeometry,
  MOUNTAIN_ENTRANCE,
  MOUNTAINS,
  mountainCrests,
  mountainRows,
  sectorsInView,
  showRanges,
} from "../src/scene/mountain-build.js";
import { FILM_SKY_GLSL } from "../src/scene/estate-sky.js";
import { createStarfield } from "../src/scene/starfield.js";

const near = (a, b, eps = 1e-4) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const groundHeight = (x, z) => 1.2 * Math.sin(0.05 * x) + 0.8 * Math.cos(0.04 * z);

test("the real-elevation profile is a normalized, non-trivial circular sample set", () => {
  assert.ok(HILL_PROFILE.length >= 24);
  for (const v of HILL_PROFILE) assert.ok(v >= 0 && v <= 1);
  assert.ok(Math.max(...HILL_PROFILE) > 0.5, "profile should have real relief, not a flat line");
  assert.ok(Math.min(...HILL_PROFILE) < Math.max(...HILL_PROFILE) * 0.5);
});

test("the hill ring is continuous with the walkable terrain at its inner edge and rises smoothly outward", () => {
  const geometry = createHillGeometry({ groundHeight });
  const p = geometry.attributes.position;
  const cols = HILL.radialSegments + 1;
  // Inner ring (ring 0) must sit exactly on groundHeight — the same function
  // the walkable terrain uses — so there is no seam where the two meet.
  for (let seg = 0; seg <= HILL.radialSegments; seg++) {
    const x = p.getX(seg),
      z = p.getZ(seg),
      y = p.getY(seg);
    near(y, groundHeight(x, z));
    near(Math.hypot(x, z), HILL.innerRadius, 1e-3);
  }
  // Outer ring sits at outerRadius, and every vertex on the mesh stays within
  // [innerRadius, outerRadius] — no geometry escapes the intended band.
  const outerRow = HILL.ringSegments * cols;
  for (let seg = 0; seg <= HILL.radialSegments; seg++) {
    const i = outerRow + seg;
    near(Math.hypot(p.getX(i), p.getZ(i)), HILL.outerRadius, 1e-3);
  }
  for (let i = 0; i < p.count; i++) {
    const r = Math.hypot(p.getX(i), p.getZ(i));
    assert.ok(r >= HILL.innerRadius - 1e-3 && r <= HILL.outerRadius + 1e-3);
  }
  geometry.dispose();
});

test("innerRadius clears the directed shots' widest camera distance with margin", () => {
  // "Under the branches", the widest low wide-angle shot, puts the camera at
  // roughly radius 116 from the origin — a camera inside the ring's own
  // footprint previously rendered as a solid dark wedge filling the frame.
  const widestShotCameraDistance = 116;
  assert.ok(HILL.innerRadius > widestShotCameraDistance * 1.1);
});

test("createHillSilhouette builds a visible, shadow-free mesh, hides it on low tier, and disposes cleanly", () => {
  const hill = createHillSilhouette({ groundHeight });
  assert.equal(hill.mesh.name, "hill-silhouette");
  assert.equal(hill.mesh.castShadow, false);
  assert.equal(hill.mesh.receiveShadow, false);
  assert.equal(hill.mesh.visible, true);
  hill.applyQuality({ tier: "high" });
  assert.equal(hill.mesh.visible, true);
  hill.applyQuality({ tier: "balanced" });
  assert.equal(hill.mesh.visible, true);
  hill.applyQuality({ tier: "low" });
  assert.equal(hill.mesh.visible, false);
  hill.applyQuality({ tier: "high" });
  assert.equal(hill.mesh.visible, true);
  let geometryDisposed = 0,
    materialDisposed = 0;
  hill.mesh.geometry.addEventListener("dispose", () => geometryDisposed++);
  hill.mesh.material.addEventListener("dispose", () => materialDisposed++);
  assert.equal(hill.dispose(), true);
  assert.equal(hill.dispose(), false);
  assert.equal(geometryDisposed, 1);
  assert.equal(materialDisposed, 1);
  assert.equal(hill.mesh.parent, null);
  // Calling applyQuality after disposal must not resurrect visibility.
  assert.equal(hill.applyQuality({ tier: "high" }), false);
});

test("custom radii and amplitude are honoured by the geometry factory", () => {
  const geometry = createHillGeometry({
    groundHeight,
    innerRadius: 40,
    outerRadius: 60,
    amplitude: 5,
    radialSegments: 16,
    ringSegments: 2,
  });
  const p = geometry.attributes.position;
  assert.equal(p.count, 17 * 3);
  for (let i = 0; i < p.count; i++) {
    const r = Math.hypot(p.getX(i), p.getZ(i));
    assert.ok(r >= 40 - 1e-3 && r <= 60 + 1e-3);
    assert.ok(p.getY(i) <= 5 + 1e-3);
  }
  geometry.dispose();
});

// Film mountains (mountain-build.js): crests are elevation angles in degrees per world azimuth.
const crests = mountainCrests();
const skyline = crests[0].map((_, j) => Math.max(...crests.map((range) => range[j])));
const step = 360 / MOUNTAINS.columns;
const columnOf = (azimuth) =>
  Math.round((((azimuth % 360) + 360) % 360) / step) % MOUNTAINS.columns;
function columns(from, to) {
  const out = [];
  for (let a = from; a <= to + 1e-9; a += step) out.push(columnOf(a));
  return out;
}
const highest = (profile, from, to) => Math.max(...columns(from, to).map((j) => profile[j]));
function correlation(a, b) {
  const mean = (v) => v.reduce((x, y) => x + y) / v.length,
    ma = mean(a),
    mb = mean(b);
  let ab = 0,
    aa = 0,
    bb = 0;
  for (let i = 0; i < a.length; i++) {
    ab += (a[i] - ma) * (b[i] - mb);
    aa += (a[i] - ma) ** 2;
    bb += (b[i] - mb) ** 2;
  }
  return ab / Math.sqrt(aa * bb);
}
const rotate = (profile, by) => profile.map((_, j) => profile[(j + by) % profile.length]);
const elevationOf = (p, i) =>
  (Math.atan2(p.getY(i), Math.hypot(p.getX(i), p.getZ(i))) * 180) / Math.PI;
const geometry = createMountainGeometry();
const perRange = MOUNTAINS.rows.length * MOUNTAINS.columns;

test("film mountains are five camera-centred ranges of rows x columns in one wrapped Uint16 mesh that faces the centre", () => {
  const { radii, rows, columns: n, foot } = MOUNTAINS,
    p = geometry.attributes.position,
    terrain = geometry.attributes.aTerrain,
    form = geometry.attributes.aForm,
    index = geometry.index.array;
  // Six rows by 2160 columns per range: 64,800 vertices, still inside Uint16 indices.
  assert.equal(rows.length, 6);
  assert.equal(n, 2160);
  assert.equal(p.count, radii.length * rows.length * n);
  assert.ok(p.count < 65536, "Uint16 indices");
  assert.ok(index instanceof Uint16Array);
  assert.equal(index.length / 3, radii.length * (rows.length - 1) * n * 2);
  assert.equal(
    geometry.attributes.normal,
    undefined,
    "the shader lights each pixel, so no normal ships",
  );
  assert.equal(terrain.itemSize, 4);
  assert.equal(form.itemSize, 4);
  radii.forEach((radius, range) => {
    for (let j = 0; j < n; j++) {
      const crest = range * perRange + j,
        base = crest + (rows.length - 1) * n;
      near(Math.hypot(p.getX(crest), p.getZ(crest)), radius, 1e-3);
      near(elevationOf(p, crest), crests[range][j], 1e-3);
      assert.equal(terrain.getX(crest), 0);
      assert.equal(terrain.getY(crest), range);
      near(elevationOf(p, base), foot, 1e-3);
      // Each row sits on its own radius, strictly below the row above it.
      for (let row = 1; row < rows.length; row++) {
        const v = crest + row * n;
        near(Math.hypot(p.getX(v), p.getZ(v)), radius * rows[row], 1e-3);
        assert.ok(
          elevationOf(p, v - n) - elevationOf(p, v) >= 0.08 - 1e-4,
          `range ${range} column ${j} row ${row}`,
        );
        near(terrain.getX(v), crests[range][j] - elevationOf(p, v), 1e-3);
      }
    }
    // Each range's quad from the last column wraps to column 0: no duplicate seam column at azimuth 0.
    let wraps = 0;
    for (let t = 0; t < index.length; t += 6)
      if (Math.floor(index[t] / perRange) === range && index[t] % n === n - 1) {
        assert.deepEqual(
          [...index.subarray(t, t + 6)].map((v) => v % n),
          [n - 1, n - 1, 0, n - 1, 0, 0],
        );
        wraps++;
      }
    assert.equal(wraps, rows.length - 1);
  });
  // Every quad once (sector by sector: see the sectors test).
  assert.equal(
    new Set(Array.from({ length: index.length / 6 }, (_, q) => index[q * 6])).size,
    index.length / 6,
  );
  for (let t = 0; t < index.length; t += 3) {
    const [a, b, c] = [0, 1, 2].map((k) => [
      p.getX(index[t + k]),
      p.getY(index[t + k]),
      p.getZ(index[t + k]),
    ]);
    const u = b.map((v, k) => v - a[k]),
      v = c.map((w, k) => w - a[k]);
    const nx = u[1] * v[2] - u[2] * v[1],
      nz = u[0] * v[1] - u[1] * v[0];
    assert.ok(
      nx * (a[0] + b[0] + c[0]) + nz * (a[2] + b[2] + c[2]) < 0,
      `triangle ${t / 3} faces outward`,
    );
  }
  // The rows are progressively smoothed crests, so lower spurs broaden downward.
  const rowsOf = mountainRows(crests[4]),
    roughness = (row) => row.reduce((sum, e, j) => sum + Math.abs(row[(j + 1) % n] - e), 0);
  for (let row = 1; row < rowsOf.length - 1; row++)
    assert.ok(roughness(rowsOf[row]) < roughness(rowsOf[row - 1]));
});

test("aForm carries each face's turn, lean and fold and the nearer ranges' skyline", () => {
  const form = geometry.attributes.aForm,
    n = MOUNTAINS.columns;
  for (let v = 0; v < form.count; v++) {
    const range = Math.floor(v / perRange),
      j = v % n;
    assert.ok(Math.abs(form.getX(v)) <= 3 + 1e-6, "face turn clamped to +-3");
    assert.ok(form.getY(v) > 0.4 && form.getY(v) <= 1.35 + 1e-6, "leans toward the viewer");
    assert.ok(Math.abs(form.getZ(v)) <= 1 + 1e-6, "fold clamped to +-1");
    if (range === 0) assert.equal(form.getW(v), -90);
    else near(form.getW(v), Math.max(-5, ...crests.slice(0, range).map((crest) => crest[j])), 1e-3);
  }
  // The lean eases from the crest to the feet, and farther ranges lean less.
  assert.ok(form.getY(0) > form.getY(5 * n));
  assert.ok(form.getY(0) > form.getY(4 * perRange));
  // The watch summit (150 degrees, far range) under the moon key (32, 28, 14):
  // the flank turned toward it is lit, the other falls past the terminator.
  const key = [32, 28, 14].map((value) => value / Math.hypot(32, 28, 14));
  const facing = (row, degrees) => {
    const j = columnOf(degrees),
      v = 4 * perRange + row * n + j,
      azimuth = (j * step * Math.PI) / 180,
      tangent = [-Math.sin(azimuth), Math.cos(azimuth)],
      inward = [-Math.cos(azimuth), -Math.sin(azimuth)],
      lean = form.getY(v) * (1 + 0.25 * form.getZ(v)),
      normal = [
        tangent[0] * form.getX(v) + inward[0] * lean,
        1,
        tangent[1] * form.getX(v) + inward[1] * lean,
      ];
    return (normal[0] * key[0] + normal[1] * key[1] + normal[2] * key[2]) / Math.hypot(...normal);
  };
  for (const row of [1, 2]) {
    assert.ok(facing(row, 147) > 0.6, `row ${row} lit flank ${facing(row, 147)}`);
    assert.ok(facing(row, 153) < 0.3, `row ${row} shadow flank ${facing(row, 153)}`);
  }
});

test("mountain crests keep the sun saddle, tree shots and Close-up clear and the tour peaks dramatic", () => {
  for (const [from, to, cap] of [
    [171, 183, 3],
    [22, 86, 2.1],
    [232, 280, 3],
    [-1, 8, 3.2],
  ])
    assert.ok(
      highest(skyline, from, to) <= cap,
      `${from}-${to} rises to ${highest(skyline, from, to)}`,
    );
  for (const [from, to, least] of [
    [141, 164, 7],
    [5, 17, 5.4],
    [96, 120, 4],
  ])
    assert.ok(
      highest(skyline, from, to) >= least,
      `${from}-${to} peaks at ${highest(skyline, from, to)}`,
    );
  const means = crests.map((range) => range.reduce((a, b) => a + b) / range.length);
  for (let range = 1; range < means.length; range++) assert.ok(means[range] > means[range - 1]);
  assert.ok(Math.max(...crests[0]) <= 2.5, "the near range stays low");
});

test("mountain crests never repeat around the ring, between ranges or across tour windows", () => {
  const n = MOUNTAINS.columns;
  for (const profile of [...crests, skyline])
    for (let k = 2; k <= 8; k++)
      assert.ok(correlation(profile, rotate(profile, Math.round(n / k))) < 0.5);
  for (let a = 0; a < crests.length; a++)
    // Ranges share the authored height envelope (framing), so they correlate
    // somewhat, but no range is a copy of another.
    for (let b = a + 1; b < crests.length; b++) assert.ok(correlation(crests[a], crests[b]) < 0.7);
  // The watch, Portrait, Lantern study and Close-up windows, 40 degrees from each left edge.
  const windows = [141.5, 68.4, 31.8, -4.6].map((from) =>
    columns(from, from + 40).map((j) => skyline[j]),
  );
  for (let a = 0; a < windows.length; a++)
    for (let b = a + 1; b < windows.length; b++)
      assert.ok(correlation(windows[a], windows[b]) < 0.5);
  let peaks = 0,
    steepest = 0;
  for (let j = 0; j < n; j++) {
    steepest = Math.max(steepest, Math.abs(skyline[(j + 1) % n] - skyline[j]) / step);
    const height = skyline[j];
    if (!(height > skyline[(j + n - 1) % n] && height >= skyline[(j + 1) % n])) continue;
    // Prominence: the drop to the higher of the two lowest cols toward a higher summit.
    const col = (direction) => {
      let low = height;
      for (let k = 1; k < n; k++) {
        const v = skyline[(j + direction * k + n) % n];
        if (v > height) return low;
        low = Math.min(low, v);
      }
      return Math.min(...skyline);
    };
    if (height - Math.max(col(-1), col(1)) >= 0.3) peaks++;
  }
  // The reshaped crests (asymmetric summits, shoulders and teeth that grow
  // with height) keep many distinct summits and steep faces.
  assert.ok(peaks >= 40, `${peaks} peaks with 0.3 degree prominence`);
  assert.ok(steepest >= 1.2, `crest slope reaches only ${steepest} degrees per degree`);
});

test("snow caps only the high massifs of the farther ranges, mirrored exactly by snowReach", () => {
  const p = geometry.attributes.position,
    terrain = geometry.attributes.aTerrain,
    n = MOUNTAINS.columns;
  // aTerrain.w carries the column's massif height (0 on the near range, which
  // stays bare): a smoothed maximum of the crest around it, the snowline's reference.
  const snowy = (v) => snowReach(elevationOf(p, v), terrain.getW(v));
  const snowIn = (from, to) =>
    columns(from, to).some((j) => crests.some((_, range) => snowy(range * perRange + j)));
  for (let v = 0; v < terrain.count; v++) {
    const range = Math.floor(v / perRange),
      j = v % n,
      massif = terrain.getW(v);
    if (range === 0) assert.equal(massif, 0);
    else {
      let window = -Infinity;
      for (let k = -42; k <= 42; k++) window = Math.max(window, crests[range][(j + k + n) % n]);
      assert.ok(massif <= window + 1e-4 && massif >= 0.9 * crests[range][j], `massif at ${v}`);
    }
    if (massif <= SNOW.line) assert.equal(snowy(v), 0, "low massifs stay bare");
  }
  // The cap deepens with the massif, up to its limit, and its reach includes the
  // noisy snowline and the gully tongues at their most generous.
  assert.equal(snowReach(4, 4), 1);
  assert.equal(snowReach(2.8, 4), 1);
  assert.equal(snowReach(2.7, 4), 0);
  assert.equal(snowReach(2.6, 9), 1);
  assert.equal(snowReach(2.4, 9), 0);
  assert.equal(snowReach(10, SNOW.line), 0);
  assert.ok(snowIn(141, 164), "The watch massif carries snow");
  assert.ok(snowIn(5, 17), "the Close-up horn carries snow");
  assert.ok(snowIn(95, 120), "the Portrait peaks carry snow");
  // The shader sizes the same cap, jitter and tongue from SNOW.
  const hill = createHillSilhouette({ groundHeight });
  hill.setFilmTreatment(true);
  const shader = hill.mesh.material.fragmentShader;
  assert.ok(shader.includes(`clamp((vT.w-${SNOW.line})*${SNOW.depth},0.,${SNOW.max})`));
  assert.ok(shader.includes(`max(cap*${SNOW.jitter},${SNOW.jitterMin})`));
  assert.ok(shader.includes(`-cap*${SNOW.tongue}*`));
  hill.dispose();
});

test("the snow edge is anti-aliased across its own gradient and never copies the crest's teeth", () => {
  const hill = createHillSilhouette({ groundHeight });
  hill.setFilmTreatment(true);
  const shader = hill.mesh.material.fragmentShader,
    // Its assignment (the snowline is assigned where a massif carries snow).
    statement = (name) =>
      shader.match(new RegExp(String.raw`\b${name}=(?!0\.[,;])[^;]*;`))?.[0] ?? "";
  // The snowline and the steepness that sheds snow depend only on smooth fields
  // (the massif depth, polar noise and the face's turn), never on vT.x, the
  // depth below the toothed crest, whose per-column steps would echo down the
  // flank as stair-stepped tongue edges.
  for (const name of ["line", "dS"]) {
    assert.ok(statement(name), `${name} is declared`);
    assert.doesNotMatch(statement(name), /vT\.x/, `${name} follows the smooth massif`);
  }
  assert.match(shader, /float se=el-line, sw=max\(fwidth\(se\),\.5\/ppd\);/);
  assert.match(shader, /smoothstep\(0\.,1\.6\*sw,se\)/);
  // Creases turn the face through an anti-aliased sign, not a hard sign().
  assert.doesNotMatch(shader, /\bsign\(/);
  // The fine octave, the strata and the snowline's noise run only where they
  // show (perf review 2026-09-28), in branches that hold no derivative, so
  // they stay real branches (ANGLE flattens a branch holding one) and every
  // derivative is taken in uniform control flow.
  const branches = [...shader.matchAll(/if\((f2|st|cap)>0\.\)/g)].map((match) => {
    let at = match.index + match[0].length,
      depth = 0;
    const start = at;
    for (; at < shader.length; at++) {
      if (shader[at] === "{") depth++;
      else if (shader[at] === "}" && --depth === 0) return shader.slice(start, at + 1);
      else if (shader[at] === ";" && depth === 0) return shader.slice(start, at + 1);
    }
    return "";
  });
  assert.equal(branches.length, 4);
  for (const body of branches) assert.doesNotMatch(body, /fwidth|dFd/, body.slice(0, 60));
  assert.match(
    shader,
    /vec2 g1=pn\(vec2\(w\*1\.3,el\*\.4\),468\.\), g2=vec2\(\.5,0\.\);/,
    "a skipped fine octave weighs nothing",
  );
  hill.dispose();
});

test("thin low strips part as layers without echoing their crest", () => {
  const hill = createHillSilhouette({ groundHeight });
  hill.setFilmTreatment(true);
  const shader = hill.mesh.material.fragmentShader;
  // slim: 1 on a far range that rises less than about half a degree above the
  // nearer skyline (aForm.w), 0 from about 2.2 degrees.
  assert.match(shader, /rise=crest-vF\.w, slim=far\*\(1\.-smoothstep\(\.6,2\.2,rise\)\)/);
  // Stacked strips never echo as a second light-dark band under each crest: on a
  // thin strip the valley mist fades smoothly over its lower two thirds (dark
  // under its crest, misted at its foot, so the layers still part at every
  // junction), and the lean's change with depth fades; no rim or ink is drawn
  // about any crest (realistic ranges).
  assert.match(
    shader,
    /float mist=\(1\.-smoothstep\(0\.,min\(\.9,mix\(\.6,\.65,slim\)\*max\(rise,\.05\)\),el-vF\.w\)\)\*far\*mix\(\.7,\.65,slim\);/,
  );
  assert.doesNotMatch(shader, /float cr=|c\+=cr\*/);
  assert.match(shader, /float lean=mix\(vF\.y,[^,]+,slim\)/);
  hill.dispose();
});

test("the rock body stays ordered by distance, below the sky and with a readable lit and shadow flank", () => {
  const { transmittance, albedo, rockMax } = MOUNTAIN_AIR;
  assert.deepEqual([...transmittance], [0.86, 0.8, 0.62, 0.44, 0.3]);
  assert.equal(albedo.length, MOUNTAINS.radii.length);
  for (const lit of [0, 0.5, 1]) {
    for (let range = 0; range < transmittance.length; range++) {
      const body = mountainBody(range, lit);
      assert.ok(
        body > 0.1 && body <= rockMax && rockMax < 1,
        `range ${range} stays visible and below the sky`,
      );
      if (range > 0)
        assert.ok(
          body - mountainBody(range - 1, lit) >= 0.025,
          `range ${range} approaches the sky`,
        );
    }
  }
  // Moonlit and shadowed faces differ by at least a fifth of the sky's luma on
  // every range (the former band clamp held them within 1-2/255), and distance
  // flattens form.
  const contrast = (range) => mountainBody(range, 1) - mountainBody(range, 0);
  for (let range = 0; range < transmittance.length; range++)
    assert.ok(contrast(range) >= 0.2, `range ${range} flank ${contrast(range)}`);
  assert.ok(contrast(4) < contrast(1));
  // Summits see through thinner air: more of their form.
  assert.ok(
    mountainBody(4, 1, { elevation: 6 }) - mountainBody(4, 0, { elevation: 6 }) > contrast(4),
  );
  // The shader applies the same air, albedo and moonlight and no longer pins
  // each range to a narrow luma band.
  const hill = createHillSilhouette({ groundHeight });
  hill.setFilmTreatment(true);
  const shader = hill.mesh.material.fragmentShader;
  const g = (v) => (Number.isInteger(v) ? v.toFixed(1) : String(v)),
    [t0, t1, t2, t3, t4] = transmittance.map(g);
  assert.ok(
    shader.includes(
      `float T=mix(mix(mix(mix(${t0},${t1},step(0.5,vT.y)),${t2},step(1.5,vT.y)),${t3},step(2.5,vT.y)),${t4},step(3.5,vT.y))`,
    ),
  );
  assert.ok(shader.includes(`*${g(MOUNTAIN_AIR.moon)}*lit+`));
  assert.ok(shader.includes(`c*=min(1.,${rockMax}*sL/max(dot(c,W),1e-4));`));
  assert.doesNotMatch(shader, /bodyLuma|tL-/);
  hill.dispose();
});

test("hill treatment swaps and reuses resources while restoring the original baseline", async () => {
  const statuses = [];
  const hill = createHillSilhouette({ groundHeight, onStatus: (status) => statuses.push(status) }),
    original = hill.mesh.geometry,
    material = hill.mesh.material;
  assert.equal(hill.mesh.frustumCulled, true);
  assert.equal(hill.mesh.renderOrder, 0);
  assert.equal(hill.ready, null, "nothing is requested before the film");
  hill.setFilmTreatment(true);
  // Until the lazy ranges land the film draws an empty stand-in.
  assert.equal(hill.mesh.geometry.attributes.position.count, 0);
  assert.ok(hill.ready instanceof Promise);
  const grade = hill.mesh.material;
  assert.notEqual(grade, material);
  assert.ok(grade instanceof ShaderMaterial);
  assert.equal(grade.fog, true);
  // Transparent with no blending: drawn after the stars, writing colour and depth layer exactly.
  assert.equal(grade.transparent, true);
  assert.equal(grade.blending, NoBlending);
  assert.equal(grade.depthWrite, true);
  assert.equal(grade.depthTest, true);
  assert.equal(grade.side, FrontSide);
  assert.equal(
    hill.mesh.frustumCulled,
    false,
    "the ranges follow the camera; world bounds never apply",
  );
  assert.equal(hill.mesh.renderOrder, MOUNTAIN_AIR.renderOrder);
  await hill.ready;
  const film = hill.mesh.geometry;
  assert.notEqual(film, original);
  assert.equal(film.attributes.position.count, MOUNTAINS.radii.length * perRange);
  assert.deepEqual(statuses, ["loading", "ready"]);
  hill.applyQuality({ tier: "low" });
  assert.equal(hill.mesh.visible, false);
  hill.setFilmTreatment(false);
  assert.equal(hill.mesh.geometry, original);
  assert.equal(hill.mesh.material, material);
  assert.equal(hill.mesh.frustumCulled, true);
  assert.equal(hill.mesh.renderOrder, 0);
  hill.setFilmTreatment(true);
  assert.equal(hill.mesh.geometry, film);
  assert.equal(hill.mesh.material, grade);
  assert.equal(hill.mesh.visible, false, "treatment must not undo low-quality hiding");
  hill.applyQuality({ tier: "balanced" });
  assert.equal(hill.mesh.visible, true);
  assert.equal(hill.mesh.geometry, film);
  assert.deepEqual(statuses, ["loading", "ready"], "requested once");
  let count = 0;
  for (const resource of [original, material, film, grade])
    resource.addEventListener("dispose", () => count++);
  hill.dispose();
  hill.dispose();
  assert.equal(count, 4);
  assert.equal(hill.setFilmTreatment(true), false);
});

test("the ranges are requested only for a visible film, keep the stand-in on failure and are freed after disposal", async () => {
  let requests = 0;
  const load =
    (build = () => Promise.resolve(new BufferGeometry())) =>
    () => {
      requests++;
      return Promise.resolve({ buildMountains: build });
    };
  // Low quality never requests the chunk.
  const low = createHillSilhouette({ groundHeight, load: load() });
  low.applyQuality({ tier: "low" });
  low.setFilmTreatment(true);
  assert.equal(low.ready, null);
  assert.equal(requests, 0);
  // A step up from low while the film is on requests it then; so does the film.
  low.applyQuality({ tier: "balanced" });
  assert.ok(low.ready instanceof Promise);
  const idle = createHillSilhouette({ groundHeight, load: load() });
  idle.applyQuality({ tier: "high" });
  assert.equal(idle.ready, null, "no request until the film is on");
  assert.equal(requests, 1);
  // The build receives the scene's rendering and tour, and can be cancelled.
  const rendering = {},
    tour = { running: true, transition: { cut: false } };
  let received = null,
    invalidated = 0;
  const wired = createHillSilhouette({
    groundHeight,
    rendering,
    tour,
    invalidate: () => invalidated++,
    load: load((options) => {
      received = options;
      return Promise.resolve(new BufferGeometry());
    }),
  });
  wired.setFilmTreatment(true);
  await wired.ready;
  assert.equal(received.rendering, rendering);
  assert.equal(received.tour, tour);
  assert.equal(received.cancelled(), false);
  assert.equal(invalidated, 1, "a still frame redraws once the ranges land");
  wired.dispose();
  assert.equal(received.cancelled(), true);
  // A failed chunk keeps the empty stand-in and reports a fallback.
  const statuses = [];
  const failed = createHillSilhouette({
    groundHeight,
    onStatus: (status) => statuses.push(status),
    load: () => Promise.reject(new Error("offline")),
  });
  failed.setFilmTreatment(true);
  await failed.ready;
  assert.deepEqual(statuses, ["loading", "fallback"]);
  assert.equal(failed.mesh.geometry.attributes.position.count, 0);
  // Ranges finished after disposal are freed, never kept.
  let finish;
  const late = new BufferGeometry();
  let freed = 0;
  late.addEventListener("dispose", () => freed++);
  const gone = createHillSilhouette({
    groundHeight,
    load: load(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    ),
  });
  gone.setFilmTreatment(true);
  await new Promise((resolve) => setImmediate(resolve));
  gone.dispose();
  finish(late);
  await gone.ready;
  assert.equal(freed, 1);
  for (const hill of [low, idle, failed]) hill.dispose();
  // hill-silhouette.js never imports the chunk statically, so it stays out of the entry.
  const source = await readFile(
    new URL("../src/scene/hill-silhouette.js", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /from\s+["']\.\/mountain-build\.js["']/);
  assert.match(source, /import\("\.\/mountain-build\.js"\)/);
  const chunk = await readFile(new URL("../src/scene/mountain-build.js", import.meta.url), "utf8");
  assert.deepEqual(
    [...chunk.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1]),
    ["three"],
  );
});

// A frame clock for requestAnimationFrame (the landing gate polls per frame).
function frames() {
  const queue = [],
    previous = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = (task) => queue.push(task);
  return {
    async step(count = 1) {
      for (let i = 0; i < count; i++) {
        for (const task of queue.splice(0)) task(performance.now());
        await new Promise((resolve) => setImmediate(resolve));
      }
    },
    restore() {
      if (previous) globalThis.requestAnimationFrame = previous;
      else delete globalThis.requestAnimationFrame;
    },
  };
}

test("the ranges build in short idle slices, hold the shafts' slot and fade in wherever they could show mid-shot", async () => {
  const clock = frames(),
    idle = globalThis.requestIdleCallback,
    style = globalThis.getComputedStyle,
    slices = [];
  let outstanding = 0;
  try {
    globalThis.requestIdleCallback = (task, options) => {
      assert.equal(options.timeout, 100);
      outstanding++;
      setImmediate(() => {
        outstanding--;
        const start = performance.now();
        task({ didTimeout: false, timeRemaining: () => 4 });
        slices.push(performance.now() - start);
      });
    };
    const names = new Set(["is-ready"]),
      tour = { running: true, transition: { cut: false } };
    const rendering = {
      renderer: {
        domElement: { parentNode: { classList: { contains: (name) => names.has(name) } } },
      },
    };
    globalThis.getComputedStyle = () => ({ transitionDuration: "0s" });
    let arrived = null;
    buildMountains({ rendering, tour }).then((built) => {
      arrived = built;
    });
    // While it slices, the light shafts wait on rendering.terrainSlicing.
    assert.ok(rendering.terrainSlicing instanceof Promise, "light-shafts.js sees the build");
    do await clock.step();
    while (outstanding);
    await clock.step(3);
    // Mid-shot after the fade (a slow phone): it lands at once, fading in over
    // MOUNTAIN_ENTRANCE.late, rather than leaving the horizon bare until the cut.
    assert.ok(arrived, "lands mid-shot rather than waiting for a cut");
    assert.equal(arrived.userData.fadeIn, MOUNTAIN_ENTRANCE.late);
    assert.equal(rendering.terrainSlicing, null, "the slot clears once the build ends");
    assert.ok(slices.length > 3, `${slices.length} slices`);
    // Each slice stops before a step that could overrun it: never a long task,
    // and typically within the 4 ms of idle time offered (the suite runs files in
    // parallel, so a single slice can stretch; the browser check is separate).
    const sorted = [...slices].sort((a, b) => a - b);
    assert.ok(sorted.at(-1) < 50, `no long task (${sorted.at(-1).toFixed(1)} ms)`);
    assert.ok(
      sorted[sorted.length >> 1] < 8,
      `median slice ${sorted[sorted.length >> 1].toFixed(1)} ms`,
    );
    // Exactly the ranges built at once.
    for (const name of ["position", "aTerrain", "aForm"])
      assert.deepEqual(arrived.attributes[name].array, geometry.attributes[name].array, name);
    assert.deepEqual(arrived.index.array, geometry.index.array);
    arrived.dispose();
    // Sharing the slot with the terrain: it holds a promise for both.
    let terrainDone;
    const terrain = new Promise((resolve) => {
      terrainDone = resolve;
    });
    rendering.terrainSlicing = terrain;
    tour.running = false; // not touring: any frame is unseen
    const shared = buildMountains({ rendering, tour });
    assert.notEqual(rendering.terrainSlicing, terrain);
    const both = rendering.terrainSlicing;
    const still = await shared;
    assert.equal(still.userData.fadeIn, 0, "a still frame takes the ranges at once");
    still.dispose();
    assert.equal(rendering.terrainSlicing, both, "held while the terrain still slices");
    terrainDone();
    await both;
    await Promise.resolve();
    assert.equal(rendering.terrainSlicing, null);
    // Disposed first: the build stops and resolves to nothing.
    let gone = false;
    assert.equal(
      await buildMountains({ rendering, tour, cancelled: () => gone || !(gone = true) }),
      null,
    );
    assert.equal(rendering.terrainSlicing, null);
  } finally {
    clock.restore();
    if (idle) globalThis.requestIdleCallback = idle;
    else delete globalThis.requestIdleCallback;
    if (style) globalThis.getComputedStyle = style;
    else delete globalThis.getComputedStyle;
  }
});

test("under the reveal's fade the ranges rush in back-to-back slices of at most 12 ms", async () => {
  const idle = globalThis.requestIdleCallback,
    style = globalThis.getComputedStyle,
    timeout = globalThis.setTimeout;
  const tasks = [];
  let idles = 0;
  try {
    globalThis.requestIdleCallback = (task) => {
      idles++;
      setImmediate(() => task({ didTimeout: true, timeRemaining: () => 0 }));
    };
    globalThis.setTimeout = (task, ms, ...rest) =>
      timeout(
        (...args) => {
          const start = performance.now();
          task(...args);
          tasks.push(performance.now() - start);
        },
        ms,
        ...rest,
      );
    const names = new Set(["is-ready"]),
      tour = { running: true, transition: { cut: false } };
    const rendering = {
      renderer: {
        domElement: { parentNode: { classList: { contains: (name) => names.has(name) } } },
      },
    };
    performance.mark("babel:reveal");
    globalThis.getComputedStyle = () => ({ transitionDuration: "60s" });
    const built = await buildMountains({ rendering, tour });
    assert.ok(built?.attributes.aForm, "it lands at once under the fade");
    assert.equal(
      built.userData.fadeIn,
      MOUNTAIN_ENTRANCE.fade,
      "the canvas is partly opaque: a short fade-in",
    );
    assert.equal(idles, 0, "under the fade no slice waits for idle time");
    // Up to 12 ms each: typically no more, and never a long task under the suite's load.
    const sorted = [...tasks].sort((a, b) => a - b);
    assert.ok(
      sorted.length > 0 && sorted.at(-1) < 50,
      `longest rushed slice ${sorted.at(-1).toFixed(1)} ms`,
    );
    assert.ok(
      sorted[sorted.length >> 1] <= 13,
      `median rushed slice ${sorted[sorted.length >> 1].toFixed(1)} ms`,
    );
    built.dispose();
  } finally {
    globalThis.setTimeout = timeout;
    if (idle) globalThis.requestIdleCallback = idle;
    else delete globalThis.requestIdleCallback;
    if (style) globalThis.getComputedStyle = style;
    else delete globalThis.getComputedStyle;
    performance.clearMarks("babel:reveal");
  }
});

test("a starved idle wait before the reveal switches to rushed slices as soon as the fade begins", async () => {
  const clock = frames(),
    idle = globalThis.requestIdleCallback,
    style = globalThis.getComputedStyle;
  try {
    // A busy phone before and during the reveal: idle callbacks never come.
    let idles = 0;
    globalThis.requestIdleCallback = () => {
      idles++;
    };
    const names = new Set(),
      tour = { running: true, transition: { cut: false } };
    const rendering = {
      renderer: {
        domElement: { parentNode: { classList: { contains: (name) => names.has(name) } } },
      },
    };
    // The canvas container carries its fade (styles.css) before the reveal too;
    // the build reads it up front, never inside a slice.
    let styleReads = 0;
    globalThis.getComputedStyle = () => {
      styleReads++;
      return { transitionDuration: "60s" };
    };
    let arrived = null;
    buildMountains({ rendering, tour }).then((built) => {
      arrived = built;
    });
    const readsAtStart = styleReads;
    await clock.step(3);
    assert.equal(idles, 1, "waiting for idle time while the canvas is hidden");
    assert.equal(arrived, null);
    // The canvas starts fading in: the next frame rushes the pending slice.
    names.add("is-ready");
    performance.mark("babel:reveal");
    // Frames keep coming while the rushed slices (timers) run: up to 10 s here.
    const began = performance.now();
    while (!arrived && performance.now() - began < 10000) {
      await clock.step();
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    assert.equal(styleReads, readsAtStart, "no style read once the build is under way");
    assert.ok(arrived?.attributes.aForm, "built and landed under the fade");
    assert.equal(idles, 1, "no further idle waits");
    arrived.dispose();
  } finally {
    clock.restore();
    if (idle) globalThis.requestIdleCallback = idle;
    else delete globalThis.requestIdleCallback;
    if (style) globalThis.getComputedStyle = style;
    else delete globalThis.getComputedStyle;
    performance.clearMarks("babel:reveal");
  }
});

test("hidden, on a cut or still the ranges land at once; otherwise they fade in over the sky by a constant alpha", async () => {
  const clock = frames(),
    idle = globalThis.requestIdleCallback,
    style = globalThis.getComputedStyle;
  const material = new ShaderMaterial({ transparent: true, blending: NoBlending }),
    mesh = { material };
  try {
    globalThis.requestIdleCallback = (task) =>
      setImmediate(() => task({ didTimeout: false, timeRemaining: () => 8 }));
    globalThis.getComputedStyle = () => ({ transitionDuration: "0s" });
    const names = new Set(),
      tour = { running: true, transition: { cut: false } };
    const rendering = {
      renderer: {
        domElement: { parentNode: { classList: { contains: (name) => names.has(name) } } },
      },
    };
    // Before the reveal (the canvas is hidden): at once, the material untouched.
    let pending = buildMountains({ rendering, tour, mesh });
    let built = null;
    pending.then((value) => {
      built = value;
    });
    while (!built) await clock.step();
    assert.equal(built.userData.fadeIn, 0);
    assert.equal(material.blending, NoBlending, "no fade");
    assert.equal(typeof mesh.onBeforeRender, "function", "the sectors in view still apply");
    built.dispose();
  } finally {
    clock.restore();
    if (idle) globalThis.requestIdleCallback = idle;
    else delete globalThis.requestIdleCallback;
    if (style) globalThis.getComputedStyle = style;
    else delete globalThis.getComputedStyle;
  }
  // The fade itself: frame time (steps of at most 0.1 s) ramps a constant
  // alpha that blends colour and depth-layer code alike over what the canvas
  // shows, then the material's own blending (none) returns.
  const now = performance.now,
    times = [0, 16, 5000, 5016, 5116, 5216, 5316, 5416, 5516, 5616, 5716, 5816, 5916, 6016, 6032];
  const seen = [],
    faded = { material: new ShaderMaterial({ transparent: true, blending: NoBlending }) },
    fading = faded.material;
  try {
    let t = 0;
    performance.now = () => times[t];
    assert.equal(showRanges(faded, new BufferGeometry(), 1), false, "only the sectored ranges");
    assert.equal(showRanges(faded, geometry, 1), true);
    assert.equal(fading.blending, 5, "CustomBlending");
    assert.deepEqual([fading.blendEquation, fading.blendEquationAlpha], [100, 100]);
    assert.deepEqual(
      [fading.blendSrc, fading.blendDst, fading.blendSrcAlpha, fading.blendDstAlpha],
      [213, 214, 213, 214],
      "constant alpha for colour and the layer code alike",
    );
    const camera = new PerspectiveCamera(45, 1.6, 0.1, 500);
    camera.updateMatrixWorld();
    faded.onBeforeRender(null, null, camera, new BufferGeometry());
    assert.equal(fading.blendAlpha, 0, "another geometry (the baseline hills) takes no step");
    for (; t < times.length; t++) {
      faded.onBeforeRender(null, null, camera, geometry);
      seen.push(fading.blendAlpha);
    }
    assert.equal(seen[0], 0, "the first frame still shows the sky");
    assert.ok(seen[2] < 0.05, `a 5 s stall (a hidden page) counts as one 0.1 s step: ${seen[2]}`);
    for (let i = 1; i < seen.length; i++) assert.ok(seen[i] >= seen[i - 1], "never steps back");
    assert.equal(seen.at(-1), 1);
    assert.equal(fading.blending, NoBlending, "whole again: no blending");
    assert.ok(seen.indexOf(1) >= 11, `about a second of frames (${seen.indexOf(1)})`);
  } finally {
    performance.now = now;
    geometry.setDrawRange(0, Infinity);
  }
  assert.ok(
    MOUNTAIN_ENTRANCE.late >= 1.5 && MOUNTAIN_ENTRANCE.late <= 2,
    "a gentle mid-shot fade of 1.5-2 s",
  );
  assert.ok(
    MOUNTAIN_ENTRANCE.fade > 0 && MOUNTAIN_ENTRANCE.fade <= 0.5,
    "under the canvas's own fade, a short one",
  );
  // hill-silhouette.js hands the chunk its mesh, and the massifs' models, meshes
  // and skyline texels once it has loaded them.
  const source = flat(
    await readFile(new URL("../src/scene/hill-silhouette.js", import.meta.url), "utf8"),
  );
  assert.ok(
    source.includes(
      "buildMountains({ rendering, tour, cancelled: () => disposed, mesh, models: models?.models ?? null, massifs: models?.meshes ?? null, texels: models?.texels ?? null })",
    ),
  );
});

test("each draw of the ranges takes only the sectors in view, and the whole ring again after it", () => {
  const { count, seam, margin } = MOUNTAINS.sectors,
    { size } = geometry.userData.sectors,
    index = geometry.index.array,
    n = MOUNTAINS.columns;
  assert.equal(size * count, index.length);
  const mesh = { material: new ShaderMaterial() };
  assert.equal(showRanges(mesh, geometry), true);
  assert.deepEqual([geometry.drawRange.start, geometry.drawRange.count], [0, index.length]);
  const azimuthOf = (v) =>
    ((Math.atan2(geometry.attributes.position.getZ(v), geometry.attributes.position.getX(v)) *
      180) /
      Math.PI +
      360) %
    360;
  const inView = (camera, azimuth, elevation) => {
    const direction = new Vector3(
      Math.cos((azimuth * Math.PI) / 180),
      Math.tan((elevation * Math.PI) / 180),
      Math.sin((azimuth * Math.PI) / 180),
    );
    const ndc = direction.clone().add(camera.position).project(camera);
    return (
      Math.abs(ndc.x) <= 1 &&
      Math.abs(ndc.y) <= 1 &&
      ndc.z < 1 &&
      direction.clone().applyMatrix4(camera.matrixWorldInverse.clone().setPosition(0, 0, 0)).z < 0
    );
  };
  let culled = 0;
  for (const [aspect, fov] of [
    [1.6, 45],
    [0.46, 55],
    [2.16, 40],
  ])
    for (let yaw = 0; yaw < 360; yaw += 7.5)
      for (const pitch of [-8, 0, 12, 27]) {
        const camera = new PerspectiveCamera(fov, aspect, 0.1, 500);
        camera.position.set(3, 5, -2);
        camera.rotation.order = "YXZ";
        camera.rotation.set((pitch * Math.PI) / 180, -Math.PI / 2 - (yaw * Math.PI) / 180, 0);
        camera.updateMatrixWorld();
        mesh.onBeforeRender(null, null, camera, geometry);
        const { start, count: drawn } = geometry.drawRange;
        assert.ok(start % size === 0 && drawn % size === 0 && start + drawn <= index.length);
        if (drawn < index.length) culled++;
        // Every direction in view (azimuth and a mountain elevation) lies in a drawn sector.
        const from = start / size,
          to = from + drawn / size;
        for (let a = 0; a < 360; a += 1)
          for (const e of [-10, 0, 8]) {
            if (!inView(camera, a, e)) continue;
            const sector = Math.floor(((((a - seam) % 360) + 360) % 360) / (360 / count));
            assert.ok(
              sector >= from && sector < to,
              `yaw ${yaw} pitch ${pitch} aspect ${aspect}: azimuth ${a} in sector ${sector}, drawn ${from}-${to}`,
            );
          }
        mesh.onAfterRender(null, null, camera, geometry);
        assert.deepEqual(
          [geometry.drawRange.start, geometry.drawRange.count],
          [0, index.length],
          "whole again after the draw",
        );
      }
  assert.ok(culled > 200, `${culled} views drew part of the ring`);
  // Each sector's triangles cover its own columns only, nearest range first.
  const span = n / count,
    first = Math.round((seam / 360) * n);
  for (let sector = 0; sector < count; sector++) {
    let range = 0;
    for (let t = sector * size; t < (sector + 1) * size; t += 6) {
      const column = index[t] % n,
        own = (column - first - sector * span + 2 * n) % n;
      assert.ok(own >= 0 && own < span, `sector ${sector} holds column ${column}`);
      const r = Math.floor(index[t] / perRange);
      assert.ok(r >= range, "nearest range first");
      range = r;
    }
  }
  // No tour view looks across the seam (fix/perf/azimuths.json: -147 to 193 degrees).
  assert.ok(seam - margin > 193 && seam + margin < 360 - 147);
  // Views that cannot be bounded draw everything.
  assert.equal(sectorsInView(null), null);
  const up = new PerspectiveCamera(45, 1, 0.1, 500);
  up.lookAt(0, 1, 0.01);
  up.updateMatrixWorld();
  assert.equal(sectorsInView(up), null);
  near(azimuthOf(first), seam, 1e-4);
});

test("the mountain shader rides the camera, hazes toward the film sky and writes the mountains' layer", () => {
  const hill = createHillSilhouette({
    groundHeight,
    skyRadius: 130,
    shellOpacity: 0.52,
    sunPosition: [-85, 55, -14],
  });
  hill.setFilmTreatment(true);
  const material = hill.mesh.material;
  assert.match(material.vertexShader, /cameraPosition\s*\+\s*position/);
  assert.match(material.vertexShader, /attribute vec4 aTerrain, aForm;/);
  assert.ok(material.fragmentShader.includes(FILM_SKY_GLSL));
  assert.match(material.fragmentShader, /fwidth\(vT\.x\)/);
  assert.equal(material.extensions.derivatives, true);
  assert.doesNotMatch(material.fragmentShader + material.vertexShader, /sampler2D|texture2D/);
  assert.match(material.fragmentShader, /gl_FragColor=vec4\(c,0\.3333\);\s*}$/);
  // A shot's low mist on the feet, shared with the ground's (mud-ground.js
  // slateCalmFor()) and drawn last, only when a shot asks for it.
  assert.equal(material.uniforms.uMist, RANGE_MIST);
  assert.deepEqual({ ...RANGE_MIST.value }, { x: 0, y: 0, z: 0, w: 0 }, "off by default");
  assert.ok(RANGE_MIST_SHAPE.floor < 0 && RANGE_MIST_SHAPE.top > 0 && RANGE_MIST_SHAPE.top < 0.05);
  assert.match(
    material.fragmentShader,
    /uniform vec4 uMist;[\s\S]*if\(uMist\.w>0\.\)\{[^}]*\}\s*gl_FragColor=vec4\(c,0\.3333\);\s*}$/,
  );
  // Lit by the moon key (rendering's sun light, 32,28,14).
  const key = [32, 28, 14].map((value) =>
    (value / Math.hypot(32, 28, 14)).toFixed(3).replace(/^0/, ""),
  );
  assert.ok(material.fragmentShader.includes(`K=vec3(${key.join(",")})`));
  // Every polar noise is periodic around the ring (P = 360 x its frequency), so
  // there is no seam behind the camera.
  const noises = [
    ...material.fragmentShader.matchAll(/pn\(vec2\(\w+\*([\d.]+),[^)]*\),([\d.]+)\)/g),
  ];
  assert.ok(noises.length >= 8, `${noises.length} polar noises`);
  for (const [, frequency, period] of noises) near(360 * Number(frequency), Number(period), 1e-6);
  // The feet haze to the fog colour over the ground's own horizon distances.
  assert.ok(
    material.fragmentShader.includes(`smoothstep(${HORIZON_HAZE.near}.,${HORIZON_HAZE.far}.,vD)`),
  );
  assert.equal(material.uniforms.uSky.value.x, 130 * 130);
  assert.equal(material.uniforms.uSky.value.y, 0.52);
  assert.deepEqual(material.uniforms.uSun.value.toArray(), [-85, 55, -14]);
  for (const name of ["fogColor", "fogNear", "fogFar"]) assert.ok(material.uniforms[name]);
  hill.dispose();
});

test("foot haze keeps the ground seam but clears the exposed low Lantern-study ranges", () => {
  const height = MOUNTAIN_AIR.footHazeHeight;
  assert.equal(height, 3);
  const fogFraction = (aboveDatum) => {
    const t = Math.max(0, Math.min(1, aboveDatum / height));
    return 1 - t * t * (3 - 2 * t);
  };
  assert.equal(fogFraction(-2), 1, "below the ground datum stays fully fogged");
  assert.equal(fogFraction(0), 1, "the bottom seam exactly matches the ground fog");
  assert.equal(fogFraction(1.5), 0.5, "the feet retain a soft transition");
  assert.equal(fogFraction(3), 0);
  // Lantern-study capture: camera is 2.637 units above the ground datum. At
  // azimuth 45 degrees these four mid-bands are exposed; the fifth is occluded.
  // The old 0..9 fade replaced 70%, 40%, 12%, 1% with the same fog colour.
  const cameraHeight = 2.637,
    column = columnOf(45);
  let preceding = 0,
    visible = 0;
  for (let range = 0; range < MOUNTAINS.radii.length; range++) {
    const crest = crests[range][column];
    if (crest <= preceding) continue;
    const middle = (preceding + crest) / 2;
    const aboveDatum = cameraHeight + MOUNTAINS.radii[range] * Math.tan((middle * Math.PI) / 180);
    assert.equal(
      fogFraction(aboveDatum),
      0,
      `visible range ${range} must retain its own body shade`,
    );
    preceding = crest;
    visible++;
  }
  assert.equal(visible, 4);
  const hill = createHillSilhouette({ groundHeight });
  hill.setFilmTreatment(true);
  assert.match(
    hill.mesh.material.fragmentShader,
    /1\.-smoothstep\(0\.,3\.0,vH\)\*smoothstep\(-\.05,-\.008,vL\.y\/r\)/,
  );
  hill.dispose();
});

test("stars draw after the sky and before the mountains, which stay inside the far plane", async () => {
  const stars = createStarfield({
    parent: new Group(),
    camera: new PerspectiveCamera(),
    profile: { tier: "high" },
  });
  assert.ok(stars.root.renderOrder > -1 && stars.root.renderOrder < MOUNTAIN_AIR.renderOrder);
  assert.ok(MOUNTAIN_AIR.renderOrder < 0);
  stars.dispose();
  const window = { BabelSite: {} };
  vm.runInNewContext(await readFile(new URL("../src/scene/world.js", import.meta.url), "utf8"), {
    window,
  });
  const far = window.BabelSite.scene.WORLD.CAMERA_FAR,
    p = geometry.attributes.position;
  assert.ok(MOUNTAINS.radii.at(-1) * 1.03 < far);
  let farthest = 0;
  for (let i = 0; i < p.count; i++)
    farthest = Math.max(farthest, Math.hypot(p.getX(i), p.getY(i), p.getZ(i)));
  assert.ok(farthest * 1.03 < far, `a crest reaches ${farthest}`);
  near(geometry.boundingSphere.radius, farthest, 1e-3);
  // The ground is fully hazed before the near range rises out of it.
  assert.ok(HORIZON_HAZE.far <= MOUNTAINS.radii[0] * MOUNTAINS.rows[2]);
});

test("the shared horizon slate reads as distant ground: lighter than a void, below the phone tier's lit slate", () => {
  const [r, g, b] = TERRAIN_HORIZON.match(/^vec3\(([\d.]+),([\d.]+),([\d.]+)\)$/)
    .slice(1)
    .map(Number);
  const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  // The post chain writes shader values without an sRGB encode. At luma .0375
  // the plain past the foothills showed as a near-black band (about 9/255),
  // darker than both the lit slate and the mountain feet. Matched captures put
  // luma .08 level with balanced's darker lit slate at the frame edges, where
  // the terrain edge dissolved on phones.
  assert.ok(luma > 0.055 && luma < 0.075, `horizon luma ${luma}`);
  assert.ok(b >= r && b - r <= 0.02, "a cool, near-neutral slate rather than a blue veil");
});

test("the ranges read as real rock: a softly wrapped key, no drawn rim or ink about the crests", () => {
  const hill = createHillSilhouette({ groundHeight });
  hill.setFilmTreatment(true);
  const shader = hill.mesh.material.fragmentShader;
  // The key wraps a little past the terminator, never a crisp, faceted edge.
  const { wrap } = MOUNTAIN_AIR,
    g = (v) => (Number.isInteger(v) ? v.toFixed(1) : String(v));
  assert.ok(wrap > 0 && wrap < 0.5);
  assert.ok(shader.includes(`float nl=dot(n,K), lit=clamp((nl+${g(wrap)})/${g(1 + wrap)},0.,1.)`));
  assert.doesNotMatch(shader, /crisp=smoothstep/);
  // Every name the ring shader reads is declared: the snow's terminator width among them.
  assert.match(shader, /float te=max\(\.05,1\.5\*fwidth\(nl\)\);/);
  assert.ok(shader.indexOf("float te=") < shader.indexOf("smoothstep(.3-te,.3+te,ns)"));
  // No cool or warm rim drawn about the crests, and no crest ink line.
  assert.doesNotMatch(shader, /float cr=|vec3\(\.55,\.62,\.8\)/);
  assert.ok(!shader.includes("c=mix(c,vec3(.012,.016,.03)"));
  // The faint warm glow toward the orb stays.
  assert.ok(shader.includes("c*=1.+vec3(.06,.02,-.04)*pow(max(dot(v,toSun),0.),10.);"));
  hill.dispose();
});

test("one moon key: the scene's key light, the sky's glow, the ranges' shade and the ground's occlusion", async () => {
  const text = (file) => readFile(new URL(`../src/scene/${file}`, import.meta.url), "utf8");
  const unit = (v) => v.map((c) => c / Math.hypot(...v));
  // The authority is the scene's key light: rendering.js places its sun
  // DirectionalLight at index.js lightingConfig.directionalPosition over a
  // target left at the origin (three's default), and focusFilmShadow moves both
  // by the same offset (scene-rendering.test), so the key (toward the light)
  // is that position, normalised. The visible orb (WORLD.SUN_POSITION) is not
  // the key and is not tied here.
  const index = await text("index.js");
  const position = index
    .match(/directionalPosition:\s*\{\s*x:\s*([\d.-]+),\s*y:\s*([\d.-]+),\s*z:\s*([\d.-]+),?\s*\}/)
    .slice(1)
    .map(Number);
  const key = unit(position);
  const rendering = await text("rendering.js");
  assert.match(
    rendering,
    /sunLight\.position\.set\(\s*lighting\.directionalPosition\.x,\s*lighting\.directionalPosition\.y,\s*lighting\.directionalPosition\.z,?\s*\);/,
  );
  assert.equal(
    (rendering.match(/sunLight\.target\.position\.\w+\(/g) ?? []).join(","),
    "sunLight.target.position.clone(,sunLight.target.position.copy(,sunLight.target.position.copy(",
    "the target only saved, restored or moved with the light",
  );
  const { DirectionalLight } = await import("three");
  assert.deepEqual(new DirectionalLight().target.position.toArray(), [0, 0, 0]);
  // world.js SUN_DIRECTION, which the sky's glow reads, points the same way.
  const window = { BabelSite: {} };
  vm.runInNewContext(await text("world.js"), { window });
  const { SUN_DIRECTION } = window.BabelSite.scene.WORLD;
  unit([...SUN_DIRECTION]).forEach((c, i) => near(c, key[i], 1e-12));
  // The film ranges: the shader's K (to three decimals) and the coarse vertex
  // shade mountain-build.js bakes for the Blender export (KEY).
  const hill = createHillSilhouette({ groundHeight });
  hill.setFilmTreatment(true);
  const shaderKey = hill.mesh.material.fragmentShader
    .match(/K=vec3\(([\d.]+),([\d.]+),([\d.]+)\)/)
    .slice(1)
    .map(Number);
  shaderKey.forEach((c, i) => near(c, key[i], 5e-4));
  hill.dispose();
  const build = (await text("mountain-build.js")).match(
    /const KEY = \[([\d.,\s-]+)\]\.map\(\(v\) => v \/ Math\.hypot\(([\d.,\s-]+)\)\);/,
  );
  assert.ok(build, "mountain-build.js KEY is a normalised literal");
  const [numbers, norm] = build.slice(1).map((list) => list.split(",").map(Number));
  assert.deepEqual(numbers, norm, "normalised by its own length");
  unit(numbers).forEach((c, i) => near(c, key[i], 1e-12));
  // The ground: the key the roots' occlusion is baked along (terrain-build.js).
  const { KEY_LIGHT } = await import("../src/scene/terrain-build.js");
  KEY_LIGHT.forEach((c, i) => near(c, key[i], 1e-12));
});
