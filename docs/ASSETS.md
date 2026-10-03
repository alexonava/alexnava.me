# Assets

Every binary file the site ships or builds from: what it is, its size and limits, how it is made and how to replace it. Sizes are bytes, read from the files. Provenance and rights are in [Credits](CREDITS.md); how the scene loads and releases models is in [Architecture](ARCHITECTURE.md#scene-lifecycle). Terms such as startup tier, film, stand-in lantern and procedural ground are defined in the [Glossary](GLOSSARY.md).

## Models

`images/architecture/ROLE-TIER.glb`. The startup tier picks the set: high or balanced, never both, and an adaptive quality step never loads another ([architecture-assets.js](../src/scene/architecture-assets.js) `setQuality`).

| File                           |     Bytes | Triangles | Embedded maps                                                       |
| ------------------------------ | --------: | --------: | ------------------------------------------------------------------- |
| `tower-high.glb`               | 1,869,912 |    23,714 | colour, normal: WebP 2048                                           |
| `tower-balanced.glb`           |   920,408 |     9,718 | colour, normal: WebP 1024                                           |
| `tree-high.glb`                | 2,028,412 |    39,827 | colour WebP 2048, metal-roughness WebP 512, normal WebP 1024        |
| `tree-balanced.glb`            |   896,532 |    26,025 | colour WebP 1024, metal-roughness WebP 256, normal WebP 512         |
| `lantern-high.glb`             |   847,992 |     3,000 | colour, metal-roughness, emission: WebP 2048; normal: **JPEG** 2048 |
| `lantern-balanced.glb`         |   462,292 |     3,000 | colour, metal-roughness, normal, emission: WebP 1024                |
| `lichen-rock-high.glb`         |   287,212 |     2,990 | colour, normal: WebP 1024                                           |
| `lichen-rock-balanced.glb`     |   113,000 |     1,194 | colour, normal: WebP 512                                            |
| `weathered-stone-high.glb`     |   279,764 |     2,990 | colour, normal: WebP 1024                                           |
| `weathered-stone-balanced.glb` |   111,632 |     1,194 | colour, normal: WebP 512                                            |

Every model is a binary glTF 2.0 with one mesh of one indexed triangle primitive, all buffers and images embedded, and `KHR_mesh_quantization` and `EXT_texture_webp` required. Positions are normalized 16-bit integers except the lantern's, which are floats. The tower and both rocks store tangents; the tree and lantern do not. No model carries an occlusion map. The lantern's scene `extras.lantern` holds its `authoredHeight` (2.48) and its `luminousCenter`, where [lantern.js](../src/scene/lantern.js) places the light; the tree's `extras.tree` records `foliage: false`.

The tower and tree are required: without either the scene returns to the title card. The lantern and rocks are optional. If the lantern fails, the tree keeps the stand-in lantern, an iron post lantern [architecture.js](../src/scene/architecture.js) builds in code; if a rock fails, there are no rocks.

### What the loader accepts

[architecture-assets.js](../src/scene/architecture-assets.js) `loadArchitectureAsset` and `validateEmbeddedGlb` refuse a model, and its role falls back, when:

- the response is not OK, or its `Content-Length` or body exceeds the tier's per-model limit (`ARCHITECTURE_ASSET_BUDGETS`);
- the header is not `glTF` version 2 with a length equal to the file's and a 4-byte-aligned JSON chunk;
- any buffer or image has a `uri` (everything must be embedded);
- it has skins or animations;
- `extensionsRequired` names anything but `EXT_texture_webp`, `KHR_texture_transform`, `KHR_mesh_quantization` and `KHR_materials_emissive_strength`;
- an embedded image fails to decode.

`test/architecture-assets.test.mjs` also requires one mesh with one triangle primitive, at least one image, and `POSITION`, `NORMAL` and `TEXCOORD_0`; `test/lantern.test.mjs` requires the lantern's four maps, its 3,000 triangles, a positive `emissiveFactor` and the emitter metadata.

## Slate maps

`images/materials/`, lossy WebP without alpha. The film ground loads them once the film is on ([filmic-earth.js](../src/scene/filmic-earth.js) `FILM_GROUND_PRESETS.slate`), and [stone-detail.js](../src/scene/stone-detail.js) rejects any map whose pixel size differs from the expected one; the procedural ground then stays.

| File                     |   Bytes | Size | Tier     |
| ------------------------ | ------: | ---- | -------- |
| `slate-color-1024.webp`  | 193,482 | 1024 | high     |
| `slate-normal-1024.webp` | 361,594 | 1024 | high     |
| `slate-color-512.webp`   |  65,168 | 512  | balanced |
| `slate-normal-512.webp`  | 111,126 | 512  | balanced |
| `slate-detail-512.webp`  |  24,542 | 512  | both     |

## Page artwork

`images/`, lossy WebP, used by [styles.css](../styles.css).

| File                             |  Bytes | Pixels  | Alpha | Use                                                                                                                          |
| -------------------------------- | -----: | ------- | ----- | ---------------------------------------------------------------------------------------------------------------------------- |
| `paper-grain.webp`               |  1,996 | 384×384 | no    | Paper fill, tiled (dialogs and the 404)                                                                                      |
| `paper-edge.webp`                | 89,244 | 768×768 | yes   | Paper edge, `border-image` slice 96                                                                                          |
| `paper-vignette-profile.webp`    | 28,356 | 420×420 | yes   | Profile dialog                                                                                                               |
| `paper-vignette-experience.webp` | 35,420 | 420×420 | yes   | Experience dialog                                                                                                            |
| `paper-vignette-contact.webp`    | 27,978 | 420×420 | yes   | Contact dialog                                                                                                               |
| `estate-map-desktop.webp`        | 99,920 | 960×640 | yes   | About map (3:2)                                                                                                              |
| `estate-map-portrait.webp`       | 93,690 | 600×900 | yes   | About map on portrait viewports (squares included) up to 600 px wide, `(max-width: 600px) and (orientation: portrait)` (2:3) |

## Fonts

`fonts/`. The build discovers every `fonts/*.woff2` ([build.mjs](../build.mjs) `fontAssetManifest`).

| File                                |  Bytes | Weights | Role         |
| ----------------------------------- | -----: | ------- | ------------ |
| `cormorant-garamond-variable.woff2` | 37,640 | 300–700 | Display      |
| `instrument-sans-variable.woff2`    | 30,092 | 400–700 | Body and UI  |
| `OFL.txt`                           |  4,486 |         | Font license |

## Icons and share card

`public/`, copied to the site root under stable names.

| File                    |   Bytes | Pixels    | Notes                                         |
| ----------------------- | ------: | --------- | --------------------------------------------- |
| `favicon.ico`           |   5,430 | 16 and 32 | Fallback on both pages, listed before the SVG |
| `favicon.svg`           |     258 | vector    | Page icon on both pages                       |
| `icon.svg`              |     266 | vector    | Manifest, `any`                               |
| `icon-maskable.svg`     |     256 | vector    | Manifest, `maskable`                          |
| `apple-touch-icon.png`  |   2,498 | 180×180   | Opaque, palette                               |
| `icon-192.png`          |   9,005 | 192×192   | RGBA                                          |
| `icon-512.png`          |  26,321 | 512×512   | RGBA                                          |
| `icon-maskable-512.png` |  13,398 | 512×512   | Opaque RGB                                    |
| `og.png`                | 296,091 | 1200×630  | Share card; opaque, 224-colour palette        |

`tools/og-card-backdrop.webp` (66,076 bytes, 1600×900, opaque) is the share card's backdrop: a still of the live scene's opening shot, The watch, with every page layer but the canvas hidden. It is never published (`test/hosting.test.mjs`, `test/bundle-output.test.mjs`).

## Sources

Only the share card is generated in the repository. Everything else is committed as delivered; [Credits](CREDITS.md) records where each came from, and the preparation scripts and records named there are in the owner's private archive.

| Assets                        | Made                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tower, rocks                  | Decimated in Blender, maps re-baked with Cycles, from supplied Meshy models ([Credits](CREDITS.md))                                                                                                                                                                                                                                                                                |
| Tree                          | Reduced in Blender from a supplied Meshy model (the GLB's `asset.generator`)                                                                                                                                                                                                                                                                                                       |
| Lantern                       | Repackaged by a Node script from its v1 GLB of a supplied Meshy model: positions byte-identical, normals and UVs quantized; colour, metal-roughness and the balanced normal map encoded as WebP from the supplied source; the emission map as lossless WebP of the v1 PNG pixels; the high tier's normal map kept as the v1 JPEG (`asset.generator`, `scenes[0].extras.packaging`) |
| Slate maps                    | Baked in Blender from a supplied Meshy model                                                                                                                                                                                                                                                                                                                                       |
| Paper textures                | Generated with OpenAI's image tool and prepared as WebP                                                                                                                                                                                                                                                                                                                            |
| Vignettes, estate maps        | No record in the repository                                                                                                                                                                                                                                                                                                                                                        |
| Fonts                         | Variable woff2 subsets of the two OFL fonts; the subsetting is not in the repository                                                                                                                                                                                                                                                                                               |
| Icons                         | No generator in the repository                                                                                                                                                                                                                                                                                                                                                     |
| `public/og.png`               | Rendered from `tools/og-card.html` over the backdrop ([below](#refresh-the-share-card))                                                                                                                                                                                                                                                                                            |
| `tools/og-card-backdrop.webp` | A 1600×900 still of the accepted live scene's opening shot, The watch                                                                                                                                                                                                                                                                                                              |

## Budgets

| Budget                                                 | Limit                                              | Now              | Enforced by                                                                                                 |
| ------------------------------------------------------ | -------------------------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------- |
| Any one model, high                                    | 6 MiB (6,291,456)                                  | 2,028,412 (tree) | The loader (`ARCHITECTURE_ASSET_BUDGETS`) and `bundle-output`                                               |
| Any one model, balanced                                | 3 MiB (3,145,728)                                  | 920,408 (tower)  | The same                                                                                                    |
| Complete scene, high: five models and three slate maps | 6 MiB                                              | 5,892,910        | `bundle-output`: "the complete scene fits 6 MiB on high and 3 MiB on balanced…"                             |
| Complete scene, balanced                               | 3 MiB                                              | 2,704,700        | The same                                                                                                    |
| UI bundle (`app.HASH.js`)                              | under 30 KiB                                       |                  | `bundle-output`: "UI bundle stays under the LCP budget"                                                     |
| Scene entry and the chunks it imports statically       | under 820 KiB, exactly two files                   |                  | `bundle-output`: "scene bundle stays under the deferred-payload budget"                                     |
| Paper grain, paper edge and the three vignettes        | 200 KiB (204,800)                                  | 182,994          | `markup-accessibility`: "three distinct transparent paper vignettes share the 200 KiB section-paper budget" |
| Both estate maps                                       | 200 KiB (204,800)                                  | 193,610          | `bundle-output`: "estate map artwork is hashed, responsive and under 200 KiB combined"                      |
| `public/og.png`                                        | opaque, exactly 1200×630, at most 300 KB (300,000) | 296,091          | `hosting`: "the share image is an opaque 1200x630 PNG of at most 300 KB, as its tags say"                   |

Lazy scene chunks are outside the script budget. Script sizes change with every build; `npm run build:dist` prints them.

## Publication

The build publishes these sources only as `name.HASH.ext`, eight hex digits of the file's SHA-256, cached immutably for a year: the paper and estate-map artwork, every model, the slate maps and the fonts ([build.mjs](../build.mjs) `isFingerprintedSource`), besides the scripts and the stylesheet. Pages, the stylesheet and the scene name only the hashed copies. `public/` files and `fonts/OFL.txt` keep stable names and revalidate after seven days; after a release that changes one, purge its URL ([Operations](OPERATIONS.md#headers-and-caching)). Nothing in `tools/` is published.

`test/bundle-output.test.mjs` fails when a file in `images/` is published under its plain name or is missing under its hashed name, and `test/hosting.test.mjs` expects exactly 22 fingerprinted files in `images/` (2 paper textures, 3 vignettes, 2 estate maps, 10 models and 5 slate maps); a new file there means updating that count. `.gitignore` ignores `*.png` except `og.png`, `apple-touch-icon.png`, `icon-192.png`, `icon-512.png` and `icon-maskable-512.png`, so a new PNG must be added there as an exception before Git sees it.

## How to

### Replace a model

1. Prepare the GLB to the loader's rules above, within its tier's limit, with the same role and tier name. Keep the supplied silhouettes, UVs and map resolutions ([Style](STYLE.md#materials-and-lighting)).
2. Keep each tier's complete scene within its budget.
3. When the tree changes, run `node tools/bake-root-shade.mjs` and paste the `ROOT_RESTS`, `ROOT_SHADE` and `ROOT_COVER` it prints over those constants in [terrain-build.js](../src/scene/terrain-build.js); `test/terrain-build.test.mjs` re-bakes both tree variants and fails on any difference.
4. Recheck every shot it appears in ([Scene modes](SCENE-MODES.md#capture-recipe)); `test/framing.test.mjs` fits the directed shots to the delivered tower, tree and lantern on both tiers.
5. Update the tables in this file and the model's entry in [Credits](CREDITS.md).

The build hashes the new bytes, so the file needs no other wiring. Replacing the tower or tree also changes the UI bundle, which names those two URLs and sizes for the early request and the loading line.

### Add a model role

Name the role in [build.mjs](../build.mjs) `architectureAssetManifest` and in [architecture-assets.js](../src/scene/architecture-assets.js) `ROLES`, add both tier files, and give it a consumer (a channel in `createArchitectureAssetController`, or a rock type in [rock-scatter.js](../src/scene/rock-scatter.js) `ROCK_TYPES`). Then update the role lists in `test/bundle-output.test.mjs`, `test/architecture-assets.test.mjs` and `test/build.test.mjs`, the image count in `test/hosting.test.mjs`, the budgets and this file.

### Replace the slate maps

Keep the five names and exact pixel sizes (1024 or 512; the detail map 512 on both tiers), seamless tiles, and the complete-scene budgets. stone-detail.js rejects any other size at runtime.

### Replace the paper, vignettes or estate maps

Keep the file names, the vignettes at 420×420 with alpha and each distinct, and the estate maps at 3:2 (desktop) and 2:3 (portrait) with alpha. Hold paper grain, paper edge and the vignettes to 200 KiB together, and the two maps to 200 KiB together. A new image needs its name in `FINGERPRINTED_PAPER` in [build.mjs](../build.mjs) and the count in `test/hosting.test.mjs`.

### Replace an icon

Keep the names and sizes: `apple-touch-icon.png` 180×180 and `icon-maskable-512.png` 512×512 opaque (launchers crop them), `icon-192.png` and `icon-512.png` at their sizes, `favicon.ico` with 16 and 32 px images. `test/hosting.test.mjs` checks each, the manifest's icon list and the homepage's icon links; `test/markup-accessibility.test.mjs` holds the 404's icon links equal to the homepage's. Purge the changed URLs after the release.

### Change a font

The two variable fonts are the only ones the design allows ([Style](STYLE.md#palette-and-type)). To replace one, keep its file name or update every reference: the `@font-face` rule in [styles.css](../styles.css), the `<link rel="preload">`s in [index.html](../index.html) and [404.html](../404.html), the share card's own `@font-face` URLs in [tools/og-card.html](../tools/og-card.html), and `fonts/OFL.txt`'s copyright lines. `test/bundle-output.test.mjs` requires every `fonts/*.woff2` to be in the stylesheet and preloaded, each page's preloads to name exactly the stylesheet's fonts, and the two copyright lines; `test/markup-accessibility.test.mjs` holds the 404's preloads equal to the homepage's. `test/markup-accessibility.test.mjs` finds the two `@font-face` rules by file name (`cormorant-garamond-variable.woff2`, `instrument-sans-variable.woff2`) and expects weight ranges 300–700 and 400–700, so a renamed file changes that test too.

### Refresh the share card

1. Refresh `tools/og-card-backdrop.webp` only from an accepted live view: a 1600×900 still of The watch with every page layer but the canvas hidden. Edit `tools/og-card.html` when the card's text changes.
2. Render and quantize the card with the commands in `tools/og-card.html`'s header comment (headless Edge, then ImageMagick to a palette PNG).
3. Use the largest dither amount that keeps `public/og.png` at or under 300 KB (the header comment gives the steps), then run `node --test test/hosting.test.mjs`, which holds it opaque, exactly 1200×630 and at most 300 KB.
4. After the release, purge `/og.png` ([Operations](OPERATIONS.md#headers-and-caching)) and re-scrape it with LinkedIn Post Inspector.
