#!/usr/bin/env bash
. ../env.sh

log_error() {
  echo "error: $1" >&2
}

require_tool() {
  if command -v "$1" >/dev/null 2>&1 && [ -n "$1" ]; then
    return 0
  elif [ "$1" = "sh" ] || [ "$1" = "bash" ]; then
    return 0
  fi
  log_error "missing $1"
  return 1
}
