import assert from "node:assert/strict";
import test from "node:test";
import { createOpeningPresentation } from "../src/scene/opening-presentation.js";

function draw(owner, start = 0, count = 20, gap = 1000 / 60, work = 2) {
  for (let n = 0; n < count; n++) owner.sample(start + n * gap, work);
}

test("only a fresh window of actual scene draws admits the opening", () => {
  const owner = createOpeningPresentation();
  assert.equal(owner.ready, false, "time without draws is not readiness");
  draw(owner, 5000, 8);
  assert.equal(owner.ready, false);
  owner.sample(5500, 120);
  draw(owner, 5517, 12);
  assert.equal(owner.ready, false, "a long upload restarts the complete window");
  draw(owner, 5717, 9);
  assert.equal(owner.ready, true);
  owner.dispose();
});

test("a slow or invalid stream never wins by waiting out a timer", () => {
  for (const [gap, work] of [
    [60, 2],
    [16, 40],
    [16, NaN],
    [16, -1],
  ]) {
    const owner = createOpeningPresentation();
    draw(owner, 0, 1000, gap, work);
    assert.equal(owner.ready, false);
    owner.dispose();
  }
});

test("stable 30 Hz displays are usable and a hidden/refitted window starts fresh", () => {
  const owner = createOpeningPresentation();
  draw(owner, 0, 15, 1000 / 30);
  assert.equal(owner.ready, true);
  owner.reset();
  draw(owner, 10000, 10);
  assert.equal(owner.ready, false);
  draw(owner, 10167, 10);
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
