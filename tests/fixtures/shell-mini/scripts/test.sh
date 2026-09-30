#!/usr/bin/env bash
source ../lib/log.sh
i=0
while [ $i -lt 3 ]; do
  i=$((i + 1))
done
test -f build.sh || exit 1
