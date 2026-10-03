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
import { createHash } from "node:crypto";

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
  assert.ok(refs.length > 0);
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

test("About and estate buttons have accessible names and reference their dialogs", async () => {
  const html = await readIndexHtml();
  const buttonBlocks = html.match(/<button[^>]*class="bottom-btn[^"]*"[^>]*>/g) || [];
  assert.ok(buttonBlocks.length === 4, "About and its three destinations expose dialog buttons");
  for (const block of buttonBlocks) {
    assert.match(block, /aria-label="[^"]+"/, `bottom-bar button is missing aria-label: ${block}`);
    assert.match(
      block,
      /aria-expanded="(true|false)"/,
      "bottom-bar button tracks aria-expanded state",
    );
    assert.match(
      block,
      /aria-controls="[^"]+"/,
      "bottom-bar button references the panel it toggles",
    );
  }
});

test("modal overlays declare dialog semantics and start hidden", async () => {
  const html = await readIndexHtml();
  const overlayBlocks = html.match(/<div[^>]*class="panel-overlay"[\s\S]*?>/g) || [];
  assert.ok(overlayBlocks.length === 4, "About and its three categories each expose a dialog");
  for (const block of overlayBlocks) {
    assert.match(block, /role="dialog"/);
    assert.match(block, /aria-modal="true"/);
    assert.match(block, /aria-labelledby="/);
    assert.match(block, /\shidden(\s|>)/);
  }
});

test("all estate panels share the parchment frame", async () => {
  const html = await readIndexHtml();
  const sharedFrames =
    html.match(/class="[^"]*\bpanel-parchment\b[^"]*\bpanel-surface\b[^"]*"/g) || [];
  assert.equal(
    sharedFrames.length,
    3,
    "all panels use the shared panel-parchment + panel-surface frame",
  );
});

test("the scene is the landing content and the estate starts inside the hidden About dialog", async () => {
  const html = flatHtml(await readIndexHtml());
  assert.match(html, /<body class="scene-home">/);
  assert.match(html, /<main[^>]*id="main"[^>]*tabindex="-1"/);
  assert.match(html, /<div class="scene-shell" aria-hidden="true">/);
  assert.match(html, /id="home-scene" class="scene-canvas"/);
  const main = html.match(/<main[\s\S]*?<\/main>/)[0];
  assert.match(main, /id="home" class="hero section"/);
  assert.doesNotMatch(main, /class="estate-map"|class="estate-destinations"/);
  assert.match(html, /id="panel-about"[^>]* hidden>[\s\S]*?class="estate-destinations"/);
  assert.match(html, /class="panel-close" aria-label="Close About"/);
  assert.equal(
    (html.match(/class="panel-close panel-back" aria-label="Back to About"/g) || []).length,
    3,
  );
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

test("the canvas keeps one 480ms fade over the title card, and the loading line finishes within it", async () => {
  const styles = await readStyles();
  const canvas = cssRule(styles, ".scene-canvas");
  assert.match(canvas, /z-index:\s*1;/);
  assert.match(canvas, /opacity:\s*0;/);
  assert.match(canvas, /transition:\s*opacity 480ms ease-out;/);
  assert.match(cssRule(styles, ".scene-canvas.is-ready"), /opacity:\s*1;/);
  // terrain-build.js, mountain-build.js and light-shafts.js read the canvas's
  // one transitionDuration, so no other rule may add or change a transition.
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

test("estate layers preserve artwork proportions without masking labels", async () => {
  const css = flatCss(await readStyles());
  assert.match(css, /aspect-ratio: 3 \/ 2/);
  assert.match(css, /aspect-ratio: 2 \/ 3/);
  assert.match(css, /\.estate-home-map \.estate-map::before/);
  assert.match(
    css,
    /\.scene-entry\[hidden\], \[data-scene-fallback\]\[hidden\] \{ display: none; \}/,
  );
});

test("paper and estate surfaces are declared once", async () => {
  const css = await readStyles();
  // Each surface has one top-level block of its own (shared selector lists
  // aside); media queries only adjust it.
  for (const selector of [
    ".panel-parchment",
    ".panel-parchment__sheet",
    ".panel-parchment__sheet::before",
    ".panel-parchment__sheet::after",
    ".panel-parchment__content",
    ".panel-parchment__sheet .eyebrow",
    ".panel-parchment__sheet h2",
    ".panel-parchment__sheet .panel-body",
    ".panel-estate",
    ".estate-map",
    ".estate-title",
    ".estate-destination span",
    ".panel-estate .panel-close",
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

test("fallback About link and matching category copy remain usable before scene menu initialization", async () => {
  const html = flatHtml(await readIndexHtml());
  assert.match(
    html,
    /<h1>[\s\S]*?class="hero-word">Alex<\/span>[\s\S]*?class="hero-word">Nava<\/span>[\s\S]*?<\/h1>/,
  );
  const fallbackLink = html.match(/<a[^>]*href="#about-text"[^>]*>/)[0];
  assert.match(fallbackLink, /aria-label="About"/);
  assert.match(fallbackLink, /data-scene-fallback/);
  assert.doesNotMatch(fallbackLink, / hidden/);
  const fallbackContent = html.match(/<div class="scene-fallback-content"[^>]*>/)[0];
  assert.match(fallbackContent, /id="about-text"/);
  assert.match(fallbackContent, /data-scene-fallback/);
  assert.doesNotMatch(fallbackContent, / hidden/);
  const fallbackNav = html.match(/<nav class="estate-text-nav"[^>]*>([\s\S]*?)<\/nav>/)[1];
  assert.deepEqual(
    [...fallbackNav.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]),
    ["profile-text", "experience-text", "contact-text"],
  );
  assert.match(html, /<button[^>]*class="[^"]*scene-entry"[^>]* hidden>/);
  const text = (value) =>
    value
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  for (const category of ["profile", "experience", "contact"]) {
    const inline = html.match(
      new RegExp(`id="${category}-text"[^>]*>[\\s\\S]*?<p>([\\s\\S]*?)</p>`),
    )[1];
    const dialog = html.match(
      new RegExp(`id="panel-${category}"[\\s\\S]*?<p class="panel-body">([\\s\\S]*?)</p>`),
    )[1];
    assert.equal(text(inline), text(dialog), `${category} fallback wording drifted`);
  }
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

test("the first-paint hero, action cursors, microcopy and paper copy stay legible", async () => {
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
  // The one top-level sheet rule holds every paper's height at all widths but
  // on small landscape phones, whose screens are shorter than it: there the
  // vignette goes back beside the copy and the sheet keeps its content's height.
  assert.match(cssRule(styles, ".panel-parchment__sheet"), /min-height:\s*\d+px;/);
  const shortLandscape = mediaBlock(
    styles,
    "(orientation: landscape) and (max-height: 500px) and (max-width: 700px)",
  );
  assert.match(shortLandscape, /\.panel-parchment__sheet\s*\{[^}]*min-height:\s*0;/);
  assert.match(shortLandscape, /\.panel-vignette\s*\{[^}]*grid-column:\s*2;/);
  assert.doesNotMatch(
    styles.replace(/\n\.panel-parchment__sheet\s*\{[^}]*\}/, "").replace(shortLandscape, ""),
    /\.panel-parchment__sheet\s*\{[^}]*min-height/,
    "no other later or media rule overrides the paper height",
  );
  // The eyebrow and body ink that render read on the paper.
  const paper = cssRule(styles, ".panel-parchment__sheet::before").match(
    /background-color:\s*(#[0-9a-f]{6});/i,
  )[1];
  const eyebrowColors = [...styles.matchAll(/\.panel-parchment__sheet \.eyebrow\s*\{([^}]*)\}/g)]
    .map((match) => match[1].match(/(?:^|[;\s])color:\s*([^;]+);/)?.[1])
    .filter(Boolean);
  assert.equal(eyebrowColors.length, 1, "one eyebrow ink renders");
  const bodyInk = cssRule(styles, ".panel-parchment__sheet .panel-body").match(
    /(?:^|[;\s])color:\s*([^;]+);/,
  )[1];
  for (const ink of [eyebrowColors[0], bodyInk])
    assert.ok(contrast(color(styles, ink), paper) >= 4.5, `${ink} on the paper`);
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
    html.match(/<!--email_off--><a [^>]*href="mailto:[^"]+"[^>]*>[^<]+<\/a><!--\/email_off-->/g) ||
    [];
  assert.equal(
    wrapped.length,
    2,
    "the fallback Contact section and Contact dialog keep literal links",
  );
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
  for (const rule of [
    /\.hero h1\s*\{[^}]*font-weight:\s*700;[^}]*font-synthesis-weight:\s*none;/,
    /\.estate-title\s*\{[^}]*font: 600[^}]*font-synthesis-weight:\s*none;/,
    /\.estate-destination span\s*\{[^}]*font: 600[^}]*font-synthesis-weight:\s*none;/,
  ]) {
    assert.match(styles, rule);
  }
});

test("forced colors and high-contrast modes keep system colors and the system cursor", async () => {
  const styles = await readStyles();
  assert.doesNotMatch(styles, /forced-color-adjust:\s*none/);
  assert.match(styles, /\.panel-overlay\s*\{\s*cursor:\s*auto;\s*\}/);
  assert.match(
    styles,
    /@media \(forced-colors: active\), \(prefers-contrast: more\)\s*\{\s*html,\s*body\s*\{\s*cursor:\s*auto;/,
  );
});

test("no-JavaScript fallback links stay legible on the night", async () => {
  const styles = await readStyles();
  const ink = cssRule(styles, ".scene-fallback-content a").match(/(?:^|[;\s])color:\s*([^;]+);/)[1];
  assert.ok(contrast(color(styles, ink), color(styles, "var(--night-900)")) >= 4.5, ink);
});

test("the no-JavaScript About starts below the fold with display headings and 44px links", async () => {
  const styles = await readStyles();
  // The desktop hero ends 90px above the fold; the fallback clears it.
  const heroShortfall = Number(
    cssRule(styles, ".hero").match(/min-height:\s*calc\(100svh - (\d+)px\);/)[1],
  );
  const fallback = cssRule(styles, ".scene-fallback-content");
  const [marginTop] = fallback
    .match(/margin:\s*(\d+)px auto 0;/)
    .slice(1)
    .map(Number);
  assert.ok(marginTop >= heroShortfall, `${marginTop}px clears the hero's ${heroShortfall}px`);
  const headings = cssRule(styles, ".scene-fallback-content :is(h2, h3)");
  assert.match(headings, /font-family:\s*var\(--font-display\);/);
  assert.match(headings, /font-weight:\s*500;/);
  assert.ok(contrast(headings.match(/color:\s*(#[0-9a-f]{6});/i)[1], "#0c1016") >= 4.5);
  const link = cssRule(styles, ".scene-fallback-content a");
  assert.match(link, /display:\s*inline-flex;/);
  assert.match(link, /align-items:\s*center;/);
  assert.match(link, /min-height:\s*44px;/);
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

test("paper copy wraps without orphans and dialogs centre beside a classic scrollbar", async () => {
  const styles = await readStyles();
  assert.match(cssRule(styles, ".panel-parchment__sheet h2"), /text-wrap:\s*balance;/);
  for (const selector of [".panel-parchment__sheet .panel-body", ".not-found .story-text"])
    assert.match(cssRule(styles, selector), /text-wrap:\s*pretty;/, selector);
  const overlay = styles.match(/\n\.panel-overlay\s*\{[^}]*position:\s*fixed;[^}]*\}/)[0];
  assert.match(overlay, /scrollbar-gutter:\s*stable both-edges;/);
});

test("the 3:2 estate map fits short laptop and landscape-phone viewports", async () => {
  const styles = flatCss(await readStyles());
  assert.match(
    styles,
    /\.panel-overlay\s*\{[^}]*padding:\s*max\(24px, env\(safe-area-inset-top\)\)[^;]*max\(24px, env\(safe-area-inset-bottom\)\)/,
  );
  assert.match(
    styles,
    /\.panel-estate\s*\{[^}]*width:\s*min\(100%, 960px, calc\(\(100svh - 48px\) \* 1\.5\)\);/,
  );
  assert.match(
    styles,
    /@media \(orientation: landscape\) and \(max-height: 500px\)\s*\{\s*\.panel-estate\s*\{\s*width:\s*min\(\s*100%,\s*960px,\s*calc\(\(100svh - max\(8px, env\(safe-area-inset-top\)\) - max\(10px, env\(safe-area-inset-bottom\)\)\) \* 1\.5\)\s*\);/,
  );
  // The portrait map below 600px keeps its own width after the caps.
  const cap = styles.lastIndexOf("(100svh - max(8px");
  const portrait = styles.indexOf(".panel-estate { width: min(100%, 440px); }");
  assert.ok(cap > 0 && portrait > cap);
  // Only portrait phones take the 2:3 map: a 568x320 landscape phone keeps the
  // 3:2 map under its short-viewport cap, which the 2:3 map would overflow.
  const portraitMap = mediaBlock(styles, "(max-width: 600px) and (orientation: portrait)");
  assert.match(portraitMap, /\.panel-estate \{ width: min\(100%, 440px\); \}/);
  assert.match(portraitMap, /aspect-ratio: 2 \/ 3;/);
  assert.match(portraitMap, /estate-map-portrait\.webp/);
  assert.equal(mediaBlock(styles, "(max-width: 600px)").includes("aspect-ratio"), false);
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

test("fixed chrome and dialogs clear left and right safe-area insets", async () => {
  const styles = await readStyles();
  assert.match(
    styles,
    /\.hero\s*\{[^}]*padding-left:\s*max\(0px, calc\(env\(safe-area-inset-left\) - 16px\)\);/,
  );
  const footer = cssRule(styles, ".site-footer");
  assert.match(footer, /right:\s*max\(20px, calc\(env\(safe-area-inset-right\) \+ 8px\)\);/);
  assert.match(footer, /bottom:\s*max\(30px, calc\(22px \+ env\(safe-area-inset-bottom\)\)\);/);
  assert.match(footer, /left:\s*max\(20px, calc\(env\(safe-area-inset-left\) \+ 8px\)\);/);
  const sidePaddings = [...styles.matchAll(/\.panel-overlay\s*\{[^}]*padding:([^;]+);/g)]
    .map((match) => match[1].trim())
    .filter((padding) => padding.includes("safe-area-inset-left"));
  assert.deepEqual(
    sidePaddings.map((padding) => padding.match(/^max\((\d+px)/)[1]),
    ["24px", "8px"],
    "the base and short-landscape overlays pad for side insets",
  );
  for (const padding of sidePaddings) {
    assert.match(
      padding,
      /max\(\d+px, env\(safe-area-inset-right\)\)\s+max\(\d+px, env\(safe-area-inset-bottom\)\)\s+max\(\d+px, env\(safe-area-inset-left\)\)$/,
    );
  }
});

test("landmarks and heading levels describe the page structure", async () => {
  const html = await readIndexHtml();
  const styles = await readStyles();
  assert.match(html, /<footer class="site-footer">[\s\S]*?data-panel="about"[\s\S]*?<\/footer>/);
  const fallback = html.match(/<div class="scene-fallback-content"[\s\S]*?<\/main>/)[0];
  assert.deepEqual(
    [...fallback.matchAll(/<(h[1-6])>([^<]+)<\/h[1-6]>/g)].map(
      (match) => `${match[1]} ${match[2]}`,
    ),
    ["h2 About", "h3 Profile", "h3 Experience", "h3 Contact"],
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

test("About is the only footer control and keeps the corner clear", async () => {
  const html = await readIndexHtml();
  const footer = html.match(/<footer class="site-footer">([\s\S]*?)<\/footer>/)?.[1] || "";
  assert.match(footer, /href="#about-text"[^>]*data-scene-fallback/);
  assert.match(footer, /data-panel="about"[^>]*aria-controls="panel-about"/);
  assert.equal((footer.match(/>About<\/span>/g) || []).length, 2);
  assert.doesNotMatch(footer, /mailto:|Email/);
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
  assert.match(hover, /\.site-footer__about:hover\s*\{[^}]*text-decoration:\s*underline;/);
  const footerHover = /\.site-footer__(?:link|about):hover/g;
  assert.equal((styles.match(footerHover) || []).length, (hover.match(footerHover) || []).length);

  const phone = mediaBlock(styles, "(max-width: 640px)");
  assert.match(
    phone,
    /\.site-footer\s*\{[^}]*right:\s*max\(\d+px, calc\(env\(safe-area-inset-right\) \+ 8px\)\);[^}]*left:\s*max\(\d+px, calc\(env\(safe-area-inset-left\) \+ 8px\)\);/,
  );

  const forced = styles.slice(styles.indexOf("/* Windows High Contrast"));
  assert.match(forced, /a,\s*\.site-footer__about\s*\{\s*color:\s*LinkText;/);
});

test("category copy stays minimal and matches its Markdown equivalent", async () => {
  const html = flatHtml(await readIndexHtml());
  const markdown = await readFile(path.join(projectRoot, "public", "index.md"), "utf8");
  const profile = "This is my personal corner of the web.";
  const experience = "Analytics, reporting, remediation, and controls, across banking and health.";
  for (const [id, sentence] of [
    ["profile", profile],
    ["experience", experience],
  ]) {
    const escaped = sentence.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(html, new RegExp(`id="${id}-text"><h3>[^<]+</h3><p>${escaped}</p></section>`));
    assert.ok(html.includes(`<p class="panel-body">${sentence}</p>`), `${id} dialog copy`);
    assert.ok(markdown.includes(`\n${sentence}\n`), `${id} Markdown copy`);
  }
  assert.equal(
    html.split("A little about me and what I’m working on.").length - 1,
    1,
    "only the hero keeps the intro",
  );
  assert.match(html, /id="panel-experience-title">My background\.<\/h2>/);
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
  assert.equal(
    data.mainEntity.description,
    "Background in analytics, reporting, remediation, and controls across banking and health.",
  );
  assert.deepEqual(Object.keys(data.mainEntity).sort(), ["@type", "description", "name", "url"]);
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

test("one shared backdrop dims the scene steadily across map and paper swaps", async () => {
  const styles = await readStyles();
  const backdrop = cssRule(styles, "body::after");
  assert.match(backdrop, /position:\s*fixed;/);
  assert.match(backdrop, /inset:\s*0;/);
  assert.match(backdrop, /z-index:\s*19;/, "just below the z-index 20 overlays");
  assert.match(backdrop, /pointer-events:\s*none;/);
  assert.match(backdrop, /opacity:\s*0;/);
  // The dim fades in over 440 ms, inside index.js's 450 ms dialog hold.
  assert.match(
    cssRule(styles, "body[data-panel-open]::after"),
    /opacity:\s*1;\s*transition-duration:\s*440ms;/,
  );
  const overlay = styles.match(/\n\.panel-overlay\s*\{[^}]*position:\s*fixed;[^}]*\}/)[0];
  assert.match(overlay, /z-index:\s*20;/);
  assert.match(overlay, /inset:\s*0;/, "the overlay still fills the viewport for backdrop clicks");
  assert.match(overlay, /background:\s*transparent;/);
  const dim = backdrop.match(/rgba\([^)]*\)/)[0];
  assert.equal(styles.split(dim).length - 1, 1, "the dim is painted once");
  assert.match(
    styles,
    /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?body::after\s*\{\s*transition:\s*none;/,
  );
});

test("dialog polish keeps readable ink, touch cues and paper-safe controls", async () => {
  const styles = await readStyles();
  const paper = cssRule(styles, ".panel-parchment__sheet::before").match(
    /background-color:\s*(#[0-9a-f]{6});/i,
  )[1];
  const email = cssRule(styles, "#panel-contact .panel-body a");
  assert.match(email, /display:\s*inline-block;/);
  assert.ok(contrast(email.match(/(?:^|[;\s])color:\s*(#[0-9a-f]{6});/i)[1], paper) >= 4.5);

  const touch = mediaBlock(styles, "(hover: none), (pointer: coarse)");
  assert.match(touch, /\.estate-destination span\s*\{[^}]*text-decoration:\s*underline;/);
  assert.match(touch, /\.panel-estate \.estate-destination:active\s*\{[^}]*background:/);
  // The touch underline shares the base label rule's specificity, so it must
  // follow that rule in source order to keep winning.
  const baseLabel = styles.search(/^\.estate-destination span\s*\{/m);
  const touchLabel = styles.search(
    /@media \(hover: none\), \(pointer: coarse\)\s*\{[^@]*?\.estate-destination span\s*\{[^}]*text-decoration:\s*underline;/,
  );
  assert.ok(
    baseLabel >= 0 && touchLabel > baseLabel,
    "the touch underline follows the base label rule",
  );
  const unscoped = styles.replace(/@media \(hover: hover\)\s*\{(?:[^{}]*\{[^}]*\})*\s*\}/g, "");
  assert.equal(
    unscoped.match(/\.estate-destination:hover span/),
    null,
    "the map underline follows real hover only",
  );
  // So does the destination's tint, so a tap leaves none behind.
  assert.doesNotMatch(unscoped, /\.estate-destination:hover[^{]*\{[^}]*background/);
  assert.match(
    styles,
    /@media \(hover: hover\)\s*\{\s*\.estate-destination:hover\s*\{\s*background:/,
  );

  // Back clears the paper's 24px deckled edge, so it sits wholly on the paper.
  const back = Number(
    cssRule(styles, ".panel-parchment .panel-back").match(/margin:\s*(\d+)px;/)[1],
  );
  assert.ok(back > 24, `Back sits ${back}px in`);
  assert.doesNotMatch(
    styles,
    /\.panel-parchment \.panel-close\s*\{/,
    "no second margin rule for Back",
  );
});

test("the Contact address is a 44px target whose padding never moves its line", async () => {
  const styles = await readStyles();
  const email = cssRule(styles, "#panel-contact .panel-body a");
  const [, smallest, lineHeight] = email.match(
    /font:\s*500 clamp\((\d+)px,[^)]*\)\s*\/\s*([\d.]+)\s/,
  );
  const padding = Number(email.match(/padding-block:\s*(\d+)px;/)[1]);
  const [top, bottom] = email
    .match(/margin-block:\s*([^;]+);/)[1]
    .split(/\s+/)
    .map((value) => Number.parseFloat(value));
  assert.ok(
    Number(smallest) * Number(lineHeight) + 2 * padding >= 44,
    `${smallest}px x ${lineHeight} + 2 x ${padding}px reaches 44px`,
  );
  // The bottom margin takes the bottom padding back, so the line box keeps
  // its depth below the baseline, and the address keeps its 8px gap above.
  assert.equal(bottom, -padding);
  assert.equal(top + padding, 8);
  assert.doesNotMatch(email, /(?:^|[;\s])margin(?:-top|-bottom)?:/, "one margin declaration");
  // Real hover deepens the underline; a press firms it on every device.
  assert.match(
    mediaBlock(styles, "(hover: hover)"),
    /#panel-contact \.panel-body a:hover\s*\{\s*text-decoration-color:\s*currentColor;/,
  );
  assert.match(
    cssRule(styles, "#panel-contact .panel-body a:active"),
    /text-decoration-color:\s*currentColor;/,
  );
});

test("controls tint on real hover, press deeper without lifting and share one paper focus ink", async () => {
  const styles = await readStyles();
  // Touch browsers keep :hover after a tap, so tints and lifts follow real
  // hover; reduced motion may only cancel the lift.
  const hover = mediaBlock(styles, "(hover: hover)");
  const reduced = mediaBlock(styles, "(prefers-reduced-motion: reduce)");
  // mediaBlock joins a query's blocks; each one leaves the sheet on its own.
  const outside = [hover, reduced]
    .flatMap((joined) => joined.split(/\n(?=@media )/))
    .reduce((sheet, block) => sheet.replace(block, ""), styles);
  for (const selector of [".panel-close:hover", ".not-found .back-link:hover"]) {
    assert.ok(cssRules(hover, (list) => list.includes(selector)).length > 0, selector);
    assert.ok(!outside.includes(selector), `${selector} only on real hover`);
  }
  assert.match(
    cssRule(styles, ".panel-close:focus-visible"),
    /background:[^;]+;[^}]*transform:\s*translateY\(-1px\);/,
    "keyboard focus keeps the tint and lift",
  );
  for (const selector of [
    ".panel-close:active",
    ".not-found .back-link:active",
    ".site-footer__link:active",
  ]) {
    const body = cssRule(styles, selector);
    assert.ok(body, `${selector} has a pressed state`);
    assert.doesNotMatch(body, /translate/, `${selector} does not lift`);
  }
  assert.match(cssRule(styles, ".panel-close:active"), /transform:\s*none;/);
  assert.match(cssRule(styles, ".panel-estate .panel-close:active"), /background:/);
  assert.match(cssRule(styles, ".not-found .back-link"), /transition:[^;]*\bcolor 180ms ease;/);
  // Only the estate destinations' background ever changes on .bottom-btn.
  assert.match(cssRule(styles, ".bottom-btn"), /transition:\s*background-color 180ms ease;/);
  for (const selector of [
    ".bottom-btn",
    ".panel-close",
    ".site-footer__link",
    ".not-found .back-link",
    "#panel-contact .panel-body a",
  ]) {
    assert.ok(
      cssRules(reduced, (list) => list.split(",").some((part) => part.trim() === selector)).some(
        ({ body }) => /transition:\s*none;/.test(body),
      ),
      `${selector} is immediate for reduced motion`,
    );
  }
  // Every focus ring on paper or the estate map takes one ink.
  const paperInks = cssRules(
    styles,
    (selector) =>
      selector.includes("focus-visible") &&
      /panel-parchment|panel-estate|estate-destination|not-found/.test(selector),
  ).flatMap(({ body }) => [...body.matchAll(/#[0-9a-f]{6}/gi)].map(([ink]) => ink.toLowerCase()));
  assert.ok(paperInks.length >= 4);
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
  const [paperRule] = cssRules(styles, (selector) =>
    selector.split(",").some((part) => part.trim() === ".panel-parchment ::selection"),
  );
  assert.ok(paperRule, "paper has its own selection");
  for (const scope of [".panel-estate ::selection", ".not-found .story-shell ::selection"])
    assert.ok(paperRule.selector.includes(scope), scope);
  const paper = cssRule(styles, ".panel-parchment__sheet::before").match(
    /background-color:\s*(#[0-9a-f]{6});/i,
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
  // The dialogs' paper: their light layer first, over the same ivory.
  const dialogLight = cssRule(styles, ".panel-parchment__sheet::before").match(
    /linear-gradient\([^;]*?\)\)/,
  )[0];
  assert.match(sheet, /background:\s*linear-gradient\(/);
  assert.ok(sheet.includes(dialogLight), "the 404 shares the dialogs' 115deg light");
  assert.equal(
    paper,
    cssRule(styles, ".panel-parchment__sheet::before").match(
      /background-color:\s*(#[0-9a-f]{6});/i,
    )[1],
  );
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
});

const root = new URL("../", import.meta.url);

test("the scene opens About through the text button and keeps Contact inside the estate", async () => {
  const html = flatHtml(await readFile(new URL("index.html", root), "utf8"));
  const entry = html.match(/<button[^>]*class="[^"]*scene-entry"[\s\S]*?<\/button>/)[0];
  assert.match(entry, /data-panel="about"/);
  assert.match(entry, /aria-controls="panel-about"/);
  assert.match(entry, /aria-label="About"/);
  assert.match(entry, / hidden>/);
  assert.match(entry, /<span class="about-link__label">About<\/span>/);
  assert.doesNotMatch(entry, /<img|<canvas/);
  assert.match(html, /href="#about-text"[^>]*data-scene-fallback>[\s\S]*?about-link__label/);
  const primary = html.match(/<footer class="site-footer"[\s\S]*?<\/footer>/)[0];
  assert.doesNotMatch(primary, /data-panel="contact"/);
  for (const name of ["profile", "experience", "contact"]) {
    assert.ok(html.includes(`aria-controls="panel-${name}"`));
  }
});

test("estate destinations are labeled HTML buttons in keyboard order without floating icons", async () => {
  const html = await readFile(new URL("index.html", root), "utf8");
  const map = html.match(/<nav class="estate-destinations"[\s\S]*?<\/nav>/)[0];
  const destinations = [...map.matchAll(/data-panel="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(destinations, ["profile", "experience", "contact"]);
  assert.doesNotMatch(map, /<img|<canvas/);
  for (const name of destinations) {
    assert.ok(map.includes(`aria-controls="panel-${name}"`));
    assert.ok(map.includes(`<span>${name[0].toUpperCase() + name.slice(1)}</span>`));
  }
});

const categories = ["profile", "experience", "contact"];

test("three distinct transparent paper vignettes share the 200 KiB section-paper budget", async () => {
  let total = 0;
  for (const name of ["paper-grain.webp", "paper-edge.webp"]) {
    total += (await readFile(new URL(`images/${name}`, root))).length;
  }
  const hashes = new Set();
  for (const category of categories) {
    const bytes = await readFile(new URL(`images/paper-vignette-${category}.webp`, root));
    total += bytes.length;
    assert.equal(bytes.toString("ascii", 0, 4), "RIFF");
    assert.equal(bytes.toString("ascii", 8, 12), "WEBP");
    assert.equal(bytes.toString("ascii", 12, 16), "VP8X");
    assert.ok(bytes[20] & 0x10, `${category} must preserve transparency`);
    assert.equal(bytes.readUIntLE(24, 3) + 1, 420);
    assert.equal(bytes.readUIntLE(27, 3) + 1, 420);
    hashes.add(createHash("sha256").update(bytes).digest("hex"));
  }
  assert.equal(hashes.size, 3, "each category must have its own illustration");
  assert.ok(total <= 200 * 1024, `shared paper and vignettes use ${total} bytes`);
});

test("each child dialog owns one decorative noninteractive vignette without changing menu destinations", async () => {
  const html = await readFile(new URL("index.html", root), "utf8");
  for (const category of categories) {
    const start = html.indexOf(`id="panel-${category}"`);
    const next = html.indexOf('class="panel-overlay"', start + 1);
    const panel = html.slice(start, next === -1 ? undefined : next);
    const decoration = panel.match(/<div class="panel-vignette [^"]+"[^>]*>/g) || [];
    assert.equal(decoration.length, 1, `${category} requires one decorative illustration`);
    assert.ok(decoration[0].includes(`panel-vignette--${category}`));
    assert.ok(decoration[0].includes('aria-hidden="true"'));
    assert.doesNotMatch(decoration[0], /tabindex|role=|data-panel|aria-label/);
    assert.ok(panel.includes('aria-label="Back to About"'));
    assert.ok(panel.includes(`id="panel-${category}-title"`));
  }
  const menu = html.match(/<nav class="estate-destinations"[\s\S]*?<\/nav>/)[0];
  assert.deepEqual(
    [...menu.matchAll(/data-panel="([^"]+)"/g)].map((match) => match[1]),
    categories,
  );
  assert.doesNotMatch(menu, /panel-vignette|<img|<canvas/);
});
