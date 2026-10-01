// The film's scattered rocks, loaded on demand (scripts/scene.rock-build.HASH.js)
// once rock-scatter.js decides they will show: their placement, grounding,
// contacts and meshes. Visitors on the low tier (the static title card) never
// download it.
//
// This module imports nothing: code shared with the entry would move into the
// shared chunk (build.mjs refuses first-party code there), and even three
// would split the shared Three.js chunk in two. Every table, helper and Three
// class arrives in `lib` (rock-scatter.js ROCK_LIB).

// Reach of each directed shot's view wedge from its subject; other tower shots 45.
const SHOT_REACH = { "The watch": 160, Portrait: 95, "Root and lantern": 40, "Close-up": 30, "Lantern study": 15 };

// Clear of the tower, tree, lantern and path, and outside every directed
// shot's wedge between its camera and its subject: azimuth +-(arc/2 + 10).
export function rockClear(lib, x, z, radius, { lanternStone = false } = {}) {
  const { ESTATE, DIRECTED_SHOTS } = lib,
    lantern = lib.estateLantern(),
    { tower, tree } = ESTATE;
  if (Math.hypot(x - tower.x, z - tower.z) <= tower.clear + radius) return false;
  if (Math.hypot(x - tree.x, z - tree.z) <= (lanternStone ? ESTATE.lantern.offset : tree.clear + radius)) return false;
  if (Math.hypot(x - lantern.x, z - lantern.z) <= ESTATE.lantern.clear + radius) return false;
  if (lib.estatePathDistance(x, z) <= ESTATE.path.clear + 0.5 + radius) return false;
  for (const [kind, shots] of Object.entries(DIRECTED_SHOTS))
    for (const shot of shots) {
      const center = shot.subject === "tree-lantern" ? lantern : ESTATE[kind],
        dx = x - center.x,
        dz = z - center.z,
        distance = Math.hypot(dx, dz),
        turn = Math.abs(((Math.atan2(dz, dx) * 180) / Math.PI - shot.azimuth + 540) % 360 - 180);
      if (distance < (SHOT_REACH[shot.name] ?? 45) && turn < shot.arc / 2 + 10) return false;
    }
  return true;
}

// Seeded placement without terrain: x/z, footprint radius and the variety
// draws, the clusters first and then one pebble beside each tall rock.
export function rockFootprints(lib, seed = 91357) {
  const { ROCK_TYPES, ROCK_CLUSTERS, PEBBLE_UNDER } = lib;
  let state = seed;
  const random = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296;
  const rocks = [];
  const vary = (rock) => {
    const [fx, fz] = ROCK_TYPES[rock.type].footprint,
      stretch = 0.8 + 0.45 * random();
    return Object.assign(rock, {
      yaw: random() * Math.PI * 2,
      stretch,
      lift: 0.85 + 0.25 * random(),
      tone: 0.94 + 0.12 * random(),
      sink: 0.12 + 0.23 * random(),
      // Bounding radius of the stretched footprint, and its mean half extent.
      radius: 0.5 * Math.hypot(fx * stretch, fz) * rock.height,
      half: 0.25 * (fx * stretch + fz) * rock.height,
    });
  };
  for (const [id, anchor, deg, dist, type, height] of ROCK_CLUSTERS)
    rocks.push(vary({ id, type, height, ...lib.estatePoint(anchor, deg, dist), lanternStone: anchor === "lantern" }));
  for (const rock of rocks.filter((item) => item.height >= PEBBLE_UNDER)) {
    for (let attempt = 0; attempt < 16; attempt++) {
      const angle = random() * Math.PI * 2,
        reach = (1.2 + 1.4 * random()) * rock.radius;
      const pebble = vary({
        id: `${rock.id}p`,
        type: random() < 0.5 ? "lichen" : "weathered",
        height: 0.12 + 0.16 * random(),
        x: rock.x + Math.cos(angle) * reach,
        z: rock.z + Math.sin(angle) * reach,
        pebble: true,
      });
      if (
        rockClear(lib, pebble.x, pebble.z, pebble.radius) &&
        rocks.every((other) => Math.hypot(pebble.x - other.x, pebble.z - other.z) > pebble.radius + other.radius)
      ) {
        rocks.push(pebble);
        break;
      }
    }
  }
  return rocks;
}

// Seats each rock on the terrain: the up axis leans 60% toward the ground's
// normal (pebbles up to 4 degrees more), and the base sinks below the lowest of
// five footprint samples.
export function createRockLayout(lib, { groundHeight, seed = 91357 }) {
  const { Matrix4, Quaternion, Vector3 } = lib,
    up = new Vector3(0, 1, 0),
    point = new Vector3(),
    normal = new Vector3(),
    tilt = new Quaternion(),
    spin = new Quaternion();
  return rockFootprints(lib, seed).map((rock) => {
    const [fx, fz] = lib.ROCK_TYPES[rock.type].footprint,
      hx = 0.5 * fx * rock.stretch * rock.height,
      hz = 0.5 * fz * rock.height;
    spin.setFromAxisAngle(up, rock.yaw);
    let low = groundHeight(rock.x, rock.z);
    for (const [px, pz] of [[hx, 0], [-hx, 0], [0, hz], [0, -hz]]) {
      point.set(px, 0, pz).applyQuaternion(spin);
      low = Math.min(low, groundHeight(rock.x + point.x, rock.z + point.z));
    }
    const d = Math.max(hx, hz, 0.25);
    normal
      .set(
        (groundHeight(rock.x - d, rock.z) - groundHeight(rock.x + d, rock.z)) / (2 * d),
        1,
        (groundHeight(rock.x, rock.z - d) - groundHeight(rock.x, rock.z + d)) / (2 * d),
      )
      .normalize()
      .lerp(up, 0.4);
    if (rock.pebble) normal.add(point.set(Math.sin(rock.yaw * 3), 0, Math.cos(rock.yaw * 5)).multiplyScalar(0.07));
    tilt.setFromUnitVectors(up, normal.normalize()).multiply(spin);
    const scale = new Vector3(rock.stretch, rock.lift, 1).multiplyScalar(rock.height),
      y = low - rock.sink * scale.y;
    return { ...rock, y, matrix: new Matrix4().compose(new Vector3(rock.x, y, rock.z), tilt, scale) };
  });
}

// Fills the ground's contact slots after the tree and lantern (mud-ground.js
// slateContacts): every rock at least 0.3 tall. mud-ground.js gates these on
// slateRockContact, which index.js sets when the rocks appear.
export function writeRockContacts(contacts, rocks) {
  const entries = rocks.filter((rock) => rock.height >= 0.3).map((rock) => [rock.x, rock.z, rock.half * 1.35, 0.28]);
  contacts.set(entries.slice(0, contacts.length / 4 - 2).flat(), 8);
  return contacts;
}

// Loads the two stones and builds one InstancedMesh per stone with no
// instances. Their programs link through compile(); take() then commits the
// instances on a tour cut, under the dissolve's kept frame.
export function createRocks(
  lib,
  {
    parent,
    groundHeight,
    tier,
    anisotropy = 4,
    compile = () => false,
    contacts = null,
    loadAsset = lib.loadArchitectureAsset,
    urls = lib.ARCHITECTURE_ASSET_URLS,
    onStatus = () => {},
  },
) {
  const { Color, InstancedMesh } = lib,
    root = new lib.Group();
  root.name = "film-rocks";
  root.visible = false;
  parent.add(root);
  const meshes = [],
    materials = [],
    resources = [];
  let film = false,
    disposed = false,
    queued = false,
    committed = false;
  const abort = new AbortController();
  const step = lib.createDeferredQualityStep({
    prepare() {
      // Linking needs the meshes visible for this one synchronous traversal.
      root.visible = true;
      try {
        return compile();
      } finally {
        sync();
      }
    },
  });
  function sync() {
    root.visible = film && committed;
  }
  // An asset's textures are disposed before its bitmaps close.
  function free(asset) {
    Object.entries(asset).forEach(([kind, set]) =>
      set.forEach((resource) => (kind === "bitmaps" ? resource.close() : resource.dispose?.())),
    );
  }
  function build(assets) {
    const layout = createRockLayout(lib, { groundHeight }),
      color = new Color();
    Object.keys(lib.ROCK_TYPES).forEach((type, index) => {
      const rocks = layout.filter((rock) => rock.type === type),
        material = lib.stampDepthLayer(lib.materialFor(assets[index], anisotropy, "rock"), lib.DEPTH_LAYER.ground);
      materials.push(material);
      lib.applyFilmGrade(material, true);
      const mesh = new InstancedMesh(lib.sourceMesh(assets[index]).geometry, material, rocks.length);
      mesh.name = `film-rocks-${type}`;
      rocks.forEach((rock, i) => {
        mesh.setMatrixAt(i, rock.matrix);
        mesh.setColorAt(i, color.setScalar(rock.tone));
      });
      mesh.count = 0;
      mesh.castShadow = mesh.receiveShadow = tier === "high";
      meshes.push(mesh);
      root.add(mesh);
    });
    if (contacts) writeRockContacts(contacts, layout);
  }
  function release() {
    meshes.splice(0).forEach((mesh) => mesh.dispose());
    root.clear();
    materials.splice(0).forEach((material) => material.dispose());
    resources.splice(0).forEach(free);
  }
  Promise.allSettled(
    Object.values(lib.ROCK_TYPES).map(({ role }) => loadAsset(urls[tier]?.[role], { signal: abort.signal, tier, role })),
  ).then((results) => {
    const assets = results.map((result) => (result.status === "fulfilled" ? result.value : null)),
      loaded = assets.filter(Boolean).map((asset) => lib.collectResources(asset));
    if (disposed) return loaded.forEach(free);
    resources.push(...loaded);
    try {
      if (assets.some((asset) => !asset?.scene?.isObject3D)) throw new Error("Rock asset unavailable");
      build(assets);
    } catch {
      release();
      onStatus({ status: "fallback", tier });
    }
  });
  return {
    root,
    get committed() {
      return committed;
    },
    setFilmActive(active) {
      if (disposed) return;
      film = Boolean(active);
      sync();
    },
    // Called each frame: queues the link once built, and commits on the first
    // cut after it settles (at once when no tour runs and the link is done).
    take({ cut = false, running = false, nowMs = 0 } = {}) {
      if (disposed || committed || !meshes.length) return false;
      if (!queued) {
        queued = true;
        step.queue(true, nowMs);
      }
      if (!step.take({ cut: cut || !running, running: true, nowMs })) return false;
      meshes.forEach((mesh) => {
        mesh.count = mesh.instanceMatrix.count;
        mesh.computeBoundingSphere();
      });
      committed = true;
      sync();
      onStatus({ status: "ready", tier });
      return true;
    },
    dispose() {
      if (disposed) return false;
      disposed = true;
      abort.abort();
      root.removeFromParent();
      release();
      return true;
    },
  };
}
