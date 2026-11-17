#!/usr/bin/env bash
# Zips the extension for sideloading / sharing, with the licence texts its parts require. Output: dist/subtext-<version>.zip
# The zip holds whatever is in extension/. A copy without the held data files (docs/PUBLISHING.md) builds a zip without them.
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION=$(node -e "console.log(require('./extension/manifest.json').version)")
ZIP="dist/subtext-$VERSION.zip"
mkdir -p dist
rm -f "$ZIP"
(cd extension && zip -qr "../$ZIP" . -x '*.DS_Store')
# code (AGPL) and data (CC BY-SA) licences and the NOTICE at the top of the zip
zip -qj "$ZIP" LICENSE LICENSE-DATA NOTICE
LISTING=$(unzip -l "$ZIP")
need() { grep -q " $1\$" <<<"$LISTING" || { echo "package: $1 is missing from $ZIP" >&2; exit 1; }; }
for f in LICENSE LICENSE-DATA NOTICE; do need "$f"; done
# the warning list ships only with the licence texts of its sources beside it: data/GPL-3.0.txt, data/COI-open-data-licence.txt, data/NOTICE-lists.md
if grep -q " data/known-bad.json\$" <<<"$LISTING"; then
  for f in data/GPL-3.0.txt data/COI-open-data-licence.txt data/NOTICE-lists.md; do need "$f"; done
else
  echo "package: extension/data/known-bad.json is not in this copy; the zip has no warning list and none of its licence texts" >&2
fi
echo "$ZIP"
