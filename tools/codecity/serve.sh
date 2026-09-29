#!/usr/bin/env bash
# Serves site/ on http://127.0.0.1:${CODE_ATLAS_PORT:-9400}/ with every built repository's source
# directory mounted read-only under /<name>/src/ for the code viewer.
# Bound to loopback only: the pages expose source code.
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
ATLAS=$(cd "$HERE/../.." && pwd)
PORT=${CODE_ATLAS_PORT:-9400}
CONTAINER=code-atlas
VISUALIZATION_IMAGE=codecharta/codecharta-visualization
CODECHARTA=$ATLAS/.cache/codecharta

if [[ ! -f $CODECHARTA/index.html ]]; then
    echo "extracting CodeCharta visualization (BSD-3) from $VISUALIZATION_IMAGE"
    mkdir -p "$CODECHARTA"
    docker run --rm --platform linux/amd64 -v "$CODECHARTA":/export --entrypoint sh "$VISUALIZATION_IMAGE" \
        -c 'cp -R /usr/share/nginx/html/. /export/'
fi

mounts=(-v "$ATLAS/site":/usr/share/nginx/html:ro -v "$CODECHARTA":/usr/share/nginx/html/codecharta:ro)
mkdir -p "$ATLAS/site/codecharta"
for config in "$ATLAS"/repos/*.json; do
    name=$(basename "$config" .json)
    [[ -f $ATLAS/site/$name/meta.json ]] || continue
    repo=$(node -e 'console.log(require(process.argv[1]).path)' "$config" | sed "s|^~|$HOME|")
    src=$(node -e 'console.log(require(process.argv[1]).sourceDir)' "$config")
    # docker needs the mount point to exist inside the read-only site/ mount
    mkdir -p "$ATLAS/site/$name/src/$src"
    mounts+=(-v "$repo/$src":/usr/share/nginx/html/$name/src/$src:ro)
done

docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
docker run -d --name "$CONTAINER" -p 127.0.0.1:"$PORT":80 "${mounts[@]}" nginx:stable-alpine >/dev/null
echo "http://127.0.0.1:$PORT/"
