#!/usr/bin/env bash
#
# deploy.sh — 构建并推送（第三站轻页 PDF 工具）
#
# 与另两个站点（网站副业 / 网站副业2）保持同一套约定：
#   本地构建校验 → 提交 → 推送 GitHub → Cloudflare Pages 自动部署
#
# Cloudflare Pages 项目配置（与另两个站点一致）：
#   构建命令：python3 build.py --build
#   输出目录：dist
#
# 用法：
#   ./deploy.sh "本次改了什么"    # 构建 + 提交 + 推送
#   ./deploy.sh --preview         # 只本地构建，不推送
#
# 首次使用：
#   git remote add origin git@github.com:linluo2012/qingye-pdf-tools.git

set -euo pipefail
cd "$(dirname "$0")"

PY="/Users/linluo2012/.workbuddy/binaries/python/versions/3.13.12/bin/python3"
[ -x "$PY" ] || PY="$(command -v python3)"

DOMAIN=""
if [ -f domain.txt ]; then
  DOMAIN="$(head -1 domain.txt | tr -d ' \n\r')"
fi
if [ -z "$DOMAIN" ]; then
  echo "错误：找不到域名。在 domain.txt 第一行写入 pdf.linwt.top 即可。"
  exit 1
fi

echo "主域名: $DOMAIN"
echo

# 用与云端一致的 --build 模式校验，这样本地验过的产物就是线上会跑的那份。
# dist/ 与 site/ 都不入库，Cloudflare Pages 云端会重新生成。
echo "[1/4] 本地构建校验（与云端相同的 --build 模式）…"
"$PY" build.py "$DOMAIN" --build
echo

if [ "${1:-}" = "--preview" ]; then
  echo "预览构建完成，未推送。产物在 dist/，本地打开 dist/index.html 可查看。"
  exit 0
fi

MSG="${1:-}"
if [ -z "$MSG" ]; then
  read -r -p "请输入本次改动说明: " MSG
  [ -n "$MSG" ] || { echo "已取消"; exit 0; }
fi

echo "[2/4] 检查改动…"
git add -A
if [ -z "$(git status --porcelain)" ]; then
  echo "没有检测到任何改动，无需推送。"
  exit 0
fi

if ! git remote get-url origin >/dev/null 2>&1; then
  echo "尚未关联远程仓库。先执行一次："
  echo "  git remote add origin git@github.com:linluo2012/qingye-pdf-tools.git"
  exit 1
fi

echo "[3/4] 提交改动…"
git commit -q -m "$MSG"

echo "[4/4] 推送到 GitHub…"
BRANCH="$(git branch --show-current)"
push_ok=0
for attempt in 1 2 3; do
  if [ "$attempt" -gt 1 ]; then
    echo "      重试（第 $attempt 次）…"
    sleep 4
  fi
  if git push origin "$BRANCH" 2>&1; then
    push_ok=1
    break
  fi
done

if [ "$push_ok" -ne 1 ]; then
  echo
  echo "推送失败。代码已安全提交在本地，不会丢失。"
  echo "检查网络或 GitHub 权限后重试： git push origin $BRANCH"
  exit 1
fi

echo
echo "已推送。Cloudflare Pages 将在约 30 秒内自动部署。"
echo "线上地址：https://$DOMAIN/"
echo "备用入口：https://qingye-pdf-tools.app.workbuddy.host/（内容同步更新）"
echo "想撤销：git revert HEAD --no-edit && git push origin $BRANCH"