#!/usr/bin/env bash
# 私有词闸：公开仓里不许出现任何宿主（接入本引擎的站点）的名字、内部路径、内部文档名、个人信息。
# ─────────────────────────────────────────────────────────────────────────────
# 词表**不进仓**（进了仓，词表本身就是泄露）：默认读仓根的 `.private-terms`（已在 .gitignore 里），
# 每行一个 ERE 正则（不分大小写），`#` 开头是注释；也可以用环境变量 PRIVATE_TERMS_FILE 指向别处
# （CI 里把词表放进 secret、写成临时文件再指过来）。
# 没有词表时只提示、不失败：公开的 fork 与贡献者不需要、也不应该知道你的私有词。
#
# 缺省查四样东西，都是「推上去就公开」的：
#   ① 会被提交的文件（已跟踪的 + 未跟踪但没被忽略的）；
#   ② 还没推到任何远端的提交信息；
#   ③ 还没推到任何远端的提交里**加进去**的行（先加后删也会留在历史里）；
#   ④ 本地分支名（推送后分支名公开；只警告不失败——分支名有时是工具指定的）。
# `--history`：审计全部可达历史（所有提交加进去的行与提交信息）和所有引用名（含远端分支、标签），有就失败。
#   仓库已经公开过的词只能靠改写历史清掉，这个模式用来确认改写干净了。
set -euo pipefail
cd "$(dirname "$0")/.."
mode="${1:-}"

file="${PRIVATE_TERMS_FILE:-.private-terms}"
if [ ! -f "$file" ]; then
  echo "ℹ️  没有私有词表（$file），跳过私有词闸"
  exit 0
fi
pattern=$(grep -vE '^[[:space:]]*(#|$)' "$file" | paste -sd'|' - || true)
if [ -z "$pattern" ]; then
  echo "ℹ️  私有词表是空的，跳过私有词闸"
  exit 0
fi

fail=0
hits=$(git ls-files -z --cached --others --exclude-standard | xargs -0 -r grep -nIiE -- "$pattern" 2>/dev/null || true)
if [ -n "$hits" ]; then
  echo "❌ 文件里有私有词（推上去就公开）："
  echo "$hits"
  fail=1
fi

if [ "$mode" = "--history" ]; then
  range=(--all)
  scope="全部历史"
else
  range=(--branches --not --remotes)
  scope="未推送的提交"
fi

msgs=$(git log "${range[@]}" --format='%h %s%n%b' 2>/dev/null | grep -nIiE -- "$pattern" || true)
if [ -n "$msgs" ]; then
  echo "❌ ${scope}的提交信息里有私有词："
  echo "$msgs"
  fail=1
fi

added=$(git log "${range[@]}" -p --format='commit %h' 2>/dev/null | awk '/^commit /{c=$2} /^\+[^+]/{print c": "$0}' | grep -IiE -- "$pattern" || true)
if [ -n "$added" ]; then
  echo "❌ ${scope}里加进去过私有词（删掉也还在历史里）："
  echo "$added" | head -50
  fail=1
fi

if [ "$mode" = "--history" ]; then
  refs=$(git for-each-ref --format='%(refname:short)' | grep -iE -- "$pattern" || true)
  if [ -n "$refs" ]; then echo "❌ 引用名里有私有词（含远端分支 / 标签）："; echo "$refs"; fail=1; fi
else
  refs=$(git for-each-ref --format='%(refname:short)' refs/heads | grep -iE -- "$pattern" || true)
  if [ -n "$refs" ]; then
    echo "⚠️  本地分支名里有私有词——推送后分支名公开，合并后记得删掉远端分支，能改名就改名："
    echo "$refs"
  fi
fi

if [ "$fail" -ne 0 ]; then exit 1; fi
echo "✅ 没有私有词"
