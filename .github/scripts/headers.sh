# Shared by the Cloudflare audit scripts; source it, do not run it.

# extract_final_header_block RAW FINAL: copies the last response's header
# block from a curl --dump-header file (one block per redirect or 1xx).
extract_final_header_block() {
  local raw_headers="$1"
  local final_headers="$2"

  tr -d '\r' < "$raw_headers" |
    awk '
      /^HTTP\// {
        block = $0 ORS
        capture = 1
        next
      }
      capture {
        block = block $0 ORS
        if ($0 == "") {
          final = block
          block = ""
          capture = 0
        }
      }
      END {
        if (block != "") {
          final = block
        }
        printf "%s", final
      }' > "$final_headers"
}
