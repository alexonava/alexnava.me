# UI

The page's interface as built: its tokens, breakpoints, layers, components, motion, dialogs, deep links and the 404 page. [Style](STYLE.md) sets the rules it follows, [Accessibility](ACCESSIBILITY.md) says how it meets them, [Content](CONTENT.md) holds the words, and [Contracts](CONTRACTS.md#dom) lists the DOM hooks the scripts and the scene share. The sources are [index.html](../index.html), [404.html](../404.html), [styles.css](../styles.css), [src/ui/](../src/ui/) and [main.js](../src/main.js). Terms such as title card, live path, reveal and render hold are defined in the [Glossary](GLOSSARY.md).

## Page structure

The homepage's `body`, in order:

1. The skip link (`.skip-link`, to `#main`).
2. The scene shell (`.scene-shell`, `aria-hidden`): the scene host `#home-scene.scene-canvas`, then `.scene-vignette`. The vignette must follow the host, because the title card's grain fades through a sibling selector.
3. The site shell (`.site-shell`, `aria-hidden`).
4. `main#main` (`tabindex="-1"`): the hero (`#home.hero.section`, holding `#hero-minimal`), then the no-JS About (`#about-text`, `data-scene-fallback`).
5. The bottom bar (`.bottom-bar`, `aria-hidden`) and its empty spacer.
6. The loading line (`#scene-loader`, `aria-hidden`, `hidden`).
7. The footer: the no-JS About link and the About button (`.scene-entry`, `hidden`).
8. Four dialogs, each `hidden`: About (`#panel-about`), Contact, Profile and Experience.
9. The UI bundle, `<script defer src="/scripts/app.js">`.

Neither page has an inline style: the Content Security Policy forbids them, and scripts change styles only through the CSSOM. Neither has an `<img>` or `<picture>`: all artwork is CSS backgrounds.

## Tokens

`:root` sets `color-scheme: dark` and these custom properties.

| Property              | Value                                                                                                    | Role                                                                                                                 |
| --------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `--font-display`      | `"Cormorant Garamond", Georgia, "Times New Roman", serif`                                                | The name, the dialog and 404 headings, the estate map's title and labels, the Contact address and the no-JS headings |
| `--font-body`         | `"Instrument Sans", ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif` | All other text                                                                                                       |
| `--night-900`         | `#0c1016`                                                                                                | The `html` background and the top of `body`'s night gradient; both pages' `theme-color` matches it                   |
| `--night-800`         | `#191d25`                                                                                                | The night gradient at 34%                                                                                            |
| `--parchment-200`     | `#f2e8da`                                                                                                | The no-JS links                                                                                                      |
| `--text`              | `#e5e4df`                                                                                                | Main text; the footer's About when hovered, pressed or expanded                                                      |
| `--text-primary`      | `var(--text)`                                                                                            | `body` text and the skip link                                                                                        |
| `--text-muted-accent` | `#bfc1bf`                                                                                                | Meta text, one tier below the main text                                                                              |
| `--text-accent`       | `var(--text-muted-accent)`                                                                               | The footer, the loading line and `.eyebrow`'s base colour (every eyebrow sits on paper, which overrides it)          |
| `--text-meta-shadow`  | `0 2px 8px rgba(7, 10, 14, 0.42)`                                                                        | The footer's and the loading line's text shadow                                                                      |
| `--border-soft`       | `rgba(241, 229, 212, 0.16)`                                                                              | The skip link's border                                                                                               |
| `--ui-focus`          | `#d0d1cc`                                                                                                | The focus ring on the night                                                                                          |
| `--cursor-line`       | A 9×28 SVG data URI of a pale vertical line (`#e6ece7`), hotspot `4 14`, then `auto`                     | The pointer over the night                                                                                           |
| `--max`               | `1180px`                                                                                                 | The widest `.section` column; narrower screens keep a 16px gutter each side (12px up to 640px wide)                  |
| `--gutter`            | `clamp(64px, 5.5vw, 160px)`, defined only from 1681px wide                                               | The hero's and the footer's side offset on very wide screens                                                         |

Colours that recur outside the tokens:

| Value                               | Use                                                                         |
| ----------------------------------- | --------------------------------------------------------------------------- |
| `#f7f1ea`                           | The name, the no-JS headings, selected text on the night                    |
| `#dfb882`, `rgba(223, 184, 130, …)` | The star's amber: the loading line's fill and glow, the selection wash      |
| `#e8ddc8`                           | The paper's ivory, on the dialogs and the 404                               |
| `#211c16`                           | Paper ink: headings, body copy, the Contact address, selected text on paper |
| `#60492e`                           | Eyebrows on paper                                                           |
| `#59472f`                           | The focus ring on paper and on the estate map                               |
| `#3b2c1e`                           | Close, Back and the 404's Home link                                         |
| `rgba(7, 10, 18, …)`                | The hero's and the bottom bar's scrims                                      |

## Breakpoints

### Layout

Each row is a media query in styles.css; queries that appear in several places are one row. `svh` sizes follow a `vh` fallback.

| Query                                                                     | What changes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| None (desktop)                                                            | The hero is `calc(100svh - 90px)` tall with the name bottom-left (`align-items: flex-end`), 72px top and `clamp(56px, 10vh, 104px)` bottom padding; the name is `clamp(48px, 8vw, 104px)`. The footer sits `max(30px, 22px + inset)` above the bottom and `max(20px, inset + 8px)` in from each side.                                                                                                                                                                                                                                                                                                                   |
| `(min-width: 1681px)`                                                     | Past the 1600px reference, `--gutter` is set; the hero leaves the centred 1180px column (`width: auto`, no auto margins) and pads by the gutter or the safe-area inset, whichever is larger; the footer's sides take the gutter too.                                                                                                                                                                                                                                                                                                                                                                                    |
| `(min-width: 761px) and (max-width: 1024px) and (orientation: portrait)`  | Tablets in portrait: the name moves to the top (`align-items: flex-start`, top padding `max(48px, 38px + inset)`) at `clamp(54px, 8vw, 72px)`; the hero block is `min(58vw, 440px)` with `clamp(24px, 5vw, 40px)` left padding; the intro is 31ch, 12px below the name; the site shell drops to 0.2; the bottom bar's spacer is 52px.                                                                                                                                                                                                                                                                                   |
| `(max-width: 820px)`                                                      | The hero fills the screen (`min-height: 100svh`), with top padding `max(22px, inset)` and bottom `max(82px, 70px + inset)`; the site shell drops to 0.24.                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `(max-width: 820px), (orientation: landscape) and (max-height: 500px)`    | The no-JS About loses its 90px top margin and starts at the fold, under a hero that already fills the screen.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `(max-width: 760px)`                                                      | The name moves to the top (`align-items: flex-start`; top padding `max(56px, 42px + inset)`, bottom `max(96px, 82px + inset)`); the hero block is `min(82vw, 420px)` with `clamp(14px, 4vw, 24px)` left padding, left-aligned.                                                                                                                                                                                                                                                                                                                                                                                          |
| `(max-width: 700px)`                                                      | The category paper takes one column: the vignette moves under the copy at 154px, 18px below it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `(max-width: 640px)`                                                      | The section gutter is 12px. The hero's top padding is `max(34px, 24px + inset)` and its bottom `max(124px, 104px + inset)`; the name is `clamp(44px, 13vw, 64px)`; the hero block is `min(84vw, 360px)` with `clamp(18px, 5vw, 30px)` left padding; the intro is 14px, 10px below the name. The footer's sides and the bottom bar's right padding are `max(16px, inset + 8px)`; the spacer is 48px. The dialog overlay pads `max(12px, inset)` top, 14px each side and `max(14px, inset)` bottom. The 404's text is 16px.                                                                                               |
| `(max-width: 600px)`                                                      | The category paper pads 62px 36px 48px, and its body copy is 16px with `overflow-wrap: anywhere` (Contact's keeps its own `clamp(17px, 1.55vw, 20px)`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `(max-width: 600px) and (orientation: portrait)`                          | The About map takes the 2:3 portrait art in a panel `min(100%, 440px)` wide, with its title at 24px, the destinations at 38% by 30% in their portrait positions and the labels at 19px. Squares count as portrait.                                                                                                                                                                                                                                                                                                                                                                                                      |
| `(orientation: landscape) and (max-height: 500px)`                        | Phones turned sideways. The hero fills the screen with the name at the top (top padding `max(12px, inset)`, bottom `max(68px, 58px + inset)`) at `clamp(34px, 8vh, 56px)`, at most 10ch wide; the hero block is `min(45vw, 300px)` with `clamp(14px, 3vw, 22px)` left padding and `max(8px, inset)` below; the intro is 24ch, 8px below the name. The bottom bar's right padding is `max(16px, inset + 8px)` and its spacer 44px. The dialog overlay pads 8px top, 12px each side and 10px bottom, or the safe-area inset where larger, and the 3:2 About map's width is capped by the height left inside that padding. |
| `(orientation: landscape) and (max-height: 500px) and (max-width: 700px)` | Small landscape phones: the category paper goes back to two columns with a 120px vignette beside the copy, 40px 48px padding and no minimum height, so the paper fits the screen and the backdrop around it stays tappable.                                                                                                                                                                                                                                                                                                                                                                                             |

### Input and preferences

| Query                                                                                | What changes                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `(hover: hover)`                                                                     | Every hover style, because touch browsers keep `:hover` after a tap: the footer's About brightens (`.site-footer__link:hover`) and underlines (`.site-footer__about:hover`); an estate destination tints and underlines its label; Close and Back tint and lift 1px; the Contact address's underline darkens; the 404's Home link tints. |
| `(hover: none), (pointer: coarse)`                                                   | The map labels keep a resting underline, and a pressed destination tints.                                                                                                                                                                                                                                                                |
| `@supports (-webkit-touch-callout: none)` with `(hover: none) and (pointer: coarse)` | Touch WebKit: the scene and site shells become `position: absolute`, `100vh` then `100lvh` tall from the top, so they extend beneath Safari's bottom toolbar. The bottom bar takes the footer's offset as its `bottom` with no bottom padding, which keeps its top edge, and its scrim is removed.                                       |
| `(prefers-reduced-motion: reduce)`                                                   | Transitions, entrance animations, lifts and smooth scrolling go ([Motion](#reduced-motion)).                                                                                                                                                                                                                                             |
| `(prefers-reduced-transparency: reduce)`                                             | The bottom bar's scrim is removed; the hero's stays, because it keeps the name legible over the scene. The loading line's track turns solid (`#34373c`) and its fill loses its glow.                                                                                                                                                     |
| `(forced-colors: active)`                                                            | The scene shell, vignette, site shell, both scrims and the loading line are removed. Controls, the paper, the estate map and the 404 sheet take system colours with borders, without paper textures, vignettes or map art; links and the footer's About are `LinkText`, an expanded control `Highlight`.                                 |
| `(forced-colors: active), (prefers-contrast: more)`                                  | The system cursor replaces the line cursor, and the title card's grain is removed.                                                                                                                                                                                                                                                       |
| `@supports (text-wrap: balance)`                                                     | The name and the 404 heading balance their lines with `overflow-wrap: normal`; otherwise they break with `overflow-wrap: anywhere`.                                                                                                                                                                                                      |

styles.css has no `prefers-reduced-data` query: [main.js](../src/main.js) and [quality.js](../src/scene/quality.js) read that preference ([Accessibility](ACCESSIBILITY.md#preferences)).

### Scene framing

The scene frames its subject around the hero and the bottom bar, so its layout rules mirror the hero's breakpoints. styles.css puts the name at the top on portrait screens (squares included) up to 1024px wide, and on landscape screens up to 760px wide or 500px tall; elsewhere it sits bottom-left.

**The stacked-layout helper.** `isStackedLayout(width, height)` in [directed-shots.js](../src/scene/directed-shots.js) says whether the name stacks above the subject. [cinematic.js](../src/scene/cinematic.js) re-exports it, and index.js reads it too.

```js
height >= width ? width <= 1024 : width < 600 && height > 500;
```

That is every portrait or square screen up to 1024px wide, and landscape screens narrower than 600px and taller than 500px. On the other landscape screens whose hero sits at the top (600 to 760px wide, or up to 500px tall: phones turned sideways), the scene frames the subject beside the name, as on desktop. Change the helper with the hero's breakpoints; `test/cinematic.test.mjs` holds sizes on each side of it.

| Rule                                                             | Where                                                                       | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cinematicSafeArea(width, height, hero, nav)`                    | cinematic.js                                                                | The box the shot fits into. Stacked: 20px from the left, from 24px under the hero (`max(24, hero.bottom + 24)`) down to 28px above the bottom bar. Portrait monitors (taller than wide, over 1024px wide): the name stays bottom-left, so the subject takes the full width from 32px under the top to 24px above the hero. Otherwise beside the name: from 32px under the top, starting 36px right of the hero, between 34% and 48% of the width. Always 24px clear on the right, at least 32px above the bottom edge, and at least 140 by 120px.                                                                                                                                                                                                           |
| `resolveDirectedShot(shot, width, height)` and `SQUAT_LANDSCAPE` | directed-shots.js                                                           | Picks a shot's variant. The portrait variant serves canvases taller than wide, stacked layouts, and landscapes up to 500px tall (the hero's own short-landscape breakpoint, 500 included) narrower than `SQUAT_LANDSCAPE` (1.55:1): squarish windows such as 599×499 or 700×480, where the wide variants push the star past the right edge. A shot's own `squat` variant takes those squarish windows first (Watch and tree: azimuth 40, so the star stays whole right of the name). Wider short landscapes, every landscape phone among them, take the landscape variant, or the compact one under 600px wide where a shot has one. The watch has both (camera height 0.55 and 0.4, azimuth −12); Watch and tree has a landscape variant (tilt −3° to 0°). |
| Text band                                                        | index.js, [postprocess.js](../src/scene/postprocess.js) `setTextProtection` | In film, the band that shades the top of the frame behind a stacked name applies only to stacked layouts under 900px wide, in shots whose `arc` is 2. Beside the name it would dim the subject.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Composition profile                                              | [quality.js](../src/scene/quality.js) `getSceneCompositionProfile`          | `portraitPhone` (portrait up to 760px wide, at least 1.15:1), `landscapePhone` (landscape up to 500px tall and 1000px wide), `tabletPortrait` (portrait, 761 to 1024px wide), `compact` (under 1100px wide) or `desktop`. It frames the orbit camera before a directed shot is ready.                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

index.js measures the hero with `layoutRect(#hero-minimal)`, an offset-chain box that ignores the hero's entrance and scroll transforms, and the bottom bar with its bounding box. It re-measures on every resize (a window `resize`, a ResizeObserver on the scene host, and `createPixelRatioWatcher` in [runtime.js](../src/scene/runtime.js) when only the device pixel ratio changes, as when a window moves to a display of another scale) and when fonts finish loading. The text guard measures the bounding boxes of `.hero h1`, `.hero-intro` and the About label on the same events, every 30th frame and after a scroll ([Contracts](CONTRACTS.md#dom)).

## Layers

The root stacking context, bottom to top:

| `z-index` | Layer                                                      | Notes                                                                                                                                                                                             |
| --------: | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|         0 | `.scene-shell` (fixed; absolute on touch WebKit)           | Its own context: the star field `::before` (0), the scene host `.scene-canvas` (1) and `.scene-vignette` (2), whose grain `::before` paints over the vignette's gradients. It clips its overflow. |
|         1 | `.site-shell` (fixed; absolute on touch WebKit)            | Above the live scene too.                                                                                                                                                                         |
|         2 | `main` (relative)                                          | Its own context. `.hero-minimal` isolates (`isolation: isolate`), so its scrim `::before` (−1) sits behind the name but above the scene and site shells.                                          |
|        10 | `.bottom-bar`, `.scene-loader`, `.site-footer` (all fixed) | They paint in source order, so the footer's About is on top. The bottom bar is a context of its own and keeps its scrim `::before` (−1) behind its spacer.                                        |
|        19 | `body::after` (fixed)                                      | The dim behind an open dialog. `pointer-events: none`.                                                                                                                                            |
|        20 | `.panel-overlay` (fixed, one per dialog)                   | The four dialogs; a closing and an opening dialog overlap here while they cross-fade.                                                                                                             |
|        80 | `.skip-link` (fixed)                                       | Above everything; off screen until focused, and `inert` while a dialog is open.                                                                                                                   |

Inside the dialogs:

- **Paper.** `.panel-parchment` is a context of its own (its `filter`). In it the sheet (`.panel-parchment__sheet`, relative, `isolation: isolate`) holds its grain `::before` and edge `::after` at −1 and its copy (`.panel-parchment__content`) at 2, above the unpositioned vignette. Back is sticky at 3, above the sheet.
- **Estate map.** `.estate-map` (relative, `isolation: isolate`) holds its paper backing `::after` at −2, the map art `::before` at −1, the title and the destinations (absolute, no `z-index`), and Close (absolute) at 2.

On the 404 the scene shell (0) holds the star field and the vignette with its grain; `main.section` (relative, 2) holds the sheet (`.story-shell`, relative, `isolation: isolate`) with its paper `::before` and edge `::after` at −1.

## Components

### Title card

The first paint on every path and the last on the static path ([Glossary](GLOSSARY.md)). It needs no script and requests no image.

- **Night.** `body`'s vertical gradient, `--night-900` to `--night-800` at 34% to `#0d1119`, under `.scene-shell`'s own background: two faint cool hazes, one where the moon sits in the opening shot (78% across, 16% down), over a veil that darkens toward the foot.
- **Star field.** `.scene-shell::before`: two tiling SVG data URIs of 40 stars each, on 640px and 1040px tiles that never line up. The stars are warm (`#efe8da`) with a few cool ones (`#d6dee8`), 0.4 to 1.1px in radius, and fade from 36% of the height to nothing at 84%. They and the hazes lie under the canvas, so only the title card shows them.
- **Vignette.** `.scene-vignette`: two faint pale glows in the upper left and upper centre, an elliptical darkening toward the edges and a vertical darkening toward the foot. It stays over the live scene.
- **Grain.** `.scene-vignette::before`: a 150px tile of fractal noise (`feTurbulence`, seed 7) split into faint white and black specks whose alphas balance near code value 23, on the night, so 8-bit screens show the gradients dithered rather than stepped. It lies above the canvas and below all text. At the reveal `#home-scene` gains `is-ready`, and `.scene-canvas.is-ready + .scene-vignette::before` fades the grain out with the canvas's 480ms fade-in; no `:has()` is needed. When the scene drops `is-ready` (a lost WebGL context, a failure after the reveal or teardown), the canvas fades out and the grain returns. It stays on the static path and on the 404, and is removed in forced colours and increased contrast.
- **Site shell.** `.site-shell`: faint vertical rules every 72px and a pale wash at the top, masked to fade out by 72% of the height, at opacity 0.34.

### Loading line

`#scene-loader`, on the live path only ([scene-loader.js](../src/ui/scene-loader.js); [Architecture](ARCHITECTURE.md#title-card-and-loading-line) has its progress model). It reads "Loading the estate · N%" over a 2px track, centred, one 44px row above the footer's offset, `min(240px, 100% - 48px)` wide, in the footer's meta type (12px/16px, 0.08em tracking, `--text-accent`, the meta shadow) with tabular figures and a fixed 4ch slot for the value. It takes no pointer events and cannot be selected.

- The track is `rgba(230, 226, 214, 0.16)`; the fill is the star's amber, `#dfb882`, with a soft glow, and only its `transform: scaleX()` moves, with real progress.
- `begin()` unhides it and adds `is-loading` (fade in). `end()` adds `is-done` (fade out within the canvas's fade-in) and hides it 600ms later. The reveal completes it at 100%; a hidden scene host or 15 s without progress retires it below 100%.
- It has no pseudo-element layer, keyframes or animation of its own.

### Hero

`#hero-minimal` inside `.hero.section`, the only content of `main` on the enhanced page.

- **Name.** The `h1`, two block `.hero-word` spans. Cormorant 700 with `font-synthesis-weight: none`, `#f7f1ea`, `clamp(48px, 8vw, 104px)` on desktop, line height 0.98, −0.015em tracking, at most 8ch wide, with a faint halo (`0 0 44px rgba(198, 208, 202, 0.1)`).
- **Intro.** `.hero-intro`: `#deddd9`, `clamp(14px, 1.25vw, 17px)`, line height 1.55, at most 30ch, balanced, 18px below the name, with a dark text shadow.
- **Scrim.** `.hero-minimal::before`: a soft oval of `rgba(7, 10, 18, 0.58)` at its centre with a (1 − t²)² falloff (`radial-gradient(closest-side, …)`), reaching 140px above, 196px right, 167px below and 240px left of the hero block, and transparent before every edge of its box. `main`'s `overflow-x: clip` keeps it from widening the layout viewport on phones.
- The hero's layout box and text bound the scene's framing and text guard ([Scene framing](#scene-framing)).

### Footer and About

`.site-footer`: fixed, `max(20px, inset + 8px)` from each side and `max(30px, 22px + inset)` above the bottom, a grid whose first column holds About. Meta type: 12px/16px, 0.08em tracking, `--text-accent`, the meta shadow. The footer takes no pointer events; its links do.

- About is two controls, each `.site-footer__link.site-footer__about` with an `.about-link__label` span: the no-JS link to `#about-text` (`data-scene-fallback`) and the About button (`.scene-entry`, `data-panel="about"`, `aria-controls="panel-about"`), which [scene-menu.js](../src/ui/scene-menu.js) shows in the link's place once the dialogs bind.
- `min-height: 44px` with `margin: -14px` and `padding: 0 14px` hang a 44px target around the 16px line. The focus ring is drawn 12px inside (`outline-offset: -12px`), 2px clear of the text.
- Real hover brightens it to `--text` and underlines it (`rgba(229, 228, 223, 0.5)`, 3px offset). Pressed or expanded (`aria-expanded="true"`, while About or a category opened from it shows), it is `--text`.

### Bottom bar

`.bottom-bar` (`aria-hidden`): a fixed band across the screen's foot holding one empty spacer, `.bottom-btn--icon`, 52px square (48px up to 640px wide, 44px on short landscapes). Its top edge bounds the scene's framing, so the spacer keeps the band's height without a control. Its scrim, `.bottom-bar::before`, reaches 52px above the band: an ellipse centred on the bottom edge with a horizontal radius of 34% of the width, `rgba(7, 10, 18, 0.56)` at its centre and transparent along its top and sides. Reduced transparency, forced colours and touch WebKit remove the scrim.

### About estate menu

`#panel-about`: the illustrated estate map as a menu ([Assets](ASSETS.md#page-artwork) has the art).

- `.panel-estate` is `min(100%, 960px, (100svh - 48px) × 1.5)` wide, so the 3:2 map fits the overlay's usable height; short landscapes cap it by the height inside their own overlay padding, and portrait screens up to 600px wide take the 2:3 map at `min(100%, 440px)`.
- `.estate-map` keeps the art's ratio. Its `::before` paints the map art with a little directional light (`brightness(1.015)` and two drop shadows); its `::after` is a solid paper fill (`#e6d3af`) inset 2% behind the art.
- The title, the `h2` About, is centred near the top in Cormorant 600, `clamp(22px, 3vw, 34px)` (24px on portrait).
- Profile, Experience and Contact are `button.bottom-btn.estate-destination`s placed and sized in the art's proportional coordinates (24% of the width on the 3:2 map, 38% on the 2:3 one, and at least 44px square), in a nav named Site categories. Each label is a Cormorant 600 span at the target's foot, `clamp(18px, 2.5vw, 29px)` (19px on portrait). Real hover tints the target (`rgba(78, 54, 26, 0.035)`) and underlines the label; on touch screens the label keeps a resting underline and a press tints. Keyboard focus draws a 2px `#59472f` ring 3px out with the same faint tint.
- Close (×, named Close About) sits 16px from the map's top right corner: a 44px circle on a pale wash (`rgba(242, 230, 203, 0.58)`).

### Category dialogs

`#panel-profile`, `#panel-experience` and `#panel-contact`: cotton paper with dark, selectable ink.

- **Paper.** `.panel-parchment` is `min(100%, 720px)` wide with two soft drop shadows. Its sheet (`.panel-parchment__sheet`) is a grid of the copy and a 180px vignette column, at least 370px tall, padded 64px 64px 70px. The sheet's `::before` (23px in) is ivory `#e8ddc8` under a 115° light and the 384px paper grain, so the copy stays readable while the image loads or if it fails; its `::after` is the deckled edge, `border-image: url("/images/paper-edge.webp") 96 / 24px / 0 stretch`.
- **Copy.** An eyebrow (`#60492e`), the `h2` (Cormorant 500, `clamp(34px, 4vw, 52px)`, at most 13ch, balanced) and the body (Instrument Sans 17px/1.65, at most 38ch, `text-wrap: pretty`), all in `#211c16` but the eyebrow.
- **Vignette.** `.panel-vignette--profile|experience|contact`: a decorative drawing (`aria-hidden`, no pointer events, not selectable) at the foot of its own column, never under the copy, multiplied into the paper at 0.7 opacity. It moves under the copy up to 700px wide and back beside a shorter sheet on small landscape phones ([Breakpoints](#layout)).
- **Back.** `button.panel-close.panel-back`, named Back to About, at the paper's top right corner: 30px in, wholly clear of the 24px edge, 44px high and at least 64px wide, 13px type. It is sticky (`top: max(12px, inset)`), so it stays in view while a tall paper scrolls. Real hover and keyboard focus tint it (`rgba(88, 72, 50, 0.16)`, ink `#241910`) and lift it 1px; a press tints deeper without lifting.
- **Contact address.** The Contact paper's one action, a literal `mailto:` link in Cormorant 500 `clamp(24px, 2.4vw, 30px)`, `#211c16`, underlined at `rgba(94, 76, 52, 0.48)`. Its 8px block padding makes a 44px target and its `margin-block: 0 -8px` takes the bottom padding back, so the line does not move. Real hover darkens the underline to the ink colour; a press also thickens it to 2px.

### Skip link

`.skip-link`, Skip to main content: a 44px pill (`rgba(14, 18, 34, 0.88)`, `--border-soft`, `--text-primary`) fixed `max(14px, inset)` from the top left. Unfocused it sits above the screen by its own height, its top offset and 8px more, so it never shows below a notch; focus slides it into view. It targets `main` (`tabindex="-1"`), which takes focus without a ring.

### No-JS fallback

`#about-text` in `main`, with `data-scene-fallback` on it and on the footer's About link. [scene-menu.js](../src/ui/scene-menu.js) hides both once `initPanels()` succeeds, and not while focus is inside either.

- It starts at the fold on every screen: 90px below the desktop hero, which ends 90px above the fold, and directly under the full-height hero on phones (up to 820px wide, or landscape up to 500px tall). The title card shows alone until the visitor scrolls.
- A 720px column with 48px 24px 160px padding. The `h2` About (40px) and the `h3` sections (28px) are Cormorant 500 in `#f7f1ea`; the heading, the nav named Categories and the sections share one 640px centred column.
- The links are `--parchment-200`, underlined at `rgba(198, 208, 202, 0.48)`, `inline-flex` with a 44px minimum height. Each section takes focus (`tabindex="-1"`).

### Focus, selection and cursor

- **Focus.** `:focus-visible` draws a 3px `--ui-focus` ring 4px out. On paper and on the 404 sheet the ring is `#59472f`; on the estate map (destinations and Close) it is 2px `#59472f`, 3px out.
- **Selection.** On the night, a wash of the star's amber (`rgba(223, 184, 130, 0.32)`) with `#f7f1ea` text; on the paper, the estate map and the 404 sheet, a stronger wash (0.45) with `#211c16` ink.
- **Cursor.** The pale line cursor (`--cursor-line`) over the night; the pointer over links and buttons, with no tap highlight; the system cursor over dialog overlays and the 404 sheet, and everywhere in forced colours and increased contrast.
- **Pressed.** `:active` states never lift. They apply on every device to the footer's About, Close and Back, the estate Close, the Contact address and the 404's Home link; a destination's press tint applies on touch screens.

## Motion

Every animation and transition in the stylesheet, and the one scripted motion. The stylesheet has one keyframes rule, `hero-reveal` (8px up to rest, `transform` only).

| What                | Property                                                                                                            | Duration and easing                                          | Notes                                                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Hero entrance       | `hero-reveal`                                                                                                       | 720ms `cubic-bezier(0.22, 1, 0.36, 1)`, fill `backwards`     | No forwards fill, so hero.js's inline scroll transform applies once it ends                                                        |
| Footer entrance     | `hero-reveal`                                                                                                       | 820ms `ease` after 560ms, fill `both`                        |                                                                                                                                    |
| Hero scroll fade    | inline `opacity` and `transform` ([hero.js](../src/ui/hero.js))                                                     | Each frame closes 16% of the gap to the target               | At progress p (the scroll over 58% of the viewport height, at most 1): opacity 1 − 1.14p, 22p px down, scale 1 − 0.025p            |
| Canvas fade-in      | `.scene-canvas` `opacity` 0 to 1                                                                                    | 480ms `ease-out`                                             | On `is-ready`. terrain-build.js, mountain-build.js and light-shafts.js read this `transitionDuration`; keep it a single transition |
| Title-card grain    | `.scene-vignette::before` `opacity` 1 to 0                                                                          | 480ms `ease-out`                                             | With the canvas, through the sibling selector                                                                                      |
| Loading line in     | `opacity`                                                                                                           | 320ms `ease` after 240ms                                     |                                                                                                                                    |
| Loading line out    | `opacity`                                                                                                           | 360ms `ease` after 120ms                                     | Done by 480ms, within the canvas's fade-in                                                                                         |
| Loading fill        | `transform: scaleX()`                                                                                               | 520ms `cubic-bezier(0.22, 1, 0.36, 1)`; 240ms once done      | Moves only with real progress                                                                                                      |
| Dim behind dialogs  | `body::after` `opacity`                                                                                             | In 440ms `ease`, out 240ms `ease`                            | Holds steady while the map and paper cross-fade; the render hold starts 450ms after opening, once it is in                         |
| Dialog overlay      | `.panel-overlay` `opacity`                                                                                          | In 440ms `ease`, out 240ms `ease`                            | panels.js hides it after its `opacity` transition ends, or after 320ms                                                             |
| Dialog surface      | `.panel-surface` `transform` from `perspective(1200px) translateY(18px) scale(0.985) rotateX(4deg)`, origin 50% 80% | In 440ms `cubic-bezier(0.2, 0.7, 0.25, 1)`, out 240ms `ease` | The lift into light: 18px up with a shallow tilt                                                                                   |
| Close and Back      | `transform` (a 1px lift), `background`, `color`                                                                     | 160ms `ease`                                                 | Lift on real hover and keyboard focus; none when pressed                                                                           |
| Contact address     | `text-decoration-color`                                                                                             | 160ms `ease`                                                 |                                                                                                                                    |
| Footer About        | `color`                                                                                                             | 180ms `ease`                                                 | `.site-footer__link`'s transition replaces the button's `.bottom-btn` one                                                          |
| Estate destinations | `background-color` (`.bottom-btn`)                                                                                  | 180ms `ease`                                                 |                                                                                                                                    |
| 404 Home link       | `background`, `border-color`, `color`                                                                               | 180ms `ease`                                                 |                                                                                                                                    |
| Skip link           | `transform`                                                                                                         | 180ms `ease`                                                 | Slides in on focus                                                                                                                 |
| In-page scrolling   | `html { scroll-behavior: smooth }`                                                                                  | The browser's                                                |                                                                                                                                    |

Nothing on the page animates in a loop, and the loading line has no glint: its bar moves only with real progress.

### Reduced motion

Under `prefers-reduced-motion: reduce`:

- `transition: none` on the skip link, the hero block, `.bottom-btn` (the About button and the destinations), the footer's links, the dialog overlays and surfaces in both states, Close and Back, the Contact address, the 404's Home link, the dim (`body::after`), the canvas, the title card's grain and the loading line with its fill. The canvas and the grain change at once at the reveal; the loading line appears and goes at once.
- `animation: none` on the hero block and the footer.
- `transform: none` on the dialog surface and on Close and Back when hovered or focused.
- `scroll-behavior: auto`.
- hero.js holds the hero at full opacity with no transform, and follows the preference as it changes.
- panels.js hides a closing dialog at once, and finishes any close in progress when the preference turns on.
- main.js loads no live scene unless the address forces it ([Accessibility](ACCESSIBILITY.md#preferences)); a forced scene holds the tour and the drift.

## Dialogs

[panels.js](../src/ui/panels.js) runs all four. `initPanels()` binds only when every `.bottom-btn[data-panel]` has its `#panel-ID` and each dialog has a surface (`.panel-surface`) and a `.panel-close`; a failed binding removes every listener it added, so a later call can retry.

**Opening.** The About button and each destination are `.bottom-btn[data-panel]` buttons. Pressing one:

1. When the button is a destination inside the open About, puts About on the Back stack with the control that opened About and the destination.
2. Starts closing the dialog that was showing, so the two cross-fade over the steady dim.
3. Unhides the new dialog, removes its `aria-hidden` and `inert`, and adds `open` after a forced reflow, so its transition runs.
4. Sets `aria-expanded`: `true` on the button for the open dialog and on About while a category opened from it shows.
5. Makes the background `inert` and sets `body[data-panel-open="true"]`.
6. Focuses the dialog's `.panel-close`, without scrolling: Close (×) in About, Back in a category.
7. Dispatches `babel:panelchange` with the dialog now showing ([Contracts](CONTRACTS.md#events)).

**Closing.** Close, Back, Escape and the backdrop all close the active dialog.

- From a category opened from About, About reopens, focus returns to the destination that opened the category, and `babel:panelchange` names About.
- Otherwise the dialog closes, `aria-expanded` resets, the background leaves `inert`, `data-panel-open` goes, focus returns to the control that opened it (the footer's About), and `babel:panelchange` names none.
- A closing dialog loses `open` and becomes `aria-hidden` and `inert` at once. It gets `hidden` when its overlay's `opacity` transition ends, or after 320ms if none arrives; reopening it first cancels that.
- The backdrop is the overlay itself, around the surface. It dismisses only when the press (`pointerdown`) and the click both land on it, so a drag-select from the paper never closes a dialog.

**Focus trap.** While a dialog is open, Tab and Shift+Tab wrap between its first and last focusable controls (`button:not([disabled])`, `a[href]` and `[tabindex]` other than −1, not `hidden` or `inert`), and focus that has left the dialog comes back to it. About cycles through Close and its three destinations; a category through Back, and in Contact the address.

**Background.** `inert` goes on `.skip-link`, `.scene-shell`, `.site-shell`, `main`, `.bottom-bar` and `.site-footer`. The loading line is not on the list: it is `aria-hidden`, holds no control and takes no pointer events.

**Scroll lock.** `body[data-panel-open="true"]` sets `overflow: hidden`, so the page cannot scroll; `html` and `body` always set `overscroll-behavior: none`. The overlay scrolls its own content (`overflow-y: auto`, `overscroll-behavior: contain`) and reserves a scrollbar gutter on both edges, so a classic scrollbar never pushes the paper off centre. A short surface centres (`margin-block: auto`); a tall one starts at the top and scrolls under the sticky Back.

**Render hold.** The scene reads `body[data-panel-open]` ([index.js](../src/scene/index.js)). The tour holds at once, and the flame, flicker and drips freeze. 450ms after a dialog opens, once the 440ms dim has faded in, rendering stops (`createPanelHold` in runtime.js, synced by a MutationObserver on `body`). A resize behind a dialog draws one frame. The hold ends with the last dialog, and the governor then takes no samples for 3 s. Without MutationObserver the tour still holds, but rendering does not stop. The loading line's stall clock skips time with a dialog open.

**Art warm-up.** The map and paper art downloads only when a dialog paints it, so [scene-menu.js](../src/ui/scene-menu.js) fetches it ahead of the first open. Once the About button is live, the first `pointerenter`, `focusin` or `touchstart` on it (passive listeners, all three removed after the first) reads the URLs the computed styles already name, the build's hashed copies:

- the estate map's `::before` `background-image`, for the current media (desktop or portrait art);
- the paper sheet's `::before` `background-image` (the grain);
- the paper sheet's `::after` `border-image-source` (the edge).

Each URL loads once through `new Image()` with async decoding, into the browser's cache. The vignettes are not warmed. The warm-up never runs when `BabelSite.scene.detectSaveData()` ([quality.js](../src/scene/quality.js)) is true: `navigator.connection.saveData`, or `prefers-reduced-data: reduce`. It does nothing without `getComputedStyle` or `Image`, and any error leaves the dialogs to load their own art.

## Deep links

[deep-links.js](../src/ui/deep-links.js) binds only after the enhanced menu succeeds (`initSceneMenu()` returns `true` in [main.js](../src/main.js)); without it the `-text` hashes stay native anchors into the no-JS fallback.

| Hash                              | Opens                 | Through                                   |
| --------------------------------- | --------------------- | ----------------------------------------- |
| `#about`, `#about-text`           | About, the estate map | The About button                          |
| `#profile`, `#profile-text`       | The Profile paper     | The About button, then Profile on the map |
| `#experience`, `#experience-text` | The Experience paper  | The About button, then Experience         |
| `#contact`, `#contact-text`       | The Contact paper     | The About button, then Contact            |

- Dialogs open by pressing the same buttons a visitor presses, so focus, the Back stack and Escape behave as by hand: Back from a deep-linked category returns to About.
- A hash is read at startup and on every `hashchange`. It must match exactly (`#Profile` and `#about-textual` open nothing). An unknown hash, such as the skip link's `#main`, is ignored; an empty one closes any open dialog, a category through About.
- Moving from one category's hash to another's goes through About: Back, then the other destination. A hash naming the dialog already open opens nothing again.
- The address follows the dialog showing through `history.replaceState`, keeping the path, the query and `history.state`, so dialogs add no history entries. It is written on every `babel:panelchange` whose hash differs from the address (an open, a step back to `#about`, the final close to no hash at all), which also settles a `-text` alias on the plain hash, and when an alias names the dialog already open.
- A document that refuses `replaceState` keeps its dialogs working and its address unchanged; without `CustomEvent` the dialogs work and the address does not follow them.

## The 404 page

[404.html](../404.html): one cotton-paper sheet centred on the same night. Cloudflare Pages serves it, with status 404, for a path that has no file and no redirect.

- **Head.** Parity with the homepage where the two overlap: the same viewport (`viewport-fit=cover`), `theme-color` `#0c1016`, `color-scheme` `dark`, description, icons (`favicon.ico`, `favicon.svg`, `apple-touch-icon.png`) and font preloads, and the same stylesheet. Its title is its own. It has no script, manifest, canonical link, social tags or structured data. `test/markup-accessibility.test.mjs` holds the icons, preloads, description and colour scheme equal.
- **Page.** `body.not-found` is a grid that centres `main.section` (32px block padding). Behind it is the scene shell with the star field and the vignette; no scene host precedes the vignette, so its grain stays. There is no site shell, skip link, footer or loading line.
- **Paper.** `.story-shell`, `min(100%, 560px)` wide, padded `clamp(56px, 8vw, 72px)` by `clamp(44px, 8vw, 72px)`, with the dialogs' paper: the same ivory, 115° light, 384px grain and deckled edge, and two drop shadows. Ink is `#211c16`, the eyebrow `#60492e` and the text `#393229`. The `h1` is Cormorant 500 `clamp(34px, 5vw, 52px)`, at most 12ch, balanced where supported; the text is 18px/1.72 (16px up to 640px wide), at most 46ch. The sheet takes the system cursor and the paper's focus ink.
- **Home link.** `.back-link` to `/`: a 44px pill (12px 18px padding, `rgba(88, 72, 50, 0.08)` with a `rgba(64, 47, 30, 0.22)` border, `#3b2c1e`, no underline). Real hover deepens it, a press deeper still, without a lift.
- **Copy.** Fixed, like all the site's words ([Content](CONTENT.md)). [smoke-pages.sh](../.github/scripts/smoke-pages.sh) requests a missing path on the deployed site and requires status 404, the `alexnava.me` host and the heading That page isn't here. in the body; `test/smoke-pages.test.mjs` mocks the same heading. The words change only with the owner's approval; the heading then changes in 404.html, smoke-pages.sh (a CI file, which needs authorization), `test/smoke-pages.test.mjs` and `test/markup-accessibility.test.mjs` ([Content](CONTENT.md#change-the-copy)).
- In forced colours the sheet is `Canvas` with a `CanvasText` border, no paper art, and the Home link `LinkText`.
