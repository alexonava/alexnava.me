import assert from "node:assert/strict";
import test, { after } from "node:test";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileP = promisify(execFile);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scratchRoot = path.join(projectRoot, ".tmp-preview-review");
await mkdir(scratchRoot, { recursive: true });
const bundleScratch = await mkdtemp(path.join(scratchRoot, "bundle-output-"));
const distDir = path.join(bundleScratch, "dist");
const scriptsDir = path.join(distDir, "scripts");

after(async () => {
  assert.equal(path.dirname(path.resolve(bundleScratch)), scratchRoot);
  await rm(bundleScratch, { recursive: true, force: true });
});
await execFileP(process.execPath, ["build.mjs", "--dist", "--outdir", distDir], { cwd: projectRoot });

// The entry itself (app.HASH.js / scene.HASH.js), not one of its chunks.
async function findHashedScript(prefix) {
  const entries = await readdir(scriptsDir);
  const pattern = new RegExp(`^${prefix}\\.[a-f0-9]{8}\\.js$`);
  const matches = entries.filter((name) => pattern.test(name));
  if (matches.length !== 1) throw new Error(`expected one ${prefix}.HASH.js in ${scriptsDir}`);
  return path.join(scriptsDir, matches[0]);
}

// Chunks a module names in static import/export-from statements (downloaded
// with it) and in dynamic import() calls (downloaded on demand).
function chunkImports(text) {
  const named = (pattern) => [...text.matchAll(pattern)].map((match) => match[1]);
  return {
    static: named(/(?:\bimport\s*(?:[\w$*{][^;()"'`]*?\bfrom\s*)?|\bexport\s*\{[^}]*\}\s*from\s*)["']\.\/([^"']+)["']/g),
    dynamic: named(/\bimport\(\s*["']\.\/([^"']+)["']\s*\)/g),
  };
}

// Everything a default visitor's scene load fetches: the entry named by the
// page plus every chunk reachable through static imports. Lazily imported
// chunks (the ?sceneDebug=1 developer tools) are listed separately.
async function sceneScripts() {
  const entry = path.basename(await findHashedScript("scene"));
  const loaded = new Map();
  const lazy = new Set();
  const pending = [entry];
  while (pending.length) {
    const name = pending.pop();
    if (loaded.has(name)) continue;
    const text = await readFile(path.join(scriptsDir, name), "utf8");
    loaded.set(name, text);
    const imports = chunkImports(text);
    pending.push(...imports.static);
    imports.dynamic.forEach((chunk) => lazy.add(chunk));
  }
  for (const name of loaded.keys()) lazy.delete(name);
  return { entry, loaded, lazy: [...lazy] };
}

async function readSceneStatic() {
  return [...(await sceneScripts()).loaded.values()].join("\n");
}

test("UI bundle stays under the LCP budget", async () => {
  const file = await findHashedScript("app");
  const { size } = await stat(file);
  const kb = size / 1024;
  assert.ok(kb < 30, `app bundle is ${kb.toFixed(1)} kB; budget is 30 kB`);
});

test("scene bundle stays under the deferred-payload budget", async () => {
  // The budget covers every byte a default visitor's scene load downloads:
  // the entry and each chunk it imports statically. The ?sceneDebug=1
  // developer tools (developer camera + OutlinePass) and the film's rock
  // placement load on demand only. The owner raised the limit from 810 KiB to
  // 820 KiB on 2026-09-24 for the slate v2 ground and rocks.
  const { loaded } = await sceneScripts();
  // The exporter's additional lazy consumer separates the existing Pass base
  // classes from the shared Three.js core. There is still one copy of Three.
  assert.equal(loaded.size, 3, `scene loads ${[...loaded.keys()]}`);
  let bytes = 0;
  for (const name of loaded.keys()) bytes += (await stat(path.join(scriptsDir, name))).size;
  const kb = bytes / 1024;
  assert.ok(
    kb < 820,
    `scene bundle (${[...loaded.keys()].join(" + ")}) is ${kb.toFixed(1)} kB; budget is 820 kB`,
  );
});

test("developer tools are a lazy scene chunk that default visitors never download", async () => {
  const { entry, loaded, lazy } = await sceneScripts();
  // Optional effects and owner tools remain outside the initial static code.
  assert.deepEqual(
    lazy.map((name) => name.replace(/\.[a-f0-9]{8}\.js$/, "")).sort(),
    ["scene.blender-export", "scene.developer-tools", "scene.lantern-flame", "scene.light-shafts", "scene.mountain-build", "scene.rock-build", "scene.terrain-build"],
  );
  const developerName = lazy.find((name) => name.startsWith("scene.developer-tools."));
  const developer = await readFile(path.join(scriptsDir, developerName), "utf8");
  const statics = [...loaded.values()].join("\n");
  // Markers that survive minification: the developer HUD id and an OutlinePass method.
  for (const marker of [/dev-mode-hud/, /changeVisibilityOfSelectedObjects/, /Backquote/]) {
    assert.match(developer, marker);
    assert.doesNotMatch(statics, marker, `${marker} leaked into the visitor scene payload`);
  }
  assert.match(loaded.get(entry), new RegExp(`import\\(\\s*"\\./${developerName.replaceAll(".", "\\.")}"\\s*\\)`));
  // The lazy chunk reuses the visitor's Three.js instead of carrying a copy.
  const threeMarker = "Multiple instances of Three.js being imported";
  assert.ok(!developer.includes(threeMarker), "Three.js is duplicated in the developer chunk");
  assert.equal(statics.split(threeMarker).length - 1, 1, "Three.js ships exactly once");
  for (const chunk of chunkImports(developer).static) {
    assert.ok(loaded.has(chunk), `developer tools import ${chunk}, which visitors do not load`);
  }
  // A statically imported chunk evaluates before the entry's ordered imports
  // (scene-entry.js), so it must carry no first-party BabelSite registration.
  for (const [name, text] of loaded) {
    if (name !== entry) {
      assert.doesNotMatch(text, /BabelSite/, `${name} carries ordered scene side effects`);
    }
  }
});

test("the optional lantern flame shader stays in its own lazy chunk", async () => {
  const { loaded, lazy } = await sceneScripts();
  const flameName = lazy.find((name) => name.startsWith("scene.lantern-flame."));
  assert.ok(flameName);
  const flame = await readFile(path.join(scriptsDir, flameName), "utf8");
  const statics = [...loaded.values()].join("\n");
  const app = await readFile(await findHashedScript("app"), "utf8");
  assert.match(flame, /lanternFire/);
  assert.doesNotMatch(statics, /lanternFire/);
  assert.doesNotMatch(app, /lantern-flame/);
  for (const dependency of chunkImports(flame).static)
    assert.ok(loaded.has(dependency), "flame reuses the already loaded Three.js instance");
});

test("Blender export and GLTFExporter stay exclusively in the explicit local action's lazy chunk", async () => {
  const { entry, loaded, lazy } = await sceneScripts();
  const exporterName = lazy.find((name) => name.startsWith("scene.blender-export."));
  assert.ok(exporterName, "the editable scene exporter has its own hashed lazy chunk");
  const exporter = await readFile(path.join(scriptsDir, exporterName), "utf8");
  const app = await readFile(await findHashedScript("app"), "utf8");
  const statics = [...loaded.values()].join("\n");
  for (const marker of [/THREE\.GLTFExporter/, /babel-blender-snapshot-v1/, /Blender export requires localhost/]) {
    assert.match(exporter, marker);
    assert.doesNotMatch(statics, marker, `${marker} leaked into the default scene payload`);
    assert.doesNotMatch(app, marker, `${marker} leaked into the UI payload`);
  }
  assert.ok(!app.includes(exporterName), "the UI must not preload the export module");
  assert.match(loaded.get(entry), new RegExp(`import\\(\\s*"\\./${exporterName.replaceAll(".", "\\.")}"\\s*\\)`));
  assert.ok(!exporter.includes("Multiple instances of Three.js being imported"), "the exporter reuses Three.js");
  for (const dependency of chunkImports(exporter).static) {
    assert.ok(loaded.has(dependency), `exporter imports a separate Three.js dependency: ${dependency}`);
  }
  const source = await readFile(path.join(projectRoot, "src", "scene", "index.js"), "utf8");
  assert.match(source, /if \(qualityControls\.debug && \["localhost", "127\.0\.0\.1", "\[::1\]"\]\.includes\(window\.location\.hostname\)\)/);
  assert.match(source, /scene\.exportBlenderSnapshot = async \(options = \{\}\) => \{[\s\S]*?await import\("\.\/blender-export\.js"\)/);
});

test("the film's rock placement is a lazy chunk that imports nothing", async () => {
  const { entry, loaded, lazy } = await sceneScripts();
  const rockName = lazy.find((name) => name.startsWith("scene.rock-build."));
  const rocks = await readFile(path.join(scriptsDir, rockName), "utf8");
  const statics = [...loaded.values()].join("\n");
  // Its Three.js classes and first-party helpers arrive as arguments, so it
  // neither splits the shared chunk nor pulls scene modules into it.
  assert.deepEqual(chunkImports(rocks), { static: [], dynamic: [] });
  assert.match(rocks, /film-rocks/);
  assert.doesNotMatch(statics, /film-rocks/, "rock placement leaked into the visitor scene payload");
  assert.match(loaded.get(entry), new RegExp(`import\\(\\s*"\\./${rockName.replaceAll(".", "\\.")}"\\s*\\)`));
});

test("the film's light shafts are a lazy chunk outside the visitor payload", async () => {
  const { entry, loaded, lazy } = await sceneScripts();
  const shaftsName = lazy.find((name) => name.startsWith("scene.light-shafts."));
  assert.ok(shaftsName, "the light shafts have their own hashed lazy chunk");
  const shafts = await readFile(path.join(scriptsDir, shaftsName), "utf8");
  const statics = [...loaded.values()].join("\n");
  const app = await readFile(await findHashedScript("app"), "utf8");
  // Markers that survive minification and GLSL compaction: the march, the
  // box material's name and the subjects' program key suffix.
  for (const marker of [/shaftMarch/, /LightShafts/, /light-shafts-/]) {
    assert.match(shafts, marker);
    assert.doesNotMatch(statics, marker, `${marker} leaked into the visitor scene payload`);
    assert.doesNotMatch(app, marker, `${marker} leaked into the UI payload`);
  }
  // The entry imports it on demand and nothing preloads it.
  assert.match(loaded.get(entry), new RegExp(`import\\(\\s*"\\./${shaftsName.replaceAll(".", "\\.")}"\\s*\\)`));
  assert.ok(!app.includes(shaftsName), "the UI must not preload the light shafts");
  // It reuses the visitor's Three.js and carries no first-party modules.
  assert.ok(!shafts.includes("Multiple instances of Three.js being imported"), "Three.js is duplicated in the light shafts");
  assert.deepEqual(chunkImports(shafts).dynamic, []);
  for (const dependency of chunkImports(shafts).static) {
    assert.ok(loaded.has(dependency), `the light shafts import ${dependency}, which visitors do not load`);
  }
  assert.doesNotMatch(shafts, /initHomeScene/);
});

test("the film mountains' generator is a lazy chunk that imports only Three.js", async () => {
  const { entry, loaded, lazy } = await sceneScripts();
  const mountainName = lazy.find((name) => name.startsWith("scene.mountain-build."));
  assert.ok(mountainName, "the film ranges have their own hashed lazy chunk");
  const mountains = await readFile(path.join(scriptsDir, mountainName), "utf8");
  const statics = [...loaded.values()].join("\n");
  const app = await readFile(await findHashedScript("app"), "utf8");
  // Markers that survive minification: the generator's hash constant (0x9e3779b1,
  // shared by no other scene module) and its ring and row constants.
  for (const marker of [/2654435761|0x9e3779b1|-1640531535/, /15485863/, /104729/]) {
    assert.match(mountains, marker);
    assert.doesNotMatch(statics, marker, `${marker} leaked into the visitor scene payload`);
    assert.doesNotMatch(app, marker, `${marker} leaked into the UI payload`);
  }
  // The entry keeps the ranges' material and requests the chunk on demand;
  // nothing preloads it.
  assert.match(statics, /EstateMountains/);
  assert.match(loaded.get(entry), new RegExp(`import\\(\\s*"\\./${mountainName.replaceAll(".", "\\.")}"\\s*\\)`));
  assert.ok(!app.includes(mountainName), "the UI must not preload the mountains");
  // It reuses the visitor's Three.js through the shared chunk and carries no
  // first-party scene module or further chunk.
  assert.ok(!mountains.includes("Multiple instances of Three.js being imported"), "Three.js is duplicated in the mountain chunk");
  assert.deepEqual(chunkImports(mountains).dynamic, []);
  const statically = chunkImports(mountains).static;
  assert.ok(statically.length >= 1);
  for (const dependency of statically)
    assert.ok(loaded.has(dependency) && dependency.startsWith("scene.shared."), `the mountains import ${dependency}`);
  assert.doesNotMatch(mountains, /BabelSite|initHomeScene|EstateMountains/);
});

test("the UI names exactly the scene entry's static chunks for modulepreload", async () => {
  const app = await readFile(await findHashedScript("app"), "utf8");
  const { entry, loaded, lazy } = await sceneScripts();
  const named = new Set(app.match(/\/scripts\/scene\.[\w.-]+\.js/g) ?? []);
  const statics = [...loaded.keys()].filter((name) => name !== entry);
  assert.ok(statics.length >= 1, "the shared Three.js chunk is a static import");
  assert.deepEqual([...named].sort(), statics.map((name) => `/scripts/${name}`).sort());
  // The page names the entry; the developer chunk is never preloaded.
  for (const name of [entry, ...lazy]) assert.ok(!app.includes(name), `${name} is named by the UI`);
  assert.match(app, /modulepreload/);
});

test("every published script is named for the hash of its bytes under an immutable prefix", async () => {
  const names = await readdir(scriptsDir);
  const scene = names.filter((name) => name.startsWith("scene."));
  assert.ok(scene.length >= 2, "the scene entry and its chunks are published");
  for (const name of names) {
    // _headers marks /scripts/app.*.js and /scripts/scene.*.js immutable.
    assert.match(name, /^(?:app|scene)\.(?:[a-z][a-z-]*\.)?[a-f0-9]{8}\.js$/);
    const bytes = await readFile(path.join(scriptsDir, name));
    const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 8);
    assert.ok(name.endsWith(`.${hash}.js`), `${name} must fingerprint its emitted bytes`);
  }
  for (const name of scene) {
    const { static: statics, dynamic } = chunkImports(await readFile(path.join(scriptsDir, name), "utf8"));
    for (const chunk of [...statics, ...dynamic]) {
      assert.ok(scene.includes(chunk), `${name} imports unpublished ${chunk}`);
    }
  }
});

test("Three.js does not leak into the UI bundle", async () => {
  const file = await findHashedScript("app");
  const text = await readFile(file, "utf8");
  // GLSL fragments are string literals in three.js shader chunks and survive
  // minification — their presence in the UI bundle means the split regressed.
  assert.doesNotMatch(text, /gl_Position/, "app bundle contains Three.js GLSL");
});

test("authored material requests stay inside the deferred scene bundle", async () => {
  const app = await readFile(await findHashedScript("app"), "utf8");
  const scene = await readSceneStatic();
  assert.doesNotMatch(app, /images\/materials\/stone-/);
  assert.match(scene, /images\/materials\/stone-/);
  assert.doesNotMatch(app, /images\/materials\/ground-/);
  assert.match(scene, /images\/materials\/ground-/);
});

test("authored material pairs fit transfer budgets and are copied intact into dist", async () => {
  for (const [prefix, kinds, budgets] of [
    ["stone", ["color", "roughness"], { 1024: 750 * 1024, 512: 256 * 1024 }],
    ["ground", ["color", "normal"], { 1024: 640 * 1024, 512: 224 * 1024 }],
  ]) {
    for (const [size, budget] of Object.entries(budgets)) {
      let bytes = 0;
      for (const kind of kinds) {
        const relative = path.join("images", "materials", `${prefix}-${kind}-${size}.webp`);
        const source = await readFile(path.join(projectRoot, relative));
        const published = await readFile(path.join(distDir, relative));
        assert.ok(source.length > 0);
        assert.equal(source.toString("ascii", 8, 12), "WEBP", `${relative} must be WebP`);
        assert.deepEqual(published, source);
        bytes += source.length;
      }
      assert.ok(bytes <= budget, `${size} ${prefix} pair is ${bytes} bytes; budget ${budget}`);
    }
  }
});

test("construction geometry requests and BRK1 decoder stay inside the deferred scene bundle", async () => {
  const app = await readFile(await findHashedScript("app"), "utf8");
  const scene = await readSceneStatic();
  for (const marker of [
    /images\/materials\/stone-brick\.bin/,
    /images\/materials\/stone-tread\.bin/,
    /Invalid BRK1 brick geometry/,
  ]) {
    assert.doesNotMatch(app, marker, "geometry loading or decoding leaked into the UI bundle");
    assert.match(scene, marker, "deferred scene is missing a geometry loader or decoder");
  }
});

test("shared brick and tread fit the combined detail transfer budgets", async () => {
  const relative = path.join("images", "materials", "stone-brick.bin");
  const source = await readFile(path.join(projectRoot, relative));
  const published = await readFile(path.join(distDir, relative));
  assert.equal(source.toString("ascii", 0, 4), "BRK1");
  assert.ok(
    source.length > 8 && source.length < 48 * 1024,
    `brick binary is ${source.length} bytes`,
  );
  assert.deepEqual(published, source);
  const treadBytes = (await stat(path.join(distDir, "images", "materials", "stone-tread.bin")))
    .size;

  for (const [size, budget] of [
    [1024, 750 * 1024],
    [512, 256 * 1024],
  ]) {
    let bytes = source.length + treadBytes;
    for (const kind of ["color", "roughness"]) {
      const map = path.join(distDir, "images", "materials", `stone-${kind}-${size}.webp`);
      bytes += (await stat(map)).size;
    }
    assert.ok(
      bytes <= budget,
      `${size} maps plus shared brick and tread are ${bytes} bytes; budget ${budget}`,
    );
  }
});

test("the shared tread is at most 200 triangles and crown reuse adds no geometry asset", async () => {
  const relative = path.join("images", "materials", "stone-tread.bin");
  const source = await readFile(path.join(projectRoot, relative));
  assert.ok(source.length >= 8 && source.length <= 9608, `tread is ${source.length} bytes`);
  assert.equal(source.toString("ascii", 0, 4), "BRK1");
  const vertices = source.readUInt32LE(4);
  assert.ok(
    vertices > 0 && vertices % 3 === 0 && vertices <= 600,
    `${vertices / 3} tread triangles`,
  );
  assert.equal(source.length, 8 + vertices * 16, "BRK1 attributes must match the vertex count");
  assert.deepEqual(await readFile(path.join(distDir, relative)), source);
  const binaries = (await readdir(path.join(distDir, "images", "materials"))).filter((name) =>
    /\.(bin|glb|gltf)$/i.test(name),
  );
  assert.deepEqual(binaries.sort(), ["stone-brick.bin", "stone-tread.bin"]);
});

test("published responsive posters use content hashes and retain intact compatibility copies", async () => {
  const html = await readFile(path.join(distDir, "index.html"), "utf8");
  const expectedNames = [];
  for (const [orientation, attribute] of [
    ["landscape", "src"],
    ["portrait", "srcset"],
  ]) {
    const stableName = `scene-poster-${orientation}.webp`;
    const source = await readFile(path.join(projectRoot, "images", stableName));
    const hash = createHash("sha256").update(source).digest("hex").slice(0, 8);
    const hashedName = `scene-poster-${orientation}.${hash}.webp`;
    expectedNames.push(hashedName);
    assert.ok(html.includes(`${attribute}="/images/${hashedName}"`), "first paint references the current responsive poster hash");
    assert.deepEqual(await readFile(path.join(distDir, "images", hashedName)), source);
    assert.deepEqual(await readFile(path.join(distDir, "images", stableName)), source);
  }
  const emittedNames = (await readdir(path.join(distDir, "images"))).filter((name) =>
    /^scene-poster-(landscape|portrait)\.[a-f0-9]{8}\.webp$/.test(name),
  );
  assert.deepEqual(emittedNames.sort(), expectedNames.sort());
  assert.doesNotMatch(html, /\/images\/scene-poster-(landscape|portrait)\.webp/);
});

test("the build refuses a shared scene chunk that would carry first-party modules", async () => {
  const fixture = await mkdtemp(path.join(scratchRoot, "shared-chunk-build-"));
  try {
    // The sanitized static payload supplies the model files the manifest reads.
    await cp(distDir, fixture, { recursive: true });
    await cp(path.join(projectRoot, "build.mjs"), path.join(fixture, "build.mjs"));
    await cp(path.join(projectRoot, "tools"), path.join(fixture, "tools"), { recursive: true });
    await mkdir(path.join(fixture, "src"));
    await writeFile(path.join(fixture, "src", "app.js"), "void 0;");
    // A lazily imported module that shares a registration with the entry moves
    // it into a chunk that would evaluate before the entry's ordered imports.
    await writeFile(path.join(fixture, "src", "helpers.js"), "globalThis.BabelSite = { scene: {} };");
    await writeFile(path.join(fixture, "src", "tools.js"), 'import "./helpers.js";');
    await writeFile(
      path.join(fixture, "src", "scene-entry.js"),
      'import "./helpers.js";\nif (globalThis.debug) import("./tools.js");',
    );
    await assert.rejects(
      execFileP(process.execPath, ["build.mjs", "--check"], { cwd: fixture }),
      (error) => /Shared scene chunk would reorder side-effect modules: src\/helpers\.js/.test(error.stderr),
    );
    // Without the shared registration the same layout builds.
    await writeFile(path.join(fixture, "src", "tools.js"), "export const tools = 1;");
    await execFileP(process.execPath, ["build.mjs", "--check"], { cwd: fixture });
  } finally {
    assert.equal(path.dirname(path.resolve(fixture)), scratchRoot);
    await rm(fixture, { recursive: true, force: true });
  }
});

test("changing only fixture poster bytes changes only that poster URL", async () => {
  const scratchRoot = path.join(projectRoot, ".tmp-preview-review");
  await mkdir(scratchRoot, { recursive: true });
  const fixture = await mkdtemp(path.join(scratchRoot, "poster-build-"));
  const sourcePath = path.join(projectRoot, "images", "scene-poster-landscape.webp");
  const sourceBefore = await readFile(sourcePath);
  try {
    // Reuse the sanitized static payload; only the actual build script and its
    // unrewritten HTML/CSS inputs are copied from source. No user data or deps.
    await cp(distDir, fixture, { recursive: true });
    for (const file of ["build.mjs", "index.html", "404.html", "styles.css", "site-agents.md"]) {
      await cp(path.join(projectRoot, file), path.join(fixture, file));
    }
    await cp(path.join(projectRoot, "tools"), path.join(fixture, "tools"), { recursive: true });
    await mkdir(path.join(fixture, "src"));
    await writeFile(path.join(fixture, "src", "app.js"), "void 0;");
    await writeFile(path.join(fixture, "src", "scene-entry.js"), "void 0;");
    async function posterUrls() {
      await execFileP(process.execPath, ["build.mjs", "--dist", "--outdir", path.join(fixture, "dist")], { cwd: fixture });
      const html = await readFile(path.join(fixture, "dist", "index.html"), "utf8");
      return Object.fromEntries(
        ["landscape", "portrait"].map((orientation) => [
          orientation,
          html.match(new RegExp(`/images/scene-poster-${orientation}\\.[a-f0-9]{8}\\.webp`))?.[0],
        ]),
      );
    }
    const before = await posterUrls();
    assert.ok(before.landscape && before.portrait);
    const changed = Buffer.concat([sourceBefore, Buffer.from("fixture-only-poster-change")]);
    await writeFile(path.join(fixture, "images", "scene-poster-landscape.webp"), changed);
    const after = await posterUrls();
    const changedHash = createHash("sha256").update(changed).digest("hex").slice(0, 8);
    assert.equal(after.landscape, `/images/scene-poster-landscape.${changedHash}.webp`);
    assert.notEqual(after.landscape, before.landscape);
    assert.equal(after.portrait, before.portrait);
    assert.deepEqual(await readFile(sourcePath), sourceBefore, "tracked poster must not change");
  } finally {
    assert.equal(path.dirname(path.resolve(fixture)), scratchRoot);
    await rm(fixture, { recursive: true, force: true });
  }
});

test("architecture stays deferred and each selected model fits both tier budgets", async () => {
  const app = await readFile(await findHashedScript("app"), "utf8");
  const scene = await readSceneStatic();
  // The hashed model manifest lives in the entry, so a model revision changes
  // only the entry's URL and never the shared Three.js chunk's.
  const { entry, loaded } = await sceneScripts();
  const manifestUrl = /\/images\/architecture\/tower-high\.[a-f0-9]{8}\.glb/;
  assert.match(loaded.get(entry), manifestUrl);
  for (const [name, text] of loaded) {
    if (name !== entry) assert.doesNotMatch(text, /\/images\/architecture\//, name);
  }
  // The UI names the hashed models only to request them early; loading and
  // validation stay in the scene bundle.
  assert.doesNotMatch(app, /Invalid architecture GLB header/);
  assert.match(scene, /Invalid architecture GLB header/);
  for (const [tier, limit] of [
    ["high", 6 * 1024 * 1024],
    ["balanced", 3 * 1024 * 1024],
  ]) {
    const bytesByRole = {};
    for (const role of ["stairs", "wall", "base", "crown", "tower", "tree"]) {
      const name = role + "-" + tier + ".glb";
      const source = await readFile(path.join(projectRoot, "images", "architecture", name));
      const hash = createHash("sha256").update(source).digest("hex").slice(0, 8);
      const hashedName = role + "-" + tier + "." + hash + ".glb";
      assert.deepEqual(
        await readFile(path.join(distDir, "images", "architecture", hashedName)),
        source,
      );
      assert.ok(
        scene.includes("/images/architecture/" + hashedName),
        "scene must request the current fingerprint",
      );
      assert.equal(
        app.includes("/images/architecture/" + hashedName),
        role === "tower" || role === "tree",
        "the UI names the current fingerprint of only the models it requests early",
      );
      assert.equal(source.toString("ascii", 0, 4), "glTF");
      assert.equal(source.readUInt32LE(8), source.length);
      const gltf = JSON.parse(source.toString("utf8", 20, 20 + source.readUInt32LE(12)));
      assert.equal(gltf.meshes.length, 1, name + " should have one shared mesh");
      assert.equal(gltf.meshes[0].primitives.length, 1, name + " should have one shared material");
      assert.ok(gltf.images.length > 0, name + " must retain source surface detail");
      for (const resource of [...gltf.images, ...gltf.buffers])
        assert.equal(resource.uri, undefined);
      assert.equal(gltf.animations?.length || 0, 0);
      const primitive = gltf.meshes[0].primitives[0];
      assert.equal(primitive.mode ?? 4, 4, "triangle topology required");
      for (const semantic of ["POSITION", "NORMAL", "TEXCOORD_0"])
        assert.ok(Number.isInteger(primitive.attributes[semantic]));
      bytesByRole[role] = source.length;
    }
    // The authored ground pair loads alongside either supplied model set.
    const groundSize = tier === "high" ? 1024 : 512;
    let groundBytes = 0;
    for (const kind of ["color", "normal"]) {
      const file = path.join(projectRoot, "images", "materials", `ground-${kind}-${groundSize}.webp`);
      groundBytes += (await stat(file)).size;
    }
    for (const [model, roles] of Object.entries({
      assembled: ["stairs", "wall", "base", "crown", "tree"],
      complete: ["tower", "tree"],
    })) {
      const total = roles.reduce((sum, role) => sum + bytesByRole[role], groundBytes);
      assert.ok(
        total <= limit,
        tier + " " + model + " architecture plus ground is " + total + " bytes; budget " + limit,
      );
    }
  }
});


test("the ?ground=earth comparison's earth maps are deferred and fit both material and complete-scene budgets", async () => {
  const app=await readFile(await findHashedScript("app"),"utf8");assert.doesNotMatch(app,/earth-(?:color|normal|roughness)/);
  for(const [tier,size,limit,totalLimit] of [["high",1024,600*1024,6*1024*1024],["balanced",512,200*1024,3*1024*1024]]) {
    let bytes=0;
    for(const kind of ["color","normal","roughness"]) {
      const file=`earth-${kind}-${size}.webp`,source=await readFile(path.join(projectRoot,"images","materials",file));
      assert.equal(source.toString("ascii",8,12),"WEBP");assert.deepEqual(await readFile(path.join(distDir,"images","materials",file)),source);bytes+=source.length;
    }
    assert.ok(bytes<=limit,`${tier} earth: ${bytes}`);
    for(const role of ["tower","tree"])bytes+=(await stat(path.join(projectRoot,"images","architecture",`${role}-${tier}.glb`))).size;
    assert.ok(bytes<=totalLimit,`${tier} scene: ${bytes}`);
  }
});

test("the ?ground=earth comparison's grass color/mask maps are deferred and fit both their own and the complete-scene budgets", async () => {
  const app=await readFile(await findHashedScript("app"),"utf8");assert.doesNotMatch(app,/grass-(?:color|mask)/);
  for(const [tier,size,limit,totalLimit] of [["high",1024,250*1024,6*1024*1024],["balanced",512,90*1024,3*1024*1024]]) {
    let bytes=0;
    for(const kind of ["color","mask"]) {
      const file=`grass-${kind}-${size}.webp`,source=await readFile(path.join(projectRoot,"images","materials",file));
      assert.equal(source.toString("ascii",8,12),"WEBP");assert.deepEqual(await readFile(path.join(distDir,"images","materials",file)),source);bytes+=source.length;
    }
    assert.ok(bytes<=limit,`${tier} grass: ${bytes}`);
    for(const role of ["tower","tree"])bytes+=(await stat(path.join(projectRoot,"images","architecture",`${role}-${tier}.glb`))).size;
    for(const kind of ["color","normal","roughness"])bytes+=(await stat(path.join(projectRoot,"images","materials",`earth-${kind}-${size}.webp`))).size;
    assert.ok(bytes<=totalLimit,`${tier} scene incl. earth+grass: ${bytes}`);
  }
});

test("the default film slate set and rocks are deferred and fit their own and the complete-scene budgets", async () => {
  // Default film pages request the slate's color, normal and shared detail map,
  // and on high and balanced the two rock models (the ?ground=earth comparison
  // keeps the earth and grass maps budgeted above). Only the scene entry names
  // their hashed copies.
  const app = await readFile(await findHashedScript("app"), "utf8");
  const { entry, loaded } = await sceneScripts();
  assert.doesNotMatch(app, /slate-|lichen-rock|weathered-stone|lantern-high|lantern-balanced/);
  for (const [tier, size, limit, rockLimit, totalLimit] of [
    ["high", 1024, 640 * 1024, 320 * 1024, 6 * 1024 * 1024],
    ["balanced", 512, 224 * 1024, 128 * 1024, 3 * 1024 * 1024],
  ]) {
    let bytes = 0;
    for (const file of [`slate-color-${size}.webp`, `slate-normal-${size}.webp`, "slate-detail-512.webp"]) {
      const source = await readFile(path.join(projectRoot, "images", "materials", file));
      assert.equal(source.toString("ascii", 8, 12), "WEBP");
      const hashed = file.replace(".webp", `.${createHash("sha256").update(source).digest("hex").slice(0, 8)}.webp`);
      assert.deepEqual(await readFile(path.join(distDir, "images", "materials", hashed)), source);
      assert.ok(loaded.get(entry).includes(`/images/materials/${hashed}`), `${hashed} is named by the scene entry`);
      bytes += source.length;
    }
    assert.ok(bytes <= limit, `${tier} slate: ${bytes}`);
    for (const role of ["lichen-rock", "weathered-stone"]) {
      const source = await readFile(path.join(projectRoot, "images", "architecture", `${role}-${tier}.glb`));
      assert.equal(source.toString("ascii", 0, 4), "glTF");
      assert.ok(source.length <= rockLimit, `${role}-${tier}: ${source.length}`);
      bytes += source.length;
    }
    for (const role of ["tower", "tree", "lantern"]) {
      bytes += (await stat(path.join(projectRoot, "images", "architecture", `${role}-${tier}.glb`))).size;
    }
    assert.ok(bytes <= totalLimit, `${tier} scene incl. slate, rocks and lantern: ${bytes}`);
  }
});
test("homepage discovers the deferred scene while its UI excludes the renderer and model loading", async () => {
  const html = await readFile(path.join(distDir, "index.html"), "utf8");
  const app = await readFile(await findHashedScript("app"), "utf8");
  const sceneName = path.basename(await findHashedScript("scene"));
  assert.ok(html.includes(`content="/scripts/${sceneName}" data-scene-script`));
  assert.doesNotMatch(html, /<script[^>]*src="[^\"]*scene[.]/);
  assert.match(app, /ensureSceneReady|initHomeScene/);
  assert.match(app, /getWebGLCapabilities/);
  assert.match(app, /initSceneMenu/);
  assert.doesNotMatch(app, /gl_Position|WebGLRenderer|GLTFLoader|Invalid architecture GLB/);
});

test("retired About case assets remain intact while About uses real text", async () => {
  const html = await readFile(path.join(distDir, "index.html"), "utf8");
  let total = 0;
  for (const name of ["nav-about", "nav-about-active"]) {
    const bytes = await readFile(path.join(projectRoot, "images", `${name}.webp`));
    const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 8);
    total += bytes.length;
    const hashedName = `${name}.${hash}.webp`;
    assert.ok(!html.includes(`src="/images/${hashedName}"`));
    assert.ok(!html.includes(`src="/images/${name}.webp"`));
    assert.deepEqual(await readFile(path.join(distDir, "images", hashedName)), bytes);
  }
  assert.ok(total <= 80 * 1024);
  assert.match(html, /class="about-link__label">About<\/span>/);
  assert.doesNotMatch(html, /nav-contact|Leather_Envelope|Stylized_3D/);
});

test("paper textures and category vignettes are fingerprinted and stay under 200 KiB combined", async () => {
  const cssDir = path.join(distDir, "css");
  const cssName = (await readdir(cssDir)).find((name) => /^styles\.[a-f0-9]{8}\.css$/.test(name));
  const css = await readFile(path.join(cssDir, cssName), "utf8");
  assert.equal(cssName, `styles.${createHash("sha256").update(css).digest("hex").slice(0, 8)}.css`);
  let total = 0;
  for (const name of ["paper-grain", "paper-edge", "paper-vignette-profile", "paper-vignette-experience", "paper-vignette-contact"]) {
    const source = await readFile(path.join(projectRoot, "images", `${name}.webp`));
    total += source.length;
    const hash = createHash("sha256").update(source).digest("hex").slice(0, 8);
    assert.ok(css.includes(`/images/${name}.${hash}.webp`));
    assert.ok(!css.includes(`/images/${name}.webp`));
    assert.deepEqual(await readFile(path.join(distDir, "images", `${name}.${hash}.webp`)), source);
  }
  assert.ok(total <= 200 * 1024, `${total} bytes of paper textures exceeds budget`);
});


test("estate map artwork is hashed, responsive and under 200 KiB combined", async () => {
  const cssName = (await readdir(path.join(distDir, "css"))).find(n => /^styles\.[a-f0-9]{8}\.css$/.test(n));
  const css = await readFile(path.join(distDir, "css", cssName), "utf8");
  let total = 0;
  for (const name of ["estate-map-desktop", "estate-map-portrait"]) {
    const bytes = await readFile(path.join(projectRoot, "images", name + ".webp"));
    total += bytes.length;
    const hash = createHash("sha256").update(bytes).digest("hex").slice(0,8);
    assert.ok(css.includes(`/images/${name}.${hash}.webp`));
    assert.deepEqual(await readFile(path.join(distDir,"images",`${name}.${hash}.webp`)),bytes);
  }
  assert.ok(total <= 200 * 1024);
});

test("the stylesheet is published minified", async () => {
  const cssName = (await readdir(path.join(distDir, "css"))).find((name) => /^styles\.[a-f0-9]{8}\.css$/.test(name));
  const css = await readFile(path.join(distDir, "css", cssName), "utf8");
  const source = await readFile(path.join(projectRoot, "styles.css"), "utf8");
  assert.ok(css.length < source.length * 0.9, `${css.length} bytes from ${source.length} of source`);
  assert.equal(css.trimEnd().split("\n").length, 1, "minified CSS keeps no line breaks");
  assert.doesNotMatch(css, /\/\*/, "minified CSS keeps no comments");
});

test("hosting icons and the nested security.txt are published intact", async () => {
  for (const file of [
    "favicon.ico",
    "apple-touch-icon.png",
    "icon-192.png",
    "icon-512.png",
    "icon-maskable-512.png",
    "manifest.webmanifest",
    ".well-known/security.txt",
  ]) {
    assert.deepEqual(await readFile(path.join(distDir, file)), await readFile(path.join(projectRoot, file)), file);
  }
});

test("sitemap lastmod follows the page's dateModified rather than the build date", async () => {
  const sitemap = await readFile(path.join(distDir, "sitemap.xml"), "utf8");
  const dateModified = (await readFile(path.join(projectRoot, "index.md"), "utf8")).match(
    /^dateModified: (\d{4}-\d{2}-\d{2})\r?$/m,
  )[1];
  assert.match(sitemap, new RegExp(`<lastmod>${dateModified}</lastmod>`));
  assert.doesNotMatch(sitemap, /<changefreq>|<priority>/, "search engines ignore these hints");
});
