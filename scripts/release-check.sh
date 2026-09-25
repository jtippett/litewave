#!/usr/bin/env bash
# Usage: scripts/release-check.sh vX.Y.Z [--notes FILE]
# Exits 0 when the tag matches package.json, packages/phoenix/mix.exs and a
# dated section in both changelogs. With --notes, writes the root changelog
# section for the tag to FILE (GitHub release notes).
set -euo pipefail

tag="${1:-}"
notes=""
if [ "${2:-}" = "--notes" ]; then notes="${3:-}"; fi

if [[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+- ]]; then
  echo "release-check: tag '$tag' is a prerelease; the workflow publishes only stable versions (npm 'latest', Hex, GitHub release) for now" >&2
  exit 1
fi
if [[ ! "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "release-check: tag '$tag' must look like v1.2.3" >&2
  exit 1
fi
version="${tag#v}"

pkg=$(node -p "require('./package.json').version")
mix=$(sed -n 's/^  @version "\(.*\)"$/\1/p' packages/phoenix/mix.exs)

fail=0
[ "$pkg" = "$version" ] || { echo "release-check: package.json is $pkg, tag is $version" >&2; fail=1; }
[ "$mix" = "$version" ] || { echo "release-check: packages/phoenix/mix.exs is $mix, tag is $version" >&2; fail=1; }
for changelog in CHANGELOG.md packages/phoenix/CHANGELOG.md; do
  grep -q "^## \[$version\] - [0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\}$" "$changelog" ||
    { echo "release-check: $changelog has no dated '## [$version] - YYYY-MM-DD' section" >&2; fail=1; }
done
[ "$fail" -eq 0 ] || exit 1

if [ -n "$notes" ]; then
  awk -v v="$version" '
    /^## \[/ { printing = index($0, "[" v "]") > 0 }
    /^\[.*\]: http/ { printing = 0 }
    printing
  ' CHANGELOG.md > "$notes"
  [ -s "$notes" ] || { echo "release-check: no notes extracted for $version" >&2; exit 1; }
fi

echo "release-check: $tag matches package.json, mix.exs and both changelogs"
