// Owner-only, explicitly requested export. This module must stay behind import()
// and must not import first-party scene modules (see developer-tools.js).
import {
  BackSide, BufferGeometry, Color, DataTexture, DoubleSide, Float32BufferAttribute,
  Group, Material, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial,
  Object3D, PlaneGeometry, Quaternion, RGBAFormat, Scene, Source, Vector3,
} from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";

export function isBlenderExportAllowed(location) {
  return Boolean(location && ["http:", "https:"].includes(location.protocol) &&
    ["localhost", "127.0.0.1", "[::1]", "::1"].includes(location.hostname) &&
    new URLSearchParams(location.search).get("sceneDebug") === "1");
}

// Only portable descriptive values belong in glTF extras. Runtime userData can
// hold materials, controllers, DOM nodes, callbacks, and cycles.
function metadataValue(value, depth = 0, seen = new WeakSet()) {
  if (value == null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "object" || depth > 3 || seen.has(value)) return undefined;
  if (value.isObject3D || value.isMaterial || value.isTexture || value.nodeType) return undefined;
  seen.add(value);
  if (Array.isArray(value)) return value.slice(0, 32).map(item => metadataValue(item, depth + 1, seen) ?? null);
  if (Object.getPrototypeOf(value) !== Object.prototype) return undefined;
  return Object.fromEntries(Object.entries(value).slice(0, 32).flatMap(([key, item]) => {
    const safe = metadataValue(item, depth + 1, seen);
    return safe === undefined ? [] : [[key, safe]];
  }));
}

function localMatrix(object) {
  return object.matrixAutoUpdate
    ? new Matrix4().compose(object.position, object.quaternion, object.scale)
    : object.matrix.clone();
}

function worldMatrix(object) {
  const matrix = localMatrix(object);
  return object.parent ? matrix.premultiply(worldMatrix(object.parent)) : matrix;
}

function setMatrix(object, matrix) {
  object.matrix.copy(matrix);
  matrix.decompose(object.position, object.quaternion, object.scale);
  object.matrixAutoUpdate = false;
}

function colorUniform(source, names, fallback) {
  for (const key of names) {
    const value = source.uniforms?.[key]?.value;
    if (value?.isColor) return value.clone();
    if (value?.isVector3) return new Color().setRGB(value.x, value.y, value.z);
  }
  return source.color?.clone() ?? new Color(fallback);
}

const clamp = (n, min = 0, max = 1) => Math.min(max, Math.max(min, n));
const smoothstep = (a, b, n) => { const t = clamp((n - a) / (b - a)); return t * t * (3 - 2 * t); };
function skyColor(altitude, film, source) {
  if (!film) return colorUniform(source, ["bottomColor"], 0x4f4d55)
    .lerp(colorUniform(source, ["topColor"], 0x181d2d), smoothstep(-0.2, 0.7, altitude));
  return new Color().setRGB(0.30, 0.36, 0.49)
    .lerp(new Color().setRGB(0.11, 0.14, 0.21), smoothstep(-0.02, 0.28, altitude))
    .lerp(new Color().setRGB(0.045, 0.065, 0.13), smoothstep(0.24, 0.9, altitude));
}

/** Make an independently disposable, editable snapshot without modifying live
 * transforms, userData, geometry, materials, textures, or GPU resources. Image
 * pixels are borrowed read-only until serialization completes. */
export function createBlenderSnapshot({ scene: sourceScene, camera, viewport = {}, metadata = {} }) {
  if (!sourceScene?.isScene || !camera?.isCamera) throw new Error("A live scene and camera are required.");
  const geometryCopies = new Map(), materialCopies = new Map(), textureCopies = new Map();
  const ownedGeometry = new Set(), ownedMaterials = new Set(), ownedTextures = new Set();
  const nodes = new Map(), records = new Map(), viewWorld = worldMatrix(camera), cameraPosition = new Vector3().setFromMatrixPosition(viewWorld);
  const viewRotation = new Quaternion().setFromRotationMatrix(new Matrix4().extractRotation(viewWorld));
  const viewportHeight = Math.max(1, viewport.height || 900);
  const report = {
    format: "babel-blender-snapshot-v1", capturedAt: new Date().toISOString(),
    metadata: metadataValue(metadata) || {},
    coordinates: "glTF Y-up; Blender's glTF importer converts to Z-up",
    objects: [], lights: [], approximations: [],
    environment: {
      background: sourceScene.background?.isColor ? sourceScene.background.toArray() : null,
      fog: sourceScene.fog ? { type: sourceScene.fog.isFogExp2 ? "exponential" : "linear",
        color: sourceScene.fog.color.toArray(), near: sourceScene.fog.near ?? null,
        far: sourceScene.fog.far ?? null, density: sourceScene.fog.density ?? null } : null,
    },
  };
  const note = (name, reason) => report.approximations.push({ name, reason });
  const ownGeometry = geometry => { ownedGeometry.add(geometry); return geometry; };
  const ownMaterial = material => { ownedMaterials.add(material); return material; };

  function copyTexture(source) {
    if (ownedTextures.has(source)) return source;
    if (!textureCopies.has(source)) {
      const proxy = Object.create(source);
      proxy.userData = metadataValue(source.userData) || {};
      // Texture.copy marks its Source dirty. Give the clone its own Source so
      // exporting cannot invalidate the live texture's GPU upload version.
      proxy.source = new Source(source.source.data);
      const texture = new source.constructor().copy(proxy);
      textureCopies.set(source, texture);
      ownedTextures.add(texture);
    }
    return textureCopies.get(source);
  }

  function copyGeometry(source) {
    if (!geometryCopies.has(source)) {
      const geometry = ownGeometry(new BufferGeometry().copy(source));
      geometry.userData = metadataValue(source.userData) || {};
      geometryCopies.set(source, geometry);
    }
    return geometryCopies.get(source);
  }

  function glowTexture(corona = false) {
    const size = 64, data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const r = Math.hypot((x + 0.5) / size - 0.5, (y + 0.5) / size - 0.5) * (corona ? 3.6 : 2);
      const alpha = corona ? smoothstep(0.96, 1.04, r) * Math.exp(-Math.max(0, r - 1) * 9) * (1 - smoothstep(1.35, 1.8, r))
        : Math.exp(-r * r * 2.8) * (1 - smoothstep(0.6, 1, r));
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.round(alpha * 255);
    }
    const texture = new DataTexture(data, size, size, RGBAFormat);
    texture.name = corona ? "Solar corona radial approximation" : "Star radial approximation";
    texture.needsUpdate = true;
    ownedTextures.add(texture);
    return texture;
  }

  function copyMaterial(source, object) {
    if (Array.isArray(source)) return source.map(material => copyMaterial(material, object));
    if (!source) return ownMaterial(new MeshStandardMaterial({ color: 0x808080 }));
    if (materialCopies.has(source)) return materialCopies.get(source);
    let material;
    if (source.isMeshStandardMaterial || source.isMeshBasicMaterial) {
      // Material.copy JSON-serializes userData; a read-through proxy keeps it safe.
      const proxy = Object.create(source);
      proxy.userData = metadataValue(source.userData) || {};
      material = new source.constructor().copy(proxy);
      if (source.onBeforeCompile !== Material.prototype.onBeforeCompile) {
        note(object.name || source.name || object.type, "PBR maps and scalar values retained; browser onBeforeCompile shading (terrain blend, puddles, contact shade, grading) is not baked.");
      }
    } else if (source.isShaderMaterial || source.isRawShaderMaterial) {
      const name = `${source.name} ${object.name}`.toLowerCase();
      const sky = source.uniforms?.topColor && source.uniforms?.bottomColor;
      const mountains = name.includes("mountain");
      material = new MeshBasicMaterial({
        color: colorUniform(source, ["uColor", "color", "diffuse", "topColor"],
          name.includes("solar") ? 0xffaa50 : mountains ? 0x303c55 : 0x6a7390),
        vertexColors: Boolean(source.vertexColors || sky || mountains),
        side: source.side === BackSide ? DoubleSide : source.side,
      });
      if (sky || mountains) material.color.setRGB(1, 1, 1);
      if (name.includes("corona")) {
        material.map = glowTexture(true);
        material.transparent = true;
        material.opacity = 0.55;
      }
      note(object.name || source.name || object.type,
        sky ? "Sky shell retained with baked altitude gradient; cloud noise, nebula and sun scattering are approximated."
          : mountains ? "Camera-following ranges frozen at capture camera; vertex colors approximate haze, snow and moonlit shade."
            : "Shader replaced with an editable unlit material; animation, bloom and shader-only shading are approximated.");
    } else {
      material = source.isSpriteMaterial || source.isPointsMaterial
        ? new MeshBasicMaterial() : new MeshStandardMaterial({ roughness: 0.9, metalness: 0 });
      for (const key of ["color", "emissive", "normalScale"]) {
        if (material[key] && source[key]) material[key].copy(source[key]);
      }
      for (const key of ["map", "alphaMap", "normalMap", "emissiveMap", "aoMap", "lightMap", "opacity", "transparent", "alphaTest", "side", "vertexColors"]) {
        if (source[key] !== undefined && key in material) material[key] = source[key];
      }
      note(object.name || source.name || object.type, `${source.type} converted to ${material.type}; supported textures retained.`);
    }
    material.name = source.name || `${object.name || object.type} material`;
    material.userData = metadataValue(source.userData) || {};
    if (material.side === BackSide) material.side = DoubleSide;
    for (const key of Object.keys(material)) {
      if (material[key]?.isTexture) material[key] = copyTexture(material[key]);
    }
    materialCopies.set(source, ownMaterial(material));
    return material;
  }

  function shaderGeometry(source) {
    const material = source.material;
    if (Array.isArray(material) || !material?.isShaderMaterial) return copyGeometry(source.geometry);
    const isSky = material.uniforms?.topColor && material.uniforms?.bottomColor;
    const isMountain = material.name === "EstateMountains";
    const isProminence = material.name === "SolarProminences";
    if (!isSky && !isMountain && !isProminence) return copyGeometry(source.geometry);
    const geometry = ownGeometry(new BufferGeometry().copy(source.geometry));
    geometry.userData = {};
    const position = geometry.getAttribute("position"), color = new Float32Array(position.count * 3);
    const point = new Vector3(), sourceWorld = worldMatrix(source), inverseWorld = sourceWorld.clone().invert();
    const terrain = geometry.getAttribute("aTerrain");
    for (let i = 0; i < position.count; i++) {
      point.fromBufferAttribute(position, i);
      if (isSky) skyColor(point.clone().applyMatrix4(sourceWorld).normalize().y,
        material.uniforms.uFilm?.value > 0.5, material).toArray(color, i * 3);
      if (isMountain) {
        const layer = (terrain?.getY(i) || 0) / 3;
        const shade = terrain?.getZ(i) ?? 0.5;
        const tint = new Color().setRGB(0.06, 0.08, 0.12).lerp(new Color().setRGB(0.23, 0.28, 0.38), layer * 0.76);
        tint.multiplyScalar(0.7 + 0.3 * clamp(shade));
        const crest = terrain?.getW(i) || 0;
        const altitude = Math.atan2(point.y, Math.hypot(point.x, point.z)) * 180 / Math.PI;
        if (layer > 0 && crest > 9) tint.lerp(new Color().setRGB(0.40, 0.45, 0.56), smoothstep(crest * 0.66, crest * 0.9, altitude) * 0.72);
        tint.toArray(color, i * 3);
      }
      if (isProminence) {
        const worldPoint = point.clone().applyMatrix4(sourceWorld);
        const tangent = new Vector3().fromBufferAttribute(geometry.getAttribute("aTangent"), i).transformDirection(sourceWorld);
        const facing = cameraPosition.clone().sub(worldPoint).normalize();
        const side = new Vector3().crossVectors(tangent, facing).normalize();
        const distance = worldPoint.distanceTo(cameraPosition);
        const pixelWorld = camera.isPerspectiveCamera ? 2 * distance * Math.tan(camera.fov * Math.PI / 360) / viewportHeight : (camera.top - camera.bottom) / viewportHeight;
        worldPoint.addScaledVector(side, geometry.getAttribute("aSide").getX(i) * 1.1 * pixelWorld).applyMatrix4(inverseWorld);
        position.setXYZ(i, worldPoint.x, worldPoint.y, worldPoint.z);
      }
    }
    if (isSky || isMountain) geometry.setAttribute("color", new Float32BufferAttribute(color, 3));
    if (isProminence) geometry.computeVertexNormals();
    return geometry;
  }

  function pointMesh(source) {
    const geometry = source.geometry, material = source.material;
    const cosmic = material.uniforms?.uNebulaLayers?.value > 0.5 && material.uniforms?.uCelestialTier?.value > 0.5;
    const positions = (cosmic && geometry.getAttribute("aCelestialPosition")) || geometry.getAttribute("position");
    const first = geometry.drawRange.start, count = Math.max(0, Math.min(positions.count - first, geometry.drawRange.count));
    const colors = geometry.getAttribute("color"), sizes = geometry.getAttribute("aSize");
    const sourceWorld = worldMatrix(source), inverseWorld = sourceWorld.clone().invert();
    const right = new Vector3(1, 0, 0).applyQuaternion(viewRotation), up = new Vector3(0, 1, 0).applyQuaternion(viewRotation);
    const vertices = [], vertexColors = [], uv = [], indices = [];
    const baseColor = material.color || new Color(1, 1, 1);
    for (let i = first; i < first + count; i++) {
      const index = geometry.index ? geometry.index.getX(i) : i;
      const local = new Vector3().fromBufferAttribute(positions, index), center = local.clone().applyMatrix4(sourceWorld);
      const distance = center.distanceTo(cameraPosition);
      const pixels = sizes?.getX(index) || material.size || 1.5;
      const width = camera.isPerspectiveCamera ? 2 * distance * Math.tan(camera.fov * Math.PI / 360) / viewportHeight * pixels : (camera.top - camera.bottom) / viewportHeight * pixels;
      const color = colors ? new Color().fromBufferAttribute(colors, index) : baseColor.clone();
      color.multiplyScalar((material.uniforms?.uVisibility?.value ?? 1) * (cosmic ? smoothstep(0.015, 0.36, local.y / 180) : 1));
      const base = vertices.length / 3;
      for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        center.clone().addScaledVector(right, x * width / 2).addScaledVector(up, y * width / 2).applyMatrix4(inverseWorld).toArray(vertices, vertices.length);
        color.toArray(vertexColors, vertexColors.length);
        uv.push((x + 1) / 2, (y + 1) / 2);
      }
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    const baked = ownGeometry(new BufferGeometry());
    baked.setAttribute("position", new Float32BufferAttribute(vertices, 3));
    baked.setAttribute("color", new Float32BufferAttribute(vertexColors, 3));
    baked.setAttribute("uv", new Float32BufferAttribute(uv, 2));
    baked.setIndex(indices);
    baked.computeVertexNormals();
    const bakedMaterial = ownMaterial(new MeshBasicMaterial({ name: `${source.name} baked points`, map: glowTexture(),
      vertexColors: true, transparent: true, side: DoubleSide, depthWrite: false }));
    note(source.name || "Points", `${count} visible points frozen as camera-facing quads; current quality draw range and celestial positions retained, twinkle/dust/bloom approximated.`);
    return new Mesh(baked, bakedMaterial);
  }

  function cloneNode(source, parentWorld = new Matrix4()) {
    if (!source.visible) return null;
    const currentWorld = parentWorld.clone().multiply(localMatrix(source));
    let target;
    if (source.isInstancedMesh) {
      target = new Group();
      const geometry = copyGeometry(source.geometry), material = copyMaterial(source.material, source);
      for (let i = 0; i < source.count; i++) {
        let instanceMaterial = material;
        if (source.instanceColor) {
          const color = new Color(); source.getColorAt(i, color);
          instanceMaterial = (Array.isArray(material) ? material : [material]).map(base => {
            const variant = ownMaterial(base.clone()); variant.color.multiply(color); return variant;
          });
          if (!Array.isArray(material)) instanceMaterial = instanceMaterial[0];
        }
        const instance = new Mesh(geometry, instanceMaterial);
        instance.name = `${source.name || "Instance"} ${String(i + 1).padStart(4, "0")}`;
        const matrix = new Matrix4(); source.getMatrixAt(i, matrix); setMatrix(instance, matrix);
        instance.userData = { sourceInstance: i };
        target.add(instance);
      }
    } else if (source.isPoints) target = pointMesh(source);
    else if (source.isSprite) {
      const geometry = ownGeometry(new PlaneGeometry(1, 1));
      geometry.translate(0.5 - source.center.x, 0.5 - source.center.y, 0);
      target = new Mesh(geometry, copyMaterial(source.material, source));
      const scale = new Vector3().setFromMatrixScale(currentWorld), position = new Vector3().setFromMatrixPosition(currentWorld);
      const rotation = viewRotation.clone().multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), source.material.rotation || 0));
      setMatrix(target, parentWorld.clone().invert().multiply(new Matrix4().compose(position, rotation, scale)));
      note(source.name || "Sprite", "Sprite frozen as a textured plane facing the capture camera.");
    } else if (source.isMesh) target = new Mesh(shaderGeometry(source), copyMaterial(source.material, source));
    else if (source.isCamera) {
      const proxy = Object.create(source); proxy.userData = {};
      target = new source.constructor().copy(proxy, false);
      // glTF cameras carry a symmetric lens only. Keep the captured projection
      // explicitly: cinematic fitting writes off-axis shifts directly into it.
      target.userData.babelCameraProjection = {
        matrix: source.projectionMatrix.toArray(), aspect: source.aspect ?? null,
        viewport: { width: viewport.width || null, height: viewport.height || null },
      };
      note(source.name || source.type, "glTF cannot encode off-axis lens framing. Restore the captured projection from babelCameraProjection/report.camera.projectionMatrix in Blender; with VERTICAL sensor fit use shift_x = matrix[8] * aspect / 2 and shift_y = matrix[9] / 2.");
    } else if (source.isLight) {
      const light = { name: source.name || source.type, type: source.type, color: source.color.toArray(),
        intensity: source.intensity, groundColor: source.groundColor?.toArray() ?? null, worldMatrix: currentWorld.toArray(),
        distance: source.distance ?? null, decay: source.decay ?? null, castShadow: Boolean(source.castShadow) };
      report.lights.push(light);
      if (source.isDirectionalLight || source.isPointLight || source.isSpotLight) {
        target = new source.constructor();
        target.color.copy(source.color); target.intensity = source.intensity;
        target.castShadow = Boolean(source.castShadow);
        for (const key of ["distance", "decay", "angle", "penumbra"]) if (key in source) target[key] = source[key];
        if (source.target) {
          const position = new Vector3().setFromMatrixPosition(currentWorld);
          const targetPosition = new Vector3().setFromMatrixPosition(worldMatrix(source.target));
          const rotation = new Matrix4().lookAt(position, targetPosition, source.up);
          rotation.setPosition(position);
          setMatrix(target, parentWorld.clone().invert().multiply(rotation));
          target.target = new Object3D(); target.target.position.z = -1; target.add(target.target);
        }
      } else {
        target = new Group();
        note(light.name, `${source.type} retained as an editable metadata marker and in report.lights; recreate with Blender world lighting.`);
      }
      target.userData.babelLight = light;
    } else target = new Group();
    if (!source.isSprite && !(source.isLight && source.target)) setMatrix(target, localMatrix(source));
    if (source.material?.name === "EstateMountains") {
      // Its vertex shader ignores modelMatrix and follows cameraPosition.
      setMatrix(target, parentWorld.clone().invert().multiply(new Matrix4().makeTranslation(...cameraPosition.toArray())));
    }
    target.name = source.name || (source.material?.uniforms?.topColor ? "estate-sky-shell" : source.type);
    target.userData = { ...(metadataValue(source.userData) || {}), ...target.userData,
      babelSourceType: source.type, babelSourceName: source.name || "" };
    nodes.set(source, target);
    const record = { name: target.name, sourceType: source.type, exportedType: target.type,
      instances: source.isInstancedMesh ? source.count : undefined, worldMatrix: currentWorld.toArray() };
    records.set(source, record);
    report.objects.push(record);
    for (const child of source.children) {
      const copy = cloneNode(child, currentWorld); if (copy) target.add(copy);
    }
    return target;
  }

  const snapshot = new Scene(); snapshot.name = "alexnava.me editable snapshot";
  snapshot.userData = { babelSnapshot: report.format, ...report.metadata };
  const sceneRoot = cloneNode(sourceScene, sourceScene.parent ? worldMatrix(sourceScene.parent) : new Matrix4());
  if (sceneRoot) { setMatrix(sceneRoot, worldMatrix(sourceScene)); snapshot.add(sceneRoot); }
  if (!nodes.has(camera)) {
    const copy = cloneNode(camera, camera.parent ? worldMatrix(camera.parent) : new Matrix4());
    if (copy) { setMatrix(copy, viewWorld); snapshot.add(copy); }
  }
  snapshot.updateMatrixWorld(true);
  nodes.forEach((target, source) => { records.get(source).exportedWorldMatrix = target.matrixWorld.toArray(); });
  report.camera = { name: nodes.get(camera)?.name, type: camera.type, worldMatrix: viewWorld.toArray(),
    projectionMatrix: camera.projectionMatrix.toArray(),
    fov: camera.fov ?? null, aspect: camera.aspect ?? null, near: camera.near, far: camera.far,
    viewport: { width: viewport.width || null, height: viewport.height || null } };
  report.counts = { sourceObjects: report.objects.length, exportedObjects: 0, meshes: 0, triangles: 0,
    geometries: ownedGeometry.size, materials: ownedMaterials.size, textures: ownedTextures.size };
  snapshot.traverse(object => {
    report.counts.exportedObjects++;
    if (object.isMesh) {
      report.counts.meshes++;
      const geometry = object.geometry;
      report.counts.triangles += Math.min(geometry.drawRange.count, geometry.index?.count ?? geometry.attributes.position?.count ?? 0) / 3;
    }
  });
  note("Scene environment", "Browser fog, world lighting, tone mapping, color management, postprocessing and camera transitions require Blender approximation; geometry and active camera are retained.");
  let disposed = false;
  return { scene: snapshot, report, dispose() {
    if (disposed) return false;
    disposed = true;
    ownedGeometry.forEach(geometry => geometry.dispose());
    ownedMaterials.forEach(material => material.dispose());
    ownedTextures.forEach(texture => texture.dispose());
    snapshot.clear();
    return true;
  } };
}

export async function exportBlenderSnapshot({ location = globalThis.location, filename = "alexnava-lantern-study", download = false, ...options }) {
  if (!isBlenderExportAllowed(location)) throw new Error("Blender export requires localhost and ?sceneDebug=1.");
  const snapshot = createBlenderSnapshot(options);
  try {
    const arrayBuffer = await new GLTFExporter().parseAsync(snapshot.scene, {
      binary: true, onlyVisible: true, trs: false, maxTextureSize: Infinity,
    });
    const blob = new Blob([arrayBuffer], { type: "model/gltf-binary" });
    const report = snapshot.report;
    report.byteLength = arrayBuffer.byteLength;
    const reportBlob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    if (download) {
      for (const [file, content] of [[`${filename}.glb`, blob], [`${filename}.json`, reportBlob]]) {
        const url = URL.createObjectURL(content), anchor = document.createElement("a");
        anchor.href = url; anchor.download = file; anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    }
    return { arrayBuffer, blob, report, reportBlob };
  } finally { snapshot.dispose(); }
}
