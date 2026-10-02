# Troubleshooting

Symptom, cause and fix for the failures that recur. Messages are quoted as the code prints them; `…` stands for the part that varies. Terms such as static gate, live path, startup tier and reveal are defined in the [Glossary](GLOSSARY.md).

## Reading the scene's state

In the browser console, on any visit:

| Check                                          | Reads as                                                                                                                                                                                                                                                                                                 |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `document.getElementById("home-scene").hidden` | `true`: the title card stays (a static gate, a failed bundle or initialization, the scene declining its own low tier, or a tower or tree that failed before the reveal). `false` does not prove a scene: after a failure past the reveal the host stays shown but empty (`#home-scene canvas` is `null`) |
| `BabelSite.sceneLoader.state.status`           | The loading line's run; the first ending sticks ([below](#the-loading-line-stalls-or-retires))                                                                                                                                                                                                           |
| `BabelSite.shared.getWebGLCapabilities()`      | `available`, `softwareRenderer` and the texture limits the gates and the startup tier used                                                                                                                                                                                                               |
| `BabelSite.scene.readSceneQualityControls()`   | The `?quality=` and `sceneDebug` controls as read                                                                                                                                                                                                                                                        |
| `BabelSite.scene.detectSaveData()`             | `true` when Save-Data or `prefers-reduced-data` is on                                                                                                                                                                                                                                                    |
| `typeof BabelSite.scene.initHomeScene`         | `"function"` once the scene bundle has run                                                                                                                                                                                                                                                               |
| `BabelSite.sceneDebug`                         | With `?sceneDebug=1`: present once the scene accepted its tier; `failure`, `architecture`, `shaders` and the rest per [Scene modes](SCENE-MODES.md#scenedebug)                                                                                                                                           |

## The scene never appears

The page keeps the title card by design on the static path ([Contracts](CONTRACTS.md), [main.js](../src/main.js) `ensureSceneReady`).

| Cause                                                                                                                     | Shows as                                                                                                                                                                                             | Fix or check                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reduced motion preferred                                                                                                  | `state.status` `idle`                                                                                                                                                                                | Intended. `?quality=high`, `?quality=balanced` or `?sceneDebug=1` passes it. Clearing the preference loads the scene without a reload.                                                                                                                          |
| Reduced data: Save-Data or `prefers-reduced-data`                                                                         | `detectSaveData()` is `true`; `idle`                                                                                                                                                                 | Intended. Only `?quality=high` or `?quality=balanced` passes it: `?sceneDebug=1` alone passes main.js's preference gate, but the startup tier is still low (`idle`, or `static` when the probe left the limits unknown and the scene declined the tier itself). |
| No WebGL                                                                                                                  | `getWebGLCapabilities().available` is `false`                                                                                                                                                        | Nothing passes this gate.                                                                                                                                                                                                                                       |
| Software renderer (SwiftShader, llvmpipe, Microsoft Basic Render Driver)                                                  | `softwareRenderer` is `true`                                                                                                                                                                         | `?quality=high`, `?quality=balanced` or `?sceneDebug=1` passes it; with `?sceneDebug=1` the detected tier must still not be low. Runners without a GPU land here.                                                                                               |
| Low startup tier: 2 GB or less of device memory, textures under 4096 or anisotropy under 4, data saver, or `?quality=low` | `idle`, and no scene script is requested. When the probe left the texture limits unknown, main.js cannot tell: the scene bundle loads, `initHomeScene()` returns `false` and the line reads `static` | `?quality=high` or `?quality=balanced` overrides it.                                                                                                                                                                                                            |
| The scene bundle failed to load, or initialization threw                                                                  | Console: `Scene bundle failed to load.`; the host is hidden                                                                                                                                          | Check the network panel for the `scene.*.js` chunks; a later `BabelSite.ensureSceneReady()` retries a failed script.                                                                                                                                            |
| The tower or tree could not load                                                                                          | `sceneDebug.failure` is `{ stage: "architecture:tower", message: "asset-unavailable" }` (or `tree`)                                                                                                  | Check the GLB request and its size against the tier's budget ([Architecture](ARCHITECTURE.md#assets-and-budgets)). Before the reveal the host is hidden; after it, see [below](#the-scene-disappears-mid-visit).                                                |
| The tab is hidden                                                                                                         | `state.status` stays `loading`                                                                                                                                                                       | Nothing renders in a hidden tab, and hidden time does not count toward a stall.                                                                                                                                                                                 |

To see the scene on a gated device, open `?quality=high&sceneDebug=1` (or `balanced`) and read `BabelSite.sceneDebug`. `?sceneDebug=1` alone keeps the detected tier.

## The scene disappears mid-visit

- **Lost WebGL context.** The canvas loses `is-ready` and fades to the title card over the 480 ms transition, staying in the host; a restored context redraws it.
- **The tree failed after the reveal.** The tower and the tree load together. Every shot needs the tower, so the reveal always waits for it, and for the tree only with `view=tree`. With `view=tower` a tree that cannot load after the reveal sets `sceneDebug.failure` to `{ stage: "architecture:tree", message: "asset-unavailable" }`. The scene stops, the canvas loses `is-ready`, and the runtime is disposed, which removes the canvas from the host: in the same task when no shader warm-up is pending, so the canvas vanishes without the fade, or once the pending warm-ups settle (each bounded at 2 s), so it fades for that long at most ([index.js](../src/scene/index.js) `failToTitle`). The host stays shown and empty over the title card.

## The loading line stalls or retires

The line retires below 100% when the run ends without a reveal ([scene-loader.js](../src/ui/scene-loader.js)). A run ends once: the first of `revealed`, `static` and `stalled` sticks, so a run that stalled reads `stalled` after a later reveal or a hidden host. `BabelSite.sceneLoader.state.status` reads:

| Status     | Means                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `idle`     | No run began: a static gate in main.js kept the title card, or main.js has not reached the gates yet (they run after first paint)                                                                                                                                                                                                                                                                                 |
| `loading`  | The run is in progress. Without `MutationObserver` it also lasts after the scene hid its own host, until the watchdog ends the run `stalled`                                                                                                                                                                                                                                                                      |
| `revealed` | `#home-scene` gained `is-ready`, or the `babel:reveal` mark arrived. A failure after the reveal leaves it `revealed`                                                                                                                                                                                                                                                                                              |
| `static`   | main.js hid the host and ended the run (`disableSceneHost()`): a failed bundle or initialization, or the scene declining its own low tier. A tower or tree that failed before the reveal makes the scene hide the host itself (index.js `stopFailedScene`), which reads `static` through the `MutationObserver` on the host; without one it reads `stalled` ([The scene never appears](#the-scene-never-appears)) |
| `stalled`  | No progress for about 16 s of visible time, below                                                                                                                                                                                                                                                                                                                                                                 |

The watchdog checks every 2 s and stalls after `STALL_MS` (15 s) without progress, so about 16 s; time in a hidden tab or with a dialog open does not count. Retiring the line does not stop the scene, which reveals when it is ready. `bytes`, `stages` and `built` show where progress stopped:

- `bytes` not growing: the tower (or, with `view=tree`, the tree) is not arriving. Without streaming support (`ReadableStream` and the `Response` constructor) `track()` returns each response unchanged: `bytes` stays at 0 throughout, and the line holds at 26% at most (bundle, initialization and build) until it reads 100% at the reveal.
- `built` steps missing: without `PerformanceObserver` the build share waits for the reveal, so the line holds at 84% at most.
- Everything done but no reveal: the reveal waits for shader warm-ups (2 s each at most) and for the tower (with `view=tree`, the tree too) to be assembled.

## The site does not load from the repository folder

`index.html` names `/scripts/app.js` and `/scripts/scene.js` (`404.html` loads no script), which exist only in the build's output, under hashed names. A static server on the repository root serves `index.html`, `styles.css`, the fonts and the images, so the title card shows, but the UI bundle is missing: the page behaves as without JavaScript (the no-JS About section, no dialogs, deep links or scene). A file URL also loses the root-relative paths. Use `npm run dev` or `npm run preview`.

## The dev server will not start

`npm run dev` checks the port first and stops nothing:

```text
Cannot start dev at http://127.0.0.1:4173: …. Choose another --port; no existing process was stopped.
```

Another process holds the port; `npm run preview` also uses 4173. Start on another port with `npm run dev -- --port 4180`. Other messages: `--port requires an integer from 1 to 65535.`, `Unknown dev option: …`, and `Wrangler exited with ….` when the preview server stops on its own.

`npm run dev` and `npm run watch` start their children (Wrangler, the builder) through [tools/owned-process.mjs](../tools/owned-process.mjs) `spawnOwned()`: each child gets its own process group (outside Windows), and stopping stops only that group, with `SIGTERM` and then `SIGKILL` after 3 s (`taskkill /T /F` on Windows). Nothing is found or stopped by name or port, so a server left running from elsewhere keeps the port until you stop it yourself.

## A change does not show in development

- The watcher prints `rebuilt site; refresh your browser` after each successful rebuild; the page does not reload itself.
- `Build failed; keeping the last successful output.`, followed by `Builder exited with 1.`, means the last edit broke the build; `dist/` still serves the previous output and the watcher keeps watching. The build's own message ([below](#the-build-fails)) is printed above those lines. Fix it and save again.
- A failed first build stops `npm run dev` and `npm run watch`; fix the error and start the command again.

## The build fails

`npm run build:dist` stops with these messages from [build.mjs](../build.mjs) and [tools/build-output.mjs](../tools/build-output.mjs); `npm run verify` builds only the scripts, so it reports only the chunk messages. Under `npm run dev` or `npm run watch` the same message comes from the child build, and the watcher carries on ([above](#a-change-does-not-show-in-development)).

| Message                                                                                                     | Cause                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Fix                                                                                                                                                                                                                                                                             |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.html names an un-hashed asset after the rewrite: …` (or `404.html`)                                  | A page names a script other than `/scripts/app.js` or `/scripts/scene.js`, a `?v=` query, or a font that is not in `fonts/`                                                                                                                                                                                                                                                                                                                                                                                   | Load scripts through `src/app.js` or the scene's dynamic imports; drop `?v=` (the hashes replace it); name only fonts that exist in `fonts/`.                                                                                                                                   |
| `styles.css names an un-hashed font: …`                                                                     | A `url()` names a font that is not in `fonts/`                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Fix the path or add the font (new fonts need approval: [Style](STYLE.md#guardrails)).                                                                                                                                                                                           |
| `Shared scene chunk would reorder side-effect modules: src/…`                                               | A first-party module (`src/…`) is imported by more than one output: by the entry's static graph and a lazy chunk, or by two lazy chunks. esbuild moves it into a chunk that is no entry point, and the build refuses any such chunk that holds first-party code. The first-party scene modules register on `BabelSite` in the order [scene-entry.js](../src/scene-entry.js) lists, and a chunk the entry imports statically would evaluate before them; a chunk shared only by lazy chunks is refused as well | A lazy module must not import first-party code that the entry or another lazy module also imports. The lazy modules import only `three` (rock-build.js imports nothing) and receive helpers as arguments, as [rock-scatter.js](../src/scene/rock-scatter.js) passes `ROCK_LIB`. |
| `Script chunks import each other cyclically: …`, `… imports external …`, `… does not name its chunk …`      | The scene's chunk graph is not what the fingerprinting expects                                                                                                                                                                                                                                                                                                                                                                                                                                                | Remove the cycle or the external import.                                                                                                                                                                                                                                        |
| `Build output would overwrite …`, `Build output must not be the project root or its parent.`                | `--outdir` points into the sources                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Choose a folder outside `src/`, `images/`, `fonts/`, `public/`, `tools/`, `test/`, `node_modules/`, `.git/` and `.cache/`.                                                                                                                                                      |
| `An explicit --outdir must be empty or a previous output of this project.`                                  | `--outdir` names a folder with other files                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Use an empty folder or one this build wrote.                                                                                                                                                                                                                                    |
| `Build output contains a symlink: …`, `Build output cannot traverse a symlink: …`                           | A symbolic link in or above the output                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Remove the link.                                                                                                                                                                                                                                                                |
| `Use only one of --watch, --check, or --dist.`, `--outdir requires a directory.`, `Unknown build option: …` | Arguments to `node build.mjs`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `node build.mjs` accepts one of `--dist` (the default), `--check` or `--watch`, plus `--outdir DIR` and `--retain-assets` (keep earlier hashed assets, as watch builds do).                                                                                                     |

A failed build leaves the previous output in place; if restoring it also fails, the message ends `recovery files retained at …`.

## format:check fails

```text
[warn] …/file
[warn] Code style issues found in the above file. Run Prettier with --write to fix.
```

With several files the last line reads `[warn] Code style issues found in N files. Run Prettier with --write to fix.`

Run `npm run format` and commit the result. Prettier is pinned to 3.9.9 in `package.json` and configured in `.prettierrc.json`; a globally installed Prettier of another version can format differently, so use the npm scripts. Markdown, including these docs, is formatted too.

## A test fails after an intentional change

The test holds the old value. Change the source and the test's expected value in the same commit, with the reason, and update the docs that state the value ([Testing](TESTING.md#locked-values)). Copy changes are a common case: the dialog copy must match the no-JS fallback, and the Profile and Experience sentences must also appear in `public/index.md`.

## A slice-timing test fails on a busy machine

```text
no long task (… ms)
median slice … ms
longest rushed slice … ms
median rushed slice … ms
```

Three tests time real work with `performance.now()` and fail when the machine is loaded, as when `npm test` runs files in parallel beside other work ([Testing](TESTING.md#timing-sensitive-tests)). Rerun the file alone (`node --test test/terrain-build.test.mjs` or `test/hill-silhouette.test.mjs`). A failure that repeats on an idle machine is a regression: a build step that no longer yields within its slice.

## The security.txt test fails

```text
security.txt expires …: move Expires in public/.well-known/security.txt up to a year ahead
```

The `Expires` line is 30 days or less away. The check reads the clock, so every branch and the deploy workflow fail together until it is renewed. Set `Expires` within 366 days ahead (a later date fails with `security.txt Expires should stay under a year ahead`), update the dates in [Operations](OPERATIONS.md#headers-and-caching), and purge `/.well-known/security.txt` after the release.

## Lighthouse fails in CI

The `audit` job asserts the medians of three runs against [lighthouserc.json](../lighthouserc.json) and uploads its reports as a workflow artifact; read them for the failing audit. It serves `dist/` from Lighthouse CI's own static server, so `_headers` play no part.

- **SEO (must be 1.00).** Lighthouse's robots-txt audit fails on a directive it does not know, so hosting.test.mjs allows only `User-agent`, `Allow`, `Disallow` and `Sitemap` in `robots.txt` (`robots.txt uses a directive Lighthouse rejects: …`). The repository asserts nothing else about SEO; the uploaded report names any other failing audit.
- **Accessibility (must be 1.00).** [Style](STYLE.md#motion-and-accessibility) holds the contrast, target-size and text-size rules.
- **Performance, LCP, CLS, TBT.** The runners have no GPU, so the WebGL or software-renderer gate keeps the title card and the audit measures the title card alone ([Testing](TESTING.md#lighthouse)). A larger UI bundle, a render-blocking request or a layout shift in the title card shows here first.

## The robots.txt test fails

hosting.test.mjs holds `robots.txt` to exactly the training crawlers in [Operations](OPERATIONS.md#cloudflare-dashboard-checklist) item 6, with search, citation and assistant crawlers allowed: the `*` group must read `Allow: /` alone, and the file must keep `Sitemap: https://alexnava.me/sitemap.xml`. It also allows only the `User-agent`, `Allow`, `Disallow` and `Sitemap` directives, because Lighthouse's robots-txt audit fails on any other ([above](#lighthouse-fails-in-ci)). Change the crawler list in `robots.txt`, the test and Operations together, and in Cloudflare's AI Crawl Control.

The same file refuses any `X-Robots-Tag` in `public/_headers` (`static Pages headers cannot safely scope X-Robots-Tag by hostname`), so crawler rules stay in `robots.txt`.

## The Cloudflare audit fails

`cloudflare-audit.yml` checks the live site weekly ([Operations](OPERATIONS.md#cloudflare-audit)). Each `edge-settings` failure names its check:

| Check                            | Usual cause and fix                                                                                                                                                                              |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Browser request`                | A challenge or block (Security → WAF, Bots) answers browser-like requests from GitHub's runners.                                                                                                 |
| `Contact email link`             | Email Address Obfuscation rewrites the `mailto:` link: turn it off (checklist item 2).                                                                                                           |
| `Same-origin scripts only`       | Web Analytics or RUM injection adds a third-party script: turn it off (item 3).                                                                                                                  |
| `HTML Cache-Control`             | A rule appends `no-store` to the page (item 1).                                                                                                                                                  |
| `Immutable fingerprinted assets` | A rule appends `no-store` or changes the hashed assets' caching (item 1).                                                                                                                        |
| `GLB compression`                | No Compression Rule for `model/gltf-binary` and `application/octet-stream` (item 4), or the audit could not find the `tower-high` GLB URL.                                                       |
| `Fingerprinted asset discovery`  | The audit's patterns no longer match the build's names ([Contracts](CONTRACTS.md#published-names-other-tools-read)); updating `.github/scripts/` is a CI change that needs the owner's approval. |

After changing a dashboard setting, rerun the audit with `gh workflow run cloudflare-audit.yml --ref main`.

## The preview deploy is missing

- Fork pull requests build and audit but never deploy.
- The `preview` job waits for approval of the `preview` environment.
- `The Cloudflare repository secrets are not configured; skipping preview deploy.` is a notice, not a failure; `… set but invalid.` fails the job ([Operations](OPERATIONS.md#credentials)).
