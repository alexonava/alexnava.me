# Credits

## Rights

- **Code**: `build.mjs`, `src/`, `tools/`, the tests, the GitHub workflows and
  scripts, and the HTML and CSS markup are released under the MIT License
  ([LICENSE](../LICENSE)). That includes the procedural scene: sky, clouds,
  terrain, materials, camera and animation.
- **Artwork and content**: the 3D models and textures as prepared for this site
  (made on a paid Meshy plan, so owned by Alex Nava), the images, the icons, the
  share card (`public/og.png` and `tools/og-card-backdrop.webp`), the writing
  and the visual design are © 2026 Alex Nava, all rights reserved. The MIT
  License does not cover them.
- **Fonts**: Cormorant Garamond and Instrument Sans are licensed under the SIL
  Open Font License 1.1 ([fonts/OFL.txt](../fonts/OFL.txt)).
- **Three.js**: MIT License.

## Third-party libraries

- **Three.js** (r160) — MIT License. Copyright 2010-2023 Three.js Authors.
  Bundled into the content-hashed `dist/scripts/scene.*.js` chunks; the Three.js
  core is in `scene.shared.HASH.js`, which keeps its license notice at the end.
  Source: https://github.com/mrdoob/three.js

## Typography

- **Cormorant Garamond** by The Cormorant Project Authors (designer Christian
  Thalmann) — SIL Open Font License 1.1.
- **Instrument Sans** by The Instrument Sans Project Authors — SIL Open Font
  License 1.1.

Both are self-hosted as variable woff2 subsets in `fonts/`. Their copyright
notices and the license text are in `fonts/OFL.txt`, which the site publishes
beside them at `/fonts/OFL.txt`.

## Source archive

Paths below that start with `Assets/` are in Alex Nava's private artwork
archive, which holds the supplied originals and their preparation scripts,
reports and QA renders. The archive is not part of this repository, and nothing
in it is published. Sizes, formats and budgets of the delivered files are in
[Assets](ASSETS.md).

## Supplied timber lookout tower

The tower in `images/architecture/tower-{high,balanced}.glb` is a timber
fire-lookout watchtower from the Meshy model
`Meshy_AI_watchtower_0923082652_texture.glb`, supplied by Alex Nava on
2026-09-23 (29,926,940 bytes, SHA-256
`5898eab40106aa3c7553b971d0d3caecf4664a65a1fc04358b5ef9e303dc1fc2`).

It was processed locally without recoloring or new generation: scaled to unit
height, decimated in Blender 4.5 to 23,714 (high) and 9,718 (balanced)
triangles on the supplied UVs, and its color and normal maps re-baked by Cycles
from the full-resolution source. The maps ship as embedded WebP (2048 high,
1024 balanced) with stored tangents and `KHR_mesh_quantization` geometry. Source,
scripts, reports and QA renders are in `Assets/Architecture/tower-v2`; none are
published.

## Supplied tree and lantern

The tree and lantern in `images/architecture/{tree,lantern}-{high,balanced}.glb`
are Meshy models supplied by Alex Nava, optimized locally without new
generation. Original files and preparation records are in
`Assets/Architecture/tree-v2` and `Assets/Architecture/lantern`, and the
lantern's packaging in `Assets/Architecture/lantern/v2`. Each GLB records its
own preparation: the tree's `asset.generator` names a Blender reduction and
the tree-v2 packaging; the lantern's `scenes[0].extras.packaging` names the
Node script `package-lantern-v2.mjs`, which kept the first version's positions
byte for byte and quantized its normals and texture coordinates. It encoded the
colour and metal-roughness maps, and the balanced tier's normal map, as WebP
from the supplied source; the emission map as lossless WebP of the first
version's PNG pixels; and kept the first version's JPEG as the high tier's
normal map.

The tree ships at 39,827 (high) and 26,025 (balanced) triangles, with
`KHR_mesh_quantization` geometry and embedded WebP colour, metal-roughness and
normal maps. The lantern ships at 3,000 triangles on both tiers, with float
positions, quantized normals and texture coordinates, and embedded colour,
metal-roughness, normal and emission maps: WebP at 1024 on balanced; on high,
WebP at 2048 except the normal map, an embedded 2048 JPEG.

The stand-in lantern, the iron post lantern the scene shows until the
supplied lantern commits and keeps if it fails, is built in code
(`src/scene/architecture.js`) and is part of neither model.

## Supplied Meshy rocks

The film's scattered stones in `images/architecture/{lichen-rock,weathered-stone}-{high,balanced}.glb`
come from two Meshy models supplied by Alex Nava on 2026-09-23:
`Meshy_AI_Lichen_Rock_0923090020_texture.glb` (SHA-256
`1c3cf68198b3397c910eb8f51c1c162392d5491ba33de58610ace25d5868cbd0`) and
`Meshy_AI_Weathered_Stone_0923090028_texture.glb` (SHA-256
`c279db21dbd95ba2f4abf08cab1b471627498bf094a6d823df06afdbd4cdf4a2`).

Each was scaled to unit height, decimated in Blender to 2,990 (high) and 1,194
(balanced) triangles with new UVs, and its color, normal and ambient occlusion
re-baked by Cycles. Each GLB carries embedded WebP colour and normal maps (1024
high, 512 balanced), stored tangents and `KHR_mesh_quantization` geometry; none
has a separate occlusion map. Scripts, reports and QA renders are in
`Assets/Architecture/rocks-v1`; none are published.

## Supplied Meshy mountains

The film's mountains in `images/architecture/{mountain-ridge,mountain-spine,mountain-summit}-{high,balanced}.glb`
come from three Meshy models supplied by Alex Nava on 2026-10-03:
`Meshy_AI_Snow_Mountain_Ridge_0925082630_texture.glb` (SHA-256
`c4b99498a91cb8977ecd7ed0780a0a1c16aeffe94eb9747802f6f184c46948a5`, the
ridge), `Meshy_AI_Snow_Mountain_Ridge_0925082622_texture.glb` (SHA-256
`e5cca117aca1abe7ae01df606407ddd9800b266982e40e00922702ffc08402b4`, the
spine) and `Meshy_AI_Snow_Mountain_Summit_0925031332_texture.glb` (SHA-256
`a3773a9fc831ebc0f2129bffb17fe7094e559943bb36aca630f132fb49319dc8`, the
summit).

Each was normalized, culled in Blender to the faces an eye in its viewing
envelope can see, collapse-decimated to 3,799 triangles with its skyline
weighted, unwrapped, and its object-space normal, base colour and ambient
occlusion baked by Cycles from the full source; the supplied emissive and
metallic-roughness maps were dropped. Each GLB carries an object-space normal
map and a whiteness and occlusion mask as WebP (512 and 256 high, 256 and 128
balanced) and `KHR_mesh_quantization` geometry. Scripts, reports and QA
renders are in `Assets/Architecture/mountains-v1`; none are published.

## Slate ground

The ground maps `images/materials/slate-{color,normal}-{1024,512}.webp` and
`slate-detail-512.webp` were baked locally from the Meshy "Cracked Desert
Ground" model supplied by Alex Nava: Blender Cycles baked its height, normal and
colour top-down, the tile was made seamless, and the colour remapped to the
site's night palette. Scripts, reports and QA renders are in
`Assets/Materials/slate-v2`; none are published. No new Meshy generation was
commissioned.

Tool: [Meshy](https://www.meshy.ai/).

The close soil maps `images/materials/slate-{grit,relief}-{1024,512}.webp` are
derived from ["Dirt"](https://polyhaven.com/a/dirt) by Charlotte Baglioni on
Poly Haven, released under [CC0](https://polyhaven.com/license): the grit map is
its colour's luminance against its own local mean, the relief map is a height
integrated from its normal map, both greyscale and tiling
(`Assets/Materials/dirt-close-v1/scripts/make-dirt-close.py`; the source and its
provenance are in `Assets/Materials/PolyHaven-Dirt`). Credit is not required
under CC0; it is given here.

## Baseline hill ring elevation data

The baseline hill ring (`HILL_PROFILE` in `src/scene/hill-silhouette.js`) is
built from a 48-sample circular elevation traverse (1.6 km radius, centered on
the South Downs near Devil's Dyke, West Sussex, England), retrieved 2026-09-09
via the public [Open-Elevation API](https://api.open-elevation.com), which
serves SRTM-derived public-domain elevation data. The samples are baked into
source; there is no runtime fetch.

The ring belongs only to the baseline, the scene as it stands before the film
(both terms are in the [Glossary](GLOSSARY.md)). The film, which starts when
the tower commits, takes the ring's place at once: it shows an empty stand-in
until its own ranges (the lazy `src/scene/mountain-build.js` chunk, with the
Meshy mountains) are built, and keeps the stand-in if that chunk fails. The scene is revealed
only after the tower loads, so visitors never see the ring.

## Cotton paper panel material

The paper textures, `images/paper-grain.webp` and `images/paper-edge.webp`,
were generated with OpenAI's built-in image generation tool and prepared as
local WebP assets. They are decorative; all panel wording remains selectable
HTML. The repository records no source for the three paper vignettes
(`images/paper-vignette-*.webp`) or the two estate maps
(`images/estate-map-*.webp`).
