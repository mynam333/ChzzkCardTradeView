#!/usr/bin/env bash
set -euo pipefail

cd /home/ubuntu/ChzzkCardTradeView

# lock
exec 9>/tmp/deploy.lock
flock -n 9 || { echo "[deploy] already running"; exit 1; }

# env (더 안전한 방식)
if [ -f .env ]; then
  set -a
  . ./.env
  set +a
else
  echo "[Error] .env file not found!"
  exit 1
fi

mkdir -p backups

echo "[deploy] backup mysql"
mysqldump -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASSWORD" \
  --single-transaction --routines --triggers \
  "$DB_NAME" > backups/mysql-before-update-$(date +%F-%H%M%S).sql

echo "[deploy] pull"
git pull --ff-only

# 🚨 [추가] 빌드 전 기존 Node 프로세스를 멈춰 메모리와 CPU를 확보합니다.
echo "[deploy] stop PM2 to free up memory"
pm2 stop ecosystem.config.cjs || echo "PM2 is not running, skipping stop."

echo "[deploy] install (throttled)"
nice -n 15 ionice -c2 -n7 pnpm fetch
nice -n 15 ionice -c2 -n7 pnpm install \
  --offline \
  --frozen-lockfile \
  --child-concurrency=1 \
  --network-concurrency=8

echo "[deploy] build backend"
nice -n 15 ionice -c2 -n7 pnpm --filter backend build

echo "[deploy] apply schema"
mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" < init-db-mysql.sql

# 🚨 [수정] 멈춰있던 PM2를 환경변수 업데이트와 함께 다시 구동합니다.
echo "[deploy] reload and start PM2"
pm2 reload ecosystem.config.cjs --update-env

echo "[deploy] status"
pm2 status