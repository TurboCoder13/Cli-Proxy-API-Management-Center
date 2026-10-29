#!/usr/bin/env bash
set -euo pipefail

npx --yes --package renovate@latest renovate-config-validator --no-global --strict renovate.json
