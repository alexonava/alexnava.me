import assert from "node:assert/strict";
import test from "node:test";
import {
  contrast,
  flat as flatCss,
  mediaBlock,
  rule as cssRule,
  rules as cssRules,
} from "./support/css.mjs";
import { flat as flatHtml } from "./support/html.mjs";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));

const projectRoot = path.resolve(testDir, "..");

async function readIndexHtml() {
  return readFile(path.join(projectRoot, "index.html"), "utf8");
}

async function readStyles() {
  return readFile(path.join(projectRoot, "styles.css"), "utf8");
}

async function readNotFoundHtml() {
  return readFile(path.join(projectRoot, "404.html"), "utf8");
}

// A colour as the cascade resolves it: var(--name) follows the :root tokens.
function color(styles, value) {
  let resolved = value.trim();
  while (resolved.startsWith("var("))
    resolved = styles.match(new RegExp(`${resolved.slice(4, -1)}:\\s*([^;]+);`))[1].trim();
  return resolved;
}

function collectMatches(regex, source) {
  const out = [];
  for (const match of source.matchAll(regex)) out.push(match[1]);
  return out;
}

test("every aria-controls target resolves to an element id in the same document", async () => {
  const html = await readIndexHtml();
  const controls = collectMatches(/aria-controls="([^"]+)"/g, html);
  assert.ok(controls.length > 0, "sanity: fixture exposes aria-controls");

  for (const targetId of controls) {
    const idAttr = new RegExp(`id="${targetId}"`);
    assert.match(html, idAttr, `aria-controls="${targetId}" has no matching element`);
  }
});

test("every aria-labelledby reference resolves to an element id", async () => {
  const html = await readIndexHtml();
  const refs = collectMatches(/aria-labelledby="([^"]+)"/g, html);
  for (const targetId of refs) {
    assert.match(html, new RegExp(`id="${targetId}"`), `aria-labelledby="${targetId}" missing`);
  }
});

test("the skip-link points at an id that exists on the page", async () => {
  const html = await readIndexHtml();
  const skipMatch = html.match(/class="skip-link"\s+href="#([^"]+)"/);
  assert.ok(skipMatch, "skip-link is present");
  assert.match(html, new RegExp(`id="${skipMatch[1]}"`));
});

test("Contact is the page's one button, a native disclosure over the links it shows", async () => {
  const html = flatHtml(await readIndexHtml());
  const buttons = html.match(/<button[^>]*>/g) || [];
  assert.equal(buttons.length, 1);
  const [toggle] = buttons;
  assert.match(toggle, /class="site-footer__link site-footer__contact"/);
  assert.match(toggle, /type="button"/);
  assert.match(toggle, /aria-expanded="true"/, "expanded, as the no-JS links show");
  assert.match(toggle, /aria-controls="contact-links"/);
  assert.match(toggle, / hidden>/, "hidden until contact.js binds it");
  assert.doesNotMatch(toggle, /aria-label/, "its text names it");
  assert.match(html, /<span class="site-footer__label">Contact<\/span><\/button>/);
  assert.match(html, /<p class="site-footer__links" id="contact-links">/);
});

test("the scene is the landing content, and nothing covers or dims it", async () => {
  const html = flatHtml(await readIndexHtml());
  const styles = await readStyles();
  assert.match(html, /<body class="scene-home">/);
  assert.match(html, /<main[^>]*id="main"[^>]*tabindex="-1"/);
  assert.match(html, /<div class="scene-shell" aria-hidden="true">/);
  assert.match(html, /id="home-scene" class="scene-canvas"/);
  const main = html.match(/<main[\s\S]*?<\/main>/)[0];
  assert.match(main, /id="home" class="hero section"/);
  assert.doesNotMatch(html, /role="dialog"|aria-modal|class="panel-|estate-map|data-panel/);
  assert.doesNotMatch(styles, /body::after|data-panel-open|\.panel-|\.estate-/);
});

const LOADER_MARKUP =
  '<div class="scene-loader" id="scene-loader" aria-hidden="true" hidden><p class="scene-loader__label">Loading the estate &middot; <span class="scene-loader__value">0%</span></p><div class="scene-loader__track"><div class="scene-loader__fill"></div></div></div>';

test("the title card paints no picture, and its hidden loading line sits between the bottom bar and footer", async () => {
  const html = flatHtml(await readIndexHtml());
  assert.doesNotMatch(html, /<picture|<img/);
  assert.equal(
    html.split(flatHtml(LOADER_MARKUP)).length - 1,
    1,
    "the loading line's exact markup, once",
  );
  const at = html.indexOf(flatHtml(LOADER_MARKUP));
  assert.ok(html.indexOf('<div class="bottom-bar"') < at, "after the bottom bar");
  assert.ok(at < html.indexOf('<footer class="site-footer">'), "before the footer");
  const main = html.match(/<main[\s\S]*?<\/main>/)[0];
  assert.doesNotMatch(main, /scene-loader/, "outside main");
  // The CSP allows no inline style; the line moves only through the CSSOM.
  for (const page of [html, await readNotFoundHtml()]) {
    assert.doesNotMatch(page, /\sstyle=|<style[\s>]/);
  }
});

test("the walk fades the page off the canvas and back, keeping every box's layout and never the canvas", async () => {
  const styles = await readStyles();
  const walking = cssRule(styles, "body.scene-walking > :not(.scene-shell)"),
    hidden = cssRule(styles, "body.scene-walk-hidden > :not(.scene-shell)");
  assert.match(walking, /transition:\s*opacity 420ms ease,\s*visibility 0s;/);
  assert.match(hidden, /opacity:\s*0;\s*visibility:\s*hidden;/);
  assert.match(hidden, /transition:\s*opacity 420ms ease,\s*visibility 0s linear 420ms;/);
  // Visibility, never display: the tour's safe area measures the hidden boxes.
  for (const { selector, body } of cssRules(styles, (list) => list.includes("scene-walk")))
    assert.doesNotMatch(`${selector}{${body}`, /display|scene-canvas|scene-shell\s*>/, selector);
});

test("the canvas keeps one 480ms fade over the title card, and the loading line finishes within it", async () => {
  const styles = await readStyles();
  const canvas = cssRule(styles, ".scene-canvas");
  assert.match(canvas, /z-index:\s*1;/);
  assert.match(canvas, /opacity:\s*0;/);
  assert.match(canvas, /transition:\s*opacity 480ms ease-out;/);
  assert.match(cssRule(styles, ".scene-canvas.is-ready"), /opacity:\s*1;/);
  // terrain-build.js and mountain-build.js read the canvas's one
  // transitionDuration, so no other rule may add or change a transition.
  const canvasTransitions = cssRules(styles, (selector) =>
    selector.split(",").some((part) => /^\.scene-canvas(?:\.is-ready)?$/.test(part.trim())),
  ).flatMap(({ body }) =>
    [...body.matchAll(/transition[\w-]*:\s*([^;]+);/g)].map((match) => match[1]),
  );
  assert.deepEqual(canvasTransitions, ["opacity 480ms ease-out", "none"]);
  const [, duration, delay] = cssRule(styles, ".scene-loader.is-done").match(
    /opacity:\s*0;\s*transition:\s*opacity (\d+)ms ease (\d+)ms;/,
  );
  assert.ok(Number(duration) + Number(delay) <= 480, "the line is gone when the canvas is in");
  const reduced = mediaBlock(styles, "(prefers-reduced-motion: reduce)");
  for (const selector of [
    ".scene-canvas",
    ".scene-loader.is-loading",
    ".scene-loader.is-done",
    ".scene-loader__fill",
  ]) {
    assert.ok(
      cssRules(reduced, (list) => list.split(",").some((part) => part.trim() === selector)).some(
        ({ body }) => /transition:\s*none;/.test(body),
      ),
      `${selector} is immediate for reduced motion`,
    );
  }
  // The bar moves only with real progress: no glint sweeps it, for anyone.
  assert.deepEqual(
    cssRules(
      styles,
      (selector) => /scene-loader/.test(selector) && /::(?:after|before)/.test(selector),
    ),
    [],
    "no decorative layer on the loading line",
  );
  assert.doesNotMatch(styles, /@keyframes scene-loader|glint/, "no glint keyframes");
  assert.doesNotMatch(
    cssRules(styles, (selector) => selector.includes("scene-loader"))
      .map(({ body }) => body)
      .join(""),
    /animation/,
    "nothing on the loading line animates",
  );
});

test("the loading line is fixed above the footer, inert, legible and drawn by one transform", async () => {
  const styles = await readStyles();
  const loader = cssRule(styles, ".scene-loader");
  assert.match(loader, /position:\s*fixed;/);
  assert.match(loader, /pointer-events:\s*none;/);
  // One 44px footer row above the footer's own safe-area offset.
  const footerBottom = cssRule(styles, ".site-footer").match(/bottom:\s*([^;]+);/)[1];
  assert.ok(
    loader.includes(`bottom: calc(${footerBottom} + 44px);`),
    "the line sits on the footer",
  );
  assert.ok(Number(loader.match(/font-size:\s*(\d+)px;/)[1]) >= 12);
  assert.match(loader, /color:\s*var\(--text-accent\);/);
  assert.match(loader, /text-shadow:\s*var\(--text-meta-shadow\);/);
  assert.match(cssRule(styles, ".scene-loader__label"), /font-variant-numeric:\s*tabular-nums;/);
  const fill = cssRule(styles, ".scene-loader__fill");
  assert.match(fill, /transform:\s*scaleX\(0\);/);
  assert.match(fill, /transform-origin:\s*0 50%;/);
  // Only the transform animates, and the script writes nothing else.
  const fillTransitions = cssRules(styles, (selector) =>
    /\.scene-loader__fill$/.test(selector.trim()),
  ).flatMap(({ body }) =>
    [...body.matchAll(/transition(?:-property)?:\s*([^;]+);/g)].map((match) => match[1]),
  );
  assert.ok(fillTransitions.length > 0);
  for (const transition of fillTransitions)
    assert.match(transition, /^(?:transform \d+ms\b|none$)/);
  const script = await readFile(path.join(projectRoot, "src", "ui", "scene-loader.js"), "utf8");
  assert.deepEqual(
    [...new Set([...script.matchAll(/\.style\.(\w+)\s*=/g)].map((match) => match[1]))],
    ["transform"],
  );
  assert.match(
    mediaBlock(styles, "(forced-colors: active)"),
    /\.scene-loader\s*\{\s*display:\s*none;/,
  );
  const transparency = mediaBlock(styles, "(prefers-reduced-transparency: reduce)");
  assert.match(transparency, /\.scene-loader__track\s*\{\s*background:\s*#[0-9a-f]{6};/i);
  assert.match(transparency, /\.scene-loader__fill\s*\{\s*box-shadow:\s*none;/);
  const ink = color(styles, "var(--text-accent)"),
    night = color(styles, "var(--night-900)");
  assert.ok(
    contrast(ink, night) >= 4.5,
    `${ink} on the night is ${contrast(ink, night).toFixed(2)}:1`,
  );
});

test("the title card's night sky is two tiling star layers drawn in CSS, with no image request", async () => {
  const styles = await readStyles();
  const stars = cssRule(styles, ".scene-shell::before");
  assert.match(stars, /z-index:\s*0;/, "under the canvas (1) and vignette (2)");
  assert.match(cssRule(styles, ".scene-vignette"), /z-index:\s*2;/);
  assert.match(stars, /pointer-events:\s*none;/);
  const layers = [...stars.matchAll(/url\("(data:image\/svg\+xml,[^"]+)"\)/g)].map(
    (match) => match[1],
  );
  assert.equal(layers.length, 2);
  const sizes = layers.map((layer) => Number(layer.match(/width='(\d+)'/)[1]));
  assert.notEqual(sizes[0], sizes[1], "the two tiles never line up");
  for (const [index, layer] of layers.entries()) {
    // Encoded like --cursor-line: no raw markup characters in the URL.
    assert.doesNotMatch(layer, /[<>#"]/);
    const size = sizes[index];
    assert.match(stars, new RegExp(`background-size:[^;]*\\b${size}px ${size}px`));
    const circles = [...layer.matchAll(/%3Ccircle cx='(\d+)' cy='(\d+)' r='([\d.]+)'/g)];
    assert.ok(circles.length > 0);
    // A star never crosses its tile's edge, so the tiles meet without a seam.
    for (const [, x, y, r] of circles)
      for (const at of [x, y])
        assert.ok(Number(at) - Number(r) > 0 && Number(at) + Number(r) < size);
  }
  for (const { selector, body } of cssRules(styles, (selector) =>
    selector.includes(".scene-shell"),
  )) {
    assert.doesNotMatch(body, /\/images\//, `${selector} requests no image`);
  }
});

test("a faint, zero-mean grain dithers the title card and fades with the reveal", async () => {
  const styles = await readStyles();
  const grain = cssRule(styles, ".scene-vignette::before");
  assert.match(grain, /position:\s*absolute;/);
  assert.match(grain, /inset:\s*0;/);
  assert.match(grain, /content:\s*"";/);
  assert.match(grain, /pointer-events:\s*none;/);
  // One tile, encoded like --cursor-line, requesting nothing.
  const tiles = [...grain.matchAll(/url\("(data:image\/svg\+xml,[^"]+)"\)/g)].map(
    (match) => match[1],
  );
  assert.equal(tiles.length, 1);
  assert.doesNotMatch(tiles[0], /[<>#"]|%(?![0-9A-F]{2})/i);
  const svg = decodeURIComponent(tiles[0].slice("data:image/svg+xml,".length));
  const size = Number(svg.match(/<svg [^>]*width='(\d+)'/)[1]);
  assert.equal(Number(svg.match(/<svg [^>]*height='(\d+)'/)[1]), size);
  assert.match(grain, new RegExp(`background-size:\\s*${size}px ${size}px;`));
  assert.match(svg, /<feTurbulence type='fractalNoise' [^>]*stitchTiles='stitch'/);
  assert.match(svg, /color-interpolation-filters='sRGB'/);
  // Two layers from one noise channel: white specks where it rises above its
  // middle, black specks where it falls below, each alpha zero at the middle.
  const [light, dark] = [...svg.matchAll(/<feColorMatrix in='n' values='([^']+)'/g)].map((match) =>
    match[1].split(" ").map(Number),
  );
  assert.deepEqual(light.slice(0, 15), [0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], "white");
  assert.deepEqual(dark.slice(0, 15), Array(15).fill(0), "black");
  const [kLight, kDark] = [light[15], -dark[15]];
  assert.ok(kLight > 0 && kDark > 0);
  assert.ok(Math.abs(light[19] + kLight / 2) < 1e-9 && Math.abs(dark[19] - kDark / 2) < 1e-9);
  // White lifts a code value L by its alpha x (255 - L), black lowers it by
  // its alpha x L: they balance at L = 255 kLight / (kLight + kDark), which
  // must lie on the night, between its darkest and lightest tokens.
  const luma = (hex) => {
    const [r, g, b] = hex.match(/[0-9a-f]{2}/gi).map((part) => parseInt(part, 16));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const balance = (255 * kLight) / (kLight + kDark);
  const [darkest, lightest] = ["var(--night-900)", "var(--night-800)"].map((token) =>
    luma(color(styles, token)),
  );
  assert.ok(
    balance >= darkest && balance <= lightest,
    `balances at ${balance.toFixed(1)}, not on the night (${darkest.toFixed(1)}-${lightest.toFixed(1)})`,
  );
  // Faint: even at the noise's extremes a speck moves the night by a few codes.
  assert.ok((kLight / 2) * (255 - darkest) <= 6 && (kDark / 2) * lightest <= 7);
  // Gone with the canvas's own 480ms fade, at once for reduced motion, and
  // never in forced colours or increased contrast.
  const canvasFade = cssRule(styles, ".scene-canvas").match(/transition:\s*opacity (\d+ms) /)[1];
  assert.match(grain, new RegExp(`transition:\\s*opacity ${canvasFade} ease-out;`));
  // A sibling selector (the vignette follows the canvas), so browsers without
  // :has() fade it too.
  assert.match(
    cssRule(styles, ".scene-canvas.is-ready + .scene-vignette::before"),
    /opacity:\s*0;/,
  );
  assert.match(
    flatHtml(await readIndexHtml()),
    /<div id="home-scene" class="scene-canvas"><\/div>\s*<div class="scene-vignette"><\/div>/,
  );
  assert.doesNotMatch(styles, /:has\(/);
  assert.match(
    mediaBlock(styles, "(prefers-reduced-motion: reduce)"),
    /\.scene-vignette::before\s*\{\s*transition:\s*none;/,
  );
  assert.match(
    mediaBlock(styles, "(forced-colors: active), (prefers-contrast: more)"),
    /\.scene-vignette::before\s*\{\s*display:\s*none;/,
  );
});

test("the footer's controls and the 404's paper are declared once", async () => {
  const css = await readStyles();
  // Each has one top-level block of its own (shared selector lists aside);
  // media queries only adjust it.
  for (const selector of [
    ".site-footer__contact",
    ".site-footer__links",
    ".not-found .story-shell",
    ".not-found .story-shell h1",
    ".not-found .back-link",
  ]) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const blocks = css.match(new RegExp(`(?<!,\\s*)^${escaped}\\s*\\{`, "gm")) || [];
    assert.equal(blocks.length, 1, `${selector} has one top-level block`);
  }
});

test("external links that open in a new tab declare rel=noopener", async () => {
  const html = await readIndexHtml();
  const externalAnchors = html.match(/<a[^>]*target="_blank"[^>]*>/g) || [];
  for (const anchor of externalAnchors) {
    assert.match(anchor, /rel="[^"]*noopener[^"]*"/, `target="_blank" without noopener: ${anchor}`);
  }
});

test("without scripts the footer shows the email and LinkedIn in Contact's place", async () => {
  const html = flatHtml(await readIndexHtml());
  assert.match(
    html,
    /<h1>[\s\S]*?class="hero-word">Alex<\/span>[\s\S]*?class="hero-word">Nava<\/span>[\s\S]*?<\/h1>/,
  );
  const footer = html.match(/<footer class="site-footer">([\s\S]*?)<\/footer>/)[1];
  // Contact comes first, so its sibling rule reaches the links once it shows.
  assert.ok(footer.indexOf("site-footer__contact") < footer.indexOf("site-footer__links"));
  const links = footer.match(/<p class="site-footer__links" id="contact-links">([\s\S]*?)<\/p>/);
  assert.ok(links, "the links follow Contact");
  assert.doesNotMatch(links[0], / hidden/, "on show until contact.js collapses them");
  const anchors = [
    ...links[1].matchAll(/<a ([^>]*)><span class="site-footer__label">([^<]+)<\/span><\/a>/g),
  ];
  assert.deepEqual(
    anchors.map(([, , label]) => label),
    ["alexonava@gmail.com", "LinkedIn"],
  );
  assert.equal(anchors[0][1], 'class="site-footer__link" href="mailto:alexonava@gmail.com"');
  assert.equal(
    anchors[1][1],
    'class="site-footer__link" href="https://www.linkedin.com/in/alex-nava/" target="_blank" rel="noopener"',
  );
  assert.doesNotMatch(html, /data-scene-fallback|scene-entry|about-text|scene-fallback-content/);
});

test("homepage modification metadata matches its public Markdown equivalent", async () => {
  const html = await readIndexHtml();
  const markdown = await readFile(path.join(projectRoot, "public", "index.md"), "utf8");
  assert.equal(
    html.match(/"dateModified": "([^"]+)"/)[1],
    markdown.match(/dateModified: (\S+)/)[1],
  );
});

test("personal metadata stays consistent and scene discovery uses inert metadata", async () => {
  const html = await readIndexHtml();
  const description = "Alex Nava’s personal website";
  const sceneMeta = html.match(/<meta[^>]*name="babel:scene-script"[^>]*>/)?.[0] || "";

  assert.ok(
    html.split(description).length - 1 >= 3,
    "the shared public description must remain present in core and structured metadata",
  );

  assert.match(html, /<title>Alex Nava<\/title>/);
  assert.match(sceneMeta, /content="\/scripts\/scene\.js" data-scene-script/);
  assert.doesNotMatch(html, /<script[^>]*src="\/scripts\/scene\.js"/);
  assert.doesNotMatch(html, /<link[^>]*data-scene-script/);
  assert.doesNotMatch(html, /rel="prefetch"[^>]*scene\.js/);
});

test("the first-paint hero, action cursors and microcopy stay legible", async () => {
  const styles = await readStyles();
  assert.doesNotMatch(
    styles,
    /@keyframes hero-rise\s*\{\s*from\s*\{\s*opacity:\s*0/,
    "the hero must not begin hidden",
  );
  assert.match(
    styles,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.hero-minimal,[\s\S]*?animation:\s*none;/,
    "the unified hero reveal is static when reduced motion is requested",
  );
  assert.match(styles, /a,\s*button\s*\{\s*cursor:\s*pointer;/);
  assert.doesNotMatch(
    styles,
    /font-size:\s*(?:[0-9](?:\.[0-9]+)?|1[01](?:\.[0-9]+)?)px/,
    "user-facing microcopy must not fall below 12px",
  );
});

test("the hero backdrop fades to transparent before every edge of its box", async () => {
  // A closest-side ellipse reaches its last stop at the nearest edge on each
  // axis, so every edge, and every corner beyond it, is fully transparent:
  // no clear pane shows where the box clips the backdrop.
  const styles = await readStyles();
  const rule = styles.match(/\n\.hero-minimal::before\s*\{([^}]*)\}/)?.[1];
  assert.ok(rule, "the hero backdrop rule exists");
  const gradient = rule.match(/radial-gradient\(([\s\S]*?)\);/)?.[1];
  assert.ok(gradient, "the backdrop is a radial gradient");
  assert.match(
    gradient,
    /^\s*closest-side\s*,/,
    "sized to the box's nearest sides, so it ends inside the box",
  );
  const stops = [...gradient.matchAll(/rgba\(7, 10, 18, ([\d.]+)\) ([\d.]+)%/g)].map(
    ([, a, at]) => [+a, +at / 100],
  );
  assert.equal(stops.at(-1).join(), "0,1", "fully transparent at the ellipse's edge");
  const darkest = stops[0][0];
  for (const [alpha, t] of stops) {
    assert.ok(
      Math.abs(alpha - darkest * (1 - t * t) ** 2) < 0.006,
      `a smooth (1 - t²)² falloff at ${t}`,
    );
  }
  assert.doesNotMatch(rule, /mask-image/, "no mask edge of its own");
});

test("the bottom scrim fades to transparent before the top and sides of its box", async () => {
  // Centred on the box's bottom edge, an ellipse whose vertical radius is at
  // most the box's height, and whose horizontal radius clears both sides,
  // reaches its last, transparent stop inside the box: no straight edge shows
  // across the ground where the box ends.
  const styles = await readStyles();
  const gradient = cssRule(styles, ".bottom-bar::before").match(
    /radial-gradient\(([\s\S]*?)\);/,
  )?.[1];
  assert.ok(gradient, "the scrim is a radial gradient");
  const [rx, ry, cx, cy] = gradient
    .match(/^\s*ellipse ([\d.]+)% ([\d.]+)% at ([\d.]+)% ([\d.]+)%\s*,/)
    .slice(1)
    .map(Number);
  assert.equal(cy, 100, "centred on the bottom edge");
  assert.ok(ry <= cy, `the vertical radius (${ry}%) ends at or before the top edge`);
  assert.ok(rx <= Math.min(cx, 100 - cx), `the horizontal radius (${rx}%) clears both sides`);
  const stops = [...gradient.matchAll(/rgba\(7, 10, 18, ([\d.]+)\) ([\d.]+)%/g)].map(
    ([, alpha, at]) => [+alpha, +at],
  );
  assert.equal(stops[0].join(), "0.56,0", "the same darkness at the centre");
  assert.equal(stops.at(-1).join(), "0,100", "fully transparent at the ellipse's edge");
});

test("main clips the hero backdrop's horizontal overflow so phones keep a device-width layout", async () => {
  // The backdrop's box reaches about 196px past the hero's right edge. On a
  // 390px phone that widened the mobile layout viewport to ~495px and pushed
  // the footer below the screen; body's overflow-x: hidden does not stop it.
  const styles = await readStyles();
  const main = cssRule(styles, "main");
  assert.match(main, /overflow-x:\s*clip;/);
  assert.doesNotMatch(
    main,
    /overflow(-y)?:\s*(hidden|auto|scroll)/,
    "no scroll container or vertical clip",
  );
});

test("every contact address sits inside Cloudflare email_off markers", async () => {
  const html = flatHtml(await readIndexHtml());
  const wrapped =
    html.match(
      /<!--email_off--><a [^>]*href="mailto:[^"]+"[^>]*><span[^>]*>[^<]+<\/span><\/a><!--\/email_off-->/g,
    ) || [];
  assert.equal(wrapped.length, 1, "Contact's email keeps a literal link");
  const outside = html.replace(/<!--email_off-->[\s\S]*?<!--\/email_off-->/g, "");
  assert.doesNotMatch(outside, /mailto:|[\w.+-]+@[\w-]+\.[a-z]{2,}/i);
});

test("variable font faces supply real weights", async () => {
  const styles = await readStyles();
  const html = await readIndexHtml();
  const faces = styles.match(/@font-face\s*\{[^}]*\}/g) || [];
  assert.equal(faces.length, 2);
  assert.match(
    faces.find((face) => face.includes("cormorant-garamond-variable.woff2")),
    /font-weight:\s*300 700;/,
  );
  assert.match(
    faces.find((face) => face.includes("instrument-sans-variable.woff2")),
    /font-weight:\s*400 700;/,
  );
  const fontUrls = [
    ...[...styles.matchAll(/url\("(\/fonts\/[^"]+)"\)/g)].map((match) => match[1]),
    ...[...html.matchAll(/href="(\/fonts\/[^"]+)"/g)].map((match) => match[1]),
  ];
  assert.ok(fontUrls.length >= 4);
  for (const url of fontUrls) await access(path.join(projectRoot, url));
  assert.match(styles, /\.hero h1\s*\{[^}]*font-weight:\s*700;[^}]*font-synthesis-weight:\s*none;/);
});

test("forced colors and high-contrast modes keep system colors and the system cursor", async () => {
  const styles = await readStyles();
  assert.doesNotMatch(styles, /forced-color-adjust:\s*none/);
  assert.match(
    styles,
    /@media \(forced-colors: active\), \(prefers-contrast: more\)\s*\{\s*html,\s*body\s*\{\s*cursor:\s*auto;/,
  );
});

test("the email and LinkedIn read at Contact's tier, underlined, with or without scripts", async () => {
  const styles = await readStyles();
  assert.match(cssRule(styles, ".site-footer__links"), /color:\s*var\(--text-nav\);/);
  const nav = color(styles, "var(--text-nav)");
  assert.ok(contrast(nav, color(styles, "var(--night-900)")) >= 4.5, nav);
  const link = cssRule(styles, ".site-footer__links .site-footer__link");
  assert.match(link, /text-decoration:\s*underline;/);
  assert.match(link, /text-decoration-thickness:\s*1px;/);
  assert.match(link, /text-underline-offset:\s*4px;/);
  // Real hover brightens the underline, as the shared rule brightens the text.
  assert.match(
    mediaBlock(styles, "(hover: hover)"),
    /\.site-footer__links \.site-footer__link:hover\s*\{\s*text-decoration-color:/,
  );
});

test("the skip link clears the notch, is a 44px target and hides wholly above any inset", async () => {
  const styles = await readStyles();
  const skip = cssRule(styles, ".skip-link");
  const top = skip.match(/(?:^|[;\s])top:\s*([^;]+);/)[1];
  assert.equal(top, "max(14px, env(safe-area-inset-top))");
  assert.match(skip, /(?:^|[;\s])left:\s*max\(14px, env\(safe-area-inset-left\)\);/);
  assert.match(skip, /display:\s*inline-flex;/);
  assert.match(skip, /min-height:\s*44px;/);
  // Hidden, it moves up by its own height and its whole top offset.
  const hidden = skip.match(/transform:\s*translateY\(calc\(-100% - (.+) - (\d+)px\)\);/);
  assert.ok(hidden, "the hidden transform names its height and offset");
  assert.equal(hidden[1], top);
  assert.ok(Number(hidden[2]) > 0);
  assert.match(cssRule(styles, ".skip-link:focus"), /transform:\s*translateY\(0\);/);
});

test("reduced transparency keeps the hero's text scrim", async () => {
  const styles = await readStyles();
  const transparency = mediaBlock(styles, "(prefers-reduced-transparency: reduce)");
  assert.match(transparency, /\.bottom-bar::before\s*\{\s*display:\s*none;/);
  assert.doesNotMatch(transparency, /\.hero-minimal::before/, "the name keeps its scrim");
});

test("the 404's copy wraps without orphans", async () => {
  const styles = await readStyles();
  assert.match(cssRule(styles, ".not-found .story-text"), /text-wrap:\s*pretty;/);
});

test("phones do not gain a phantom scroll below the small-viewport hero", async () => {
  const styles = await readStyles();
  assert.match(styles, /\nbody\s*\{[^}]*min-height:\s*100vh;[^}]*min-height:\s*100svh;/);
  assert.doesNotMatch(styles, /100dvh/);
});

test("modern iPhones open full-bleed: night to every edge, no bounce, matching bars", async () => {
  const styles = await readStyles();
  const html = await readIndexHtml();
  const manifest = JSON.parse(
    await readFile(path.join(projectRoot, "public", "manifest.webmanifest"), "utf8"),
  );
  assert.match(html, /<meta name="viewport" content="[^"]*viewport-fit=cover[^"]*"/);
  assert.match(
    html,
    /<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"/,
  );
  // Safari's bars, the notch area and any overscroll show the page's own night.
  assert.match(
    styles,
    /\nhtml\s*\{[^}]*background:\s*var\(--night-900\);[^}]*overscroll-behavior:\s*none;/,
  );
  assert.match(styles, /\nbody\s*\{[^}]*background:[^;]+;[^}]*overscroll-behavior:\s*none;/);
  const night = color(styles, "var(--night-900)");
  for (const page of [html, await readNotFoundHtml()])
    assert.ok(page.includes(`<meta name="theme-color" content="${night}"`));
  assert.equal(manifest.theme_color, night);
  assert.equal(manifest.background_color, night);
  // The canvas's buffer follows the full-bleed container (scene-bootstrap.test.mjs).
});

test("fixed chrome clears left and right safe-area insets", async () => {
  const styles = await readStyles();
  assert.match(
    styles,
    /\.hero\s*\{[^}]*padding-left:\s*max\(0px, calc\(env\(safe-area-inset-left\) - 16px\)\);/,
  );
  const footer = cssRule(styles, ".site-footer");
  assert.match(footer, /right:\s*max\(20px, calc\(env\(safe-area-inset-right\) \+ 8px\)\);/);
  assert.match(footer, /bottom:\s*max\(30px, calc\(22px \+ env\(safe-area-inset-bottom\)\)\);/);
  assert.match(footer, /left:\s*max\(20px, calc\(env\(safe-area-inset-left\) \+ 8px\)\);/);
});

test("landmarks and heading levels describe the page structure", async () => {
  const html = await readIndexHtml();
  const styles = await readStyles();
  assert.match(
    html,
    /<footer class="site-footer">[\s\S]*?aria-controls="contact-links"[\s\S]*?<\/footer>/,
  );
  // The name is the page's one heading.
  assert.deepEqual(
    [...html.matchAll(/<(h[1-6])[\s>]/g)].map((match) => match[1]),
    ["h1"],
  );

  const notFound = await readNotFoundHtml();
  assert.match(notFound, /<h1>That page isn't here\.<\/h1>/);
  assert.doesNotMatch(notFound, /<h2>/);
  // The 404 shares the title card's night: no picture, only the vignette.
  assert.doesNotMatch(notFound, /<picture|<img/);
  assert.match(
    notFound,
    /<div class="scene-shell" aria-hidden="true"><div class="scene-vignette"><\/div><\/div>/,
  );
  const classTokens = [...notFound.matchAll(/class="([^"]+)"/g)].flatMap((match) =>
    match[1].split(/\s+/),
  );
  for (const token of classTokens) {
    assert.match(styles, new RegExp(`\\.${token}(?![\\w-])`), `404 class "${token}" has no styles`);
  }
});

test("social previews describe the share image", async () => {
  const html = flatHtml(await readIndexHtml());
  const alt = "Alex Nava — a timber lookout tower under a moonlit sky";
  assert.ok(html.includes(`<meta property="og:image:alt" content="${alt}" />`));
  assert.ok(html.includes(`<meta name="twitter:image:alt" content="${alt}" />`));
});

test("Contact and its two links are the footer's only controls, and the corner stays clear", async () => {
  const html = await readIndexHtml();
  const footer =
    flatHtml(html).match(/<footer class="site-footer">([\s\S]*?)<\/footer>/)?.[1] || "";
  assert.equal((footer.match(/<button/g) || []).length, 1);
  assert.match(footer, /^<button[^>]*class="site-footer__link site-footer__contact"/);
  const anchors = footer.match(/<a [^>]*>/g) || [];
  assert.equal(anchors.length, 2, "only the email and LinkedIn");
  for (const anchor of anchors) assert.match(anchor, /^<a class="site-footer__link" href=/);
  const safeArea = html.match(/<div class="bottom-bar"[\s\S]*?<\/div>/)[0];
  assert.match(safeArea, /aria-hidden="true"/);
  assert.doesNotMatch(safeArea, /<button|<a /);
});

test("footer controls keep 44px targets without blocking the scene", async () => {
  const styles = await readStyles();
  const footer = cssRule(styles, ".site-footer");
  assert.match(footer, /position:\s*fixed;/);
  assert.match(footer, /pointer-events:\s*none;/);
  assert.ok(Number(footer.match(/font-size:\s*(\d+)px;/)[1]) >= 12);
  assert.match(footer, /color:\s*var\(--text-accent\);/);
  assert.match(footer, /text-shadow:\s*var\(--text-meta-shadow\);/);

  const link = cssRule(styles, ".site-footer__link");
  assert.match(link, /display:\s*inline-flex;/);
  assert.match(link, /min-height:\s*44px;/);
  assert.match(link, /pointer-events:\s*auto;/);
  assert.match(link, /text-shadow:\s*inherit;/, "buttons otherwise drop the meta shadow");

  // Touch browsers keep :hover after a tap, so only the pressed state stays bright.
  const hover = mediaBlock(styles, "(hover: hover)");
  assert.match(hover, /\.site-footer__link:hover\s*\{\s*color:\s*var\(--text\);/);
  assert.match(hover, /\.site-footer__contact:hover\s*\{[^}]*text-decoration:\s*underline;/);
  const footerHover = /\.site-footer__(?:link|contact):hover/g;
  assert.equal((styles.match(footerHover) || []).length, (hover.match(footerHover) || []).length);

  const phone = mediaBlock(styles, "(max-width: 640px)");
  assert.match(
    phone,
    /\.site-footer\s*\{[^}]*right:\s*max\(\d+px, calc\(env\(safe-area-inset-right\) \+ 8px\)\);[^}]*left:\s*max\(\d+px, calc\(env\(safe-area-inset-left\) \+ 8px\)\);/,
  );

  // Every target sits one 44px row from the next: stacked on phones (18px
  // lines), side by side past the two 14px overhangs elsewhere.
  const line = Number(footer.match(/line-height:\s*(\d+)px;/)[1]);
  const stack = cssRule(phone, ".site-footer__links");
  assert.match(stack, /flex-direction:\s*column;/);
  assert.equal(line + Number(stack.match(/gap:\s*(\d+)px;/)[1]), 44, "between the links");
  const above = Number(
    cssRule(phone, ".site-footer__contact:not([hidden]) + .site-footer__links").match(
      /margin:\s*0 0 (\d+)px;/,
    )[1],
  );
  assert.equal(
    line + above + Number(footer.match(/row-gap:\s*(\d+)px;/)[1]),
    44,
    "and above Contact",
  );
  assert.ok(Number(cssRule(styles, ".site-footer__links").match(/gap:\s*(\d+)px;/)[1]) >= 28);
  // Disclosed on wider screens they follow Contact on its line, after a hairline.
  const beside = cssRule(styles, ".site-footer__contact:not([hidden]) + .site-footer__links");
  assert.match(beside, /grid-column:\s*2;/);
  assert.match(beside, /margin-left:\s*26px;/);
  assert.match(beside, /padding-left:\s*26px;/);
  assert.match(beside, /border-left:\s*1px solid rgba\(229, 228, 223, 0\.28\);/);

  const forced = styles.slice(styles.indexOf("/* Windows High Contrast"));
  assert.match(forced, /a,\s*\.site-footer__contact\s*\{\s*color:\s*LinkText;/);
});

test("Contact and its links keep a brighter label over edgeless text scrims of their own", async () => {
  const styles = await readStyles();
  // A tier above the meta text, 14px, and well clear of the night.
  const nav = styles.match(/--text-nav:\s*(#[0-9a-f]{6});/i)[1];
  const meta = styles.match(/--text-muted-accent:\s*(#[0-9a-f]{6});/i)[1];
  const night = styles.match(/--night-900:\s*(#[0-9a-f]{6});/i)[1];
  assert.ok(contrast(nav, night) > contrast(meta, night));
  assert.ok(contrast(nav, night) >= 12, `${contrast(nav, night)}`);
  assert.match(cssRule(styles, ".site-footer"), /font-size:\s*14px;\s*line-height:\s*18px;/);
  for (const selector of [".site-footer__contact", ".site-footer__links"]) {
    const body = cssRule(styles, selector);
    assert.match(body, /position:\s*relative;/, selector);
    assert.match(body, /isolation:\s*isolate;/, selector);
    assert.match(body, /color:\s*var\(--text-nav\);/, selector);
  }
  assert.match(
    cssRule(styles, '.site-footer__contact[aria-expanded="true"]'),
    /color:\s*var\(--text\);/,
  );
  // The 44px target hangs around the 18px line; the ring stays 2px clear of it.
  assert.match(cssRule(styles, ".site-footer__link"), /margin:\s*-13px -14px;/);
  assert.match(cssRule(styles, ".site-footer__link:focus-visible"), /outline-offset:\s*-11px;/);
  // The scrims sit behind the text inside their own stacking contexts, wider
  // and taller than the targets so their corners are covered, and reach
  // transparent before every edge: no plate, no straight edge.
  const [scrim] = cssRules(
    styles,
    (list) =>
      list
        .split(",")
        .map((part) => part.trim())
        .join() === ".site-footer__contact::before,.site-footer__links::before",
  );
  assert.ok(scrim, "one shared scrim rule");
  assert.match(scrim.body, /z-index:\s*-1;/);
  assert.match(scrim.body, /pointer-events:\s*none;/);
  assert.match(scrim.body, /radial-gradient\(\s*closest-side,\s*rgba\(7, 10, 18, 0\.5\) 0%/);
  assert.match(scrim.body, /rgba\(7, 10, 18, 0\) 100%\s*\);/);
  const contact = cssRule(styles, ".site-footer__contact::before");
  assert.ok(Number(contact.match(/width:\s*(\d+)px;/)[1]) >= 2 * 67);
  assert.ok(Number(contact.match(/height:\s*(\d+)px;/)[1]) >= 2 * 44);
  const links = cssRule(styles, ".site-footer__links::before");
  assert.ok(Number(links.match(/width:\s*calc\(100% \+ (\d+)px\);/)[1]) >= 2 * 28);
  assert.ok(Number(links.match(/height:\s*calc\(100% \+ (\d+)px\);/)[1]) >= 44);
  // Forced colours drop them with the other scrims; reduced transparency keeps
  // them with the hero's, as all keep text legible.
  assert.match(
    mediaBlock(styles, "(forced-colors: active)"),
    /\.site-footer__contact::before,\s*\.site-footer__links::before,[^{]*\{\s*display:\s*none;/,
  );
  assert.doesNotMatch(
    mediaBlock(styles, "(prefers-reduced-transparency: reduce)"),
    /site-footer__/,
  );
});

test("on tablets the intro keeps its own text scrim", async () => {
  const styles = await readStyles();
  // Tablets in portrait: the intro runs on one line past the hero scrim's reach,
  // over the close shots' subjects, so it sits over its own soft oval, as About
  // does: behind the line, in its own stacking context, transparent before
  // every edge with the hero's (1 - t²)² falloff.
  const tablet = mediaBlock(
    styles,
    "(min-width: 761px) and (max-width: 1024px) and (orientation: portrait)",
  );
  const intro = cssRule(tablet, ".hero-intro");
  assert.match(intro, /position:\s*relative;/);
  assert.match(intro, /isolation:\s*isolate;/);
  assert.match(intro, /max-width:\s*31ch;/);
  const scrim = cssRule(tablet, ".hero-intro::before");
  assert.match(scrim, /z-index:\s*-1;/);
  assert.match(scrim, /pointer-events:\s*none;/);
  assert.match(scrim, /width:\s*calc\(100% \+ 240px\);/);
  assert.match(scrim, /height:\s*calc\(100% \+ 96px\);/);
  assert.match(scrim, /radial-gradient\(\s*closest-side,/);
  const stops = [...scrim.matchAll(/rgba\(7, 10, 18, ([\d.]+)\) ([\d.]+)%/g)].map(([, a, at]) => [
    +a,
    +at / 100,
  ]);
  assert.equal(stops[0].join(), "0.6,0", "0.6 at its centre");
  assert.equal(stops.at(-1).join(), "0,1", "fully transparent at the ellipse's edge");
  for (const [alpha, t] of stops)
    assert.ok(
      Math.abs(alpha - 0.6 * (1 - t * t) ** 2) < 0.006,
      `a smooth (1 - t²)² falloff at ${t}`,
    );
  // Over the live scene only: it shows while hero.js marks the hero
  // is-over-scene (the scene host is ready) and fades with the canvas's own
  // 480ms fade, at once for reduced motion, so the title card's night never
  // shows it as a shape.
  const canvasFade = cssRule(styles, ".scene-canvas").match(/transition:\s*opacity (\d+ms) /)[1];
  assert.match(scrim, /opacity:\s*0;/);
  assert.match(scrim, new RegExp(`transition:\\s*opacity ${canvasFade} ease-out;`));
  assert.match(
    cssRule(tablet, ".hero-minimal.is-over-scene .hero-intro::before"),
    /^\s*opacity:\s*1;\s*$/,
  );
  assert.match(
    mediaBlock(styles, "(prefers-reduced-motion: reduce)"),
    /\.hero-intro::before\s*\{\s*transition:\s*none;/,
  );
  // The name paints above the intro, so the oval's upward reach never dims its
  // feet: the name keeps #f7f1ea.
  const name = cssRule(tablet, ".hero h1");
  assert.match(name, /position:\s*relative;/);
  assert.match(name, /z-index:\s*1;/);
  // Only there: phones, desktops and landscape keep the hero's scrim alone, and
  // forced colours drop it with the others.
  assert.equal(
    cssRules(styles, (selector) => selector.includes(".hero-intro::before")).filter(({ body }) =>
      /background:/.test(body),
    ).length,
    1,
  );
  assert.match(
    mediaBlock(styles, "(forced-colors: active)"),
    /\.hero-intro::before,[^{]*\{\s*display:\s*none;/,
  );
});

test("the copy stays minimal and matches its Markdown equivalent", async () => {
  const html = flatHtml(await readIndexHtml());
  const markdown = await readFile(path.join(projectRoot, "public", "index.md"), "utf8");
  const intro = "A little about me and what I’m working on.";
  assert.equal(html.split(intro).length - 1, 1, "only the hero keeps the intro");
  assert.ok(markdown.includes(`\n${intro}\n`));
  // Contact's two links, in the page and in Markdown.
  assert.ok(markdown.includes("[alexonava@gmail.com](mailto:alexonava@gmail.com)"));
  assert.ok(html.includes('href="https://www.linkedin.com/in/alex-nava/"'));
  assert.ok(markdown.includes("(https://www.linkedin.com/in/alex-nava/)"));
  for (const page of [html, markdown])
    assert.doesNotMatch(page, /\bExperience\b|personal corner|analytics|banking/i);
});

test("structured data describes the person without new facts and dates match Markdown", async () => {
  const html = await readIndexHtml();
  const markdown = await readFile(path.join(projectRoot, "public", "index.md"), "utf8");
  const data = JSON.parse(
    html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1],
  );
  assert.equal(data["@type"], "ProfilePage");
  assert.equal(data.description, "Alex Nava’s personal website");
  assert.equal(data.mainEntity["@type"], "Person");
  assert.deepEqual(Object.keys(data.mainEntity).sort(), ["@type", "name", "url"]);
  assert.equal(data.dateModified, markdown.match(/^dateModified: (\S+)$/m)[1]);
  assert.match(html, /<title>Alex Nava<\/title>/);
});

test("very wide screens anchor the hero and footer to a gutter beyond the 1600px reference", async () => {
  const styles = await readStyles();
  const wide = mediaBlock(styles, "(min-width: 1681px)");
  assert.ok(wide, "the gutter starts above the 1600px reference composition");
  assert.match(wide, /--gutter:/);
  assert.match(
    wide,
    /\.hero\s*\{[^}]*padding-inline:\s*max\(var\(--gutter\), env\(safe-area-inset-left\)\)\s*max\(var\(--gutter\), env\(safe-area-inset-right\)\);/,
  );
  assert.match(
    wide,
    /\.site-footer\s*\{[^}]*right:\s*max\(var\(--gutter\), calc\(env\(safe-area-inset-right\) \+ 8px\)\);[^}]*left:\s*max\(var\(--gutter\), calc\(env\(safe-area-inset-left\) \+ 8px\)\);/,
  );
  assert.equal(
    (styles.match(/var\(--gutter\)/g) || []).length,
    (wide.match(/var\(--gutter\)/g) || []).length,
    "the gutter is used only above 1680px",
  );
});

test("controls brighten on real hover and press without lifting; the 404's paper keeps one focus ink", async () => {
  const styles = await readStyles();
  // Touch browsers keep :hover after a tap, so tints follow real hover.
  const hover = mediaBlock(styles, "(hover: hover)");
  const reduced = mediaBlock(styles, "(prefers-reduced-motion: reduce)");
  // mediaBlock joins a query's blocks; each one leaves the sheet on its own.
  const outside = [hover, reduced]
    .flatMap((joined) => joined.split(/\n(?=@media )/))
    .reduce((sheet, block) => sheet.replace(block, ""), styles);
  for (const selector of [".site-footer__link:hover", ".not-found .back-link:hover"]) {
    assert.ok(cssRules(hover, (list) => list.includes(selector)).length > 0, selector);
    assert.ok(!outside.includes(selector), `${selector} only on real hover`);
  }
  for (const selector of [".not-found .back-link:active", ".site-footer__link:active"]) {
    const body = cssRule(styles, selector);
    assert.ok(body, `${selector} has a pressed state`);
    assert.doesNotMatch(body, /translate/, `${selector} does not lift`);
  }
  assert.match(cssRule(styles, ".not-found .back-link"), /transition:[^;]*\bcolor 180ms ease;/);
  for (const selector of [".site-footer__link", ".not-found .back-link"]) {
    assert.ok(
      cssRules(reduced, (list) => list.split(",").some((part) => part.trim() === selector)).some(
        ({ body }) => /transition:\s*none;/.test(body),
      ),
      `${selector} is immediate for reduced motion`,
    );
  }
  // Every focus ring on the paper takes one ink.
  const paperInks = cssRules(
    styles,
    (selector) => selector.includes("focus-visible") && selector.includes("not-found"),
  ).flatMap(({ body }) => [...body.matchAll(/#[0-9a-f]{6}/gi)].map(([ink]) => ink.toLowerCase()));
  assert.ok(paperInks.length >= 1);
  assert.deepEqual([...new Set(paperInks)], ["#59472f"]);
});

test("selected text takes a warm wash that keeps its ink legible on the night and on paper", async () => {
  const styles = await readStyles();
  // The wash composited over its ground, as #rrggbb.
  const over = (wash, ground) => {
    const [r, g, b, a] = wash
      .match(/rgba\(([^)]+)\)/)[1]
      .split(",")
      .map(Number);
    const base = ground.match(/[0-9a-f]{2}/gi).map((part) => parseInt(part, 16));
    return `#${[r, g, b]
      .map((channel, index) => Math.round(channel * a + base[index] * (1 - a)))
      .map((channel) => channel.toString(16).padStart(2, "0"))
      .join("")}`;
  };
  const night = cssRule(styles, "::selection");
  const paperRule = { body: cssRule(styles, ".not-found .story-shell ::selection") };
  assert.ok(paperRule.body, "the 404's paper has its own selection");
  const paper = cssRule(styles, ".not-found .story-shell::before").match(
    /(#[0-9a-f]{6}) url\("\/images\/paper-grain\.webp"\)/i,
  )[1];
  for (const [body, ground] of [
    [night, color(styles, "var(--night-900)")],
    [night, color(styles, "var(--night-800)")],
    [paperRule.body, paper],
  ]) {
    const wash = body.match(/background:\s*(rgba\([^)]+\));/)[1];
    const ink = body.match(/(?:^|[;\s])color:\s*(#[0-9a-f]{6});/i)[1];
    const selected = over(wash, ground);
    assert.ok(
      contrast(ink, selected) >= 4.5,
      `${ink} on ${selected} is ${contrast(ink, selected).toFixed(2)}:1`,
    );
    // The sun's amber, never the system blue.
    const [r, , b] = wash
      .match(/rgba\(([^)]+)\)/)[1]
      .split(",")
      .map(Number);
    assert.ok(r > b, `${wash} is warm`);
  }
});

test("the 404 shares the homepage's icons, font preloads and description", async () => {
  const home = flatHtml(await readIndexHtml());
  const notFound = flatHtml(await readNotFoundHtml());
  const links = (html, pattern) => (html.match(pattern) || []).sort();
  for (const pattern of [
    /<link rel="icon"[^>]*>/g,
    /<link rel="apple-touch-icon"[^>]*>/g,
    /<link rel="preload" href="\/fonts\/[^>]*>/g,
  ]) {
    const shared = links(home, pattern);
    assert.ok(shared.length > 0, String(pattern));
    assert.deepEqual(links(notFound, pattern), shared, String(pattern));
  }
  for (const preload of links(notFound, /<link rel="preload"[^>]*>/g)) {
    assert.match(preload, /as="font" type="font\/woff2" crossorigin/);
  }
  const description = (html) => html.match(/<meta name="description" content="([^"]+)"/)[1];
  assert.equal(description(notFound), description(home), "no new copy");
});

test("both pages declare their dark colour scheme", async () => {
  for (const page of [await readIndexHtml(), await readNotFoundHtml()]) {
    assert.match(flatHtml(page), /<meta name="color-scheme" content="dark" \/>/);
  }
});

test("the 404 is a centered cotton-paper sheet with dark ink", async () => {
  const notFound = await readNotFoundHtml();
  const styles = await readStyles();
  assert.match(notFound, /<body class="not-found">/);
  assert.match(cssRule(styles, ".not-found"), /display:\s*grid;\s*place-items:\s*center;/);
  const sheet = cssRule(styles, ".not-found .story-shell::before");
  const paper = sheet.match(/(#[0-9a-f]{6}) url\("\/images\/paper-grain\.webp"\)/i)[1];
  // A 115deg light over the ivory and its grain.
  assert.match(sheet, /background:\s*linear-gradient\(115deg,/);
  assert.match(
    cssRule(styles, ".not-found .story-shell::after"),
    /border-image:\s*url\("\/images\/paper-edge\.webp"\)/,
  );
  assert.match(cssRule(styles, ".not-found .back-link"), /min-height:\s*44px;/);
  // The pale line cursor vanishes on the paper, so the sheet takes the system one.
  assert.match(cssRule(styles, ".not-found .story-shell"), /cursor:\s*auto;/);
  const inks = [".not-found .story-shell", ".not-found .story-shell .eyebrow"].map(
    (selector) => cssRule(styles, selector).match(/(?:^|[;\s])color:\s*(#[0-9a-f]{6});/i)[1],
  );
  for (const ink of inks) assert.ok(contrast(ink, paper) >= 4.5, `${ink} on paper`);
  // Phones turned sideways take a shorter sheet and heading, so the paper fits
  // the screen's height (a 568x320 phone included) and stays centred.
  const sideways = flatCss(mediaBlock(styles, "(orientation: landscape) and (max-height: 500px)"));
  assert.match(sideways, /\.not-found \.section \{ padding-block: 12px; \}/);
  assert.match(sideways, /\.not-found \.story-shell \{ padding-block: 36px; \}/);
  assert.match(sideways, /\.not-found \.story-shell h1 \{ font-size: 34px; \}/);
});

const root = new URL("../", import.meta.url);

test("the 404's paper grain and edge stay within their 200 KiB budget", async () => {
  let total = 0;
  for (const name of ["paper-grain.webp", "paper-edge.webp"]) {
    const bytes = await readFile(new URL(`images/${name}`, root));
    assert.equal(bytes.toString("ascii", 0, 4), "RIFF", name);
    assert.equal(bytes.toString("ascii", 8, 12), "WEBP", name);
    total += bytes.length;
  }
  assert.ok(total <= 200 * 1024, `the paper uses ${total} bytes`);
});
