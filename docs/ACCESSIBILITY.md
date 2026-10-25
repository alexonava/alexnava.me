# Accessibility

How the site works with a keyboard, a screen reader, user preferences and older browsers, and what the repository checks. Visual rules (contrast, type, motion) are in [Style](STYLE.md); the words themselves are in [Content](CONTENT.md). Terms such as title card, live path, low tier and no-JS fallback are defined in the [Glossary](GLOSSARY.md).

## Target

The intended conformance target is WCAG 2.2 level AA. This file is where that target is recorded, and no check tests conformance as a whole. [Style](STYLE.md#motion-and-accessibility) sets the house rules: text keeps 4.5:1 contrast or better on the night and over every tour shot (the AA minimum for normal text); no text is below 12 px; interactive targets are at least 44 px (above AA's 24 px target-size minimum).

What the repository checks:

| Check                                                                                                                                                                                                                                                | Where                               |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| Lighthouse accessibility score 1.00 (median of three runs) on the homepage's title card                                                                                                                                                              | `lighthouserc.json`, CI `audit` job |
| No `font-size` below 12px in styles.css; the footer at 12px or more                                                                                                                                                                                  | `markup-accessibility`              |
| All text in one colour, `--text` (every `color` outside forced colours is it, `inherit`, `currentColor` or `transparent`), at 4.5:1 or better on the night and 12:1 or better for the footer's Contact and links; selected text at 4.5:1 on its wash | `markup-accessibility`              |
| 44 px targets: the skip link, the footer's Contact and its two links, and the 404's Home link                                                                                                                                                        | `markup-accessibility`              |
| Every `aria-controls` target exists; the skip link's target exists                                                                                                                                                                                   | `markup-accessibility`              |
| Landmarks and heading levels; the footer's Contact button and its links, which show without scripts                                                                                                                                                  | `markup-accessibility`              |
| No `forced-color-adjust: none`; forced-colors and increased-contrast modes keep the system cursor and hide the loading line's star                                                                                                                   | `markup-accessibility`              |
| Contact's collapse and reveal, `aria-expanded`, Escape and focus return, the hashes that open it, the links left alone when focus is inside them or the markup is incomplete                                                                         | `contact`                           |

GitHub's runners have no GPU, so Lighthouse audits the static title card, not the live scene. The 404 page is not audited.

## Keyboard

1. The first stop is the skip link, Skip to main content, which slides into view on focus and moves focus to `main` (`tabindex="-1"`).
2. The next stop is Contact, the footer's button. Enter or Space shows the email address and LinkedIn beside it (above it on phones), the next two stops; pressing it again hides them. Escape hides them from anywhere on the page and, when focus was on one of them, returns it to Contact. Without scripts the two links are the stops after the skip link.
3. Over the live scene on a desktop, `or ~ starts the walk ([Scene modes](SCENE-MODES.md#walk)), which nothing announces: the page fades off the canvas into`visibility: hidden`, so it leaves the accessibility tree and focus with it, and the mouse is captured. The arrow keys and W, A, S and D walk and turn. The same key, or Esc twice, brings the page and the tour back. It never starts under reduced motion or forced colors, or on a touch-primary device.

While the live scene loads, the opening's doors cover the page, the skip link excepted: the first key that is not a modifier alone or a shortcut, the first focus and a tap on the paper part them at once ([scene-doors.js](../src/ui/scene-doors.js)), so no stop is ever under the paper. Without scripts they open on their own after 4 s.

[contact.js](../src/ui/contact.js) owns the disclosure: `aria-expanded`, Escape and focus return. It traps no focus and makes nothing `inert`, so the page stays as it was while the links show. An address ending `#about`, `#profile`, `#experience` or `#contact` (or the same with `-text`) opens the links on load and on every `hashchange`. The footer's targets are 44 px high; the links sit 28 px apart in a row, and one 44 px row apart where they stack above Contact up to 640 px wide. [UI](UI.md#contact) describes Contact in full.

## Screen readers

- The page is `lang="en"`. Landmarks: `main` and the footer.
- Headings: the name is the homepage's only heading, its `h1`.
- Contact is a button with `aria-expanded` and `aria-controls="contact-links"`: `false` while the links are hidden, `true` while they show. The links are plain links: the address a literal `mailto:` link, LinkedIn opening in a new tab (`rel="noopener"`).
- Decorative layers are hidden from assistive technology: the scene shell with its canvas and the loading line's star (`aria-hidden`), the site shell, the opening's doors (with their drawing's canvas), the bottom bar (`.bottom-bar`, an empty band that shades the screen's foot behind the footer) and the loading line. The loading line is not announced.
- All copy is HTML text.

## Without JavaScript

The page is complete without scripts, once the opening's doors, which cover it for its first 4 s, have opened on their own. Contact stays hidden, and the footer shows the email address and LinkedIn in its place: plain links with 44 px targets over their own scrim. [contact.js](../src/ui/contact.js) folds them behind Contact only once it binds, and not while focus is inside them. A browser that cannot run the UI bundle keeps the links, and the title card never depends on the scene.

## Preferences

**Reduced motion** (`prefers-reduced-motion: reduce`)

- No live scene: [main.js](../src/main.js) requests no scene script unless `?quality=high|balanced` or `?sceneDebug=1|true` forces it; `?quality=auto` or an unknown value forces nothing, and `?quality=low` keeps the title card. Without an explicit quality or debug override, main.js rechecks startup if the preference later clears. An explicit `?quality=high|balanced|low` or `?sceneDebug=1|true` determines startup as above (`forcesLiveScene`); clearing motion or data alone does not trigger recovery from a static tier selected under those controls. Forced colours always block startup, including these overrides.
- The entrance animations stop: the hero's and the footer's rise, both `hero-reveal`. The hero's scroll fade ([hero.js](../src/ui/hero.js)) stops and the hero stays in place.
- No opening doors: `.scene-doors` is `display: none`, so nothing parts and the title card shows at once.
- Transitions are removed from the skip link, the footer's Contact and links, the 404's Home link, the canvas fade-in, the title card's grain, the tablet intro's scrim and the loading line with its bar's fill, which then steps to each new value. The loading line and its star have no animation of their own: the line's value, its bar and the star change only with real progress, and the star has no transition to remove.
- In-page scrolling is instant (`scroll-behavior: auto` replaces `smooth`).
- A live scene, forced or running when the preference turns on, holds the tour and the drift, freezes scene time with the flame and the drips, and draws only when something changes.

**Reduced data** (`prefers-reduced-data: reduce`, or Save-Data from `navigator.connection`, which only Chromium browsers have)

- No live scene: main.js keeps the title card, and with `?sceneDebug=1` quality.js still gives the low startup tier, which keeps it too. When the probe could not read the texture limits, main.js downloads the scene bundle before `initHomeScene()` declines that tier; the title card stays either way. Only `?quality=high` or `?quality=balanced` overrides reduced data.
- The scene loads if the preference later clears, unless the address carries `?quality=high|balanced|low` or `?sceneDebug=1|true`, as under reduced motion. With `?sceneDebug=1`, a reduced-data change alone does not restart startup; clearing forced colours rechecks the current preferences even with that override.

**Reduced transparency** (`prefers-reduced-transparency: reduce`)

- The bottom bar's soft backdrop is removed. The hero's, the tablet intro's and the footer's stay: they are the scrims that keep the text legible over the scene.
- The loading line's track turns solid (`#1f2227`) and its fill drops its glow.
- The scene's post-process vignette is off ([postprocess.js](../src/scene/postprocess.js)).

**Forced colours** (`forced-colors: active`)

- The decorative layers are removed: the opening's doors, the scene shell with its canvas, the vignette with the title card's grain, the site shell, and the hero's, the tablet intro's, the footer's and the bottom bar's backdrops. So are the loading line, its bar with it, and its star.
- main.js checks this mode before probing WebGL, requesting the scene bundle or models, or starting the loading line. An initial forced-colours visit makes none of those requests, even with an explicit quality or debug override.
- When the preference clears, main.js rechecks the other startup gates and starts once if eligible; overlapping preference changes share any startup in flight. `?quality=low` stays static, and `?sceneDebug=1` with reduced data still selects the low tier. This is a startup gate: switching the preference on does not unload an already initialized scene; CSS hides its decorative shell.
- The skip link and the footer's controls use system colours (Canvas, CanvasText and LinkText; no others): links, the 404's Home among them, and Contact are LinkText.
- The cursor is the system's.

**Increased contrast** (`prefers-contrast: more`)

- The system cursor replaces the pale line cursor, and the title card's grain and the loading line's star are removed; the opening's doors stay plain paper, without fibres, light or drawing. Nothing else changes.

**Hover.** Touch browsers keep `:hover` after a tap, so every hover style is limited to `(hover: hover)`:

- `.site-footer__contact:hover` underlines Contact, and `.site-footer__links .site-footer__link:hover` strengthens a link's underline: the footer's only controls.
- `.not-found .back-link:hover` underlines the 404's Home link.

No `:hover` selector stands outside that query. The pressed (`:active`) styles apply on every device. Hover and press only underline: the text keeps its colour.

## Browser support

The build sets no browser list. esbuild compiles the scripts with `target: "es2022"`: the UI is one deferred classic script, and the scene is ES modules (a `type="module"` entry with `modulepreload` for its shared chunk). The stylesheet is minified without a target, so no CSS syntax is lowered ([build.mjs](../build.mjs)).

### WebGL

The probe ([webgl-probe.js](../src/shared/webgl-probe.js)) asks for WebGL2 and falls back to WebGL1. Without either the title card stays. On a software renderer it stays too, unless `?quality=high|balanced` or `?sceneDebug=1` forces the scene ([Preferences](#preferences)). Without a `?quality=` tier, texture limits under 4096 or anisotropic filtering under 4 give the low tier, which keeps the title card too.

| Needs WebGL2                                                             | On WebGL1        |
| ------------------------------------------------------------------------ | ---------------- |
| Scene MSAA on high (also needs `EXT_color_buffer_float`; postprocess.js) | No multisampling |

Shader warm-up needs `renderer.compileAsync` and `KHR_parallel_shader_compile`. Without them each warm-up reports `unwarmed` and programs link on their first draw ([rendering.js](../src/scene/rendering.js) `compileShaders`). The models need WebP decoding: a map that fails to decode fails the model. Every model and slate-map request uses `fetch` with an `AbortController` signal ([architecture-assets.js](../src/scene/architecture-assets.js), [stone-detail.js](../src/scene/stone-detail.js)); without them the scene cannot load the tree and never reveals. main.js checks both before its early tree request and skips it without them.

### Optional APIs

| API                             | Used for                                                                                                                                        | Without it                                                                                                                                                                                                      |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `requestIdleCallback`           | Starting the scene after first paint (500 ms timeout); fitting the next tour shot (1500 ms); building the terrain and ranges in slices (100 ms) | `requestAnimationFrame` then `setTimeout`; `setTimeout` 50 ms; `setTimeout` 0                                                                                                                                   |
| `ReadableStream` and `Response` | The loading line's byte count                                                                                                                   | The line advances on stages and build steps only                                                                                                                                                                |
| `PerformanceObserver`           | The loading line's build share and the reveal mark                                                                                              | The build share waits for the reveal                                                                                                                                                                            |
| `MutationObserver`              | Ending the loading line; showing the tablet intro's scrim only over the live scene (hero.js)                                                    | The loading line's 2 s watchdog sees the reveal, but not a host the scene hides after a failed watch or tree, so the line then retires only as stalled, about 16 s later; the tablet intro's scrim always shows |
| `IntersectionObserver`          | Not rendering an off-screen canvas                                                                                                              | The canvas counts as visible                                                                                                                                                                                    |
| `ResizeObserver`                | Resizes of the scene host without a window resize; re-measuring the footer's text guard on the frame after Contact's links show or hide         | Window resizes and pixel-ratio changes only; the guard follows the links within 30 frames                                                                                                                       |
| `document.fonts`                | Re-measuring the text the scene frames around after fonts load, and placing the loading line's star again                                       | Re-measured on the next resize                                                                                                                                                                                  |
| `navigator.deviceMemory`        | The low tier at 2 GB or less                                                                                                                    | Memory is not a reason for the low tier (iOS hides it)                                                                                                                                                          |
| `createImageBitmap`             | Decoding the slate maps                                                                                                                         | The slate reports `fallback` and the procedural ground stays                                                                                                                                                    |

### CSS

- `svh` sizes the page and hero, after a `vh` fallback. On touch WebKit (`@supports (-webkit-touch-callout: none)`) the decorative layers use `lvh`, after a `vh` fallback.
- `text-wrap: balance` balances the intro and, inside `@supports`, the name and the 404 heading, which otherwise break with `overflow-wrap: anywhere`.
- `env(safe-area-inset-*)` keeps the skip link, the hero, the footer and the loading line (its label, and its bar below the home-screen app's status bar) clear of notches and the home indicator, and the bottom bar follows the same insets. `main` is at least one viewport tall (`min-height: 100vh`, then `100svh`) and clips decorative overflow on both axes with `overflow: clip`, without becoming a scroll container. In-flow content can grow its height and scroll normally with the document.
- Focus rings use `:focus-visible`. The stylesheet uses no `:has()`: the title card's grain fades at the reveal through a sibling selector, `.scene-canvas.is-ready + .scene-vignette::before`.
- The pages carry no inline styles: the Content Security Policy forbids them, and scripts change styles only through the CSSOM.
