# Assets

Every binary file the site ships or builds from: what it is, its size and limits, how it is made and how to replace it. Sizes are bytes, read from the files. Provenance and rights are in [Credits](CREDITS.md); how the scene loads and releases models is in [Architecture](ARCHITECTURE.md#scene-lifecycle). Terms such as startup tier, film, stand-in lantern and procedural ground are defined in the [Glossary](GLOSSARY.md).

## Models

`images/architecture/ROLE-TIER.glb`. The startup tier picks the set: high or balanced, never both, and an adaptive quality step never loads another ([architecture-assets.js](../src/scene/architecture-assets.js) `setQuality`).

| File                           |     Bytes | Triangles | Embedded maps                                                       |
| ------------------------------ | --------: | --------: | ------------------------------------------------------------------- |
| `tree-high.glb`                | 2,028,412 |    39,827 | colour WebP 2048, metal-roughness WebP 512, normal WebP 1024        |
| `tree-balanced.glb`            |   896,532 |    26,025 | colour WebP 1024, metal-roughness WebP 256, normal WebP 512         |
| `lantern-high.glb`             |   847,992 |     3,000 | colour, metal-roughness, emission: WebP 2048; normal: **JPEG** 2048 |
| `lantern-balanced.glb`         |   462,292 |     3,000 | colour, metal-roughness, normal, emission: WebP 1024                |
| `lichen-rock-high.glb`         |   287,212 |     2,990 | colour, normal: WebP 1024                                           |
| `lichen-rock-balanced.glb`     |   113,000 |     1,194 | colour, normal: WebP 512                                            |
| `weathered-stone-high.glb`     |   279,764 |     2,990 | colour, normal: WebP 1024                                           |
| `weathered-stone-balanced.glb` |   111,632 |     1,194 | colour, normal: WebP 512                                            |
| `mountain-ridge-high.glb`      |   135,112 |     3,799 | albedo, object-space normal WebP 512; AO/snow lossless WebP 256     |
| `mountain-ridge-balanced.glb`  |    84,664 |     3,799 | albedo, object-space normal WebP 256; AO/snow lossless WebP 128     |
| `mountain-spine-high.glb`      |   128,664 |     3,800 | albedo, object-space normal WebP 512; AO/snow lossless WebP 256     |
| `mountain-spine-balanced.glb`  |    85,356 |     3,800 | albedo, object-space normal WebP 256; AO/snow lossless WebP 128     |
| `mountain-summit-high.glb`     |   149,020 |     3,799 | albedo, object-space normal WebP 512; AO/snow lossless WebP 256     |
| `mountain-summit-balanced.glb` |    91,140 |     3,799 | albedo, object-space normal WebP 256; AO/snow lossless WebP 128     |

Every model is a binary glTF 2.0 with one mesh of one indexed triangle primitive, all buffers and images embedded, and `KHR_mesh_quantization` and `EXT_texture_webp` required. Positions are normalized 16-bit integers except the lantern's, which are floats. Both rocks store tangents; the tree, lantern and mountains do not. Only the mountains carry an occlusion texture. The lantern's scene `extras.lantern` holds its `authoredHeight` (2.48) and `luminousCenter`, where [lantern.js](../src/scene/lantern.js) places the light; the tree's `extras.tree` records `foliage: false`. The mountains keep the same culled geometry on both tiers, in the full massif's frame (front +Z, bounding X/Z centered, base y = 0, largest horizontal half-extent 1). Node `extras.mountain` records `normalSpace: "object"`, `materialLayout: "albedo-ao-snow-v1"`, the measured `albedoMean`, the matched bake's `albedoBakeSHA256`, the viewing `envelope` each placement stays inside and the real `terrain` it was built from (the massif, the bearing it is seen from, its window in metres, its vertical scale and the elevation source). The three textures occupy standard GLB slots: `baseColorTexture` is sRGB albedo, `normalTexture` is the existing object-space normal in glTF axes, and `occlusionTexture` is `NoColorSpace` data with R ambient occlusion and G source snow/whiteness. The custom massif shader reads these channels explicitly; snow coverage and AO are preserved losslessly. `test/mountain-massifs.test.mjs` caps each massif role at 280,000 bytes high and 140,000 balanced, below the generic loader's per-model limits.

Both tree tiers include a bounded local vertex repair: a small tree-fork volume adjustment. Only positions and affected normal/tangent frames change inside the selected neighborhood. Triangle indices, UVs, embedded maps, GLB JSON, byte lengths, AABBs, ground contacts and root geometry stay exact; this is not a remesh. `tools/repair-landmark-geometry.py` reproduces the two approved results from SHA-pinned original GLBs, validating every result before writing output.

The tree is required: without it the scene returns to the title card. A Lantern study opening prepares that tree and the settled replacement or fallback lantern before reveal. A Watch opening needs no model (the lookout it was composed around left on the owner's call of 2026-10-20; its source models stay in the owner's `Assets/Architecture/tower-v2`). The lantern, rocks and mountains are optional. If the lantern fails, the tree keeps the stand-in lantern, an iron post lantern [architecture.js](../src/scene/architecture.js) builds in code; if a rock fails, there are no rocks; if a mountain fails or misses its 12 s deadline, the five procedural rings stand in for all three.

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

`images/materials/`, lossy WebP without alpha. The nine required slate variants supply five maps per live tier. The selected required set loads once the film is on ([filmic-earth.js](../src/scene/filmic-earth.js) `FILM_GROUND_PRESETS.slate`), and [stone-detail.js](../src/scene/stone-detail.js) rejects any required map whose pixel size differs from the expected one; the procedural ground then stays. The optional soil roughness tile below has independent loading and failure handling.

| File                            |   Bytes | Size | Tier     |
| ------------------------------- | ------: | ---- | -------- |
| `slate-color-1024.webp`         | 193,482 | 1024 | high     |
| `slate-normal-1024.webp`        | 361,594 | 1024 | high     |
| `slate-grit-1024.webp`          | 131,758 | 1024 | high     |
| `slate-relief-1024.webp`        |  94,770 | 1024 | high     |
| `slate-color-512.webp`          |  65,168 | 512  | balanced |
| `slate-normal-512.webp`         | 111,126 | 512  | balanced |
| `slate-grit-512.webp`           |  56,578 | 512  | balanced |
| `slate-relief-512.webp`         |  39,862 | 512  | balanced |
| `slate-detail-512.webp`         |  24,542 | 512  | both     |
| `slate-soil-roughness-512.webp` |   3,042 | 512  | both     |

The grit and relief maps are the close soil near the lens (mud-ground.js `SLATE_CLOSE`): greyscale albedo detail and height from CC0 PolyHaven "Dirt" ([Credits](CREDITS.md)), made by `Assets/Materials/dirt-close-v1/scripts/make-dirt-close.py`.

The independent optional `slate-soil-roughness-512.webp` is 3,042 bytes, shared by both tiers. It is grayscale linear data (`NoColorSpace`), prepared before a close tree opening, or requested after other reveals, with a 12 KiB streamed-body limit and an eight-second deadline. Its owner stages it until a cut or a still frame; failure preserves all five required ground maps. The shader subtracts its encoded mean, 0.9450162550982307, before adding its close-range variation to exposed soil, leaving water and coastal bedrock alone. `tools/bake-soil-roughness.py` verifies the original 16-bit Dirt source SHA-256, normalizes before filtering and produces the 512px WebP at quality 78/method 6. The tile adds about 1.33 MiB of decoded RGBA mip storage. Adaptive quality retains the same asset; disposal restores its binding before freeing the texture and bitmap.

## Coast detail

`images/materials/`, two independent optional rock maps shared by high and balanced. [coast-detail.js](../src/scene/coast-detail.js) requests them only after reveal while the coast is active, then stages each until a cut or a still frame. Either can fail without blocking the other or the reveal. Procedural shading remains available for each missing input.

The river and waterfall add no downloaded assets. Their geometry prepares in the lazy terrain owner. The river's upper water surface shares the ground's indexed geometry and material; the solid bed remains the height used by walking and planting. The current terrain ceiling is 78,000 solid-bed triangles plus 8,000 water-surface triangles, separately enforced by the river-channel regressions. The closed waterfall uses one opaque front-side draw. These water limits leave the existing combined cliff, stack and rubble ceilings of 45,000 triangles high and 25,000 balanced unchanged.

| File                    |  Bytes | Size | Tier |
| ----------------------- | -----: | ---- | ---- |
| `coast-albedo-512.webp` | 77,902 | 512  | both |
| `coast-detail-256.webp` | 48,186 | 256  | both |

The 512px lossy albedo tile is sRGB and is normalized in the shader by its measured linear RGB mean (`COAST_ALBEDO.mean`) before mixing with calibrated dark rock reflectance. It supplies the face, stacks and exposed shelf bedrock, returning to the slate ground inland. Its independent streamed-body limit is 96 KiB. The 256px lossless detail tile packs OpenGL normal X/Y in red/green (green is not inverted) and roughness in blue; the shader reconstructs positive normal Z. It is `NoColorSpace` data, with a 48 KiB streamed-body limit. Both use repeating mipmaps, an 8 s deadline and the same 6.56-unit tile, corresponding to the source's 2 m. The diffuse, normal and roughness sources are CC0 Poly Haven “Seaside Rock” by Dimitrios Savva ([Credits](CREDITS.md#coast-rock-detail)). `tools/bake-coast-albedo.py` produces the colour tile from the exact 1k diffuse source with its MD5 checked and reports the encoded tile's linear mean; it requires Pillow only for authoring. The data tile's independent 5-bit normal channels and 4-bit roughness channel are packed by `Assets/Materials/coast-detail-v1/make-coast-detail.py` in the private archive.

## The cel sky's plates

`images/materials/cel-sky-<key>.webp` are RGBA WebPs of the film sky's own cel banks (estate-sky.js `cloudFieldGLSL`), lit in volume and baked once round the sky, four times as wide as tall: u is the azimuth over a full turn and v runs from 0.78 at the horizon to the zenith. `moon` is lit by the moon and is the plate for every shot without a sun of its own; `close-up`, `root-and-lantern` and `broken-coast` are each lit from that shot's sun (directed-shots.js `sun`). They are display-referred artwork, sampled as `NoColorSpace`; alpha stores real clear-sky windows. The build fingerprints each separately from the slate maps. The bake tools (`tools/sky-bake`, `bake-live.ps1`) are kept in the local review archive.

| File                            | Pixels   | Bytes   | Lit by                                    |
| ------------------------------- | -------- | ------- | ----------------------------------------- |
| `cel-sky-moon.webp`             | 3072×768 | 261,388 | the moon (every shot without its own sun) |
| `cel-sky-close-up.webp`         | 2048×512 | 126,676 | Close-up's sun                            |
| `cel-sky-root-and-lantern.webp` | 2048×512 | 139,096 | Root and lantern's sun                    |
| `cel-sky-broken-coast.webp`     | 2048×512 | 138,348 | The broken coast's sun                    |

The lazy [cloud-plate.js](../src/scene/cloud-plate.js) owner requests them only for the live high and balanced sky: the moon's first, then the suns' one at a time, each within a 640 KiB file limit, a 4,194,304-pixel decode limit and an 8 s abort deadline; all four stay within the owner's 2 MB sky budget. They repeat round the sky with mipmaps on the existing shell, which lends its uniform objects to the stars and the environment capture. A ready plate commits during hidden preparation or on the cut to its shot, and the environment is drawn again with it. Failure leaves the procedural sky and never delays the reveal. Disposal restores borrowed uniforms, frees the owned textures and closes their bitmaps.

## The opening's paper

`images/paper/`, two greyscale lossy WebP tiles of 768×768 that repeat, from the CC0 ambientCG "Paper 006" scan ([Credits](CREDITS.md#the-openings-paper)). The stylesheet's doors lay the detail tile over their paper with an overlay blend; it is not preloaded, so it never delays the UI script on a slow line, and until it lands the paper is its plain colour. Being the largest thing the title card paints, that tile is the page's largest contentful paint, so a heavier tile shows first in CI's Lighthouse LCP. The doors' drawing ([paper-doors.js](../src/doors/paper-doors.js)) reads both on the live path: the height for the sheet's relief and thickness (stored at half its contrast, which the shader restores), the detail for its specks. A missing or failed tile leaves the stylesheet's doors.

| File                |  Bytes | Size | Use                                        |
| ------------------- | -----: | ---- | ------------------------------------------ |
| `paper-detail.webp` | 31,830 | 768  | Specks and fibres (stylesheet and drawing) |
| `paper-height.webp` | 44,910 | 768  | Relief and thickness (drawing)             |

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
| `og.png`                | 298,049 | 1200×630  | Share card; opaque, 224-colour palette                    |

The icons are the initials AN in the name's face, Cormorant Garamond 700, in the name's colour (`#f7f1ea`) on the night (`#090b16`) ([Style](STYLE.md#static-images)). `favicon.svg` and `icon.svg` draw, on a 512 viewBox, the night tile with its corners rounded at 112 and the initials as one outline path (even-odd fill), so they need no font. `icon-maskable.svg` is full bleed, its initials scaled to 0.815 of theirs to sit inside the maskable safe circle, and `apple-touch-icon.png` is `icon.svg`'s drawing full bleed (iOS rounds it). The PNGs and the ICO's images are Chrome's renderings of these drawings.

`tools/og-card-backdrop.webp` (62,498 bytes, 1600×670, opaque) is the share card's backdrop: The broken coast at its native mid-move composition, selected on 2026-10-25. The fully loaded high-quality scene was captured at 1600×900, with its camera held at phase 0.5 and every page layer but the canvas hidden, then clipped between its widescreen bars. The WebP uses quality 88; the 224-colour card uses 92% Floyd–Steinberg diffusion, the highest whole-percent setting under 300,000 bytes for this export. Capture and export receipts retain the source, build and pixel hashes. The backdrop is never published (`test/hosting.test.mjs`, `test/bundle-output.test.mjs`).

## Sources

Runtime assets are committed in their delivered form. Local authoring helpers also rebuild the matched mountain albedo packaging and coastal colour tile from cached sources, alongside the share-card renderer. They are not runtime dependencies and fetch no artwork; [Credits](CREDITS.md) records the private sources and preparation records.

| Assets                        | Made                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rocks                         | Decimated in Blender, maps re-baked with Cycles, from supplied Meshy models ([Credits](CREDITS.md))                                                                                                                                                                                                                                                                                |
| Mountains                     | Real massifs (the Grandes Jorasses, the Dents du Midi and the Weisshorn) meshed from public elevation data, given their crags, rock tones and snow by slope, altitude and curvature, then culled, skyline-weighted, unwrapped and baked in Blender Cycles in the private `Assets/Architecture/mountains-v2` ([Credits](CREDITS.md)).                                               |
| Tree                          | Reduced in Blender from a supplied Meshy model (the GLB's `asset.generator`)                                                                                                                                                                                                                                                                                                       |
| Lantern                       | Repackaged by a Node script from its v1 GLB of a supplied Meshy model: positions byte-identical, normals and UVs quantized; colour, metal-roughness and the balanced normal map encoded as WebP from the supplied source; the emission map as lossless WebP of the v1 PNG pixels; the high tier's normal map kept as the v1 JPEG (`asset.generator`, `scenes[0].extras.packaging`) |
| Slate maps                    | Baked in Blender from a supplied Meshy model                                                                                                                                                                                                                                                                                                                                       |
| Coast detail                  | The normal/roughness tile is downsampled and packed from CC0 Poly Haven “Seaside Rock.” `tools/bake-coast-albedo.py` checks the diffuse source MD5, downsamples it to 512px and reports the colour tile's measured linear RGB mean. Original maps, metadata and the packed-data preparation are in `Assets/Materials/coast-detail-v1` ([Credits](CREDITS.md#coast-rock-detail)).   |
| The opening's paper           | Greyscale tiles from the CC0 ambientCG "Paper 006" 1K scan: its colour's luminance against its own local mean (detail) and its displacement at half contrast (height), made by `Assets/Materials/paper-v1/make-paper.ps1` from the archived source set ([Credits](CREDITS.md#the-openings-paper)).                                                                                 |
| Fonts                         | Variable woff2 subsets of the two OFL fonts; the subsetting is not in the repository                                                                                                                                                                                                                                                                                               |
| Icons                         | The initials traced into outlines by a Node script from Chrome's rendering of Cormorant Garamond 700 at 1000 px (marching squares, simplified to within 0.2 px), and the PNG and ICO images rendered by Chrome from the same drawings by another ([Credits](CREDITS.md)); no generator in the repository                                                                           |
| `public/og.png`               | Rendered from `tools/og-card.html` over the backdrop ([below](#refresh-the-share-card))                                                                                                                                                                                                                                                                                            |
| `tools/og-card-backdrop.webp` | A 1600×670 high-quality still of The broken coast at native move phase 0.5, cropped from the fully loaded live scene                                                                                                                                                                                                                                                               |

## Budgets

| Budget                                                                                           | Limit                                              | Now              | Enforced by                                                                               |
| ------------------------------------------------------------------------------------------------ | -------------------------------------------------- | ---------------- | ----------------------------------------------------------------------------------------- |
| Any one model, high                                                                              | 6 MiB (6,291,456)                                  | 2,028,412 (tree) | The loader (`ARCHITECTURE_ASSET_BUDGETS`) and `bundle-output`                             |
| Any one model, balanced                                                                          | 3 MiB (3,145,728)                                  | 896,532 (tree)   | The same                                                                                  |
| Complete scene, high: seven models, five slate maps, soil roughness and both optional coast maps | 7.25 MiB (7,602,176)                               | 4,791,452        | `bundle-output`: complete-scene budget, including all optional maps                       |
| Complete scene, balanced                                                                         | 3.5 MiB (3,670,016)                                | 2,271,022        | The same                                                                                  |
| UI bundle and capability worker (`app.HASH.js` + `webgl-probe.HASH.js`)                          | under 34 KiB                                       |                  | `bundle-output`: "UI and capability worker together stay under the existing LCP budget"   |
| Scene entry and the chunks it imports statically                                                 | under 835 KiB, exactly two files                   |                  | `bundle-output`: "scene bundle stays under the deferred-payload budget"                   |
| `public/og.png`                                                                                  | opaque, exactly 1200×630, at most 300 KB (300,000) | 298,049          | `hosting`: "the share image is an opaque 1200x630 PNG of at most 300 KB, as its tags say" |

The cliff and stack meshes together are capped at 45,000 triangles on high and 25,000 on balanced (`coastGeometrySettings`, `test/coast-geometry.test.mjs`). Their default geometry totals 41,360 and 20,000 triangles; with the river's actual falls notch it totals 41,322 and 19,962. The three buttresses and sparse rubble stay merged into the existing cliff groups rather than adding meshes or passes. The live terrain prepares these same cliff and stack buffers cooperatively in its existing idle slices before handing them to the coastal owner; fixed byte baselines hold the output equal to the synchronous builders. This changes preparation scheduling, not the geometry, shaders, asset downloads or draw groups.

Foreground cover is a separate optional field of 8-unit chunks, capped at 12 visible batches and 160,000 triangles on high or six batches and 64,000 triangles on balanced. Resident geometry buffers are bounded to 32 MiB / 16 MiB. The field retains compact, finite camera coverage metadata rather than generating an infinite landscape. Geometry is prepared in idle slices, never in the frame callback. Small chunk material owners share one program, wind clock and quality uniforms; each owns only its fade binding, so Three uploads that fade correctly on each draw. They add no shadow casters, downloaded models or rendering passes.

The UI and the one-shot capability worker share a 34 KiB budget (30 KiB until the opening's doors, its preparation and its chance met the lantern opening's light: the owner's call of 2026-10-26); the worker does not import Three.js. Lazy scene chunks are outside the script budget, and so is the doors' script (`doors.HASH.js`, about 15.6 kB), which loads only on the live path, beside the scene bundle, and with the height tile draws the doors as paper. The geometry preparation helper, `architecture-prepare.js`, loads after a required model has parsed; a failed chunk leaves the established synchronous constructor available. The scene's default load carries The watch's stored outline, which frames that shot and places its loading star ([opening-outline.js](../src/scene/opening-outline.js), about 10 kB of it), and the supplied lantern's, which places a Lantern study opening's light ([opening-lantern.js](../src/scene/opening-lantern.js): about 1.6 kB, 3.3 kB with its fit, which raised the scene's budget from 831 to 835 KiB on the owner's call of 2026-10-26). Script sizes change with every build; `npm run build:dist` prints them.

## Publication

The build publishes these sources only as `name.HASH.ext`, eight hex digits of the file's SHA-256, cached immutably for a year: every model, the slate maps, both coast maps, the opening's two paper maps and the fonts ([build.mjs](../build.mjs) `isFingerprintedSource`), besides the scripts and stylesheet. Pages, the stylesheet, the scene and the doors' script name only the hashed copies (the paper's through `paperAssetManifest` and `__BABEL_PAPER_URLS__`). Optional coastal URLs remain in the lazy terrain chunk, outside the entry's slate manifest. `public/` files are copied under their stable names.

`test/bundle-output.test.mjs` fails when a file in `images/` is published under its plain name or is missing under its hashed name, and `test/hosting.test.mjs` expects exactly 28 fingerprinted files in `images/` (14 models, 9 slate maps, optional soil roughness, both coast maps and both paper maps); a new file there means updating that count. `images/` holds only `architecture/`, `materials/` and `paper/`, and the stylesheet requests no picture: its only URLs are the hashed fonts, the paper's hashed detail map and `data:` URIs (`test/bundle-output.test.mjs`). `.gitignore` ignores `*.png` except `og.png`, `apple-touch-icon.png`, `icon-192.png`, `icon-512.png` and `icon-maskable-512.png`, so a new PNG must be added there as an exception before Git sees it.

## How to

### Replace a model

1. Prepare the GLB to the loader's rules above, within its tier's limit, with the same role and tier name. Keep the supplied silhouettes, UVs and map resolutions ([Style](STYLE.md#materials-and-lighting)).
2. Keep each tier's complete scene within its budget.
3. When the tree changes, run `node tools/bake-root-shade.mjs` and paste the `ROOT_RESTS`, `ROOT_SHADE` and `ROOT_COVER` it prints over those constants in [terrain-build.js](../src/scene/terrain-build.js); `test/terrain-build.test.mjs` re-bakes both tree variants and fails on any difference. When the lantern changes, run `node tools/bake-lantern-outline.mjs` and paste the `OPENING_LANTERN` it prints over the one in [opening-lantern.js](../src/scene/opening-lantern.js); `test/opening-star.test.mjs` re-bakes both lantern variants and fails on any difference.
4. Recheck every shot it appears in ([Scene modes](SCENE-MODES.md#capture-recipe)); `test/framing.test.mjs` fits the directed shots to the delivered tree and lantern on both tiers.
5. Update the tables in this file and the model's entry in [Credits](CREDITS.md).

The build hashes the new bytes, so the file needs no other wiring. Replacing the tree also changes the UI bundle, which names its URL and size for the early request and the loading line.

### Add a model role

Name the role in [build.mjs](../build.mjs) `architectureAssetManifest` and in [architecture-assets.js](../src/scene/architecture-assets.js) `ROLES`, add both tier files, and give it a consumer (a channel in `createArchitectureAssetController`, a rock type in [rock-scatter.js](../src/scene/rock-scatter.js) `ROCK_TYPES`, or a massif in [hill-silhouette.js](../src/scene/hill-silhouette.js) `MASSIFS.roles`). Then update the role lists in `test/bundle-output.test.mjs`, `test/architecture-assets.test.mjs` and `test/build.test.mjs`, the image count in `test/hosting.test.mjs`, the budgets and this file.

### Replace the slate maps

Keep the nine required slate names and exact pixel sizes (1024 or 512; the detail map 512 on both tiers), seamless tiles, and the complete-scene budgets. stone-detail.js rejects any other size in that required set at runtime. The optional soil roughness tile follows its separate 512px loading and encoding contract above.

### Replace the coast detail map

Keep the 256×256 dimensions, lossless data encoding, RG OpenGL normal X/Y and B roughness layout, seamless repeat, 6.56-unit tile and 48 KiB response limit. Update its byte table, provenance and complete-scene totals. Its URL belongs only to the lazy coast owner; keep it out of the entry's slate manifest and the UI. Check failure, cancellation, cut-time application and cached reactivation with `test/coast-detail.test.mjs`.

### Replace the coast albedo

Keep the 512×512 sRGB tile, seamless repeat, 6.56-unit scale and 96 KiB response limit. `python tools/bake-coast-albedo.py --source PATH --output images/materials/coast-albedo-512.webp` requires the exact diffuse source documented in [Credits](CREDITS.md#coast-rock-detail) and local Pillow. Record the tool's measured encoded-image `linear_mean` in `COAST_ALBEDO.mean`, update the byte table and complete-scene totals, and keep the URL inside the lazy coastal chunk. Check colour/data independence, failed and stale images, cut-time binding, cached reactivation and shared shelf bindings with `test/coast-albedo.test.mjs`, `test/coast-bedrock.test.mjs` and `test/coast-material.test.mjs`.

### Replace an icon

Keep the names and sizes: `apple-touch-icon.png` 180×180 and `icon-maskable-512.png` 512×512 opaque (launchers crop them), `icon-192.png` and `icon-512.png` at their sizes, `favicon.ico` with 16 and 32 px images. `test/hosting.test.mjs` checks each, the manifest's icon list and the homepage's icon links; `test/markup-accessibility.test.mjs` holds the 404's icon links equal to the homepage's. Purge the changed URLs after the release.

### Change a font

The two variable fonts are the only ones the design allows ([Style](STYLE.md#palette-and-type)). To replace one, keep its file name or update every reference: the `@font-face` rule in [styles.css](../styles.css), the `<link rel="preload">`s in [index.html](../index.html) and [404.html](../404.html), the share card's own `@font-face` URLs in [tools/og-card.html](../tools/og-card.html), and `fonts/OFL.txt`'s copyright lines. `test/bundle-output.test.mjs` requires every `fonts/*.woff2` to be in the stylesheet and preloaded, each page's preloads to name exactly the stylesheet's fonts, and the two copyright lines; `test/markup-accessibility.test.mjs` holds the 404's preloads equal to the homepage's. `test/markup-accessibility.test.mjs` finds the two `@font-face` rules by file name (`cormorant-garamond-variable.woff2`, `instrument-sans-variable.woff2`) and expects weight ranges 300–700 and 400–700, so a renamed file changes that test too.

### Refresh the share card

1. Refresh `tools/og-card-backdrop.webp` only from an accepted live view: a fully loaded 1600×900 high-quality still with every page layer but the canvas hidden, cropped to the picture between the film's widescreen bars (1600×670). Today's is The broken coast at its native move midpoint (phase 0.5). Hold its actual authored camera pose and retain source/build, readiness and pixel-hash receipts. Edit `tools/og-card.html` when the card's text changes.
2. Render and quantize the card with the commands in `tools/og-card.html`'s header comment (headless Edge, then ImageMagick to a palette PNG).
3. Use the largest dither amount that keeps `public/og.png` under 300 KB (the header comment gives the steps). Then set the `?card=` of `index.html`'s `og:image` and `twitter:image` to the first eight hex digits of the new file's SHA-256, so link previews fetch it afresh, and run `node --test test/hosting.test.mjs`, which holds the file opaque, exactly 1200×630 and at most 300 KB, and both tags on its hash.
4. After the release, purge `/og.png` ([Operations](OPERATIONS.md#headers-and-caching)) and re-scrape it with LinkedIn Post Inspector.
