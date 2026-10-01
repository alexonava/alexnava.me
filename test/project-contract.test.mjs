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

test("Cloudflare preview credentials run separately from pull-request build code", async () => {
  const deploy = await readProjectFile(".github/workflows/deploy.yml");
  const preview = await readProjectFile(".github/workflows/preview.yml");

  assert.doesNotMatch(deploy, /\n    env:\r?\n      CLOUDFLARE_API_TOKEN:/);
  assert.match(
    deploy,
    /- name: Deploy to Cloudflare Pages[\s\S]*?env:[\s\S]*?CLOUDFLARE_API_TOKEN:/,
  );
  assert.match(preview, /\n  build:\r?\n[\s\S]*?npm run build:dist/);
  assert.match(preview, /uses: actions\/upload-artifact@/);
  assert.match(preview, /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/);
  assert.match(preview, /uses: actions\/download-artifact@/);
  // The preview job installs the same wrangler the lockfile resolves.
  const lock = JSON.parse(await readProjectFile("package-lock.json"));
  const wrangler = lock.packages["node_modules/wrangler"].version;
  assert.ok(
    preview.includes(
      `npm install --global --ignore-scripts --no-audit --no-fund wrangler@${wrangler}`,
    ),
    `the preview job installs wrangler@${wrangler}`,
  );
  assert.match(
    preview,
    /- name: Deploy preview to Cloudflare Pages[\s\S]*?env:[\s\S]*?CLOUDFLARE_API_TOKEN:/,
  );
  assert.doesNotMatch(preview, /npx wrangler/);

  const credentialedJob = preview.slice(preview.indexOf("\n  preview:"));
  assert.doesNotMatch(credentialedJob, /actions\/checkout@/);
  assert.doesNotMatch(credentialedJob, /\brun:\s*npm ci\b/);
  assert.doesNotMatch(credentialedJob, /npm run build:dist/);
});

test("deploy workflows expose environment metadata and use explicit missing-credential policies", async () => {
  const deploy = await readProjectFile(".github/workflows/deploy.yml");
  const preview = await readProjectFile(".github/workflows/preview.yml");

  assert.match(
    deploy,
    /environment:\r?\n\s+name:\s*production\r?\n\s+url:\s*https:\/\/alexnava\.me\//,
  );
  assert.match(
    preview,
    /environment:\r?\n\s+name:\s*preview\r?\n\s+url:\s*\$\{\{\s*steps\.deploy\.outputs\.url\s*\}\}/,
  );
  assert.match(deploy, /Production deploy requires[\s\S]*?exit 1/);
  assert.doesNotMatch(deploy, /skipping deploy/i);
  assert.match(preview, /ready=false[\s\S]*?skipping preview deploy[\s\S]*?exit 0/i);
});

test("deploys smoke-check what they published: production through the shared script, previews inline", async () => {
  const deploy = await readProjectFile(".github/workflows/deploy.yml");
  const preview = await readProjectFile(".github/workflows/preview.yml");
  const smoke = await readProjectFile(".github/scripts/smoke-pages.sh");

  // The script's own behaviour is tested in smoke-pages.test.mjs.
  assert.match(deploy, /run:\s*bash \.github\/scripts\/smoke-pages\.sh "\$DEPLOYMENT_URL"/);
  assert.match(
    smoke,
    /\[\[ ! "\$deployment_url" =~ \^https:\/\/\[a-z0-9-\]\+\\\.alexnava-me\\\.pages\\\.dev\$\s*\]\]/,
  );
  assert.match(smoke, /for attempt in /, "the deployment URL is retried");
  assert.doesNotMatch(smoke, /--location/);
  assert.match(preview, /PREVIEW_URL:\s*\$\{\{\s*steps\.deploy\.outputs\.url\s*\}\}/);
  assert.match(preview, /short_branch="preview-\$\{branch_slug\}"/);
  assert.match(preview, /\[ "\$status" = "200" \]/);
  assert.match(preview, /\[ "\$effective_host" = "\$expected_host" \]/);
  assert.doesNotMatch(preview, /--location/);
  assert.match(preview, /c\.user\?\.login === 'github-actions\[bot\]'/);
  assert.match(
    preview,
    /comment:\r?\n\s+if:[^\r\n]*needs\.preview\.outputs\.ready[^\r\n]*\r?\n\s+needs: preview[\s\S]*?permissions:\r?\n\s+contents: read\r?\n\s+pull-requests: write/,
  );
  assert.doesNotMatch(preview, /^permissions:\r?\n\s+contents: read\r?\n\s+pull-requests: write/m);
});

test("dependency auditing gates every build and deploy workflow at high severity", async () => {
  const packageJson = JSON.parse(await readProjectFile("package.json"));
  const workflowNames = ["ci.yml", "deploy.yml", "preview.yml", "lighthouse.yml"];

  assert.equal(packageJson.scripts["audit:ci"], "npm audit --audit-level=high");
  for (const workflowName of workflowNames) {
    const workflow = await readProjectFile(path.join(".github", "workflows", workflowName));
    assert.match(workflow, /run:\s*npm run audit:ci/);
  }
});

test("Lighthouse uses repository artifacts and hard performance-quality budgets", async () => {
  const lighthouse = JSON.parse(await readProjectFile("lighthouserc.json"));
  const workflow = await readProjectFile(".github/workflows/lighthouse.yml");
  const { collect, assert: assertionConfig } = lighthouse.ci;
  const assertions = assertionConfig.assertions;

  assert.equal(collect.numberOfRuns, 3);
  assert.deepEqual(collect.url, ["http://localhost/"]);
  assert.equal(assertionConfig.aggregationMethod, "median");
  assert.deepEqual(assertions["categories:performance"], ["error", { minScore: 0.8 }]);
  assert.deepEqual(assertions["categories:accessibility"], ["error", { minScore: 1 }]);
  assert.deepEqual(assertions["categories:best-practices"], ["error", { minScore: 0.95 }]);
  assert.deepEqual(assertions["categories:seo"], ["error", { minScore: 1 }]);
  assert.deepEqual(assertions["largest-contentful-paint"], ["error", { maxNumericValue: 2500 }]);
  assert.deepEqual(assertions["cumulative-layout-shift"], ["error", { maxNumericValue: 0.1 }]);
  assert.deepEqual(assertions["total-blocking-time"], ["error", { maxNumericValue: 200 }]);
  assert.match(workflow, /uploadArtifacts:\s*true/);
  assert.match(workflow, /temporaryPublicStorage:\s*false/);
  assert.doesNotMatch(workflow, /pull-requests:\s*write/);
});

test("Cloudflare audit is scheduled, manual, least-privilege, and sanitized", async () => {
  const workflow = await readProjectFile(".github/workflows/cloudflare-audit.yml");

  assert.match(workflow, /schedule:\r?\n\s+- cron:\s*"[^"]+"/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /audit:\r?\n\s+if:\s*github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /permissions:\r?\n\s+contents:\s*read/);
  // Redirects are inspected, never followed.
  assert.match(workflow, /--max-redirs 0/);
  assert.doesNotMatch(workflow, /--location\b/);
  assert.match(workflow, /\[ "\$apex_status" != "200" \]/);
  assert.match(workflow, /\[ "\$apex_effective_url" != "https:\/\/alexnava\.me\/" \]/);
  assert.match(workflow, /\[ "\$pages_status" = "301" \]/);
  assert.match(workflow, /\[ "\$www_status" != "301" \]/);
  assert.match(workflow, /sanitize_headers /);
  // Nothing dumps the raw project or traces a command line with a token.
  assert.doesNotMatch(workflow, /cat "\$raw_project"/);
  assert.doesNotMatch(workflow, /set -x/);
});

test("Cloudflare audit checks dashboard-owned edge settings outside the rollback path", async () => {
  const workflow = await readProjectFile(".github/workflows/cloudflare-audit.yml");
  const smoke = await readProjectFile(".github/scripts/smoke-pages.sh");
  const deploy = await readProjectFile(".github/workflows/deploy.yml");

  const edgeStart = workflow.indexOf("\n  edge-settings:");
  assert.ok(edgeStart > workflow.indexOf("\n  audit:"), "edge checks run as a separate job");
  const edge = workflow.slice(edgeStart);
  assert.match(edge, /^\s+edge-settings:\r?\n\s+if:\s*github\.ref == 'refs\/heads\/main'/);
  assert.match(edge, /\n\s+permissions:\s*\{\}\r?\n/);
  assert.doesNotMatch(edge, /secrets\.|environment:/, "edge checks need no credentials");
  assert.match(edge, /browser_ua="Mozilla\/5\.0 [^"\r\n]*Chrome\/[^"\r\n]*"/);
  assert.match(edge, /--user-agent "\$browser_ua"/);
  assert.match(edge, /--header 'Accept: text\/html,application\/xhtml\+xml/);
  assert.match(edge, /--max-redirs 0/);

  // Email obfuscation, injected third-party scripts and appended no-store.
  assert.match(edge, /grep -Fq 'href="mailto:alexonava@gmail\.com"'/);
  assert.match(edge, /! grep -Fq '\/cdn-cgi\/l\/email-protection'/);
  assert.match(edge, /grep -oiE '<script\[\^>\]\*>'/);
  assert.match(edge, /\[ "\$host" != "\$origin_host" \]/);
  assert.match(edge, /html_cache_control,,\}" == \*no-store\*/);

  // Fingerprinted assets: app, CSS, the named scene entry and its static chunks.
  assert.match(edge, /\/scripts\/app\\\.\[a-f0-9\]\{8\}\\\.js/);
  assert.match(edge, /\/css\/styles\\\.\[a-f0-9\]\{8\}\\\.css/);
  assert.match(edge, /name="babel:scene-script"/);
  assert.match(
    edge,
    /\(from\|import\)\[\[:space:\]\]\*/,
    "only static imports name checked chunks",
  );
  assert.match(edge, /\^\/scripts\/scene\\\.shared\\\.\[a-f0-9\]\{8\}\\\.js\$/);
  assert.match(edge, /cache_control,,\}" != \*immutable\*/);
  assert.match(edge, /cache_control,,\}" == \*no-store\*/);

  // A fingerprinted GLB must come back compressed.
  assert.match(edge, /\/images\/architecture\/tower-high\\\.\[a-f0-9\]\{8\}\\\.glb/);
  assert.match(edge, /--header 'Accept-Encoding: br, gzip'/);
  assert.match(edge, /200:br \| 200:gzip\)/);

  // Every failure is collected and reported before the job fails.
  assert.match(edge, /failures\+=\(/);
  assert.match(edge, /if \[ "\$\{#failures\[@\]\}" -gt 0 \]; then[\s\S]*?exit 1/);
  assert.match(edge, /GITHUB_STEP_SUMMARY/);

  // Rollback cannot fix dashboard settings, so none of this reaches the smoke path.
  for (const rollbackPath of [smoke, deploy]) {
    assert.doesNotMatch(
      rollbackPath,
      /no-store|email-protection|Accept-Encoding|cloudflareinsights/i,
    );
    assert.doesNotMatch(rollbackPath, /cloudflare-audit|edge-settings/);
  }
});

test("CodeQL default setup is not duplicated by a workflow", async () => {
  const workflowDir = path.join(projectRoot, ".github", "workflows");
  const workflowFiles = await readdir(workflowDir);

  assert.equal(
    workflowFiles.some((file) => /codeql/i.test(file)),
    false,
    "CodeQL default setup should not be duplicated by an advanced-setup workflow",
  );
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
  // Fingerprinted artwork, models and maps also match /images/*, so these
  // rules detach that rule's Cache-Control.
  for (const fingerprintedPath of [
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
    "/fonts/instrument-sans-400.woff2",
  ]) {
    assert.equal(cacheControl(pathname), revalidated, pathname);
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
  const icoSizes = Array.from({ length: ico.readUInt16LE(4) }, (_, i) => ico[6 + i * 16]);
  assert.deepEqual(
    icoSizes.sort((a, b) => a - b),
    [16, 32, 48],
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

test("production deploy is workflow-owned and explicitly publishes main", async () => {
  const packageJson = JSON.parse(await readProjectFile("package.json"));
  const deploy = await readProjectFile(".github/workflows/deploy.yml");

  assert.match(deploy, /npx wrangler pages deploy dist --project-name=alexnava-me --branch=main/);
  assert.match(deploy, /if:\s*github\.ref == 'refs\/heads\/main'/);
  assert.match(deploy, /group:\s*pages-production\r?\n\s+cancel-in-progress:\s*false/);
});

test("production deploy captures and verifies an automatic Pages rollback target", async () => {
  const deploy = await readProjectFile(".github/workflows/deploy.yml");
  const smoke = await readProjectFile(".github/scripts/smoke-pages.sh");

  await access(path.join(projectRoot, ".github", "scripts", "smoke-pages.sh"));
  assert.match(
    deploy,
    /https:\/\/api\.cloudflare\.com\/client\/v4\/accounts\/\$CLOUDFLARE_ACCOUNT_ID\/pages\/projects\/alexnava-me"/,
  );
  assert.match(deploy, /\.result\.canonical_deployment\.environment == "production"/);
  assert.match(deploy, /\.result\.canonical_deployment\.latest_stage\.status == "success"/);
  assert.match(deploy, /deployment_id=\$deployment_id/);
  assert.match(deploy, /deployment_url=\$\{deployment_url%\/\}/);
  assert.match(
    deploy,
    /if:\s*failure\(\) && steps\.deploy\.outcome == 'success'[\s\S]*?\/deployments\/\$PREVIOUS_DEPLOYMENT_ID\/rollback/,
  );
  assert.match(
    deploy,
    /if:\s*failure\(\) && steps\.deploy\.outcome == 'success' && steps\.rollback\.outcome == 'success'/,
  );
  assert.equal(
    (deploy.match(/bash \.github\/scripts\/smoke-pages\.sh/g) || []).length,
    2,
    "new deployments and rollbacks must use the same smoke script",
  );
  assert.match(
    deploy,
    /bash \.github\/scripts\/smoke-pages\.sh "\$PREVIOUS_DEPLOYMENT_URL" --rollback/,
  );
  assert.doesNotMatch(deploy, /"\$DEPLOYMENT_URL" --rollback/);
  assert.match(deploy, /previous deployment was restored and verified\.[\s\S]*?exit 1/);
  assert.doesNotMatch(smoke, /CLOUDFLARE_(API_TOKEN|ACCOUNT_ID)/);
});

test("every workflow action is pinned to a full commit SHA with its version in a comment", async () => {
  const workflowDir = path.join(projectRoot, ".github", "workflows");
  const workflowFiles = (await readdir(workflowDir)).filter((file) => /\.ya?ml$/.test(file));
  let uses = 0;
  for (const file of workflowFiles) {
    const lines = (await readProjectFile(path.join(".github", "workflows", file))).split(/\r?\n/);
    lines.forEach((line, index) => {
      const action = line.match(/^\s*(?:- )?uses:\s*([^\s@]+)@(\S+)\s*$/);
      if (!action || action[1].startsWith("./")) return;
      uses++;
      assert.match(action[2], /^[a-f0-9]{40}$/, `${file}: ${action[1]} must use a full commit SHA`);
      assert.match(
        lines[index - 1],
        new RegExp(`^\\s*# ${action[1].replace(/[./]/g, "\\$&")}@v\\d`),
        `${file}: ${action[1]} names its version in the comment above`,
      );
    });
  }
  assert.ok(uses > 0, "expected at least one GitHub Action use");
});

test("checkouts never persist credentials", async () => {
  const workflowDir = path.join(projectRoot, ".github", "workflows");
  let count = 0;
  for (const file of (await readdir(workflowDir)).filter((name) => /\.ya?ml$/.test(name))) {
    const workflow = await readProjectFile(path.join(".github", "workflows", file));
    const checkouts =
      workflow.match(
        /uses: actions\/checkout@\S+(?:\r?\n\s+with:[\s\S]*?)?(?=\r?\n\s+- |\r?\n\s*\r?\n|$)/g,
      ) || [];
    for (const checkout of checkouts)
      assert.match(checkout, /persist-credentials:\s*false/, `${file}: ${checkout}`);
    count += checkouts.length;
  }
  assert.ok(count > 0, "expected at least one checkout");
});
