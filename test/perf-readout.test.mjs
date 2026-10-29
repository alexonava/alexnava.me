import assert from "node:assert/strict";
import test from "node:test";
import { createPerfReadout } from "../src/scene/perf-readout.js";

function fakeDocument() {
  const element = {
    className: "",
    style: {},
    attributes: {},
    textContent: "",
    removed: false,
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
    remove() {
      this.removed = true;
    },
  };
  const host = {
    children: [],
    appendChild(child) {
      this.children.push(child);
    },
  };
  return { doc: { createElement: () => element }, host, element };
}

test("?perf=1's readout reports each second's frame rate, longest gap, shot, resolution and level", () => {
  const { doc, host, element } = fakeDocument();
  const readout = createPerfReadout(host, doc);
  assert.deepEqual(host.children, [element]);
  assert.equal(element.attributes["aria-hidden"], "true");
  assert.equal(element.style.pointerEvents, "none");
  const drawn = {
    shot: "Lantern study",
    pixelRatio: 1.25,
    width: 487,
    height: 1055,
    level: "low step 1",
  };
  // 45 frames over a little more than a second, one 60 ms gap among them.
  let t = 1000;
  readout.frame(t, drawn);
  for (let i = 1; i <= 45; i++) {
    t += i === 20 ? 60 : 21.5;
    readout.frame(t, drawn);
  }
  assert.equal(
    element.textContent,
    "45 fps  longest 60 ms\nLantern study\n1.25x  0.51 MP\nlow step 1",
  );
  readout.dispose();
  assert.equal(element.removed, true);
});

test("the readout needs a host and a document", () => {
  assert.equal(createPerfReadout(null), null);
  assert.equal(createPerfReadout({ appendChild() {} }, {}), null);
});
