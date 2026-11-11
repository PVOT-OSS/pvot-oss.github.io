#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Rebuilds assets/fonts/material-symbols-rounded.woff2: a subset of Material Symbols Rounded
# with only the icons the site uses, so visitors never fetch anything from Google.
#
# Run it after you use a new icon name anywhere (an app's `icon:`, or <span class="ms">name</span>):
#   ./scripts/fonts.sh
set -euo pipefail
cd "$(dirname "$0")/.."

# Every icon name: app front matter, class="ms..." spans, and the names main.js swaps in.
icons=$(
  {
    grep -h '^icon:' _apps/*.md | awk '{print $2}'
    grep -rhoE 'class="ms[^"]*">[a-z0-9_]+<' --include='*.html' . --exclude-dir=_site --exclude-dir=public \
      | sed -E 's/.*>([a-z0-9_]+)</\1/'
    printf '%s\n' close menu check content_copy pause play_arrow
  } | sort -u | paste -sd, -
)

ua='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36'
css=$(curl -fsS -A "$ua" "https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..48,300..500,0..1,0&icon_names=${icons}&display=block")
url=$(printf '%s' "$css" | sed -n 's/.*url(\([^)]*\)).*/\1/p' | head -1)
curl -fsS -A "$ua" -o assets/fonts/material-symbols-rounded.woff2 "$url"
echo "material-symbols-rounded.woff2: $(echo "$icons" | tr ',' '\n' | wc -l | tr -d ' ') icons, $(wc -c < assets/fonts/material-symbols-rounded.woff2 | tr -d ' ') bytes"
