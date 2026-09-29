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

# Sources are mounted outside the web root and aliased in, so site/ never holds mount points
NGINX_CONF=$ATLAS/.cache/nginx.conf
mounts=(-v "$ATLAS/site":/usr/share/nginx/html:ro -v "$CODECHARTA":/srv/codecharta:ro -v "$NGINX_CONF":/etc/nginx/conf.d/default.conf:ro)
locations="    location /codecharta/ { alias /srv/codecharta/; }"$'\n'
for config in "$ATLAS"/repos/*.json; do
    name=$(basename "$config" .json)
    [[ -f $ATLAS/site/$name/meta.json ]] || continue
    repo=$(node -e 'console.log(require(process.argv[1]).path)' "$config" | sed "s|^~|$HOME|")
    src=$(node -e 'console.log(require(process.argv[1]).sourceDir)' "$config")
    mounts+=(-v "$repo/$src":/srv/src/$name/$src:ro)
    locations+="    location /$name/src/ { alias /srv/src/$name/; }"$'\n'
done
cat > "$NGINX_CONF" <<CONF
server {
    listen 80;
    root /usr/share/nginx/html;
    index index.html;
$locations}
CONF

docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
docker run -d --name "$CONTAINER" -p 127.0.0.1:"$PORT":80 "${mounts[@]}" nginx:stable-alpine >/dev/null
echo "http://127.0.0.1:$PORT/"
