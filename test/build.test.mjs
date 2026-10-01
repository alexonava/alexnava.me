// build.mjs and its tools: staged output, watching, portability and shader compaction.

import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:net";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile, cp } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { publishBuild, validateOutputDirectory } from "../tools/build-output.mjs";
import { createRebuildQueue, isBuildInput, startWatching } from "../tools/watch.mjs";
import { assertPortAvailable, parseDevOptions } from "../tools/dev.mjs";
import { spawnOwned } from "../tools/owned-process.mjs";
import { BUILD_INPUT_FILES, BUILD_INPUT_DIRS, contentDateModified } from "../build.mjs";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { transform } from "esbuild";
import { compactShaderSource } from "../tools/shader-compact.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const scratchRoot = path.join(projectRoot, ".tmp-preview-review");

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fixture(t) {
  await mkdir(scratchRoot, { recursive: true });
  const root = await mkdtemp(path.join(scratchRoot, "build-development-"));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(root)), scratchRoot);
    await rm(root, { recursive: true, force: true });
  });
  return root;
}

async function snapshot(directory) {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  const files = await Promise.all(
    entries
      .filter((entry) => entry.isFile())
      .map(async (entry) => {
        const file = path.join(entry.parentPath, entry.name);
        return [path.relative(directory, file), (await readFile(file)).toString("base64")];
      }),
  );
  return Object.fromEntries(files.sort(([a], [b]) => a.localeCompare(b)));
}

test("staged builds retain the last good payload after errors and keep prior hashed assets only when requested", async (t) => {
  const root = await fixture(t);
  const output = path.join(root, "output");
  const prepare = (hash, text) => async (directory) => {
    await mkdir(path.join(directory, "scripts"));
    await writeFile(path.join(directory, "scripts", `app.${hash}.js`), text);
    await writeFile(
      path.join(directory, "index.html"),
      `<script src="/scripts/app.${hash}.js"></script>`,
    );
    await writeFile(path.join(directory, "robots.txt"), text);
  };
  await publishBuild({
    projectRoot: root,
    outputDirectory: output,
    prepare: prepare("11111111", "first"),
  });
  const before = await snapshot(output);
  await assert.rejects(
    publishBuild({
      projectRoot: root,
      outputDirectory: output,
      prepare: async (directory) => {
        await writeFile(path.join(directory, "index.html"), "incomplete");
        throw new Error("fixture compilation failed");
      },
    }),
    /fixture compilation failed/,
  );
  assert.deepEqual(await snapshot(output), before);
  await publishBuild({
    projectRoot: root,
    outputDirectory: output,
    retainAssets: true,
    prepare: prepare("22222222", "second"),
  });
  assert.equal(await readFile(path.join(output, "scripts", "app.11111111.js"), "utf8"), "first");
  assert.match(await readFile(path.join(output, "index.html"), "utf8"), /app\.22222222\.js/);
  assert.equal(await readFile(path.join(output, "robots.txt"), "utf8"), "second");
  await publishBuild({
    projectRoot: root,
    outputDirectory: output,
    prepare: prepare("33333333", "third"),
  });
  assert.deepEqual(await readdir(path.join(output, "scripts")), ["app.33333333.js"]);
});

test("watch builds retain an open page's split scene chunks until a full build", async (t) => {
  const root = await fixture(t);
  const output = path.join(root, "output");
  // A page still showing an older entry may lazily import its light-shafts chunk.
  const prepare = (hash) => async (directory) => {
    await mkdir(path.join(directory, "scripts"));
    for (const name of [`scene.${hash}`, `scene.shared.${hash}`, `scene.light-shafts.${hash}`]) {
      await writeFile(path.join(directory, "scripts", `${name}.js`), hash);
    }
    await writeFile(path.join(directory, "index.html"), hash);
  };
  await publishBuild({ projectRoot: root, outputDirectory: output, prepare: prepare("aaaaaaaa") });
  await publishBuild({
    projectRoot: root,
    outputDirectory: output,
    retainAssets: true,
    prepare: prepare("bbbbbbbb"),
  });
  assert.deepEqual((await readdir(path.join(output, "scripts"))).sort(), [
    "scene.aaaaaaaa.js",
    "scene.bbbbbbbb.js",
    "scene.light-shafts.aaaaaaaa.js",
    "scene.light-shafts.bbbbbbbb.js",
    "scene.shared.aaaaaaaa.js",
    "scene.shared.bbbbbbbb.js",
  ]);
  await publishBuild({ projectRoot: root, outputDirectory: output, prepare: prepare("cccccccc") });
  assert.deepEqual((await readdir(path.join(output, "scripts"))).sort(), [
    "scene.cccccccc.js",
    "scene.light-shafts.cccccccc.js",
    "scene.shared.cccccccc.js",
  ]);
});

test("output safety rejects source paths and nonempty directories that this builder does not own", async (t) => {
  const root = await fixture(t);
  for (const target of [
    root,
    path.dirname(root),
    path.join(root, "src"),
    path.join(root, "images", "nested"),
    path.join(root, ".git"),
  ]) {
    await assert.rejects(validateOutputDirectory(root, target), /project root|overwrite/);
  }
  const foreign = path.join(root, "foreign");
  await mkdir(foreign);
  await writeFile(path.join(foreign, "keep.txt"), "user work");
  await assert.rejects(
    publishBuild({
      projectRoot: root,
      outputDirectory: foreign,
      prepare: async () => assert.fail("must reject before compiling"),
    }),
    /must be empty/,
  );
  assert.equal(await readFile(path.join(foreign, "keep.txt"), "utf8"), "user work");
});

test("rebuild queue serializes saves, coalesces a burst, recovers after failure, and closes pending work", async () => {
  let running = 0;
  let maxRunning = 0;
  let calls = 0;
  const releases = [];
  const errors = [];
  const queue = createRebuildQueue(
    async () => {
      calls++;
      maxRunning = Math.max(maxRunning, ++running);
      await new Promise((resolve) => releases.push(resolve));
      running--;
      if (calls === 1) throw new Error("invalid source");
    },
    { debounceMs: 10, onError: (error) => errors.push(error.message) },
  );
  const initial = queue.flush();
  queue.request();
  queue.request();
  queue.request();
  releases.shift()();
  await delay(15);
  assert.equal(calls, 2);
  releases.shift()();
  await initial;
  assert.equal(maxRunning, 1);
  assert.deepEqual(errors, ["invalid source"]);
  queue.request();
  await queue.close();
  await delay(15);
  assert.equal(calls, 2);
});

test("watch classification covers every published input and ignores generated output", () => {
  const inputs = { files: BUILD_INPUT_FILES, directories: BUILD_INPUT_DIRS };
  assert.equal(isBuildInput(null, inputs), false, "unknown directory events need an input check");
  for (const file of [
    ...BUILD_INPUT_FILES,
    "src/scene/index.js",
    "images/new/nested.webp",
    "fonts/font.woff2",
    "tools/build-output.mjs",
  ]) {
    assert.ok(isBuildInput(file, inputs), `${file} must trigger a rebuild`);
    assert.ok(isBuildInput(file.replaceAll("/", "\\"), inputs));
  }
  for (const file of [
    "dist/index.html",
    ".cache/babel-build-x/index.html",
    ".wrangler/state/file",
    "node_modules/module/index.js",
    "README.md",
    "test/build-development.test.mjs",
  ]) {
    assert.equal(isBuildInput(file, inputs), false, `${file} must not create a rebuild loop`);
  }
});

test("sitemap lastmod reads dateModified only from index.md front matter", () => {
  assert.equal(
    contentDateModified("---\ntitle: A\ndateModified: 2026-09-11\n---\n# A\n"),
    "2026-09-11",
  );
  assert.equal(
    contentDateModified('\uFEFF---\r\ndateModified: "2026-01-02"\r\n---\r\n'),
    "2026-01-02",
  );
  assert.equal(contentDateModified("fixture\n"), undefined, "missing front matter falls back");
  assert.equal(contentDateModified("---\ntitle: A\n---\ndateModified: 2026-09-11\n"), undefined);
  assert.equal(contentDateModified("---\ndateModified: September\n---\n"), undefined);
});

test(
  "real project build starts once and stays idle through output and scratch writes",
  { timeout: 20000 },
  async (t) => {
    const scratch = await fixture(t);
    const output = path.join(scratch, "dist");
    const errors = [];
    let built = 0;
    const watching = startWatching({
      projectRoot,
      outputDirectory: output,
      files: BUILD_INPUT_FILES,
      directories: BUILD_INPUT_DIRS,
      debounceMs: 40,
      onBuilt: () => built++,
      onError: (error) => errors.push(error.message),
    });
    t.after(() => watching.close());
    let timeout;
    try {
      await Promise.race([
        watching.ready,
        watching.failed,
        new Promise((_resolve, reject) => {
          timeout = setTimeout(() => reject(new Error("Initial real build did not settle")), 10000);
        }),
      ]);
      clearTimeout(timeout);
      await delay(400);
      assert.equal(built, 1, "source reads and build publication must not schedule another build");
      await writeFile(path.join(output, "generated-write.txt"), "not a source input");
      await mkdir(path.join(scratch, ".cache", "generated"), { recursive: true });
      await writeFile(
        path.join(scratch, ".cache", "generated", "scratch.txt"),
        "not a source input",
      );
      await delay(600);
      assert.equal(built, 1, "writes beneath output and scratch directories must remain ignored");
      assert.deepEqual(errors, []);
      assert.match(
        await readFile(path.join(output, "index.html"), "utf8"),
        /scripts\/app\.[a-f0-9]{8}\.js/,
      );
    } finally {
      clearTimeout(timeout);
      await watching.close();
    }
  },
);

test("real watcher responds to HTML, CSS, public files, fonts, nested images and source edits without watching its output", async (t) => {
  const root = await fixture(t);
  const output = path.join(root, "dist");
  await mkdir(output);
  for (const directory of ["src", "images/nested", "fonts", "public"])
    await mkdir(path.join(root, directory), { recursive: true });
  await writeFile(
    path.join(root, "build.mjs"),
    'import { writeFile } from "node:fs/promises"; await writeFile(new URL("./dist/result.txt", import.meta.url), String(Date.now()));',
  );
  let built = 0;
  const watching = startWatching({
    projectRoot: root,
    outputDirectory: output,
    files: BUILD_INPUT_FILES,
    directories: BUILD_INPUT_DIRS,
    debounceMs: 20,
    onBuilt: () => built++,
    onError: (error) => assert.fail(error.message),
  });
  t.after(() => watching.close());
  await watching.ready;
  for (const file of [
    "index.html",
    "404.html",
    "styles.css",
    "public/_headers",
    "public/_redirects",
    "public/site-agents.md",
    "fonts/new.woff2",
    "images/nested/new.webp",
    "src/new.js",
  ]) {
    const before = built;
    await writeFile(path.join(root, file), "fixture");
    const deadline = Date.now() + 5000;
    while (built === before && Date.now() < deadline) await delay(20);
    assert.ok(built > before, `${file} did not rebuild`);
  }
  await delay(100);
  const settled = built;
  await writeFile(path.join(output, "manual.txt"), "not an input");
  await delay(150);
  assert.equal(built, settled);
  await watching.close();
});

test("dev options validate ports and busy-port refusal preserves the existing listener", async (t) => {
  assert.deepEqual(parseDevOptions([]), { port: 4173 });
  assert.deepEqual(parseDevOptions(["--port", "4181"]), { port: 4181 });
  for (const args of [
    ["--port"],
    ["--port", "0"],
    ["--port", "65536"],
    ["--port", "123x"],
    ["--remote"],
  ])
    assert.throws(() => parseDevOptions(args));
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const port = server.address().port;
  await assert.rejects(assertPortAvailable(port), /no existing process was stopped/);
  assert.equal(server.address().port, port);
});

test(
  "owned shutdown stops its child tree and leaves a separately launched process alive",
  { timeout: 15000 },
  async (t) => {
    const unrelated = spawnOwned(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      stdio: "ignore",
    });
    const owner = spawnOwned(
      process.execPath,
      [
        "-e",
        'const { spawn } = require("node:child_process"); const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" }); console.log(child.pid); setInterval(() => {}, 1000);',
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    t.after(async () => {
      await Promise.all([owner.stop(), unrelated.stop()]);
    });
    const descendant = await new Promise((resolve, reject) => {
      let text = "";
      owner.child.stdout.on("data", (chunk) => {
        text += chunk;
        if (text.includes("\n")) resolve(Number(text.trim()));
      });
      owner.child.once("error", reject);
    });
    assert.ok(Number.isInteger(descendant) && descendant > 0);
    await owner.stop();
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      try {
        process.kill(descendant, 0);
      } catch {
        break;
      }
      await delay(20);
    }
    assert.throws(() => process.kill(descendant, 0), /ESRCH|not found|no such process/i);
    assert.doesNotThrow(() => process.kill(unrelated.child.pid, 0));
  },
);

const execFileP = promisify(execFile);

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex").slice(0, 8);

// Exercise the actual builder in an isolated checkout-shaped fixture. Tiny
// binary assets and stub entries avoid copying the archived scene payload or
// racing bundle-output.test.mjs for the real dist/ directory.
test("CSS asset URLs and bytes are portable across checkout line endings", async () => {
  const scratchRoot = path.join(projectRoot, ".tmp-preview-review");
  await mkdir(scratchRoot, { recursive: true });
  const fixture = await mkdtemp(path.join(scratchRoot, "portable-css-"));
  const sourceCss = await readFile(path.join(projectRoot, "styles.css"));
  const paper = Buffer.from([82, 73, 70, 70, 13, 10, 0, 255, 87, 69, 66, 80]);
  try {
    await cp(path.join(projectRoot, "build.mjs"), path.join(fixture, "build.mjs"));
    await cp(path.join(projectRoot, "tools"), path.join(fixture, "tools"), { recursive: true });
    for (const dir of [
      "src",
      "fonts",
      "images/architecture",
      "images/materials",
      "public/.well-known",
    ]) {
      await mkdir(path.join(fixture, dir), { recursive: true });
    }
    for (const file of [
      "LICENSE",
      ...[
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
        "site-agents.md",
      ].map((name) => `public/${name}`),
    ]) {
      await writeFile(path.join(fixture, file), "fixture\n");
    }
    for (const file of ["app.js", "scene-entry.js"]) {
      await writeFile(path.join(fixture, "src", file), "void 0;\n");
    }
    for (const file of ["index.html", "404.html"]) {
      await writeFile(path.join(fixture, file), '<link rel="stylesheet" href="/styles.css">');
    }
    for (const name of [
      "paper-grain",
      "paper-edge",
      "paper-vignette-profile",
      "paper-vignette-experience",
      "paper-vignette-contact",
      "estate-map-desktop",
      "estate-map-portrait",
    ]) {
      await writeFile(path.join(fixture, "images", `${name}.webp`), paper);
    }
    for (const tier of ["high", "balanced"]) {
      for (const role of ["tower", "tree", "lantern", "lichen-rock", "weathered-stone"]) {
        await writeFile(path.join(fixture, "images", "architecture", `${role}-${tier}.glb`), paper);
      }
    }
    for (const map of ["color-1024", "normal-1024", "color-512", "normal-512", "detail-512"]) {
      await writeFile(path.join(fixture, "images", "materials", `slate-${map}.webp`), paper);
    }

    async function buildCss(css) {
      await writeFile(path.join(fixture, "styles.css"), css);
      await execFileP(
        process.execPath,
        ["build.mjs", "--dist", "--outdir", path.join(fixture, "dist")],
        { cwd: fixture },
      );
      const cssDir = path.join(fixture, "dist", "css");
      const names = await readdir(cssDir);
      assert.equal(names.length, 1);
      const name = names[0];
      const bytes = await readFile(path.join(cssDir, name));
      assert.equal(name, `styles.${hash(bytes)}.css`, "URL must fingerprint emitted bytes");
      for (const page of ["index.html", "404.html"]) {
        const html = await readFile(path.join(fixture, "dist", page), "utf8");
        assert.ok(html.includes(`/css/${name}`), `${page} must use the emitted stylesheet URL`);
      }
      return { name, bytes };
    }

    const lfSource = sourceCss.toString("utf8").replace(/\r\n?/g, "\n");
    const lf = await buildCss(lfSource);
    const crlf = await buildCss(lfSource.replace(/\n/g, "\r\n"));
    assert.deepEqual(crlf, lf, "LF and CRLF checkouts must publish identical CSS bytes and URLs");
    assert.ok(!crlf.bytes.includes(13), "emitted CSS must contain only LF line endings");
    assert.ok(crlf.bytes.toString("utf8").includes(`/images/paper-grain.${hash(paper)}.webp`));
    assert.deepEqual(
      await readFile(path.join(fixture, "dist", "images", `paper-grain.${hash(paper)}.webp`)),
      paper,
      "binary artwork, including CRLF bytes, must remain unchanged",
    );
    // A fingerprinted source is published only under its hashed name.
    await assert.rejects(readFile(path.join(fixture, "dist", "images", "paper-grain.webp")), {
      code: "ENOENT",
    });

    assert.ok(lf.bytes.length < Buffer.byteLength(lfSource), "the stylesheet is minified");
    assert.equal(
      await readFile(path.join(fixture, "dist", ".well-known", "security.txt"), "utf8"),
      "fixture\n",
      "nested static files are copied into their own directory",
    );

    const edited = await buildCss(`${lfSource}\n.portability-fixture { color: #123456; }\n`);
    assert.notEqual(edited.name, lf.name, "a real CSS change must still invalidate its URL");
    assert.ok(edited.bytes.toString("utf8").includes(".portability-fixture{color:#123456}"));
    const publishedHtml = await readFile(path.join(fixture, "dist", "index.html"));
    await writeFile(path.join(fixture, "src", "app.js"), "export const broken = ;");
    await assert.rejects(
      execFileP(process.execPath, ["build.mjs", "--dist", "--outdir", path.join(fixture, "dist")], {
        cwd: fixture,
      }),
    );
    assert.deepEqual(
      await readFile(path.join(fixture, "dist", "index.html")),
      publishedHtml,
      "a syntax error must leave the last successful page available",
    );
    assert.deepEqual(
      await readFile(path.join(fixture, "dist", "css", edited.name)),
      edited.bytes,
      "a syntax error must leave the last successful assets available",
    );
    await writeFile(path.join(fixture, "src", "app.js"), "void 0;");
    await rm(path.join(fixture, "public", "favicon.svg"));
    await assert.rejects(
      execFileP(process.execPath, ["build.mjs", "--dist", "--outdir", path.join(fixture, "dist")], {
        cwd: fixture,
      }),
    );
    assert.deepEqual(
      await readFile(path.join(fixture, "dist", "index.html")),
      publishedHtml,
      "a missing copied input must also preserve the last successful page",
    );
    assert.deepEqual(
      await readFile(path.join(projectRoot, "styles.css")),
      sourceCss,
      "the tracked stylesheet must not be modified by this regression test",
    );
  } finally {
    assert.equal(path.dirname(path.resolve(fixture)), scratchRoot);
    await rm(fixture, { recursive: true, force: true });
  }
});

test("no tracked text file carries a U+FFFD replacement character", async () => {
  // A lost encoding round trip leaves U+FFFD where a character was.
  const { stdout } = await execFileP("git", ["ls-files", "-z"], { cwd: projectRoot });
  const binary = /\.(?:woff2|glb|webp|png|ico|jpg)$/;
  const replacement = Buffer.from("\uFFFD", "utf8");
  let checked = 0;
  for (const file of stdout.split("\0").filter((name) => name && !binary.test(name))) {
    let bytes;
    try {
      bytes = await readFile(path.join(projectRoot, file));
    } catch (error) {
      if (error.code === "ENOENT") continue; // deleted in the working tree
      throw error;
    }
    assert.equal(bytes.indexOf(replacement), -1, `${file} carries U+FFFD`);
    checked++;
  }
  assert.ok(checked > 50, `${checked} text files checked`);
});

test("shader compaction strips GLSL indentation, comments and spaces but keeps directives and expressions", () => {
  const source = [
    "const a = `",
    "  #ifdef USE_MAP",
    "    float x = a * b; // a comment",
    "",
    "    vec2 y = vec2( 1.0, x );",
    "    float z = a - -b;",
    "  #endif",
    "  float w = ${value} * 2.0;",
    "  gl_FragColor.a = ${alpha};`;",
    "const b = `  plain   text ${x}  `;",
    "const re = /`[^`]*`/g, half = 1 / 2 / 3;",
    'const s = "`  float not = 1;  `";',
  ].join("\n");
  const out = compactShaderSource(source);
  assert.equal(
    out,
    [
      "const a = `",
      "#ifdef USE_MAP",
      "float x=a*b;vec2 y=vec2(1.0,x);float z=a- -b;",
      "#endif",
      // Spaces at a ${} edge stay: the expression may end in anything.
      "float w= ${value} *2.0;",
      "gl_FragColor.a= ${alpha};`;",
      "const b = `  plain   text ${x}  `;",
      "const re = /`[^`]*`/g, half = 1 / 2 / 3;",
      'const s = "`  float not = 1;  `";',
    ].join("\n"),
  );
  assert.equal(compactShaderSource(out), out, "idempotent");
  // A regex after a comment (three's /*@__PURE__*/ style) is still a regex.
  assert.equal(compactShaderSource("x = /*c*/ /`/.source;"), "x = /*c*/ /`/.source;");
  assert.throws(() => compactShaderSource("const a = `float x;"), /unterminated template literal/);
});

test("every scene module compacts to JavaScript that still parses and minifies no larger", async () => {
  const dir = new URL("../src/scene/", import.meta.url);
  let before = 0,
    after = 0;
  for (const name of (await readdir(dir)).filter((file) => file.endsWith(".js"))) {
    const source = await readFile(new URL(name, dir), "utf8");
    const compact = compactShaderSource(source);
    const a = (await transform(source, { minify: true, format: "esm" })).code;
    const b = (await transform(compact, { minify: true, format: "esm" })).code;
    assert.ok(b.length <= a.length, name);
    before += a.length;
    after += b.length;
  }
  assert.ok(before - after > 2000, `saved ${before - after} bytes`);
});
