// The GitHub Actions workflows: CI, deploys, audits and action pinning.
import assert from "node:assert/strict";
import test from "node:test";
import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function readProjectFile(relativePath) {
  return readFile(path.join(projectRoot, relativePath), "utf8");
}

// One job of a workflow: from its id line to the next job's.
function job(workflow, id) {
  const start = workflow.indexOf(`\n  ${id}:\n`);
  assert.ok(start >= 0, `job ${id}`);
  const next = workflow.slice(start + 1).search(/\n  [\w-]+:\r?\n/);
  return workflow.slice(start, next < 0 ? undefined : start + 1 + next);
}

test("CI builds once on pull requests and manual runs, and its audit and preview use that build", async () => {
  const ci = await readProjectFile(".github/workflows/ci.yml");
  assert.match(ci, /^name: CI$/m);
  assert.match(ci, /^on:\r?\n  pull_request:\r?\n  workflow_dispatch:\r?\n\r?\npermissions:/m);
  assert.match(ci, /^permissions:\r?\n  contents: read$/m);
  assert.match(
    ci,
    /^concurrency:\r?\n  group: ci-\$\{\{ github\.event\.pull_request\.number \|\| github\.ref \}\}\r?\n  cancel-in-progress: true$/m,
  );
  const jobs = ci.slice(ci.indexOf("\njobs:"));
  assert.deepEqual(
    [...jobs.matchAll(/^  ([\w-]+):$/gm)].map((match) => match[1]),
    ["build", "audit", "preview", "comment"],
  );
  // Check names are the job ids.
  assert.doesNotMatch(jobs, /^    name:/m);

  const build = job(ci, "build");
  assert.match(build, /node-version-file: \.nvmrc/);
  const steps = [
    "run: npm ci",
    "run: npm run audit:ci",
    "run: npm run format:check",
    "run: npm run verify",
    "run: npm test",
    "run: npm run build:dist",
    "uses: actions/upload-artifact@",
  ].map((step) => build.indexOf(step));
  assert.ok(steps.every((at) => at >= 0));
  assert.deepEqual(
    steps,
    [...steps].sort((a, b) => a - b),
  );
  assert.match(build, /name: Audit npm dependencies \(high and critical\)/);
  assert.match(
    build,
    /name: site-dist\r?\n\s+path: dist\/\r?\n\s+include-hidden-files: true\r?\n\s+if-no-files-found: error\r?\n\s+retention-days: 3/,
  );

  // The audit takes the build's payload; it installs and builds nothing.
  const audit = job(ci, "audit");
  assert.match(audit, /needs: build/);
  assert.match(audit, /uses: actions\/download-artifact@[\s\S]*?name: site-dist/);
  assert.doesNotMatch(audit, /npm (?:ci|run|test)/);
});

test("Cloudflare preview credentials run separately from pull-request build code", async () => {
  const deploy = await readProjectFile(".github/workflows/deploy.yml");
  const ci = await readProjectFile(".github/workflows/ci.yml");
  const preview = job(ci, "preview");

  assert.doesNotMatch(deploy, /\n    env:\r?\n      CLOUDFLARE_API_TOKEN:/);
  assert.match(
    deploy,
    /- name: Deploy to Cloudflare Pages[\s\S]*?env:[\s\S]*?CLOUDFLARE_API_TOKEN:/,
  );
  assert.match(preview, /needs: build/);
  assert.match(
    preview,
    /if: github\.event_name == 'pull_request' && github\.event\.pull_request\.head\.repo\.full_name == github\.repository/,
  );
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
  assert.doesNotMatch(preview, /actions\/checkout@/);
  assert.doesNotMatch(preview, /\brun:\s*npm ci\b/);
  assert.doesNotMatch(preview, /npm run build:dist/);
});

test("deploy workflows expose environment metadata and use explicit missing-credential policies", async () => {
  const deploy = await readProjectFile(".github/workflows/deploy.yml");
  const preview = job(await readProjectFile(".github/workflows/ci.yml"), "preview");

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
  const preview = await readProjectFile(".github/workflows/ci.yml");
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
  const workflowNames = ["ci.yml", "deploy.yml"];

  assert.equal(packageJson.scripts["audit:ci"], "npm audit --audit-level=high");
  for (const workflowName of workflowNames) {
    const workflow = await readProjectFile(path.join(".github", "workflows", workflowName));
    assert.match(workflow, /run:\s*npm run audit:ci/);
  }
});

test("Lighthouse uses repository artifacts and hard performance-quality budgets", async () => {
  const lighthouse = JSON.parse(await readProjectFile("lighthouserc.json"));
  const workflow = job(await readProjectFile(".github/workflows/ci.yml"), "audit");
  const { collect, assert: assertionConfig } = lighthouse.ci;
  const assertions = assertionConfig.assertions;

  assert.equal(collect.numberOfRuns, 3);
  assert.equal(collect.staticDistDir, "./dist");
  assert.deepEqual(collect.url, ["http://localhost/"]);
  assert.equal(assertionConfig.aggregationMethod, "median");
  assert.deepEqual(assertions["categories:performance"], ["error", { minScore: 0.8 }]);
  assert.deepEqual(assertions["categories:accessibility"], ["error", { minScore: 1 }]);
  assert.deepEqual(assertions["categories:best-practices"], ["error", { minScore: 0.95 }]);
  assert.deepEqual(assertions["categories:seo"], ["error", { minScore: 1 }]);
  assert.deepEqual(assertions["largest-contentful-paint"], ["error", { maxNumericValue: 2500 }]);
  assert.deepEqual(assertions["cumulative-layout-shift"], ["error", { maxNumericValue: 0.1 }]);
  assert.deepEqual(assertions["total-blocking-time"], ["error", { maxNumericValue: 200 }]);
  assert.match(workflow, /configPath: \.\/lighthouserc\.json/);
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

test("production deploy is workflow-owned and explicitly publishes main", async () => {
  const deploy = await readProjectFile(".github/workflows/deploy.yml");

  assert.match(deploy, /npx wrangler pages deploy dist --project-name=alexnava-me --branch=main/);
  assert.match(deploy, /if:\s*github\.ref == 'refs\/heads\/main'/);
  assert.match(deploy, /group:\s*pages-production\r?\n\s+cancel-in-progress:\s*false/);
});

test("deploy is the full gate on main: audit, format, verify, test and build before publishing", async () => {
  const deploy = await readProjectFile(".github/workflows/deploy.yml");
  assert.match(
    deploy,
    /^on:\r?\n  push:\r?\n    branches:\r?\n      - main\r?\n  workflow_dispatch:/m,
  );
  assert.match(deploy, /node-version-file: \.nvmrc/);
  const steps = [
    "run: npm ci",
    "run: npm run audit:ci",
    "run: npm run format:check",
    "run: npm run verify",
    "run: npm test",
    "run: npm run build:dist",
    "name: Deploy to Cloudflare Pages",
  ].map((step) => deploy.indexOf(step));
  assert.ok(steps.every((at) => at >= 0));
  assert.deepEqual(
    steps,
    [...steps].sort((a, b) => a - b),
  );
  assert.match(deploy, /name: Audit npm dependencies \(high and critical\)/);
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
