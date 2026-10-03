# Architecture

## Overview

alexnava.me is a static site: two pages, one stylesheet, a small UI script and a deferred Three.js scene, built by esbuild into `dist/` and served by Cloudflare Pages. The page never depends on the scene. The title card (a night sky drawn in CSS, the identity and About) is the first visual, and it is final for static visitors. Capable devices load the scene behind it, reveal it once it can draw, and tour seven directed shots of a timber lookout tower and a twisted tree with a lantern. Terms such as film, baseline, startup tier, low tier, commit point and stand-in lantern are defined in the [Glossary](GLOSSARY.md).

The UI and scene bundles meet only on `window.BabelSite`, a few DOM hooks and the scene's `babel:` User Timing entries, which the loading line observes. The UI publishes `BabelSite.ui`, `BabelSite.shared`, `BabelSite.sceneLoader`, `BabelSite.ensureSceneReady` and the quality helpers on `BabelSite.scene`. The scene entry adds its own entries to `BabelSite.scene`, among them `initHomeScene`, `setVisitorPaused` and `isVisitorPaused`, and publishes `BabelSite.sceneDebug` when asked. [Contracts](CONTRACTS.md) lists every shared name, event, attribute and User Timing entry. `Babel` is the code's own namespace (`BabelSite`, the `babel:` marks and events, the `__BABEL_*__` build-time defines), not the Babel compiler.

## Page and startup

[src/main.js](../src/main.js) boots in this order:

1. `initUi()` wires the hero, the About dialog with its estate map, its Profile, Experience and Contact dialogs, and deep links. Navigation never waits for the scene. Once the About button is live, [scene-menu.js](../src/ui/scene-menu.js) warms the dialogs' art on the first `pointerenter`, `focusin` or `touchstart` on it: it reads the hashed URLs the computed styles already name (the estate map's `::before` for the current media, the paper sheet's `::before` grain and `::after` edge) and fetches each with `new Image()`. It runs once, never under Save-Data, and does nothing without `getComputedStyle` or `Image`; a dialog still loads its own art when it opens.
2. After first paint (`requestIdleCallback` with a 500 ms timeout, or `requestAnimationFrame` then `setTimeout` without it) it applies the static gates. The scene host is hidden and no scene script is requested when reduced motion or reduced data is preferred (including `navigator.connection.saveData`), when WebGL is unavailable or software-rendered (SwiftShader, llvmpipe, Microsoft Basic Render Driver), or when the startup tier is low. `?quality=high|balanced` passes the reduced-motion, reduced-data and software gates. `?sceneDebug=1` passes the same three in main.js, but a reduced-data preference still gives the low startup tier (quality.js `selectSceneQualityTier`), so the title card stays: main.js declines before requesting the scene bundle or, when the probe could not read the texture limits, after downloading it, once `initHomeScene()` declines the low tier. Neither passes the WebGL gate, and `?quality=auto` or an unknown value forces nothing. There is no user-agent, Lighthouse or viewport exception. A visitor whose reduced-motion or reduced-data preference later clears gets the scene then, unless the address carries `?quality=high|balanced|low` or `?sceneDebug=1|true`: main.js installs no recovery listeners when either is present (`forcesLiveScene`).
3. The startup tier comes from [quality.js](../src/scene/quality.js), which the UI bundle carries, and the limits the WebGL probe already read. Unknown limits leave the choice to the scene, which reads them with a probe of its own and declines the low tier itself (`initHomeScene()` returns `false`).
4. `sceneLoader.begin({ tier })` starts the loading line. main.js appends the scene entry as a module script and, just before it, a `<link rel="modulepreload">` for each chunk the entry imports statically (`__BABEL_SCENE_MODULE_PRELOADS__`: the shared Three.js chunk), so both download together. No lazy chunk is preloaded.
5. It then requests the startup tier's tower and tree at low fetch priority (`__BABEL_ARCHITECTURE_PREFETCH_URLS__`; a hidden page waits until shown) and shares the responses on `BabelSite.scene.prefetched`, keyed by URL. [architecture-assets.js](../src/scene/architecture-assets.js) takes a matching response at most once; the rest are aborted when the live selection starts, at teardown, or when the bundle or initialization fails.
6. When the bundle has run, main.js reports `stage("bundle")`, calls `initHomeScene()` and reports `stage("init")`. A failed bundle or initialization hides the host and calls `end("static")`. A failed module load removes its script so a later call can retry.

### Title card and loading line

Neither page has an `<img>` or `<picture>` element: the artwork (paper, vignettes, estate map) is CSS backgrounds, and the title card uses no raster image at all. index.html and styles.css paint it: the night gradient, a CSS star field (`.scene-shell::before`) and the vignette under the identity and About. A faint grain (`.scene-vignette::before`, a 150px inline SVG tile) dithers the night against banding. It fades with the canvas's reveal through a sibling selector, `.scene-canvas.is-ready + .scene-vignette::before`, so the vignette must directly follow the scene host ([Contracts](CONTRACTS.md#dom)). The 404 page is a centred cotton-paper sheet built like the category dialogs (their light, grain and edge) over the same CSS night; it has no scene host, so its grain stays. Its head names the homepage's icons, preloads both fonts, declares `color-scheme: dark` and takes the site's description. It loads no script.

On the live path [src/ui/scene-loader.js](../src/ui/scene-loader.js) (`BabelSite.sceneLoader`) shows one line, `#scene-loader`, above the footer. Its value is real progress: 10% bundle, 4% initialization, 70% model bytes and 12% model build, a running maximum held at 96% until the reveal. Bytes count the required models (the tower, plus the tree for `view=tree`): `track(url, response)` reads each model response into a copy as it arrives and counts decoded bytes against the sizes build.mjs defines for the UI (`__BABEL_ARCHITECTURE_PREFETCH_BYTES__`). Build follows the scene's measures `babel:glb-parse:<role>`, `babel:assembly:<role>` and `babel:shaders:<role>`. A MutationObserver on `#home-scene` ends the run: gaining `is-ready` is the reveal (100%, then the line fades within the canvas's fade-in), and `hidden` retires the line below 100%. The `babel:reveal` mark, seen through a PerformanceObserver, also completes it. A watchdog checks every 2 s, completes the line once the host is `is-ready`, and retires it as stalled once 15 s (`STALL_MS`) pass without progress, which its checks reach at 16 s, counting only time while the page is visible and no dialog is open. The watchdog does not check the host's `hidden` attribute: without a MutationObserver, a host the scene hides after a failed tower or tree retires the line only through that stall. `.scene-canvas` keeps one 480 ms opacity transition; terrain-build.js, mountain-build.js and light-shafts.js read it as `transitionDuration`.

## Module map

_lazy_ marks a chunk loaded on demand.

**Pages (repository root)**

| File         | Role                                                               |
| ------------ | ------------------------------------------------------------------ |
| `index.html` | Identity, About, dialogs, no-JS fallback, scene host, loading line |
| `404.html`   | Not-found page: a paper sheet on the same night, no script         |
| `styles.css` | Type, layout, paper surfaces, title card, loading line             |

**UI bundle (`src/`)**

| File                    | Role                                                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------------------ |
| `app.js`                | UI entry: imports the modules below, then main.js                                                            |
| `main.js`               | Boot, static gates, scene and early model requests                                                           |
| `ui/hero.js`            | Hero chrome and scroll state                                                                                 |
| `ui/panels.js`          | The About menu and category dialogs: focus, Back and Escape, `inert`, `data-panel-open`, `babel:panelchange` |
| `ui/scene-menu.js`      | Swaps the no-JavaScript About for the About button once `initPanels()` succeeds; warms the dialogs' art      |
| `ui/deep-links.js`      | `#about`, `#profile`, `#experience`, `#contact` and their `-text` aliases                                    |
| `ui/scene-loader.js`    | Loading line (`BabelSite.sceneLoader`)                                                                       |
| `shared/webgl-probe.js` | WebGL probe and cached limits (both bundles)                                                                 |
| `shared/motion.js`      | Reduced-motion helpers (both bundles)                                                                        |
| `scene/quality.js`      | Tiers, profiles, composition, governor (both bundles)                                                        |

**Scene core (`src/scene/`, and the entry in `src/`)**

| File                   | Role                                                                                                                             |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `../scene-entry.js`    | Scene entry: imports `perf-marks.js`, the shared modules and `index.js`, then records `babel:scene-entry` and `babel:scene-eval` |
| `index.js`             | Assembly, reveal, holds, commits, `sceneDebug`                                                                                   |
| `runtime.js`           | Scheduler, cadence, holds, warm-ups, deferred steps, pixel-ratio watcher                                                         |
| `subsystem.js`         | Subsystem registry and lifecycle                                                                                                 |
| `rendering.js`         | Renderer, lights, shadows, shader compilation                                                                                    |
| `night-environment.js` | The film sky captured as the scene's environment                                                                                 |
| `postprocess.js`       | Composer, grade, bloom, ink contour, dissolve                                                                                    |
| `depth-layers.js`      | Depth-layer codes for the dissolve                                                                                               |
| `perf-marks.js`        | `babel:` marks and measures                                                                                                      |
| `helpers.js`           | Ground height and math on `BabelSite.scene`                                                                                      |
| `palette.js`           | Ground palette                                                                                                                   |
| `world.js`             | World constants                                                                                                                  |

**Camera (`src/scene/`)**

| File                | Role                                                                                   |
| ------------------- | -------------------------------------------------------------------------------------- |
| `directed-shots.js` | Shot definitions, dwells and viewport variants; the stacked layout (`isStackedLayout`) |
| `cinematic.js`      | Safe area, shot fitting, drift and push-in                                             |
| `camera-tour.js`    | Tour pacing and dissolve timing                                                        |
| `scene-modes.js`    | Opening view from `?view=`                                                             |

**Models (`src/scene/`)**

| File                     | Role                                         |
| ------------------------ | -------------------------------------------- |
| `architecture-assets.js` | Model manifest, requests, validation, leases |
| `architecture.js`        | Tower and tree materials and grades          |
| `tree-normals.js`        | Tree normal smoothing                        |
| `prop-scale.js`          | Tree and lantern scale and grounding         |
| `lantern.js`             | Lantern mount over the stand-in lantern      |
| `lantern-flame.js`       | _lazy_ Flame and glass shading               |
| `estate-layout.js`       | Tower, tree, lantern and path anchors        |

**Sky and mountains (`src/scene/`)**

| File                 | Role                                                                                                    |
| -------------------- | ------------------------------------------------------------------------------------------------------- |
| `atmosphere.js`      | Sky shell, clouds, nebula octaves                                                                       |
| `estate-sky.js`      | Film sky gradient, horizon band, the cloud field (`cloudFieldGLSL`) and its reshaping (`CLOUD_RESHAPE`) |
| `celestial-field.js` | Shared nebula frame and dust                                                                            |
| `starfield.js`       | Stars (`STAR_COUNTS`), hidden behind the cloud banks                                                    |
| `solar-body.js`      | The star and its prominences                                                                            |
| `hill-silhouette.js` | Baseline hill ring, mountain material, ranges stand-in, far plain air (`HORIZON_AIR`)                   |
| `mountain-build.js`  | _lazy_ Film mountain geometry                                                                           |
| `light-shafts.js`    | _lazy_ Star rays and moonbeams (WebGL2)                                                                 |

**Ground (`src/scene/`)**

| File                      | Role                                                                     |
| ------------------------- | ------------------------------------------------------------------------ |
| `environment.js`          | Ground root and its children                                             |
| `textures.js`             | Procedural ground canvases                                               |
| `film-scene.js`           | Film treatment; borrows and restores the ground                          |
| `filmic-earth.js`         | Slate map preset and terrain size                                        |
| `stone-detail.js`         | Slate maps by asset tier                                                 |
| `mud-ground.js`           | Slate, wetness, puddles, contacts and text boxes (`createSlateContacts`) |
| `estate-ground-detail.js` | Tufts and the winding path                                               |
| `terrain-build.js`        | _lazy_ Terrain, root supports, puddle mirror, litter                     |
| `rock-scatter.js`         | Rock clusters and contacts                                               |
| `rock-build.js`           | _lazy_ Rock placement and instancing                                     |

## Tools

Build, development and authoring helpers in `tools/`. None is published.

| File                    | Role                                                                                                |
| ----------------------- | --------------------------------------------------------------------------------------------------- |
| `build-output.mjs`      | Validates the output folder, stages the payload, replaces assets before HTML, rolls back on failure |
| `watch.mjs`             | `npm run watch`: debounced, serialized rebuilds with `--retain-assets`                              |
| `dev.mjs`               | `npm run dev`: watch builds plus an owned Wrangler server (`--port`, default 4173)                  |
| `owned-process.mjs`     | Starts a child process and stops only what it started, never a process found by name or port        |
| `shader-compact.mjs`    | Compacts the scene's GLSL template literals before esbuild                                          |
| `bake-root-shade.mjs`   | Bakes the tree's root tables (`ROOT_RESTS`, `ROOT_SHADE`, `ROOT_COVER`) for terrain-build.js        |
| `og-card.html`          | Source of the share card, `public/og.png`                                                           |
| `og-card-backdrop.webp` | The share card's backdrop, a still of the live scene                                                |

`node tools/bake-root-shade.mjs` prints the three constants from both tree variants, deterministically; paste them over the ones in [terrain-build.js](../src/scene/terrain-build.js) whenever one of its inputs changes: the tree models, the tree's seating (`TREE_FOOTING`, `TREE_SINK`), the root lines and lattice, the key-light direction (`KEY_LIGHT`), the terrain, or the ground the tables must leave untouched (the lantern clearing about `LANTERN_FOOT` and the puddles in `PUDDLE_ZONES`). `test/terrain-build.test.mjs` re-bakes and fails on any difference.

## Scene lifecycle

- **Subsystems.** Each scene part registers with a registry ([subsystem.js](../src/scene/subsystem.js)) as an object with optional `applyQuality`, `resize`, `update` and `dispose` hooks; a missing hook is a no-op. Hooks run in `lifecycleOrder`. Disposal runs in reverse registration order, continues past a failing subsystem and rethrows the first error. A throw during initialization disposes what was registered, and nothing registers after disposal.
- **Borrowed resources.** A subsystem that derives from another's geometry, materials or programs restores the originals before freeing its own: the film terrain over the procedural ground, the lantern mount over the stand-in lantern, and the light shafts' and slate's shader hooks over the materials they extend. Quality changes and failed or stale loads keep a usable fallback.
- **Shared uniforms.** Some uniform objects are lent rather than copied, so one write reaches every material that reads them; a borrower never frees or replaces them ([Contracts](CONTRACTS.md#shared-uniform-objects)). index.js creates the slate's contacts and text boxes (`groundContacts`, mud-ground.js `createSlateContacts()`) before the sky shell and shares them with the ground, the rocks, the bark (`textGuard`), the sky shell and, through the shell, the stars. The starfield borrows the shell's `uTime`, `uFilm`, `uClouds`, `uNebulaLayers`, `uCloudReshape`, `slateText` and `slateAspect`; disposing the stars leaves the sky and its uniforms intact.
- **Asset leases.** architecture-assets.js loads the tower, tree, lantern and rocks for the startup tier. A decoded asset is held by a lease through staging, commit and restoration; aborted or stale results are released through the same path. The tower and tree are required. The lantern and rocks are optional and never hold the reveal.
- **Reveal.** Until a directed shot is ready the hidden canvas keeps the pre-reveal orbit camera and redraws only when invalidated. Programs link through `renderer.compileAsync` with `KHR_parallel_shader_compile` (`createShaderWarmup`, each warm-up bounded at 2 s). Before the reveal nothing draws while a warm-up is pending, and the reveal waits for it. The first frame that can show marks `babel:reveal`, adds `is-ready` to `#home-scene` and starts the 480 ms fade-in. Afterwards a committed model stays hidden until its programs are linked.
- **Framing.** Each directed shot is fitted inside a safe area cut from the hero's layout box and the bottom bar's top edge ([cinematic.js](../src/scene/cinematic.js) `cinematicSafeArea`). `isStackedLayout(width, height)` ([directed-shots.js](../src/scene/directed-shots.js), re-exported by cinematic.js for index.js) mirrors the hero's breakpoints in styles.css ([Contracts](CONTRACTS.md#hero-breakpoints)): a stacked layout frames the subject below the name; landscape phones and desktops frame it right of the hero; portrait monitors frame it across the full width above the name. `resolveDirectedShot` gives a shot its viewport variant ([Scene modes](SCENE-MODES.md#viewport-variants)): `portrait` for canvases taller than wide, stacked layouts and squat landscapes (up to 500px tall and narrower than `SQUAT_LANDSCAPE`, 1.55:1); for other canvases up to 500px tall, `compact` under 600px wide (The watch only) or `landscape`; none elsewhere. index.js applies the film's phone text band only in a stacked layout.
- **Commit points.** A change that would pop mid-shot lands only before the reveal, inside the fade-in, on a tour cut under the dissolve's kept frame, or on a still frame while the tour is not running: the lantern, the rocks, the film terrain, light-shaft treatments, the slate's root shading and adaptive quality steps (`createDeferredQualityStep`, waiting at most 30 s). The mountains, and a light still building when its shot opens, fade in instead.
- **Holds.** An open dialog holds the tour at once (a tour hold) and, 450 ms later, after the dim overlay has faded in, stops rendering until the last dialog closes (a render hold, `createPanelHold`). `scene.setVisitorPaused()` holds the tour and, from the reveal, rendering (`createVisitorHold`); `scene.isVisitorPaused()` reads it. Behind a visitor pause a resize, context restore or content change (model, map, shader, font) draws one still frame; behind a dialog only a resize does; scroll never does.
- **Failure.** If the tower or tree cannot load, `failToTitle()` stops the scene at once (a host never shown is hidden; a shown canvas fades back to the title card) and disposes the runtime on a later tick, once in-flight warm-ups settle. There is no fallback world. A lantern failure keeps the stand-in lantern: an iron post lantern that [architecture.js](../src/scene/architecture.js) builds in code beside the tree, not part of any model.
- **Diagnostics.** `?sceneDebug=1` publishes a read-only status object, `BabelSite.sceneDebug`; [Scene modes](SCENE-MODES.md) lists its fields. There are no developer controls.

## Rendering and quality

The scene runs on the high and balanced tiers only; the low tier keeps the title card. quality.js picks the startup tier: a data-saver request, 2 GB or less of device memory, or weak limits (textures under 4096 or anisotropy under 4) give low; four cores or fewer, a phone-sized touch viewport, a touch device without flagship limits, or a short side under 340 px give balanced; the rest get high. `?quality=` overrides it and pins the governor: an explicit tier takes no adaptive step.

|                     | High      | Balanced |
| ------------------- | --------- | -------- |
| Pixel-ratio cap     | 1.5       | 1.25     |
| Shadows             | 2048 map  | 1024 map |
| Bloom               | on        | off      |
| Scene MSAA (WebGL2) | 4 samples | none     |
| Stars               | 4200      | 2600     |

Touch-primary devices cap the pixel ratio at 1.25 on every tier. The composer's targets follow the canvas in device pixels; the renderer's own antialiasing is off. Star sprites, prominences, bloom and the ink contour are sized in CSS pixels. Models and slate maps keep the startup tier (`assetTier`), so a quality step never re-downloads them.

The governor samples display intervals only after the reveal, and not for 3 s after a resize, resume, dialog release or asset commit; a dissolve's tour capture, cut and first blended frames are skipped. A 60-frame window averaging over 20 ms for 120 consecutive frames steps down one tier. A revealed scene never draws the low profile: its step below balanced, the resolution step, keeps the profile and lowers only the pixel ratio to 1. Recovery needs 300 frames whose window average stays under the larger of 15 ms and 1.1 times its 10th percentile, counted only while that percentile is at most 17.5 ms (a display at 60 Hz or faster that keeps up), and 10 s since the last change; each recovery followed by another downgrade doubles both, and after two such oscillations recovery stops. While the tour runs, a step waits for the next cut; where the browser links programs in parallel, it links them first (`rendering.prepareQuality()`).

[runtime.js](../src/scene/runtime.js) renders only visible frames, on an even cadence: every nth vsync of the estimated refresh rate near 60 Hz (144 Hz draws 72 fps; touch screens stay at or below 60). The moon key's shadow map (`rendering.lights.sun`) redraws only after a shot, quality, resize, model or treatment change, or a restored WebGL context; a step between the tiers' map sizes frees the map for the next draw to allocate. The renderer uses `PCFSoftShadowMap`, whose directional-light filter in three r160 is a fixed 3×3 texel footprint that ignores `shadow.radius`, so the scene sets no radius: the map's texel size alone sets how soft a shadow's edge falls. When the film starts, rendering.js sets the film sky as the scene's environment: [night-environment.js](../src/scene/night-environment.js) links the environment capture's sky program in the background from start-up and draws the sky shell's own shader once into a prefiltered (PMREM) cube, again only after a lost context ([below](#sky-stars-and-far-plain)). The window's `resize` and a ResizeObserver on the host feed the resize controller (runtime.js `createSceneResizeController`), which resizes the renderer with `setSize(width, height, false)` when the size or the pixel ratio changed. A pixel-ratio change that resizes nothing, such as a window moved to a display of another scale, reaches it through runtime.js `createPixelRatioWatcher()`: index.js wires it to the controller, and it listens to a `(resolution: <ratio>dppx)` media query, re-arms on the new ratio after each change, then calls the controller. `disposeHomeSceneRuntime()` removes its listener. Without `matchMedia`, or a query without `addEventListener`, it watches nothing. rendering.js checks the WebGL context before entering the composer, so a lost context is caught before Three.js hears of it. The page normally opens two WebGL contexts, the probe and the renderer, both with `powerPreference: "default"`. When the probe could not read the texture limits, the scene opens a third, short-lived one for them (quality.js `readWebGLQualityCaps`). Each probe releases its context through `WEBGL_lose_context`.

## Sky, stars and far plain

- **Sky shell.** [estate-sky.js](../src/scene/estate-sky.js) builds the shell's material, `createEstateSkyMaterial(config, textGuard)`. [atmosphere.js](../src/scene/atmosphere.js) drives its drift clock (`uTime`, on scene time) and its octaves (`uNebulaLayers`: 3 on high, 2 on balanced, 0 outside the film), and [film-scene.js](../src/scene/film-scene.js) turns `uFilm` on. The film's cloud field is GLSL text, `cloudFieldGLSL(time)`, which the shell interpolates and the stars evaluate too. Its reshaping, `CLOUD_RESHAPE`, works through two weights, both exactly 0 over the reference banks. The open weight (`open`, on the bank density) also leaves the roof's clear lane alone. The bend weight (`bend`, on the noise's coordinates) eases in over wider azimuths and radius and also reaches the lane, which keeps its own clearing. Through `bend` the reshaping decompresses the noise toward the horizon, enlarges it evenly (`scale`) and swirls it; through `open` the half-frequency octave decides bank or clear sky, and the next octave cuts darker lanes inside the banks. Behind the name and intro the text guard (`CLOUD_TEXT_GLSL`) thins the reshaped banks' cover, which the stars read too, without changing their shapes; it reads the `slateText` and `slateAspect` objects that index.js lends as `textGuard`. `uCloudReshape` scales the reshaping: 1 for the shell and the stars.
- **Stars.** [starfield.js](../src/scene/starfield.js) borrows the shell's uniforms (`uTime` as `uSkyTime`) and takes the shell's radius (`WORLD.SKY_DOME_RADIUS`) from index.js. In film each star finds where its view ray leaves the shell, evaluates `cloudFieldGLSL("uSkyTime")` there, with the text guard at the star's own clip position, and dims by the bank's opacity in the sky (0.94). No sprite draws under `STAR_MIN_FOOTPRINT` (2 device px); its colour scales by the area ratio, so its light is unchanged.
- **Environment capture.** night-environment.js clones the shell's material for its one capture and gives the clone its own `uCloudReshape` (0) and an empty `slateText`. The capture keeps the clouds as authored, so the materials' sky light and reflections keep their approved brightness, and no text box from the page reaches the cube.
- **Far plain.** Past the film terrain's edge (`TERRAIN_EDGE`, 192 units from the origin, half of [filmic-earth.js](../src/scene/filmic-earth.js) `EARTH.width`) the frame shows the near range's body below eye level. [hill-silhouette.js](../src/scene/hill-silhouette.js) eases that body, within 0.02 of slope below eye level, into the far plain's air: `TERRAIN_HORIZON` lifted by `HORIZON_AIR.horizon` (1.65) at eye level, rising to `HORIZON_AIR.edge` (1.9) where the view meets the terrain's edge. The feet haze to the same air over `HORIZON_HAZE`. [mud-ground.js](../src/scene/mud-ground.js) darkens the slate's far edge toward `TERRAIN_HORIZON` times `HORIZON_AIR.ground` (1.75) and never lightens it, so the edge stays above the grade's ground cel step.

## Assets and budgets

Every model, map, image, font and icon, with its size, and every byte and script budget with the check that enforces it, is in [Assets](ASSETS.md).

## Build pipeline

[build.mjs](../build.mjs) writes `dist/` through [tools/build-output.mjs](../tools/build-output.mjs), which stages the payload, replaces assets before HTML and rolls back if publication fails.

- **Scripts.** The scene builds first, as ESM with code splitting: the entry, one shared chunk that may hold only third-party code (the build refuses a first-party module there, since it would evaluate before the entry's ordered imports), and five lazy chunks. Chunks are named after the hash of their final bytes, dependencies first, so any change yields a new entry URL. The UI then builds as one IIFE that names the entry's static chunks for preloading. The scene entry receives the model and slate manifests as string literals (`__BABEL_ARCHITECTURE_URLS__`, `__BABEL_MATERIAL_URLS__`); the UI receives only each tier's tower and tree URLs and sizes.
- **Fingerprints.** Scripts, CSS, the paper and estate-map artwork, every model, the slate maps and the fonts publish only as `name.HASH.ext` (eight hex digits of SHA-256), immutable for a year. The fonts are discovered from `fonts/*.woff2`. The stylesheet's `url()`s are rewritten before minifying, from LF bytes, and the pages' asset paths with exact replacements; an un-hashed stylesheet, script or font path, or a `?v=` query, left after the rewrite fails the build.
- **Legal comments.** esbuild keeps license comments at the end of each output (`legalComments: "eof"`); the shared chunk ends with Three.js's notice.
- **Shader compaction.** [tools/shader-compact.mjs](../tools/shader-compact.mjs) strips indentation, comments and spaces beside punctuation from the scene's GLSL template literals before esbuild minifies; Three.js's own shaders are untouched.
- **Static files.** The hosting, icon and discovery files in `public/` are copied verbatim (`public/site-agents.md` becomes `/AGENTS.md`); `sitemap.xml`'s `lastmod` comes from `public/index.md`'s `dateModified`. `fonts/OFL.txt` publishes beside the fonts.
- **Development.** `npm run dev` ([tools/dev.mjs](../tools/dev.mjs)) watches the inputs ([tools/watch.mjs](../tools/watch.mjs)), serializes rebuilds and serves `dist/` through an owned Wrangler process. Watch builds pass `--retain-assets`, which keeps, for pages already open, the hashed scripts, CSS, images, models and fonts that the folder's previous build recorded in its manifest (`.cache/build-outputs/`); without it a build removes the files its predecessor recorded and it no longer writes, and a file no build recorded is never removed. A failed build keeps the last good output. `--outdir` writes elsewhere than `dist/`; build-output.mjs `validateOutputDirectory` refuses the project root or any folder containing it, `src`, `images`, `fonts`, `public`, `tools`, `test`, `node_modules`, `.git`, `.cache` or any folder inside them, a path through a symbolic link, and an existing file, and `publishBuild` refuses a non-empty folder other than `dist/` that is not an earlier output of this project.

## Tests

`npm test` runs `node --test "test/*.test.mjs"`: Node's own runner, no framework. Files are grouped by domain: page and UI (`markup-accessibility`, `panels`, `scene-menu`, `deep-links`, `scene-loader`, `boot`), scene wiring (`scene-bootstrap`, `scene-basics`, `scene-runtime`, `scene-quality`, `scene-postprocess`, `scene-visitor-pause`, `startup-cost`), camera (`cinematic`, `framing`, `camera-tour`), subjects and surroundings (`architecture`, `architecture-assets`, `lantern`, `sky`, `night-environment`, `hill-silhouette`, `light-shafts`, `film-scene`, `ground`, `terrain-build`), delivery (`build`, `bundle-output`, `hosting`, `smoke-pages`, `workflows`), and the docs (`docs`). `bundle-output` builds the site once into a temporary folder under `.tmp-preview-review/` and checks the real payload; two of its tests build small fixture projects there as well (the refused shared chunk, and a changed model's effect on the UI bundle).

[test/support/](../test/support/) holds shared helpers, outside the test glob. Each of `code.mjs`, `css.mjs` and `html.mjs` has its own whitespace-normalizing `flat()` for its language, so source, style and markup checks survive formatting; `code.mjs` also reads source files, and `css.mjs` parses rules and media blocks and computes contrast. `glb.mjs` is a GLB reader that handles normalized integer attributes, byte strides and node transforms, and `terrain.mjs` holds the plain-dune baseline the terrain tests compare against.
