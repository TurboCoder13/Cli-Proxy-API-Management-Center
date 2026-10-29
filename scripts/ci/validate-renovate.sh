#!/usr/bin/env bash
set -euo pipefail

npx --yes --package renovate renovate-config-validator renovate.json
