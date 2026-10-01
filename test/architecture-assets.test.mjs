import assert from "node:assert/strict";
import test, { after } from "node:test";
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Texture } from "three";
import {
  ARCHITECTURE_ASSET_BUDGETS,
  ARCHITECTURE_ASSET_URLS,
  createArchitectureAssetController,
  loadArchitectureAsset,
} from "../src/scene/architecture-assets.js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseGlb } from "./support/glb.mjs";

const flush = () => new Promise((resolve) => setImmediate(resolve));

const towerRoles = ["tower"];

function asset(name, events = []) {
  const counts = { geometry: 0, material: 0, color: 0, roughness: 0, bitmap: 0 };
  const bitmap = {
    close() {
      counts.bitmap += 1;
      events.push(`${name}:bitmap`);
    },
  };
  const geometry = new BoxGeometry();
  const material = new MeshStandardMaterial();
  const color = new Texture(bitmap);
  const roughness = new Texture(bitmap);
  material.map = color;
  material.roughnessMap = roughness;
  for (const [kind, resource] of Object.entries({ geometry, material, color, roughness })) {
    resource.addEventListener("dispose", () => {
      counts[kind] += 1;
      events.push(`${name}:${kind}`);
    });
  }
  const scene = new Group();
  scene.add(new Mesh(geometry, material), new Mesh(geometry, [material, material]));
  return { scene, scenes: [scene], counts, geometry, material, color, roughness, bitmap };
}

function harness(options = {}) {
  const requests = [],
    statuses = [],
    towerReady = [],
    treeReady = [],
    events = [];
  const controller = createArchitectureAssetController({
    ...options,
    loadAsset(url, { signal, tier, role }) {
      let resolve, reject;
      const promise = new Promise((yes, no) => {
        resolve = yes;
        reject = no;
      });
      requests.push({ url, signal, tier, role, resolve, reject });
      return promise;
    },
    onStatus(status) {
      statuses.push(status);
    },
    onTowerReady(assets, context) {
      towerReady.push({ assets, context });
      events.push("tower:ready");
      if (options.failTowerReady) throw new Error("assembly failed");
      return () => {
        events.push("tower:cleanup");
      };
    },
    onTreeReady(assets, context) {
      treeReady.push({ assets, context });
      events.push("tree:ready");
      return () => {
        events.push("tree:cleanup");
      };
    },
    onRestoreTower() {
      events.push("tower:restore");
      if (options.failTowerRestore) throw new Error("restoration failed");
    },
    onRestoreTree() {
      events.push("tree:restore");
    },
  });
  return { controller, requests, statuses, towerReady, treeReady, events };
}

function request(h, role, tier = "high") {
  return h.requests.findLast((record) => record.role === role && record.tier === tier);
}

function complete(h, roles = [...towerRoles, "tree"], tier = "high") {
  return roles.map((role) => {
    const parsed = asset(`${tier}-${role}`, h.events);
    request(h, role, tier).resolve(parsed);
    return parsed;
  });
}

function assertReleased(parsed, expected = 1) {
  assert.deepEqual(Object.values(parsed.counts), Array(5).fill(expected));
}

test("architecture requests require live high/balanced quality and repeated state does not reload", async () => {
  for (const options of [{ disabled: true }, {}]) {
    const h = harness(options);
    h.controller.setQuality({ tier: "high" });
    h.controller.applyQuality({ tier: "balanced" });
    assert.equal(h.requests.length, 0);
    h.controller.setQuality({ tier: "low" }, true);
    h.controller.setQuality({ tier: "unknown" }, true);
    assert.equal(h.requests.length, 0);
    h.controller.setQuality({ tier: "high" }, true);
    assert.equal(h.requests.length, options.disabled ? 0 : 2);
    h.controller.applyQuality({ tier: "high" });
    h.controller.setLive(true);
    assert.equal(h.requests.length, options.disabled ? 0 : 2);
    h.controller.dispose();
  }
});

test("complete mode requests only the selected tower and independent tree after the live gate", async () => {
  const h = harness();
  h.controller.setQuality({ tier: "high" });
  h.controller.setQuality({ tier: "low" }, true);
  assert.equal(h.requests.length, 0);
  h.controller.setQuality({ tier: "high" }, true);
  assert.deepEqual(
    h.requests.map(({ role }) => role),
    ["tower", "tree"],
  );
  assert.deepEqual(
    h.requests.map(({ url }) => url),
    [ARCHITECTURE_ASSET_URLS.high.tower, ARCHITECTURE_ASSET_URLS.high.tree],
  );
  h.controller.applyQuality({ tier: "high" });
  h.controller.setLive(true);
  assert.equal(h.requests.length, 2);
  const [tree] = complete(h, ["tree"]);
  await flush();
  assert.equal(h.treeReady.length, 1);
  assert.equal(h.towerReady.length, 0);
  const [tower] = complete(h, ["tower"]);
  await flush();
  assert.deepEqual(Object.keys(h.towerReady[0].assets), ["tower"]);
  assert.equal(h.towerReady[0].assets.tower, tower);
  assert.equal(h.towerReady[0].context.tier, "high");
  assertReleased(tree, 0);
  assertReleased(tower, 0);
  h.controller.applyQuality({ tier: "low" });
  for (const role of ["tower", "tree"]) {
    assert.ok(h.events.indexOf(`${role}:restore`) < h.events.indexOf(`${role}:cleanup`));
    assert.ok(h.events.indexOf(`${role}:cleanup`) < h.events.indexOf(`high-${role}:geometry`));
  }
  assertReleased(tower);
  assertReleased(tree);
  assert.equal(h.controller.dispose(), true);
  assert.equal(h.controller.dispose(), false);
});

test("complete mode ignores stale parses after a quality change and keeps current assets alive", async () => {
  const h = harness();
  h.controller.setQuality({ tier: "high" }, true);
  const highRequests = h.requests.slice();
  h.controller.applyQuality({ tier: "balanced" });
  assert.ok(highRequests.every(({ signal }) => signal.aborted));
  assert.deepEqual(
    h.requests.map(({ tier, role }) => [tier, role]),
    [
      ["high", "tower"],
      ["high", "tree"],
      ["balanced", "tower"],
      ["balanced", "tree"],
    ],
  );
  const current = complete(h, ["tower", "tree"], "balanced");
  await flush();
  const stale = complete(h, ["tower", "tree"]);
  await flush();
  stale.forEach((parsed) => assertReleased(parsed));
  current.forEach((parsed) => assertReleased(parsed, 0));
  assert.equal(h.towerReady.length, 1);
  assert.equal(h.towerReady[0].context.tier, "balanced");
  assert.equal(h.treeReady.length, 1);
  h.controller.dispose();
  current.forEach((parsed) => assertReleased(parsed));
});

test("complete mode retains fallback on tower download or assembly failure without interrupting the tree", async () => {
  for (const failTowerReady of [false, true]) {
    const h = harness({ failTowerReady });
    h.controller.setQuality({ tier: "high" }, true);
    const [tree] = complete(h, ["tree"]);
    let tower;
    if (failTowerReady) [tower] = complete(h, ["tower"]);
    else request(h, "tower").reject(new Error("tower unavailable"));
    await flush();
    assert.equal(h.statuses.findLast((status) => status.kind === "tower").status, "fallback");
    assert.equal(h.treeReady.length, 1);
    assertReleased(tree, 0);
    if (tower) assertReleased(tower);
    assert.equal(request(h, "tower").signal.aborted, true);
    assert.equal(request(h, "tree").signal.aborted, false);
    h.controller.applyQuality({ tier: "high" });
    h.controller.setLive(true);
    assert.equal(h.requests.length, 2, "failed loads do not retry every frame");
    h.controller.dispose();
    assertReleased(tree);
    if (tower) assertReleased(tower);
  }
});

test("complete mode releases late tower parses after low quality, gate closure, or teardown", async () => {
  for (const action of ["low", "gate", "dispose"]) {
    const h = harness();
    h.controller.setQuality({ tier: "high" }, true);
    const [tree] = complete(h, ["tree"]);
    await flush();
    if (action === "low") h.controller.applyQuality({ tier: "low" });
    else if (action === "gate") h.controller.setLive(false);
    else h.controller.dispose();
    assert.equal(request(h, "tower").signal.aborted, true);
    const [lateTower] = complete(h, ["tower"]);
    await flush();
    assertReleased(tree);
    assertReleased(lateTower);
    assert.equal(h.towerReady.length, 0);
    h.controller.dispose();
    assertReleased(lateTower);
  }
});

test("tree failure is independent and a controlled tier change retries each role once", async () => {
  const h = harness();
  h.controller.setQuality({ tier: "high" }, true);
  const tower = complete(h, towerRoles);
  request(h, "tree").reject(new Error("image unavailable"));
  await flush();
  assert.equal(h.towerReady.length, 1);
  assert.equal(h.treeReady.length, 0);
  assert.equal(h.statuses.findLast((s) => s.kind === "tree").status, "fallback");
  for (let index = 0; index < 4; index += 1) h.controller.applyQuality({ tier: "high" });
  assert.equal(h.requests.length, 2);
  h.controller.applyQuality({ tier: "balanced" });
  assert.equal(h.requests.length, 4);
  tower.forEach((parsed) => assertReleased(parsed));
  assert.ok(h.events.indexOf("tower:restore") < h.events.indexOf("tower:cleanup"));
  assert.ok(h.events.indexOf("tower:cleanup") < h.events.indexOf("high-tower:geometry"));
  const balanced = complete(h, [...towerRoles, "tree"], "balanced");
  await flush();
  assert.equal(h.towerReady.length, 2);
  assert.equal(h.treeReady.length, 1);
  h.controller.dispose();
  balanced.forEach((parsed) => assertReleased(parsed));
});

test("a pinned asset tier keeps live models through adaptive profile changes without refetching", async () => {
  {
    const h = harness();
    const roles = ["tower", "tree"];
    // Scene order: quality is applied before the first frame opens the live gate.
    h.controller.applyQuality({ tier: "balanced" }, { pixelRatio: 1.5, assetTier: "high" });
    assert.equal(h.requests.length, 0);
    h.controller.setLive(true);
    assert.deepEqual(
      h.requests.map(({ tier }) => tier),
      roles.map(() => "high"),
    );
    const parsed = complete(h, roles);
    await flush();
    const statusCount = h.statuses.length;
    for (const tier of ["balanced", "low", "high", "balanced"]) {
      assert.equal(
        h.controller.applyQuality({ tier }, { pixelRatio: 1, assetTier: "high" }),
        false,
      );
    }
    assert.equal(h.controller.setQuality({ tier: "low" }, true, { assetTier: "high" }), false);
    assert.equal(h.requests.length, roles.length, "no other tier is downloaded");
    assert.ok(h.requests.every(({ signal }) => !signal.aborted));
    assert.equal(h.statuses.length, statusCount, "no procedural or loading status is published");
    assert.ok(
      !h.events.some((event) => event.endsWith(":restore")),
      "live models are never blanked",
    );
    assert.ok(h.statuses.every(({ tier }) => tier === "high"));
    parsed.forEach((model) => assertReleased(model, 0));
    h.controller.dispose();
    parsed.forEach((model) => assertReleased(model));
  }
});

test("stale high-quality parses cannot replace or free a newer balanced assembly", async () => {
  const h = harness();
  h.controller.setQuality({ tier: "high" }, true);
  const oldRequests = h.requests.slice();
  h.controller.applyQuality({ tier: "balanced" });
  assert.ok(oldRequests.every(({ signal }) => signal.aborted));
  const current = complete(h, [...towerRoles, "tree"], "balanced");
  await flush();
  const stale = complete(h);
  await flush();
  stale.forEach((parsed) => assertReleased(parsed));
  current.forEach((parsed) => assertReleased(parsed, 0));
  assert.equal(h.towerReady.length, 1);
  assert.equal(h.towerReady[0].context.tier, "balanced");
  assert.equal(h.treeReady.length, 1);
  h.controller.dispose();
  current.forEach((parsed) => assertReleased(parsed));
});

test("low quality or closing the live gate restores before disposal and ignores later completion", async () => {
  for (const action of ["low", "gate", "dispose"]) {
    const h = harness();
    h.controller.setQuality({ tier: "high" }, true);
    const [tree] = complete(h, ["tree"]);
    await flush();
    if (action === "low") h.controller.applyQuality({ tier: "low" });
    else if (action === "gate") h.controller.setLive(false);
    else h.controller.dispose();
    assertReleased(tree);
    assert.ok(h.events.indexOf("tree:restore") < h.events.indexOf("tree:cleanup"));
    assert.ok(h.events.indexOf("tree:cleanup") < h.events.indexOf("high-tree:geometry"));
    const pending = complete(h, towerRoles);
    await flush();
    pending.forEach((parsed) => assertReleased(parsed));
    assert.equal(h.towerReady.length, 0);
    if (action !== "dispose") assert.equal(h.controller.dispose(), true);
    assert.equal(h.controller.dispose(), false);
    assert.equal(h.controller.setLive(true), false);
    assert.equal(h.controller.applyQuality({ tier: "high" }), false);
    assertReleased(tree);
  }
});

test("shared scene resources dispose once and shared images close after all texture disposals", async () => {
  const h = harness();
  h.controller.setQuality({ tier: "high" }, true);
  const shared = asset("shared", h.events);
  request(h, "tower").resolve(shared);
  request(h, "tree").resolve(shared);
  await flush();
  assertReleased(shared, 0);
  h.controller.dispose();
  assertReleased(shared);
  assert.ok(h.events.indexOf("tree:restore") < h.events.indexOf("shared:geometry"));
  assert.ok(h.events.indexOf("shared:color") < h.events.indexOf("shared:bitmap"));
  assert.ok(h.events.indexOf("shared:roughness") < h.events.indexOf("shared:bitmap"));
});

test("assembly callback failure restores and frees tower assets without breaking the tree", async () => {
  const h = harness({ failTowerReady: true, failTowerRestore: true });
  h.controller.setQuality({ tier: "high" }, true);
  const parsed = complete(h);
  await flush();
  assertReleased(parsed[0]);
  assertReleased(parsed[1], 0);
  assert.equal(h.statuses.findLast((s) => s.kind === "tower").status, "fallback");
  assert.equal(h.statuses.findLast((s) => s.kind === "tree").status, "ready");
  h.controller.dispose();
  parsed.forEach((model) => assertReleased(model));
});

test("custom hashed URLs are used and invalid parsed assets never commit", async () => {
  const urls = {
    high: Object.fromEntries(
      [...towerRoles, "tree"].map((role) => [role, `/models/${role}.a1b2.glb`]),
    ),
  };
  const h = harness({ urls });
  h.controller.setQuality({ tier: "high" }, true);
  assert.ok(h.requests.every(({ url, role }) => url === urls.high[role]));
  const invalid = asset("invalid", h.events);
  invalid.scene.isObject3D = false;
  request(h, "tower").resolve(invalid);
  await flush();
  assertReleased(invalid);
  assert.equal(h.towerReady.length, 0);
  assert.equal(h.statuses.findLast((s) => s.kind === "tower").status, "fallback");
  h.controller.dispose();
});

test("reopening the live gate retries failed assets once without a per-frame retry loop", async () => {
  const h = harness();
  h.controller.applyQuality({ tier: "balanced" });
  h.controller.setLive(true);
  h.requests.forEach(({ reject }) => reject(new Error("offline")));
  await flush();
  assert.equal(h.requests.length, 2);
  h.controller.setLive(true);
  assert.equal(h.requests.length, 2);
  h.controller.setLive(false);
  h.controller.setLive(true);
  assert.equal(h.requests.length, 4);
  h.controller.dispose();
});

test("optional lantern loads independently and its failure cannot block the tree", async () => {
  const h = harness({ includeLantern: true });
  h.controller.setQuality({ tier: "high" }, true);
  assert.deepEqual(
    h.requests.map(({ role }) => role),
    ["tower", "tree", "lantern"],
  );
  const [tree] = complete(h, ["tree"]);
  await flush();
  assert.equal(h.treeReady.length, 1);
  assert.equal(h.statuses.findLast((s) => s.kind === "lantern").status, "loading");
  request(h, "lantern").reject(new Error("404 or image decode failed"));
  await flush();
  assert.equal(h.statuses.findLast((s) => s.kind === "lantern").status, "fallback");
  assertReleased(tree, 0);
  assert.equal(request(h, "tree").signal.aborted, false);
  h.controller.dispose();
  assertReleased(tree);
});

test("optional lantern releases staged and late parses after tier switches, gate closure and disposal", async () => {
  for (const action of ["tier", "gate", "dispose"]) {
    const ready = [],
      events = [];
    const h = harness({
      includeLantern: true,
      onLanternReady(parsed, { tier }) {
        ready.push(tier);
        return () => events.push("cleanup");
      },
      onRestoreLantern() {
        events.push("restore");
      },
    });
    h.controller.setQuality({ tier: "high" }, true);
    const old = request(h, "lantern");
    if (action === "tier") h.controller.applyQuality({ tier: "balanced" });
    else if (action === "gate") h.controller.setLive(false);
    else h.controller.dispose();
    assert.equal(old.signal.aborted, true);
    const stale = asset("stale");
    old.resolve(stale);
    await flush();
    assertReleased(stale);
    assert.deepEqual(ready, []);
    if (action === "tier") {
      const current = asset("balanced", events);
      request(h, "lantern", "balanced").resolve(current);
      await flush();
      assert.deepEqual(ready, ["balanced"]);
      assertReleased(current, 0);
      h.controller.applyQuality({ tier: "low" }, { assetTier: "balanced" });
      assertReleased(current, 0, "adaptive cost changes keep the startup model tier");
      h.controller.dispose();
      assertReleased(current);
      assert.ok(events.indexOf("restore") < events.indexOf("cleanup"));
      assert.ok(events.indexOf("cleanup") < events.indexOf("balanced:geometry"));
    }
    h.controller.dispose();
  }
});

function glb(json, binary = Buffer.alloc(0)) {
  const source = Buffer.from(JSON.stringify(json));
  const jsonLength = Math.ceil(source.length / 4) * 4;
  const binaryLength = Math.ceil(binary.length / 4) * 4;
  const buffer = Buffer.alloc(20 + jsonLength + (binary.length ? 8 + binaryLength : 0), 0x20);
  buffer.writeUInt32LE(0x46546c67, 0);
  buffer.writeUInt32LE(2, 4);
  buffer.writeUInt32LE(buffer.length, 8);
  buffer.writeUInt32LE(jsonLength, 12);
  buffer.writeUInt32LE(0x4e4f534a, 16);
  source.copy(buffer, 20);
  if (binary.length) {
    buffer.writeUInt32LE(binaryLength, 20 + jsonLength);
    buffer.writeUInt32LE(0x004e4942, 24 + jsonLength);
    binary.copy(buffer, 28 + jsonLength);
  }
  return buffer;
}

test("the real loader fetches with its abort signal and parses a self-contained static GLB", async () => {
  const previousFetch = globalThis.fetch;
  const abort = new AbortController();
  const data = glb({ asset: { version: "2.0" }, scene: 0, scenes: [{ nodes: [] }], nodes: [] });
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, signal: options.signal });
    return new Response(data);
  };
  try {
    const parsed = await loadArchitectureAsset(ARCHITECTURE_ASSET_URLS.high.tree, {
      signal: abort.signal,
      tier: "high",
    });
    assert.ok(parsed.scene.isObject3D);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].signal, abort.signal);
    assert.equal(requests[0].url, "/images/architecture/tree-high.glb");
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("the real loader rejects oversized, malformed, external, animated, and decoder-dependent assets", async () => {
  const previousFetch = globalThis.fetch;
  const context = { signal: new AbortController().signal, tier: "balanced" };
  const base = { asset: { version: "2.0" }, scene: 0, scenes: [{ nodes: [] }], nodes: [] };
  const cases = [
    { data: Buffer.alloc(10) },
    { data: Buffer.alloc(ARCHITECTURE_ASSET_BUDGETS.balanced + 1) },
    { data: glb({ ...base, buffers: [{ uri: "https://external.invalid/mesh.bin" }] }) },
    { data: glb({ ...base, images: [{ uri: "image.png" }] }) },
    { data: glb({ ...base, skins: [{}] }) },
    { data: glb({ ...base, animations: [{}] }) },
    { data: glb({ ...base, extensionsRequired: ["KHR_draco_mesh_compression"] }) },
    { data: glb(base), status: 404 },
    {
      data: glb(base),
      headers: { "content-length": String(ARCHITECTURE_ASSET_BUDGETS.balanced + 1) },
    },
  ];
  try {
    for (const { data, status = 200, headers } of cases) {
      let calls = 0;
      globalThis.fetch = async () => {
        calls += 1;
        return new Response(data, { status, headers });
      };
      await assert.rejects(loadArchitectureAsset("/test.glb", context));
      assert.equal(calls, 1, "No external dependency should be requested");
    }
    const aborted = new AbortController();
    globalThis.fetch = async () => {
      aborted.abort();
      return new Response(glb(base));
    };
    await assert.rejects(
      loadArchitectureAsset("/test.glb", { ...context, signal: aborted.signal }),
      { name: "AbortError" },
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("an embedded image failure rejects the GLB and closes other decoded images instead of committing null maps", async () => {
  const previousFetch = globalThis.fetch;
  const previousError = console.error;
  const descriptors = Object.fromEntries(
    ["self", "createImageBitmap"].map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  const binary = Buffer.concat([
    Buffer.from(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer),
    Buffer.from([1, 0, 0, 0]),
    Buffer.from([2, 0, 0, 0]),
  ]);
  const data = glb(
    {
      asset: { version: "2.0" },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0 }],
      buffers: [{ byteLength: binary.length }],
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: 36 },
        { buffer: 0, byteOffset: 36, byteLength: 4 },
        { buffer: 0, byteOffset: 40, byteLength: 4 },
      ],
      accessors: [
        {
          bufferView: 0,
          componentType: 5126,
          count: 3,
          type: "VEC3",
          min: [0, 0, 0],
          max: [1, 1, 0],
        },
      ],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
      materials: [
        { pbrMetallicRoughness: { baseColorTexture: { index: 0 } }, normalTexture: { index: 1 } },
      ],
      textures: [{ source: 0 }, { source: 1 }],
      images: [
        { bufferView: 1, mimeType: "image/png" },
        { bufferView: 2, mimeType: "image/png" },
      ],
    },
    binary,
  );
  let closed = 0,
    decoded = 0;
  const urls = [];
  globalThis.self = globalThis;
  globalThis.createImageBitmap = async (blob) => {
    decoded += 1;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (bytes[0] === 2) throw new Error("Invalid image pixels");
    return {
      width: 1,
      height: 1,
      close() {
        closed += 1;
      },
    };
  };
  globalThis.fetch = async (url, options) => {
    urls.push(url);
    return url === "/test.glb" ? new Response(data) : previousFetch(url, options);
  };
  console.error = () => {};
  try {
    await assert.rejects(
      loadArchitectureAsset("/test.glb", { tier: "high", signal: new AbortController().signal }),
      /Architecture image decode failed/,
    );
    assert.equal(decoded, 2);
    assert.equal(closed, 1);
    assert.equal(urls.filter((url) => !url.startsWith("blob:")).length, 1);
  } finally {
    globalThis.fetch = previousFetch;
    console.error = previousError;
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});

const base = { asset: { version: "2.0" }, scene: 0, scenes: [{ nodes: [] }], nodes: [] };

// main.js shares early model requests on window.BabelSite.scene.prefetched.
async function withPrefetched(entries, run) {
  const previousSite = Object.getOwnPropertyDescriptor(globalThis, "BabelSite");
  const previousFetch = globalThis.fetch;
  const prefetched = new Map(entries);
  const fetches = [];
  globalThis.BabelSite = { scene: { prefetched } };
  globalThis.fetch = async (url, options) => {
    fetches.push({ url, signal: options.signal });
    if (options.signal.aborted) throw new DOMException("Aborted", "AbortError");
    return new Response(glb(base));
  };
  try {
    return await run({ prefetched, fetches });
  } finally {
    globalThis.fetch = previousFetch;
    if (previousSite) Object.defineProperty(globalThis, "BabelSite", previousSite);
    else delete globalThis.BabelSite;
  }
}

function earlyRequest(response) {
  const entry = { aborted: 0, response };
  entry.response.catch(() => {});
  entry.abort = () => {
    entry.aborted += 1;
  };
  return entry;
}

test("the real loader consumes a matching early response once, then fetches for itself", async () => {
  const url = ARCHITECTURE_ASSET_URLS.high.tree;
  const early = earlyRequest(Promise.resolve(new Response(glb(base))));
  await withPrefetched([[url, early]], async ({ prefetched, fetches }) => {
    const signal = new AbortController().signal;
    const first = await loadArchitectureAsset(url, { signal, tier: "high", role: "tree" });
    assert.ok(first.scene.isObject3D);
    assert.equal(fetches.length, 0, "the early response replaces the scene's request");
    assert.equal(prefetched.has(url), false);
    assert.equal(early.aborted, 0);

    const second = await loadArchitectureAsset(url, { signal, tier: "high", role: "tree" });
    assert.ok(second.scene.isObject3D);
    assert.deepEqual(
      fetches.map((request) => [request.url, request.signal]),
      [[url, signal]],
    );
  });
});

test("the real loader ignores an early response for another URL", async () => {
  const other = earlyRequest(Promise.resolve(new Response(glb(base))));
  await withPrefetched(
    [[ARCHITECTURE_ASSET_URLS.balanced.tree, other]],
    async ({ prefetched, fetches }) => {
      const signal = new AbortController().signal;
      await loadArchitectureAsset(ARCHITECTURE_ASSET_URLS.high.tree, { signal, tier: "high" });
      assert.deepEqual(
        fetches.map(({ url }) => url),
        [ARCHITECTURE_ASSET_URLS.high.tree],
      );
      assert.equal(prefetched.get(ARCHITECTURE_ASSET_URLS.balanced.tree), other);
    },
  );
});

test("a failed or unsuccessful early request falls back to the loader's own request", async () => {
  const url = ARCHITECTURE_ASSET_URLS.high.tower;
  for (const [response, cancelled] of [
    [Promise.reject(new TypeError("Failed to fetch")), 0],
    [Promise.resolve(new Response("unavailable", { status: 503 })), 1],
  ]) {
    const early = earlyRequest(response);
    await withPrefetched([[url, early]], async ({ fetches }) => {
      const signal = new AbortController().signal;
      const parsed = await loadArchitectureAsset(url, { signal, tier: "high", role: "tower" });
      assert.ok(parsed.scene.isObject3D);
      assert.deepEqual(
        fetches.map((request) => [request.url, request.signal]),
        [[url, signal]],
      );
      assert.equal(early.aborted, cancelled, "an unused early body is cancelled");
    });
  }
});

test("the early response keeps the loader's byte budget and validation", async () => {
  const url = ARCHITECTURE_ASSET_URLS.balanced.tree;
  for (const response of [
    new Response(Buffer.alloc(ARCHITECTURE_ASSET_BUDGETS.balanced + 1)),
    new Response(glb(base), {
      headers: { "content-length": String(ARCHITECTURE_ASSET_BUDGETS.balanced + 1) },
    }),
    new Response(glb({ ...base, animations: [{}] })),
  ]) {
    const early = earlyRequest(Promise.resolve(response));
    await withPrefetched([[url, early]], async ({ fetches }) => {
      const signal = new AbortController().signal;
      await assert.rejects(loadArchitectureAsset(url, { signal, tier: "balanced" }));
      assert.equal(fetches.length, 0, "a valid response is not requested twice");
    });
  }
});

test("aborting a load cancels the early request it took", async () => {
  const url = ARCHITECTURE_ASSET_URLS.high.tree;
  let rejectEarly;
  const early = earlyRequest(
    new Promise((_, reject) => {
      rejectEarly = reject;
    }),
  );
  early.abort = () => {
    early.aborted += 1;
    rejectEarly(new DOMException("Aborted", "AbortError"));
  };
  await withPrefetched([[url, early]], async () => {
    const abort = new AbortController();
    const pending = loadArchitectureAsset(url, { signal: abort.signal, tier: "high" });
    abort.abort();
    await assert.rejects(pending, { name: "AbortError" });
    assert.equal(early.aborted, 1);
  });
});

test("the live selection takes its early requests and releases those for another tier", async () => {
  const matching = earlyRequest(Promise.resolve(new Response(glb(base))));
  const otherTier = earlyRequest(Promise.resolve(new Response(glb(base))));
  await withPrefetched(
    [
      [ARCHITECTURE_ASSET_URLS.high.tree, matching],
      [ARCHITECTURE_ASSET_URLS.balanced.tower, otherTier],
    ],
    async ({ prefetched, fetches }) => {
      const ready = [];
      const controller = createArchitectureAssetController({
        onTowerReady() {
          ready.push("tower");
        },
        onTreeReady() {
          ready.push("tree");
        },
      });
      controller.applyQuality({ tier: "high" }, { assetTier: "high" });
      assert.equal(prefetched.size, 2, "a closed live gate keeps early requests");
      controller.setQuality({ tier: "high" }, true, { assetTier: "high" });
      assert.equal(prefetched.size, 0);
      assert.equal(matching.aborted, 0);
      assert.equal(otherTier.aborted, 1);
      for (let index = 0; index < 50 && ready.length < 2; index += 1) await flush();
      assert.deepEqual(ready.sort(), ["tower", "tree"]);
      assert.deepEqual(
        fetches.map(({ url }) => url),
        [ARCHITECTURE_ASSET_URLS.high.tower],
      );
      controller.dispose();
    },
  );
});

test("unused early requests are released by a live low tier or teardown", async () => {
  for (const action of ["low", "dispose"]) {
    const early = earlyRequest(new Promise(() => {}));
    await withPrefetched([[ARCHITECTURE_ASSET_URLS.high.tree, early]], async ({ prefetched }) => {
      const h = harness();
      h.controller.applyQuality({ tier: "high" }, { assetTier: "high" });
      assert.equal(early.aborted, 0);
      if (action === "low") h.controller.setQuality({ tier: "low" }, true, { assetTier: "low" });
      else h.controller.dispose();
      assert.equal(early.aborted, 1, action);
      assert.equal(prefetched.size, 0);
      assert.equal(h.requests.length, 0);
      h.controller.dispose();
    });
  }
});

test("the loading line counts the loader's own request once and never re-wraps a taken early response", async () => {
  const url = ARCHITECTURE_ASSET_URLS.high.tree;
  const early = earlyRequest(Promise.resolve(new Response(glb(base))));
  await withPrefetched([[url, early]], async ({ fetches }) => {
    const tracked = [];
    let copy = (response) =>
      new Response(response.body, { status: response.status, headers: response.headers });
    // ui/scene-loader.js returns a counted copy, which the loader then reads.
    globalThis.BabelSite.sceneLoader = {
      track(trackedUrl, response) {
        tracked.push(trackedUrl);
        return copy(response);
      },
    };
    const signal = new AbortController().signal;
    // main.js counted the early response as it arrived.
    const first = await loadArchitectureAsset(url, { signal, tier: "high", role: "tree" });
    assert.ok(first.scene.isObject3D);
    assert.deepEqual(tracked, [], "a taken early response is not wrapped twice");
    const second = await loadArchitectureAsset(url, { signal, tier: "high", role: "tree" });
    assert.ok(second.scene.isObject3D);
    assert.equal(fetches.length, 1);
    assert.deepEqual(tracked, [url], "the loader's own request is counted exactly once");
    // The loader reads the copy track() returned, not the original.
    copy = () => new Response(Buffer.alloc(10));
    await assert.rejects(
      loadArchitectureAsset(url, { signal, tier: "high", role: "tree" }),
      /payload bounds/,
    );
    assert.deepEqual(tracked, [url, url]);
  });
});

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Every model the live scene loads, and the slate maps each tier requests.
const ROLES = ["tower", "tree", "lantern", "lichen-rock", "weathered-stone"];

test("every delivered model is one self-contained, static, triangle mesh", async () => {
  for (const tier of ["high", "balanced"])
    for (const role of ROLES) {
      const name = `${role}-${tier}.glb`;
      const source = await readFile(path.join(projectRoot, "images", "architecture", name));
      assert.equal(source.toString("ascii", 0, 4), "glTF");
      assert.equal(source.readUInt32LE(8), source.length);
      const gltf = parseGlb(source).json;
      assert.equal(gltf.meshes.length, 1, name + " should have one shared mesh");
      assert.equal(gltf.meshes[0].primitives.length, 1, name + " should have one shared material");
      assert.ok(gltf.images.length > 0, name + " must retain source surface detail");
      for (const resource of [...gltf.images, ...gltf.buffers])
        assert.equal(resource.uri, undefined);
      assert.equal(gltf.animations?.length || 0, 0);
      const primitive = gltf.meshes[0].primitives[0];
      assert.equal(primitive.mode ?? 4, 4, "triangle topology required");
      for (const semantic of ["POSITION", "NORMAL", "TEXCOORD_0"])
        assert.ok(Number.isInteger(primitive.attributes[semantic]));
    }
});
