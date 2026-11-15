#!/bin/sh
set -eu
AVERA_PACKAGE_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if ! command -v node >/dev/null 2>&1; then
  echo 'Install Node.js 22.18 or newer LTS from https://nodejs.org, then start Avera again.' >&2
  exit 1
fi
exec node "$AVERA_PACKAGE_DIR/scripts/desktop-launcher.mjs" "$@"
