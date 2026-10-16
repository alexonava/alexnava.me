// The footer's Contact (src/ui/contact.js): a disclosure over the email and
// LinkedIn, run in a node:vm sandbox over a fake footer (support/contact-dom.mjs).

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { createContactDom } from "./support/contact-dom.mjs";

const contactSource = await readFile(new URL("../src/ui/contact.js", import.meta.url), "utf8");

function load(options) {
  const dom = createContactDom(options);
  const context = vm.createContext({ window: dom.window, document: dom.document });
  vm.runInContext(contactSource, context, { filename: "src/ui/contact.js" });
  return { ...dom, init: () => dom.window.BabelSite.ui.initContact() };
}

const expanded = (dom) => dom.toggle.getAttribute("aria-expanded");

test("Contact takes the no-JS links' place, collapsed, once", () => {
  const dom = load();
  assert.equal(dom.toggle.hidden, true);
  assert.equal(dom.links.hidden, false);
  assert.equal(dom.init(), true);
  assert.equal(dom.toggle.hidden, false);
  assert.equal(dom.links.hidden, true);
  assert.equal(expanded(dom), "false");
  assert.equal(dom.init(), true);
  assert.equal(dom.toggle.listenerCount("click"), 1, "a second call binds nothing more");
  assert.equal(dom.document.listenerCount("keydown"), 1);
  assert.equal(dom.window.listenerCount("hashchange"), 1);
});

test("pressing Contact shows the email and LinkedIn, and pressing it again hides them", () => {
  const dom = load();
  dom.init();
  dom.toggle.dispatch("click");
  assert.equal(dom.links.hidden, false);
  assert.equal(expanded(dom), "true");
  dom.toggle.dispatch("click");
  assert.equal(dom.links.hidden, true);
  assert.equal(expanded(dom), "false");
});

test("Escape closes Contact and brings focus back to it only from inside the links", () => {
  const dom = load();
  dom.init();
  dom.toggle.dispatch("click");
  dom.document.activeElement = dom.linkedin;
  dom.document.dispatch("keydown", { key: "Enter" });
  assert.equal(dom.links.hidden, false, "other keys leave it open");
  dom.document.dispatch("keydown", { key: "Escape" });
  assert.equal(dom.links.hidden, true);
  assert.equal(expanded(dom), "false");
  assert.equal(dom.document.activeElement, dom.toggle);
  assert.equal(dom.toggle.focusOptions?.preventScroll, true);

  dom.toggle.dispatch("click");
  dom.document.activeElement = dom.document.body;
  dom.toggle.focusOptions = null;
  dom.document.dispatch("keydown", { key: "Escape" });
  assert.equal(dom.links.hidden, true);
  assert.equal(dom.document.activeElement, dom.document.body, "focus elsewhere stays put");
  assert.equal(dom.toggle.focusOptions, null);
  dom.document.dispatch("keydown", { key: "Escape" });
  assert.equal(expanded(dom), "false", "Escape while closed changes nothing");
});

test("addresses naming About, its sections or Contact open Contact, on load and later", () => {
  for (const name of ["about", "profile", "experience", "contact"]) {
    for (const hash of [`#${name}`, `#${name}-text`]) {
      const dom = load({ hash });
      dom.init();
      assert.equal(dom.links.hidden, false, hash);
      assert.equal(expanded(dom), "true", hash);
    }
  }
  const dom = load({ hash: "#main" });
  dom.init();
  assert.equal(dom.links.hidden, true);
  dom.window.location.hash = "#contact";
  dom.window.dispatch("hashchange");
  assert.equal(dom.links.hidden, false);
  dom.toggle.dispatch("click");
  dom.window.location.hash = "#home";
  dom.window.dispatch("hashchange");
  assert.equal(dom.links.hidden, true, "other addresses leave Contact as it is");
});

test("missing markup or a focused link keeps the no-JS links", () => {
  for (const options of [{ toggle: false }, { links: false }]) {
    const dom = load(options);
    assert.equal(dom.init(), false);
    assert.equal(dom.toggle.hidden, true);
    assert.equal(dom.links.hidden, false);
  }
  const dom = load();
  dom.document.activeElement = dom.email;
  assert.equal(dom.init(), false, "a visitor's focused link is never hidden");
  assert.equal(dom.toggle.hidden, true);
  assert.equal(dom.links.hidden, false);
  dom.document.activeElement = dom.document.body;
  assert.equal(dom.init(), true);
  assert.equal(dom.links.hidden, true);
});
