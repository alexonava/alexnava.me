import { build, transform } from "esbuild";
import { copyFile, cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { publishBuild } from "./tools/build-output.mjs";
import { compactShaderSource } from "./tools/shader-compact.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// The UI entry stays small for first paint. The scene entry carries Three.js
// and the tower runtime, then main.js loads it after the hero has rendered.
// The scene is an ES module split by esbuild: code reached only through a
// dynamic import() (the film's terrain, ranges, rocks, light shafts and lantern
// flame) becomes a lazy chunk, and code it shares with the entry (Three.js)
// becomes one static chunk that the entry imports. Every chunk keeps the scene.*.js prefix and a content hash.
// The scene builds first: the UI names the scene's static chunks so main.js
// can preload them beside the entry (see buildScripts).
const APP_ENTRY = "src/app.js";
const SCENE_ENTRY = "src/scene-entry.js";
const SCRIPT_ENTRIES = [
  { basename: "scene", entry: SCENE_ENTRY, split: true },
  { basename: "app", entry: APP_ENTRY },
];
// esbuild names split output here only to resolve import paths; with
// write: false nothing is written, and fingerprintChunks renames everything.
const SPLIT_OUTDIR = join(__dirname, ".cache", "split-scripts");

// Files copied verbatim (no URL rewriting) to the same path in dist: the
// hosting, icon and discovery files kept in public/, plus LICENSE, which GitHub
// reads from the repository root. The internal agent guide's public
// counterpart, public/site-agents.md, is published as /AGENTS.md.
const PUBLIC_DIR = "public";
const PUBLIC_FILES = [
  "favicon.svg",
  "favicon.ico",
  "icon.svg",
  "icon-maskable.svg",
  "apple-touch-icon.png",
  "icon-192.png",
  "icon-512.png",
  "icon-maskable-512.png",
  "manifest.webmanifest",
  "og.png",
  "robots.txt",
  "llms.txt",
  "sitemap.md",
  "index.md",
  "_headers",
  "_redirects",
  ".well-known/security.txt",
];
const STATIC_FILES = [
  { source: "LICENSE", destination: "LICENSE" },
  ...PUBLIC_FILES.map((file) => ({ source: `${PUBLIC_DIR}/${file}`, destination: file })),
  { source: `${PUBLIC_DIR}/site-agents.md`, destination: "AGENTS.md" },
];
const STATIC_DIRS = ["fonts", "images"];
const FINGERPRINTED_POSTERS = ["scene-poster-landscape.webp", "scene-poster-portrait.webp"];
const FINGERPRINTED_PAPER = [
  "paper-grain.webp",
  "paper-edge.webp",
  "paper-vignette-profile.webp",
  "paper-vignette-experience.webp",
  "paper-vignette-contact.webp",
  "estate-map-desktop.webp",
  "estate-map-portrait.webp",
];
// Sources the build publishes only as hashed copies (path relative to the
// project root, any separator).
export function isFingerprintedSource(file) {
  const path = file.split(sep).join("/");
  return (
    [...FINGERPRINTED_POSTERS, ...FINGERPRINTED_PAPER].some((name) => path === `images/${name}`) ||
    /^images\/architecture\/[^/]+\.glb$/.test(path) ||
    /^images\/materials\/slate-[^/]+\.webp$/.test(path)
  );
}
export const BUILD_INPUT_FILES = [
  "LICENSE",
  "index.html",
  "404.html",
  "styles.css",
  "build.mjs",
  "package.json",
  "package-lock.json",
];
// The watcher follows root files without recursion; directories, public/
// included, are watched as a whole.
export const BUILD_INPUT_DIRS = ["src", ...STATIC_DIRS, PUBLIC_DIR, "tools"];

// esbuild keeps template literal text verbatim: the scene's GLSL loses its
// indentation, comments and spaces beside punctuation here instead
// (tools/shader-compact.mjs). Three.js's own shaders are left as published.
const SCENE_SOURCE = /[\\/]src[\\/]scene[\\/][^\\/]+\.js$/;
const compactShaders = {
  name: "compact-shaders",
  setup(bundler) {
    bundler.onLoad({ filter: SCENE_SOURCE }, async ({ path }) => ({
      contents: compactShaderSource(await readFile(path, "utf8")),
      loader: "js",
    }));
  },
};

const scriptBuildOptions = (entry, split = false) => ({
  entryPoints: [join(__dirname, entry)],
  bundle: true,
  minify: true,
  target: "es2022",
  format: split ? "esm" : "iife",
  legalComments: "none",
  write: false,
  plugins: [compactShaders],
  ...(split && {
    splitting: true,
    metafile: true,
    absWorkingDir: __dirname,
    outdir: SPLIT_OUTDIR,
    entryNames: "[name]",
    chunkNames: "[name]-[hash]",
  }),
});

function sha8(buf) {
  return createHash("sha256").update(buf).digest("hex").slice(0, 8);
}

async function architectureAssetManifest() {
  const urls = {};
  const files = [];
  for (const tier of ["high", "balanced"]) {
    urls[tier] = {};
    for (const role of ["tower", "tree", "lantern", "lichen-rock", "weathered-stone"]) {
      const name = role + "-" + tier + ".glb";
      const bytes = await readFile(join(__dirname, "images", "architecture", name));
      const hashedName = name.replace(".glb", "." + sha8(bytes) + ".glb");
      urls[tier][role] = "/images/architecture/" + hashedName;
      files.push({ hashedName, bytes });
    }
  }
  return { urls, files };
}

// The film slate's maps (images/materials/slate-*.webp) are hashed too:
// { source name: hashed URL }, which the scene entry reads (stone-detail.js).
const SLATE_MAPS = ["color-1024", "normal-1024", "color-512", "normal-512", "detail-512"];
async function materialAssetManifest() {
  const urls = {};
  const files = [];
  for (const map of SLATE_MAPS) {
    const name = `slate-${map}.webp`;
    const bytes = await readFile(join(__dirname, "images", "materials", name));
    const hashedName = name.replace(".webp", `.${sha8(bytes)}.webp`);
    urls[name] = `/images/materials/${hashedName}`;
    files.push({ hashedName, bytes });
  }
  return { urls, files };
}

// Split output refers to its chunks by esbuild's temporary names. Rename each
// chunk after the sha256 of its final bytes, dependencies first, so an
// importer's hash covers the fingerprinted names it loads: any chunk change
// yields a new entry URL. The entry is BASENAME.HASH.js; chunks are
// BASENAME.LABEL.HASH.js, where LABEL is the dynamically imported module's
// file name, or "shared" for code that more than one output uses.
function fingerprintChunks({ basename, entry: source }, { metafile, outputFiles }) {
  const outputKey = (file) => relative(__dirname, file).split(sep).join("/");
  const texts = new Map(outputFiles.map((file) => [outputKey(file.path), file.text]));
  const named = new Map();
  const visiting = new Set();
  function visit(key) {
    if (named.has(key)) return named.get(key);
    if (visiting.has(key)) throw new Error(`Script chunks import each other cyclically: ${key}`);
    visiting.add(key);
    const meta = metafile.outputs[key];
    let text = texts.get(key);
    if (!meta || text === undefined) throw new Error(`esbuild produced no output named ${key}`);
    // A chunk that is no entry point holds code several outputs share, and the
    // entry's static import makes it evaluate before any entry module. The
    // first-party scene modules register on BabelSite in the order
    // scene-entry.js lists, so none of them may move there.
    const firstParty = Object.keys(meta.inputs).filter((input) => input.startsWith("src/"));
    if (!meta.entryPoint && firstParty.length) {
      throw new Error(
        `Shared ${basename} chunk would reorder side-effect modules: ${firstParty.join(", ")}`,
      );
    }
    const imports = [];
    for (const { path: dependency, kind, external } of meta.imports) {
      if (external) throw new Error(`${key} imports external ${dependency}`);
      const chunk = visit(dependency);
      const from = dependency.split("/").pop();
      let replaced = 0;
      for (const quote of ['"', "'", "`"]) {
        const specifier = `${quote}./${from}${quote}`;
        replaced += text.split(specifier).length - 1;
        text = text.replaceAll(specifier, `${quote}./${chunk.name}${quote}`);
      }
      if (!replaced) throw new Error(`${key} does not name its chunk ${from}`);
      imports.push({ chunk, lazy: kind === "dynamic-import" });
    }
    // esbuild records each dynamic import() target as an entry point too.
    const dynamicName = meta.entryPoint?.replace(/^.*\/|\.[cm]?js$/g, "");
    const label = meta.entryPoint === source ? "" : `${dynamicName ?? "shared"}.`;
    const chunk = { name: `${basename}.${label}${sha8(text)}.js`, text, imports };
    visiting.delete(key);
    named.set(key, chunk);
    return chunk;
  }
  const entries = Object.keys(metafile.outputs).filter(
    (key) => metafile.outputs[key].entryPoint === source,
  );
  if (entries.length !== 1) throw new Error(`Expected one output for ${source}`);
  const entry = visit(entries[0]);
  for (const key of Object.keys(metafile.outputs)) visit(key);
  // Everything the entry imports statically downloads with it; a dynamic
  // import() target, and whatever only it reaches, downloads on demand.
  const loaded = new Set([entry]);
  for (const chunk of loaded) {
    for (const { chunk: dependency, lazy } of chunk.imports) if (!lazy) loaded.add(dependency);
  }
  return [entry, ...[...named.values()].filter((chunk) => chunk !== entry)].map((chunk) => ({
    name: chunk.name,
    text: chunk.text,
    lazy: !loaded.has(chunk),
  }));
}

// The scene loads every role. The UI requests only the startup tier's tower
// and tree beside the scene bundle, so it names only those: the other roles'
// hashes (the rocks among them) then never change the UI bundle.
// Returns the published scripts, entry first, as [{ name, text, lazy }].
async function buildScriptBundle({ basename, entry, split }, architecture, materials, sceneModulePreloads) {
  const options = scriptBuildOptions(entry, split);
  const { urls } = architecture ?? (await architectureAssetManifest());
  // The scene manifests are string literals that the scene parses: an
  // object-valued define becomes a virtual module that splitting places in the
  // shared Three.js chunk, so each model or map revision would change its URL.
  options.define =
    entry === SCENE_ENTRY
      ? {
          __BABEL_ARCHITECTURE_URLS__: JSON.stringify(JSON.stringify(urls)),
          __BABEL_MATERIAL_URLS__: JSON.stringify(
            JSON.stringify((materials ?? (await materialAssetManifest())).urls),
          ),
        }
      : {
          __BABEL_ARCHITECTURE_PREFETCH_URLS__: JSON.stringify(
            Object.fromEntries(
              Object.entries(urls).map(([tier, { tower, tree }]) => [tier, { tower, tree }]),
            ),
          ),
          __BABEL_SCENE_MODULE_PRELOADS__: JSON.stringify(sceneModulePreloads ?? []),
        };
  const result = await build(options);
  if (split) return fingerprintChunks({ basename, entry }, result);
  const out = result.outputFiles?.[0];
  if (!out) throw new Error(`esbuild produced no output for ${entry}`);
  return [{ name: `${basename}.${sha8(out.text)}.js`, text: out.text, lazy: false }];
}

// Builds every script entry, scene first. The browser finds the scene entry's
// static import (the shared Three.js chunk) only after downloading and parsing
// the whole entry, one round trip later; the UI bundle therefore names those
// chunks, and main.js adds a modulepreload for each beside the entry script.
// The lazily imported chunks are not named. Returns [{ script, chunks }].
async function buildScripts(architecture, materials) {
  const built = [];
  let sceneModulePreloads;
  for (const script of SCRIPT_ENTRIES) {
    const chunks = await buildScriptBundle(script, architecture, materials, sceneModulePreloads);
    if (script.entry === SCENE_ENTRY) {
      sceneModulePreloads = chunks
        .slice(1)
        .filter((chunk) => !chunk.lazy)
        .map(({ name }) => `/scripts/${name}`);
    }
    built.push({ script, chunks });
  }
  return built;
}

// Reads the YYYY-MM-DD dateModified from index.md front matter, if present.
export function contentDateModified(markdown) {
  const frontMatter = markdown.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? "";
  return frontMatter.match(/^dateModified:\s*["']?(\d{4}-\d{2}-\d{2})["']?\s*$/m)?.[1];
}

function rewriteHtml(src, { appPath, cssPath, scenePath, posterPaths }) {
  // Match source refs with or without a ?v=NNN query,
  // so stale query strings in source can't drift away from the real hashed path.
  let html = src
    .replace(/\/styles\.css(\?v=\d+)?/g, cssPath)
    .replace(/\/scripts\/app\.js(\?v=\d+)?/g, appPath)
    .replace(/\/scripts\/scene\.js(\?v=\d+)?/g, scenePath);
  for (const [sourcePath, hashedPath] of Object.entries(posterPaths)) {
    html = html.replaceAll(sourcePath, hashedPath);
  }
  return html;
}

async function writePayload(DIST_DIR) {
  const DIST_SCRIPTS_DIR = join(DIST_DIR, "scripts");
  const DIST_CSS_DIR = join(DIST_DIR, "css");
  await mkdir(DIST_SCRIPTS_DIR, { recursive: true });
  await mkdir(DIST_CSS_DIR, { recursive: true });
  const architecture = await architectureAssetManifest();
  const materials = await materialAssetManifest();
  const fingerprintedImages = new Map();
  for (const name of [...FINGERPRINTED_POSTERS, ...FINGERPRINTED_PAPER]) {
    fingerprintedImages.set(name, await readFile(join(__dirname, "images", name)));
  }

  const scriptPaths = {};
  for (const { script, chunks } of await buildScripts(architecture, materials)) {
    for (const { name, text } of chunks) await writeFile(join(DIST_SCRIPTS_DIR, name), text);
    scriptPaths[script.basename] = `/scripts/${chunks[0].name}`;

    const describe = (list) => {
      const bytes = list.reduce((sum, { text }) => sum + Buffer.byteLength(text), 0);
      const names = list.map(({ name }) => `scripts/${name}`).join(" + ");
      return `${names} (${(bytes / 1024).toFixed(1)} kB)`;
    };
    const lazy = chunks.filter((chunk) => chunk.lazy);
    console.log(`bundled ${script.entry} -> ${describe(chunks.filter((chunk) => !chunk.lazy))}`);
    if (lazy.length) console.log(`  loaded on demand: ${describe(lazy)}`);
  }

  // Git checkouts can use CRLF on Windows; hash and publish the same LF bytes
  // everywhere so a release has one asset URL independent of the build host.
  let cssSrc = (await readFile(join(__dirname, "styles.css"), "utf8")).replace(/\r\n?/g, "\n");
  for (const name of FINGERPRINTED_PAPER) {
    const bytes = fingerprintedImages.get(name);
    cssSrc = cssSrc.replaceAll(
      `/images/${name}`,
      `/images/${name.replace(/\.webp$/, `.${sha8(bytes)}.webp`)}`,
    );
  }
  // Minify after rewriting, then hash the published bytes. Without a browser
  // target esbuild lowers no syntax, and url() paths pass through unresolved.
  const { code: css } = await transform(cssSrc, {
    loader: "css",
    minify: true,
    logLevel: "warning",
  });
  const cssHash = sha8(css);
  const cssHashedName = `styles.${cssHash}.css`;
  const cssHashedUrl = `/css/${cssHashedName}`;
  await writeFile(join(DIST_CSS_DIR, cssHashedName), css);

  // copyFile creates no directories; .well-known/security.txt needs its own.
  await Promise.all(
    STATIC_FILES.map(async ({ source, destination }) => {
      await mkdir(dirname(join(DIST_DIR, destination)), { recursive: true });
      await copyFile(join(__dirname, source), join(DIST_DIR, destination));
    }),
  );
  // Fingerprinted sources publish only under their hashed names: the posters,
  // paper and estate maps, every model and the slate maps. Nothing the build
  // writes names their source paths, so no plain copy is kept.
  await Promise.all(
    STATIC_DIRS.map((dir) =>
      cp(join(__dirname, dir), join(DIST_DIR, dir), {
        recursive: true,
        filter: (source) => !isFingerprintedSource(relative(__dirname, source)),
      }),
    ),
  );

  // A model or map revision receives a new URL.
  await mkdir(join(DIST_DIR, "images", "architecture"), { recursive: true });
  for (const { hashedName, bytes } of architecture.files) {
    await writeFile(join(DIST_DIR, "images", "architecture", hashedName), bytes);
  }
  await mkdir(join(DIST_DIR, "images", "materials"), { recursive: true });
  for (const { hashedName, bytes } of materials.files) {
    await writeFile(join(DIST_DIR, "images", "materials", hashedName), bytes);
  }

  // New pages receive a fresh URL whenever poster or paper bytes change,
  // independent of the browser's image cache.
  const posterPaths = {};
  for (const name of [...FINGERPRINTED_POSTERS, ...FINGERPRINTED_PAPER]) {
    const bytes = fingerprintedImages.get(name);
    const hashedName = name.replace(/\.webp$/, `.${sha8(bytes)}.webp`);
    await writeFile(join(DIST_DIR, "images", hashedName), bytes);
    posterPaths[`/images/${name}`] = `/images/${hashedName}`;
  }

  for (const name of ["index.html", "404.html"]) {
    const htmlSrc = await readFile(join(__dirname, name), "utf8");
    const rewritten = rewriteHtml(htmlSrc, {
      appPath: scriptPaths.app,
      cssPath: cssHashedUrl,
      scenePath: scriptPaths.scene,
      posterPaths,
    });
    await writeFile(join(DIST_DIR, name), rewritten);
  }

  // lastmod reports when the content changed, matching the JSON-LD dateModified,
  // so an unrelated rebuild does not advertise a fresh page.
  const lastmod =
    contentDateModified(await readFile(join(__dirname, PUBLIC_DIR, "index.md"), "utf8")) ??
    new Date().toISOString().slice(0, 10);
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://alexnava.me/</loc>
    <lastmod>${lastmod}</lastmod>
  </url>
</urlset>
`;
  await writeFile(join(DIST_DIR, "sitemap.xml"), sitemap);

  console.log(`hashed assets: css/${cssHashedName}`);
}

export async function buildDist(
  outputDirectory = join(__dirname, "dist"),
  { retainAssets = false } = {},
) {
  await publishBuild({
    projectRoot: __dirname,
    outputDirectory,
    retainAssets,
    prepare: writePayload,
  });
}

async function main() {
  const args = process.argv.slice(2);
  let mode = "--dist";
  let modeChosen = false;
  let outputDirectory = join(__dirname, "dist");
  let retainAssets = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (["--watch", "--check", "--dist"].includes(arg)) {
      if (modeChosen) throw new Error("Use only one of --watch, --check, or --dist.");
      mode = arg;
      modeChosen = true;
    } else if (arg === "--outdir") {
      const value = args[++i];
      if (!value || value.startsWith("--")) throw new Error("--outdir requires a directory.");
      outputDirectory = resolve(__dirname, value);
    } else if (arg === "--retain-assets") retainAssets = true;
    else throw new Error(`Unknown build option: ${arg}`);
  }
  if (mode === "--watch") {
    const { runWatch } = await import("./tools/watch.mjs");
    await runWatch({
      projectRoot: __dirname,
      outputDirectory,
      files: BUILD_INPUT_FILES,
      directories: BUILD_INPUT_DIRS,
    });
  } else if (mode === "--check") {
    const architecture = await architectureAssetManifest();
    await buildScripts(architecture, await materialAssetManifest());
    console.log(`verified ${SCRIPT_ENTRIES.map(({ entry }) => entry).join(", ")}`);
  } else {
    await buildDist(outputDirectory, { retainAssets });
    console.log(`built deployable ${outputDirectory}`);
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  await main();
