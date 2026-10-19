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
| `mountain-ridge-high.glb`      |   188,492 |     3,799 | albedo, object-space normal WebP 512; AO/snow lossless WebP 256     |
| `mountain-ridge-balanced.glb`  |   106,184 |     3,799 | albedo, object-space normal WebP 256; AO/snow lossless WebP 128     |
| `mountain-spine-high.glb`      |   187,796 |     3,799 | albedo, object-space normal WebP 512; AO/snow lossless WebP 256     |
| `mountain-spine-balanced.glb`  |   107,504 |     3,799 | albedo, object-space normal WebP 256; AO/snow lossless WebP 128     |
| `mountain-summit-high.glb`     |   264,272 |     3,799 | albedo, object-space normal WebP 512; AO/snow lossless WebP 256     |
| `mountain-summit-balanced.glb` |   133,800 |     3,799 | albedo, object-space normal WebP 256; AO/snow lossless WebP 128     |

Every model is a binary glTF 2.0 with one mesh of one indexed triangle primitive, all buffers and images embedded, and `KHR_mesh_quantization` and `EXT_texture_webp` required. Positions are normalized 16-bit integers except the lantern's, which are floats. The tower and both rocks store tangents; the tree, lantern and mountains do not. Only the mountains carry an occlusion texture. The lantern's scene `extras.lantern` holds its `authoredHeight` (2.48) and `luminousCenter`, where [lantern.js](../src/scene/lantern.js) places the light; the tree's `extras.tree` records `foliage: false`. The mountains keep the same culled geometry on both tiers, in the full massif's frame (front +Z, bounding X/Z centered, base y = 0, largest horizontal half-extent 1). Node `extras.mountain` records `normalSpace: "object"`, `materialLayout: "albedo-ao-snow-v1"`, the measured `albedoMean`, the matched bake's `albedoBakeSHA256` and the viewing `envelope` each placement stays inside. The three textures occupy standard GLB slots: `baseColorTexture` is sRGB albedo, `normalTexture` is the existing object-space normal in glTF axes, and `occlusionTexture` is `NoColorSpace` data with R ambient occlusion and G source snow/whiteness. The custom massif shader reads these channels explicitly; snow coverage and AO are preserved losslessly. `test/mountain-massifs.test.mjs` caps each massif role at 280,000 bytes high and 140,000 balanced, below the generic loader's per-model limits.

Both tower and tree tiers include bounded local vertex repairs: a small tree-fork volume adjustment and a recess at one visible gallery rail joint. Only positions and affected normal/tangent frames change inside the selected neighborhoods. Triangle indices, UVs, embedded maps, GLB JSON, byte lengths, AABBs, ground contacts and root geometry stay exact; this is not a remesh. `tools/repair-landmark-geometry.py` reproduces the four approved results from SHA-pinned original GLBs, validating every result before writing output.

The tower and tree are required: without either the scene returns to the title card. The lantern, rocks and mountains are optional. If the lantern fails, the tree keeps the stand-in lantern, an iron post lantern [architecture.js](../src/scene/architecture.js) builds in code; if a rock fails, there are no rocks; if a mountain fails or misses its 12 s deadline, the five procedural rings stand in for all three.

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
| `slate-grit-1024.webp`   | 131,758 | 1024 | high     |
| `slate-relief-1024.webp` |  94,770 | 1024 | high     |
| `slate-color-512.webp`   |  65,168 | 512  | balanced |
| `slate-normal-512.webp`  | 111,126 | 512  | balanced |
| `slate-grit-512.webp`    |  56,578 | 512  | balanced |
| `slate-relief-512.webp`  |  39,862 | 512  | balanced |
| `slate-detail-512.webp`  |  24,542 | 512  | both     |

The grit and relief maps are the close soil near the lens (mud-ground.js `SLATE_CLOSE`): greyscale albedo detail and height from CC0 PolyHaven "Dirt" ([Credits](CREDITS.md)), made by `Assets/Materials/dirt-close-v1/scripts/make-dirt-close.py`.

## Coast detail

`images/materials/`, two independent optional rock maps shared by high and balanced. [coast-detail.js](../src/scene/coast-detail.js) requests them only after reveal while the coast is active, then stages each until a cut or a still frame. Either can fail without blocking the other or the reveal. Procedural shading remains available for each missing input.

The river and waterfall add no downloaded assets. Their geometry prepares in the lazy terrain owner. The river's upper water surface shares the ground's indexed geometry and material; the solid bed remains the height used by walking and planting. The current terrain ceiling is 78,000 solid-bed triangles plus 8,000 water-surface triangles, separately enforced by the river-channel regressions. The closed waterfall uses one opaque front-side draw. These water limits leave the existing combined cliff, stack and rubble ceilings of 45,000 triangles high and 25,000 balanced unchanged.

| File                    |  Bytes | Size | Tier |
| ----------------------- | -----: | ---- | ---- |
| `coast-albedo-512.webp` | 77,902 | 512  | both |
| `coast-detail-256.webp` | 48,186 | 256  | both |

The 512px lossy albedo tile is sRGB and is normalized in the shader by its measured linear RGB mean (`COAST_ALBEDO.mean`) before mixing with calibrated dark rock reflectance. It supplies the face, stacks and exposed shelf bedrock, returning to the slate ground inland. Its independent streamed-body limit is 96 KiB. The 256px lossless detail tile packs OpenGL normal X/Y in red/green (green is not inverted) and roughness in blue; the shader reconstructs positive normal Z. It is `NoColorSpace` data, with a 48 KiB streamed-body limit. Both use repeating mipmaps, an 8 s deadline and the same 6.56-unit tile, corresponding to the source's 2 m. The diffuse, normal and roughness sources are CC0 Poly Haven “Seaside Rock” by Dimitrios Savva ([Credits](CREDITS.md#coast-rock-detail)). `tools/bake-coast-albedo.py` produces the colour tile from the exact 1k diffuse source with its MD5 checked and reports the encoded tile's linear mean; it requires Pillow only for authoring. The data tile's independent 5-bit normal channels and 4-bit roughness channel are packed by `Assets/Materials/coast-detail-v1/make-coast-detail.py` in the private archive.

## Fonts

`fonts/`. The build discovers every `fonts/*.woff2` ([build.mjs](../build.mjs) `fontAssetManifest`).

| File                                |  Bytes | Weights | Role         |
| ----------------------------------- | -----: | ------- | ------------ |
| `cormorant-garamond-variable.woff2` | 37,640 | 300–700 | Display      |
| `instrument-sans-variable.woff2`    | 30,092 | 400–700 | Body and UI  |
| `OFL.txt`                           |  4,486 |         | Font license |

## Icons and share card

`public/`, copied to the site root under stable names.

| File                    |   Bytes | Pixels    | Notes                                                     |
| ----------------------- | ------: | --------- | --------------------------------------------------------- |
| `favicon.ico`           |   5,430 | 16 and 32 | Fallback on both pages, listed before the SVG; BMP images |
| `favicon.svg`           |   3,394 | vector    | Page icon on both pages                                   |
| `icon.svg`              |   3,394 | vector    | Manifest, `any`; the same file as `favicon.svg`           |
| `icon-maskable.svg`     |   3,423 | vector    | Manifest, `maskable`                                      |
| `apple-touch-icon.png`  |   1,101 | 180×180   | Opaque palette                                            |
| `icon-192.png`          |   1,969 | 192×192   | Palette with transparency (tRNS)                          |
| `icon-512.png`          |  18,901 | 512×512   | RGBA                                                      |
| `icon-maskable-512.png` |   2,928 | 512×512   | Opaque palette                                            |
| `og.png`                | 298,931 | 1200×630  | Share card; opaque, 224-colour palette                    |

The icons are the initials AN in the name's face, Cormorant Garamond 700, in the name's colour (`#f7f1ea`) on the night (`#090b16`) ([Style](STYLE.md#static-images)). `favicon.svg` and `icon.svg` draw, on a 512 viewBox, the night tile with its corners rounded at 112 and the initials as one outline path (even-odd fill), so they need no font. `icon-maskable.svg` is full bleed, its initials scaled to 0.815 of theirs to sit inside the maskable safe circle, and `apple-touch-icon.png` is `icon.svg`'s drawing full bleed (iOS rounds it). The PNGs and the ICO's images are Chrome's renderings of these drawings.

`tools/og-card-backdrop.webp` (43,954 bytes, 1600×670, opaque) is the share card's backdrop: the lookout's gallery (Gallery detail) under the milky banks, the owner's pick of 2026-10-16: a still of that shot with every page layer but the canvas hidden, the sky's cloud directions turned 70 degrees so The watch's banks stand behind the cabin, and the shot's light lifted a little (fill 1.5, key 1.1). It is never published (`test/hosting.test.mjs`, `test/bundle-output.test.mjs`).

## Sources

Runtime assets are committed in their delivered form. Local authoring helpers also rebuild the matched mountain albedo packaging and coastal colour tile from cached sources, alongside the share-card renderer. They are not runtime dependencies and fetch no artwork; [Credits](CREDITS.md) records the private sources and preparation records.

| Assets                        | Made                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tower, rocks                  | Decimated in Blender, maps re-baked with Cycles, from supplied Meshy models ([Credits](CREDITS.md))                                                                                                                                                                                                                                                                                   |
| Mountains                     | Culled, skyline-weighted, unwrapped and baked in Blender Cycles from supplied Meshy models. `tools/prepare-mountain-albedo.py` packages the matched cached colour bake with the existing geometry and object normals, and puts preserved AO/snow in the occlusion slot. It checks the bake SHA-256 against the archive report and requires local Pillow/NumPy, not a site dependency. |
| Tree                          | Reduced in Blender from a supplied Meshy model (the GLB's `asset.generator`)                                                                                                                                                                                                                                                                                                          |
| Lantern                       | Repackaged by a Node script from its v1 GLB of a supplied Meshy model: positions byte-identical, normals and UVs quantized; colour, metal-roughness and the balanced normal map encoded as WebP from the supplied source; the emission map as lossless WebP of the v1 PNG pixels; the high tier's normal map kept as the v1 JPEG (`asset.generator`, `scenes[0].extras.packaging`)    |
| Slate maps                    | Baked in Blender from a supplied Meshy model                                                                                                                                                                                                                                                                                                                                          |
| Coast detail                  | The normal/roughness tile is downsampled and packed from CC0 Poly Haven “Seaside Rock.” `tools/bake-coast-albedo.py` checks the diffuse source MD5, downsamples it to 512px and reports the colour tile's measured linear RGB mean. Original maps, metadata and the packed-data preparation are in `Assets/Materials/coast-detail-v1` ([Credits](CREDITS.md#coast-rock-detail)).      |
| Fonts                         | Variable woff2 subsets of the two OFL fonts; the subsetting is not in the repository                                                                                                                                                                                                                                                                                                  |
| Icons                         | The initials traced into outlines by a Node script from Chrome's rendering of Cormorant Garamond 700 at 1000 px (marching squares, simplified to within 0.2 px), and the PNG and ICO images rendered by Chrome from the same drawings by another ([Credits](CREDITS.md)); no generator in the repository                                                                              |
| `public/og.png`               | Rendered from `tools/og-card.html` over the backdrop ([below](#refresh-the-share-card))                                                                                                                                                                                                                                                                                               |
| `tools/og-card-backdrop.webp` | A 1600×670 still of the live scene's Gallery detail under The watch's banks, made with the prototype capture scripts in the owner's archive                                                                                                                                                                                                                                           |

## Budgets

| Budget                                                                           | Limit                                              | Now              | Enforced by                                                                               |
| -------------------------------------------------------------------------------- | -------------------------------------------------- | ---------------- | ----------------------------------------------------------------------------------------- |
| Any one model, high                                                              | 6 MiB (6,291,456)                                  | 2,028,412 (tree) | The loader (`ARCHITECTURE_ASSET_BUDGETS`) and `bundle-output`                             |
| Any one model, balanced                                                          | 3 MiB (3,145,728)                                  | 920,408 (tower)  | The same                                                                                  |
| Complete scene, high: eight models, five slate maps and both optional coast maps | 7.25 MiB (7,602,176)                               | 6,886,086        | `bundle-output`: complete-scene budget, including both optional coastal maps              |
| Complete scene, balanced                                                         | 3.5 MiB (3,670,016)                                | 3,274,716        | The same                                                                                  |
| UI bundle and capability worker (`app.HASH.js` + `webgl-probe.HASH.js`)          | under 30 KiB                                       |                  | `bundle-output`: "UI and capability worker together stay under the existing LCP budget"   |
| Scene entry and the chunks it imports statically                                 | under 831 KiB, exactly two files                   |                  | `bundle-output`: "scene bundle stays under the deferred-payload budget"                   |
| `public/og.png`                                                                  | opaque, exactly 1200×630, at most 300 KB (300,000) | 298,931          | `hosting`: "the share image is an opaque 1200x630 PNG of at most 300 KB, as its tags say" |

The cliff and stack meshes together are capped at 45,000 triangles on high and 25,000 on balanced (`coastGeometrySettings`, `test/coast-geometry.test.mjs`). Their default geometry totals 41,360 and 20,000 triangles; with the river's actual falls notch it totals 41,322 and 19,962. The three buttresses and sparse rubble stay merged into the existing cliff groups rather than adding meshes or passes. The live terrain prepares these same cliff and stack buffers cooperatively in its existing idle slices before handing them to the coastal owner; fixed byte baselines hold the output equal to the synchronous builders. This changes preparation scheduling, not the geometry, shaders, asset downloads or draw groups.

The UI and the one-shot capability worker share the existing 30 KiB budget; the worker does not import Three.js. Lazy scene chunks are outside the script budget. The geometry preparation helper, `architecture-prepare.js`, loads after a required model has parsed; a failed chunk leaves the established synchronous constructor available. The scene's default load carries the tower's stored outline for the loading line's star ([opening-outline.js](../src/scene/opening-outline.js), about 10 kB of it). Script sizes change with every build; `npm run build:dist` prints them.

## Publication

The build publishes these sources only as `name.HASH.ext`, eight hex digits of the file's SHA-256, cached immutably for a year: every model, the slate maps, both coast maps and the fonts ([build.mjs](../build.mjs) `isFingerprintedSource`), besides the scripts and stylesheet. Pages, the stylesheet and scene name only the hashed copies. Optional coastal URLs remain in the lazy terrain chunk, outside the entry's slate manifest. `public/` files are copied under their stable names.

`test/bundle-output.test.mjs` fails when a file in `images/` is published under its plain name or is missing under its hashed name, and `test/hosting.test.mjs` expects exactly 26 fingerprinted files in `images/` (16 models, 9 slate maps and the coast detail map); a new file there means updating that count. `images/` holds only `architecture/` and `materials/`, and the stylesheet requests no image: its only URLs are the hashed fonts and `data:` URIs (`test/bundle-output.test.mjs`). `.gitignore` ignores `*.png` except `og.png`, `apple-touch-icon.png`, `icon-192.png`, `icon-512.png` and `icon-maskable-512.png`, so a new PNG must be added there as an exception before Git sees it.

## How to

### Replace a model

1. Prepare the GLB to the loader's rules above, within its tier's limit, with the same role and tier name. Keep the supplied silhouettes, UVs and map resolutions ([Style](STYLE.md#materials-and-lighting)).
2. Keep each tier's complete scene within its budget.
3. When the tree changes, run `node tools/bake-root-shade.mjs` and paste the `ROOT_RESTS`, `ROOT_SHADE` and `ROOT_COVER` it prints over those constants in [terrain-build.js](../src/scene/terrain-build.js); `test/terrain-build.test.mjs` re-bakes both tree variants and fails on any difference.
4. When the tower changes, run `node tools/bake-opening-outline.mjs`, which rewrites [opening-outline.js](../src/scene/opening-outline.js), the tower's stored outline that places the loading line's star before the tower loads; `test/opening-star.test.mjs` re-measures both tower variants and fails until you do.
5. Recheck every shot it appears in ([Scene modes](SCENE-MODES.md#capture-recipe)); `test/framing.test.mjs` fits the directed shots to the delivered tower, tree and lantern on both tiers.
6. Update the tables in this file and the model's entry in [Credits](CREDITS.md).

The build hashes the new bytes, so the file needs no other wiring. Replacing the tower or tree also changes the UI bundle, which names those two URLs and sizes for the early request and the loading line.

### Add a model role

Name the role in [build.mjs](../build.mjs) `architectureAssetManifest` and in [architecture-assets.js](../src/scene/architecture-assets.js) `ROLES`, add both tier files, and give it a consumer (a channel in `createArchitectureAssetController`, a rock type in [rock-scatter.js](../src/scene/rock-scatter.js) `ROCK_TYPES`, or a massif in [hill-silhouette.js](../src/scene/hill-silhouette.js) `MASSIFS.roles`). Then update the role lists in `test/bundle-output.test.mjs`, `test/architecture-assets.test.mjs` and `test/build.test.mjs`, the image count in `test/hosting.test.mjs`, the budgets and this file.

### Replace the slate maps

Keep the nine names and exact pixel sizes (1024 or 512; the detail map 512 on both tiers), seamless tiles, and the complete-scene budgets. stone-detail.js rejects any other size at runtime.

### Replace the coast detail map

Keep the 256×256 dimensions, lossless data encoding, RG OpenGL normal X/Y and B roughness layout, seamless repeat, 6.56-unit tile and 48 KiB response limit. Update its byte table, provenance and complete-scene totals. Its URL belongs only to the lazy coast owner; keep it out of the entry's slate manifest and the UI. Check failure, cancellation, cut-time application and cached reactivation with `test/coast-detail.test.mjs`.

### Replace the coast albedo

Keep the 512×512 sRGB tile, seamless repeat, 6.56-unit scale and 96 KiB response limit. `python tools/bake-coast-albedo.py --source PATH --output images/materials/coast-albedo-512.webp` requires the exact diffuse source documented in [Credits](CREDITS.md#coast-rock-detail) and local Pillow. Record the tool's measured encoded-image `linear_mean` in `COAST_ALBEDO.mean`, update the byte table and complete-scene totals, and keep the URL inside the lazy coastal chunk. Check colour/data independence, failed and stale images, cut-time binding, cached reactivation and shared shelf bindings with `test/coast-albedo.test.mjs`, `test/coast-bedrock.test.mjs` and `test/coast-material.test.mjs`.

### Replace an icon

Keep the names and sizes: `apple-touch-icon.png` 180×180 and `icon-maskable-512.png` 512×512 opaque (launchers crop them), `icon-192.png` and `icon-512.png` at their sizes, `favicon.ico` with 16 and 32 px images. `test/hosting.test.mjs` checks each, the manifest's icon list and the homepage's icon links; `test/markup-accessibility.test.mjs` holds the 404's icon links equal to the homepage's. Purge the changed URLs after the release.

### Change a font

The two variable fonts are the only ones the design allows ([Style](STYLE.md#palette-and-type)). To replace one, keep its file name or update every reference: the `@font-face` rule in [styles.css](../styles.css), the `<link rel="preload">`s in [index.html](../index.html) and [404.html](../404.html), the share card's own `@font-face` URLs in [tools/og-card.html](../tools/og-card.html), and `fonts/OFL.txt`'s copyright lines. `test/bundle-output.test.mjs` requires every `fonts/*.woff2` to be in the stylesheet and preloaded, each page's preloads to name exactly the stylesheet's fonts, and the two copyright lines; `test/markup-accessibility.test.mjs` holds the 404's preloads equal to the homepage's. `test/markup-accessibility.test.mjs` finds the two `@font-face` rules by file name (`cormorant-garamond-variable.woff2`, `instrument-sans-variable.woff2`) and expects weight ranges 300–700 and 400–700, so a renamed file changes that test too.

### Refresh the share card

1. Refresh `tools/og-card-backdrop.webp` only from an accepted live view: a 1600×900 still with every page layer but the canvas hidden, cropped to the picture between the film's widescreen bars (1600×670). Today's is Gallery detail with the sky's cloud directions turned 70 degrees and its light lifted a little, rendered by the prototype capture scripts in the owner's archive (`Assets/Review captures/share-card-20261016`). Edit `tools/og-card.html` when the card's text changes.
2. Render and quantize the card with the commands in `tools/og-card.html`'s header comment (headless Edge, then ImageMagick to a palette PNG).
3. Use the largest dither amount that keeps `public/og.png` at or under 300 KB (the header comment gives the steps). Then set the `?card=` of `index.html`'s `og:image` and `twitter:image` to the first eight hex digits of the new file's SHA-256, so link previews fetch it afresh, and run `node --test test/hosting.test.mjs`, which holds the file opaque, exactly 1200×630 and at most 300 KB, and both tags on its hash.
4. After the release, purge `/og.png` ([Operations](OPERATIONS.md#headers-and-caching)) and re-scrape it with LinkedIn Post Inspector.
