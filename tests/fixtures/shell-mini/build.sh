#!/usr/bin/env bash
set -e
DIR="$(dirname "$0")"
source ./lib/common.sh
source "$DIR/x.sh"
. ./lib/log.sh
./scripts/test.sh
bash scripts/deploy.sh
sh ./ci/run.sh --fast
./missing.sh
echo "built"
