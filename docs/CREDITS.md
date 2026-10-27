# Credits

## Rights

- **Code**: `build.mjs`, `src/`, `tools/`, the tests, the GitHub workflows and
  scripts, and the HTML and CSS markup are released under the MIT License
  ([LICENSE](../LICENSE)). That includes the procedural scene: sky, clouds,
  terrain, materials, camera and animation.
- **Artwork and content**: the 3D models and textures as prepared for this site
  (made on a paid Meshy plan, so owned by Alex Nava), the images, the icons, the
  share card (`public/og.png` and `tools/og-card-backdrop.webp`), the writing
  and the visual design are © 2026 Alex Nava, all rights reserved, except the
  third-party assets credited below, which retain their stated licenses. The MIT
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

## The watch's stored outline

The watch frames a stored outline (`src/scene/opening-outline.js`): measurements
of the timber fire-lookout watchtower that stood on the terrace until the owner
left it out on 2026-10-20, from the Meshy model
`Meshy_AI_watchtower_0923082652_texture.glb`, supplied by Alex Nava on
2026-09-23 (29,926,940 bytes, SHA-256
`5898eab40106aa3c7553b971d0d3caecf4664a65a1fc04358b5ef9e303dc1fc2`). Only those
measurements ship, a convex hull of points per variant; the model is no longer
published. Its source, scripts, reports, QA renders and last delivered GLBs are
in `Assets/Architecture/tower-v2`.

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

The lantern's stored outline (`src/scene/opening-lantern.js`) is measured from
the supplied lantern's geometry, the same on both tiers: its convex hull and
its luminous centre, which place a Lantern study opening's loading light.
`tools/bake-lantern-outline.mjs` derives it from the delivered GLBs.

The delivered tree also contains a local geometry repair on both tiers: added
volume at a small tree fork. `tools/repair-landmark-geometry.py` reproduces these from the
SHA-pinned original GLBs with local NumPy. Topology, UVs, embedded artwork,
file sizes, AABBs, roots and ground contacts remain exact; positions and their
affected surface frames change only within the bounded neighborhoods. No new
model generation or broad remeshing is involved.

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

## Real mountains (elevation data)

The film's mountains in `images/architecture/{mountain-ridge,mountain-spine,mountain-summit}-{high,balanced}.glb`
are three real Alpine massifs, the owner's choice of 2026-10-19 ("real terrain")
to replace the supplied Meshy models: the Grandes Jorasses' north face (the
ridge), the Dents du Midi from the north (the spine) and the Weisshorn's east
face (the summit). Their heights come from Terrain Tiles on the AWS Open Data
Registry (Mapzen/Tilezen, terrarium encoding, zoom 13), which composite open
elevation models. Here those are **EU-DEM**, produced using Copernicus data and
information funded by the European Union (EU-DEM layers), and **SRTM**, data
available from the U.S. Geological Survey. The full attribution list is
https://github.com/tilezen/joerd/blob/master/docs/attribution.md.

Each window was resampled in the eye's frame and set on its plain, given ribs
and couloirs down its fall line below the data's resolution, and given relative
rock tones and snow by slope, altitude and curvature. Each was scaled
vertically to its role's height for its width (between 0.91 and 1.3; recorded
in the GLB's `extras.mountain.terrain`). Then, as before, each was culled in
Blender to the faces an eye in its viewing envelope can see, collapse-decimated
to about 3,800 triangles with its skyline weighted, and unwrapped. Its
object-space normal, albedo, ambient occlusion and snow were baked by Cycles.
High uses 512px albedo and object normals with a 256px lossless AO/snow mask;
balanced uses 256px albedo and normals with a 128px mask. The 22 source tiles,
the scripts, reports and QA renders are in the private
`Assets/Architecture/mountains-v2` and are not published.

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

## Coast rock detail

`images/materials/coast-albedo-512.webp` and
`images/materials/coast-detail-256.webp` derive from
[“Seaside Rock”](https://polyhaven.com/a/seaside_rock) by Dimitrios Savva on
Poly Haven, released under [CC0](https://polyhaven.com/license). The colour
tile uses the diffuse scan; the data tile uses the OpenGL normal and roughness
maps. The normal's green channel is not inverted.

`tools/bake-coast-albedo.py` requires the unmodified 1024×1024 diffuse PNG
(MD5 `36cc332a0797aa8164a909737d763203`), checks it before processing,
downsamples to 512×512 and writes sRGB WebP at quality 88. It reports the
encoded image's measured linear RGB mean, which normalizes reflectance in the
coastal shaders. Pillow is an authoring requirement, not a runtime dependency.

The packed-data preparation downsamples to 256×256, normalizes the normal,
packs X/Y into red/green and roughness into blue, quantizes the channels
independently to 5/5/4 bits and encodes lossless WebP. Both tiles use the
source's 2 m scale as 6.56 estate units. Original maps, official API metadata,
the packed-data script and provenance are in
`Assets/Materials/coast-detail-v1` in the private archive; those sources are
not published. Credit is not required under CC0; it is given here.

## The opening's paper

`images/paper/paper-detail.webp` and `images/paper/paper-height.webp` derive from
["Paper 006"](https://ambientcg.com/view?id=Paper006) on ambientCG, released under
[CC0](https://docs.ambientcg.com/license/). The detail tile is the colour scan's
luminance against its own local mean; the height tile is its displacement map at half
contrast; both greyscale, 768 px and tiling. They give the washi its fine tooth;
`src/doors/paper-doors.js` draws its fibres and flecks of bark itself. The source set, its checksum and the
script that makes both (`make-paper.ps1`) are in `Assets/Materials/paper-v1`; they are
not published. Credit is not required under CC0; it is given here.

## Icons

The icons in `public/` draw the initials AN in Cormorant Garamond 700 (SIL Open
Font License 1.1, [above](#typography)) in the name's colour on the night. Their
outlines were traced from Chrome's rendering of the font at 1000 px (marching
squares, simplified to within 0.2 px), so the icons embed no font, and Chrome
rendered the PNG and ICO images from the same drawings. The scripts,
`trace-initials.cjs` and `make-icons.cjs`, are in
`Assets/Review captures/loader-20261016/tools`; none are published.

## Baseline hill ring elevation data

The baseline hill ring (`HILL_PROFILE` in `src/scene/hill-silhouette.js`) is
built from a 48-sample circular elevation traverse (1.6 km radius, centered on
the South Downs near Devil's Dyke, West Sussex, England), retrieved 2026-09-09
via the public [Open-Elevation API](https://api.open-elevation.com), which
serves SRTM-derived public-domain elevation data. The samples are baked into
source; there is no runtime fetch.

The ring belongs only to the baseline, the scene as it stands before the film
(both terms are in the [Glossary](GLOSSARY.md)). The film, which starts when
the watch commits, takes the ring's place at once: it shows an empty stand-in
until its own ranges (the lazy `src/scene/mountain-build.js` chunk, with the
massifs) are built, and keeps the stand-in if that chunk fails. The scene is revealed
only after the watch commits, so visitors never see the ring.

## Close soil roughness

The optional `slate-soil-roughness-512.webp` derives from the existing CC0 Poly Haven [Dirt](https://polyhaven.com/a/dirt) roughness source by Charlotte Baglioni. Its original 1024px 16-bit PNG has SHA-256 `29f68a8972f1e69cf47e67924efe469350f953a5f707f63633a9c36cd7c63f6a`. `tools/bake-soil-roughness.py` checks that source, divides by 65535 before float Lanczos filtering, and encodes 512px grayscale WebP at quality 78/method 6. The delivered 3,042-byte tile has SHA-256 `1bfd73de6b856c482275fa572e7b3f360e46c06d1fbd2532481577fe8370ae3d`. The source remains in the private `Assets/Materials/PolyHaven-Dirt` archive. Pillow is used only for authoring; the site downloads only the final WebP.
