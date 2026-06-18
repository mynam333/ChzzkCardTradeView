#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/home/ubuntu/ChzzkCardTradeView}"
RELEASE_ARCHIVE="${1:-}"
RELEASE_ROOT="${PROJECT_DIR}/releases"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
RELEASE_DIR="${RELEASE_ROOT}/${TIMESTAMP}"
LOCK_FILE="${PROJECT_DIR}/deploy.lock"
API_APP_NAME="${API_APP_NAME:-chikapo-api}"
WORKER_APP_NAMES="${WORKER_APP_NAMES:-chikapo-live-worker chikapo-scheduler-worker chikapo-backup-worker chikapo-image-worker chikapo-chat-worker}"
KEEP_RELEASES="${KEEP_RELEASES:-5}"
REQUIRED_NODE_MAJOR="${REQUIRED_NODE_MAJOR:-22}"
CLEANUP_RELEASE_ARTIFACTS="${CLEANUP_RELEASE_ARTIFACTS:-true}"

resolve_command() {
  local command_name="$1"
  local candidate

  if command -v "${command_name}" >/dev/null 2>&1; then
    command -v "${command_name}"
    return
  fi

  for candidate in \
    "${HOME:-}/.local/bin/${command_name}" \
    "${HOME:-}/.npm-global/bin/${command_name}" \
    "${HOME:-}/.nvm/versions/node"/*"/bin/${command_name}" \
    "/usr/local/bin/${command_name}" \
    "/usr/bin/${command_name}"; do
    if [ -x "${candidate}" ]; then
      printf '%s\n' "${candidate}"
      return
    fi
  done

  return 1
}

resolve_node() {
  local candidate

  if [ -n "${NODE_BIN:-}" ] && [ -x "${NODE_BIN}" ]; then
    printf '%s\n' "${NODE_BIN}"
    return
  fi

  for candidate in \
    "${HOME:-}/.nvm/versions/node/v${REQUIRED_NODE_MAJOR}"*"/bin/node" \
    "/opt/node-v${REQUIRED_NODE_MAJOR}"*"/bin/node" \
    "/usr/local/node-v${REQUIRED_NODE_MAJOR}"*"/bin/node"; do
    if [ -x "${candidate}" ]; then
      printf '%s\n' "${candidate}"
      return
    fi
  done

  if command -v node >/dev/null 2>&1; then
    command -v node
    return
  fi

  return 1
}

assert_node_version() {
  local node_bin="$1"
  local version major

  version="$("${node_bin}" -p "process.versions.node" 2>/dev/null || true)"
  major="${version%%.*}"
  if [ -z "${version}" ] || [ "${major:-0}" -lt "${REQUIRED_NODE_MAJOR}" ]; then
    echo "[deploy] Node.js ${REQUIRED_NODE_MAJOR}+ is required for production install."
    echo "[deploy] current node: ${node_bin:-not found} ${version:-unknown}"
    echo "[deploy] install Node.js ${REQUIRED_NODE_MAJOR} on the server, or set NODE_BIN to a compatible node binary."
    echo "[deploy] nvm example:"
    echo "[deploy]   nvm install ${REQUIRED_NODE_MAJOR}"
    echo "[deploy]   nvm alias default ${REQUIRED_NODE_MAJOR}"
    echo "[deploy]   corepack enable"
    echo "[deploy]   corepack prepare pnpm@10 --activate"
    echo "[deploy]   npm install -g pm2"
    exit 1
  fi
}

NODE_BIN="$(resolve_node || true)"
if [ -z "${NODE_BIN}" ]; then
  echo "[deploy] node command not found"
  echo "[deploy] install Node.js ${REQUIRED_NODE_MAJOR}, or set NODE_BIN to a compatible node binary."
  exit 1
fi
assert_node_version "${NODE_BIN}"
NODE_DIR="$(dirname "${NODE_BIN}")"
export PATH="${NODE_DIR}:${PATH}"

PM2_BIN="${PM2_BIN:-}"
if [ -z "${PM2_BIN}" ]; then
  PM2_BIN="$(resolve_command pm2 || true)"
fi

if [ -z "${RELEASE_ARCHIVE}" ]; then
  echo "[deploy] usage: ./deploy.sh /path/to/backend-release.tar.gz"
  exit 1
fi

if [ -z "${PM2_BIN}" ]; then
  echo "[deploy] pm2 command not found in non-interactive SSH PATH"
  echo "[deploy] install pm2 globally for the deploy user, or set PM2_BIN in the server environment."
  echo "[deploy] examples:"
  echo "[deploy]   npm install -g pm2"
  echo "[deploy]   echo 'PM2_BIN=\$(command -v pm2)' >> ~/.profile"
  exit 1
fi

cd "${PROJECT_DIR}"
mkdir -p "${RELEASE_ROOT}"

exec 9>"${LOCK_FILE}"
flock -n 9 || { echo "[deploy] already running"; exit 1; }

if [ ! -f "${RELEASE_ARCHIVE}" ]; then
  echo "[deploy] release archive not found: ${RELEASE_ARCHIVE}"
  exit 1
fi

assert_can_write_path() {
  local target="$1"
  local parent

  if [ -e "${target}" ]; then
    if [ ! -w "${target}" ]; then
      echo "[deploy] permission denied: ${target}"
      echo "[deploy] fix ownership on the server, for example:"
      echo "[deploy]   sudo chown -R \$(whoami):\$(id -gn) '${PROJECT_DIR}'"
      exit 1
    fi
    return
  fi

  parent="$(dirname "${target}")"
  if [ ! -w "${parent}" ]; then
    echo "[deploy] permission denied: cannot create ${target}"
    echo "[deploy] fix ownership on the server, for example:"
    echo "[deploy]   sudo chown -R \$(whoami):\$(id -gn) '${PROJECT_DIR}'"
    exit 1
  fi
}

read_env_value() {
  local key="$1"
  local result=""
  local file line value

  for file in ".env" "backend/.env" ".env.deploy"; do
    [ -f "${file}" ] || continue
    while IFS= read -r line || [ -n "${line}" ]; do
      line="${line%$'\r'}"
      case "${line}" in
        ""|\#*) continue ;;
        export\ *) line="${line#export }" ;;
      esac
      case "${line}" in
        "${key}="*)
          value="${line#*=}"
          if [[ "${value}" == \"*\" && "${value}" == *\" ]]; then
            value="${value:1:${#value}-2}"
          elif [[ "${value}" == \'*\' && "${value}" == *\' ]]; then
            value="${value:1:${#value}-2}"
          fi
          result="${value}"
          ;;
      esac
    done < "${file}"
  done

  printf '%s' "${result}"
}

env_value() {
  local key="$1"
  local fallback="${2:-}"
  local existing="${!key-}"
  local parsed=""

  if [ -n "${existing}" ]; then
    printf '%s' "${existing}"
    return
  fi

  parsed="$(read_env_value "${key}")"
  if [ -n "${parsed}" ]; then
    printf '%s' "${parsed}"
  else
    printf '%s' "${fallback}"
  fi
}

set_env_file_value() {
  local file="$1"
  local key="$2"
  local value="$3"

  [ -f "${file}" ] || return 0

  if grep -Eq "^(export[[:space:]]+)?${key}=" "${file}"; then
    sed -i -E "s|^(export[[:space:]]+)?${key}=.*|\\1${key}=${value}|" "${file}"
  else
    printf '\n%s=%s\n' "${key}" "${value}" >> "${file}"
  fi
}

DEPLOY_MYSQL_HOST="${DEPLOY_MYSQL_HOST-127.0.0.1}"
if [ -n "${DEPLOY_MYSQL_HOST}" ]; then
  for env_file in ".env" "backend/.env" ".env.deploy"; do
    if [ -f "${env_file}" ]; then
      echo "[deploy] set MYSQL_HOST=${DEPLOY_MYSQL_HOST} in ${env_file}"
      set_env_file_value "${env_file}" "MYSQL_HOST" "${DEPLOY_MYSQL_HOST}"
    fi
  done
fi

DB_HOST_VALUE="$(env_value MYSQL_HOST)"
if [ -z "${DB_HOST_VALUE}" ]; then DB_HOST_VALUE="$(env_value DB_HOST)"; fi
DB_PORT_VALUE="$(env_value MYSQL_PORT "$(env_value DB_PORT 3306)")"
DB_USER_VALUE="$(env_value MYSQL_USER)"
if [ -z "${DB_USER_VALUE}" ]; then DB_USER_VALUE="$(env_value DB_USER)"; fi
DB_PASSWORD_VALUE="$(env_value MYSQL_PASSWORD)"
if [ -z "${DB_PASSWORD_VALUE}" ]; then DB_PASSWORD_VALUE="$(env_value DB_PASSWORD)"; fi
DB_NAME_VALUE="$(env_value MYSQL_DATABASE)"
if [ -z "${DB_NAME_VALUE}" ]; then DB_NAME_VALUE="$(env_value DB_NAME)"; fi
DB_CONNECT_TIMEOUT="${DB_CONNECT_TIMEOUT:-10}"
DB_COMMAND_TIMEOUT="${DB_COMMAND_TIMEOUT:-90}"
DB_BACKUP_RETRIES="${DB_BACKUP_RETRIES:-3}"
DB_BACKUP_RETRY_DELAY="${DB_BACKUP_RETRY_DELAY:-5}"
DB_SCHEMA_RETRIES="${DB_SCHEMA_RETRIES:-3}"
DB_SCHEMA_RETRY_DELAY="${DB_SCHEMA_RETRY_DELAY:-5}"
USE_HTTPS_VALUE="$(env_value USE_HTTPS false)"
PORT_VALUE="$(env_value PORT 5000)"
CHAT_WORKER_PORT_VALUE="$(env_value CHAT_WORKER_PORT 5001)"

run_with_db_timeout() {
  if command -v timeout >/dev/null 2>&1; then
    timeout "${DB_COMMAND_TIMEOUT}s" "$@"
  else
    "$@"
  fi
}

print_db_error() {
  local label="$1"
  local log_file="$2"
  local status="$3"

  if [ "${status}" = "124" ]; then
    echo "[deploy] ${label} timed out after ${DB_COMMAND_TIMEOUT}s"
  fi
  if [ -s "${log_file}" ]; then
    echo "[deploy] ${label} error: $(tail -n 1 "${log_file}" | sed -E 's/(password: )[^\r\n]+/\1****/Ig')"
  fi
}

run_mysql_backup() {
  local output_file="$1"
  local tmp_file="${output_file}.tmp"
  local err_file="${output_file}.err"
  local attempt=1
  local status=0
  local dump_args=(--single-transaction --routines --triggers)

  if [ -n "${MYSQLDUMP_GTID_ARG:-}" ]; then
    dump_args+=("${MYSQLDUMP_GTID_ARG}")
  fi
  if [ "${MYSQLDUMP_INCLUDE_DERIVED_TABLES:-false}" != "true" ]; then
    dump_args+=(
      "--ignore-table=${DB_NAME_VALUE}.user_asset_rankings"
      "--ignore-table=${DB_NAME_VALUE}.user_asset_rankings_old"
      "--ignore-table=${DB_NAME_VALUE}.user_asset_rankings_next"
      "--ignore-table=${DB_NAME_VALUE}.user_asset_ranking_cards"
      "--ignore-table=${DB_NAME_VALUE}.user_asset_ranking_cards_old"
      "--ignore-table=${DB_NAME_VALUE}.user_asset_ranking_cards_next"
    )
  fi

  while [ "${attempt}" -le "${DB_BACKUP_RETRIES}" ]; do
    status=0
    if run_with_db_timeout env MYSQL_PWD="${DB_PASSWORD_VALUE}" mysqldump \
      -h "${DB_HOST_VALUE}" -P "${DB_PORT_VALUE}" -u "${DB_USER_VALUE}" \
      "${dump_args[@]}" \
      "${DB_NAME_VALUE}" > "${tmp_file}" 2> "${err_file}"; then
      mv "${tmp_file}" "${output_file}"
      rm -f "${err_file}"
      return 0
    else
      status="$?"
    fi

    rm -f "${tmp_file}"
    print_db_error "mysql backup" "${err_file}" "${status}"
    if [ "${attempt}" -lt "${DB_BACKUP_RETRIES}" ]; then
      echo "[deploy] mysql backup failed; retry ${attempt}/${DB_BACKUP_RETRIES} after ${DB_BACKUP_RETRY_DELAY}s"
      sleep "${DB_BACKUP_RETRY_DELAY}"
    fi
    attempt="$((attempt + 1))"
  done

  rm -f "${err_file}"
  return 1
}

run_mysql_schema() {
  local attempt=1
  local err_file="backups/mysql-schema-${TIMESTAMP}.err"
  local status=0

  while [ "${attempt}" -le "${DB_SCHEMA_RETRIES}" ]; do
    status=0
    if run_with_db_timeout env MYSQL_PWD="${DB_PASSWORD_VALUE}" mysql \
      -h "${DB_HOST_VALUE}" -P "${DB_PORT_VALUE}" -u "${DB_USER_VALUE}" "${DB_NAME_VALUE}" < init-db-mysql.sql 2> "${err_file}"; then
      rm -f "${err_file}"
      return 0
    else
      status="$?"
    fi

    print_db_error "mysql schema" "${err_file}" "${status}"
    if [ "${attempt}" -lt "${DB_SCHEMA_RETRIES}" ]; then
      echo "[deploy] mysql schema apply failed; retry ${attempt}/${DB_SCHEMA_RETRIES} after ${DB_SCHEMA_RETRY_DELAY}s"
      sleep "${DB_SCHEMA_RETRY_DELAY}"
    fi
    attempt="$((attempt + 1))"
  done

  rm -f "${err_file}"
  return 1
}

echo "[deploy] extract release: ${RELEASE_ARCHIVE}"
mkdir -p "${RELEASE_DIR}"
tar -xzf "${RELEASE_ARCHIVE}" -C "${RELEASE_DIR}"

for required in backend/dist backend/package.json package.json pnpm-workspace.yaml ecosystem.config.cjs init-db-mysql.sql; do
  if [ ! -e "${RELEASE_DIR}/${required}" ]; then
    echo "[deploy] invalid release archive. missing: ${required}"
    exit 1
  fi
done

for writable in package.json pnpm-workspace.yaml backend/package.json ecosystem.config.cjs init-db-mysql.sql deploy.sh backend/dist backend; do
  assert_can_write_path "${writable}"
done

if [ "${SKIP_DB_BACKUP:-false}" != "true" ] && command -v mysqldump >/dev/null 2>&1; then
  if [ -n "${DB_HOST_VALUE}" ] && [ -n "${DB_USER_VALUE}" ] && [ -n "${DB_NAME_VALUE}" ]; then
    mkdir -p backups
    echo "[deploy] backup mysql"
    MYSQLDUMP_GTID_ARG=""
    if mysqldump --help 2>/dev/null | grep -q -- '--set-gtid-purged'; then
      MYSQLDUMP_GTID_ARG="--set-gtid-purged=OFF"
    fi
    if ! run_mysql_backup "backups/mysql-before-update-${TIMESTAMP}.sql"; then
      echo "[deploy] mysql backup failed after ${DB_BACKUP_RETRIES} attempts: ${DB_HOST_VALUE}:${DB_PORT_VALUE}/${DB_NAME_VALUE}"
      echo "[deploy] check DB VM/service, private IP route, firewall/security-list, MYSQL_HOST/MYSQL_PORT, and DB credentials."
      if [ "${SKIP_DB_BACKUP_ON_FAILURE:-false}" = "true" ]; then
        echo "[deploy] continue because SKIP_DB_BACKUP_ON_FAILURE=true"
      else
        echo "[deploy] aborting before app replacement to avoid deploying without a fresh DB backup."
        exit 2
      fi
    fi
  else
    echo "[deploy] mysql backup skipped: MYSQL_* or DB_* env is incomplete"
  fi
fi

NEED_INSTALL=false
if [ ! -d "node_modules" ] || [ ! -d "backend/node_modules" ]; then
  NEED_INSTALL=true
elif ! cmp -s "backend/package.json" "${RELEASE_DIR}/backend/package.json"; then
  NEED_INSTALL=true
fi

echo "[deploy] update metadata"
cp "${RELEASE_DIR}/package.json" package.json
cp "${RELEASE_DIR}/pnpm-workspace.yaml" pnpm-workspace.yaml
cp "${RELEASE_DIR}/backend/package.json" backend/package.json
cp "${RELEASE_DIR}/ecosystem.config.cjs" ecosystem.config.cjs
cp "${RELEASE_DIR}/init-db-mysql.sql" init-db-mysql.sql
cp "${RELEASE_DIR}/deploy.sh" deploy.sh
chmod +x deploy.sh

if [ "${NEED_INSTALL}" != "true" ]; then
  MISSING_PROD_DEPS="$("${NODE_BIN}" -e "
    const fs = require('fs');
    const pkg = JSON.parse(fs.readFileSync('backend/package.json', 'utf8'));
    const deps = Object.keys(pkg.dependencies || {});
    const missing = deps.filter((dep) => !fs.existsSync('backend/node_modules/' + dep));
    if (missing.length) process.stdout.write(missing.join(' '));
  ")"
  if [ -n "${MISSING_PROD_DEPS}" ]; then
    echo "[deploy] production dependencies missing; install required: ${MISSING_PROD_DEPS}"
    NEED_INSTALL=true
  fi
fi

if [ "${NEED_INSTALL}" = "true" ]; then
  if ! command -v pnpm >/dev/null 2>&1; then
    echo "[deploy] pnpm is required on the server when dependencies changed"
    exit 1
  fi
  echo "[deploy] install production dependencies because package metadata changed"
  CI=true PNPM_CONFIG_CONFIRM_MODULES_PURGE=false \
    nice -n 15 ionice -c2 -n7 pnpm install --prod --no-lockfile --config.confirm-modules-purge=false --filter backend...
else
  echo "[deploy] dependencies unchanged; skip install"
fi

echo "[deploy] replace backend dist"
rm -rf backend/dist.next
cp -a "${RELEASE_DIR}/backend/dist" backend/dist.next
if [ -d backend/dist ]; then
  rm -rf "backend/dist.prev"
  mv backend/dist backend/dist.prev
fi
mv backend/dist.next backend/dist

if [ "${SKIP_SCHEMA:-false}" != "true" ] && command -v mysql >/dev/null 2>&1; then
  if [ -n "${DB_HOST_VALUE}" ] && [ -n "${DB_USER_VALUE}" ] && [ -n "${DB_NAME_VALUE}" ]; then
    echo "[deploy] apply mysql schema"
    if ! run_mysql_schema; then
      echo "[deploy] mysql schema apply failed after ${DB_SCHEMA_RETRIES} attempts: ${DB_HOST_VALUE}:${DB_PORT_VALUE}/${DB_NAME_VALUE}"
      echo "[deploy] check DB connectivity before re-running deployment."
      exit 2
    fi
  else
    echo "[deploy] schema skipped: MYSQL_* or DB_* env is incomplete"
  fi
fi

echo "[deploy] reload api without downtime"
"${PM2_BIN}" startOrReload ecosystem.config.cjs --only "${API_APP_NAME}" --update-env

HEALTHCHECK_URL="${HEALTHCHECK_URL:-}"
if [ -z "${HEALTHCHECK_URL}" ]; then
  HEALTHCHECK_SCHEME="http"
  if [ "${USE_HTTPS_VALUE}" = "true" ]; then
    HEALTHCHECK_SCHEME="https"
  fi
  HEALTHCHECK_URL="${HEALTHCHECK_SCHEME}://127.0.0.1:${PORT_VALUE}/health"
fi

echo "[deploy] health check: ${HEALTHCHECK_URL}"
for attempt in $(seq 1 30); do
  if curl -fsSk "${HEALTHCHECK_URL}" >/dev/null; then
    echo "[deploy] api is healthy"
    break
  fi
  if [ "${attempt}" = "30" ]; then
    echo "[deploy] api health check failed"
    "${PM2_BIN}" status
    exit 1
  fi
  sleep 1
done

echo "[deploy] reload workers sequentially"
for app_name in ${WORKER_APP_NAMES}; do
  "${PM2_BIN}" startOrReload ecosystem.config.cjs --only "${app_name}" --update-env
  if [ "${app_name}" = "chikapo-chat-worker" ]; then
    CHAT_HEALTHCHECK_URL="${CHAT_HEALTHCHECK_URL:-http://127.0.0.1:${CHAT_WORKER_PORT_VALUE}/health}"
    echo "[deploy] chat worker health check: ${CHAT_HEALTHCHECK_URL}"
    for attempt in $(seq 1 20); do
      if curl -fsSk "${CHAT_HEALTHCHECK_URL}" >/dev/null; then
        echo "[deploy] chat worker is healthy"
        break
      fi
      if [ "${attempt}" = "20" ]; then
        echo "[deploy] chat worker health check failed"
        "${PM2_BIN}" status
        exit 1
      fi
      sleep 1
    done
  fi
  sleep 2
done

if [ "${CLEANUP_RELEASE_ARTIFACTS}" = "true" ]; then
  echo "[deploy] cleanup release artifacts"
  rm -rf "${RELEASE_DIR}"
  rm -f "${RELEASE_ARCHIVE}"
else
  echo "[deploy] prune old releases"
  find "${RELEASE_ROOT}" -mindepth 1 -maxdepth 1 -type d | sort -r | tail -n +"$((KEEP_RELEASES + 1))" | xargs -r rm -rf
fi

echo "[deploy] status"
"${PM2_BIN}" status
