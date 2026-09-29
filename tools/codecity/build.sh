#!/usr/bin/env bash
# Builds the code-city site for one repository described in repos/<name>.json into site/<name>/.
# Needs only docker + node on the host; the target repository is mounted read-only and never written.
#   usage: tools/codecity/build.sh <name>
#   CODECITY_SINCE     window for "recent" git metrics   (default: 6 months ago)
#   CODECITY_BASELINE  snapshot compared in delta mode    (default: 3 months ago)
set -euo pipefail

NAME=${1:?usage: $0 <repo-name>  (reads repos/<repo-name>.json)}
HERE=$(cd "$(dirname "$0")" && pwd)
ATLAS=$(cd "$HERE/../.." && pwd)
CONFIG=$ATLAS/repos/$NAME.json
[[ -f $CONFIG ]] || { echo "no config: $CONFIG" >&2; exit 1; }

conf() { node -e 'const c = require(process.argv[1]); const v = c[process.argv[2]] ?? process.argv[3] ?? ""; console.log([v].flat().join(","))' "$CONFIG" "$@"; }
REPO=$(conf path | sed "s|^~|$HOME|")
REPO=$(git -C "$REPO" rev-parse --show-toplevel)
SRC=$(conf sourceDir)
LANGUAGE=$(conf language php)
EXT=$(conf extensions "$LANGUAGE")
EXCLUDE=$(conf exclude)
ROUTES=$(conf routesDir)
PROVIDERS=$(conf providersPrefix)

SINCE=${CODECITY_SINCE:-6 months ago}
BASELINE_AGO=${CODECITY_BASELINE:-3 months ago}
ANALYSIS_IMAGE=codecharta/codecharta-analysis

WORK=$ATLAS/.work/$NAME
SERVE=$ATLAS/site/$NAME
rm -rf "$WORK" "$SERVE"
mkdir -p "$WORK/baseline" "$SERVE"

ccsh() {
    # amd64-only image; runs under emulation on Apple Silicon
    docker run --rm --platform linux/amd64 \
        -v "$REPO":/repo:ro -v "$WORK":/work -w /work \
        -e GIT_CONFIG_COUNT=1 -e GIT_CONFIG_KEY_0=safe.directory -e GIT_CONFIG_VALUE_0='*' \
        "$ANALYSIS_IMAGE" ccsh "$@" 2>&1 | tr '\r' '\n' | grep -E '^Created Project|ERROR|^Exception' || true
}

BASELINE_COMMIT=$(git -C "$REPO" rev-list -1 --before="$BASELINE_AGO" HEAD)
echo "repo: $REPO ($SRC/)"
echo "baseline: $BASELINE_COMMIT ($BASELINE_AGO)"
git -C "$REPO" archive "$BASELINE_COMMIT" "$SRC" | tar -x -C "$WORK/baseline"

echo "git log since: $SINCE"
git -C "$REPO" -c core.quotepath=off log --numstat --raw --topo-order --reverse -m --since="$SINCE" > "$WORK/recent.log"
git -C "$REPO" -c core.quotepath=off ls-files > "$WORK/files.txt"

echo "[1/5] code metrics (HEAD, baseline)"
EXCLUDE_ARG=-e=${EXCLUDE:-^$}
ccsh unifiedparser "/repo/$SRC" -fe="$EXT" "$EXCLUDE_ARG" -nc -o code.cc.json
ccsh unifiedparser "baseline/$SRC" -fe="$EXT" "$EXCLUDE_ARG" --bypass-gitignore -nc -o baseline.cc.json

echo "[2/5] git metrics (recent, full history)"
ccsh gitlogparser log-scan --git-log=recent.log --repo-files=files.txt --add-author --silent -nc -o git-recent-all.cc.json
ccsh gitlogparser repo-scan --repo-path /repo --add-author --silent -nc -o git-history-all.cc.json
ccsh modify git-recent-all.cc.json -s="/root/$SRC" -o git-recent.cc.json
ccsh modify git-history-all.cc.json -s="/root/$SRC" -o git-history.cc.json

echo "[3/5] merge"
ccsh merge code.cc.json git-recent.cc.json -nc -o current.cc.json
ccsh merge code.cc.json git-history.cc.json -nc -o history.cc.json

echo "[4/5] enrich + hotspot report"
node "$HERE/enrich.mjs" "$CONFIG" "$REPO" "$WORK" "$SERVE" "$SINCE" "$BASELINE_COMMIT"

echo "[5/5] code dependencies + architecture explorer"
case $LANGUAGE in
    php)
        [[ -f $ATLAS/vendor/autoload.php ]] || docker run --rm -v "$ATLAS":/app -w /app composer:2 install --no-interaction --no-progress
        docker run --rm -v "$ATLAS":/atlas:ro -v "$REPO":/repo:ro -v "$WORK":/work php:8.2-cli \
            php -d memory_limit=3G /atlas/tools/codecity/deps.php /repo "$SRC" "$ROUTES" "$PROVIDERS" /work/deps.json
        ;;
    typescript | javascript)
        [[ -f $ATLAS/node_modules/dependency-cruiser/package.json ]] || docker run --rm -v "$ATLAS":/app -w /app node:22-alpine npm install --no-audit --no-fund
        docker run --rm -v "$ATLAS":/atlas:ro -v "$REPO":/repo:ro -v "$WORK":/work node:22-alpine \
            node /atlas/tools/codecity/deps-js.mjs /repo "$SRC" "$ROUTES" "$EXT" "$EXCLUDE" "$(conf tsConfig tsconfig.json)" /work/deps.json
        ;;
    *)
        echo "no dependency extractor for '$LANGUAGE' yet" >&2
        exit 1
        ;;
esac
node "$HERE/architecture.mjs" "$NAME" "$CONFIG" "$REPO" "$WORK" "$SERVE"
node "$HERE/index.mjs" "$ATLAS"

cat "$WORK/links.md"
echo "serve: tools/codecity/serve.sh"
