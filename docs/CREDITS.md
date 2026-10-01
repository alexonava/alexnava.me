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
generation. Original files and preparation records are in the local artwork
archive (`Assets/Architecture/tree-v2` and `Assets/Architecture/lantern`; the lantern's
WebP and quantized packaging is in `Assets/Architecture/lantern/v2`).

## Supplied Meshy rocks

The film's scattered stones in `images/architecture/{lichen-rock,weathered-stone}-{high,balanced}.glb`
come from two Meshy models supplied by Alex Nava on 2026-09-23:
`Meshy_AI_Lichen_Rock_0923090020_texture.glb` (SHA-256
`1c3cf68198b3397c910eb8f51c1c162392d5491ba33de58610ace25d5868cbd0`) and
`Meshy_AI_Weathered_Stone_0923090028_texture.glb` (SHA-256
`c279db21dbd95ba2f4abf08cab1b471627498bf094a6d823df06afdbd4cdf4a2`).

Each was scaled to unit height, decimated in Blender to 2,990 (high) and 1,194
(balanced) triangles with new UVs, and its color, normal and ambient occlusion
re-baked by Cycles. Scripts, reports and QA renders are in
`Assets/Architecture/rocks-v1`; none are published.

## Slate ground

The ground maps `images/materials/slate-{color,normal}-{1024,512}.webp` and
`slate-detail-512.webp` were baked locally from the Meshy "Cracked Desert
Ground" model supplied by Alex Nava: Blender Cycles baked its height, normal and
colour top-down, the tile was made seamless, and the colour remapped to the
site's night palette. Scripts, reports and QA renders are in
`Assets/Materials/slate-v2`; none are published. No new Meshy generation was
commissioned.

Tool: [Meshy](https://www.meshy.ai/).

## Background hill silhouette elevation data

The distant hill silhouette (`src/scene/hill-silhouette.js`) is built from a
48-sample circular elevation traverse (1.6 km radius, centered on the South
Downs near Devil's Dyke, West Sussex, England), retrieved 2026-09-09 via the
public [Open-Elevation API](https://api.open-elevation.com), which serves
SRTM-derived public-domain elevation data. The samples are baked into source;
there is no runtime fetch.

## Cotton paper panel material

The paper textures were generated with OpenAI's built-in image
generation tool and prepared as local WebP assets. They are decorative; all
panel wording remains selectable HTML.
