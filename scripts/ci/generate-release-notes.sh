#!/usr/bin/env bash
set -euo pipefail
current_tag="${GITHUB_REF_NAME}"
previous_tag="$(git tag --list 'v*' --sort=-v:refname | grep -v "^${current_tag}$" | head -n 1 || true)"
if [ -n "${previous_tag}" ]; then
  range="${previous_tag}..${current_tag}"
else
  range="${current_tag}"
fi
git log --pretty=format:"- %h %s" "${range}" > release-notes.md
