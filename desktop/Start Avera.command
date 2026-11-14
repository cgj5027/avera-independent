#!/bin/sh
set -eu
AVERA_PACKAGE_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec sh "$AVERA_PACKAGE_DIR/start-avera.sh" "$@"
