import assert from "node:assert/strict";
import test from "node:test";
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Texture } from "three";
import { createRockScatter, estateContacts, ROCK_LIB } from "../src/scene/rock-scatter.js";
import { createRockLayout, createRocks } from "../src/scene/rock-build.js";

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const flush = async (n = 5) => {
  for (let i = 0; i < n; i++) await new Promise((resolve) => setImmediate(resolve));
};
function rig(options = {}) {
  const parent = new Group(),
    contacts = estateContacts(),
    statuses = [],
    requests = [],
    owned = [],
    events = [];
  let chunks = 0;
  function asset(role) {
    const geometry = new BoxGeometry(),
      material = new MeshStandardMaterial(),
      scene = new Group(),
      bitmap = {
        width: 1,
        height: 1,
        close: () => {
          bitmapRecord.freed++;
          events.push(`${role}:bitmap`);
        },
      },
      bitmapRecord = { freed: 0 },
      texture = new Texture(bitmap);
    for (const [kind, resource] of Object.entries({ geometry, material, texture })) {
      const record = { freed: 0 };
      owned.push(record);
      resource.addEventListener("dispose", () => {
        record.freed++;
        events.push(`${role}:${kind}`);
      });
    }
    owned.push(bitmapRecord);
    material.map = texture;
    scene.add(new Mesh(geometry, material));
    return { scene };
  }
  const owner = createRockScatter({
    tier: "high",
    parent,
    contacts,
    compile: () => true,
    load: async () => {
      chunks++;
      return { createRocks };
    },
    loadAsset: async (_url, request) => {
      requests.push(request);
      return asset(request.role);
    },
    onStatus: ({ status }) => statuses.push(status),
    ...options,
  });
  return {
    parent,
    contacts,
    statuses,
    requests,
    owned,
    events,
    asset,
    owner,
    get chunks() {
      return chunks;
    },
    open() {
      owner.setFilmActive(true);
      owner.setTreeStatus("ready");
      owner.setRevealed();
    },
    root: () => parent.getObjectByName("film-rocks"),
    freed() {
      assert.ok(owned.length > 0);
      assert.ok(
        owned.every((record) => record.freed === 1),
        "source resources freed exactly once",
      );
      for (const role of ["lichen-rock", "weathered-stone"])
        assert.ok(
          events.indexOf(`${role}:texture`) < events.indexOf(`${role}:bitmap`),
          "texture freed before bitmap closes",
        );
    },
  };
}

for (const tier of ["high", "balanced"])
  test(`${tier} gated rock downloads overlap queued terrain and await its cut before stable placement`, async () => {
    const terrain = deferred(),
      cut = deferred(),
      stable = (x, z) => 0.015 * x + 0.025 * z,
      height = Object.assign(() => 99, { film: stable, ready: cut.promise }),
      r = rig({ tier, terrain: () => terrain.promise });
    try {
      r.owner.setFilmActive(true);
      r.owner.setTreeStatus("ready");
      await flush();
      assert.equal(r.chunks, 0);
      assert.equal(r.requests.length, 0, "reveal still gates every request");
      r.owner.setRevealed();
      await flush();
      assert.equal(r.chunks, 1);
      assert.deepEqual(
        r.requests.map(({ tier: ownTier, role }) => [ownTier, role]),
        [
          [tier, "lichen-rock"],
          [tier, "weathered-stone"],
        ],
      );
      assert.equal(
        r.root().children.length,
        0,
        "downloads finish before queued terrain, without layout",
      );
      assert.ok(
        r.owned.every((record) => record.freed === 0),
        "loaded sources stay leased while terrain is pending",
      );
      assert.ok(r.contacts.subarray(8).every((value) => value === 0));
      assert.deepEqual(r.owner.footprints, []);
      terrain.resolve(height);
      await flush();
      assert.equal(r.root().children.length, 0, "sampler publication alone is not the coastal cut");
      cut.resolve(true);
      await flush();
      const layout = createRockLayout(ROCK_LIB, { groundHeight: stable });
      assert.equal(r.root().children.length, 2);
      for (const mesh of r.root().children) {
        const type = mesh.name.slice("film-rocks-".length);
        layout
          .filter((rock) => rock.type === type)
          .forEach((rock, i) =>
            assert.deepEqual(
              Array.from(mesh.instanceMatrix.array.slice(i * 16, (i + 1) * 16)),
              Array.from(new Float32Array(rock.matrix.elements)),
            ),
          );
      }
      assert.equal(r.owner.take({ cut: false, running: true, nowMs: 0 }), false);
      await flush();
      assert.equal(r.owner.take({ cut: true, running: true, nowMs: 16 }), true);
      assert.equal(r.root().visible, true);
      assert.deepEqual(r.statuses, ["loading", "ready"]);
      r.owner.setFilmActive(false);
      r.owner.setFilmActive(true);
      r.owner.setRevealed();
      r.owner.setTreeStatus("ready");
      await flush();
      assert.equal(r.chunks, 1);
      assert.equal(r.requests.length, 2, "reactivation does not download again");
    } finally {
      r.owner.dispose();
      r.freed();
    }
  });

test("optional opening rocks prepare, link and commit while the canvas remains hidden", async () => {
  const r = rig({ terrain: () => Object.assign(() => 0, { ready: Promise.resolve(true) }) });
  try {
    const prepared = r.owner.prepareOpening();
    r.owner.setFilmActive(true);
    r.owner.setTreeStatus("ready");
    assert.equal(await prepared, true);
    assert.equal(r.owner.committed, true);
    assert.equal(r.root().visible, true);
    assert.deepEqual(r.statuses, ["loading", "ready"]);
    assert.equal(r.requests.length, 2);
    r.owner.setRevealed();
    await flush();
    assert.equal(r.requests.length, 2, "reveal reuses prepared assets");
  } finally {
    r.owner.dispose();
    r.freed();
  }
});

test("an optional opening rock deadline disposes late assets and settles fallback once", async () => {
  const assets = deferred();
  let r;
  r = rig({
    terrain: () => Object.assign(() => 0, { ready: Promise.resolve(true) }),
    loadAsset: (_url, request) => assets.promise.then(() => r.asset(request.role)),
  });
  try {
    r.owner.setFilmActive(true);
    r.owner.setTreeStatus("ready");
    assert.equal(await r.owner.prepareOpening({ timeoutMs: 10 }), true);
    assert.deepEqual(r.statuses, ["loading", "fallback"]);
    assets.resolve();
    await flush();
    assert.equal(r.owner.committed, false);
    assert.deepEqual(r.statuses, ["loading", "fallback"]);
    r.freed();
  } finally {
    r.owner.dispose();
  }
});

test("the optional rock download deadline does not charge time awaiting required terrain", async () => {
  const terrain = deferred(),
    r = rig({ terrain: () => terrain.promise });
  try {
    r.owner.setFilmActive(true);
    r.owner.setTreeStatus("ready");
    let settled = false;
    const ready = r.owner.prepareOpening({ timeoutMs: 10 }).then((value) => {
      settled = true;
      return value;
    });
    await flush();
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(settled, false);
    assert.deepEqual(r.statuses, ["loading"]);
    terrain.resolve(Object.assign(() => 0, { ready: Promise.resolve(true) }));
    assert.equal(await ready, true);
    assert.equal(r.owner.committed, true);
    assert.deepEqual(r.statuses, ["loading", "ready"]);
  } finally {
    r.owner.dispose();
    r.freed();
  }
});

for (const failed of ["terrain", "ready"])
  test(`${failed} rejection while GLBs are pending is observed and frees their late results`, async () => {
    const terrain = deferred(),
      cut = deferred(),
      assets = deferred(),
      height = Object.assign(() => 1, { ready: cut.promise });
    let r;
    r = rig({
      terrain: () => terrain.promise,
      loadAsset: (_url, request) => {
        r.requests.push(request);
        return assets.promise.then(() => r.asset(request.role));
      },
    });
    try {
      r.open();
      await flush();
      assert.equal(r.requests.length, 2);
      if (failed === "ready") {
        terrain.resolve(height);
        await flush();
        cut.reject(new Error("lost coastal preparation"));
      } else terrain.reject(new Error("terrain failed"));
      await flush();
      assert.equal(r.root().children.length, 0);
      assets.resolve();
      await flush();
      r.freed();
      assert.deepEqual(r.statuses, ["loading", "fallback"]);
      assert.equal(r.owner.take({ cut: true }), false);
      assert.ok(r.contacts.subarray(8).every((value) => value === 0));
    } finally {
      r.owner.dispose();
    }
  });

for (const pending of ["terrain", "ready"])
  test(`disposing loaded rocks waiting on ${pending} releases immediately and ignores late rejection`, async () => {
    const terrain = deferred(),
      cut = deferred(),
      r = rig({ terrain: () => terrain.promise });
    r.open();
    await flush();
    if (pending === "ready") {
      terrain.resolve(Object.assign(() => 1, { ready: cut.promise }));
      await flush();
    }
    assert.ok(r.owned.every((record) => record.freed === 0));
    const root = r.root();
    r.owner.dispose();
    r.freed();
    assert.equal(root.parent, null);
    if (pending === "ready") cut.reject(new Error("late cut failure"));
    else terrain.reject(new Error("late terrain failure"));
    await flush();
    r.freed();
    assert.deepEqual(r.statuses, ["loading"]);
    assert.equal(root.children.length, 0);
  });

test("disposal aborts in-flight rock requests and frees assets that arrive after it", async () => {
  const terrain = deferred(),
    assets = deferred();
  let r;
  r = rig({
    terrain: () => terrain.promise,
    loadAsset: (_url, request) => {
      r.requests.push(request);
      return assets.promise.then(() => r.asset(request.role));
    },
  });
  r.open();
  await flush();
  r.owner.dispose();
  assert.ok(r.requests.every(({ signal }) => signal.aborted));
  assets.resolve();
  terrain.resolve(Object.assign(() => 1, { ready: Promise.resolve(false) }));
  await flush();
  r.freed();
  assert.equal(r.parent.children.length, 0);
  assert.deepEqual(r.statuses, ["loading"]);
});

for (const finish of ["chunk-failure", "disposed-chunk"])
  test(`ready rejection stays handled when the ${finish} prevents builder creation`, async () => {
    const chunk = deferred(),
      cut = deferred(),
      height = Object.assign(() => 1, { ready: cut.promise }),
      r = rig({ terrain: () => height, load: () => chunk.promise });
    r.open();
    await flush();
    cut.reject(new Error("ready failed before chunk"));
    await flush();
    if (finish === "disposed-chunk") r.owner.dispose();
    chunk.reject(new Error("chunk unavailable"));
    await flush();
    assert.equal(r.requests.length, 0);
    assert.equal(r.parent.children.length, 0);
    assert.deepEqual(
      r.statuses,
      finish === "disposed-chunk" ? ["loading"] : ["loading", "fallback"],
    );
    r.owner.dispose();
  });

test("a throwing lazy factory reports fallback and still observes deferred terrain failure", async () => {
  const terrain = deferred(),
    r = rig({
      terrain: () => terrain.promise,
      load: async () => ({
        createRocks() {
          throw new Error("factory unavailable");
        },
      }),
    });
  r.open();
  await flush();
  terrain.reject(new Error("terrain unavailable later"));
  await flush();
  assert.deepEqual(r.statuses, ["loading", "fallback"]);
  assert.equal(r.requests.length, 0);
  r.owner.dispose();
});
