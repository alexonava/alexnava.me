import assert from "node:assert/strict";
import test from "node:test";
import { createOpeningPresentation, OPENING_FRAMES } from "../src/scene/opening-presentation.js";

function draw(owner, start = 0, count = 20, gap = 1000 / 60, work = 2) {
  for (let n = 0; n < count; n++) owner.sample(start + n * gap, work);
}

test("the opening is admitted by its first actual scene draws, whatever their pace", () => {
  const owner = createOpeningPresentation();
  assert.equal(owner.ready, false, "time without draws is not readiness");
  draw(owner, 5000, OPENING_FRAMES - 1);
  assert.equal(owner.ready, false);
  owner.sample(5500, 120);
  assert.equal(owner.ready, true, "a long upload among them does not hold the reveal");
  owner.dispose();
});

test("the fastest drawn interval measures the profile; a stall or skipped frame does not", () => {
  const owner = createOpeningPresentation();
  assert.equal(owner.frameMs, 0, "no interval before two draws");
  for (const at of [0, 400, 417, 900]) owner.sample(at, 2);
  assert.equal(owner.ready, true);
  assert.equal(owner.frameMs, 17, "one clean gap among stalls");
  assert.deepEqual(owner.gaps, [400, 17, 483]);
  owner.reset();
  draw(owner, 1000, OPENING_FRAMES, 70);
  assert.equal(owner.frameMs, 70, "a GPU too slow for the profile slows every gap");
  owner.dispose();
});

test("invalid timing never admits and a hidden/refitted window starts fresh", () => {
  for (const [gap, work] of [
    [16, NaN],
    [16, -1],
    [-16, 2],
  ]) {
    const owner = createOpeningPresentation();
    draw(owner, 1000, 50, gap, work);
    assert.equal(owner.ready, false);
    owner.dispose();
  }
  const owner = createOpeningPresentation();
  draw(owner, 0, OPENING_FRAMES, 1000 / 30);
  assert.equal(owner.ready, true);
  owner.reset();
  draw(owner, 10000, OPENING_FRAMES - 1);
  assert.equal(owner.ready, false);
  draw(owner, 10100, 1);
  assert.equal(owner.ready, true);
  owner.dispose();
  draw(owner, 20000);
  assert.equal(owner.ready, false, "disposal cannot be undone by late draws");
});

test("WebGL2 admission waits for a nonblocking GPU fence and releases it once", () => {
  let status = 0,
    flushed = 0,
    deleted = 0;
  const gl = {
    SYNC_GPU_COMMANDS_COMPLETE: 1,
    WAIT_FAILED: 2,
    ALREADY_SIGNALED: 3,
    CONDITION_SATISFIED: 4,
    fenceSync: () => ({}),
    flush: () => flushed++,
    deleteSync: () => deleted++,
    clientWaitSync(sync, flags, timeout) {
      assert.equal(flags, 0);
      assert.equal(timeout, 0, "the readiness check never blocks the main thread");
      return status;
    },
  };
  const owner = createOpeningPresentation(gl);
  draw(owner);
  assert.equal(owner.ready, false, "CPU submission is not GPU completion");
  assert.equal(flushed, 1);
  status = gl.CONDITION_SATISFIED;
  owner.sample(334, 1);
  assert.equal(owner.ready, true);
  assert.equal(deleted, 1);
  owner.dispose();
  assert.equal(deleted, 1);
});

test("a failed or lost GPU cannot admit stale preparation", () => {
  let lost = false,
    deleted = 0;
  const gl = {
    WAIT_FAILED: 2,
    ALREADY_SIGNALED: 3,
    CONDITION_SATISFIED: 4,
    fenceSync: () => ({}),
    flush() {},
    deleteSync: () => deleted++,
    clientWaitSync: () => 2,
    isContextLost: () => lost,
  };
  const owner = createOpeningPresentation(gl);
  owner.sample(0, 1);
  owner.sample(16, 1);
  assert.equal(owner.failed, true);
  assert.equal(owner.ready, false);
  assert.equal(deleted, 1);
  owner.reset();
  owner.sample(32, 1);
  lost = true;
  owner.sample(48, 1);
  assert.equal(owner.ready, false);
  assert.equal(deleted, 1, "a lost context's old fence is never queried or freed");
  owner.dispose();
});
