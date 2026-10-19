import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { BufferGeometry } from "three";
import {
  cliffGeometry,
  coastGeometrySettings,
  coastGeometrySteps,
  fallsNotch,
  riverFalls,
  stackGeometry,
} from "../src/scene/ocean.js";
import { filmHeight, RIVER_LINE } from "../src/scene/terrain-build.js";

const context = { window: { BabelSite: {} } };
vm.runInNewContext(
  readFileSync(new URL("../src/scene/helpers.js", import.meta.url), "utf8"),
  context,
);
const height = filmHeight(context.window.BabelSite.scene.groundHeight, true),
  drop = riverFalls(RIVER_LINE),
  // Captured from the synchronous constructors (re-taken 2026-10-19 for
  // variable-thickness bedding; the stack buffers are unchanged).
  // Include every attribute's bytes, in order, and the complete index buffer.
  baseline = {
    high: [
      "37e49edfc9e8a2309c1468fa0a54d3a2e8e5c6060d1b4224984587341f321180",
      "50cc3e86adeb69d114106c98a5717601d5c65d2a524d1cb842fdd3d5c02326d6",
    ],
    balanced: [
      "77d2161f109afc57a42420ba04599d03b37343d812958c4a5034a6c343529d7b",
      "5409d1d0c1b9992b400f49ceb9ea26873494b31eee5e37f16b053ea79385ea69",
    ],
  };
function fingerprint(geometry) {
  const hash = createHash("sha256");
  for (const [name, attribute] of Object.entries(geometry.attributes))
    hash
      .update(name)
      .update(
        Buffer.from(attribute.array.buffer, attribute.array.byteOffset, attribute.array.byteLength),
      );
  if (geometry.index) hash.update(Buffer.from(geometry.index.array.buffer));
  return hash.digest("hex");
}
function drain(steps) {
  for (;;) {
    const next = steps.next();
    if (next.done) return next.value;
  }
}
function watchBuffers(t) {
  const buffers = new Map(),
    setAttribute = BufferGeometry.prototype.setAttribute,
    dispose = BufferGeometry.prototype.dispose;
  t.mock.method(BufferGeometry.prototype, "setAttribute", function (...args) {
    if (!buffers.has(this)) buffers.set(this, 0);
    return setAttribute.apply(this, args);
  });
  t.mock.method(BufferGeometry.prototype, "dispose", function () {
    if (buffers.has(this)) buffers.set(this, buffers.get(this) + 1);
    return dispose.call(this);
  });
  return buffers;
}

for (const tier of ["high", "balanced"])
  test(`${tier} cooperative coast preserves every synchronous geometry byte and bounded sampling slices`, () => {
    const settings = coastGeometrySettings(tier),
      original = [
        cliffGeometry(height, settings.cliff, 190, fallsNotch(drop)),
        stackGeometry(settings.stacks),
      ];
    let calls = 0,
      previous = 0,
      slices = 0,
      prepared;
    const steps = coastGeometrySteps(
      (...args) => {
        calls++;
        return height(...args);
      },
      tier,
      drop,
    );
    try {
      for (;;) {
        const next = steps.next();
        // Eight cliff columns, each with shelfRows taps and one lip tap;
        // buttresses have only one height tap per column.
        assert.ok(calls - previous <= 8 * (settings.cliff.shelfRows + 1));
        previous = calls;
        slices++;
        if (next.done) {
          prepared = next.value;
          break;
        }
      }
      assert.ok(slices > 150, "preparation can yield throughout both expensive builders");
      for (const [i, geometry] of [prepared.cliff, prepared.stacks].entries()) {
        assert.equal(fingerprint(geometry), baseline[tier][i], "physical bedding byte baseline");
        assert.deepEqual(geometry.groups, original[i].groups);
        assert.deepEqual(geometry.userData, original[i].userData);
        assert.deepEqual(geometry.index?.array, original[i].index?.array);
        assert.deepEqual(Object.keys(geometry.attributes), Object.keys(original[i].attributes));
        for (const [name, attribute] of Object.entries(geometry.attributes))
          assert.deepEqual(attribute.array, original[i].attributes[name].array, name);
      }
      assert.ok(
        prepared.cliff.index.count / 3 + prepared.stacks.attributes.position.count / 3 <=
          settings.maxTriangles,
      );
    } finally {
      steps.return();
      for (const geometry of [...original, prepared?.cliff, prepared?.stacks]) geometry?.dispose();
    }
  });

for (const method of ["return", "throw"])
  for (const phase of ["early", "packing-cliff", "finished-cliff", "packing-stacks"])
    test(`${method} during ${phase} releases every constructed coast buffer exactly once`, (t) => {
      const buffers = watchBuffers(t),
        steps = coastGeometrySteps(height, "high", drop);
      let stopped = false;
      try {
        for (let i = 0; i < 1000; i++) {
          const next = steps.next(),
            first = [...buffers.keys()][0];
          assert.equal(next.done, false);
          if (
            phase === "early" ||
            (phase === "packing-cliff" && first && !first.attributes.normal) ||
            (phase === "finished-cliff" && first?.attributes.normal) ||
            (phase === "packing-stacks" && buffers.size === 2)
          ) {
            stopped = true;
            break;
          }
        }
        assert.ok(stopped, `reached ${phase}`);
        if (method === "throw") assert.throws(() => steps.throw(new Error("retired")), /retired/);
        else assert.equal(steps.return().done, true);
        assert.equal(steps.return().done, true, "repeated cancellation is inert");
        assert.equal(buffers.size, phase === "early" ? 0 : phase === "packing-stacks" ? 2 : 1);
        for (const count of buffers.values()) assert.equal(count, 1);
      } finally {
        steps.return();
      }
    });

test("successful preparation transfers ownership and closing its iterator cannot free handed-off buffers", (t) => {
  const buffers = watchBuffers(t),
    steps = coastGeometrySteps(height, "balanced", drop),
    prepared = drain(steps);
  assert.equal(buffers.size, 2);
  steps.return();
  assert.deepEqual([...buffers.values()], [0, 0]);
  prepared.cliff.dispose();
  prepared.stacks.dispose();
  assert.deepEqual([...buffers.values()], [1, 1]);
});
