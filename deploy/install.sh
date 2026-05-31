#!/usr/bin/env bash
set -Eeuo pipefail

DOMAIN_INPUT="${DOMAIN-}"
BIND_DOMAIN_INPUT="${BIND_DOMAIN-}"
USE_CLOUDFLARE_INPUT="${USE_CLOUDFLARE-}"
CONFIRM_DEPLOY_INPUT="${CONFIRM_DEPLOY-}"
NONINTERACTIVE_INPUT="${NONINTERACTIVE-}"
REPO_URL_INPUT="${REPO_URL-}"
BRANCH_INPUT="${BRANCH-}"
APP_DIR_INPUT="${APP_DIR-}"
APP_USER_INPUT="${APP_USER-}"
APP_HOST_INPUT="${APP_HOST-}"
APP_PORT_INPUT="${APP_PORT-}"
SERVICE_NAME_INPUT="${SERVICE_NAME-}"
SSL_DIR_INPUT="${SSL_DIR-}"
USE_DEFAULT_PATHS_INPUT="${USE_DEFAULT_PATHS-}"

DOMAIN=""
BIND_DOMAIN=""
USE_CLOUDFLARE=""
CONFIRM_DEPLOY=""
REPO_URL=""
BRANCH=""
APP_DIR=""
APP_USER=""
APP_HOST=""
APP_PORT=""
SERVICE_NAME=""
SSL_DIR=""
NGINX_SITE=""
NGINX_ENABLED=""
ENABLE_HTTPS="no"
HAS_TTY="no"

DEFAULT_REPO_URL="https://github.com/jyfdexh/Outlook-Lite.git"
DEFAULT_BRANCH="main"
DEFAULT_APP_DIR="/opt/outlook-lite"
DEFAULT_APP_USER="outlooklite"
DEFAULT_APP_HOST="127.0.0.1"
DEFAULT_APP_PORT="8765"
DEFAULT_SERVICE_NAME="outlook-lite"
DEFAULT_SSL_DIR="/etc/ssl/outlook-lite"

log() {
  printf '\n\033[1;32m%s\033[0m\n' "$1"
}

note() {
  printf '\033[1;36m%s\033[0m\n' "$1"
}

fail() {
  printf '\n\033[1;31m%s\033[0m\n' "$1" >&2
  exit 1
}

require_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    fail "请使用 root 权限运行，例如：curl -fsSL 安装脚本地址 | sudo bash"
  fi
}

detect_tty() {
  local normalized_noninteractive=""
  if [[ -n "${NONINTERACTIVE_INPUT}" ]]; then
    normalized_noninteractive="$(normalize_yes_no "${NONINTERACTIVE_INPUT}")" || fail "NONINTERACTIVE 只能填写 yes 或 no"
    if [[ "${normalized_noninteractive}" == "yes" ]]; then
      HAS_TTY="no"
      return
    fi
  fi

  if [[ -r /dev/tty && -w /dev/tty ]]; then
    HAS_TTY="yes"
  fi
}

normalize_yes_no() {
  local value
  value="$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')"
  case "${value}" in
    y|yes|1|true|on|是|绑定|启用)
      printf 'yes'
      ;;
    n|no|0|false|off|否|不绑定|禁用)
      printf 'no'
      ;;
    *)
      return 1
      ;;
  esac
}

ask_yes_no() {
  local preset="${1:-}"
  local question="$2"
  local default_value="$3"
  local default_label="Y/n"
  local answer=""
  local normalized=""

  if [[ -n "${preset}" ]]; then
    normalized="$(normalize_yes_no "${preset}")" || fail "无法识别选项：${preset}，请使用 yes 或 no"
    printf '%s' "${normalized}"
    return
  fi

  if [[ "${HAS_TTY}" != "yes" ]]; then
    printf '%s' "${default_value}"
    return
  fi

  if [[ "${default_value}" == "no" ]]; then
    default_label="y/N"
  fi

  while true; do
    printf '%s [%s]: ' "${question}" "${default_label}" >/dev/tty
    IFS= read -r answer </dev/tty || fail "无法读取输入"
    answer="${answer:-${default_value}}"
    normalized="$(normalize_yes_no "${answer}")" && {
      printf '%s' "${normalized}"
      return
    }
    printf '请输入 yes 或 no。\n' >/dev/tty
  done
}

ask_text() {
  local preset="${1:-}"
  local question="$2"
  local default_value="${3:-}"
  local required="${4:-no}"
  local answer=""

  if [[ -n "${preset}" ]]; then
    printf '%s' "${preset}"
    return
  fi

  if [[ "${HAS_TTY}" != "yes" ]]; then
    if [[ "${required}" == "yes" && -z "${default_value}" ]]; then
      fail "缺少必填配置：${question}"
    fi
    printf '%s' "${default_value}"
    return
  fi

  while true; do
    if [[ -n "${default_value}" ]]; then
      printf '%s [%s]: ' "${question}" "${default_value}" >/dev/tty
    else
      printf '%s: ' "${question}" >/dev/tty
    fi
    IFS= read -r answer </dev/tty || fail "无法读取输入"
    answer="${answer:-${default_value}}"
    if [[ -n "${answer}" || "${required}" != "yes" ]]; then
      printf '%s' "${answer}"
      return
    fi
    printf '这里不能为空。\n' >/dev/tty
  done
}

configure_wizard() {
  log "Outlook Lite 部署向导"
  note "直接回车会使用括号里的默认值。"

  if [[ -n "${DOMAIN_INPUT}" && -z "${BIND_DOMAIN_INPUT}" ]]; then
    BIND_DOMAIN_INPUT="yes"
  fi

  BIND_DOMAIN="$(ask_yes_no "${BIND_DOMAIN_INPUT}" "是否绑定域名？" "yes")"
  if [[ "${BIND_DOMAIN}" == "yes" ]]; then
    DOMAIN="$(ask_text "${DOMAIN_INPUT}" "请输入域名，只填域名，不带 http:// 或 https://" "" "yes")"
    USE_CLOUDFLARE="$(ask_yes_no "${USE_CLOUDFLARE_INPUT}" "是否使用 Cloudflare 代理？使用后脚本会配置 HTTPS 源站证书" "yes")"
  else
    DOMAIN=""
    USE_CLOUDFLARE="no"
  fi

  REPO_URL="$(ask_text "${REPO_URL_INPUT}" "GitHub 仓库地址" "${DEFAULT_REPO_URL}" "yes")"
  BRANCH="$(ask_text "${BRANCH_INPUT}" "部署分支" "${DEFAULT_BRANCH}" "yes")"
  APP_HOST="$(ask_text "${APP_HOST_INPUT}" "本机监听地址" "${DEFAULT_APP_HOST}" "yes")"
  APP_PORT="$(ask_text "${APP_PORT_INPUT}" "本机服务端口" "${DEFAULT_APP_PORT}" "yes")"

  local use_default_paths
  use_default_paths="$(ask_yes_no "${USE_DEFAULT_PATHS_INPUT}" "是否使用默认安装路径和服务名？" "yes")"
  if [[ "${use_default_paths}" != "yes" ]]; then
    APP_DIR="$(ask_text "${APP_DIR_INPUT}" "安装目录" "${DEFAULT_APP_DIR}" "yes")"
    APP_USER="$(ask_text "${APP_USER_INPUT}" "运行用户" "${DEFAULT_APP_USER}" "yes")"
    SERVICE_NAME="$(ask_text "${SERVICE_NAME_INPUT}" "systemd 服务名" "${DEFAULT_SERVICE_NAME}" "yes")"
    SSL_DIR="$(ask_text "${SSL_DIR_INPUT}" "HTTPS 源站证书目录" "${DEFAULT_SSL_DIR}" "yes")"
  else
    APP_DIR="${APP_DIR_INPUT:-${DEFAULT_APP_DIR}}"
    APP_USER="${APP_USER_INPUT:-${DEFAULT_APP_USER}}"
    SERVICE_NAME="${SERVICE_NAME_INPUT:-${DEFAULT_SERVICE_NAME}}"
    SSL_DIR="${SSL_DIR_INPUT:-${DEFAULT_SSL_DIR}}"
  fi

  if [[ "${BIND_DOMAIN}" == "yes" && "${USE_CLOUDFLARE}" == "yes" ]]; then
    ENABLE_HTTPS="yes"
  fi

  refresh_derived_config
  print_plan
  CONFIRM_DEPLOY="$(ask_yes_no "${CONFIRM_DEPLOY_INPUT}" "确认开始部署？" "yes")"
  if [[ "${CONFIRM_DEPLOY}" != "yes" ]]; then
    fail "已取消部署"
  fi
}

refresh_derived_config() {
  NGINX_SITE="/etc/nginx/sites-available/${SERVICE_NAME}"
  NGINX_ENABLED="/etc/nginx/sites-enabled/${SERVICE_NAME}"
}

validate_config() {
  if [[ "${BIND_DOMAIN}" == "yes" ]]; then
    if [[ -z "${DOMAIN}" ]]; then
      fail "绑定域名时必须填写 DOMAIN"
    fi
    if [[ "${DOMAIN}" == *"/"* || "${DOMAIN}" == *":"* || "${DOMAIN}" == *" "* ]]; then
      fail "域名只填写主机名，不要包含协议、路径或空格，例如：mail.example.com"
    fi
  fi

  if ! [[ "${APP_PORT}" =~ ^[0-9]+$ ]] || (( APP_PORT < 1 || APP_PORT > 65535 )); then
    fail "端口必须是 1 到 65535 之间的数字"
  fi

  if [[ -z "${REPO_URL}" || -z "${BRANCH}" || -z "${APP_DIR}" || -z "${APP_USER}" || -z "${SERVICE_NAME}" ]]; then
    fail "仓库、分支、安装目录、运行用户和服务名不能为空"
  fi

  if [[ "${APP_DIR}" != /* ]]; then
    fail "安装目录必须是绝对路径，例如：/opt/outlook-lite"
  fi
  case "${APP_DIR}" in
    /|/bin|/boot|/dev|/etc|/home|/lib|/lib64|/media|/mnt|/opt|/proc|/root|/run|/sbin|/srv|/sys|/tmp|/usr|/var)
      fail "安装目录过于危险，请使用类似 /opt/outlook-lite 的独立目录"
      ;;
  esac
  if [[ "${APP_DIR}" != /opt/* ]]; then
    fail "为了避免误删系统目录，安装目录必须放在 /opt/ 下，例如：/opt/outlook-lite"
  fi

  if ! [[ "${APP_USER}" =~ ^[a-z_][a-z0-9_-]*[$]?$ ]]; then
    fail "运行用户只能使用小写字母、数字、下划线和短横线，例如：outlooklite"
  fi
  if ! [[ "${SERVICE_NAME}" =~ ^[A-Za-z0-9_.@-]+$ ]]; then
    fail "systemd 服务名只能使用字母、数字、点、下划线、@ 和短横线"
  fi
  if ! [[ "${APP_HOST}" =~ ^[A-Za-z0-9_.:-]+$ ]]; then
    fail "本机监听地址包含不支持的字符"
  fi
}

print_plan() {
  local public_access="服务器 IP 的 HTTP 访问"
  local target="/dev/stdout"
  if [[ "${BIND_DOMAIN}" == "yes" && "${ENABLE_HTTPS}" == "yes" ]]; then
    public_access="https://${DOMAIN}"
  elif [[ "${BIND_DOMAIN}" == "yes" ]]; then
    public_access="http://${DOMAIN}"
  fi

  if [[ "${HAS_TTY}" == "yes" ]]; then
    target="/dev/tty"
  fi

  cat >"${target}" <<EOF

部署计划：
- 公开访问：${public_access}
- 仓库地址：${REPO_URL}
- 部署分支：${BRANCH}
- 安装目录：${APP_DIR}
- 运行用户：${APP_USER}
- 本机服务：${APP_HOST}:${APP_PORT}
- systemd 服务：${SERVICE_NAME}
- Nginx 配置：${NGINX_SITE}

EOF
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
  if [[ "${ENABLE_HTTPS}" != "yes" ]]; then
    return
  fi

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
  local server_name="_"
  if [[ -n "${DOMAIN}" ]]; then
    server_name="${DOMAIN}"
  fi

  if [[ "${ENABLE_HTTPS}" == "yes" ]]; then
    cat >"${NGINX_SITE}" <<EOF
server {
    listen 80;
    server_name ${server_name};
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl http2;
    server_name ${server_name};

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
  else
    cat >"${NGINX_SITE}" <<EOF
server {
    listen 80;
    server_name ${server_name};

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
  fi

  rm -f /etc/nginx/sites-enabled/default
  ln -sf "${NGINX_SITE}" "${NGINX_ENABLED}"
  nginx -t
  systemctl reload nginx
}

server_ip() {
  hostname -I 2>/dev/null | awk '{print $1}'
}

print_next_steps() {
  log "部署完成"

  if [[ "${BIND_DOMAIN}" == "yes" && "${ENABLE_HTTPS}" == "yes" ]]; then
    cat <<EOF
访问地址：https://${DOMAIN}

Cloudflare 建议设置：
1. DNS 添加 A 记录：你的子域名 -> 你的服务器 IP，并开启橙色云。
2. SSL/TLS 模式选择 Full。当前脚本使用自签源站证书，Full strict 不适用。
3. Zero Trust Access 添加 Self-hosted 应用，域名填 ${DOMAIN}，只允许你的邮箱访问。
EOF
  elif [[ "${BIND_DOMAIN}" == "yes" ]]; then
    cat <<EOF
访问地址：http://${DOMAIN}

当前没有配置 HTTPS。生产使用建议接入 Cloudflare，或自行配置可信证书后改成 HTTPS。
EOF
  else
    cat <<EOF
访问地址：http://$(server_ip)/

当前未绑定域名，只配置了 HTTP。生产使用建议绑定域名并加访问保护。
EOF
  fi

  cat <<EOF

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
  detect_tty
  configure_wizard
  validate_config
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
