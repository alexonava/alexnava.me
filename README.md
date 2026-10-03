# alexnava.me

Source for [alexnava.me](https://alexnava.me/), Alex Nava's website. The homepage opens on a title card and, on capable devices, a deferred Three.js night scene that tours a timber lookout tower and a twisted tree; About opens an illustrated estate map with Profile, Experience and Contact. The text and the title card stand alone when the scene cannot run.

## Work locally

Use Node.js 22 (`.nvmrc`) and restore dependencies with `npm ci`, then:

```sh
npm run dev
```

Open [http://127.0.0.1:4173/](http://127.0.0.1:4173/). Development mode builds the site, watches its inputs and serves `dist/` through Wrangler; refresh after a rebuild. `npm run dev -- --port 4180` serves on another port when 4173 is taken, for example by another worktree's dev server; each checkout's dev server builds and serves its own `dist/`.

| Command                  | Purpose                                                                    |
| ------------------------ | -------------------------------------------------------------------------- |
| `npm run dev`            | Watch the inputs and serve the local preview (`-- --port N`, default 4173) |
| `npm run preview`        | Build once and serve `dist/` through Wrangler on port 4173                 |
| `npm run watch`          | Rebuild `dist/` on every input change, without a server                    |
| `npm run build`          | Build the publish payload in `dist/` (the same as `build:dist`)            |
| `npm run build:dist`     | Build the publish payload in `dist/`                                       |
| `npm run verify`         | Compile-check the scripts without writing files                            |
| `npm test`               | Run the test suite                                                         |
| `npm run format`         | Format the repository with Prettier                                        |
| `npm run format:check`   | Check formatting without writing                                           |
| `npm run audit:ci`       | Fail on high or critical npm advisories                                    |
| `npm run deploy:preview` | Build and publish `dist/` to the Pages `preview` alias, never production   |

`build.mjs` takes one mode, `--dist` (the default), `--check` or `--watch`, and two options:

- `--outdir DIR` writes the payload to another folder, for example `node build.mjs --outdir .tmp-preview-review/site`. The build refuses the project root or any folder containing it; `src`, `images`, `fonts`, `public`, `tools`, `test`, `node_modules`, `.git`, `.cache` or any folder inside them; a path through a symbolic link; an existing file; and a non-empty folder other than `dist/` that is not an earlier output of this project ([tools/build-output.mjs](tools/build-output.mjs)).
- `--retain-assets` also keeps the hashed scripts, CSS, images, models and fonts that the folder's previous build recorded in its manifest (`.cache/build-outputs/`), as watch builds do for pages still open. Without it, a build removes the files its predecessor recorded and it no longer writes. A build never removes a file the folder's manifest does not record: in a `dist/` with no manifest, it replaces only the files it writes and leaves the rest.

Add `?view=tree&angle=2&tour=0` to stay on one shot; the [scene-mode guide](docs/SCENE-MODES.md) lists every shot and parameter.

## Layout

- `index.html`, `404.html`, `styles.css`: the pages and their styles.
- `src/`: the UI bundle (`app.js`, `main.js`, `ui/`) and the deferred scene (`scene-entry.js`, `scene/`); each bundle carries its own copy of `shared/` and `scene/quality.js`.
- `images/`, `fonts/`: runtime artwork, models, slate maps and fonts, published under content hashes.
- `public/`: hosting, icon and discovery files copied to the site root.
- `tools/`: `build-output.mjs` (staged publication of the payload), `watch.mjs` and `dev.mjs` (rebuilds and the dev server), `owned-process.mjs` (starting and stopping their child processes), `shader-compact.mjs` (the GLSL compactor), `bake-root-shade.mjs` (the tree's baked root tables) and the share card's source, `og-card.html` and `og-card-backdrop.webp`.
- `test/`: the test suite, with shared helpers in `test/support/`.
- `.github/`: workflows and the smoke and audit scripts.

`build.mjs` writes `dist/`, which is generated and never edited or committed.

## Documentation

The [documentation index](docs/README.md) lists every document. The main ones:

- [Architecture](docs/ARCHITECTURE.md): startup, modules, tools, scene lifecycle, quality, build and tests
- [Contracts](docs/CONTRACTS.md): the names, events and attributes the UI and scene share
- [Style](docs/STYLE.md): visual, motion and accessibility rules
- [UI](docs/UI.md): the page's tokens, breakpoints and the scene framing that mirrors them, layers, components, motion, dialogs, deep links and the 404 page
- [Scene modes](docs/SCENE-MODES.md): URL parameters, shots, pauses and status objects
- [Content](docs/CONTENT.md): where the site's words live and how to change them
- [Assets](docs/ASSETS.md): models, maps, artwork, fonts and icons, with every budget
- [Accessibility](docs/ACCESSIBILITY.md): keyboard, screen readers, preferences and browser support
- [Operations](docs/OPERATIONS.md): release gates, CI, deploy, rollback, headers and Cloudflare
- [Glossary](docs/GLOSSARY.md): the terms the code and the docs use, such as film, baseline and the tiers
- [Credits](docs/CREDITS.md) and [Security](SECURITY.md)
- [AGENTS.md](AGENTS.md): instructions for coding agents

Local work never publishes production: `npm run deploy:preview` publishes only the `preview` alias, and production releases go through an approved pull request to `main`.

## License

The code (`build.mjs`, `src/`, `tools/` except `og-card-backdrop.webp`, the tests, the GitHub workflows and scripts, and the HTML and CSS markup) is released under the [MIT License](LICENSE). The artwork, 3D models and textures as prepared for the site, the images, icons and share card (`public/og.png` and `tools/og-card-backdrop.webp`), the writing and the visual design are © 2026 Alex Nava, all rights reserved. The fonts are licensed under the SIL Open Font License 1.1 ([fonts/OFL.txt](fonts/OFL.txt)), and Three.js under the MIT License. [Credits](docs/CREDITS.md) has the details.
