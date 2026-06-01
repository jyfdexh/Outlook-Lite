# Outlook Lite 令牌取件

Outlook Lite 是一个轻量级 Outlook 邮件读取工具。它专注做一件事：用 `client_id + refresh_token` 读取 Outlook 邮件，自动识别令牌顺序，并在界面里高亮可能的验证码。

项目不使用数据库，不需要第三方 Python 依赖，直接用 Python 标准库启动本地 Web 服务。

## 功能

- 支持两种 Outlook 令牌格式自动识别：

  ```text
  邮箱----密码----client_id----refresh_token
  邮箱----密码----refresh_token----client_id
  ```

- 支持一次添加多个邮箱令牌，每行一个。
- 粘贴或输入时实时检测格式，显示可导入数量、错误数量和重复数量。
- 默认只读取收件箱；点击“垃圾邮件”时才读取垃圾邮件，减少无意义请求。
- 每次只读取 10 封邮件，滚动到底部后可点击“加载更多”继续读取后 10 封。
- 邮件列表只读取摘要；点击邮件后才按需读取完整正文，减少慢请求。
- 支持 HTML 邮件渲染，也支持“显示邮件源”查看原始 JSON。
- 自动提取疑似验证码，显示在邮件标题旁，点击即可复制。
- 支持搜索邮件标题、发件人、邮箱和验证码。
- 支持复制邮箱名、复制邮箱令牌、删除单个邮箱。
- 支持导入、导出本地邮箱令牌列表。
- 支持只清空当前页面邮件缓存，不删除邮箱令牌。
- 支持清空本地邮箱令牌，带确认弹窗防误触。
- 支持多主题切换，默认主题为“亲生物设计”。
- 支持文件版管理员统计后台，不需要数据库。

## 运行环境

- Python 3.10 或更新版本
- 现代浏览器

不需要安装 Flask、FastAPI、Node 依赖或数据库。

## 启动

Windows 可以直接双击项目根目录的：

```text
start-outlook-lite.bat
```

脚本会自动启动本地服务并打开浏览器。如果 `8765` 端口已经在运行，会直接打开已有服务页面。

也可以手动启动：

```bash
python app.py --host 127.0.0.1 --port 8765
```

打开：

```text
http://127.0.0.1:8765/
```

也可以直接打开：

```text
static/index.html
```

如果用 `file://` 打开页面，前端会自动请求本地服务：

```text
http://127.0.0.1:8765/api/messages
```

因此仍需要先启动 `app.py`。

## Ubuntu 一键部署

如果你有 Ubuntu 22 服务器，可以直接用部署脚本安装为 `systemd` 服务，并用 Nginx 反向代理到域名。

推荐先在 Cloudflare 添加 DNS：

```text
类型：A
名称：mail
内容：你的服务器 IP
代理：开启，橙色云
```

然后在服务器执行：

```bash
curl -fsSL https://raw.githubusercontent.com/jyfdexh/Outlook-Lite/main/deploy/install.sh | sudo bash
```

脚本会进入部署向导，按提示选择：

- 是否绑定域名。
- 域名是什么，只填 `mail.example.com` 这种主机名。
- 是否使用 Cloudflare 代理。
- GitHub 仓库地址和部署分支。
- 本机监听地址和端口。
- 管理员后台密码；留空会自动生成随机密码。
- 是否使用默认安装目录、运行用户和服务名。
- 最后确认部署计划。

如果你想跳过交互，也可以通过环境变量预填配置：

```bash
curl -fsSL https://raw.githubusercontent.com/jyfdexh/Outlook-Lite/main/deploy/install.sh | sudo env DOMAIN=mail.example.com NONINTERACTIVE=yes bash
```

脚本会完成这些事情：

- 安装 `git`、`nginx`、`python3`。
- 拉取 GitHub 仓库到 `/opt/outlook-lite`。
- 创建 `outlooklite` 系统用户。
- 创建并启动 `outlook-lite.service`。
- 配置 Nginx，把你的域名转发到本机 `127.0.0.1:8765`。
- 创建 `/opt/outlook-lite/data` 文件版统计目录。
- 写入管理员密码文件和管理员会话密钥文件。
- 安装更新命令 `outlook-lite-update`。

脚本默认生成自签源站证书，适合 Cloudflare SSL/TLS 的 `Full` 模式。如果你要使用 `Full strict`，请把证书替换成 Cloudflare Origin Certificate。

部署完成后访问：

```text
https://mail.example.com
```

管理员后台：

```text
https://mail.example.com/admin
```

强烈建议在 Cloudflare Zero Trust Access 里给你的域名加登录保护，只允许你自己的邮箱访问。

## 服务器更新

本地改完并推送到 GitHub 后，服务器执行：

```bash
sudo outlook-lite-update
```

这个命令会自动：

- 从 GitHub 拉取 `main` 分支最新代码。
- 保留 `/opt/outlook-lite/data` 里的统计文件和管理员配置。
- 如果旧版本没有管理员配置，会自动生成管理员密码并在终端输出一次。
- 重启 `outlook-lite.service`。

如果想查看运行状态：

```bash
sudo systemctl status outlook-lite
```

如果想看实时日志：

```bash
sudo journalctl -u outlook-lite -f
```

## 使用方式

1. 点击左上角“添加邮箱”。
2. 粘贴一行或多行邮箱令牌，每行一个：

   ```text
   user@example.com----password----client_id----refresh_token
   user@example.com----password----refresh_token----client_id
   ```

   读取邮件实际使用 `client_id + refresh_token` 换取访问令牌；密码字段只是兼容原始账号格式的占位，不参与登录校验，可以任意填写。

3. 点击“添加邮箱”。
4. 点击左侧邮箱卡片，或点击“获取邮件”。
5. 在中间列表点击邮件查看详情。
6. 如果标题旁出现验证码胶囊，点击即可复制。

## 数据保存说明

Outlook Lite 不使用数据库，不在服务端保存账号。为了刷新页面或关闭浏览器后仍能看到临时邮箱，以下内容会保存在当前浏览器的 `localStorage`：

- 邮箱令牌原始行
- 邮箱导入时间
- 邮箱上次读取时间
- 当前主题和当前邮箱高亮色

当前版本不会把已读取邮件列表、邮件正文、当前选择、筛选条件和分页状态持久保存到 `localStorage`。刷新页面后会保留邮箱令牌列表，但邮件内容需要手动重新读取。

由于账号行包含 `refresh_token`，请只在可信设备上使用。如果不再需要，点击页面右上角“清空本地邮箱”删除本地保存的令牌。

## 文件版管理员统计

部署到服务器后可打开：

```text
/admin
```

管理员后台默认使用文件保存统计，不需要安装数据库。默认数据目录：

```text
/opt/outlook-lite/data
```

主要文件：

```text
data/analytics.json              # 聚合统计
data/events.log                  # 事件流水，一行一个 JSON
data/admin-password              # 管理员密码文件
data/admin-session-secret        # 管理员会话签名密钥
```

统计内容包括：

- 当前在线人数。
- 累计访问次数和独立访客数。
- 累计导入邮箱数量。
- 读取成功、读取失败、累计读取邮件数量。
- 导入域名分布和读取域名分布。
- Graph / IMAP 读取来源分布。
- 简化后的失败原因。
- 最近事件。

隐私边界：

- 不保存 `refresh_token`。
- 不保存 `client_id`。
- 不保存密码字段。
- 不保存完整邮箱令牌。
- 不保存邮件标题、正文、验证码。
- 不保存完整 IP，只用匿名访客 Cookie 统计访客和在线人数。

如果要手动修改管理员密码：

```bash
sudo sh -c 'printf "%s" "你的新密码" > /opt/outlook-lite/data/admin-password'
sudo chown outlooklite:outlooklite /opt/outlook-lite/data/admin-password
sudo chmod 600 /opt/outlook-lite/data/admin-password
sudo systemctl restart outlook-lite
```

## 邮件读取方式

读取流程：

1. 优先使用 Microsoft Graph。
2. 如果 Graph 失败，尝试 IMAP XOAUTH2 `outlook.live.com`。
3. 如果仍然失败，继续尝试 IMAP XOAUTH2 `outlook.office365.com`。

为了提升速度，Microsoft Graph 列表接口只请求摘要字段；IMAP 列表也只拉邮件头部。完整正文会在点击具体邮件后再按需读取。

`client_id` 会按 UUID 形态自动识别。如果第三段是 UUID，则按：

```text
client_id----refresh_token
```

如果第四段是 UUID，则按：

```text
refresh_token----client_id
```

## 测试

```bash
python -m unittest discover -s tests -v
python -m py_compile app.py
```

如果本机安装了 Node.js，还可以检查前端脚本语法：

```bash
node --check static/app.js
```

## 项目结构

```text
.
├── app.py                    # 本地 HTTP 服务、Outlook 解析、Graph/IMAP 读取
├── start-outlook-lite.bat    # Windows 一键启动脚本
├── static/
│   ├── index.html            # 前端页面
│   ├── admin.html            # 文件版管理员统计后台
│   ├── app.js                # 前端交互、本地邮箱列表、验证码提取
│   ├── admin.js              # 管理员统计后台交互
│   └── styles.css            # 页面样式和主题
├── deploy/
│   ├── install.sh            # Ubuntu 交互式一键部署
│   └── update.sh             # 服务器同步 GitHub 更新
└── tests/
    └── test_parser.py        # 解析、Graph、IMAP 和正文处理测试
```

## 安全提示

- 不要把真实账号、密码、`refresh_token` 粘贴到公开 issue、聊天记录或截图里。
- `refresh_token` 等同于邮箱访问凭证，请妥善保管。
- 本工具默认适合本地临时管理 Outlook 邮箱；如果部署到公网，建议加登录保护、HTTPS 和访问白名单。
