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

DB_HOST_VALUE="$(env_value MYSQL_HOST)"
if [ -z "${DB_HOST_VALUE}" ]; then DB_HOST_VALUE="$(env_value DB_HOST)"; fi
DB_PORT_VALUE="$(env_value MYSQL_PORT "$(env_value DB_PORT 3306)")"
DB_USER_VALUE="$(env_value MYSQL_USER)"
if [ -z "${DB_USER_VALUE}" ]; then DB_USER_VALUE="$(env_value DB_USER)"; fi
DB_PASSWORD_VALUE="$(env_value MYSQL_PASSWORD)"
if [ -z "${DB_PASSWORD_VALUE}" ]; then DB_PASSWORD_VALUE="$(env_value DB_PASSWORD)"; fi
DB_NAME_VALUE="$(env_value MYSQL_DATABASE)"
if [ -z "${DB_NAME_VALUE}" ]; then DB_NAME_VALUE="$(env_value DB_NAME)"; fi
USE_HTTPS_VALUE="$(env_value USE_HTTPS false)"
PORT_VALUE="$(env_value PORT 5000)"
CHAT_WORKER_PORT_VALUE="$(env_value CHAT_WORKER_PORT 5001)"

echo "[deploy] extract release: ${RELEASE_ARCHIVE}"
mkdir -p "${RELEASE_DIR}"
tar -xzf "${RELEASE_ARCHIVE}" -C "${RELEASE_DIR}"

for required in backend/dist backend/package.json package.json pnpm-lock.yaml pnpm-workspace.yaml ecosystem.config.cjs init-db-mysql.sql; do
  if [ ! -e "${RELEASE_DIR}/${required}" ]; then
    echo "[deploy] invalid release archive. missing: ${required}"
    exit 1
  fi
done

for writable in package.json pnpm-lock.yaml pnpm-workspace.yaml backend/package.json ecosystem.config.cjs init-db-mysql.sql deploy.sh backend/dist backend; do
  assert_can_write_path "${writable}"
done

if [ "${SKIP_DB_BACKUP:-false}" != "true" ] && command -v mysqldump >/dev/null 2>&1; then
  if [ -n "${DB_HOST_VALUE}" ] && [ -n "${DB_USER_VALUE}" ] && [ -n "${DB_NAME_VALUE}" ]; then
    mkdir -p backups
    echo "[deploy] backup mysql"
    mysqldump -h "${DB_HOST_VALUE}" -P "${DB_PORT_VALUE}" -u "${DB_USER_VALUE}" -p"${DB_PASSWORD_VALUE}" \
      --single-transaction --routines --triggers \
      "${DB_NAME_VALUE}" > "backups/mysql-before-update-${TIMESTAMP}.sql"
  else
    echo "[deploy] mysql backup skipped: MYSQL_* or DB_* env is incomplete"
  fi
fi

NEED_INSTALL=false
if [ ! -d "node_modules" ] || [ ! -d "backend/node_modules" ]; then
  NEED_INSTALL=true
elif ! cmp -s "pnpm-lock.yaml" "${RELEASE_DIR}/pnpm-lock.yaml"; then
  NEED_INSTALL=true
elif ! cmp -s "backend/package.json" "${RELEASE_DIR}/backend/package.json"; then
  NEED_INSTALL=true
fi

echo "[deploy] update metadata"
cp "${RELEASE_DIR}/package.json" package.json
cp "${RELEASE_DIR}/pnpm-lock.yaml" pnpm-lock.yaml
cp "${RELEASE_DIR}/pnpm-workspace.yaml" pnpm-workspace.yaml
cp "${RELEASE_DIR}/backend/package.json" backend/package.json
cp "${RELEASE_DIR}/ecosystem.config.cjs" ecosystem.config.cjs
cp "${RELEASE_DIR}/init-db-mysql.sql" init-db-mysql.sql
cp "${RELEASE_DIR}/deploy.sh" deploy.sh
chmod +x deploy.sh

if [ "${NEED_INSTALL}" = "true" ]; then
  if ! command -v pnpm >/dev/null 2>&1; then
    echo "[deploy] pnpm is required on the server when dependencies changed"
    exit 1
  fi
  echo "[deploy] install production dependencies because package metadata changed"
  nice -n 15 ionice -c2 -n7 pnpm install --prod --frozen-lockfile --filter backend...
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
    mysql -h "${DB_HOST_VALUE}" -P "${DB_PORT_VALUE}" -u "${DB_USER_VALUE}" -p"${DB_PASSWORD_VALUE}" "${DB_NAME_VALUE}" < init-db-mysql.sql
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

echo "[deploy] prune old releases"
find "${RELEASE_ROOT}" -mindepth 1 -maxdepth 1 -type d | sort -r | tail -n +"$((KEEP_RELEASES + 1))" | xargs -r rm -rf

echo "[deploy] status"
"${PM2_BIN}" status
