#!/usr/bin/env bash
# Assemble the website for GitHub Pages into one folder.
#   bash .github/scripts/build_site.sh _site
# The page is plain HTML/JS with no build step, so this only copies files:
# everything in site/ except its tests, plus the latest data/listings.json.
set -euo pipefail

OUT="${1:?usage: build_site.sh <output-folder>}"
rm -rf "$OUT"
mkdir -p "$OUT"

# Copy site/, leaving out things only needed for development
tar -C site \
  --exclude ./tests --exclude ./package.json --exclude ./package-lock.json --exclude ./node_modules \
  -cf - . | tar -C "$OUT" -xf -

# The page tries listings.json first; without it, it shows the sample data
if [ -f data/listings.json ]; then
  cp data/listings.json "$OUT/listings.json"
else
  echo "No data/listings.json yet; the site will show sample listings."
fi

# Tell GitHub Pages to serve files as-is (no Jekyll processing)
touch "$OUT/.nojekyll"

echo "Built $OUT:"
(cd "$OUT" && find . -type f | sort)
