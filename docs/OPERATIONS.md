# Operations

The repository-owned path from source to Cloudflare Pages. Dashboard, DNS, secret, push and deploy changes need explicit approval.

## Release gates

Use Node.js 22 (`.nvmrc`). The local equivalent of CI:

```powershell
npm.cmd ci
npm.cmd run audit:ci
npm.cmd run format:check
npm.cmd run verify
npm.cmd test
npm.cmd run build:dist
```

`audit:ci` fails on high or critical advisories, and `format:check` on any file Prettier would change (`npm run format` fixes them). Budgets are enforced by the tests: the UI bundle under 30 KiB, the scene entry and its static chunks under 820 KiB, and the complete scene within 6 MiB on high and 3 MiB on balanced.

Lighthouse runs three times and asserts the median: performance at least 0.80, accessibility 1.00, best practices 0.95 and SEO 1.00; LCP at most 2500 ms, CLS 0.10 and TBT 200 ms. GitHub's runners have no GPU, so CI audits the static title card. For each release, also run three default Lighthouse passes of the live scene on GPU hardware and hold its median to the same performance and TBT gates.

## CI

`.github/workflows/ci.yml` runs on pull requests and manual runs, and builds once:

- `build` installs, audits, checks formatting, verifies, tests and builds, then uploads `dist/` as the `site-dist` artifact (kept 3 days).
- `audit` runs Lighthouse against that artifact; it installs nothing.
- `preview` (same-repository pull requests only, in the `preview` environment) deploys that artifact with a pinned Wrangler to a `preview-<branch>` alias, without checking out pull-request code, and smoke-checks it.
- `comment` posts the preview URL on the pull request.

`deploy.yml` runs on pushes to `main` and manual runs, and repeats every gate before publishing. `cloudflare-audit.yml` runs weekly. CodeQL uses GitHub's default setup, not a workflow.

## Credentials

Cloudflare credentials are two repository secrets: `CLOUDFLARE_API_TOKEN` (this account, `Account → Cloudflare Pages → Edit`) and `CLOUDFLARE_ACCOUNT_ID`. Each step that calls Cloudflare sets exactly those two in its own `env`; no job or workflow exposes them. The `preview` environment (approval by `alexonava`) and the `production` environment (`main` only) gate the jobs that use them.

Production fails when the credentials are missing or invalid. A preview with missing credentials posts a notice and skips the deploy; invalid ones fail it. Fork pull requests build and audit but never reach the credentialed job.

## Deploy and smoke checks

Production deploys only from `main`. The workflow captures the current successful production deployment as the rollback target, publishes `dist/` to the Pages project `alexnava-me`, and runs `.github/scripts/smoke-pages.sh` against the new deployment URL and `https://alexnava.me/`. Both must return `200` without a cross-host redirect, contain `<title>Alex Nava</title>` and name matching hashed app, scene and CSS assets. The apex must send CSP, HSTS and `X-Content-Type-Options: nosniff`, the 404 page must return a real 404, and `www` must `301` to the apex. Apex parity allows about three minutes for custom-domain promotion.

There is no local production deploy command; merging an approved pull request releases. To retry an approved revision of `main`:

```powershell
gh workflow run deploy.yml --ref main
```

`npm run deploy:preview` publishes a local build to the `preview` branch alias.

## Rollback

If a post-upload smoke check fails, the workflow calls Cloudflare's Pages rollback endpoint for the captured deployment, smoke-checks it with `--rollback`, and stays red. If the automatic rollback fails, restore the captured deployment from the Pages dashboard and rerun the smoke script by hand. Never rewrite Git history to roll back.

## Headers and caching

`public/_headers` is the baseline. HTML revalidates on every request. Icons, the manifest, `robots.txt`, the discovery files, `security.txt`, `/fonts/OFL.txt` and other stable names revalidate after seven days. Content-hashed scripts, CSS, fonts, images, models and slate maps are immutable for a year. Do not add absolute-host patterns: Pages applies rules by path, so a `pages.dev`-only header would reach the apex.

A deploy does not purge the zone's cache. After a release that changes a stable-named file (`/robots.txt`, `/og.png`, `/favicon.ico`, `/manifest.webmanifest`, `/llms.txt`, `/fonts/OFL.txt` and the like), purge those URLs (Caching → Configuration → Custom Purge). HTML and hashed files need no purge.

`/.well-known/security.txt` expires on 2027-09-23, and a test fails 30 days earlier: renew its `Expires` line before 2027-08-24.

The apex is a native custom domain on `alexnava-me`. An exact-host Bulk Redirect (list `alexnava_pages_hostname_redirects`) sends `alexnava-me.pages.dev` to the apex, keeping paths and queries. Do not add Workers on these hostnames: a Worker fetching the Pages hostname can loop through that redirect.

## Cloudflare audit

`cloudflare-audit.yml` runs every Monday at 15:17 UTC and on demand, from scripts in `.github/scripts/`:

- `pages-project` (in the `production` environment) runs `cloudflare-audit.sh project`, which reads the Pages project with the two secrets and keeps only its name, branch and domains, and `cloudflare-audit.sh headers`, which checks the live apex (`200`, effective host exactly `alexnava.me`, security headers), `pages.dev` (`200` with noindex, or `301`/`308` to the apex keeping path and query) and `www` (`301` to the apex). Redirects are inspected, never followed. Sanitized reports are kept 14 days.
- `edge-settings` runs `cloudflare-edge-settings.sh` with no credentials and checks what dashboard settings can change after `_headers`: no email obfuscation, same-origin scripts only, no `no-store`, immutable fingerprinted assets and a compressed `tower-high` GLB.

Both share `headers.sh`. None of this is on the deploy or rollback path: a rollback cannot fix a dashboard setting.

## Cloudflare dashboard checklist

Settings that rewrite live responses after `_headers`. The `edge-settings` job asserts items 1–4; after changing any of them, run `gh workflow run cloudflare-audit.yml --ref main`.

1. **No appended `no-store`** from Transform Rules, Cache Rules, Browser Cache TTL (keep Respect Existing Headers) or Snippets.
2. **Email Address Obfuscation off** (Scrape Shield). Each `mailto:` link is also wrapped in `<!--email_off-->`.
3. **Web Analytics/RUM injection off**, in the Pages project's Metrics and in Speed → Observatory. The CSP blocks the beacon anyway.
4. **Compress GLBs**: a Compression Rule enables Brotli (gzip fallback) for `model/gltf-binary` and `application/octet-stream`.
5. **HTTP/3 (with QUIC)** on.
6. **AI crawlers and HSTS preload.** AI training is declined; search, citation, archive and assistant crawlers stay welcome. Block only the training crawlers in AI Crawl Control (Amazonbot, Bytespider, CCBot, ClaudeBot, FacebookBot, GPTBot, Meta-ExternalAgent) and list the same tokens, plus `Applebot-Extended`, in `robots.txt`. Keep Cloudflare's managed robots.txt off (it disallows Google-Extended). HSTS preload is declined: keep the zone's preload box off and its values identical to `_headers`.

## Repository controls

- Every action is pinned to a full commit SHA with its version in a comment; checkouts never persist credentials; jobs get only the permissions they use.
- CodeQL default setup is required on `main`.
- Dependabot updates npm and GitHub Actions weekly, except `three`, pinned at 0.160.1 for r160's legacy light units; upgrade it only with a deliberate visual review.
