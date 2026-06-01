#!/usr/bin/env bash
set -Eeuo pipefail

BRANCH="${BRANCH:-main}"
APP_DIR="${APP_DIR:-/opt/outlook-lite}"
APP_USER="${APP_USER:-outlooklite}"
SERVICE_NAME="${SERVICE_NAME:-outlook-lite}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"

log() {
  printf '\n\033[1;32m%s\033[0m\n' "$1"
}

fail() {
  printf '\n\033[1;31m%s\033[0m\n' "$1" >&2
  exit 1
}

require_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    fail "请使用 root 权限运行，例如：sudo outlook-lite-update"
  fi
}

generate_secret() {
  openssl rand -base64 32 | tr -d '\n'
}

prepare_admin_data() {
  local data_dir="${APP_DIR}/data"
  local password_file="${data_dir}/admin-password"
  local session_secret_file="${data_dir}/admin-session-secret"
  local dropin_dir="/etc/systemd/system/${SERVICE_NAME}.service.d"
  local generated_password="no"

  log "准备文件版统计和管理员配置"
  mkdir -p "${data_dir}"

  if [[ -z "${ADMIN_PASSWORD}" && -f "${password_file}" ]]; then
    ADMIN_PASSWORD="$(cat "${password_file}")"
  fi
  if [[ -z "${ADMIN_PASSWORD}" ]]; then
    ADMIN_PASSWORD="$(generate_secret)"
    generated_password="yes"
  fi

  printf '%s' "${ADMIN_PASSWORD}" >"${password_file}"
  if [[ ! -f "${session_secret_file}" ]]; then
    generate_secret >"${session_secret_file}"
  fi

  chown -R "${APP_USER}:${APP_USER}" "${data_dir}"
  chmod 700 "${data_dir}"
  chmod 600 "${password_file}" "${session_secret_file}"

  mkdir -p "${dropin_dir}"
  cat >"${dropin_dir}/10-admin-env.conf" <<EOF
[Service]
Environment=OUTLOOK_LITE_DATA_DIR=${APP_DIR}/data
Environment=ADMIN_PASSWORD_FILE=${APP_DIR}/data/admin-password
Environment=ADMIN_SESSION_SECRET_FILE=${APP_DIR}/data/admin-session-secret
EOF
  systemctl daemon-reload

  if [[ "${generated_password}" == "yes" ]]; then
    printf '\n\033[1;33m已生成管理员后台密码，请保存：%s\033[0m\n' "${ADMIN_PASSWORD}"
  fi
}

main() {
  require_root

  if [[ ! -d "${APP_DIR}/.git" ]]; then
    fail "未找到项目仓库：${APP_DIR}"
  fi

  log "从 GitHub 同步最新代码"
  git config --global --add safe.directory "${APP_DIR}" >/dev/null 2>&1 || true
  git -C "${APP_DIR}" fetch origin "${BRANCH}"
  git -C "${APP_DIR}" checkout "${BRANCH}"
  git -C "${APP_DIR}" pull --ff-only origin "${BRANCH}"
  chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}"
  prepare_admin_data

  log "重启 Outlook Lite 服务"
  systemctl restart "${SERVICE_NAME}"
  systemctl --no-pager --full status "${SERVICE_NAME}"

  log "更新完成"
}

main "$@"
