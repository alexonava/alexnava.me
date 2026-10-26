import assert from "node:assert/strict";
import test from "node:test";
import {
  createCameraPreparation,
  queueTourShot,
  runPreparationSteps,
  uploadTextures,
} from "../src/scene/preparation-tasks.js";

function taskHost({ postTask = true } = {}) {
  let clock = 0,
    serial = 0,
    closed = 0,
    aborted = 0;
  const queue = new Map(),
    listeners = new Set(),
    turns = [];
  const add = (kind, callback) => {
    const id = ++serial;
    queue.set(id, { kind, callback });
    return id;
  };
  const host = {
    performance: { now: () => clock },
    document: {
      hidden: false,
      addEventListener: (_, task) => listeners.add(task),
      removeEventListener: (_, task) => listeners.delete(task),
    },
    AbortController,
    setTimeout: (task, delay) => add(`timer:${delay}`, task),
    clearTimeout: (id) => queue.delete(id),
    requestIdleCallback: (task) =>
      add("idle", () => task({ didTimeout: false, timeRemaining: () => 50 })),
    cancelIdleCallback: (id) => queue.delete(id),
    MessageChannel: class {
      constructor() {
        const ids = new Set();
        this.port1 = {
          onmessage: null,
          close: () => {
            closed++;
            for (const id of ids) queue.delete(id);
          },
        };
        this.port2 = {
          postMessage: (data) => {
            const id = add("message", () => {
              ids.delete(id);
              this.port1.onmessage?.({ data });
            });
            ids.add(id);
          },
          close: () => closed++,
        };
      }
    },
  };
  if (postTask)
    host.scheduler = {
      postTask(task, { signal }) {
        return new Promise((resolve, reject) => {
          const abort = () => {
            aborted++;
            queue.delete(id);
            reject(new Error("aborted"));
          };
          const id = add("postTask", () => {
            signal.removeEventListener("abort", abort);
            task();
            resolve();
          });
          signal.addEventListener("abort", abort, { once: true });
        });
      },
    };
  return {
    host,
    turns,
    queue,
    listeners,
    get closed() {
      return closed;
    },
    get aborted() {
      return aborted;
    },
    advance() {
      clock++;
    },
    hidden(value) {
      host.document.hidden = value;
      for (const task of listeners) task();
    },
    next() {
      const [id, { kind, callback }] = queue.entries().next().value;
      queue.delete(id);
      const start = clock;
      callback();
      turns.push({ kind, ms: clock - start });
    },
    drain() {
      while (queue.size) this.next();
    },
  };
}

function* orderedSteps(environment, output, length = 19) {
  try {
    for (let i = 0; i < length; i++) {
      environment.advance();
      output.push(Math.fround(Math.sin(i) * 7));
      yield;
    }
    return new Float32Array(output);
  } finally {
    output.closed = true;
  }
}

for (const postTask of [true, false])
  test(`priority preparation keeps exact output in 4 ms ${postTask ? "postTask" : "MessageChannel"} turns and releases its queue`, async () => {
    const environment = taskHost({ postTask }),
      output = [],
      reference = [];
    for (const _ of orderedSteps({ advance() {} }, reference)) void _;
    const result = runPreparationSteps(
      orderedSteps(environment, output),
      { priority: () => true },
      environment.host,
    );
    environment.drain();
    assert.deepEqual(await result, new Float32Array(reference));
    assert.equal(output.closed, true);
    assert.equal(environment.turns[0].kind, "idle", "the first turn still waits for idle");
    assert.ok(
      environment.turns.slice(1).every(({ kind }) => kind === (postTask ? "postTask" : "message")),
    );
    assert.ok(environment.turns.every(({ ms }) => ms <= 4));
    assert.equal(environment.queue.size, 0);
    assert.equal(environment.listeners.size, 0);
    assert.equal(environment.closed, postTask ? 0 : 2);
  });

test("visible refinement retains idle slices rather than priority tasks", async () => {
  const environment = taskHost(),
    result = runPreparationSteps(orderedSteps(environment, []), {}, environment.host);
  environment.drain();
  await result;
  assert.ok(environment.turns.every(({ kind }) => kind === "idle"));
  assert.deepEqual(
    environment.turns.map(({ ms }) => ms),
    [8, 8, 3],
  );
  assert.equal(environment.listeners.size, 0);
});

test("an owner cancelled before its lazy scheduler arrives queues no stale callback", async () => {
  const environment = taskHost();
  let closed = 0;
  assert.equal(
    await runPreparationSteps(
      {
        next: () => assert.fail("cancelled work cannot start"),
        return: () => {
          closed++;
        },
      },
      { cancelled: () => true },
      environment.host,
    ),
    null,
  );
  assert.equal(closed, 1);
  assert.equal(environment.queue.size, 0);
  assert.equal(environment.listeners.size, 0);
});

test("a rejected scheduler task falls back once to message turns without leaking an aborted callback", async () => {
  const environment = taskHost();
  let attempts = 0;
  environment.host.scheduler.postTask = () => {
    attempts++;
    return Promise.reject(new Error("scheduler unavailable"));
  };
  const result = runPreparationSteps(
    orderedSteps(environment, []),
    { priority: () => true },
    environment.host,
  );
  environment.next();
  await Promise.resolve();
  environment.drain();
  assert.equal((await result).length, 19);
  assert.equal(attempts, 1);
  assert.ok(environment.turns.slice(1).every(({ kind }) => kind === "message"));
  assert.equal(environment.closed, 2);
  assert.equal(environment.queue.size, 0);
  assert.equal(environment.listeners.size, 0);
});

test("a hidden page cancels its pending priority callback, resumes once and never advances hidden work", async () => {
  const environment = taskHost(),
    output = [],
    result = runPreparationSteps(
      orderedSteps(environment, output),
      { priority: () => true },
      environment.host,
    );
  environment.next();
  assert.equal(output.length, 4);
  environment.hidden(true);
  assert.equal(environment.aborted, 1);
  environment.next();
  assert.equal(output.length, 4);
  assert.equal(environment.turns.at(-1).kind, "timer:100");
  environment.hidden(false);
  environment.drain();
  assert.equal((await result).length, 19);
  assert.equal(environment.queue.size, 0);
  assert.equal(environment.listeners.size, 0);
});

test("disposal or a stale generation closes a suspended generator and its message ports", async () => {
  const environment = taskHost({ postTask: false }),
    output = [];
  let generation = 1;
  const result = runPreparationSteps(
    orderedSteps(environment, output),
    { priority: () => true, cancelled: () => generation !== 1 },
    environment.host,
  );
  environment.next();
  environment.hidden(true);
  generation++;
  environment.drain();
  assert.equal(await result, null);
  assert.equal(output.length, 4);
  assert.equal(output.closed, true);
  assert.equal(environment.closed, 2);
  assert.equal(environment.queue.size, 0);
  assert.equal(environment.listeners.size, 0);
});

test("failed work closes generator resources and rejects without a late callback", async () => {
  const environment = taskHost({ postTask: false });
  let released = false;
  const steps = (function* () {
    try {
      for (let i = 0; i < 4; i++) {
        environment.advance();
        yield;
      }
      throw new Error("build failed");
    } finally {
      released = true;
    }
  })();
  const result = runPreparationSteps(steps, { priority: () => true }, environment.host);
  environment.drain();
  await assert.rejects(result, /build failed/);
  assert.equal(released, true);
  assert.equal(environment.closed, 2);
  assert.equal(environment.queue.size, 0);
  assert.equal(environment.listeners.size, 0);
});

test("camera preparation discards stale root and safe-area jobs before publishing a fit", () => {
  let clock = 0,
    released = 0,
    available = true;
  const area = { left: 0, top: 0, width: 800, height: 600 },
    root = { matrixWorld: { elements: new Array(16).fill(0) }, updateWorldMatrix() {} },
    published = [],
    shot = {},
    camera = { isAvailable: () => available },
    measure = function* () {
      const stamp = root.matrixWorld.elements[12];
      try {
        for (let i = 0; i < 8; i++) {
          clock++;
          yield;
        }
        return stamp;
      } finally {
        released++;
      }
    },
    fit = function* (_, measured, target) {
      for (let i = 0; i < 8; i++) {
        clock++;
        yield;
      }
      published.push([measured, target.width]);
    },
    job = createCameraPreparation(
      camera,
      () => [root, root],
      { tree: [shot] },
      (value) => value,
      () => area,
      measure,
      fit,
      () => clock,
    );
  assert.equal(job.prepare("tree", 0, 800, 600), "pending");
  root.matrixWorld.elements[12] = 3;
  assert.equal(job.prepare("tree", 0, 800, 600), "pending");
  assert.equal(released, 1, "the stale measurement generator closed");
  // Advance the new job into its fit, then invalidate the captured safe area.
  job.prepare("tree", 0, 800, 600);
  job.prepare("tree", 0, 800, 600);
  area.width = 700;
  while (job.prepare("tree", 0, 800, 600) === "pending") {}
  assert.deepEqual(published, [[3, 700]]);
  job.prepare("tree", 0, 800, 600);
  job.cancel();
  available = false;
  assert.equal(job.prepare("tree", 0, 800, 600), "unavailable");
  assert.deepEqual(published, [[3, 700]], "cancelled work cannot publish late content");
});

test("the lazy tour queue keeps the latest shot, waits for a capture/hidden page and retires on disposal", () => {
  const environment = taskHost(),
    calls = [];
  let active = true,
    capture = true;
  const camera = {
      prepare: (...args) => {
        calls.push(args.slice(0, 4));
        return calls.length === 1 ? "pending" : "ready";
      },
    },
    frame = () => (active ? [390, 844, { capture, progress: 1 }] : null);
  queueTourShot(camera, "tree", 0, frame, environment.host);
  queueTourShot(camera, "tree", 2, frame, environment.host);
  environment.next();
  assert.equal(calls.length, 0);
  capture = false;
  environment.hidden(true);
  environment.next();
  assert.equal(calls.length, 0);
  environment.hidden(false);
  environment.next();
  assert.deepEqual(calls, [["tree", 2, 390, 844]]);
  active = false;
  environment.drain();
  assert.equal(calls.length, 1);
  assert.equal(environment.queue.size, 0);
});

function capturedTexture(name) {
  const listeners = new Set();
  return {
    name,
    listeners,
    addEventListener: (_, callback) => listeners.add(callback),
    removeEventListener: (_, callback) => listeners.delete(callback),
    dispose: () => {
      for (const callback of listeners) callback();
    },
  };
}

test("captured texture uploads yield between costly calls and readiness waits for the final upload", async () => {
  const environment = taskHost(),
    a = capturedTexture("a"),
    b = capturedTexture("b"),
    uploaded = [];
  let settled = false;
  const ready = uploadTextures(
    {
      initTexture(texture) {
        uploaded.push(texture.name);
        for (let i = 0; i < 5; i++) environment.advance();
      },
    },
    new Set([a, b]),
    () => true,
    Date.now() + 10000,
    environment.host,
  ).then((value) => {
    settled = true;
    return value;
  });
  assert.deepEqual(uploaded, [], "capturing does not upload in the compiler task");
  environment.next();
  assert.deepEqual(uploaded, ["a"]);
  assert.equal(settled, false);
  environment.drain();
  assert.equal(await ready, true);
  assert.deepEqual(uploaded, ["a", "b"]);
  assert.ok(environment.turns.every(({ ms }) => ms <= 5));
  assert.equal(a.listeners.size + b.listeners.size, 0);
  assert.equal(environment.queue.size, 0);
});

for (const reason of ["generation", "context", "deadline", "texture"])
  test(`a retired ${reason} cancels deferred texture uploads and removes borrowed listeners`, async () => {
    const environment = taskHost(),
      texture = capturedTexture("retired"),
      uploaded = [];
    let valid = true,
      lost = false;
    const ready = uploadTextures(
      {
        initTexture: (value) => uploaded.push(value),
        getContext: () => ({ isContextLost: () => lost }),
      },
      new Set([texture]),
      () => valid,
      reason === "deadline" ? Date.now() - 1 : Date.now() + 10000,
      environment.host,
    );
    if (reason === "generation") valid = false;
    if (reason === "context") lost = true;
    if (reason === "texture") texture.dispose();
    environment.drain();
    assert.equal(await ready, false);
    assert.equal(uploaded.length, 0);
    assert.equal(texture.listeners.size, 0);
    assert.equal(environment.listeners.size, 0);
    assert.equal(environment.queue.size, 0);
  });
