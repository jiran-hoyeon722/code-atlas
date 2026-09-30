#!/usr/bin/env bash
source lib/common.sh

for target in a b; do
  case "$target" in
    a) echo "deploy a" ;;
    b) echo "deploy b" ;;
    *) exit 1 ;;
  esac
done
