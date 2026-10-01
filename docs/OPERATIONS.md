# Operations

The repository-owned path from source to Cloudflare Pages. Dashboard, DNS, secret, push and deploy changes still require explicit approval.

## Release gates

Use Node.js 22 or newer. The local equivalent of CI:

```powershell
npm.cmd ci
npm.cmd run audit:ci
npm.cmd run verify
npm.cmd test
npm.cmd run build:dist
```

`npm run audit:ci` fails on high or critical npm advisories. Lighthouse runs three times and asserts against the median: it hard-fails below performance 0.80, accessibility 1.00, best practices 0.95 or SEO 1.00, and above LCP 2500 ms, CLS 0.10 or TBT 200 ms. Reports are kept as GitHub Actions artifacts.

CI Lighthouse runs on GPU-less GitHub-hosted runners, where the delivery policy below keeps the title card static. The CI check therefore audits the static title card delivery path, not the live scene (nor its loading line). Hold the live scene to the same performance and TBT gates by measuring it locally on GPU hardware for each release: three uninstrumented default Lighthouse runs, median.

The bundle limits are 30 KiB for the UI and 820 KiB for the scene entry plus the chunks it imports statically; lazily imported chunks are outside that total. Model and texture payloads stay within 6 MiB on high and 3 MiB on balanced.

## Live scene delivery policy

The title card (the night sky drawn in CSS, the identity and About) is the first visual before JavaScript and requests no image. Capable hardware, including real phones, loads the deferred Three.js scene; meanwhile a loading line above the footer shows real progress and reads 100% at the reveal. The title card stays static, with no loading line, and no scene script is downloaded, when reduced data or reduced motion is requested, WebGL is unavailable, the renderer is software-only (SwiftShader, llvmpipe, Microsoft Basic Render Driver), or the device resolves to the low quality tier. If an authored model fails to load, the scene stops on the title card (a revealed canvas fades back to it) and the loading line retires.

`?quality=balanced|high` forces the live path through the preference and software-renderer gates; it still stops when WebGL is unavailable. Do not add user-agent, Lighthouse or phone-viewport exceptions.

The scene entry imports one shared chunk statically (Three.js core). Lazy chunks load only for the live film scene (high or balanced): rocks, lantern flame, terrain, light shafts (WebGL2 only) and mountains. All match the immutable `/scripts/scene.*.js` rule in `_headers`, and the pages still name exactly one app, one scene entry and one CSS asset.

The share card's backdrop, `tools/og-card-backdrop.webp` (a 1600x900 still of the live scene, formerly the landscape poster), is not published. Whenever it changes, regenerate `public/og.png` from `tools/og-card.html` (the recipe is in that file) and re-scrape it with LinkedIn Post Inspector after release.

## GitHub environments and credentials

Cloudflare credentials are two repository secrets: `CLOUDFLARE_API_TOKEN` (limited to this account with `Account → Cloudflare Pages → Edit`) and `CLOUDFLARE_ACCOUNT_ID`. Each step that talks to Cloudflare sets exactly those two in its own `env`; no job or workflow exposes them. The `preview` and `production` GitHub environments only gate the jobs that use them.

`preview` requires approval from `alexonava`; `production` accepts only `main`. A production run fails when credentials are absent or invalid. Fork pull requests build the preview artifact but skip the credentialed job. Missing preview credentials produce a notice and skip deployment; invalid configured credentials still fail.

## Deploy and smoke checks

Production runs only from `main`. Before upload, the workflow captures the current successful production deployment as the rollback target, publishes `dist/` to Pages project `alexnava-me`, then runs `.github/scripts/smoke-pages.sh` against the new immutable deployment URL and `https://alexnava.me/`. Both must return `200` without a cross-host redirect, contain `<title>Alex Nava</title>`, and reference matching hashed app, scene and CSS assets. The apex must send CSP, HSTS and `X-Content-Type-Options: nosniff`, the 404 page must return a real 404, and `www` must `301` to the apex. Apex parity allows about three minutes for custom-domain promotion.

Preview builds run without credentials and upload only `dist/`; a separate environment-gated job deploys that artifact with an exact Wrangler version, to a `preview-` prefixed alias, without checking out pull-request code.

```powershell
npm.cmd run deploy:preview
```

Production has no direct local npm deploy command. Merging an approved pull request to `main` triggers the release. To retry an approved `main` revision:

```powershell
gh workflow run deploy.yml --ref main
```

A Pages deploy does not purge the zone's edge cache. After a release that changes `/robots.txt`, `/og.png` or another stable-named file, purge that URL (Caching → Configuration → Custom Purge). Fingerprinted assets and HTML need no purge.

## Rollback

If any post-upload smoke check fails, the workflow posts to Cloudflare's official Pages rollback endpoint for the captured deployment, reruns the smoke script against it with `--rollback`, and keeps the workflow red. If automated rollback fails, restore the captured deployment ID from the Cloudflare Pages dashboard and rerun the script manually. Do not rewrite Git history to roll back a release.

## Response headers

`public/_headers` is the tracked baseline. HTML revalidates immediately. Icons and other stable-named files revalidate after seven days. Content-hashed CSS, JavaScript, fonts, images and GLBs are immutable for one year. Do not add absolute-host patterns to `_headers`: Pages applies them by path, so a `pages.dev`-only `X-Robots-Tag` can leak onto the apex.

`/.well-known/security.txt` expires 2027-09-23. The contract test fails 30 days earlier, so renew the `Expires` line in `public/.well-known/security.txt` before 2027-08-24.

The apex is a native custom domain on `alexnava-me`. An exact-host Cloudflare Bulk Redirect (list `alexnava_pages_hostname_redirects`) sends `alexnava-me.pages.dev` to the apex, preserving paths and query strings. Do not recreate the removed `babel-apex` or `babel-bot` Worker routes: a Worker fetch to the Pages hostname can loop through that redirect.

## Scheduled Cloudflare audit

`Cloudflare Audit` runs every Monday at 15:17 UTC and on demand. Its `pages-project` job reads the Pages project with the repository's Cloudflare secrets and keeps only its name, branch and domains; it extracts only each request's final response-header block, and requires the apex to answer `200` with effective host exactly `alexnava.me`. The Pages hostname must either return `200` with noindex or redirect its root with `301`/`308` to exactly `https://alexnava.me/`. Sanitized reports are kept for 14 days.

The scripts live in `.github/scripts/` (`cloudflare-audit.sh`, `cloudflare-edge-settings.sh`, and the shared `headers.sh`). The `edge-settings` job uses no credentials and checks what dashboard settings can change after `_headers`: no email obfuscation, same-origin scripts, no `no-store`, immutable fingerprinted assets, and a compressed `tower-high` GLB. These checks deliberately stay out of `smoke-pages.sh`, because a rollback cannot fix a dashboard setting.

## Cloudflare dashboard checklist

Owner settings that rewrite live responses after `_headers`, applied 2026-09-23. The weekly `edge-settings` audit job asserts items 1–4; after changing any of them, run `gh workflow run cloudflare-audit.yml --ref main`.

1. **No appended `no-store`** from Transform Rules, Cache Rules, Browser Cache TTL (keep Respect Existing Headers) or Snippets.
2. **Email Address Obfuscation off** (Scrape Shield). Each `mailto:` link is also wrapped in `<!--email_off-->`.
3. **Web Analytics/RUM injection off**, in the Pages project's Metrics and in Speed → Observatory. The CSP blocks the beacon anyway.
4. **Compress GLBs**: a Compression Rule enables Brotli (gzip fallback) for `model/gltf-binary` and `application/octet-stream`.
5. **HTTP/3 (with QUIC)** on.
6. **AI crawlers and HSTS preload.** AI model training is declined; search, citation, archive and assistant crawlers stay welcome. Block only the training crawlers in AI Crawl Control (Amazonbot, Bytespider, CCBot, ClaudeBot, FacebookBot, GPTBot, Meta-ExternalAgent) and list the same tokens, plus `Applebot-Extended`, in `robots.txt`. Leave Cloudflare's managed robots.txt off, because it disallows Google-Extended. HSTS preload is declined: keep the zone's HSTS Preload box off and its values identical to `_headers`.

## Repository security controls

Keep GitHub Actions pinned to full commit SHAs with job-scoped permissions. GitHub CodeQL default setup is enabled as the low-maintenance scanner; its analyses are required checks on `main`. Dependabot covers npm and GitHub Actions weekly, except `three`, which is pinned to 0.160.1 for r160 legacy light units; upgrade it only with a deliberate visual review.
