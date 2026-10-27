import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

// Run both sides of the actual bridge. Only the GPU renderer is replaced: the
// page serializes a light, the fake Worker clones it, and the worker entry gives
// it to the renderer. This catches fields lost between the two working paths.
const source = (await readFile(new URL("../src/doors-entry.js", import.meta.url), "utf8")).replace(
  /^import \{ createPaperDoors \} from "\.\/doors\/paper-doors\.js";\r?\n/m,
  "",
);

async function startDrawing(inWorker) {
  const lights = [];
  const pending = [];
  const renderer = {
    light: (value) => lights.push(structuredClone(value)),
    resize() {},
    open: () => Promise.resolve(),
    dispose() {},
  };
  const createPaperDoors = async () => renderer;
  let worker;
  class FakeWorker {
    constructor() {
      worker = this;
      this.context = {
        createPaperDoors,
        setTimeout,
        clearTimeout,
        performance,
        postMessage: (value) => this.onmessage?.({ data: structuredClone(value) }),
      };
      vm.runInNewContext(source, this.context, { filename: "src/doors-entry.js:worker" });
    }
    postMessage(value) {
      pending.push(this.context.onmessage({ data: structuredClone(value) }));
    }
    terminate() {}
  }
  const canvas = {
    ...(inWorker ? { transferControlToOffscreen: () => ({}) } : {}),
    remove() {},
  };
  const context = {
    URL,
    performance,
    createPaperDoors,
    setTimeout,
    clearTimeout,
    Worker: FakeWorker,
    devicePixelRatio: 1,
    location: { href: "https://alexnava.me/" },
    document: {
      currentScript: { src: "https://alexnava.me/scripts/doors.test.js" },
      createElement: () => canvas,
    },
    addEventListener() {},
    removeEventListener() {},
  };
  vm.runInNewContext(source, context, { filename: "src/doors-entry.js:page" });
  const drawing = await new Promise((resolve, reject) => {
    context.BabelSite.paperDoors.start(
      { clientWidth: 1440, clientHeight: 900, appendChild() {} },
      { tier: "high", drawn: resolve, failed: (value, why) => reject(new Error(why)) },
    );
  });
  assert.equal(!!worker, inWorker, "the requested rendering path was used");
  return {
    drawing,
    lights,
    async flush() {
      await Promise.all(pending.splice(0));
    },
  };
}

test("the worker bridge preserves the lantern kind, place and warmth, then clears it for the sun", async () => {
  const h = await startDrawing(true);
  const lantern = { x: 700, y: 520, radius: 24, kind: "lantern" };
  const sun = { x: 1188, y: 498, radius: 26.5 };
  for (const input of [
    { star: lantern, warm: 0.4 },
    { star: sun, warm: 1 },
    { star: null, warm: 0 },
  ]) {
    h.drawing.light(input);
    await h.flush();
    assert.deepEqual(h.lights.at(-1), { type: "light", ...input });
  }
  h.drawing.dispose();
});

test("worker and in-page drawing receive the same lantern light", async () => {
  const worker = await startDrawing(true);
  const page = await startDrawing(false);
  const input = { star: { x: 360, y: 540, radius: 21, kind: "lantern" }, warm: 0.75 };
  worker.drawing.light(input);
  page.drawing.light(input);
  await worker.flush();
  const { type, ...workerLight } = worker.lights.at(-1);
  assert.equal(type, "light");
  assert.deepEqual(workerLight, page.lights.at(-1));
  worker.drawing.dispose();
  page.drawing.dispose();
});
