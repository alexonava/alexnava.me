# alexnava.me

Source for [alexnava.me](https://alexnava.me/), Alex Nava's website. The homepage opens on a title card and, on capable devices, a deferred Three.js night scene that tours a timber lookout tower and a twisted tree; About opens an illustrated estate menu with Profile, Experience and Contact. The text and the title card stand alone when the scene cannot run.

## Work locally

Use Node.js 22 (`.nvmrc`) and restore dependencies with `npm ci`, then:

```sh
npm run dev
```

Open [http://127.0.0.1:4173/](http://127.0.0.1:4173/). Development mode builds the site, watches its inputs and serves `dist/` through Wrangler; refresh after a rebuild. `npm run dev -- --port 4180` starts a second preview.

| Command                | Purpose                                         |
| ---------------------- | ----------------------------------------------- |
| `npm run dev`          | Watch the inputs and serve the local preview    |
| `npm run preview`      | Build once and serve through Wrangler           |
| `npm run build:dist`   | Build the publish payload in `dist/`            |
| `npm run verify`       | Compile-check the scripts without writing files |
| `npm test`             | Run the test suite                              |
| `npm run format`       | Format the repository with Prettier             |
| `npm run format:check` | Check formatting without writing                |
| `npm run audit:ci`     | Fail on high or critical npm advisories         |

Add `?view=tree&angle=2&tour=0` to hold one shot; the [scene-mode guide](docs/SCENE-MODES.md) lists every shot and parameter.

## Layout

- `index.html`, `404.html`, `styles.css`: the pages and their styles.
- `src/`: the UI bundle (`app.js`, `main.js`, `ui/`, `shared/`) and the deferred scene (`scene-entry.js`, `scene/`).
- `images/`, `fonts/`: runtime artwork, models, slate maps and fonts, published under content hashes.
- `public/`: hosting, icon and discovery files copied to the site root.
- `tools/`: build, watch and dev-server helpers, the shader compactor and the share-card source.
- `test/`: the test suite, with shared helpers in `test/support/`.
- `.github/`: workflows and the smoke and audit scripts.

`build.mjs` writes `dist/`, which is generated and never edited or committed.

## Documentation

- [Architecture](docs/ARCHITECTURE.md): startup, modules, scene lifecycle, quality, assets, build and tests
- [Style](docs/STYLE.md): visual, motion and accessibility rules
- [Scene modes](docs/SCENE-MODES.md): URL parameters, shots, pauses and status objects
- [Operations](docs/OPERATIONS.md): release gates, CI, deploy, rollback, headers and Cloudflare
- [Credits](docs/CREDITS.md) and [Security](SECURITY.md)
- [AGENTS.md](AGENTS.md): instructions for coding agents

Local work never publishes the site; production releases go through an approved pull request to `main`.

## License

The code (`build.mjs`, `src/`, `tools/`, the tests, the workflows and the HTML and CSS markup) is released under the [MIT License](LICENSE). The artwork, 3D models and textures as prepared for the site, the images, icons and share card, the writing and the visual design are © 2026 Alex Nava, all rights reserved. The fonts are licensed under the SIL Open Font License 1.1 ([fonts/OFL.txt](fonts/OFL.txt)), and Three.js under the MIT License. [Credits](docs/CREDITS.md) has the details.
