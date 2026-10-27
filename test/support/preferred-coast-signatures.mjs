import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const approved = JSON.parse(
  readFileSync(new URL("./preferred-coast-signatures.json", import.meta.url), "utf8"),
);
assert.equal(approved.source, "046ba230f9cdc273a76210a1272eb8e8417d2296");

// The owner selected the exact before cameras and explicitly retired the newer
// unobstructed-waterfall requirement. Preserve every live projected vertex and
// terrain/cliff ray as numeric comparisons against those selected cameras.
export function createCoastObservation() {
  const digest = createHash("sha256");
  let count = 0;
  return {
    add(...values) {
      for (const value of values) {
        assert.ok(Number.isFinite(value));
        const bytes = Buffer.allocUnsafe(8);
        bytes.writeDoubleLE(Math.round(value * 1e7) / 1e7);
        digest.update(bytes);
        count++;
      }
    },
    finish() {
      return { count, sha256: digest.digest("hex") };
    },
  };
}

export function assertCoastObservation(key, actual) {
  assert.ok(Object.hasOwn(approved.observations, key), `approved framing case: ${key}`);
  assert.deepEqual(actual, approved.observations[key], `live camera matches before: ${key}`);
}
