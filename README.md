# Outlook Lite

Outlook Lite 是一个轻量级 Outlook 邮件读取工具。它只做一件事：临时管理 Outlook 账号，自动识别 `client_id` / `refresh_token` 顺序，读取收件箱邮件，并在界面里高亮可能的验证码。

项目不使用数据库，不需要第三方 Python 依赖，直接用 Python 标准库启动本地 Web 服务。

## 功能

- 支持两种 Outlook 账号格式自动识别：

  ```text
  邮箱----密码----client_id----refresh_token
  邮箱----密码----refresh_token----client_id
  ```

- 支持一次添加多个邮箱，每行一个账号。
- 邮箱和已读取邮件保存到浏览器 `localStorage`，刷新页面或关闭浏览器后仍可恢复。
- 不使用数据库，不在服务端保存账号。
- 点击左侧邮箱或右上角“获取邮件”读取当前邮箱。
- 默认展示最新 10 封邮件，底部可点击“加载更多”继续展示。
- 自动提取疑似验证码，显示在邮件标题旁，点击即可复制。
- 邮件详情支持 HTML 内容渲染，也支持“显示邮件源”查看原始 JSON。
- 支持复制邮箱名、复制账号令牌。
- 支持清空本地保存的邮箱和邮件缓存，带确认弹窗防误触。

## 运行环境

- Python 3.10 或更新版本
- 现代浏览器

不需要安装 Flask、FastAPI、Node 依赖或数据库。

## 启动

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

## 使用方式

1. 点击左上角“添加邮箱”。
2. 粘贴一行或多行账号，每行一个：

   ```text
   user@outlook.com----password----client_id----refresh_token
   user@outlook.com----password----refresh_token----client_id
   ```

3. 点击“添加邮箱”。
4. 点击左侧邮箱卡片，或点击右上角“获取邮件”。
5. 在中间列表点击邮件查看详情。
6. 如果标题旁出现验证码胶囊，点击即可复制。

## 数据保存说明

Outlook Lite 不使用数据库。为了刷新页面后仍能看到临时邮箱，以下内容会保存在当前浏览器的 `localStorage`：

- 邮箱账号行
- 邮件缓存
- 当前选中的邮箱和邮件
- 当前筛选和展示数量

这些数据只保存在本机浏览器里。由于账号行包含 `refresh_token`，请只在可信设备上使用。如果不再需要，点击页面左侧“清空本地邮箱”删除本地保存数据。

## 邮件读取方式

读取流程：

1. 优先使用 Microsoft Graph。
2. 如果 Graph 失败，尝试 IMAP XOAUTH2。

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
├── app.py              # 本地 HTTP 服务、Outlook 解析、Graph/IMAP 读取
├── static/
│   ├── index.html      # 前端页面
│   ├── app.js          # 前端交互、localStorage、验证码提取
│   └── styles.css      # 页面样式
└── tests/
    └── test_parser.py  # 解析和邮件正文处理测试
```

## 安全提示

- 不要把真实账号、密码、`refresh_token` 粘贴到公开 issue、聊天记录或截图里。
- `refresh_token` 等同于邮箱访问凭证，请妥善保管。
- 本工具只适合本地临时管理 Outlook 邮箱，不建议部署到公网。
