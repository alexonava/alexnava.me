import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DIRECTED_SHOTS } from "../src/scene/directed-shots.js";

// Lantern study's light, lens, ground and growth are a fixed benchmark the owner locked
// (the Artistic set's light and the wetter ground) while the other shots' looks change.
// Its camera and viewport variants are locked with the other seven in
// preferred-framing.test.mjs.
const approved = JSON.parse(
  readFileSync(new URL("./support/lantern-study-approved.json", import.meta.url), "utf8"),
);

// Everything preferred-framing.test.mjs leaves out of the camera, at any depth, so a
// look override inside a viewport variant (say `portrait.light`) also fails here.
const LOOK = ["name", "light", "ground", "lens", "look", "sun", "growth", "fill"];

function lookOnly(value) {
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, item]) => {
      if (LOOK.includes(key)) return [[key, item]];
      if (!item || typeof item !== "object" || Array.isArray(item)) return [];
      const look = lookOnly(item);
      return Object.keys(look).length ? [[key, look]] : [];
    }),
  );
}

test("Lantern study keeps its approved light, lens, ground and growth", () => {
  assert.deepEqual(lookOnly(DIRECTED_SHOTS.tree[1]), approved);
});
