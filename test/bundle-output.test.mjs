import assert from "node:assert/strict";

import test, { after } from "node:test";

import { execFile } from "node:child_process";

import { createHash } from "node:crypto";

import { promisify } from "node:util";

import { cp, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";

import path from "node:path";

import { fileURLToPath } from "node:url";

import { ARCHITECTURE_ASSET_BUDGETS } from "../src/scene/architecture-assets.js";

const execFileP = promisify(execFile);

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const scratchRoot = path.join(projectRoot, ".tmp-preview-review");

await mkdir(scratchRoot, { recursive: true });

const bundleScratch = await mkdtemp(path.join(scratchRoot, "bundle-output-"));

const distDir = path.join(bundleScratch, "dist");

const scriptsDir = path.join(distDir, "scripts");

// Every model the live scene loads, and the slate maps each tier requests.
const ROLES = [
  "tower",
  "tree",
  "lantern",
  "lichen-rock",
  "weathered-stone",
  "mountain-ridge",
  "mountain-spine",
  "mountain-summit",
];

const slateMaps = (tier) => {
  const size = tier === "high" ? 1024 : 512;
  return [`slate-color-${size}.webp`, `slate-normal-${size}.webp`, "slate-detail-512.webp"];
};

after(async () => {
  assert.equal(path.dirname(path.resolve(bundleScratch)), scratchRoot);
  await rm(bundleScratch, { recursive: true, force: true });
});

await execFileP(process.execPath, ["build.mjs", "--dist", "--outdir", distDir], {
  cwd: projectRoot,
});

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
    static: named(
      /(?:\bimport\s*(?:[\w$*{][^;()"'`]*?\bfrom\s*)?|\bexport\s*\{[^}]*\}\s*from\s*)["']\.\/([^"']+)["']/g,
    ),
    dynamic: named(/\bimport\(\s*["']\.\/([^"']+)["']\s*\)/g),
  };
}

// Everything a default visitor's scene load fetches: the entry named by the
// page plus every chunk reachable through static imports. Lazily imported
// chunks (the film's optional effects) are listed separately.
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
  // the entry and each chunk it imports statically. The film's terrain,
  // ranges, rocks, light shafts and lantern flame load on demand only.
  const { loaded } = await sceneScripts();
  // The entry and one shared Three.js chunk.
  assert.equal(loaded.size, 2, `scene loads ${[...loaded.keys()]}`);
  let bytes = 0;
  for (const name of loaded.keys()) bytes += (await stat(path.join(scriptsDir, name))).size;
  const kb = bytes / 1024;
  assert.ok(
    kb < 820,
    `scene bundle (${[...loaded.keys()].join(" + ")}) is ${kb.toFixed(1)} kB; budget is 820 kB`,
  );
});

test("the film's optional effects are the only lazy chunks, and Three.js ships once", async () => {
  const { entry, loaded, lazy } = await sceneScripts();
  assert.deepEqual(lazy.map((name) => name.replace(/\.[a-f0-9]{8}\.js$/, "")).sort(), [
    "scene.lantern-flame",
    "scene.light-shafts",
    "scene.mountain-build",
    "scene.rock-build",
    "scene.terrain-build",
  ]);
  const statics = [...loaded.values()].join("\n");
  const threeMarker = "Multiple instances of Three.js being imported";
  assert.equal(statics.split(threeMarker).length - 1, 1, "Three.js ships exactly once");
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

test("the film's rock placement is a lazy chunk that imports nothing", async () => {
  const { entry, loaded, lazy } = await sceneScripts();
  const rockName = lazy.find((name) => name.startsWith("scene.rock-build."));
  const rocks = await readFile(path.join(scriptsDir, rockName), "utf8");
  const statics = [...loaded.values()].join("\n");
  // Its Three.js classes and first-party helpers arrive as arguments, so it
  // neither splits the shared chunk nor pulls scene modules into it.
  assert.deepEqual(chunkImports(rocks), { static: [], dynamic: [] });
  assert.match(rocks, /film-rocks/);
  assert.doesNotMatch(
    statics,
    /film-rocks/,
    "rock placement leaked into the visitor scene payload",
  );
  assert.match(
    loaded.get(entry),
    new RegExp(`import\\(\\s*"\\./${rockName.replaceAll(".", "\\.")}"\\s*\\)`),
  );
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
  assert.match(
    loaded.get(entry),
    new RegExp(`import\\(\\s*"\\./${shaftsName.replaceAll(".", "\\.")}"\\s*\\)`),
  );
  assert.ok(!app.includes(shaftsName), "the UI must not preload the light shafts");
  // It reuses the visitor's Three.js and carries no first-party modules.
  assert.ok(
    !shafts.includes("Multiple instances of Three.js being imported"),
    "Three.js is duplicated in the light shafts",
  );
  assert.deepEqual(chunkImports(shafts).dynamic, []);
  for (const dependency of chunkImports(shafts).static) {
    assert.ok(
      loaded.has(dependency),
      `the light shafts import ${dependency}, which visitors do not load`,
    );
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
  assert.match(
    loaded.get(entry),
    new RegExp(`import\\(\\s*"\\./${mountainName.replaceAll(".", "\\.")}"\\s*\\)`),
  );
  assert.ok(!app.includes(mountainName), "the UI must not preload the mountains");
  // It reuses the visitor's Three.js through the shared chunk and carries no
  // first-party scene module or further chunk.
  assert.ok(
    !mountains.includes("Multiple instances of Three.js being imported"),
    "Three.js is duplicated in the mountain chunk",
  );
  assert.deepEqual(chunkImports(mountains).dynamic, []);
  const statically = chunkImports(mountains).static;
  assert.ok(statically.length >= 1);
  for (const dependency of statically)
    assert.ok(
      loaded.has(dependency) && dependency.startsWith("scene.shared."),
      `the mountains import ${dependency}`,
    );
  assert.doesNotMatch(mountains, /BabelSite|initHomeScene|EstateMountains/);
});

test("the UI names exactly the scene entry's static chunks for modulepreload", async () => {
  const app = await readFile(await findHashedScript("app"), "utf8");
  const { entry, loaded, lazy } = await sceneScripts();
  const named = new Set(app.match(/\/scripts\/scene\.[\w.-]+\.js/g) ?? []);
  const statics = [...loaded.keys()].filter((name) => name !== entry);
  assert.ok(statics.length >= 1, "the shared Three.js chunk is a static import");
  assert.deepEqual([...named].sort(), statics.map((name) => `/scripts/${name}`).sort());
  // The page names the entry; no lazy chunk is preloaded.
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
    const { static: statics, dynamic } = chunkImports(
      await readFile(path.join(scriptsDir, name), "utf8"),
    );
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

test("the scene requests only the slate's material maps, and only from the deferred bundle", async () => {
  const app = await readFile(await findHashedScript("app"), "utf8");
  const scene = await readSceneStatic();
  assert.doesNotMatch(app, /images\/materials\//);
  assert.match(scene, /images\/materials\/slate-/);
  const materials = await readdir(path.join(projectRoot, "images", "materials"));
  assert.ok(
    materials.every((name) => name.startsWith("slate-")),
    materials.join(", "),
  );
  const published = await readdir(path.join(distDir, "images", "materials"));
  assert.ok(
    published.every((name) => /^slate-[\w-]+\.[a-f0-9]{8}\.webp$/.test(name)),
    published.join(", "),
  );
});

test("dist/images publishes fingerprinted sources only under their hashed names", async () => {
  async function files(directory, prefix = "") {
    const out = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory())
        out.push(...(await files(path.join(directory, entry.name), relative)));
      else out.push(relative);
    }
    return out;
  }
  const sources = await files(path.join(projectRoot, "images"));
  const published = new Set(await files(path.join(distDir, "images")));
  assert.ok(sources.length > 0);
  for (const source of sources) {
    assert.ok(!published.has(source), `${source} is also published under its plain name`);
    const bytes = await readFile(path.join(projectRoot, "images", source));
    const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 8);
    const hashed = source.replace(/\.(webp|glb)$/, `.${hash}.$1`);
    assert.ok(published.has(hashed), `${hashed} is published`);
  }
  for (const name of published) assert.match(name, /\.[a-f0-9]{8}\.(webp|glb)$/, name);
  // No page or stylesheet names a plain source path.
  const css = (await readdir(path.join(distDir, "css"))).map((name) =>
    path.join(distDir, "css", name),
  );
  for (const file of [path.join(distDir, "index.html"), path.join(distDir, "404.html"), ...css]) {
    const text = await readFile(file, "utf8");
    for (const url of text.match(/\/images\/[\w./-]+/g) ?? []) {
      assert.match(url, /\.[a-f0-9]{8}\.(webp|glb)$/, `${path.basename(file)} names ${url}`);
    }
  }
});

test("fonts publish only under hashed names, which the stylesheet and the preloads share", async () => {
  const sources = (await readdir(path.join(projectRoot, "fonts"))).filter((name) =>
    name.endsWith(".woff2"),
  );
  const published = (await readdir(path.join(distDir, "fonts"))).filter((name) =>
    name.endsWith(".woff2"),
  );
  assert.ok(sources.length >= 2);
  const hashed = [];
  for (const name of sources) {
    const bytes = await readFile(path.join(projectRoot, "fonts", name));
    const hashedName = name.replace(
      /\.woff2$/,
      `.${createHash("sha256").update(bytes).digest("hex").slice(0, 8)}.woff2`,
    );
    assert.deepEqual(await readFile(path.join(distDir, "fonts", hashedName)), bytes, hashedName);
    hashed.push(`/fonts/${hashedName}`);
  }
  assert.deepEqual(published.sort(), hashed.map((url) => url.slice("/fonts/".length)).sort());

  const cssName = (await readdir(path.join(distDir, "css"))).find((name) =>
    /^styles\.[a-f0-9]{8}\.css$/.test(name),
  );
  const css = await readFile(path.join(distDir, "css", cssName), "utf8");
  const cssFonts = [...css.matchAll(/url\("?(\/fonts\/[^")]+)"?\)/g)].map((match) => match[1]);
  assert.deepEqual([...cssFonts].sort(), [...hashed].sort());
  // Both pages preload the very files the stylesheet names.
  for (const page of ["index.html", "404.html"]) {
    const html = await readFile(path.join(distDir, page), "utf8");
    const preloads = [...html.matchAll(/<link[^>]*rel="preload"[^>]*>/g)]
      .map(([link]) => link.match(/href="(\/fonts\/[^"]+)"/)?.[1])
      .filter(Boolean);
    assert.deepEqual([...preloads].sort(), [...hashed].sort(), page);
  }

  // The fonts' license and copyright notices ship beside them.
  const ofl = await readFile(path.join(distDir, "fonts", "OFL.txt"), "utf8");
  assert.equal(ofl, await readFile(path.join(projectRoot, "fonts", "OFL.txt"), "utf8"));
  assert.match(ofl, /^Copyright 2015 The Cormorant Project Authors /m);
  assert.match(ofl, /^Copyright 2022 The Instrument Sans Project Authors /m);
  assert.match(ofl, /SIL OPEN FONT LICENSE Version 1\.1/);
});

test("the shared scene chunk keeps Three.js's license notice, and the site publishes no LICENSE", async () => {
  const { loaded } = await sceneScripts();
  const [shared] =
    [...loaded].find(([name]) => /^scene\.shared\.[a-f0-9]{8}\.js$/.test(name)) ?? [];
  assert.ok(shared, "the scene loads a shared chunk");
  const text = loaded.get(shared);
  assert.match(text, /@license/);
  assert.match(text, /Three\.js Authors/);
  await assert.rejects(readFile(path.join(distDir, "LICENSE")), { code: "ENOENT" });
});

test("the pages publish no picture, and the share card's backdrop stays unpublished", async () => {
  for (const page of ["index.html", "404.html"]) {
    const html = await readFile(path.join(distDir, page), "utf8");
    assert.doesNotMatch(html, /<picture|<img/, page);
  }
  await assert.rejects(readFile(path.join(distDir, "tools", "og-card-backdrop.webp")), {
    code: "ENOENT",
  });
});

test("the UI carries the loading line and its tower and tree byte sizes; the scene only reports to it", async () => {
  const app = await readFile(await findHashedScript("app"), "utf8");
  const scene = await readSceneStatic();
  assert.match(app, /scene-loader__fill/);
  assert.match(app, /sceneLoader/);
  for (const tier of ["high", "balanced"]) {
    for (const role of ["tower", "tree"]) {
      const { size } = await stat(
        path.join(projectRoot, "images", "architecture", `${role}-${tier}.glb`),
      );
      assert.ok(app.includes(`${role}:${size}`), `the UI names ${role}-${tier}'s ${size} bytes`);
      assert.ok(!scene.includes(`${role}:${size}`), `the scene carries no ${role}-${tier} size`);
    }
  }
  for (const role of ROLES.filter((item) => !["tower", "tree"].includes(item))) {
    const { size } = await stat(
      path.join(projectRoot, "images", "architecture", `${role}-high.glb`),
    );
    assert.ok(!app.includes(String(size)), `the UI names no ${role} size`);
  }
  // The scene's model loader reports its own requests; the copy stays in the UI.
  assert.match(scene, /sceneLoader/);
  assert.doesNotMatch(scene, /Loading the estate|scene-loader__/);
  const html = await readFile(path.join(distDir, "index.html"), "utf8");
  assert.match(html, /<div class="scene-loader" id="scene-loader" aria-hidden="true" hidden>/);
});

test("the build refuses a shared scene chunk that would carry first-party modules", async () => {
  const fixture = await mkdtemp(path.join(scratchRoot, "shared-chunk-build-"));
  try {
    // The sanitized static payload, plus the source images (models, maps and
    // paper) the build hashes, which dist carries only under hashed names.
    await cp(distDir, fixture, { recursive: true });
    await cp(path.join(projectRoot, "images"), path.join(fixture, "images"), { recursive: true });
    await cp(path.join(projectRoot, "build.mjs"), path.join(fixture, "build.mjs"));
    await cp(path.join(projectRoot, "tools"), path.join(fixture, "tools"), { recursive: true });
    await mkdir(path.join(fixture, "src"));
    await writeFile(path.join(fixture, "src", "app.js"), "void 0;");
    // A lazily imported module that shares a registration with the entry moves
    // it into a chunk that would evaluate before the entry's ordered imports.
    await writeFile(
      path.join(fixture, "src", "helpers.js"),
      "globalThis.BabelSite = { scene: {} };",
    );
    await writeFile(path.join(fixture, "src", "tools.js"), 'import "./helpers.js";');
    await writeFile(
      path.join(fixture, "src", "scene-entry.js"),
      'import "./helpers.js";\nif (globalThis.debug) import("./tools.js");',
    );
    await assert.rejects(
      execFileP(process.execPath, ["build.mjs", "--check"], { cwd: fixture }),
      (error) =>
        /Shared scene chunk would reorder side-effect modules: src\/helpers\.js/.test(error.stderr),
    );
    // Without the shared registration the same layout builds.
    await writeFile(path.join(fixture, "src", "tools.js"), "export const tools = 1;");
    await execFileP(process.execPath, ["build.mjs", "--check"], { cwd: fixture });
  } finally {
    assert.equal(path.dirname(path.resolve(fixture)), scratchRoot);
    await rm(fixture, { recursive: true, force: true });
  }
});

test("changing only a fixture tower model changes only its URL and size in the UI, and a rebuild is stable", async () => {
  const fixture = await mkdtemp(path.join(scratchRoot, "model-size-build-"));
  const sourcePath = path.join(projectRoot, "images", "architecture", "tower-high.glb");
  const sourceBefore = await readFile(sourcePath);
  const sha8 = (bytes) => createHash("sha256").update(bytes).digest("hex").slice(0, 8);
  try {
    // Reuse the sanitized static payload; only the build script, its
    // unrewritten HTML/CSS inputs, the source fonts and images and the two UI
    // modules that read the model manifest are copied from source. No user data.
    await cp(distDir, fixture, { recursive: true });
    await rm(path.join(fixture, "fonts"), { recursive: true, force: true });
    await cp(path.join(projectRoot, "fonts"), path.join(fixture, "fonts"), { recursive: true });
    await cp(path.join(projectRoot, "images"), path.join(fixture, "images"), { recursive: true });
    for (const file of ["build.mjs", "index.html", "404.html", "styles.css"]) {
      await cp(path.join(projectRoot, file), path.join(fixture, file));
    }
    await cp(path.join(projectRoot, "public"), path.join(fixture, "public"), { recursive: true });
    await cp(path.join(projectRoot, "tools"), path.join(fixture, "tools"), { recursive: true });
    await mkdir(path.join(fixture, "src", "ui"), { recursive: true });
    for (const file of ["main.js", "ui/scene-loader.js"]) {
      await cp(path.join(projectRoot, "src", file), path.join(fixture, "src", file));
    }
    await writeFile(
      path.join(fixture, "src", "app.js"),
      'import "./ui/scene-loader.js";\nimport "./main.js";\n',
    );
    await writeFile(path.join(fixture, "src", "scene-entry.js"), "void 0;");
    async function buildApp() {
      await execFileP(
        process.execPath,
        ["build.mjs", "--dist", "--outdir", path.join(fixture, "dist")],
        { cwd: fixture },
      );
      const names = (await readdir(path.join(fixture, "dist", "scripts"))).filter((name) =>
        /^app\.[a-f0-9]{8}\.js$/.test(name),
      );
      assert.equal(names.length, 1);
      return {
        name: names[0],
        text: await readFile(path.join(fixture, "dist", "scripts", names[0]), "utf8"),
      };
    }
    // The UI's model manifest: each tier's tower and tree URLs and sizes.
    const manifest = (text) => ({
      urls: text.match(/\/images\/architecture\/[\w-]+\.[a-f0-9]{8}\.glb/g),
      sizes: text.match(/\b(?:tower|tree):\d+\b/g),
    });
    const before = await buildApp();
    const was = manifest(before.text);
    const oldUrl = `/images/architecture/tower-high.${sha8(sourceBefore)}.glb`;
    const oldSize = `tower:${sourceBefore.length}`;
    assert.equal(was.urls.length, 4);
    assert.equal(was.sizes.length, 4);
    assert.equal(
      was.urls.filter((url) => url === oldUrl).length,
      1,
      "the UI names the tower's URL once",
    );
    assert.equal(was.sizes.filter((size) => size === oldSize).length, 1, "and its size once");
    const changed = Buffer.concat([sourceBefore, Buffer.from("fixture-only-model-change")]);
    await writeFile(path.join(fixture, "images", "architecture", "tower-high.glb"), changed);
    const after = await buildApp();
    assert.notEqual(after.name, before.name);
    // Minified names may shift with the hash's characters; the manifest
    // changes in exactly the tower's URL and size.
    const newUrl = `/images/architecture/tower-high.${sha8(changed)}.glb`;
    assert.deepEqual(manifest(after.text), {
      urls: was.urls.map((url) => (url === oldUrl ? newUrl : url)),
      sizes: was.sizes.map((size) => (size === oldSize ? `tower:${changed.length}` : size)),
    });
    // An unchanged rebuild publishes the same UI, and a model the UI does not
    // request early (the lantern) never changes it.
    assert.equal((await buildApp()).name, after.name);
    const lantern = path.join(fixture, "images", "architecture", "lantern-high.glb");
    await writeFile(lantern, Buffer.concat([await readFile(lantern), Buffer.from("fixture")]));
    assert.equal((await buildApp()).name, after.name);
    assert.deepEqual(await readFile(sourcePath), sourceBefore, "the tracked model must not change");
  } finally {
    assert.equal(path.dirname(path.resolve(fixture)), scratchRoot);
    await rm(fixture, { recursive: true, force: true });
  }
});

test("models and slate maps are deferred: the scene entry names their hashed copies, the UI only the early tower and tree", async () => {
  const app = await readFile(await findHashedScript("app"), "utf8");
  const scene = await readSceneStatic();
  // The hashed model manifest lives in the entry, so a model revision changes
  // only the entry's URL and never the shared Three.js chunk's.
  const { entry, loaded } = await sceneScripts();
  assert.match(loaded.get(entry), /\/images\/architecture\/tower-high\.[a-f0-9]{8}\.glb/);
  for (const [name, text] of loaded) {
    if (name !== entry) assert.doesNotMatch(text, /\/images\/architecture\//, name);
  }
  // The UI names the hashed models only to request them early; loading and
  // validation stay in the scene bundle.
  assert.doesNotMatch(app, /Invalid architecture GLB header/);
  assert.match(scene, /Invalid architecture GLB header/);
  const hashed = (bytes, name) =>
    name.replace(
      /\.(glb|webp)$/,
      `.${createHash("sha256").update(bytes).digest("hex").slice(0, 8)}.$1`,
    );
  for (const tier of ["high", "balanced"]) {
    for (const role of ROLES) {
      const name = `${role}-${tier}.glb`;
      const source = await readFile(path.join(projectRoot, "images", "architecture", name));
      const published = hashed(source, name);
      assert.deepEqual(
        await readFile(path.join(distDir, "images", "architecture", published)),
        source,
      );
      assert.ok(loaded.get(entry).includes(`/images/architecture/${published}`), published);
      assert.equal(
        app.includes(`/images/architecture/${published}`),
        role === "tower" || role === "tree",
        `the UI names ${published} only to request it early`,
      );
    }
    for (const file of slateMaps(tier)) {
      const source = await readFile(path.join(projectRoot, "images", "materials", file));
      assert.equal(source.toString("ascii", 8, 12), "WEBP");
      const published = hashed(source, file);
      assert.deepEqual(
        await readFile(path.join(distDir, "images", "materials", published)),
        source,
      );
      assert.ok(loaded.get(entry).includes(`/images/materials/${published}`), published);
    }
  }
});

test("the complete scene fits 6 MiB on high and 3 MiB on balanced, and each model the loader's limit", async () => {
  // A live scene downloads the tower, tree, lantern, both rocks, the three
  // Meshy massifs and the slate's color, normal and detail maps.
  for (const [tier, budget] of [
    ["high", 6 * 1024 * 1024],
    ["balanced", 3 * 1024 * 1024],
  ]) {
    let total = 0;
    for (const role of ROLES) {
      const { size } = await stat(
        path.join(projectRoot, "images", "architecture", `${role}-${tier}.glb`),
      );
      assert.ok(
        size <= ARCHITECTURE_ASSET_BUDGETS[tier],
        `${role}-${tier} is ${size} bytes; the loader accepts ${ARCHITECTURE_ASSET_BUDGETS[tier]}`,
      );
      total += size;
    }
    for (const file of slateMaps(tier))
      total += (await stat(path.join(projectRoot, "images", "materials", file))).size;
    assert.ok(total <= budget, `${tier} complete scene is ${total} bytes; budget ${budget}`);
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

test("paper textures and category vignettes are fingerprinted", async () => {
  const cssDir = path.join(distDir, "css");
  const cssName = (await readdir(cssDir)).find((name) => /^styles\.[a-f0-9]{8}\.css$/.test(name));
  const css = await readFile(path.join(cssDir, cssName), "utf8");
  assert.equal(cssName, `styles.${createHash("sha256").update(css).digest("hex").slice(0, 8)}.css`);
  // Their 200 KiB budget is held in markup-accessibility.test.mjs ("three distinct
  // transparent paper vignettes share the 200 KiB section-paper budget").
  for (const name of [
    "paper-grain",
    "paper-edge",
    "paper-vignette-profile",
    "paper-vignette-experience",
    "paper-vignette-contact",
  ]) {
    const source = await readFile(path.join(projectRoot, "images", `${name}.webp`));
    const hash = createHash("sha256").update(source).digest("hex").slice(0, 8);
    assert.ok(css.includes(`/images/${name}.${hash}.webp`));
    assert.ok(!css.includes(`/images/${name}.webp`));
    assert.deepEqual(await readFile(path.join(distDir, "images", `${name}.${hash}.webp`)), source);
  }
});

test("estate map artwork is hashed, responsive and under 200 KiB combined", async () => {
  const cssName = (await readdir(path.join(distDir, "css"))).find((n) =>
    /^styles\.[a-f0-9]{8}\.css$/.test(n),
  );
  const css = await readFile(path.join(distDir, "css", cssName), "utf8");
  let total = 0;
  for (const name of ["estate-map-desktop", "estate-map-portrait"]) {
    const bytes = await readFile(path.join(projectRoot, "images", name + ".webp"));
    total += bytes.length;
    const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 8);
    assert.ok(css.includes(`/images/${name}.${hash}.webp`));
    assert.deepEqual(await readFile(path.join(distDir, "images", `${name}.${hash}.webp`)), bytes);
  }
  assert.ok(total <= 200 * 1024);
});

test("the stylesheet is published minified", async () => {
  const cssName = (await readdir(path.join(distDir, "css"))).find((name) =>
    /^styles\.[a-f0-9]{8}\.css$/.test(name),
  );
  const css = await readFile(path.join(distDir, "css", cssName), "utf8");
  const source = await readFile(path.join(projectRoot, "styles.css"), "utf8");
  assert.ok(
    css.length < source.length * 0.9,
    `${css.length} bytes from ${source.length} of source`,
  );
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
    assert.deepEqual(
      await readFile(path.join(distDir, file)),
      await readFile(path.join(projectRoot, "public", file)),
      file,
    );
  }
});

test("sitemap lastmod follows the page's dateModified rather than the build date", async () => {
  const sitemap = await readFile(path.join(distDir, "sitemap.xml"), "utf8");
  const dateModified = (await readFile(path.join(projectRoot, "public", "index.md"), "utf8")).match(
    /^dateModified: (\d{4}-\d{2}-\d{2})\r?$/m,
  )[1];
  assert.match(sitemap, new RegExp(`<lastmod>${dateModified}</lastmod>`));
  assert.doesNotMatch(sitemap, /<changefreq>|<priority>/, "search engines ignore these hints");
});
