# Editable Blender snapshot

The website remains the source of its Three.js scene. The owner can capture its
current visible composition as an editable GLB for a local Blender session.
This export is an authoring aid; the browser remains the appearance reference.

## Capture

Run the local preview and open the desired shot with `sceneDebug=1` on
`localhost`, `127.0.0.1`, or IPv6 loopback. For the lantern handoff use
`?sceneDebug=1&view=tree&angle=2&tour=0&quality=high`. Check the selected view in
`BabelSite.sceneDebug` before capturing. Wait until the tower, tree, replacement
lantern, rocks, terrain textures and initial shader warm-up have settled.

The debug scene exposes the following action:

```js
const snapshot = await BabelSite.scene.exportBlenderSnapshot({
  filename: "alexnava-lantern-study",
  download: true,
});
```

The action checks runtime readiness and pauses the scene for its capture.
`download: true` downloads the GLB and an adjacent JSON report. Leave it false
for automation; the resolved result contains `arrayBuffer`, `blob`, `report`
and `reportBlob`. An automated local transfer may write the returned bytes and
JSON without a browser download. No files are uploaded by the export action.

`src/scene/blender-export.js` and Three's existing GLTFExporter are loaded only
when this action is called. They must remain dynamically imported and must not
import other first-party scene modules into the shared Three.js chunk.

## What transfers

- Visible hierarchy, geometry, UVs, normals, active draw ranges, material
  textures and PBR values are cloned independently of the running scene.
  Invisible comparison/fallback branches are excluded.
- Leaves, rocks and other instanced meshes become individual editable objects
  sharing one cloned geometry per source. Instance colors become materials.
- The active camera, including its world transform and lens parameters, and
  directional, point and spot lights transfer through standard glTF extensions.
  Directional and spot target directions are frozen into their export transforms.
  Camera projection matrices and each light's shadow allocation are retained in
  the JSON report and node extras for Blender restoration.
- Stars become a single mesh of textured, camera-facing quads. The active
  celestial positions and quality draw range are retained. Sprites become
  textured camera-facing planes. Solar prominence ribbon width becomes real
  geometry instead of depending on a vertex shader.
- Runtime objects, callbacks and cycles are removed from `userData`. Small
  descriptive values remain as glTF extras. Export disposal frees only the
  snapshot's resources; original geometry, materials and texture upload state
  are retained.

## Blender interpretation

glTF uses Y-up. Blender's glTF importer converts this to Blender's Z-up; do not
rotate the scene a second time. Textures are embedded in the GLB. After import,
pack Blender's images and save a `.blend` alongside the GLB and JSON under the
workspace's `Assets/Architecture/lantern/` folder.

The JSON report records the capture time, shot/tier metadata, object inventory,
world transforms, mesh/triangle/resource counts, active camera, original lights,
background/fog values and every approximation. The custom `babelLight` extras
also retain unsupported lights in the imported hierarchy.

The directed camera uses an off-axis projection to leave space for the page
identity. Standard glTF lens parameters omit this shift. Restore it from the
16-value, column-major `report.camera.projectionMatrix` or the camera node's
`babelCameraProjection.matrix` extras. For a Blender camera using `VERTICAL`
sensor fit and the recorded render aspect, set `shift_x = matrix[8] * aspect / 2`
and `shift_y = matrix[9] / 2`. Retain the imported lens and world transform.
Enable Blender light shadows only when the corresponding `babelLight.castShadow`
(also in `report.lights`) is true; fill and lantern lights must keep their
original shadow allocation.

Sky shaders become an unlit shell with an altitude color gradient. The mountain
ranges retain their geometry and are placed at the captured camera position,
matching the original camera-following vertex shader; baked vertex colors
approximate their moonlit shade, snow and haze. Clouds, nebula noise, stellar
dust, solar shading, twinkle, bloom and animation are approximated.

Ground and model `onBeforeCompile` effects retain base maps and PBR values.
Terrain's two-scale tile blending, puddles, contact darkening, wet sheen and
shader color grades are not baked. Hemisphere and ambient lights become named
metadata markers; recreate their fill through Blender world lighting using the
report. Fog, browser color management, light units, tone mapping, postprocessing
and the tour's transitions do not transfer as equivalent Blender renderer
settings. A Blender render will therefore differ from the authoritative local
website preview.

## Checks

`node --test test/blender-export.test.mjs` verifies the origin gate, actual shader
families, hierarchy and instance transforms, current point ranges, sprite
orientation, light direction, camera capture, circular metadata safety, resource
ownership and a real binary GLB round trip through the exporter. The complete
project verification and browser/Blender visual checks are required for a final
scene handoff.
