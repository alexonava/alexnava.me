#!/usr/bin/env bash
# The weekly Cloudflare audit (.github/workflows/cloudflare-audit.yml).
#   cloudflare-audit.sh project   reads the Pages project with
#                                 CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID
#                                 and keeps only its name, branch and domains;
#   cloudflare-audit.sh headers   checks the live apex, pages.dev and www
#                                 responses without credentials.
# Sanitized reports go to ./cloudflare-audit/. Nothing here is on the deploy
# or rollback path.
set -euo pipefail

RUNNER_TEMP="${RUNNER_TEMP:-$(mktemp -d)}"
GITHUB_STEP_SUMMARY="${GITHUB_STEP_SUMMARY:-/dev/stdout}"
GITHUB_SHA="${GITHUB_SHA:-$(git rev-parse HEAD 2>/dev/null || echo unknown)}"
# shellcheck source=headers.sh
source "$(dirname "$0")/headers.sh"
mkdir -p cloudflare-audit

project() {
  local token="${CLOUDFLARE_API_TOKEN:-}"
  local account_id="${CLOUDFLARE_ACCOUNT_ID:-}"
  if [ -z "$token" ] || [ -z "$account_id" ]; then
    echo "::error::Cloudflare audit requires the CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID repository secrets."
    exit 1
  fi

  # The raw project response stays in the runner's temp; only jq reads it.
  local raw_project="$RUNNER_TEMP/cloudflare-pages-project.json"
  curl \
    --fail \
    --silent \
    --show-error \
    --retry 3 \
    --retry-all-errors \
    --header "Authorization: Bearer $token" \
    --header "Content-Type: application/json" \
    --output "$raw_project" \
    "https://api.cloudflare.com/client/v4/accounts/$account_id/pages/projects/alexnava-me"

  jq -e '
    .success == true and
    .result.name == "alexnava-me" and
    .result.production_branch == "main" and
    ((.result.domains // []) | index("alexnava.me")) != null
  ' "$raw_project" >/dev/null

  jq \
    --arg checked_at "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" \
    '{
      checked_at: $checked_at,
      project: {
        name: .result.name,
        subdomain: .result.subdomain,
        production_branch: .result.production_branch,
        domains: ((.result.domains // []) | sort),
        created_on: .result.created_on
      }
    }' \
    "$raw_project" > cloudflare-audit/pages-project.json
}

# sanitize_headers LABEL RAW: keeps the final response's status line and its
# security and caching headers as cloudflare-audit/LABEL-headers.txt.
sanitize_headers() {
  local label="$1"
  local raw_headers="$2"
  local final_headers="$RUNNER_TEMP/${label}-final-headers.txt"

  extract_final_header_block "$raw_headers" "$final_headers"
  awk 'BEGIN { IGNORECASE=1 }
      /^HTTP\// ||
      /^(cache-control|content-security-policy|cross-origin-opener-policy|cross-origin-resource-policy|location|permissions-policy|referrer-policy|strict-transport-security|x-content-type-options|x-frame-options|x-robots-tag):/ {
        print
      }' "$final_headers" > "cloudflare-audit/${label}-headers.txt"
}

headers() {
  local apex_raw_headers="$RUNNER_TEMP/apex-headers.txt"
  local apex_body="$RUNNER_TEMP/apex-body.html"
  local apex_meta apex_status apex_effective_url apex_effective_host
  apex_meta="$(
    curl \
      --silent \
      --show-error \
      --max-redirs 0 \
      --retry 3 \
      --retry-all-errors \
      --dump-header "$apex_raw_headers" \
      --output "$apex_body" \
      --write-out '%{http_code} %{url_effective}' \
      "https://alexnava.me/"
  )"
  sanitize_headers "apex" "$apex_raw_headers"
  read -r apex_status apex_effective_url <<< "$apex_meta"
  apex_effective_host="${apex_effective_url#*://}"
  apex_effective_host="${apex_effective_host%%/*}"
  apex_effective_host="${apex_effective_host%%:*}"
  if [ "$apex_status" != "200" ] ||
    [ "$apex_effective_host" != "alexnava.me" ] ||
    [ "$apex_effective_url" != "https://alexnava.me/" ]; then
    echo "::error::apex must return 200 directly from https://alexnava.me/ without redirecting."
    exit 1
  fi
  grep -Fq "<title>Alex Nava</title>" "$apex_body"

  local pages_raw_headers="$RUNNER_TEMP/pages-dev-headers.txt"
  local pages_body="$RUNNER_TEMP/pages-dev-body.html"
  local pages_status
  pages_status="$(
    curl \
      --silent \
      --show-error \
      --retry 3 \
      --retry-all-errors \
      --dump-header "$pages_raw_headers" \
      --output "$pages_body" \
      --write-out '%{http_code}' \
      "https://alexnava-me.pages.dev/"
  )"
  sanitize_headers "pages-dev" "$pages_raw_headers"

  local apex_headers="cloudflare-audit/apex-headers.txt"
  local pages_headers="cloudflare-audit/pages-dev-headers.txt"
  grep -Eq '^HTTP/[^ ]+[[:space:]]+200([[:space:]]|$)' "$apex_headers"
  grep -Eiq "^content-security-policy:.*form-action 'none'.*frame-src 'none'.*worker-src 'none'" "$apex_headers"
  grep -Eiq '^strict-transport-security:[[:space:]]*max-age=31536000' "$apex_headers"
  grep -Eiq '^x-content-type-options:[[:space:]]*nosniff' "$apex_headers"

  local pages_result
  if [ "$pages_status" = "200" ]; then
    grep -Fq "<title>Alex Nava</title>" "$pages_body"
    grep -Eiq '^x-robots-tag:.*noindex' "$pages_headers"
    pages_result="200 with X-Robots-Tag noindex"
  elif { [ "$pages_status" = "301" ] || [ "$pages_status" = "308" ]; } &&
    grep -Eiq '^location:[[:space:]]*https://alexnava\.me/[[:space:]]*$' "$pages_headers"; then
    local canonical_headers="$RUNNER_TEMP/pages-dev-canonical-headers.txt"
    local canonical_status
    canonical_status="$(
      curl \
        --silent \
        --show-error \
        --retry 3 \
        --retry-all-errors \
        --dump-header "$canonical_headers" \
        --output /dev/null \
        --write-out '%{http_code}' \
        "https://alexnava-me.pages.dev/__babel-canonical-check?source=cloudflare-audit&keep=1"
    )"
    local canonical_final_headers="$RUNNER_TEMP/pages-dev-canonical-final-headers.txt"
    extract_final_header_block "$canonical_headers" "$canonical_final_headers"
    if { [ "$canonical_status" != "301" ] && [ "$canonical_status" != "308" ]; } ||
      ! grep -Eiq '^location:[[:space:]]*https://alexnava\.me/__babel-canonical-check\?source=cloudflare-audit&keep=1[[:space:]]*$' "$canonical_final_headers"; then
      echo "::error::pages.dev canonical redirect must preserve path and query."
      exit 1
    fi
    pages_result="$pages_status canonical redirect to apex"
  else
    echo "::error::pages.dev must return 200 with noindex or 301/308 to the apex."
    exit 1
  fi

  local www_raw_headers="$RUNNER_TEMP/www-headers.txt"
  local www_status
  www_status="$(
    curl \
      --silent \
      --show-error \
      --retry 3 \
      --retry-all-errors \
      --dump-header "$www_raw_headers" \
      --output /dev/null \
      --write-out '%{http_code}' \
      "https://www.alexnava.me/"
  )"
  sanitize_headers "www" "$www_raw_headers"
  local www_headers="cloudflare-audit/www-headers.txt"
  if [ "$www_status" != "301" ] ||
    ! grep -Eiq '^location:[[:space:]]*https://alexnava\.me/[[:space:]]*$' "$www_headers"; then
    echo "::error::www must return 301 with Location: https://alexnava.me/"
    exit 1
  fi

  {
    printf '# Cloudflare audit\n\n'
    printf -- '- Checked: %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
    printf -- '- Repository revision: `%s`\n' "$GITHUB_SHA"
    printf -- '- Pages project: `alexnava-me`\n'
    printf -- '- Production branch: `main`\n'
    printf -- '- Public DNS/TLS reachability, apex marker, and security headers: pass\n'
    printf -- '- www exact 301 redirect: pass\n'
    printf -- '- Exact pages.dev canonicalization: %s\n' "$pages_result"
  } > cloudflare-audit/summary.md
  cat cloudflare-audit/summary.md >> "$GITHUB_STEP_SUMMARY"
}

case "${1:-}" in
  project) project ;;
  headers) headers ;;
  *)
    echo "Usage: cloudflare-audit.sh project|headers" >&2
    exit 2
    ;;
esac
