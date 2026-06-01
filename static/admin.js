const loginCard = document.querySelector("#login-card");
const passwordInput = document.querySelector("#admin-password");
const statusBox = document.querySelector("#admin-status");
const dashboard = document.querySelector("#admin-dashboard");
const statGrid = document.querySelector("#stat-grid");
const importDomains = document.querySelector("#import-domains");
const fetchDomains = document.querySelector("#fetch-domains");
const sourcesBox = document.querySelector("#sources");
const failureReasons = document.querySelector("#failure-reasons");
const recentEvents = document.querySelector("#recent-events");
const refreshButton = document.querySelector("#refresh-button");
const exportButton = document.querySelector("#export-button");
const resetButton = document.querySelector("#reset-button");
const logoutButton = document.querySelector("#logout-button");
const toast = document.querySelector("#toast");

let toastTimer = 0;

function redirectToFrontLogin() {
  // 后台不再放重复登录表单，未授权时统一回到前台齿轮入口登录。
  const url = new URL("/", window.location.href);
  url.searchParams.set("admin", "login");
  window.location.replace(url.toString());
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatNumber(value) {
  return new Intl.NumberFormat("zh-CN").format(Number(value || 0));
}

function formatDate(value) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function setStatus(message, type = "") {
  if (!statusBox) {
    return;
  }
  statusBox.textContent = message || "";
  statusBox.className = `admin-status ${type}`.trim();
}

function showToast(message) {
  if (!toast) {
    return;
  }
  toast.textContent = message;
  toast.classList.add("visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast.classList.remove("visible");
  }, 1500);
}

function setLoggedIn(loggedIn) {
  if (loginCard) {
    loginCard.hidden = true;
  }
  dashboard.hidden = !loggedIn;
  refreshButton.hidden = !loggedIn;
  exportButton.hidden = !loggedIn;
  resetButton.hidden = !loggedIn;
  logoutButton.hidden = !loggedIn;
}

async function readJsonResponse(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "请求失败");
  }
  return data;
}

function renderStats(stats) {
  const publicStats = stats.public || {};
  const counters = stats.counters || {};
  const cards = [
    ["在线人数", publicStats.online_count],
    ["累计访问", publicStats.visit_total],
    ["独立访客", publicStats.visitor_total],
    ["导入邮箱", publicStats.import_total],
    ["累计读取", publicStats.fetch_total],
    ["读取成功", publicStats.fetch_success],
    ["读取失败", publicStats.fetch_failed],
    ["累计邮件数", publicStats.message_total],
    ["心跳次数", counters.heartbeat_total],
    ["创建时间", formatDate(stats.created_at)],
    ["更新时间", formatDate(stats.updated_at)],
    ["存储模式", "文件版"],
  ];

  statGrid.innerHTML = cards
    .map(([label, value]) => `
      <article class="admin-stat-card">
        <span>${escapeHtml(label)}</span>
        <strong>${typeof value === "number" ? formatNumber(value) : escapeHtml(value)}</strong>
      </article>
    `)
    .join("");

  renderCountList(importDomains, stats.import_domains || [], "暂无导入域名");
  renderCountList(fetchDomains, stats.fetch_domains || [], "暂无读取域名");
  renderCountList(sourcesBox, stats.sources || [], "暂无读取来源");
  renderCountList(failureReasons, stats.failure_reasons || [], "暂无失败记录");
  renderEvents(stats.recent_events || []);
}

function renderCountList(container, rows, emptyText) {
  container.innerHTML = rows.length
    ? rows.slice(0, 12).map((item) => `
      <div class="admin-list-row">
        <span title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</span>
        <strong>${formatNumber(item.count)}</strong>
      </div>
    `).join("")
    : `<p class="admin-empty">${escapeHtml(emptyText)}</p>`;
}

function eventTitle(event) {
  if (event.type === "import") {
    return `导入 ${formatNumber(event.count)} 个邮箱`;
  }
  if (event.type === "fetch_success") {
    return `读取成功，${formatNumber(event.message_count)} 封`;
  }
  if (event.type === "fetch_failed") {
    return `读取失败：${event.reason || "未知错误"}`;
  }
  return event.type || "未知事件";
}

function eventMeta(event) {
  if (event.type === "import") {
    return Object.entries(event.domains || {})
      .map(([domain, count]) => `${domain} × ${count}`)
      .join("，") || "-";
  }
  return [event.domain, event.source, event.scope].filter(Boolean).join(" · ") || "-";
}

function renderEvents(events) {
  recentEvents.innerHTML = events.length
    ? events.slice(0, 60).map((event) => `
      <div class="admin-event">
        <time>${escapeHtml(formatDate(event.time))}</time>
        <strong>${escapeHtml(event.type || "-")}</strong>
        <p title="${escapeHtml(eventTitle(event))}">${escapeHtml(eventTitle(event))}</p>
        <em title="${escapeHtml(eventMeta(event))}">${escapeHtml(eventMeta(event))}</em>
      </div>
    `).join("")
    : `<p class="admin-empty">暂无事件</p>`;
}

async function loadStats({ quiet = false } = {}) {
  try {
    const response = await fetch("/api/admin/stats");
    const data = await readJsonResponse(response);
    setLoggedIn(true);
    renderStats(data.stats);
    if (!quiet) {
      showToast("统计已刷新");
    }
  } catch (error) {
    setLoggedIn(false);
    showToast(error.message || "登录已过期，请重新登录");
    window.setTimeout(redirectToFrontLogin, quiet ? 0 : 650);
  }
}

refreshButton.addEventListener("click", () => loadStats());

resetButton.addEventListener("click", async () => {
  if (!window.confirm("确认清空所有统计记录？这不会删除邮箱令牌。")) {
    return;
  }
  try {
    const response = await fetch("/api/admin/reset", { method: "POST" });
    await readJsonResponse(response);
    await loadStats({ quiet: true });
    showToast("统计已清空");
  } catch (error) {
    showToast(error.message);
  }
});

logoutButton.addEventListener("click", async () => {
  await fetch("/api/admin/logout", { method: "POST" }).catch(() => {});
  setLoggedIn(false);
  window.location.href = "/";
});

loadStats({ quiet: true });
