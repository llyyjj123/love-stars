#!/usr/bin/env bash
# 一键备份 love-stars（换服务器 / 定期备份都能用）
#
# 用法：
#   bash scripts/backup-all.sh              # 备份到 /opt/love-stars/backup/auto-<时间>/
#   bash scripts/backup-all.sh /data/bak    # 指定输出目录
#
# 产出：
#   love_stars-<时间>.dump   数据库（custom 格式，pg_restore 可恢复）
#   love_stars-<时间>.sql    数据库（纯 SQL，人类可读，用于核对）
#   media-<时间>.tar.gz      照片
#   env-<时间>.tar.gz        .env（含密码，注意保管）
#   server-src-<时间>.tar.gz 源码 + dist + prisma（不含 node_modules）
#   love-stars.service       systemd 定义
#   manifest.txt             文件清单 + 行数 + 对账结果

set -euo pipefail

APP_DIR="${APP_DIR:-/opt/love-stars}"
STAMP=$(date +%Y%m%d-%H%M%S)
OUT="${1:-$APP_DIR/backup/auto-$STAMP}"

mkdir -p "$OUT"
echo "==> 输出目录: $OUT"

# sudo -u postgres 会切到 postgres 的家目录，先 cd 到 /tmp 避免 "could not change directory" 噪音
cd /tmp

# ---------- 1. 数据库 ----------
echo "==> 导出数据库"
sudo -u postgres pg_dump -Fc love_stars > "$OUT/love_stars-$STAMP.dump"
sudo -u postgres pg_dump     love_stars > "$OUT/love_stars-$STAMP.sql"

# ---------- 2. 行数 + 对账 ----------
echo "==> 记录行数与对账"
{
  echo "# love-stars 备份清单 $STAMP"
  echo
  echo "## 表行数"
  for t in Task User Account Item LedgerOp LedgerEntry CheckIn CheckinStreak Redemption Nudge Outbox AuditLog Gift; do
    n=$(sudo -u postgres psql -tAc "select count(*) from \"$t\"" -d love_stars 2>/dev/null || echo "?")
    echo "$t=$n"
  done
  echo
  echo "## 对账（sum 必须为 0）"
  sudo -u postgres psql -tAc 'select sum(balance) from "Account"' -d love_stars
  echo
  echo "## 余额明细"
  sudo -u postgres psql -tAc 'select kind, coalesce("ownerId", chr(45)), balance from "Account" order by kind' -d love_stars
} | tee "$OUT/manifest.txt"

SUM=$(sudo -u postgres psql -tAc 'select sum(balance) from "Account"' -d love_stars)
if [ "$SUM" != "0" ]; then
  echo "!! 警告：sum(balance) = $SUM，不是 0。备份已生成，但请先查账再迁移。" >&2
fi

# ---------- 3. 媒体 ----------
echo "==> 打包媒体"
tar czf "$OUT/media-$STAMP.tar.gz" -C "$APP_DIR/data" media
COUNT=$(tar tzf "$OUT/media-$STAMP.tar.gz" | grep -c 'media/.*\.' || true)
echo "media 文件数: $COUNT" | tee -a "$OUT/manifest.txt"

# ---------- 4. .env ----------
echo "==> 打包 .env"
tar czf "$OUT/env-$STAMP.tar.gz" -C "$APP_DIR" server/.env
chmod 600 "$OUT/env-$STAMP.tar.gz"

# ---------- 5. 代码 ----------
echo "==> 打包代码（不含 node_modules）"
tar czf "$OUT/server-src-$STAMP.tar.gz" \
  -C "$APP_DIR" \
  --exclude='server/node_modules' \
  --exclude='server/dist.bak*' \
  --exclude='server/dist.old' \
  --exclude='server/data' \
  server/src server/dist server/prisma server/test \
  server/package.json server/package-lock.json \
  server/prisma.config.ts server/tsconfig.json

# ---------- 6. systemd ----------
cp /etc/systemd/system/love-stars.service "$OUT/" 2>/dev/null || echo "(systemd 文件不存在，跳过)"

# ---------- 7. 汇总 ----------
echo
echo "==> 完成，文件清单："
ls -lh "$OUT"
echo
echo "下一步：把整个目录下载到本地"
echo "  scp -r root@<服务器IP>:$OUT D:/learn/migrate/"
