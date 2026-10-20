import test from "node:test";
import assert from "node:assert/strict";
import {
  BoxGeometry,
  Color,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  RepeatWrapping,
  Scene,
  ShaderLib,
  SRGBColorSpace,
  Texture,
  Vector2,
  Vector3,
} from "three";
import {
  CLIFF,
  COAST,
  COAST_SHADOW,
  COAST_SHOTS,
  FALLS,
  SEA,
  SEA_SHARED,
  SHORE,
  STACKS,
  cliffGeometry,
  coastDistance,
  coastShot,
  coastGlsl,
  coastLand,
  coastPlane,
  createCliff,
  createFalls,
  createSea,
  fallsGeometry,
  faultAlong,
  landFactor,
  riverFalls,
  slateShoreEdits,
  stackGeometry,
  stacksMirrorGlsl,
  stacksSurfGlsl,
  stackWaterlineProfile,
} from "../src/scene/ocean.js";
import { DEPTH_LAYER } from "../src/scene/depth-layers.js";
import { DIRECTED_SHOTS, shotPose } from "../src/scene/directed-shots.js";
import { TOUR_ORDER } from "../src/scene/camera-tour.js";
import { MIST_PARS, MIST_UNIFORMS, mistOn } from "../src/scene/drifting-mist.js";
import { FLASH_GROUND } from "../src/scene/film-light.js";
import { createFilmScene } from "../src/scene/film-scene.js";
import { HIGH_VIEW, HORIZON_AIR, RANGE_MIST, SEA_SINK } from "../src/scene/hill-silhouette.js";
import {
  configureGroundShading,
  createSlateContacts,
  MOON_LIGHTS,
  SLATE_TEXT_GUARD,
  SLATE_TILING,
} from "../src/scene/mud-ground.js";
import {
  createEarthGeometry,
  dripClock,
  filmHeight,
  foothillHeight,
  FINE_WINDOW,
  LANTERN_FOOT,
  RIVER_LINE,
  settleRoots,
  shadeSlateGround,
  TERRAIN_BASE,
  TREE_FOOTING,
} from "../src/scene/terrain-build.js";
import { compilePrograms } from "../src/scene/shader-programs.js";
import { createRockScatter, ROCK_LIB } from "../src/scene/rock-scatter.js";
import { createRocks, createRockLayout } from "../src/scene/rock-build.js";
import { flat, source } from "./support/code.mjs";

// What film-scene.js lends the sea (terrain-build.js settleRoots()'s `lib`).
const lib = {
  SLATE_TEXT_GUARD,
  MIST_PARS,
  MIST_UNIFORMS,
  FLASH_GROUND,
  RANGE_MIST,
  SEA_SINK,
  HIGH_VIEW,
};
const rendering = () => ({ homeScene: new Scene(), lights: {}, tier: "high" });

// seaCoast() read back as JavaScript, so the GLSL and coastDistance() are held equal.
function glslCoast() {
  const body = coastGlsl()
    .replace(/^float seaCoast\(vec2 p\)\{/, "")
    .replace(/\}$/, "")
    .replace(/float /g, "let ")
    .replace(/dot\(p,vec2\(([^,]+),([^)]+)\)\)/g, "(p[0]*($1)+p[1]*($2))")
    .replace(/\b(sin|cos|abs|sqrt)\(/g, "Math.$1(")
    .replace(/inversesqrt\(/g, "1/Math.sqrt(")
    .replace(/(\d)\.(?!\d)/g, "$1.0");
  return new Function("p", body);
}

test("the fault's distance is one table, in JavaScript and GLSL, about a unit a unit near the line and seamless", () => {
  const seaCoast = glslCoast();
  for (let x = -190; x <= 190; x += 7.3)
    for (let z = -190; z <= 190; z += 6.1) {
      const d = coastDistance(x, z);
      // (The GLSL keeps six decimals of each coefficient: exact enough near the line, where it is read.)
      assert.ok(
        Math.abs(seaCoast([x, z]) - d) < (Math.abs(d) < 15 ? 0.01 : 0.005 * Math.abs(d)),
        `${x},${z}`,
      );
    }
  // The fault's mean line, for the ranges that sink past it.
  const [nx, nz, offset] = coastPlane();
  assert.ok(Math.abs(nx - Math.cos((COAST.bearing * Math.PI) / 180)) < 1e-12);
  assert.ok(Math.abs(nz - Math.sin((COAST.bearing * Math.PI) / 180)) < 1e-12);
  assert.equal(offset, COAST.offset);
  // Near the line it measures distance (the drop, the walk's edge and the sea's own edge read it
  // there); and nowhere near it does it jump, not even through a fracture's cusp.
  const slope = (x, z, e = 0.005) =>
    Math.hypot(
      coastDistance(x + e, z) - coastDistance(x - e, z),
      coastDistance(x, z + e) - coastDistance(x, z - e),
    ) /
    (2 * e);
  let near = 0;
  for (let x = -190; x <= 190; x += 0.53)
    for (let z = -190; z <= 190; z += 0.53) {
      const d = Math.abs(coastDistance(x, z));
      if (d > 9) continue;
      const g = slope(x, z);
      assert.ok(g < 4, `a jump at ${x},${z}`);
      if (d < 1) {
        assert.ok(g > 0.75 && g < 1.3, `${g} at ${x},${z}`);
        near++;
      }
    }
  assert.ok(near > 1000, `${near} samples on the line`);
});

test("the land falls to the seabed past the fault, well clear of the estate, its foothills fading first", () => {
  const base = (x, z) => 0.3 * Math.sin(x * 0.05) + 0.2 * Math.cos(z * 0.07);
  const film = filmHeight(base),
    land = filmHeight(base, true);
  for (let x = -190; x <= 190; x += 3.7)
    for (let z = -190; z <= 190; z += 4.3) {
      const d = coastDistance(x, z);
      if (d < SHORE.drop) assert.equal(film(x, z), SHORE.deep, `${x},${z}`);
      else assert.equal(film(x, z), land(x, z), `${x},${z}`);
      assert.ok(land(x, z) > SHORE.deep + 20);
      assert.equal(coastLand(d, 1), d >= SHORE.drop ? 1 : SHORE.deep);
      // The foothills fade out over SHORE.hills inland of the shelf.
      if (d < SHORE.shelf) assert.ok(land(x, z) - TERRAIN_BASE < 1e-9 || Math.hypot(x, z) < 113);
    }
  assert.equal(landFactor(SHORE.shelf), 0);
  assert.equal(landFactor(SHORE.shelf + SHORE.hills), 1);
  // The seabed lies well under the sea; the shelf covers the drop and a coarse cell's diagonal.
  assert.ok(SHORE.deep < SEA.level - 6);
  assert.ok(SHORE.shelf >= SHORE.drop + 3 * Math.SQRT2);
  // Nothing of the estate stands near it: the lookout, the tree's root window, the lantern.
  assert.ok(coastDistance(0, 0) > 100);
  for (const x of [FINE_WINDOW.x[0], FINE_WINDOW.x[1]])
    for (const z of [FINE_WINDOW.z[0], FINE_WINDOW.z[1]])
      assert.ok(coastDistance(TREE_FOOTING.x + x, TREE_FOOTING.z + z) > SHORE.shelf + 3);
  assert.ok(coastDistance(LANTERN_FOOT.x, LANTERN_FOOT.z) > SHORE.shelf + 10);
  // The foothills, where they stand, stand on the land.
  for (let a = 0; a < 360; a += 3)
    for (const r of [120, 139, 156]) {
      const x = r * Math.cos((a * Math.PI) / 180),
        z = r * Math.sin((a * Math.PI) / 180);
      if (coastDistance(x, z) < SHORE.shelf) assert.equal(land(x, z), TERRAIN_BASE, `${x},${z}`);
      assert.ok(foothillHeight(x, z) >= 0);
    }
});

test("the sea is one program: the film's environment its only texture, the ground's depth stamp, and the entry's guard, mist and lightning", () => {
  const clock = dripClock({ value: 0 }),
    sea = createSea({ lib, clock, rendering: rendering() }),
    { mesh, material } = sea,
    fragment = material.fragmentShader;
  assert.ok(material.isShaderMaterial);
  assert.ok(!material.lights, "it reads the scene's lights itself, as uniforms");
  assert.equal(material.uniforms.seaTime, clock.uniform, "on the sea's own clock");
  // Shared, not copied: the lightning, the shot's mist, and the text boxes.
  assert.equal(material.uniforms.babelFlash, FLASH_GROUND.babelFlash);
  assert.equal(material.uniforms.uMist, RANGE_MIST);
  assert.equal(material.uniforms.slateText, MIST_UNIFORMS.mistText);
  assert.equal(material.uniforms.slateAbout, MIST_UNIFORMS.mistAbout);
  assert.ok(fragment.includes(SLATE_TEXT_GUARD));
  assert.ok(fragment.includes("slateBehindText()") && fragment.includes("slateTextKnee("));
  assert.equal(fragment.includes("mistOver("), mistOn);
  if (mistOn) assert.ok(fragment.includes(MIST_PARS));
  // The ground's depth layer, as the entry's (depth-layers.js).
  assert.equal(SEA_SHARED.layer, DEPTH_LAYER.ground);
  assert.ok(fragment.includes(`gl_FragColor=vec4(c,${DEPTH_LAYER.ground});`));
  assert.ok(
    Math.abs(SEA_SHARED.edgeLift - (HORIZON_AIR.edge / HORIZON_AIR.ground - 1)) < 5e-5,
    "the walk's far edge lifts to the far plain's air",
  );
  // No texture but the environment's (through three's CubeUV chunks) and the moon's
  // shadow map, which it reads itself (it casts none, and takes none from three).
  assert.deepEqual(fragment.match(/uniform sampler\w+ \w+/g), ["uniform sampler2D seaShadowMap"]);
  assert.ok(fragment.includes("#include <cube_uv_reflection_fragment>"));
  assert.equal(mesh.castShadow, false);
  assert.equal(mesh.receiveShadow, false);
  // Near the rock the cliffs' and the stacks' shadows lie on it.
  assert.ok(fragment.includes("if(z<70.)seaSun=seaShadow(P,vec3(0.,1.,0.));"));
  assert.equal(mesh.frustumCulled, false, "it rides on the lens");
  assert.equal(mesh.renderOrder, 0.5);
  // Its light stays under the bloom's threshold (0.85 luma): the mirror's and the glitter's knees.
  assert.ok(SEA.knee + SEA.glitter.knee < 0.85);
  // White water reflects at most foam's own share of the light it takes.
  assert.ok(SEA.surf.albedo <= 0.8 && FALLS.albedo <= 0.8);
  // The white water about the stacks and where the falls land.
  assert.ok(fragment.includes(stacksSurfGlsl()));
  assert.equal(material.uniforms.seaFalls.value.w, 0);
  const plunge = createSea({ lib, clock, rendering: rendering(), plunge: [80, 82, 8] });
  assert.deepEqual({ ...plunge.material.uniforms.seaFalls.value }, { x: 80, y: 82, z: 8, w: 1 });
  plunge.dispose();
  sea.dispose();
});

test("the sea reads raw light intensities and applies its subdued custom 1/pi normalization", () => {
  const view = rendering(),
    { mesh, material } = createSea({ lib, clock: dripClock({ value: 0 }), rendering: view });
  const light = (color, intensity, position) => {
    const l = new Group();
    l.color = new Color(color);
    l.intensity = intensity;
    l.position.copy(position);
    l.target = new Group();
    l.updateMatrixWorld();
    l.target.updateMatrixWorld();
    return l;
  };
  view.lights = {
    sun: light(0xffffff, 2, new Vector3(0, 10, 0)),
    fill: light(0x8080ff, 0.5, new Vector3(10, 0, 0)),
    ambient: { color: new Color(0x404040), intensity: 0.25 },
    hemisphere: { color: new Color(0xffffff), groundColor: new Color(0x000000), intensity: 0.6 },
  };
  view.homeScene.environment = { isTexture: true };
  mesh.onBeforeRender();
  const u = material.uniforms;
  assert.deepEqual(u.seaKey.value.toArray(), [0, 1, 0]);
  assert.deepEqual(u.seaKeyColor.value.toArray(), [2, 2, 2]);
  assert.deepEqual(u.seaFill.value.toArray(), [1, 0, 0]);
  assert.ok(Math.abs(u.seaFillColor.value.z - 0.5) < 1e-9);
  assert.ok(Math.abs(u.seaAmbient.value.x - new Color(0x404040).r * 0.25) < 1e-9);
  assert.deepEqual(u.seaHemiSky.value.toArray(), [0.6, 0.6, 0.6]);
  assert.deepEqual(u.seaHemiGround.value.toArray(), [0, 0, 0]);
  assert.equal(material.envMap, view.homeScene.environment);
  assert.equal(u.envMap.value, view.homeScene.environment);
  // The balanced tier draws no lace in the foam, and only the coarser fine ripples.
  assert.equal(u.seaFine.value, 1);
  view.tier = "balanced";
  mesh.onBeforeRender();
  assert.equal(u.seaLace.value, 0);
  assert.equal(u.seaFine.value, 0);
  material.dispose();
});

test("the cliffs cover the terrain's drop with their shelf, fall below the sea, and carry the stacks", () => {
  const height = () => 1.25,
    geometry = cliffGeometry(height),
    p = geometry.attributes.position,
    a = geometry.attributes.aCliff;
  assert.equal(a.itemSize, 3);
  let inner = Infinity,
    foot = Infinity;
  for (let i = 0; i < p.count; i++) {
    const [x, y, z] = [p.getX(i), p.getY(i), p.getZ(i)],
      [v, off] = [a.getY(i), a.getZ(i)];
    assert.ok(Number.isFinite(x + y + z));
    if (v === 0) inner = Math.min(inner, off);
    foot = Math.min(foot, y);
    // The shelf lies just over the plain; nothing stands far above it, the ribs
    // and the rubble included.
    assert.ok(y < 1.25 + CLIFF.lip[1] + 0.2, `${y} at ${x},${z}`);
  }
  assert.ok(inner <= -SHORE.shelf, "the shelf reaches over the whole drop");
  assert.ok(foot <= SEA.level - 3, "the face goes on under the sea");
  geometry.dispose();
  // The stacks stand out at sea clear of the cliffs' surf, under the bloom's light.
  const stacks = stackGeometry(),
    q = stacks.attributes.position;
  assert.equal(stacks.attributes.aCliff.itemSize, 3);
  // Every stack carries the stacks' mark (2), so the cliffs' material darkens it with spray.
  for (let i = 0; i < stacks.attributes.aCliff.count; i += 97)
    assert.equal(stacks.attributes.aCliff.getY(i), 2);
  assert.ok(STACKS.wet > 0 && STACKS.wet < 1);
  for (const [s, out, height, half, stretch] of STACKS.list) {
    assert.ok(out - half * stretch > SEA.surf.reach + 6, `a stack at ${s} crowds the cliffs`);
    // A stack is a remnant of the plateau: its cap no higher than about the plain.
    if (stretch <= 2)
      assert.ok(height <= -SEA.level + 1.5, `a stack at ${s} stands over the plain`);
  }
  let top = -Infinity;
  for (let i = 0; i < q.count; i++) {
    top = Math.max(top, q.getY(i));
    assert.ok(coastDistance(q.getX(i), q.getZ(i)) < -SEA.surf.reach, "every stack is out at sea");
  }
  assert.ok(top < SEA.level + 25);
  assert.equal(q.count, STACKS.list.length * STACKS.sides * (STACKS.rings * 6 + 3));
  const normal = stacks.attributes.normal,
    va = new Vector3(),
    vb = new Vector3(),
    vc = new Vector3(),
    face = new Vector3(),
    shade = new Vector3(),
    joins = new Map();
  let smoothed = 0,
    sharp = false;
  for (let i = 0; i < q.count; i += 3) {
    va.fromBufferAttribute(q, i);
    vb.fromBufferAttribute(q, i + 1);
    vc.fromBufferAttribute(q, i + 2);
    face.subVectors(vb, va).cross(vc.sub(va)).normalize();
    for (let j = 0; j < 3; j++) {
      shade.fromBufferAttribute(normal, i + j);
      assert.ok(Math.abs(shade.length() - 1) < 1e-6, "finite unit normals");
      const dot = shade.dot(face),
        key = [q.getX(i + j), q.getY(i + j), q.getZ(i + j)].join(",");
      assert.ok(dot >= Math.cos(Math.PI / 6) - 1e-4, "shading stays within the 30-degree crease");
      if (dot < 1 - 1e-5) smoothed++;
      if (!joins.has(key)) joins.set(key, []);
      for (const other of joins.get(key)) if (shade.dot(other) < 0.5) sharp = true;
      joins.get(key).push(shade.clone());
    }
  }
  assert.ok(smoothed > q.count / 4, "shallow joins do not show every triangle");
  assert.ok(sharp, "the broken rim and real fractures keep sharp normals");
  // More rings refine the same geology instead of moving whole ledges to
  // different heights. Check matching sections on all five authored stacks.
  const dense = stackGeometry({ ...STACKS, rings: STACKS.rings * 2 }),
    section = (geometry, rings, k, r, j) => {
      const i =
          k * STACKS.sides * (rings * 6 + 3) +
          (Math.min(r, rings - 1) * STACKS.sides + j) * 6 +
          (r === rings ? 2 : 0),
        p = geometry.attributes.position;
      return [p.getX(i), p.getY(i), p.getZ(i)];
    };
  for (let k = 0; k < STACKS.list.length; k++)
    for (let r = 0; r <= STACKS.rings; r++)
      for (let j = 0; j < STACKS.sides; j++)
        assert.deepEqual(
          section(stacks, STACKS.rings, k, r, j),
          section(dense, STACKS.rings * 2, k, r * 2, j),
          "ledge positions follow height, not mesh density",
        );
  dense.dispose();
  stacks.dispose();
  // One material for both: the stacks ride on the cliff's mesh, and go with it.
  const cliff = createCliff({
      lib,
      clock: dripClock({ value: 0 }),
      rendering: rendering(),
      height,
    }),
    [child] = cliff.mesh.children;
  assert.equal(child.name, "estate-stacks");
  assert.equal(child.material, cliff.material);
  // The stacks: their own rock darker than the cliffs', a weedy band about their foot.
  assert.ok(cliff.material.fragmentShader.includes(`float stack=step(1.5,vC.y),hs=vW.y-vSeaY+`));
  assert.ok(
    cliff.material.fragmentShader.includes(
      `alb*=mix(1.,${STACKS.wet},stack)*mix(vec3(1.),mix(vec3(`,
    ),
  );
  assert.ok(STACKS.weed > 1 && STACKS.weedTone.every((v) => v > 0.3 && v < 1));
  // A moon sheen: broad on dry rock, tighter where it is wet, held back behind the text.
  assert.ok(
    cliff.material.fragmentShader.includes(
      "c+=seaGGX(n,E,mix(.6,.18,wet),.04)*mix(.2,1.,wet)*(1.-.8*b);",
    ),
  );
  assert.equal(cliff.material.uniforms.cliffRiver.value.w, 0, "no falls without a drop");
  let freed = 0;
  cliff.mesh.geometry.addEventListener("dispose", () => freed++);
  child.geometry.addEventListener("dispose", () => freed++);
  cliff.dispose();
  assert.equal(freed, 2);
});

test("the cliff shelf shares the ground material, UV phase and neutral root attributes without owning borrowed resources", () => {
  const maps = Array.from({ length: 10 }, () => new Texture()),
    [color, normal, nextColor, nextNormal, procedural, detail, grit, relief, nextGrit, nextRelief] =
      maps,
    freed = new Map(maps.map((map) => [map, 0])),
    ground = new MeshStandardMaterial({ color: 0x5c5048 }),
    view = rendering(),
    ambient = { color: new Color(0.2, 0.3, 0.4), intensity: 0.8 };
  let groundFreed = 0;
  ground.addEventListener("dispose", () => groundFreed++);
  for (const map of maps) map.addEventListener("dispose", () => freed.set(map, freed.get(map) + 1));
  color.wrapS = color.wrapT = normal.wrapS = normal.wrapT = RepeatWrapping;
  color.repeat.setScalar(384 / SLATE_TILING.tile);
  normal.repeat.copy(color.repeat);
  color.colorSpace = SRGBColorSpace;
  ground.map = color;
  ground.normalMap = normal;
  ground.normalScale.set(0.45, 0.45);
  ground.userData.slateRoot = shadeSlateGround;
  configureGroundShading(ground, true, { detail, grit, relief, contacts: createSlateContacts() });
  view.lights.ambient = ambient;
  const cliff = createCliff({
      lib,
      clock: dripClock({ value: 0 }),
      rendering: view,
      height: () => 1.25,
      groundMaterial: ground,
      drop: riverFalls(RIVER_LINE),
    }),
    geometry = cliff.mesh.geometry,
    { position, uv, aCliff, slateRoot, slateShade, slatePool, slateRiverSurface } =
      geometry.attributes,
    ownResources = [geometry, cliff.mesh.children[0].geometry, cliff.material],
    ownFreed = new Map(ownResources.map((resource) => [resource, 0])),
    version = cliff.material.version;
  for (const resource of ownResources)
    resource.addEventListener("dispose", () => ownFreed.set(resource, ownFreed.get(resource) + 1));
  let disposed = false;
  const sameMaterial = () => {
    assert.deepEqual(cliff.mesh.material, [ground, cliff.material]);
    assert.equal(
      cliff.mesh.material[0],
      ground,
      "the shelf takes the actual ground material, not a copy",
    );
    assert.equal(
      cliff.mesh.children[0].material,
      cliff.material,
      "the stacks keep the custom cliff lighting",
    );
    assert.notEqual(cliff.material, ground);
    assert.equal(cliff.material.version, version);
  };
  const compileShelf = () => {
    const shader = {
      uniforms: {},
      vertexShader: ShaderLib.physical.vertexShader,
      fragmentShader: ShaderLib.physical.fragmentShader,
    };
    cliff.mesh.material[0].onBeforeCompile(shader);
    return shader;
  };
  try {
    sameMaterial();
    assert.equal(slateRiverSurface.itemSize, 2);
    assert.equal(slateRiverSurface.count, position.count);
    assert.ok(
      slateRiverSurface.array.every((value) => value === 0),
      "the borrowed shelf keeps neutral river-cap attributes",
    );
    assert.equal(
      cliff.material.uniforms.cliffRiver.value.w,
      0,
      "the borrowed river is not painted again on the rock bevel",
    );
    const shelfCount = (geometry.userData.coastGeometry.columns - 1) * CLIFF.shelfRows * 6;
    assert.deepEqual(
      geometry.groups,
      [
        { start: 0, count: shelfCount, materialIndex: 0 },
        { start: shelfCount, count: geometry.index.count - shelfCount, materialIndex: 1 },
      ],
      "two contiguous draw groups cover the shelf and exposed rock exactly once",
    );
    for (let i = 0; i < geometry.index.count; i += 3) {
      const vertices = [0, 1, 2].map((j) => geometry.index.getX(i + j));
      if (i < shelfCount)
        assert.ok(
          vertices.every((v) => aCliff.getY(v) === 0),
          "the ground material stays on the shelf",
        );
      else
        assert.ok(
          vertices.some(
            (v) => aCliff.getY(v) > 0 || v >= geometry.userData.coastGeometry.baseVertices,
          ),
          "the lip, face and added broken rock retain their own material",
        );
    }
    assert.equal(uv.itemSize, 2);
    assert.equal(slateRoot.itemSize, 4);
    assert.equal(slateShade.itemSize, 3);
    assert.equal(slatePool.itemSize, 1);
    for (const attribute of [uv, slateRoot, slateShade, slatePool])
      assert.equal(attribute.count, position.count);
    for (let i = 0; i < position.count; i++) {
      assert.ok(Math.abs(uv.getX(i) - (position.getX(i) / 384 + 0.5)) < 1e-7);
      assert.ok(Math.abs(uv.getY(i) - (0.5 - position.getZ(i) / 384)) < 1e-7);
      assert.deepEqual(
        [slateRoot.getX(i), slateRoot.getY(i), slateRoot.getZ(i), slateRoot.getW(i)],
        [0, 0, 0, 1],
      );
      assert.deepEqual(
        [slateShade.getX(i), slateShade.getY(i), slateShade.getZ(i), slatePool.getX(i)],
        [0, 0, 0, 0],
      );
    }
    const initial = compileShelf();
    assert.equal(initial.uniforms.slateGrit.value, grit);
    assert.equal(initial.uniforms.slateRelief.value, relief);
    assert.ok(
      initial.vertexShader.includes("attribute vec4 slateRoot;"),
      "the shelf supports the ground's real root program",
    );
    ground.map = nextColor;
    ground.normalMap = nextNormal;
    ground.color = new Color(0x665248);
    ground.normalScale = new Vector2(0.31, 0.42);
    ground.roughness = 0.72;
    configureGroundShading(ground, true, {
      detail,
      grit: nextGrit,
      relief: nextRelief,
      contacts: createSlateContacts(),
    });
    ground.needsUpdate = true;
    sameMaterial();
    assert.equal(cliff.mesh.material[0].map, nextColor);
    assert.equal(cliff.mesh.material[0].normalMap, nextNormal);
    assert.equal(cliff.mesh.material[0].normalScale, ground.normalScale);
    assert.equal(cliff.mesh.material[0].color, ground.color);
    assert.equal(cliff.mesh.material[0].roughness, 0.72);
    const replacement = compileShelf();
    assert.equal(replacement.uniforms.slateGrit.value, nextGrit);
    assert.equal(replacement.uniforms.slateRelief.value, nextRelief);
    ambient.intensity = 1.7;
    cliff.mesh.children[0].onBeforeRender();
    assert.deepEqual(
      cliff.material.uniforms.seaAmbient.value.toArray(),
      ambient.color.clone().multiplyScalar(1.7).toArray(),
    );
    ground.map = procedural;
    ground.normalMap = null;
    configureGroundShading(ground, false);
    sameMaterial();
    assert.equal(cliff.mesh.material[0].map, procedural);
    assert.equal(cliff.mesh.material[0].normalMap, null);
    assert.equal(
      compileShelf().fragmentShader,
      ShaderLib.physical.fragmentShader,
      "fallback uses the ground's own current shader",
    );
    assert.ok(
      [...freed.values()].every((count) => count === 0),
      "profile and map replacement never release borrowed textures",
    );
    cliff.dispose();
    disposed = true;
    assert.equal(groundFreed, 0, "the ground material remains owned by the ground");
    assert.ok(
      [...freed.values()].every((count) => count === 0),
      "cliff disposal leaves every borrowed texture alive",
    );
    assert.ok(
      [...ownFreed.values()].every((count) => count === 1),
      "only the derived geometry and cliff material are released, once each",
    );
  } finally {
    if (!disposed) cliff.dispose();
    ground.dispose();
    maps.forEach((map) => map.dispose());
  }
});

test("the river pours off the cliffs where it meets the fault, into white water at their foot", () => {
  const drop = riverFalls(RIVER_LINE);
  assert.ok(drop, "the river reaches the fault");
  const [x, z, half] = drop.lip;
  assert.ok(Math.abs(coastDistance(x, z)) < 0.05, "its lip is on the fault");
  assert.ok(Math.abs(drop.along - faultAlong(x, z)) < 1e-9);
  // It runs out to sea, its width the river's there.
  assert.ok(
    drop.heading[0] * Math.cos(Math.PI / 3) + drop.heading[1] * Math.sin(Math.PI / 3) > 0.8,
  );
  assert.ok(half > 2 && half < 6);
  const height = () => 1.25,
    { geometry, plunge } = fallsGeometry(drop, height),
    p = geometry.attributes.position,
    f = geometry.attributes.aFall;
  let low = Infinity,
    high = -Infinity;
  for (let i = 0; i < p.count; i++) {
    low = Math.min(low, p.getY(i));
    high = Math.max(high, p.getY(i));
    assert.ok(f.getY(i) >= 0 && f.getY(i) <= 2);
  }
  assert.ok(low <= SEA.level, "the sheet reaches the sea");
  // At most the shelf's last row over the land (cliffGeometry(): 0.04 + 0.1 of its relief).
  assert.ok(high <= 1.25 + 0.14 + FALLS.lift + 1e-6, "and starts on the shelf");
  assert.ok(coastDistance(plunge[0], plunge[1]) < 0, "it lands out at sea");
  assert.ok(Math.hypot(plunge[0] - x, plunge[1] - z) < 8, "at the cliffs' foot");
  assert.equal(plunge[2], half * FALLS.plunge);
  geometry.dispose();
  // The falls, and the cliffs' slot and shelf water for them.
  const clock = dripClock({ value: 0 }),
    falls = createFalls({ lib, clock, rendering: rendering(), drop, height }),
    cliff = createCliff({ lib, clock, rendering: rendering(), height, drop });
  assert.deepEqual(falls.plunge, plunge);
  // Its middle's brink and heading, which the sea's mirror hangs it from.
  const brink = fallsGeometry(drop, height);
  assert.deepEqual(falls.sheet, brink.sheet);
  brink.geometry.dispose();
  assert.ok(Math.abs(coastDistance(falls.sheet[0], falls.sheet[1])) < 0.2, "on the fault");
  assert.deepEqual(falls.sheet.slice(2), [...drop.heading]);
  const mirror = createSea({ lib, clock, rendering: rendering(), plunge, sheet: falls.sheet });
  assert.deepEqual(Object.values(mirror.material.uniforms.seaSheet.value), falls.sheet);
  mirror.dispose();
  assert.equal(falls.material.side, 0, "the closed solid has outward-facing front, back and sides");
  assert.equal(cliff.material.uniforms.cliffRiver.value.w, half);
  assert.ok(falls.material.fragmentShader.includes(`gl_FragColor=vec4(c,${DEPTH_LAYER.ground});`));
  falls.dispose();
  cliff.dispose();
});

test("the moon's shadow on the coast: the rock casts it, and the cliffs, the stacks, the falls and the sea read the key's own map", () => {
  const view = rendering(),
    sun = new Group(),
    texture = new Texture();
  Object.assign(sun, {
    color: new Color(0xffffff),
    intensity: 2,
    target: new Group(),
    castShadow: true,
    shadow: {
      map: { texture },
      matrix: new Matrix4().makeTranslation(1, 2, 3),
      mapSize: new Vector2(2048, 2048),
    },
  });
  sun.position.set(0, 10, 0);
  sun.updateMatrixWorld();
  sun.target.updateMatrixWorld();
  view.lights = { sun };
  view.renderer = { shadowMap: { enabled: true } };
  const clock = dripClock({ value: 0 }),
    drop = riverFalls(RIVER_LINE),
    height = () => 1.25,
    sea = createSea({ lib, clock, rendering: view }),
    cliff = createCliff({ lib, clock, rendering: view, height, drop }),
    falls = createFalls({ lib, clock, rendering: view, drop, height });
  // The cliffs and the stacks cast (three's depth pass, back faces); the shelf, the
  // ground's material, receives as the plain does; the water and the falls cast none.
  assert.equal(cliff.mesh.castShadow, true);
  assert.equal(cliff.mesh.receiveShadow, true);
  assert.equal(cliff.mesh.children[0].castShadow, true);
  assert.equal(sea.mesh.castShadow, false);
  assert.equal(falls.mesh.castShadow, false);
  for (const { mesh, material } of [sea, cliff, falls]) {
    const u = material.uniforms,
      fragment = material.fragmentShader;
    // Lent per draw: the map, its matrix and its size; off with the renderer's shadows.
    mesh.onBeforeRender();
    assert.equal(u.seaShadowMap.value, texture);
    assert.deepEqual(u.seaShadowMatrix.value.elements, sun.shadow.matrix.elements);
    assert.deepEqual({ ...u.seaShadowSet.value }, { x: 1, y: 2048 });
    view.renderer.shadowMap.enabled = false;
    mesh.onBeforeRender();
    assert.equal(u.seaShadowMap.value, null);
    assert.equal(u.seaShadowSet.value.x, 0);
    view.renderer.shadowMap.enabled = true;
    // The moon's diffuse and its sheen take it; it fades in from the map's edge.
    assert.ok(fragment.includes("seaKeyColor*max(dot(n,seaKey),0.)*seaSun"));
    assert.ok(fragment.includes("return seaKeyColor*seaSun*(a2/"));
    assert.ok(fragment.includes(`smoothstep(0.,${COAST_SHADOW.edge},min(e.x,e.y))`));
    // The spray is lit in the open, never in the surface's shadow.
    assert.ok(fragment.includes("seaSun=1.;c=mix(c,"));
  }
  assert.ok(cliff.material.fragmentShader.includes("seaSun=seaShadow(vW,n);"));
  assert.ok(falls.material.fragmentShader.includes("seaSun=seaShadow(vW,n);"));
  assert.ok(falls.material.fragmentShader.includes("seaKeyColor*seaSun*(.25/SEA_PI+"));
  sea.dispose();
  cliff.dispose();
  falls.dispose();
});

test("the sea mirrors the cliffs' lit, wet face, the stacks and the falls where its reflected ray meets them", () => {
  const sea = createSea({
      lib,
      clock: dripClock({ value: 0 }),
      rendering: rendering(),
      plunge: [80, 82, 8],
      sheet: [78, 80, 0.5, 0.86],
    }),
    fragment = sea.material.fragmentShader;
  // The face: where the ray first meets it, wet and darker at its foot.
  assert.ok(fragment.includes("face=max(face,f);if(th>1e3&&f>.5)th=tt;"));
  // The stacks, each where the ray enters its leaning section, the one it meets most shaded.
  assert.ok(fragment.includes(stacksMirrorGlsl()));
  assert.equal(fragment.split("if(sc>bs)").length - 1, STACKS.list.length);
  // The falls, between their brink and the plunge.
  assert.ok(fragment.includes("vec2 fo=mix(seaSheet.xy,seaFalls.xy,.5);"));
  // All of it lit as it faces (its own moonlight, not the water's shadow) and its wet sheen, in one light.
  assert.ok(
    fragment.includes(
      "float ss=seaSun;seaSun=1.;\nsky=mix(sky,ha*seaLight(hn,babelFlash.x*(1.-b))+seaGGX(hn,-Rt,mix(.6,.18,hwet),.04)*mix(.2,1.,hwet),hw);seaSun=ss;",
    ),
  );
  assert.equal(
    fragment.split("seaLight(").length - 1,
    5,
    "no more lights than before (four, and its own)",
  );
  sea.dispose();
});

test("the slate's shore edits: the walk's view from up high fades the land's far edge, but not at the cliffs", () => {
  const edits = slateShoreEdits(HIGH_VIEW.fade);
  assert.equal(edits.length, 2);
  for (const [stage] of edits) assert.equal(stage, "fragmentShader");
  assert.ok(edits[0][2].includes("uniform float slateHigh;"));
  assert.ok(edits[0][2].includes(coastGlsl()));
  assert.ok(edits[1][2].includes("slateHigh*smoothstep(80.0, 188.0, length(vMudWorld.xz))"));
  assert.ok(edits[1][2].includes("smoothstep(30.0, 70.0, seaCoast(vMudWorld.xz))"));
  assert.ok(edits[1][2].includes(`earthAir *= 1.0+slateHigh*${SEA_SHARED.edgeLift};`));
  assert.deepEqual(HIGH_VIEW.fade, [80, 188]);
});

test("the sea, the cliffs and the falls land with the film terrain, sink the ranges past the fault, and go with it", async () => {
  const scene = new Scene(),
    root = new Group(),
    ground = new Mesh(new BoxGeometry(), new MeshStandardMaterial());
  scene.add(root);
  root.add(ground);
  const film = createFilmScene({
    ground,
    groundHeight: () => 0,
    loadTerrain: () => import("../src/scene/terrain-build.js"),
    skyMaterial: { uniforms: { sunColor: { value: new Color() } } },
    rendering: { setFilmTreatment() {}, homeScene: scene, lights: {} },
    atmosphere: { setFilmTreatment() {} },
    invalidate() {},
  });
  film.setActive(true);
  const height = await film.ready;
  assert.equal(height.shore(80, 80), coastDistance(80, 80), "the walk's edge");
  const names = root.children.map((child) => child.name);
  for (const name of ["estate-sea", "estate-cliff", "estate-falls"])
    assert.ok(names.includes(name), `${name} in ${names}`);
  // The fault's shots join the tree's list with the sea, framed from the ground's parent.
  const treeShots = () => DIRECTED_SHOTS.tree.map((shot) => shot.name),
    coastNames = COAST_SHOTS.map((shot) => shot.name),
    landNames = treeShots().filter((name) => !coastNames.includes(name));
  assert.deepEqual(treeShots(), [...landNames, ...coastNames]);
  assert.deepEqual(
    [SEA_SINK.value.x, SEA_SINK.value.y, SEA_SINK.value.z, SEA_SINK.value.w],
    [...coastPlane(), 1],
  );
  const meshes = root.children.filter((child) => child.name.startsWith("estate-"));
  film.setActive(false);
  assert.equal(ground.geometry.type, "BoxGeometry", "restore the borrowed surface");
  assert.ok(
    meshes.every((mesh) => !mesh.parent),
    "withdraw the entire shore",
  );
  assert.equal(SEA_SINK.value.w, 0);
  assert.equal(height(100, 40), 0, "the live sampler follows the borrowed ground");
  assert.equal(height.shore(80, 80), Infinity, "the inactive coast cannot constrain the walk");
  assert.deepEqual(treeShots(), landNames, "the fault's shots leave with the sea");
  film.setActive(true);
  assert.deepEqual(treeShots(), [...landNames, ...coastNames], "and join it again, once");
  assert.ok(
    meshes.every((mesh) => mesh.parent === root),
    "reuse the shore on reactivation",
  );
  assert.equal(SEA_SINK.value.w, 1);
  film.dispose();
  for (const name of ["estate-sea", "estate-cliff", "estate-falls"])
    assert.ok(!root.children.some((child) => child.name === name), `${name} stays`);
  assert.equal(SEA_SINK.value.w, 0, "the ranges stand again");
  assert.deepEqual(treeShots(), landNames);
  ground.material.dispose();
});

test("the fault's shots look over the broken coast from the land, inside the sky's shell, their shadow over the coast", () => {
  assert.equal(new Set(COAST_SHOTS.map((shot) => shot.name)).size, COAST_SHOTS.length);
  // The film's shadow camera (rendering.js focusFilmShadow(): 48 either side, looking
  // down the moon key), fully in once COAST_SHADOW.edge in from its edge.
  const key = new Vector3(...MOON_LIGHTS.key).normalize(),
    across = new Vector3(0, 1, 0).cross(key).normalize(),
    up = key.clone().cross(across),
    covered = (shot, x, y, z) => {
      const d = new Vector3(x - shot.shadow[0], y - 1.25, z - shot.shadow[1]);
      return (
        Math.max(Math.abs(d.dot(across)), Math.abs(d.dot(up))) < 48 * (1 - 2 * COAST_SHADOW.edge)
      );
    };
  const estate = new Group();
  estate.position.y = -6.8;
  estate.updateMatrixWorld(true);
  for (const base of COAST_SHOTS) {
    assert.ok(Object.isFrozen(base) && TOUR_ORDER.includes(base.after), base.name);
    assert.ok(base.landscape.move === null, "landscape phones hold it still");
    for (const shot of [
      base,
      { ...base, ...base.landscape },
      ...(base.portrait ? [{ ...base, ...base.portrait }] : []),
    ]) {
      const view = coastShot(shot, estate),
        measured = view.measure(null, view),
        fitted = view.fit(measured, view, null);
      assert.deepEqual(measured.target.toArray(), [shot.aim[0], shot.aim[1] - 6.8, shot.aim[2]]);
      assert.equal(measured.cameraY, shot.rise - 6.8);
      assert.equal(fitted.distance, shot.reach);
      // Its camera, through its whole move: on the land, back from the cliffs' lip, high
      // over the plain, and inside the sky's shell (radius 130 about the lookout).
      for (const phase of [0, 0.25, 0.5, 0.75, 1]) {
        const pose = shotPose(shot, phase),
          yaw = (shot.azimuth * Math.PI) / 180,
          reach = shot.reach * pose.scale,
          side = pose.truck * reach,
          x = shot.aim[0] + Math.cos(yaw) * reach - Math.sin(yaw) * side,
          z = shot.aim[2] + Math.sin(yaw) * reach + Math.cos(yaw) * side,
          label = `${shot.name} at ${phase}`;
        assert.ok(coastDistance(x, z) > 3, `${label} stands on the land`);
        assert.ok(Math.hypot(x, z) < 122, `${label} inside the sky's shell`);
        assert.ok(shot.rise + pose.crane * measured.height > 1.25 + 4, `${label} over the plain`);
        // The film's shadow covers the land at its feet.
        assert.ok(covered(shot, x, 1.25, z), label);
      }
      // ... and the rock it looks at: every stack within 25 degrees of its aim and 100 units
      // of its camera (farther, it stands small in the mist), foot and crown.
      const yaw = (shot.azimuth * Math.PI) / 180,
        eye = [shot.aim[0] + Math.cos(yaw) * shot.reach, shot.aim[2] + Math.sin(yaw) * shot.reach],
        aim = Math.atan2(shot.aim[2] - eye[1], shot.aim[0] - eye[0]);
      STACKS.list.forEach(([, , height], k) => {
        const [x, z] = stackWaterlineProfile(STACKS, k).center,
          turn = Math.atan2(z - eye[1], x - eye[0]) - aim;
        if (
          Math.abs(Math.atan2(Math.sin(turn), Math.cos(turn))) > (25 * Math.PI) / 180 ||
          Math.hypot(x - eye[0], z - eye[1]) > 100
        )
          return;
        for (const y of [SEA.level, SEA.level + height])
          assert.ok(covered(shot, x, y, z), `${shot.name}'s shadow covers stack ${k}`);
      });
      assert.deepEqual(fitted.shadow.toArray(), [shot.shadow[0], 1.25 - 6.8, shot.shadow[1]]);
    }
  }
});

test("the ranges sink past the fault in both mountain programs, off until the sea lands", () => {
  const silhouette = flat(source("src/scene/hill-silhouette.js"));
  assert.equal(SEA_SINK.value.w, 0);
  assert.ok(
    silhouette.includes(
      "w.y-=uSea.w*smoothstep(0.,60.,dot(w.xz,uSea.xy)-uSea.z)*(w.y-modelMatrix[3].y+40.);",
    ),
  );
  assert.equal(silhouette.match(/uSea: SEA_SINK|uniforms\.uSea = SEA_SINK/g)?.length, 2);
  assert.equal(silhouette.match(/\$\{SINK_GLSL\}/g)?.length, 2);
  // The sea's module is the terrain chunk's own (terrain-build.js imports it), and imports
  // only its optional texture owner: nothing first-party enters from the
  // entry, and what it shares with that entry is restated or lent.
  const imports = (path) =>
    [...flat(source(path)).matchAll(/import [^;]*? from "([^"]+)";/g)].map((match) => match[1]);
  assert.ok(imports("src/scene/terrain-build.js").includes("./ocean.js"));
  assert.deepEqual(imports("src/scene/ocean.js"), ["three", "./coast-detail.js"]);
  assert.deepEqual(imports("src/scene/coast-detail.js"), ["three"]);
});

test("the sea, the cliffs and the falls link with the slate's root shading and land only with it, unseen", async () => {
  const queue = [],
    previous = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = (task) => queue.push(task);
  const step = async (count = 1) => {
    for (let i = 0; i < count; i++) {
      for (const task of queue.splice(0)) task(performance.now());
      await new Promise((resolve) => setImmediate(resolve));
    }
  };
  try {
    const terrain = createEarthGeometry(() => 0),
      material = new MeshStandardMaterial();
    configureGroundShading(material, true, { detail: { isTexture: true } });
    const root = new Group(),
      ground = new Mesh(terrain, material);
    root.add(ground);
    // A renderer that links in parallel, its programs ready at once; it records each batch.
    const batches = [],
      cache = new WeakMap(),
      renderer = {
        domElement: { parentNode: { classList: { contains: (name) => name === "is-ready" } } },
        extensions: { has: (name) => name === "KHR_parallel_shader_compile" },
        getContext: () => ({ isContextLost: () => false }),
        properties: {
          get(m) {
            if (!cache.has(m)) cache.set(m, {});
            return cache.get(m);
          },
        },
        shadowMap: { enabled: false },
        getRenderTarget: () => null,
        setRenderTarget() {},
        compile(objects) {
          const materials = new Set(),
            names = [];
          objects.traverse((object) => {
            if (!object.material) return;
            names.push(object.name);
            materials.add(object.material);
            renderer.properties.get(object.material).currentProgram = { isReady: () => true };
          });
          batches.push(names);
          return materials;
        },
      };
    const rendering = {
        renderer,
        compilePrograms,
        homeScene: new Scene(),
        lights: {},
        camera: { isCamera: true },
        composer: { readBuffer: { isRenderTarget: true } },
      },
      tour = { running: true, transition: { cut: false } };
    const landed = () =>
      ["estate-sea", "estate-cliff", "estate-falls"].filter((name) =>
        root.children.some((child) => child.name === name),
      );
    settleRoots(
      terrain,
      ground,
      rendering,
      () => 0,
      () => {},
      tour,
      lib,
    );
    // One batch: the slate's stand-in beside the sea, the cliffs (with their stacks) and the falls.
    assert.equal(batches.length, 1);
    for (const name of ["estate-sea", "estate-cliff", "estate-stacks", "estate-falls"])
      assert.ok(batches[0].includes(name), `${name} in ${batches[0]}`);
    await step(3);
    assert.deepEqual(landed(), [], "linked, but nothing lands mid-shot");
    assert.equal(SEA_SINK.value.w, 0, "the ranges stand");
    assert.equal(material.userData.slateRoot, undefined);
    tour.transition.cut = true;
    await step(2);
    assert.deepEqual(
      landed(),
      ["estate-sea", "estate-cliff", "estate-falls"],
      "on the cut, with the slate",
    );
    assert.equal(typeof material.userData.slateRoot, "function");
    assert.equal(SEA_SINK.value.w, 1);
    terrain.dispose();
    assert.deepEqual(landed(), []);
    assert.equal(SEA_SINK.value.w, 0);
    material.dispose();
  } finally {
    if (previous) globalThis.requestAnimationFrame = previous;
    else delete globalThis.requestAnimationFrame;
  }
});

// The real film/terrain owners, with only frame delivery and driver completion
// controlled. The camera can reveal the borrowed ground while this tuple waits.
function coastalFilmRig({ revealed = true, holdBuild = false } = {}) {
  const frames = [],
    previous = globalThis.requestAnimationFrame,
    terrain = createEarthGeometry(() => 0),
    original = new BoxGeometry(),
    material = new MeshStandardMaterial(),
    ground = new Mesh(original, material),
    root = new Group(),
    scene = new Scene(),
    batches = [],
    tour = { running: true, transition: { cut: false } },
    host = { revealed };
  globalThis.requestAnimationFrame = (task) => frames.push(task);
  root.add(ground);
  scene.add(root);
  let finishBuild, sampler;
  const build = holdBuild ? new Promise((resolve) => (finishBuild = resolve)) : terrain;
  const renderer = {
    domElement: { parentNode: { classList: { contains: () => host.revealed } } },
    extensions: { has: () => true },
    compile() {},
    properties: {},
    getContext: () => ({ isContextLost: () => false }),
    getRenderTarget: () => null,
    setRenderTarget() {},
    shadowMap: { enabled: false },
  };
  const film = createFilmScene({
    ground,
    groundHeight: () => 0,
    rendering: {
      renderer,
      homeScene: scene,
      lights: {},
      camera: {},
      setFilmTreatment() {},
      compilePrograms(_renderer, objects, _camera, _scene, valid) {
        const meshes = [];
        objects.traverse((mesh) => mesh.isMesh && meshes.push(mesh));
        return new Promise((finish) => batches.push({ meshes, valid, finish }));
      },
    },
    atmosphere: { setFilmTreatment() {} },
    skyMaterial: { uniforms: { sunColor: { value: new Color() } } },
    onGroundChange: (active) =>
      configureGroundShading(material, active, { detail: { isTexture: true } }),
    tour,
    loadTerrain: async () => ({
      createEarthGeometry: () => build,
      settleRoots(...args) {
        sampler = settleRoots(...args);
        return sampler;
      },
    }),
  });
  return {
    film,
    terrain,
    original,
    ground,
    root,
    batches,
    host,
    tour,
    get sampler() {
      return sampler;
    },
    finishBuild: () => finishBuild?.(terrain),
    shore: () => root.children.filter((child) => child.name.startsWith("estate-")),
    async step(count = 1) {
      for (let i = 0; i < count; i++) {
        for (const task of frames.splice(0)) task(performance.now());
        await new Promise((resolve) => setImmediate(resolve));
      }
    },
    async dispose() {
      film.dispose();
      batches.forEach((batch) => batch.finish(false));
      await this.step(2);
      original.dispose();
      material.dispose();
      if (previous) globalThis.requestAnimationFrame = previous;
      else delete globalThis.requestAnimationFrame;
    },
  };
}

test("the reveal keeps borrowed terrain until coastal geometry, shore, sink and height can land together", async () => {
  const r = coastalFilmRig({ revealed: false });
  let ready;
  try {
    r.film.setActive(true);
    r.film.ready.then((height) => (ready = height));
    await r.step(2);
    assert.equal(r.batches.length, 0);
    assert.equal(r.ground.geometry, r.original);
    assert.equal(r.sampler(100, 40), 0, "no future height while the borrowed ground draws");
    assert.equal(r.sampler.shore(80, 80), Infinity);
    assert.equal(ready, r.sampler, "prepared readiness lets optional downloads start");
    // The title-card reveal is independent of this optional work.
    r.host.revealed = true;
    await r.step(2);
    assert.equal(r.batches.length, 1);
    assert.equal(r.ground.geometry, r.original, "a pending driver cannot expose the cut seabed");
    assert.deepEqual(r.shore(), []);
    assert.equal(SEA_SINK.value.w, 0);
    r.batches[0].finish(true);
    await r.step(2);
    assert.equal(r.ground.geometry, r.original, "linked work still waits for its cut");
    assert.equal(ready, r.sampler, "published height still follows the borrowed ground");
    r.tour.transition.cut = true;
    await r.step(2);
    assert.equal(await r.film.ready, r.sampler);
    assert.equal(r.ground.geometry, r.terrain);
    assert.equal(r.shore().length, 3);
    assert.equal(SEA_SINK.value.w, 1);
    assert.ok(Math.abs(r.sampler(100, 40) - filmHeight(() => 0, true)(100, 40)) < 1e-10);
    assert.equal(r.sampler.shore(80, 80), coastDistance(80, 80));
  } finally {
    await r.dispose();
  }
});

test("film deactivation during a coastal build or link prevents late landing and reactivation reuses the tuple", async () => {
  for (const phase of ["building", "linking", "linked"]) {
    const r = coastalFilmRig({ holdBuild: phase === "building" });
    try {
      r.film.setActive(true);
      await r.step(2);
      if (phase === "linked") {
        r.batches[0].finish(true);
        await r.step(2);
      }
      r.film.setActive(false);
      r.finishBuild();
      r.batches.forEach((batch) => batch.finish(true));
      r.tour.transition.cut = true;
      await r.step(3);
      assert.equal(r.ground.geometry, r.original, phase);
      assert.equal(r.shore().length, 0);
      assert.equal(SEA_SINK.value.w, 0);
      assert.equal(r.sampler(100, 40), 0);
      assert.equal(r.sampler.shore(80, 80), Infinity);
      assert.ok(
        r.batches.every((batch) => !batch.valid()),
        "old generations retire",
      );
      r.tour.transition.cut = false;
      const count = r.batches.length;
      r.film.setActive(true);
      await r.step(2);
      assert.equal(r.batches.length, count + 1);
      r.batches.at(-1).finish(true);
      await r.step(2);
      assert.equal(r.ground.geometry, r.original, "reactivation also waits for a cut");
      r.tour.transition.cut = true;
      await r.step(2);
      assert.equal(await r.film.ready, r.sampler);
      assert.equal(r.ground.geometry, r.terrain);
      const meshes = r.shore();
      assert.equal(meshes.length, 3);
      r.film.setActive(false);
      assert.equal(r.ground.geometry, r.original);
      assert.ok(meshes.every((mesh) => !mesh.parent));
      assert.equal(SEA_SINK.value.w, 0);
      assert.equal(r.sampler(100, 40), 0, "the cached sampler follows withdrawal too");
    } finally {
      await r.dispose();
    }
  }
});

test("rock GLBs start beside coastal linking but their layout waits for the coastal commit", async () => {
  const r = coastalFilmRig(),
    requests = [];
  let rocks;
  try {
    r.film.setActive(true);
    await r.step(2);
    const height = await r.film.ready;
    assert.equal(height, r.sampler);
    assert.equal(height(100, 40), 0);
    rocks = createRockScatter({
      tier: "high",
      parent: r.root,
      terrain: () => r.film.ready,
      load: async () => ({ createRocks }),
      loadAsset: () => new Promise((resolve) => requests.push(resolve)),
      compile: () => true,
    });
    rocks.setFilmActive(true);
    rocks.setTreeStatus("ready");
    rocks.setRevealed();
    await r.step(2);
    assert.equal(requests.length, 2, "both GLBs start before the pending coastal programs finish");
    for (const resolve of requests) {
      const scene = new Group();
      scene.add(new Mesh(new BoxGeometry(), new MeshStandardMaterial()));
      resolve({ scene });
    }
    await r.step(2);
    const root = r.root.getObjectByName("film-rocks");
    assert.equal(root.children.length, 0, "loaded assets cannot place rocks against future ground");
    assert.equal(rocks.take({ cut: true, running: true }), false);
    r.batches[0].finish(true);
    await r.step(2);
    assert.equal(root.children.length, 0, "linked coast still waits for a cut");
    r.tour.transition.cut = true;
    await r.step(2);
    assert.equal(await height.ready, true);
    assert.equal(r.ground.geometry, r.terrain);
    assert.equal(root.children.length, 2);
    assert.equal(root.visible, false, "rock programs and placement retain their own cut gate");
    rocks.take({ cut: false, running: true, nowMs: 0 });
    await r.step();
    assert.equal(rocks.take({ cut: true, running: true, nowMs: 16 }), true);
    assert.equal(root.visible, true);
  } finally {
    rocks?.dispose();
    await r.dispose();
  }
});

test("loaded rocks waiting for a coastal cut release on terrain failure or scatter disposal", async () => {
  for (const owner of ["terrain", "rocks"]) {
    const r = coastalFilmRig(),
      owned = [],
      statuses = [];
    let rocks;
    try {
      r.film.setActive(true);
      await r.step(2);
      const height = await r.film.ready;
      rocks = createRockScatter({
        tier: "high",
        parent: r.root,
        terrain: () => r.film.ready,
        load: async () => ({ createRocks }),
        loadAsset: async () => {
          const geometry = new BoxGeometry(),
            material = new MeshStandardMaterial(),
            scene = new Group();
          for (const resource of [geometry, material]) {
            const record = { freed: 0 };
            owned.push(record);
            resource.addEventListener("dispose", () => record.freed++);
          }
          scene.add(new Mesh(geometry, material));
          return { scene };
        },
        onStatus: ({ status }) => statuses.push(status),
      });
      rocks.setFilmActive(true);
      rocks.setTreeStatus("ready");
      rocks.setRevealed();
      await r.step(3);
      assert.equal(owned.length, 4);
      assert.ok(
        owned.every(({ freed }) => freed === 0),
        "the pending build owns its loaded assets",
      );
      const root = r.root.getObjectByName("film-rocks");
      assert.equal(root.children.length, 0);
      if (owner === "terrain") {
        r.film.dispose();
        assert.equal(await height.ready, false);
        await r.step(2);
        assert.deepEqual(statuses, ["loading", "fallback"]);
      } else {
        rocks.dispose();
        assert.ok(
          owned.every(({ freed }) => freed === 1),
          "no coastal commit is needed to release",
        );
        r.batches[0].finish(true);
        r.tour.transition.cut = true;
        await r.step(3);
        assert.equal(await height.ready, true);
        assert.deepEqual(statuses, ["loading"], "late readiness cannot publish after disposal");
      }
      assert.ok(
        owned.every(({ freed }) => freed === 1),
        "each borrowed asset is freed once",
      );
      assert.equal(root.children.length, 0);
      assert.equal(rocks.take({ cut: true, running: true }), false);
    } finally {
      rocks?.dispose();
      await r.dispose();
    }
  }
});

test("rocks loading across film withdrawal retain the committed film height while walking follows visible ground", async () => {
  const r = coastalFilmRig(),
    requests = [];
  let rocks;
  try {
    r.film.setActive(true);
    await r.step(2);
    r.batches[0].finish(true);
    r.tour.transition.cut = true;
    await r.step(2);
    const height = await r.film.ready,
      expected = createRockLayout(ROCK_LIB, { groundHeight: height });
    rocks = createRockScatter({
      tier: "high",
      parent: r.root,
      groundHeight: () => 0,
      terrain: () => r.film.ready,
      load: async () => ({ createRocks }),
      loadAsset: () => new Promise((resolve) => requests.push(resolve)),
      compile: () => true,
    });
    rocks.setFilmActive(true);
    rocks.setTreeStatus("ready");
    rocks.setRevealed();
    await r.step(2);
    assert.equal(requests.length, 2, "both real rock asset loads are pending");
    r.film.setActive(false);
    rocks.setFilmActive(false);
    assert.equal(height(100, 40), 0, "walking follows the borrowed ground");
    assert.equal(height.shore(80, 80), Infinity);
    const withdrawn = createRockLayout(ROCK_LIB, { groundHeight: height });
    assert.ok(
      expected.some((rock, i) => rock.y !== withdrawn[i].y),
      "the fixture would seat rocks differently through the visible-surface sampler",
    );
    for (const resolve of requests) {
      const scene = new Group();
      scene.add(new Mesh(new BoxGeometry(), new MeshStandardMaterial()));
      resolve({ scene });
    }
    await r.step(2);
    const root = r.root.getObjectByName("film-rocks");
    assert.equal(root.children.length, 2);
    for (const mesh of root.children) {
      const type = mesh.name.slice("film-rocks-".length),
        matrices = expected
          .filter((rock) => rock.type === type)
          .flatMap((rock) => rock.matrix.elements.map(Math.fround));
      assert.deepEqual([...mesh.instanceMatrix.array], matrices, type);
    }
    r.film.setActive(true);
    await r.step(2);
    r.batches.at(-1).finish(true);
    await r.step(2);
    rocks.setFilmActive(true);
    rocks.take({ cut: false, running: true, nowMs: 0 });
    await r.step();
    assert.equal(rocks.take({ cut: true, running: true, nowMs: 16 }), true);
    assert.equal(root.visible, true);
    assert.equal(r.ground.geometry, r.terrain);
    assert.equal(height(100, 40), height.film(100, 40));
  } finally {
    rocks?.dispose();
    await r.dispose();
  }
});

test("disposing a film with pending coastal programs settles ready and releases derived resources only", async () => {
  const r = coastalFilmRig();
  let originalFreed = 0,
    materialFreed = 0;
  r.original.addEventListener("dispose", () => originalFreed++);
  r.ground.material.addEventListener("dispose", () => materialFreed++);
  try {
    r.film.setActive(true);
    await r.step(2);
    const batch = r.batches[0],
      resources = new Set();
    for (const mesh of batch.meshes) {
      if (!mesh.name.startsWith("estate-")) continue;
      resources.add(mesh.geometry);
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material])
        if (material !== r.ground.material) resources.add(material);
    }
    assert.equal(resources.size, 7, "four shore geometries and three owned materials");
    const freed = new Map([...resources].map((resource) => [resource, 0]));
    for (const resource of resources)
      resource.addEventListener("dispose", () => freed.set(resource, freed.get(resource) + 1));
    // The batch detaches its children after compile; the owner's root is still empty.
    assert.equal(r.shore().length, 0);
    r.film.dispose();
    assert.equal(await r.film.ready, r.sampler, "the prepared visible-surface sampler stays safe");
    assert.equal(await r.sampler.ready, false, "coastal readiness retires on disposal");
    assert.equal(batch.valid(), false);
    assert.equal(r.ground.geometry, r.original);
    assert.equal(SEA_SINK.value.w, 0);
    assert.equal(originalFreed, 0, "borrowed geometry survives");
    assert.equal(materialFreed, 0, "borrowed shelf material survives");
    assert.ok(
      [...freed.values()].every((count) => count === 1),
      "each derived resource is freed once",
    );
    batch.finish(true);
    await r.step(2);
    assert.equal(r.shore().length, 0, "a retired completion cannot land later");
    assert.ok([...freed.values()].every((count) => count === 1));
  } finally {
    await r.dispose();
  }
});
