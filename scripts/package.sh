#!/usr/bin/env bash
# Zips the extension for sideloading / sharing, with the licence texts its parts require. Output: dist/subtext-<version>.zip
# The zip holds whatever is in extension/. A copy without the held data files (docs/PUBLISHING.md) builds a zip without them.
# The zip says nothing about the machine that built it: every entry has the same fixed time in UTC, entries are in sorted
# order, and no extra fields are stored (zip -X), so there is no local time, time zone, user id or group id in it.
set -euo pipefail
cd "$(dirname "$0")/.."
export TZ=UTC
VERSION=$(node -e "console.log(require('./extension/manifest.json').version)")
ZIP="dist/subtext-$VERSION.zip"
STAGE="dist/package-stage"
mkdir -p dist
rm -f "$ZIP"
rm -rf "$STAGE"
cp -R extension "$STAGE"
# code (AGPL) and data (CC BY-SA) licences and the NOTICE at the top of the zip
cp LICENSE LICENSE-DATA NOTICE "$STAGE/"
find "$STAGE" -name '.DS_Store' -delete
find "$STAGE" -exec touch -t 202601010000 {} +
(cd "$STAGE" && find . -type f | sed 's|^\./||' | LC_ALL=C sort | zip -qX "../subtext-$VERSION.zip" -@)
rm -rf "$STAGE"
LISTING=$(unzip -l "$ZIP")
need() { grep -q " $1\$" <<<"$LISTING" || { echo "package: $1 is missing from $ZIP" >&2; exit 1; }; }
for f in LICENSE LICENSE-DATA NOTICE manifest.json; do need "$f"; done
# the warning list ships only with the licence texts of its sources beside it: data/GPL-3.0.txt, data/COI-open-data-licence.txt, data/NOTICE-lists.md
if grep -q " data/known-bad.json\$" <<<"$LISTING"; then
  for f in data/GPL-3.0.txt data/COI-open-data-licence.txt data/NOTICE-lists.md; do need "$f"; done
else
  echo "package: extension/data/known-bad.json is not in this copy; the zip has no warning list and none of its licence texts" >&2
fi
# fail if any entry carries a time other than the fixed one, or an extra field
if zipinfo -v "$ZIP" | grep -E "length of extra field" | grep -qv " 0 bytes"; then echo "package: $ZIP has extra fields" >&2; exit 1; fi
if zipinfo -T "$ZIP" | grep -v "^Archive:" | grep -E "^[-d]" | grep -qv " 20260101\.000000 "; then echo "package: $ZIP has an entry with a local time" >&2; exit 1; fi
echo "$ZIP"
