import assert from "node:assert/strict";
import test from "node:test";
import { createOpeningPreparation } from "../src/scene/opening-preparation.js";

test("only completed readiness stages release the first frame", () => {
  const snapshots = [];
  const gate = createOpeningPreparation({
    stages: ["subjects", "terrain", "shaders"],
    report: (s) => snapshots.push(s),
  });
  gate.tick(0, true, 0);
  gate.tick(1000, true, 1);
  assert.equal(gate.ready, false);
  gate.settle("subjects");
  gate.settle("subjects");
  gate.settle("unknown");
  assert.equal(snapshots.length, 2);
  gate.settle("terrain");
  gate.settle("shaders");
  assert.equal(gate.ready, true);
  assert.equal(gate.state.completed, 3);
});

test("the no-progress deadline fails independently of loading UI", () => {
  const failures = [];
  const gate = createOpeningPreparation({
    stages: ["terrain"],
    fail: (reason) => failures.push(reason),
  });
  gate.tick(0, true);
  gate.tick(14999, true);
  assert.equal(failures.length, 0);
  gate.tick(15000, true);
  gate.tick(30000, true);
  assert.deepEqual(failures, ["stalled"]);
  gate.settle("terrain");
  assert.equal(gate.ready, false);
});

test("genuine progress resets idle but cannot extend total visible preparation", () => {
  const failures = [];
  const gate = createOpeningPreparation({
    stages: ["subjects", "terrain"],
    fail: (r) => failures.push(r),
  });
  gate.tick(0, true);
  gate.tick(10000, true, 0.1);
  gate.tick(20000, true, 0.2);
  gate.settle("subjects");
  gate.tick(29999, true, 0.3);
  assert.equal(failures.length, 0);
  gate.tick(30000, true, 0.4);
  assert.deepEqual(failures, ["deadline"]);
});

test("background time and disposal cannot consume or fire an opening deadline", () => {
  const failures = [];
  const gate = createOpeningPreparation({ stages: ["terrain"], fail: (r) => failures.push(r) });
  gate.tick(0, true);
  gate.tick(3000, false);
  gate.tick(120000, true);
  assert.equal(gate.state.elapsed, 3000);
  gate.tick(123000, false);
  gate.tick(600000, true);
  assert.equal(gate.state.elapsed, 6000);
  gate.dispose();
  gate.tick(900000, true);
  gate.settle("terrain");
  assert.equal(gate.ready, false);
  assert.deepEqual(failures, []);
});

test("a hidden refit revokes only its preparation stages without granting a new deadline", () => {
  const failures = [];
  const gate = createOpeningPreparation({
    stages: ["terrain", "foreground", "shaders"],
    fail: (r) => failures.push(r),
  });
  gate.tick(0, true);
  gate.tick(14000, true, 0.5);
  for (const stage of ["terrain", "foreground", "shaders"]) gate.settle(stage);
  assert.equal(gate.ready, true);
  gate.reopen("foreground", "shaders");
  assert.equal(gate.ready, false);
  assert.equal(gate.state.completed, 1);
  gate.tick(28000, true, 0.7);
  gate.settle("foreground");
  gate.tick(30000, true, 0.8);
  assert.deepEqual(failures, ["deadline"]);
});

test("late byte progress cannot forgive an already expired visible interval", () => {
  for (const [at, totalMs, reason] of [
    [15000, 30000, "stalled"],
    [15001, 30000, "stalled"],
    [7000, 7000, "deadline"],
  ]) {
    const failures = [];
    const gate = createOpeningPreparation({
      stages: ["shaders"],
      totalMs,
      fail: (r) => failures.push(r),
    });
    gate.tick(0, true, 0.2);
    gate.tick(at, true, 0.8);
    gate.settle("shaders");
    assert.deepEqual(failures, [reason]);
    assert.equal(gate.ready, false);
  }
});

test("progress before idle expiry and progress received while hidden remain valid", () => {
  const failures = [];
  const gate = createOpeningPreparation({ stages: ["shaders"], fail: (r) => failures.push(r) });
  gate.tick(0, true);
  gate.tick(14999, true, 0.2);
  assert.equal(gate.state.idle, 0);
  gate.tick(15000, false, 0.3);
  gate.tick(615000, false, 0.8);
  assert.equal(gate.state.elapsed, 15000);
  gate.tick(615000, true, 0.8);
  gate.tick(629999, true, 0.9);
  assert.deepEqual(failures, []);
  gate.settle("shaders");
  assert.equal(gate.ready, true);
});
