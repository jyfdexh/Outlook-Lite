#!/usr/bin/env bash
set -Eeuo pipefail

BRANCH="${BRANCH:-main}"
APP_DIR="${APP_DIR:-/opt/outlook-lite}"
APP_USER="${APP_USER:-outlooklite}"
SERVICE_NAME="${SERVICE_NAME:-outlook-lite}"

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

  log "重启 Outlook Lite 服务"
  systemctl restart "${SERVICE_NAME}"
  systemctl --no-pager --full status "${SERVICE_NAME}"

  log "更新完成"
}

main "$@"
