import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const panelsSourcePath = path.join(projectRoot, "src", "ui", "panels.js");
const motionSourcePath = path.join(projectRoot, "src", "shared", "motion.js");
const stylesPath = path.join(projectRoot, "styles.css");

class FakeClassList {
  constructor(element, initial = []) {
    this.element = element;
    this.items = new Set(initial);
  }

  add(...tokens) {
    for (const token of tokens) {
      this.items.add(token);
    }
    this.#sync();
  }

  remove(...tokens) {
    for (const token of tokens) {
      this.items.delete(token);
    }
    this.#sync();
  }

  contains(token) {
    return this.items.has(token);
  }

  #sync() {
    this.element.className = Array.from(this.items).join(" ");
  }
}

class FakeElement {
  constructor(document, tagName, options = {}) {
    this.document = document;
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.listeners = new Map();
    this.attributes = new Map();
    this.dataset = { ...(options.dataset || {}) };
    this.hidden = options.hidden || false;
    this.inert = false;
    this.id = options.id || "";
    this.className = "";
    this.classList = new FakeClassList(this, options.classNames || []);
    this.textContent = options.textContent || "";

    if (this.id) {
      this.setAttribute("id", this.id);
    }

    for (const [key, value] of Object.entries(options.attributes || {})) {
      this.setAttribute(key, value);
    }

    for (const [key, value] of Object.entries(this.dataset)) {
      this.setAttribute(
        `data-${key.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`)}`,
        value,
      );
    }
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) || [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }

  removeEventListener(type, handler) {
    const handlers = this.listeners.get(type) || [];
    this.listeners.set(
      type,
      handlers.filter((candidate) => candidate !== handler),
    );
  }

  dispatchEvent(event) {
    event.target ||= this;
    event.currentTarget = this;
    const handlers = this.listeners.get(event.type) || [];
    for (const handler of handlers) {
      handler.call(this, event);
    }
    return !event.defaultPrevented;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === "id") {
      this.id = String(value);
    }
    if (name === "class") {
      this.className = String(value);
      this.classList = new FakeClassList(this, String(value).split(/\s+/).filter(Boolean));
    }
    if (name === "tabindex") {
      this.tabIndex = Number(value);
    }
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  hasAttribute(name) {
    return this.attributes.has(name);
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  focus() {
    this.document.activeElement = this;
  }

  click() {
    this.dispatchEvent(createEvent("click"));
  }

  contains(node) {
    if (node === this) return true;
    return this.children.some((child) => child.contains(node));
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    return queryAll(this.children, selector);
  }

  get offsetWidth() {
    return 1;
  }
}

class FakeDocument {
  constructor() {
    this.listeners = new Map();
    this.activeElement = null;
    this.body = new FakeElement(this, "body");
  }

  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) || [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }

  removeEventListener(type, handler) {
    this.listeners.set(
      type,
      (this.listeners.get(type) || []).filter((item) => item !== handler),
    );
  }
  dispatchEvent(event) {
    event.target ||= this;
    event.currentTarget = this;
    const handlers = this.listeners.get(event.type) || [];
    for (const handler of handlers) {
      handler.call(this, event);
    }
    return !event.defaultPrevented;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    return queryAll(this.body.children, selector);
  }

  getElementById(id) {
    return queryAll(this.body.children, `#${id}`)[0] || null;
  }
}

function createEvent(type, properties = {}) {
  return {
    type,
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    ...properties,
  };
}

// Overlay listeners see bubbled pointer events: the press, the release, and a
// click on their nearest common ancestor, which is the overlay after a drag.
function pointerClick(overlay, down = overlay, up = down) {
  overlay.dispatchEvent(createEvent("pointerdown", { target: down }));
  overlay.dispatchEvent(createEvent("pointerup", { target: up }));
  overlay.dispatchEvent(createEvent("click", { target: down === up ? down : overlay }));
}

function queryAll(nodes, selector) {
  const matches = [];
  for (const node of nodes) {
    if (matchesSelector(node, selector)) {
      matches.push(node);
    }
    matches.push(...queryAll(node.children, selector));
  }
  return matches;
}

function matchesSelector(element, selector) {
  const selectors = selector.split(",").map((entry) => entry.trim());
  return selectors.some((entry) => matchesSimpleSelector(element, entry));
}

function matchesSimpleSelector(element, selector) {
  if (selector === ".skip-link") {
    return element.classList.contains("skip-link");
  }
  if (selector === ".scene-shell") {
    return element.classList.contains("scene-shell");
  }
  if (selector === ".site-shell") {
    return element.classList.contains("site-shell");
  }
  if (selector === ".bottom-bar") {
    return element.classList.contains("bottom-bar");
  }
  if (selector === ".panel-overlay") {
    return element.classList.contains("panel-overlay");
  }
  if (selector === ".panel-close") {
    return element.classList.contains("panel-close");
  }
  if (selector === ".panel-surface") return element.classList.contains("panel-surface");
  if (selector === ".panel-card") {
    return element.classList.contains("panel-card");
  }
  if (selector === ".bottom-btn[data-panel]") {
    return element.classList.contains("bottom-btn") && Boolean(element.dataset.panel);
  }
  if (selector === "button:not([disabled])") {
    return element.tagName === "BUTTON" && !element.hasAttribute("disabled");
  }
  if (selector === "a[href]") {
    return element.tagName === "A" && element.hasAttribute("href");
  }
  if (selector === '[tabindex]:not([tabindex="-1"])') {
    return element.hasAttribute("tabindex") && element.getAttribute("tabindex") !== "-1";
  }
  if (selector === "main") {
    return element.tagName === "MAIN";
  }
  if (selector.startsWith("#")) {
    return element.id === selector.slice(1);
  }
  if (/^(\.[\w-]+)+$/.test(selector)) {
    return selector
      .slice(1)
      .split(".")
      .every((name) => element.classList.contains(name));
  }
  return false;
}

function append(parent, child) {
  parent.appendChild(child);
  return child;
}

function createSiteDom({ reduceMotion = true } = {}) {
  const document = new FakeDocument();
  const window = {
    document,
    BabelSite: {},
    setTimeout,
    clearTimeout,
    matchMedia() {
      return {
        matches: reduceMotion,
        addEventListener() {},
        addListener() {},
      };
    },
  };

  const skipLink = append(
    document.body,
    new FakeElement(document, "a", {
      classNames: ["skip-link"],
      attributes: { href: "#main" },
    }),
  );
  const sceneShell = append(
    document.body,
    new FakeElement(document, "div", { classNames: ["scene-shell"] }),
  );
  append(
    sceneShell,
    new FakeElement(document, "div", { classNames: ["scene-canvas"], id: "home-scene" }),
  );
  append(sceneShell, new FakeElement(document, "div", { classNames: ["scene-vignette"] }));
  const siteShell = append(
    document.body,
    new FakeElement(document, "div", { classNames: ["site-shell"] }),
  );
  const main = append(
    document.body,
    new FakeElement(document, "main", { id: "main", attributes: { tabindex: "-1" } }),
  );
  append(main, new FakeElement(document, "section", { classNames: ["hero", "section"] }));
  const bottomBar = append(
    document.body,
    new FakeElement(document, "nav", { classNames: ["bottom-bar"] }),
  );
  const aboutButton = append(
    bottomBar,
    new FakeElement(document, "button", {
      classNames: ["bottom-btn", "bottom-btn--icon"],
      dataset: { panel: "about" },
      attributes: {
        "aria-expanded": "false",
        "aria-controls": "panel-about",
        "aria-label": "About",
      },
    }),
  );
  append(
    aboutButton,
    new FakeElement(document, "img", { classNames: ["btn-icon"], id: "btn-icon-about" }),
  );
  append(
    aboutButton,
    new FakeElement(document, "span", { classNames: ["btn-icon-label"], textContent: "About" }),
  );
  const contactButton = append(
    bottomBar,
    new FakeElement(document, "button", {
      classNames: ["bottom-btn", "bottom-btn--icon"],
      dataset: { panel: "contact" },
      attributes: {
        "aria-expanded": "false",
        "aria-controls": "panel-contact",
        "aria-label": "Contact",
      },
    }),
  );
  append(
    contactButton,
    new FakeElement(document, "canvas", { classNames: ["btn-icon"], id: "btn-icon-contact" }),
  );
  append(
    contactButton,
    new FakeElement(document, "span", { classNames: ["btn-icon-label"], textContent: "Contact" }),
  );
  const footer = append(
    document.body,
    new FakeElement(document, "footer", { classNames: ["site-footer"] }),
  );

  const aboutOverlay = append(
    document.body,
    new FakeElement(document, "div", {
      classNames: ["panel-overlay"],
      id: "panel-about",
      hidden: true,
      attributes: {
        role: "dialog",
        "aria-modal": "true",
        "aria-labelledby": "panel-about-title",
      },
    }),
  );
  const aboutCard = append(
    aboutOverlay,
    new FakeElement(document, "div", { classNames: ["panel-card"] }),
  );
  const aboutClose = append(
    aboutCard,
    new FakeElement(document, "button", {
      classNames: ["panel-close"],
      attributes: { "aria-label": "Close" },
    }),
  );
  append(aboutCard, new FakeElement(document, "h2", { id: "panel-about-title" }));
  append(
    aboutCard,
    new FakeElement(document, "a", {
      attributes: { href: "https://threejs.org" },
    }),
  );

  const contactOverlay = append(
    document.body,
    new FakeElement(document, "div", {
      classNames: ["panel-overlay"],
      id: "panel-contact",
      hidden: true,
      attributes: {
        role: "dialog",
        "aria-modal": "true",
        "aria-labelledby": "panel-contact-title",
      },
    }),
  );
  const contactCard = append(
    contactOverlay,
    new FakeElement(document, "div", { classNames: ["panel-card"] }),
  );
  const contactClose = append(
    contactCard,
    new FakeElement(document, "button", {
      classNames: ["panel-close"],
      attributes: { "aria-label": "Close" },
    }),
  );
  append(contactCard, new FakeElement(document, "h2", { id: "panel-contact-title" }));
  const contactLink = append(
    contactCard,
    new FakeElement(document, "a", {
      attributes: { href: "mailto:alexonava@gmail.com" },
    }),
  );

  return {
    window,
    document,
    elements: {
      skipLink,
      sceneShell,
      siteShell,
      main,
      bottomBar,
      aboutButton,
      contactButton,
      footer,
      aboutOverlay,
      aboutCard,
      aboutClose,
      contactOverlay,
      contactCard,
      contactClose,
      contactLink,
    },
  };
}

async function loadPanels(window, document, { initialize = true } = {}) {
  const context = { window, document, console };
  const motionSource = await readFile(motionSourcePath, "utf8");
  vm.runInNewContext(motionSource, context, { filename: motionSourcePath });
  const source = await readFile(panelsSourcePath, "utf8");
  vm.runInNewContext(source, context, { filename: panelsSourcePath });
  return initialize ? window.BabelSite.ui.initPanels() : undefined;
}

test("modal open/close locks the page, marks background inert, and restores focus", async () => {
  const { window, document, elements } = createSiteDom();
  await loadPanels(window, document);

  elements.aboutButton.dispatchEvent(createEvent("click"));

  assert.equal(elements.aboutOverlay.hidden, false);
  assert.equal(elements.aboutOverlay.inert, false);
  assert.equal(elements.aboutOverlay.getAttribute("aria-hidden"), null);
  assert.equal(elements.aboutButton.getAttribute("aria-expanded"), "true");
  assert.equal(document.body.getAttribute("data-panel-open"), "true");
  assert.equal(document.activeElement, elements.aboutClose);
  assert.equal(elements.skipLink.inert, true);
  assert.equal(elements.sceneShell.inert, true);
  assert.equal(elements.siteShell.inert, true);
  assert.equal(elements.main.inert, true);
  assert.equal(elements.bottomBar.inert, true);
  assert.equal(elements.footer.inert, true);

  document.dispatchEvent(createEvent("keydown", { key: "Escape" }));

  assert.equal(elements.aboutOverlay.hidden, true);
  assert.equal(elements.aboutOverlay.inert, true);
  assert.equal(elements.aboutOverlay.getAttribute("aria-hidden"), "true");
  assert.equal(elements.aboutButton.getAttribute("aria-expanded"), "false");
  assert.equal(document.body.getAttribute("data-panel-open"), null);
  assert.equal(document.activeElement, elements.aboutButton);
  assert.equal(elements.skipLink.inert, false);
  assert.equal(elements.sceneShell.inert, false);
  assert.equal(elements.siteShell.inert, false);
  assert.equal(elements.main.inert, false);
  assert.equal(elements.bottomBar.inert, false);
  assert.equal(elements.footer.inert, false);
});

test("every background the dialogs make inert names an element of the homepage", async () => {
  const source = await readFile(panelsSourcePath, "utf8");
  const selectors = [
    ...source.match(/const BACKGROUND_SELECTORS = \[([^\]]*)\]/)[1].matchAll(/"([^"]+)"/g),
  ].map((match) => match[1]);
  assert.ok(selectors.length > 0);
  const html = await readFile(path.join(projectRoot, "index.html"), "utf8");
  const classes = new Set(
    [...html.matchAll(/\sclass="([^"]*)"/g)].flatMap((match) => match[1].split(/\s+/)),
  );
  for (const selector of selectors) {
    if (selector.startsWith(".")) {
      assert.ok(classes.has(selector.slice(1)), selector + " matches no element in index.html");
    } else {
      assert.match(html, new RegExp("<" + selector + "[\\s>]"), selector + " is not in index.html");
    }
  }
});

test("a closing dialog becomes inert and aria-hidden before its visual transition ends", async () => {
  const { window, document, elements } = createSiteDom({ reduceMotion: false });
  await loadPanels(window, document);

  elements.aboutButton.dispatchEvent(createEvent("click"));
  elements.aboutClose.dispatchEvent(createEvent("click"));

  assert.equal(elements.aboutOverlay.hidden, false, "the exit transition can remain visible");
  assert.equal(elements.aboutOverlay.inert, true);
  assert.equal(elements.aboutOverlay.getAttribute("aria-hidden"), "true");
  assert.equal(document.body.getAttribute("data-panel-open"), null);
  assert.equal(document.activeElement, elements.aboutButton);

  elements.aboutOverlay.dispatchEvent(
    createEvent("transitionend", { target: elements.aboutOverlay }),
  );
  assert.equal(elements.aboutOverlay.hidden, true);
});

test("focus stays trapped within the active panel", async () => {
  const { window, document, elements } = createSiteDom();
  await loadPanels(window, document);

  elements.contactButton.dispatchEvent(createEvent("click"));
  elements.contactLink.focus();

  const forwardTab = createEvent("keydown", { key: "Tab" });
  document.dispatchEvent(forwardTab);

  assert.equal(forwardTab.defaultPrevented, true);
  assert.equal(document.activeElement, elements.contactClose);

  elements.contactClose.focus();

  const reverseTab = createEvent("keydown", { key: "Tab", shiftKey: true });
  document.dispatchEvent(reverseTab);

  assert.equal(reverseTab.defaultPrevented, true);
  assert.equal(document.activeElement, elements.contactLink);
});

test("scroll-safe panel rules exist in the stylesheet", async () => {
  const styles = await readFile(stylesPath, "utf8");

  assert.match(styles, /body\[data-panel-open="true"\]\s*\{[^}]*overflow:\s*hidden;/);
  assert.match(styles, /\.panel-overlay\s*\{[^}]*overflow-y:\s*auto;/);
  assert.match(styles, /\.panel-close\s*\{[^}]*position:\s*sticky;/);
});

test("reopening cancels an old exit, including stale callbacks during a later exit", async () => {
  const { window, document, elements: e } = createSiteDom({ reduceMotion: false });
  const callbacks = [];
  const cancelled = [];
  window.setTimeout = (callback) => {
    callbacks.push(callback);
    return callbacks.length;
  };
  window.clearTimeout = (id) => cancelled.push(id);
  await loadPanels(window, document);
  e.aboutButton.dispatchEvent(createEvent("click"));
  e.aboutClose.dispatchEvent(createEvent("click"));
  e.aboutButton.dispatchEvent(createEvent("click"));
  assert.ok(cancelled.includes(1));
  callbacks[0]();
  assert.equal(e.aboutOverlay.hidden, false);
  assert.equal(e.aboutOverlay.inert, false);
  e.aboutClose.dispatchEvent(createEvent("click"));
  callbacks[0]();
  assert.equal(e.aboutOverlay.hidden, false, "a stale callback cannot complete a newer exit");
  e.aboutOverlay.dispatchEvent(createEvent("transitionend", { target: e.aboutClose }));
  assert.equal(e.aboutOverlay.hidden, false, "child transitions cannot close the panel");
  callbacks[1]();
  assert.equal(e.aboutOverlay.hidden, true, "fallback completes an interrupted transition");
});

test("switching to reduced motion immediately completes pending exits", async () => {
  const { window, document, elements: e } = createSiteDom({ reduceMotion: false });
  let onChange;
  const query = {
    matches: false,
    addEventListener: (_, callback) => {
      onChange = callback;
    },
  };
  window.matchMedia = () => query;
  await loadPanels(window, document);
  e.contactButton.dispatchEvent(createEvent("click"));
  e.contactClose.dispatchEvent(createEvent("click"));
  assert.equal(e.contactOverlay.hidden, false);
  query.matches = true;
  onChange();
  assert.equal(e.contactOverlay.hidden, true);
  e.contactButton.dispatchEvent(createEvent("click"));
  assert.equal(e.contactOverlay.hidden, false);
  e.contactClose.dispatchEvent(createEvent("click"));
  assert.equal(e.contactOverlay.hidden, true);
});

test("nested Contact returns to About before restoring the outer trigger", async () => {
  const { window, document, elements: e } = createSiteDom();
  e.bottomBar.children = e.bottomBar.children.filter((child) => child !== e.contactButton);
  e.aboutOverlay.appendChild(e.contactButton);
  await loadPanels(window, document);
  e.aboutButton.dispatchEvent(createEvent("click"));
  e.contactButton.dispatchEvent(createEvent("click"));
  assert.equal(e.contactOverlay.hidden, false);
  assert.equal(e.aboutOverlay.inert, true);
  assert.equal(e.aboutButton.getAttribute("aria-expanded"), "true");
  document.dispatchEvent(createEvent("keydown", { key: "Escape" }));
  assert.equal(e.aboutOverlay.hidden, false);
  assert.equal(e.aboutOverlay.inert, false);
  assert.equal(e.contactOverlay.hidden, true);
  assert.equal(document.activeElement, e.contactButton);
  assert.equal(e.bottomBar.inert, true);
  document.dispatchEvent(createEvent("keydown", { key: "Escape" }));
  assert.equal(e.aboutOverlay.hidden, true);
  assert.equal(document.activeElement, e.aboutButton);
  assert.equal(e.bottomBar.inert, false);
});

// Retained direct-estate fixture for the previous homepage and controller compatibility.
function createEstateDom({ reduceMotion = true } = {}) {
  const document = new FakeDocument();
  const media = new FakeElement(document, "media-query");
  media.matches = reduceMotion;
  const window = {
    document,
    BabelSite: {},
    setTimeout,
    clearTimeout,
    matchMedia: () => media,
  };
  const skipLink = append(
    document.body,
    new FakeElement(document, "a", {
      classNames: ["skip-link"],
      attributes: { href: "#main" },
    }),
  );
  const main = append(document.body, new FakeElement(document, "main", { id: "main" }));
  const navigation = append(main, new FakeElement(document, "nav"));
  const footer = append(
    document.body,
    new FakeElement(document, "footer", {
      classNames: ["site-footer"],
    }),
  );
  const destinations = {};
  for (const name of ["profile", "experience", "contact"]) {
    const button = append(
      navigation,
      new FakeElement(document, "button", {
        classNames: ["bottom-btn", "estate-destination"],
        dataset: { panel: name },
        attributes: { "aria-expanded": "false", "aria-controls": "panel-" + name },
      }),
    );
    const panel = append(
      document.body,
      new FakeElement(document, "div", {
        classNames: ["panel-overlay"],
        id: "panel-" + name,
        hidden: true,
      }),
    );
    const card = append(
      panel,
      new FakeElement(document, "div", {
        classNames: ["panel-parchment", "panel-surface"],
        attributes: { tabindex: "-1" },
      }),
    );
    const close = append(
      card,
      new FakeElement(document, "button", {
        classNames: ["panel-close"],
        attributes: { "aria-label": "Close" },
      }),
    );
    const copy = append(card, new FakeElement(document, "p", { textContent: name + " copy" }));
    const link =
      name === "contact"
        ? append(
            card,
            new FakeElement(document, "a", {
              attributes: { href: "mailto:hello@example.test" },
            }),
          )
        : null;
    destinations[name] = { button, panel, card, close, copy, link };
  }
  return { window, document, media, main, navigation, footer, skipLink, destinations };
}

function listenerCount(target) {
  return [...target.listeners.values()].reduce((sum, handlers) => sum + handlers.length, 0);
}

test("each estate destination returns directly to its own trigger on close, backdrop, or Escape", async () => {
  const dom = createEstateDom();
  const { window, document, destinations } = dom;
  assert.equal(await loadPanels(window, document), true);
  for (const destination of Object.values(destinations)) {
    for (const closeBy of ["button", "backdrop", "Escape"]) {
      destination.button.focus();
      destination.button.dispatchEvent(createEvent("click"));
      assert.equal(document.activeElement, destination.close);
      assert.equal(destination.panel.hidden, false);
      assert.equal(destination.button.getAttribute("aria-expanded"), "true");
      for (const node of [dom.main, dom.footer, dom.skipLink]) assert.equal(node.inert, true);
      for (const other of Object.values(destinations).filter((item) => item !== destination)) {
        assert.equal(other.panel.hidden, true);
        assert.equal(other.button.getAttribute("aria-expanded"), "false");
      }
      destination.panel.dispatchEvent(createEvent("click", { target: destination.copy }));
      assert.equal(
        destination.panel.hidden,
        false,
        "clicking the writing area keeps the dialog open",
      );
      if (closeBy === "button") destination.close.dispatchEvent(createEvent("click"));
      else if (closeBy === "backdrop") pointerClick(destination.panel);
      else document.dispatchEvent(createEvent("keydown", { key: "Escape" }));
      assert.equal(destination.panel.hidden, true);
      assert.equal(destination.panel.inert, true);
      assert.equal(destination.button.getAttribute("aria-expanded"), "false");
      assert.equal(document.activeElement, destination.button);
      assert.equal(document.body.getAttribute("data-panel-open"), null);
      for (const node of [dom.main, dom.footer, dom.skipLink]) assert.equal(node.inert, false);
    }
  }
});

test("estate dialogs trap focus with either one control or the Contact email link", async () => {
  const dom = createEstateDom();
  await loadPanels(dom.window, dom.document);
  for (const item of Object.values(dom.destinations)) {
    item.button.dispatchEvent(createEvent("click"));
    const last = item.link || item.close;
    last.focus();
    const forward = createEvent("keydown", { key: "Tab" });
    dom.document.dispatchEvent(forward);
    assert.equal(forward.defaultPrevented, true);
    assert.equal(dom.document.activeElement, item.close);
    const reverse = createEvent("keydown", { key: "Tab", shiftKey: true });
    dom.document.dispatchEvent(reverse);
    assert.equal(reverse.defaultPrevented, true);
    assert.equal(dom.document.activeElement, last);
    dom.main.focus();
    dom.document.dispatchEvent(createEvent("keydown", { key: "Tab" }));
    assert.equal(
      dom.document.activeElement,
      item.close,
      "an escaped focus is returned to the dialog",
    );
    item.close.dispatchEvent(createEvent("click"));
  }
});

test("estate reopening and category switches cannot be hidden by stale transition callbacks", async () => {
  const dom = createEstateDom({ reduceMotion: false });
  const callbacks = [];
  dom.window.setTimeout = (callback) => {
    callbacks.push(callback);
    return callbacks.length;
  };
  dom.window.clearTimeout = () => {};
  await loadPanels(dom.window, dom.document);
  const profile = dom.destinations.profile;
  const contact = dom.destinations.contact;
  profile.button.dispatchEvent(createEvent("click"));
  profile.close.dispatchEvent(createEvent("click"));
  profile.button.dispatchEvent(createEvent("click"));
  callbacks[0]();
  assert.equal(profile.panel.hidden, false);
  assert.equal(profile.panel.inert, false);
  profile.close.dispatchEvent(createEvent("click"));
  contact.button.dispatchEvent(createEvent("click"));
  callbacks[1]();
  assert.equal(profile.panel.hidden, true);
  assert.equal(contact.panel.hidden, false);
  assert.equal(dom.document.activeElement, contact.close);
  contact.close.dispatchEvent(createEvent("click"));
  dom.media.matches = true;
  dom.media.dispatchEvent(createEvent("change"));
  assert.equal(contact.panel.hidden, true, "reduced motion finishes the pending close immediately");
  dom.destinations.experience.button.dispatchEvent(createEvent("click"));
  dom.destinations.experience.close.dispatchEvent(createEvent("click"));
  assert.equal(dom.destinations.experience.panel.hidden, true);
  assert.equal(dom.document.activeElement, dom.destinations.experience.button);
});

test("panel initialization is idempotent without duplicate listeners or toggled-open dialogs", async () => {
  const dom = createEstateDom();
  await loadPanels(dom.window, dom.document);
  for (let i = 0; i < 3; i++) assert.equal(dom.window.BabelSite.ui.initPanels(), true);
  assert.equal(listenerCount(dom.document), 1);
  assert.equal(listenerCount(dom.media), 1);
  for (const item of Object.values(dom.destinations)) {
    assert.equal(listenerCount(item.button), 1);
    assert.equal(listenerCount(item.close), 1);
    assert.equal(listenerCount(item.panel), 3, "backdrop pointerdown, pointerup, and click");
    item.button.dispatchEvent(createEvent("click"));
    assert.equal(item.panel.hidden, false);
    item.close.dispatchEvent(createEvent("click"));
  }
});

test("invalid estate panel markup fails without binding and can be repaired before retry", async (t) => {
  for (const missing of ["buttons", "panels", "target", "surface", "close"]) {
    await t.test(missing, async () => {
      const dom = createEstateDom();
      const item = dom.destinations.experience;
      let restore;
      if (missing === "buttons") {
        const saved = dom.navigation.children;
        dom.navigation.children = [];
        restore = () => {
          dom.navigation.children = saved;
        };
      } else if (missing === "panels") {
        const saved = dom.document.body.children;
        dom.document.body.children = saved.filter(
          (node) => !node.classList.contains("panel-overlay"),
        );
        restore = () => {
          dom.document.body.children = saved;
        };
      } else if (missing === "target") {
        item.button.dataset.panel = "missing";
        restore = () => {
          item.button.dataset.panel = "experience";
        };
      } else if (missing === "surface") {
        item.card.classList.remove("panel-surface");
        restore = () => item.card.classList.add("panel-surface");
      } else {
        item.close.classList.remove("panel-close");
        restore = () => item.close.classList.add("panel-close");
      }
      await loadPanels(dom.window, dom.document, { initialize: false });
      assert.equal(dom.window.BabelSite.ui.initPanels(), false);
      assert.equal(listenerCount(dom.document) + listenerCount(dom.media), 0);
      for (const destination of Object.values(dom.destinations)) {
        assert.equal(listenerCount(destination.button), 0);
        assert.equal(destination.panel.hidden, true);
      }
      restore();
      assert.equal(dom.window.BabelSite.ui.initPanels(), true);
      item.button.dispatchEvent(createEvent("click"));
      assert.equal(item.panel.hidden, false);
      item.close.dispatchEvent(createEvent("click"));
      assert.equal(dom.document.activeElement, item.button);
    });
  }
});

test("a late binding failure rolls back all earlier registrations and allows a clean retry", async () => {
  const dom = createEstateDom();
  await loadPanels(dom.window, dom.document, { initialize: false });
  const originalListen = dom.document.addEventListener;
  dom.document.addEventListener = () => {
    throw new Error("simulated event registration failure");
  };
  assert.equal(dom.window.BabelSite.ui.initPanels(), false);
  assert.equal(listenerCount(dom.media), 0);
  for (const item of Object.values(dom.destinations)) {
    assert.equal(
      listenerCount(item.button) + listenerCount(item.close) + listenerCount(item.panel),
      0,
    );
    item.button.dispatchEvent(createEvent("click"));
    assert.equal(item.panel.hidden, true);
  }
  assert.equal(dom.document.body.getAttribute("data-panel-open"), null);
  assert.equal(dom.main.inert, false);
  dom.document.addEventListener = originalListen;
  assert.equal(dom.window.BabelSite.ui.initPanels(), true);
  assert.equal(listenerCount(dom.document), 1);
  const item = dom.destinations.profile;
  item.button.dispatchEvent(createEvent("click"));
  assert.equal(item.panel.hidden, false);
  item.close.dispatchEvent(createEvent("click"));
  assert.equal(dom.document.activeElement, item.button);
});
// Current homepage: the scene's About entry opens an estate whose destinations
// open sibling category overlays; panel history returns through the estate.
function createSceneEstateDom(options = {}) {
  const dom = createEstateDom(options);
  const { document, main, navigation, destinations } = dom;
  document.body.classList.add("scene-home");
  const sceneShell = append(
    document.body,
    new FakeElement(document, "div", {
      classNames: ["scene-shell"],
    }),
  );
  append(sceneShell, new FakeElement(document, "div", { id: "home-scene" }));
  const siteShell = append(
    document.body,
    new FakeElement(document, "div", {
      classNames: ["site-shell"],
    }),
  );
  const bottomBar = append(
    document.body,
    new FakeElement(document, "nav", {
      classNames: ["bottom-bar"],
      attributes: { "aria-label": "Primary" },
    }),
  );
  const entry = append(
    bottomBar,
    new FakeElement(document, "button", {
      classNames: ["bottom-btn", "bottom-btn--icon", "scene-entry"],
      dataset: { panel: "about" },
      attributes: {
        "aria-label": "About",
        "aria-controls": "panel-about",
        "aria-expanded": "false",
      },
    }),
  );
  const panel = append(
    document.body,
    new FakeElement(document, "div", {
      id: "panel-about",
      classNames: ["panel-overlay"],
      hidden: true,
      attributes: { role: "dialog", "aria-modal": "true", "aria-labelledby": "panel-about-title" },
    }),
  );
  const card = append(
    panel,
    new FakeElement(document, "div", {
      classNames: ["panel-estate", "panel-surface"],
      attributes: { tabindex: "-1" },
    }),
  );
  const map = append(card, new FakeElement(document, "div", { classNames: ["estate-map"] }));
  append(map, new FakeElement(document, "h2", { id: "panel-about-title", textContent: "About" }));
  const close = append(
    map,
    new FakeElement(document, "button", {
      classNames: ["panel-close"],
      attributes: { "aria-label": "Close About" },
    }),
  );
  main.children = main.children.filter((element) => element !== navigation);
  navigation.classList.add("estate-destinations");
  append(map, navigation);
  for (const [name, destination] of Object.entries(destinations)) {
    destination.button.classList.add(`estate-${name}`);
    destination.close.classList.add("panel-back");
    destination.close.setAttribute("aria-label", "Back to About");
    destination.panel.setAttribute("role", "dialog");
    destination.panel.setAttribute("aria-modal", "true");
  }
  return {
    ...dom,
    sceneShell,
    siteShell,
    bottomBar,
    about: { entry, panel, card, map, close },
    backgrounds: [dom.skipLink, sceneShell, siteShell, main, bottomBar, dom.footer],
  };
}

function dismissPanel(document, panel, close, method) {
  if (method === "button") close.dispatchEvent(createEvent("click"));
  else if (method === "backdrop") pointerClick(panel);
  else document.dispatchEvent(createEvent("keydown", { key: "Escape" }));
}

test("scene About opens the map first and each category returns through its destination to the scene entry", async () => {
  const dom = createSceneEstateDom();
  const { document, about, destinations } = dom;
  assert.equal(await loadPanels(dom.window, document), true);
  for (const item of Object.values(destinations)) {
    for (const method of ["button", "backdrop", "Escape"]) {
      about.entry.focus();
      about.entry.dispatchEvent(createEvent("click"));
      assert.equal(about.panel.hidden, false);
      assert.equal(document.activeElement, about.close);
      assert.equal(about.entry.getAttribute("aria-expanded"), "true");
      for (const destination of Object.values(destinations))
        assert.equal(destination.panel.hidden, true);
      item.button.focus();
      item.button.dispatchEvent(createEvent("click"));
      assert.equal(about.panel.hidden, true);
      assert.equal(about.panel.inert, true);
      assert.equal(about.panel.getAttribute("aria-hidden"), "true");
      assert.equal(
        about.entry.getAttribute("aria-expanded"),
        "true",
        "About remains expanded while its child is active",
      );
      assert.equal(item.button.getAttribute("aria-expanded"), "true");
      assert.equal(item.panel.hidden, false);
      assert.equal(document.activeElement, item.close);
      for (const node of dom.backgrounds) assert.equal(node.inert, true);
      item.panel.dispatchEvent(createEvent("click", { target: item.copy }));
      assert.equal(item.panel.hidden, false, "selecting category copy is not a backdrop dismissal");

      dismissPanel(document, item.panel, item.close, method);
      assert.equal(item.panel.hidden, true);
      assert.equal(item.panel.inert, true);
      assert.equal(item.button.getAttribute("aria-expanded"), "false");
      assert.equal(about.panel.hidden, false);
      assert.equal(about.panel.inert, false);
      assert.equal(about.panel.getAttribute("aria-hidden"), null);
      assert.equal(
        document.activeElement,
        item.button,
        "return focuses the selected map destination",
      );
      assert.equal(document.body.getAttribute("data-panel-open"), "true");
      for (const node of dom.backgrounds)
        assert.equal(node.inert, true, "returning to About keeps the scene inert");

      dismissPanel(document, about.panel, about.close, method);
      assert.equal(about.panel.hidden, true);
      assert.equal(about.entry.getAttribute("aria-expanded"), "false");
      assert.equal(document.activeElement, about.entry, "leaving About restores the scene icon");
      assert.equal(document.body.getAttribute("data-panel-open"), null);
      for (const node of dom.backgrounds) assert.equal(node.inert, false);
    }
  }
});

test("drag-selecting between the paper and backdrop keeps the dialog open", async () => {
  const dom = createSceneEstateDom();
  const {
    document,
    about,
    destinations: { contact },
  } = dom;
  await loadPanels(dom.window, document);
  about.entry.dispatchEvent(createEvent("click"));
  contact.button.dispatchEvent(createEvent("click"));
  pointerClick(contact.panel, contact.link, contact.panel);
  assert.equal(
    contact.panel.hidden,
    false,
    "selecting the email out onto the backdrop keeps Contact open",
  );
  pointerClick(contact.panel, contact.panel, contact.copy);
  assert.equal(
    contact.panel.hidden,
    false,
    "a selection started on the backdrop keeps Contact open",
  );
  contact.panel.dispatchEvent(createEvent("pointerdown"));
  contact.panel.dispatchEvent(createEvent("click", { target: contact.copy }));
  assert.equal(
    contact.panel.hidden,
    false,
    "a backdrop press that clicks the copy keeps Contact open",
  );
  contact.panel.dispatchEvent(createEvent("click"));
  assert.equal(contact.panel.hidden, false, "each click consumes its press");
  pointerClick(contact.panel);
  assert.equal(contact.panel.hidden, true, "a press and click on the backdrop still dismiss");
  assert.equal(about.panel.hidden, false);
  assert.equal(document.activeElement, contact.button);
  pointerClick(about.panel, about.map, about.panel);
  assert.equal(about.panel.hidden, false, "the About map ignores a drag onto its backdrop");
  pointerClick(about.panel);
  assert.equal(about.panel.hidden, true);
  assert.equal(document.activeElement, about.entry);
});

test("the nested estate traps keyboard focus among Close and its three destinations", async () => {
  const dom = createSceneEstateDom();
  const { document, about, destinations } = dom;
  await loadPanels(dom.window, document);
  about.entry.dispatchEvent(createEvent("click"));
  const reverse = createEvent("keydown", { key: "Tab", shiftKey: true });
  document.dispatchEvent(reverse);
  assert.equal(reverse.defaultPrevented, true);
  assert.equal(document.activeElement, destinations.contact.button);
  const forward = createEvent("keydown", { key: "Tab" });
  document.dispatchEvent(forward);
  assert.equal(forward.defaultPrevented, true);
  assert.equal(document.activeElement, about.close);
  for (const item of Object.values(destinations)) {
    item.button.dispatchEvent(createEvent("click"));
    const last = item.link || item.close;
    last.focus();
    document.dispatchEvent(createEvent("keydown", { key: "Tab" }));
    assert.equal(document.activeElement, item.close);
    document.dispatchEvent(createEvent("keydown", { key: "Tab", shiftKey: true }));
    assert.equal(document.activeElement, last);
    document.dispatchEvent(createEvent("keydown", { key: "Escape" }));
    assert.equal(document.activeElement, item.button);
  }
  document.dispatchEvent(createEvent("keydown", { key: "Escape" }));
  assert.equal(document.activeElement, about.entry);
});

test("rapid child returns and reopenings cannot let stale exits hide the active map or category", async () => {
  const dom = createSceneEstateDom({ reduceMotion: false });
  const { document, about, destinations } = dom;
  const callbacks = [];
  dom.window.setTimeout = (callback) => {
    callbacks.push(callback);
    return callbacks.length;
  };
  dom.window.clearTimeout = () => {};
  await loadPanels(dom.window, document);
  about.entry.dispatchEvent(createEvent("click"));
  destinations.profile.button.dispatchEvent(createEvent("click")); // About exit 0.
  destinations.profile.close.dispatchEvent(createEvent("click")); // Profile exit 1.
  callbacks[0]();
  assert.equal(about.panel.hidden, false);
  assert.equal(about.panel.inert, false);
  assert.equal(document.activeElement, destinations.profile.button);
  destinations.profile.button.dispatchEvent(createEvent("click")); // About exit 2.
  callbacks[1]();
  assert.equal(destinations.profile.panel.hidden, false);
  assert.equal(destinations.profile.panel.inert, false);
  document.dispatchEvent(createEvent("keydown", { key: "Escape" })); // Profile exit 3.
  destinations.contact.button.dispatchEvent(createEvent("click")); // About exit 4.
  callbacks[2]();
  callbacks[3]();
  assert.equal(destinations.profile.panel.hidden, true);
  assert.equal(destinations.contact.panel.hidden, false);
  assert.equal(destinations.contact.panel.inert, false);
  assert.equal(document.activeElement, destinations.contact.close);
  destinations.contact.close.dispatchEvent(createEvent("click")); // Contact exit 5.
  callbacks[4]();
  assert.equal(about.panel.hidden, false);
  assert.equal(document.activeElement, destinations.contact.button);
  for (const node of dom.backgrounds) assert.equal(node.inert, true);
  about.close.dispatchEvent(createEvent("click")); // About exit 6.
  assert.equal(document.activeElement, about.entry);
  assert.equal(document.body.getAttribute("data-panel-open"), null);
  callbacks.forEach((callback) => callback());
  assert.equal(about.panel.hidden, true);
  for (const item of Object.values(destinations)) {
    assert.equal(item.panel.hidden, true);
    assert.equal(item.button.getAttribute("aria-expanded"), "false");
  }
  about.entry.dispatchEvent(createEvent("click"));
  about.close.dispatchEvent(createEvent("click"));
  assert.equal(
    document.activeElement,
    about.entry,
    "rapid nested navigation leaves no stale history entry",
  );
  callbacks.forEach((callback) => callback());
});

test("repeated initialization while a child is open preserves nested navigation and listener counts", async () => {
  const dom = createSceneEstateDom();
  const { document, about, destinations } = dom;
  await loadPanels(dom.window, document);
  about.entry.dispatchEvent(createEvent("click"));
  destinations.experience.button.dispatchEvent(createEvent("click"));
  for (let i = 0; i < 3; i++) assert.equal(dom.window.BabelSite.ui.initPanels(), true);
  assert.equal(listenerCount(document), 1);
  assert.equal(listenerCount(dom.media), 1);
  assert.equal(listenerCount(about.entry), 1);
  assert.equal(listenerCount(about.close), 1);
  for (const item of Object.values(destinations)) {
    assert.equal(listenerCount(item.button), 1);
    assert.equal(listenerCount(item.close), 1);
    assert.equal(listenerCount(item.panel), 3);
  }
  assert.equal(document.activeElement, destinations.experience.close);
  document.dispatchEvent(createEvent("keydown", { key: "Escape" }));
  assert.equal(document.activeElement, destinations.experience.button);
  document.dispatchEvent(createEvent("keydown", { key: "Escape" }));
  assert.equal(document.activeElement, about.entry);
  assert.equal(about.panel.hidden, true);
});

// Dialog changes are announced on the document for URL and scene listeners.
class FakeCustomEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.detail = init.detail;
  }
}

function recordPanelChanges(dom) {
  dom.window.CustomEvent = FakeCustomEvent;
  const changes = [];
  dom.document.addEventListener("babel:panelchange", (event) => {
    changes.push({
      ...event.detail,
      panelOpen: dom.document.body.getAttribute("data-panel-open"),
      focus: dom.document.activeElement,
    });
  });
  return changes;
}

test("each open and close announces the dialog now showing after the page settles", async () => {
  for (const method of ["button", "backdrop", "Escape"]) {
    const dom = createSceneEstateDom();
    const {
      document,
      about,
      destinations: { profile },
    } = dom;
    const changes = recordPanelChanges(dom);
    await loadPanels(dom.window, document);
    about.entry.dispatchEvent(createEvent("click"));
    profile.button.dispatchEvent(createEvent("click"));
    dismissPanel(document, profile.panel, profile.close, method);
    dismissPanel(document, about.panel, about.close, method);
    assert.deepEqual(
      changes.map(({ id, open }) => [id, open]),
      [
        ["about", true],
        ["profile", true],
        ["about", true],
        [null, false],
      ],
      `${method}: switching to a category never reports an intermediate close`,
    );
    assert.equal(changes[0].focus, about.close, "announced after focus moves into About");
    assert.equal(changes[1].focus, profile.close);
    assert.equal(changes[2].focus, profile.button, "announced after focus returns to the map");
    assert.ok(changes.slice(0, 3).every((change) => change.panelOpen === "true"));
    assert.equal(changes[3].panelOpen, null);
    assert.equal(changes[3].focus, about.entry, "announced after focus returns to the scene");
  }
});

test("direct dialogs announce their open and final close", async () => {
  const dom = createEstateDom();
  const changes = recordPanelChanges(dom);
  await loadPanels(dom.window, dom.document);
  const { contact, experience } = dom.destinations;
  contact.button.dispatchEvent(createEvent("click"));
  contact.close.dispatchEvent(createEvent("click"));
  experience.button.dispatchEvent(createEvent("click"));
  experience.button.dispatchEvent(createEvent("click"));
  assert.deepEqual(
    changes.map(({ id, open }) => [id, open]),
    [
      ["contact", true],
      [null, false],
      ["experience", true],
      [null, false],
    ],
  );
});

test("a deep link opens its category through About so Back and Escape step out normally", async () => {
  const deepLinksSource = await readFile(
    path.join(projectRoot, "src", "ui", "deep-links.js"),
    "utf8",
  );
  const dom = createSceneEstateDom();
  const { document, about, destinations } = dom;
  const hashListeners = [];
  const urls = [];
  Object.assign(dom.window, {
    CustomEvent: FakeCustomEvent,
    location: { pathname: "/", search: "", hash: "#contact-text" },
    history: {
      state: null,
      replaceState(state, title, url) {
        urls.push(url);
        dom.window.location.hash = url.includes("#") ? url.slice(url.indexOf("#")) : "";
      },
    },
    addEventListener(type, handler) {
      if (type === "hashchange") hashListeners.push(handler);
    },
  });
  const followHash = (hash) => {
    dom.window.location.hash = hash;
    hashListeners.forEach((handler) => handler({ type: "hashchange" }));
  };
  await loadPanels(dom.window, document);
  vm.runInNewContext(
    deepLinksSource,
    { window: dom.window, document },
    {
      filename: "src/ui/deep-links.js",
    },
  );
  assert.equal(dom.window.BabelSite.ui.initDeepLinks(), true);

  assert.equal(destinations.contact.panel.hidden, false);
  assert.equal(about.panel.hidden, true);
  assert.equal(about.entry.getAttribute("aria-expanded"), "true");
  assert.equal(document.activeElement, destinations.contact.close);
  assert.equal(dom.window.location.hash, "#contact");
  document.dispatchEvent(createEvent("keydown", { key: "Escape" }));
  assert.equal(about.panel.hidden, false, "Escape returns to the map");
  assert.equal(document.activeElement, destinations.contact.button);
  assert.equal(dom.window.location.hash, "#about");
  document.dispatchEvent(createEvent("keydown", { key: "Escape" }));
  assert.equal(about.panel.hidden, true);
  assert.equal(document.activeElement, about.entry);
  assert.equal(dom.window.location.hash, "");
  assert.equal(urls.at(-1), "/");

  followHash("#experience");
  assert.equal(destinations.experience.panel.hidden, false);
  followHash("#profile");
  assert.equal(destinations.experience.panel.hidden, true);
  assert.equal(destinations.profile.panel.hidden, false);
  destinations.profile.close.dispatchEvent(createEvent("click"));
  assert.equal(about.panel.hidden, false, "Back returns to the map after a hash switch");
  assert.equal(document.activeElement, destinations.profile.button);
  about.close.dispatchEvent(createEvent("click"));
  assert.equal(document.activeElement, about.entry);
  assert.equal(document.body.getAttribute("data-panel-open"), null);
  assert.equal(dom.window.location.hash, "");
});
