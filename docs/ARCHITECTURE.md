# Architecture

## Overview

alexnava.me is a static site: two pages, one stylesheet, a small UI script and a deferred Three.js scene, built by esbuild into `dist/` and served by Cloudflare Pages. The page never depends on the scene. The title card (a night sky drawn in CSS, the identity and About) is the first visual, and it is final for static visitors. Capable devices load the scene behind it, reveal it once it can draw, and tour seven directed shots of a timber lookout tower and a twisted tree with a lantern.

The UI and scene bundles meet only on `window.BabelSite`. The UI publishes `BabelSite.ui`, `BabelSite.sceneLoader` and the quality helpers on `BabelSite.scene`; the scene entry adds the rest of `BabelSite.scene` (`initHomeScene`, `disposeHomeSceneRuntime`, `setVisitorPaused`, `isVisitorPaused`). User Timing names start with `babel:`; build-time defines are `__BABEL_*__`.

## Page and startup

[src/main.js](../src/main.js) boots in this order:

1. `initUi()` wires the hero, the About estate menu, its Profile, Experience and Contact dialogs, and deep links. Navigation never waits for the scene.
2. After first paint (`requestIdleCallback`, 500 ms timeout) it applies the static gates. The scene host is hidden and no scene script is requested when reduced motion or reduced data is preferred (including `navigator.connection.saveData`), when WebGL is unavailable or software-rendered (SwiftShader, llvmpipe, Microsoft Basic Render Driver), or when the startup tier is low. `?quality=high|balanced` and `?sceneDebug=1` pass the preference and software gates, never the WebGL gate. There is no user-agent, Lighthouse or viewport exception. A visitor whose reduced-motion or reduced-data preference later clears gets the scene then.
3. The startup tier comes from [quality.js](../src/scene/quality.js), which the UI bundle carries, and the limits the WebGL probe already read. Unknown limits leave the choice to the scene.
4. `sceneLoader.begin({ tier })` starts the loading line. main.js appends the scene entry as a module script and, just before it, a `<link rel="modulepreload">` for each chunk the entry imports statically (`__BABEL_SCENE_MODULE_PRELOADS__`: the shared Three.js chunk), so both download together. No lazy chunk is preloaded.
5. It then requests the startup tier's tower and tree at low fetch priority (`__BABEL_ARCHITECTURE_PREFETCH_URLS__`; a hidden page waits until shown) and shares the responses on `BabelSite.scene.prefetched`, keyed by URL. [architecture-assets.js](../src/scene/architecture-assets.js) takes a matching response at most once; the rest are aborted when the live selection starts, at teardown, or when the bundle or initialization fails.
6. When the bundle has run, main.js reports `stage("bundle")`, calls `initHomeScene()` and reports `stage("init")`. A failed bundle or initialization hides the host and calls `end("static")`. A failed module load removes its script so a later call can retry.

### Title card and loading line

There is no picture on the site. index.html and styles.css paint the title card: the night gradient, a CSS star field (`.scene-shell::before`) and the vignette under the identity and About. The 404 page shares the night.

On the live path [src/ui/scene-loader.js](../src/ui/scene-loader.js) (`BabelSite.sceneLoader`) shows one line, `#scene-loader`, above the footer. Its value is real progress: 10% bundle, 4% initialization, 70% model bytes and 12% model build, a running maximum held at 96% until the reveal. Bytes count the required models (the tower, plus the tree for `view=tree`): `track(url, response)` reads each model response into a copy as it arrives and counts decoded bytes against the sizes build.mjs defines for the UI (`__BABEL_ARCHITECTURE_PREFETCH_BYTES__`). Build follows the scene's measures `babel:glb-parse:<role>`, `babel:assembly:<role>` and `babel:shaders:<role>`. A MutationObserver on `#home-scene` ends the run: gaining `is-ready` is the reveal (100%, then the line fades within the canvas's fade-in), and `hidden` retires the line below 100%. A watchdog retires it after 15 visible seconds without progress. `.scene-canvas` keeps one 480 ms opacity transition; terrain-build.js, mountain-build.js and light-shafts.js read it as `transitionDuration`.

## Module map

_lazy_ marks a chunk loaded on demand.

**Pages (repository root)**

| File         | Role                                                              |
| ------------ | ----------------------------------------------------------------- |
| `index.html` | Identity, About, dialogs, fallback text, scene host, loading line |
| `404.html`   | Not-found page on the same night                                  |
| `styles.css` | Type, layout, paper surfaces, title card, loading line            |

**UI bundle (`src/`)**

| File                    | Role                                                  |
| ----------------------- | ----------------------------------------------------- |
| `app.js`                | UI entry: imports the modules below, then main.js     |
| `main.js`               | Boot, static gates, scene and early model requests    |
| `ui/hero.js`            | Hero chrome and scroll state                          |
| `ui/panels.js`          | Dialogs, focus, Back and Escape, `data-panel-open`    |
| `ui/scene-menu.js`      | The About estate menu                                 |
| `ui/deep-links.js`      | `#profile`, `#experience` and `#contact`              |
| `ui/scene-loader.js`    | Loading line (`BabelSite.sceneLoader`)                |
| `shared/webgl-probe.js` | WebGL probe and cached limits (both bundles)          |
| `shared/motion.js`      | Reduced-motion helpers (both bundles)                 |
| `scene/quality.js`      | Tiers, profiles, composition, governor (both bundles) |

**Scene core (`src/scene/`; the entry is `src/scene-entry.js`)**

| File              | Role                                                |
| ----------------- | --------------------------------------------------- |
| `index.js`        | Assembly, reveal, holds, commits, `sceneDebug`      |
| `runtime.js`      | Scheduler, cadence, holds, warm-ups, deferred steps |
| `subsystem.js`    | Subsystem registry and lifecycle                    |
| `rendering.js`    | Renderer, lights, shadows, shader compilation       |
| `postprocess.js`  | Composer, grade, bloom, ink, dissolve               |
| `depth-layers.js` | Depth-layer codes for the dissolve                  |
| `perf-marks.js`   | `babel:` marks and measures                         |
| `helpers.js`      | Ground height and math on `BabelSite.scene`         |
| `palette.js`      | Ground palette                                      |
| `world.js`        | World constants                                     |

**Camera (`src/scene/`)**

| File                | Role                            |
| ------------------- | ------------------------------- |
| `directed-shots.js` | Shot definitions and holds      |
| `cinematic.js`      | Shot fitting, drift and push-in |
| `camera-tour.js`    | Tour pacing and dissolve timing |
| `scene-modes.js`    | Opening view from `?view=`      |

**Models (`src/scene/`)**

| File                     | Role                                         |
| ------------------------ | -------------------------------------------- |
| `architecture-assets.js` | Model manifest, requests, validation, leases |
| `architecture.js`        | Tower and tree materials and grades          |
| `tree-normals.js`        | Tree normal smoothing                        |
| `prop-scale.js`          | Tree and lantern scale and grounding         |
| `lantern.js`             | Lantern mount over the tree's stand-in       |
| `lantern-flame.js`       | _lazy_ Flame and glass shading               |
| `estate-layout.js`       | Tower, tree, lantern and path anchors        |

**Sky and mountains (`src/scene/`)**

| File                 | Role                                        |
| -------------------- | ------------------------------------------- |
| `atmosphere.js`      | Sky shell, clouds, nebula octaves           |
| `estate-sky.js`      | Film sky gradient, horizon band, clouds     |
| `celestial-field.js` | Shared nebula frame and dust                |
| `starfield.js`       | Stars (`STAR_COUNTS`)                       |
| `solar-body.js`      | The star and its prominences                |
| `hill-silhouette.js` | Baseline hills, mountain material, stand-in |
| `mountain-build.js`  | _lazy_ Film mountain geometry               |
| `light-shafts.js`    | _lazy_ Star rays and moonbeams (WebGL2)     |

**Ground (`src/scene/`)**

| File                      | Role                                                 |
| ------------------------- | ---------------------------------------------------- |
| `environment.js`          | Ground root and its children                         |
| `textures.js`             | Procedural ground canvases                           |
| `film-scene.js`           | Film treatment; borrows and restores the ground      |
| `filmic-earth.js`         | Slate map preset and terrain size                    |
| `stone-detail.js`         | Slate maps by asset tier                             |
| `mud-ground.js`           | Slate, wetness, puddles, contacts                    |
| `estate-ground-detail.js` | Tufts and the winding path                           |
| `terrain-build.js`        | _lazy_ Terrain, root supports, puddle mirror, litter |
| `rock-scatter.js`         | Rock clusters and contacts                           |
| `rock-build.js`           | _lazy_ Rock placement and instancing                 |

## Scene lifecycle

- **Subsystems.** Each scene part registers with a registry ([subsystem.js](../src/scene/subsystem.js)) as an object with optional `applyQuality`, `resize`, `update` and `dispose` hooks; a missing hook is a no-op. Hooks run in `lifecycleOrder`. Disposal runs in reverse registration order, continues past a failing subsystem and rethrows the first error. A throw during initialization disposes what was registered, and nothing registers after disposal.
- **Borrowed resources.** A subsystem that derives from another's geometry, materials or programs restores the originals before freeing its own: the film terrain over the procedural ground, the lantern mount over the stand-in lantern, and the light shafts' and slate's shader hooks over the materials they extend. Quality changes and failed or stale loads keep a usable fallback.
- **Asset leases.** architecture-assets.js loads the tower, tree, lantern and rocks for the startup tier. A decoded asset is held by a lease through staging, commit and restoration; aborted or stale results are released through the same path. The tower and tree are required. The lantern and rocks are optional and never hold the reveal.
- **Reveal.** Until a directed shot is ready the hidden canvas keeps the pre-reveal orbit camera and redraws only when invalidated. Programs link through `renderer.compileAsync` with `KHR_parallel_shader_compile` (`createShaderWarmup`, each warm-up bounded at 2 s). Before the reveal nothing draws while a warm-up is pending, and the reveal waits for it. The first frame that can show marks `babel:reveal`, adds `is-ready` to `#home-scene` and starts the 480 ms fade-in. Afterwards a committed model stays hidden until its programs are linked.
- **Commit points.** A change that would pop mid-shot lands only before the reveal, inside the fade-in, on a tour cut under the dissolve's kept frame, or on a still frame while the tour is not running: the lantern, the rocks, the film terrain, light-shaft treatments, the slate's root shading and adaptive quality steps (`createDeferredQualityStep`, waiting at most 30 s). The mountains, and a light still building when its shot opens, fade in instead.
- **Holds.** An open dialog holds the tour at once and, 450 ms later, after the dim overlay has faded in, stops rendering until the last dialog closes (`createPanelHold`). `scene.setVisitorPaused()` holds the tour and, from the reveal, rendering (`createVisitorHold`); `scene.isVisitorPaused()` reads it. Behind a hold, a resize, context restore or content change draws one still frame; scroll does not.
- **Failure.** If the tower or tree cannot load, `failToTitle()` stops the scene at once (a host never shown is hidden; a shown canvas fades back to the title card) and disposes the runtime on a later tick, once in-flight warm-ups settle. There is no fallback world. A lantern failure keeps the tree's built-in lantern.
- **Diagnostics.** `?sceneDebug=1` publishes a read-only status object, `BabelSite.sceneDebug`; [Scene modes](SCENE-MODES.md) lists its fields. There are no developer controls.

## Rendering and quality

The scene runs on the high and balanced tiers only; the low tier keeps the title card. quality.js picks the startup tier: a data-saver request, 2 GB or less of device memory, or weak limits (textures under 4096 or anisotropy under 4) give low; four cores or fewer, a phone-sized touch viewport, a touch device without flagship limits, or a short side under 340 px give balanced; the rest get high. `?quality=` overrides it.

|                     | High      | Balanced |
| ------------------- | --------- | -------- |
| Pixel-ratio cap     | 1.5       | 1.25     |
| Shadows             | 2048 map  | off      |
| Bloom               | on        | off      |
| Scene MSAA (WebGL2) | 4 samples | none     |
| Stars               | 4200      | 2600     |

Touch-primary devices cap the pixel ratio at 1.25 on every tier. The composer's targets follow the canvas in device pixels; the renderer's own antialiasing is off. Star sprites, prominences, bloom and the ink contour are sized in CSS pixels. Models and slate maps keep the startup tier (`assetTier`), so a quality step never re-downloads them.

The governor samples display intervals only after the reveal, and not for 3 s after a resize, resume, dialog release or asset commit; a dissolve's capture, cut and first blended frames are skipped. A 60-frame window averaging over 20 ms for 120 consecutive frames steps down one tier. A revealed scene never draws the low profile: its low step keeps the profile and lowers only the pixel ratio to 1. Recovery needs 300 frames whose window average stays under the larger of 15 ms and 1.1 times its 10th percentile, counted only while that percentile is at most 17.5 ms (a display at 60 Hz or faster that keeps up), and 10 s since the last change; each recovery followed by another downgrade doubles both, and after two such oscillations recovery stops. While the tour runs, a step waits for the next cut; where the browser links programs in parallel, it links them first (`rendering.prepareQuality()`).

[runtime.js](../src/scene/runtime.js) renders only visible frames, on an even cadence: every nth vsync of the estimated refresh rate near 60 Hz (144 Hz draws 72 fps; touch screens stay at or below 60). The sun's shadow map redraws only after a shot, quality, resize, model or treatment change. A ResizeObserver on the host resizes the renderer with `setSize(width, height, false)`. rendering.js checks the WebGL context before entering the composer, so a lost context is caught before Three.js hears of it. The page opens two WebGL contexts, the probe and the renderer, both with `powerPreference: "default"`.

## Assets and budgets

Sizes in bytes. Models are GLBs with `KHR_mesh_quantization` and embedded WebP maps (`EXT_texture_webp`), prepared from the supplied originals ([Credits](CREDITS.md)); the slate maps are WebP.

| Asset                     |      High | Balanced |
| ------------------------- | --------: | -------: |
| tower                     | 1,869,912 |  920,408 |
| tree                      | 2,028,412 |  896,532 |
| lantern                   | 1,067,876 |  872,188 |
| lichen-rock               |   287,212 |  113,000 |
| weathered-stone           |   279,764 |  111,632 |
| slate color (1024 / 512)  |   193,482 |   65,168 |
| slate normal (1024 / 512) |   361,594 |  111,126 |
| slate detail (512)        |    24,542 |   24,542 |

The complete scene, everything above for one tier, is 6,112,794 bytes on high against a 6 MiB budget (6,291,456) and 3,114,596 on balanced against 3 MiB (3,145,728).

The loader rejects any single model over its tier's budget. Script budgets: the UI bundle under 30 KiB, and the scene entry plus the chunks it imports statically under 820 KiB; lazy chunks are outside that total.

## Build pipeline

[build.mjs](../build.mjs) writes `dist/` through [tools/build-output.mjs](../tools/build-output.mjs), which stages the payload, replaces assets before HTML and rolls back if publication fails.

- **Scripts.** The scene builds first, as ESM with code splitting: the entry, one shared chunk that may hold only third-party code (the build refuses a first-party module there, since it would evaluate before the entry's ordered imports), and five lazy chunks. Chunks are named after the hash of their final bytes, dependencies first, so any change yields a new entry URL. The UI then builds as one IIFE that names the entry's static chunks for preloading. The scene entry receives the model and slate manifests as string literals (`__BABEL_ARCHITECTURE_URLS__`, `__BABEL_MATERIAL_URLS__`); the UI receives only each tier's tower and tree URLs and sizes.
- **Fingerprints.** Scripts, CSS, the paper and estate-map artwork, every model, the slate maps and the fonts publish only as `name.HASH.ext` (eight hex digits of SHA-256), immutable for a year. The fonts are discovered from `fonts/*.woff2`. The stylesheet's `url()`s are rewritten before minifying, from LF bytes, and the pages' asset paths with exact replacements; an un-hashed stylesheet, script or font path, or a `?v=` query, left after the rewrite fails the build.
- **Legal comments.** esbuild keeps license comments at the end of each output (`legalComments: "eof"`); the shared chunk ends with Three.js's notice.
- **Shader compaction.** [tools/shader-compact.mjs](../tools/shader-compact.mjs) strips indentation, comments and spaces beside punctuation from the scene's GLSL template literals before esbuild minifies; Three.js's own shaders are untouched.
- **Static files.** The hosting, icon and discovery files in `public/` are copied verbatim (`public/site-agents.md` becomes `/AGENTS.md`); `sitemap.xml`'s `lastmod` comes from `public/index.md`'s `dateModified`. `fonts/OFL.txt` publishes beside the fonts.
- **Development.** `npm run dev` ([tools/dev.mjs](../tools/dev.mjs)) watches the inputs ([tools/watch.mjs](../tools/watch.mjs)), serializes rebuilds and serves `dist/` through an owned Wrangler process. Watch builds keep earlier hashed assets for pages already open; a failed build keeps the last good output.

## Tests

`npm test` runs `node --test "test/*.test.mjs"`: Node's own runner, no framework. Files are grouped by domain: page and UI (`markup-accessibility`, `panels`, `scene-menu`, `deep-links`, `scene-loader`, `boot`), scene wiring (`scene-bootstrap`, `scene-basics`, `scene-runtime`, `scene-quality`, `scene-postprocess`, `scene-visitor-pause`, `startup-cost`), camera (`cinematic`, `framing`, `camera-tour`), subjects and surroundings (`architecture`, `architecture-assets`, `lantern`, `sky`, `hill-silhouette`, `light-shafts`, `film-scene`, `ground`, `terrain-build`), and delivery (`build`, `bundle-output`, `hosting`, `smoke-pages`, `workflows`). `bundle-output` builds the site once into a temporary folder under `.tmp-preview-review/` and checks the real payload.

[test/support/](../test/support/) holds shared helpers, outside the test glob: `code.mjs` (source reading and a whitespace-normalizing `flat()` so source checks survive formatting), `css.mjs` (rule and media-block parsing, contrast), `html.mjs`, `glb.mjs` (a GLB reader that handles normalized integer attributes, byte strides and node transforms) and `terrain.mjs` (the plain-dune baseline the terrain tests compare against).
