#!/usr/bin/env bash
# 发版（.github/workflows/release.yml 在 main 上 CI 跑绿后调用；也可以在 Actions 页对 main 手动运行）：
#   package.json 的版本还没有 tag ⇒ 在当前提交上打 tag、建 GitHub release（说明取 CHANGELOG 里这一版的一节），附上编译好的安装包；
#   tag 已在 ⇒ 缺 release 就补建，缺安装包就在 tag 那个提交上构建后补传，都齐了就什么也不做（重复运行无害）；
#   设了 NPM_TOKEN ⇒ 这一版 npm 上还没有就发上去（在 GitHub Actions 里带来源证明）。
# 要 gh 与 GH_TOKEN（contents: write）。本机试跑：DRY_RUN=1 bash scripts/release.sh（照样构建打包，只打印要发布的动作）
set -euo pipefail
cd "$(dirname "$0")/.."

NAME=$(node -p "require('./package.json').name")
VERSION=$(node -p "require('./package.json').version")
TAG="v$VERSION"
ASSET="$NAME-$VERSION.tgz"
HEAD_SHA=$(git rev-parse HEAD)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"; git worktree prune' EXIT

run() { if [ -n "${DRY_RUN:-}" ]; then echo "[dry-run] $*"; else "$@"; fi; }

# 在指定提交上构建并打包。用独立的工作区：这个脚本自己就在当前检出里，不能切走
pack_at() {
  local sha=$1 dir="$WORK/tree"
  git worktree add --quiet --detach "$dir" "$sha"
  if ! (cd "$dir" && pnpm install --frozen-lockfile && pnpm build && pnpm pack --pack-destination "$WORK") > "$WORK/pack.log" 2>&1; then
    tail -n 40 "$WORK/pack.log"
    echo "❌ 在 ${sha:0:7} 上构建或打包失败（上面是日志末尾）"
    exit 1
  fi
  git worktree remove --force "$dir"
  [ -f "$WORK/$ASSET" ] || { echo "❌ 打包后没有 $ASSET"; exit 1; }
  echo "📦 $ASSET ← ${sha:0:7}"
}

notes() { node scripts/release-notes.mjs "$VERSION" > "$WORK/notes.md"; }

if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  TARGET=$(git rev-list -n 1 "$TAG")
  if ! gh release view "$TAG" >/dev/null 2>&1; then
    echo "tag $TAG 已在（${TARGET:0:7}），还没有 release：补建"
    notes
    pack_at "$TARGET"
    run gh release create "$TAG" --verify-tag --title "$TAG" --notes-file "$WORK/notes.md" "$WORK/$ASSET"
  elif ! gh release view "$TAG" --json assets --jq '.assets[].name' | grep -qxF "$ASSET"; then
    echo "$TAG 的 release 缺安装包：在 ${TARGET:0:7} 上构建后补传"
    pack_at "$TARGET"
    run gh release upload "$TAG" "$WORK/$ASSET"
  else
    echo "✅ $TAG 的 release 与安装包都在"
  fi
else
  echo "发 $TAG（${HEAD_SHA:0:7}）"
  notes
  pack_at "$HEAD_SHA"
  run gh release create "$TAG" --target "$HEAD_SHA" --title "$TAG" --notes-file "$WORK/notes.md" "$WORK/$ASSET"
fi

if [ -n "${NPM_TOKEN:-}" ]; then
  if npm view "$NAME@$VERSION" version >/dev/null 2>&1; then
    echo "✅ npm 上已有 $NAME@$VERSION"
  else
    [ -f "$WORK/$ASSET" ] || run gh release download "$TAG" --pattern "$ASSET" --dir "$WORK"
    printf '//registry.npmjs.org/:_authToken=%s\n' "$NPM_TOKEN" > "$WORK/.npmrc"
    provenance=()
    if [ "${GITHUB_ACTIONS:-}" = true ]; then provenance=(--provenance); fi
    run npm publish "$WORK/$ASSET" --access public --userconfig "$WORK/.npmrc" "${provenance[@]}"
  fi
fi
