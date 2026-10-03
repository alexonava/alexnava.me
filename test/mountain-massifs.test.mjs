// The Meshy massifs (mountain-build.js RANGE_PLACEMENTS, hill-silhouette.js MASSIFS):
// the delivered GLBs, their placements, the composed skyline behind every tour
// shot, the massif shading, and how the ranges load, land, fall back and free.

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { PerspectiveCamera, Texture } from "three";
import { glbAsset, modelBytes, parseGlb } from "./support/glb.mjs";
import {
  createHillSilhouette,
  HORIZON_HAZE,
  MASSIF_SNOW,
  MASSIFS,
  MOUNTAIN_AIR,
  snowReach,
} from "../src/scene/hill-silhouette.js";
import {
  buildMountains,
  createRangeGeometry,
  MOUNTAINS,
  mountainCrests,
  placeRange,
  RANGE_BACKDROP,
  RANGE_LAYERS,
  RANGE_PLACEMENTS,
  RANGE_SKY,
  rangeSkyline,
  sectorsInView,
  showRanges,
} from "../src/scene/mountain-build.js";
import { DEPTH_LAYER } from "../src/scene/depth-layers.js";

const near = (a, b, eps = 1e-4) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const TIERS = Object.freeze({ high: 125_000, balanced: 95_000 });

// A delivered massif as placeRange() takes it, with its node extras.
function massif(role, tier = "high") {
  const mesh = glbAsset(modelBytes(role, tier)).scene.children[0],
    { position, uv } = mesh.geometry.attributes;
  return {
    position,
    uv,
    index: mesh.geometry.index,
    height: mesh.userData.height,
    extras: mesh.userData,
  };
}
const models = Object.fromEntries(MASSIFS.roles.map((role) => [role, massif(role)]));
const composed = createRangeGeometry(models);

test("the Meshy massifs ship as compact, quantized, object-space GLBs within their caps", () => {
  for (const role of MASSIFS.roles) {
    const shapes = [];
    for (const [tier, cap] of Object.entries(TIERS)) {
      const bytes = modelBytes(role, tier),
        { json } = parseGlb(bytes);
      assert.ok(bytes.length <= cap, `${role}-${tier} ${bytes.length} bytes > ${cap}`);
      assert.deepEqual(json.extensionsRequired, ["EXT_texture_webp", "KHR_mesh_quantization"]);
      assert.equal(json.meshes.length, 1);
      assert.equal(json.meshes[0].primitives.length, 1);
      const { attributes, indices, material } = json.meshes[0].primitives[0],
        type = (id) => [json.accessors[id].componentType, Boolean(json.accessors[id].normalized)];
      assert.deepEqual(Object.keys(attributes).sort(), ["NORMAL", "POSITION", "TEXCOORD_0"]);
      assert.deepEqual(type(attributes.POSITION), [5122, true], "int16 positions");
      assert.deepEqual(type(attributes.NORMAL), [5120, true], "int8 normals");
      assert.deepEqual(type(attributes.TEXCOORD_0), [5123, true], "uint16 UVs");
      assert.equal(json.accessors[indices].componentType, 5123, "uint16 indices");
      const m = json.materials[material];
      assert.ok(m.pbrMetallicRoughness.baseColorTexture, "the mask");
      assert.ok(m.normalTexture, "the object-space normal map");
      assert.equal(m.emissiveTexture, undefined, "the supplied emissive glow is dropped");
      assert.equal(m.pbrMetallicRoughness.metallicRoughnessTexture, undefined);
      assert.notEqual(m.doubleSided, true, "single-sided");
      assert.ok(json.images.every((image) => image.mimeType === "image/webp"));
      const extras = json.nodes[0].extras;
      assert.equal(extras.role, role);
      assert.equal(extras.quality, tier);
      assert.equal(extras.front, "+Z");
      assert.equal(extras.mountain.normalSpace, "object");
      assert.ok(extras.height > 0 && extras.height <= 1);
      for (const key of ["yaw", "distance", "height"]) assert.ok(key in extras.mountain.envelope);
      shapes.push(massif(role, tier).position.array);
    }
    // One composition on every tier: the tiers differ only in their maps.
    assert.deepEqual(shapes[0], shapes[1], `${role} geometry differs between tiers`);
  }
});

test("every placement is one eye inside its model's culled envelope, in its layer's shell", () => {
  const ids = new Set();
  // The shells lie past the ground's horizon haze and inside the backdrop rings' lowest row.
  const backdrop =
    Math.min(...RANGE_BACKDROP.ranges.map((range) => MOUNTAINS.radii[range])) *
    MOUNTAINS.rows.at(-1);
  RANGE_LAYERS.forEach(([inner, outer], layer) => {
    assert.ok(inner < outer);
    if (layer) assert.ok(inner > RANGE_LAYERS[layer - 1][1], "layers do not overlap");
  });
  assert.ok(RANGE_LAYERS[0][0] > HORIZON_HAZE.far);
  assert.ok(RANGE_LAYERS.at(-1)[1] < backdrop, `${RANGE_LAYERS.at(-1)[1]} >= ${backdrop}`);
  for (const p of RANGE_PLACEMENTS) {
    assert.ok(!ids.has(p.id), `${p.id} twice`);
    ids.add(p.id);
    assert.ok(MASSIFS.roles.includes(p.role), p.id);
    assert.ok([0, 1, 2].includes(p.layer), p.id);
    const env = models[p.role].extras.mountain.envelope;
    assert.ok(Math.abs(p.yaw) <= env.yaw, `${p.id} yaw ${p.yaw}`);
    assert.ok(
      p.distance >= env.distance[0] && p.distance <= env.distance.at(-1),
      `${p.id} distance`,
    );
    assert.ok(p.sink >= env.height[0] && p.sink <= env.height.at(-1), `${p.id} sink`);
    assert.ok(p.squash > 0.4 && p.squash <= 1, `${p.id} squash`);
    assert.ok(p.snow >= 0, p.id);
    if (p.layer === 0) assert.equal(p.snow, 0, `${p.id}: the near layer stays bare`);
    // The shell remap slides each vertex along its own sight line into the layer's shell.
    const shape = placeRange(models[p.role], p),
      [inner, outer] = RANGE_LAYERS[p.layer];
    for (let i = 0; i < shape.elevation.length; i++) {
      const x = shape.position[i * 3],
        y = shape.position[i * 3 + 1],
        z = shape.position[i * 3 + 2],
        r = Math.hypot(x, y, z);
      assert.ok(r >= inner - 1e-3 && r <= outer + 1e-3, `${p.id} vertex ${i} at ${r}`);
      near((Math.atan2(y, Math.hypot(x, z)) * 180) / Math.PI, shape.elevation[i], 1e-3);
    }
  }
});

test("a placement keeps what its eye sees: affine, mirrored winding, the azimuth it names", () => {
  const p = RANGE_PLACEMENTS.find((item) => item.mirror),
    plain = { ...p, mirror: false },
    a = placeRange(models[p.role], plain),
    b = placeRange(models[p.role], p);
  // The mirror swaps each triangle's winding, so the faces still face the camera.
  for (let t = 0; t < a.index.length; t += 3) {
    assert.equal(b.index[t], a.index[t]);
    assert.equal(b.index[t + 1], a.index[t + 2]);
    assert.equal(b.index[t + 2], a.index[t + 1]);
  }
  // The eye's line to the bounding centre points at the placement's azimuth.
  for (const q of RANGE_PLACEMENTS) {
    const sky = rangeSkyline(placeRange(models[q.role], q)),
      reach = sky.values.reduce((n, v) => n + (v > -90), 0);
    const from = sky.from,
      span = sky.values.length * RANGE_SKY.bin;
    assert.ok(q.azimuth > from && q.azimuth < from + span, `${q.id} sits in its own span`);
    assert.ok(reach > 0.9 * sky.values.length, `${q.id} skyline is continuous`);
  }
});

// The combined skyline: every massif's own (finest bins) and the backdrop rings.
const backdropCrests = mountainCrests(RANGE_BACKDROP);
function skylineAt(azimuth) {
  let best = -90;
  for (const { sky } of composed.placed) {
    for (const turn of [-360, 0, 360]) {
      const j = Math.floor((azimuth + turn - sky.from) / RANGE_SKY.bin);
      if (j >= 0 && j < sky.values.length) best = Math.max(best, sky.values[j]);
    }
  }
  const column = Math.round((((azimuth % 360) + 360) % 360) * (MOUNTAINS.columns / 360));
  for (const range of RANGE_BACKDROP.ranges)
    best = Math.max(best, backdropCrests[range][column % MOUNTAINS.columns]);
  return best;
}
const highest = (from, to) => {
  let best = -90;
  for (let a = from; a <= to; a += RANGE_SKY.bin / 2) best = Math.max(best, skylineAt(a));
  return best;
};

test("the composed skyline keeps the sun saddle, Close-up and Threshold clear and the tour peaks dramatic", () => {
  for (const [from, to, cap] of [
    [171, 183, 3],
    [232, 280, 3],
    [-1, 8, 3.2],
    // The tree shots: taller than the rings' 2.1 degrees (owner, 2026-10-03), with
    // an open band of sky kept above them (framing.test.mjs).
    [22, 86, 4.5],
  ])
    assert.ok(highest(from, to) <= cap, `${from}-${to} rises to ${highest(from, to)}`);
  for (const [from, to, least] of [
    [141, 164, 7],
    [5, 17, 5.4],
    [96, 120, 4],
  ])
    assert.ok(highest(from, to) >= least, `${from}-${to} peaks at ${highest(from, to)}`);
  // The near layer stays low and bare.
  for (const { placement, sky } of composed.placed)
    if (placement.layer === 0)
      assert.ok(
        Math.max(...sky.values) <= 2.5,
        `${placement.id} rises to ${Math.max(...sky.values)}`,
      );
  // The backdrop: hazy depth with no authored summits, under the massifs it stands behind.
  assert.deepEqual(RANGE_BACKDROP.ranges, [3, 4]);
  for (const range of RANGE_BACKDROP.ranges)
    assert.ok(Math.max(...backdropCrests[range]) < 5, `ring ${range} stays below the heroes`);
});

test("each massif's mesh runs sector by sector from the seam, nearest layer first, drawn with a sector of padding", () => {
  const { count, seam } = MOUNTAINS.sectors,
    width = 360 / count;
  for (const [role, geometry] of Object.entries(composed.geometries)) {
    const { starts, pad } = geometry.userData.sectors,
      position = geometry.attributes.position,
      terrain = geometry.attributes.aTerrain,
      index = geometry.index.array;
    assert.equal(starts.length, count + 1);
    assert.equal(starts.at(-1), index.length);
    assert.equal(pad, 1);
    for (let s = 0; s < count; s++) {
      let layer = -1;
      for (let t = starts[s]; t < starts[s + 1]; t += 3) {
        // Each triangle sits in its centroid's sector (azimuths unwrapped about its first corner).
        const az = [0, 1, 2].map(
            (k) =>
              (Math.atan2(position.getZ(index[t + k]), position.getX(index[t + k])) * 180) /
              Math.PI,
          ),
          mean =
            az[0] + (((az[1] - az[0] + 540) % 360) - 180 + ((az[2] - az[0] + 540) % 360) - 180) / 3;
        assert.equal(
          Math.floor(((((mean - seam) % 360) + 360) % 360) / width),
          s,
          `${role} sector ${s}`,
        );
        const l = terrain.getY(index[t]);
        assert.ok(l >= layer, `${role} sector ${s}: nearest layer first`);
        layer = l;
      }
    }
  }
  // A view draws its sectors and one more each side, then the whole mesh again.
  const geometry = composed.geometries["mountain-summit"],
    { starts } = geometry.userData.sectors,
    mesh = { material: null };
  assert.equal(showRanges(mesh, geometry), true);
  const camera = new PerspectiveCamera(38, 16 / 9, 0.1, 450);
  camera.lookAt(Math.cos((151 * Math.PI) / 180), 0.05, Math.sin((151 * Math.PI) / 180));
  camera.updateMatrixWorld();
  const [first, span] = sectorsInView(camera);
  mesh.onBeforeRender(null, null, camera, geometry);
  const from = Math.max(0, first - 1),
    to = Math.min(count, first + span + 1);
  assert.deepEqual(
    [geometry.drawRange.start, geometry.drawRange.count],
    [starts[from], starts[to] - starts[from]],
  );
  mesh.onAfterRender(null, null, camera, geometry);
  assert.deepEqual([geometry.drawRange.start, geometry.drawRange.count], [0, starts.at(-1)]);
});

test("the massifs' attributes: depth below their own crest, layer, snowline and massif; the placement for the normals", () => {
  for (const [role, geometry] of Object.entries(composed.geometries)) {
    const terrain = geometry.attributes.aTerrain,
      inst = geometry.attributes.aInst,
      uv = geometry.attributes.uv;
    assert.equal(terrain.itemSize, 4);
    assert.equal(inst.itemSize, 4);
    assert.equal(uv.itemSize, 2);
    let crest = 0;
    for (let v = 0; v < terrain.count; v++) {
      assert.ok(terrain.getX(v) >= 0, `${role} ${v} above its own crest`);
      if (terrain.getX(v) < 1e-3) crest++;
      assert.ok([0, 1, 2].includes(terrain.getY(v)));
      near(Math.hypot(inst.getX(v), inst.getY(v)), 1, 1e-5);
      assert.ok([1, -1].includes(inst.getZ(v)));
      assert.ok(inst.getW(v) > 0.4 && inst.getW(v) <= 1);
    }
    assert.ok(crest > 50, `${role}: the crest itself reads 0 (${crest})`);
  }
  // Snow: only on the copies with a snowline, and their massif height carries it.
  for (const { placement, massif } of composed.placed)
    if (placement.snow)
      assert.ok(Math.max(...massif) > placement.snow, `${placement.id} reaches its snowline`);
});

test("massif snow follows the rings' rule from each copy's own snowline, mirrored by snowReach", () => {
  assert.equal(MASSIF_SNOW.tongue, 0.5);
  assert.ok(MASSIF_SNOW.depth > 0 && MASSIF_SNOW.max > 0);
  const line = 2;
  // A massif below its snowline holds none; high on a tall one, all reach.
  assert.equal(snowReach(1.5, 1.9, { ...MASSIF_SNOW, line }), 0);
  assert.equal(snowReach(7.9, 8, { ...MASSIF_SNOW, line }), 1);
  // The reach never extends past the cap, its full gully tongue and the jitter.
  const cap = Math.min(MASSIF_SNOW.max, (8 - line) * MASSIF_SNOW.depth),
    lowest =
      8 -
      cap * (1 + MASSIF_SNOW.tongue) -
      Math.max(cap * MASSIF_SNOW.jitter, MASSIF_SNOW.jitterMin);
  assert.equal(snowReach(lowest + 0.01, 8, { ...MASSIF_SNOW, line }), 1);
  assert.equal(snowReach(lowest - 0.01, 8, { ...MASSIF_SNOW, line }), 0);
});

// A stand-in for loadArchitectureAsset(): the delivered GLB with maps whose
// bitmaps record when they close.
function deliver(log) {
  return (url, { tier, role, priority, signal }) => {
    log.push({ url, tier, role, priority, signal });
    const asset = glbAsset(modelBytes(role, tier)),
      mesh = asset.scene.children[0];
    for (const kind of ["normalMap", "map"]) {
      const texture = new Texture({ close: () => log.push(`close ${role} ${kind}`) });
      texture.dispose = () => log.push(`dispose ${role} ${kind}`);
      mesh.material[kind] = texture;
    }
    return Promise.resolve(asset);
  };
}
const URLS = Object.fromEntries(
  ["high", "balanced"].map((tier) => [
    tier,
    Object.fromEntries(MASSIFS.roles.map((role) => [role, `/${role}-${tier}.glb`])),
  ]),
);

test("at a model tier the ranges load the massifs at low priority and land them with the backdrop", async () => {
  const log = [],
    statuses = [];
  const hill = createHillSilhouette({
    groundHeight: () => 0,
    tier: "balanced",
    urls: URLS,
    loadAsset: deliver(log),
    onStatus: (status) => statuses.push(status),
  });
  hill.applyQuality({ tier: "balanced" });
  hill.setFilmTreatment(true);
  await hill.ready;
  assert.deepEqual(
    log.filter((entry) => entry.url).map(({ url, tier, priority }) => [url, tier, priority]),
    MASSIFS.roles.map((role) => [`/${role}-balanced.glb`, "balanced", "low"]),
  );
  assert.deepEqual(statuses, ["loading", "ready"]);
  // The backdrop: RANGE_BACKDROP's two rings.
  assert.equal(
    hill.mesh.geometry.attributes.position.count,
    RANGE_BACKDROP.ranges.length * MOUNTAINS.rows.length * MOUNTAINS.columns,
  );
  const root = hill.mesh.children.find((child) => child.name === "film-massifs");
  assert.ok(root.visible);
  assert.equal(root.children.length, MASSIFS.roles.length);
  for (const mesh of root.children) {
    assert.equal(mesh.material.name, "EstateMeshyRanges");
    assert.equal(mesh.renderOrder, MASSIFS.renderOrder);
    assert.equal(mesh.frustumCulled, false);
    assert.ok(mesh.geometry.attributes.aTerrain.count > 0);
    const { uNormal, uMask, uNearer } = mesh.material.uniforms;
    assert.ok(uNormal.value.isTexture && uMask.value.isTexture);
    assert.equal(uMask.value.colorSpace, "", "the mask is data");
    assert.equal(uNearer.value.image.width, MASSIFS.sky.texture);
    assert.ok(
      uNearer.value.image.data.some((byte) => byte > 0),
      "the skyline texels arrived",
    );
  }
  // Baseline: the massifs hide with the film.
  hill.setFilmTreatment(false);
  assert.equal(root.visible, false);
  hill.setFilmTreatment(true);
  assert.equal(root.visible, true);
  // Freed on dispose: each map before the bitmap it reads.
  hill.dispose();
  for (const role of MASSIFS.roles)
    for (const kind of ["normalMap", "map"])
      assert.ok(
        log.indexOf(`dispose ${role} ${kind}`) < log.indexOf(`close ${role} ${kind}`),
        `${role} ${kind} disposed before its bitmap closes`,
      );
});

test("a failed massif GLB lands the five rings instead; low and baseline never load them", async () => {
  const log = [],
    statuses = [];
  const failing = (url, options) =>
    options.role === "mountain-spine"
      ? Promise.reject(new Error("404"))
      : deliver(log)(url, options);
  const hill = createHillSilhouette({
    groundHeight: () => 0,
    tier: "high",
    urls: URLS,
    loadAsset: failing,
    onStatus: (status) => statuses.push(status),
  });
  hill.applyQuality({ tier: "high" });
  hill.setFilmTreatment(true);
  await hill.ready;
  assert.deepEqual(statuses, ["loading", "fallback"]);
  assert.equal(
    hill.mesh.geometry.attributes.position.count,
    MOUNTAINS.radii.length * MOUNTAINS.rows.length * MOUNTAINS.columns,
    "the five rings",
  );
  assert.equal(
    hill.mesh.children.find((child) => child.name === "film-massifs").children.length,
    0,
  );
  // The two that did load were freed at once.
  for (const role of ["mountain-ridge", "mountain-summit"])
    assert.ok(log.includes(`close ${role} normalMap`), `${role} freed`);
  hill.dispose();
  // Low never loads them; neither does a scene without a model tier.
  for (const options of [
    { tier: "high", quality: "low" },
    { tier: null, quality: "high" },
  ]) {
    const calls = [];
    const other = createHillSilhouette({
      groundHeight: () => 0,
      tier: options.tier,
      urls: URLS,
      loadAsset: (...args) => {
        calls.push(args);
        return Promise.reject(new Error("unexpected"));
      },
    });
    other.applyQuality({ tier: options.quality });
    other.setFilmTreatment(true);
    await other.ready;
    assert.equal(calls.length, 0);
    other.dispose();
  }
});

test("the massif shader is the ranges' moonlit style on the models' own relief", async () => {
  const hill = createHillSilhouette({
    groundHeight: () => 0,
    tier: "high",
    urls: URLS,
    loadAsset: deliver([]),
  });
  hill.applyQuality({ tier: "high" });
  hill.setFilmTreatment(true);
  await hill.ready;
  const mesh = hill.mesh.children[0].children[0],
    { vertexShader, fragmentShader } = mesh.material,
    ranges = hill.mesh.material.fragmentShader;
  // It rides the camera with the rings' depth compression and writes the mountains' layer.
  assert.match(vertexShader, /vec4 w=vec4\(cameraPosition\+position,1\.0\)/);
  assert.match(vertexShader, /gl_Position\.z=mix\(gl_Position\.z,gl_Position\.w,\.8\);/);
  assert.ok(fragmentShader.includes(`gl_FragColor=vec4(c,${DEPTH_LAYER.mountains});`));
  // The object-space map turned by the placement.
  assert.ok(fragmentShader.includes("m.x*=vI.z; m.y/=vI.w;"));
  assert.ok(
    fragmentShader.includes("vec3 n=normalize(vec3(m.x*vI.x-m.z*vI.y,m.y,m.x*vI.y+m.z*vI.x));"),
  );
  // The rings' sky, far plain, rims and ink, verbatim; the rock one air farther out.
  for (const shared of [
    "float b=dot(o,d), t=-b+sqrt(max(b*b-dot(o,o)+uSky.x,0.)), a=(o.y+d.y*t)*inversesqrt(uSky.x);",
    "c=mix(c,vec3(.012,.016,.03),(1.-smoothstep(.4,1.4,px))*(.7-.3*k));",
    "c=mix(c,pa,fh*(1.-smoothstep(-.02,0.,vL.y/r)));",
    "+vec3(.1,.07,.04)*pow(max(dot(v,toSun),0.),60.));",
  ]) {
    assert.ok(ranges.includes(shared), `the rings keep: ${shared}`);
    assert.ok(fragmentShader.includes(shared), `the massifs share: ${shared}`);
  }
  assert.equal(MASSIFS.air, 1);
  assert.ok(
    fragmentShader.includes(
      `float T=mix(mix(mix(mix(${MOUNTAIN_AIR.transmittance[0]},${MOUNTAIN_AIR.transmittance[1]},step(0.5,(vT.y+1.0)))`,
    ),
  );
  // Snow from each copy's own snowline (aTerrain.z), only where it has one.
  assert.ok(
    fragmentShader.includes(
      `float cap=clamp((vT.w-vT.z)*${MASSIF_SNOW.depth},0.,${MASSIF_SNOW.max});`,
    ),
  );
  assert.ok(fragmentShader.includes("if(vT.z>.5&&cap>0.)"));
  // Between the stars and the rings, after which it covers them.
  assert.ok(MASSIFS.renderOrder > -0.75 && MASSIFS.renderOrder < MOUNTAIN_AIR.renderOrder);
  assert.equal(mesh.material.transparent, true);
  hill.dispose();
});

test("the massifs' constants agree across the entry and the lazy chunk", async () => {
  assert.deepEqual(
    { ...MASSIFS.sky },
    { texture: RANGE_SKY.texture, floor: RANGE_SKY.floor, span: RANGE_SKY.span },
  );
  assert.deepEqual(
    [...new Set(RANGE_PLACEMENTS.map((p) => p.role))].sort(),
    [...MASSIFS.roles].sort(),
  );
  // The chunk names no first-party module: the entry hands it everything.
  const chunk = await readFile(new URL("../src/scene/mountain-build.js", import.meta.url), "utf8");
  assert.deepEqual(
    [...chunk.matchAll(/^import [\s\S]*? from "([^"]+)";$/gm)].map((m) => m[1]),
    ["three"],
  );
});

test("the composed build lands in short slices and frees itself when cancelled", async () => {
  const idle = globalThis.requestIdleCallback,
    style = globalThis.getComputedStyle,
    raf = globalThis.requestAnimationFrame,
    slices = [];
  try {
    globalThis.requestAnimationFrame = (task) => setImmediate(() => task(performance.now()));
    globalThis.requestIdleCallback = (task) =>
      setImmediate(() => {
        const start = performance.now();
        task({ didTimeout: false, timeRemaining: () => 4 });
        slices.push(performance.now() - start);
      });
    globalThis.getComputedStyle = () => ({ transitionDuration: "0s" });
    const rendering = {
      renderer: { domElement: { parentNode: { classList: { contains: () => true } } } },
    };
    const meshes = Object.fromEntries(MASSIFS.roles.map((role) => [role, { material: null }])),
      texels = new Uint8Array(RANGE_SKY.texture * 4);
    const built = await buildMountains({
      rendering,
      tour: { running: false, transition: { cut: false } },
      models,
      massifs: meshes,
      texels,
    });
    assert.ok(built.userData.massifs);
    for (const role of MASSIFS.roles) {
      assert.equal(meshes[role].geometry, built.userData.massifs[role]);
      assert.deepEqual(
        meshes[role].geometry.attributes.aTerrain.array,
        composed.geometries[role].attributes.aTerrain.array,
      );
    }
    assert.deepEqual(texels, composed.texture);
    const sorted = [...slices].sort((a, b) => a - b);
    assert.ok(sorted.at(-1) < 50, `no long task (${sorted.at(-1).toFixed(1)} ms)`);
    assert.ok(
      sorted[sorted.length >> 1] < 8,
      `median slice ${sorted[sorted.length >> 1].toFixed(1)} ms`,
    );
    built.dispose();
    Object.values(built.userData.massifs).forEach((geometry) => geometry.dispose());
    let gone = false;
    assert.equal(
      await buildMountains({
        rendering,
        models,
        massifs: meshes,
        cancelled: () => gone || !(gone = true),
      }),
      null,
    );
  } finally {
    if (raf) globalThis.requestAnimationFrame = raf;
    else delete globalThis.requestAnimationFrame;
    if (idle) globalThis.requestIdleCallback = idle;
    else delete globalThis.requestIdleCallback;
    if (style) globalThis.getComputedStyle = style;
    else delete globalThis.getComputedStyle;
  }
});
