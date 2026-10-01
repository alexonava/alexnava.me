// The hosting contract: headers, redirects, discovery files, icons and robots.

import assert from "node:assert/strict";
import test from "node:test";
import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));

const projectRoot = path.resolve(testDir, "..");

async function readProjectFile(relativePath) {
  return readFile(path.join(projectRoot, relativePath), "utf8");
}

test("the page names its committed share image for social previews", async () => {
  const indexHtml = await readProjectFile("index.html");
  await access(path.join(projectRoot, "public", "og.png"));
  assert.match(indexHtml, /property="og:image"\s+content="https:\/\/alexnava\.me\/og\.png"/);
  assert.match(indexHtml, /name="twitter:image"\s+content="https:\/\/alexnava\.me\/og\.png"/);
  assert.match(indexHtml, /name="twitter:card"\s+content="summary_large_image"/);
});

test("public agent-discovery files keep their own headers and the page links its Markdown", async () => {
  const headers = await readProjectFile("public/_headers");
  const indexHtml = await readProjectFile("index.html");
  for (const pathName of ["/llms.txt", "/AGENTS.md", "/index.md", "/sitemap.md"]) {
    assert.match(headers, new RegExp(`${pathName.replace(".", "\\.")}\\r?\\n\\s+Cache-Control`));
  }
  assert.match(
    headers,
    /\/llms\.txt\r?\n\s+Cache-Control[\s\S]*?Content-Type: text\/plain; charset=utf-8/,
  );
  assert.match(indexHtml, /rel="alternate" type="text\/markdown" href="\/index\.md"/);
  assert.match(indexHtml, /application\/ld\+json/);
});

// RFC 9309 groups: consecutive user-agent lines share the rules that follow them.
function parseRobotsGroups(text) {
  const groups = [];
  const directives = [];
  let current = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const separator = line.indexOf(":");
    assert.ok(separator > 0, `robots.txt line has no directive: ${rawLine}`);
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    directives.push(field);
    if (field === "user-agent") {
      if (!current || current.rules.length > 0) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
    } else if (field === "allow" || field === "disallow") {
      assert.ok(current, `robots.txt rule appears before any user-agent: ${rawLine}`);
      current.rules.push(`${field}: ${value}`);
    }
  }
  return { groups, directives };
}

test("robots.txt declines AI training but keeps search and citation crawlers welcome", async () => {
  const robots = await readProjectFile("public/robots.txt");
  const { groups, directives } = parseRobotsGroups(robots);

  // Lighthouse's robots-txt audit (SEO must stay at 1) fails on unknown directives.
  for (const field of directives) {
    assert.ok(
      ["user-agent", "allow", "disallow", "sitemap"].includes(field),
      `robots.txt uses a directive Lighthouse rejects: ${field}`,
    );
  }
  assert.match(robots, /^Sitemap: https:\/\/alexnava\.me\/sitemap\.xml$/m);

  const rulesFor = (token) =>
    groups.filter((group) => group.agents.includes(token.toLowerCase())).flatMap((g) => g.rules);
  assert.deepEqual(rulesFor("*"), ["allow: /"]);

  // Exactly the training crawlers blocked in AI Crawl Control, plus Apple's opt-out token.
  const trainingCrawlers = [
    "Amazonbot",
    "Applebot-Extended",
    "Bytespider",
    "CCBot",
    "ClaudeBot",
    "FacebookBot",
    "GPTBot",
    "meta-externalagent",
  ];
  const named = [...new Set(groups.flatMap((group) => group.agents))].filter((a) => a !== "*");
  assert.deepEqual(
    named.sort(),
    trainingCrawlers.map((token) => token.toLowerCase()).sort(),
    "robots.txt names exactly the training crawlers recorded in OPERATIONS item 6",
  );
  for (const token of trainingCrawlers) {
    assert.deepEqual(rulesFor(token), ["disallow: /"], `${token} must be fully disallowed`);
  }

  // Search engines, AI search, archives, link previews, and assistants fetching a page for a
  // person fall through to *, including the siblings of each blocked training crawler.
  for (const token of [
    "Googlebot",
    "Google-Extended", // also governs Gemini grounding and citations
    "Bingbot",
    "Applebot",
    "DuckDuckBot",
    "YandexBot",
    "Baiduspider",
    "PetalBot",
    "OAI-SearchBot",
    "ChatGPT-User",
    "Claude-SearchBot",
    "Claude-User",
    "PerplexityBot",
    "Perplexity-User",
    "DuckAssistBot",
    "MistralAI-User",
    "Amzn-SearchBot",
    "Amzn-User",
    "meta-webindexer",
    "meta-externalfetcher",
    "facebookexternalhit",
    "archive.org_bot",
    "Arquivo-web-crawler",
  ]) {
    assert.deepEqual(rulesFor(token), [], `${token} must not be named in robots.txt`);
  }

  // The decision is recorded next to the Cloudflare setting that enforces it.
});

test("the share card's backdrop stays in tools/, outside the published images", async () => {
  const card = await readProjectFile("tools/og-card.html");
  await access(path.join(projectRoot, "tools", "og-card-backdrop.webp"));
  assert.match(card, /url\("og-card-backdrop\.webp"\)/);
  assert.doesNotMatch(card, /\.\.\/images\//);
});

test("Cloudflare Pages headers preserve the static security contract", async () => {
  const headers = await readProjectFile("public/_headers");
  const indexHtml = await readProjectFile("index.html");

  assert.match(headers, /^\/\*\r?\n/m);
  assert.match(headers, /!\s*Access-Control-Allow-Origin/);
  assert.match(headers, /X-Content-Type-Options:\s*nosniff/);
  assert.match(headers, /Referrer-Policy:\s*strict-origin-when-cross-origin/);
  assert.match(headers, /X-Frame-Options:\s*DENY/);
  assert.match(headers, /Cross-Origin-Opener-Policy:\s*same-origin/);
  assert.match(headers, /Cross-Origin-Resource-Policy:\s*same-origin/);
  assert.match(
    headers,
    /Permissions-Policy:\s*camera=\(\), microphone=\(\), geolocation=\(\), payment=\(\), usb=\(\)/,
  );
  assert.match(
    headers,
    /Content-Security-Policy:\s*default-src 'self'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'; frame-src 'none'; object-src 'none'; worker-src 'none'; img-src 'self' data: blob:; font-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self' blob:/,
  );

  const hsts = headers.match(/Strict-Transport-Security:\s*max-age=(\d+); includeSubDomains\r?$/m);
  assert.ok(hsts, "HSTS must include subdomains");
  assert.ok(Number(hsts[1]) >= 31_536_000, "HSTS max-age must be at least 12 months");
  // Sending preload counts as a request to join the browser preload list (declined in OPERATIONS).
  assert.doesNotMatch(headers, /Strict-Transport-Security:[^\r\n]*preload/i);
  assert.doesNotMatch(headers, /Access-Control-Allow-Origin:\s*\*/);
  assert.doesNotMatch(headers, /static\.cloudflareinsights\.com/);
  assert.doesNotMatch(indexHtml, /static\.cloudflareinsights\.com/);
});

test("redirect contract stays limited to known legacy paths", async () => {
  const redirects = await readProjectFile("public/_redirects");
  const redirectLines = redirects
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));

  assert.deepEqual(redirectLines, [
    "/explore / 301",
    "/tower-world / 301",
    "/tower-world.html / 301",
    "/babel_explorable_world.html / 301",
    "/explore/* / 301",
    "/prototype/* / 301",
  ]);
});

test("static headers separate immutable fingerprints from revalidated stable assets", async () => {
  const headers = await readProjectFile("public/_headers");

  assert.match(headers, /Strict-Transport-Security:\s*max-age=31536000; includeSubDomains\r?$/m);
  for (const directive of ["form-action 'none'", "frame-src 'none'", "worker-src 'none'"]) {
    assert.match(headers, new RegExp(directive.replace(" ", "\\s+")));
  }
  assert.doesNotMatch(
    headers,
    /X-Robots-Tag/i,
    "static Pages headers cannot safely scope X-Robots-Tag by hostname",
  );
  assert.doesNotMatch(
    headers,
    /^https?:\/\//m,
    "absolute URL patterns are not supported in the Pages _headers file",
  );
  const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const stablePath of [
    "/favicon.svg",
    "/favicon.ico",
    "/icon.svg",
    "/icon-maskable.svg",
    "/apple-touch-icon.png",
    "/icon-192.png",
    "/icon-512.png",
    "/icon-maskable-512.png",
    "/manifest.webmanifest",
    "/og.png",
    "/robots.txt",
    "/sitemap.xml",
    "/LICENSE",
    "/.well-known/security.txt",
    "/fonts/*",
  ]) {
    assert.match(
      headers,
      new RegExp(
        `^${escape(stablePath)}\\r?\\n\\s+Cache-Control: public, max-age=604800, must-revalidate`,
        "m",
      ),
    );
  }
  for (const textPath of ["/LICENSE", "/.well-known/security.txt"]) {
    assert.match(
      headers,
      new RegExp(
        `^${escape(textPath)}\\r?\\n\\s+Cache-Control[^\\r\\n]*\\r?\\n\\s+Content-Type: text/plain; charset=utf-8`,
        "m",
      ),
    );
  }
  for (const fingerprintedPath of [
    "/css/styles.*.css",
    "/scripts/app.*.js",
    "/scripts/scene.*.js",
  ]) {
    assert.match(
      headers,
      new RegExp(
        `${escape(fingerprintedPath)}\\r?\\n\\s+Cache-Control: public, max-age=31536000, immutable`,
      ),
    );
  }
  // Fingerprinted fonts, artwork, models and maps also match /fonts/* or
  // /images/*, so these rules detach that rule's Cache-Control.
  for (const fingerprintedPath of [
    "/fonts/:name.:hash.woff2",
    "/images/:name.:hash.webp",
    "/images/architecture/:name.:hash.glb",
    "/images/materials/slate-:map.:hash.webp",
  ]) {
    assert.match(
      headers,
      new RegExp(
        `^${escape(fingerprintedPath)}\\r?\\n\\s+! Cache-Control\\r?\\n\\s+Cache-Control: public, max-age=31536000, immutable`,
        "m",
      ),
    );
  }
});

// Cloudflare Pages applies every matching _headers rule in file order: "! Name"
// deletes the value so far and a repeated header joins with ", ". A splat
// matches any characters; a :placeholder matches any except "/".
function parsePagesHeaders(text) {
  const rules = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("/")) {
      const pattern = line
        .split("*")
        .map((part) => part.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&"))
        .join(".*")
        .replace(/:[A-Za-z]\w*/g, "[^/]+");
      rules.push({ pattern: new RegExp(`^${pattern}$`), set: [], unset: [] });
    } else if (line.startsWith("! ")) {
      rules.at(-1).unset.push(line.slice(2).trim().toLowerCase());
    } else {
      const colon = line.indexOf(":");
      const name = line.slice(0, colon).trim().toLowerCase();
      rules.at(-1).set.push([name, line.slice(colon + 1).trim()]);
    }
  }
  return (pathname) => {
    const headers = new Map();
    const declared = new Set();
    for (const rule of rules.filter(({ pattern }) => pattern.test(pathname))) {
      for (const name of rule.unset) headers.delete(name);
      for (const [name, value] of rule.set) {
        const joined = declared.has(name) && headers.has(name);
        headers.set(name, joined ? `${headers.get(name)}, ${value}` : value);
        declared.add(name);
      }
    }
    return headers;
  };
}

test("Pages header rules resolve one cache policy for stable and fingerprinted paths", async () => {
  const headersFor = parsePagesHeaders(await readProjectFile("public/_headers"));
  const cacheControl = (pathname) => headersFor(pathname).get("cache-control");
  const immutable = "public, max-age=31536000, immutable";
  const revalidated = "public, max-age=604800, must-revalidate";
  const hash = "0123abcd";

  for (const pathname of ["/index.html", "/404.html"]) {
    assert.equal(cacheControl(pathname), "public, max-age=0, must-revalidate", pathname);
  }
  for (const pathname of [
    `/css/styles.${hash}.css`,
    `/scripts/app.${hash}.js`,
    `/scripts/scene.${hash}.js`,
    `/scripts/scene.shared.${hash}.js`,
    `/scripts/scene.light-shafts.${hash}.js`,
    `/scripts/scene.rock-build.${hash}.js`,
  ]) {
    assert.equal(cacheControl(pathname), immutable, pathname);
  }
  for (const pathname of [
    "/favicon.ico",
    "/apple-touch-icon.png",
    "/icon-192.png",
    "/icon-512.png",
    "/icon-maskable-512.png",
    "/.well-known/security.txt",
    "/LICENSE",
    "/fonts/OFL.txt",
  ]) {
    assert.equal(cacheControl(pathname), revalidated, pathname);
  }
  // The build publishes each font only as name.HASH.woff2.
  const fonts = (await readdir(path.join(projectRoot, "fonts"))).filter((name) =>
    name.endsWith(".woff2"),
  );
  assert.ok(fonts.length >= 2);
  for (const name of fonts) {
    const hashed = `/fonts/${name.replace(/\.woff2$/, `.${hash}.woff2`)}`;
    assert.equal(cacheControl(hashed), immutable, hashed);
  }
  for (const pathname of ["/LICENSE", "/.well-known/security.txt", "/llms.txt"]) {
    assert.equal(headersFor(pathname).get("content-type"), "text/plain; charset=utf-8", pathname);
  }

  // The build publishes top-level artwork, the architecture models and the
  // film slate's maps only as name.HASH.ext, which are immutable; any other
  // image would keep a revalidated plain URL.
  let fingerprintable = 0;
  const images = path.join(projectRoot, "images");
  for (const entry of await readdir(images, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const relative = path
      .relative(images, path.join(entry.parentPath, entry.name))
      .split(path.sep)
      .join("/");
    const stable = `/images/${relative}`;
    const hashed = stable.replace(/\.(\w+)$/, `.${hash}.$1`);
    const hashedByBuild =
      /^(?:[^/]+\.webp|architecture\/[^/]+\.glb|materials\/slate-[^/]+\.webp)$/.test(relative);
    fingerprintable += hashedByBuild;
    assert.equal(cacheControl(stable), revalidated, stable);
    assert.equal(cacheControl(hashed), hashedByBuild ? immutable : revalidated, hashed);
    assert.equal(headersFor(hashed).get("x-content-type-options"), "nosniff", hashed);
  }
  assert.equal(fingerprintable, 22, "5 paper textures, 2 estate maps, 10 models and 5 slate maps");
});

test("hosting files publish security.txt, raster icons and a stable manifest id", async () => {
  const buildScript = await readProjectFile("build.mjs");
  const indexHtml = await readProjectFile("index.html");
  const manifest = JSON.parse(await readProjectFile("public/manifest.webmanifest"));
  const securityTxt = await readProjectFile("public/.well-known/security.txt");

  // RFC 9116 requires Contact and Expires, recommended under a year out. The
  // check fails a month early so the renewal ships while the live file is valid.
  assert.match(securityTxt, /^Contact: mailto:alexonava@gmail\.com$/m);
  assert.match(securityTxt, /^Preferred-Languages: en$/m);
  assert.match(securityTxt, /^Canonical: https:\/\/alexnava\.me\/\.well-known\/security\.txt$/m);
  const expires = securityTxt.match(/^Expires: (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)$/m);
  assert.ok(expires, "security.txt needs an RFC 3339 UTC Expires field");
  const day = 24 * 60 * 60 * 1000;
  const remaining = Date.parse(expires[1]) - Date.now();
  assert.ok(
    remaining > 30 * day,
    `security.txt expires ${expires[1]}: move Expires in public/.well-known/security.txt up to a year ahead`,
  );
  assert.ok(remaining <= 366 * day, "security.txt Expires should stay under a year ahead");

  for (const [file, size, opaque] of [
    ["apple-touch-icon.png", 180, true],
    ["icon-192.png", 192, false],
    ["icon-512.png", 512, false],
    ["icon-maskable-512.png", 512, true],
  ]) {
    const png = await readFile(path.join(projectRoot, "public", file));
    assert.equal(png.toString("latin1", 1, 4), "PNG", file);
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [size, size], file);
    // Full-bleed icons carry no alpha: iOS and maskable launchers crop them.
    if (opaque) {
      assert.ok([2, 3].includes(png[25]) && !png.includes("tRNS"), `${file} must be opaque`);
    }
  }
  const ico = await readFile(path.join(projectRoot, "public", "favicon.ico"));
  assert.deepEqual([ico.readUInt16LE(0), ico.readUInt16LE(2)], [0, 1], "favicon.ico is an icon");
  const icoEntries = Array.from({ length: ico.readUInt16LE(4) }, (_, i) => 6 + i * 16);
  assert.deepEqual(
    icoEntries.map((at) => ico[at]).sort((a, b) => a - b),
    [16, 32],
  );
  for (const at of icoEntries)
    assert.ok(
      ico.readUInt32LE(at + 12) + ico.readUInt32LE(at + 8) <= ico.length,
      "favicon.ico images lie inside the file",
    );

  assert.equal(manifest.id, "/");
  assert.deepEqual(
    manifest.icons.map(({ src, type, sizes, purpose }) => [src, type, sizes, purpose]),
    [
      ["/icon.svg", "image/svg+xml", "any", "any"],
      ["/icon-maskable.svg", "image/svg+xml", "any", "maskable"],
      ["/icon-192.png", "image/png", "192x192", "any"],
      ["/icon-512.png", "image/png", "512x512", "any"],
      ["/icon-maskable-512.png", "image/png", "512x512", "maskable"],
    ],
  );
  // The ICO fallback precedes the SVG, which browsers then prefer.
  assert.match(
    indexHtml,
    /<link rel="icon" href="\/favicon\.ico" sizes="32x32" \/>\s*<link rel="icon" href="\/favicon\.svg" type="image\/svg\+xml" \/>/,
  );
  assert.match(indexHtml, /<link rel="apple-touch-icon" href="\/apple-touch-icon\.png" \/>/);
});
