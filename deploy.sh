#!/usr/bin/env bash
set -euo pipefail

cd /home/ubuntu/ChzzkCardTradeView

# 1. .env 파일이 있으면 로드합니다.
if [ -f .env ]; then
  export $(echo $(grep -v '^#' .env | xargs))
else
  echo "[Error] .env file not found!"
  exit 1
fi

mkdir -p backups

echo "[deploy] backup mysql"
# 2. 하드코딩된 정보 대신 환경변수($DB_...)를 사용합니다.
mysqldump -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASSWORD" \
  --single-transaction \
  --routines \
  --triggers \
  "$DB_NAME" > backups/mysql-before-update-$(date +%F-%H%M%S).sql

echo "[deploy] pull"
git pull

echo "[deploy] install"
# 이전 에러 해결을 위해 --no-frozen-lockfile 로 변경하는 것을 추천합니다.
pnpm install --no-frozen-lockfile

echo "[deploy] build backend"
pnpm --filter backend build

echo "[deploy] apply schema"
# 3. 스키마 적용 부분도 환경변수로 대체합니다.
mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" < init-db-mysql.sql

echo "[deploy] reload pm2"
pm2 reload ecosystem.config.cjs --update-env

echo "[deploy] status"
pm2 status