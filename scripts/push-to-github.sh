#!/usr/bin/env bash
# 把本地仓库推送到 GitHub
# 用法：
#   bash scripts/push-to-github.sh https://github.com/<用户名>/<仓库名>.git
# 或（推荐，需已配置 SSH key）：
#   bash scripts/push-to-github.sh git@github.com:<用户名>/<仓库名>.git
#
# 注意：本脚本不会记录或上传任何证书、密钥。

set -euo pipefail

REMOTE_URL="${1:-}"

if [ -z "$REMOTE_URL" ]; then
  echo "用法: bash scripts/push-to-github.sh <git 仓库地址>"
  echo "示例: bash scripts/push-to-github.sh https://github.com/me/love-stars.git"
  exit 1
fi

cd "$(dirname "$0")/.."

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "错误：当前目录不是 git 仓库"
  exit 1
fi

if git remote get-url origin >/dev/null 2>&1; then
  echo "已存在 origin，更新为: $REMOTE_URL"
  git remote set-url origin "$REMOTE_URL"
else
  echo "添加 origin: $REMOTE_URL"
  git remote add origin "$REMOTE_URL"
fi

echo "--- 待推送的提交 ---"
git --no-pager log --oneline -n 5

echo "--- 检查是否误提交敏感文件 ---"
LEAK=0
for pattern in "*.jks" "*.keystore" "key.properties" ".env" "*.p12" "*.mobileprovision"; do
  if git ls-files --error-unmatch "$pattern" >/dev/null 2>&1; then
    echo "  ✗ 发现敏感文件: $pattern"
    LEAK=1
  fi
done
if [ "$LEAK" -eq 1 ]; then
  echo "检测到敏感文件已被跟踪，请先执行: git rm --cached <文件> 并提交"
  exit 1
fi
echo "  ✓ 未发现敏感文件"

echo "--- 推送 ---"
git push -u origin main

echo ""
echo "完成。打开 https://github.com 查看 Actions 标签页，即可手动触发构建。"
