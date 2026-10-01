#!/usr/bin/env bash
# Checks the Cloudflare dashboard settings that can rewrite live responses
# where _headers and the build cannot reach (.github/workflows/cloudflare-audit.yml).
# It needs no credentials and only reports: a smoke failure rolls production
# back, and a rollback cannot change a dashboard setting, so none of this is on
# the deploy or rollback path.
set -euo pipefail

RUNNER_TEMP="${RUNNER_TEMP:-$(mktemp -d)}"
GITHUB_STEP_SUMMARY="${GITHUB_STEP_SUMMARY:-/dev/stdout}"
# shellcheck source=headers.sh
source "$(dirname "$0")/headers.sh"

origin="https://alexnava.me"
origin_host="alexnava.me"
browser_ua="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
checklist="See the Cloudflare dashboard checklist in docs/OPERATIONS.md; after changing the dashboard, run this workflow manually."
work="$RUNNER_TEMP/edge-settings"
mkdir -p "$work"
failures=()
summary=()

pass() {
  summary+=("- $1: pass${2:+ ($2)}")
}

# fail LABEL MESSAGE [HINT]: HINT defaults to the dashboard checklist.
fail() {
  local hint="${3-$checklist}"
  failures+=("$1: $2")
  summary+=("- $1: **fail**")
  echo "::error title=$1::$2${hint:+ $hint}"
}

finish() {
  {
    printf '# Cloudflare edge settings\n\n'
    printf -- '- Checked: %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
    printf '%s\n' "${summary[@]}"
    if [ "${#failures[@]}" -gt 0 ]; then
      printf '\n## Failures\n\n'
      printf -- '- %s\n' "${failures[@]}"
      printf '\nDashboard settings are fixed in Cloudflare, not in this repository. %s\n' "$checklist"
    fi
  } >> "$GITHUB_STEP_SUMMARY"
  if [ "${#failures[@]}" -gt 0 ]; then
    echo "::error::${#failures[@]} Cloudflare edge check(s) failed; see the step summary. $checklist"
    exit 1
  fi
  echo "All Cloudflare edge checks passed."
}

# fetch NAME PATH [curl options]: saves the body to $work/NAME.body and
# the final response's headers to $work/NAME.headers; prints the status.
fetch() {
  local name="$1"
  local path="$2"
  shift 2
  : > "$work/$name.raw-headers"
  : > "$work/$name.body"
  curl \
    --silent \
    --show-error \
    --max-redirs 0 \
    --retry 3 \
    --retry-all-errors \
    --connect-timeout 10 \
    --max-time 60 \
    --user-agent "$browser_ua" \
    --dump-header "$work/$name.raw-headers" \
    --output "$work/$name.body" \
    --write-out '%{http_code}' \
    "$@" \
    "$origin$path" || true
  extract_final_header_block "$work/$name.raw-headers" "$work/$name.headers"
}

# header NAME FILE: every value of one header in a final header block.
header() {
  { grep -i "^$1:" "$2" || true; } |
    sed -E 's/^[^:]+:[[:space:]]*//; s/[[:space:]]+$//' |
    awk 'NR > 1 { printf ", " } { printf "%s", $0 }'
}

# The page as a browser requests it: dashboard rewrites such as email
# obfuscation and analytics injection apply only to HTML requests.
html_status="$(
  fetch html "/" \
    --compressed \
    --header 'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
)"
tr '\r\n' '  ' < "$work/html.body" > "$work/html.flat"
if [ "$html_status" != "200" ] || ! grep -Fq "<title>Alex Nava</title>" "$work/html.flat"; then
  fail "Browser request" "A browser-like request for $origin/ returned HTTP $html_status without the page marker, so no edge setting could be checked. Look for a challenge or block under Security (WAF, Bots) that applies to browsers on GitHub-hosted runners."
  finish
fi
pass "Browser request" "HTTP 200"

if grep -Fq 'href="mailto:alexonava@gmail.com"' "$work/html.flat" &&
  ! grep -Fq '/cdn-cgi/l/email-protection' "$work/html.flat"; then
  pass "Contact email link"
else
  fail "Contact email link" "The page must keep href=\"mailto:alexonava@gmail.com\" and contain no /cdn-cgi/l/email-protection link; Email Address Obfuscation is rewriting it. Turn off Scrape Shield → Email Address Obfuscation."
fi

{ grep -oiE '<script[^>]*>' "$work/html.flat" || true; } |
  sed -nE "s/.*[[:space:]][sS][rR][cC][[:space:]]*=[[:space:]]*[\"']?([^\"' >]+).*/\1/p" \
    > "$work/script-srcs"
third_party_hosts="$(
  while IFS= read -r src; do
    case "${src,,}" in
      http://* | https://* | //*)
        host="${src#*//}"
        host="${host%%[/?#]*}"
        host="${host%%:*}"
        host="${host,,}"
        if [ "$host" != "$origin_host" ]; then
          printf '%s\n' "$host"
        fi
        ;;
    esac
  done < "$work/script-srcs" | sort -u | paste -sd ' ' -
)"
if [ -z "$third_party_hosts" ]; then
  pass "Same-origin scripts only"
else
  fail "Same-origin scripts only" "The page loads scripts from $third_party_hosts, which the CSP blocks. Turn off automatic Web Analytics/RUM injection (Workers & Pages → alexnava-me → Metrics → Web Analytics, and Speed → Observatory → RUM)."
fi

html_cache_control="$(header cache-control "$work/html.headers")"
if [[ "${html_cache_control,,}" == *no-store* ]]; then
  fail "HTML Cache-Control" "The page's Cache-Control is \"$html_cache_control\"; _headers sends public, max-age=0, must-revalidate. Remove the rule that appends no-store (Rules → Transform Rules or Cache Rules, Caching → Browser Cache TTL, or a Snippet)."
else
  pass "HTML Cache-Control" "${html_cache_control:-none}"
fi

# Fingerprinted assets: the page names the app, CSS and scene entry,
# and the entry imports the shared scene chunk, which the app preloads.
cache_findings=()
checked_assets=0
check_immutable() {
  local name="$1"
  local asset_path="$2"
  local status
  local cache_control
  status="$(fetch "$name" "$asset_path" --compressed)"
  cache_control="$(header cache-control "$work/$name.headers")"
  checked_assets=$((checked_assets + 1))
  if [ "$status" != "200" ]; then
    cache_findings+=("$asset_path returned HTTP $status")
  elif [[ "${cache_control,,}" != *immutable* ]] || [[ "${cache_control,,}" == *no-store* ]]; then
    cache_findings+=("$asset_path sends Cache-Control \"${cache_control:-none}\"")
  fi
}

app_path="$(grep -oE '/scripts/app\.[a-f0-9]{8}\.js' "$work/html.flat" | head -n 1 || true)"
css_path="$(grep -oE '/css/styles\.[a-f0-9]{8}\.css' "$work/html.flat" | head -n 1 || true)"
entry_path="$(
  { grep -oiE '<meta[^>]*name="babel:scene-script"[^>]*>' "$work/html.flat" || true; } |
    grep -oE '/scripts/scene\.[a-f0-9]{8}\.js' | head -n 1 || true
)"
: > "$work/app.body"
: > "$work/entry.body"
if [ -n "$app_path" ]; then
  check_immutable app "$app_path"
fi
if [ -n "$css_path" ]; then
  check_immutable css "$css_path"
fi
if [ -n "$entry_path" ]; then
  check_immutable entry "$entry_path"
fi

# Static imports only; the lazily imported scene chunks share the same
# /scripts/scene.*.js rule.
chunk_paths="$(
  {
    { grep -oE "(from|import)[[:space:]]*[\"']\./scene\.[a-z0-9.-]+\.js[\"']" "$work/entry.body" || true; } |
      grep -oE 'scene\.[a-z0-9.-]+\.js' | sed 's|^|/scripts/|' || true
    grep -oE '/scripts/scene\.[a-z0-9-]+\.[a-f0-9]{8}\.js' "$work/app.body" || true
  } | sort -u
)"
chunk_index=0
for chunk_path in $chunk_paths; do
  chunk_index=$((chunk_index + 1))
  check_immutable "chunk-$chunk_index" "$chunk_path"
done

missing=""
[ -n "$app_path" ] || missing="$missing the app script;"
[ -n "$css_path" ] || missing="$missing the stylesheet;"
[ -n "$entry_path" ] || missing="$missing the babel:scene-script entry;"
grep -Eq '^/scripts/scene\.shared\.[a-f0-9]{8}\.js$' <<< "$chunk_paths" ||
  missing="$missing the shared scene chunk;"
if [ -n "$missing" ]; then
  fail "Fingerprinted asset discovery" "Could not find${missing%;}. A production build from before the scene split has no shared chunk; otherwise update this audit's discovery patterns to match build.mjs." ""
fi

if [ "${#cache_findings[@]}" -gt 0 ]; then
  findings="$(printf '%s; ' "${cache_findings[@]}")"
  fail "Immutable fingerprinted assets" "${findings%; }. _headers makes hashed scripts and CSS public, max-age=31536000, immutable. Remove the rule that appends no-store (Rules → Transform Rules or Cache Rules, Caching → Browser Cache TTL, or a Snippet)."
elif [ "$checked_assets" -gt 0 ]; then
  pass "Immutable fingerprinted assets" "$checked_assets checked"
fi

glb_path="$(
  cat "$work/entry.body" "$work/app.body" |
    grep -oE '/images/architecture/tower-high\.[a-f0-9]{8}\.glb' | head -n 1 || true
)"
if [ -z "$glb_path" ]; then
  fail "GLB compression" "Could not find a fingerprinted tower-high GLB in the scene entry or app script; update this audit's discovery pattern to match build.mjs." ""
else
  glb_status="$(fetch glb "$glb_path" --header 'Accept-Encoding: br, gzip')"
  rm -f "$work/glb.body"
  glb_encoding="$(header content-encoding "$work/glb.headers")"
  case "$glb_status:${glb_encoding,,}" in
    200:br | 200:gzip)
      pass "GLB compression" "$glb_encoding"
      ;;
    *)
      fail "GLB compression" "$glb_path returned HTTP $glb_status with Content-Encoding \"${glb_encoding:-none}\" to Accept-Encoding br, gzip. Add a Compression Rule (Rules → Compression Rules) that enables Brotli for model/gltf-binary and application/octet-stream."
      ;;
  esac
fi

finish
