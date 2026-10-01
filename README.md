# alexnava.me

Source for Alex Nava's website. The homepage opens on a cinematic tower and tree scene; About opens the illustrated estate menu and its Profile, Experience and Contact dialogs. Readable text and the static poster remain available when the scene cannot run.

## Work locally

Use Node.js 22 or newer and restore dependencies with `npm ci`.

    npm run dev

Open [localhost:4173](http://127.0.0.1:4173/). Development mode builds the site, watches its inputs and serves it through Wrangler; refresh after a rebuild. Use `npm run dev -- --port 4180` for a second preview.

| Command | Purpose |
| --- | --- |
| npm run dev | Watch inputs and serve the local preview |
| npm run preview | Build once and serve through Wrangler |
| npm run build:dist | Generate the publish payload in dist |
| npm run verify | Compile-check source without writing output |
| npm test | Run the regression suite |
| npm run audit:ci | Check dependency advisories |

Edit JavaScript in src, markup in index.html, styles in styles.css, runtime artwork in images, and the hosting, icon and discovery files (headers, redirects, robots.txt, llms.txt, manifest, icons) in public. Never hand-edit dist. The build emits content-hashed scripts/app.HASH.js, the deferred scripts/scene.HASH.js (an ES module that imports its hashed scripts/scene.*.js chunks), css/styles.HASH.css and fingerprinted runtime images.

Add `?view=tower&angle=1&tour=0` to hold a composition, or `tour=5` for a faster review cadence. The [scene-mode guide](docs/SCENE-MODES.md) lists every shot.

## Documentation

- [Architecture and source map](docs/ARCHITECTURE.md)
- [Camera and scene modes](docs/SCENE-MODES.md)
- [Style](docs/STYLE.md): accepted visual, motion and accessibility constraints
- [AGENTS.md](AGENTS.md): instructions for coding agents
- [Operations](docs/OPERATIONS.md): release gates, deploy, smoke checks and rollback

Local work does not publish the site; production releases go through an approved pull request to main.

[Live website](https://alexnava.me/) · [Credits](docs/CREDITS.md) · [Security](SECURITY.md) · [MIT license](LICENSE)
