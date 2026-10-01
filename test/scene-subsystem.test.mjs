import assert from "node:assert/strict";
import test from "node:test";
import {
  createSceneSubsystemRegistry,
  normalizeSceneSubsystem,
  runSceneInitialization,
} from "../src/scene/subsystem.js";

test("scene subsystem normalization supplies bound no-op lifecycle hooks", () => {
  const source = {
    name: "bound",
    update() {
      return this.name;
    },
  };
  const subsystem = normalizeSceneSubsystem(source);

  assert.equal(subsystem.update(), "bound");
  assert.equal(subsystem.resize(), undefined);
  assert.equal(subsystem.applyQuality(), undefined);
  assert.equal(subsystem.dispose(), undefined);
});

test("scene subsystem registry invokes in order and disposes once in reverse order", () => {
  const calls = [];
  const registry = createSceneSubsystemRegistry([
    {
      update() {
        calls.push("update-a");
      },
      resize() {
        calls.push("resize-a");
      },
      applyQuality() {
        calls.push("quality-a");
      },
      dispose() {
        calls.push("dispose-a");
      },
    },
    {
      update() {
        calls.push("update-b");
      },
      resize() {
        calls.push("resize-b");
      },
      applyQuality() {
        calls.push("quality-b");
      },
      dispose() {
        calls.push("dispose-b");
      },
    },
  ]);

  registry.update();
  registry.resize();
  registry.applyQuality();
  assert.deepEqual(calls, [
    "update-a",
    "update-b",
    "resize-a",
    "resize-b",
    "quality-a",
    "quality-b",
  ]);

  assert.equal(registry.dispose(), true);
  assert.equal(registry.dispose(), false);
  assert.deepEqual(calls.slice(-2), ["dispose-b", "dispose-a"]);
  assert.equal(registry.update(), false);
  assert.throws(() => registry.register({}), /after disposal/);
});

test("scene subsystem registry honors deterministic lifecycle order without changing reverse disposal", () => {
  const calls = [];
  const registry = createSceneSubsystemRegistry();
  registry.register({
    lifecycleOrder: 100,
    update() {
      calls.push("render");
    },
    dispose() {
      calls.push("dispose-render");
    },
  });
  registry.register({
    lifecycleOrder: 10,
    update() {
      calls.push("environment");
    },
    dispose() {
      calls.push("dispose-environment");
    },
  });
  registry.register({
    lifecycleOrder: 30,
    update() {
      calls.push("atmosphere");
    },
    dispose() {
      calls.push("dispose-atmosphere");
    },
  });

  registry.update();
  assert.deepEqual(calls, ["environment", "atmosphere", "render"]);
  registry.dispose();
  assert.deepEqual(calls.slice(-3), [
    "dispose-atmosphere",
    "dispose-environment",
    "dispose-render",
  ]);
});

test("failed scene initialization disposes registered systems and rethrows the original error", () => {
  const calls = [];
  const original = new Error("construction failed");
  const registry = createSceneSubsystemRegistry([
    {
      dispose() {
        calls.push("dispose");
      },
    },
  ]);

  assert.throws(
    () =>
      runSceneInitialization(registry, () => {
        throw original;
      }),
    (error) => error === original,
  );
  assert.deepEqual(calls, ["dispose"]);
  assert.equal(registry.disposed, true);
});
