# Accessibility

How the site works with a keyboard, a screen reader, user preferences and older browsers, and what the repository checks. Visual rules (contrast, type, motion) are in [Style](STYLE.md); the words themselves are in [Content](CONTENT.md). Terms such as title card, live path, low tier and no-JS fallback are defined in the [Glossary](GLOSSARY.md).

## Target

The intended conformance target is WCAG 2.2 level AA. This file is where that target is recorded, and no check tests conformance as a whole. [Style](STYLE.md#motion-and-accessibility) sets the house rules: text keeps 4.5:1 contrast or better on the night, on paper and over every tour shot (the AA minimum for normal text); no text is below 12 px; interactive targets are at least 44 px (above AA's 24 px target-size minimum).

What the repository checks:

| Check                                                                                                                                                                              | Where                                |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| Lighthouse accessibility score 1.00 (median of three runs) on the homepage's title card                                                                                            | `lighthouserc.json`, CI `audit` job  |
| No `font-size` below 12px in styles.css; the footer at 12px or more                                                                                                                | `markup-accessibility`               |
| 4.5:1 for the paper ink of the dialogs' eyebrow and body and of the 404, and the no-JS links on the night                                                                          | `markup-accessibility`               |
| 44 px targets: the skip link, the no-JS links, the footer's About (link and button), the Contact address (its 8 px block padding around its smallest line) and the 404's Home link | `markup-accessibility`               |
| Every `aria-controls` and `aria-labelledby` target exists; the skip link's target exists                                                                                           | `markup-accessibility`               |
| Dialogs declare `role="dialog"`, `aria-modal="true"` and `aria-labelledby`, and start hidden                                                                                       | `markup-accessibility`               |
| Landmarks and heading levels; one decorative, unlabelled vignette per category dialog                                                                                              | `markup-accessibility`               |
| No `forced-color-adjust: none`; forced-colors and increased-contrast modes keep the system cursor                                                                                  | `markup-accessibility`               |
| Focus trap, focus restoration, Back, Escape and backdrop dismissal, `aria-expanded`, background `inert`                                                                            | `panels`, `scene-menu`, `deep-links` |

GitHub's runners have no GPU, so Lighthouse audits the static title card, not the live scene. The 404 page is not audited.

## Keyboard

1. The first stop is the skip link, Skip to main content, which slides into view on focus and moves focus to `main` (`tabindex="-1"`).
2. On the enhanced page the next stop is About, the footer button. It opens the About dialog, whose illustrated estate map is the menu, and focuses its Close button (×, named Close About). Tab then reaches Profile, Experience and Contact.
3. A destination opens its category dialog and focuses Back. In a category dialog, Back, Escape or a click on the backdrop return to About with focus on the destination that opened it. About has no Back: its Close (×), Escape or a click on the backdrop close the menu and return focus to the footer button.
4. While a dialog is open, Tab and Shift+Tab cycle within it, and everything behind it (the skip link, `main`, the footer and the decorative layers) is `inert` and cannot scroll.

[panels.js](../src/ui/panels.js) owns the dialogs: focus, the trap, the Back stack and `aria-expanded`. A backdrop dismisses only when both the press and the release land on it, so a drag-select across the paper never closes a dialog. Close and Back are 44 px high and each estate map destination at least 44 px square; no test checks these sizes. On small landscape phones (landscape, up to 700 px wide and 500 px tall) the category papers set the vignette beside a shorter sheet, so the paper fits the screen and the backdrop around it stays tappable. [UI](UI.md#dialogs) describes the dialogs in full.

### Deep links

`#about`, `#profile`, `#experience` and `#contact`, and their no-JavaScript aliases `#about-text`, `#profile-text`, `#experience-text` and `#contact-text`, open the matching dialog through the same buttons a visitor presses, so focus and Back behave as they do by hand, and an alias settles on the plain hash ([deep-links.js](../src/ui/deep-links.js)). The address follows the open dialog through `history.replaceState`, so dialogs add no history entries.

## Screen readers

- The page is `lang="en"`. Landmarks: `main`, the footer, and two named navigations, Categories (no-JavaScript) and Site categories (the estate map).
- Headings: the name is the only `h1`; About is an `h2` with `h3` sections in the no-JavaScript text; each dialog's `h2` names it through `aria-labelledby`.
- The About button and the three destinations carry `aria-expanded` and `aria-controls`. About stays expanded while a category dialog opened from it is showing.
- Each dialog is `role="dialog"` with `aria-modal="true"`. A closed dialog is `hidden`; a closing one is `aria-hidden` and `inert` until it finishes.
- Decorative layers are hidden from assistive technology: the scene shell with its canvas (`aria-hidden`), the site shell, the bottom bar (`.bottom-bar`, an empty band that shades the screen's foot behind the footer), the loading line and the dialog vignettes. The loading line is not announced.
- All copy is HTML text. The estate map's labels are buttons over the artwork, and the address is a literal `mailto:` link.

## Without JavaScript

The page is complete without scripts. The footer's About link points at `#about-text`, a section in `main` with the three categories and links to each; the sections take focus (`tabindex="-1"`). The section starts at the fold on every screen, so the title card shows alone until the visitor scrolls: 90 px below the desktop hero, which ends 90 px above the fold, and directly under the full-height hero on phones (up to 820 px wide, or landscape up to 500 px tall). [scene-menu.js](../src/ui/scene-menu.js) swaps that fallback for the About button only after `initPanels()` succeeds, and not while focus is inside the fallback. A browser that cannot run the UI bundle keeps the no-JS fallback, and the title card never depends on the scene.

## Preferences

**Reduced motion** (`prefers-reduced-motion: reduce`)

- No live scene: [main.js](../src/main.js) requests no scene script unless `?quality=high|balanced` or `?sceneDebug=1|true` forces it; `?quality=auto` or an unknown value forces nothing, and `?quality=low` keeps the title card. main.js loads the scene if the preference later clears, except when the address carries `?quality=high|balanced|low` or `?sceneDebug=1|true`: then it installs no listener (`forcesLiveScene`).
- Dialogs open and close at once: styles.css drops their transitions, and [panels.js](../src/ui/panels.js) hides a closing dialog immediately, finishing any close in progress when the preference turns on.
- The entrance animations stop: the hero's and the footer's rise, both `hero-reveal`. The hero's scroll fade ([hero.js](../src/ui/hero.js)) stops and the hero stays in place.
- Transitions are removed from the skip link, the footer links and the About button, the estate map's destinations, the dialogs and their paper surface, Close and Back, the Contact address, the 404's Home link, the dim overlay behind an open dialog (`body::after`), the canvas fade-in, the title card's grain and the loading line. The loading line has no animation of its own: its bar moves only with real progress.
- Close and Back lose their hover and focus lift, the paper surface opens without its rise and tilt, and in-page scrolling is instant (`scroll-behavior: auto` replaces `smooth`).
- A live scene, forced or running when the preference turns on, holds the tour and the drift, freezes scene time with the flame and the drips, and draws only when something changes.

**Reduced data** (`prefers-reduced-data: reduce`, or Save-Data from `navigator.connection`, which only Chromium browsers have)

- No live scene: main.js keeps the title card, and with `?sceneDebug=1` quality.js still gives the low startup tier, which keeps it too. When the probe could not read the texture limits, main.js downloads the scene bundle before `initHomeScene()` declines that tier; the title card stays either way. Only `?quality=high` or `?quality=balanced` overrides reduced data.
- The scene loads if the preference later clears, unless the address carries `?quality=high|balanced|low` or `?sceneDebug=1|true`, as under reduced motion. So `?sceneDebug=1` with reduced data keeps the title card until a reload.

**Reduced transparency** (`prefers-reduced-transparency: reduce`)

- The bottom bar's soft backdrop is removed. The hero's stays: it is the scrim that keeps the name legible over the scene.
- The loading line's track turns solid and its fill loses its shadow.
- The scene's post-process vignette is off ([postprocess.js](../src/scene/postprocess.js)).

**Forced colours** (`forced-colors: active`)

- The decorative layers are removed: the scene shell with its canvas, the vignette with the title card's grain, the site shell, and the hero and bottom-bar backdrops. So is the loading line.
- Only CSS reacts: no script reads this mode, so on the live path main.js still requests the scene bundle and the early tower and tree, and initializes the scene behind the hidden shell.
- Controls, dialogs, the estate map and the 404 sheet use system colours (Canvas, CanvasText, ButtonFace, ButtonText, LinkText, Highlight and HighlightText; no others), without paper textures or vignettes.
- The cursor is the system's.

**Increased contrast** (`prefers-contrast: more`)

- The system cursor replaces the pale line cursor, and the title card's grain is removed. Nothing else changes.

**Hover.** Touch browsers keep `:hover` after a tap, so every hover style is limited to `(hover: hover)`:

- `.site-footer__link:hover` brightens the footer's About (the no-JS link and the button, the footer's only controls), and `.site-footer__about:hover` underlines it.
- `.estate-destination:hover` tints an estate map destination, and `.estate-destination:hover span` underlines its label.
- `.panel-close:hover` tints Close and Back and lifts them 1 px.
- `#panel-contact .panel-body a:hover` darkens the Contact address's underline.
- `.not-found .back-link:hover` tints the 404's Home link.

The only `:hover` selectors outside that query set `transform: none` and change nothing on a tap. On touch screens, `(hover: none), (pointer: coarse)` gives the map labels a resting underline and a pressed destination a tint. The other pressed (`:active`) styles apply on every device.

## Browser support

The build sets no browser list. esbuild compiles the scripts with `target: "es2022"`: the UI is one deferred classic script, and the scene is ES modules (a `type="module"` entry with `modulepreload` for its shared chunk). The stylesheet is minified without a target, so no CSS syntax is lowered ([build.mjs](../build.mjs)).

### WebGL

The probe ([webgl-probe.js](../src/shared/webgl-probe.js)) asks for WebGL2 and falls back to WebGL1. Without either the title card stays. On a software renderer it stays too, unless `?quality=high|balanced` or `?sceneDebug=1` forces the scene ([Preferences](#preferences)). Without a `?quality=` tier, texture limits under 4096 or anisotropic filtering under 4 give the low tier, which keeps the title card too.

| Needs WebGL2                                                             | On WebGL1                   |
| ------------------------------------------------------------------------ | --------------------------- |
| The light shafts' lazy chunk (index.js checks `isWebGL2`)                | Not requested; no air light |
| Scene MSAA on high (also needs `EXT_color_buffer_float`; postprocess.js) | No multisampling            |

Shader warm-up needs `renderer.compileAsync` and `KHR_parallel_shader_compile`. Without them each warm-up reports `unwarmed` and programs link on their first draw ([rendering.js](../src/scene/rendering.js) `compileShaders`). The models need WebP decoding: a map that fails to decode fails the model. Every model and slate-map request uses `fetch` with an `AbortController` signal ([architecture-assets.js](../src/scene/architecture-assets.js), [stone-detail.js](../src/scene/stone-detail.js)); without them the scene cannot load the tower and tree and never reveals. main.js checks both before its early tower and tree requests and skips those without them.

### Optional APIs

| API                             | Used for                                                                                                                                                                                                             | Without it                                                                                                                                                                                                                                          |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `requestIdleCallback`           | Starting the scene after first paint (500 ms timeout); fitting the next tour shot (1500 ms); building the terrain and ranges in slices (100 ms); building the light shafts' noise tile and lights in slices (120 ms) | `requestAnimationFrame` then `setTimeout`; `setTimeout` 50 ms; `setTimeout` 0; `setTimeout` 16 ms                                                                                                                                                   |
| `ReadableStream` and `Response` | The loading line's byte count                                                                                                                                                                                        | The line advances on stages and build steps only                                                                                                                                                                                                    |
| `PerformanceObserver`           | The loading line's build share and the reveal mark                                                                                                                                                                   | The build share waits for the reveal                                                                                                                                                                                                                |
| `MutationObserver`              | Ending the loading line; the render hold behind dialogs                                                                                                                                                              | The loading line's 2 s watchdog sees the reveal, but not a host the scene hides after a failed tower or tree, so the line then retires only as stalled, about 16 s later; the tour still holds for dialogs, but rendering does not stop behind them |
| `IntersectionObserver`          | Not rendering an off-screen canvas                                                                                                                                                                                   | The canvas counts as visible                                                                                                                                                                                                                        |
| `ResizeObserver`                | Resizes of the scene host without a window resize                                                                                                                                                                    | Window resizes and pixel-ratio changes only                                                                                                                                                                                                         |
| `document.fonts`                | Re-measuring the text the scene frames around after fonts load                                                                                                                                                       | Re-measured on the next resize                                                                                                                                                                                                                      |
| `CustomEvent`                   | `babel:panelchange`, which keeps the address in step                                                                                                                                                                 | Dialogs work; the address does not follow them                                                                                                                                                                                                      |
| `history.replaceState`          | Writing the open dialog to the address                                                                                                                                                                               | Dialogs work; the address stays as it was                                                                                                                                                                                                           |
| `navigator.deviceMemory`        | The low tier at 2 GB or less                                                                                                                                                                                         | Memory is not a reason for the low tier (iOS hides it)                                                                                                                                                                                              |
| `createImageBitmap`             | Decoding the slate maps                                                                                                                                                                                              | The slate reports `fallback` and the procedural ground stays                                                                                                                                                                                        |

### CSS

- `svh` sizes the page and hero, after a `vh` fallback. On touch WebKit (`@supports (-webkit-touch-callout: none)`) the decorative layers use `lvh`, after a `vh` fallback.
- `text-wrap: balance` balances the intro and the dialog headings and, inside `@supports`, the name and the 404 heading, which otherwise break with `overflow-wrap: anywhere`.
- `env(safe-area-inset-*)` keeps the skip link, the hero, the footer, the loading line and the dialogs (the overlay, Close and the estate map) clear of notches and the home indicator, and the bottom bar follows the same insets; `main` clips horizontal overflow with `overflow-x: clip`.
- Focus rings use `:focus-visible`. The stylesheet uses no `:has()`: the title card's grain fades at the reveal through a sibling selector, `.scene-canvas.is-ready + .scene-vignette::before`.
- The pages carry no inline styles: the Content Security Policy forbids them, and scripts change styles only through the CSSOM.
