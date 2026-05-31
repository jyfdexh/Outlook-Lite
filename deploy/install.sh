#!/usr/bin/env bash
set -Eeuo pipefail

DOMAIN="${DOMAIN:-mail.2333330.xyz}"
REPO_URL="${REPO_URL:-https://github.com/jyfdexh/Outlook-Lite.git}"
BRANCH="${BRANCH:-main}"
APP_DIR="${APP_DIR:-/opt/outlook-lite}"
APP_USER="${APP_USER:-outlooklite}"
APP_HOST="${APP_HOST:-127.0.0.1}"
APP_PORT="${APP_PORT:-8765}"
SERVICE_NAME="${SERVICE_NAME:-outlook-lite}"
SSL_DIR="${SSL_DIR:-/etc/ssl/outlook-lite}"
NGINX_SITE="/etc/nginx/sites-available/${SERVICE_NAME}"
NGINX_ENABLED="/etc/nginx/sites-enabled/${SERVICE_NAME}"

log() {
  printf '\n\033[1;32m%s\033[0m\n' "$1"
}

fail() {
  printf '\n\033[1;31m%s\033[0m\n' "$1" >&2
  exit 1
}

require_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    fail "请使用 root 权限运行，例如：sudo env DOMAIN=${DOMAIN} bash deploy/install.sh"
  fi
}

install_packages() {
  log "安装系统依赖"
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y \
    ca-certificates \
    git \
    nginx \
    openssl \
    python3
}

ensure_user() {
  if id "${APP_USER}" >/dev/null 2>&1; then
    log "系统用户 ${APP_USER} 已存在"
    return
  fi
  log "创建系统用户 ${APP_USER}"
  useradd --system --home-dir "${APP_DIR}" --shell /usr/sbin/nologin "${APP_USER}"
}

sync_repository() {
  log "同步项目代码"
  git config --global --add safe.directory "${APP_DIR}" >/dev/null 2>&1 || true
  if [[ -d "${APP_DIR}/.git" ]]; then
    git -C "${APP_DIR}" fetch origin "${BRANCH}"
    git -C "${APP_DIR}" checkout "${BRANCH}"
    git -C "${APP_DIR}" pull --ff-only origin "${BRANCH}"
  else
    rm -rf "${APP_DIR}"
    git clone --branch "${BRANCH}" "${REPO_URL}" "${APP_DIR}"
  fi
  chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}"
  chmod +x "${APP_DIR}/deploy/update.sh"
}

write_systemd_service() {
  log "写入 systemd 服务"
  cat >"/etc/systemd/system/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=Outlook Lite 令牌取件服务
After=network-online.target
Wants=network-online.target

[Service]
User=${APP_USER}
Group=${APP_USER}
WorkingDirectory=${APP_DIR}
ExecStart=/usr/bin/python3 ${APP_DIR}/app.py --host ${APP_HOST} --port ${APP_PORT}
Restart=always
RestartSec=3
Environment=PYTHONUNBUFFERED=1
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable --now "${SERVICE_NAME}"
}

write_update_command() {
  log "安装更新命令"
  ln -sf "${APP_DIR}/deploy/update.sh" /usr/local/bin/outlook-lite-update
}

ensure_self_signed_cert() {
  log "准备 HTTPS 源站证书"
  mkdir -p "${SSL_DIR}"
  if [[ -f "${SSL_DIR}/${DOMAIN}.crt" && -f "${SSL_DIR}/${DOMAIN}.key" ]]; then
    log "源站证书已存在，跳过生成"
    return
  fi

  # 这里生成自签证书，配合 Cloudflare SSL/TLS 的 Full 模式使用；如果要 Full strict，请替换为 Cloudflare Origin Certificate。
  openssl req -x509 -nodes -newkey rsa:2048 -days 3650 \
    -keyout "${SSL_DIR}/${DOMAIN}.key" \
    -out "${SSL_DIR}/${DOMAIN}.crt" \
    -subj "/CN=${DOMAIN}" \
    -addext "subjectAltName=DNS:${DOMAIN}"
  chmod 600 "${SSL_DIR}/${DOMAIN}.key"
}

write_nginx_site() {
  log "写入 Nginx 反向代理"
  cat >"${NGINX_SITE}" <<EOF
server {
    listen 80;
    server_name ${DOMAIN};
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl http2;
    server_name ${DOMAIN};

    ssl_certificate ${SSL_DIR}/${DOMAIN}.crt;
    ssl_certificate_key ${SSL_DIR}/${DOMAIN}.key;

    client_max_body_size 2m;

    location / {
        proxy_pass http://${APP_HOST}:${APP_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_connect_timeout 15s;
        proxy_send_timeout 90s;
        proxy_read_timeout 90s;
    }
}
EOF

  ln -sf "${NGINX_SITE}" "${NGINX_ENABLED}"
  nginx -t
  systemctl reload nginx
}

print_next_steps() {
  log "部署完成"
  cat <<EOF
访问地址：https://${DOMAIN}

Cloudflare 建议设置：
1. DNS 添加 A 记录：mail -> 你的服务器 IP，并开启橙色云。
2. SSL/TLS 模式选择 Full。当前脚本使用自签源站证书，Full strict 不适用。
3. Zero Trust Access 添加 Self-hosted 应用，域名填 ${DOMAIN}，只允许你的邮箱访问。

以后服务器同步 GitHub 更新：
sudo outlook-lite-update

查看服务状态：
sudo systemctl status ${SERVICE_NAME}

查看服务日志：
sudo journalctl -u ${SERVICE_NAME} -f
EOF
}

main() {
  require_root
  install_packages
  ensure_user
  sync_repository
  write_systemd_service
  write_update_command
  ensure_self_signed_cert
  write_nginx_site
  print_next_steps
}

main "$@"
