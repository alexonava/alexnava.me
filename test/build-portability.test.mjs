import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileP = promisify(execFile);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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
