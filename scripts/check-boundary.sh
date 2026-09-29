#!/usr/bin/env bash
# 引擎边界闸：src/ 里不许出现宿主框架与宿主环境的痕迹——
#   · `server-only` / `next/` / `react`：框架标记留在宿主的包装层；
#   · `process.env`：key 与配置一律由宿主传进来，引擎不读环境；
#   · `@/`：宿主仓的路径别名。
# 另：主入口 index.ts 不许导出 openalex（出网代码只走单独入口）；
#     浏览器能用的入口（index / client）运行时的依赖图里不许有服务端模块（scripts/check-entry-graph.mjs）；
#     只有 openalex.ts（出网到外部源）与 client.ts（打宿主自己的 API）可以调 fetch。
set -euo pipefail
cd "$(dirname "$0")/.."
bad=$(grep -rnE "server-only|from ['\"]next/|from ['\"]react|process\.env|from ['\"]@/" src/ || true)
if [ -n "$bad" ]; then echo "❌ src/ 里有宿主耦合："; echo "$bad"; exit 1; fi
if grep -nE "openalex" src/index.ts | grep -vE "^\s*[0-9]+:\s*(//|\*|/\*)" | grep -E "export|import" >/dev/null; then
  echo "❌ src/index.ts 导出了 openalex（出网代码只许走单独入口）"; exit 1
fi
# 裸 fetch 标识符（直接调用、`(x ?? fetch)(…)`、赋值给别的名字都算）；注释行、类型位置（`fetch?:` / `typeof fetch`）不算
fetchers=$(grep -nE "(^|[^.A-Za-z_'\"\`])fetch([^A-Za-z_]|$)" src/*.ts | grep -vE "^[^:]+:[0-9]+:[[:space:]]*(//|\*|/\*)" \
  | grep -vE "fetch\?:|typeof fetch|'\[evidence\.[a-z]+\] fetch failed'" | cut -d: -f1 | sort -u | grep -vE "^src/(openalex|client)\.ts$" || true)
if [ -n "$fetchers" ]; then echo "❌ 只有 openalex.ts 与 client.ts 可以调 fetch："; echo "$fetchers"; exit 1; fi
node scripts/check-entry-graph.mjs
echo "✅ 引擎边界干净"
