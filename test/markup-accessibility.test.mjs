import assert from "node:assert/strict";
import test from "node:test";
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

test("all estate panels share the parchment frame without decorative monograms or seals", async () => {
  const html = await readIndexHtml();
  const sharedFrames =
    html.match(/class="[^"]*\bpanel-parchment\b[^"]*\bpanel-surface\b[^"]*"/g) || [];

  assert.equal(
    sharedFrames.length,
    3,
    "all panels use the shared panel-parchment + panel-surface frame",
  );
  assert.doesNotMatch(html, /class="panel-parchment__watermark"/);
  assert.doesNotMatch(html, /class="panel-parchment__seal"/);
  assert.doesNotMatch(html, /panel-object-stage/, "the 3D panel-object stage is removed");
  assert.doesNotMatch(html, /data-panel-object/);
  assert.doesNotMatch(html, /panel-parchment--notebook/, "metaphor-named modifiers are gone");
  assert.doesNotMatch(html, /panel-parchment--letter/);
  assert.doesNotMatch(html, /panel-art-about/);
  assert.doesNotMatch(html, /panel-art-contact/);
  assert.doesNotMatch(html, /panel-parchment__rail/);
  assert.doesNotMatch(html, /panel-notebook/);
  assert.doesNotMatch(html, /panel-letter/);
  assert.doesNotMatch(html, /panel-letter__quill/);
});

test("the scene is the landing content and the estate starts inside the hidden About dialog", async () => {
  const html = await readIndexHtml();
  assert.match(html, /<body class="scene-home">/);
  assert.match(html, /<main[^>]*id="main"[^>]*tabindex="-1"/);
  assert.match(html, /<div class="scene-shell" aria-hidden="true">/);
  assert.match(html, /id="home-scene" class="scene-canvas"/);
  const main = html.match(/<main[\s\S]*?<\/main>/)[0];
  assert.match(main, /id="home" class="hero section"/);
  assert.doesNotMatch(main, /class="estate-map"|class="estate-destinations"/);
  assert.match(html, /id="panel-about"[^>]* hidden>[\s\S]*?class="estate-destinations"/);
  assert.match(html, /class="panel-close" aria-label="Close About"/);
  assert.equal((html.match(/class="panel-close panel-back" aria-label="Back to About"/g) || []).length, 3);
});

test("responsive scene posters paint before the deferred renderer and debug UI stays out of published markup", async () => {
  const html = await readIndexHtml();
  assert.match(html, /<picture class="scene-poster" aria-hidden="true">/);
  assert.match(html, /media="\(orientation: portrait\)"[\s\S]*?srcset="\/images\/scene-poster-portrait\.webp"/);
  assert.match(html, /src="\/images\/scene-poster-landscape\.webp"[\s\S]*?alt=""[\s\S]*?loading="eager"[\s\S]*?fetchpriority="high"/);
  assert.doesNotMatch(html, /dev-mode-hud/, "developer mode creates its HUD on demand");
  assert.doesNotMatch(html, /loading-ritual/);
});

test("the poster stays opaque until the canvas fade completes", async () => {
  const styles = await readStyles();
  const canvasFade = styles.match(/\.scene-canvas\s*\{[^}]*transition:\s*opacity (\d+)ms/)?.[1];
  assert.ok(canvasFade, "the canvas fades in");
  assert.match(
    styles,
    /\n\.scene-poster\s*\{[^}]*z-index:\s*0;[^}]*opacity:\s*1;[^}]*transition:\s*none;/,
    "the poster under the canvas returns at once when the canvas fades out",
  );
  assert.match(
    styles,
    new RegExp(
      `\\.scene-canvas\\.is-ready \\+ \\.scene-poster\\s*\\{[^}]*opacity:\\s*0;[^}]*transition:\\s*opacity 0s linear ${canvasFade}ms;`,
    ),
  );
  assert.match(
    styles,
    /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.scene-canvas,\s*\.scene-poster,\s*\.scene-canvas\.is-ready \+ \.scene-poster\s*\{\s*transition:\s*none;/,
    "reduced motion swaps the poster and canvas immediately",
  );
});

test("estate layers preserve artwork proportions without masking labels", async () => {
  const css = await readStyles();
  assert.match(css, /aspect-ratio: 3 \/ 2/);
  assert.match(css, /aspect-ratio: 2 \/ 3/);
  assert.match(css, /\.estate-home-map \.estate-map::before/);
  assert.match(css, /\.scene-entry\[hidden\], \[data-scene-fallback\]\[hidden\] \{ display: none; \}/);
});

test("paper and estate surfaces are declared once, without retired layers", async () => {
  const css = await readStyles();
  // Retired treatments: the loading ritual, the direct-estate homepage, the
  // hero kicker, and the glass panel card that panels.js keeps only as a
  // selector fallback. The .scene-home body class no longer scopes any rule,
  // so a later .scene-home layer cannot quietly override the rules below.
  for (const retired of [
    /loading-ritual/,
    /\.hero-kicker/,
    /\.scene-home\b/,
    /\.estate-home(?!-map)\b/,
    /\.estate-main\b/,
    /\.estate-identity\b/,
    /data-estate-fallback/,
    /\.panel-card\b/,
    /\.panel-footnote\b/,
  ]) {
    assert.doesNotMatch(css, retired);
  }
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
  const html = await readIndexHtml();
  assert.match(html, /<h1>[\s\S]*?class="hero-word">Alex<\/span>[\s\S]*?class="hero-word">Nava<\/span>[\s\S]*?<\/h1>/);
  assert.doesNotMatch(html, /<noscript>|data-scramble|Wells Fargo|CVS Health/);
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
  const text = (value) => value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  for (const category of ["profile", "experience", "contact"]) {
    const inline = html.match(new RegExp(`id="${category}-text"[^>]*>[\\s\\S]*?<p>([\\s\\S]*?)</p>`))[1];
    const dialog = html.match(new RegExp(`id="panel-${category}"[\\s\\S]*?<p class="panel-body">([\\s\\S]*?)</p>`))[1];
    assert.equal(text(inline), text(dialog), `${category} fallback wording drifted`);
  }
});

test("homepage modification metadata matches its public Markdown equivalent", async () => {
  const html = await readIndexHtml();
  const markdown = await readFile(path.join(projectRoot, "index.md"), "utf8");
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

test("first-paint hero, action cursors, microcopy, and short-landscape labels stay legible", async () => {
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
  assert.match(
    styles,
    /@media \(orientation: landscape\) and \(max-height: 500px\)[\s\S]*?\.btn-icon-label\s*\{[^}]*opacity:\s*1;/,
  );
  assert.match(styles, /\.btn-icon-label\s*\{[^}]*opacity:\s*1;/);
  // The one top-level sheet rule holds every paper's height at all widths.
  assert.match(cssRule(styles, ".panel-parchment__sheet"), /min-height:\s*370px;/);
  assert.doesNotMatch(
    styles.replace(/\n\.panel-parchment__sheet\s*\{[^}]*\}/, ""),
    /\.panel-parchment__sheet\s*\{[^}]*min-height/,
    "no later or media rule overrides the paper height",
  );
  assert.match(
    styles,
    /@media \(max-width: 760px\)[\s\S]*?\.hero\s*\{[^}]*align-items:\s*flex-start;/,
  );
  assert.match(
    styles,
    /\.panel-parchment__sheet \.eyebrow\s*\{[^}]*color:\s*#60492e;[^}]*opacity:\s*1;/,
  );
  // Later same-selector rules must not override the restrained brown ink.
  const eyebrowColors = [...styles.matchAll(/\.panel-parchment__sheet \.eyebrow\s*\{([^}]*)\}/g)]
    .map((match) => match[1].match(/(?:^|[;\s])color:\s*([^;]+);/)?.[1])
    .filter(Boolean);
  assert.deepEqual(eyebrowColors, ["#60492e"], "the paper eyebrow ink that renders is #60492e");
  const paperBody = cssRule(styles, ".panel-parchment__sheet .panel-body");
  assert.match(paperBody, /color:\s*#211c16;/);
  assert.match(paperBody, /font:\s*400 17px\/1\.65 var\(--font-body\);/);
  assert.match(
    mediaBlock(styles, "(max-width: 600px)"),
    /\.panel-parchment__sheet \.panel-body\s*\{[^}]*font-size:\s*16px;/,
  );
});

test("the hero backdrop fades to transparent before every edge of its box", async () => {
  // The owner saw a clear pane beside the name (2026-09-28): the old farthest-corner
  // ellipse was still ~40% dark where its box clipped it on the left. A closest-side
  // ellipse reaches its last stop at the nearest edge on each axis, so every edge
  // (and every corner beyond it) is fully transparent.
  const styles = await readStyles();
  const rule = styles.match(/\n\.hero-minimal::before\s*\{([^}]*)\}/)?.[1];
  assert.ok(rule, "the hero backdrop rule exists");
  const gradient = rule.match(/radial-gradient\(([\s\S]*?)\);/)?.[1];
  assert.ok(gradient, "the backdrop is a radial gradient");
  assert.match(gradient, /^\s*closest-side\s*,/, "sized to the box's nearest sides, so it ends inside the box");
  const stops = [...gradient.matchAll(/rgba\(7, 10, 18, ([\d.]+)\) ([\d.]+)%/g)].map(([, a, at]) => [+a, +at / 100]);
  assert.equal(stops.at(-1).join(), "0,1", "fully transparent at the ellipse's edge");
  assert.equal(stops[0][0], 0.58, "as dark as before right behind the name");
  for (const [alpha, t] of stops) {
    assert.ok(Math.abs(alpha - 0.58 * (1 - t * t) ** 2) < 0.006, `a smooth (1 - t²)² falloff at ${t}`);
  }
  assert.doesNotMatch(rule, /mask-image/, "no mask edge of its own");
});

test("every contact address sits inside Cloudflare email_off markers", async () => {
  const html = await readIndexHtml();
  const wrapped =
    html.match(/<!--email_off--><a [^>]*href="mailto:[^"]+"[^>]*>[^<]+<\/a><!--\/email_off-->/g) || [];
  assert.equal(
    wrapped.length,
    2,
    "the fallback Contact section and Contact dialog keep literal links",
  );
  const outside = html.replace(/<!--email_off-->[\s\S]*?<!--\/email_off-->/g, "");
  assert.doesNotMatch(outside, /mailto:|[\w.+-]+@[\w-]+\.[a-z]{2,}/i);
});

test("variable font faces supply real weights without the retired static face", async () => {
  const styles = await readStyles();
  const html = await readIndexHtml();
  const faces = styles.match(/@font-face\s*\{[^}]*\}/g) || [];
  assert.equal(faces.length, 2);
  assert.match(faces.find((face) => face.includes("cormorant-garamond-500.woff2")), /font-weight:\s*300 700;/);
  assert.match(faces.find((face) => face.includes("instrument-sans-400.woff2")), /font-weight:\s*400 700;/);
  assert.doesNotMatch(`${styles}\n${html}`, /instrument-sans-600/);
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

test("the visible About label forwards clicks to its control", async () => {
  const styles = await readStyles();
  const label = styles.match(/\.btn-icon-label\s*\{[^}]*\}/)[0];
  assert.match(label, /position:\s*absolute;/, "the label stays outside the bar's layout rectangle");
  assert.match(label, /pointer-events:\s*auto;/);
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

test("no-JavaScript fallback links use the light dark-background link ink", async () => {
  const styles = await readStyles();
  assert.match(
    styles,
    /\.scene-fallback-content a\s*\{[^}]*color:\s*var\(--parchment-200\);[^}]*text-decoration-color:\s*rgba\(198, 208, 202, 0\.48\);/,
  );
  assert.match(styles, /--parchment-200:\s*#[0-9a-f]{6};/i);
});

test("the 3:2 estate map fits short laptop and landscape-phone viewports", async () => {
  const styles = await readStyles();
  assert.match(
    styles,
    /\.panel-overlay\s*\{[^}]*padding:\s*max\(24px, env\(safe-area-inset-top\)\)[^;]*max\(24px, env\(safe-area-inset-bottom\)\)/,
  );
  assert.match(styles, /\.panel-estate\s*\{[^}]*width:\s*min\(100%, 960px, calc\(\(100svh - 48px\) \* 1\.5\)\);/);
  assert.match(
    styles,
    /@media \(orientation: landscape\) and \(max-height: 500px\)\s*\{\s*\.panel-estate\s*\{\s*width:\s*min\(\s*100%,\s*960px,\s*calc\(\(100svh - max\(8px, env\(safe-area-inset-top\)\) - max\(10px, env\(safe-area-inset-bottom\)\)\) \* 1\.5\)\s*\);/,
  );
  // The portrait map below 600px keeps its own width after the caps.
  const cap = styles.lastIndexOf("(100svh - max(8px");
  const portrait = styles.indexOf(".panel-estate { width: min(100%, 440px); }");
  assert.ok(cap > 0 && portrait > cap);
});

test("phones do not gain a phantom scroll below the small-viewport hero", async () => {
  const styles = await readStyles();
  assert.match(styles, /\nbody\s*\{[^}]*min-height:\s*100vh;[^}]*min-height:\s*100svh;/);
  assert.doesNotMatch(styles, /100dvh/);
});

test("modern iPhones open full-bleed: night to every edge, no bounce, matching bars", async () => {
  const styles = await readStyles();
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const manifest = JSON.parse(await readFile(new URL("../manifest.webmanifest", import.meta.url), "utf8"));
  assert.match(html, /<meta name="viewport" content="[^"]*viewport-fit=cover[^"]*"/);
  assert.match(html, /<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"/);
  // Safari's bars, the notch area and any overscroll show the page's own night.
  assert.match(styles, /\nhtml\s*\{[^}]*background:\s*var\(--night-900\);[^}]*overscroll-behavior:\s*none;/);
  assert.match(styles, /\nbody\s*\{[^}]*background:\s*linear-gradient\([^;]*#0d1119 100%\);[^}]*overscroll-behavior:\s*none;/);
  assert.match(styles, /--night-900:\s*#0c1016;/);
  assert.match(html, /<meta name="theme-color" content="#0c1016"/);
  assert.equal(manifest.theme_color, "#0c1016");
  assert.equal(manifest.background_color, "#0c1016");
  // The canvas keeps its CSS size; its buffer follows the full-bleed container.
  const rendering = await readFile(new URL("../src/scene/rendering.js", import.meta.url), "utf8");
  const scene = await readFile(new URL("../src/scene/index.js", import.meta.url), "utf8");
  assert.match(rendering, /renderer\.setSize\(nextWidth, nextHeight, false\);/);
  assert.doesNotMatch(rendering, /renderer\.setSize\([^)]*\b(?:height|Height)\)/);
  assert.match(scene, /readSize\(\) \{\s*const rect = container\?\.getBoundingClientRect\?\.\(\);/);
  assert.match(scene, /new ResizeObserver\(\(\) => resizeController\.resize\(\)\)/);
  assert.match(scene, /containerResizeObserver\?\.observe\(container\);/);
  assert.match(scene, /containerResizeObserver\?\.disconnect\(\);\s*resizeController\.dispose\(\);/);
});
test("fixed chrome and dialogs clear left and right safe-area insets", async () => {
  const styles = await readStyles();
  assert.match(styles, /\.hero\s*\{[^}]*padding-left:\s*max\(0px, calc\(env\(safe-area-inset-left\) - 16px\)\);/);
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
    assert.match(padding, /max\(\d+px, env\(safe-area-inset-right\)\)\s+max\(\d+px, env\(safe-area-inset-bottom\)\)\s+max\(\d+px, env\(safe-area-inset-left\)\)$/);
  }
});

test("landmarks and heading levels describe the page structure", async () => {
  const html = await readIndexHtml();
  const styles = await readStyles();
  assert.match(html, /<footer class="site-footer">[\s\S]*?data-panel="about"[\s\S]*?<\/footer>/);
  assert.match(styles, /body\.dev-mode-active > \*:not\(\.scene-shell\):not\(\.dev-mode-hud\)/);
  const fallback = html.match(/<div class="scene-fallback-content"[\s\S]*?<\/main>/)[0];
  assert.deepEqual(
    [...fallback.matchAll(/<(h[1-6])>([^<]+)<\/h[1-6]>/g)].map((match) => `${match[1]} ${match[2]}`),
    ["h2 About", "h3 Profile", "h3 Experience", "h3 Contact"],
  );

  const notFound = await readNotFoundHtml();
  assert.match(notFound, /<h1>That page isn't here\.<\/h1>/);
  assert.doesNotMatch(notFound, /<h2>/);
  assert.match(notFound, /<meta name="theme-color" content="#0c1016" \/>/);
  assert.match(notFound, /<picture class="scene-poster" aria-hidden="true">/);
  const classTokens = [...notFound.matchAll(/class="([^"]+)"/g)].flatMap((match) => match[1].split(/\s+/));
  for (const token of classTokens) {
    assert.match(styles, new RegExp(`\\.${token}(?![\\w-])`), `404 class "${token}" has no styles`);
  }
  // The 404 heading is an h1, so its display face lives on that rule alone.
  const notFoundHeading = cssRule(styles, ".not-found .story-shell h1");
  assert.match(notFoundHeading, /font-family:\s*var\(--font-display\);/);
  assert.match(notFoundHeading, /font-weight:\s*500;/);
  assert.doesNotMatch(styles, /\.story-shell h2/);
});

test("social previews describe the share image", async () => {
  const html = await readIndexHtml();
  const alt = "Alex Nava — a timber lookout tower under a moonlit sky";
  assert.ok(html.includes(`<meta property="og:image:alt" content="${alt}" />`));
  assert.ok(html.includes(`<meta name="twitter:image:alt" content="${alt}" />`));
});

// The first standalone rule for a selector, not one listed after a comma.
function cssRule(styles, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return styles.match(new RegExp(`(?:^|[}/{])\\s*${escaped}\\s*\\{([^}]*)\\}`))?.[1] || "";
}

// Every block for a media query, joined in source order.
function mediaBlock(styles, query) {
  const blocks = [];
  for (let start = styles.indexOf(`@media ${query} {`); start >= 0; start = styles.indexOf(`@media ${query} {`, start + 1)) {
    let depth = 0;
    for (let index = styles.indexOf("{", start); index < styles.length; index += 1) {
      if (styles[index] === "{") depth += 1;
      if (styles[index] === "}" && --depth === 0) {
        blocks.push(styles.slice(start, index + 1));
        break;
      }
    }
  }
  return blocks.join("\n");
}

function contrast(foreground, background) {
  const luminance = (hex) => {
    const [r, g, b] = hex.match(/[0-9a-f]{2}/gi).map((part) => {
      const channel = parseInt(part, 16) / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

test("About is the only footer control and keeps the corner clear", async () => {
  const html = await readIndexHtml();
  const footer = html.match(/<footer class="site-footer">([\s\S]*?)<\/footer>/)?.[1] || "";
  assert.doesNotMatch(footer, /site-copyright|&copy;|�|2026 Alex Nava/);
  assert.match(footer, /href="#about-text"[^>]*data-scene-fallback/);
  assert.match(footer, /data-panel="about"[^>]*aria-controls="panel-about"/);
  assert.equal((footer.match(/>About<\/span>/g) || []).length, 2);
  assert.doesNotMatch(footer, /mailto:|Email/);
  const safeArea = html.match(/<div class="bottom-bar"[\s\S]*?<\/div>/)[0];
  assert.match(safeArea, /aria-hidden="true"/);
  assert.doesNotMatch(safeArea, /<button|<a /);
  assert.doesNotMatch(html, /scene-pause|Pause scene/);
});

test("footer controls keep 44px targets without blocking the scene", async () => {
  const styles = await readStyles();
  const footer = cssRule(styles, ".site-footer");
  assert.match(footer, /position:\s*fixed;/);
  assert.match(footer, /pointer-events:\s*none;/);
  assert.match(footer, /font-size:\s*12px;/);
  assert.match(footer, /line-height:\s*16px;/);
  assert.match(footer, /letter-spacing:\s*0\.08em;/);
  assert.match(footer, /color:\s*var\(--text-accent\);/);
  assert.match(footer, /text-shadow:\s*var\(--text-meta-shadow\);/);

  const link = cssRule(styles, ".site-footer__link");
  assert.match(link, /display:\s*inline-flex;/);
  assert.match(link, /min-height:\s*44px;/);
  // 44px less the 14px hung above and below leaves the 16px line.
  assert.match(link, /margin:\s*-14px;/);
  assert.match(link, /padding:\s*0 14px;/);
  assert.match(link, /pointer-events:\s*auto;/);
  assert.match(link, /text-shadow:\s*inherit;/, "buttons otherwise drop the meta shadow");
  // The shared 3px ring sits 2px outside the text line, not around the 44px box.
  assert.match(cssRule(styles, ".site-footer__link:focus-visible"), /outline-offset:\s*-12px;/);
  assert.match(footer, /row-gap:\s*6px;/, "a stacked line stays clear of the neighbouring ring");

  // Touch browsers keep :hover after a tap, so only the pressed state stays bright.
  const hover = mediaBlock(styles, "(hover: hover)");
  assert.match(hover, /\.site-footer__link:hover\s*\{\s*color:\s*var\(--text\);/);
  assert.match(hover, /\.site-footer__about:hover\s*\{[^}]*text-decoration:\s*underline;/);
  const footerHover = /\.site-footer__(?:link|about):hover/g;
  assert.equal((styles.match(footerHover) || []).length, (hover.match(footerHover) || []).length);

  assert.doesNotMatch(styles, /\.site-copyright/);
  assert.match(footer, /grid-template-columns:\s*max-content minmax\(0, 1fr\);/);

  // The short About label keeps narrow phones on one footer line.
  assert.doesNotMatch(styles, /@media \(max-width: 480px\)/);

  const phone = mediaBlock(styles, "(max-width: 640px)");
  assert.match(phone, /\.site-footer\s*\{[^}]*right:\s*max\(16px, calc\(env\(safe-area-inset-right\) \+ 8px\)\);[^}]*left:\s*max\(16px, calc\(env\(safe-area-inset-left\) \+ 8px\)\);/);

  const forced = styles.slice(styles.indexOf("/* Windows High Contrast"));
  assert.match(forced, /a,\s*\.site-footer__about\s*\{\s*color:\s*LinkText;/);
  assert.match(styles, /body\.dev-mode-active > \*:not\(\.scene-shell\):not\(\.dev-mode-hud\),\s*body\.dev-mode-active::after\s*\{/);
});

test("category copy stays minimal and matches its Markdown equivalent", async () => {
  const html = await readIndexHtml();
  const markdown = await readFile(path.join(projectRoot, "index.md"), "utf8");
  const profile = "This is my personal corner of the web.";
  const experience = "Analytics, reporting, remediation, and controls, across banking and health.";
  for (const [id, sentence] of [["profile", profile], ["experience", experience]]) {
    const escaped = sentence.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(html, new RegExp(`id="${id}-text"><h3>[^<]+</h3><p>${escaped}</p></section>`));
    assert.ok(html.includes(`<p class="panel-body">${sentence}</p>`), `${id} dialog copy`);
    assert.ok(markdown.includes(`\n${sentence}\n`), `${id} Markdown copy`);
  }
  assert.equal(html.split("A little about me and what I’m working on.").length - 1, 1, "only the hero keeps the intro");
  assert.doesNotMatch(`${html}\n${markdown}`, /health analytics|My background is in/);
  assert.match(html, /id="panel-experience-title">My background\.<\/h2>/);
});

test("structured data describes the person without new facts and dates match Markdown", async () => {
  const html = await readIndexHtml();
  const markdown = await readFile(path.join(projectRoot, "index.md"), "utf8");
  const data = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
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
  assert.match(wide, /--gutter:\s*clamp\(64px, 5\.5vw, 160px\);/);
  assert.match(
    wide,
    /\.hero\s*\{[^}]*width:\s*auto;[^}]*margin-inline:\s*0;[^}]*padding-inline:\s*max\(var\(--gutter\), env\(safe-area-inset-left\)\)\s*max\(var\(--gutter\), env\(safe-area-inset-right\)\);/,
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
  assert.match(backdrop, /rgba\(8, 10, 16, 0\.64\)/);
  assert.match(backdrop, /opacity:\s*0;/);
  assert.match(backdrop, /transition:\s*opacity 240ms ease;/);
  assert.match(cssRule(styles, "body[data-panel-open]::after"), /opacity:\s*1;\s*transition-duration:\s*440ms;/);

  const overlay = styles.match(/\n\.panel-overlay\s*\{[^}]*position:\s*fixed;[^}]*\}/)[0];
  assert.match(overlay, /z-index:\s*20;/);
  assert.match(overlay, /inset:\s*0;/, "the overlay still fills the viewport for backdrop clicks");
  assert.match(overlay, /background:\s*transparent;/);
  assert.equal((styles.match(/rgba\(8, 10, 16, 0\.64\)/g) || []).length, 1, "the dim is painted once");
  assert.match(
    styles,
    /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?body::after\s*\{\s*transition:\s*none;/,
  );
});

test("dialog polish keeps readable ink, touch cues and paper-safe controls", async () => {
  const styles = await readStyles();
  const email = cssRule(styles, "#panel-contact .panel-body a");
  assert.match(email, /display:\s*inline-block;/);
  assert.match(email, /color:\s*#211c16;/);
  assert.match(email, /font:\s*500 clamp\(24px, 2\.4vw, 30px\) \/ 1\.2 var\(--font-display\);/);
  assert.match(email, /text-decoration-thickness:\s*1px;/);
  assert.match(email, /text-underline-offset:\s*0\.18em;/);
  assert.ok(contrast("#211c16", "#e8ddc8") >= 4.5);

  const touch = mediaBlock(styles, "(hover: none), (pointer: coarse)");
  assert.match(touch, /\.estate-destination span\s*\{[^}]*text-decoration:\s*underline;[^}]*rgba\(72, 53, 30, 0\.35\)/);
  assert.match(touch, /\.panel-estate \.estate-destination:active\s*\{[^}]*background:\s*rgba\(78, 54, 26, 0\.08\);/);
  // The touch underline shares the base label rule's specificity, so it must
  // follow that rule in source order to keep winning.
  const baseLabel = styles.search(/^\.estate-destination span\s*\{/m);
  const touchLabel = styles.search(
    /@media \(hover: none\), \(pointer: coarse\)\s*\{[^@]*?\.estate-destination span\s*\{[^}]*text-decoration:\s*underline;/,
  );
  assert.ok(baseLabel >= 0 && touchLabel > baseLabel, "the touch underline follows the base label rule");
  const unscopedHover = styles
    .replace(/@media \(hover: hover\)\s*\{[^{}]*\{[^}]*\}\s*\}/g, "")
    .match(/\.estate-destination:hover span/);
  assert.equal(unscopedHover, null, "the map underline follows real hover only");

  // 30px clears the 24px deckled edge, so Back sits wholly on the paper.
  assert.match(cssRule(styles, ".panel-parchment .panel-back"), /margin:\s*30px;/);
  assert.doesNotMatch(styles, /\.panel-parchment \.panel-close\s*\{/, "no second margin rule for Back");
  // The About case defers to the scene: small, with no glow or indicator dot,
  // a target of at least 44px, and the footer's pale-stone type.
  assert.doesNotMatch(styles, /\.bottom-btn--icon::(?:before|after)/);
  for (const [, size] of styles.matchAll(/\.bottom-btn--icon\s*\{[^}]*?width:\s*(\d+)px;/g)) {
    assert.ok(Number(size) >= 44 && Number(size) <= 52, `About target ${size}px`);
  }
  const label = cssRule(styles, ".btn-icon-label");
  assert.match(label, /color:\s*var\(--text-accent\);/);
  assert.match(label, /font-size:\s*13px;[^}]*letter-spacing:\s*0\.14em;/);
});

test("the 404 is a centered cotton-paper sheet with dark ink", async () => {
  const notFound = await readNotFoundHtml();
  const styles = await readStyles();
  assert.match(notFound, /<body class="not-found">/);
  assert.match(cssRule(styles, ".not-found"), /display:\s*grid;\s*place-items:\s*center;/);
  assert.match(cssRule(styles, ".not-found .story-shell"), /color:\s*#211c16;/);
  assert.match(cssRule(styles, ".not-found .story-shell::before"), /#e8ddc8 url\("\/images\/paper-grain\.webp"\)/);
  assert.match(cssRule(styles, ".not-found .story-shell::after"), /border-image:\s*url\("\/images\/paper-edge\.webp"\)/);
  assert.match(cssRule(styles, ".not-found .story-shell .eyebrow"), /color:\s*#60492e;/);
  assert.match(cssRule(styles, ".not-found .back-link"), /min-height:\s*44px;/);
  for (const ink of ["#211c16", "#393229", "#60492e", "#3b2c1e"]) {
    assert.ok(contrast(ink, "#e8ddc8") >= 4.5, `${ink} on paper`);
  }
});
